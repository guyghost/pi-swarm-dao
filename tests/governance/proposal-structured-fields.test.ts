import { beforeEach, describe, expect, it } from "vitest";
import { setState } from "../../extensions/dao/persistence.ts";
import {
  createInitialState,
  type Proposal,
} from "../../extensions/dao/types.ts";
import {
  updateProposalStructuredFields,
} from "../../extensions/dao/governance/proposals.ts";
import { validateProposalQuality } from "../../extensions/dao/governance/proposal-quality.ts";

beforeEach(() => {
  const state = createInitialState();
  state.proposals = [
    {
      id: 1,
      title: "Incomplete proposal",
      type: "product-feature",
      description: "Needs more structure",
      stage: "intake",
      proposedBy: "test",
      status: "open",
      votes: [],
      agentOutputs: [],
      createdAt: new Date().toISOString(),
    } as Proposal,
  ];
  setState(state);
});

describe("updateProposalStructuredFields", () => {
  it("fills the quality-gate fields so validation can pass", () => {
    const updated = updateProposalStructuredFields(1, {
      problemStatement: "Users submit vague proposals that cannot be evaluated consistently.",
      acceptanceCriteria: [
        "Proposal includes all required structured fields before deliberation.",
      ],
      successMetrics: [
        "90% of proposals pass validation before deliberation.",
      ],
      rollbackConditions: [
        "Rollback if valid proposals are blocked unexpectedly.",
      ],
    });

    expect(updated.problemStatement).toContain("vague proposals");
    expect(updated.acceptanceCriteria).toHaveLength(1);
    expect(updated.acceptanceCriteria?.[0].id).toBe("AC-1");
    expect(updated.successMetrics).toEqual([
      "90% of proposals pass validation before deliberation.",
    ]);
    expect(updated.rollbackConditions).toEqual([
      "Rollback if valid proposals are blocked unexpectedly.",
    ]);

    const validation = validateProposalQuality(updated);
    expect(validation.valid).toBe(true);
  });

  it("can clear acceptance criteria when an empty list is supplied", () => {
    const updated = updateProposalStructuredFields(1, {
      acceptanceCriteria: [],
    });

    expect(updated.acceptanceCriteria).toBeUndefined();
  });
});
