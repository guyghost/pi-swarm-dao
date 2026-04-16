import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

// Cross-cutting
import { getState, setState, restoreState, toolResult } from "./persistence.js";

// Types
import type { ProposalType, AgentRiskLevel, DAOArtefacts, ProposalContent, CompositeScore, AmendmentPayload, AmendmentOrigin, AmendmentState } from "./types.js";
import { PROPOSAL_TYPES, PROPOSAL_TYPE_LABELS } from "./types.js";

// Layer 1: Governance
import {
  createProposal, getProposal, listProposals, updateProposalStatus,
  storeDeliberationResults, storeExecutionResult, storeCompositeScore, formatProposal,
} from "./governance/proposals.js";
import { parseVoteFromOutput, tallyVotes, formatTallyResult } from "./governance/voting.js";
import { assertTransition, statusLabel } from "./governance/lifecycle.js";
import { calculateCompositeScore, parseScoresFromOutput, applyMalus, formatCompositeScore, calculateRICEScore, parseRICEFromOutput, rankByRICE, formatRICEScore } from "./governance/scoring.js";
import { classifyRiskZone, formatZoneClassification } from "./governance/zones.js";
import { validateAmendmentPayload, previewAmendment, executeAmendment, rollbackAmendment } from "./governance/amendments.js";
import { validateCouncilApproval, formatCouncilInfo } from "./governance/councils.js";

// Layer 2: Intelligence
import { initializeAgents, addAgent, removeAgent, updateAgent, getAgent, listAgents, formatAgentsTable, formatAgentCard, formatRegistryTable } from "./intelligence/agents.js";
import { dispatchSwarm } from "./intelligence/swarm.js";
import { synthesize } from "./intelligence/synthesis.js";

// Layer 3: Delivery
import { executeProposal } from "./delivery/execution.js";
import { verifyExecution, formatVerification } from "./delivery/verification.js";
import { getOutcome, initOutcome, addRating, addMetric, markReviewed, generateDashboard } from "./delivery/outcomes.js";
import { captureSnapshot, updateSnapshotFiles, getSnapshot, performDryRun, performRollback } from "./delivery/dry-run.js";
import { detectHostContext, formatHostContext, buildAgentHostContext } from "./host-context.js";

// Round Table
import { runRoundTable, formatRoundTable } from "./intelligence/round-table.js";

// GitHub Issues Persistence
import {
  ghCreateProposal, ghUpdateStatus, ghAddDeliberation,
  ghAddControlResult, ghAddExecution, ghAddArtefacts,
  ghAddPlan, ghRestoreState, getIssueNumber, ghCloseImplemented,
} from "./github-persistence.js";
import { parseDeliveryPlan, storePlan, getPlan, formatPlan } from "./delivery/plan.js";
import {
  generateAllArtefacts,
  formatAllArtefacts,
  formatArtefactsSummary,
  formatDecisionBrief,
  formatADR,
  formatRiskReport,
  formatPRDLite,
  formatImplementationPlan,
  formatTestPlan,
  formatReleasePacket,
} from "./delivery/artefacts.js";

// Layer 4: Control
import { runGates } from "./control/gates.js";
import { recordAudit, getProposalAudit, formatAuditTrail } from "./control/audit.js";
import { generateChecklist, formatChecklist, checklistStats } from "./control/checklist.js";

// Rendering
import { renderDashboard, renderDeliberationProgress, renderControlResult, renderHistory, renderAgentOutputSummary, renderAmendmentDiff, renderAmendmentStatus } from "./render.js";
import { renderPipelineDashboard, renderProposalCard, parseFilterArgs } from "./render-pipeline.js";

