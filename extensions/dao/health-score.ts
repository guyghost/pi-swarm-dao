// ============================================================
// pi-swarm-dao — Governance Health Score Engine (Proposal #19)
// ============================================================
// Computes a composite health score (0-100) from 4 metrics:
//   passRate, avgRating, deliberationDepth, participation
// with week-over-week snapshots and trend tracking.
// ============================================================

import { getState, setState } from "./persistence.js";
import type {
  HealthScore,
  HealthMetric,
  HealthSnapshot,
  HealthWeights,
  Proposal,
  ProposalOutcome,
} from "./types.js";

const DEFAULT_WEIGHTS: HealthWeights = {
  passRate: 25,
  avgRating: 25,
  deliberationDepth: 25,
  participation: 25,
};

/** Minimum proposals needed for a meaningful score */
const MIN_PROPOSALS = 3;

/** Get effective weights from config or fall back to defaults */
export const getWeights = (): HealthWeights => {
  return getState().config.healthWeights ?? { ...DEFAULT_WEIGHTS };
};

/** Validate that weights are positive and sum to 100 */
export const validateWeights = (weights: HealthWeights): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  const keys = ["passRate", "avgRating", "deliberationDepth", "participation"] as const;
  for (const k of keys) {
    if (typeof weights[k] !== "number" || weights[k] < 0) {
      errors.push(`${k} must be a positive number, got ${weights[k]}`);
    }
  }
  const sum = keys.reduce((s, k) => s + weights[k], 0);
  if (sum !== 100) {
    errors.push(`Weights must sum to 100, got ${sum}`);
  }
  return { valid: errors.length === 0, errors };
};

// ── Metric Computations ────────────────────────────────────

/** Compute pass rate from proposals */
const computePassRate = (proposals: Proposal[]): { raw: number; normalized: number } => {
  const resolved = proposals.filter(
    (p) => p.status === "approved" || p.status === "controlled" || p.status === "executed" || p.status === "rejected"
  );
  if (resolved.length === 0) return { raw: 0, normalized: 0 };
  const passed = resolved.filter(
    (p) => p.status === "approved" || p.status === "controlled" || p.status === "executed"
  ).length;
  const raw = passed / resolved.length;
  return { raw, normalized: Math.round(raw * 100) };
};

/** Compute average outcome rating from proposals */
const computeAvgRating = (proposals: Proposal[], outcomes: Record<number, ProposalOutcome>): { raw: number; normalized: number } => {
  const rated = proposals
    .map((p) => outcomes[p.id])
    .filter((o): o is ProposalOutcome => !!o && o.ratings.length > 0);
  if (rated.length === 0) return { raw: 0, normalized: 0 };
  const raw = rated.reduce((s, o) => s + o.overallScore, 0) / rated.length;
  // 1-5 scale → 0-100
  return { raw, normalized: Math.round((raw / 5) * 100) };
};

/** Compute deliberation depth (avg agent outputs per proposal) */
const computeDeliberationDepth = (proposals: Proposal[]): { raw: number; normalized: number } => {
  const withOutputs = proposals.filter((p) => p.agentOutputs.length > 0);
  if (withOutputs.length === 0) return { raw: 0, normalized: 0 };
  const totalAgents = getState().agents.length || 1;
  const raw = withOutputs.reduce((s, p) => s + p.agentOutputs.length, 0) / withOutputs.length;
  // Normalize against total agents (max depth = all agents participated)
  const normalized = Math.min(100, Math.round((raw / totalAgents) * 100));
  return { raw, normalized };
};

/** Compute agent participation rate across proposals */
const computeParticipation = (proposals: Proposal[]): { raw: number; normalized: number } => {
  const totalAgents = getState().agents.length;
  if (totalAgents === 0) return { raw: 0, normalized: 0 };
  const withOutputs = proposals.filter((p) => p.agentOutputs.length > 0);
  if (withOutputs.length === 0) return { raw: 0, normalized: 0 };
  const raw = withOutputs.reduce((s, p) => {
    const uniqueAgents = new Set(p.agentOutputs.map((o) => o.agentId)).size;
    return s + uniqueAgents / totalAgents;
  }, 0) / withOutputs.length;
  return { raw, normalized: Math.round(raw * 100) };
};

