// ============================================================
// TDD RED Phase — XState v5 Proposal State Machine Tests
// ============================================================
// These tests define the contract for proposalMachine
// (extensions/dao/core/machine.ts) which does not exist yet.
//
// Run: npx vitest run extensions/dao/core/__tests__/machine.test.ts
// All tests MUST FAIL until the machine is implemented.
// ============================================================

import { describe, it, expect } from "vitest";
import { createActor } from "xstate";
import { proposalMachine } from "../machine.js";

// ── Helpers ───────────────────────────────────────────────────

/** Create a fresh actor for a new proposal lifecycle. */
function createProposalActor(proposalId = 1) {
  const actor = createActor(proposalMachine, {
    input: { proposalId },
  });
  actor.start();
  return actor;
}

// ── Initial State ─────────────────────────────────────────────

describe("proposalMachine — initial state", () => {
  it("starts in 'open' state", () => {
    const actor = createProposalActor();
    expect(actor.getSnapshot().value).toBe("open");
  });

  it("initializes proposalId from input", () => {
    const actor = createProposalActor(42);
    expect(actor.getSnapshot().context.proposalId).toBe(42);
  });

  it("initializes quorumMet to false", () => {
    const actor = createProposalActor();
    expect(actor.getSnapshot().context.quorumMet).toBe(false);
  });

  it("initializes gatesPassed to false", () => {
    const actor = createProposalActor();
    expect(actor.getSnapshot().context.gatesPassed).toBe(false);
  });
});

// ── Happy Path Transitions ───────────────────────────────────

describe("proposalMachine — happy path transitions", () => {
  it("open → deliberate → deliberating", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    expect(actor.getSnapshot().value).toBe("deliberating");
  });

  it("deliberating → approve (quorumMet:true) → approved", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    expect(actor.getSnapshot().value).toBe("approved");
  });

  it("deliberating → reject → rejected", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "reject", quorumMet: false, hasVotes: true });
    expect(actor.getSnapshot().value).toBe("rejected");
  });

  it("deliberating → pass_gates (quorumMet:true) → controlled (shortcut)", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "pass_gates", quorumMet: true });
    expect(actor.getSnapshot().value).toBe("controlled");
  });

  it("approved → pass_gates (gatesPassed:true) → controlled", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    actor.send({ type: "pass_gates", gatesPassed: true });
    expect(actor.getSnapshot().value).toBe("controlled");
  });

  it("approved → reject → rejected", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    actor.send({ type: "reject" });
    expect(actor.getSnapshot().value).toBe("rejected");
  });

  it("controlled → execute (gatesPassed:true) → executed", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    actor.send({ type: "pass_gates", gatesPassed: true });
    actor.send({ type: "execute", gatesPassed: true });
    expect(actor.getSnapshot().value).toBe("executed");
  });

  it("controlled → fail_execution → failed", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    actor.send({ type: "pass_gates", gatesPassed: true });
    actor.send({ type: "fail_execution" });
    expect(actor.getSnapshot().value).toBe("failed");
  });

  it("failed → retry → controlled", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    actor.send({ type: "pass_gates", gatesPassed: true });
    actor.send({ type: "fail_execution" });
    actor.send({ type: "retry" });
    expect(actor.getSnapshot().value).toBe("controlled");
  });
});

// ── Full Lifecycle ───────────────────────────────────────────

describe("proposalMachine — full lifecycle", () => {
  it("walks open → deliberating → approved → controlled → executed", () => {
    const actor = createProposalActor(99);

    // Submit & deliberate
    actor.send({ type: "deliberate" });
    expect(actor.getSnapshot().value).toBe("deliberating");

    // Approve with quorum
    actor.send({ type: "approve", quorumMet: true, approvalScore: 85 });
    expect(actor.getSnapshot().value).toBe("approved");

    // Pass control gates
    actor.send({ type: "pass_gates", gatesPassed: true });
    expect(actor.getSnapshot().value).toBe("controlled");

    // Execute with gates passed
    actor.send({ type: "execute", gatesPassed: true });
    expect(actor.getSnapshot().value).toBe("executed");

    // Context preserved through full lifecycle
    expect(actor.getSnapshot().context.proposalId).toBe(99);
    expect(actor.getSnapshot().context.quorumMet).toBe(true);
    expect(actor.getSnapshot().context.gatesPassed).toBe(true);
    expect(actor.getSnapshot().context.approvalScore).toBe(85);
  });
});

