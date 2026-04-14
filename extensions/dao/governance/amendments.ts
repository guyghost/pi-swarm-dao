// ============================================================
// pi-swarm-dao — Self-Amending Engine
// ============================================================
// Validates, previews, executes, and rolls back amendments to
// the DAO's own configuration, agents, and governance rules.
// ============================================================

import type {
  AmendmentPayload,
  AmendmentSnapshot,
  DAOAgent,
  DAOConfig,
  Proposal,
  CouncilMembership,
} from "../types.js";
import { getState, setState, createAmendmentSnapshot, restoreAmendmentSnapshot } from "../persistence.js";
import { updateAgent } from "../intelligence/agents.js";
import { addAgent, removeAgent } from "../intelligence/agents.js";

// ── Validation ──────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate an amendment payload for structural correctness and safety.
 */
export const validateAmendmentPayload = (payload: AmendmentPayload): ValidationResult => {
  const errors: string[] = [];

  switch (payload.type) {
    case "agent-update": {
      if (!payload.agentId) errors.push("agentId is required");
      if (!payload.changes || Object.keys(payload.changes).length === 0) {
        errors.push("changes must contain at least one field");
      }
      if (payload.changes.weight !== undefined) {
        if (payload.changes.weight < 1 || payload.changes.weight > 10) {
          errors.push("weight must be between 1 and 10");
        }
      }
      // Verify agent exists
      const agent = getState().agents.find(a => a.id === payload.agentId);
      if (!agent) errors.push(`Agent "${payload.agentId}" not found`);
      break;
    }

    case "agent-add": {
      if (!payload.agent) errors.push("agent definition is required");
      if (!payload.agent.id) errors.push("agent.id is required");
      if (!payload.agent.name) errors.push("agent.name is required");
      if (!payload.agent.role) errors.push("agent.role is required");
      if (payload.agent.weight < 1 || payload.agent.weight > 10) {
        errors.push("agent.weight must be between 1 and 10");
      }
      // Check for duplicate ID
      if (getState().agents.some(a => a.id === payload.agent.id)) {
        errors.push(`Agent "${payload.agent.id}" already exists`);
      }
      break;
    }

    case "agent-remove": {
      if (!payload.agentId) errors.push("agentId is required");
      const existing = getState().agents.find(a => a.id === payload.agentId);
      if (!existing) errors.push(`Agent "${payload.agentId}" not found`);
      // Check minimum agents
      if (getState().agents.length <= 3) {
        errors.push("Cannot remove agent: minimum 3 agents required");
      }
      break;
    }

    case "config-update": {
      if (!payload.changes || Object.keys(payload.changes).length === 0) {
        errors.push("changes must contain at least one field");
      }
      if (payload.changes.quorumPercent !== undefined) {
        const floor = getState().config.quorumFloor ?? 60;
        if (payload.changes.quorumPercent < floor) {
          errors.push(`quorumPercent cannot be below quorum floor (${floor}%)`);
        }
      }
      if (payload.changes.approvalThreshold !== undefined) {
        if (payload.changes.approvalThreshold < 1 || payload.changes.approvalThreshold > 100) {
          errors.push("approvalThreshold must be between 1 and 100");
        }
      }
      break;
    }

    case "quorum-update": {
      if (!payload.typeQuorum || Object.keys(payload.typeQuorum).length === 0) {
        errors.push("typeQuorum must contain at least one type override");
      }
      const floor = getState().config.quorumFloor ?? 60;
      for (const [type, config] of Object.entries(payload.typeQuorum)) {
        if (type === "governance-change" && config?.quorumPercent !== undefined) {
          if (config.quorumPercent < floor) {
            errors.push(`governance-change quorumPercent cannot be below quorum floor (${floor}%)`);
          }
        }
        if (config?.quorumPercent !== undefined && (config.quorumPercent < 1 || config.quorumPercent > 100)) {
          errors.push(`${type}: quorumPercent must be between 1 and 100`);
        }
        if (config?.approvalPercent !== undefined && (config.approvalPercent < 1 || config.approvalPercent > 100)) {
          errors.push(`${type}: approvalPercent must be between 1 and 100`);
        }
      }
      break;
    }

    case "gate-update": {
      if (!payload.addGates?.length && !payload.removeGates?.length) {
        errors.push("Must specify at least one gate to add or remove");
      }
      break;
    }

    case "council-update": {
      if (!payload.agentId) errors.push("agentId is required");
      if (!payload.councils) errors.push("councils array is required");
      const agentExists = getState().agents.find(a => a.id === payload.agentId);
      if (!agentExists) errors.push(`Agent "${payload.agentId}" not found`);
      break;
    }

    default:
      errors.push(`Unknown amendment type: ${(payload as any).type}`);
  }

  return { valid: errors.length === 0, errors };
};

