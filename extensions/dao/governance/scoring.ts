// ============================================================
// pi-swarm-dao — Composite Scoring Engine (RICE + Custom Axes)
// ============================================================
// Two scoring systems:
//
// 1. RICE Framework (Proposal #5):
//    Reach × Impact × Confidence / Effort
//    Industry-standard prioritization scoring
//
// 2. Custom Composite (original):
//    Weighted scoring on 100 points:
//    User Impact: 30%, Business Impact: 20%, Effort: 15% (inv),
//    Security Risk: 20% (inv), Confidence: 15%
// ============================================================

import type { AxisScore, CompositeScore, RiskZone, ProposalContent, Proposal, RICEScore } from "../types.js";
import { SCORING_WEIGHTS } from "../types.js";

/**
 * Calculate the composite score from individual axis scores (0-10 each).
 * Effort and Security Risk are inverted (low = good).
 * Returns a score from 0 to 100.
 */
export const calculateCompositeScore = (axes: AxisScore): CompositeScore => {
  // Invert effort and security risk (lower is better → higher score)
  const adjustedUserImpact = axes.userImpact;
  const adjustedBusinessImpact = axes.businessImpact;
  const adjustedEffort = 10 - axes.effort;       // invert: effort 2 → score 8
  const adjustedSecurityRisk = 10 - axes.securityRisk; // invert: risk 8 → score 2
  const adjustedConfidence = axes.confidence;

  const raw =
    adjustedUserImpact * SCORING_WEIGHTS.userImpact +
    adjustedBusinessImpact * SCORING_WEIGHTS.businessImpact +
    adjustedEffort * SCORING_WEIGHTS.effort +
    adjustedSecurityRisk * SCORING_WEIGHTS.securityRisk +
    adjustedConfidence * SCORING_WEIGHTS.confidence;

  // Scale to 0-100 (raw is 0-10)
  let weighted = Math.round(raw * 10);

  // Clamp
  weighted = Math.max(0, Math.min(100, weighted));

  // Determine risk zone from composite score
  const riskZone = deriveRiskZone(weighted, axes);

  // Build breakdown
  const breakdown = buildBreakdown(axes, weighted);

  return { axes, weighted, riskZone, breakdown };
};

/**
 * Derive risk zone from composite score and axis values.
 *
 * Red:   securityRisk >= 7 OR weighted < 35
 * Orange: securityRisk >= 4 OR weighted < 60
 * Green: everything else
 */
export const deriveRiskZone = (weighted: number, axes: AxisScore): RiskZone => {
  if (axes.securityRisk >= 7 || weighted < 35) return "red";
  if (axes.securityRisk >= 4 || weighted < 60) return "orange";
  return "green";
};

/**
 * Apply permission/data malus to a composite score.
 * Returns a new CompositeScore with adjusted values.
 */
export const applyMalus = (
  score: CompositeScore,
  permissionsImpact: string[],
  dataImpact: string[]
): CompositeScore => {
  let adjusted = score.weighted;

  // Malus for sensitive permissions
  const sensitivePermissions = permissionsImpact.filter((p) =>
    /auth|permission|access|credential|cookie|clipboard|host/i.test(p)
  );
  if (sensitivePermissions.length > 0) {
    adjusted -= 15;
  }

  // Malus for data access expansion
  const sensitiveData = dataImpact.filter((d) =>
    /storage|pii|personal|database|api|sensitive/i.test(d)
  );
  if (sensitiveData.length > 0) {
    adjusted -= 10;
  }

  adjusted = Math.max(0, Math.min(100, adjusted));

  // Re-derive risk zone
  const riskZone = deriveRiskZone(adjusted, score.axes);

  return {
    ...score,
    weighted: adjusted,
    riskZone,
    breakdown: buildBreakdown(score.axes, adjusted),
  };
};

