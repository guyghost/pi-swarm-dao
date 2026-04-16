/**
 * Execution Verification & Status Tracking (Proposal #7)
 *
 * Post-execution verification: checks file changes, compilation, tests, git status.
 */
import { execSync } from "child_process";
import type { ExecutionVerification, VerificationStatus } from "../types.js";

/**
 * Run post-execution verification checks
 */
export function verifyExecution(
  proposalId: number,
  expectedFiles: string[] = [],
  projectDir: string = process.cwd(),
): ExecutionVerification {
  const timestamp = new Date().toISOString();
  const filesChanged = getChangedFiles(projectDir);
  const missingFiles = expectedFiles.filter(
    (f) => !filesChanged.some((c) => c.endsWith(f) || c === f),
  );
  const compilationOk = checkCompilation(projectDir);
  const testResult = runTests(projectDir);
  const gitClean = checkGitClean(projectDir);

  // Determine status
  let status: VerificationStatus = "success";

  if (!compilationOk) {
    status = "failed";
  } else if (testResult.testsFailed > 0) {
    status = testResult.testsPassed > 0 ? "partial" : "failed";
  } else if (missingFiles.length > 0) {
    status = "partial";
  }

  const summary = buildSummary(status, filesChanged, testResult, compilationOk, gitClean, missingFiles);

  return {
    proposalId,
    status,
    timestamp,
    filesChanged,
    missingFiles,
    testOutput: testResult.output,
    testsPassed: testResult.testsPassed,
    testsFailed: testResult.testsFailed,
    compilationOk,
    gitClean,
    summary,
  };
}

/** Get list of files changed since last commit */
function getChangedFiles(dir: string): string[] {
  try {
    const output = execSync("git diff --name-only HEAD~1 HEAD", {
      cwd: dir,
      encoding: "utf-8",
      timeout: 10_000,
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    try {
      const output = execSync("git diff --name-only", {
        cwd: dir,
        encoding: "utf-8",
        timeout: 10_000,
      });
      return output.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }
}

/** Check if TypeScript compiles without errors */
function checkCompilation(dir: string): boolean {
  try {
    execSync("npx tsc --noEmit", {
      cwd: dir,
      encoding: "utf-8",
      timeout: 60_000,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/** Run tests and collect results */
function runTests(dir: string): { testsPassed: number; testsFailed: number; output: string } {
  try {
    const output = execSync("npx vitest run --reporter=verbose 2>&1", {
      cwd: dir,
      encoding: "utf-8",
      timeout: 120_000,
      stdio: "pipe",
    });

    const passMatch = output.match(/(\d+)\s+passed/);
    const failMatch = output.match(/(\d+)\s+failed/);

    return {
      testsPassed: passMatch ? parseInt(passMatch[1], 10) : 0,
      testsFailed: failMatch ? parseInt(failMatch[1], 10) : 0,
      output: output.slice(-2000),
    };
  } catch (err: any) {
    const output = err.stdout || err.message || "";
    const passMatch = output.match(/(\d+)\s+passed/);
    const failMatch = output.match(/(\d+)\s+failed/);

    return {
      testsPassed: passMatch ? parseInt(passMatch[1], 10) : 0,
      testsFailed: failMatch ? parseInt(failMatch[1], 10) : (passMatch ? 0 : 1),
      output: output.slice(-2000),
    };
  }
}

/** Check if git working tree is clean */
function checkGitClean(dir: string): boolean {
  try {
    const output = execSync("git status --porcelain", {
      cwd: dir,
      encoding: "utf-8",
      timeout: 10_000,
    });
    return output.trim().length === 0;
  } catch {
    return false;
  }
}

/** Build human-readable summary */
function buildSummary(
  status: VerificationStatus,
  filesChanged: string[],
  testResult: { testsPassed: number; testsFailed: number; output: string },
  compilationOk: boolean,
  gitClean: boolean,
  missingFiles: string[],
): string {
  const icon = status === "success" ? "\u2705" : status === "partial" ? "\u26A0\uFE0F" : "\u274C";
  const lines: string[] = [
    icon + " Verification: " + status.toUpperCase(),
    "",
    "**Compilation:** " + (compilationOk ? "\u2705 OK" : "\u274C FAILED"),
    "**Tests:** " + testResult.testsPassed + " passed, " + testResult.testsFailed + " failed",
    "**Files changed:** " + filesChanged.length,
    "**Git status:** " + (gitClean ? "\u2705 Clean" : "\u26A0\uFE0F Uncommitted changes"),
  ];

  if (missingFiles.length > 0) {
    lines.push("", "**Missing expected files:** " + missingFiles.join(", "));
  }

  return lines.join("\n");
}

/** Format verification result for display */
export function formatVerification(v: ExecutionVerification): string {
  const icon = v.status === "success" ? "\u2705" : v.status === "partial" ? "\u26A0\uFE0F" : "\u274C";
  const lines: string[] = [
    "# " + icon + " Execution Verification \u2014 Proposal #" + v.proposalId,
    "",
    "**Status:** " + v.status.toUpperCase(),
    "**Timestamp:** " + v.timestamp,
    "",
    "## Checks",
    "| Check | Result |",
    "|-------|--------|",
    "| Compilation | " + (v.compilationOk ? "\u2705 OK" : "\u274C FAILED") + " |",
    "| Tests | " + (v.testsPassed ?? 0) + " passed, " + (v.testsFailed ?? 0) + " failed |",
    "| Files changed | " + v.filesChanged.length + " |",
    "| Git clean | " + (v.gitClean ? "\u2705 Yes" : "\u26A0\uFE0F No") + " |",
    "",
  ];

  if (v.filesChanged.length > 0) {
    lines.push("## Files Changed");
    for (const f of v.filesChanged) {
      lines.push("- `" + f + "`");
    }
    lines.push("");
  }

  if (v.missingFiles.length > 0) {
    lines.push("## Missing Expected Files");
    for (const f of v.missingFiles) {
      lines.push("- `" + f + "`");
    }
    lines.push("");
  }

  lines.push("## Summary");
  lines.push(v.summary);

  return lines.join("\n");
}
