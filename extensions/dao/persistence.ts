import type { DAOState, DAOAgent, DAOConfig } from "./types.js";
import { createInitialState } from "./types.js";

// The custom type identifier for our state entries
const STATE_ENTRY_TYPE = "dao-state";

/** In-memory state — the single source of truth at runtime */
let currentState: DAOState = createInitialState();

/** Get the current state (read-only reference) */
export function getState(): DAOState {
  return currentState;
}

/** Update the current state (replaces entirely) */
export function setState(state: DAOState): void {
  currentState = state;
}

const TERMINAL_STATES = new Set(["executed", "rejected", "failed"]);
const MAX_AUDIT_LOG = 200;

/**
 * Compact state to reduce memory footprint.
 * - Trims large text fields on terminal proposals (agentOutputs, synthesis, executionResult)
 * - Caps the audit log to the most recent entries
 */
export function compactState(): void {
  for (const p of currentState.proposals) {
    if (!TERMINAL_STATES.has(p.status)) continue;

    // Trim agentOutputs content
    if (p.agentOutputs) {
      for (const output of p.agentOutputs) {
        if (output.content && output.content.length > 500) {
          output.content = output.content.slice(0, 500) + "\n\n[…trimmed]";
        }
      }
    }

    // Trim synthesis
    if (p.synthesis && p.synthesis.length > 1000) {
      p.synthesis = p.synthesis.slice(0, 1000) + "\n\n[…trimmed]";
    }

    // Trim executionResult
    if (p.executionResult && p.executionResult.length > 1000) {
      p.executionResult = p.executionResult.slice(0, 1000) + "\n\n[…trimmed]";
    }
  }

  // Cap audit log to last MAX_AUDIT_LOG entries
  if (currentState.auditLog.length > MAX_AUDIT_LOG) {
    currentState.auditLog = currentState.auditLog.slice(-MAX_AUDIT_LOG);
  }

  setState(currentState);
}

/**
 * Create a snapshot of amendment-relevant state (agents + config) for rollback.
 */
export function createAmendmentSnapshot(): { agents: DAOAgent[]; config: DAOConfig; capturedAt: string } {
  const state = currentState;
  return {
    agents: state.agents.map(a => ({ ...a, councils: a.councils ? [...a.councils] : [] })),
    config: { ...state.config, typeQuorum: { ...state.config.typeQuorum }, requiredGates: [...state.config.requiredGates] },
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Restore agents and config from a pre-amendment snapshot.
 */
export function restoreAmendmentSnapshot(snapshot: { agents: DAOAgent[]; config: DAOConfig }): void {
  currentState.agents = snapshot.agents;
  currentState.config = snapshot.config;
}

/**
 * Create a state snapshot suitable for tool result `details`.
 * Called by every tool that modifies state.
 */
export function createStateSnapshot(): { daoState: DAOState } {
  compactState();
  // Shallow clone top-level, sharing references to immutable historical data
  const snapshot: DAOState = {
    ...currentState,
    proposals: currentState.proposals.map(p => ({ ...p })),
    agents: [...currentState.agents],
    auditLog: [...currentState.auditLog],
    controlResults: { ...currentState.controlResults },
    deliveryPlans: { ...currentState.deliveryPlans },
    artefacts: { ...currentState.artefacts },
    outcomes: { ...currentState.outcomes },
    snapshots: { ...currentState.snapshots },
  };
  return { daoState: snapshot };
}

/**
 * Restore state from session branch.
 * Scans tool results on the current branch for the latest DAO state snapshot.
 *
 * @param ctx - The ExtensionContext with sessionManager access
 */
export function restoreState(ctx: any): void {
  let restored = false;

  // Scan the branch in reverse to find the most recent state snapshot
  const branch = ctx.sessionManager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (
      entry.type === "message" &&
      entry.message.role === "toolResult" &&
      entry.message.details?.daoState
    ) {
      currentState = entry.message.details.daoState as DAOState;
      restored = true;
      break;
    }
  }

  // Migrate proposals missing the `type` field (backward compatibility)
  if (restored) {
    for (const p of currentState.proposals) {
      if (!p.type) {
        (p as any).type = "feature"; // Default to "feature" for legacy proposals
      }
    }

    // Migrate agents missing registry fields (backward compatibility)
    for (const a of currentState.agents) {
      if (!a.owner) a.owner = "system";
      if (!a.mission) a.mission = a.description;
      if (!a.riskLevel) a.riskLevel = "medium";
      if (!a.authorizedEnvironments) a.authorizedEnvironments = ["dev", "staging", "prod"];
      if (!a.stopConditions) a.stopConditions = [
        { type: "timeout", description: "Default timeout", value: "60s" },
        { type: "error", description: "LLM failure threshold", value: "3" },
      ];
      if (!a.kpis) a.kpis = [];
      if (!a.lastReviewDate) a.lastReviewDate = "2026-04-13";
    }

    // Migrate state missing artefacts field (backward compatibility)
    if (!currentState.artefacts) {
      currentState.artefacts = {};
    }

    // Migrate proposals missing V2 fields
    for (const p of currentState.proposals) {
      // Migrate old type names to new
      if ((p as any).type === "feature") p.type = "product-feature";
      if ((p as any).type === "security") p.type = "security-change";
      if ((p as any).type === "ux") p.type = "product-feature";
      if ((p as any).type === "policy") p.type = "governance-change";
      if ((p as any).type === "release") p.type = "release-change";

      // Add missing pipeline stage
      if (!(p as any).stage) {
        (p as any).stage = "intake";
      }

      // Add missing risk zone
      if (!(p as any).riskZone) {
        (p as any).riskZone = "green";
      }
    }

    // Migrate config missing typeQuorum
    if (!(currentState.config as any).typeQuorum) {
      (currentState.config as any).typeQuorum = {
        "product-feature": { quorumPercent: 60, approvalPercent: 55, description: "Product Roadmap" },
        "security-change": { quorumPercent: 75, approvalPercent: 70, description: "Security-sensitive" },
        "technical-change": { quorumPercent: 60, approvalPercent: 55, description: "Technical / Architecture" },
        "release-change": { quorumPercent: 50, approvalPercent: 51, description: "Routine Release" },
        "governance-change": { quorumPercent: 70, approvalPercent: 66, description: "Governance / Policy" },
      };
    }

    // Migrate agents missing councils
    for (const a of currentState.agents) {
      if (!a.councils) {
        a.councils = [];
      }
    }

    // Migrate state missing outcomes (Proposal #6)
    if (!currentState.outcomes) {
      currentState.outcomes = {};
    }

    // Migrate state missing snapshots (Proposal #8)
    if (!currentState.snapshots) {
      currentState.snapshots = {};
    }
  }

  if (!restored) {
    currentState = createInitialState();
  }
}

/**
 * Helper to build a tool result with embedded state snapshot.
 * Use this in every tool's execute() to persist state changes.
 */
export function toolResult(text: string, extra?: Record<string, any>) {
  return {
    content: [{ type: "text" as const, text }],
    details: {
      ...createStateSnapshot(),
      ...extra,
    },
  };
}
