// ============================================================
// pi-swarm-dao — GitHub Issues Persistence Layer
// ============================================================
// Persists DAO proposals, votes, and deliberation exchanges
// to GitHub Issues for visibility, audit, and cross-session
// durability.
//
// Mapping:
//   Proposal  → GitHub Issue (title, body, labels)
//   Vote      → Issue Comment (per-agent vote)
//   Synthesis → Issue Comment (deliberation summary)
//   Status    → Label update (dao-status:*)
//   Artefacts → Issue Comment (generated docs summary)
// ============================================================

import { execFileSync } from "node:child_process";
import type { Proposal, Vote, AgentOutput, CompositeScore, ControlCheckResult } from "./types.js";
import { PROPOSAL_TYPE_LABELS, RISK_ZONE_LABELS } from "./types.js";

// ── Label Mapping ────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  open: "dao-status:open",
  deliberating: "dao-status:open",
  approved: "dao-status:approved",
  controlled: "dao-status:controlled",
  rejected: "dao-status:rejected",
  executed: "dao-status:executed",
  failed: "dao-status:failed",
};

const TYPE_LABELS: Record<string, string> = {
  "product-feature": "dao-type:product-feature",
  "security-change": "dao-type:security-change",
  "technical-change": "dao-type:technical-change",
  "release-change": "dao-type:release-change",
  "governance-change": "dao-type:governance-change",
};

const ZONE_LABELS: Record<string, string> = {
  green: "dao-zone:green",
  orange: "dao-zone:orange",
  red: "dao-zone:red",
};

// ── GitHub CLI Helper ────────────────────────────────────────

/** Run a gh command and return stdout. Throws on failure. */
const gh = (...args: string[]): string => {
  try {
    return execFileSync("gh", args, {
      cwd: process.cwd(),
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10MB for large issue bodies
      timeout: 30_000,
    }).trim();
  } catch (err: any) {
    // If gh is not available or auth fails, silently return
    // This allows the DAO to work without GitHub integration
    const message = err?.stderr?.toString() || err?.message || "";
    if (message.includes("not found") || message.includes("not authenticated")) {
      return "";
    }
    throw new Error(`GitHub CLI error: ${message.slice(0, 500)}`);
  }
};

// ── Issue Body Builders ──────────────────────────────────────

/** Build the issue body from a proposal. */
const buildProposalBody = (proposal: Proposal): string => {
  const typeLabel = PROPOSAL_TYPE_LABELS[proposal.type];
  const score = proposal.compositeScore;
  const zone = proposal.riskZone;

  let body = `## ${typeLabel}\n\n`;
  body += proposal.description;

  if (proposal.context) {
    body += `\n\n### Context\n${proposal.context}`;
  }

  if (score) {
    body += `\n\n### Composite Score: ${score.weighted}/100`;
    body += `\n**Zone:** ${zone ? RISK_ZONE_LABELS[zone] : "TBD"}`;
    body += `\n\n| Axis | Score | Weight | Adjusted |`;
    body += `\n|------|-------|--------|----------|`;
    body += `\n| User Impact | ${score.axes.userImpact}/10 | 30% | ${(score.axes.userImpact * 0.3).toFixed(1)} |`;
    body += `\n| Business Impact | ${score.axes.businessImpact}/10 | 20% | ${(score.axes.businessImpact * 0.2).toFixed(1)} |`;
    body += `\n| Effort (inv) | ${score.axes.effort}/10 | 15% | ${(score.axes.effort * 0.15).toFixed(1)} |`;
    body += `\n| Security Risk (inv) | ${score.axes.securityRisk}/10 | 20% | ${(score.axes.securityRisk * 0.2).toFixed(1)} |`;
    body += `\n| Confidence | ${score.axes.confidence}/10 | 15% | ${(score.axes.confidence * 0.15).toFixed(1)} |`;
  }

  body += `\n\n---\n*Proposal #${proposal.id} · Created: ${proposal.createdAt} · By: ${proposal.proposedBy}*`;

  return body;
};

/** Build labels array for a proposal. */
const buildLabels = (proposal: Proposal): string[] => {
  const labels: string[] = ["dao-proposal"];

  const statusLabel = STATUS_LABELS[proposal.status];
  if (statusLabel) labels.push(statusLabel);

  const typeLabel = TYPE_LABELS[proposal.type];
  if (typeLabel) labels.push(typeLabel);

  const zone = proposal.riskZone;
  if (zone) {
    const zoneLabel = ZONE_LABELS[zone];
    if (zoneLabel) labels.push(zoneLabel);
  }

  return labels;
};

/** Vote position emoji */
const voteEmoji = (position: string): string => {
  switch (position) {
    case "for": return "✅";
    case "against": return "❌";
    case "abstain": return "⏸️";
    default: return "❓";
  }
};

