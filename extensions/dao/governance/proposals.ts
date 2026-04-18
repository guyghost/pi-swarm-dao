// ============================================================
// pi-swarm-dao — Proposal Management (V2 Structured)
// ============================================================

import type {
  Proposal,
  ProposalStatus,
  ProposalType,
  ProposalContent,
  PipelineStage,
} from "../types.js";
import { PROPOSAL_TYPE_LABELS } from "../types.js";
import { getState, setState } from "../persistence.js";
import { transitionProposal } from "../shell/lifecycle-manager.js";
import type { ProposalEvent, GuardContext } from "../core/states.js";

// ── Status → Event Mapping (for deprecated wrapper) ──────────

/**
 * Map a target status to the FSM event and guard context needed
 * to reach it from the current status. Used by the deprecated
 * `updateProposalStatus()` wrapper to delegate to the FSM.
 */
const statusToEvent = (
  from: ProposalStatus,
  to: ProposalStatus,
): { event: ProposalEvent; ctx: Partial<GuardContext> } => {
  const map: Record<
    string,
    { event: ProposalEvent; ctx: Partial<GuardContext> }
  > = {
    // open → deliberating
    "open:deliberating": { event: "deliberate", ctx: {} },
    // deliberating → approved
    "deliberating:approved": { event: "approve", ctx: { quorumMet: true } },
    // deliberating → rejected
    "deliberating:rejected": {
      event: "reject",
      ctx: { quorumMet: false, hasVotes: true },
    },
    // deliberating → controlled (shortcut)
    "deliberating:controlled": {
      event: "pass_gates",
      ctx: { quorumMet: true, gatesPassed: true },
    },
    // approved → controlled
    "approved:controlled": { event: "pass_gates", ctx: { gatesPassed: true } },
    // approved → rejected
    "approved:rejected": { event: "reject", ctx: {} },
    // controlled → executed
    "controlled:executed": { event: "execute", ctx: { gatesPassed: true } },
    // controlled → failed
    "controlled:failed": { event: "fail_execution", ctx: {} },
    // failed → controlled (retry)
    "failed:controlled": { event: "retry", ctx: {} },
  };

  const result = map[`${from}:${to}`];
  if (!result) {
    throw new Error(
      `Unknown status transition mapping: "${from}" → "${to}". Use transitionProposal() directly with the correct FSM event.`,
    );
  }
  return result;
};

/**
 * Create a new structured proposal.
 * Supports both legacy (title+description) and V2 (full ProposalContent) modes.
 */
export const createProposal = (
  title: string,
  type: ProposalType,
  description: string,
  proposedBy: string = "user",
  context?: string,
  content?: Partial<ProposalContent>,
  id?: number,
): Proposal => {
  const state = getState();

  const fullContent: ProposalContent | undefined = content
    ? {
        title,
        type,
        problemStatement: content.problemStatement ?? description,
        targetUser: content.targetUser ?? "user",
        expectedOutcome: content.expectedOutcome ?? description.split(".")[0],
        successMetrics: content.successMetrics ?? [],
        scopeIn: content.scopeIn ?? [description.split("\n")[0]],
        scopeOut: content.scopeOut ?? [],
        permissionsImpact: content.permissionsImpact ?? [],
        dataImpact: content.dataImpact ?? [],
        technicalOptions: content.technicalOptions ?? [],
        risks: content.risks ?? [],
        dependencies: content.dependencies ?? [],
        estimatedEffort: content.estimatedEffort ?? "TBD",
        confidenceScore: content.confidenceScore ?? 5,
        recommendedDecision: content.recommendedDecision ?? "pending",
      }
    : undefined;

  const proposalId = id ?? state.nextProposalId;

  const proposal: Proposal = {
    id: proposalId,
    title,
    type,
    description,
    context,
    content: fullContent,
    stage: "intake",
    proposedBy,
    status: "open",
    votes: [],
    agentOutputs: [],
    createdAt: new Date().toISOString(),
  };

  state.nextProposalId = Math.max(state.nextProposalId, proposalId + 1);
  state.proposals.push(proposal);
  setState(state);
  return proposal;
};

