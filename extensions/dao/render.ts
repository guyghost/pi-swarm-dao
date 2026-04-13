import type {
  DAOState,
  Proposal,
  TallyResult,
  AgentOutput,
} from "./types.js";

/**
 * Render the full DAO dashboard.
 */
export const renderDashboard = (state: DAOState): string => {
  const lines: string[] = [];

  lines.push("# 🏛️ DAO Swarm Dashboard");
  lines.push("");

  // === Config ===
  lines.push("## ⚙️ Configuration");
  lines.push(`- Quorum: ${state.config.quorumPercent}%`);
  lines.push(`- Approval threshold: ${state.config.approvalThreshold}%`);
  lines.push(`- Default model: ${state.config.defaultModel}`);
  lines.push(`- Max concurrent agents: ${state.config.maxConcurrent}`);
  lines.push("");

  // === Agents ===
  lines.push("## 👥 Agents");
  if (state.agents.length === 0) {
    lines.push("No agents configured. Run `dao_setup` to initialize.");
  } else {
    const totalWeight = state.agents.reduce((s, a) => s + a.weight, 0);
    lines.push(
      "| # | Agent | Role | Weight | Influence | Model |"
    );
    lines.push(
      "|---|-------|------|--------|-----------|-------|"
    );
    state.agents.forEach((a, i) => {
      const influence = ((a.weight / totalWeight) * 100).toFixed(1);
      lines.push(
        `| ${i + 1} | ${a.name} | ${a.role} | ${a.weight} | ${influence}% | ${a.model ?? "default"} |`
      );
    });
    lines.push(`\n**Total weight:** ${totalWeight}`);
  }
  lines.push("");

  // === Proposals ===
  lines.push("## 📋 Proposals");
  if (state.proposals.length === 0) {
    lines.push("No proposals yet.");
  } else {
    const open = state.proposals.filter((p) => p.status === "open" || p.status === "deliberating");
    const resolved = state.proposals.filter(
      (p) => p.status !== "open" && p.status !== "deliberating"
    );

    if (open.length > 0) {
      lines.push("### Active");
      lines.push("| # | Title | Status | Proposed By |");
      lines.push("|---|-------|--------|-------------|");
      for (const p of open) {
        const statusEmoji = p.status === "deliberating" ? "🗳️" : "📝";
        lines.push(
          `| ${p.id} | ${p.title} | ${statusEmoji} ${p.status} | ${p.proposedBy} |`
        );
      }
      lines.push("");
    }

    if (resolved.length > 0) {
      lines.push("### Resolved");
      lines.push("| # | Title | Status | Resolved |");
      lines.push("|---|-------|--------|----------|");
      for (const p of resolved) {
        const statusEmoji =
          p.status === "approved"
            ? "✅"
            : p.status === "rejected"
              ? "❌"
              : p.status === "executed"
                ? "🚀"
                : "⚠️";
        lines.push(
          `| ${p.id} | ${p.title} | ${statusEmoji} ${p.status} | ${p.resolvedAt?.split("T")[0] ?? "—"} |`
        );
      }
    }
  }

  return lines.join("\n");
};

/**
 * Render deliberation progress (called during swarm dispatch).
 */
export const renderDeliberationProgress = (
  completed: number,
  total: number,
  lastAgent: string
): string => {
  const bar = "█".repeat(completed) + "░".repeat(total - completed);
  return `Deliberating [${bar}] ${completed}/${total} — ${lastAgent} done`;
};

/**
 * Render a compact vote result bar.
 */
export const renderVoteBar = (tally: TallyResult): string => {
  const total = tally.totalVotingWeight;
  if (total === 0) return "[no votes cast]";

  const forPct = Math.round((tally.weightedFor / total) * 20);
  const againstPct = Math.round((tally.weightedAgainst / total) * 20);
  const remaining = 20 - forPct - againstPct;

  const bar =
    "🟢".repeat(forPct) +
    "🔴".repeat(againstPct) +
    "⚪".repeat(Math.max(0, remaining));

  return `${bar} ${(tally.approvalScore * 100).toFixed(1)}% for`;
};

/**
 * Render the history of all proposals.
 */
export const renderHistory = (proposals: Proposal[]): string => {
  if (proposals.length === 0) {
    return "# 📜 DAO History\n\nNo proposals have been submitted yet.";
  }

  const lines: string[] = [];
  lines.push("# 📜 DAO History");
  lines.push("");

  // Sort by ID descending (newest first)
  const sorted = [...proposals].sort((a, b) => b.id - a.id);

  for (const p of sorted) {
    const statusEmoji =
      p.status === "approved"
        ? "✅"
        : p.status === "rejected"
          ? "❌"
          : p.status === "executed"
            ? "🚀"
            : p.status === "deliberating"
              ? "🗳️"
              : p.status === "open"
                ? "📝"
                : "⚠️";

    lines.push(`## ${statusEmoji} Proposal #${p.id}: ${p.title}`);
    lines.push(`**Status:** ${p.status} | **By:** ${p.proposedBy} | **Created:** ${p.createdAt.split("T")[0]}`);
    if (p.resolvedAt) {
      lines.push(`**Resolved:** ${p.resolvedAt.split("T")[0]}`);
    }
    lines.push("");
    lines.push(p.description);

    if (p.votes.length > 0) {
      lines.push("");
      lines.push("**Votes:**");
      for (const v of p.votes) {
        const vEmoji =
          v.position === "for" ? "✅" : v.position === "against" ? "❌" : "⏸️";
        lines.push(`- ${vEmoji} **${v.agentName}** (${v.weight}): ${v.reasoning}`);
      }
    }

    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
};

/**
 * Render agent output summary for deliberation results.
 */
export const renderAgentOutputSummary = (outputs: AgentOutput[]): string => {
  const lines: string[] = [];
  lines.push("### Agent Performance");
  lines.push("| Agent | Role | Duration | Status |");
  lines.push("|-------|------|----------|--------|");

  for (const o of outputs) {
    const duration = (o.durationMs / 1000).toFixed(1);
    const status = o.error ? `⚠️ Error: ${o.error.slice(0, 50)}` : "✅ OK";
    lines.push(`| ${o.agentName} | ${o.role} | ${duration}s | ${status} |`);
  }

  const totalDuration = Math.max(...outputs.map((o) => o.durationMs));
  lines.push(`\n**Total wall time:** ${(totalDuration / 1000).toFixed(1)}s (parallel execution)`);

  return lines.join("\n");
};