// ── Preview ─────────────────────────────────────────────────

export interface AmendmentDiff {
  field: string;
  before: string;
  after: string;
}

/**
 * Preview what an amendment would change without applying it.
 */
export const previewAmendment = (payload: AmendmentPayload): AmendmentDiff[] => {
  const state = getState();
  const diffs: AmendmentDiff[] = [];

  switch (payload.type) {
    case "agent-update": {
      const agent = state.agents.find(a => a.id === payload.agentId);
      if (!agent) return diffs;
      for (const [key, value] of Object.entries(payload.changes)) {
        const before = (agent as any)[key];
        diffs.push({
          field: `agent.${payload.agentId}.${key}`,
          before: typeof before === "object" ? JSON.stringify(before) : String(before ?? ""),
          after: typeof value === "object" ? JSON.stringify(value) : String(value ?? ""),
        });
      }
      break;
    }

    case "agent-add": {
      diffs.push({
        field: "agents",
        before: `${state.agents.length} agents`,
        after: `${state.agents.length + 1} agents (+${payload.agent.name})`,
      });
      break;
    }

    case "agent-remove": {
      const agent = state.agents.find(a => a.id === payload.agentId);
      diffs.push({
        field: "agents",
        before: `${state.agents.length} agents`,
        after: `${state.agents.length - 1} agents (-${agent?.name ?? payload.agentId})`,
      });
      break;
    }

    case "config-update": {
      for (const [key, value] of Object.entries(payload.changes)) {
        const before = (state.config as any)[key];
        diffs.push({
          field: `config.${key}`,
          before: String(before ?? ""),
          after: String(value ?? ""),
        });
      }
      break;
    }

    case "quorum-update": {
      for (const [type, changes] of Object.entries(payload.typeQuorum)) {
        const existing = state.config.typeQuorum[type as keyof typeof state.config.typeQuorum];
        if (changes?.quorumPercent !== undefined) {
          diffs.push({
            field: `typeQuorum.${type}.quorumPercent`,
            before: String(existing?.quorumPercent ?? "default"),
            after: String(changes.quorumPercent),
          });
        }
        if (changes?.approvalPercent !== undefined) {
          diffs.push({
            field: `typeQuorum.${type}.approvalPercent`,
            before: String(existing?.approvalPercent ?? "default"),
            after: String(changes.approvalPercent),
          });
        }
      }
      break;
    }

    case "gate-update": {
      if (payload.addGates?.length) {
        diffs.push({
          field: "config.requiredGates",
          before: state.config.requiredGates.join(", "),
          after: [...new Set([...state.config.requiredGates, ...payload.addGates])].join(", "),
        });
      }
      if (payload.removeGates?.length) {
        diffs.push({
          field: "config.requiredGates",
          before: state.config.requiredGates.join(", "),
          after: state.config.requiredGates.filter(g => !payload.removeGates!.includes(g)).join(", "),
        });
      }
      break;
    }

    case "council-update": {
      const agent = state.agents.find(a => a.id === payload.agentId);
      diffs.push({
        field: `agent.${payload.agentId}.councils`,
        before: JSON.stringify(agent?.councils ?? []),
        after: JSON.stringify(payload.councils),
      });
      break;
    }
  }

  return diffs;
};

// ── Execution ───────────────────────────────────────────────

/**
 * Execute an amendment payload against the live state.
 * Takes a pre-amendment snapshot, applies changes, verifies post-conditions.
 * If verification fails, automatically rolls back.
 *
 * @returns the snapshot (for storage on the proposal) and whether it succeeded
 */