// ── Guard Rejections ─────────────────────────────────────────

describe("proposalMachine — guard rejections", () => {
  it("deliberating → approve WITHOUT quorumMet → stays deliberating", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: false });
    expect(actor.getSnapshot().value).toBe("deliberating");
  });

  it("approved → pass_gates WITHOUT gatesPassed → stays approved", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    actor.send({ type: "pass_gates", gatesPassed: false });
    expect(actor.getSnapshot().value).toBe("approved");
  });

  it("controlled → execute WITHOUT gatesPassed → stays controlled", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    actor.send({ type: "pass_gates", gatesPassed: true });
    actor.send({ type: "execute", gatesPassed: false });
    expect(actor.getSnapshot().value).toBe("controlled");
  });
});

// ── Invalid Transitions (ignored events) ─────────────────────

describe("proposalMachine — invalid transitions", () => {
  it("open → execute → stays open (execute not valid from open)", () => {
    const actor = createProposalActor();
    actor.send({ type: "execute", gatesPassed: true });
    expect(actor.getSnapshot().value).toBe("open");
  });

  it("executed → deliberate → stays executed (terminal state)", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    actor.send({ type: "pass_gates", gatesPassed: true });
    actor.send({ type: "execute", gatesPassed: true });
    expect(actor.getSnapshot().value).toBe("executed");

    // Sending to a terminal (final) state is a no-op
    actor.send({ type: "deliberate" });
    expect(actor.getSnapshot().value).toBe("executed");
  });

  it("rejected → approve → stays rejected (terminal state)", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "reject", quorumMet: false, hasVotes: true });
    expect(actor.getSnapshot().value).toBe("rejected");

    // Sending to a terminal (final) state is a no-op
    actor.send({ type: "approve", quorumMet: true });
    expect(actor.getSnapshot().value).toBe("rejected");
  });

  it("open → pass_gates → stays open (pass_gates not valid from open)", () => {
    const actor = createProposalActor();
    actor.send({ type: "pass_gates", gatesPassed: true });
    expect(actor.getSnapshot().value).toBe("open");
  });

  it("approved → execute → stays approved (execute not valid from approved)", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    actor.send({ type: "execute", gatesPassed: true });
    expect(actor.getSnapshot().value).toBe("approved");
  });
});

// ── Terminal States ──────────────────────────────────────────

describe("proposalMachine — terminal states", () => {
  it("'executed' is a final state — actor stops after reaching it", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    actor.send({ type: "pass_gates", gatesPassed: true });
    actor.send({ type: "execute", gatesPassed: true });

    expect(actor.getSnapshot().value).toBe("executed");
    // A root-level final state causes the actor to stop
    expect(actor.getSnapshot().matches("executed")).toBe(true);
  });

  it("'rejected' is a final state — actor stops after reaching it", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "reject", quorumMet: false, hasVotes: true });

    expect(actor.getSnapshot().value).toBe("rejected");
    expect(actor.getSnapshot().matches("rejected")).toBe(true);
  });
});

// ── Context Updates ──────────────────────────────────────────

