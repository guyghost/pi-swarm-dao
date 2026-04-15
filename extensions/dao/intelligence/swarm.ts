import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DAOAgent, Proposal, AgentOutput } from "../types.js";
import { PROPOSAL_TYPE_LABELS } from "../types.js";
import { getState } from "../persistence.js";
import { extractAssistantMessage } from "../pi-json.js";
import { detectHostContext, buildAgentHostContext } from "../host-context.js";

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
  const typeLabel = PROPOSAL_TYPE_LABELS[proposal.type];
  const hostCtx = detectHostContext();
  let prompt = `# Proposal #${proposal.id}: ${proposal.title}\n\n`;
  prompt += `**Type:** ${typeLabel}\n\n`;
  prompt += `**Host Project:** ${hostCtx.repoSlug} (${hostCtx.language}${hostCtx.framework ? `, ${hostCtx.framework}` : ""})\n`;
  prompt += `**Branch:** ${hostCtx.branch}\n\n`;
  prompt += `> Adapt your analysis to this proposal type (${proposal.type}). Focus on aspects most relevant to this domain.\n`;
  prompt += `> You are analyzing a proposal for the project \`${hostCtx.repoSlug}\`, not for the DAO tool itself.\n\n`;
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
      "--no-tools",
      "--append-system-prompt", promptFile,
      `Task: ${taskPrompt}`,
    ];

    return await new Promise<AgentOutput>((resolve) => {
      // spawn inherits process.env by default — no need to copy it
      const proc = spawn("pi", args, {
        cwd: process.cwd(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Accumulate stdout/stderr as Buffers to avoid GC pressure from repeated
      // string concatenation with 4 concurrent processes
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout.on("data", (data: Buffer) => {
        stdoutChunks.push(data);
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderrChunks.push(data);
      });

      // Parse timeout from agent stopConditions (e.g. "60s" → 60000ms)
      const parseTimeoutMs = (): number => {
        const timeoutCondition = agent.stopConditions?.find(
          (c) => c.type === "timeout"
        );
        if (!timeoutCondition?.value) return 120_000;
        const match = timeoutCondition.value.match(/^(\d+)s$/);
        return match ? parseInt(match[1], 10) * 1000 : 120_000;
      };
      const timeoutMs = parseTimeoutMs();
      let timedOut = false;

      // Guard to prevent timeout and abort from racing to double-kill
      let killing = false;
      let killTimerId: ReturnType<typeof setTimeout> | undefined;

      const timeoutId = setTimeout(() => {
        if (killing) return;
        killing = true;
        timedOut = true;
        proc.kill("SIGTERM");
        // Schedule SIGKILL escalation and track the timer so we can
        // cancel it if the process exits before the deadline
        killTimerId = setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5000);
      }, timeoutMs);

      // Handle abort
      const onAbort = () => {
        if (killing) return;
        killing = true;
        clearTimeout(timeoutId);
        proc.kill("SIGTERM");
        killTimerId = setTimeout(() => {
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
        clearTimeout(timeoutId);
        if (killTimerId) clearTimeout(killTimerId);
        signal?.removeEventListener("abort", onAbort);

        // Convert accumulated buffers to strings and release references immediately
        const stdout = Buffer.concat(stdoutChunks).toString();
        const stderr = Buffer.concat(stderrChunks).toString();
        stdoutChunks.length = 0;
        stderrChunks.length = 0;

        // Parse the JSON events from stdout to extract the assistant's message
        const content = extractAssistantMessage(stdout);

        if (timedOut) {
          resolve({
            agentId: agent.id,
            agentName: agent.name,
            role: agent.role,
            content: content || "",
            durationMs: Date.now() - startTime,
            error: `Agent timed out after ${timeoutMs / 1000}s`,
          });
          return;
        }

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
        clearTimeout(timeoutId);
        if (killTimerId) clearTimeout(killTimerId);
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
  const totalAgents = agents.length;
  const outputs = await mapWithConcurrency(
    agents,
    maxConcurrent,
    async (agent) => {
      const output = await runAgent(agent, proposal, signal);
      completed++;
      onProgress?.(completed, totalAgents, agent.name);
      return output;
    }
  );

  // Retry timed-out agents once with 1.5x timeout
  const timedOutIndices: number[] = [];
  for (let i = 0; i < outputs.length; i++) {
    if (outputs[i].error?.includes("timed out")) {
      timedOutIndices.push(i);
    }
  }

  if (timedOutIndices.length > 0 && !signal?.aborted) {
    const retryAgents = timedOutIndices.map((i) => {
      const original = agents[i];
      // Increase timeout by 1.5x for retry
      const retryStopConditions = (original.stopConditions ?? []).map((c) => {
        if (c.type === "timeout" && c.value) {
          const match = c.value.match(/^(\d+)s$/);
          if (match) {
            const newTimeout = Math.round(parseInt(match[1], 10) * 1.5);
            return { ...c, value: `${newTimeout}s` };
          }
        }
        return c;
      });
      return { ...original, stopConditions: retryStopConditions };
    });

    const retryOutputs = await mapWithConcurrency(
      retryAgents,
      maxConcurrent,
      async (agent) => {
        const output = await runAgent(agent, proposal, signal);
        completed++;
        onProgress?.(completed, totalAgents + timedOutIndices.length, `${agent.name} (retry)`);
        return output;
      }
    );

    // Replace timed-out outputs with retry results
    for (let j = 0; j < timedOutIndices.length; j++) {
      outputs[timedOutIndices[j]] = retryOutputs[j];
    }
  }

  return outputs;
};
