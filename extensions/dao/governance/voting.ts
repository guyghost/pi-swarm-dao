// ============================================================
// pi-swarm-dao — Voting & Tally (V2 — Per-Type Quorum)
// ============================================================

import type { Vote, VotePosition, TallyResult, ProposalType } from "../types.js";
import { TYPE_QUORUM } from "../types.js";
import { getState } from "../persistence.js";

/**
 * Parse a vote from an agent's markdown output.
 */
export const parseVoteFromOutput = (
  agentId: string,
  agentName: string,
  weight: number,
  output: string
): Vote => {
  const voteSection = output.match(
    /#{2,}\s*\*{0,2}Vote\*{0,2}\s*\r?\n([\s\S]*?)(?=\n#{2,}\s|\n---|\s*$)/i
  );

  if (!voteSection) {
    // Fallback: try to find Position/Reasoning pattern without heading
    const fallback = output.match(
      /\*?\*?Position:?\*?\*?\s*(for|against|abstain)[\s\S]*?\*?\*?Reasoning:?\*?\*?\s*(.+?)(?:\n|$)/i
    );
    if (fallback) {
      return {
        agentId,
        agentName,
        position: fallback[1].toLowerCase() as VotePosition,
        reasoning: fallback[2].trim(),
        weight,
      };
    }

    return {
      agentId,
      agentName,
      position: "abstain",
      reasoning: "No vote section found in agent output",
      weight,
    };
  }

  const section = voteSection[1];
  const positionMatch = section.match(/\*?\*?Position:?\*?\*?\s*(for|against|abstain)/i);
  const position: VotePosition = positionMatch
    ? (positionMatch[1].toLowerCase() as VotePosition)
    : "abstain";

  const reasoningMatch = section.match(/\*?\*?Reasoning:?\*?\*?\s*(.+?)(?:\n|$)/i);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : "No reasoning provided";

  return { agentId, agentName, position, reasoning, weight };
};

/**
 * Get the quorum settings for a specific proposal type.
 * Falls back to global config if no per-type override.
 */
const getTypeQuorum = (
  type: ProposalType
): { quorumPercent: number; approvalPercent: number } => {
  const config = getState().config;
  const typeConfig = config.typeQuorum[type];
  return {
    quorumPercent: typeConfig?.quorumPercent ?? config.quorumPercent,
    approvalPercent: typeConfig?.approvalPercent ?? config.approvalThreshold,
  };
};

/**
 * Tally votes for a proposal using weighted voting with per-type quorum.
 */
export const tallyVotes = (
  proposalId: number,
  votes: Vote[],
  proposalType?: ProposalType
): TallyResult => {
  const config = getState().config;
  const totalAgents = votes.length;

  // Get per-type quorum
  const typeQuorum = proposalType
    ? getTypeQuorum(proposalType)
    : { quorumPercent: config.quorumPercent, approvalPercent: config.approvalThreshold };

  const votingVotes = votes.filter((v) => v.position !== "abstain");
  const votingAgents = votingVotes.length;

  const quorumPercent =
    totalAgents > 0 ? (votingAgents / totalAgents) * 100 : 0;
  const quorumMet = quorumPercent >= typeQuorum.quorumPercent;

  const weightedFor = votingVotes
    .filter((v) => v.position === "for")
    .reduce((sum, v) => sum + v.weight, 0);

  const weightedAgainst = votingVotes
    .filter((v) => v.position === "against")
    .reduce((sum, v) => sum + v.weight, 0);

  const totalVotingWeight = votingVotes.reduce((sum, v) => sum + v.weight, 0);
  const approvalScore = totalVotingWeight > 0 ? weightedFor / totalVotingWeight : 0;

  const approved = quorumMet && approvalScore * 100 >= typeQuorum.approvalPercent;

  return {
    proposalId,
    approved,
    quorumMet,
    totalAgents,
    votingAgents,
    quorumPercent,
    weightedFor,
    weightedAgainst,
    totalVotingWeight,
    approvalScore,
    votes,
  };
};

/**
 * Format tally results as a readable summary.
 */
export const formatTallyResult = (
  tally: TallyResult,
  proposalType?: ProposalType
): string => {
  const verdict = tally.approved ? "✅ APPROVED" : "❌ REJECTED";
  const quorumStatus = tally.quorumMet ? "✅ Met" : "❌ Not met";
  const typeQuorum = proposalType
    ? getTypeQuorum(proposalType)
    : { quorumPercent: getState().config.quorumPercent, approvalPercent: getState().config.approvalThreshold };

  const lines = [
    `## Vote Results — Proposal #${tally.proposalId}`,
    "",
    `**Verdict: ${verdict}**`,
    "",
    "### Summary",
    `- Quorum: ${quorumStatus} (${tally.quorumPercent.toFixed(1)}% participation, ${typeQuorum.quorumPercent}% required)`,
    `- Approval: ${(tally.approvalScore * 100).toFixed(1)}% weighted "for" (${typeQuorum.approvalPercent}% required)`,
    `- Weighted For: ${tally.weightedFor} / ${tally.totalVotingWeight}`,
    `- Weighted Against: ${tally.weightedAgainst} / ${tally.totalVotingWeight}`,
    `- Voting agents: ${tally.votingAgents} / ${tally.totalAgents}`,
    proposalType ? `- Type-specific quorum: ${TYPE_QUORUM[proposalType]?.description ?? "default"}` : "",
    "",
    "### Individual Votes",
    "| Agent | Position | Weight | Reasoning |",
    "|-------|----------|--------|-----------|",
  ];

  for (const v of tally.votes) {
    const emoji = v.position === "for" ? "✅" : v.position === "against" ? "❌" : "⏸️";
    lines.push(`| ${v.agentName} | ${emoji} ${v.position} | ${v.weight} | ${v.reasoning} |`);
  }

  return lines.join("\n");
};
