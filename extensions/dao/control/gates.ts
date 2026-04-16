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
import { buildDependencyGraph, checkReadiness } from "../governance/dependency-graph.js";

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
  if (proposalType === "security-change" && gateId === "risk-threshold" && baseSeverity === "warning") {
    return "blocker";
  }
  if (proposalType === "release-change" && gateId === "delivery-feasibility" && baseSeverity === "warning") {
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

/**
 * zone-compliance: Verify risk zone compliance.
 * Red zone requires security review and formal vote.
 */
const gateZoneCompliance = (proposal: Proposal): GateResult => {
  const zone = proposal.riskZone ?? "green";

  if (zone === "red") {
    // Red zone: check if critic voted for (proxy for security review)
    const criticVote = proposal.votes.find((v) => v.agentId === "critic");
    const criticApproved = criticVote?.position === "for";

    return {
      gateId: "zone-compliance",
      name: "Zone Compliance",
      passed: criticApproved,
      severity: "blocker",
      message: criticApproved
        ? "🔴 Red zone — security review passed (Critic approved)"
        : "🔴 Red zone — requires security approval. Critic agent must vote for.",
      details: { zone, criticApproved },
    };
  }

  if (zone === "orange") {
    return {
      gateId: "zone-compliance",
      name: "Zone Compliance",
      passed: true,
      severity: "warning",
      message: "🟠 Orange zone — council review recommended",
      details: { zone },
    };
  }

  return {
    gateId: "zone-compliance",
    name: "Zone Compliance",
    passed: true,
    severity: "info",
    message: "🟢 Green zone — standard approval flow",
    details: { zone },
  };
};

// ── Self-Amendment Gates ──────────────────────────────────────

/**
 * self-amendment-safety: Verify post-amendment state invariants.
 * PASS if: amendment preview doesn't violate minimum agents (≥3), total weight (≥5), quorum floor.
 * Only runs for governance-change proposals with an amendment payload.
 */
const gateSelfAmendmentSafety = (proposal: Proposal): GateResult => {
  // Only applies to governance-change proposals with amendment payload
  if (proposal.type !== "governance-change" || !proposal.amendmentPayload) {
    return {
      gateId: "self-amendment-safety",
      name: "Self-Amendment Safety",
      passed: true,
      severity: "blocker",
      message: "Not a self-amendment — gate not applicable",
    };
  }

  const state = getState();
  const errors: string[] = [];
  const payload = proposal.amendmentPayload;

  // Simulate the amendment to check invariants
  if (payload.type === "agent-remove") {
    const remaining = state.agents.length - 1;
    if (remaining < 3) errors.push(`Would leave only ${remaining} agents (min 3)`);
    const removedAgent = state.agents.find(a => a.id === payload.agentId);
    const newWeight = state.agents.reduce((s, a) => s + a.weight, 0) - (removedAgent?.weight ?? 0);
    if (newWeight < 5) errors.push(`Total weight would drop to ${newWeight} (min 5)`);
  }

  if (payload.type === "agent-update" && payload.changes.weight !== undefined) {
    const agent = state.agents.find(a => a.id === payload.agentId);
    const oldWeight = agent?.weight ?? 0;
    const delta = payload.changes.weight - oldWeight;
    const newTotal = state.agents.reduce((s, a) => s + a.weight, 0) + delta;
    if (newTotal < 5) errors.push(`Total weight would drop to ${newTotal} (min 5)`);
  }

  if (payload.type === "config-update" && payload.changes.quorumPercent !== undefined) {
    const floor = state.config.quorumFloor ?? 60;
    if (payload.changes.quorumPercent < floor) {
      errors.push(`Quorum ${payload.changes.quorumPercent}% below floor ${floor}%`);
    }
  }

  if (payload.type === "quorum-update") {
    const floor = state.config.quorumFloor ?? 60;
    for (const [type, changes] of Object.entries(payload.typeQuorum)) {
      if (type === "governance-change" && changes?.quorumPercent !== undefined) {
        if (changes.quorumPercent < floor) {
          errors.push(`governance-change quorum ${changes.quorumPercent}% below floor ${floor}%`);
        }
      }
    }
  }

  const passed = errors.length === 0;
  return {
    gateId: "self-amendment-safety",
    name: "Self-Amendment Safety",
    passed,
    severity: "blocker",
    message: passed
      ? "Self-amendment safety checks passed"
      : `Self-amendment would violate invariants: ${errors.join("; ")}`,
    details: { errors },
  };
};

/**
 * weight-conservation: Warn if a weight change exceeds ±30% of current value.
 * Only runs for agent-update with weight changes.
 */
const gateWeightConservation = (proposal: Proposal): GateResult => {
  if (
    proposal.type !== "governance-change" ||
    !proposal.amendmentPayload ||
    proposal.amendmentPayload.type !== "agent-update" ||
    proposal.amendmentPayload.changes.weight === undefined
  ) {
    return {
      gateId: "weight-conservation",
      name: "Weight Conservation",
      passed: true,
      severity: "warning",
      message: "No weight change — gate not applicable",
    };
  }

  const payload = proposal.amendmentPayload;
  const current = getState().agents.find(a => a.id === payload.agentId);
  if (!current) {
    return {
      gateId: "weight-conservation",
      name: "Weight Conservation",
      passed: false,
      severity: "warning",
      message: `Agent "${payload.agentId}" not found`,
    };
  }

  const oldWeight = current.weight;
  const newWeight = payload.changes.weight!;
  const changePct = Math.abs(newWeight - oldWeight) / oldWeight * 100;
  const passed = changePct <= 30;

  return {
    gateId: "weight-conservation",
    name: "Weight Conservation",
    passed,
    severity: "warning",
    message: passed
      ? `Weight change ${oldWeight}→${newWeight} (${changePct.toFixed(0)}%) within 30% threshold`
      : `Weight change ${oldWeight}→${newWeight} (${changePct.toFixed(0)}%) exceeds 30% threshold — review recommended`,
    details: { oldWeight, newWeight, changePct: Math.round(changePct) },
  };
};

/**
 * prompt-integrity: Verify updated system prompts contain required sections.
 * Required sections: "## Vote" and "## Constraints"
 */
const gatePromptIntegrity = (proposal: Proposal): GateResult => {
  if (
    proposal.type !== "governance-change" ||
    !proposal.amendmentPayload ||
    proposal.amendmentPayload.type !== "agent-update" ||
    !proposal.amendmentPayload.changes.systemPrompt
  ) {
    return {
      gateId: "prompt-integrity",
      name: "Prompt Integrity",
      passed: true,
      severity: "warning",
      message: "No prompt change — gate not applicable",
    };
  }

  const newPrompt = proposal.amendmentPayload.changes.systemPrompt;
  const missing: string[] = [];
  if (!/##\s*Vote/i.test(newPrompt)) missing.push("## Vote");
  if (!/##\s*Constraints/i.test(newPrompt)) missing.push("## Constraints");

  const passed = missing.length === 0;
  return {
    gateId: "prompt-integrity",
    name: "Prompt Integrity",
    passed,
    severity: "warning",
    message: passed
      ? "System prompt contains all required sections (Vote, Constraints)"
      : `System prompt missing required sections: ${missing.join(", ")}`,
    details: { missingSections: missing },
  };
};

/**
 * circular-amendment: Block an agent from voting to increase its own power.
 * An amendment initiated by an agent that increases that agent's weight is circular.
 */
const gateCircularAmendment = (proposal: Proposal): GateResult => {
  if (
    proposal.type !== "governance-change" ||
    !proposal.amendmentPayload ||
    !proposal.amendmentOrigin ||
    proposal.amendmentOrigin.source !== "agent"
  ) {
    return {
      gateId: "circular-amendment",
      name: "Circular Amendment",
      passed: true,
      severity: "blocker",
      message: "Not an agent-initiated amendment — gate not applicable",
    };
  }

  const originAgentId = proposal.amendmentOrigin.agentId!;
  const payload = proposal.amendmentPayload;
  let isCircular = false;
  let reason = "";

  // Agent trying to increase its own weight
  if (payload.type === "agent-update" && payload.agentId === originAgentId && payload.changes.weight !== undefined) {
    const current = getState().agents.find(a => a.id === originAgentId);
    if (current && payload.changes.weight > current.weight) {
      isCircular = true;
      reason = `Agent "${originAgentId}" cannot increase its own weight (${current.weight} → ${payload.changes.weight})`;
    }
  }

  // Agent trying to update its own council role to lead
  if (payload.type === "council-update" && payload.agentId === originAgentId) {
    const currentLeadRoles = getState().agents.find(a => a.id === originAgentId)?.councils?.filter(c => c.role === "lead").length ?? 0;
    const newLeadRoles = payload.councils.filter(c => c.role === "lead").length;
    if (newLeadRoles > currentLeadRoles) {
      isCircular = true;
      reason = `Agent "${originAgentId}" cannot promote itself to additional lead roles`;
    }
  }

  return {
    gateId: "circular-amendment",
    name: "Circular Amendment",
    passed: !isCircular,
    severity: "blocker",
    message: isCircular
      ? `🔄 Circular amendment blocked: ${reason}`
      : "No circular amendment detected",
    details: { isCircular, originAgentId },
  };
};

// ── Gate Registry ────────────────────────────────────────────

type GateFn = (proposal: Proposal) => GateResult;

/**
 * acceptance-criteria: Verify structured acceptance criteria are defined and met.
 * PASS if: proposal has acceptanceCriteria and all are marked met.
 * WARNING if: no acceptance criteria defined (advisory — not required for all proposals).
 * BLOCKER if: criteria defined but some are not met.
 */
const gateAcceptanceCriteria = (proposal: Proposal): GateResult => {
  if (!proposal.acceptanceCriteria || proposal.acceptanceCriteria.length === 0) {
    return {
      gateId: "acceptance-criteria",
      name: "Acceptance Criteria",
      passed: true,
      severity: "warning",
      message: "No structured acceptance criteria defined — advisory only",
      details: { criteriaCount: 0 },
    };
  }

  const total = proposal.acceptanceCriteria.length;
  const met = proposal.acceptanceCriteria.filter(c => c.met === true).length;
  const unmet = proposal.acceptanceCriteria.filter(c => c.met !== true);
  const allMet = met === total;

  return {
    gateId: "acceptance-criteria",
    name: "Acceptance Criteria",
    passed: allMet,
    severity: allMet ? "info" : "blocker",
    message: allMet
      ? `All ${total} acceptance criteria met`
      : `${total - met}/${total} acceptance criteria not met: ${unmet.map(c => c.id).join(", ")}`,
    details: {
      total,
      met,
      unmet: unmet.map(c => ({ id: c.id, given: c.given, then: c.then })),
    },
  };
};

/** Check that all hard dependencies are satisfied before execution */
const gateDependencyReadiness: GateFn = (proposal) => {
  const readiness = checkReadiness(proposal.id);
  if (!readiness) {
    return { gateId: "dependency-readiness", name: "Dependency Readiness", passed: true, severity: "info", message: "No dependencies found" };
  }

  const hardUnsatisfied = readiness.unsatisfiedDeps.filter(d => d.type === "hard");
  const allUnsatisfied = readiness.unsatisfiedDeps;

  if (hardUnsatisfied.length > 0) {
    return {
      gateId: "dependency-readiness",
      name: "Dependency Readiness",
      passed: false,
      severity: "blocker",
      message: `${hardUnsatisfied.length} unsatisfied hard dep(s): ${hardUnsatisfied.map(d => "#" + d.proposalId + " (" + d.status + ")").join(", ")}`,
    };
  }

  if (allUnsatisfied.length > 0) {
    return {
      gateId: "dependency-readiness",
      name: "Dependency Readiness",
      passed: true,
      severity: "warning",
      message: `${allUnsatisfied.length} unsatisfied soft dep(s): ${allUnsatisfied.map(d => "#" + d.proposalId).join(", ")}`,
    };
  }

  return { gateId: "dependency-readiness", name: "Dependency Readiness", passed: true, severity: "info", message: "All dependencies satisfied" };
};

/** Check for conflicts with other active proposals */
const gateDependencyConflict: GateFn = (proposal) => {
  const graph = buildDependencyGraph();
  const relevantConflicts = graph.conflicts.filter(
    c => c.proposalA === proposal.id || c.proposalB === proposal.id,
  );

  if (relevantConflicts.length === 0) {
    return { gateId: "dependency-conflict", name: "Dependency Conflict", passed: true, severity: "info", message: "No conflicts detected" };
  }

  const blockers = relevantConflicts.filter(c => c.severity === "blocker");
  if (blockers.length > 0) {
    return {
      gateId: "dependency-conflict",
      name: "Dependency Conflict",
      passed: false,
      severity: "blocker",
      message: `${blockers.length} blocker conflict(s): ${blockers.map(c => "#" + c.proposalA + " \u2194 #" + c.proposalB + " (" + c.conflictType + ")").join("; ")}`,
    };
  }

  return {
    gateId: "dependency-conflict",
    name: "Dependency Conflict",
    passed: true,
    severity: "warning",
    message: `${relevantConflicts.length} warning conflict(s): ${relevantConflicts.map(c => "#" + c.proposalA + " \u2194 #" + c.proposalB).join("; ")}`,
  };
};

const GATES: Record<string, GateFn> = {
  "quorum-quality": gateQuorumQuality,
  "risk-threshold": gateRiskThreshold,
  "vote-consensus": gateVoteConsensus,
  "spec-completeness": gateSpecCompleteness,
  "delivery-feasibility": gateDeliveryFeasibility,
  "agent-registry-compliance": gateRegistryCompliance,
  "zone-compliance": gateZoneCompliance,
  "self-amendment-safety": gateSelfAmendmentSafety,
  "weight-conservation": gateWeightConservation,
  "prompt-integrity": gatePromptIntegrity,
  "circular-amendment": gateCircularAmendment,
  "acceptance-criteria": gateAcceptanceCriteria,
  "dependency-readiness": gateDependencyReadiness,
  "dependency-conflict": gateDependencyConflict,
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
