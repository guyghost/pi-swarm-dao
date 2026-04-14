import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Proposal, DAOAgent } from "../types.js";
import { PROPOSAL_TYPE_LABELS } from "../types.js";
import { getState } from "../persistence.js";
import { getAgent } from "../intelligence/agents.js";
import { extractAssistantMessage } from "../pi-json.js";

/**
 * Execute an approved proposal by delegating to the Delivery Agent
 * (or a specified executor agent).
 *
 * The executor receives the full proposal + deliberation synthesis
 * and produces a concrete execution plan.
 */
export async function executeProposal(
  proposal: Proposal,
  executorId?: string,
  signal?: AbortSignal
): Promise<string> {
  // Find the executor agent (default: "delivery")
  const agentId = executorId ?? "delivery";
  const agent = getAgent(agentId);

  if (!agent) {
    throw new Error(
      `Executor agent "${agentId}" not found. Available agents: ${getState()
        .agents.map((a) => a.id)
        .join(", ")}`
    );
  }

  if (proposal.status !== "approved" && proposal.status !== "controlled") {
    throw new Error(
      `Proposal #${proposal.id} is not approved (status: ${proposal.status}). Only approved or controlled proposals can be executed.`
    );
  }

  // Build the execution prompt with full context
  const executionPrompt = buildExecutionPrompt(proposal, agent);
  const model = agent.model ?? getState().config.defaultModel;

  // Create temp directory for system prompt
  const tmpDir = mkdtempSync(join(tmpdir(), "dao-exec-"));
  const promptFile = join(tmpDir, "system-prompt.md");

  try {
    writeFileSync(promptFile, agent.systemPrompt, "utf-8");

    const args = [
      "--mode", "json",
      "-p",
      "--no-session",
      "--model", model,
      "--no-tools",
      "--append-system-prompt", promptFile,
      `Task: ${executionPrompt}`,
    ];

    /** Process-level timeout (300s — execution takes longer than deliberation). */
    const EXECUTION_TIMEOUT_MS = 300_000;
    /** Grace period after SIGTERM before force-killing with SIGKILL. */
    const SIGKILL_GRACE_MS = 5_000;

    return await new Promise<string>((resolve, reject) => {
      const proc = spawn("pi", args, {
        cwd: process.cwd(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        // env omitted — spawn inherits process.env by default
      });

      // MAJOR-1: Buffer array avoids GC churn from repeated string concatenation
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout.on("data", (data: Buffer) => {
        stdoutChunks.push(data);
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderrChunks.push(data);
      });

      // Track SIGKILL escalation timer so it can be cleared on close/error
      let killTimerId: ReturnType<typeof setTimeout> | undefined;
      // Track process-level timeout so it can be cleared on close/error
      let timeoutTimerId: ReturnType<typeof setTimeout> | undefined;
      // Flag to distinguish timeout from normal exit
      let timedOut = false;

      /** Send SIGTERM, then escalate to SIGKILL after grace period. */
      const escalateKill = () => {
        proc.kill("SIGTERM");
        killTimerId = setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, SIGKILL_GRACE_MS);
      };

      // Handle external abort (AbortSignal)
      const onAbort = () => {
        escalateKill();
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      // Process-level timeout: kill if execution exceeds limit
      timeoutTimerId = setTimeout(() => {
        timedOut = true;
        escalateKill();
      }, EXECUTION_TIMEOUT_MS);

      proc.on("close", (code) => {
        // CRITICAL-1: Clear orphaned timers to prevent memory leaks
        if (killTimerId) clearTimeout(killTimerId);
        if (timeoutTimerId) clearTimeout(timeoutTimerId);
        signal?.removeEventListener("abort", onAbort);

        // Convert buffered chunks to strings
        const stdout = Buffer.concat(stdoutChunks).toString();
        const stderr = Buffer.concat(stderrChunks).toString();
        stdoutChunks.length = 0;
        stderrChunks.length = 0;

        if (timedOut) {
          reject(
            new Error(
              `Execution agent timed out after ${EXECUTION_TIMEOUT_MS / 1000}s`
            )
          );
          return;
        }

        const content = extractAssistantMessage(stdout);

        if (code !== 0 && !content) {
          reject(
            new Error(
              `Execution agent exited with code ${code}: ${stderr.slice(0, 500)}`
            )
          );
          return;
        }

        resolve(content || "(no execution output)");
      });

      proc.on("error", (err) => {
        if (killTimerId) clearTimeout(killTimerId);
        if (timeoutTimerId) clearTimeout(timeoutTimerId);
        signal?.removeEventListener("abort", onAbort);
        reject(new Error(`Failed to spawn execution agent: ${err.message}`));
      });
    });
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/** Max chars for synthesis in execution prompt (prevents oversized prompts). */
const MAX_SYNTHESIS_CHARS = 1_500;
/** Max chars per vote reasoning in execution prompt. */
const MAX_VOTE_REASONING_CHARS = 200;

/**
 * Build the execution prompt with deliberation context.
 *
 * Prompt is kept concise to avoid LLM inference timeouts.
 * Deliberation synthesis and vote reasoning are truncated —
 * the execution agent needs the gist, not the full transcript.
 */
const buildExecutionPrompt = (proposal: Proposal, agent: DAOAgent): string => {
  const typeLabel = PROPOSAL_TYPE_LABELS[proposal.type];
  let prompt = `# Execute Approved Proposal #${proposal.id}: ${proposal.title}\n\n`;
  prompt += `**Type:** ${typeLabel}\n\n`;
  prompt += `> Adapt your execution plan to this proposal type (${proposal.type}).\n\n`;
  prompt += `## Proposal Description\n${proposal.description}\n\n`;

  if (proposal.context) {
    prompt += `## Additional Context\n${proposal.context}\n\n`;
  }

  if (proposal.synthesis) {
    const truncated = proposal.synthesis.length > MAX_SYNTHESIS_CHARS
      ? proposal.synthesis.slice(0, MAX_SYNTHESIS_CHARS) + "\n\n[…synthesis truncated for execution]"
      : proposal.synthesis;
    prompt += `## Deliberation Synthesis (summary)\n${truncated}\n\n`;
  }

  // Include concise vote summary
  if (proposal.votes.length > 0) {
    prompt += `## Vote Summary\n`;
    for (const v of proposal.votes) {
      const reasoning = v.reasoning.length > MAX_VOTE_REASONING_CHARS
        ? v.reasoning.slice(0, MAX_VOTE_REASONING_CHARS) + "…"
        : v.reasoning;
      prompt += `- **${v.agentName}** (${v.weight}) **${v.position}**: ${reasoning}\n`;
    }
    prompt += `\n`;
  }

  prompt += `## Your Task\n`;
  prompt += `This proposal has been APPROVED by the DAO. `;
  prompt += `Produce a concise, actionable execution plan with phased tasks. `;
  prompt += `Focus on implementation steps, branch strategy, and rollback plan. `;
  prompt += `Be brief — avoid restating the proposal.`;

  return prompt;
};
