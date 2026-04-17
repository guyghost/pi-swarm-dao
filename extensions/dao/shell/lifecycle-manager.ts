// ============================================================
// pi-swarm-dao — Shell: Proposal Lifecycle Manager
// ============================================================
// The imperative shell that wraps the XState v5 proposal machine
// with side effects (persistence, hooks, audit).
//
// Strangler pattern: XState machine validates transitions
// internally, public API signature unchanged.
// ============================================================

import { createActor } from "xstate";
import type { ProposalStatus } from "../types.js";
import type { ProposalEvent, GuardContext } from "../core/states.js";
import { STATE_LABELS, TERMINAL_STATES } from "../core/states.js";
import { proposalMachine } from "../core/machine.js";
import type { MachineEvents } from "../core/machine.js";
import { fireHooks, CriticalHookError } from "./hooks.js";
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

// ── Event Mapping ────────────────────────────────────────────

/**
 * Map a ProposalEvent + GuardContext to an XState MachineEvent.
 * Guard data (quorumMet, gatesPassed, approvalScore) flows from
 * the GuardContext into the event payload for XState guards.
 */
const toMachineEvent = (
  event: ProposalEvent,
  ctx: GuardContext,
): MachineEvents => {
  switch (event) {
    case "deliberate":
      return { type: "deliberate" };
    case "approve":
      return {
        type: "approve",
        quorumMet: ctx.quorumMet ?? false,
        approvalScore: ctx.approvalScore,
      };
    case "reject":
      return {
        type: "reject",
        quorumMet: ctx.quorumMet,
        approvalScore: ctx.approvalScore,
        hasVotes: ctx.hasVotes,
      };
    case "pass_gates":
      return {
        type: "pass_gates",
        gatesPassed: ctx.gatesPassed,
        quorumMet: ctx.quorumMet,
      };
    case "fail_gates":
      return { type: "fail_gates" };
    case "execute":
      return { type: "execute", gatesPassed: ctx.gatesPassed ?? false };
    case "fail_execution":
      return { type: "fail_execution" };
    case "retry":
      return { type: "retry" };
    case "abandon":
      return { type: "abandon" };
    default:
      // 'submit', 'archive' — no XState equivalent, map to harmless event
      return { type: "deliberate" };
  }
};

// ── Core Lifecycle Operations ────────────────────────────────

/**
 * Attempt a state transition on a proposal.
 *
 * This is THE single entry point for all state transitions.
 * It:
 *   1. Evaluates the transition against the XState machine
 *   2. Updates the proposal status in persistence (side effect)
 *   3. Fires registered hooks (side effect)
 *   4. Records an audit entry (side effect)
 *
 * If a critical hook fails, the status change is rolled back and
 * the result reports success=false with the hook error.
 */
export const transitionProposal = async (
  proposalId: number,
  event: ProposalEvent,
  ctx: GuardContext,
): Promise<LifecycleResult> => {
  const state = getState();
  const proposal = state.proposals.find((p) => p.id === proposalId);

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

  // Special case: archive is idempotent on terminal states
  if (event === "archive") {
    if (TERMINAL_STATES.has(from)) {
      recordAudit(
        proposalId,
        "governance",
        "transition_applied",
        "system",
        `${STATE_LABELS[from]} → archive (idempotent)`,
      );

      return {
        success: true,
        from,
        to: from,
        event,
        proposalId,
      };
    }

    return {
      success: false,
      from,
      to: from,
      event,
      proposalId,
      error: `Cannot archive non-terminal state: ${from}`,
    };
  }

  // ── XState machine validation (strangler pattern) ──────────

  const machineEvent = toMachineEvent(event, ctx);

  // Create a machine snapshot at the proposal's current state
  const machineSnapshot = proposalMachine.resolveState({
    value: from,
    context: {
      proposalId,
      quorumMet: ctx.quorumMet ?? false,
      gatesPassed: ctx.gatesPassed ?? false,
      approvalScore: ctx.approvalScore ?? 0,
    },
  });

  // Restore actor from the persisted snapshot
  const persistedSnapshot =
    proposalMachine.getPersistedSnapshot(machineSnapshot);
  const actor = createActor(proposalMachine, {
    snapshot: persistedSnapshot,
    input: { proposalId },
  });
  actor.start();

  // Send the mapped event
  actor.send(machineEvent);

  // Check the resulting snapshot
  const resultSnapshot = actor.getSnapshot();
  const to = resultSnapshot.value as ProposalStatus;
  const transitioned = to !== from;

  actor.stop();

  if (!transitioned) {
    // Transition rejected — guard failed or event not valid from this state
    recordAudit(
      proposalId,
      "control",
      "transition_rejected",
      "system",
      `Transition rejected: ${STATE_LABELS[from]} → ${event}. Reason: event not accepted from current state or guard condition not met`,
    );

    return {
      success: false,
      from,
      to: from,
      event,
      proposalId,
      error: `Transition rejected: event "${event}" not accepted from state "${from}"`,
    };
  }

  // Apply transition (side effect: mutate state)
  proposal.status = to;

  // Set resolvedAt on terminal states
  if (["approved", "rejected", "executed", "failed"].includes(to)) {
    proposal.resolvedAt = new Date().toISOString();
  }

  setState(state);

  // Fire hooks (side effect) — may throw CriticalHookError
  try {
    await fireHooks(from, to, event, proposalId, ctx);
  } catch (err) {
    if (err instanceof CriticalHookError) {
      // ── Rollback: restore original status ───────────────────
      proposal.status = from;

      // Clear resolvedAt if we had set it
      if (["approved", "rejected", "executed", "failed"].includes(to)) {
        proposal.resolvedAt = undefined;
      }

      setState(state);

      recordAudit(
        proposalId,
        "control",
        "transition_rolled_back",
        "system",
        `Rolled back ${STATE_LABELS[from]} → ${STATE_LABELS[to]} via ${event}: critical hook "${err.hookName}" failed`,
      );

      return {
        success: false,
        from,
        to: from,
        event,
        proposalId,
        error: `Critical hook failed: "${err.hookName}" — ${String(err.cause)}`,
      };
    }
    // Unexpected error — still rollback for safety
    proposal.status = from;
    if (["approved", "rejected", "executed", "failed"].includes(to)) {
      proposal.resolvedAt = undefined;
    }
    setState(state);

    throw err;
  }

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
  overrides?: Partial<GuardContext>,
): GuardContext => {
  const state = getState();
  const proposal = state.proposals.find((p) => p.id === proposalId);

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
