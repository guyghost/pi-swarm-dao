// ============================================================
// pi-swarm-dao — Proposal Lifecycle State Machine
// ============================================================
// Pure functions enforcing valid proposal status transitions.
// Terminal states: rejected, executed, failed (no further moves).
//
// open → deliberating → approved → controlled → executed
//                    ↘ rejected  ↘ rejected   ↘ failed
// ============================================================

import type { ProposalStatus } from "../types.js";

/**
 * Valid state transitions map.
 * Keys are current states; values are the set of allowed next states.
 * Empty arrays denote terminal states (no further transitions possible).
 */
export const TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  open: ["deliberating"],
  deliberating: ["approved", "rejected"],
  approved: ["controlled", "rejected"],
  controlled: ["executed", "failed"],
  rejected: [],
  executed: [],
  failed: [],
};

/**
 * Check whether a transition from one status to another is valid.
 */
export const canTransition = (
  from: ProposalStatus,
  to: ProposalStatus
): boolean => TRANSITIONS[from].includes(to);

/**
 * Assert that a transition is valid. Throws a descriptive error if not.
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
 * Get all valid next states from a given status.
 * Returns an empty array for terminal states.
 */
export const nextStates = (from: ProposalStatus): ProposalStatus[] => [
  ...TRANSITIONS[from],
];

/**
 * Check whether a status is terminal (no further transitions possible).
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