/**
 * Parse axis scores from agent outputs (Prioritizer agent primarily).
 * Falls back to heuristic scoring if no structured data found.
 */
export const parseScoresFromOutput = (proposal: Proposal): AxisScore => {
  const prioritizer = proposal.agentOutputs.find((o) => o.agentId === "prioritizer");
  const critic = proposal.agentOutputs.find((o) => o.agentId === "critic");

  // Try to parse from prioritizer output
  if (prioritizer && !prioritizer.error) {
    const content = prioritizer.content;
    const scores = parseAxisFromText(content);
    if (scores) return scores;
  }

  // Fallback: estimate from proposal content
  return estimateAxes(proposal, critic?.content);
};

/**
 * Try to parse structured axis scores from text.
 */
const parseAxisFromText = (text: string): AxisScore | null => {
  const patterns: Record<keyof AxisScore, RegExp> = {
    userImpact: /(?:user\s+impact|impact\s+utilisateur)\s*[:=]?\s*(\d+)/i,
    businessImpact: /(?:business\s+impact)\s*[:=]?\s*(\d+)/i,
    effort: /(?:effort|implementation\s+cost)\s*[:=]?\s*(\d+)/i,
    securityRisk: /(?:security\s+risk|risk\s+level)\s*[:=]?\s*(\d+)/i,
    confidence: /(?:confidence|strategic\s+alignment)\s*[:=]?\s*(\d+)/i,
  };

  const scores: Partial<AxisScore> = {};
  let found = 0;

  for (const [key, regex] of Object.entries(patterns)) {
    const match = text.match(regex);
    if (match) {
      (scores as any)[key] = Math.max(1, Math.min(10, parseInt(match[1], 10)));
      found++;
    }
  }

  if (found >= 3) {
    return {
      userImpact: scores.userImpact ?? 5,
      businessImpact: scores.businessImpact ?? 5,
      effort: scores.effort ?? 5,
      securityRisk: scores.securityRisk ?? 5,
      confidence: scores.confidence ?? 5,
    };
  }

  return null;
};

/**
 * Estimate axis scores heuristically from proposal data.
 */
const estimateAxes = (proposal: Proposal, criticContent?: string): AxisScore => {
  const content = proposal.content;
  const desc = proposal.description.toLowerCase();

  // Estimate security risk from critic output or content
  let securityRisk = 3; // baseline
  if (criticContent) {
    const riskMatch = criticContent.match(/Risk\s+Score:\s*(\d+)\s*\/\s*10/i);
    if (riskMatch) securityRisk = parseInt(riskMatch[1], 10);
  }
  if (content?.permissionsImpact.length || content?.dataImpact.length) {
    securityRisk = Math.max(securityRisk, 4);
  }
  if (/auth|permission|credential|security/i.test(desc)) {
    securityRisk = Math.max(securityRisk, 6);
  }

  // Estimate effort
  let effort = 5;
  const effortStr = content?.estimatedEffort ?? "";
  if (/hour|day/i.test(effortStr)) effort = 3;
  if (/week/i.test(effortStr)) effort = 5;
  if (/month|sprint/i.test(effortStr)) effort = 7;
  if (content?.dependencies?.length) effort = Math.min(10, effort + content.dependencies.length);

  // Confidence from content or proposal field
  const confidence = content?.confidenceScore ?? 5;

  return {
    userImpact: 6,
    businessImpact: 5,
    effort,
    securityRisk,
    confidence,
  };
};

/**
 * Build a human-readable breakdown string.
 */
