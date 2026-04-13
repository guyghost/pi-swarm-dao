import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

// Cross-cutting
import { getState, setState, restoreState, toolResult } from "./persistence.js";

// Types
import type { ProposalType, AgentRiskLevel } from "./types.js";
import { PROPOSAL_TYPES } from "./types.js";

// Layer 1: Governance
import {
  createProposal, getProposal, listProposals, updateProposalStatus,
  storeDeliberationResults, storeExecutionResult, formatProposal,
} from "./governance/proposals.js";
import { parseVoteFromOutput, tallyVotes, formatTallyResult } from "./governance/voting.js";
import { assertTransition, statusLabel } from "./governance/lifecycle.js";

// Layer 2: Intelligence
import { initializeAgents, addAgent, removeAgent, getAgent, listAgents, formatAgentsTable, formatAgentCard, formatRegistryTable } from "./intelligence/agents.js";
import { dispatchSwarm } from "./intelligence/swarm.js";
import { synthesize } from "./intelligence/synthesis.js";

// Layer 3: Delivery
import { executeProposal } from "./delivery/execution.js";
import { parseDeliveryPlan, storePlan, getPlan, formatPlan } from "./delivery/plan.js";
import { generateReleaseNotes, generateChangelog } from "./delivery/artifacts.js";

// Layer 4: Control
import { runGates } from "./control/gates.js";
import { recordAudit, getProposalAudit, formatAuditTrail } from "./control/audit.js";
import { generateChecklist, formatChecklist, checklistStats } from "./control/checklist.js";

