// ============================================================
// pi-swarm-dao — Round Table: Each agent proposes an idea
// ============================================================
// During a round table, every agent suggests a proposal idea
// from their unique perspective. The human then picks which
// ideas to formally propose and deliberate on.
// ============================================================

import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DAOAgent } from "../types.js";
import { getState } from "../persistence.js";
import { extractAssistantMessage } from "../pi-json.js";

/** Max chars for a round table suggestion (prevents oversized output). */
const MAX_SUGGESTION_CHARS = 1_500;

/** Result of a single agent's round table suggestion. */
export interface RoundTableSuggestion {
  agentId: string;
  agentName: string;
  role: string;
  weight: number;
  suggestion: string;
  error?: string;
  durationMs: number;
}

/** Build the round table prompt for an agent. */
const buildRoundTablePrompt = (agent: DAOAgent): string => {
  return `# Round Table — What Should We Work On Next?

You are in a round table with ${agent.role ? `your role being "${agent.role}"` : "other specialized agents"}.
Each agent is asked to suggest ONE concrete proposal idea.

## Context
The pi-swarm-dao project is a multi-agent DAO governance extension for the Pi coding agent.
It currently has ${getState().agents.length} agents, ${getState().proposals.length} proposals, and uses GitHub Issues for persistence.

Recent activity:
${getState().proposals.slice(-3).map(p => `- #${p.id}: ${p.title} (${p.status})`).join("\n") || "- No proposals yet"}

## Your Task
Suggest ONE proposal idea that would create the most value from YOUR perspective.
Be specific: include a title, a brief description of the problem and solution, and why it matters now.

## Output Format (STRICT — follow exactly)

### Title
[One-line title for the proposal]

### Type
[product-feature | security-change | technical-change | release-change | governance-change]

### Problem
[1-2 sentences describing the specific problem]

### Solution
[1-2 sentences describing the proposed approach]

### Why Now
[1 sentence on urgency or strategic value]

## Constraints
- ONE idea only — your best one
- Be specific, not vague
- Think from YOUR perspective — what does your domain need most?
- Max 150 words`;
};

/** Run a single agent for round table suggestions. */
const runRoundTableAgent = async (
  agent: DAOAgent,
  signal?: AbortSignal
): Promise<RoundTableSuggestion> => {
  const startTime = Date.now();
  const tmpDir = mkdtempSync(join(tmpdir(), "dao-rt-"));
  const promptFile = join(tmpDir, "round-table-prompt.md");

  try {
    // Use a lightweight system prompt — just identity, not full deliberation prompt
    const lightPrompt = `# ${agent.name}\nRole: ${agent.role}\nMission: ${agent.mission ?? agent.description}\n\nYou are participating in a round table to propose ideas. Be concise and specific.`;
    writeFileSync(promptFile, lightPrompt, "utf-8");

    const taskPrompt = buildRoundTablePrompt(agent);
    const model = agent.model ?? getState().config.defaultModel;

    const args = [
      "--mode", "json",
      "-p",
      "--no-session",
      "--model", model,
      "--no-tools",
      "--append-system-prompt", promptFile,
      `Task: ${taskPrompt}`,
    ];

    return await new Promise<RoundTableSuggestion>((resolve) => {
      const proc = spawn("pi", args, {
        cwd: process.cwd(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout.on("data", (data: Buffer) => stdoutChunks.push(data));
      proc.stderr.on("data", (data: Buffer) => stderrChunks.push(data));

      const timeoutMs = 90_000; // 90s — shorter than deliberation
      let timedOut = false;
      let killing = false;
      let killTimerId: ReturnType<typeof setTimeout> | undefined;

      const timeoutId = setTimeout(() => {
        if (killing) return;
        killing = true;
        timedOut = true;
        proc.kill("SIGTERM");
        killTimerId = setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
      }, timeoutMs);

      const onAbort = () => {
        if (killing) return;
        killing = true;
        clearTimeout(timeoutId);
        proc.kill("SIGTERM");
        killTimerId = setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
      };

      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      proc.on("close", () => {
        clearTimeout(timeoutId);
        if (killTimerId) clearTimeout(killTimerId);
        signal?.removeEventListener("abort", onAbort);

        const stdout = Buffer.concat(stdoutChunks).toString();
        const content = extractAssistantMessage(stdout);

        if (timedOut) {
          resolve({
            agentId: agent.id,
            agentName: agent.name,
            role: agent.role,
            weight: agent.weight,
            suggestion: content ? content.slice(0, MAX_SUGGESTION_CHARS) : "",
            error: "Timed out",
            durationMs: Date.now() - startTime,
          });
          return;
        }

        resolve({
          agentId: agent.id,
          agentName: agent.name,
          role: agent.role,
          weight: agent.weight,
          suggestion: content ? content.slice(0, MAX_SUGGESTION_CHARS) : "(no suggestion)",
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
          weight: agent.weight,
          suggestion: "",
          error: err.message,
          durationMs: Date.now() - startTime,
        });
      });
    });
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
};

/**
 * Run a round table — every agent suggests one proposal idea.
 * Returns all suggestions for the human to review.
 */
export const runRoundTable = async (
  agents: DAOAgent[],
  signal?: AbortSignal,
  onProgress?: (completed: number, total: number, agentName: string) => void
): Promise<RoundTableSuggestion[]> => {
  const maxConcurrent = Math.min(getState().config.maxConcurrent, agents.length);
  let completed = 0;
  const total = agents.length;

  const results: RoundTableSuggestion[] = new Array(agents.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < agents.length) {
      const index = nextIndex++;
      const agent = agents[index];
      const result = await runRoundTableAgent(agent, signal);
      results[index] = result;
      completed++;
      onProgress?.(completed, total, agent.name);
    }
  };

  const workers = Array.from(
    { length: maxConcurrent },
    () => worker()
  );
  await Promise.all(workers);

  return results;
};

/**
 * Format round table results for display.
 */
export const formatRoundTable = (suggestions: RoundTableSuggestion[]): string => {
  let output = `# 🗣️ Round Table — Agent Suggestions\n\n`;
  output += `> Each agent was asked: "What should we work on next?"\n\n`;

  for (const s of suggestions) {
    const icon = s.error ? "⚠️" : "💡";
    output += `## ${icon} ${s.agentName} (weight: ${s.weight})\n`;
    output += `*${s.role}* · ${(s.durationMs / 1000).toFixed(1)}s`;
    if (s.error) output += ` · **Error:** ${s.error}`;
    output += `\n\n${s.suggestion}\n\n---\n\n`;
  }

  output += `## 🎯 Next Steps\n\n`;
  output += `Pick the ideas you want to formally propose:\n\n`;
  output += "```";
  output += `\n dao_propose(`;
  output += `\n   title: "Your chosen title",`;
  output += `\n   type: "technical-change",`;
  output += `\n   description: "Adapted from [Agent Name]'s suggestion: ..."`;
  output += `\n )`;
  output += "\n```";

  return output;
};