export default function daoExtension(pi: ExtensionAPI) {
  // ================================================================
  // STATE RESTORATION
  // ================================================================

  pi.on("session_start", async (_event, ctx) => {
    restoreState(ctx);
    ghRestoreState(); // Restore proposal → issue mapping
  });

  pi.on("session_tree", async (_event, ctx) => {
    restoreState(ctx);
    ghRestoreState();
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
    daoContext += `\n- \`dao_propose\` → create proposals (types: product-feature, security-change, technical-change, release-change, governance-change)`;
    daoContext += `\n- \`dao_deliberate\` → run full swarm deliberation + weighted vote + composite scoring`;
    daoContext += `\n- \`dao_check\` → run control gates on approved proposals before execution`;
    daoContext += `\n- \`dao_plan\` → generate structured delivery plan`;
    daoContext += `\n- \`dao_execute\` → execute controlled/approved proposals`;
    daoContext += `\n- \`dao_artefacts\` → view auto-generated artefacts (Decision Brief, ADR, Risk Report, PRD Lite, Implementation Plan, Test Plan, Release Packet)`;
    daoContext += `\n- \`dao_audit\` → view full audit trail`;
    daoContext += `\n- \`dao_rate\` → rate proposal outcomes post-execution (1-5 stars)`;
    daoContext += `\n- \`dao_dashboard\` → view outcome tracking dashboard`;
    daoContext += `\n- \`dao_dry_run\` → preview execution without applying changes`;
    daoContext += `\n- \`dao_rollback\` → revert proposal to pre-execution snapshot`;
    daoContext += `\n- \`dao_verify\` → verify execution results (files, tests, compilation)`;
    daoContext += `\n\n**Self-Amending Tools:**`;
    daoContext += `\n- \`dao_propose_amendment\` → propose changes to DAO agents, config, quorum, gates, or councils`;
    daoContext += `\n- \`dao_update_agent\` → shortcut to propose agent property changes (creates governance-change proposal)`;
    daoContext += `\n- \`dao_update_config\` → shortcut to propose config changes (creates governance-change proposal)`;
    daoContext += `\n- \`dao_preview_amendment\` → preview amendment diff before execution`;
    daoContext += `\n- \`dao_approve_amendment\` → human confirmation to execute an approved amendment`;
    daoContext += `\n\nAvailable proposal types: product-feature (✨), security-change (🔒), technical-change (⚙️), release-change (📦), governance-change (📜).`;
    daoContext += `\nEach type has per-type quorum thresholds and maps to a council (product-council, security-council, delivery-council, governance-council).`;
    daoContext += `\nRisk zones: 🟢 Green (auto-approve), 🟠 Orange (council review), 🔴 Red (formal vote + security).`;

    // Inject host project context so the agent knows WHERE it's running
    const hostCtx = detectHostContext();
    daoContext += `\n\n## Host Project Context`;
    daoContext += `\n- **Project:** ${hostCtx.repoSlug}`;
    daoContext += `\n- **Root:** ${hostCtx.rootDir}`;
    daoContext += `\n- **Branch:** ${hostCtx.branch}`;
    daoContext += `\n- **Language:** ${hostCtx.language}`;
    if (hostCtx.framework) daoContext += `\n- **Framework:** ${hostCtx.framework}`;
    if (hostCtx.packageManager) daoContext += `\n- **Package Manager:** ${hostCtx.packageManager}`;
    if (hostCtx.isSelfRepo) daoContext += `\n- ⚠️ Running inside pi-swarm-dao's own repository`;
    daoContext += `\n- Proposals and executions target this project, not the DAO extension itself.`;

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
  // TOOL: dao_propose_amendment
  // ================================================================

  pi.registerTool({
    name: "dao_propose_amendment",
    label: "DAO Propose Amendment",
    description:
      "Propose an amendment to the DAO itself (agents, config, quorum, gates, councils). Creates a governance-change proposal with the amendment payload attached. The amendment must pass deliberation + control gates before execution.",
    parameters: Type.Object({
      title: Type.String({ description: "Short title for the amendment" }),
      description: Type.String({ description: "Why this amendment is needed" }),
      amendmentType: StringEnum(
        ["agent-update", "agent-add", "agent-remove", "config-update", "quorum-update", "gate-update", "council-update"],
        { description: "Type of amendment" }
      ),
      // agent-update fields
      agentId: Type.Optional(Type.String({ description: "Agent ID (for agent-update, agent-remove, council-update)" })),
      agentChanges: Type.Optional(Type.String({ description: "JSON object of agent fields to change (for agent-update). E.g. '{\"weight\": 4, \"role\": \"new role\"}'" })),
      // agent-add fields
      newAgentId: Type.Optional(Type.String({ description: "New agent ID (for agent-add)" })),
      newAgentName: Type.Optional(Type.String({ description: "New agent name (for agent-add)" })),
      newAgentRole: Type.Optional(Type.String({ description: "New agent role (for agent-add)" })),
      newAgentDescription: Type.Optional(Type.String({ description: "New agent description (for agent-add)" })),
      newAgentWeight: Type.Optional(Type.Number({ description: "New agent weight 1-10 (for agent-add)", minimum: 1, maximum: 10 })),
      // config-update fields
      configChanges: Type.Optional(Type.String({ description: "JSON object of config fields to change (for config-update). E.g. '{\"quorumPercent\": 65}'" })),
      // quorum-update fields
      quorumChanges: Type.Optional(Type.String({ description: "JSON object of per-type quorum changes (for quorum-update). E.g. '{\"governance-change\": {\"quorumPercent\": 75}}'" })),
      // gate-update fields
      addGates: Type.Optional(Type.Array(Type.String(), { description: "Gate IDs to add (for gate-update)" })),
      removeGates: Type.Optional(Type.Array(Type.String(), { description: "Gate IDs to remove (for gate-update)" })),
      // council-update fields
      councils: Type.Optional(Type.String({ description: "JSON array of council memberships (for council-update). E.g. '[{\"council\": \"governance-council\", \"role\": \"lead\"}]'" })),
      // Origin
      originSource: Type.Optional(StringEnum(["human", "agent"], { description: "Who initiated this amendment (default: human)" })),
      originAgentId: Type.Optional(Type.String({ description: "Agent ID that initiated (if originSource is agent)" })),
    }),
    promptSnippet: "dao_propose_amendment — Propose a self-amendment to the DAO (agents, config, quorum, gates, councils)",
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const state = getState();
      if (!state.initialized) {
        return toolResult("DAO not initialized. Run `dao_setup` first.");
      }

      // Build the amendment payload from params
      let payload: AmendmentPayload;
      try {
        switch (params.amendmentType) {
          case "agent-update": {
            if (!params.agentId) return toolResult("Error: agentId is required for agent-update");
            if (!params.agentChanges) return toolResult("Error: agentChanges JSON is required for agent-update");
            const changes = JSON.parse(params.agentChanges);
            payload = { type: "agent-update", agentId: params.agentId, changes };
            break;
          }
          case "agent-add": {
            if (!params.newAgentId || !params.newAgentName || !params.newAgentRole || !params.newAgentDescription || !params.newAgentWeight) {
              return toolResult("Error: newAgentId, newAgentName, newAgentRole, newAgentDescription, newAgentWeight are all required for agent-add");
            }
            payload = {
              type: "agent-add",
              agent: {
                id: params.newAgentId,
                name: params.newAgentName,
                role: params.newAgentRole,
                description: params.newAgentDescription,
                weight: params.newAgentWeight,
              },
            };
            break;
          }
          case "agent-remove": {
            if (!params.agentId) return toolResult("Error: agentId is required for agent-remove");
            payload = { type: "agent-remove", agentId: params.agentId };
            break;
          }
          case "config-update": {
            if (!params.configChanges) return toolResult("Error: configChanges JSON is required for config-update");
            const changes = JSON.parse(params.configChanges);
            payload = { type: "config-update", changes };
            break;
          }
          case "quorum-update": {
            if (!params.quorumChanges) return toolResult("Error: quorumChanges JSON is required for quorum-update");
            const typeQuorum = JSON.parse(params.quorumChanges);
            payload = { type: "quorum-update", typeQuorum };
            break;
          }
          case "gate-update": {
            if (!params.addGates?.length && !params.removeGates?.length) {
              return toolResult("Error: at least one of addGates or removeGates is required for gate-update");
            }
            payload = { type: "gate-update", addGates: params.addGates, removeGates: params.removeGates };
            break;
          }
          case "council-update": {
            if (!params.agentId) return toolResult("Error: agentId is required for council-update");
            if (!params.councils) return toolResult("Error: councils JSON is required for council-update");
            const councils = JSON.parse(params.councils);
            payload = { type: "council-update", agentId: params.agentId, councils };
            break;
          }
          default:
            return toolResult(`Error: unknown amendment type: ${params.amendmentType}`);
        }
      } catch (err: any) {
        return toolResult(`Error parsing amendment parameters: ${err.message}`);
      }

      // Validate the payload
      const validation = validateAmendmentPayload(payload);
      if (!validation.valid) {
        return toolResult(`❌ Amendment validation failed:\n${validation.errors.map(e => `- ${e}`).join("\n")}`);
      }

      // Build origin
      const origin: AmendmentOrigin = {
        source: (params.originSource as "human" | "agent") ?? "human",
        agentId: params.originAgentId,
      };

      // Create a governance-change proposal with the amendment attached
      const proposal = createProposal(
        params.title,
        "governance-change" as ProposalType,
        params.description,
        origin.source === "agent" ? `agent:${origin.agentId}` : "user",
        undefined,
      );

      // Attach amendment data
      proposal.amendmentPayload = payload;
      proposal.amendmentOrigin = origin;
      proposal.amendmentState = origin.source === "agent" ? "pending-vote" : "pending-vote";

      // Classify risk zone (amendment-aware)
      const zone = classifyRiskZone(proposal);
      proposal.riskZone = zone;

      // Audit
      recordAudit(
        proposal.id,
        "governance",
        "amendment_proposed",
        origin.source === "agent" ? `agent:${origin.agentId}` : "user",
        `Amendment proposed: ${payload.type} — ${params.title}`,
      );

      // Preview diff
      const diffs = previewAmendment(payload);
      const diffTable = renderAmendmentDiff(diffs);

      const zoneLabel = zone === "red" ? "🔴 Red" : zone === "orange" ? "🟠 Orange" : "🟢 Green";
      const agentWarning = origin.source === "agent"
        ? "\n\n> ⚠️ **Agent-initiated amendment** — requires DAO vote + human confirmation via `dao_approve_amendment`."
        : "";

      return toolResult(
        `# 📜 Amendment Proposed — #${proposal.id}\n\n` +
        `**Title:** ${params.title}\n` +
        `**Type:** ${payload.type}\n` +
        `**Risk Zone:** ${zoneLabel}\n` +
        `**Origin:** ${origin.source}${origin.agentId ? ` (${origin.agentId})` : ""}\n\n` +
        diffTable +
        agentWarning +
        `\n\nRun \`dao_deliberate\` with proposalId ${proposal.id} to start deliberation.`
      );
    },
  });

  // ================================================================
  // TOOL: dao_preview_amendment
  // ================================================================

  pi.registerTool({
    name: "dao_preview_amendment",
    label: "DAO Preview Amendment",
    description:
      "Preview the changes an amendment proposal would make without applying them. Shows a before/after diff.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the amendment proposal to preview" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }
      if (!proposal.amendmentPayload) {
        return toolResult(`Proposal #${params.proposalId} is not an amendment proposal.`);
      }

      const diffs = previewAmendment(proposal.amendmentPayload);
      const diffTable = renderAmendmentDiff(diffs);
      const status = renderAmendmentStatus(proposal);

      return toolResult(`${status}\n\n${diffTable}`);
    },
  });

  // ================================================================
  // TOOL: dao_approve_amendment
  // ================================================================

  pi.registerTool({
    name: "dao_approve_amendment",
    label: "DAO Approve Amendment",
    description:
      "Human confirmation to execute an approved amendment. Required for agent-initiated amendments. Executes the amendment with automatic rollback on failure.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the amendment proposal to approve and execute" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }
      if (!proposal.amendmentPayload) {
        return toolResult(`Proposal #${params.proposalId} is not an amendment proposal.`);
      }

      // Must be approved or controlled
      if (proposal.status !== "approved" && proposal.status !== "controlled") {
        return toolResult(
          `Proposal #${proposal.id} is not approved/controlled (status: ${proposal.status}). The amendment must pass deliberation and control gates first.`
        );
      }

      // For agent-initiated: check that the amendment was in approved-pending-human state
      if (
        proposal.amendmentOrigin?.source === "agent" &&
        proposal.amendmentState !== "approved-pending-human" &&
        proposal.amendmentState !== "pending-vote" // also allow if DAO already approved
      ) {
        return toolResult(
          `Amendment state is "${proposal.amendmentState}" — expected "approved-pending-human" for agent-initiated amendments.`
        );
      }

      // Execute the amendment
      const result = executeAmendment(proposal.amendmentPayload);

      if (result.success) {
        proposal.amendmentState = "executed";
        proposal.preAmendmentSnapshot = result.snapshot;
        updateProposalStatus(proposal.id, "executed");

        recordAudit(
          proposal.id,
          "governance",
          "amendment_executed",
          "user",
          `Amendment executed successfully: ${proposal.amendmentPayload.type}`,
        );

        const diffs = previewAmendment(proposal.amendmentPayload);

        return toolResult(
          `# ✅ Amendment Executed — #${proposal.id}\n\n` +
          `**Type:** ${proposal.amendmentPayload.type}\n` +
          `**State:** 🚀 executed\n` +
          `**Snapshot:** Captured at ${result.snapshot.capturedAt} (rollback available)\n\n` +
          renderAmendmentDiff(diffs) +
          `\n\n> 💾 Pre-amendment snapshot saved. Use \`dao_rollback_amendment\` if needed.`
        );
      } else {
        proposal.amendmentState = "rolled-back";

        recordAudit(
          proposal.id,
          "governance",
          "amendment_failed",
          "system",
          `Amendment auto-rolled back: ${result.error}`,
        );

        return toolResult(
          `# ⏪ Amendment Failed & Rolled Back — #${proposal.id}\n\n` +
          `**Error:** ${result.error}\n\n` +
          `The DAO state has been automatically restored to the pre-amendment snapshot.`
        );
      }
    },
  });

  // ================================================================
  // TOOL: dao_update_agent
  // ================================================================

  pi.registerTool({
    name: "dao_update_agent",
    label: "DAO Update Agent",
    description:
      "Update an existing agent's properties. Automatically creates a governance-change proposal with the amendment. Use dao_deliberate to process it.",
    parameters: Type.Object({
      agentId: Type.String({ description: "ID of the agent to update" }),
      weight: Type.Optional(Type.Number({ description: "New vote weight (1-10)", minimum: 1, maximum: 10 })),
      role: Type.Optional(Type.String({ description: "New role description" })),
      name: Type.Optional(Type.String({ description: "New display name" })),
      description: Type.Optional(Type.String({ description: "New description" })),
      model: Type.Optional(Type.String({ description: "New LLM model" })),
      riskLevel: Type.Optional(StringEnum(["low", "medium", "high", "critical"], { description: "New risk level" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const state = getState();
      if (!state.initialized) {
        return toolResult("DAO not initialized. Run `dao_setup` first.");
      }

      const agent = getAgent(params.agentId);
      if (!agent) {
        return toolResult(`Agent "${params.agentId}" not found.`);
      }

      // Build changes object from non-undefined params
      const changes: Record<string, any> = {};
      if (params.weight !== undefined) changes.weight = params.weight;
      if (params.role !== undefined) changes.role = params.role;
      if (params.name !== undefined) changes.name = params.name;
      if (params.description !== undefined) changes.description = params.description;
      if (params.model !== undefined) changes.model = params.model;
      if (params.riskLevel !== undefined) changes.riskLevel = params.riskLevel;

      if (Object.keys(changes).length === 0) {
        return toolResult("No changes specified. Provide at least one field to update.");
      }

      const payload: AmendmentPayload = {
        type: "agent-update",
        agentId: params.agentId,
        changes,
      };

      // Validate
      const validation = validateAmendmentPayload(payload);
      if (!validation.valid) {
        return toolResult(`❌ Validation failed:\n${validation.errors.map(e => `- ${e}`).join("\n")}`);
      }

      // Create governance-change proposal
      const changeDesc = Object.entries(changes).map(([k, v]) => `${k}: ${v}`).join(", ");
      const proposal = createProposal(
        `Update agent ${agent.name}: ${changeDesc}`,
        "governance-change" as ProposalType,
        `Proposed changes to agent "${agent.name}" (${params.agentId}): ${changeDesc}`,
        "user",
      );

      proposal.amendmentPayload = payload;
      proposal.amendmentOrigin = { source: "human" };
      proposal.amendmentState = "pending-vote";
      proposal.riskZone = classifyRiskZone(proposal);

      recordAudit(
        proposal.id,
        "governance",
        "amendment_proposed",
        "user",
        `Agent update amendment: ${params.agentId} — ${changeDesc}`,
      );

      const diffs = previewAmendment(payload);

      return toolResult(
        `# 📜 Agent Update Amendment — #${proposal.id}\n\n` +
        `**Agent:** ${agent.name} (\`${params.agentId}\`)\n` +
        `**Risk Zone:** ${proposal.riskZone === "red" ? "🔴 Red" : proposal.riskZone === "orange" ? "🟠 Orange" : "🟢 Green"}\n\n` +
        renderAmendmentDiff(diffs) +
        `\n\nRun \`dao_deliberate\` with proposalId ${proposal.id} to start deliberation.`
      );
    },
  });

  // ================================================================
  // TOOL: dao_update_config
  // ================================================================

  pi.registerTool({
    name: "dao_update_config",
    label: "DAO Update Config",
    description:
      "Update DAO configuration settings. Automatically creates a governance-change proposal with the amendment. Use dao_deliberate to process it.",
    parameters: Type.Object({
      quorumPercent: Type.Optional(Type.Number({ description: "New quorum percentage", minimum: 1, maximum: 100 })),
      approvalThreshold: Type.Optional(Type.Number({ description: "New approval threshold percentage", minimum: 1, maximum: 100 })),
      riskThreshold: Type.Optional(Type.Number({ description: "New risk threshold (1-10)", minimum: 1, maximum: 10 })),
      maxConcurrent: Type.Optional(Type.Number({ description: "Max concurrent agents", minimum: 1, maximum: 8 })),
      defaultModel: Type.Optional(Type.String({ description: "New default LLM model" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const state = getState();
      if (!state.initialized) {
        return toolResult("DAO not initialized. Run `dao_setup` first.");
      }

      const changes: Record<string, any> = {};
      if (params.quorumPercent !== undefined) changes.quorumPercent = params.quorumPercent;
      if (params.approvalThreshold !== undefined) changes.approvalThreshold = params.approvalThreshold;
      if (params.riskThreshold !== undefined) changes.riskThreshold = params.riskThreshold;
      if (params.maxConcurrent !== undefined) changes.maxConcurrent = params.maxConcurrent;
      if (params.defaultModel !== undefined) changes.defaultModel = params.defaultModel;

      if (Object.keys(changes).length === 0) {
        return toolResult("No changes specified. Provide at least one config field to update.");
      }

      const payload: AmendmentPayload = {
        type: "config-update",
        changes,
      };

      // Validate
      const validation = validateAmendmentPayload(payload);
      if (!validation.valid) {
        return toolResult(`❌ Validation failed:\n${validation.errors.map(e => `- ${e}`).join("\n")}`);
      }

      // Create governance-change proposal
      const changeDesc = Object.entries(changes).map(([k, v]) => `${k}: ${v}`).join(", ");
      const proposal = createProposal(
        `Update DAO config: ${changeDesc}`,
        "governance-change" as ProposalType,
        `Proposed configuration changes: ${changeDesc}`,
        "user",
      );

      proposal.amendmentPayload = payload;
      proposal.amendmentOrigin = { source: "human" };
      proposal.amendmentState = "pending-vote";
      proposal.riskZone = classifyRiskZone(proposal);

      recordAudit(
        proposal.id,
        "governance",
        "amendment_proposed",
        "user",
        `Config update amendment: ${changeDesc}`,
      );

      const diffs = previewAmendment(payload);

      return toolResult(
        `# 📜 Config Update Amendment — #${proposal.id}\n\n` +
        `**Risk Zone:** ${proposal.riskZone === "red" ? "🔴 Red" : proposal.riskZone === "orange" ? "🟠 Orange" : "🟢 Green"}\n\n` +
        renderAmendmentDiff(diffs) +
        `\n\nRun \`dao_deliberate\` with proposalId ${proposal.id} to start deliberation.`
      );
    },
  });

  // ================================================================
  // TOOL: dao_propose
  // ================================================================

  pi.registerTool({
    name: "dao_propose",
    label: "DAO Propose",
    description:
      "Create a new proposal for the DAO to deliberate on. Requires a title, type, and description. Structured fields (problemStatement, acceptanceCriteria, successMetrics, rollbackConditions) are strongly recommended for quality deliberation.",
    parameters: Type.Object({
      title: Type.String({ description: "Short title for the proposal" }),
      type: StringEnum(PROPOSAL_TYPES, { description: "Proposal type category" }),
      description: Type.String({ description: "Detailed description of what is being proposed" }),
      context: Type.Optional(Type.String({ description: "Additional context (market data, constraints, prior decisions)" })),
      problemStatement: Type.Optional(Type.String({ description: "Structured problem statement: what problem does this solve and for whom?" })),
      acceptanceCriteria: Type.Optional(Type.Array(Type.String(), { description: "Measurable, testable conditions that must be met for the proposal to be considered successful. E.g. ['Test coverage >= 80%', 'Response time < 500ms']" })),
      successMetrics: Type.Optional(Type.Array(Type.String(), { description: "Quantitative metrics to track after execution. E.g. ['deliberation_latency < 60s', 'proposal_throughput >= 5/day']" })),
      rollbackConditions: Type.Optional(Type.Array(Type.String(), { description: "Measurable triggers for rollback. E.g. ['Test suite failure rate > 10%', 'Performance regression > 20%']" })),
    }),
    promptSnippet: "dao_propose — Create a new DAO proposal for swarm deliberation",
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const state = getState();
      if (!state.initialized) {
        return toolResult("DAO not initialized. Run `dao_setup` first.");
      }

      const proposal = createProposal(
        params.title,
        params.type as ProposalType,
        params.description,
        "user",
        params.context,
      );

      // Store structured fields (Proposal #6 — Template)
      const structuredFields: string[] = [];
      const missingFields: string[] = [];

      if (params.problemStatement) {
        (proposal as any).problemStatement = params.problemStatement;
        structuredFields.push("problemStatement");
      } else {
        missingFields.push("problemStatement");
      }

      if (params.acceptanceCriteria && params.acceptanceCriteria.length > 0) {
        proposal.acceptanceCriteria = params.acceptanceCriteria.map((ac, i) => ({
          id: `AC-${i + 1}`,
          given: "Proposal is executed",
          when: "Implementation is verified",
          then: ac,
        }));
        structuredFields.push("acceptanceCriteria");
      } else {
        missingFields.push("acceptanceCriteria");
      }

      if (params.successMetrics && params.successMetrics.length > 0) {
        (proposal as any).successMetrics = params.successMetrics;
        structuredFields.push("successMetrics");
      } else {
        missingFields.push("successMetrics");
      }

      if (params.rollbackConditions && params.rollbackConditions.length > 0) {
        (proposal as any).rollbackConditions = params.rollbackConditions;
        structuredFields.push("rollbackConditions");
      } else {
        missingFields.push("rollbackConditions");
      }

      // Quality warning for missing structured fields
      const qualityWarning = missingFields.length > 0
        ? `\n\n> ⚠️ **Quality Warning:** Missing structured fields: ${missingFields.join(", ")}. These are strongly recommended for quality deliberation and control gate validation. Future versions may require them.`
        : "";

      // Classify risk zone
      const zone = classifyRiskZone(proposal);
      proposal.riskZone = zone;

      // Audit
      recordAudit(
        proposal.id,
        "governance",
        "proposal_created",
        "user",
        `Proposal "${params.title}" created via dao_propose tool`,
      );

      // GitHub Issue — persist proposal
      const ghIssue = ghCreateProposal(proposal);
      const ghNote = ghIssue ? `\n**GitHub Issue:** #${ghIssue}` : "";

      const zoneLabel = zone === "red" ? "🔴 Red" : zone === "orange" ? "🟠 Orange" : "🟢 Green";
      const typeLabel = PROPOSAL_TYPE_LABELS[params.type as ProposalType];

      return toolResult(
        `# 📋 Proposal Created — #${proposal.id}\n\n` +
        `**Title:** ${params.title}\n` +
        `**Type:** ${typeLabel}\n` +
        `**Risk Zone:** ${zoneLabel}\n` +
        `**Status:** 📝 open\n` +
        `**Stage:** intake\n\n` +
        `## Description\n${params.description}\n` +
        (params.context ? `\n\n## Context\n${params.context}` : "") +
        (params.problemStatement ? `\n\n## Problem Statement\n${params.problemStatement}` : "") +
        (params.acceptanceCriteria?.length ? `\n\n## Acceptance Criteria\n${params.acceptanceCriteria.map((c, i) => `- [ ] AC-${i + 1}: ${c}`).join("\n")}` : "") +
        (params.successMetrics?.length ? `\n\n## Success Metrics\n${params.successMetrics.map(m => `- ${m}`).join("\n")}` : "") +
        (params.rollbackConditions?.length ? `\n\n## Rollback Conditions\n${params.rollbackConditions.map(c => `- ${c}`).join("\n")}` : "") +
        `${qualityWarning}${ghNote}\n\nRun \`dao_deliberate\` with proposalId ${proposal.id} to start deliberation.`
      );
    },
  });

  // ================================================================
  // TOOL: dao_deliberate
  // ================================================================

  pi.registerTool({
    name: "dao_deliberate",
    label: "DAO Deliberate",
    description:
      "Run full swarm deliberation on a proposal. Dispatches all 7 agents in parallel, collects votes, synthesizes results, and computes composite score.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the proposal to deliberate on" }),
    }),
    promptSnippet: "dao_deliberate — Run full swarm deliberation with weighted voting",
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const state = getState();
      if (!state.initialized) {
        return toolResult("DAO not initialized. Run `dao_setup` first.");
      }

      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }

      // Must be open to start deliberation
      if (proposal.status !== "open") {
        return toolResult(
          `Proposal #${proposal.id} is not open (status: ${proposal.status}). Only open proposals can be deliberated.`
        );
      }

      // Transition to deliberating
      assertTransition(proposal.status, "deliberating");
      updateProposalStatus(proposal.id, "deliberating");

      recordAudit(
        proposal.id,
        "governance",
        "deliberation_started",
        "system",
        `Deliberation started on proposal #${proposal.id}: ${proposal.title}`,
      );

      // Report progress
      if (onUpdate) {
        onUpdate({
          content: [{ type: "text" as const, text: `🗳️ Starting deliberation on proposal #${proposal.id}: ${proposal.title}...` }],
          details: {},
        });
      }

      const startTime = Date.now();
      const agents = state.agents;

      // Dispatch the swarm
      ctx?.ui?.setWorkingMessage?.("DAO: Deliberating with 10 agents (\u23F3 ~3-6 min)...");
      const agentOutputs = await dispatchSwarm(
        proposal,
        agents,
        signal ?? undefined,
        (completed, total, agentName) => {
          const progress = renderDeliberationProgress(completed, total, agentName);
          ctx?.ui?.setWorkingMessage?.("DAO: " + progress);
          if (onUpdate) {
            onUpdate({
              content: [{ type: "text" as const, text: progress }],
              details: {},
            });
          }
        },
      );

      // Parse votes from each agent output
      const votes = agentOutputs.map((output) => {
        const agent = agents.find((a) => a.id === output.agentId);
        const weight = agent?.weight ?? 1;

        // If there's content, always try to parse a vote from it —
        // even if the agent timed out, partial output may contain a vote
        if (output.content) {
          const parsed = parseVoteFromOutput(output.agentId, output.agentName, weight, output.content);
          // Use the parsed vote if it's a real vote (not a parsing failure)
          if (parsed.position !== "abstain" || parsed.reasoning !== "No vote section found in agent output") {
            return parsed;
          }
        }

        // No content or vote parsing failed — fall back to abstain
        if (output.error) {
          return {
            agentId: output.agentId,
            agentName: output.agentName,
            position: "abstain" as const,
            reasoning: output.error,
            weight,
          };
        }

        return {
          agentId: output.agentId,
          agentName: output.agentName,
          position: "abstain" as const,
          reasoning: "No output produced",
          weight,
        };
      });

      // Synthesize results
      const synthesis = synthesize(agentOutputs, votes);

      // Store results
      storeDeliberationResults(proposal.id, agentOutputs, synthesis, votes);

      // Tally votes
      const tally = tallyVotes(proposal.id, votes, proposal.type);

      // Compute composite score
      const axisScores = parseScoresFromOutput(proposal);
      let compositeScore = calculateCompositeScore(axisScores);

      // Apply malus if structured content is available
      if (proposal.content) {
        compositeScore = applyMalus(compositeScore, proposal.content.permissionsImpact, proposal.content.dataImpact);
      }

      storeCompositeScore(proposal.id, compositeScore);

      // Compute and store RICE score (Proposal #5)
      const riceScore = parseRICEFromOutput(proposal);
      if (riceScore) {
        proposal.riceScore = riceScore;
        getState(); // trigger state update
      }

      // Update proposal status based on tally
      const newStatus: "approved" | "rejected" = tally.approved ? "approved" : "rejected";
      assertTransition("deliberating", newStatus);
      updateProposalStatus(proposal.id, newStatus);

      const durationMs = Date.now() - startTime;

      // Audit
      recordAudit(
        proposal.id,
        "intelligence",
        "deliberation_completed",
        "system",
        `Deliberation completed: ${newStatus} (${tally.weightedFor}/${tally.totalVotingWeight} weighted for, score ${compositeScore.weighted}/100)`,
        { durationMs, tally: { approved: tally.approved, weightedFor: tally.weightedFor, totalVotingWeight: tally.totalVotingWeight } },
      );

      // GitHub Issue — persist deliberation votes and synthesis
      ghAddDeliberation(proposal, agentOutputs, {
        weightedFor: tally.weightedFor,
        weightedAgainst: tally.weightedAgainst,
        totalVotingWeight: tally.totalVotingWeight,
        votingAgents: tally.votingAgents,
        totalAgents: tally.totalAgents,
        quorumMet: tally.quorumMet,
        approvalScore: tally.approvalScore,
      }, durationMs);

      // Format results
      const tallyFormatted = formatTallyResult(tally, proposal.type);
      const scoreFormatted = formatCompositeScore(compositeScore);
      const agentSummary = renderAgentOutputSummary(agentOutputs);
      const zoneFormatted = formatZoneClassification(proposal);

      const verdict = tally.approved ? "✅ APPROVED" : "❌ REJECTED";
      const nextStep = tally.approved
        ? `Run \`dao_check\` with proposalId ${proposal.id} to run control gates.`
        : "The proposal was rejected. You may revise and create a new proposal.";

      ctx?.ui?.setWorkingMessage?.(); // Restore default
      return toolResult(
        `# 🗳️ Deliberation Complete — #${proposal.id}: ${proposal.title}\n\n` +
        `**Verdict:** ${verdict}\n` +
        `**Duration:** ${(durationMs / 1000).toFixed(1)}s (parallel execution)\n\n` +
        tallyFormatted + "\n\n" +
        scoreFormatted + "\n\n" +
        zoneFormatted + "\n\n" +
        agentSummary + "\n\n" +
        `---\n\n` +
        `## Synthesis\n${synthesis.slice(0, 2000)}${synthesis.length > 2000 ? "\n\n[...truncated]" : ""}\n\n` +
        `---\n\n` +
        `**Next:** ${nextStep}`
      );
    },
  });

  // ================================================================
  // TOOL: dao_check
  // ================================================================

  pi.registerTool({
    name: "dao_check",
    label: "DAO Check",
    description:
      "Run control gates on an approved proposal before execution. Checks quorum quality, risk threshold, vote consensus, and more.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the proposal to check" }),
    }),
    promptSnippet: "dao_check — Run control gates on an approved proposal",
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }

      if (proposal.status !== "approved" && proposal.status !== "controlled") {
        return toolResult(
          `Proposal #${proposal.id} is not approved/controlled (status: ${proposal.status}). Run \`dao_deliberate\` first.`
        );
      }

      if (onUpdate) {
        onUpdate({
          content: [{ type: "text" as const, text: `🛡️ Running control gates on proposal #${proposal.id}: ${proposal.title}...` }],
          details: {},
        });
      }

      // Run all gates
      const controlResult = runGates(proposal);

      // Generate checklist
      const checklist = generateChecklist(proposal);
      controlResult.checklist = checklist;

      const stats = checklistStats(checklist);

      // Update status to controlled if all gates passed
      if (controlResult.allGatesPassed && proposal.status !== "controlled") {
        assertTransition(proposal.status, "controlled");
        updateProposalStatus(proposal.id, "controlled");
      }

      // Audit
      recordAudit(
        proposal.id,
        "control",
        controlResult.allGatesPassed ? "gates_passed" : "gates_failed",
        "system",
        `Control check: ${controlResult.blockerCount} blockers, ${controlResult.warningCount} warnings, ${stats.checked}/${stats.total} checklist items`,
      );

      // GitHub Issue — persist control gate results
      ghAddControlResult(proposal, controlResult);

      // Format results
      const gatesFormatted = renderControlResult(controlResult);
      const checklistFormatted = formatChecklist(checklist);

      const nextStep = controlResult.allGatesPassed
        ? `Run \`dao_plan\` with proposalId ${proposal.id} to generate the delivery plan.`
        : "Resolve blockers before proceeding. Address the failed gates above.";

      return toolResult(
        gatesFormatted + "\n\n" +
        checklistFormatted + "\n\n" +
        `---\n\n**Next:** ${nextStep}`
      );
    },
  });

  // ================================================================
  // TOOL: dao_plan
  // ================================================================

  pi.registerTool({
    name: "dao_plan",
    label: "DAO Plan",
    description:
      "Generate or view the delivery plan for an approved/controlled proposal. Parses the Delivery Agent output into phases and tasks.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the proposal to plan" }),
    }),
    promptSnippet: "dao_plan — Generate structured delivery plan",
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }

      if (proposal.status !== "approved" && proposal.status !== "controlled" && proposal.status !== "executed") {
        return toolResult(
          `Proposal #${proposal.id} is not approved/controlled (status: ${proposal.status}). Run \`dao_deliberate\` first.`
        );
      }

      // Check if plan already exists
      const existingPlan = getPlan(proposal.id);
      if (existingPlan) {
        return toolResult(
          formatPlan(existingPlan) +
          `\n\n---\n\nRun \`dao_execute\` with proposalId ${proposal.id} to execute, or \`dao_artefacts\` to view generated artefacts.`
        );
      }

      if (onUpdate) {
        onUpdate({
          content: [{ type: "text" as const, text: `🗂️ Generating delivery plan for proposal #${proposal.id}: ${proposal.title}...` }],
          details: {},
        });
      }

      // Parse delivery plan from the delivery agent's output
      const deliveryOutput = proposal.agentOutputs.find((o) => o.agentId === "delivery");
      const plan = parseDeliveryPlan(
        proposal.id,
        deliveryOutput?.content ?? proposal.description,
      );

      storePlan(plan);

      // Audit
      recordAudit(
        proposal.id,
        "delivery",
        "plan_generated",
        "system",
        `Delivery plan generated: ${plan.phases.length} phases, ${plan.phases.reduce((s, p) => s + p.tasks.length, 0)} tasks, estimated ${plan.estimatedDuration}`,
      );

      // GitHub Issue — persist delivery plan
      ghAddPlan(proposal, formatPlan(plan));

      return toolResult(
        formatPlan(plan) +
        `\n\n---\n\nRun \`dao_execute\` with proposalId ${proposal.id} to execute, or \`dao_artefacts\` to view generated artefacts.`
      );
    },
  });

  // ================================================================
  // TOOL: dao_execute
  // ================================================================

  pi.registerTool({
    name: "dao_execute",
    label: "DAO Execute",
    description:
      "Execute a controlled/approved proposal by delegating to the Delivery Agent. Only proposals that passed control gates should be executed.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the proposal to execute" }),
    }),
    promptSnippet: "dao_execute — Execute an approved proposal via the Delivery Agent",
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }

      // Allow retry from failed status — transition back to controlled first
      if (proposal.status === "failed") {
        assertTransition(proposal.status, "controlled");
        updateProposalStatus(proposal.id, "controlled");
      }

      if (proposal.status !== "approved" && proposal.status !== "controlled") {
        return toolResult(
          `Proposal #${proposal.id} is not approved/controlled (status: ${proposal.status}). It must pass deliberation and control gates first.`
        );
      }

      recordAudit(
        proposal.id,
        "delivery",
        "execution_started",
        "user",
        `Execution started for proposal #${proposal.id}: ${proposal.title}`,
      );

      if (onUpdate) {
        onUpdate({
          content: [{ type: "text" as const, text: `🚀 Executing proposal #${proposal.id}: ${proposal.title}...` }],
          details: {},
        });
      }

      try {
        // Capture pre-execution snapshot for rollback (Proposal #8)
        captureSnapshot(proposal.id);

        // Don't pass pi's tool AbortSignal to the execution subprocess.
        // Pi's tool timeout (~180s) would cause premature aborts.
        // Execution has no internal timeout — it runs until completion or user abort (Ctrl+C).
        ctx?.ui?.setWorkingMessage?.("DAO: Executing proposal (\u23F3 this may take several minutes)...");
        const result = await executeProposal(proposal, undefined);

        ctx?.ui?.setWorkingMessage?.(); // Restore default
        storeExecutionResult(proposal.id, result);

        recordAudit(
          proposal.id,
          "delivery",
          "execution_completed",
          "system",
          `Execution completed successfully for proposal #${proposal.id}`,
        );

        // GitHub Issue — persist execution result
        ghAddExecution(proposal, result);

        // Post-execution verification (Proposal #7)
        const verification = verifyExecution(proposal.id, [], process.cwd());
        const state = getState();
        state.verifications[proposal.id] = verification;

        recordAudit(
          proposal.id,
          "delivery",
          "execution_verified",
          "system",
          `Execution verification: ${verification.status} (${verification.testsPassed ?? 0} tests passed, ${verification.filesChanged.length} files changed)`,
        );

        const verificationSummary = verification.status === "success"
          ? `✅ Verified: ${verification.testsPassed ?? 0} tests passed, ${verification.filesChanged.length} files changed, compilation OK`
          : verification.status === "partial"
          ? `⚠️ Partial: ${verification.testsFailed ?? 0} test(s) failed or ${verification.missingFiles.length} missing file(s)`
          : `❌ Failed: ${verification.summary}`;

        return toolResult(
          `# 🚀 Execution Complete — #${proposal.id}: ${proposal.title}\n\n` +
          `**Status:** ✅ Executed\n` +
          `**Verification:** ${verificationSummary}\n\n` +
          `## Execution Output\n${result}\n\n` +
          `---\n\nRun \`dao_artefacts\` with proposalId ${proposal.id} to view all generated artefacts.`
        );
      } catch (err: any) {
        updateProposalStatus(proposal.id, "failed");

        recordAudit(
          proposal.id,
          "delivery",
          "execution_failed",
          "system",
          `Execution failed: ${err.message}`,
        );

        // GitHub Issue — persist failure
        ghAddExecution(proposal, `⚠️ Execution Failed: ${err.message}`);

        return toolResult(
          `# ⚠️ Execution Failed — #${proposal.id}: ${proposal.title}\n\n` +
          `**Error:** ${err.message}\n\n` +
          `The proposal status has been set to \"failed\". Review the error and try again.`
        );
      }
    },
  });

  // ================================================================
  // TOOL: dao_artefacts
  // ================================================================

  pi.registerTool({
    name: "dao_artefacts",
    label: "DAO Artefacts",
    description:
      "View auto-generated artefacts for a proposal (Decision Brief, ADR, Risk Report, PRD Lite, Implementation Plan, Test Plan, Release Packet). Generates them if not yet created.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the proposal to view artefacts for" }),
      artefact: Type.Optional(StringEnum(
        ["all", "decision-brief", "adr", "risk-report", "prd-lite", "implementation-plan", "test-plan", "release-packet"],
        { description: "Specific artefact to view (default: all)" },
      )),
    }),
    promptSnippet: "dao_artefacts — View auto-generated artefacts (Decision Brief, ADR, Risk Report, PRD, Plan, Tests, Release)",
    async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
      const state = getState();
      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }

      // Must have deliberation results to generate artefacts
      if (proposal.agentOutputs.length === 0) {
        return toolResult(
          `Proposal #${proposal.id} has no deliberation results. Run \`dao_deliberate\` first.`
        );
      }

      const artefact = params.artefact ?? "all";

      // Generate artefacts if not yet cached
      let artefacts = state.artefacts[proposal.id];
      if (!artefacts) {
        if (onUpdate) {
          onUpdate({
            content: [{ type: "text" as const, text: `📚 Generating artefacts for proposal #${proposal.id}...` }],
            details: {},
          });
        }
        // Need tally for decision brief
        const tally = tallyVotes(proposal.id, proposal.votes, proposal.type);
        const controlResult = state.controlResults[proposal.id];
        const plan = getPlan(proposal.id);

        artefacts = generateAllArtefacts(proposal, tally, controlResult, plan);
        state.artefacts[proposal.id] = artefacts;
        setState(state);

        recordAudit(
          proposal.id,
          "delivery",
          "artefacts_generated",
          "system",
          `Generated 7 artefacts for proposal #${proposal.id}`,
        );

        // GitHub Issue — persist artefacts summary
        ghAddArtefacts(proposal, 7);
      }

      // Return specific artefact or all
      switch (artefact) {
        case "decision-brief":
          return toolResult(formatDecisionBrief(artefacts.decisionBrief));
        case "adr":
          return toolResult(formatADR(artefacts.adr));
        case "risk-report":
          return toolResult(formatRiskReport(artefacts.riskReport));
        case "prd-lite":
          return toolResult(formatPRDLite(artefacts.prdLite));
        case "implementation-plan":
          return toolResult(formatImplementationPlan(artefacts.implementationPlan));
        case "test-plan":
          return toolResult(formatTestPlan(artefacts.testPlan));
        case "release-packet":
          return toolResult(formatReleasePacket(artefacts.releasePacket));
        default:
          return toolResult(
            formatArtefactsSummary(artefacts) + "\n\n---\n\n" + formatAllArtefacts(artefacts)
          );
      }
    },
  });

  // ================================================================
  // TOOL: dao_audit
  // ================================================================

  pi.registerTool({
    name: "dao_audit",
    label: "DAO Audit",
    description:
      "View the full audit trail for a specific proposal or all proposals.",
    parameters: Type.Object({
      proposalId: Type.Optional(Type.Number({ description: "ID of the proposal to audit (omit for all)" })),
    }),
    promptSnippet: "dao_audit — View audit trail for a proposal or all proposals",
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const state = getState();

      if (params.proposalId !== undefined) {
        const proposal = getProposal(params.proposalId);
        if (!proposal) {
          return toolResult(`Proposal #${params.proposalId} not found.`);
        }

        const entries = getProposalAudit(params.proposalId);
        if (entries.length === 0) {
          return toolResult(`No audit entries found for proposal #${params.proposalId}.`);
        }

        return toolResult(formatAuditTrail(entries));
      }

      // All proposals
      const trail = formatAuditTrail(state.auditLog);
      return toolResult(trail);
    },
  });

  // ================================================================
  // COMMAND: /dao
  // ================================================================

  pi.registerCommand("dao", {
    description: "Initialize DAO (if needed) and show the dashboard",
    async handler(_args: string, ctx: ExtensionCommandContext) {
      const state = getState();

      // Auto-initialize if not yet set up
      if (!state.initialized) {
        initializeAgents();
        recordAudit(
          0,
          "governance",
          "auto_initialized",
          "system",
          "DAO auto-initialized via /dao command"
        );
      }

      const updatedState = getState();
      const dashboard = renderDashboard(updatedState);

      if (ctx.hasUI) {
        ctx.ui.notify(
          updatedState.initialized
            ? `DAO active: ${updatedState.agents.length} agents, ${updatedState.proposals.length} proposals`
            : "DAO initialization failed",
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

  // ================================================================
  // COMMAND: /dao-deliberate
  // ================================================================

  pi.registerCommand("dao-deliberate", {
    description: "Deliberate on open proposals. Pass a proposal ID to deliberate only that one.",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const state = getState();
      if (!state.initialized) {
        pi.sendMessage({
          customType: "dao-error",
          content: "DAO not initialized. Run `/dao` first.",
          display: true,
        });
        return;
      }

      // Parse optional proposal ID from args
      const trimmed = args.trim();
      const numericId = parseInt(trimmed, 10);

      // Gather proposals to deliberate
      let targets;
      if (trimmed && !isNaN(numericId)) {
        const p = getProposal(numericId);
        if (!p) {
          pi.sendMessage({
            customType: "dao-error",
            content: `Proposal #${numericId} not found.`,
            display: true,
          });
          return;
        }
        if (p.status !== "open") {
          pi.sendMessage({
            customType: "dao-error",
            content: `Proposal #${p.id} \"${p.title}\" has status **${p.status}**. Only open proposals can be deliberated.`,
            display: true,
          });
          return;
        }
        targets = [p];
      } else {
        targets = listProposals().filter((p) => p.status === "open");
        if (targets.length === 0) {
          pi.sendMessage({
            customType: "dao-info",
            content: "No open proposals to deliberate on. Use `/dao-roundtable` to generate new ones.",
            display: true,
          });
          return;
        }
      }

      const label = targets.length === 1
        ? `Proposal #${targets[0].id}: ${targets[0].title}`
        : `${targets.length} open proposals`;

      pi.sendMessage({
        customType: "dao-deliberate-start",
        content: `# 🗳️ Deliberation Starting\n\n${label} will be deliberated by ${state.agents.length} agents.\n\n${targets.map((p) => `- **#${p.id}** ${p.title} (${p.type})`).join("\\n")}`,
        display: true,
      });

      if (ctx.hasUI) {
        ctx.ui.notify(`🗳️ Deliberating on ${label}...`, "info");
      }

      // Sequential deliberation
      const results: Array<{
        proposal: typeof targets[0];
        tally: any;
        compositeScore: any;
        synthesis: string;
        durationMs: number;
        error?: string;
      }> = [];

      for (const proposal of targets) {
        const startTime = Date.now();
        try {
          // Transition to deliberating
          updateProposalStatus(proposal.id, "deliberating");
          ghUpdateStatus(proposal);
          recordAudit(proposal.id, "governance", "deliberation_started", "user",
            `Deliberation started via /dao-deliberate on proposal #${proposal.id}: ${proposal.title}`);

          // Dispatch swarm
          const agentOutputs = await dispatchSwarm(proposal, state.agents);

          // Parse votes
          const votes = agentOutputs.map((output) => {
            const agent = state.agents.find((a) => a.id === output.agentId);
            const weight = agent?.weight ?? 1;
            if (output.content) {
              const parsed = parseVoteFromOutput(output.agentId, output.agentName, weight, output.content);
              if (parsed.position !== "abstain" || parsed.reasoning !== "No vote section found in agent output") {
                return parsed;
              }
            }
            return { agentId: output.agentId, agentName: output.agentName, position: "abstain" as const, reasoning: output.error ?? "No output produced", weight };
          });

          // Synthesize
          const synthesis = synthesize(agentOutputs, votes);
          storeDeliberationResults(proposal.id, agentOutputs, synthesis, votes);

          // Tally
          const tally = tallyVotes(proposal.id, votes, proposal.type);

          // Composite score
          const axisScores = parseScoresFromOutput(proposal);
          let compositeScore = calculateCompositeScore(axisScores);
          if (proposal.content) {
            compositeScore = applyMalus(compositeScore, proposal.content.permissionsImpact, proposal.content.dataImpact);
          }
          storeCompositeScore(proposal.id, compositeScore);

          // Compute and store RICE score (Proposal #5)
          const riceScore = parseRICEFromOutput(proposal);
          if (riceScore) proposal.riceScore = riceScore;

          // Determine outcome
          const newStatus: "approved" | "rejected" = tally.approved ? "approved" : "rejected";
          updateProposalStatus(proposal.id, newStatus);
          if (newStatus === "approved") {
            proposal.riskZone = classifyRiskZone(proposal);
          }

          ghUpdateStatus(proposal);
          ghAddDeliberation(proposal, agentOutputs, {
            weightedFor: tally.weightedFor, weightedAgainst: tally.weightedAgainst,
            totalVotingWeight: tally.totalVotingWeight, votingAgents: tally.votingAgents,
            totalAgents: tally.totalAgents, quorumMet: tally.quorumMet, approvalScore: tally.approvalScore,
          }, Date.now() - startTime);

          recordAudit(proposal.id, "intelligence", "deliberation_completed", "system",
            `Deliberation completed: ${newStatus} (${tally.weightedFor}/${tally.totalVotingWeight} weighted for, score ${compositeScore.weighted}/100)`);

          results.push({ proposal, tally, compositeScore, synthesis, durationMs: Date.now() - startTime });
        } catch (err: any) {
          updateProposalStatus(proposal.id, "open");
          ghUpdateStatus(proposal);
          results.push({ proposal, tally: null, compositeScore: null, synthesis: "", durationMs: Date.now() - startTime, error: err.message });
        }
      }

      // Format results
      const lines: string[] = ["# 🗳️ Deliberation Results\\n"];
      for (const r of results) {
        if (r.error) {
          lines.push(`## ❌ #${r.proposal.id} ${r.proposal.title}\\n`);
          lines.push(`**Error:** ${r.error}\\n`);
        } else {
          const emoji = r.proposal.status === "approved" ? "✅ Approved" : "❌ Rejected";
          lines.push(`## ${emoji} — #${r.proposal.id} ${r.proposal.title}\\n`);
          lines.push(`| Metric | Value |`);
          lines.push(`|--------|-------|`);
          lines.push(`| Score | ${r.compositeScore?.weighted ?? "?"}/100 |`);
          lines.push(`| Votes | ${r.tally.weightedFor}/${r.tally.totalVotingWeight} weighted for |`);
          lines.push(`| Quorum | ${r.tally.quorumMet ? "✅ Met" : "❌ Not met"} |`);
          lines.push(`| Approval | ${Math.round(r.tally.approvalScore)}% |`);
          lines.push(`| Duration | ${(r.durationMs / 1000).toFixed(1)}s |`);
          const firstLine = r.synthesis.split("\\n")[0];
          if (firstLine) lines.push(`\\n> ${firstLine}\\n`);
        }
      }
      const approved = results.filter((r) => r.proposal.status === "approved").length;
      const rejected = results.filter((r) => r.proposal.status === "rejected").length;
      const failed = results.filter((r) => r.error).length;
      lines.push(`---\\n**Summary:** ${approved} approved, ${rejected} rejected${failed ? `, ${failed} failed` : ""} out of ${results.length} proposals.`);
      if (approved > 0) lines.push(`\\nUse \`/dao-check <id>\` to run control gates on approved proposals.`);

      pi.sendMessage({
        customType: "dao-deliberate-results",
        content: lines.join("\\n"),
        display: true,
      });
    },
  });

  // ================================================================
  // COMMAND: /dao-status
  // ================================================================

  pi.registerCommand("dao-status", {
    description: "View the DAO proposal pipeline dashboard. Filters: --stage, --type, --needs-action, --stale",
    async handler(args: string, _ctx: ExtensionCommandContext) {
      const state = getState();
      if (!state.initialized) {
        pi.sendMessage({
          customType: "dao-error",
          content: "DAO not initialized. Run `/dao` first.",
          display: true,
        });
        return;
      }

      // Check for proposal ID (single proposal view)
      const trimmed = args.trim();
      const numericId = parseInt(trimmed.split("\\s+")[0], 10);

      if (trimmed && !isNaN(numericId) && !trimmed.startsWith("--")) {
        // Single proposal card view
        const proposal = getProposal(numericId);
        if (!proposal) {
          pi.sendMessage({
            customType: "dao-error",
            content: `Proposal #${numericId} not found.`,
            display: true,
          });
          return;
        }
        pi.sendMessage({
          customType: "dao-status",
          content: renderProposalCard(proposal),
          display: true,
        });
        return;
      }

      // Pipeline dashboard view
      const filters = parseFilterArgs(trimmed);
      const content = renderPipelineDashboard(
        state.proposals,
        filters,
        state.config.staleThresholdHours ?? 24,
      );

      pi.sendMessage({
        customType: "dao-status",
        content,
        display: true,
      });
    },
  });

  // ================================================================
  // COMMAND: /dao-roundtable
  // ================================================================

  pi.registerCommand("dao-roundtable", {
    description: "Ask every agent to suggest a proposal idea (round table)",
    async handler(_args: string, ctx: ExtensionCommandContext) {
      const state = getState();
      if (!state.initialized) {
        pi.sendMessage({
          customType: "dao-error",
          content: "DAO not initialized. Run `/dao` first.",
          display: true,
        });
        return;
      }

      if (ctx.hasUI) {
        ctx.ui.notify(`🗣️ Round table starting — ${state.agents.length} agents...`, "info");
      }

      pi.sendMessage({
        customType: "dao-roundtable-start",
        content: `# 🗣️ Round Table Starting...\n\nAsking ${state.agents.length} agents to suggest ideas. This takes ~30-60s.`,
        display: true,
      });

      try {
        const suggestions = await runRoundTable(state.agents);

        // Auto-create proposals from parsed suggestions
        const proposalIds = new Map<string, number>();
        const proposalTitles = new Map<number, string>();
        for (const s of suggestions) {
          if (s.parsed) {
            const proposal = createProposal(
              s.parsed.title,
              s.parsed.type,
              s.parsed.description,
              s.agentId,
              `Suggested by ${s.agentName} during round table`
            );
            const zone = classifyRiskZone(proposal);
            proposal.riskZone = zone;
            proposalIds.set(s.agentId, proposal.id);
            proposalTitles.set(proposal.id, proposal.title);

            recordAudit(
              proposal.id,
              "governance",
              "proposal_created",
              s.agentId,
              `Proposal "${s.parsed.title}" created from round table suggestion by ${s.agentName}`,
            );

            // Persist to GitHub
            ghCreateProposal(proposal);
          }
        }

        const hostCtx = detectHostContext();
        const formatted = formatRoundTable(suggestions, proposalIds, proposalTitles, hostCtx.repoSlug);

        pi.sendMessage({
          customType: "dao-roundtable-results",
          content: formatted,
          display: true,
        });
      } catch (err: any) {
        pi.sendMessage({
          customType: "dao-error",
          content: `Round table failed: ${err.message}`,
          display: true,
        });
      }
    },
  });

  // ================================================================
  // COMMAND: /dao:ship — Full Pipeline (deliberate → check → execute)
  // ================================================================

  pi.registerCommand("dao:ship", {
    description: "Run the full DAO pipeline on a proposal: deliberate → check → execute. Pass a proposal ID or leave empty for first open proposal.",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const state = getState();
      if (!state.initialized) {
        pi.sendMessage({
          customType: "dao-error",
          content: "DAO not initialized. Run `/dao` first.",
          display: true,
        });
        return;
      }

      // Parse proposal ID
      const trimmed = args.trim();
      const numericId = parseInt(trimmed, 10);
      let proposal;

      if (trimmed && !isNaN(numericId)) {
        proposal = getProposal(numericId);
        if (!proposal) {
          pi.sendMessage({ customType: "dao-error", content: `Proposal #${numericId} not found.`, display: true });
          return;
        }
      } else {
        // Pick the first open proposal
        const openProposals = listProposals().filter(p => p.status === "open");
        if (openProposals.length === 0) {
          pi.sendMessage({
            customType: "dao-error",
            content: "No open proposals to ship. Use `/dao-roundtable` to create some.",
            display: true,
          });
          return;
        }
        proposal = openProposals[0];
      }

      if (proposal.status !== "open" && proposal.status !== "controlled") {
        pi.sendMessage({
          customType: "dao-error",
          content: `Proposal #${proposal.id} "${proposal.title}" has status **${proposal.status}**. Only open or controlled proposals can be shipped.`,
          display: true,
        });
        return;
      }

      const hostCtx = detectHostContext();
      const totalSteps = 3; // deliberate → check → execute
      let currentStep = 0;

      const reportProgress = (step: string, detail: string) => {
        currentStep++;
        // Immediate visual feedback via status bar + notification + widget
        ctx.ui.setStatus("dao-ship", step + ": " + detail);
        ctx.ui.notify(step + ": " + detail, "info");
        ctx.ui.setWidget("dao-ship", [
          "\uD83D\uDEA2 Ship Pipeline \u2014 #" + proposal!.id + ": " + proposal!.title,
          "",
          step + " " + detail,
          "\u23F3 Elapsed: calculating...",
        ]);
        pi.sendMessage({
          customType: "dao-ship-progress",
          content: `# 🚢 Ship Pipeline — #${proposal!.id}: ${proposal!.title}\n\n` +
            `**Projet:** ${hostCtx.repoSlug}\n\n` +
            `| Étape | Statut |\n|-------|--------|\n` +
            `${currentStep >= 1 ? `| 🗳️ Deliberate | ${currentStep > 1 ? (proposal!.status === "approved" || proposal!.status === "controlled" || proposal!.status === "executed" ? "✅" : "❌") : "⏳ " + detail} |\n` : ""}` +
            `${currentStep >= 2 ? `| 🛡️ Check | ${currentStep > 2 ? "✅" : "⏳ " + detail} |\n` : ""}` +
            `${currentStep >= 3 ? `| 🚀 Execute | ${currentStep > 3 ? "✅" : "⏳ " + detail} |\n` : ""}`,
          display: true,
        });
      };

      try {
        // Variables to track pipeline results
        let tallyResult: any = null;
        let compositeScoreResult: any = null;
        let controlResultValue: any = null;
        const skipDeliberate = proposal.status !== "open";
        const skipCheck = proposal.status === "controlled";

        // ── STEP 1: DELIBERATE ───────────────────────────────────
        if (!skipDeliberate) {
          reportProgress("Deliberate", "Starting swarm deliberation...");

          updateProposalStatus(proposal.id, "deliberating");
          ghUpdateStatus(proposal);
          recordAudit(proposal.id, "governance", "deliberation_started", "user",
            `Ship pipeline: deliberation started on proposal #${proposal.id}: ${proposal.title}`);

          const agentOutputs = await dispatchSwarm(proposal, state.agents);

          const votes = agentOutputs.map((output) => {
            const agent = state.agents.find((a) => a.id === output.agentId);
            const weight = agent?.weight ?? 1;
            if (output.content) {
              const parsed = parseVoteFromOutput(output.agentId, output.agentName, weight, output.content);
              if (parsed.position !== "abstain" || parsed.reasoning !== "No vote section found in agent output") {
                return parsed;
              }
            }
            return { agentId: output.agentId, agentName: output.agentName, position: "abstain" as const, reasoning: output.error ?? "No output produced", weight };
          });

          const synthesis = synthesize(agentOutputs, votes);
          storeDeliberationResults(proposal.id, agentOutputs, synthesis, votes);

          tallyResult = tallyVotes(proposal.id, votes, proposal.type);
          const axisScores = parseScoresFromOutput(proposal);
          compositeScoreResult = calculateCompositeScore(axisScores);
          if (proposal.content) {
            compositeScoreResult = applyMalus(compositeScoreResult, proposal.content.permissionsImpact, proposal.content.dataImpact);
          }
          storeCompositeScore(proposal.id, compositeScoreResult);

          // Compute and store RICE score (Proposal #5)
          const riceScore = parseRICEFromOutput(proposal);
          if (riceScore) proposal.riceScore = riceScore;

          const deliberationStatus: "approved" | "rejected" = tallyResult.approved ? "approved" : "rejected";
          updateProposalStatus(proposal.id, deliberationStatus);
          if (deliberationStatus === "approved") {
            proposal.riskZone = classifyRiskZone(proposal);
          }

          ghUpdateStatus(proposal);
          ghAddDeliberation(proposal, agentOutputs, {
            weightedFor: tallyResult.weightedFor, weightedAgainst: tallyResult.weightedAgainst,
            totalVotingWeight: tallyResult.totalVotingWeight, votingAgents: tallyResult.votingAgents,
            totalAgents: tallyResult.totalAgents, quorumMet: tallyResult.quorumMet, approvalScore: tallyResult.approvalScore,
          }, Date.now() - Date.now());

          recordAudit(proposal.id, "intelligence", "deliberation_completed", "system",
            `Ship pipeline: ${deliberationStatus} (${tallyResult.weightedFor}/${tallyResult.totalVotingWeight} for, score ${compositeScoreResult.weighted}/100)`);

          if (deliberationStatus === "rejected") {
            pi.sendMessage({
              customType: "dao-ship-result",
              content:
                `# 🚢 Ship Pipeline — Stopped at Deliberation\n\n` +
                `**Proposal #${proposal.id}:** ${proposal.title}\n` +
                `**Projet:** ${hostCtx.repoSlug}\n\n` +
                `| Étape | Statut |\n|-------|--------|\n| 🗳️ Deliberate | ❌ Rejected |\n| 🛡️ Check | ⏭️ Skipped |\n| 🚀 Execute | ⏭️ Skipped |\n\n` +
                `**Votes:** ${tallyResult.weightedFor}/${tallyResult.totalVotingWeight} weighted for (${Math.round(tallyResult.approvalScore)}%)\n` +
                `**Quorum:** ${tallyResult.quorumMet ? "✅ Met" : "❌ Not met"}\n\n` +
                `> The swarm voted against this proposal. Review the votes and refine the proposal.`,
              display: true,
            });
            return;
          }
        }

        // ── STEP 2: CHECK (Control Gates) ───────────────────────
        if (!skipCheck) {
          reportProgress("Check", "Running control gates...");

          controlResultValue = runGates(proposal);
          const checklist = generateChecklist(proposal);
          controlResultValue.checklist = checklist;

          if (controlResultValue.allGatesPassed) {
            assertTransition(proposal.status, "controlled");
            updateProposalStatus(proposal.id, "controlled");
          }

          ghAddControlResult(proposal, controlResultValue);
          recordAudit(proposal.id, "control", controlResultValue.allGatesPassed ? "gates_passed" : "gates_failed", "system",
            `Ship pipeline: ${controlResultValue.blockerCount} blockers, ${controlResultValue.warningCount} warnings`);

          if (!controlResultValue.allGatesPassed) {
            const failedGates = controlResultValue.gates.filter((g: any) => !g.passed && g.severity === "blocker");
            pi.sendMessage({
              customType: "dao-ship-result",
              content:
                `# 🚢 Ship Pipeline — Stopped at Control Gates\n\n` +
                `**Proposal #${proposal.id}:** ${proposal.title}\n` +
                `**Projet:** ${hostCtx.repoSlug}\n\n` +
                `| Étape | Statut |\n|-------|--------|\n| 🗳️ Deliberate | ✅ ${tallyResult ? `Approved (${Math.round(tallyResult.approvalScore)}%)` : "Already approved"} |\n| 🛡️ Check | ❌ ${controlResultValue.blockerCount} blocker(s) |\n| 🚀 Execute | ⏭️ Skipped |\n\n` +
                `### Failed Gates\n` +
                failedGates.map((g: any) => `- ❌ **${g.name}:** ${g.message}`).join("\n") + "\n\n" +
                `> Resolve blockers and re-run \`/dao:ship ${proposal.id}\`.`,
              display: true,
            });
            return;
          }
        }

        // ── STEP 3: EXECUTE ──────────────────────────────────────
        reportProgress("Execute", "Executing proposal...");

        captureSnapshot(proposal.id);
        const executionResult = await executeProposal(proposal, undefined);
        storeExecutionResult(proposal.id, executionResult);

        updateProposalStatus(proposal.id, "executed");
        ghUpdateStatus(proposal);
        ghAddExecution(proposal, executionResult);

        recordAudit(proposal.id, "delivery", "execution_completed", "system",
          `Ship pipeline: execution completed for proposal #${proposal.id}`);

        // ── SUCCESS ──────────────────────────────────────────────
        const deliberationDetail = tallyResult
          ? `${Math.round(tallyResult.approvalScore)}% approval, score ${compositeScoreResult.weighted}/100`
          : "Previously deliberated";
        const checkDetail = controlResultValue
          ? `${controlResultValue.warningCount} warning(s)`
          : "Previously passed";

        // Clear status bar and widget on completion
        ctx.ui.setStatus("dao-ship", undefined);
        ctx.ui.setWidget("dao-ship", undefined);
        ctx.ui.notify("Pipeline complete for #" + proposal.id, "info");

        pi.sendMessage({
          customType: "dao-ship-result",
          content:
            `# 🚢 Ship Pipeline — Complete!\n\n` +
            `**Proposal #${proposal.id}:** ${proposal.title}\n` +
            `**Projet:** ${hostCtx.repoSlug}\n\n` +
            `| Étape | Statut | Détail |\n|-------|--------|--------|\n` +
            `| 🗳️ Deliberate | ✅ Approved | ${deliberationDetail} |\n` +
            `| 🛡️ Check | ✅ All gates passed | ${checkDetail} |\n` +
            `| 🚀 Execute | ✅ Done | Delivery plan generated |\n\n` +
            `### Execution Output\n${executionResult.slice(0, 1000)}${executionResult.length > 1000 ? "\n\n[…truncated]" : ""}\n\n` +
            `---\n\n` +
            `Next steps:\n` +
            `- \`dao_artefacts(${proposal.id})\` — view generated artefacts\n` +
            `- \`dao_rate(${proposal.id})\` — rate the outcome`,
          display: true,
        });

      } catch (err: any) {
        // Something went wrong mid-pipeline
        recordAudit(proposal.id, "delivery", "ship_failed", "system",
          `Ship pipeline failed: ${err.message}`);

        pi.sendMessage({
          customType: "dao-ship-result",
          content:
            `# 🚢 Ship Pipeline — Error\n\n` +
            `**Proposal #${proposal.id}:** ${proposal.title}\n` +
            `**Projet:** ${hostCtx.repoSlug}\n\n` +
            `Pipeline stopped at step ${currentStep}/${totalSteps}.\n\n` +
            `**Error:** ${err.message}\n\n` +
            `> Fix the issue and re-run \`/dao:ship ${proposal.id}\`.`,
          display: true,
        });
      }
    },
  });

  // ================================================================
  // COMMAND: /dao hello — First-Run Onboarding (Proposal #10)
  // ================================================================

  pi.registerCommand("dao hello", {
    description: "Guided first-run onboarding: meet the agents, create your first proposal, see deliberation in action",
    async handler(_args: string, ctx: ExtensionCommandContext) {
      const state = getState();

      // Auto-initialize if needed
      if (!state.initialized) {
        initializeAgents();
        recordAudit(0, "governance", "auto_initialized", "system", "DAO auto-initialized via /dao hello");
      }

      const updatedState = getState();

      // Check if already onboarded
      if ((updatedState as any).onboardingCompleted) {
        pi.sendMessage({
          customType: "dao-hello",
          content: "# 👋 Welcome Back!\n\nYou've already completed onboarding.\n\nHere's a refresher:\n- `/dao` — dashboard\n- `/dao-propose` — create a proposal\n- `/dao-deliberate` — run swarm deliberation\n- `/dao:ship` — full pipeline in one command\n- `/dao-roundtable` — ask agents for ideas\n\nRun `/dao` to see your proposals.",
          display: true,
        });
        return;
      }

      // ── STEP 1: Welcome ────────────────────────────────────
      pi.sendMessage({
        customType: "dao-hello",
        content:
          "# 👋 Welcome to DAO Swarm!\n\n" +
          "The DAO is a **multi-agent governance system** that helps you make better decisions.\n" +
          "10 specialized agents analyze your proposals, debate them, vote, and generate implementation plans.\n\n" +
          "This quick tour will show you how it works in ~2 minutes.\n\n" +
          "---\n\n" +
          "*Press Enter or say \"continue\" to proceed...*",
        display: true,
      });

      // ── STEP 2: Meet the Agents ───────────────────────────
      const agents = updatedState.agents;
      let agentIntro = "# 🏛️ Meet Your Agents\n\n";
      agentIntro += "These are the 10 agents that will analyze your proposals:\n\n";
      agentIntro += "| # | Agent | Role | Weight |\n";
      agentIntro += "|---|-------|------|--------|\n";
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        agentIntro += `| ${i + 1} | **${a.name}** | ${a.role} | ${a.weight} |\n`;
      }
      agentIntro += "\n**Total weight:** " + agents.reduce((s, a) => s + a.weight, 0) + "\n\n";
      agentIntro += "> Higher weight = more influence on the final decision.\n";
      agentIntro += "> Agents vote **for**, **against**, or **abstain** — and explain their reasoning.\n\n";
      agentIntro += "---\n\n*Press Enter to continue...*";

      pi.sendMessage({
        customType: "dao-hello",
        content: agentIntro,
        display: true,
      });

      // ── STEP 3: Quick Questionnaire (only in UI mode) ─────
      let projectName = "my-project";
      let projectGoal = "ship a feature";

      if (ctx.hasUI) {
        try {
          projectName = (await ctx.ui.input("What's your project name?", "my-project")) ?? "my-project";

          const goalChoice = await ctx.ui.select(
            "What's your primary goal?",
            [
              "Ship a feature",
              "Improve code quality",
              "Add governance process",
              "Explore the tool",
            ],
          );
          if (goalChoice) projectGoal = goalChoice;
        } catch {
          // User cancelled — use defaults
        }
      }

      // ── STEP 4: Auto-generate Starter Proposal ──────────────
      const goalTypeMap: Record<string, string> = {
        "Ship a feature": "product-feature",
        "Improve code quality": "technical-change",
        "Add governance process": "governance-change",
        "Explore the tool": "product-feature",
      };
      const proposalType = goalTypeMap[projectGoal] || "product-feature";

      const typeLabel = PROPOSAL_TYPE_LABELS[proposalType as keyof typeof PROPOSAL_TYPE_LABELS] || proposalType;

      const starterDescription = `Auto-generated starter proposal for **${projectName}**.\n\n` +
        `**Problem:** ${projectName} needs a clear direction for its next iteration. Without a structured approach, development risks becoming unfocused.\n\n` +
        `**Solution:** Define the top priority for the next sprint based on the goal: _${projectGoal}_. Break it down into concrete deliverables with measurable outcomes.\n\n` +
        `**Why Now:** Starting with a clear proposal sets the tone for structured governance and ensures every change is deliberate.`;

      const starterTitle = `Starter: Define ${projectGoal} priority for ${projectName}`;

      const proposal = createProposal(
        starterTitle,
        proposalType as any,
        starterDescription,
        "user",
        `Auto-generated by /dao hello onboarding`
      );
      const zone = classifyRiskZone(proposal);
      proposal.riskZone = zone;

      // Mark as onboarding proposal
      (proposal as any).isDemo = true;

      ghCreateProposal(proposal);

      pi.sendMessage({
        customType: "dao-hello",
        content:
          `# ✨ Your First Proposal Has Been Created!\n\n` +
          `**Proposal #${proposal.id}:** ${starterTitle}\n` +
          `**Type:** ${typeLabel}\n` +
          `**Status:** Open\n\n` +
          `This is a *real* proposal — you can deliberate on it, run it through control gates, and execute it.\n\n` +
          `---\n\n*Press Enter to see what happens next...*`,
        display: true,
      });

      // ── STEP 5: Explain the Pipeline ───────────────────────
      pi.sendMessage({
        customType: "dao-hello",
        content:
          "# 🔄 The DAO Pipeline\n\n" +
          "Here's what happens when you ship a proposal:\n\n" +
          "| Step | Command | What Happens |\n" +
          "|------|---------|-------------|\n" +
          "| 🗳️ **Deliberate** | `/dao-deliberate` | 10 agents analyze, debate, and vote |\n" +
          "| 🛡️ **Check** | `/dao-check` | Control gates verify quality & risk |\n" +
          "| 🚀 **Execute** | `/dao-execute` | Delivery plan generated |\n" +
          "\n" +
          "Or do it all at once:\n\n" +
          "| Command | What It Does |\n" +
          "|---------|-------------|\n" +
          "| `/dao:ship` | Full pipeline in one command |\n" +
          "| `/dao-roundtable` | Ask agents to suggest ideas |\n" +
          "| `/dao` | See the dashboard |\n\n" +
          "---\n\n*Press Enter for your next steps...*",
        display: true,
      });

      // ── STEP 6: Next Steps ─────────────────────────────────
      (updatedState as any).onboardingCompleted = true;

      pi.sendMessage({
        customType: "dao-hello",
        content:
          "# 🎯 Your Next Steps\n\n" +
          "You're all set! Here's what to try:\n\n" +
          `1. \`/dao-deliberate ${proposal.id}\` — deliberate on your starter proposal` + "\n" +
          `2. \`/dao:ship ${proposal.id}\` — ship it through the full pipeline` + "\n" +
          "3. `/dao-roundtable` — let agents suggest more proposals\n" +
          "4. `/dao` — see your dashboard anytime\n\n" +
          "**Pro tips:**\n" +
          "- Use `dao_propose` to create custom proposals\n" +
          "- Use `dao_rate` after execution to track outcomes\n" +
          "- Use `dao_dashboard` to see score distributions\n\n" +
          "---\n\n" +
          "Welcome to the swarm! 🐝",
        display: true,
      });

      recordAudit(
        proposal.id,
        "governance",
        "onboarding_completed",
        "user",
        `Onboarding completed via /dao hello. Starter proposal #${proposal.id} created.`,
      );
    },
  });

  // ================================================================
  // COMMAND: /dao quickstart — Guided First Proposal (Proposal #9)
  // ================================================================

  pi.registerCommand("dao quickstart", {
    description: "Run a full DAO pipeline demo: propose → deliberate → check → artefacts (~3-5 min)",
    async handler(_args: string, ctx: ExtensionCommandContext) {
      let state = getState();

      // Auto-initialize if needed
      if (!state.initialized) {
        initializeAgents();
        recordAudit(0, "governance", "auto_initialized", "system", "DAO auto-initialized via /dao quickstart");
      }

      state = getState();
      const hostCtx = detectHostContext();

      // ── WELCOME ────────────────────────────────────────────
      pi.sendMessage({
        customType: "dao-quickstart",
        content:
          "# 🚀 DAO Quickstart — 5-Minute Demo\n\n" +
          "This will run the **full DAO pipeline** on a sample proposal:\n\n" +
          "| Step | What Happens | ~Time |\n" +
          "|------|-------------|-------|\n" +
          "| 1️⃣ Create | Sample proposal \"Add contribution guidelines\" | instant |\n" +
          "| 2️⃣ Deliberate | All 10 agents analyze, debate, and vote | ~3 min |\n" +
          "| 3️⃣ Check | Control gates verify quality & risk | instant |\n" +
          "| 4️⃣ Artefacts | Decision brief, ADR, risk report, PRD, tests | instant |\n\n" +
          `**Project:** ${hostCtx.repoSlug}\n\n` +
          "---\n\n*Say \"go\" or press Enter to start...*",
        display: true,
      });

      // ── STEP 1: Create Sample Proposal ─────────────────────
      const sampleTitle = `Quickstart: Add contribution guidelines for ${hostCtx.repoName}`;
      const sampleDescription =
        `**Problem:** The project ${hostCtx.repoName} (${hostCtx.language}) has no contribution guidelines. New contributors face a steep learning curve — no clear expectations for PR format, commit messages, testing requirements, or review process.\n\n` +
        `**Solution:** Create a CONTRIBUTING.md with:\n- Development setup instructions\n- PR submission checklist\n- Code review expectations\n- Testing requirements\n- Commit message conventions\n\n` +
        `**Why Now:** Every day without contribution guidelines, potential contributors bounce. This is the single highest-leverage documentation investment for an open-source project.`;

      const proposal = createProposal(
        sampleTitle,
        "product-feature",
        sampleDescription,
        "user",
        "Auto-generated by /dao quickstart"
      );
      const zone = classifyRiskZone(proposal);
      proposal.riskZone = zone;
      (proposal as any).isDemo = true;

      ghCreateProposal(proposal);

      pi.sendMessage({
        customType: "dao-quickstart",
        content:
          `# 1️⃣ Step 1: Proposal Created\n\n` +
          `**Proposal #${proposal.id}:** ${sampleTitle}\n` +
          `**Type:** ✨ Product Feature\n` +
          `**Zone:** ${zone === "green" ? "🟢 Green" : zone === "orange" ? "🟠 Orange" : "🔴 Red"}\n\n` +
          "> A **proposal** is an idea submitted to the DAO. It goes through deliberation (agents vote), control gates (quality checks), then execution.\n\n" +
          "---\n\n*Starting deliberation... 🗳️*",
        display: true,
      });

      // ── STEP 2: Deliberate ─────────────────────────────────
      try {
        updateProposalStatus(proposal.id, "deliberating");
        ghUpdateStatus(proposal);
        recordAudit(proposal.id, "governance", "deliberation_started", "user",
          `Quickstart: deliberation started on proposal #${proposal.id}`);

        ctx.ui.setStatus("dao-quickstart", "Step 2/4: Deliberating (10 agents, ~3 min)...");
        ctx.ui.notify("Step 2/4: Deliberating with 10 agents (~3 min)...", "info");

        const agentOutputs = await dispatchSwarm(proposal, state.agents);

        ctx.ui.setStatus("dao-quickstart", "Step 2/4: Deliberation complete");
        const votes = agentOutputs.map((output) => {
          const agent = state.agents.find((a) => a.id === output.agentId);
          const weight = agent?.weight ?? 1;
          if (output.content) {
            const parsed = parseVoteFromOutput(output.agentId, output.agentName, weight, output.content);
            if (parsed.position !== "abstain" || parsed.reasoning !== "No vote section found in agent output") {
              return parsed;
            }
          }
          return { agentId: output.agentId, agentName: output.agentName, position: "abstain" as const, reasoning: output.error ?? "No output produced", weight };
        });

        const synthesis = synthesize(agentOutputs, votes);
        storeDeliberationResults(proposal.id, agentOutputs, synthesis, votes);

        const tally = tallyVotes(proposal.id, votes, proposal.type);
        const axisScores = parseScoresFromOutput(proposal);
        const compositeScore = calculateCompositeScore(axisScores);
        storeCompositeScore(proposal.id, compositeScore);

        // RICE
        const riceScore = parseRICEFromOutput(proposal);
        if (riceScore) proposal.riceScore = riceScore;

        const newStatus: "approved" | "rejected" = tally.approved ? "approved" : "rejected";
        updateProposalStatus(proposal.id, newStatus);
        if (newStatus === "approved") proposal.riskZone = classifyRiskZone(proposal);

        ghUpdateStatus(proposal);
        ghAddDeliberation(proposal, agentOutputs, {
          weightedFor: tally.weightedFor, weightedAgainst: tally.weightedAgainst,
          totalVotingWeight: tally.totalVotingWeight, votingAgents: tally.votingAgents,
          totalAgents: tally.totalAgents, quorumMet: tally.quorumMet, approvalScore: tally.approvalScore,
        }, Date.now() - Date.now());

        const voteEmoji = newStatus === "approved" ? "✅" : "❌";
        pi.sendMessage({
          customType: "dao-quickstart",
          content:
            `# 2️⃣ Step 2: Deliberation Complete ${voteEmoji}\n\n` +
            `**Verdict:** ${newStatus.toUpperCase()}\n` +
            `**Votes:** ${tally.weightedFor}/${tally.totalVotingWeight} weighted for (${Math.round(tally.approvalScore)}%)\n` +
            `**Score:** ${compositeScore.weighted}/100\n\n` +
            `| Agent | Vote | Weight |\n|-------|------|--------|\n` +
            votes.map(v => `| ${v.agentName} | ${v.position === "for" ? "✅" : v.position === "against" ? "❌" : "⏸️"} ${v.position} | ${v.weight} |`).join("\n") + "\n\n" +
            "> **Deliberation** means all 10 agents analyzed the proposal from their unique perspective — strategy, architecture, risk, user impact — then voted with weighted influence.\n\n" +
            "---",
          display: true,
        });

        if (newStatus === "rejected") {
          pi.sendMessage({
            customType: "dao-quickstart",
            content: "# ⚠️ Sample proposal was rejected\n\nThis can happen — the swarm votes honestly. Try again with `/dao quickstart` or create your own proposal with `/dao-propose`.",
            display: true,
          });
          return;
        }

        // ── STEP 3: Control Gates ───────────────────────────
        ctx.ui.setStatus("dao-quickstart", "Step 3/4: Running control gates...");
        const controlResult = runGates(proposal);
        const checklist = generateChecklist(proposal);
        controlResult.checklist = checklist;

        if (controlResult.allGatesPassed) {
          assertTransition(proposal.status, "controlled");
          updateProposalStatus(proposal.id, "controlled");
        }

        ghAddControlResult(proposal, controlResult);

        const gatesIcon = controlResult.allGatesPassed ? "✅" : "❌";
        pi.sendMessage({
          customType: "dao-quickstart",
          content:
            `# 3️⃣ Step 3: Control Gates ${gatesIcon}\n\n` +
            `**Result:** ${controlResult.allGatesPassed ? "All gates passed" : `${controlResult.blockerCount} blocker(s)`}\n\n` +
            `| Gate | Status |\n|------|--------|\n` +
            controlResult.gates.map(g => `| ${g.passed ? "✅" : "❌"} ${g.name} | ${g.severity} |`).join("\n") + "\n\n" +
            "> **Control gates** verify quorum quality, risk levels, vote consensus, and zone compliance before execution is allowed.\n\n" +
            "---",
          display: true,
        });

        // ── STEP 4: Artefacts ───────────────────────────────
        const tallyForResult = tally;
        const plan = parseDeliveryPlan(proposal.id, proposal.agentOutputs.find(o => o.agentId === "delivery")?.content ?? proposal.description);
        storePlan(plan);

        // Generate artefacts
        const artefacts = generateAllArtefacts(proposal, tallyForResult, controlResult, plan);
        state.artefacts[proposal.id] = artefacts;

        ghAddArtefacts(proposal, 7);

        pi.sendMessage({
          customType: "dao-quickstart",
          content:
            `# 4️⃣ Step 4: Artefacts Generated 📚\n\n` +
            `7 documents created for proposal #${proposal.id}:\n\n` +
            `| # | Artefact | Purpose |\n|---|----------|---------|\n` +
            `| 1 | 📋 Decision Brief | Summary of what was decided and why |\n` +
            `| 2 | 🏗️ ADR | Architecture Decision Record |\n` +
            `| 3 | 🔒 Risk Report | Risk assessment with mitigations |\n` +
            `| 4 | 📝 PRD Lite | User stories and acceptance criteria |\n` +
            `| 5 | 🗂️ Implementation Plan | Phases, tasks, and effort estimates |\n` +
            `| 6 | 🧪 Test Plan | Unit, integration, and E2E tests |\n` +
            `| 7 | 📦 Release Packet | Changelog, release notes, rollback plan |\n\n` +
            "> **Artefacts** are auto-generated from the deliberation output. They provide everything needed to implement and ship the proposal.\n",
          display: true,
        });

        // ── COMPLETION ───────────────────────────────────────
        pi.sendMessage({
          customType: "dao-quickstart",
          content:
            "# ✅ Quickstart Complete!\n\n" +
            "You just ran the full DAO pipeline:\n\n" +
            "```\n" +
            "propose → deliberate → check → artefacts\n" +
            "````\n\n" +
            "### What's Next?\n\n" +
            "| Command | What It Does |\n|---------|-------------|\n" +
            "| `/dao-propose` | Create your own proposal |\n" +
            "| `/dao-roundtable` | Let agents suggest ideas |\n" +
            "| `/dao:ship <id>` | Run the full pipeline on any proposal |\n" +
            "| `/dao hello` | Guided onboarding tour |\n" +
            "| `/dao` | View your dashboard |\n\n" +
            "Welcome to the swarm! 🐝",
          display: true,
        });

        recordAudit(proposal.id, "governance", "quickstart_completed", "user",
          `Quickstart completed. Sample proposal #${proposal.id} processed through full pipeline.`);

      } catch (err: any) {
        pi.sendMessage({
          customType: "dao-error",
          content: `# ❌ Quickstart Failed\n\n**Error:** ${err.message}\n\nTry running \`/dao quickstart\` again or use the individual commands: \`/dao-propose\`, \`/dao-deliberate\`, \`/dao-check\`.`,
          display: true,
        });
      }
    },
  });

  // ================================================================
  // TOOL: dao_roundtable
  // ================================================================

  pi.registerTool({
    name: "dao_roundtable",
    label: "DAO Round Table",
    description:
      "Ask every DAO agent to suggest one proposal idea. Suggestions are automatically converted into formal DAO proposals (open status) ready for deliberation.",
    parameters: Type.Object({
      topic: Type.Optional(Type.String({ description: "Optional topic to focus agent suggestions (e.g., 'UX improvements', 'security')" })),
    }),
    promptSnippet: "dao_roundtable — Agents suggest ideas that become proposals automatically",
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const state = getState();
      if (!state.initialized) {
        return toolResult("DAO not initialized. Run `dao_setup` first.");
      }

      const agents = state.agents;

      ctx?.ui?.setWorkingMessage?.("DAO: Round table — collecting ideas from " + agents.length + " agents...");

      if (onUpdate) {
        onUpdate({
          content: [{ type: "text" as const, text: `🗣️ Round table starting — ${agents.length} agents suggesting ideas...` }],
          details: {},
        });
      }

      const suggestions = await runRoundTable(
        agents,
        undefined,
        (completed, total, agentName) => {
          ctx?.ui?.setWorkingMessage?.("DAO: Round table " + completed + "/" + total + " \u2014 " + agentName);
          if (onUpdate) {
            onUpdate({
              content: [{ type: "text" as const, text: `🗣️ ${completed}/${total} — ${agentName} responded` }],
              details: {},
            });
          }
        },
      );

      // Auto-create proposals from parsed suggestions
      const proposalIds = new Map<string, number>();
      const proposalTitles = new Map<number, string>();
      for (const s of suggestions) {
        if (s.parsed) {
          const proposal = createProposal(
            s.parsed.title,
            s.parsed.type,
            s.parsed.description,
            s.agentId,
            `Suggested by ${s.agentName} during round table`
          );
          const zone = classifyRiskZone(proposal);
          proposal.riskZone = zone;
          proposalIds.set(s.agentId, proposal.id);
          proposalTitles.set(proposal.id, proposal.title);

          recordAudit(
            proposal.id,
            "governance",
            "proposal_created",
            s.agentId,
            `Proposal "${s.parsed.title}" created from round table suggestion by ${s.agentName}`,
          );

          // Persist to GitHub
          ghCreateProposal(proposal);
        }
      }

      const hostCtx = detectHostContext();
      const formatted = formatRoundTable(suggestions, proposalIds, proposalTitles, hostCtx.repoSlug);

      recordAudit(
        0,
        "intelligence",
        "roundtable_completed",
        "system",
        `Round table completed: ${suggestions.length} suggestions, ${proposalIds.size} proposals created`,
      );

      ctx?.ui?.setWorkingMessage?.(); // Restore default
      return toolResult(formatted);
    },
  });

  // ================================================================
  // TOOL: dao_verify — Post-execution verification (Proposal #7)
  // ================================================================

  pi.registerTool({
    name: "dao_verify",
    label: "DAO Verify Execution",
    description:
      "Run post-execution verification on a proposal. Checks file changes, compilation, tests, and git status. Use after dao_execute to confirm delivery quality.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the proposal to verify" }),
      expectedFiles: Type.Optional(Type.Array(Type.String(), { description: "Files expected to have been changed" })),
    }),
    promptSnippet: "dao_verify — Verify execution results for a proposal",
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }

      if (proposal.status !== "executed" && proposal.status !== "failed" && proposal.status !== "controlled") {
        return toolResult(
          `Proposal #${proposal.id} has status "${proposal.status}". Only executed, failed, or controlled proposals can be verified.`
        );
      }

      const verification = verifyExecution(
        proposal.id,
        params.expectedFiles ?? [],
        process.cwd(),
      );

      // Store verification result
      const state = getState();
      state.verifications[proposal.id] = verification;

      recordAudit(
        proposal.id,
        "delivery",
        "execution_verified",
        "system",
        `Manual verification: ${verification.status} (${verification.testsPassed ?? 0}/${(verification.testsPassed ?? 0) + (verification.testsFailed ?? 0)} tests, ${verification.filesChanged.length} files)`
      );

      return toolResult(formatVerification(verification));
    },
  });

  // ================================================================
  // TOOL: dao_close
  // ================================================================

  pi.registerTool({
    name: "dao_close",
    label: "DAO Close Proposal",
    description:
      "Close a GitHub issue after implementing a proposal. Posts an implementation summary with commits, files changed, and test results, then closes the issue as completed. Only use after the actual code has been pushed.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the proposal to close" }),
      commits: Type.Array(Type.String(), { description: "List of commit SHAs that implemented the proposal" }),
      filesChanged: Type.Array(Type.String(), { description: "List of files created or modified" }),
      testsPassed: Type.Number({ description: "Number of tests passing" }),
      branch: Type.Optional(Type.String({ description: "Feature branch name" })),
    }),
    promptSnippet: "dao_close — Close proposal issue after implementation",
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const state = getState();
      if (!state.initialized) {
        return toolResult("DAO not initialized. Run `dao_setup` first.");
      }

      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }

      if (proposal.status !== "executed") {
        return toolResult(
          `Proposal #${proposal.id} has status "${proposal.status}". Only executed proposals can be closed after implementation. Run the full pipeline (deliberate → check → execute) first.`
        );
      }

      // Close the GitHub issue with implementation summary
      ghCloseImplemented(proposal, {
        commits: params.commits,
        filesChanged: params.filesChanged,
        testsPassed: params.testsPassed,
        branch: params.branch,
      });

      recordAudit(
        proposal.id,
        "delivery",
        "issue_closed",
        "user",
        `GitHub issue closed after implementation: ${params.commits.length} commits, ${params.filesChanged.length} files, ${params.testsPassed} tests passing`,
      );

      const issueNumber = getIssueNumber(proposal.id);
      const issueNote = issueNumber ? ` (GitHub Issue #${issueNumber})` : "";

      return toolResult(
        `# ✅ Proposal #${proposal.id} Closed${issueNote}\n\n` +
        `**Title:** ${proposal.title}\n\n` +
        `### Implementation Summary\n\n` +
        `| Detail | Value |\n` +
        `|--------|-------|\n` +
        `| Commits | ${params.commits.length} |\n` +
        `| Files changed | ${params.filesChanged.length} |\n` +
`| Tests passing | ${params.testsPassed} |\n` +
        `| Branch | ${params.branch ?? "main"} |\n\n` +
        `**Commits:**\n${params.commits.map(c => `- \`${c}\``).join("\n")}\n\n` +
        `GitHub issue closed as completed.`
      );
    },
  });

  // ================================================================
  // TOOL: dao_rate (Proposal #6 — Outcome Tracking)
  // ================================================================

  pi.registerTool({
    name: "dao_rate",
    label: "DAO Rate Proposal",
    description:
      "Rate a proposal's outcome post-execution (1-5 stars). Tracks whether proposals deliver their intended value.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the executed proposal to rate" }),
      score: Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3), Type.Literal(4), Type.Literal(5)], {
        description: "Rating: 1=failure, 2=below expectations, 3=met expectations, 4=exceeded, 5=far exceeded",
      }),
      comment: Type.String({ description: "Why this rating? What was the actual outcome?" }),
      metricName: Type.Optional(Type.String({ description: "Optional: metric name to track (e.g., 'deliberation_latency')" })),
      metricBefore: Type.Optional(Type.String({ description: "Optional: metric value before" })),
      metricAfter: Type.Optional(Type.String({ description: "Optional: metric value after" })),
    }),
    promptSnippet: "dao_rate — Rate a proposal outcome post-execution",
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }

      if (proposal.status !== "executed" && proposal.status !== "failed") {
        return toolResult(
          `Proposal #${proposal.id} has status "${proposal.status}". Only executed or failed proposals can be rated.`
        );
      }

      const outcome = addRating(params.proposalId, "user", params.score, params.comment);

      // Add optional metric
      if (params.metricName && params.metricBefore && params.metricAfter) {
        addMetric(params.proposalId, params.metricName, params.metricBefore, params.metricAfter);
      }

      const stars = "★".repeat(params.score) + "☆".repeat(5 - params.score);

      return toolResult(
        `# 📊 Outcome Rated — #${params.proposalId}: ${proposal.title}\n\n` +
        `**Rating:** ${stars} (${params.score}/5)\n\n` +
        `**Comment:** ${params.comment}\n\n` +
        `**Overall Score:** ${outcome.overallScore.toFixed(1)}/5 (${outcome.ratings.length} rating${outcome.ratings.length > 1 ? "s" : ""})\n\n` +
        `---\n\nRun \`dao_dashboard\` to see all tracked outcomes.`
      );
    },
  });

  // ================================================================
  // TOOL: dao_dashboard (Proposal #6 — Outcome Dashboard)
  // ================================================================

  pi.registerTool({
    name: "dao_dashboard",
    label: "DAO Outcome Dashboard",
    description:
      "View the outcome tracking dashboard showing proposal success rates, score distributions, and metrics across all tracked proposals.",
    parameters: Type.Object({}),
    promptSnippet: "dao_dashboard — View outcome tracking dashboard",
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const dashboard = generateDashboard();
      return toolResult(dashboard);
    },
  });

  // ================================================================
  // TOOL: dao_dry_run (Proposal #8 — Dry-Run)
  // ================================================================

  pi.registerTool({
    name: "dao_dry_run",
    label: "DAO Dry-Run",
    description:
      "Preview what an execution would do without applying changes. Shows affected files, risks, and estimated duration. Takes a snapshot for potential rollback.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the proposal to dry-run" }),
    }),
    promptSnippet: "dao_dry_run — Preview execution without applying changes",
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }

      if (proposal.status !== "approved" && proposal.status !== "controlled") {
        return toolResult(
          `Proposal #${proposal.id} is not approved/controlled (status: ${proposal.status}). Only approved proposals can be dry-run.`
        );
      }

      // Capture snapshot before anything happens
      if (onUpdate) {
        onUpdate({
          content: [{ type: "text" as const, text: `🧪 Running dry-run on proposal #${params.proposalId}: ${proposal.title}...` }],
          details: {},
        });
      }

      ctx?.ui?.setWorkingMessage?.("DAO: Running dry-run snapshot...");

      const snapshot = captureSnapshot(params.proposalId);

      // Use execution result if available, otherwise use proposal description
      const plan = proposal.executionResult || proposal.description;
      const result = performDryRun(params.proposalId, plan);

      recordAudit(
        params.proposalId,
        "delivery",
        "dry_run",
        "user",
        `Dry-run performed for proposal #${params.proposalId}`,
      );

      const canProceedIcon = result.canProceed ? "✅" : "⚠️";

      return toolResult(
        `# 🧪 Dry-Run Preview — #${params.proposalId}: ${proposal.title}\n\n` +
        `${canProceedIcon} **Can Proceed:** ${result.canProceed}\n\n` +
        `**Snapshot:** ${snapshot.commitSha} on \`${snapshot.branch}\`\n\n` +
        `${result.preview}\n\n` +
        `---\n\n` +
        `Run \`dao_execute\` with proposalId ${params.proposalId} to execute, or \`dao_rollback\` to revert.`
      );
    },
  });

  // ================================================================
  // TOOL: dao_rollback (Proposal #8 — Rollback)
  // ================================================================

  pi.registerTool({
    name: "dao_rollback",
    label: "DAO Rollback",
    description:
      "Rollback a proposal execution by reverting files to the pre-execution snapshot. Only works if a dry-run or execution snapshot exists.",
    parameters: Type.Object({
      proposalId: Type.Number({ description: "ID of the proposal to rollback" }),
    }),
    promptSnippet: "dao_rollback — Revert proposal execution to pre-execution snapshot",
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const proposal = getProposal(params.proposalId);
      if (!proposal) {
        return toolResult(`Proposal #${params.proposalId} not found.`);
      }

      if (onUpdate) {
        onUpdate({
          content: [{ type: "text" as const, text: `⏪ Rolling back proposal #${params.proposalId}: ${proposal.title}...` }],
          details: {},
        });
      }

      const result = performRollback(params.proposalId);

      recordAudit(
        params.proposalId,
        "delivery",
        result.success ? "rollback_succeeded" : "rollback_failed",
        "user",
        `Rollback ${result.success ? "succeeded" : "failed"} for proposal #${params.proposalId}: ${result.message}`,
      );

      if (result.success) {
        // Update proposal status back to controlled
        updateProposalStatus(params.proposalId, "controlled");
      }

      const icon = result.success ? "✅" : "❌";

      return toolResult(
        `# ${icon} Rollback — #${params.proposalId}: ${proposal.title}\n\n` +
        `${result.message}`
      );
    },
  });
}
