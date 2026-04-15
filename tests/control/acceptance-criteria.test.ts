// ============================================================
// Tests — Proposal #10: Acceptance Criteria Gate
// ============================================================
import { describe, it, expect, beforeEach } from "vitest";
import { getState, setState } from "../../extensions/dao/persistence.ts";
import { createInitialState, type Proposal } from "../../extensions/dao/types.ts";
import { runGates } from "../../extensions/dao/control/gates.ts";

// Reset state before each test
beforeEach(() => {
  const state = createInitialState();
  // Add minimal agents for quorum
  state.agents = [
    { id: "test-agent", name: "Test", role: "testing", description: "Test agent", weight: 1, systemPrompt: "" },
  ];
  setState(state);
});

const makeProposal = (overrides: Partial<Proposal> = {}): Proposal => ({
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

describe("Acceptance Criteria Gate (#10)", () => {
  it("passes with warning when no criteria defined", () => {
    const proposal = makeProposal();
    const result = runGates(proposal);
    const acGate = result.gates.find(g => g.gateId === "acceptance-criteria");

    expect(acGate).toBeDefined();
    expect(acGate!.passed).toBe(true);
    expect(acGate!.severity).toBe("warning");
    expect(acGate!.message).toContain("No structured acceptance criteria");
  });

  it("passes when all criteria are met", () => {
    const proposal = makeProposal({
      acceptanceCriteria: [
        { id: "AC-1", given: "a proposal exists", when: "it is executed", then: "it produces output", met: true, evidence: "Output observed" },
        { id: "AC-2", given: "execution completes", when: "result is checked", then: "status is executed", met: true, evidence: "Status confirmed" },
      ],
    });
    const result = runGates(proposal);
    const acGate = result.gates.find(g => g.gateId === "acceptance-criteria");

    expect(acGate!.passed).toBe(true);
    expect(acGate!.severity).toBe("info");
    expect(acGate!.message).toContain("All 2 acceptance criteria met");
  });

  it("fails with blocker when criteria are not met", () => {
    const proposal = makeProposal({
      acceptanceCriteria: [
        { id: "AC-1", given: "a proposal exists", when: "it is executed", then: "it produces output", met: true },
        { id: "AC-2", given: "execution completes", when: "result is checked", then: "status is executed", met: false },
      ],
    });
    const result = runGates(proposal);
    const acGate = result.gates.find(g => g.gateId === "acceptance-criteria");

    expect(acGate!.passed).toBe(false);
    expect(acGate!.severity).toBe("blocker");
    expect(acGate!.message).toContain("1/2 acceptance criteria not met");
    expect(acGate!.message).toContain("AC-2");
  });

  it("reports unmet criteria details in gate details", () => {
    const proposal = makeProposal({
      acceptanceCriteria: [
        { id: "AC-1", given: "setup", when: "action", then: "result", met: true },
        { id: "AC-2", given: "setup2", when: "action2", then: "result2", met: false },
      ],
    });
    const result = runGates(proposal);
    const acGate = result.gates.find(g => g.gateId === "acceptance-criteria");

    expect(acGate!.details?.unmet).toHaveLength(1);
    expect(acGate!.details?.unmet[0].id).toBe("AC-2");
  });
});
