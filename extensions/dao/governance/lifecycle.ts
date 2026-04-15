// ============================================================
// pi-swarm-dao — Proposal Lifecycle State Machine (V3)
// ============================================================
// Facade over the formal state machine in core/ and shell/.
// Re-exports the canonical transition table + adds convenience
// helpers for backward compatibility.
// ============================================================

import type { ProposalStatus, PipelineStage } from "../types.js";
import type { GuardContext, ProposalEvent } from "../core/states.js";
import { TRANSITION_TABLE, STATE_LABELS as CORE_LABELS, TERMINAL_STATES } from "../core/states.js";
import { evaluateTransition, getAllowedTransitions, getAllTargets, isTerminal as coreIsTerminal } from "../core/evaluate.js";

// ── Re-export core for direct access ────────────────────────

export { TRANSITION_TABLE, TERMINAL_STATES } from "../core/states.js";
export { evaluateTransition, getAllowedTransitions, getAllTargets } from "../core/evaluate.js";
export type { GuardContext, ProposalEvent } from "../core/states.js";
export type { TransitionResult, TransitionOK, TransitionRejected } from "../core/evaluate.js";
export { onTransition, removeHook } from "../shell/hooks.js";
export type { TransitionHook } from "../shell/hooks.js";
export { transitionProposal, buildContext } from "../shell/lifecycle-manager.js";
export type { LifecycleResult } from "../shell/lifecycle-manager.js";

// ── Pipeline Stage Mapping (legacy compatibility) ────────────

/**
 * Map pipeline stages to proposal statuses.
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
 * Valid pipeline stage transitions.
 */
export const PIPELINE_TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  intake: ["qualification"],
  qualification: ["analysis"],
  analysis: ["critique"],
  critique: ["scoring"],
  scoring: ["council"],
  council: ["vote"],
  vote: ["spec"],
  spec: ["execution-gate"],
  "execution-gate": ["postmortem"],
  postmortem: [],
};

// ── Legacy API (backward compatibility) ──────────────────────

/**
 * Derive the legacy TRANSITIONS map from the core transition table.
 * This replaces the hardcoded TRANSITIONS constant.
 */
const deriveLegacyTransitions = (): Record<ProposalStatus, ProposalStatus[]> => {
  const result: Record<string, ProposalStatus[]> = {
    open: [],
    deliberating: [],
    approved: [],
    controlled: [],
    rejected: [],
    executed: [],
    failed: [],
  };

  for (const [key, transition] of TRANSITION_TABLE) {
    const from = key.split(":")[0] as ProposalStatus;
    if (from !== transition.target) { // skip self-transitions (archive)
      if (!result[from].includes(transition.target)) {
        result[from].push(transition.target);
      }
    }
  }

  return result as Record<ProposalStatus, ProposalStatus[]>;
};

/**
 * Valid status transitions — derived from the core transition table.
 * Kept for backward compatibility with existing callers.
 */
export const TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = deriveLegacyTransitions();

// ── Legacy helpers (backward compatible signatures) ──────────

/**
 * Check whether a status transition is valid.
 * Uses the core transition table.
 */
export const canTransition = (
  from: ProposalStatus,
  to: ProposalStatus
): boolean => TRANSITIONS[from].includes(to);

/**
 * Assert that a status transition is valid (throws).
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
 * Assert that a pipeline stage transition is valid (throws).
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
 * Get all valid next stages from a pipeline stage.
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
  coreIsTerminal(status);

/**
 * Get a human-readable label for a proposal status.
 */
export const statusLabel = (status: ProposalStatus): string =>
  CORE_LABELS[status] ?? status;