// Rendering
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
          "\n\n## DAO Swarm\nThe pi-swarm-dao extension is loaded (4-layer architecture: Governance → Intelligence → Control → Delivery). Use `dao_setup` to initialize the DAO with default agents, or run `/dao` for the dashboard.",
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

    let daoContext = `\n\n## DAO Swarm Status (4-Layer: Governance → Intelligence → Control → Delivery)`;
    daoContext += `\n- Active agents: ${agents.length} (${agentList}) — Total weight: ${totalWeight}`;
    daoContext += `\n- Open proposals: ${openProposals.length}`;
    if (openProposals.length > 0) {
      for (const p of openProposals) {
        daoContext += `\n  - #${p.id} "${p.title}" (${p.type}) (${p.status})`;
      }
    }
    daoContext += `\n- Config: quorum=${state.config.quorumPercent}%, approval=${state.config.approvalThreshold}%, risk=${state.config.riskThreshold}/10`;

    const riskCounts = agents.reduce((acc, a) => {
      const level = a.riskLevel ?? "unknown";
      acc[level] = (acc[level] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const riskSummary = Object.entries(riskCounts).map(([k, v]) => `${k}:${v}`).join(", ");
    daoContext += `\n- Agent risk profile: ${riskSummary}`;

    daoContext += `\n\nYou have access to DAO governance tools:`;
    daoContext += `\n- \`dao_propose\` → create proposals (types: feature, security, ux, release, policy)`;
    daoContext += `\n- \`dao_deliberate\` → run full swarm deliberation + weighted vote`;
    daoContext += `\n- \`dao_check\` → run control gates on approved proposals before execution`;
    daoContext += `\n- \`dao_plan\` → generate structured delivery plan`;
    daoContext += `\n- \`dao_execute\` → execute controlled/approved proposals`;
    daoContext += `\n- \`dao_audit\` → view full audit trail`;
    daoContext += `\n\nAvailable proposal types: feature (✨ new functionality), security (🔒 permissions/access), ux (🎨 UI/UX), release (📦 publication/rollback), policy (📜 governance rules).`;

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
        `# DAO Initialized\n\n${agents.length} agents configured:\n\n${table}\n\nThe 4-layer DAO is ready:\n- **Governance:** Propose and deliberate\n- **Intelligence:** Agent swarm analysis\n- **Control:** Quality gates & audit trail\n- **Delivery:** Execution & artifacts\n\nCreate proposals with \`dao_propose\` and deliberate with \`dao_deliberate\`.`
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
      owner: Type.Optional(Type.String({ description: "Who is responsible for this agent" })),
      mission: Type.Optional(Type.String({ description: "Clear objective for this agent" })),
      riskLevel: Type.Optional(StringEnum(["low", "medium", "high", "critical"], { description: "Risk classification" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const agent = addAgent({
          ...params,
          riskLevel: params.riskLevel as AgentRiskLevel | undefined,
        });
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
    parameters: Type.Object({
      detailed: Type.Optional(Type.Boolean({ description: "Show full registry view instead of simple table" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const agents = listAgents();
      if (agents.length === 0) {
        return toolResult("No agents configured. Run `dao_setup` first.");
      }
      const output = params.detailed
        ? formatRegistryTable(agents)
        : `# DAO Agents\n\n${formatAgentsTable(agents)}`;
      return toolResult(output);
    },
  });

  // ================================================================
  // TOOL: dao_agent_card
  // ================================================================

  pi.registerTool({
    name: "dao_agent_card",
    label: "DAO Agent Card",
    description: "Show the full registry card for a specific agent, including all 11 registry fields.",
    parameters: Type.Object({
      agentId: Type.String({ description: "ID of the agent to inspect" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const agent = getAgent(params.agentId);
      if (!agent) {
        return toolResult(`Agent "${params.agentId}" not found.`);
      }
      return toolResult(formatAgentCard(agent));
    },
  });

  // ================================================================
  // TOOL: dao_propose
  // ================================================================

  pi.registerTool({
    name: "dao_propose",
    label: "DAO Propose",
    description:
      "Create a new typed proposal for the DAO to deliberate on. Every proposal must have a type (feature, security, ux, release, or policy). Provide a title, type, detailed description, and optional context.",
    parameters: Type.Object({
      title: Type.String({ description: "Short title for the proposal" }),
      type: StringEnum(["feature", "security", "ux", "release", "policy"], {
        description: "Type of proposal: feature, security, ux, release, or policy",
      }),
      description: Type.String({ description: "Detailed description of what is being proposed" }),
      context: Type.Optional(Type.String({ description: "Additional context (market data, constraints, etc.)" })),
    }),
    promptSnippet: "dao_propose — Submit a new typed proposal (feature/security/ux/release/policy) for DAO deliberation",
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const state = getState();
      if (!state.initialized) {
        return toolResult("DAO not initialized. Run `dao_setup` first.");
      }

      const proposal = createProposal(
        params.title,
        params.type as ProposalType, // Safe: StringEnum validates at runtime
        params.description,
        "user",
        params.context
      );

      // Audit: proposal created
      recordAudit(
        proposal.id,
        "governance",
        "proposal_created",
        "user",
        `Proposal "${params.title}" created by user`
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

      // Update status to deliberating
      updateProposalStatus(proposal.id, "deliberating");

      // Audit: deliberation started
      recordAudit(
        proposal.id,
        "governance",
        "deliberation_started",
        "system",
        `Swarm deliberation started with ${agents.length} agents`
      );

      const startTime = Date.now();

      // Stream progress updates
      onUpdate?.({
        content: [{ type: "text", text: renderDeliberationProgress(0, agents.length, "Starting...") }],
        details: undefined,
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
            details: undefined,
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

      // Audit: swarm completed
      const durationMs = Date.now() - startTime;
      recordAudit(
        proposal.id,
        "intelligence",
        "swarm_completed",
        "system",
        `${agentOutputs.length} agents completed in ${(durationMs / 1000).toFixed(1)}s`
      );

      // Synthesize all outputs
      const synthDoc = synthesize(agentOutputs, votes);

      // Tally votes
      const tally = tallyVotes(proposal.id, votes);

      // Update proposal with results
      const finalStatus = tally.approved ? "approved" : "rejected";
      storeDeliberationResults(proposal.id, agentOutputs, synthDoc, votes);
      updateProposalStatus(proposal.id, finalStatus);

      // Audit: votes tallied
      recordAudit(
        proposal.id,
        "governance",
        "votes_tallied",
        "system",
        `Result: ${finalStatus} with ${(tally.approvalScore * 100).toFixed(1)}% weighted approval`
      );

      // Build the full result
      const tallyFormatted = formatTallyResult(tally);
      const agentSummary = renderAgentOutputSummary(agentOutputs);

      let nextStepHint = "";
      if (tally.approved) {
        nextStepHint = "\n\n> **Next step:** Run `dao_check` to validate with control gates before execution.";
      }

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
        nextStepHint,
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
  // TOOL: dao_check — Control Gates
  // ================================================================

  pi.registerTool({
    name: "dao_check",
    label: "DAO Control Check",
    description:
      "Run quality control gates and generate checklist for an approved proposal before execution. Validates quorum, risk, consensus, specs, and delivery feasibility.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the approved proposal to check" }),
    }),
    promptSnippet: "dao_check — Run control gates before execution",
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }

      if (proposal.status !== "approved") {
        return toolResult(
          `Proposal #${proposal.id} is not approved (status: ${statusLabel(proposal.status)}). Only approved proposals can be checked.`
        );
      }

      // Run all gates
      const result = runGates(proposal);

      // Generate checklist
      const checklist = generateChecklist(proposal);
      result.checklist = checklist;

      // Audit: gates checked
      recordAudit(
        proposal.id,
        "control",
        "gates_checked",
        "system",
        `${result.gates.length} gates evaluated: ${result.blockerCount} blockers, ${result.warningCount} warnings`
      );

      // Auto-transition to "controlled" if all gates passed
      if (result.allGatesPassed) {
        assertTransition("approved", "controlled");
        updateProposalStatus(proposal.id, "controlled");
        recordAudit(
          proposal.id,
          "control",
          "status_controlled",
          "system",
          "All gates passed — proposal promoted to controlled"
        );
      }

      // Format output
      const stats = checklistStats(checklist);

      const gateTable = [
        "| Gate | Status | Severity | Message |",
        "|------|--------|----------|---------|",
      ];
      for (const gate of result.gates) {
        const icon = gate.passed ? "✅" : gate.severity === "blocker" ? "🚫" : gate.severity === "warning" ? "⚠️" : "ℹ️";
        gateTable.push(`| ${gate.name} | ${icon} ${gate.passed ? "Pass" : "Fail"} | ${gate.severity} | ${gate.message} |`);
      }

      const lines = [
        `# Control Check — Proposal #${proposal.id}`,
        "",
        `**Result:** ${result.allGatesPassed ? "✅ ALL GATES PASSED" : "🚫 GATES BLOCKED"}`,
        `**Gates:** ${result.gates.filter((g) => g.passed).length}/${result.gates.length} passed | ${result.blockerCount} blockers | ${result.warningCount} warnings`,
        "",
        "## Gate Results",
        "",
        ...gateTable,
        "",
        formatChecklist(checklist),
        "",
        `**Checklist:** ${stats.checked}/${stats.total} (${stats.percent}%)`,
      ];

      if (result.allGatesPassed) {
        lines.push("");
        lines.push("> **Ready for execution.** Run `dao_plan` to generate a delivery plan, or `dao_execute` to proceed directly.");
      } else {
        lines.push("");
        lines.push("> **Blocked.** Review the failing gates above. You may resolve issues and re-run `dao_check`, or proceed at your own risk.");
      }

      return toolResult(lines.join("\n"), { controlCheck: result });
    },
  });

  // ================================================================
  // TOOL: dao_audit — Audit Trail
  // ================================================================

  pi.registerTool({
    name: "dao_audit",
    label: "DAO Audit Trail",
    description: "Show the full audit trail for a proposal or all proposals.",
    parameters: Type.Object({
      proposalId: Type.Optional(Type.Number({ description: "Specific proposal ID (omit for full audit)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      let entries;

      if (params.proposalId !== undefined) {
        const proposal = getProposal(params.proposalId);
        if (!proposal) {
          return toolResult(`Proposal #${params.proposalId} not found.`);
        }
        entries = getProposalAudit(params.proposalId);
      } else {
        entries = getState().auditLog;
      }

      if (entries.length === 0) {
        return params.proposalId !== undefined
          ? toolResult(`No audit entries found for proposal #${params.proposalId}.`)
          : toolResult("No audit entries recorded yet.");
      }

      return toolResult(formatAuditTrail(entries));
    },
  });

  // ================================================================
  // TOOL: dao_plan — Delivery Plan
  // ================================================================

  pi.registerTool({
    name: "dao_plan",
    label: "DAO Delivery Plan",
    description: "Generate or show the structured delivery plan for an approved/controlled proposal.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the proposal" }),
    }),
    promptSnippet: "dao_plan — Show structured delivery plan with phases, tasks, and timeline",
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }

      if (proposal.status !== "approved" && proposal.status !== "controlled") {
        return toolResult(
          `Proposal #${proposal.id} is not approved/controlled (status: ${statusLabel(proposal.status)}). Only approved or controlled proposals can have delivery plans.`
        );
      }

      // Check for existing plan
      let plan = getPlan(params.proposalId);

      if (!plan) {
        // Parse plan from delivery agent output, or from execution result / synthesis
        const deliveryOutput = proposal.agentOutputs.find((o) => o.agentId === "delivery")?.content
          ?? proposal.executionResult
          ?? proposal.synthesis
          ?? proposal.description;

        plan = parseDeliveryPlan(params.proposalId, deliveryOutput);
        storePlan(plan);

        recordAudit(
          proposal.id,
          "delivery",
          "plan_generated",
          "system",
          `Delivery plan created with ${plan.phases.length} phases, ${plan.phases.reduce((n, p) => n + p.tasks.length, 0)} tasks`
        );
      }

      return toolResult(formatPlan(plan));
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

      // Accept both "approved" (legacy) and "controlled" status
      if (proposal.status !== "approved" && proposal.status !== "controlled") {
        return toolResult(
          `Proposal #${proposal.id} is not approved or controlled (status: ${statusLabel(proposal.status)}). Only approved/controlled proposals can be executed.`
        );
      }

      let warning = "";
      if (proposal.status === "approved") {
        warning = "\n\n> ⚠️ **Note:** This proposal was executed without passing through control gates (`dao_check`). Consider running `dao_check` before execution for better quality assurance.";
      }

      onUpdate?.({
        content: [{ type: "text", text: "🚀 Executing proposal — delegating to Delivery Agent..." }],
        details: undefined,
      });

      try {
        const result = await executeProposal(proposal, params.executorId, signal);
        storeExecutionResult(proposal.id, result);

        // Audit: execution completed
        recordAudit(
          proposal.id,
          "delivery",
          "execution_completed",
          "system",
          `Execution completed for proposal #${proposal.id}`
        );

        return toolResult(
          `# Execution Plan — Proposal #${proposal.id}\n\n${result}${warning}`
        );
      } catch (err: any) {
        updateProposalStatus(proposal.id, "failed");

        recordAudit(
          proposal.id,
          "delivery",
          "execution_failed",
          "system",
          `Execution failed: ${err.message}`
        );

        return toolResult(`Execution failed: ${err.message}`);
      }
    },
  });

  // ================================================================
  // COMMAND: /dao
  // ================================================================

  pi.registerCommand("dao", {
    description: "Show the DAO dashboard with agents, proposals, and configuration",
    async handler(_args: string, ctx: ExtensionCommandContext) {
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
    async handler(_args: string, ctx: ExtensionCommandContext) {
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

      const selectedType = await ctx.ui.select(
        "Proposal Type",
        PROPOSAL_TYPES
      );
      if (!selectedType) return;

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

      const proposal = createProposal(title, selectedType as ProposalType, description, "user", context);

      // Audit: proposal created via command
      recordAudit(
        proposal.id,
        "governance",
        "proposal_created",
        "user",
        `Proposal "${title}" created via /dao-propose command`
      );

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
    async handler(_args: string, ctx: ExtensionCommandContext) {
      const state = getState();

      if (!ctx.hasUI) {
        pi.sendMessage({
          customType: "dao-config",
          content: `## DAO Config\n- Quorum: ${state.config.quorumPercent}%\n- Approval: ${state.config.approvalThreshold}%\n- Model: ${state.config.defaultModel}\n- Max concurrent: ${state.config.maxConcurrent}\n- Risk threshold: ${state.config.riskThreshold}/10\n- Required gates: ${state.config.requiredGates.join(", ")}`,
          display: true,
        });
        return;
      }

      const options = [
        `Quorum: ${state.config.quorumPercent}%`,
        `Approval threshold: ${state.config.approvalThreshold}%`,
        `Default model: ${state.config.defaultModel}`,
        `Max concurrent: ${state.config.maxConcurrent}`,
        `Risk threshold: ${state.config.riskThreshold}/10`,
        "Cancel",
      ];
      const choice = await ctx.ui.select("DAO Configuration", options);

      if (!choice || choice === "Cancel") return;

      const configMap: Record<string, { key: keyof typeof state.config; parse: (v: string) => any }> = {
        "Quorum": { key: "quorumPercent", parse: (v) => Math.max(0, Math.min(100, parseInt(v, 10) || 60)) },
        "Approval": { key: "approvalThreshold", parse: (v) => Math.max(0, Math.min(100, parseInt(v, 10) || 51)) },
        "Default": { key: "defaultModel", parse: (v) => v },
        "Max": { key: "maxConcurrent", parse: (v) => Math.max(1, Math.min(8, parseInt(v, 10) || 4)) },
        "Risk": { key: "riskThreshold", parse: (v) => Math.max(1, Math.min(10, parseInt(v, 10) || 7)) },
      };

      const prefix = choice.split(" ")[0];
      const mapping = configMap[prefix];
      if (!mapping) return;

      const input = await ctx.ui.input(
        `New value for ${mapping.key}`,
        `Current: ${state.config[mapping.key]}`
      );

      if (!input) return;

      (state.config as any)[mapping.key] = mapping.parse(input);
      setState(state);
      ctx.ui.notify(`Updated ${mapping.key} successfully`, "info");
    },
  });

  // ================================================================
  // COMMAND: /dao-history
  // ================================================================

  pi.registerCommand("dao-history", {
    description: "Show the full history of DAO proposals and deliberations",
    async handler(_args: string, _ctx: ExtensionCommandContext) {
      const proposals = listProposals();
      const history = renderHistory(proposals);

      pi.sendMessage({
        customType: "dao-history",
        content: history,
        display: true,
      });
    },
  });

  // ================================================================
  // COMMAND: /dao-audit
  // ================================================================

  pi.registerCommand("dao-audit", {
    description: "Show the full DAO audit trail across all proposals",
    async handler(_args: string, _ctx: ExtensionCommandContext) {
      const state = getState();
      const trail = formatAuditTrail(state.auditLog);

      pi.sendMessage({
        customType: "dao-audit",
        content: trail,
        display: true,
      });
    },
  });
}
