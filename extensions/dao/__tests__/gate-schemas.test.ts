// ============================================================
// pi-swarm-dao — Gate Schema Registry Tests (Proposal #21)
// ============================================================

import { describe, it, expect } from "vitest";
import {
  GATE_SCHEMAS,
  getSchemaForType,
  validateProposalSchema,
  formatSchemaFailures,
} from "../governance/gate-schemas.js";
import type { Proposal, ProposalType } from "../types.js";

const makeProposal = (type: ProposalType, overrides: Partial<Proposal> = {}): Proposal => ({
  id: 1,
  title: "Test",
  type,
  description: "## Problem\n\nA problem.\n\n## Solution\n\nA solution.",
  stage: "intake",
  proposedBy: "test",
  status: "open",
  votes: [],
  agentOutputs: [],
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe("Gate Schema Registry (Proposal #21)", () => {
  it("has schemas for all 5 proposal types", () => {
    const types: ProposalType[] = [
      "product-feature",
      "security-change",
      "technical-change",
      "release-change",
      "governance-change",
    ];
    for (const t of types) {
      const schema = getSchemaForType(t);
      expect(schema).toBeDefined();
      expect(schema.proposalType).toBe(t);
      expect(schema.requiredFields.length).toBeGreaterThan(0);
      expect(schema.requiredSections.length).toBeGreaterThan(0);
    }
  });

  it("security-change requires impact assessment and threat model", () => {
    const schema = getSchemaForType("security-change");
    expect(schema.requiredFields.some((f) => f.name === "impactAssessment")).toBe(true);
    expect(schema.requiredSections.some((s) => s.heading.includes("Threat Model"))).toBe(true);
    expect(schema.riskThresholdOverride).toBe(5);
  });

  it("governance-change requires migration path", () => {
    const schema = getSchemaForType("governance-change");
    expect(schema.requiredFields.some((f) => f.name === "migrationPath")).toBe(true);
    expect(schema.requiredSections.some((s) => s.heading.includes("Migration Path"))).toBe(true);
    expect(schema.riskThresholdOverride).toBe(4);
  });

  it("validates a complete product-feature proposal", () => {
    const proposal = makeProposal("product-feature", {
      description: "## Problem\n\nP\n\n## Solution\n\nS\n\n## User Stories\n\nUS-1\n\n## Success Metrics\n\nM",
      problemStatement: "Problem",
      acceptanceCriteria: [{ id: "AC-1", given: "", when: "", then: "" }],
      successMetrics: ["Metric"],
      rollbackConditions: ["Rollback"],
    });
    const result = validateProposalSchema(proposal);
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it("fails when required fields are missing", () => {
    const proposal = makeProposal("product-feature", {
      description: "## Problem\n\nP\n\n## Solution\n\nS\n\n## User Stories\n\nUS-1\n\n## Success Metrics\n\nM",
    });
    const result = validateProposalSchema(proposal);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.field === "problemStatement")).toBe(true);
    expect(result.failures.some((f) => f.field === "acceptanceCriteria")).toBe(true);
  });

  it("fails when required sections are missing", () => {
    const proposal = makeProposal("product-feature", {
      description: "No sections here",
      problemStatement: "Problem",
      acceptanceCriteria: [{ id: "AC-1", given: "", when: "", then: "" }],
      successMetrics: ["Metric"],
      rollbackConditions: ["Rollback"],
    });
    const result = validateProposalSchema(proposal);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.section === "Problem Statement")).toBe(true);
    expect(result.failures.some((f) => f.section === "User Stories")).toBe(true);
  });

  it("formats failures with both fields and sections", () => {
    const proposal = makeProposal("security-change", {
      description: "No sections",
    });
    const result = validateProposalSchema(proposal);
    const formatted = formatSchemaFailures(result);
    expect(formatted).toContain("Schema Validation Failures");
    expect(formatted).toContain("Missing Fields");
    expect(formatted).toContain("Missing Sections");
    expect(formatted).toContain("Threat Model");
  });

  it("governance-change passes with minimal fields", () => {
    const proposal = makeProposal("governance-change", {
      description: "## Problem\n\nP\n\n## Migration Path\n\nM\n\n## Council Review\n\nR",
      problemStatement: "Problem",
    });
    const result = validateProposalSchema(proposal);
    expect(result.passed).toBe(true);
  });

  it("release-change requires release notes section", () => {
    const proposal = makeProposal("release-change", {
      description: "## Problem\n\nP\n\n## Solution\n\nS",
      problemStatement: "Problem",
      acceptanceCriteria: [{ id: "AC-1", given: "", when: "", then: "" }],
      successMetrics: ["Metric"],
    });
    const result = validateProposalSchema(proposal);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.section === "Release Notes")).toBe(true);
  });

  it("throws for unknown proposal types", () => {
    expect(() => getSchemaForType("unknown" as ProposalType)).toThrow("No gate schema defined");
  });
});
