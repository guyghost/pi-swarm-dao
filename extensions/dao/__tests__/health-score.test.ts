// ============================================================
// pi-swarm-dao — Health Score Engine Tests (Proposal #19)
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  computeHealthScore,
  getWeekKey,
  parseWeekKey,
  validateWeights,
  getWeights,
  getHealthTrend,
  snapshotWeeklyScore,
  getHealthSnapshots,
  formatHealthScore,
  formatHealthTrend,
} from "../health-score.js";
import { getState, setState } from "../persistence.js";
import { createInitialState } from "../types.js";
import type { Proposal, ProposalOutcome, HealthWeights } from "../types.js";

const mockProposal = (id: number, status: Proposal["status"], agentOutputCount: number = 10): Proposal => ({
  id,
  title: `Proposal ${id}`,
  type: "product-feature",
  description: "desc",
  stage: "postmortem",
  proposedBy: "user",
  status,
  votes: [],
  agentOutputs: Array.from({ length: agentOutputCount }, (_, i) => ({
    agentId: `agent-${i}`,
    agentName: `Agent ${i}`,
    role: "test",
    content: `output ${i}`,
    durationMs: 1000,
  })),
  createdAt: new Date().toISOString(),
});

describe("Health Score Engine", () => {
  beforeEach(() => {
    setState(createInitialState());
    const state = getState();
    state.initialized = true;
    state.agents = Array.from({ length: 10 }, (_, i) => ({
      id: `agent-${i}`,
      name: `Agent ${i}`,
      role: "test",
      description: "test",
      weight: 1,
      systemPrompt: "test",
    }));
    setState(state);
  });

  describe("computeHealthScore", () => {
    it("returns insufficient data when fewer than 3 proposals", () => {
      const score = computeHealthScore([]);
      expect(score.insufficientData).toBe(true);
      expect(score.score).toBe(0);
      expect(score.label).toBe("—");
    });

    it("returns insufficient data with 2 proposals", () => {
      const score = computeHealthScore([mockProposal(1, "approved"), mockProposal(2, "rejected")]);
      expect(score.insufficientData).toBe(true);
    });

    it("computes a score with 3+ proposals", () => {
      const proposals = [
        mockProposal(1, "approved"),
        mockProposal(2, "approved"),
        mockProposal(3, "rejected"),
      ];
      const score = computeHealthScore(proposals);
      expect(score.insufficientData).toBe(false);
      expect(score.score).toBeGreaterThan(0);
      expect(score.proposalCount).toBe(3);
      expect(score.metrics).toHaveLength(4);
    });

    it("computes pass rate correctly (2/3 approved = 67%)", () => {
      const proposals = [
        mockProposal(1, "approved"),
        mockProposal(2, "approved"),
        mockProposal(3, "rejected"),
      ];
      const score = computeHealthScore(proposals);
      const passRateMetric = score.metrics.find(m => m.name === "Pass Rate")!;
      expect(passRateMetric.normalizedScore).toBe(67);
      expect(passRateMetric.displayValue).toBe("67% pass rate");
    });

    it("computes avg rating from outcomes", () => {
      const state = getState();
      const proposals = [
        mockProposal(1, "executed"),
        mockProposal(2, "executed"),
        mockProposal(3, "executed"),
      ];
      state.proposals = proposals;
      state.outcomes[1] = {
        proposalId: 1, ratings: [{ proposalId: 1, rater: "user", score: 4, comment: "", ratedAt: "" }],
        metrics: [], overallScore: 4, status: "tracked", createdAt: "", updatedAt: "",
      };
      state.outcomes[2] = {
        proposalId: 2, ratings: [{ proposalId: 2, rater: "user", score: 5, comment: "", ratedAt: "" }],
        metrics: [], overallScore: 5, status: "tracked", createdAt: "", updatedAt: "",
      };
      setState(state);

      const score = computeHealthScore(proposals);
      const ratingMetric = score.metrics.find(m => m.name === "Avg Outcome Rating")!;
      expect(ratingMetric.rawValue).toBe(4.5);
      expect(ratingMetric.normalizedScore).toBe(90);
    });

    it("labels scores correctly", () => {
      const state = getState();
      const proposals = Array.from({ length: 10 }, (_, i) => mockProposal(i + 1, "approved"));
      // Add ratings to boost avg rating score
      for (let i = 1; i <= 10; i++) {
        state.outcomes[i] = {
          proposalId: i, ratings: [{ proposalId: i, rater: "user", score: 5, comment: "", ratedAt: "" }],
          metrics: [], overallScore: 5, status: "tracked", createdAt: "", updatedAt: "",
        };
      }
      setState(state);
      const score = computeHealthScore(proposals);
      expect(score.label).toBe("🟢 Healthy");
    });

    it("uses custom weights", () => {
      const proposals = [
        mockProposal(1, "approved"),
        mockProposal(2, "approved"),
        mockProposal(3, "rejected"),
      ];
      const weights: HealthWeights = { passRate: 100, avgRating: 0, deliberationDepth: 0, participation: 0 };
      const score = computeHealthScore(proposals, weights);
      expect(score.metrics[0].weight).toBe(100);
      expect(score.metrics[1].weight).toBe(0);
    });
  });

  describe("week utilities", () => {
    it("getWeekKey returns expected format", () => {
      const key = getWeekKey(new Date("2026-05-05"));
      expect(key).toMatch(/^\d{4}-W\d{2}$/);
    });

    it("parseWeekKey extracts year and week", () => {
      const parsed = parseWeekKey("2026-W18");
      expect(parsed.year).toBe(2026);
      expect(parsed.week).toBe(18);
    });
  });

  describe("validateWeights", () => {
    it("validates correct weights", () => {
      const result = validateWeights({ passRate: 25, avgRating: 25, deliberationDepth: 25, participation: 25 });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("fails when weights don't sum to 100", () => {
      const result = validateWeights({ passRate: 30, avgRating: 30, deliberationDepth: 30, participation: 30 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("sum to 100"))).toBe(true);
    });

    it("fails when a weight is negative", () => {
      const result = validateWeights({ passRate: -10, avgRating: 50, deliberationDepth: 30, participation: 30 });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("passRate"))).toBe(true);
    });
  });

  describe("snapshotWeeklyScore", () => {
    it("creates a snapshot for current week", () => {
      const state = getState();
      state.proposals = Array.from({ length: 5 }, (_, i) => mockProposal(i + 1, "approved"));
      setState(state);

      const snap = snapshotWeeklyScore();
      expect(snap.weekKey).toMatch(/^\d{4}-W\d{2}$/);
      expect(snap.score).toBeGreaterThan(0);
      expect(snap.proposalCount).toBe(5);

      const all = getHealthSnapshots();
      expect(all).toHaveLength(1);
    });

    it("replaces existing snapshot for same week", () => {
      const state = getState();
      state.proposals = [mockProposal(1, "approved"), mockProposal(2, "approved"), mockProposal(3, "approved")];
      setState(state);

      snapshotWeeklyScore();
      snapshotWeeklyScore();
      expect(getHealthSnapshots()).toHaveLength(1);
    });
  });

  describe("getHealthTrend", () => {
    it("returns trend with current and previous", () => {
      const state = getState();
      state.proposals = Array.from({ length: 5 }, (_, i) => mockProposal(i + 1, "approved"));
      // Use current week + previous week for the snapshot
      const now = new Date();
      const prevWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const currKey = getWeekKey(now);
      const prevKey = getWeekKey(prevWeek);
      state.healthSnapshots = [
        { weekKey: prevKey, year: now.getFullYear(), week: parseWeekKey(prevKey).week, score: 70, metrics: [], proposalCount: 5, createdAt: "" },
        { weekKey: currKey, year: now.getFullYear(), week: parseWeekKey(currKey).week, score: 75, metrics: [], proposalCount: 5, createdAt: "" },
      ];
      setState(state);

      const trend = getHealthTrend(8);
      expect(trend.current).toBe(75);
      expect(trend.previous).toBe(70);
      expect(trend.direction).toBe("↑");
      expect(trend.delta).toBe(5);
    });

    it("returns dash when no data", () => {
      const trend = getHealthTrend(8);
      expect(trend.direction).toBe("—");
      expect(trend.current).toBeNull();
    });
  });

  describe("formatHealthScore", () => {
    it("formats insufficient data", () => {
      const score = computeHealthScore([]);
      const formatted = formatHealthScore(score);
      expect(formatted).toContain("insufficient data");
    });

    it("formats full score with metrics table", () => {
      const proposals = Array.from({ length: 5 }, (_, i) => mockProposal(i + 1, "approved"));
      const score = computeHealthScore(proposals);
      const formatted = formatHealthScore(score);
      expect(formatted).toContain("Pass Rate");
      expect(formatted).toContain("Agent Participation");
    });
  });

  describe("formatHealthTrend", () => {
    it("formats trend with direction", () => {
      const trend = {
        current: 80, previous: 75, direction: "↑" as const, delta: 5,
        weeks: [{ weekKey: "2026-W18", score: 80 }],
      };
      const formatted = formatHealthTrend(trend);
      expect(formatted).toContain("↑");
      expect(formatted).toContain("W18");
    });
  });
});
