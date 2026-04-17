// ============================================================
// pi-swarm-dao — Core: Mermaid State Diagram Export
// ============================================================
// Generates diagrams from the XState v5 machine definition.
// Transition data below mirrors proposalMachine (machine.ts).
// Keep in sync — the exhaustive test matrix in
// __tests__/machine.test.ts validates consistency.
// ============================================================

import { STATE_LABELS } from "./states.js";
import type { ProposalStatus } from "../types.js";

// ── Transition definitions (sourced from proposalMachine) ────
// Maps "state:event" → target state and optional guard name.
// TypeScript ProposalStatus type ensures state names stay valid.

interface DiagramTransition {
  from: ProposalStatus;
  to: ProposalStatus;
  event: string;
  guard?: string;
}

const MACHINE_TRANSITIONS: DiagramTransition[] = [
  { from: "open",          to: "deliberating", event: "deliberate" },
  { from: "deliberating",  to: "approved",     event: "approve",    guard: "quorumMet" },
  { from: "deliberating",  to: "rejected",     event: "reject",     guard: "hasVotes" },
  { from: "deliberating",  to: "controlled",   event: "pass_gates", guard: "quorumMet" },
  { from: "approved",      to: "controlled",   event: "pass_gates", guard: "gatesPassed" },
  { from: "approved",      to: "rejected",     event: "reject" },
  { from: "controlled",    to: "executed",     event: "execute",    guard: "gatesPassed" },
  { from: "controlled",    to: "failed",       event: "fail_execution" },
  { from: "failed",        to: "controlled",   event: "retry" },
  { from: "failed",        to: "rejected",     event: "abandon" },
];

const TERMINAL_STATES: ReadonlySet<ProposalStatus> = new Set([
  "executed",
  "rejected",
]);

const ALL_STATES: ProposalStatus[] = [
  "open",
  "deliberating",
  "approved",
  "controlled",
  "executed",
  "failed",
  "rejected",
];

/**
 * Generate a Mermaid stateDiagram-v2 from the XState machine transitions.
 */
export const generateMermaidDiagram = (): string => {
  const lines: string[] = [
    "stateDiagram-v2",
    "    direction TB",
    "",
    "    %% States",
  ];

  // Declare states with labels
  for (const state of ALL_STATES) {
    const label = STATE_LABELS[state];
    if (TERMINAL_STATES.has(state)) {
      lines.push(`    state "${label}" as ${state}`);
      lines.push(`    ${state} --> [*]`);
    } else {
      lines.push(`    ${state} : ${label}`);
    }
  }

  lines.push("");
  lines.push("    %% Transitions");

  // Generate transitions with guard annotations
  for (const t of MACHINE_TRANSITIONS) {
    const guard = t.guard ? ` [${t.guard}]` : "";
    lines.push(`    ${t.from} --> ${t.to} : ${t.event}${guard}`);
  }

  return lines.join("\n");
};

/**
 * Generate a compact markdown section with the diagram.
 */
export const generateDiagramMarkdown = (): string => {
  const diagram = generateMermaidDiagram();
  return `# Proposal State Machine\n\nAuto-generated from the XState v5 FSM in \`core/machine.ts\`.\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n`;
};
