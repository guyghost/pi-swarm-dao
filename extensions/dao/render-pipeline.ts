// ============================================================
// pi-swarm-dao — Pipeline Dashboard Rendering
// ============================================================
// Read-only rendering of the DAO proposal pipeline.
// No side effects — pure functions only.

import type { Proposal, ProposalStatus, ProposalType, CompositeScore } from "./types.js";
import { PROPOSAL_TYPE_LABELS } from "./types.js";

// ── Pipeline Stages (ordered) ────────────────────────────────

export const PIPELINE_COLUMNS: ProposalStatus[] = [
  "open",
  "deliberating",
  "approved",
  "controlled",
  "executed",
];

const TERMINAL_COLUMNS: ProposalStatus[] = [
  "rejected",
  "failed",
];

export const STATUS_LABELS: Record<ProposalStatus, string> = {
  open: "📝 Open",
  deliberating: "🗳️ Deliberating",
  approved: "✅ Approved",
  controlled: "🔒 Controlled",
  executed: "🚀 Executed",
  rejected: "❌ Rejected",
  failed: "⚠️ Failed",
};

// ── Helpers ───────────────────────────────────────────────────

/** Truncate a string to maxLen chars, appending ellipsis if truncated */
const truncate = (s: string, maxLen: number): string =>
  s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;