// ── Core Computation ───────────────────────────────────────

/** Compute the governance health score from current state */
export const computeHealthScore = (
  proposals?: Proposal[],
  weights?: HealthWeights,
): HealthScore => {
  const state = getState();
  const targetProposals = proposals ?? state.proposals;
  const effectiveWeights = weights ?? getWeights();

  if (targetProposals.length < MIN_PROPOSALS) {
    return {
      score: 0,
      label: "—",
      metrics: [],
      insufficientData: true,
      proposalCount: targetProposals.length,
    };
  }

  const passRate = computePassRate(targetProposals);
  const avgRating = computeAvgRating(targetProposals, state.outcomes);
  const deliberationDepth = computeDeliberationDepth(targetProposals);
  const participation = computeParticipation(targetProposals);

  const metrics: HealthMetric[] = [
    {
      name: "Pass Rate",
      rawValue: passRate.raw,
      normalizedScore: passRate.normalized,
      weight: effectiveWeights.passRate,
      contribution: (passRate.normalized * effectiveWeights.passRate) / 100,
      displayValue: `${passRate.normalized}% pass rate`,
    },
    {
      name: "Avg Outcome Rating",
      rawValue: avgRating.raw,
      normalizedScore: avgRating.normalized,
      weight: effectiveWeights.avgRating,
      contribution: (avgRating.normalized * effectiveWeights.avgRating) / 100,
      displayValue: avgRating.raw > 0 ? `${avgRating.raw.toFixed(1)}/5 avg rating` : "No ratings yet",
    },
    {
      name: "Deliberation Depth",
      rawValue: deliberationDepth.raw,
      normalizedScore: deliberationDepth.normalized,
      weight: effectiveWeights.deliberationDepth,
      contribution: (deliberationDepth.normalized * effectiveWeights.deliberationDepth) / 100,
      displayValue: `${deliberationDepth.raw.toFixed(1)} avg agent outputs`,
    },
    {
      name: "Agent Participation",
      rawValue: participation.raw,
      normalizedScore: participation.normalized,
      weight: effectiveWeights.participation,
      contribution: (participation.normalized * effectiveWeights.participation) / 100,
      displayValue: `${participation.normalized}% participation`,
    },
  ];

  const score = Math.round(metrics.reduce((s, m) => s + m.contribution, 0));

  // Label based on score
  let label: string;
  if (score >= 80) label = "🟢 Healthy";
  else if (score >= 60) label = "🟡 Moderate";
  else if (score >= 40) label = "🟠 At Risk";
  else label = "🔴 Critical";

  return {
    score,
    label,
    metrics,
    insufficientData: false,
    proposalCount: targetProposals.length,
  };
};

// ── Week Key Utilities ─────────────────────────────────────

/** Get ISO week number from date */
const getISOWeek = (date: Date): number => {
  const tmp = new Date(date.getTime());
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 4 - (tmp.getDay() || 7));
  const yearStart = new Date(tmp.getFullYear(), 0, 1);
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
};

/** Get week key for a date */
export const getWeekKey = (date: Date): string => {
  const year = date.getFullYear();
  const week = getISOWeek(date);
  return `${year}-W${String(week).padStart(2, "0")}`;
};

/** Get current week key */
export const getCurrentWeekKey = (): string => getWeekKey(new Date());

/** Parse year and week from week key */
export const parseWeekKey = (key: string): { year: number; week: number } => {
  const [year, weekStr] = key.split("-W");
  return { year: parseInt(year, 10), week: parseInt(weekStr, 10) };
};

// ── Snapshotting ───────────────────────────────────────────

/** Get all existing health snapshots */
export const getHealthSnapshots = (): HealthSnapshot[] => {
  return getState().healthSnapshots ?? [];
};

