import { describe, expect, it } from "vitest";
import {
  renderDeliberationLiveWidget,
  renderDeliberationProgress,
} from "../../extensions/dao/render.ts";

describe("deliberation rendering", () => {
  it("renders the compact progress bar message", () => {
    expect(renderDeliberationProgress(3, 7, "Architect")).toContain("3/7");
    expect(renderDeliberationProgress(3, 7, "Architect")).toContain("Architect done");
  });

  it("renders a live widget with score, threshold, and agent states", () => {
    const lines = renderDeliberationLiveWidget({
      proposalId: 12,
      title: "Make deliberation realtime",
      subtitle: "Collecting votes…",
      statusLabel: "IN PROGRESS",
      weightedFor: 5,
      totalWeight: 15,
      requiredWeight: 8,
      completedAgents: 3,
      totalAgents: 7,
      lastAgent: "Research Agent",
      agents: [
        { agentId: "strategist", agentName: "Product Strategist", weight: 3, status: "completed", vote: "for" },
        { agentId: "researcher", agentName: "Research Agent", weight: 2, status: "completed", vote: "for" },
        { agentId: "architect", agentName: "Solution Architect", weight: 3, status: "pending" },
        { agentId: "critic", agentName: "Critic / Risk Agent", weight: 3, status: "error", note: "no vote" },
      ],
    });

    expect(lines.some((line) => line.includes("Délibération Pi-Swarm-DAO"))).toBe(true);
    expect(lines.some((line) => line.includes("SCORE ACTUEL 5/15   SEUIL REQUIS 8   ÉTAT IN PROGRESS"))).toBe(true);
    expect(lines.some((line) => line.includes("Progress [███░░░░] 3/7 — last: Research Agent"))).toBe(true);
    expect(lines.some((line) => line.includes("✅ Product [3]"))).toBe(true);
    expect(lines.some((line) => line.includes("FOR +3"))).toBe(true);
    expect(lines.some((line) => line.includes("⚠️ Critic/Risk [3]"))).toBe(true);
    expect(lines.some((line) => line.includes("ERROR · no vote"))).toBe(true);
  });
});
