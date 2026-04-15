// ============================================================
// pi-swarm-dao — Shell: Public API
// ============================================================

export { onTransition, removeHook, clearHooks } from "./hooks.js";
export type { TransitionHook } from "./hooks.js";
export { transitionProposal, buildContext } from "./lifecycle-manager.js";
export type { LifecycleResult } from "./lifecycle-manager.js";
