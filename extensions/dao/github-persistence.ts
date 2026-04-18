// ============================================================
// pi-swarm-dao — GitHub Issues Persistence Layer
// ============================================================
// Persists DAO proposals, votes, and deliberation exchanges
// to GitHub Issues for visibility, audit, and cross-session
// durability.
//
// GitHub is the canonical durable store for proposal state:
//   - Proposal body contains a machine-readable snapshot
//   - Comments contain structured DAO events for auditability
//   - Labels encode status/type/zone for human visibility
// ============================================================

import { execFileSync } from "node:child_process";
import type {
  Proposal,
  Vote,
  AgentOutput,
  ControlCheckResult,
  ProposalStatus,
  ProposalType,
  RiskZone,
  DAOState,
  AuditEntry,
  DeliveryPlan,
  DAOArtefacts,
  ArtefactFileIndex,
  ExecutionVerification,
  ProposalOutcome,
  ExecutionSnapshot,
  DryRunResult,
} from "./types.js";
import {
  PROPOSAL_TYPE_LABELS,
  PROPOSAL_TYPES,
  RISK_ZONE_LABELS,
} from "./types.js";
import { getState, setState } from "./persistence.js";
import { parseDeliveryPlan } from "./delivery/plan.js";
import { generateAllArtefacts } from "./delivery/artefacts.js";
import { tallyVotes } from "./governance/voting.js";

// ── Canonical Metadata ───────────────────────────────────────

const PROPOSAL_METADATA_START = "<!-- dao:proposal:start -->";
const PROPOSAL_METADATA_END = "<!-- dao:proposal:end -->";
const EVENT_METADATA_PREFIX = "<!-- dao:event ";
const EVENT_METADATA_SUFFIX = " -->";

const STATUS_LABELS: Record<ProposalStatus, string> = {
  open: "dao-status:open",
  deliberating: "dao-status:open",
  approved: "dao-status:approved",
  controlled: "dao-status:controlled",
  rejected: "dao-status:rejected",
  executed: "dao-status:executed",
  failed: "dao-status:failed",
};

const TYPE_LABELS: Record<ProposalType, string> = {
  "product-feature": "dao-type:product-feature",
  "security-change": "dao-type:security-change",
  "technical-change": "dao-type:technical-change",
  "release-change": "dao-type:release-change",
  "governance-change": "dao-type:governance-change",
};

const ZONE_LABELS: Record<RiskZone, string> = {
  green: "dao-zone:green",
  orange: "dao-zone:orange",
  red: "dao-zone:red",
};

const ALL_STATUS_LABELS = [
  "dao-status:open",
  "dao-status:approved",
  "dao-status:controlled",
  "dao-status:rejected",
  "dao-status:executed",
  "dao-status:failed",
  "dao-status:implemented",
];
const ALL_TYPE_LABELS = Object.values(TYPE_LABELS);
const ALL_ZONE_LABELS = Object.values(ZONE_LABELS);
const ALL_DAO_STATE_LABELS = [...ALL_STATUS_LABELS, ...ALL_TYPE_LABELS, ...ALL_ZONE_LABELS];

interface ProposalSnapshotEnvelope {
  dao: {
    version: 1;
    proposal: Proposal;
  };
}

interface EventEnvelope<TPayload = Record<string, unknown>> {
  version: 1;
  kind:
    | "vote"
    | "synthesis"
    | "control"
    | "execution"
    | "artefacts"
    | "plan"
    | "audit"
    | "implemented"
    | "verification"
    | "outcome"
    | "snapshot"
    | "rollback";
  proposalId: number;
  timestamp: string;
  payload: TPayload;
}

interface GitHubLabelJson {
  name?: string;
}

interface GitHubIssueCommentJson {
  body?: string;
  createdAt?: string;
}

interface GitHubIssueJson {
  number: number;
  title: string;
  body?: string;
  createdAt?: string;
  labels?: Array<string | GitHubLabelJson>;
  comments?: GitHubIssueCommentJson[];
}

const isProposalStatus = (value: unknown): value is ProposalStatus =>
  typeof value === "string" && ["open", "deliberating", "approved", "controlled", "rejected", "executed", "failed"].includes(value);

const isProposalType = (value: unknown): value is ProposalType =>
  typeof value === "string" && PROPOSAL_TYPES.includes(value as ProposalType);

const isRiskZone = (value: unknown): value is RiskZone =>
  value === "green" || value === "orange" || value === "red";

const normalizeLabels = (labels: GitHubIssueJson["labels"]): string[] =>
  (labels ?? [])
    .map((label) => typeof label === "string" ? label : label?.name)
    .filter((label): label is string => Boolean(label));

