// ============================================================
// pi-swarm-dao — Dry-Run & Rollback Safety Net (Proposal #8)
// ============================================================
// Provides dry-run execution previews and snapshot-based rollback
// for executed proposals.
// ============================================================

import { execFileSync } from "node:child_process";
import { getState, setState, createStateSnapshot } from "../persistence.js";
import type { ExecutionSnapshot, DryRunResult } from "../types.js";

// ── Git Helpers ──────────────────────────────────────────────

const git = (...args: string[]): string => {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024,
      timeout: 15_000,
    }).trim();
  } catch {
    return "";
  }
};

const getCurrentBranch = (): string => {
  return git("branch", "--show-current") || "unknown";
};

const getCurrentCommit = (): string => {
  return git("rev-parse", "--short", "HEAD") || "unknown";
};

const getChangedFiles = (ref: string): string[] => {
  const diff = git("diff", "--name-only", ref);
  return diff ? diff.split("\n").filter(Boolean) : [];
};

// ── Snapshot Management ──────────────────────────────────────

/**
 * Capture a snapshot of the current state before execution.
 * Returns the snapshot for storage.
 */
export const captureSnapshot = (proposalId: number): ExecutionSnapshot => {
  const state = getState();

  const snapshot: ExecutionSnapshot = {
    proposalId,
    timestamp: new Date().toISOString(),
    branch: getCurrentBranch(),
    commitSha: getCurrentCommit(),
    filesChanged: [],  // Will be populated after execution
    stateSnapshot: JSON.stringify(createStateSnapshot()),
  };

  state.snapshots[proposalId] = snapshot;
  setState(state);
  return snapshot;
};

/**
 * Update a snapshot with the files that changed during execution.
 */
export const updateSnapshotFiles = (proposalId: number, files: string[]): void => {
  const state = getState();
  const snapshot = state.snapshots[proposalId];
  if (snapshot) {
    snapshot.filesChanged = files;
    setState(state);
  }
};

/**
 * Get the snapshot for a proposal.
 */
export const getSnapshot = (proposalId: number): ExecutionSnapshot | undefined => {
  return getState().snapshots[proposalId];
};

// ── Dry-Run ──────────────────────────────────────────────────

/**
 * Perform a dry-run of a proposal execution.
 * Returns a preview of what would happen without applying changes.
 */
export const performDryRun = (proposalId: number, executionPlan: string): DryRunResult => {
  const state = getState();
  const proposal = state.proposals.find(p => p.id === proposalId);

  if (!proposal) {
    return {
      proposalId,
      preview: "Proposal not found",
      filesAffected: [],
      risks: [],
      estimatedDuration: "N/A",
      canProceed: false,
    };
  }

  // Analyze the execution plan for affected files
  const filesAffected = extractFilesFromPlan(executionPlan);

  // Identify risks
  const risks = identifyRisks(proposal.type, filesAffected);

  // Estimate duration based on number of phases/tasks
  const estimatedDuration = estimateDuration(executionPlan);

  // Build preview
  let preview = `## Dry-Run Preview: ${proposal.title}\n\n`;
  preview += `**Current Branch:** ${getCurrentBranch()}\n`;
  preview += `**Current Commit:** ${getCurrentCommit()}\n`;
  preview += `**Proposal Type:** ${proposal.type}\n\n`;

  if (filesAffected.length > 0) {
    preview += `### Files That Would Be Affected\n`;
    for (const f of filesAffected) {
      preview += `- \`${f}\`\n`;
    }
    preview += `\n`;
  }

  if (risks.length > 0) {
    preview += `### ⚠️ Risks Identified\n`;
    for (const r of risks) {
      preview += `- ${r}\n`;
    }
    preview += `\n`;
  }

  preview += `### Execution Plan Summary\n`;
  preview += executionPlan.slice(0, 500) + (executionPlan.length > 500 ? "\n\n[…truncated]" : "");

  return {
    proposalId,
    preview,
    filesAffected,
    risks,
    estimatedDuration,
    canProceed: risks.filter(r => r.startsWith("🔴")).length === 0,
  };
};

// ── Rollback ─────────────────────────────────────────────────

/**
 * Rollback a proposal execution by reverting to the pre-execution snapshot.
 * Returns true if rollback was successful.
 */
export const performRollback = (proposalId: number): { success: boolean; message: string } => {
  const snapshot = getSnapshot(proposalId);

  if (!snapshot) {
    return {
      success: false,
      message: `No snapshot found for proposal #${proposalId}. Cannot rollback.`,
    };
  }

  // Check if we're on the same branch
  const currentBranch = getCurrentBranch();
  if (currentBranch !== snapshot.branch) {
    return {
      success: false,
      message: `Current branch "${currentBranch}" differs from snapshot branch "${snapshot.branch}". Switch branches first.`,
    };
  }

  // If there are files changed, revert them using git
  if (snapshot.filesChanged.length > 0) {
    try {
      // Checkout the original versions of changed files
      for (const file of snapshot.filesChanged) {
        git("checkout", snapshot.commitSha, "--", file);
      }

      return {
        success: true,
        message: `Rolled back ${snapshot.filesChanged.length} file(s) to commit ${snapshot.commitSha}:\n${snapshot.filesChanged.map(f => `- ${f}`).join("\n")}`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Rollback failed: ${err.message}. Manual recovery needed — snapshot commit: ${snapshot.commitSha}`,
      };
    }
  }

  return {
    success: true,
    message: `No files to revert. Snapshot was at commit ${snapshot.commitSha}.`,
  };
};

// ── Helpers ──────────────────────────────────────────────────

/** Extract file paths mentioned in an execution plan. */
const extractFilesFromPlan = (plan: string): string[] => {
  const filePattern = /[`']([a-zA-Z0-9_/.-]+\.[a-z]{1,10})[`']/g;
  const matches = new Set<string>();
  let match;
  while ((match = filePattern.exec(plan)) !== null) {
    const file = match[1];
    // Filter out obvious non-files
    if (!file.includes("node_modules") && !file.startsWith(".") && file.length > 3) {
      matches.add(file);
    }
  }
  return [...matches].sort();
};

/** Identify risks based on proposal type and affected files. */
const identifyRisks = (type: string, files: string[]): string[] => {
  const risks: string[] = [];

  // Core files are always risky
  const coreFiles = files.filter(f =>
    f.includes("types.ts") || f.includes("persistence.ts") || f.includes("index.ts")
  );
  if (coreFiles.length > 0) {
    risks.push(`🔴 Core files affected: ${coreFiles.join(", ")}`);
  }

  // Test files should be included
  const hasTests = files.some(f => f.includes(".test.") || f.includes(".spec."));
  if (!hasTests && files.length > 0) {
    risks.push("🟡 No test files in plan — consider adding tests");
  }

  // Type changes
  if (type === "security-change") {
    risks.push("🟡 Security change — ensure audit log is updated");
  }

  return risks;
};

/** Estimate duration from execution plan text. */
const estimateDuration = (plan: string): string => {
  const phaseCount = (plan.match(/###?\s+Phase/gi) || []).length;
  const taskCount = (plan.match(/^\d+\./gm) || []).length;

  if (phaseCount === 0 && taskCount === 0) return "< 1 minute";
  if (taskCount <= 3) return "1-5 minutes";
  if (taskCount <= 8) return "5-15 minutes";
  return "15-30 minutes";
};
