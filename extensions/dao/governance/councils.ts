// ============================================================
// pi-swarm-dao — Council-Based Validation
// ============================================================
// Each proposal type maps to one or more councils.
// A council is a group of agents with specific validation roles.
//
// Councils:
//   product-council:   Product Feature validation
//   security-council:  Security Change validation
//   delivery-council:  Technical/Release validation
//   governance-council: Governance/Policy validation
// ============================================================

import type {
  Proposal,
  ProposalType,
  Council,
  DAOAgent,
  CouncilMembership,
  Vote,
} from "../types.js";
import { PROPOSAL_COUNCIL, RISK_ZONE_DEFINITIONS } from "../types.js";
import type { RiskZone } from "../types.js";
import { getState } from "../persistence.js";

/**
 * Get the councils responsible for a proposal type.
 */
export const getCouncilsForType = (type: ProposalType): Council[] =>
  PROPOSAL_COUNCIL[type] ?? [];

/**
 * Get agents that are members of a specific council.
 */
export const getCouncilMembers = (council: Council): DAOAgent[] => {
  const agents = getState().agents;
  return agents.filter((a) =>
    a.councils?.some((c) => c.council === council)
  );
};

/**
 * Check if a specific agent is a member of any council for a proposal type.
 */
export const isAgentOnCouncil = (agentId: string, type: ProposalType): boolean => {
  const councils = getCouncilsForType(type);
  const agent = getState().agents.find((a) => a.id === agentId);
  if (!agent) return false;
  return agent.councils?.some((c) => councils.includes(c.council)) ?? false;
};

/**
 * Validate that the required councils have approved a proposal.
 * Returns validation result with details.
 */
export const validateCouncilApproval = (
  proposal: Proposal,
  votes: Vote[]
): { approved: boolean; missingCouncils: Council[]; details: string } => {
  const requiredCouncils = getCouncilsForType(proposal.type);
  const missingCouncils: Council[] = [];

  for (const council of requiredCouncils) {
    const members = getCouncilMembers(council);
    const memberIds = new Set(members.map((m) => m.id));

    // Check if at least one council member voted "for"
    const councilFor = votes.find(
      (v) => memberIds.has(v.agentId) && v.position === "for"
    );

    if (!councilFor) {
      missingCouncils.push(council);
    }
  }

  const approved = missingCouncils.length === 0;
  const details = approved
    ? `All required councils approved: ${requiredCouncils.join(", ")}`
    : `Missing approval from: ${missingCouncils.join(", ")}`;

  return { approved, missingCouncils, details };
};

/**
 * Get the required decision rules based on risk zone.
 * Used to determine the approval flow.
 */
export const getDecisionRules = (
  type: ProposalType,
  riskZone: RiskZone
): {
  humanApprovals: number;
  requiresSecurityReview: boolean;
  requiresFormalVote: boolean;
  description: string;
} => {
  const zoneDef = RISK_ZONE_DEFINITIONS[riskZone];

  // Security-type always requires security review regardless of zone
  const requiresSecurityReview =
    zoneDef.requiresSecurityReview || type === "security-change";

  // Governance-type always requires formal vote
  const requiresFormalVote =
    zoneDef.requiresFormalVote || type === "governance-change";

  return {
    humanApprovals: zoneDef.humanApprovals,
    requiresSecurityReview,
    requiresFormalVote,
    description: zoneDef.process,
  };
};

/**
 * Format council information for a proposal.
 */
export const formatCouncilInfo = (proposal: Proposal): string => {
  const councils = getCouncilsForType(proposal.type);
  const zone = proposal.riskZone ?? "green";
  const rules = getDecisionRules(proposal.type, zone);

  const lines = [
    "## 🏛️ Council Validation",
    "",
    `**Required councils:** ${councils.join(", ")}`,
    `**Risk zone:** ${zone}`,
    `**Human approvals:** ${rules.humanApprovals}`,
    `**Security review:** ${rules.requiresSecurityReview ? "Required" : "Not required"}`,
    `**Formal vote:** ${rules.requiresFormalVote ? "Required" : "Not required"}`,
    "",
    "### Council Members",
  ];

  for (const council of councils) {
    const members = getCouncilMembers(council);
    if (members.length > 0) {
      lines.push(`**${council}:**`);
      for (const m of members) {
        const membership = m.councils?.find((c) => c.council === council);
        const role = membership?.role ?? "member";
        lines.push(`- ${m.name} (${role}, weight: ${m.weight})`);
      }
    } else {
      lines.push(`**${council}:** No agents assigned — will use all agents`);
    }
    lines.push("");
  }

  return lines.join("\n");
};

/**
 * Default council memberships for the 7 standard agents.
 */
export const DEFAULT_COUNCIL_MEMBERSHIPS: Record<string, CouncilMembership[]> = {
  strategist: [{ council: "product-council", role: "lead" }],
  researcher: [{ council: "product-council", role: "member" }],
  architect: [
    { council: "product-council", role: "member" },
    { council: "delivery-council", role: "lead" },
  ],
  critic: [
    { council: "security-council", role: "lead" },
    { council: "product-council", role: "advisor" },
  ],
  prioritizer: [
    { council: "product-council", role: "member" },
    { council: "governance-council", role: "member" },
  ],
  "spec-writer": [{ council: "delivery-council", role: "member" }],
  delivery: [
    { council: "delivery-council", role: "member" },
    { council: "security-council", role: "advisor" },
  ],
};
