import type { DAOAgent, AgentRiskLevel } from "../types.js";
import { getState, setState } from "../persistence.js";
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
    // Registry defaults
    owner: agent.owner ?? "user",
    mission: agent.mission ?? agent.description,
    riskLevel: agent.riskLevel ?? "medium",
    authorizedEnvironments: agent.authorizedEnvironments ?? ["dev", "staging", "prod"],
    stopConditions: agent.stopConditions ?? [
      { type: "timeout", description: "Default timeout", value: "60s" },
      { type: "error", description: "LLM failure threshold", value: "3" },
    ],
    kpis: agent.kpis ?? [],
    lastReviewDate: agent.lastReviewDate ?? new Date().toISOString().split("T")[0],
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
    "| Agent | Role | Weight | Risk | Model |\n|-------|------|--------|------|-------|";
  const rows = agents
    .map(
      (a) =>
        `| ${a.name} | ${a.role} | ${a.weight}/${totalWeight} | ${riskBadge(a.riskLevel)} | ${a.model ?? "default"} |`,
    )
    .join("\n");
  return `${header}\n${rows}`;
};

/**
 * Risk level badge with color indicator.
 */
const riskBadge = (level?: AgentRiskLevel): string => {
  switch (level) {
    case "critical": return "🔴 critical";
    case "high": return "🟠 high";
    case "medium": return "🟡 medium";
    case "low": return "🟢 low";
    default: return "⚪ unknown";
  }
};

/**
 * Format a full registry card for a single agent.
 */
export const formatAgentCard = (agent: DAOAgent): string => {
  const lines: string[] = [];
  lines.push(`# 🪪 Agent Card: ${agent.name}`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| **ID** | \`${agent.id}\` |`);
  lines.push(`| **Name** | ${agent.name} |`);
  lines.push(`| **Owner** | ${agent.owner ?? "system"} |`);
  lines.push(`| **Mission** | ${agent.mission ?? agent.description} |`);
  lines.push(`| **Role** | ${agent.role} |`);
  lines.push(`| **Weight** | ${agent.weight} |`);
  lines.push(`| **Risk Level** | ${riskBadge(agent.riskLevel)} |`);
  lines.push(`| **Model** | ${agent.model ?? "default"} |`);
  lines.push(`| **Last Review** | ${agent.lastReviewDate ?? "never"} |`);
  lines.push("");

  // Authorized Inputs
  lines.push("## 📥 Authorized Inputs");
  if (agent.authorizedInputs?.length) {
    lines.push(agent.authorizedInputs.map(i => `- \`${i}\``).join("\n"));
  } else {
    lines.push("- *No restrictions defined*");
  }
  lines.push("");

  // Authorized Tools
  lines.push("## 🔧 Authorized Tools");
  if (agent.tools?.length) {
    lines.push(agent.tools.map(t => `- \`${t}\``).join("\n"));
  } else {
    lines.push("- *No tools (--no-tools)*");
  }
  lines.push("");

  // Authorized Data
  lines.push("## 📊 Authorized Data");
  if (agent.authorizedData?.length) {
    lines.push(agent.authorizedData.map(d => `- \`${d}\``).join("\n"));
  } else {
    lines.push("- *No restrictions defined*");
  }
  lines.push("");

  // Authorized Environments
  lines.push("## 🌍 Authorized Environments");
  if (agent.authorizedEnvironments?.length) {
    lines.push(agent.authorizedEnvironments.map(e => `- \`${e}\``).join("\n"));
  } else {
    lines.push("- *All environments*");
  }
  lines.push("");

  // Stop Conditions
  lines.push("## 🛑 Stop Conditions");
  if (agent.stopConditions?.length) {
    lines.push("| Type | Description | Value |");
    lines.push("|------|-------------|-------|");
    for (const sc of agent.stopConditions) {
      lines.push(`| ${sc.type} | ${sc.description} | ${sc.value ?? "—"} |`);
    }
  } else {
    lines.push("- *No stop conditions defined*");
  }
  lines.push("");

  // KPIs
  lines.push("## 📈 KPIs");
  if (agent.kpis?.length) {
    lines.push("| KPI | Description | Target |");
    lines.push("|-----|-------------|--------|");
    for (const kpi of agent.kpis) {
      lines.push(`| ${kpi.name} | ${kpi.description} | ${kpi.target} |`);
    }
  } else {
    lines.push("- *No KPIs defined*");
  }

  return lines.join("\n");
};

/**
 * Format a compact registry overview of all agents.
 */
export const formatRegistryTable = (agents: DAOAgent[]): string => {
  const lines: string[] = [];
  lines.push("# 📋 Agent Registry");
  lines.push("");
  lines.push("| Agent | Owner | Mission | Risk | Environments | Last Review |");
  lines.push("|-------|-------|---------|------|--------------|-------------|");
  for (const a of agents) {
    const missionText = a.mission ?? a.description;
    const truncated = missionText.length > 60 ? `${missionText.slice(0, 60)}…` : missionText;
    const envs = a.authorizedEnvironments?.length ? a.authorizedEnvironments.join(", ") : "all";
    lines.push(
      `| ${a.name} | ${a.owner ?? "system"} | ${truncated} | ${riskBadge(a.riskLevel)} | ${envs} | ${a.lastReviewDate ?? "never"} |`
    );
  }
  return lines.join("\n");
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
