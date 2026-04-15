// ============================================================
// pi-swarm-dao — Round Table: Each agent proposes an idea
// ============================================================
// During a round table, every agent suggests a proposal idea.
// Suggestions are automatically parsed and converted into
// formal DAO proposals (open status) ready for deliberation.
// ============================================================

import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DAOAgent, ProposalType } from "../types.js";
import { PROPOSAL_TYPES } from "../types.js";
import { getState } from "../persistence.js";
import { extractAssistantMessage } from "../pi-json.js";
import { detectHostContext } from "../host-context.js";

/** Max chars for a round table suggestion (prevents oversized output). */
const MAX_SUGGESTION_CHARS = 2_000;

/** Result of a single agent's round table suggestion. */
export interface RoundTableSuggestion {
  agentId: string;
  agentName: string;
  role: string;
  weight: number;
  suggestion: string;
  /** Parsed fields from the agent's output. */
  parsed?: {
    title: string;
    type: ProposalType;
    description: string;
  };
  error?: string;
  durationMs: number;
}

// ── Parsing ──────────────────────────────────────────────────

/** Parse an agent's structured output into title, type, description. */
const parseSuggestion = (raw: string): RoundTableSuggestion["parsed"] => {
  // Extract title
  const titleMatch = raw.match(/###\s*Title\s*\n\s*(.+)/i)
    ?? raw.match(/\*\*Title:\*\*\s*(.+)/i)
    ?? raw.match(/^#\s+(.+)/m);
  const title = titleMatch?.[1]?.trim() ?? "";

  // Extract type
  const typeMatch = raw.match(
    /###\s*Type\s*\n\s*(product-feature|security-change|technical-change|release-change|governance-change)/i
  ) ?? raw.match(
    /\*\*Type:\*\*\s*(product-feature|security-change|technical-change|release-change|governance-change)/i
  );
  const type = (typeMatch?.[1]?.trim() ?? "technical-change") as ProposalType;

  // Validate type
  const validType = PROPOSAL_TYPES.includes(type) ? type : "technical-change";

  // Build description from the full suggestion (it's already structured)
  let description = raw.trim();

  // If title was found, the description is the full text (it has problem/solution/why now)
  if (!title) return undefined;

  return {
    title,
    type: validType,
    description,
  };
};

// ── Prompt Building ──────────────────────────────────────────

/** Build the round table prompt for an agent. */
const buildRoundTablePrompt = (agent: DAOAgent): string => {
  const hostCtx = detectHostContext();
  return `# Round Table — What Should We Work On Next?

You are in a round table with ${agent.role ? `your role being "${agent.role}"` : "other specialized agents"}.
Each agent is asked to suggest ONE concrete proposal idea.

## Context
The DAO is running inside project \`${hostCtx.repoSlug}\` (${hostCtx.language}${hostCtx.framework ? `, ${hostCtx.framework}` : ""} — branch \`${hostCtx.branch}\`).
It currently has ${getState().agents.length} agents, ${getState().proposals.length} proposals, and uses GitHub Issues for persistence.${hostCtx.isSelfRepo ? "\n⚠️ The DAO is running inside its own repository (pi-swarm-dao). Proposals should improve the DAO extension itself." : `\nProposals should target the host project (${hostCtx.repoSlug}), not the DAO extension.`}

Recent activity:
${getState().proposals.slice(-3).map(p => `- #${p.id}: ${p.title} (${p.status})`).join("\n") || "- No proposals yet"}

## Your Task
Suggest ONE proposal idea that would create the most value from YOUR perspective.
Be specific: include a title, a brief description of the problem and solution, and why it matters now.

## Output Format (STRICT — follow exactly)

### Title
[One-line title for the proposal]

### Type
[product-feature | security-change | technical-change | release-change | governance-change]

### Problem
[1-2 sentences describing the specific problem]

### Solution
[1-2 sentences describing the proposed approach]

### Why Now
[1 sentence on urgency or strategic value]

## Constraints
- ONE idea only — your best one
- Be specific, not vague
- Think from YOUR perspective — what does your domain need most?
- Max 150 words`;
};

// ── Agent Execution ──────────────────────────────────────────

/** Run a single agent for round table suggestions. */
const runRoundTableAgent = async (
  agent: DAOAgent,
  signal?: AbortSignal
): Promise<RoundTableSuggestion> => {
  const startTime = Date.now();
  const tmpDir = mkdtempSync(join(tmpdir(), "dao-rt-"));
  const promptFile = join(tmpDir, "round-table-prompt.md");

  try {
    // Use a lightweight system prompt — just identity, not full deliberation prompt
    const lightPrompt = `# ${agent.name}\nRole: ${agent.role}\nMission: ${agent.mission ?? agent.description}\n\nYou are participating in a round table to propose ideas. Be concise and specific.`;
    writeFileSync(promptFile, lightPrompt, "utf-8");

    const taskPrompt = buildRoundTablePrompt(agent);
    const model = agent.model ?? getState().config.defaultModel;

    const args = [
      "--mode", "json",
      "-p",
      "--no-session",
      "--model", model,
      "--no-tools",
      "--append-system-prompt", promptFile,
      `Task: ${taskPrompt}`,
    ];

    return await new Promise<RoundTableSuggestion>((resolve) => {
      const proc = spawn("pi", args, {
        cwd: process.cwd(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout.on("data", (data: Buffer) => stdoutChunks.push(data));
      proc.stderr.on("data", (data: Buffer) => stderrChunks.push(data));

      const timeoutMs = 90_000;
      let timedOut = false;
      let killing = false;
      let killTimerId: ReturnType<typeof setTimeout> | undefined;

      const timeoutId = setTimeout(() => {
        if (killing) return;
        killing = true;
        timedOut = true;
        proc.kill("SIGTERM");
        killTimerId = setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
      }, timeoutMs);

      const onAbort = () => {
        if (killing) return;
        killing = true;
        clearTimeout(timeoutId);
        proc.kill("SIGTERM");
        killTimerId = setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
      };

      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      proc.on("close", () => {
        clearTimeout(timeoutId);
        if (killTimerId) clearTimeout(killTimerId);
        signal?.removeEventListener("abort", onAbort);

        const stdout = Buffer.concat(stdoutChunks).toString();
        const content = extractAssistantMessage(stdout);

        if (timedOut) {
          resolve({
            agentId: agent.id,
            agentName: agent.name,
            role: agent.role,
            weight: agent.weight,
            suggestion: content ? content.slice(0, MAX_SUGGESTION_CHARS) : "",
            error: "Timed out",
            durationMs: Date.now() - startTime,
          });
          return;
        }

        const raw = content ? content.slice(0, MAX_SUGGESTION_CHARS) : "(no suggestion)";
        const parsed = parseSuggestion(raw);

        resolve({
          agentId: agent.id,
          agentName: agent.name,
          role: agent.role,
          weight: agent.weight,
          suggestion: raw,
          parsed,
          durationMs: Date.now() - startTime,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timeoutId);
        if (killTimerId) clearTimeout(killTimerId);
        signal?.removeEventListener("abort", onAbort);
        resolve({
          agentId: agent.id,
          agentName: agent.name,
          role: agent.role,
          weight: agent.weight,
          suggestion: "",
          error: err.message,
          durationMs: Date.now() - startTime,
        });
      });
    });
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
};

// ── Public API ───────────────────────────────────────────────

/**
 * Run a round table — every agent suggests one proposal idea.
 * Returns all suggestions for the human to review.
 */
export const runRoundTable = async (
  agents: DAOAgent[],
  signal?: AbortSignal,
  onProgress?: (completed: number, total: number, agentName: string) => void
): Promise<RoundTableSuggestion[]> => {
  const maxConcurrent = Math.min(getState().config.maxConcurrent, agents.length);
  let completed = 0;
  const total = agents.length;

  const results: RoundTableSuggestion[] = new Array(agents.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < agents.length) {
      const index = nextIndex++;
      const agent = agents[index];
      const result = await runRoundTableAgent(agent, signal);
      results[index] = result;
      completed++;
      onProgress?.(completed, total, agent.name);
    }
  };

  const workers = Array.from(
    { length: maxConcurrent },
    () => worker()
  );
  await Promise.all(workers);

  return results;
};

/**
 * Format round table results for display.
 * Shows suggestions and indicates which became proposals.
 */
export const formatRoundTable = (
  suggestions: RoundTableSuggestion[],
  proposalIds: Map<string, number>
): string => {
  let output = `# 🗣️ Round Table — ${suggestions.filter(s => s.parsed).length}/${suggestions.length} idées transformées en propositions\n\n`;
  output += `> Chaque agent a proposé une idée → automatiquement convertie en proposition DAO\n\n`;

  for (const s of suggestions) {
    const proposalId = proposalIds.get(s.agentId);
    const statusIcon = s.error ? "⚠️" : proposalId ? "📋" : "💡";
    const proposalNote = proposalId ? ` → **Proposal #${proposalId}**` : "";
    const errorNote = s.error ? ` · **Error:** ${s.error}` : "";

    output += `## ${statusIcon} ${s.agentName} (weight: ${s.weight})${proposalNote}\n`;
    output += `*${s.role}* · ${(s.durationMs / 1000).toFixed(1)}s${errorNote}\n\n`;

    if (s.parsed) {
      output += `**${s.parsed.title}** · ${s.parsed.type}\n\n`;
      // Show just the key sections, not the full raw output
      const problemMatch = s.suggestion.match(/###\s*Problem\s*\n([\s\S]*?)(?=\n###|$)/i);
      const solutionMatch = s.suggestion.match(/###\s*Solution\s*\n([\s\S]*?)(?=\n###|$)/i);
      const whyMatch = s.suggestion.match(/###\s*Why Now\s*\n([\s\S]*?)(?=\n###|$)/i);

      if (problemMatch) output += `**Problem:** ${problemMatch[1].trim()}\n\n`;
      if (solutionMatch) output += `**Solution:** ${solutionMatch[1].trim()}\n\n`;
      if (whyMatch) output += `**Why Now:** ${whyMatch[1].trim()}\n\n`;
    } else if (s.suggestion) {
      output += `${s.suggestion.slice(0, 300)}\n\n`;
    }

    output += `---\n\n`;
  }

  const createdIds = Array.from(proposalIds.values());
  if (createdIds.length > 0) {
    output += `## 🎯 Prêt pour la délibération\n\n`;
    output += `Les propositions sont créées et en attente. Lancez la délibération :\n\n`;
    for (const id of createdIds) {
      output += `- \`dao_deliberate(proposalId: ${id})\` — Proposal #${id}\n`;
    }
  }

  return output;
};
