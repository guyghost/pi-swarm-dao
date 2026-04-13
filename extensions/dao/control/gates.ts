import type {
  Proposal,
  AgentOutput,
  Vote,
  GateResult,
  ControlCheckResult,
  DAOAgent,
  ProposalType,
} from "../types.js";
import { getState, setState } from "../persistence.js";

// ── Helpers ──────────────────────────────────────────────────

const findOutput = (proposal: Proposal, agentId: string): AgentOutput | undefined =>
  proposal.agentOutputs.find((o) => o.agentId === agentId);

const findVote = (proposal: Proposal, agentId: string): Vote | undefined =>
  proposal.votes.find((v) => v.agentId === agentId);

const getAgent = (agentId: string): DAOAgent | undefined =>
  getState().agents.find((a) => a.id === agentId);

const parseRiskScore = (content: string): number | null => {
  const match = content.match(/Risk Score:\s*(\d+)\s*\/\s*10/i);
  return match ? parseInt(match[1], 10) : null;
};

/**
 * Return a modified severity for certain gates based on the proposal type.
 * - security proposals: risk-threshold promoted from warning → blocker
 * - release proposals: delivery-feasibility promoted from warning → blocker
 */
const getTypeSpecificSeverity = (
  gateId: string,
  baseSeverity: GateResult["severity"],
  proposalType: ProposalType
): GateResult["severity"] => {
  if (proposalType === "security" && gateId === "risk-threshold" && baseSeverity === "warning") {
    return "blocker";
  }
  if (proposalType === "release" && gateId === "delivery-feasibility" && baseSeverity === "warning") {
    return "blocker";
  }
  return baseSeverity;
};

// ── Individual Gates ─────────────────────────────────────────

/**
 * quorum-quality: Verify quorum was met and vote count is reasonable.
 * PASS if: votingAgents / totalAgents >= config.quorumPercent / 100
 */
const gateQuorumQuality = (proposal: Proposal): GateResult => {
  const config = getState().config;
  const totalAgents = getState().agents.length;
  const votingAgents = proposal.votes.filter((v) => v.position !== "abstain").length;
  const participation = totalAgents > 0 ? votingAgents / totalAgents : 0;
  const passed = participation * 100 >= config.quorumPercent;

  return {
    gateId: "quorum-quality",
    name: "Quorum Quality",
    passed,
    severity: "blocker",
    message: passed
      ? `Quorum met: ${(participation * 100).toFixed(1)}% participation (${votingAgents}/${totalAgents} agents)`
      : `Quorum NOT met: ${(participation * 100).toFixed(1)}% participation (${votingAgents}/${totalAgents} agents), requires ${config.quorumPercent}%`,
    details: { votingAgents, totalAgents, participation: Math.round(participation * 1000) / 10 },
  };
};

/**
 * risk-threshold: Parse risk score from Critic agent output.
 * PASS if: risk score < config.riskThreshold.
 * If risk score >= threshold → WARNING (not blocker).
 */
const gateRiskThreshold = (proposal: Proposal): GateResult => {
  const config = getState().config;
  const criticOutput = findOutput(proposal, "critic");

  if (!criticOutput) {
    return {
      gateId: "risk-threshold",
      name: "Risk Threshold",
      passed: false,
      severity: "warning",
      message: "No Critic agent output found — cannot assess risk",
    };
  }

  const score = parseRiskScore(criticOutput.content);

  if (score === null) {
    return {
      gateId: "risk-threshold",
      name: "Risk Threshold",
      passed: false,
      severity: "warning",
      message: "Could not parse risk score from Critic output",
    };
  }

  const passed = score < config.riskThreshold;

  return {
    gateId: "risk-threshold",
    name: "Risk Threshold",
    passed,
    severity: "warning",
    message: passed
      ? `Risk score ${score}/10 is below threshold ${config.riskThreshold}`
      : `Risk score ${score}/10 meets or exceeds threshold ${config.riskThreshold} — review recommended`,
    details: { riskScore: score, threshold: config.riskThreshold },
  };
};

/**
 * vote-consensus: Check no high-weight agent (weight >= 3) voted against.
 * PASS if: no agent with weight >= 3 voted against.
 * Severity: warning (advisory).
 */
const gateVoteConsensus = (proposal: Proposal): GateResult => {
  const highWeightAgainst = proposal.votes.filter(
    (v) => v.weight >= 3 && v.position === "against",
  );

  const passed = highWeightAgainst.length === 0;

  return {
    gateId: "vote-consensus",
    name: "Vote Consensus",
    passed,
    severity: "warning",
    message: passed
      ? "No high-weight agents voted against"
      : `${highWeightAgainst.length} high-weight agent(s) voted against: ${highWeightAgainst.map((v) => `${v.agentName} (w:${v.weight})`).join(", ")}`,
    details: {
      dissentingAgents: highWeightAgainst.map((v) => ({
        agentId: v.agentId,
        name: v.agentName,
        weight: v.weight,
        reasoning: v.reasoning,
      })),
    },
  };
};