const buildBreakdown = (axes: AxisScore, total: number): string => {
  const parts = [
    `User Impact: ${axes.userImpact}/10 × 30% = ${((axes.userImpact) * SCORING_WEIGHTS.userImpact * 10).toFixed(1)}`,
    `Business Impact: ${axes.businessImpact}/10 × 20% = ${((axes.businessImpact) * SCORING_WEIGHTS.businessImpact * 10).toFixed(1)}`,
    `Effort: ${axes.effort}/10 (inverted: ${10 - axes.effort}) × 15% = ${((10 - axes.effort) * SCORING_WEIGHTS.effort * 10).toFixed(1)}`,
    `Security Risk: ${axes.securityRisk}/10 (inverted: ${10 - axes.securityRisk}) × 20% = ${((10 - axes.securityRisk) * SCORING_WEIGHTS.securityRisk * 10).toFixed(1)}`,
    `Confidence: ${axes.confidence}/10 × 15% = ${((axes.confidence) * SCORING_WEIGHTS.confidence * 10).toFixed(1)}`,
    `**Total: ${total}/100**`,
  ];
  return parts.join("\n");
};

/**
 * Format a CompositeScore as readable markdown.
 */
export const formatCompositeScore = (score: CompositeScore): string => {
  const zoneLabel = score.riskZone === "red" ? "🔴 Red" : score.riskZone === "orange" ? "🟠 Orange" : "🟢 Green";
  const lines = [
    `## 📊 Composite Score: ${score.weighted}/100`,
    "",
    `**Risk Zone:** ${zoneLabel}`,
    "",
    "### Axis Breakdown",
    "| Axis | Score | Weight | Adjusted |",
    "|------|-------|--------|----------|",
    `| User Impact | ${score.axes.userImpact}/10 | 30% | ${((score.axes.userImpact) * SCORING_WEIGHTS.userImpact * 10).toFixed(1)} |`,
    `| Business Impact | ${score.axes.businessImpact}/10 | 20% | ${((score.axes.businessImpact) * SCORING_WEIGHTS.businessImpact * 10).toFixed(1)} |`,
    `| Effort (inv) | ${score.axes.effort}/10 → ${10 - score.axes.effort} | 15% | ${((10 - score.axes.effort) * SCORING_WEIGHTS.effort * 10).toFixed(1)} |`,
    `| Security Risk (inv) | ${score.axes.securityRisk}/10 → ${10 - score.axes.securityRisk} | 20% | ${((10 - score.axes.securityRisk) * SCORING_WEIGHTS.securityRisk * 10).toFixed(1)} |`,
    `| Confidence | ${score.axes.confidence}/10 | 15% | ${((score.axes.confidence) * SCORING_WEIGHTS.confidence * 10).toFixed(1)} |`,
    "",
    `**Final: ${score.weighted}/100** — Zone: ${zoneLabel}`,
  ];
  return lines.join("\n");
};

// ============================================================
// RICE Scoring Framework (Proposal #5)
// ============================================================

/**
 * Calculate RICE score: Reach × Impact × Confidence / Effort
 *
 * - Reach: number of users affected per quarter
 * - Impact: 1-10 (1=minimal, 3=low, 5=medium, 7=high, 10=massive)
 * - Confidence: percentage (0-100) — how confident in estimates
 * - Effort: person-weeks (1 = 1 week of work)
 *
 * Higher RICE score = higher priority.
 */
export const calculateRICEScore = (
  reach: number,
  impact: number,
  confidence: number,
  effort: number,
): RICEScore => {
  // Clamp inputs
  const r = Math.max(1, reach);
  const i = Math.max(1, Math.min(10, impact));
  const c = Math.max(1, Math.min(100, confidence));
  const e = Math.max(0.5, effort); // avoid division by zero, min 0.5 week

  const riceScore = Math.round((r * i * (c / 100)) / e);

  return {
    reach: r,
    impact: i,
    confidence: c,
    effort: e,
    riceScore,
  };
};

/**
 * Parse RICE estimates from agent outputs.
 * The Prioritization Agent is the primary source.
 */
