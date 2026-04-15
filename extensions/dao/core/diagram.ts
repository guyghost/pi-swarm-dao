// ============================================================
// pi-swarm-dao — Core: Mermaid State Diagram Export
// ============================================================

import { getDefinedStates, getEventsForState, getTransition, STATE_LABELS } from "./states.js";
import type { ProposalStatus } from "../types.js";

/**
 * Generate a Mermaid stateDiagram-v2 from the transition table.
 */
export const generateMermaidDiagram = (): string => {
  const lines: string[] = [
    "stateDiagram-v2",
    "    direction TB",
    "",
    "    %% States",
  ];

  // Declare states with labels
  const states = getDefinedStates();
  for (const state of states) {
    lines.push(`    ${state} : ${STATE_LABELS[state]}`);
  }

  lines.push("");
  lines.push("    %% Transitions");

  // Generate transitions
  for (const from of states) {
    const events = getEventsForState(from);
    for (const event of events) {
      const transition = getTransition(from, event);
      if (!transition) continue;
      // Skip self-transitions (archive on terminal)
      if (from === transition.target) continue;
      const guard = transition.guardDescription ? ` [${transition.guardDescription}]` : "";
      lines.push(`    ${from} --> ${transition.target} : ${event}${guard}`);
    }
  }

  return lines.join("\n");
};

/**
 * Generate a compact markdown section with the diagram.
 */
export const generateDiagramMarkdown = (): string => {
  const diagram = generateMermaidDiagram();
  return `# Proposal State Machine\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n`;
};
