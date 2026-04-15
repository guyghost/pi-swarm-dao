// ============================================================
// pi-swarm-dao — Core: Transition Evaluation (Pure Functions)
// ============================================================

import type { ProposalStatus } from "../types.js";
import type { GuardContext, ProposalEvent, RejectionReason } from "./states.js";
import { getTransition, getEventsForState, getTargetsForState, TERMINAL_STATES, STATE_LABELS } from "./states.js";

// ── Types ────────────────────────────────────────────────────

export interface TransitionOK {
  ok: true;
  from: ProposalStatus;
  to: ProposalStatus;
  event: ProposalEvent;
}

export interface TransitionRejected {
  ok: false;
  from: ProposalStatus;
  to: ProposalStatus;
  event: ProposalEvent;
  reason: RejectionReason;
  guardDescription?: string;
}

export type TransitionResult = TransitionOK | TransitionRejected;

// ── Core Functions ───────────────────────────────────────────

/**
 * Evaluate whether a transition is allowed.
 * Pure function — examines the transition table and guard conditions.
 */
export const evaluateTransition = (
  from: ProposalStatus,
  event: ProposalEvent,
  ctx: GuardContext
): TransitionResult => {
  const transition = getTransition(from, event);

  if (!transition) {
    const validEvents = getEventsForState(from);
    return {
      ok: false,
      from,
      to: from,
      event,
      reason: validEvents.length === 0 ? "ALREADY_TERMINAL" : "INVALID_STATE",
      guardDescription: validEvents.length === 0
        ? `"${STATE_LABELS[from]}" is a terminal state`
        : `Event "${event}" not valid from "${STATE_LABELS[from]}". Valid events: ${validEvents.join(", ")}`,
    };
  }

  // Check guard if present
  if (transition.guard && !transition.guard(ctx)) {
    return {
      ok: false,
      from,
      to: transition.target,
      event,
      reason: mapGuardToReason(transition.guardDescription),
      guardDescription: transition.guardDescription,
    };
  }

  return {
    ok: true,
    from,
    to: transition.target,
    event,
  };
};

/**
 * Get all allowed transitions from a given state with the current context.
 */
export const getAllowedTransitions = (
  from: ProposalStatus,
  ctx: GuardContext
): ProposalEvent[] => {
  const events = getEventsForState(from);
  return events.filter(event => {
    const transition = getTransition(from, event);
    if (!transition) return false;
    if (transition.guard && !transition.guard(ctx)) return false;
    return true;
  });
};

/**
 * Get all possible target states from a given state (regardless of guards).
 */
export const getAllTargets = (from: ProposalStatus): ProposalStatus[] =>
  getTargetsForState(from);

/**
 * Check if a state is terminal.
 */
export const isTerminal = (status: ProposalStatus): boolean =>
  TERMINAL_STATES.has(status);

/**
 * Map guard description to rejection reason.
 */
const mapGuardToReason = (desc?: string): RejectionReason => {
  if (!desc) return "ALREADY_TERMINAL";
  const lower = desc.toLowerCase();
  if (lower.includes("quorum")) return "QUORUM_NOT_MET";
  if (lower.includes("gate")) return "GATES_NOT_PASSED";
  if (lower.includes("votes") || lower.includes("deliberat")) return "NO_VOTES";
  return "ALREADY_TERMINAL";
};

/**
 * Validate that a transition is legal (throws on failure).
 */
export const assertTransition = (
  from: ProposalStatus,
  event: ProposalEvent,
  ctx: GuardContext
): ProposalStatus => {
  const result = evaluateTransition(from, event, ctx);
  if (!result.ok) {
    throw new Error(
      `Invalid transition: ${STATE_LABELS[from]} → ${event}. ` +
      `${result.guardDescription ?? result.reason}. ` +
      `(reason: ${result.reason})`
    );
  }
  return result.to;
};
