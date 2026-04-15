// ============================================================
// Tests — Proposal #5: RICE Scoring Framework
// ============================================================
import { describe, it, expect } from "vitest";
import {
  calculateRICEScore,
  formatRICEScore,
  parseRICEFromOutput,
  rankByRICE,
} from "../../extensions/dao/governance/scoring.ts";
import type { Proposal } from "../../extensions/dao/types.ts";

const makeProposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  id: 1,
  title: "Test Proposal",
  type: "product-feature",
  description: "A test proposal",
  status: "approved",
  stage: "execution-gate",
  proposedBy: "test",
  votes: [],
  agentOutputs: [],
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe("RICE Scoring (#5)", () => {
  describe("calculateRICEScore", () => {
    it("computes RICE = reach × impact × confidence / effort", () => {
      const rice = calculateRICEScore(1000, 5, 80, 2);
      // 1000 × 5 × 0.80 / 2 = 2000
      expect(rice.riceScore).toBe(2000);
      expect(rice.reach).toBe(1000);
      expect(rice.impact).toBe(5);
      expect(rice.confidence).toBe(80);
      expect(rice.effort).toBe(2);
    });

    it("clamps impact to 1-10", () => {
      const high = calculateRICEScore(100, 15, 100, 1);
      expect(high.impact).toBe(10);

      const low = calculateRICEScore(100, 0, 100, 1);
      expect(low.impact).toBe(1);
    });

    it("clamps confidence to 1-100", () => {
      const rice = calculateRICEScore(100, 5, 150, 1);
      expect(rice.confidence).toBe(100);
    });

    it("clamps effort to minimum 0.5", () => {
      const rice = calculateRICEScore(100, 5, 100, 0);
      expect(rice.effort).toBe(0.5);
    });

    it("higher reach and impact produce higher score", () => {
      const low = calculateRICEScore(100, 3, 80, 2);
      const high = calculateRICEScore(5000, 8, 80, 2);
      expect(high.riceScore).toBeGreaterThan(low.riceScore);
    });

    it("higher effort reduces score", () => {
      const easy = calculateRICEScore(1000, 5, 80, 1);
      const hard = calculateRICEScore(1000, 5, 80, 8);
      expect(easy.riceScore).toBeGreaterThan(hard.riceScore);
    });
  });

  describe("parseRICEFromOutput", () => {
    it("parses RICE from prioritizer output", () => {
      const proposal = makeProposal({
        agentOutputs: [{
          agentId: "prioritizer",
          agentName: "Prioritization Agent",
          role: "Impact scoring",
          content: "### RICE Analysis\nReach: 5000\nImpact: 7\nConfidence: 80%\nEffort: 3 weeks",
          durationMs: 1000,
        }],
      });
      const rice = parseRICEFromOutput(proposal);
      expect(rice).not.toBeNull();
      expect(rice!.reach).toBe(5000);
      expect(rice!.impact).toBe(7);
      expect(rice!.confidence).toBe(80);
      expect(rice!.effort).toBe(3);
    });

    it("returns null when no prioritizer output", () => {
      const proposal = makeProposal();
      expect(parseRICEFromOutput(proposal)).toBeNull();
    });

    it("defaults confidence to 70% when not specified", () => {
      const proposal = makeProposal({
        agentOutputs: [{
          agentId: "prioritizer",
          agentName: "Prioritization Agent",
          role: "Impact scoring",
          content: "Reach: 1000\nImpact: 5",
          durationMs: 1000,
        }],
      });
      const rice = parseRICEFromOutput(proposal);
      expect(rice).not.toBeNull();
      expect(rice!.confidence).toBe(70);
    });
  });

  describe("rankByRICE", () => {
    it("ranks proposals by RICE score descending", () => {
      const proposals = [
        makeProposal({ id: 1, riceScore: calculateRICEScore(100, 3, 50, 2) }),
        makeProposal({ id: 2, riceScore: calculateRICEScore(5000, 8, 90, 1) }),
        makeProposal({ id: 3, riceScore: calculateRICEScore(1000, 5, 70, 4) }),
      ];

      const ranked = rankByRICE(proposals);
      expect(ranked[0].id).toBe(2); // highest RICE
      expect(ranked[1].id).toBe(3);
      expect(ranked[2].id).toBe(1);
      expect(ranked[0].riceScore!.rank).toBe(1);
      expect(ranked[2].riceScore!.rank).toBe(3);
    });

    it("skips proposals without RICE scores", () => {
      const proposals = [
        makeProposal({ id: 1 }), // no RICE
        makeProposal({ id: 2, riceScore: calculateRICEScore(1000, 5, 80, 2) }),
      ];

      const ranked = rankByRICE(proposals);
      expect(ranked).toHaveLength(1);
      expect(ranked[0].id).toBe(2);
    });
  });

  describe("formatRICEScore", () => {
    it("formats RICE score as markdown", () => {
      const rice = calculateRICEScore(5000, 7, 85, 3);
      const formatted = formatRICEScore(rice);
      expect(formatted).toContain("RICE Score");
      expect(formatted).toContain("5,000");
      expect(formatted).toContain("7/10");
      expect(formatted).toContain("85%");
      expect(formatted).toContain("3 week");
    });
  });
});
