// ============================================================
// pi-swarm-dao — Core: Public API
// ============================================================

export { TRANSITION_TABLE, TERMINAL_STATES, STATE_LABELS, STATE_ORDER, getTransition, getEventsForState, getTargetsForState } from "./states.js";
export type { ProposalEvent, GuardContext, Guard, RejectionReason, TransitionDef } from "./states.js";
export { evaluateTransition, getAllowedTransitions, getAllTargets, isTerminal, assertTransition } from "./evaluate.js";
export type { TransitionResult, TransitionOK, TransitionRejected } from "./evaluate.js";
export { generateMermaidDiagram, generateDiagramMarkdown } from "./diagram.js";
export { proposalMachine } from "./machine.js";
export type { MachineContext, MachineEvents, MachineInput } from "./machine.js";
