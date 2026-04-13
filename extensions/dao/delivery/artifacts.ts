import type { Proposal, AgentOutput, Vote } from "../types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Calculate weighted approval percentage from a proposal's votes. */
const approvalPercent = (votes: Vote[]): number => {
  const voting = votes.filter((v) => v.position !== "abstain");
  if (voting.length === 0) return 0;
  const totalWeight = voting.reduce((sum, v) => sum + v.weight, 0);
  if (totalWeight === 0) return 0;
  const forWeight = voting
    .filter((v) => v.position === "for")
    .reduce((sum, v) => sum + v.weight, 0);
  return Math.round((forWeight / totalWeight) * 100);
};

/** Extract the first N sentences from text. */
const firstSentences = (text: string, n: number): string => {
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (!sentences) return text.slice(0, 300);
  return sentences.slice(0, n).join("").trim();
};

/** Find an agent output by role (case-insensitive substring match). */
const findOutputByRole = (outputs: AgentOutput[], role: string): AgentOutput | undefined =>
  outputs.find((o) => o.role.toLowerCase().includes(role.toLowerCase()));

/** Extract bullet points from markdown content. */
const extractBullets = (content: string, limit: number): string[] => {
  const bullets: string[] = [];
  for (const line of content.split("\n")) {
    if (/^\s*[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^\s*[-*]\s+/, "").trim());
      if (bullets.length >= limit) break;
    }
  }
  return bullets;
};

/** Extract risk-related content from a critic agent output. */
const extractRisks = (criticOutput: string): string[] => {
  // Look for sections about risks, concerns, issues
  const riskSection = criticOutput.match(
    /#{2,3}\s+(?:Risk|Concern|Issue|Warning)s?\s*\n([\s\S]*?)(?=\n#{2,3}\s|$)/i
  );

  if (riskSection) {
    const bullets = extractBullets(riskSection[1], 5);
    if (bullets.length > 0) return bullets;
  }

  // Fallback: extract any bullet points that mention risk/concern keywords
  const riskBullets: string[] = [];
  for (const line of criticOutput.split("\n")) {
    if (/^\s*[-*]\s+/.test(line) && /risk|concern|issue|danger|caution/i.test(line)) {
      riskBullets.push(line.replace(/^\s*[-*]\s+/, "").trim());
      if (riskBullets.length >= 5) break;
    }
  }

  return riskBullets.length > 0 ? riskBullets : ["No specific risks identified during deliberation."];
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate release notes markdown from a proposal and its deliberation results.
 */
export const generateReleaseNotes = (proposal: Proposal): string => {
  const lines: string[] = [];
  const pct = approvalPercent(proposal.votes);

  // --- Title ---
  lines.push(`# Release Notes: ${proposal.title}`);
  lines.push("");

  // --- Summary ---
  lines.push("## Summary");
  const summary = proposal.synthesis
    ? firstSentences(proposal.synthesis, 3)
    : proposal.description;
  lines.push(summary);
  lines.push("");

  // --- What's New ---
  lines.push("## What's New");
  const specWriter = findOutputByRole(proposal.agentOutputs, "spec-writer");
  const architect = findOutputByRole(proposal.agentOutputs, "architect");

  const deliverables: string[] = [];
  if (specWriter && !specWriter.error) {
    deliverables.push(...extractBullets(specWriter.content, 6));
  }
  if (deliverables.length === 0 && architect && !architect.error) {
    deliverables.push(...extractBullets(architect.content, 6));
  }
  if (deliverables.length === 0) {
    // Fallback: bullet the proposal description
    const descLines = proposal.description.split("\n").filter((l) => l.trim());
    for (const line of descLines.slice(0, 5)) {
      deliverables.push(line.replace(/^[-*]\s*/, "").trim());
    }
  }

  for (const item of deliverables) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  // --- Known Risks ---
  lines.push("## Known Risks");
  const critic = findOutputByRole(proposal.agentOutputs, "critic");
  const risks = critic && !critic.error
    ? extractRisks(critic.content)
    : ["No critic review available."];
  for (const risk of risks) {
    lines.push(`- ${risk}`);
  }
  lines.push("");

  // --- Approval ---
  const date = proposal.resolvedAt ?? proposal.createdAt;
  lines.push("## Approval");
  lines.push(`- Approved by DAO on ${date} with ${pct}% weighted approval`);

  return lines.join("\n");
};

/**
 * Generate a changelog entry (single line or short block) from a proposal.
 */
export const generateChangelog = (proposal: Proposal): string => {
  const pct = approvalPercent(proposal.votes);
  const date = new Date(proposal.resolvedAt ?? proposal.createdAt)
    .toISOString()
    .slice(0, 10);

  const summary = proposal.synthesis
    ? firstSentences(proposal.synthesis, 1)
    : proposal.description.split("\n")[0] ?? "No description";

  return `- [${date}] **${proposal.title}** — ${summary} (DAO approval: ${pct}%)`;
};
