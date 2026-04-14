// ============================================================
// pi-swarm-dao — Proposal Lifecycle State Machine (V2)
// ============================================================
// Pipeline: intake → qualification → analysis → critique →
//           scoring → council → vote → spec → execution-gate → postmortem
//
// Status mapping (backward compat):
//   intake/qualification  = "open"
//   analysis/critique/scoring/council/vote = "deliberating"
//   spec/execution-gate   = "controlled"
//   postmortem            = "executed"
// ============================================================

import type { ProposalStatus, PipelineStage } from "../types.js";

/**
 * Map pipeline stages to legacy proposal statuses.
 */
export const STAGE_TO_STATUS: Record<PipelineStage, ProposalStatus> = {
  intake: "open",
  qualification: "open",
  analysis: "deliberating",
  critique: "deliberating",
  scoring: "deliberating",
  council: "deliberating",
  vote: "deliberating",
  spec: "controlled",
  "execution-gate": "controlled",
  postmortem: "executed",
};

/**
 * Valid status transitions (legacy compatibility).
 */
export const TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  open: ["deliberating"],
  deliberating: ["approved", "rejected", "controlled"],
  approved: ["controlled", "rejected"],
  controlled: ["executed", "failed"],
  rejected: [],
  executed: [],
  failed: ["controlled"],
};

/**
 * Valid pipeline stage transitions.
 */
export const PIPELINE_TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  intake: ["qualification"],
  qualification: ["analysis"],   // rejected handled by status change
  analysis: ["critique"],
  critique: ["scoring"],
  scoring: ["council"],
  council: ["vote"],             // council can reject via status
  vote: ["spec"],                // vote can reject via status
  spec: ["execution-gate"],
  "execution-gate": ["postmortem"], // gate can block via status
  postmortem: [],                  // terminal
};

/**
 * Check whether a status transition is valid.
 */
export const canTransition = (
  from: ProposalStatus,
  to: ProposalStatus
): boolean => TRANSITIONS[from].includes(to);

/**
 * Assert that a status transition is valid.
 */
export const assertTransition = (
  from: ProposalStatus,
  to: ProposalStatus
): void => {
  if (!canTransition(from, to)) {
    const valid = TRANSITIONS[from].join(", ") || "none (terminal state)";
    throw new Error(
      `Invalid transition: ${from} → ${to}. Valid transitions from "${from}": ${valid}`
    );
  }
};

/**
 * Check whether a pipeline stage transition is valid.
 */
export const canAdvancePipeline = (
  from: PipelineStage,
  to: PipelineStage
): boolean => PIPELINE_TRANSITIONS[from].includes(to);

/**
 * Assert that a pipeline stage transition is valid.
 */
export const assertPipelineTransition = (
  from: PipelineStage,
  to: PipelineStage
): void => {
  if (!canAdvancePipeline(from, to)) {
    const valid = PIPELINE_TRANSITIONS[from].join(", ") || "none (terminal)";
    throw new Error(
      `Invalid pipeline transition: ${from} → ${to}. Valid next stages: ${valid}`
    );
  }
};

/**
 * Get all valid next stages from a given pipeline stage.
 */
export const nextStages = (from: PipelineStage): PipelineStage[] => [
  ...PIPELINE_TRANSITIONS[from],
];

/**
 * Check whether a stage is terminal.
 */
export const isTerminalStage = (stage: PipelineStage): boolean =>
  PIPELINE_TRANSITIONS[stage].length === 0;

/**
 * Check whether a status is terminal.
 */
export const isTerminal = (status: ProposalStatus): boolean =>
  TRANSITIONS[status].length === 0;

/**
 * Human-readable labels for each proposal status.
 */
const STATUS_LABELS: Record<ProposalStatus, string> = {
  open: "📝 Open",
  deliberating: "🗳️ Deliberating",
  approved: "✅ Approved",
  controlled: "🔒 Controlled",
  rejected: "❌ Rejected",
  executed: "🚀 Executed",
  failed: "⚠️ Failed",
};

/**
 * Get a human-readable label for a proposal status.
 */
export const statusLabel = (status: ProposalStatus): string =>
  STATUS_LABELS[status];
