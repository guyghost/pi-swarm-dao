import type { Vote, VotePosition, TallyResult } from "./types.js";
import { getState } from "./persistence.js";

/**
 * Parse a vote from an agent's markdown output.
 * Looks for the ## Vote section with Position and Reasoning.
 *
 * Expected format:
 * ## Vote
 * **Position:** for | against | abstain
 * **Reasoning:** Some justification text
 */
export const parseVoteFromOutput = (
  agentId: string,
  agentName: string,
  weight: number,
  output: string
): Vote => {
  // Try to find the ## Vote section
  const voteSection = output.match(
    /##\s*Vote\s*\n([\s\S]*?)(?=\n##\s|\n---|\s*$)/i
  );

  if (!voteSection) {
    // Default to abstain if no vote section found
    return {
      agentId,
      agentName,
      position: "abstain",
      reasoning: "No vote section found in agent output",
      weight,
    };
  }

  const section = voteSection[1];

  // Parse position
  const positionMatch = section.match(
    /\*?\*?Position:?\*?\*?\s*(for|against|abstain)/i
  );
  const position: VotePosition = positionMatch
    ? (positionMatch[1].toLowerCase() as VotePosition)
    : "abstain";

  // Parse reasoning
  const reasoningMatch = section.match(
    /\*?\*?Reasoning:?\*?\*?\s*(.+?)(?:\n|$)/i
  );
  const reasoning = reasoningMatch
    ? reasoningMatch[1].trim()
    : "No reasoning provided";

  return {
    agentId,
    agentName,
    position,
    reasoning,
    weight,
  };
};

/**
 * Tally votes for a proposal using weighted voting.
 *
 * Rules:
 * - Quorum: >= config.quorumPercent of agents must vote (non-abstain)
 * - Approval: weighted "for" / total voting weight >= config.approvalThreshold
 * - Abstentions do not count toward quorum or approval calculation
 */
export const tallyVotes = (
  proposalId: number,
  votes: Vote[]
): TallyResult => {
  const config = getState().config;
  const totalAgents = votes.length;

  // Separate abstentions from actual votes
  const votingVotes = votes.filter((v) => v.position !== "abstain");
  const votingAgents = votingVotes.length;

  // Calculate quorum
  const quorumPercent =
    totalAgents > 0 ? (votingAgents / totalAgents) * 100 : 0;
  const quorumMet = quorumPercent >= config.quorumPercent;

  // Calculate weighted scores
  const weightedFor = votingVotes
    .filter((v) => v.position === "for")
    .reduce((sum, v) => sum + v.weight, 0);

  const weightedAgainst = votingVotes
    .filter((v) => v.position === "against")
    .reduce((sum, v) => sum + v.weight, 0);

  const totalVotingWeight = votingVotes.reduce(
    (sum, v) => sum + v.weight,
    0
  );

  // Calculate approval score
  const approvalScore =
    totalVotingWeight > 0 ? weightedFor / totalVotingWeight : 0;

  // Determine if approved: quorum must be met AND approval threshold reached
  const approved =
    quorumMet && approvalScore * 100 >= config.approvalThreshold;

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
export const formatTallyResult = (tally: TallyResult): string => {
  const verdict = tally.approved ? "✅ APPROVED" : "❌ REJECTED";
  const quorumStatus = tally.quorumMet ? "✅ Met" : "❌ Not met";
  const config = getState().config;

  const lines = [
    `## Vote Results — Proposal #${tally.proposalId}`,
    "",
    `**Verdict: ${verdict}**`,
    "",
    "### Summary",
    `- Quorum: ${quorumStatus} (${tally.quorumPercent.toFixed(1)}% participation, ${config.quorumPercent}% required)`,
    `- Approval: ${(tally.approvalScore * 100).toFixed(1)}% weighted "for" (${config.approvalThreshold}% required)`,
    `- Weighted For: ${tally.weightedFor} / ${tally.totalVotingWeight}`,
    `- Weighted Against: ${tally.weightedAgainst} / ${tally.totalVotingWeight}`,
    `- Voting agents: ${tally.votingAgents} / ${tally.totalAgents}`,
    "",
    "### Individual Votes",
    "| Agent | Position | Weight | Reasoning |",
    "|-------|----------|--------|-----------|",
  ];

  for (const v of tally.votes) {
    const emoji =
      v.position === "for" ? "✅" : v.position === "against" ? "❌" : "⏸️";
    lines.push(
      `| ${v.agentName} | ${emoji} ${v.position} | ${v.weight} | ${v.reasoning} |`
    );
  }

  return lines.join("\n");
};