/** Take a snapshot of the current health score for this week */
export const snapshotWeeklyScore = (): HealthSnapshot => {
  const state = getState();
  const now = new Date();
  const weekKey = getWeekKey(now);
  const { year, week } = parseWeekKey(weekKey);

  const score = computeHealthScore();

  const snapshot: HealthSnapshot = {
    weekKey,
    year,
    week,
    score: score.insufficientData ? 0 : score.score,
    metrics: score.metrics.map((m) => ({ ...m })),
    proposalCount: score.proposalCount,
    createdAt: now.toISOString(),
  };

  // Replace existing snapshot for this week or append
  const existing = state.healthSnapshots ?? [];
  const idx = existing.findIndex((s) => s.weekKey === weekKey);

  if (idx >= 0) {
    existing[idx] = snapshot;
  } else {
    existing.push(snapshot);
  }

  // Keep only last 52 weeks
  if (existing.length > 52) {
    existing.sort((a, b) => (a.weekKey > b.weekKey ? 1 : -1));
    existing.splice(0, existing.length - 52);
  }

  state.healthSnapshots = existing;
  setState(state);
  return snapshot;
};

/** Compute trend from snapshots */
export interface HealthTrend {
  current: number | null;
  previous: number | null;
  direction: "↑" | "↓" | "→" | "—";
  delta: number | null;
  weeks: { weekKey: string; score: number | null }[];
}

/** Get trend over the last N weeks */
export const getHealthTrend = (weekCount: number = 8): HealthTrend => {
  const snapshots = getHealthSnapshots().sort((a, b) =>
    a.weekKey > b.weekKey ? 1 : -1,
  );

  const currentWeek = getCurrentWeekKey();
  const currentSnapshot = snapshots.find((s) => s.weekKey === currentWeek);

  // Build week list (most recent first)
  const weeks: { weekKey: string; score: number | null }[] = [];
  const now = new Date();

  for (let i = weekCount - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
    const key = getWeekKey(d);
    const snap = snapshots.find((s) => s.weekKey === key);
    weeks.push({
      weekKey: key,
      score: snap && snap.proposalCount >= MIN_PROPOSALS ? snap.score : null,
    });
  }

  // Find previous non-null score
  let previous: number | null = null;
  for (let i = snapshots.length - 2; i >= 0; i--) {
    if (snapshots[i].proposalCount >= MIN_PROPOSALS) {
      previous = snapshots[i].score;
      break;
    }
  }

  const current = currentSnapshot && currentSnapshot.proposalCount >= MIN_PROPOSALS
    ? currentSnapshot.score
    : null;

  let direction: "↑" | "↓" | "→" | "—" = "—";
  let delta: number | null = null;

  if (current !== null && previous !== null) {
    delta = current - previous;
    if (delta > 0) direction = "↑";
    else if (delta < 0) direction = "↓";
    else direction = "→";
  }

  return { current, previous, direction, delta, weeks };
};

// ── Formatting ─────────────────────────────────────────────

/** Format a health score for display */
export const formatHealthScore = (score: HealthScore): string => {
  if (score.insufficientData) {
    return `### 🏥 Governance Health Score\n\n**Score:** — (insufficient data: ${score.proposalCount}/${MIN_PROPOSALS} proposals)\n\n> Create and deliberate more proposals to generate a score.`;
  }

  let out = `### 🏥 Governance Health Score\n\n`;
  out += `**Score:** ${score.score}/100 ${score.label}\n`;
  out += `**Based on:** ${score.proposalCount} proposals\n\n`;

  out += `| Metric | Raw Value | Normalized | Weight | Contribution |\n`;
  out += `|--------|-----------|------------|--------|--------------|\n`;
  for (const m of score.metrics) {
    out += `| ${m.name} | ${m.displayValue} | ${m.normalizedScore} | ${m.weight}% | ${Math.round(m.contribution)} |\n`;
  }

  return out;
};

/** Format trend for display */
export const formatHealthTrend = (trend: HealthTrend): string => {
  let out = `### 📈 Week-over-Week Trend\n\n`;

  if (trend.current !== null && trend.previous !== null) {
    const sign = trend.delta! > 0 ? "+" : "";
    out += `**Direction:** ${trend.direction} (${sign}${trend.delta} vs previous)\n\n`;
  } else {
    out += `**Direction:** — (building baseline)\n\n`;
  }

  out += `| Week | Score |\n`;
  out += `|------|-------|\n`;
  for (const w of trend.weeks) {
    const shortWeek = w.weekKey.replace(/\d{4}-W/, "W");
    const score = w.score !== null ? String(w.score) : "—";
    out += `| ${shortWeek} | ${score} |\n`;
  }

  return out;
};
