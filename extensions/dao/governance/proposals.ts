// ============================================================
// pi-swarm-dao — Proposal Management (V2 Structured)
// ============================================================

import type {
  Proposal,
  ProposalStatus,
  ProposalType,
  ProposalContent,
  PipelineStage,
} from "../types.js";
import { PROPOSAL_TYPE_LABELS } from "../types.js";
import { STAGE_TO_STATUS } from "./lifecycle.js";
import { getState, setState } from "../persistence.js";

/**
 * Create a new structured proposal.
 * Supports both legacy (title+description) and V2 (full ProposalContent) modes.
 */
export const createProposal = (
  title: string,
  type: ProposalType,
  description: string,
  proposedBy: string = "user",
  context?: string,
  content?: Partial<ProposalContent>
): Proposal => {
  const state = getState();

  const fullContent: ProposalContent | undefined = content
    ? {
        title,
        type,
        problemStatement: content.problemStatement ?? description,
        targetUser: content.targetUser ?? "user",
        expectedOutcome: content.expectedOutcome ?? description.split(".")[0],
        successMetrics: content.successMetrics ?? [],
        scopeIn: content.scopeIn ?? [description.split("\n")[0]],
        scopeOut: content.scopeOut ?? [],
        permissionsImpact: content.permissionsImpact ?? [],
        dataImpact: content.dataImpact ?? [],
        technicalOptions: content.technicalOptions ?? [],
        risks: content.risks ?? [],
        dependencies: content.dependencies ?? [],
        estimatedEffort: content.estimatedEffort ?? "TBD",
        confidenceScore: content.confidenceScore ?? 5,
        recommendedDecision: content.recommendedDecision ?? "pending",
      }
    : undefined;

  const proposal: Proposal = {
    id: state.nextProposalId++,
    title,
    type,
    description,
    context,
    content: fullContent,
    stage: "intake",
    proposedBy,
    status: "open",
    votes: [],
    agentOutputs: [],
    createdAt: new Date().toISOString(),
  };

  state.proposals.push(proposal);
  setState(state);
  return proposal;
};

/**
 * Get a proposal by ID.
 */
export const getProposal = (id: number): Proposal | undefined =>
  getState().proposals.find((p) => p.id === id);

/**
 * List all proposals, optionally filtered by status.
 */
export const listProposals = (status?: ProposalStatus): Proposal[] => {
  const proposals = getState().proposals;
  if (status) return proposals.filter((p) => p.status === status);
  return proposals;
};

/**
 * Update a proposal's status.
 */
export const updateProposalStatus = (
  id: number,
  status: ProposalStatus
): Proposal => {
  const state = getState();
  const proposal = state.proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`Proposal #${id} not found`);

  proposal.status = status;

  if (["approved", "rejected", "executed", "failed"].includes(status)) {
    proposal.resolvedAt = new Date().toISOString();
  }

  setState(state);
  return proposal;
};

/**
 * Update a proposal's pipeline stage.
 * Also updates the legacy status to match.
 */
export const updatePipelineStage = (
  id: number,
  stage: PipelineStage
): Proposal => {
  const state = getState();
  const proposal = state.proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`Proposal #${id} not found`);

  proposal.stage = stage;
  proposal.status = STAGE_TO_STATUS[stage];

  if (stage === "postmortem") {
    proposal.resolvedAt = new Date().toISOString();
  }

  setState(state);
  return proposal;
};

/**
 * Store agent outputs and synthesis on a proposal.
 */
export const storeDeliberationResults = (
  id: number,
  agentOutputs: import("../types.js").AgentOutput[],
  synthesis: string,
  votes: import("../types.js").Vote[]
): Proposal => {
  const state = getState();
  const proposal = state.proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`Proposal #${id} not found`);

  proposal.agentOutputs = agentOutputs;
  proposal.synthesis = synthesis;
  proposal.votes = votes;
  setState(state);
  return proposal;
};

/**
 * Store execution result on a proposal.
 */
export const storeExecutionResult = (id: number, result: string): Proposal => {
  const state = getState();
  const proposal = state.proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`Proposal #${id} not found`);

  proposal.executionResult = result;
  proposal.status = "executed";
  proposal.stage = "postmortem";
  proposal.resolvedAt = new Date().toISOString();
  setState(state);
  return proposal;
};

