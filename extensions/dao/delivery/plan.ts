import type { DeliveryPlan, DeliveryPhase, DeliveryTask } from "../types.js";
import { getState, setState } from "../persistence.js";

// ---------------------------------------------------------------------------
// Effort mapping helpers
// ---------------------------------------------------------------------------

const EFFORT_PATTERNS: [RegExp, DeliveryTask["effort"]][] = [
  [/hours?/i, "xs"],
  [/1[-\s]?2\s*days?/i, "s"],
  [/few\s*days?/i, "s"],
  [/3[-\s]?5\s*days?/i, "m"],
  [/\bdays?\b/i, "m"],
  [/1[-\s]?2\s*weeks?/i, "l"],
  [/\bweeks?\b/i, "xl"],
];

const mapEffort = (raw: string): DeliveryTask["effort"] => {
  const trimmed = raw.trim();
  for (const [re, effort] of EFFORT_PATTERNS) {
    if (re.test(trimmed)) return effort;
  }
  return "m";
};

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** Extract all phase blocks from the delivery agent output. */
const parsePhases = (output: string): DeliveryPhase[] => {
  const phases: DeliveryPhase[] = [];

  // Match phase headers like "#### Phase 1: Name (Week X-Y)" or "### Phase 1: Name"
  const phaseRegex = /#{2,4}\s+Phase\s+(\d+)\s*:\s*(.+?)(?:\s*\(([^)]+)\))?\s*\n/gi;

  const phaseMatches = [...output.matchAll(phaseRegex)];

  for (const match of phaseMatches) {
    const num = parseInt(match[1], 10);
    const name = match[2].trim();
    const duration = match[3]?.trim() ?? "";

    // Grab everything until the next phase header or a known section header
    const startIdx = match.index! + match[0].length;
    const nextPhase = output.indexOf("Phase", startIdx);
    const nextSection = output.search(/#{2,3}\s+(Branch Strategy|Rollback Plan|Total Estimated)/i);

    let endIdx = output.length;
    if (nextPhase > startIdx) endIdx = Math.min(endIdx, nextPhase);
    if (nextSection > startIdx) endIdx = Math.min(endIdx, nextSection);

    const body = output.slice(startIdx, endIdx);
    const tasks = parseTasks(body, num);

    phases.push({ number: num, name, tasks, duration });
  }

  return phases;
};

/** Parse task lines from a phase body. */
const parseTasks = (body: string, phaseNum: number): DeliveryTask[] => {
  const tasks: DeliveryTask[] = [];

  // Match "- Task N.M: Description — Effort: estimate" or "- Task N.M: Description"
  const taskRegex = /[-*]\s+Task\s+(\d+\.\d+)\s*:\s*(.+?)(?:\s*[—-]\s*(?:Effort|effort)\s*:\s*(.+?))?$/gm;

  for (const match of body.matchAll(taskRegex)) {
    const id = match[1].trim();
    const description = match[2].trim();
    const effortRaw = match[3] ?? "";

    tasks.push({
      id,
      title: description.split(/[.!?]\s/)[0] || description.slice(0, 80),
      description,
      effort: effortRaw ? mapEffort(effortRaw) : "m",
      phase: phaseNum,
      dependencies: parseDependencies(description),
      status: "pending",
    });
  }

  return tasks;
};

/** Look for dependency references like "(depends on 1.1, 1.2)" in task text. */
const parseDependencies = (text: string): string[] => {
  const depMatch = text.match(/(?:depends?\s+on|deps?:)\s*([0-9.,\s]+)/i);
  if (!depMatch) return [];
  return depMatch[1]
    .split(/[,\s]+/)
    .map((d) => d.trim())
    .filter((d) => /^\d+\.\d+$/.test(d));
};

/** Extract a named section's text from the output. */
const extractSection = (output: string, heading: string): string => {
  const re = new RegExp(`#{2,3}\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n#{2,3}\\s|\\n---\\s*$|$)`, "i");
  const match = output.match(re);
  return match ? match[1].trim() : "";
};

/** Extract the total estimated duration value. */
const extractDuration = (output: string): string => {
  const match = output.match(/\*?\*?Total\s+Estimated\s+Duration:?\*?\*?\s*(.+)/i);
  return match ? match[1].trim() : "TBD";
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a DeliveryPlan from the delivery agent's markdown output.
 * Falls back to a simple single-phase plan if parsing yields no phases.
 */
export const parseDeliveryPlan = (
  proposalId: number,
  deliveryOutput: string
): DeliveryPlan => {
  const phases = parsePhases(deliveryOutput);
  const branchStrategy = extractSection(deliveryOutput, "Branch Strategy");
  const rollbackPlan = extractSection(deliveryOutput, "Rollback Plan");
  const estimatedDuration = extractDuration(deliveryOutput);

  // Fallback: single-phase plan with one task
  if (phases.length === 0) {
    return {
      proposalId,
      createdAt: new Date().toISOString(),
      phases: [
        {
          number: 1,
          name: "Execution",
          tasks: [
            {
              id: "1.1",
              title: "Execute proposal",
              description: "Execute the approved proposal as described in the synthesis.",
              effort: "m",
              phase: 1,
              dependencies: [],
              status: "pending",
            },
          ],
          duration: estimatedDuration !== "TBD" ? estimatedDuration : "",
        },
      ],
      branchStrategy: branchStrategy || "Feature branch with PR review",
      rollbackPlan: rollbackPlan || "Revert to previous state via git revert",
      estimatedDuration: estimatedDuration !== "TBD" ? estimatedDuration : "1-2 weeks",
    };
  }

  return {
    proposalId,
    createdAt: new Date().toISOString(),
    phases,
    branchStrategy: branchStrategy || "Feature branch with PR review",
    rollbackPlan: rollbackPlan || "Revert to previous state via git revert",
    estimatedDuration,
  };
};

/** Store a delivery plan in persisted state. */
export const storePlan = (plan: DeliveryPlan): void => {
  const state = getState();
  state.deliveryPlans[plan.proposalId] = plan;
  setState(state);
};

/** Retrieve a stored delivery plan. */
export const getPlan = (proposalId: number): DeliveryPlan | undefined =>
  getState().deliveryPlans[proposalId];

/** Format a delivery plan as readable markdown. */
export const formatPlan = (plan: DeliveryPlan): string => {
  const lines: string[] = [];

  lines.push(`# Delivery Plan — Proposal #${plan.proposalId}`);
  lines.push("");

  for (const phase of plan.phases) {
    const durationTag = phase.duration ? ` (${phase.duration})` : "";
    lines.push(`## Phase ${phase.number}: ${phase.name}${durationTag}`);
    lines.push("");

    if (phase.tasks.length > 0) {
      lines.push("| # | Task | Effort | Dependencies | Status |");
      lines.push("|---|------|--------|--------------|--------|");
      for (const task of phase.tasks) {
        const deps = task.dependencies.length > 0 ? task.dependencies.join(", ") : "—";
        lines.push(
          `| ${task.id} | ${task.title} | ${task.effort} | ${deps} | ${task.status} |`
        );
      }
      lines.push("");
    }
  }

  if (plan.branchStrategy) {
    lines.push("## Branch Strategy");
    lines.push(plan.branchStrategy);
    lines.push("");
  }

  if (plan.rollbackPlan) {
    lines.push("## Rollback Plan");
    lines.push(plan.rollbackPlan);
    lines.push("");
  }

  lines.push(`**Estimated Duration:** ${plan.estimatedDuration}`);

  return lines.join("\n");
};
