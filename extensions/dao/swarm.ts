import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DAOAgent, Proposal, AgentOutput } from "./types.js";
import { getState } from "./persistence.js";
import { extractAssistantMessage } from "./pi-json.js";

/**
 * Run a concurrency-limited map over an array.
 */
const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
};

/**
 * Format a proposal into a prompt for an agent.
 */
const formatProposalPrompt = (proposal: Proposal): string => {
  let prompt = `# Proposal #${proposal.id}: ${proposal.title}\n\n`;
  prompt += `## Description\n${proposal.description}\n`;
  if (proposal.context) {
    prompt += `\n## Additional Context\n${proposal.context}\n`;
  }
  prompt += `\n## Instructions\nAnalyze this proposal from your specialized perspective. Follow your output format exactly. You MUST end your response with a ## Vote section containing your Position (for/against/abstain) and Reasoning.`;
  return prompt;
};

/**
 * Extract the assistant's text message from Pi's JSON event stream.
 * Pi in --mode json emits newline-delimited JSON events.
 * We look for message_end events with the assistant's content,
 * accumulating text deltas from message_update events as a fallback.
 */
/**
 * Run a single agent as a sub-process.
 * Returns the agent's full text output.
 */
const runAgent = async (
  agent: DAOAgent,
  proposal: Proposal,
  signal?: AbortSignal
): Promise<AgentOutput> => {
  const startTime = Date.now();

  // Create temp directory for system prompt file
  const tmpDir = mkdtempSync(join(tmpdir(), "dao-"));
  const promptFile = join(tmpDir, "system-prompt.md");

  try {
    // Write system prompt to temp file
    writeFileSync(promptFile, agent.systemPrompt, "utf-8");

    const taskPrompt = formatProposalPrompt(proposal);
    const model = agent.model ?? getState().config.defaultModel;

    // Build args — use "pi" command directly (jiti resolves it)
    const args = [
      "--mode", "json",
      "-p",
      "--no-session",
      "--model", model,
      "--tools", "none",
      "--append-system-prompt", promptFile,
      `Task: ${taskPrompt}`,
    ];

    return await new Promise<AgentOutput>((resolve) => {
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

        // Parse the JSON events from stdout to extract the assistant's message
        const content = extractAssistantMessage(stdout);

        if (code !== 0 && !content) {
          resolve({
            agentId: agent.id,
            agentName: agent.name,
            role: agent.role,
            content: "",
            durationMs: Date.now() - startTime,
            error: `Agent process exited with code ${code}: ${stderr.slice(0, 500)}`,
          });
          return;
        }

        resolve({
          agentId: agent.id,
          agentName: agent.name,
          role: agent.role,
          content: content || "(no output)",
          durationMs: Date.now() - startTime,
        });
      });

      proc.on("error", (err) => {
        signal?.removeEventListener("abort", onAbort);
        resolve({
          agentId: agent.id,
          agentName: agent.name,
          role: agent.role,
          content: "",
          durationMs: Date.now() - startTime,
          error: `Failed to spawn agent: ${err.message}`,
        });
      });
    });
  } finally {
    // Clean up temp files
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
};

/**
 * Dispatch all agents in parallel to deliberate on a proposal.
 * Max concurrency is controlled by config.maxConcurrent.
 *
 * @param proposal - The proposal to deliberate on
 * @param agents - The agents to dispatch
 * @param signal - Optional AbortSignal for cancellation
 * @param onProgress - Optional callback for progress updates
 * @returns Array of agent outputs
 */
export const dispatchSwarm = async (
  proposal: Proposal,
  agents: DAOAgent[],
  signal?: AbortSignal,
  onProgress?: (completed: number, total: number, agentName: string) => void
): Promise<AgentOutput[]> => {
  const maxConcurrent = getState().config.maxConcurrent;

  let completed = 0;
  const outputs = await mapWithConcurrency(
    agents,
    maxConcurrent,
    async (agent) => {
      const output = await runAgent(agent, proposal, signal);
      completed++;
      onProgress?.(completed, agents.length, agent.name);
      return output;
    }
  );

  return outputs;
};