const getStatusFromLabels = (labels: string[]): ProposalStatus | undefined => {
  if (labels.includes("dao-status:failed")) return "failed";
  if (labels.includes("dao-status:executed") || labels.includes("dao-status:implemented")) return "executed";
  if (labels.includes("dao-status:rejected")) return "rejected";
  if (labels.includes("dao-status:controlled")) return "controlled";
  if (labels.includes("dao-status:approved")) return "approved";
  if (labels.includes("dao-status:open")) return "open";
  return undefined;
};

const getTypeFromLabels = (labels: string[]): ProposalType | undefined => {
  const typeLabel = labels.find((label) => label.startsWith("dao-type:"));
  if (!typeLabel) return undefined;
  const value = typeLabel.replace("dao-type:", "");
  return isProposalType(value) ? value : undefined;
};

const getZoneFromLabels = (labels: string[]): RiskZone | undefined => {
  const zoneLabel = labels.find((label) => label.startsWith("dao-zone:"));
  if (!zoneLabel) return undefined;
  const value = zoneLabel.replace("dao-zone:", "");
  return isRiskZone(value) ? value : undefined;
};

const buildProposalMetadataBlock = (proposal: Proposal): string => {
  const envelope: ProposalSnapshotEnvelope = {
    dao: {
      version: 1,
      proposal,
    },
  };

  return [
    PROPOSAL_METADATA_START,
    "```json",
    JSON.stringify(envelope, null, 2),
    "```",
    PROPOSAL_METADATA_END,
  ].join("\n");
};

const parseProposalMetadataBlock = (body: string): Proposal | null => {
  const match = body.match(
    /<!-- dao:proposal:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- dao:proposal:end -->/,
  );
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[1]) as ProposalSnapshotEnvelope;
    return parsed?.dao?.version === 1 && parsed.dao.proposal ? parsed.dao.proposal : null;
  } catch {
    return null;
  }
};

const stripProposalMetadataBlock = (body: string): string =>
  body.replace(
    /<!-- dao:proposal:start -->\s*```json\s*[\s\S]*?\s*```\s*<!-- dao:proposal:end -->\s*/,
    "",
  ).trim();

const buildEventMetadata = <TPayload>(kind: EventEnvelope<TPayload>["kind"], proposalId: number, payload: TPayload): string => {
  const envelope: EventEnvelope<TPayload> = {
    version: 1,
    kind,
    proposalId,
    timestamp: new Date().toISOString(),
    payload,
  };

  return `${EVENT_METADATA_PREFIX}${JSON.stringify(envelope)}${EVENT_METADATA_SUFFIX}`;
};