/** Strip ANSI escape codes */
const stripAnsi = (s: string): string =>
  s.replace(/\x1b\[[0-9;]*m/g, "");

/** Format age from ISO date string */
const formatAge = (isoDate: string): string => {
  const ms = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
};

/** Score color indicator */
const scoreIndicator = (score: number): string => {
  if (score >= 70) return `🟢 ${score}`;
  if (score >= 40) return `🟡 ${score}`;
  return `🔴 ${score}`;
};

/** Type emoji */
const typeEmoji = (type: ProposalType): string => {
  const label = PROPOSAL_TYPE_LABELS[type];
  return label ? label.split(" ")[0] : "📋";
};

/** Check if a proposal is stale (no state change for N hours) */
export const isStale = (
  proposal: Proposal,
  thresholdHours: number = 24,
): boolean => {
  if (!proposal.resolvedAt && proposal.status === "open") {
    // Use createdAt for open proposals
    const ms = Date.now() - new Date(proposal.createdAt).getTime();
    return ms > thresholdHours * 3600000;
  }
  // For non-open proposals, check resolvedAt or createdAt
  const refDate = proposal.resolvedAt ?? proposal.createdAt;
  const ms = Date.now() - new Date(refDate).getTime();
  return ms > thresholdHours * 3600000;
};

/** Check if a proposal needs human action */
export const needsAction = (proposal: Proposal): boolean => {
  // Amendment awaiting human approval
  if (proposal.amendmentState === "approved-pending-human") return true;
  // Failed execution that can be retried
  if (proposal.status === "failed") return true;
  // Approved but not yet checked
  if (proposal.status === "approved") return true;
  // Controlled but not yet executed
  if (proposal.status === "controlled") return true;
  return false;
};

/** Action hint for a proposal */
const actionHint = (proposal: Proposal): string => {
  if (proposal.amendmentState === "approved-pending-human") {
    return `⏳ Run \`dao_approve_amendment ${proposal.id}\` to approve`;
  }
  if (proposal.status === "failed") {
    return `🔄 Run \`dao_execute ${proposal.id}\` to retry`;
  }
  if (proposal.status === "approved") {
    return `🛡️ Run \`dao_check ${proposal.id}\` to run gates`;
  }
  if (proposal.status === "controlled") {
    return `🚀 Run \`dao_execute ${proposal.id}\` to execute`;
  }
  return "";
};

// ── Filter Types ──────────────────────────────────────────────

export interface PipelineFilters {
  stage?: ProposalStatus;
  type?: ProposalType;
  needsActionOnly?: boolean;
  staleOnly?: boolean;
}

// ── Main Render Function ─────────────────────────────────────

export const renderPipelineDashboard = (
  proposals: Proposal[],
  filters: PipelineFilters = {},
  staleThresholdHours: number = 24,
): string => {
  if (proposals.length === 0) {
    return "# 📊 DAO Pipeline Dashboard\n\nNo proposals found. Use `/dao-roundtable` to generate new proposals.";
  }

  const lines: string[] = [];

  // Header
  lines.push("# 📊 DAO Pipeline Dashboard");
  lines.push("");

  // Apply filters
  let filtered = [...proposals];
  if (filters.stage) {
    filtered = filtered.filter((p) => p.status === filters.stage);
  }
  if (filters.type) {
    filtered = filtered.filter((p) => p.type === filters.type);
  }
  if (filters.needsActionOnly) {
    filtered = filtered.filter((p) => needsAction(p));
  }
  if (filters.staleOnly) {
    filtered = filtered.filter((p) => isStale(p, staleThresholdHours));
  }

  // ── Needs Attention Section ────────────────────────────────
  const actionItems = filtered.filter((p) => needsAction(p));
  if (actionItems.length > 0 && !filters.stage) {
    lines.push("## ⚡ Needs Your Attention");
    lines.push("");
    for (const p of actionItems) {
      const hint = actionHint(p);
      const stale = isStale(p, staleThresholdHours);
      const staleBadge = stale ? " ⏰ STALE" : "";
      lines.push(
        `- **#${p.id}** ${truncate(stripAnsi(p.title), 55)} — ${STATUS_LABELS[p.status]}${staleBadge}`
      );
      if (hint) lines.push(`  > ${hint}`);
    }
    lines.push("");
  }

  // ── Pipeline Stages ────────────────────────────────────────
  lines.push("## Pipeline");
  lines.push("");

  // Build stage groups
  const stagesToShow = filters.stage
    ? [filters.stage]
    : [...PIPELINE_COLUMNS, ...TERMINAL_COLUMNS];

  for (const stage of stagesToShow) {
    const stageProposals = filtered
      .filter((p) => p.status === stage)
      .sort((a, b) => b.id - a.id); // newest first

    const label = STATUS_LABELS[stage];
    const count = stageProposals.length;

    lines.push(`### ${label} (${count})`);

    if (count === 0) {
      lines.push("*No proposals*");
      lines.push("");
      continue;
    }

    // Table for this stage
    lines.push("| # | Title | Type | Age | Score | Flags |");
    lines.push("|---|-------|------|-----|-------|-------|");

    for (const p of stageProposals) {
      const title = truncate(stripAnsi(p.title), 45);
      const type = `${typeEmoji(p.type)} ${p.type.replace("-", " ")}`;
      const age = formatAge(p.createdAt);

      // Score
      const score = p.compositeScore
        ? scoreIndicator(p.compositeScore.weighted)
        : "—";

      // Flags
      const flags: string[] = [];
      if (isStale(p, staleThresholdHours)) flags.push("⏰");
      if (p.amendmentState === "approved-pending-human") flags.push("⏳");
      if (p.status === "failed") flags.push("🔄");
      const flagsStr = flags.length > 0 ? flags.join(" ") : "—";

      lines.push(`| ${p.id} | ${title} | ${type} | ${age} | ${score} | ${flagsStr} |`);
    }

    lines.push("");
  }

  // ── Summary ────────────────────────────────────────────────
  const totalCount = filtered.length;
  const byStatus: Record<string, number> = {};
  for (const p of filtered) {
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  }

  lines.push("---");
  lines.push(
    `**${totalCount} proposals** — ` +
    PIPELINE_COLUMNS.concat(TERMINAL_COLUMNS)
      .filter((s) => byStatus[s])
      .map((s) => `${byStatus[s]} ${s}`)
      .join(", ")
  );

  // Filter indicators
  if (filters.stage || filters.type || filters.needsActionOnly || filters.staleOnly) {
    const activeFilters: string[] = [];
    if (filters.stage) activeFilters.push(`stage=${filters.stage}`);
    if (filters.type) activeFilters.push(`type=${filters.type}`);
    if (filters.needsActionOnly) activeFilters.push("needs-action");
    if (filters.staleOnly) activeFilters.push("stale");
    lines.push(`*Filtered: ${activeFilters.join(", ")}*`);
  }

  lines.push("");
  lines.push("`/dao status` · `/dao status --stage open` · `/dao status --needs-action`");

  return lines.join("\n");
};

// ── Compact single-proposal view ─────────────────────────────

export const renderProposalCard = (proposal: Proposal): string => {
  const lines: string[] = [];

  const label = STATUS_LABELS[proposal.status];
  lines.push(`# ${typeEmoji(proposal.type)} Proposal #${proposal.id}`);
  lines.push("");
  lines.push(`**${stripAnsi(proposal.title)}**`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Status | ${label} |`);
  lines.push(`| Type | ${typeEmoji(proposal.type)} ${proposal.type} |`);
  lines.push(`| Stage | ${proposal.stage} |`);
  lines.push(`| Age | ${formatAge(proposal.createdAt)} |`);

  if (proposal.compositeScore) {
    lines.push(`| Score | ${scoreIndicator(proposal.compositeScore.weighted)}/100 |`);
  }

  if (proposal.riskZone) {
    const zoneEmoji = proposal.riskZone === "red" ? "🔴" : proposal.riskZone === "orange" ? "🟠" : "🟢";
    lines.push(`| Risk Zone | ${zoneEmoji} ${proposal.riskZone} |`);
  }

  lines.push(`| Proposed By | ${proposal.proposedBy} |`);

  if (needsAction(proposal)) {
    lines.push("");
    lines.push(`> ⚡ **Action needed:** ${actionHint(proposal)}`);
  }

  // Description
  lines.push("");
  lines.push("## Description");
  lines.push(proposal.description);

  // Votes summary
  if (proposal.votes.length > 0) {
    lines.push("");
    lines.push("## Votes");
    const forVotes = proposal.votes.filter((v) => v.position === "for");
    const against = proposal.votes.filter((v) => v.position === "against");
    lines.push(`**${forVotes.length} for / ${against.length} against / ${proposal.votes.length - forVotes.length - against.length} abstain**`);
  }

  return lines.join("\n");
};

// ── Parse filter args from command string ─────────────────────

export const parseFilterArgs = (args: string): PipelineFilters => {
  const filters: PipelineFilters = {};
  const tokens = args.trim().split(/\s+/);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === "--stage" && tokens[i + 1]) {
      filters.stage = tokens[++i] as ProposalStatus;
    } else if (token === "--type" && tokens[i + 1]) {
      filters.type = tokens[++i] as ProposalType;
    } else if (token === "--needs-action") {
      filters.needsActionOnly = true;
    } else if (token === "--stale") {
      filters.staleOnly = true;
    }
  }

  return filters;
};
