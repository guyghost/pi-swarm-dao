import type { Proposal } from "../types.js";

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
} as const;

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const nonEmptyStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.some(nonEmptyString);

const hasAcceptanceCriteria = (proposal: Proposal): boolean =>
  Array.isArray(proposal.acceptanceCriteria) && proposal.acceptanceCriteria.length > 0;

export const validateProposalQuality = (
  proposal: Proposal,
): ProposalQualityValidationResult => {
  if (proposal.type === "governance-change") {
    return {
      valid: true,
      missingFields: [],
      template: "",
    };
  }

  const problemStatement = proposal.content?.problemStatement ?? proposal.problemStatement;
  const successMetrics = proposal.content?.successMetrics ?? proposal.successMetrics;
  const rollbackConditions = proposal.rollbackConditions;

  const missingFields: string[] = [];

  if (!nonEmptyString(problemStatement)) missingFields.push("problemStatement");
  if (!hasAcceptanceCriteria(proposal)) missingFields.push("acceptanceCriteria");
  if (!nonEmptyStringArray(successMetrics)) missingFields.push("successMetrics");
  if (!nonEmptyStringArray(rollbackConditions)) missingFields.push("rollbackConditions");

  return {
    valid: missingFields.length === 0,
    missingFields,
    template: missingFields.length === 0 ? "" : formatProposalQualityTemplate(missingFields),
  };
};

export const formatProposalQualityTemplate = (missingFields: string[]): string => {
  const fieldList = missingFields.map((field) => `- \`${field}\``).join("\n");
  const examples = missingFields
    .map((field) => `- \`${field}\`: ${EXAMPLES[field as keyof typeof EXAMPLES]}`)
    .join("\n");

  const jsonTemplate = JSON.stringify(
    {
      problemStatement: PLACEHOLDERS.problemStatement,
      acceptanceCriteria: PLACEHOLDERS.acceptanceCriteria,
      successMetrics: PLACEHOLDERS.successMetrics,
      rollbackConditions: PLACEHOLDERS.rollbackConditions,
    },
    null,
    2,
  );

  return (
    `## Missing Required Fields\n${fieldList}\n\n` +
    `## Examples\n${examples}\n\n` +
    `## Copy/Paste Template\n\n` +
    "```json\n" +
    `${jsonTemplate}\n` +
    "```"
  );
};
