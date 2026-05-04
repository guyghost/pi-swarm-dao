// ============================================================
// Tests — Proposal #15: Mandatory Dry-Run Gate
// ============================================================
import { describe, it, expect, beforeEach } from "vitest";
import { getState, setState } from "../../extensions/dao/persistence.ts";
import { createInitialState } from "../../extensions/dao/types.ts";
import { runGates } from "../../extensions/dao/control/gates.ts";

beforeEach(() => {
  const state = createInitialState();
  state.agents = [
    { id: "test-agent", name: "Test", role: "testing", description: "Test agent", weight: 1, systemPrompt: "" },
  ];
  setState(state);
});

const makeProposal = (overrides: Partial<import("../../extensions/dao/types.ts").Proposal> = {}) => ({
  id: 1,
  title: "Test Proposal",
  type: "product-feature",
  description: "A test proposal",
  status: "approved",
  stage: "execution-gate",
  proposedBy: "test",
  votes: [],
  agentOutputs: [],
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe("Mandatory Dry-Run Gate (#15)", () => {
  it("blocks when no dry-run has been performed", () => {
    const proposal = makeProposal();
    const result = runGates(proposal);
    const gate = result.gates.find(g => g.gateId === "mandatory-dry-run");

    expect(gate).toBeDefined();
    expect(gate!.passed).toBe(false);
    expect(gate!.severity).toBe("blocker");
    expect(gate!.message).toContain("No dry-run recorded");
  });

  it("blocks when previous dry-run flagged risks", () => {
    const proposal = makeProposal({
      dryRunAt: new Date().toISOString(),
      dryRunCanProceed: false,
    });
    const result = runGates(proposal);
    const gate = result.gates.find(g => g.gateId === "mandatory-dry-run");

    expect(gate!.passed).toBe(false);
    expect(gate!.severity).toBe("blocker");
    expect(gate!.message).toContain("canProceed: false");
  });

  it("passes when dry-run was successful", () => {
    const proposal = makeProposal({
      dryRunAt: new Date().toISOString(),
      dryRunCanProceed: true,
    });
    const result = runGates(proposal);
    const gate = result.gates.find(g => g.gateId === "mandatory-dry-run");

    expect(gate!.passed).toBe(true);
    expect(gate!.severity).toBe("info");
    expect(gate!.message).toContain("Dry-run performed");
  });

  it("includes dry-run timestamp in details", () => {
    const ts = "2026-05-04T20:00:00Z";
    const proposal = makeProposal({
      dryRunAt: ts,
      dryRunCanProceed: true,
    });
    const result = runGates(proposal);
    const gate = result.gates.find(g => g.gateId === "mandatory-dry-run");

    expect(gate!.details?.dryRunAt).toBe(ts);
    expect(gate!.details?.canProceed).toBe(true);
  });
});
