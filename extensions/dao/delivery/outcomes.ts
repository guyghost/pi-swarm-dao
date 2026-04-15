// ============================================================
// pi-swarm-dao — Outcome Tracking & Success Metrics (Proposal #6)
// ============================================================
// Tracks proposal outcomes post-execution: user ratings,
// before/after metrics, and dashboard aggregation.
// ============================================================

import { getState, setState } from "../persistence.js";
import type { OutcomeRating, MetricSnapshot, ProposalOutcome } from "../types.js";

/** Get the outcome record for a proposal (or undefined). */
export const getOutcome = (proposalId: number): ProposalOutcome | undefined => {
  return getState().outcomes[proposalId];
};

/** Create an initial outcome record for a proposal. */
export const initOutcome = (proposalId: number): ProposalOutcome => {
  const state = getState();
  if (state.outcomes[proposalId]) return state.outcomes[proposalId];

  const outcome: ProposalOutcome = {
    proposalId,
    ratings: [],
    metrics: [],
    overallScore: 0,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  state.outcomes[proposalId] = outcome;
  setState(state);
  return outcome;
};

/** Add a rating to a proposal outcome. */
export const addRating = (
  proposalId: number,
  rater: string,
  score: 1 | 2 | 3 | 4 | 5,
  comment: string,
): ProposalOutcome => {
  const state = getState();
  let outcome = state.outcomes[proposalId];

  if (!outcome) {
    outcome = initOutcome(proposalId);
    // Re-read from state after init
    outcome = state.outcomes[proposalId]!;
  }

  // Check if this rater already rated — update if so
  const existingIdx = outcome.ratings.findIndex(r => r.rater === rater);
  const rating: OutcomeRating = {
    proposalId,
    rater,
    score,
    comment,
    ratedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    outcome.ratings[existingIdx] = rating;
  } else {
    outcome.ratings.push(rating);
  }

  // Recalculate overall score
  outcome.overallScore = outcome.ratings.reduce((sum, r) => sum + r.score, 0) / outcome.ratings.length;
  outcome.status = "tracked";
  outcome.updatedAt = new Date().toISOString();

  setState(state);
  return outcome;
};

/** Add a before/after metric snapshot. */
export const addMetric = (
  proposalId: number,
  name: string,
  before: string,
  after: string,
  unit?: string,
): ProposalOutcome => {
  const state = getState();
  let outcome = state.outcomes[proposalId];

  if (!outcome) {
    outcome = initOutcome(proposalId);
    outcome = state.outcomes[proposalId]!;
  }

  const metric: MetricSnapshot = {
    name,
    before,
    after,
    unit,
    capturedAt: new Date().toISOString(),
  };

  outcome.metrics.push(metric);
  outcome.updatedAt = new Date().toISOString();
  setState(state);
  return outcome;
};

/** Mark an outcome as reviewed. */
export const markReviewed = (proposalId: number): ProposalOutcome | null => {
  const state = getState();
  const outcome = state.outcomes[proposalId];
  if (!outcome) return null;

  outcome.status = "reviewed";
  outcome.updatedAt = new Date().toISOString();
  setState(state);
  return outcome;
};

/** Generate a dashboard summary of all tracked outcomes. */
export const generateDashboard = (): string => {
  const state = getState();
  const outcomes = Object.values(state.outcomes);

  if (outcomes.length === 0) {
    return "📊 **Outcome Dashboard**\n\nNo outcomes tracked yet. Execute proposals and rate them to see metrics.";
  }

  const totalTracked = outcomes.length;
  const rated = outcomes.filter(o => o.ratings.length > 0);
  const avgScore = rated.length > 0
    ? rated.reduce((s, o) => s + o.overallScore, 0) / rated.length
    : 0;

  // By status
  const byStatus = {
    pending: outcomes.filter(o => o.status === "pending").length,
    tracked: outcomes.filter(o => o.status === "tracked").length,
    reviewed: outcomes.filter(o => o.status === "reviewed").length,
  };

  // Score distribution
  const distribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const o of rated) {
    for (const r of o.ratings) {
      distribution[String(r.score)]++;
    }
  }

  let dash = `📊 **Outcome Dashboard**\n\n`;
  dash += `| Metric | Value |\n`;
  dash += `|--------|-------|\n`;
  dash += `| Total Tracked | ${totalTracked} |\n`;
  dash += `| Rated | ${rated.length} |\n`;
  dash += `| Average Score | ${avgScore.toFixed(1)}/5 |\n`;
  dash += `| Pending Review | ${byStatus.pending} |\n`;
  dash += `| In Progress | ${byStatus.tracked} |\n`;
  dash += `| Reviewed | ${byStatus.reviewed} |\n`;

  dash += `\n### Score Distribution\n`;
  dash += `\`\`\`\n`;
  for (let i = 5; i >= 1; i--) {
    const count = distribution[String(i)] || 0;
    const bar = "█".repeat(count) + "░".repeat(Math.max(0, 10 - count));
    dash += `${i} ★ ${bar} (${count})\n`;
  }
  dash += `\`\`\`\n`;

  // Per-proposal breakdown
  if (rated.length > 0) {
    dash += `\n### Proposal Outcomes\n\n`;
    for (const o of rated.sort((a, b) => b.overallScore - a.overallScore)) {
      const stars = "★".repeat(Math.round(o.overallScore)) + "☆".repeat(5 - Math.round(o.overallScore));
      dash += `- **#${o.proposalId}** ${stars} ${o.overallScore.toFixed(1)}/5 (${o.ratings.length} rating${o.ratings.length > 1 ? "s" : ""}) — ${o.status}\n`;
    }
  }

  return dash;
};
