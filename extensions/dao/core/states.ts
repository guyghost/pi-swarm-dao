// ============================================================
// pi-swarm-dao — Core State Machine: States, Events, Table
// ============================================================
// Pure data — no side effects, no I/O.
// The transition table is DATA, not code.
// ============================================================

import type { ProposalStatus } from "../types.js";

// ── Events that trigger transitions ──────────────────────────

export type ProposalEvent =
  | "submit"          // user creates a proposal
  | "deliberate"      // swarm starts deliberation
  | "approve"         // deliberation approves
  | "reject"          // deliberation rejects
  | "pass_gates"      // control gates all pass
  | "fail_gates"      // control gates fail
  | "execute"         // delivery executes
  | "fail_execution"  // execution fails
  | "retry"           // retry from failed state
  | "archive";        // archive a terminal proposal

// ── Guard function (pure predicate) ──────────────────────────

/** Context available to guards for decision-making. */
export interface GuardContext {
  status: ProposalStatus;
  quorumMet?: boolean;
  gatesPassed?: boolean;
  approvalScore?: number;
  hasVotes?: boolean;
  hasExecutionResult?: boolean;
}

/** A pure guard predicate. */
export type Guard = (ctx: GuardContext) => boolean;

/** A typed rejection reason. */
export type RejectionReason =
  | "QUORUM_NOT_MET"
  | "GATES_NOT_PASSED"
  | "NO_VOTES"
  | "NOT_DELIBERATED"
  | "ALREADY_TERMINAL"
  | "INVALID_STATE";

// ── Transition definition ────────────────────────────────────

export interface TransitionDef {
  target: ProposalStatus;
  guard?: Guard;
  guardDescription?: string;
}

// ── Transition Table (flat structure for TS compatibility) ───

type StateKey = ProposalStatus;
type EventKey = ProposalEvent;

/** Flat transition table: "state:event" → TransitionDef */
const table = new Map<string, TransitionDef>();

const entry = (state: StateKey, event: EventKey, def: TransitionDef) => {
  table.set(`${state}:${event}`, def);
};

// ── Build the table ─────────────────────────────────────────

// open → deliberating
entry("open", "deliberate", { target: "deliberating" });

// deliberating → approved | rejected | controlled
entry("deliberating", "approve", {
  target: "approved",
  guard: (ctx: GuardContext) => ctx.quorumMet === true,
  guardDescription: "Quorum must be met",
});
entry("deliberating", "reject", {
  target: "rejected",
  guard: (ctx: GuardContext) => ctx.quorumMet === false || ctx.approvalScore !== undefined,
  guardDescription: "Must have deliberation results",
});
entry("deliberating", "pass_gates", {
  target: "controlled",
  guard: (ctx: GuardContext) => ctx.quorumMet === true,
  guardDescription: "Quorum must be met before gates",
});

// approved → controlled | rejected
entry("approved", "pass_gates", {
  target: "controlled",
  guard: (ctx: GuardContext) => ctx.gatesPassed === true,
  guardDescription: "All control gates must pass",
});
entry("approved", "reject", { target: "rejected" });

// controlled → executed | failed
entry("controlled", "execute", {
  target: "executed",
  guard: (ctx: GuardContext) => ctx.gatesPassed === true,
  guardDescription: "Gates must have passed",
});
entry("controlled", "fail_execution", { target: "failed" });

// failed → controlled (retry)
entry("failed", "retry", { target: "controlled" });

// terminal: archive is idempotent
entry("executed", "archive", { target: "executed" });
entry("rejected", "archive", { target: "rejected" });

/**
 * The canonical transition table.
 * Key format: "state:event" → TransitionDef
 */
export const TRANSITION_TABLE = table;

// ── Lookup helpers ───────────────────────────────────────────

/** Get the transition definition for a state + event. */
export const getTransition = (state: StateKey, event: EventKey): TransitionDef | undefined =>
  table.get(`${state}:${event}`);

/** Get all events valid from a given state. */
export const getEventsForState = (state: StateKey): EventKey[] => {
  const events: EventKey[] = [];
  for (const key of table.keys()) {
    if (key.startsWith(`${state}:`)) {
      events.push(key.split(":").slice(1).join(":") as EventKey);
    }
  }
  return events;
};

/** Get all target states reachable from a given state. */
export const getTargetsForState = (state: StateKey): ProposalStatus[] => {
  const targets = new Set<ProposalStatus>();
  for (const [key, def] of table) {
    if (key.startsWith(`${state}:`)) {
      targets.add(def.target);
    }
  }
  return Array.from(targets);
};

/** Get all states that have transitions. */
export const getDefinedStates = (): ProposalStatus[] => {
  const states = new Set<ProposalStatus>();
  for (const key of table.keys()) {
    states.add(key.split(":")[0] as ProposalStatus);
  }
  return Array.from(states);
};

// ── Terminal states ──────────────────────────────────────────

export const TERMINAL_STATES: Set<ProposalStatus> = new Set([
  "executed",
  "rejected",
]);

// ── State metadata ───────────────────────────────────────────

export const STATE_LABELS: Record<ProposalStatus, string> = {
  open: "📝 Open",
  deliberating: "🗳️ Deliberating",
  approved: "✅ Approved",
  controlled: "🔒 Controlled",
  rejected: "❌ Rejected",
  executed: "🚀 Executed",
  failed: "⚠️ Failed",
};

/** All valid states in pipeline order. */
export const STATE_ORDER: ProposalStatus[] = [
  "open",
  "deliberating",
  "approved",
  "controlled",
  "executed",
  "failed",
  "rejected",
];
