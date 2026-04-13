import type { DAOState } from "./types.js";
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

/**
 * Create a state snapshot suitable for tool result `details`.
 * Called by every tool that modifies state.
 */
export function createStateSnapshot(): { daoState: DAOState } {
  return { daoState: structuredClone(currentState) };
}

/**
 * Restore state from session branch.
 * Scans tool results on the current branch for the latest DAO state snapshot.
 *
 * @param ctx - The ExtensionContext with sessionManager access
 */
export function restoreState(ctx: any): void {
  let restored = false;

  // Scan the current branch for the latest state snapshot
  for (const entry of ctx.sessionManager.getBranch()) {
    // Look for tool results from our DAO tools that contain state snapshots
    if (
      entry.type === "message" &&
      entry.message.role === "toolResult" &&
      entry.message.details?.daoState
    ) {
      currentState = entry.message.details.daoState as DAOState;
      restored = true;
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