/** Build a comment body for an individual agent vote. */
const buildVoteComment = (vote: Vote, output: AgentOutput): string => {
  let body = `### ${voteEmoji(vote.position)} ${vote.agentName} — **${vote.position.toUpperCase()}** (weight: ${vote.weight})\n\n`;
  body += `**Role:** ${output.role}\n`;
  body += `**Duration:** ${(output.durationMs / 1000).toFixed(1)}s`;

  if (output.error) {
    body += `\n**⚠️ Error:** ${output.error}`;
  }

  body += `\n\n${output.content}`;

  return body;
};

/** Build the deliberation synthesis comment. */
const buildSynthesisComment = (
  proposal: Proposal,
  tally: { weightedFor: number; weightedAgainst: number; totalVotingWeight: number; votingAgents: number; totalAgents: number; quorumMet: boolean; approvalScore: number },
  durationMs: number
): string => {
  const status = proposal.status === "rejected" ? "❌ REJECTED" : "✅ APPROVED";

  let body = `## 🗳️ Deliberation Complete — ${status}\n\n`;
  body += `**Duration:** ${(durationMs / 1000).toFixed(1)}s (parallel execution)\n\n`;
  body += `| Metric | Result | Required |\n`;
  body += `|--------|--------|----------|\n`;
  body += `| Participation | ${tally.votingAgents}/${tally.totalAgents} agents (${((tally.votingAgents / tally.totalAgents) * 100).toFixed(1)}%) | 60% quorum |\n`;
  body += `| Approval | ${tally.weightedFor}/${tally.totalVotingWeight} weighted (${tally.approvalScore.toFixed(1)}%) | 55% threshold |\n`;

  if (proposal.synthesis) {
    body += `\n### Synthesis\n${proposal.synthesis}`;
  }

  return body;
};

/** Build control gates result comment. */
const buildControlComment = (result: ControlCheckResult): string => {
  const overall = result.allGatesPassed ? "✅ All Gates Passed" : "❌ Gates Failed";

  let body = `## 🛡️ Control Check — ${overall}\n\n`;
  body += `| Gate | Status | Severity | Message |\n`;
  body += `|------|--------|----------|--------|\n`;
  for (const gate of result.gates) {
    const icon = gate.passed ? "✅" : "❌";
    body += `| ${icon} ${gate.name} | ${gate.passed ? "Pass" : "Fail"} | ${gate.severity} | ${gate.message.slice(0, 80)} |\n`;
  }

  body += `\n**Checklist:** ${result.gates.filter(g => g.passed).length}/${result.gates.length} passed`;

  return body;
};

/** Build execution result comment. */
const buildExecutionComment = (result: string): string => {
  return `## 🚀 Execution Output\n\n${result}`;
};

// ── Public API ───────────────────────────────────────────────

/** Map of proposal ID → GitHub issue number (in-memory cache). */
const issueMap = new Map<number, number>();

/** Get the GitHub issue number for a proposal. */
export const getIssueNumber = (proposalId: number): number | undefined => {
  return issueMap.get(proposalId);
};

/**
 * Create a GitHub Issue for a new proposal.
 * Called when a proposal is created via dao_propose.
 */
export const ghCreateProposal = (proposal: Proposal): number | null => {
  // Skip if this proposal already has a GitHub issue
  if (issueMap.has(proposal.id)) {
    return issueMap.get(proposal.id)!;
  }

  const body = buildProposalBody(proposal);
  const labels = buildLabels(proposal);

  const title = `Proposal #${proposal.id}: ${proposal.title}`;

  const result = gh(
    "issue", "create",
    "--title", title,
    "--body", body,
    "--label", labels.join(","),
  );

  if (!result) return null;

  // Parse issue number from output: "https://github.com/owner/repo/issues/123"
  const match = result.match(/\/issues\/(\d+)$/);
  if (match) {
    const issueNumber = parseInt(match[1], 10);
    issueMap.set(proposal.id, issueNumber);
    return issueNumber;
  }

  return null;
};

/** Terminal states — proposal is done, issue should be closed. */
const TERMINAL_STATES = new Set(["executed", "rejected", "failed"]);

/**
 * Update the GitHub Issue when proposal status changes.
 * Updates labels to reflect new status.
 * Closes the issue on terminal states (executed, rejected, failed).
 */
export const ghUpdateStatus = (proposal: Proposal): void => {
  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;

  const labels = buildLabels(proposal);

  // Remove old status labels, add new ones
  gh(
    "issue", "edit",
    String(issueNumber),
    "--remove-label", "dao-status:open,dao-status:approved,dao-status:controlled,dao-status:rejected,dao-status:executed,dao-status:failed",
  );

  gh(
    "issue", "edit",
    String(issueNumber),
    "--add-label", labels.join(","),
  );

  // Close the issue on terminal states
  if (TERMINAL_STATES.has(proposal.status)) {
    const reason = proposal.status === "executed" ? "completed"
      : proposal.status === "rejected" ? "not planned"
      : "not planned";
    gh("issue", "close", String(issueNumber), "--reason", reason);
  }
};

