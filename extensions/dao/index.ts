import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// Internal modules
import { getState, setState, restoreState, toolResult } from "./persistence.js";
import { initializeAgents, addAgent, removeAgent, listAgents, getAgent, formatAgentsTable } from "./agents.js";
import {
  createProposal, getProposal, listProposals, updateProposalStatus,
  storeDeliberationResults, storeExecutionResult, formatProposal,
} from "./proposals.js";
import { parseVoteFromOutput, tallyVotes, formatTallyResult } from "./voting.js";
import { dispatchSwarm } from "./swarm.js";
import { synthesize } from "./synthesis.js";
import { executeProposal } from "./execution.js";
import { renderDashboard, renderDeliberationProgress, renderHistory, renderAgentOutputSummary } from "./render.js";

export default function daoExtension(pi: ExtensionAPI) {
  // ================================================================
  // STATE RESTORATION
  // ================================================================

  pi.on("session_start", async (_event, ctx) => {
    restoreState(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    restoreState(ctx);
  });

  // ================================================================
  // SYSTEM PROMPT INJECTION
  // ================================================================

  pi.on("before_agent_start", async (event, _ctx) => {
    const state = getState();

    if (!state.initialized) {
      return {
        systemPrompt:
          event.systemPrompt +
          "\n\n## DAO Swarm\nThe pi-swarm-dao extension is loaded. Use `dao_setup` to initialize the DAO with default agents, or run `/dao` for the dashboard.",
      };
    }

    const agents = state.agents;
    const totalWeight = agents.reduce((s, a) => s + a.weight, 0);
    const agentList = agents
      .map((a) => `${a.name}[${a.weight}]`)
      .join(", ");

    const openProposals = state.proposals.filter(
      (p) => p.status === "open" || p.status === "deliberating"
    );

    let daoContext = `\n\n## DAO Swarm Status`;
    daoContext += `\n- Active agents: ${agents.length} (${agentList}) — Total weight: ${totalWeight}`;
    daoContext += `\n- Open proposals: ${openProposals.length}`;
    if (openProposals.length > 0) {
      for (const p of openProposals) {
        daoContext += `\n  - #${p.id} "${p.title}" (${p.status})`;
      }
    }
    daoContext += `\n- Config: quorum=${state.config.quorumPercent}%, approval=${state.config.approvalThreshold}%`;
    daoContext += `\n\nYou have access to DAO governance tools. Use \`dao_propose\` to create proposals and \`dao_deliberate\` to run the full deliberation cycle with all agents.`;

    return {
      systemPrompt: event.systemPrompt + daoContext,
    };
  });

  // ================================================================
  // TOOL: dao_setup
  // ================================================================

  pi.registerTool({
    name: "dao_setup",
    label: "DAO Setup",
    description:
      "Initialize the DAO with default agents (Product Strategist, Research Agent, Solution Architect, Critic/Risk Agent, Prioritization Agent, Spec Writer, Delivery Agent) or custom agents.",
    parameters: Type.Object({
      useDefaults: Type.Optional(
        Type.Boolean({
          description: "Use the 7 default agents. Defaults to true.",
        })
      ),
    }),
    promptSnippet: "dao_setup — Initialize the DAO with 7 default product agents",
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const state = getState();

      if (state.initialized) {
        return toolResult(
          `DAO is already initialized with ${state.agents.length} agents. Use dao_add_agent/dao_remove_agent to modify.`
        );
      }

      const useDefaults = params.useDefaults !== false;
      const agents = initializeAgents(useDefaults ? undefined : []);

      const table = formatAgentsTable(agents);
      return toolResult(
        `# DAO Initialized\n\n${agents.length} agents configured:\n\n${table}\n\nThe DAO is ready. Create proposals with \`dao_propose\` and deliberate with \`dao_deliberate\`.`
      );
    },
  });

  // ================================================================
  // TOOL: dao_add_agent
  // ================================================================

  pi.registerTool({
    name: "dao_add_agent",
    label: "DAO Add Agent",
    description:
      "Add a new agent to the DAO with a name, role, description, and vote weight (1-10).",
    parameters: Type.Object({
      id: Type.String({ description: "Unique agent ID (lowercase, no spaces)" }),
      name: Type.String({ description: "Display name of the agent" }),
      role: Type.String({ description: "Brief role description" }),
      description: Type.String({ description: "What this agent analyzes and outputs" }),
      weight: Type.Number({ description: "Vote weight from 1 (low) to 10 (high)", minimum: 1, maximum: 10 }),
      model: Type.Optional(Type.String({ description: "LLM model override" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const agent = addAgent(params);
        return toolResult(
          `Agent added: **${agent.name}** (${agent.role}) with weight ${agent.weight}\n\n${formatAgentsTable(listAgents())}`
        );
      } catch (err: any) {
        return toolResult(`Error: ${err.message}`);
      }
    },
  });

  // ================================================================
  // TOOL: dao_remove_agent
  // ================================================================

  pi.registerTool({
    name: "dao_remove_agent",
    label: "DAO Remove Agent",
    description: "Remove an agent from the DAO by their ID.",
    parameters: Type.Object({
      agentId: Type.String({ description: "ID of the agent to remove" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const removed = removeAgent(params.agentId);
        return toolResult(
          `Agent removed: **${removed.name}** (${removed.role})\n\n${formatAgentsTable(listAgents())}`
        );
      } catch (err: any) {
        return toolResult(`Error: ${err.message}`);
      }
    },
  });

  // ================================================================
  // TOOL: dao_list_agents
  // ================================================================

  pi.registerTool({
    name: "dao_list_agents",
    label: "DAO List Agents",
    description: "List all agents in the DAO with their roles and vote weights.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const agents = listAgents();
      if (agents.length === 0) {
        return toolResult("No agents configured. Run `dao_setup` first.");
      }
      return toolResult(`# DAO Agents\n\n${formatAgentsTable(agents)}`);
    },
  });

  // ================================================================
  // TOOL: dao_propose
  // ================================================================

  pi.registerTool({
    name: "dao_propose",
    label: "DAO Propose",
    description:
      "Create a new proposal for the DAO to deliberate on. Provide a title, detailed description, and optional context.",
    parameters: Type.Object({
      title: Type.String({ description: "Short title for the proposal" }),
      description: Type.String({ description: "Detailed description of what is being proposed" }),
      context: Type.Optional(Type.String({ description: "Additional context (market data, constraints, etc.)" })),
    }),
    promptSnippet: "dao_propose — Submit a new proposal for DAO deliberation",
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const state = getState();
      if (!state.initialized) {
        return toolResult("DAO not initialized. Run `dao_setup` first.");
      }

      const proposal = createProposal(
        params.title,
        params.description,
        "user",
        params.context
      );

      return toolResult(
        `# Proposal #${proposal.id} Created\n\n${formatProposal(proposal)}\n\nRun \`dao_deliberate\` with proposalId ${proposal.id} to start the swarm deliberation.`
      );
    },
  });

  // ================================================================
  // TOOL: dao_deliberate — THE CORE TOOL
  // ================================================================

  pi.registerTool({
    name: "dao_deliberate",
    label: "DAO Deliberate",
    description:
      "Run the full DAO deliberation cycle: dispatch all agents in parallel, collect analyses, synthesize results, and tally weighted votes. Returns the verdict (approved/rejected) with full synthesis.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the proposal to deliberate on" }),
    }),
    promptSnippet: "dao_deliberate — Run parallel swarm deliberation + weighted vote on a proposal",
    promptGuidelines: [
      "Use dao_deliberate after creating a proposal with dao_propose to get the full DAO verdict",
      "The deliberation runs all agents in parallel — it may take 30-60 seconds",
    ],
    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const state = getState();
      if (!state.initialized) {
        return toolResult("DAO not initialized. Run `dao_setup` first.");
      }

      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }

      if (proposal.status !== "open") {
        return toolResult(
          `Proposal #${proposal.id} is not open for deliberation (status: ${proposal.status}).`
        );
      }

      const agents = listAgents();
      if (agents.length === 0) {
        return toolResult("No agents in the DAO. Add agents first.");
      }

      // Update status
      updateProposalStatus(proposal.id, "deliberating");

      const startTime = Date.now();

      // Stream progress updates
      onUpdate?.({
        content: [{ type: "text", text: renderDeliberationProgress(0, agents.length, "Starting...") }],
      });

      // Dispatch swarm — all agents in parallel
      const agentOutputs = await dispatchSwarm(
        proposal,
        agents,
        signal,
        (completed, total, agentName) => {
          onUpdate?.({
            content: [
              {
                type: "text",
                text: renderDeliberationProgress(completed, total, agentName),
              },
            ],
          });
        }
      );

      // Parse votes from each agent's output
      const votes = agentOutputs.map((output) => {
        const agent = getAgent(output.agentId);
        if (output.error || !output.content) {
          return {
            agentId: output.agentId,
            agentName: output.agentName,
            position: "abstain" as const,
            reasoning: output.error ?? "No output",
            weight: agent?.weight ?? 1,
          };
        }
        return parseVoteFromOutput(
          output.agentId,
          output.agentName,
          agent?.weight ?? 1,
          output.content
        );
      });

      // Attach parsed votes to outputs
      for (let i = 0; i < agentOutputs.length; i++) {
        agentOutputs[i].vote = votes[i];
      }

      // Synthesize all outputs
      const synthDoc = synthesize(agentOutputs, votes);

      // Tally votes
      const tally = tallyVotes(proposal.id, votes);

      // Update proposal with results
      const finalStatus = tally.approved ? "approved" : "rejected";
      storeDeliberationResults(proposal.id, agentOutputs, synthDoc, votes);
      updateProposalStatus(proposal.id, finalStatus);

      const durationMs = Date.now() - startTime;

      // Build the full result
      const tallyFormatted = formatTallyResult(tally);
      const agentSummary = renderAgentOutputSummary(agentOutputs);

      const resultText = [
        `# Deliberation Complete — Proposal #${proposal.id}`,
        "",
        `**Verdict: ${tally.approved ? "✅ APPROVED" : "❌ REJECTED"}** (${(tally.approvalScore * 100).toFixed(1)}% weighted approval)`,
        `**Duration:** ${(durationMs / 1000).toFixed(1)}s`,
        "",
        tallyFormatted,
        "",
        agentSummary,
        "",
        "---",
        "",
        synthDoc,
      ].join("\n");

      return toolResult(resultText, { deliberation: { proposalId: proposal.id, tally, durationMs } });
    },
  });

  // ================================================================
  // TOOL: dao_tally
  // ================================================================

  pi.registerTool({
    name: "dao_tally",
    label: "DAO Tally",
    description: "Show the detailed vote results for a proposal that has been deliberated on.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the proposal" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }

      if (proposal.votes.length === 0) {
        return toolResult(`Proposal #${proposal.id} has not been deliberated on yet.`);
      }

      const tally = tallyVotes(proposal.id, proposal.votes);
      return toolResult(formatTallyResult(tally));
    },
  });

  // ================================================================
  // TOOL: dao_execute
  // ================================================================

  pi.registerTool({
    name: "dao_execute",
    label: "DAO Execute",
    description:
      "Execute an approved proposal by delegating to the Delivery Agent (or a specified agent) to produce a concrete implementation plan.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the approved proposal" }),
      executorId: Type.Optional(
        Type.String({
          description: 'ID of the agent to execute (default: "delivery")',
        })
      ),
    }),
    promptSnippet: "dao_execute — Transform an approved proposal into an actionable plan",
    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }

      if (proposal.status !== "approved") {
        return toolResult(
          `Proposal #${proposal.id} is not approved (status: ${proposal.status}). Only approved proposals can be executed.`
        );
      }

      onUpdate?.({
        content: [{ type: "text", text: "🚀 Executing proposal — delegating to Delivery Agent..." }],
      });

      try {
        const result = await executeProposal(proposal, params.executorId, signal);
        storeExecutionResult(proposal.id, result);

        return toolResult(
          `# Execution Plan — Proposal #${proposal.id}\n\n${result}`
        );
      } catch (err: any) {
        updateProposalStatus(proposal.id, "failed");
        return toolResult(`Execution failed: ${err.message}`);
      }
    },
  });

  // ================================================================
  // COMMAND: /dao
  // ================================================================

  pi.registerCommand("dao", {
    description: "Show the DAO dashboard with agents, proposals, and configuration",
    async execute(_args, ctx) {
      const state = getState();
      const dashboard = renderDashboard(state);

      if (ctx.hasUI) {
        ctx.ui.notify(
          state.initialized
            ? `DAO active: ${state.agents.length} agents, ${state.proposals.length} proposals`
            : "DAO not initialized — use dao_setup",
          "info"
        );
      }

      pi.sendMessage({
        customType: "dao-dashboard",
        content: dashboard,
        display: true,
      });
    },
  });

  // ================================================================
  // COMMAND: /dao-propose
  // ================================================================

  pi.registerCommand("dao-propose", {
    description: "Interactively create a new proposal",
    async execute(_args, ctx) {
      if (!ctx.hasUI) {
        pi.sendMessage({
          customType: "dao-error",
          content: "Interactive proposal creation requires UI mode. Use the `dao_propose` tool instead.",
          display: true,
        });
        return;
      }

      const state = getState();
      if (!state.initialized) {
        ctx.ui.notify("DAO not initialized. Run dao_setup first.", "warning");
        return;
      }

      const title = await ctx.ui.input("Proposal Title", "Enter a short title...");
      if (!title) return;

      const description = await ctx.ui.editor(
        "Proposal Description",
        "Describe what you are proposing in detail..."
      );
      if (!description) return;

      const addContext = await ctx.ui.confirm(
        "Additional Context",
        "Do you want to add additional context (market data, constraints, etc.)?"
      );

      let context: string | undefined;
      if (addContext) {
        context =
          (await ctx.ui.editor(
            "Additional Context",
            "Add any supporting context..."
          )) ?? undefined;
      }

      const proposal = createProposal(title, description, "user", context);

      ctx.ui.notify(`Proposal #${proposal.id} created!`, "info");
      await pi.sendUserMessage(
        `I've created DAO proposal #${proposal.id}: "${proposal.title}". Please run the deliberation on it.`
      );
    },
  });

  // ================================================================
  // COMMAND: /dao-config
  // ================================================================

  pi.registerCommand("dao-config", {
    description: "View or modify DAO configuration",
    async execute(_args, ctx) {
      const state = getState();

      if (!ctx.hasUI) {
        pi.sendMessage({
          customType: "dao-config",
          content: `## DAO Config\n- Quorum: ${state.config.quorumPercent}%\n- Approval: ${state.config.approvalThreshold}%\n- Model: ${state.config.defaultModel}\n- Max concurrent: ${state.config.maxConcurrent}`,
          display: true,
        });
        return;
      }

      const choice = await ctx.ui.select("DAO Configuration", [
        { label: `Quorum: ${state.config.quorumPercent}%`, value: "quorum" },
        { label: `Approval threshold: ${state.config.approvalThreshold}%`, value: "approval" },
        { label: `Default model: ${state.config.defaultModel}`, value: "model" },
        { label: `Max concurrent: ${state.config.maxConcurrent}`, value: "concurrent" },
        { label: "Cancel", value: "cancel" },
      ]);

      if (!choice || choice === "cancel") return;

      const configKey = choice === "quorum"
        ? "quorumPercent"
        : choice === "approval"
          ? "approvalThreshold"
          : choice === "model"
            ? "defaultModel"
            : "maxConcurrent";

      const input = await ctx.ui.input(
        `New value for ${choice}`,
        `Current: ${(state.config as any)[configKey]}`
      );

      if (!input) return;

      if (choice === "quorum") {
        state.config.quorumPercent = Math.max(0, Math.min(100, parseInt(input, 10) || 60));
      } else if (choice === "approval") {
        state.config.approvalThreshold = Math.max(0, Math.min(100, parseInt(input, 10) || 51));
      } else if (choice === "model") {
        state.config.defaultModel = input;
      } else if (choice === "concurrent") {
        state.config.maxConcurrent = Math.max(1, Math.min(8, parseInt(input, 10) || 4));
      }

      setState(state);
      ctx.ui.notify(`Updated ${choice} successfully`, "info");
    },
  });

  // ================================================================
  // COMMAND: /dao-history
  // ================================================================

  pi.registerCommand("dao-history", {
    description: "Show the full history of DAO proposals and deliberations",
    async execute(_args, _ctx) {
      const proposals = listProposals();
      const history = renderHistory(proposals);

      pi.sendMessage({
        customType: "dao-history",
        content: history,
        display: true,
      });
    },
  });
}