/**
 * Get a proposal by ID.
 */
export const getProposal = (id: number): Proposal | undefined =>
  getState().proposals.find((p) => p.id === id);

export interface StructuredProposalFieldUpdates {
  problemStatement?: string;
  acceptanceCriteria?: string[];
  successMetrics?: string[];
  rollbackConditions?: string[];
}

/**
 * Update the structured proposal fields used by the quality gate.
 */
export const updateProposalStructuredFields = (
  id: number,
  updates: StructuredProposalFieldUpdates,
): Proposal => {
  const state = getState();
  const proposal = state.proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`Proposal #${id} not found`);

  if (updates.problemStatement !== undefined) {
    proposal.problemStatement = updates.problemStatement;
  }

  if (updates.acceptanceCriteria !== undefined) {
    proposal.acceptanceCriteria = updates.acceptanceCriteria.length > 0
      ? updates.acceptanceCriteria.map((ac, i) => ({
          id: `AC-${i + 1}`,
          given: "Proposal is executed",
          when: "Implementation is verified",
          then: ac,
        }))
      : undefined;
  }

  if (updates.successMetrics !== undefined) {
    proposal.successMetrics = updates.successMetrics;
  }

  if (updates.rollbackConditions !== undefined) {
    proposal.rollbackConditions = updates.rollbackConditions;
  }

  setState(state);
  return proposal;
};

/**
 * List all proposals, optionally filtered by status.
 */
export const listProposals = (status?: ProposalStatus): Proposal[] => {
  const proposals = getState().proposals;
  if (status) return proposals.filter((p) => p.status === status);
  return proposals;
};

/**
 * Update a proposal's status.
 *
 * @deprecated Use `transitionProposal()` from the lifecycle manager instead.
 * This wrapper delegates to `transitionProposal()` internally, mapping the
 * target status to the appropriate FSM event. Will be removed in Phase 2.
 */
export const updateProposalStatus = async (
  id: number,
  status: ProposalStatus,
): Promise<Proposal> => {
  const state = getState();
  const proposal = state.proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`Proposal #${id} not found`);

  const from = proposal.status;

  // If already at target status, return early (idempotent)
  if (from === status) return proposal;

  // Map target status → FSM event + guard context
  const result = statusToEvent(from, status);

  // Delegate to transitionProposal
  const transitionResult = await transitionProposal(id, result.event, {
    status: from,
    ...result.ctx,
  });

  if (!transitionResult.success) {
    throw new Error(
      `Cannot transition proposal #${id} from "${from}" to "${status}": ${transitionResult.error}`,
    );
  }

  // Return the updated proposal
  return getState().proposals.find((p) => p.id === id)!;
};

/**
 * Update a proposal's pipeline stage.
 *
 * NOTE: This only updates the pipeline stage metadata.
 * Status changes must go through `transitionProposal()` to be
 * validated by the XState machine, fire hooks, and record audit.
 */
export const updatePipelineStage = (
  id: number,
  stage: PipelineStage,
): Proposal => {
  const state = getState();
  const proposal = state.proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`Proposal #${id} not found`);

  proposal.stage = stage;

  if (stage === "postmortem") {
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
  votes: import("../types.js").Vote[],
): Proposal => {
  const state = getState();
  const proposal = state.proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`Proposal #${id} not found`);

  proposal.agentOutputs = agentOutputs;
  proposal.synthesis = synthesis;
  proposal.votes = votes;
  setState(state);
  return proposal;
};

/**
 * Store execution result on a proposal.
 *
 * NOTE: This only stores the execution result data.
 * Status changes (e.g. controlled → executed) must go through
 * `transitionProposal()` to be validated by the XState machine,
 * fire hooks, and record audit. The caller is responsible for
 * calling `transitionProposal(id, "execute", ...)` separately.
 */
