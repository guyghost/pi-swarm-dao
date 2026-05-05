// ============================================================
// pi-swarm-dao — Proposal Quality Validation (V2 with Gate Schemas)
// ============================================================
// Refactored for Proposal #21: per-type quality gate schemas.
// Backward-compatible with existing validateProposalQuality() API.
// ============================================================

import type { Proposal } from "../types.js";
import { validateProposalSchema, formatSchemaFailures, getSchemaForType } from "./gate-schemas.js";

export interface ProposalQualityValidationResult {
  valid: boolean;
  missingFields: string[];
  template: string;
}

const EXAMPLES = {
  problemStatement:
    'Users cannot complete X when Y happens, causing Z for the team.',
  acceptanceCriteria:
    'User can submit a proposal with structured fields and see validation feedback.',
  successMetrics:
    '90% of new proposals include all required structured fields.',
  rollbackConditions:
    'Rollback if validation blocks more than 20% of previously valid proposal flows.',
  impactAssessment:
    'Threat: XSS via unvalidated input. Impact: user sessions compromised.',
  migrationPath:
    'Phase 1: dual-write to new schema. Phase 2: migrate reads. Phase 3: remove old.',
  technicalDesign:
    'New state machine with XState v5, pure transitions, typed context.',
  releaseNotes:
    'v1.2.0 — Added health score dashboard, fixed dry-run edge case.',
} as const;

const PLACEHOLDERS = {
  problemStatement:
    'What problem exists today, for whom, and why it matters.',
  acceptanceCriteria: [
    'Describe a measurable condition that proves the proposal succeeded.',
  ],
  successMetrics: [
    'Define at least one metric you will track after execution.',
  ],
  rollbackConditions: [
    'Describe at least one measurable trigger that would require rollback.',
  ],
  impactAssessment: [
    'Describe security impact, threat model, and affected surfaces.',
  ],
  migrationPath: [
    'Describe phases, rollback plan, and backward compatibility strategy.',
  ],
  technicalDesign: [
    'Describe architecture, key decisions, and trade-offs.',
  ],
  releaseNotes: [
    'Summarize changes, breaking changes, and migration notes.',
  ],
} as const;

/**
 * Validate a proposal against its type-specific quality gate schema.
 * Backward-compatible with the V1 API.
 */
export const validateProposalQuality = (
  proposal: Proposal,
): ProposalQualityValidationResult => {
  const schemaResult = validateProposalSchema(proposal);

  if (schemaResult.passed) {
    return {
      valid: true,
      missingFields: [],
      template: "",
    };
  }

  // Map schema failures to the V1 missingFields format
  const missingFields = schemaResult.failures
    .filter((f) => f.field)
    .map((f) => f.field!);

  return {
    valid: false,
    missingFields,
    template: formatProposalQualityTemplate(proposal.type, schemaResult),
  };
};

/**
 * Format a helpful template for missing fields/sections.
 */
export const formatProposalQualityTemplate = (
  proposalType: Proposal['type'],
  schemaResult?: import("../types.js").SchemaValidationResult,
): string => {
  const schema = getSchemaForType(proposalType);

  let out = `## 📋 ${proposalType} Quality Requirements\n\n`;
  out += `${schema.description}\n\n`;

  // Required fields table
  out += `### Required Fields\n\n`;
  out += `| Field | Status |\n`;
  out += `|-------|--------|\n`;
  for (const field of schema.requiredFields) {
    const failed = schemaResult?.failures.find((f) => f.field === field.name);
    const status = failed ? "❌ Missing" : "✅";
    out += `| ${field.label} | ${status} |\n`;
  }

  // Required sections table
  out += `\n### Required Sections\n\n`;
  out += `| Section | Expected Heading | Status |\n`;
  out += `|---------|-----------------|--------|\n`;
  for (const section of schema.requiredSections) {
    const failed = schemaResult?.failures.find((f) => f.section === section.label);
    const status = failed ? "❌ Missing" : "✅";
    out += `| ${section.label} | \`${section.heading}\` | ${status} |\n`;
  }

  // Type-specific examples
  const fieldNames = schema.requiredFields.map((f) => f.name);
  const hasExample = (name: string): name is keyof typeof EXAMPLES =>
    name in EXAMPLES;

  const exampleFields = fieldNames.filter(hasExample);
  if (exampleFields.length > 0) {
    out += `\n### Examples\n\n`;
    for (const field of exampleFields) {
      out += `- **${field}**: ${EXAMPLES[field]}\n`;
    }
  }

  // If we have schema failures, show them
  if (schemaResult && !schemaResult.passed) {
    out += `\n${formatSchemaFailures(schemaResult)}`;
  }

  return out;
};
