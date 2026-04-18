import { describe, expect, it } from "vitest";
import type { Proposal } from "../../extensions/dao/types.ts";
import { validateProposalQuality } from "../../extensions/dao/governance/proposal-quality.ts";

const makeProposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  id: 1,
  title: "Test Proposal",
  type: "product-feature",
  description: "A test proposal",
  stage: "intake",
  proposedBy: "test",
  status: "open",
  votes: [],
  agentOutputs: [],
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe("proposal quality validation", () => {
  it("passes when all required legacy structured fields are present", () => {
    const proposal = makeProposal({
      acceptanceCriteria: [
        {
          id: "AC-1",
          given: "a proposal exists",
          when: "it is deliberated",
          then: "agents receive a complete spec",
        },
      ],
      problemStatement: "Users submit vague proposals that waste deliberation time.",
      successMetrics: ["80% of proposals include the required structured fields"],
      rollbackConditions: ["Rollback if valid proposals are blocked unexpectedly"],
    });

    const result = validateProposalQuality(proposal);

    expect(result.valid).toBe(true);
    expect(result.missingFields).toEqual([]);
    expect(result.template).toBe("");
  });

  it("passes when structured content is stored on proposal.content", () => {
    const proposal = makeProposal({
      content: {
        title: "Test Proposal",
        type: "product-feature",
        problemStatement: "Deliberation lacks a minimum spec floor.",
        targetUser: "proposal author",
        expectedOutcome: "Higher quality proposals",
        successMetrics: ["90% of proposals pass validation on first retry"],
        scopeIn: ["Validation"],
        scopeOut: [],
        permissionsImpact: [],
        dataImpact: [],
        technicalOptions: [],
        risks: [],
        dependencies: [],
        estimatedEffort: "1 day",
        confidenceScore: 8,
        recommendedDecision: "approve",
      },
      acceptanceCriteria: [
        {
          id: "AC-1",
          given: "required fields are present",
          when: "dao_deliberate is called",
          then: "deliberation proceeds",
        },
      ],
      rollbackConditions: ["Rollback if proposal throughput drops by 20%"],
    });

    const result = validateProposalQuality(proposal);

    expect(result.valid).toBe(true);
  });

  it("reports missing fields and includes a diagnostic template", () => {
    const proposal = makeProposal();

    const result = validateProposalQuality(proposal);

    expect(result.valid).toBe(false);
    expect(result.missingFields).toEqual([
      "problemStatement",
      "acceptanceCriteria",
      "successMetrics",
      "rollbackConditions",
    ]);
    expect(result.template).toContain("## Missing Required Fields");
    expect(result.template).toContain("`problemStatement`");
    expect(result.template).toContain("## Examples");
    expect(result.template).toContain("## Copy/Paste Template");
    expect(result.template).toContain("```json");
    expect(result.template).toContain('"rollbackConditions"');
  });

  it("skips the gate for governance-change proposals", () => {
    const proposal = makeProposal({
      type: "governance-change",
    });

    const result = validateProposalQuality(proposal);

    expect(result.valid).toBe(true);
    expect(result.missingFields).toEqual([]);
  });
});
