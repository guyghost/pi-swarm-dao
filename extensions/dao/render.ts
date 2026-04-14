import type {
  DAOState,
  Proposal,
  TallyResult,
  AgentOutput,
  ControlCheckResult,
  DeliveryPlan,
  ChecklistItem,
  AgentRiskLevel,
  AmendmentPayload,
  AmendmentState,
} from "./types.js";
import { PROPOSAL_TYPE_LABELS } from "./types.js";

/** Emoji for each proposal type — derived from PROPOSAL_TYPE_LABELS */
const typeEmoji = (type: Proposal["type"]): string => {
  const label = PROPOSAL_TYPE_LABELS[type];
  return label ? label.split(" ")[0] : "📋";
};

/** Risk emoji for dashboard table */
const riskEmoji = (level?: string): string => {
  switch (level) {
    case "critical": return "🔴";
    case "high": return "🟠";
    case "medium": return "🟡";
    case "low": return "🟢";
    default: return "⚪";
  }
};

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
      "| # | Agent | Role | Weight | Risk | Influence | Model |"
    );
    lines.push(
      "|---|-------|------|--------|------|-----------|-------|"
    );
    state.agents.forEach((a, i) => {
      const influence = ((a.weight / totalWeight) * 100).toFixed(1);
      lines.push(
        `| ${i + 1} | ${a.name} | ${a.role} | ${a.weight} | ${riskEmoji(a.riskLevel)} ${a.riskLevel ?? "unknown"} | ${influence}% | ${a.model ?? "default"} |`
      );
    });
    lines.push(`\n**Total weight:** ${totalWeight}`);
  }
  lines.push("");

  // === Architecture ===
  lines.push("## 🏗️ Architecture");
  lines.push("| Layer | Mission | Status |");
  lines.push("|-------|---------|--------|");
  lines.push("| 🗳️ Governance | Decide what enters the roadmap | Active |");
  lines.push(`| 🧠 Intelligence | Produce analysis and recommendations | ${state.agents.length} agents |`);
  lines.push(`| 🛡️ Control | Reduce risk before publication | ${state.config.requiredGates.length} gates configured |`);
  lines.push("| 🚀 Delivery | Convert decisions into execution | Ready |");
  lines.push("");

  // === Artefacts Status ===
  const artefactProposalIds = Object.keys(state.artefacts).map(Number);
  if (artefactProposalIds.length > 0) {
    lines.push("## 📚 Artefacts");
    lines.push("| Proposal | Type | Risk | Stories | Phases | Tests | Version |");
    lines.push("|----------|------|------|---------|--------|-------|--------|");
    for (const id of artefactProposalIds) {
      const a = state.artefacts[id];
      const p = state.proposals.find((p) => p.id === id);
      lines.push(
        `| #${id} ${p?.title ?? "?"} | ${typeEmoji(p?.type ?? "product-feature")} ${p?.type ?? "?"} | ${a.riskReport.overallRiskScore}/10 | ${a.prdLite.userStories.length} | ${a.implementationPlan.phases.length} | ${a.testPlan.unitTests.length}U/${a.testPlan.e2eTests.length}E | v${a.releasePacket.version} |`
      );
    }
    lines.push("");
  }

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
      lines.push("| # | Title | Type | Status | Zone | Score | Stage | Proposed By |");
      lines.push("|---|-------|------|--------|------|-------|-------|-------------|");
      for (const p of open) {
        const statusEmoji =
          p.status === "deliberating"
            ? "🗳️"
            : p.status === "controlled"
              ? "🔒"
              : "📝";
        const typeBadge = `${typeEmoji(p.type)} ${p.type}`;
        const zone = p.riskZone
          ? p.riskZone === "red" ? "🔴" : p.riskZone === "orange" ? "🟠" : "🟢"
          : "⚪";
        const score = p.compositeScore ? `${p.compositeScore.weighted}` : "—";
        lines.push(
          `| ${p.id} | ${p.title} | ${typeBadge} | ${statusEmoji} ${p.status} | ${zone} | ${score} | ${p.stage} | ${p.proposedBy} |`
        );
      }
      lines.push("");
    }

    if (resolved.length > 0) {
      lines.push("### Resolved");
      lines.push("| # | Title | Type | Status | Zone | Score | Resolved |");
      lines.push("|---|-------|------|--------|------|-------|----------|");
      for (const p of resolved) {
        const statusEmoji =
          p.status === "approved"
            ? "✅"
            : p.status === "rejected"
              ? "❌"
              : p.status === "executed"
                ? "🚀"
                : p.status === "controlled"
                  ? "🔒"
                  : "⚠️";
        const typeBadge = `${typeEmoji(p.type)} ${p.type}`;
        const zone = p.riskZone
          ? p.riskZone === "red" ? "🔴" : p.riskZone === "orange" ? "🟠" : "🟢"
          : "⚪";
        const score = p.compositeScore ? `${p.compositeScore.weighted}` : "—";
        lines.push(
          `| ${p.id} | ${p.title} | ${typeBadge} | ${statusEmoji} ${p.status} | ${zone} | ${score} | ${p.resolvedAt?.split("T")[0] ?? "—"} |`
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
 * Render a control check result as markdown.
 */
export const renderControlResult = (result: ControlCheckResult): string => {
  const lines: string[] = [];

  lines.push(`## 🛡️ Control Check — Proposal #${result.proposalId}`);
  lines.push("");

  if (result.allGatesPassed) {
    lines.push("**Overall:** ✅ All gates passed");
  } else {
    lines.push(
      `**Overall:** ❌ ${result.blockerCount} blocker(s), ${result.warningCount} warning(s)`
    );
  }
  lines.push("");

  lines.push("### Gates");
  lines.push("| Gate | Status | Severity | Message |");
  lines.push("|------|--------|----------|---------|");

  for (const gate of result.gates) {
    const status = gate.passed ? "✅" : "❌";
    lines.push(
      `| ${gate.name} | ${status} | ${gate.severity} | ${gate.message} |`
    );
  }

  if (result.checklist.length > 0) {
    lines.push("");
    lines.push("### Checklist");
    for (const item of result.checklist) {
      const check = item.checked ? "✅" : "⬜";
      const auto = item.autoChecked ? " *(auto)*" : "";
      lines.push(`- ${check} **${item.label}** [${item.category}]${auto}`);
      if (item.details) {
        lines.push(`  > ${item.details}`);
      }
    }
  }

  return lines.join("\n");
};

/**
 * Render a compact delivery plan summary.
 */
export const renderPlanSummary = (plan: DeliveryPlan): string => {
  const lines: string[] = [];

  const totalTasks = plan.phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
  const branchPreview =
    plan.branchStrategy.length > 100
      ? `${plan.branchStrategy.slice(0, 100)}…`
      : plan.branchStrategy;

  lines.push(`## 🚀 Delivery Summary — Proposal #${plan.proposalId}`);
  lines.push("");
  lines.push(`- **Phases:** ${plan.phases.length} phases, ${totalTasks} total tasks`);
  lines.push(`- **Estimated Duration:** ${plan.estimatedDuration}`);
  lines.push(`- **Branch Strategy:** ${branchPreview}`);

  return lines.join("\n");
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
            : p.status === "controlled"
              ? "🔒"
              : p.status === "deliberating"
                ? "🗳️"
                : p.status === "open"
                  ? "📝"
                  : "⚠️";

    lines.push(`## ${statusEmoji} Proposal #${p.id}: ${typeEmoji(p.type)} ${p.title}`);
    lines.push(`**Type:** ${typeEmoji(p.type)} ${p.type} | **Status:** ${p.status} | **Stage:** ${p.stage} | **By:** ${p.proposedBy} | **Created:** ${p.createdAt.split("T")[0]}`);
    if (p.riskZone) {
      const zoneLabel = p.riskZone === "red" ? "🔴 Red" : p.riskZone === "orange" ? "🟠 Orange" : "🟢 Green";
      lines.push(`**Zone:** ${zoneLabel}` + (p.compositeScore ? ` | **Score:** ${p.compositeScore.weighted}/100` : ""));
    }
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

/**
 * Render an amendment diff as a markdown table.
 */
export const renderAmendmentDiff = (diffs: { field: string; before: string; after: string }[]): string => {
  if (diffs.length === 0) return "*No changes detected.*";

  const lines: string[] = [];
  lines.push("## 🔄 Amendment Preview");
  lines.push("");
  lines.push("| Field | Before | After |");
  lines.push("|-------|--------|-------|");

  for (const d of diffs) {
    const before = d.before.length > 80 ? `${d.before.slice(0, 80)}…` : d.before;
    const after = d.after.length > 80 ? `${d.after.slice(0, 80)}…` : d.after;
    lines.push(`| \`${d.field}\` | ${before} | ${after} |`);
  }

  return lines.join("\n");
};

/**
 * Render amendment status with state information.
 */
export const renderAmendmentStatus = (
  proposal: Proposal,
): string => {
  if (!proposal.amendmentPayload) {
    return "*No amendment payload on this proposal.*";
  }

  const payload = proposal.amendmentPayload;
  const state = proposal.amendmentState ?? "pending-vote";
  const origin = proposal.amendmentOrigin;

  const stateEmoji: Record<string, string> = {
    "pending-vote": "🗳️",
    "approved-pending-human": "⏳",
    "approved": "✅",
    "executed": "🚀",
    "rolled-back": "⏪",
  };

  const lines: string[] = [];
  lines.push("## 📜 Amendment Status");
  lines.push("");
  lines.push(`**Type:** ${payload.type}`);
  lines.push(`**State:** ${stateEmoji[state] ?? "❓"} ${state}`);

  if (origin) {
    lines.push(`**Origin:** ${origin.source}${origin.agentId ? ` (${origin.agentId})` : ""}`);
  }

  // Type-specific details
  switch (payload.type) {
    case "agent-update":
      lines.push(`**Target Agent:** ${payload.agentId}`);
      lines.push(`**Fields Changed:** ${Object.keys(payload.changes).join(", ")}`);
      break;
    case "agent-add":
      lines.push(`**New Agent:** ${payload.agent.name} (${payload.agent.id})`);
      break;
    case "agent-remove":
      lines.push(`**Removing Agent:** ${payload.agentId}`);
      break;
    case "config-update":
      lines.push(`**Config Fields:** ${Object.keys(payload.changes).join(", ")}`);
      break;
    case "quorum-update":
      lines.push(`**Quorum Types:** ${Object.keys(payload.typeQuorum).join(", ")}`);
      break;
    case "gate-update":
      if (payload.addGates?.length) lines.push(`**Adding Gates:** ${payload.addGates.join(", ")}`);
      if (payload.removeGates?.length) lines.push(`**Removing Gates:** ${payload.removeGates.join(", ")}`);
      break;
    case "council-update":
      lines.push(`**Target Agent:** ${payload.agentId}`);
      lines.push(`**Councils:** ${payload.councils.map(c => `${c.council}(${c.role})`).join(", ")}`);
      break;
  }

  if (proposal.preAmendmentSnapshot) {
    lines.push(`**Snapshot:** Captured at ${proposal.preAmendmentSnapshot.capturedAt}`);
    lines.push(`**Rollback:** Available (${proposal.preAmendmentSnapshot.agents.length} agents, quorum=${(proposal.preAmendmentSnapshot.config as any).quorumPercent}%)`);
  }

  return lines.join("\n");
};
