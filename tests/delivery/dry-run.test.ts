// ============================================================
// Tests — Proposal #8: Dry-Run & Rollback
// ============================================================
import { describe, it, expect, beforeEach } from "vitest";
import { getState, setState } from "../../extensions/dao/persistence.ts";
import { createInitialState } from "../../extensions/dao/types.ts";
import {
  performDryRun,
  getSnapshot,
} from "../../extensions/dao/delivery/dry-run.ts";

// Reset state before each test
beforeEach(() => {
  const state = createInitialState();
  state.proposals = [
    {
      id: 1,
      title: "Test Proposal",
      type: "product-feature",
      description: "A test proposal for dry-run",
      status: "controlled",
      stage: "execution-gate",
      proposedBy: "test",
      votes: [],
      agentOutputs: [],
      createdAt: new Date().toISOString(),
    },
  ];
  setState(state);
});

describe("Dry-Run (#8)", () => {
  describe("performDryRun", () => {
    it("returns canProceed for valid proposals", () => {
      const result = performDryRun(1, "Create `src/new-feature.ts` and `tests/new-feature.test.ts`");
      expect(result.proposalId).toBe(1);
      expect(result.canProceed).toBe(true);
      expect(result.preview).toContain("Dry-Run Preview");
    });

    it("detects core files as risks", () => {
      const result = performDryRun(1, "Modify `extensions/dao/types.ts`");
      const coreRisk = result.risks.find(r => r.includes("Core files affected"));
      expect(coreRisk).toBeDefined();
    });

    it("warns when no test files in plan", () => {
      const result = performDryRun(1, "Create `src/new-feature.ts`");
      const noTestWarning = result.risks.find(r => r.includes("No test files"));
      expect(noTestWarning).toBeDefined();
    });

    it("returns failure for non-existent proposal", () => {
      const result = performDryRun(999, "No such proposal");
      expect(result.canProceed).toBe(false);
      expect(result.preview).toContain("not found");
    });

    it("extracts file paths from plan", () => {
      const result = performDryRun(1, "Create `outcomes.ts` and `dry-run.ts` in delivery/");
      expect(result.filesAffected.length).toBeGreaterThan(0);
    });
  });

  describe("getSnapshot", () => {
    it("returns undefined when no snapshot exists", () => {
      const snapshot = getSnapshot(1);
      expect(snapshot).toBeUndefined();
    });
  });
});
