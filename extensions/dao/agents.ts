import type { DAOAgent } from "./types.js";
import { getState, setState } from "./persistence.js";
import { DEFAULT_AGENTS } from "./default-agents.js";

/**
 * Initialize agents with defaults if not already initialized.
 * Called during dao_setup.
 */
export const initializeAgents = (customAgents?: DAOAgent[]): DAOAgent[] => {
  const state = getState();
  const agents = customAgents ?? [...DEFAULT_AGENTS];
  state.agents = agents;
  state.initialized = true;
  setState(state);
  return agents;
};

/**
 * Add a new agent to the DAO.
 * Validates: unique ID, weight range 1-10.
 */
export const addAgent = (
  agent: Omit<DAOAgent, "systemPrompt"> & { systemPrompt?: string },
): DAOAgent => {
  const state = getState();

  // Validate unique ID
  if (state.agents.some((a) => a.id === agent.id)) {
    throw new Error(`Agent with ID "${agent.id}" already exists`);
  }

  // Validate weight
  if (agent.weight < 1 || agent.weight > 10) {
    throw new Error(
      `Weight must be between 1 and 10, got ${agent.weight}`,
    );
  }

  const newAgent: DAOAgent = {
    ...agent,
    systemPrompt: agent.systemPrompt ?? buildDefaultPrompt(agent),
  };

  state.agents.push(newAgent);
  setState(state);
  return newAgent;
};

/**
 * Remove an agent from the DAO by ID.
 */
export const removeAgent = (agentId: string): DAOAgent => {
  const state = getState();
  const index = state.agents.findIndex((a) => a.id === agentId);

  if (index === -1) {
    throw new Error(`Agent "${agentId}" not found`);
  }

  const [removed] = state.agents.splice(index, 1);
  setState(state);
  return removed;
};

/**
 * Get a single agent by ID.
 */
export const getAgent = (agentId: string): DAOAgent | undefined => {
  return getState().agents.find((a) => a.id === agentId);
};

/**
 * List all agents with their details.
 */
export const listAgents = (): DAOAgent[] => {
  return getState().agents;
};

/**
 * Get the total weight of all agents.
 */
export const getTotalWeight = (): number => {
  return getState().agents.reduce((sum, a) => sum + a.weight, 0);
};

/**
 * Format agents list as a readable table string.
 */
export const formatAgentsTable = (agents: DAOAgent[]): string => {
  const totalWeight = agents.reduce((sum, a) => sum + a.weight, 0);
  const header =
    "| Agent | Role | Weight | Model |\n|-------|------|--------|-------|";
  const rows = agents
    .map(
      (a) =>
        `| ${a.name} | ${a.role} | ${a.weight}/${totalWeight} | ${a.model ?? "default"} |`,
    )
    .join("\n");
  return `${header}\n${rows}`;
};

/**
 * Build a generic system prompt for a custom agent.
 */
const buildDefaultPrompt = (
  agent: Omit<DAOAgent, "systemPrompt">,
): string => {
  return `# ${agent.name}

## Identity
You are the ${agent.name} in a DAO of specialized product agents deliberating on proposals.
Your role: ${agent.role}

## Responsibility
${agent.description}

## Output Format
Structure your response with clear markdown sections relevant to your role.
Include analysis, recommendations, and concerns.

## Vote
**Position:** for | against | abstain
**Reasoning:** [1-2 sentence justification from your perspective]

## Constraints
- Stay within your domain of expertise
- Be concise and actionable (300-500 words)
- Always end with the Vote section in the exact format above`;
};
