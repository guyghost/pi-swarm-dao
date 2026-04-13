import type { Proposal, ProposalStatus } from "../types.js";
import { getState, setState } from "../persistence.js";

/**
 * Create a new proposal.
 */
export const createProposal = (
  title: string,
  description: string,
  proposedBy: string = "user",
  context?: string
): Proposal => {
  const state = getState();

  const proposal: Proposal = {
    id: state.nextProposalId++,
    title,
    description,
    context,
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
export const getProposal = (id: number): Proposal | undefined => {
  return getState().proposals.find((p) => p.id === id);
};

/**
 * List all proposals, optionally filtered by status.
 */
export const listProposals = (status?: ProposalStatus): Proposal[] => {
  const proposals = getState().proposals;
  if (status) {
    return proposals.filter((p) => p.status === status);
  }
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
  if (!proposal) {
    throw new Error(`Proposal #${id} not found`);
  }

  proposal.status = status;

  if (
    status === "approved" ||
    status === "rejected" ||
    status === "executed" ||
    status === "failed"
  ) {
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
  if (!proposal) {
    throw new Error(`Proposal #${id} not found`);
  }

  proposal.agentOutputs = agentOutputs;
  proposal.synthesis = synthesis;
  proposal.votes = votes;
  setState(state);
  return proposal;
};

/**
 * Store execution result on a proposal.
 */
export const storeExecutionResult = (
  id: number,
  result: string
): Proposal => {
  const state = getState();
  const proposal = state.proposals.find((p) => p.id === id);
  if (!proposal) {
    throw new Error(`Proposal #${id} not found`);
  }

  proposal.executionResult = result;
  proposal.status = "executed";
  proposal.resolvedAt = new Date().toISOString();
  setState(state);
  return proposal;
};

/**
 * Format a proposal as a readable summary.
 */
export const formatProposal = (proposal: Proposal): string => {
  const lines = [
    `## Proposal #${proposal.id}: ${proposal.title}`,
    `**Status:** ${proposal.status} | **Proposed by:** ${proposal.proposedBy} | **Created:** ${proposal.createdAt}`,
    "",
    proposal.description,
  ];

  if (proposal.context) {
    lines.push("", `**Context:** ${proposal.context}`);
  }

  if (proposal.votes.length > 0) {
    lines.push("", "### Votes");
    lines.push("| Agent | Position | Weight | Reasoning |");
    lines.push("|-------|----------|--------|-----------|");
    for (const v of proposal.votes) {
      const emoji =
        v.position === "for" ? "✅" : v.position === "against" ? "❌" : "⏸️";
      lines.push(
        `| ${v.agentName} | ${emoji} ${v.position} | ${v.weight} | ${v.reasoning} |`
      );
    }
  }

  return lines.join("\n");
};

/**
 * Format proposals list for display.
 */
export const formatProposalsList = (proposals: Proposal[]): string => {
  if (proposals.length === 0) {
    return "No proposals found.";
  }

  const header =
    "| # | Title | Status | Proposed By | Created |\n|---|-------|--------|-------------|---------|";
  const rows = proposals
    .map(
      (p) =>
        `| ${p.id} | ${p.title} | ${p.status} | ${p.proposedBy} | ${p.createdAt.split("T")[0]} |`
    )
    .join("\n");
  return `${header}\n${rows}`;
};