export const parseEventMetadata = (commentBody: string): EventEnvelope | null => {
  const firstLine = commentBody.split("\n", 1)[0]?.trim() ?? "";
  if (!firstLine.startsWith(EVENT_METADATA_PREFIX) || !firstLine.endsWith(EVENT_METADATA_SUFFIX)) {
    return null;
  }

  try {
    const raw = firstLine.slice(EVENT_METADATA_PREFIX.length, -EVENT_METADATA_SUFFIX.length);
    const parsed = JSON.parse(raw) as EventEnvelope;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
};

const withEventMetadata = <TPayload>(kind: EventEnvelope<TPayload>["kind"], proposalId: number, payload: TPayload, body: string): string =>
  `${buildEventMetadata(kind, proposalId, payload)}\n\n${body}`;

// ── Label Registry ───────────────────────────────────────────

/** All labels the DAO needs, with their color and description. */
const DAO_LABELS: Array<{ name: string; color: string; description: string }> = [
  { name: "dao-proposal", color: "1D76DB", description: "DAO governance proposal" },
  { name: "dao-status:open", color: "EDEDED", description: "Proposal open for deliberation" },
  { name: "dao-status:approved", color: "0E8A16", description: "Proposal approved by vote" },
  { name: "dao-status:controlled", color: "BFD4F2", description: "Passed control gates" },
  { name: "dao-status:rejected", color: "D93F0B", description: "Proposal rejected" },
  { name: "dao-status:executed", color: "006B75", description: "Proposal executed" },
  { name: "dao-status:failed", color: "D93F0B", description: "Execution failed" },
  { name: "dao-status:implemented", color: "0E8A16", description: "Implemented & delivered" },
  { name: "dao-type:product-feature", color: "FEF2C0", description: "Product feature proposal" },
  { name: "dao-type:security-change", color: "B60205", description: "Security change proposal" },
  { name: "dao-type:technical-change", color: "BFDADC", description: "Technical change proposal" },
  { name: "dao-type:release-change", color: "C2E0C6", description: "Release change proposal" },
  { name: "dao-type:governance-change", color: "D4C5F9", description: "Governance change proposal" },
  { name: "dao-zone:green", color: "0E8A16", description: "Risk zone: green (auto-approve)" },
  { name: "dao-zone:orange", color: "D93F0B", description: "Risk zone: orange (council review)" },
  { name: "dao-zone:red", color: "B60205", description: "Risk zone: red (formal vote + security)" },
];

let labelsEnsured = false;

export const ensureLabels = (): void => {
  if (labelsEnsured) return;

  for (const label of DAO_LABELS) {
    try {
      execFileSync("gh", [
        "label", "create",
        label.name,
        "--color", label.color,
        "--description", label.description,
        "--force",
      ], {
        cwd: process.cwd(),
        encoding: "utf-8",
        timeout: 10_000,
        stdio: "pipe",
      });
    } catch {
      // best-effort only
    }
  }

  labelsEnsured = true;
};

// ── GitHub CLI Helper ────────────────────────────────────────

const gh = (...args: string[]): string => {
  try {
    return execFileSync("gh", args, {
      cwd: process.cwd(),
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    }).trim();
  } catch (err: any) {
    const message = err?.stderr?.toString() || err?.message || "";
    if (
      message.includes("not found") ||
      message.includes("not authenticated") ||
      message.includes("authentication")
    ) {
      return "";
    }
    throw new Error(`GitHub CLI error: ${message.slice(0, 500)}`);
  }
};

const loadIssueComments = (issueNumber: number): GitHubIssueCommentJson[] => {
  try {
    const result = gh(
      "issue",
      "view",
      String(issueNumber),
      "--json",
      "comments",
    );

    if (!result) return [];

    const parsed = JSON.parse(result) as { comments?: GitHubIssueCommentJson[] };
    return Array.isArray(parsed.comments) ? parsed.comments : [];
  } catch {
    return [];
  }
};

// ── Issue Body Builders ──────────────────────────────────────

export const buildProposalBody = (proposal: Proposal): string => {
  const typeLabel = PROPOSAL_TYPE_LABELS[proposal.type];
  const score = proposal.compositeScore;
  const zone = proposal.riskZone;
  const problemStatement = proposal.content?.problemStatement ?? proposal.problemStatement ?? proposal.description;
  const successMetrics = proposal.content?.successMetrics ?? proposal.successMetrics ?? [];
  const rollbackConditions = proposal.rollbackConditions ?? [];

  const lines = [buildProposalMetadataBlock(proposal), "", `## ${typeLabel}`, "", proposal.description];

  if (problemStatement && problemStatement !== proposal.description) {
    lines.push("", "### Problem Statement", problemStatement);
  }

  if (proposal.context) {
    lines.push("", "### Context", proposal.context);
  }

  if (proposal.acceptanceCriteria?.length) {
    lines.push("", "### Acceptance Criteria");
    for (const criterion of proposal.acceptanceCriteria) {
      lines.push(`- [ ] ${criterion.id}: ${criterion.then}`);
    }
  }

  if (successMetrics.length > 0) {
    lines.push("", "### Success Metrics");
    for (const metric of successMetrics) lines.push(`- ${metric}`);
  }

  if (rollbackConditions.length > 0) {
    lines.push("", "### Rollback Conditions");
    for (const condition of rollbackConditions) lines.push(`- ${condition}`);
  }

  if (score) {
    lines.push(
      "",
      `### Composite Score: ${score.weighted}/100`,
      `**Zone:** ${zone ? RISK_ZONE_LABELS[zone] : "TBD"}`,
      "",
      "| Axis | Score | Weight | Adjusted |",
      "|------|-------|--------|----------|",
      `| User Impact | ${score.axes.userImpact}/10 | 30% | ${(score.axes.userImpact * 0.3).toFixed(1)} |`,
      `| Business Impact | ${score.axes.businessImpact}/10 | 20% | ${(score.axes.businessImpact * 0.2).toFixed(1)} |`,
      `| Effort (inv) | ${score.axes.effort}/10 | 15% | ${(score.axes.effort * 0.15).toFixed(1)} |`,
      `| Security Risk (inv) | ${score.axes.securityRisk}/10 | 20% | ${(score.axes.securityRisk * 0.2).toFixed(1)} |`,
      `| Confidence | ${score.axes.confidence}/10 | 15% | ${(score.axes.confidence * 0.15).toFixed(1)} |`,
    );
  }

  lines.push("", "---", `*Proposal #${proposal.id} · Created: ${proposal.createdAt} · By: ${proposal.proposedBy}*`);
  return lines.join("\n");
};

const buildLabels = (proposal: Proposal): string[] => {
  const labels: string[] = ["dao-proposal", TYPE_LABELS[proposal.type], STATUS_LABELS[proposal.status]];
  if (proposal.riskZone) labels.push(ZONE_LABELS[proposal.riskZone]);
  return labels;
};

const voteEmoji = (position: string): string => {
  switch (position) {
    case "for": return "✅";
    case "against": return "❌";
    case "abstain": return "⏸️";
    default: return "❓";
  }
};

const buildVoteComment = (proposal: Proposal, vote: Vote, output: AgentOutput): string => {
  let body = `### ${voteEmoji(vote.position)} ${vote.agentName} — **${vote.position.toUpperCase()}** (weight: ${vote.weight})\n\n`;
  body += `**Role:** ${output.role}\n`;
  body += `**Duration:** ${(output.durationMs / 1000).toFixed(1)}s`;
  if (output.error) body += `\n**⚠️ Error:** ${output.error}`;
  body += `\n\n${output.content}`;

  return withEventMetadata("vote", proposal.id, { vote, output }, body);
};

const buildSynthesisComment = (
  proposal: Proposal,
  tally: { weightedFor: number; weightedAgainst: number; totalVotingWeight: number; votingAgents: number; totalAgents: number; quorumMet: boolean; approvalScore: number },
  durationMs: number,
): string => {
  const status = proposal.status === "rejected" ? "❌ REJECTED" : "✅ APPROVED";
  let body = `## 🗳️ Deliberation Complete — ${status}\n\n`;
  body += `**Duration:** ${(durationMs / 1000).toFixed(1)}s (parallel execution)\n\n`;
  body += `| Metric | Result | Required |\n`;
  body += `|--------|--------|----------|\n`;
  body += `| Participation | ${tally.votingAgents}/${tally.totalAgents} agents (${((tally.votingAgents / tally.totalAgents) * 100).toFixed(1)}%) | 60% quorum |\n`;
  body += `| Approval | ${tally.weightedFor}/${tally.totalVotingWeight} weighted (${tally.approvalScore.toFixed(1)}%) | 55% threshold |\n`;
  if (proposal.synthesis) body += `\n### Synthesis\n${proposal.synthesis}`;

  return withEventMetadata("synthesis", proposal.id, { tally, durationMs, synthesis: proposal.synthesis ?? "" }, body);
};

const buildControlComment = (proposalId: number, result: ControlCheckResult): string => {
  const overall = result.allGatesPassed ? "✅ All Gates Passed" : "❌ Gates Failed";
  let body = `## 🛡️ Control Check — ${overall}\n\n`;
  body += `| Gate | Status | Severity | Message |\n`;
  body += `|------|--------|----------|--------|\n`;
  for (const gate of result.gates) {
    const icon = gate.passed ? "✅" : "❌";
    body += `| ${icon} ${gate.name} | ${gate.passed ? "Pass" : "Fail"} | ${gate.severity} | ${gate.message.slice(0, 80)} |\n`;
  }
  body += `\n**Checklist:** ${result.gates.filter((g) => g.passed).length}/${result.gates.length} passed`;

  return withEventMetadata("control", proposalId, result, body);
};

const buildExecutionComment = (proposalId: number, result: string): string =>
  withEventMetadata("execution", proposalId, { result }, `## 🚀 Execution Output\n\n${result}`);

const buildArtefactLink = (label: string, file: ArtefactFileIndex[keyof ArtefactFileIndex]): string =>
  file.url ? `- ${label}: [${file.path}](${file.url})` : `- ${label}: \`${file.path}\``;

const buildArtefactsComment = (
  proposalId: number,
  artefactCount: number,
  files?: ArtefactFileIndex,
): string => {
  let body = `## 📚 Artefacts Generated\n\n${artefactCount} artefacts generated:`;

  if (files) {
    body += `\n\n### Repository Files\n`;
    body += [
      buildArtefactLink("📋 Decision Brief", files.decisionBrief),
      buildArtefactLink("🏗️ ADR", files.adr),
      buildArtefactLink("🔒 Risk Report", files.riskReport),
      buildArtefactLink("📝 PRD Lite", files.prdLite),
      buildArtefactLink("🗂️ Implementation Plan", files.implementationPlan),
      buildArtefactLink("🧪 Test Plan", files.testPlan),
      buildArtefactLink("📦 Release Packet", files.releasePacket),
    ].join("\n");
  } else {
    body += `\n\n- 📋 Decision Brief\n- 🏗️ ADR\n- 🔒 Risk Report\n- 📝 PRD Lite\n- 🗂️ Implementation Plan\n- 🧪 Test Plan\n- 📦 Release Packet`;
  }

  return withEventMetadata(
    "artefacts",
    proposalId,
    { artefactCount, files },
    body,
  );
};

const buildPlanComment = (proposalId: number, plan: string): string =>
  withEventMetadata("plan", proposalId, { plan }, `## 🗂️ Delivery Plan\n\n${plan}`);

const buildVerificationComment = (verification: ExecutionVerification): string =>
  withEventMetadata(
    "verification",
    verification.proposalId,
    verification,
    `## 🧪 Execution Verification\n\n**Status:** ${verification.status.toUpperCase()}\n\n${verification.summary}`,
  );

const buildOutcomeComment = (outcome: ProposalOutcome): string => {
  const latestRating = outcome.ratings.at(-1);
  const latestMetric = outcome.metrics.at(-1);
  let body = `## 📊 Outcome Update\n\n`;
  body += `**Status:** ${outcome.status}\n`;
  body += `**Overall Score:** ${outcome.overallScore.toFixed(1)}/5\n`;
  body += `**Ratings:** ${outcome.ratings.length}\n`;
  body += `**Metrics:** ${outcome.metrics.length}`;

  if (latestRating) {
    body += `\n\n### Latest Rating\n- **Rater:** ${latestRating.rater}\n- **Score:** ${latestRating.score}/5\n- **Comment:** ${latestRating.comment}`;
  }

  if (latestMetric) {
    body += `\n\n### Latest Metric\n- **Name:** ${latestMetric.name}\n- **Before:** ${latestMetric.before}${latestMetric.unit ? ` ${latestMetric.unit}` : ""}\n- **After:** ${latestMetric.after}${latestMetric.unit ? ` ${latestMetric.unit}` : ""}`;
  }

  return withEventMetadata("outcome", outcome.proposalId, outcome, body);
};

const buildSnapshotComment = (snapshot: ExecutionSnapshot, dryRun?: DryRunResult): string => {
  let body = `## 💾 Execution Snapshot\n\n`;
  body += `**Branch:** ${snapshot.branch}\n`;
  body += `**Commit:** ${snapshot.commitSha}\n`;
  body += `**Captured At:** ${snapshot.timestamp}`;

  if (dryRun) {
    body += `\n\n### Dry-Run\n- **Can Proceed:** ${dryRun.canProceed}\n- **Estimated Duration:** ${dryRun.estimatedDuration}\n- **Files Affected:** ${dryRun.filesAffected.length}`;
  }

  return withEventMetadata("snapshot", snapshot.proposalId, { snapshot, dryRun }, body);
};

const buildRollbackComment = (
  proposalId: number,
  result: { success: boolean; message: string },
): string =>
  withEventMetadata(
    "rollback",
    proposalId,
    result,
    `## ⏪ Rollback ${result.success ? "Succeeded" : "Failed"}\n\n${result.message}`,
  );

// ── Public API ───────────────────────────────────────────────

const issueMap = new Map<number, number>();

export const getIssueNumber = (proposalId: number): number | undefined => issueMap.get(proposalId);

const parseIssueNumber = (ghOutput: string): number | null => {
  const match = ghOutput.match(/\/issues\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
};

export const ghCreateProposalDraft = (
  title: string,
  type: ProposalType,
  description: string,
  proposedBy: string = "user",
  context?: string,
): number | null => {
  ensureLabels();

  const draftBody = [
    "# DAO Proposal Draft",
    "",
    description,
    context ? `\n## Context\n${context}` : "",
    "",
    `*Created by: ${proposedBy}*`,
  ].join("\n");

  const result = gh(
    "issue", "create",
    "--title", title,
    "--body", draftBody,
    "--label", ["dao-proposal", TYPE_LABELS[type], STATUS_LABELS.open].join(","),
  );

  if (!result) return null;
  const issueNumber = parseIssueNumber(result);
  if (issueNumber !== null) {
    issueMap.set(issueNumber, issueNumber);
    return issueNumber;
  }
  return null;
};

export const ghCreateProposal = (proposal: Proposal): number | null => {
  if (issueMap.has(proposal.id)) return issueMap.get(proposal.id)!;

  ensureLabels();

  const result = gh(
    "issue", "create",
    "--title", `Proposal #${proposal.id}: ${proposal.title}`,
    "--body", buildProposalBody(proposal),
    "--label", buildLabels(proposal).join(","),
  );

  if (!result) return null;
  const issueNumber = parseIssueNumber(result);
  if (issueNumber !== null) {
    issueMap.set(proposal.id, issueNumber);
    return issueNumber;
  }
  return null;
};

export const ghSyncProposal = (proposal: Proposal): void => {
  let issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) {
    issueNumber = ghCreateProposal(proposal) ?? undefined;
  }
  if (!issueNumber) return;

  issueMap.set(proposal.id, issueNumber);

  gh(
    "issue", "edit",
    String(issueNumber),
    "--title", `Proposal #${proposal.id}: ${proposal.title}`,
    "--body", buildProposalBody(proposal),
  );

  gh(
    "issue", "edit",
    String(issueNumber),
    "--remove-label", ALL_DAO_STATE_LABELS.join(","),
  );
  gh(
    "issue", "edit",
    String(issueNumber),
    "--add-label", buildLabels(proposal).join(","),
  );
};

const AUTO_CLOSE_STATES = new Set<ProposalStatus>(["rejected", "failed"]);

export const ghUpdateStatus = (proposal: Proposal): void => {
  ghSyncProposal(proposal);

  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;

  if (AUTO_CLOSE_STATES.has(proposal.status)) {
    gh("issue", "close", String(issueNumber), "--reason", "not planned");
  }
};

export const ghAddDeliberation = (
  proposal: Proposal,
  agentOutputs: AgentOutput[],
  tally: { weightedFor: number; weightedAgainst: number; totalVotingWeight: number; votingAgents: number; totalAgents: number; quorumMet: boolean; approvalScore: number },
  durationMs: number,
): void => {
  ghSyncProposal(proposal);

  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;

  gh("issue", "comment", String(issueNumber), "--body", buildSynthesisComment(proposal, tally, durationMs));

  for (const output of agentOutputs) {
    const vote = proposal.votes.find((entry) => entry.agentId === output.agentId);
    if (vote) {
      gh("issue", "comment", String(issueNumber), "--body", buildVoteComment(proposal, vote, output));
    } else if (output.error) {
      gh(
        "issue",
        "comment",
        String(issueNumber),
        "--body",
        withEventMetadata("vote", proposal.id, { output }, `### ⚠️ ${output.agentName} — ERROR (${(output.durationMs / 1000).toFixed(1)}s)\n\n**Error:** ${output.error}`),
      );
    }
  }
};

export const ghAddControlResult = (proposal: Proposal, result: ControlCheckResult): void => {
  ghSyncProposal(proposal);

  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;
  gh("issue", "comment", String(issueNumber), "--body", buildControlComment(proposal.id, result));
};

export const ghAddExecution = (proposal: Proposal, result: string): void => {
  ghSyncProposal(proposal);

  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;
  gh("issue", "comment", String(issueNumber), "--body", buildExecutionComment(proposal.id, result));
};

export const ghAddArtefacts = (
  proposal: Proposal,
  artefactCount: number,
  files?: ArtefactFileIndex,
): void => {
  ghSyncProposal(proposal);

  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;
  gh("issue", "comment", String(issueNumber), "--body", buildArtefactsComment(proposal.id, artefactCount, files));
};

export const ghAddPlan = (proposal: Proposal, plan: string): void => {
  ghSyncProposal(proposal);

  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;
  gh("issue", "comment", String(issueNumber), "--body", buildPlanComment(proposal.id, plan));
};

export const ghAddVerification = (proposal: Proposal, verification: ExecutionVerification): void => {
  ghSyncProposal(proposal);

  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;
  gh("issue", "comment", String(issueNumber), "--body", buildVerificationComment(verification));
};

export const ghAddOutcome = (proposal: Proposal, outcome: ProposalOutcome): void => {
  ghSyncProposal(proposal);

  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;
  gh("issue", "comment", String(issueNumber), "--body", buildOutcomeComment(outcome));
};

export const ghAddSnapshot = (
  proposal: Proposal,
  snapshot: ExecutionSnapshot,
  dryRun?: DryRunResult,
): void => {
  ghSyncProposal(proposal);

  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;
  gh("issue", "comment", String(issueNumber), "--body", buildSnapshotComment(snapshot, dryRun));
};

export const ghAddRollback = (
  proposal: Proposal,
  result: { success: boolean; message: string },
): void => {
  ghSyncProposal(proposal);

  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;
  gh("issue", "comment", String(issueNumber), "--body", buildRollbackComment(proposal.id, result));
};

export const ghAddAuditEntry = (
  proposalId: number,
  layer: string,
  action: string,
  details: string,
): void => {
  const issueNumber = issueMap.get(proposalId);
  if (!issueNumber) return;

  const layerLabels: Record<string, string> = {
    governance: "🗳️ Governance",
    intelligence: "🧠 Intelligence",
    control: "🛡️ Control",
    delivery: "🚀 Delivery",
  };

  const body = withEventMetadata(
    "audit",
    proposalId,
    { layer, action, details },
    `**${layerLabels[layer] || layer}** — ${action}\n\n${details}`,
  );
  gh("issue", "comment", String(issueNumber), "--body", body);
};

export const restoreProposalFromIssue = (issue: GitHubIssueJson): Proposal | null => {
  const labels = normalizeLabels(issue.labels);
  const snapshot = parseProposalMetadataBlock(issue.body ?? "");
  const fallbackTitle = issue.title.replace(/^Proposal #\d+:\s*/, "").trim() || issue.title;
  const fallbackType = getTypeFromLabels(labels) ?? "product-feature";
  const fallbackStatus = getStatusFromLabels(labels) ?? "open";
  const fallbackDescription = stripProposalMetadataBlock(issue.body ?? "") || "GitHub-restored DAO proposal";

  const proposal: Proposal = snapshot ?? {
    id: issue.number,
    title: fallbackTitle,
    type: fallbackType,
    description: fallbackDescription,
    stage: "intake",
    proposedBy: "github",
    status: fallbackStatus,
    votes: [],
    agentOutputs: [],
    createdAt: issue.createdAt ?? new Date().toISOString(),
  };

  proposal.id = issue.number;
  proposal.title = fallbackTitle || proposal.title;
  proposal.createdAt = proposal.createdAt ?? issue.createdAt ?? new Date().toISOString();

  const labelStatus = getStatusFromLabels(labels);
  if (labelStatus) proposal.status = labelStatus;

  const labelType = getTypeFromLabels(labels);
  if (labelType) proposal.type = labelType;
  if (!isProposalType(proposal.type)) proposal.type = fallbackType;

  const labelZone = getZoneFromLabels(labels);
  if (labelZone) proposal.riskZone = labelZone;

  if (!isProposalStatus(proposal.status)) proposal.status = fallbackStatus;
  if (!proposal.description) proposal.description = fallbackDescription;
  if (!proposal.stage) proposal.stage = "intake";
  if (!Array.isArray(proposal.votes)) proposal.votes = [];
  if (!Array.isArray(proposal.agentOutputs)) proposal.agentOutputs = [];

  return proposal;
};

export const rebuildStateFromIssues = (issues: GitHubIssueJson[]): Proposal[] =>
  issues
    .map((issue) => {
      const proposal = restoreProposalFromIssue(issue);
      if (proposal) issueMap.set(proposal.id, issue.number);
      return proposal;
    })
    .filter((proposal): proposal is Proposal => proposal !== null)
    .sort((a, b) => a.id - b.id);

const sortComments = (comments: GitHubIssueCommentJson[] = []): GitHubIssueCommentJson[] =>
  [...comments].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

const upsertVote = (proposal: Proposal, vote: Vote): void => {
  const existingIndex = proposal.votes.findIndex((entry) => entry.agentId === vote.agentId);
  if (existingIndex >= 0) {
    proposal.votes[existingIndex] = vote;
    return;
  }
  proposal.votes.push(vote);
};

const upsertAgentOutput = (proposal: Proposal, output: AgentOutput): void => {
  const existingIndex = proposal.agentOutputs.findIndex((entry) => entry.agentId === output.agentId);
  if (existingIndex >= 0) {
    proposal.agentOutputs[existingIndex] = output;
    return;
  }
  proposal.agentOutputs.push(output);
};

export const rehydrateStateFromIssues = (
  issues: GitHubIssueJson[],
  baseState: DAOState,
): DAOState => {
  const proposals = rebuildStateFromIssues(issues);
  const proposalMap = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const controlResults: DAOState["controlResults"] = {};
  const deliveryPlans: DAOState["deliveryPlans"] = {};
  const artefacts: DAOState["artefacts"] = {};
  const auditEntries: AuditEntry[] = [];
  const artefactProposalIds = new Set<number>();
  const artefactFiles = new Map<number, ArtefactFileIndex>();
  const verifications: DAOState["verifications"] = {};
  const outcomes: DAOState["outcomes"] = {};
  const snapshots: DAOState["snapshots"] = {};

  for (const issue of issues) {
    const proposal = proposalMap.get(issue.number);
    if (!proposal) continue;

    for (const comment of sortComments(issue.comments)) {
      const event = parseEventMetadata(comment.body ?? "");
      if (!event) continue;

      switch (event.kind) {
        case "vote": {
          const payload = event.payload as { vote?: Vote; output?: AgentOutput };
          if (payload.vote) upsertVote(proposal, payload.vote);
          if (payload.output) upsertAgentOutput(proposal, payload.output);
          break;
        }
        case "synthesis": {
          const payload = event.payload as { synthesis?: string };
          if (typeof payload.synthesis === "string" && payload.synthesis.trim().length > 0) {
            proposal.synthesis = payload.synthesis;
          }
          break;
        }
        case "control": {
          const payload = event.payload as unknown as Partial<ControlCheckResult>;
          if (
            typeof payload.proposalId === "number" &&
            typeof payload.timestamp === "string" &&
            Array.isArray(payload.gates) &&
            Array.isArray(payload.checklist)
          ) {
            controlResults[proposal.id] = payload as ControlCheckResult;
          }
          break;
        }
        case "plan": {
          const payload = event.payload as { plan?: string };
          if (typeof payload.plan === "string" && payload.plan.trim().length > 0) {
            deliveryPlans[proposal.id] = parseDeliveryPlan(proposal.id, payload.plan);
          }
          break;
        }
        case "execution": {
          const payload = event.payload as { result?: string };
          if (typeof payload.result === "string") {
            proposal.executionResult = payload.result;
          }
          break;
        }
        case "verification": {
          const payload = event.payload as Partial<ExecutionVerification>;
          if (typeof payload.proposalId === "number" && typeof payload.timestamp === "string") {
            verifications[proposal.id] = payload as ExecutionVerification;
          }
          break;
        }
        case "outcome": {
          const payload = event.payload as Partial<ProposalOutcome>;
          if (typeof payload.proposalId === "number" && Array.isArray(payload.ratings) && Array.isArray(payload.metrics)) {
            outcomes[proposal.id] = payload as ProposalOutcome;
          }
          break;
        }
        case "snapshot": {
          const payload = event.payload as { snapshot?: ExecutionSnapshot };
          if (payload.snapshot && typeof payload.snapshot.proposalId === "number") {
            snapshots[proposal.id] = payload.snapshot;
          }
          break;
        }
        case "artefacts": {
          const payload = event.payload as { files?: ArtefactFileIndex };
          artefactProposalIds.add(proposal.id);
          if (payload.files) {
            artefactFiles.set(proposal.id, payload.files);
          }
          break;
        }
        case "audit": {
          const payload = event.payload as { layer?: AuditEntry["layer"]; action?: string; details?: string };
          if (payload.layer && payload.action && payload.details) {
            auditEntries.push({
              id: 0,
              timestamp: event.timestamp,
              proposalId: proposal.id,
              layer: payload.layer,
              action: payload.action,
              actor: "github",
              details: payload.details,
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  for (const proposalId of artefactProposalIds) {
    const proposal = proposalMap.get(proposalId);
    if (!proposal) continue;

    const tally = tallyVotes(proposal.id, proposal.votes, proposal.type);
    const controlResult = controlResults[proposal.id];
    const plan = deliveryPlans[proposal.id];
    artefacts[proposal.id] = generateAllArtefacts(proposal, tally, controlResult, plan);
    const files = artefactFiles.get(proposal.id);
    if (files) {
      artefacts[proposal.id].files = files;
    }
  }

  const sortedAuditEntries = auditEntries
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map((entry, index) => ({ ...entry, id: index + 1 }));

  return {
    ...baseState,
    proposals,
    nextProposalId: Math.max(...proposals.map((proposal) => proposal.id), 0) + 1,
    controlResults,
    deliveryPlans,
    artefacts,
    auditLog: sortedAuditEntries,
    nextAuditId: sortedAuditEntries.length + 1,
    verifications,
    outcomes,
    snapshots,
  };
};

export const ghRestoreState = (): Map<number, number> => {
  try {
    const result = gh(
      "issue", "list",
      "--label", "dao-proposal",
      "--state", "all",
      "--limit", "100",
      "--json", "number,title,body,labels,createdAt",
    );

    if (!result) return issueMap;

    const issues = JSON.parse(result) as GitHubIssueJson[];
    for (const issue of issues) {
      issue.comments = loadIssueComments(issue.number);
    }

    const restoredState = rehydrateStateFromIssues(issues, getState());
    if (restoredState.proposals.length === 0) return issueMap;

    setState(restoredState);
    return issueMap;
  } catch {
    return issueMap;
  }
};

export const ghCloseImplemented = (
  proposal: Proposal,
  implementationSummary: {
    commits: string[];
    filesChanged: string[];
    testsPassed: number;
    branch?: string;
  },
): void => {
  ghSyncProposal(proposal);

  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;

  let body = `## ✅ Implemented & Delivered\n\n`;
  body += `The proposal has been fully implemented and merged.\n\n`;
  body += `### Commits\n`;
  for (const commit of implementationSummary.commits) body += `- \`${commit}\`\n`;
  body += `\n### Files Changed\n`;
  for (const file of implementationSummary.filesChanged) body += `- \`${file}\`\n`;
  body += `\n### Tests\n**${implementationSummary.testsPassed} tests passing**\n\n`;
  if (implementationSummary.branch) body += `**Branch:** \`${implementationSummary.branch}\`\n\n`;
  body += `---\n*Proposal #${proposal.id} · Closed after implementation · ${new Date().toISOString().split("T")[0]}*`;

  gh(
    "issue",
    "comment",
    String(issueNumber),
    "--body",
    withEventMetadata("implemented", proposal.id, implementationSummary, body),
  );

  gh(
    "issue",
    "edit",
    String(issueNumber),
    "--remove-label", "dao-status:executed",
  );
  gh(
    "issue",
    "edit",
    String(issueNumber),
    "--add-label", "dao-status:implemented",
  );
  gh("issue", "close", String(issueNumber), "--reason", "completed");
};