/**
 * Store composite score on a proposal.
 */
export const storeCompositeScore = (
  id: number,
  score: import("../types.js").CompositeScore
): Proposal => {
  const state = getState();
  const proposal = state.proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`Proposal #${id} not found`);

  proposal.compositeScore = score;
  proposal.riskZone = score.riskZone;
  setState(state);
  return proposal;
};

/**
 * Format a proposal as a readable summary.
 */
export const formatProposal = (proposal: Proposal): string => {
  const typeLabel = PROPOSAL_TYPE_LABELS[proposal.type];
  const lines = [
    `## Proposal #${proposal.id}: ${proposal.title}`,
    `**Type:** ${typeLabel} | **Status:** ${proposal.status} | **Stage:** ${proposal.stage} | **By:** ${proposal.proposedBy} | **Created:** ${proposal.createdAt}`,
  ];

  // Risk zone badge
  if (proposal.riskZone) {
    const zoneLabel = proposal.riskZone === "red" ? "🔴 Red" : proposal.riskZone === "orange" ? "🟠 Orange" : "🟢 Green";
    lines.push(`**Risk Zone:** ${zoneLabel}`);
  }

  // Composite score badge
  if (proposal.compositeScore) {
    lines.push(`**Score:** ${proposal.compositeScore.weighted}/100`);
  }

  lines.push("");

  // Structured content
  if (proposal.content) {
    const c = proposal.content;
    lines.push("### Problem Statement");
    lines.push(c.problemStatement);
    lines.push("");
    lines.push(`**Target User:** ${c.targetUser}`);
    lines.push(`**Expected Outcome:** ${c.expectedOutcome}`);
    lines.push(`**Estimated Effort:** ${c.estimatedEffort}`);
    lines.push(`**Confidence:** ${c.confidenceScore}/10`);

    if (c.scopeIn.length > 0) {
      lines.push("");
      lines.push("**In Scope:**");
      for (const s of c.scopeIn) lines.push(`- ${s}`);
    }

    if (c.scopeOut.length > 0) {
      lines.push("");
      lines.push("**Out of Scope:**");
      for (const s of c.scopeOut) lines.push(`- ${s}`);
    }

    if (c.permissionsImpact.length > 0) {
      lines.push("");
      lines.push("**Permissions Impact:**");
      for (const p of c.permissionsImpact) lines.push(`- ${p}`);
    }

    if (c.dataImpact.length > 0) {
      lines.push("");
      lines.push("**Data Impact:**");
      for (const d of c.dataImpact) lines.push(`- ${d}`);
    }
  } else {
    lines.push(proposal.description);
  }

  if (proposal.context) {
    lines.push("", `**Context:** ${proposal.context}`);
  }

  if (proposal.votes.length > 0) {
    lines.push("", "### Votes");
    lines.push("| Agent | Position | Weight | Reasoning |");
    lines.push("|-------|----------|--------|-----------|");
    for (const v of proposal.votes) {
      const emoji = v.position === "for" ? "✅" : v.position === "against" ? "❌" : "⏸️";
      lines.push(`| ${v.agentName} | ${emoji} ${v.position} | ${v.weight} | ${v.reasoning} |`);
    }
  }

  return lines.join("\n");
};

/**
 * Format proposals list for display.
 */
export const formatProposalsList = (proposals: Proposal[]): string => {
  if (proposals.length === 0) return "No proposals found.";

  const header =
    "| # | Title | Type | Status | Zone | Score | Stage | Proposed By | Created |\n|---|-------|------|--------|------|-------|-------|-------------|---------|";
  const rows = proposals
    .map((p) => {
      const zone = p.riskZone
        ? p.riskZone === "red" ? "🔴" : p.riskZone === "orange" ? "🟠" : "🟢"
        : "⚪";
      const score = p.compositeScore ? `${p.compositeScore.weighted}` : "—";
      return `| ${p.id} | ${p.title} | ${PROPOSAL_TYPE_LABELS[p.type]} | ${p.status} | ${zone} | ${score} | ${p.stage} | ${p.proposedBy} | ${p.createdAt.split("T")[0]} |`;
    })
    .join("\n");
  return `${header}\n${rows}`;
};
