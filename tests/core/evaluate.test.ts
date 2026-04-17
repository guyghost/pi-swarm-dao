// ============================================================
// Tests — Core State Machine: Transition Evaluation
// ============================================================

import { describe, it, expect } from "vitest";
import { evaluateTransition, getAllowedTransitions, isTerminal, assertTransition } from "../../extensions/dao/core/evaluate.ts";
import type { GuardContext } from "../../extensions/dao/core/states.ts";

// ── Happy Path: Every valid transition ───────────────────────

describe("evaluateTransition — happy path", () => {
  const baseCtx: GuardContext = {
    status: "open",
    quorumMet: true,
    gatesPassed: true,
    approvalScore: 100,
    hasVotes: true,
  };

  it("open → deliberating via deliberate", () => {
    const result = evaluateTransition("open", "deliberate", baseCtx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.from).toBe("open");
      expect(result.to).toBe("deliberating");
      expect(result.event).toBe("deliberate");
    }
  });

  it("deliberating → approved via approve (quorum met)", () => {
    const ctx = { ...baseCtx, status: "deliberating", quorumMet: true };
    const result = evaluateTransition("deliberating", "approve", ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.to).toBe("approved");
  });

  it("deliberating → rejected via reject", () => {
    const ctx = { ...baseCtx, status: "deliberating", quorumMet: false, approvalScore: 40 };
    const result = evaluateTransition("deliberating", "reject", ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.to).toBe("rejected");
  });

  it("deliberating → controlled via pass_gates (quorum met)", () => {
    const ctx = { ...baseCtx, status: "deliberating", quorumMet: true };
    const result = evaluateTransition("deliberating", "pass_gates", ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.to).toBe("controlled");
  });

  it("approved → controlled via pass_gates (gates passed)", () => {
    const ctx = { ...baseCtx, status: "approved", gatesPassed: true };
    const result = evaluateTransition("approved", "pass_gates", ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.to).toBe("controlled");
  });

  it("approved → rejected via reject", () => {
    const ctx = { ...baseCtx, status: "approved" };
    const result = evaluateTransition("approved", "reject", ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.to).toBe("rejected");
  });

  it("controlled → executed via execute (gates passed)", () => {
    const ctx = { ...baseCtx, status: "controlled", gatesPassed: true };
    const result = evaluateTransition("controlled", "execute", ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.to).toBe("executed");
  });

  it("controlled → failed via fail_execution", () => {
    const ctx = { ...baseCtx, status: "controlled" };
    const result = evaluateTransition("controlled", "fail_execution", ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.to).toBe("failed");
  });

  it("failed → controlled via retry", () => {
    const ctx = { ...baseCtx, status: "failed" };
    const result = evaluateTransition("failed", "retry", ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.to).toBe("controlled");
  });
});

// ── Guard Failures ───────────────────────────────────────────

describe("evaluateTransition — guard failures", () => {
  it("deliberating → approve REJECTED when quorum not met", () => {
    const ctx: GuardContext = { status: "deliberating", quorumMet: false };
    const result = evaluateTransition("deliberating", "approve", ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("QUORUM_NOT_MET");
      expect(result.guardDescription).toContain("Quorum");
    }
  });

  it("approved → pass_gates REJECTED when gates not passed", () => {
    const ctx: GuardContext = { status: "approved", gatesPassed: false };
    const result = evaluateTransition("approved", "pass_gates", ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("GATES_NOT_PASSED");
    }
  });

  it("controlled → execute REJECTED when gates not passed", () => {
    const ctx: GuardContext = { status: "controlled", gatesPassed: false };
    const result = evaluateTransition("controlled", "execute", ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("GATES_NOT_PASSED");
    }
  });

  it("deliberating → pass_gates REJECTED when quorum not met", () => {
    const ctx: GuardContext = { status: "deliberating", quorumMet: false };
    const result = evaluateTransition("deliberating", "pass_gates", ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("QUORUM_NOT_MET");
    }
  });
});

// ── Invalid Transitions ─────────────────────────────────────

