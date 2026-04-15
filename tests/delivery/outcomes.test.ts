// ============================================================
// Tests — Proposal #6: Outcome Tracking
// ============================================================
import { describe, it, expect, beforeEach } from "vitest";
import { getState, setState } from "../../extensions/dao/persistence.ts";
import { createInitialState } from "../../extensions/dao/types.ts";
import {
  getOutcome,
  initOutcome,
  addRating,
  addMetric,
  markReviewed,
  generateDashboard,
} from "../../extensions/dao/delivery/outcomes.ts";

// Reset state before each test
beforeEach(() => {
  setState(createInitialState());
});

describe("Outcome Tracking (#6)", () => {
  describe("initOutcome", () => {
    it("creates an outcome record for a proposal", () => {
      const outcome = initOutcome(1);
      expect(outcome.proposalId).toBe(1);
      expect(outcome.ratings).toEqual([]);
      expect(outcome.metrics).toEqual([]);
      expect(outcome.overallScore).toBe(0);
      expect(outcome.status).toBe("pending");
    });

    it("returns existing outcome if already initialized", () => {
      const first = initOutcome(1);
      first.overallScore = 5; // mutate
      const second = initOutcome(1);
      expect(second.overallScore).toBe(5);
    });
  });

  describe("addRating", () => {
    it("adds a rating and recalculates overall score", () => {
      const outcome = addRating(1, "user", 5, "Excellent");
      expect(outcome.ratings).toHaveLength(1);
      expect(outcome.ratings[0].score).toBe(5);
      expect(outcome.overallScore).toBe(5);
      expect(outcome.status).toBe("tracked");
    });

    it("averages multiple ratings", () => {
      addRating(1, "user1", 5, "Great");
      const outcome = addRating(1, "user2", 3, "OK");
      expect(outcome.overallScore).toBe(4);
      expect(outcome.ratings).toHaveLength(2);
    });

    it("updates existing rater's rating", () => {
      addRating(1, "user", 3, "OK");
      const outcome = addRating(1, "user", 5, "Actually great");
      expect(outcome.ratings).toHaveLength(1);
      expect(outcome.ratings[0].score).toBe(5);
      expect(outcome.overallScore).toBe(5);
    });
  });

  describe("addMetric", () => {
    it("adds a before/after metric snapshot", () => {
      const outcome = addMetric(1, "latency", "500ms", "200ms", "ms");
      expect(outcome.metrics).toHaveLength(1);
      expect(outcome.metrics[0].name).toBe("latency");
      expect(outcome.metrics[0].before).toBe("500ms");
      expect(outcome.metrics[0].after).toBe("200ms");
    });

    it("initializes outcome if not present", () => {
      const outcome = addMetric(1, "throughput", "10/s", "25/s");
      expect(outcome).toBeDefined();
      expect(outcome.metrics).toHaveLength(1);
    });
  });

  describe("markReviewed", () => {
    it("marks outcome as reviewed", () => {
      initOutcome(1);
      const outcome = markReviewed(1);
      expect(outcome?.status).toBe("reviewed");
    });

    it("returns null if no outcome exists", () => {
      const result = markReviewed(999);
      expect(result).toBeNull();
    });
  });

  describe("generateDashboard", () => {
    it("shows empty message when no outcomes", () => {
      const dash = generateDashboard();
      expect(dash).toContain("No outcomes tracked yet");
    });

    it("includes proposal ratings in dashboard", () => {
      addRating(1, "user", 4, "Good");
      const dash = generateDashboard();
      expect(dash).toContain("Outcome Dashboard");
      expect(dash).toContain("1");
      expect(dash).toContain("4.0/5");
    });
  });
});