export const storeExecutionResult = (id: number, result: string): Proposal => {
  const state = getState();
  const proposal = state.proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`Proposal #${id} not found`);

  proposal.executionResult = result;
  setState(state);
  return proposal;
};

/**
 * Store composite score on a proposal.
 */
export const storeCompositeScore = (
  id: number,
  score: import("../types.js").CompositeScore,
): Proposal => {
  const state = getState();
  const proposal = state.proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`Proposal #${id} not found`);

  proposal.compositeScore = score;
  proposal.riskZone = score.riskZone;
  setState(state);
  return proposal;
};

/**
 * Format a proposal as a readable summary.
 */
export const formatProposal = (proposal: Proposal): string => {
  const typeLabel = PROPOSAL_TYPE_LABELS[proposal.type];
  const lines = [
    `## Proposal #${proposal.id}: ${proposal.title}`,
    `**Type:** ${typeLabel} | **Status:** ${proposal.status} | **Stage:** ${proposal.stage} | **By:** ${proposal.proposedBy} | **Created:** ${proposal.createdAt}`,
  ];

  // Risk zone badge
  if (proposal.riskZone) {
    const zoneLabel =
      proposal.riskZone === "red"
        ? "🔴 Red"
        : proposal.riskZone === "orange"
          ? "🟠 Orange"
          : "🟢 Green";
    lines.push(`**Risk Zone:** ${zoneLabel}`);
  }

  // Composite score badge
  if (proposal.compositeScore) {
    lines.push(`**Score:** ${proposal.compositeScore.weighted}/100`);
  }

  lines.push("");

  // Structured content
  if (proposal.content) {
    const c = proposal.content;
    lines.push("### Problem Statement");
    lines.push(c.problemStatement);
    lines.push("");
    lines.push(`**Target User:** ${c.targetUser}`);
    lines.push(`**Expected Outcome:** ${c.expectedOutcome}`);
    lines.push(`**Estimated Effort:** ${c.estimatedEffort}`);
    lines.push(`**Confidence:** ${c.confidenceScore}/10`);

    if (c.scopeIn.length > 0) {
      lines.push("");
      lines.push("**In Scope:**");
      for (const s of c.scopeIn) lines.push(`- ${s}`);
    }

    if (c.scopeOut.length > 0) {
      lines.push("");
      lines.push("**Out of Scope:**");
      for (const s of c.scopeOut) lines.push(`- ${s}`);
    }

    if (c.permissionsImpact.length > 0) {
      lines.push("");
      lines.push("**Permissions Impact:**");
      for (const p of c.permissionsImpact) lines.push(`- ${p}`);
    }

    if (c.dataImpact.length > 0) {
      lines.push("");
      lines.push("**Data Impact:**");
      for (const d of c.dataImpact) lines.push(`- ${d}`);
    }
  } else {
    lines.push(proposal.description);
  }

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
        `| ${v.agentName} | ${emoji} ${v.position} | ${v.weight} | ${v.reasoning} |`,
      );
    }
  }

  return lines.join("\n");
};

/**
 * Format proposals list for display.
 */
export const formatProposalsList = (proposals: Proposal[]): string => {
  if (proposals.length === 0) return "No proposals found.";

  const header =
    "| # | Title | Type | Status | Zone | Score | Stage | Proposed By | Created |\n|---|-------|------|--------|------|-------|-------|-------------|---------|";
  const rows = proposals
    .map((p) => {
      const zone = p.riskZone
        ? p.riskZone === "red"
          ? "🔴"
          : p.riskZone === "orange"
            ? "🟠"
            : "🟢"
        : "⚪";
      const score = p.compositeScore ? `${p.compositeScore.weighted}` : "—";
      return `| ${p.id} | ${p.title} | ${PROPOSAL_TYPE_LABELS[p.type]} | ${p.status} | ${zone} | ${score} | ${p.stage} | ${p.proposedBy} | ${p.createdAt.split("T")[0]} |`;
    })
    .join("\n");
  return `${header}\n${rows}`;
};