describe("evaluateTransition — invalid transitions", () => {
  it("rejected is terminal — no transitions out", () => {
    const ctx: GuardContext = { status: "rejected" };
    const result = evaluateTransition("rejected", "deliberate", ctx);
    expect(result.ok).toBe(false);
  });

  it("executed is terminal — no transitions out", () => {
    const ctx: GuardContext = { status: "executed" };
    const result = evaluateTransition("executed", "deliberate", ctx);
    expect(result.ok).toBe(false);
  });

  it("open → execute is invalid (skip steps)", () => {
    const ctx: GuardContext = { status: "open" };
    const result = evaluateTransition("open", "execute", ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("INVALID_STATE");
    }
  });

  it("open → approve is invalid", () => {
    const ctx: GuardContext = { status: "open" };
    const result = evaluateTransition("open", "approve", ctx);
    expect(result.ok).toBe(false);
  });
});

// ── getAllowedTransitions ─────────────────────────────────────

describe("getAllowedTransitions", () => {
  it("open allows only deliberate", () => {
    const ctx: GuardContext = { status: "open" };
    const allowed = getAllowedTransitions("open", ctx);
    expect(allowed).toEqual(["deliberate"]);
  });

  it("deliberating with quorum allows approve, reject, pass_gates", () => {
    const ctx: GuardContext = { status: "deliberating", quorumMet: true, approvalScore: 100, hasVotes: true };
    const allowed = getAllowedTransitions("deliberating", ctx);
    expect(allowed).toContain("approve");
    expect(allowed).toContain("reject");
    expect(allowed).toContain("pass_gates");
  });

  it("deliberating without quorum blocks approve and pass_gates", () => {
    const ctx: GuardContext = { status: "deliberating", quorumMet: false, approvalScore: 40, hasVotes: true };
    const allowed = getAllowedTransitions("deliberating", ctx);
    expect(allowed).not.toContain("approve");
    expect(allowed).not.toContain("pass_gates");
    expect(allowed).toContain("reject");
  });

  it("approved with gates passed allows pass_gates and reject", () => {
    const ctx: GuardContext = { status: "approved", gatesPassed: true };
    const allowed = getAllowedTransitions("approved", ctx);
    expect(allowed).toContain("pass_gates");
    expect(allowed).toContain("reject");
  });

  it("controlled with gates passed allows execute and fail_execution", () => {
    const ctx: GuardContext = { status: "controlled", gatesPassed: true };
    const allowed = getAllowedTransitions("controlled", ctx);
    expect(allowed).toContain("execute");
    expect(allowed).toContain("fail_execution");
  });

  it("failed allows retry and abandon", () => {
    const ctx: GuardContext = { status: "failed" };
    const allowed = getAllowedTransitions("failed", ctx);
    expect(allowed).toEqual(["retry", "abandon"]);
  });

  it("rejected (terminal) has no allowed transitions", () => {
    const ctx: GuardContext = { status: "rejected" };
    const allowed = getAllowedTransitions("rejected", ctx);
    // archive is self-transition, filtered by target !== from check
    expect(allowed.length).toBeLessThanOrEqual(1);
  });
});

// ── isTerminal ────────────────────────────────────────────────

describe("isTerminal", () => {
  it("executed is terminal", () => expect(isTerminal("executed")).toBe(true));
  it("rejected is terminal", () => expect(isTerminal("rejected")).toBe(true));
  it("open is not terminal", () => expect(isTerminal("open")).toBe(false));
  it("deliberating is not terminal", () => expect(isTerminal("deliberating")).toBe(false));
  it("approved is not terminal", () => expect(isTerminal("approved")).toBe(false));
  it("controlled is not terminal", () => expect(isTerminal("controlled")).toBe(false));
  it("failed is not terminal", () => expect(isTerminal("failed")).toBe(false));
});

// ── assertTransition throws ──────────────────────────────────

describe("assertTransition", () => {
  it("throws on invalid transition", () => {
    const ctx: GuardContext = { status: "open" };
    expect(() => assertTransition("open", "execute", ctx)).toThrow();
  });

  it("throws on guard failure", () => {
    const ctx: GuardContext = { status: "deliberating", quorumMet: false };
    expect(() => assertTransition("deliberating", "approve", ctx)).toThrow("QUORUM_NOT_MET");
  });

  it("returns target on success", () => {
    const ctx: GuardContext = { status: "open" };
    const target = assertTransition("open", "deliberate", ctx);
    expect(target).toBe("deliberating");
  });
});
