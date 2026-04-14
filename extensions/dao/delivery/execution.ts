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

  if (proposal.status !== "approved") {
    throw new Error(
      `Proposal #${proposal.id} is not approved (status: ${proposal.status}). Only approved proposals can be executed.`
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

    /** Process-level timeout (180s — execution takes longer than deliberation). */
    const EXECUTION_TIMEOUT_MS = 180_000;
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

/**
 * Build the execution prompt with full deliberation context.
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
    prompt += `## Deliberation Synthesis\n${proposal.synthesis}\n\n`;
  }

  // Include vote summary
  if (proposal.votes.length > 0) {
    prompt += `## Vote Results\n`;
    for (const v of proposal.votes) {
      prompt += `- **${v.agentName}** voted **${v.position}**: ${v.reasoning}\n`;
    }
    prompt += `\n`;
  }

  prompt += `## Your Task\n`;
  prompt += `This proposal has been APPROVED by the DAO. `;
  prompt += `Transform it into a concrete, actionable execution plan. `;
  prompt += `Consider the synthesis above, address any concerns raised by other agents, `;
  prompt += `and produce a detailed implementation roadmap.`;

  return prompt;
};
