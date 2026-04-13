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

    return await new Promise<string>((resolve, reject) => {
      const proc = spawn("pi", args, {
        cwd: process.cwd(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle abort
      const onAbort = () => {
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5000);
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      proc.on("close", (code) => {
        signal?.removeEventListener("abort", onAbort);
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
