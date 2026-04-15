// ============================================================
// pi-swarm-dao — Shell: Proposal Lifecycle Manager
// ============================================================
// The imperative shell that wraps the pure core (transition
// evaluation) with side effects (persistence, hooks, audit).
// ============================================================

import type { ProposalStatus } from "../types.js";
import type { ProposalEvent, GuardContext } from "../core/states.js";
import { evaluateTransition } from "../core/evaluate.js";
import { STATE_LABELS } from "../core/states.js";
import { fireHooks } from "./hooks.js";
import { getState, setState } from "../persistence.js";
import { recordAudit } from "../control/audit.js";

// ── Types ────────────────────────────────────────────────────

/** Result of a lifecycle transition attempt. */
export interface LifecycleResult {
  success: boolean;
  from: ProposalStatus;
  to: ProposalStatus;
  event: ProposalEvent;
  proposalId: number;
  error?: string;
  guardDescription?: string;
}

// ── Core Lifecycle Operations ────────────────────────────────

/**
 * Attempt a state transition on a proposal.
 *
 * This is THE single entry point for all state transitions.
 * It:
 *   1. Evaluates the transition against the core FSM (pure)
 *   2. Updates the proposal status in persistence (side effect)
 *   3. Fires registered hooks (side effect)
 *   4. Records an audit entry (side effect)
 */
export const transitionProposal = (
  proposalId: number,
  event: ProposalEvent,
  ctx: GuardContext
): LifecycleResult => {
  const state = getState();
  const proposal = state.proposals.find(p => p.id === proposalId);

  if (!proposal) {
    return {
      success: false,
      from: ctx.status,
      to: ctx.status,
      event,
      proposalId,
      error: `Proposal #${proposalId} not found`,
    };
  }

  const from = proposal.status;

  // Evaluate against core FSM (pure)
  const result = evaluateTransition(from, event, ctx);

  if (!result.ok) {
    // Record failed transition attempt
    recordAudit(
      proposalId,
      "control",
      "transition_rejected",
      "system",
      `Transition rejected: ${STATE_LABELS[from]} → ${event}. Reason: ${result.reason}${result.guardDescription ? ` (${result.guardDescription})` : ""}`,
    );

    return {
      success: false,
      from,
      to: from,
      event,
      proposalId,
      error: `Transition rejected: ${result.reason}`,
      guardDescription: result.guardDescription,
    };
  }

  const to = result.to;

  // Apply transition (side effect: mutate state)
  proposal.status = to;

  // Set resolvedAt on terminal states
  if (["approved", "rejected", "executed", "failed"].includes(to)) {
    proposal.resolvedAt = new Date().toISOString();
  }

  setState(state);

  // Fire hooks (side effect)
  fireHooks(from, to, event, proposalId, ctx);

  // Record audit (side effect)
  recordAudit(
    proposalId,
    "governance",
    "transition_applied",
    "system",
    `${STATE_LABELS[from]} → ${STATE_LABELS[to]} via ${event}`,
  );

  return {
    success: true,
    from,
    to,
    event,
    proposalId,
  };
};

/**
 * Convenience: build a GuardContext from a proposal's current state.
 */
export const buildContext = (
  proposalId: number,
  overrides?: Partial<GuardContext>
): GuardContext => {
  const state = getState();
  const proposal = state.proposals.find(p => p.id === proposalId);

  return {
    status: proposal?.status ?? "open",
    quorumMet: undefined,
    gatesPassed: undefined,
    approvalScore: undefined,
    hasVotes: (proposal?.votes.length ?? 0) > 0,
    hasExecutionResult: !!proposal?.executionResult,
    ...overrides,
  };
};