/**
 * Add deliberation votes as comments on the proposal issue.
 * Called after dao_deliberate completes.
 */
export const ghAddDeliberation = (
  proposal: Proposal,
  agentOutputs: AgentOutput[],
  tally: { weightedFor: number; weightedAgainst: number; totalVotingWeight: number; votingAgents: number; totalAgents: number; quorumMet: boolean; approvalScore: number },
  durationMs: number
): void => {
  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;

  // Post synthesis as a comment
  const synthBody = buildSynthesisComment(proposal, tally, durationMs);
  gh("issue", "comment", String(issueNumber), "--body", synthBody);

  // Post each agent's vote as a separate comment
  for (const output of agentOutputs) {
    const vote = proposal.votes.find(v => v.agentId === output.agentId);
    if (vote) {
      const voteBody = buildVoteComment(vote, output);
      gh("issue", "comment", String(issueNumber), "--body", voteBody);
    } else if (output.error) {
      // Agent failed/timed out without voting
      const errorBody = `### ⚠️ ${output.agentName} — ERROR (${(output.durationMs / 1000).toFixed(1)}s)\n\n**Error:** ${output.error}`;
      gh("issue", "comment", String(issueNumber), "--body", errorBody);
    }
  }

  // Update status labels
  ghUpdateStatus(proposal);
};

/**
 * Add control gate results as a comment.
 * Called after dao_check completes.
 */
export const ghAddControlResult = (proposal: Proposal, result: ControlCheckResult): void => {
  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;

  const body = buildControlComment(result);
  gh("issue", "comment", String(issueNumber), "--body", body);

  // Update status if changed
  ghUpdateStatus(proposal);
};

/**
 * Add execution result as a comment.
 * Called after dao_execute completes.
 */
export const ghAddExecution = (proposal: Proposal, result: string): void => {
  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;

  const body = buildExecutionComment(result);
  gh("issue", "comment", String(issueNumber), "--body", body);

  // Update status
  ghUpdateStatus(proposal);
};

/**
 * Add artefacts summary as a comment.
 * Called after dao_artefacts generates documents.
 */
export const ghAddArtefacts = (proposal: Proposal, artefactCount: number): void => {
  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;

  const body = `## 📚 Artefacts Generated\n\n${artefactCount} artefacts generated:\n\n- 📋 Decision Brief\n- 🏗️ ADR\n- 🔒 Risk Report\n- 📝 PRD Lite\n- 🗂️ Implementation Plan\n- 🧪 Test Plan\n- 📦 Release Packet`;
  gh("issue", "comment", String(issueNumber), "--body", body);
};

/**
 * Add delivery plan as a comment.
 * Called after dao_plan generates a plan.
 */
export const ghAddPlan = (proposal: Proposal, plan: string): void => {
  const issueNumber = issueMap.get(proposal.id);
  if (!issueNumber) return;

  gh("issue", "comment", String(issueNumber), "--body", `## 🗂️ Delivery Plan\n\n${plan}`);
};

/**
 * Add an audit log entry as a comment.
 * Generic fallback for any DAO event.
 */
export const ghAddAuditEntry = (
  proposalId: number,
  layer: string,
  action: string,
  details: string
): void => {
  const issueNumber = issueMap.get(proposalId);
  if (!issueNumber) return;

  const layerLabels: Record<string, string> = {
    governance: "🗳️ Governance",
    intelligence: "🧠 Intelligence",
    control: "🛡️ Control",
    delivery: "🚀 Delivery",
  };

  const body = `**${layerLabels[layer] || layer}** — ${action}\n\n${details}`;
  gh("issue", "comment", String(issueNumber), "--body", body);
};

/**
 * Restore issue map from existing GitHub Issues on startup.
 * Scans open and closed issues with the dao-proposal label.
 */
export const ghRestoreState = (): Map<number, number> => {
  try {
    const result = gh(
      "issue", "list",
      "--label", "dao-proposal",
      "--state", "all",
      "--limit", "100",
      "--json", "number,title",
    );

    if (!result) return issueMap;

    const issues = JSON.parse(result);
    for (const issue of issues) {
      // Extract proposal ID from title: "Proposal #N: ..."
      const match = issue.title.match(/^Proposal #(\d+):/);
      if (match) {
        issueMap.set(parseInt(match[1], 10), issue.number);
      }
    }

    return issueMap;
  } catch {
    return issueMap;
  }
};
