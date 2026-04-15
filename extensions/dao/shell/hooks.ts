// ============================================================
// pi-swarm-dao — Shell: Transition Hook Registry
// ============================================================
// Side-effecting layer for lifecycle transition observers.
// Callbacks are called AFTER a successful transition.
// ============================================================

import type { ProposalStatus } from "../types.js";
import type { ProposalEvent, GuardContext } from "../core/states.js";

/** A transition hook callback. */
export type TransitionHook = (
  from: ProposalStatus,
  to: ProposalStatus,
  event: ProposalEvent,
  proposalId: number,
  ctx: GuardContext
) => void;

/** Registration for a specific transition pattern. */
interface HookRegistration {
  id: string;
  hook: TransitionHook;
}

// ── Hook Registry ────────────────────────────────────────────

/** Global hook registry — maps "from→to" keys to hook callbacks. */
const hooks = new Map<string, HookRegistration[]>();

/** Map wildcard keys. */
const wildcardHooks = new Map<string, HookRegistration[]>();

let hookIdCounter = 0;

/**
 * Register a hook for a specific transition.
 * Use "*" for from/to to match any state.
 */
export const onTransition = (
  from: ProposalStatus | "*",
  to: ProposalStatus | "*",
  hook: TransitionHook
): string => {
  const id = `hook-${++hookIdCounter}`;
  const registration: HookRegistration = { id, hook };

  if (from === "*" || to === "*") {
    const key = `${from}→${to}`;
    if (!wildcardHooks.has(key)) wildcardHooks.set(key, []);
    wildcardHooks.get(key)!.push(registration);
  } else {
    const key = `${from}→${to}`;
    if (!hooks.has(key)) hooks.set(key, []);
    hooks.get(key)!.push(registration);
  }

  return id;
};

/**
 * Remove a hook by its registration ID.
 */
export const removeHook = (id: string): void => {
  for (const [, regs] of hooks) {
    const idx = regs.findIndex(r => r.id === id);
    if (idx !== -1) { regs.splice(idx, 1); return; }
  }
  for (const [, regs] of wildcardHooks) {
    const idx = regs.findIndex(r => r.id === id);
    if (idx !== -1) { regs.splice(idx, 1); return; }
  }
};

/**
 * Fire all matching hooks for a transition.
 * Called by the lifecycle manager after a successful transition.
 */
export const fireHooks = (
  from: ProposalStatus,
  to: ProposalStatus,
  event: ProposalEvent,
  proposalId: number,
  ctx: GuardContext
): void => {
  // Specific hooks: from→to
  const specificKey = `${from}→${to}`;
  const specific = hooks.get(specificKey);
  if (specific) {
    for (const { hook } of specific) {
      try { hook(from, to, event, proposalId, ctx); } catch { /* swallow hook errors */ }
    }
  }

  // Wildcard hooks
  const patterns = [
    `${from}→*`,
    `*→${to}`,
    `*→*`,
  ];
  for (const pattern of patterns) {
    const wildcards = wildcardHooks.get(pattern);
    if (wildcards) {
      for (const { hook } of wildcards) {
        try { hook(from, to, event, proposalId, ctx); } catch { /* swallow hook errors */ }
      }
    }
  }
};

/**
 * Clear all hooks (for testing).
 */
export const clearHooks = (): void => {
  hooks.clear();
  wildcardHooks.clear();
};