export const parseRICEFromOutput = (proposal: Proposal): RICEScore | null => {
  const prioritizer = proposal.agentOutputs.find(o => o.agentId === "prioritizer");
  if (!prioritizer || prioritizer.error) return null;

  const text = prioritizer.content;

  // Try structured RICE section first
  const riceSection = text.match(/###?\s*RICE[^\n]*\n([\s\S]*?)(?=\n###|$)/i);
  const source = riceSection ? riceSection[1] : text;

  const reachMatch = source.match(/(?:Reach|Utilisateurs?)\s*[:=]??\s*(\d[\d,]*)/i);
  const impactMatch = source.match(/(?:Impact)\s*[:=]??\s*(\d+(?:\.\d+)?)/i);
  const confidenceMatch = source.match(/(?:Confidence|Confiance)\s*[:=]??\s*(\d+)%?/i);
  const effortMatch = source.match(/(?:Effort|Durée|Effort)\s*[:=]??\s*(\d+(?:\.\d+)?)\s*(?:week|semaine|person|w)?/i);

  if (!reachMatch || !impactMatch) return null;

  const reach = parseInt(reachMatch[1].replace(/,/g, ""), 10);
  const impact = parseFloat(impactMatch[1]);
  const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 70; // default 70%
  const effort = effortMatch ? parseFloat(effortMatch[1]) : estimateEffortWeeks(proposal);

  return calculateRICEScore(reach, impact, confidence, effort);
};

/**
 * Estimate effort in person-weeks from proposal content.
 */
const estimateEffortWeeks = (proposal: Proposal): number => {
  const content = proposal.content;
  const effortStr = content?.estimatedEffort?.toLowerCase() ?? "";

  if (/hour|heure/i.test(effortStr)) return 0.5;
  if (/1-?2\s*day|quelques\s*jour/i.test(effortStr)) return 0.5;
  if (/day|jour/i.test(effortStr)) return 1;
  if (/week|semaine/i.test(effortStr)) {
    const match = effortStr.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 2;
  }
  if (/month|mois|sprint/i.test(effortStr)) return 4;
  if (content?.dependencies?.length) return 1 + content.dependencies.length * 0.5;
  return 2; // default: 2 weeks
};

/**
 * Rank proposals by RICE score.
 * Sets the `rank` field on each RICEScore.
 */
export const rankByRICE = (proposals: Proposal[]): Proposal[] => {
  const withRICE = proposals.filter(p => p.riceScore);

  // Sort by RICE score descending
  withRICE.sort((a, b) => b.riceScore!.riceScore - a.riceScore!.riceScore);

  // Assign ranks
  withRICE.forEach((p, idx) => {
    p.riceScore!.rank = idx + 1;
  });

  return withRICE;
};

/**
 * Format a RICE score as readable markdown.
 */
export const formatRICEScore = (rice: RICEScore): string => {
  const lines = [
    `## 📊 RICE Score: ${rice.riceScore}${rice.rank ? ` (Rank #${rice.rank})` : ""}`,
    "",
    "| Component | Value | Description |",
    "|-----------|-------|-------------|",
    `| Reach | ${rice.reach.toLocaleString()} | Users affected per quarter |`,
    `| Impact | ${rice.impact}/10 | ${impactLabel(rice.impact)} |`,
    `| Confidence | ${rice.confidence}% | ${rice.confidence >= 80 ? "High" : rice.confidence >= 50 ? "Medium" : "Low"} certainty |`,
    `| Effort | ${rice.effort} week${rice.effort !== 1 ? "s" : ""} | Person-weeks |`,
    "",
    `**Formula:** ${rice.reach.toLocaleString()} × ${rice.impact} × (${rice.confidence}/100) / ${rice.effort} = **${rice.riceScore.toLocaleString()}**`,
  ];
  return lines.join("\n");
};

/** Human-readable impact label */
const impactLabel = (impact: number): string => {
  if (impact >= 9) return "Massive";
  if (impact >= 7) return "High";
  if (impact >= 5) return "Medium";
  if (impact >= 3) return "Low";
  return "Minimal";
};