/**
 * spec-completeness: Verify Spec Writer produced user stories.
 * PASS if: spec-writer output contains "US-" markers.
 */
const gateSpecCompleteness = (proposal: Proposal): GateResult => {
  const specOutput = findOutput(proposal, "spec-writer");

  if (!specOutput) {
    return {
      gateId: "spec-completeness",
      name: "Spec Completeness",
      passed: false,
      severity: "info",
      message: "No Spec Writer output found",
    };
  }

  const hasStories = /US-\d/i.test(specOutput.content);

  return {
    gateId: "spec-completeness",
    name: "Spec Completeness",
    passed: hasStories,
    severity: "info",
    message: hasStories
      ? "Spec Writer produced user stories"
      : "No user story markers (US-N) found in Spec Writer output",
  };
};

/**
 * delivery-feasibility: Verify Delivery Agent didn't flag as undeliverable.
 * PASS if: delivery agent voted "for" or "abstain".
 */
const gateDeliveryFeasibility = (proposal: Proposal): GateResult => {
  const deliveryVote = findVote(proposal, "delivery");

  if (!deliveryVote) {
    return {
      gateId: "delivery-feasibility",
      name: "Delivery Feasibility",
      passed: false,
      severity: "warning",
      message: "No Delivery Agent vote found",
    };
  }

  const passed = deliveryVote.position !== "against";

  return {
    gateId: "delivery-feasibility",
    name: "Delivery Feasibility",
    passed,
    severity: "warning",
    message: passed
      ? `Delivery Agent voted "${deliveryVote.position}" — feasible`
      : `Delivery Agent voted "against" — flagged as undeliverable: ${deliveryVote.reasoning}`,
    details: { position: deliveryVote.position, reasoning: deliveryVote.reasoning },
  };
};

/**
 * agent-registry-compliance: Verify all agents have complete registry fields.
 * PASS if: every agent has owner, mission, riskLevel, and lastReviewDate.
 */
const gateRegistryCompliance = (_proposal: Proposal): GateResult => {
  const agents = getState().agents;
  const incomplete = agents.filter(a =>
    !a.owner || !a.mission || !a.riskLevel || !a.lastReviewDate
  );

  const passed = incomplete.length === 0;

  return {
    gateId: "agent-registry-compliance",
    name: "Agent Registry Compliance",
    passed,
    severity: "info",
    message: passed
      ? `All ${agents.length} agents have complete registry cards`
      : `${incomplete.length} agent(s) have incomplete registry: ${incomplete.map(a => a.id).join(", ")}`,
    details: { incompleteAgents: incomplete.map(a => a.id) },
  };
};

// ── Gate Registry ────────────────────────────────────────────

type GateFn = (proposal: Proposal) => GateResult;

const GATES: Record<string, GateFn> = {
  "quorum-quality": gateQuorumQuality,
  "risk-threshold": gateRiskThreshold,
  "vote-consensus": gateVoteConsensus,
  "spec-completeness": gateSpecCompleteness,
  "delivery-feasibility": gateDeliveryFeasibility,
  "agent-registry-compliance": gateRegistryCompliance,
};

// ── Public API ───────────────────────────────────────────────

/**
 * Run all configured gates against a proposal.
 * Stores the result in state.controlResults[proposalId].
 */
export const runGates = (proposal: Proposal): ControlCheckResult => {
  const config = getState().config;
  const gatesToRun = config.requiredGates.filter((id) => GATES[id]);

  // Always run all gates for visibility, but only required ones count for pass/fail
  const allGateIds = [...new Set([...gatesToRun, ...Object.keys(GATES)])];
  const gates = allGateIds.map((id) => {
    const result = GATES[id](proposal);
    // Apply type-specific severity overrides
    result.severity = getTypeSpecificSeverity(result.gateId, result.severity, proposal.type);
    return result;
  });

  const blockers = gates.filter((g) => !g.passed && g.severity === "blocker");
  const requiredBlockers = gates.filter(
    (g) => !g.passed && g.severity === "blocker" && config.requiredGates.includes(g.gateId),
  );
  const warnings = gates.filter((g) => !g.passed && g.severity === "warning");

  const result: ControlCheckResult = {
    proposalId: proposal.id,
    timestamp: new Date().toISOString(),
    allGatesPassed: requiredBlockers.length === 0,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    gates,
    checklist: [],
  };

  // Persist
  const state = getState();
  state.controlResults[proposal.id] = result;
  setState(state);

  return result;
};
