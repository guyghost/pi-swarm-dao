// ============================================================
// pi-swarm-dao — Gate Schema Registry (Proposal #21)
// ============================================================
// Per-type quality gate schemas defining required fields,
// required description sections, and risk threshold overrides.
// ============================================================

import type { Proposal, ProposalType, GateSchema, SchemaValidationResult } from "../types.js";

// ── Field Validators ───────────────────────────────────────

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const nonEmptyStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.some(nonEmptyString);

const hasAcceptanceCriteria = (proposal: Proposal): boolean =>
  Array.isArray(proposal.acceptanceCriteria) && proposal.acceptanceCriteria.length > 0;

const hasContentField = (field: keyof NonNullable<Proposal["content"]>) =>
  (proposal: Proposal): boolean => {
    const content = proposal.content;
    if (!content) return false;
    const value = content[field];
    if (typeof value === "string") return nonEmptyString(value);
    if (Array.isArray(value)) return nonEmptyStringArray(value);
    return false;
  };

const hasProblemStatement = (proposal: Proposal): boolean => {
  return nonEmptyString(proposal.content?.problemStatement ?? proposal.problemStatement);
};

const hasSuccessMetrics = (proposal: Proposal): boolean => {
  return nonEmptyStringArray(proposal.content?.successMetrics ?? proposal.successMetrics);
};

const hasRollbackConditions = (proposal: Proposal): boolean => {
  return nonEmptyStringArray(proposal.rollbackConditions);
};

const hasImpactAssessment = (proposal: Proposal): boolean => {
  // Check for impactAssessment in content or as a top-level field
  return !!(nonEmptyString(proposal.content?.permissionsImpact?.join?.(" ") ?? "") ||
    nonEmptyString(proposal.content?.dataImpact?.join?.(" ") ?? "") ||
    (proposal.description && /impact assessment|threat model|security/i.test(proposal.description)));
};

const hasMigrationPath = (proposal: Proposal): boolean => {
  return !!(nonEmptyString(proposal.content?.dependencies?.join?.(" ") ?? "") ||
    (proposal.description && /migration|transition|backward compat/i.test(proposal.description)));
};

const hasTechnicalDesign = (proposal: Proposal): boolean => {
  return !!(hasContentField("technicalOptions")(proposal) ||
    (proposal.description && /technical design|architecture|design doc/i.test(proposal.description)));
};

const hasReleaseNotes = (proposal: Proposal): boolean => {
  return !!(nonEmptyString(proposal.content?.expectedOutcome) ||
    (proposal.description && /release notes|changelog|version/i.test(proposal.description)));
};

// ── Section Detectors ──────────────────────────────────────

const hasSection = (headingPattern: RegExp) => (proposal: Proposal): boolean => {
  const text = proposal.description ?? "";
  return headingPattern.test(text);
};

// ── Schema Definitions ─────────────────────────────────────

const BASE_FIELDS: GateSchema["requiredFields"] = [
  { name: "problemStatement", label: "Problem Statement", validator: hasProblemStatement },
  { name: "acceptanceCriteria", label: "Acceptance Criteria", validator: hasAcceptanceCriteria },
  { name: "successMetrics", label: "Success Metrics", validator: hasSuccessMetrics },
];

const BASE_SECTIONS: GateSchema["requiredSections"] = [
  { heading: "## Problem", label: "Problem Statement" },
  { heading: "## Solution", label: "Solution" },
];