describe("proposalMachine — context updates", () => {
  it("proposalId is set from actor input and persisted in context", () => {
    const actor = createProposalActor(7);
    expect(actor.getSnapshot().context.proposalId).toBe(7);

    // Walk through some transitions — proposalId should persist
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    expect(actor.getSnapshot().context.proposalId).toBe(7);
  });

  it("quorumMet is updated to true on approve event", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });

    // Before approve, quorumMet should be false (initial)
    expect(actor.getSnapshot().context.quorumMet).toBe(false);

    actor.send({ type: "approve", quorumMet: true });
    expect(actor.getSnapshot().context.quorumMet).toBe(true);
  });

  it("gatesPassed is updated to true on pass_gates event", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });

    // Before pass_gates, gatesPassed should be false (initial)
    expect(actor.getSnapshot().context.gatesPassed).toBe(false);

    actor.send({ type: "pass_gates", gatesPassed: true });
    expect(actor.getSnapshot().context.gatesPassed).toBe(true);
  });

  it("approvalScore is tracked in context from approve event", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });

    // Before approve, approvalScore should be 0 (initial)
    expect(actor.getSnapshot().context.approvalScore).toBe(0);

    actor.send({ type: "approve", quorumMet: true, approvalScore: 92 });
    expect(actor.getSnapshot().context.approvalScore).toBe(92);
  });
});

// ── Retry Resilience ─────────────────────────────────────────

describe("proposalMachine — retry resilience", () => {
  it("failed → retry → controlled → execute → executed (recovery path)", () => {
    const actor = createProposalActor(55);

    // Happy path to controlled
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    actor.send({ type: "pass_gates", gatesPassed: true });

    // Execution fails
    actor.send({ type: "fail_execution" });
    expect(actor.getSnapshot().value).toBe("failed");

    // Retry and succeed
    actor.send({ type: "retry" });
    expect(actor.getSnapshot().value).toBe("controlled");
    actor.send({ type: "execute", gatesPassed: true });
    expect(actor.getSnapshot().value).toBe("executed");

    // Context preserved through recovery
    expect(actor.getSnapshot().context.proposalId).toBe(55);
    expect(actor.getSnapshot().context.gatesPassed).toBe(true);
  });

  it("multiple failures and retries cycle correctly", () => {
    const actor = createProposalActor();

    // Get to controlled
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    actor.send({ type: "pass_gates", gatesPassed: true });

    // Fail → retry → fail → retry → succeed
    actor.send({ type: "fail_execution" });
    expect(actor.getSnapshot().value).toBe("failed");

    actor.send({ type: "retry" });
    expect(actor.getSnapshot().value).toBe("controlled");

    actor.send({ type: "fail_execution" });
    expect(actor.getSnapshot().value).toBe("failed");

    actor.send({ type: "retry" });
    expect(actor.getSnapshot().value).toBe("controlled");

    actor.send({ type: "execute", gatesPassed: true });
    expect(actor.getSnapshot().value).toBe("executed");
  });
});

// ── Phase 2: Hardened Guards ────────────────────────────────

describe("Phase 2: hardened guards", () => {
  it("deliberating → reject requires hasVotes=true", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "reject", quorumMet: false, hasVotes: true });
    expect(actor.getSnapshot().value).toBe("rejected");
  });

  it("deliberating → reject blocked without hasVotes", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    // No hasVotes (defaults to undefined) → guard blocks
    actor.send({ type: "reject", quorumMet: false });
    expect(actor.getSnapshot().value).toBe("deliberating");
  });

  it("failed → abandon → rejected", () => {
    const actor = createProposalActor();
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    actor.send({ type: "pass_gates", gatesPassed: true });
    actor.send({ type: "fail_execution" });
    expect(actor.getSnapshot().value).toBe("failed");

    actor.send({ type: "abandon" });
    expect(actor.getSnapshot().value).toBe("rejected");
  });

  it("abandoned proposal is final (actor stops)", () => {
    const actor = createProposalActor(88);
    actor.send({ type: "deliberate" });
    actor.send({ type: "approve", quorumMet: true });
    actor.send({ type: "pass_gates", gatesPassed: true });
    actor.send({ type: "fail_execution" });
    actor.send({ type: "abandon" });

    const snap = actor.getSnapshot();
    expect(snap.value).toBe("rejected");
    expect(snap.matches("rejected")).toBe(true);

    // No further transitions possible from final state
    actor.send({ type: "retry" });
    expect(actor.getSnapshot().value).toBe("rejected");

    // Context preserved through abandon
    expect(actor.getSnapshot().context.proposalId).toBe(88);
  });
});
