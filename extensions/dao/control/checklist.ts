import type { Proposal, AgentOutput, ChecklistItem } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────

const findOutput = (proposal: Proposal, agentId: string): AgentOutput | undefined =>
  proposal.agentOutputs.find((o) => o.agentId === agentId);

const contentMatches = (output: AgentOutput | undefined, patterns: RegExp[]): boolean => {
  if (!output) return false;
  return patterns.some((p) => p.test(output.content));
};

// ── Checklist Definitions ────────────────────────────────────

interface ChecklistDef {
  id: string;
  category: ChecklistItem["category"];
  label: string;
  autoCheck: (proposal: Proposal) => { checked: boolean; details?: string };
}

const CHECKLIST_DEFS: ChecklistDef[] = [
  {
    id: "security-review",
    category: "security",
    label: "Security implications reviewed by Critic agent",
    autoCheck: (proposal) => {
      const output = findOutput(proposal, "critic");
      return output
        ? { checked: true, details: "Critic agent output present" }
        : { checked: false };
    },
  },
  {
    id: "data-handling",
    category: "security",
    label: "Data handling and privacy assessed",
    autoCheck: (proposal) => {
      const output = findOutput(proposal, "critic");
      const checked = contentMatches(output, [/privacy/i, /\bdata\b/i, /security/i]);
      return {
        checked,
        details: checked ? "Critic output addresses data/privacy/security" : undefined,
      };
    },
  },
  {
    id: "compliance-check",
    category: "compliance",
    label: "Regulatory compliance verified",
    autoCheck: (proposal) => {
      const output = findOutput(proposal, "critic");
      const checked = contentMatches(output, [/compliance/i, /regulatory/i]);
      return {
        checked,
        details: checked ? "Critic output addresses compliance/regulatory" : undefined,
      };
    },
  },
  {
    id: "specs-written",
    category: "quality",
    label: "Specifications and acceptance criteria defined",
    autoCheck: (proposal) => {
      const output = findOutput(proposal, "spec-writer");
      const checked = output ? /US-\d/i.test(output.content) : false;
      return {
        checked,
        details: checked ? "User stories (US-N) found in Spec Writer output" : undefined,
      };
    },
  },
  {
    id: "architecture-reviewed",
    category: "quality",
    label: "Technical architecture reviewed",
    autoCheck: (proposal) => {
      const output = findOutput(proposal, "architect");
      const vote = proposal.votes.find((v) => v.agentId === "architect");
      const checked = !!output && !!vote && vote.position === "for";
      return {
        checked,
        details: checked ? "Architect output exists and voted for" : undefined,
      };
    },
  },
  {
    id: "rollback-plan",
    category: "operational",
    label: "Rollback plan defined",
    autoCheck: (proposal) => {
      const output = findOutput(proposal, "delivery");
      const checked = contentMatches(output, [/rollback/i]);
      return {
        checked,
        details: checked ? "Rollback plan mentioned in Delivery output" : undefined,
      };
    },
  },
  {
    id: "monitoring-plan",
    category: "operational",
    label: "Monitoring and alerting considered",
    autoCheck: () => ({
      checked: false,
      details: "Manual check required",
    }),
  },
];

// ── Public API ───────────────────────────────────────────────

/**
 * Generate a default checklist for a proposal, auto-checking what can be verified.
 */
export const generateChecklist = (proposal: Proposal): ChecklistItem[] =>
  CHECKLIST_DEFS.map((def) => {
    const result = def.autoCheck(proposal);
    return {
      id: def.id,
      category: def.category,
      label: def.label,
      checked: result.checked,
      autoChecked: result.checked,
      ...(result.details && { details: result.details }),
    };
  });

const CATEGORY_EMOJI: Record<ChecklistItem["category"], string> = {
  security: "🔒",
  compliance: "📋",
  quality: "✨",
  operational: "⚙️",
};

/**
 * Format checklist items as markdown.
 */
export const formatChecklist = (items: ChecklistItem[]): string => {
  if (items.length === 0) return "No checklist items.";

  const lines = ["## Control Checklist", ""];

  // Group by category
  const groups = new Map<ChecklistItem["category"], ChecklistItem[]>();
  for (const item of items) {
    const group = groups.get(item.category) ?? [];
    group.push(item);
    groups.set(item.category, group);
  }

  for (const [category, group] of groups) {
    lines.push(`### ${CATEGORY_EMOJI[category]} ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    for (const item of group) {
      const box = item.checked ? "✅" : "⬜";
      const auto = item.autoChecked ? " _(auto)_" : " _(manual)_";
      lines.push(`- ${box} **${item.label}**${auto}`);
      if (item.details) lines.push(`  > ${item.details}`);
    }
    lines.push("");
  }

  return lines.join("\n");
};

/**
 * Calculate checklist completion stats.
 */
export const checklistStats = (
  items: ChecklistItem[],
): { total: number; checked: number; percent: number } => {
  const total = items.length;
  const checked = items.filter((i) => i.checked).length;
  const percent = total > 0 ? Math.round((checked / total) * 100) : 0;
  return { total, checked, percent };
};