/** Registry of gate schemas keyed by proposal type */
export const GATE_SCHEMAS: Record<ProposalType, GateSchema> = {
  "product-feature": {
    proposalType: "product-feature",
    description: "Product features require user-facing clarity and success metrics",
    requiredFields: [
      ...BASE_FIELDS,
      { name: "rollbackConditions", label: "Rollback Conditions", validator: hasRollbackConditions },
    ],
    requiredSections: [
      ...BASE_SECTIONS,
      { heading: "## User Stories", label: "User Stories" },
      { heading: "## Success Metrics", label: "Success Metrics" },
    ],
  },

  "security-change": {
    proposalType: "security-change",
    description: "Security changes require impact assessment and threat modeling",
    requiredFields: [
      ...BASE_FIELDS,
      { name: "impactAssessment", label: "Impact Assessment", validator: hasImpactAssessment },
      { name: "rollbackConditions", label: "Rollback Conditions", validator: hasRollbackConditions },
    ],
    requiredSections: [
      ...BASE_SECTIONS,
      { heading: "## Threat Model", label: "Threat Model" },
      { heading: "## Impact Assessment", label: "Impact Assessment" },
      { heading: "## Rollback Plan", label: "Rollback Plan" },
    ],
    riskThresholdOverride: 5, // Stricter than default
  },

  "technical-change": {
    proposalType: "technical-change",
    description: "Technical changes require design clarity and dependency analysis",
    requiredFields: [
      ...BASE_FIELDS,
      { name: "technicalDesign", label: "Technical Design", validator: hasTechnicalDesign },
      { name: "rollbackConditions", label: "Rollback Conditions", validator: hasRollbackConditions },
    ],
    requiredSections: [
      ...BASE_SECTIONS,
      { heading: "## Technical Design", label: "Technical Design" },
      { heading: "## Dependencies", label: "Dependencies" },
    ],
  },

  "release-change": {
    proposalType: "release-change",
    description: "Release changes require versioning and rollout clarity",
    requiredFields: [
      ...BASE_FIELDS,
      { name: "releaseNotes", label: "Release Notes / Changelog", validator: hasReleaseNotes },
    ],
    requiredSections: [
      ...BASE_SECTIONS,
      { heading: "## Release Notes", label: "Release Notes" },
      { heading: "## Rollout Plan", label: "Rollout Plan" },
    ],
  },

  "governance-change": {
    proposalType: "governance-change",
    description: "Governance changes require migration path and broad consensus",
    requiredFields: [
      { name: "problemStatement", label: "Problem Statement", validator: hasProblemStatement },
      { name: "migrationPath", label: "Migration Path", validator: hasMigrationPath },
    ],
    requiredSections: [
      { heading: "## Problem", label: "Problem Statement" },
      { heading: "## Migration Path", label: "Migration Path" },
      { heading: "## Council Review", label: "Council Review" },
    ],
    riskThresholdOverride: 4, // Strictest
  },
};

/** Get the schema for a proposal type */
export const getSchemaForType = (type: ProposalType): GateSchema => {
  const schema = GATE_SCHEMAS[type];
  if (!schema) {
    throw new Error(`No gate schema defined for proposal type: ${type}`);
  }
  return schema;
};

// ── Validation ─────────────────────────────────────────────

/** Validate a proposal against its type-specific schema */
export const validateProposalSchema = (proposal: Proposal): SchemaValidationResult => {
  const schema = getSchemaForType(proposal.type);
  const failures: SchemaValidationResult["failures"] = [];

  // Check required fields
  for (const field of schema.requiredFields) {
    if (!field.validator(proposal)) {
      failures.push({
        field: field.name,
        expected: field.label,
        actual: "missing or empty",
      });
    }
  }

  // Check required sections
  for (const section of schema.requiredSections) {
    const pattern = new RegExp(section.heading.replace(/##\s*/, "##\\s*"), "i");
    if (!pattern.test(proposal.description ?? "")) {
      failures.push({
        section: section.label,
        expected: section.heading,
        actual: "not found in description",
      });
    }
  }

  const passed = failures.length === 0;

  return {
    passed,
    gateId: "type-specific-quality",
    name: "Type-Specific Quality",
    severity: passed ? "info" : "blocker",
    message: passed
      ? `✅ ${proposal.type} schema validation passed (${schema.requiredFields.length} fields, ${schema.requiredSections.length} sections)`
      : `❌ ${proposal.type} schema validation failed: ${failures.length} issue(s)`,
    failures,
    details: {
      schemaType: proposal.type,
      requiredFieldCount: schema.requiredFields.length,
      requiredSectionCount: schema.requiredSections.length,
      riskThresholdOverride: schema.riskThresholdOverride,
    },
  };
};

/** Format schema validation failures for display */
export const formatSchemaFailures = (result: SchemaValidationResult): string => {
  if (result.passed) return "";

  let out = `### Schema Validation Failures (${result.details?.schemaType})\n\n`;

  const fieldFailures = result.failures.filter((f) => f.field);
  const sectionFailures = result.failures.filter((f) => f.section);

  if (fieldFailures.length > 0) {
    out += `**Missing Fields:**\n`;
    for (const f of fieldFailures) {
      out += `- \`${f.field}\`: ${f.expected} — ${f.actual}\n`;
    }
    out += `\n`;
  }

  if (sectionFailures.length > 0) {
    out += `**Missing Sections:**\n`;
    for (const f of sectionFailures) {
      out += `- ${f.section}: expected "${f.expected}" — ${f.actual}\n`;
    }
    out += `\n`;
  }

  return out;
};
