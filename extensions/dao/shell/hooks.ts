// ============================================================
// pi-swarm-dao — Shell: Transition Hook Registry
// ============================================================
// Side-effecting layer for lifecycle transition observers.
// Callbacks are called AFTER a successful transition.
//
// Hooks are either "critical" or "best-effort":
//   - critical:   failure throws CriticalHookError → transition rolled back
//   - best-effort: failure is logged, transition continues
//
// Critical hooks run BEFORE best-effort hooks.
// ============================================================

import type { ProposalStatus } from "../types.js";
import type { ProposalEvent, GuardContext } from "../core/states.js";

// ── Error Types ─────────────────────────────────────────────

/**
 * Thrown when a critical hook fails.
 * The lifecycle manager catches this to roll back the transition.
 */
export class CriticalHookError extends Error {
  override readonly name = "CriticalHookError";
  constructor(
    public readonly hookName: string,
    public readonly cause: unknown,
  ) {
    super(`Critical hook "${hookName}" failed`);
  }
}

// ── Hook Types ──────────────────────────────────────────────

/** A transition hook callback. May be sync or async. */
export type TransitionHook = (
  from: ProposalStatus,
  to: ProposalStatus,
  event: ProposalEvent,
  proposalId: number,
  ctx: GuardContext,
) => void | Promise<void>;

/** Whether a hook failure should block the transition. */
export type HookType = "critical" | "best-effort";

/** Registration for a specific transition pattern. */
export interface HookRegistration {
  id: string;
  name: string;
  type: HookType;
  hook: TransitionHook;
}

/** Record of a best-effort hook that failed (but was swallowed). */
export interface HookError {
  hook: string;
  error: unknown;
}

/** Result of firing all hooks for a transition. */
export interface HookResult {
  errors: HookError[];
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
 *
 * @param type - 'critical' (failure blocks transition) or 'best-effort' (failure logged).
 *               Defaults to 'best-effort' for backwards compatibility.
 */
export const onTransition = (
  from: ProposalStatus | "*",
  to: ProposalStatus | "*",
  hook: TransitionHook,
  type: HookType = "best-effort",
  name?: string,
): string => {
  const id = `hook-${++hookIdCounter}`;
  const registration: HookRegistration = {
    id,
    name: name ?? id,
    type,
    hook,
  };

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

// ── Internal helpers ─────────────────────────────────────────

/**
 * Collect all matching registrations for a transition, sorted with
 * critical hooks first, then best-effort. Within each group the
 * registration order is preserved.
 */
export const getHooksForTransition = (
  from: ProposalStatus,
  to: ProposalStatus,
): HookRegistration[] => {
  const collected: HookRegistration[] = [];

  // Specific hooks: from→to
  const specificKey = `${from}→${to}`;
  const specific = hooks.get(specificKey);
  if (specific) collected.push(...specific);

  // Wildcard hooks
  const patterns = [`${from}→*`, `*→${to}`, `*→*`];
  for (const pattern of patterns) {
    const wildcards = wildcardHooks.get(pattern);
    if (wildcards) collected.push(...wildcards);
  }

  // Stable sort: critical first, then best-effort (preserves registration order within each group)
  return collected.sort((a, b) => {
    if (a.type === "critical" && b.type !== "critical") return -1;
    if (a.type !== "critical" && b.type === "critical") return 1;
    return 0;
  });
};

/**
 * Fire all matching hooks for a transition.
 * Called by the lifecycle manager after a successful transition.
 *
 * - Critical hooks run first. If any throws, a CriticalHookError is thrown
 *   and the caller should roll back the transition.
 * - Best-effort hooks run after. Failures are collected in `errors` and
 *   a warning is logged, but the transition is not affected.
 */
export const fireHooks = async (
  from: ProposalStatus,
  to: ProposalStatus,
  event: ProposalEvent,
  proposalId: number,
  ctx: GuardContext,
): Promise<HookResult> => {
  const errors: HookError[] = [];
  const registrations = getHooksForTransition(from, to);

  for (const reg of registrations) {
    try {
      await reg.hook(from, to, event, proposalId, ctx);
    } catch (err) {
      if (reg.type === "critical") {
        throw new CriticalHookError(reg.name, err);
      }
      // best-effort: log and continue
      console.warn(`[DAO] Best-effort hook "${reg.name}" failed:`, err);
      errors.push({ hook: reg.name, error: err });
    }
  }

  return { errors };
};

/**
 * Clear all hooks (for testing).
 */
export const clearHooks = (): void => {
  hooks.clear();
  wildcardHooks.clear();
  hookIdCounter = 0;
};
