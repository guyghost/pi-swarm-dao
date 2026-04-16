import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyExecution, formatVerification } from "../../extensions/dao/delivery/verification.js";
import type { ExecutionVerification } from "../../extensions/dao/types.js";

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(await import("child_process")).execSync;

describe("Execution Verification (Proposal #7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success when all checks pass", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("git diff --name-only HEAD~1")) return "src/foo.ts\nsrc/bar.ts\n";
      if (cmd.includes("tsc --noEmit")) return "";
      if (cmd.includes("vitest run")) return "Tests  104 passed\n104 tests passed";
      if (cmd.includes("git status --porcelain")) return "";
      return "";
    });

    const result = verifyExecution(1);

    expect(result.proposalId).toBe(1);
    expect(result.status).toBe("success");
    expect(result.compilationOk).toBe(true);
    expect(result.gitClean).toBe(true);
    expect(result.testsPassed).toBe(104);
    expect(result.testsFailed).toBe(0);
    expect(result.filesChanged).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("returns failed when compilation fails", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("git diff")) return "src/foo.ts\n";
      if (cmd.includes("tsc --noEmit")) throw new Error("Compilation error");
      if (cmd.includes("vitest run")) return "Tests  50 passed\n";
      if (cmd.includes("git status")) return "";
      return "";
    });

    const result = verifyExecution(2);

    expect(result.status).toBe("failed");
    expect(result.compilationOk).toBe(false);
  });

  it("returns partial when some tests fail", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("git diff")) return "src/foo.ts\n";
      if (cmd.includes("tsc --noEmit")) return "";
      if (cmd.includes("vitest run")) throw Object.assign(
        new Error("test failure"),
        { stdout: "Tests  98 passed, 6 failed\n98 tests passed" }
      );
      if (cmd.includes("git status")) return "";
      return "";
    });

    const result = verifyExecution(3);

    expect(result.status).toBe("partial");
    expect(result.testsPassed).toBe(98);
    expect(result.testsFailed).toBe(6);
    expect(result.compilationOk).toBe(true);
  });

  it("returns partial when expected files are missing", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("git diff")) return "src/foo.ts\n";
      if (cmd.includes("tsc --noEmit")) return "";
      if (cmd.includes("vitest run")) return "Tests  100 passed\n";
      if (cmd.includes("git status")) return "";
      return "";
    });

    const result = verifyExecution(4, ["src/foo.ts", "src/missing.ts"]);

    expect(result.status).toBe("partial");
    expect(result.missingFiles).toEqual(["src/missing.ts"]);
    expect(result.filesChanged).toEqual(["src/foo.ts"]);
  });

  it("returns failed when all tests fail", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("git diff")) return "src/foo.ts\n";
      if (cmd.includes("tsc --noEmit")) return "";
      if (cmd.includes("vitest run")) throw Object.assign(
        new Error("test failure"),
        { stdout: "Tests  0 passed, 5 failed\n0 tests passed" }
      );
      if (cmd.includes("git status")) return "";
      return "";
    });

    const result = verifyExecution(5);

    expect(result.status).toBe("failed");
    expect(result.testsPassed).toBe(0);
    expect(result.testsFailed).toBe(5);
  });

  it("handles empty git diff gracefully", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes("git diff --name-only HEAD~1")) throw new Error("no commits");
      if (cmd.includes("git diff --name-only")) throw new Error("no diff");
      if (cmd.includes("tsc --noEmit")) return "";
      if (cmd.includes("vitest run")) return "Tests  10 passed\n";
      if (cmd.includes("git status")) return "";
      return "";
    });

    const result = verifyExecution(6);

    expect(result.status).toBe("success");
    expect(result.filesChanged).toEqual([]);
  });

  it("formatVerification produces readable output", () => {
    const v: ExecutionVerification = {
      proposalId: 1,
      status: "success",
      timestamp: "2026-04-16T12:00:00.000Z",
      filesChanged: ["src/foo.ts", "src/bar.ts"],
      missingFiles: [],
      testsPassed: 104,
      testsFailed: 0,
      compilationOk: true,
      gitClean: true,
      summary: "OK",
    };

    const output = formatVerification(v);

    expect(output).toContain("Proposal #1");
    expect(output).toContain("SUCCESS");
    expect(output).toContain("104 passed");
    expect(output).toContain("src/foo.ts");
    expect(output).toContain("## Files Changed");
  });

  it("formatVerification shows missing files section", () => {
    const v: ExecutionVerification = {
      proposalId: 2,
      status: "partial",
      timestamp: "2026-04-16T12:00:00.000Z",
      filesChanged: ["src/foo.ts"],
      missingFiles: ["src/missing.ts"],
      testsPassed: 50,
      testsFailed: 2,
      compilationOk: true,
      gitClean: false,
      summary: "Partial",
    };

    const output = formatVerification(v);

    expect(output).toContain("## Missing Expected Files");
    expect(output).toContain("src/missing.ts");
    expect(output).toContain("PARTIAL");
  });
});
