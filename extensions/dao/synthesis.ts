import type { AgentOutput, Vote } from "./types.js";

/**
 * Remove the ## Vote section from agent output
 * (already captured separately in the tally).
 */
const removeVoteSection = (content: string): string =>
  content
    .replace(/##\s*Vote\s*\n[\s\S]*?(?=\n##\s|$)/i, "")
    .trim();

/**
 * Synthesize agent outputs into a unified deliberation document.
 * This is a deterministic aggregation — no LLM call needed.
 * The main Pi LLM will see this synthesis and can provide further analysis.
 */
export const synthesize = (
  agentOutputs: AgentOutput[],
  votes: Vote[]
): string => {
  const lines: string[] = [];

  lines.push("# Deliberation Synthesis");
  lines.push("");

  // === Vote Overview ===
  lines.push("## Vote Overview");
  const forVotes = votes.filter((v) => v.position === "for");
  const againstVotes = votes.filter((v) => v.position === "against");
  const abstainVotes = votes.filter((v) => v.position === "abstain");

  lines.push(
    `- **For:** ${forVotes.length} agents (weighted: ${forVotes.reduce((s, v) => s + v.weight, 0)})`
  );
  lines.push(
    `- **Against:** ${againstVotes.length} agents (weighted: ${againstVotes.reduce((s, v) => s + v.weight, 0)})`
  );
  lines.push(
    `- **Abstain:** ${abstainVotes.length} agents`
  );
  lines.push("");

  // === Consensus Points ===
  lines.push("## Consensus Points");
  if (forVotes.length === votes.length) {
    lines.push("All agents voted **for** this proposal — full consensus.");
  } else if (againstVotes.length === votes.length) {
    lines.push("All agents voted **against** this proposal — full consensus against.");
  } else {
    lines.push("Agents expressed mixed views. See individual analyses below.");
  }
  lines.push("");

  // === Points of Divergence ===
  if (againstVotes.length > 0 && forVotes.length > 0) {
    lines.push("## Points of Divergence");
    lines.push("**Agents voting FOR:**");
    for (const v of forVotes) {
      lines.push(`- **${v.agentName}** (weight ${v.weight}): ${v.reasoning}`);
    }
    lines.push("");
    lines.push("**Agents voting AGAINST:**");
    for (const v of againstVotes) {
      lines.push(`- **${v.agentName}** (weight ${v.weight}): ${v.reasoning}`);
    }
    lines.push("");
  }

  // === Individual Agent Analyses ===
  lines.push("## Agent Analyses");
  lines.push("");

  for (const output of agentOutputs) {
    if (output.error) {
      lines.push(`### ⚠️ ${output.agentName} (${output.role}) — ERROR`);
      lines.push(`Agent failed: ${output.error}`);
    } else {
      lines.push(`### ${output.agentName} (${output.role})`);
      // Include the agent's full output, excluding the vote section
      // (already summarized above)
      const contentWithoutVote = removeVoteSection(output.content);
      lines.push(contentWithoutVote);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
};
