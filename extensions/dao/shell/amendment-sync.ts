// ============================================================
// pi-swarm-dao — Shell: Amendment State Sync Hooks
// ============================================================
// Best-effort hooks that sync proposal.amendmentState when
// the FSM transitions to a terminal state.
//
// - On transition to `executed`:  amendmentState → 'executed'
// - On transition to `rejected`:  amendmentState → 'rolled-back'
//
// Only active amendments are updated (pending-vote, approved-pending-human,
// approved). Already-resolved amendments are left untouched.
// ============================================================

import { onTransition } from "./hooks.js";
import { getState, setState } from "../persistence.js";
import type { AmendmentState } from "../types.js";

// ── Active Amendment States ──────────────────────────────────

/** Amendment states that are considered "active" (not yet resolved). */
const ACTIVE_AMENDMENT_STATES: ReadonlySet<AmendmentState> = new Set([
  "pending-vote",
  "approved-pending-human",
  "approved",
]);

// ── Hook Registration ────────────────────────────────────────

/**
 * Sync amendmentState to 'executed' when a proposal reaches the executed state.
 * Only updates if the proposal has an active amendment.
 */
const syncAmendmentOnExecuted = (
  _from: string,
  _to: string,
  _event: string,
  proposalId: number,
): void => {
  const state = getState();
  const proposal = state.proposals.find(p => p.id === proposalId);

  if (
    proposal?.amendmentPayload &&
    proposal.amendmentState &&
    ACTIVE_AMENDMENT_STATES.has(proposal.amendmentState)
  ) {
    proposal.amendmentState = "executed";
    setState(state);
  }
};

/**
 * Sync amendmentState to 'rolled-back' when a proposal reaches the rejected state.
 * Only updates if the proposal has an active amendment.
 */
const syncAmendmentOnRejected = (
  _from: string,
  _to: string,
  _event: string,
  proposalId: number,
): void => {
  const state = getState();
  const proposal = state.proposals.find(p => p.id === proposalId);

  if (
    proposal?.amendmentPayload &&
    proposal.amendmentState &&
    ACTIVE_AMENDMENT_STATES.has(proposal.amendmentState)
  ) {
    proposal.amendmentState = "rolled-back";
    setState(state);
  }
};

/**
 * Register best-effort hooks that sync amendmentState when proposal
// status transitions to a terminal state.
 *
 * Call this once during DAO initialization.
 */
export const registerAmendmentSyncHooks = (): void => {
  onTransition(
    "*",
    "executed",
    syncAmendmentOnExecuted,
    "best-effort",
    "amendment-sync-executed",
  );

  onTransition(
    "*",
    "rejected",
    syncAmendmentOnRejected,
    "best-effort",
    "amendment-sync-rejected",
  );
};