export const executeAmendment = (
  payload: AmendmentPayload,
): { success: boolean; snapshot: AmendmentSnapshot; error?: string } => {
  // 1. Snapshot
  const snapshot = createAmendmentSnapshot();

  try {
    // 2. Apply
    applyAmendment(payload);

    // 3. Verify post-conditions
    const verification = verifyPostAmendment();
    if (!verification.valid) {
      // Rollback
      restoreAmendmentSnapshot(snapshot);
      return {
        success: false,
        snapshot,
        error: `Post-amendment verification failed: ${verification.errors.join("; ")}`,
      };
    }

    return { success: true, snapshot };
  } catch (err: any) {
    // Rollback on any error
    restoreAmendmentSnapshot(snapshot);
    return { success: false, snapshot, error: err.message };
  }
};

/**
 * Apply an amendment payload to the live state.
 * This is the actual mutation — no safety checks here.
 */
const applyAmendment = (payload: AmendmentPayload): void => {
  const state = getState();

  switch (payload.type) {
    case "agent-update":
      updateAgent(payload.agentId, payload.changes);
      break;

    case "agent-add":
      addAgent(payload.agent);
      break;

    case "agent-remove":
      removeAgent(payload.agentId);
      break;

    case "config-update":
      Object.assign(state.config, payload.changes);
      setState(state);
      break;

    case "quorum-update":
      for (const [type, changes] of Object.entries(payload.typeQuorum)) {
        const existing = state.config.typeQuorum[type as keyof typeof state.config.typeQuorum];
        if (existing && changes) {
          Object.assign(existing, changes);
        } else if (changes) {
          (state.config.typeQuorum as any)[type] = changes;
        }
      }
      setState(state);
      break;

    case "gate-update":
      if (payload.addGates) {
        for (const gate of payload.addGates) {
          if (!state.config.requiredGates.includes(gate)) {
            state.config.requiredGates.push(gate);
          }
        }
      }
      if (payload.removeGates) {
        state.config.requiredGates = state.config.requiredGates.filter(
          g => !payload.removeGates!.includes(g)
        );
      }
      setState(state);
      break;

    case "council-update": {
      const agentIdx = state.agents.findIndex(a => a.id === payload.agentId);
      if (agentIdx !== -1) {
        state.agents[agentIdx].councils = payload.councils;
        setState(state);
      }
      break;
    }
  }
};

// ── Post-Amendment Verification ─────────────────────────────

export interface VerificationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Verify the DAO state is valid after an amendment.
 * Invariants:
 * 1. At least 3 agents
 * 2. Total weight >= 5
 * 3. Quorum >= quorumFloor
 * 4. No agent without a systemPrompt
 */
export const verifyPostAmendment = (): VerificationResult => {
  const state = getState();
  const errors: string[] = [];

  // Invariant 1: minimum 3 agents
  if (state.agents.length < 3) {
    errors.push(`Must have at least 3 agents (currently ${state.agents.length})`);
  }

  // Invariant 2: total weight >= 5
  const totalWeight = state.agents.reduce((sum, a) => sum + a.weight, 0);
  if (totalWeight < 5) {
    errors.push(`Total weight must be >= 5 (currently ${totalWeight})`);
  }

  // Invariant 3: quorum >= quorumFloor
  const floor = state.config.quorumFloor ?? 60;
  if (state.config.quorumPercent < floor) {
    errors.push(`quorumPercent (${state.config.quorumPercent}%) cannot be below quorumFloor (${floor}%)`);
  }

  // Check governance-change quorum
  const govQuorum = state.config.typeQuorum["governance-change"];
  if (govQuorum && govQuorum.quorumPercent < floor) {
    errors.push(`governance-change quorumPercent (${govQuorum.quorumPercent}%) cannot be below quorumFloor (${floor}%)`);
  }

  // Invariant 4: no agent without systemPrompt
  const missingPrompt = state.agents.filter(a => !a.systemPrompt);
  if (missingPrompt.length > 0) {
    errors.push(`Agents without systemPrompt: ${missingPrompt.map(a => a.id).join(", ")}`);
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Manually rollback an amendment using a stored snapshot.
 */
export const rollbackAmendment = (snapshot: AmendmentSnapshot): void => {
  restoreAmendmentSnapshot(snapshot);
};
