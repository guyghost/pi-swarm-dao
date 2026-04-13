// ============================================================
// pi-swarm-dao — Risk Zone Classification
// ============================================================
// Green:  auto-approve + async human review
// Orange: council review + QA checklist
// Red:    formal vote + Security Council + human approval
// ============================================================

import type { Proposal, ProposalContent, RiskZone, CompositeScore } from "../types.js";
import { RISK_ZONE_DEFINITIONS } from "../types.js";

/**
 * Classify a proposal into a risk zone based on its content and composite score.
 *
 * Decision logic:
 * 1. If composite score is already computed, use its derived zone
 * 2. Otherwise, classify based on structured content fields
 */
export const classifyRiskZone = (proposal: Proposal): RiskZone => {
  // Use pre-computed score if available
  if (proposal.compositeScore) {
    return proposal.compositeScore.riskZone;
  }

  const content = proposal.content;

  // Without structured content, use heuristic from type + description
  if (!content) {
    return classifyFromType(proposal.type, proposal.description);
  }

  // Check for red-zone signals
  if (hasRedZoneSignals(content)) return "red";

  // Check for orange-zone signals
  if (hasOrangeZoneSignals(content)) return "orange";

  return "green";
};

/**
 * Red zone signals:
 * - Non-empty permissions impact with sensitive items
 * - Non-empty data impact with sensitive items
 * - Explicit high-risk mentions
 */
const hasRedZoneSignals = (content: ProposalContent): boolean => {
  // Sensitive permissions
  const sensitivePerms = content.permissionsImpact.filter((p) =>
    /auth|permission|access|credential|cookie|clipboard|host|multi-site/i.test(p)
  );
  if (sensitivePerms.length > 0) return true;

  // Sensitive data
  const sensitiveData = content.dataImpact.filter((d) =>
    /storage|pii|personal|database|sensitive|store|publication/i.test(d)
  );
  if (sensitiveData.length > 0) return true;

  // High risk mentions
  const highRiskMentions = content.risks.filter((r) =>
    /critical|severe|security breach|data leak|auth/i.test(r)
  );
  if (highRiskMentions.length > 0) return true;

  return false;
};

/**
 * Orange zone signals:
 * - Non-trivial scope
 * - Dependencies on other systems
 * - Moderate risk mentions
 */
const hasOrangeZoneSignals = (content: ProposalContent): boolean => {
  // Non-trivial scope (more than 3 items in scope)
  if (content.scopeIn.length > 3) return true;

  // Has dependencies
  if (content.dependencies.length > 0) return true;

  // Has permissions or data impact (but not sensitive enough for red)
  if (content.permissionsImpact.length > 0 || content.dataImpact.length > 0) return true;

  // Has risks mentioned
  if (content.risks.length > 0) return true;

  return false;
};

/**
 * Fallback classification from proposal type and description.
 */
const classifyFromType = (type: Proposal["type"], description: string): RiskZone => {
  // Security changes default to red
  if (type === "security-change") return "red";

  // Release changes default to orange
  if (type === "release-change") return "orange";

  // Governance changes default to orange
  if (type === "governance-change") return "orange";

  // Check description for red signals
  if (/auth|permission|credential|security|sensitive|store\s+publication/i.test(description)) {
    return "red";
  }

  // Check description for orange signals
  if (/refactor|migration|integration|api|database/i.test(description)) {
    return "orange";
  }

  return "green";
};

/**
 * Get the decision rules for a risk zone.
 */
export const getZoneRules = (zone: RiskZone) => RISK_ZONE_DEFINITIONS[zone];

/**
 * Format risk zone classification as markdown.
 */
export const formatZoneClassification = (proposal: Proposal): string => {
  const zone = classifyRiskZone(proposal);
  const rules = getZoneRules(zone);
  const zoneLabel = zone === "red" ? "🔴 Red" : zone === "orange" ? "🟠 Orange" : "🟢 Green";

  const lines = [
    `## 🚦 Risk Zone: ${zoneLabel}`,
    "",
    `**Criteria:** ${rules.criteria}`,
    `**Process:** ${rules.process}`,
    `**Human approvals required:** ${rules.humanApprovals}`,
    `**Security review:** ${rules.requiresSecurityReview ? "✅ Required" : "❌ Not required"}`,
    `**Formal vote:** ${rules.requiresFormalVote ? "✅ Required" : "❌ Not required"}`,
  ];

  return lines.join("\n");
};
