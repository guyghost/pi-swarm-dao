import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock persistence before importing the module
vi.mock("../../extensions/dao/persistence.js", () => ({
  getState: vi.fn(() => ({
    proposals: [],
    snapshots: {},
    deliveryPlans: {},
  })),
}));

vi.mock("../../extensions/dao/governance/proposals.js", () => ({
  getProposal: vi.fn(),
  listProposals: vi.fn(() => []),
}));

import {
  buildDependencyGraph,
  analyzeImpact,
  checkReadiness,
  formatDependencyGraph,
  formatImpactAnalysis,
  formatReadiness,
} from "../../extensions/dao/governance/dependency-graph.js";

import { getProposal, listProposals } from "../../extensions/dao/governance/proposals.js";
import { getState } from "../../extensions/dao/persistence.js";

const mockedListProposals = vi.mocked(listProposals);
const mockedGetProposal = vi.mocked(getProposal);
const mockedGetState = vi.mocked(getState);

function makeProposal(id: number, title: string, status = "open", deps: string[] = []) {
  return {
    id,
    title,
    status,
    type: "product-feature",
    riskZone: "green",
    description: "",
    proposedBy: "user",
    content: deps.length > 0 ? { dependencies: deps } : undefined,
  } as any;
}

describe("Dependency Graph Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildDependencyGraph", () => {
    it("builds an empty graph with no proposals", () => {
      mockedListProposals.mockReturnValue([]);
      mockedGetState.mockReturnValue({ snapshots: {}, deliveryPlans: {} } as any);

      const graph = buildDependencyGraph();

      expect(graph.nodes.size).toBe(0);
      expect(graph.edges).toHaveLength(0);
      expect(graph.cycles).toHaveLength(0);
      expect(graph.conflicts).toHaveLength(0);
      expect(graph.executionOrder).toHaveLength(0);
    });

    it("builds nodes from proposals", () => {
      mockedListProposals.mockReturnValue([
        makeProposal(1, "Alpha", "open"),
        makeProposal(2, "Beta", "executed"),
      ]);
      mockedGetState.mockReturnValue({ snapshots: {}, deliveryPlans: {} } as any);

      const graph = buildDependencyGraph();

      expect(graph.nodes.size).toBe(2);
      expect(graph.nodes.get(1)?.title).toBe("Alpha");
      expect(graph.nodes.get(2)?.status).toBe("executed");
    });

    it("extracts dependency edges from proposal content", () => {
      mockedListProposals.mockReturnValue([
        makeProposal(1, "Alpha", "open"),
        makeProposal(2, "Beta", "open", ["Requires #1"]),
        makeProposal(3, "Gamma", "open", ["Depends on #1", "#2 recommended"]),
      ]);
      mockedGetState.mockReturnValue({ snapshots: {}, deliveryPlans: {} } as any);

      const graph = buildDependencyGraph();

      expect(graph.edges).toHaveLength(3);
      expect(graph.edges.find(e => e.from === 2 && e.to === 1)?.type).toBe("hard");
      expect(graph.edges.find(e => e.from === 3 && e.to === 2)?.type).toBe("soft");
    });

    it("computes topological sort (execution order)", () => {
      mockedListProposals.mockReturnValue([
        makeProposal(3, "Gamma", "open", ["Requires #1"]),
        makeProposal(1, "Alpha", "open"),
        makeProposal(2, "Beta", "open", ["Requires #1"]),
      ]);
      mockedGetState.mockReturnValue({ snapshots: {}, deliveryPlans: {} } as any);

      const graph = buildDependencyGraph();

      // Alpha (#1) should come first (no deps), then Beta (#2) and Gamma (#3)
      expect(graph.executionOrder[0]).toBe(1);
      const betaIdx = graph.executionOrder.indexOf(2);
      const gammaIdx = graph.executionOrder.indexOf(3);
      expect(betaIdx).toBeGreaterThan(0);
      expect(gammaIdx).toBeGreaterThan(0);
    });

    it("detects cycles", () => {
      mockedListProposals.mockReturnValue([
        makeProposal(1, "Alpha", "open", ["Requires #2"]),
        makeProposal(2, "Beta", "open", ["Requires #1"]),
      ]);
      mockedGetState.mockReturnValue({ snapshots: {}, deliveryPlans: {} } as any);

      const graph = buildDependencyGraph();

      expect(graph.cycles.length).toBeGreaterThan(0);
    });

    it("computes transitive dependencies", () => {
      mockedListProposals.mockReturnValue([
        makeProposal(1, "Alpha", "open"),
        makeProposal(2, "Beta", "open", ["Requires #1"]),
        makeProposal(3, "Gamma", "open", ["Requires #2"]),
      ]);
      mockedGetState.mockReturnValue({ snapshots: {}, deliveryPlans: {} } as any);

      const graph = buildDependencyGraph();

      // Gamma depends on Beta, Beta depends on Alpha → Gamma transitively depends on Alpha
      const gammaDeps = graph.transitiveDeps.get(3);
      expect(gammaDeps).toBeDefined();
      expect(gammaDeps!.has(1)).toBe(true);
      expect(gammaDeps!.has(2)).toBe(true);
    });

    it("computes transitive dependents (reverse)", () => {
      mockedListProposals.mockReturnValue([
        makeProposal(1, "Alpha", "open"),
        makeProposal(2, "Beta", "open", ["Requires #1"]),
        makeProposal(3, "Gamma", "open", ["Requires #1"]),
      ]);
      mockedGetState.mockReturnValue({ snapshots: {}, deliveryPlans: {} } as any);

      const graph = buildDependencyGraph();

      // Alpha has two dependents: Beta and Gamma
      const alphaDeps = graph.transitiveDependents.get(1);
      expect(alphaDeps).toBeDefined();
      expect(alphaDeps!.has(2)).toBe(true);
      expect(alphaDeps!.has(3)).toBe(true);
    });
  });

  describe("detectConflicts", () => {
    it("detects file overlap conflicts", () => {
      mockedListProposals.mockReturnValue([
        makeProposal(1, "Alpha", "open"),
        makeProposal(2, "Beta", "open"),
      ]);
      mockedGetState.mockReturnValue({
        snapshots: {
          1: { filesChanged: ["src/types.ts", "src/index.ts"] },
          2: { filesChanged: ["src/types.ts", "src/other.ts"] },
        },
        deliveryPlans: {},
      } as any);

      const graph = buildDependencyGraph();

      const fileConflicts = graph.conflicts.filter(c => c.conflictType === "file_overlap");
      expect(fileConflicts.length).toBeGreaterThan(0);
      expect(fileConflicts[0].affectedFiles).toContain("src/types.ts");
    });

    it("skips conflicts between terminal proposals", () => {
      mockedListProposals.mockReturnValue([
        makeProposal(1, "Alpha", "executed"),
        makeProposal(2, "Beta", "executed"),
      ]);
      mockedGetState.mockReturnValue({
        snapshots: {
          1: { filesChanged: ["src/types.ts"] },
          2: { filesChanged: ["src/types.ts"] },
        },
        deliveryPlans: {},
      } as any);

      const graph = buildDependencyGraph();

      expect(graph.conflicts.filter(c => c.conflictType === "file_overlap")).toHaveLength(0);
    });
  });

  describe("checkReadiness", () => {
    it("returns ready when no dependencies", () => {
      mockedListProposals.mockReturnValue([makeProposal(1, "Alpha", "open")]);
      mockedGetProposal.mockReturnValue(makeProposal(1, "Alpha", "open"));
      mockedGetState.mockReturnValue({ snapshots: {}, deliveryPlans: {} } as any);

      const check = checkReadiness(1);

      expect(check?.ready).toBe(true);
      expect(check?.unsatisfiedDeps).toHaveLength(0);
    });

    it("returns not ready when hard dep is unsatisfied", () => {
      mockedListProposals.mockReturnValue([
        makeProposal(1, "Alpha", "open"),
        makeProposal(2, "Beta", "open", ["Requires #1"]),
      ]);
      mockedGetProposal.mockImplementation((id: number) => {
        if (id === 1) return makeProposal(1, "Alpha", "open");
        if (id === 2) return makeProposal(2, "Beta", "open", ["Requires #1"]);
        return undefined;
      });
      mockedGetState.mockReturnValue({ snapshots: {}, deliveryPlans: {} } as any);

      const check = checkReadiness(2);

      expect(check?.ready).toBe(false);
      expect(check?.unsatisfiedDeps).toHaveLength(1);
      expect(check?.unsatisfiedDeps[0].type).toBe("hard");
    });

    it("returns ready when hard dep is executed", () => {
      mockedListProposals.mockReturnValue([
        makeProposal(1, "Alpha", "executed"),
        makeProposal(2, "Beta", "open", ["Requires #1"]),
      ]);
      mockedGetProposal.mockImplementation((id: number) => {
        if (id === 1) return makeProposal(1, "Alpha", "executed");
        if (id === 2) return makeProposal(2, "Beta", "open", ["Requires #1"]);
        return undefined;
      });
      mockedGetState.mockReturnValue({ snapshots: {}, deliveryPlans: {} } as any);

      const check = checkReadiness(2);

      expect(check?.ready).toBe(true);
    });

    it("returns null for non-existent proposal", () => {
      mockedGetProposal.mockReturnValue(undefined);
      expect(checkReadiness(999)).toBeNull();
    });
  });

  describe("analyzeImpact", () => {
    it("returns null for non-existent proposal", () => {
      mockedGetProposal.mockReturnValue(undefined);
      expect(analyzeImpact(999)).toBeNull();
    });

    it("computes cascading impact", () => {
      mockedListProposals.mockReturnValue([
        makeProposal(1, "Alpha", "open"),
        makeProposal(2, "Beta", "open", ["Requires #1"]),
        makeProposal(3, "Gamma", "open", ["Requires #2"]),
      ]);
      mockedGetProposal.mockImplementation((id: number) => {
        if (id === 1) return makeProposal(1, "Alpha", "open");
        if (id === 2) return makeProposal(2, "Beta", "open", ["Requires #1"]);
        if (id === 3) return makeProposal(3, "Gamma", "open", ["Requires #2"]);
        return undefined;
      });
      mockedGetState.mockReturnValue({ snapshots: {}, deliveryPlans: {} } as any);

      const impact = analyzeImpact(1);

      expect(impact).not.toBeNull();
      expect(impact!.directlyBlocked).toContain(2);
      expect(impact!.transitivelyBlocked).toContain(3);
      expect(impact!.riskLevel).toBe("high");
    });

    it("returns low risk when nothing depends on proposal", () => {
      mockedListProposals.mockReturnValue([
        makeProposal(1, "Alpha", "open"),
        makeProposal(2, "Beta", "open"),
      ]);
      mockedGetProposal.mockImplementation((id: number) => {
        if (id === 1) return makeProposal(1, "Alpha", "open");
        return undefined;
      });
      mockedGetState.mockReturnValue({ snapshots: {}, deliveryPlans: {} } as any);

      const impact = analyzeImpact(1);

      expect(impact?.riskLevel).toBe("low");
      expect(impact?.transitivelyBlocked).toHaveLength(0);
    });
  });

  describe("Formatting", () => {
    it("formatDependencyGraph produces readable output", () => {
      mockedListProposals.mockReturnValue([
        makeProposal(1, "Alpha", "executed"),
        makeProposal(2, "Beta", "open", ["Requires #1"]),
      ]);
      mockedGetState.mockReturnValue({ snapshots: {}, deliveryPlans: {} } as any);

      const graph = buildDependencyGraph();
      const output = formatDependencyGraph(graph);

      expect(output).toContain("Dependency Graph");
      expect(output).toContain("Alpha");
      expect(output).toContain("Beta");
      expect(output).toContain("Execution Order");
    });

    it("formatImpactAnalysis shows blocked proposals", () => {
      mockedListProposals.mockReturnValue([
        makeProposal(1, "Alpha", "open"),
        makeProposal(2, "Beta", "open", ["Requires #1"]),
      ]);
      mockedGetProposal.mockImplementation((id: number) => {
        if (id === 1) return makeProposal(1, "Alpha", "open");
        if (id === 2) return makeProposal(2, "Beta", "open", ["Requires #1"]);
        return undefined;
      });
      mockedGetState.mockReturnValue({ snapshots: {}, deliveryPlans: {} } as any);

      const impact = analyzeImpact(1)!;
      const output = formatImpactAnalysis(impact);

      expect(output).toContain("Impact Analysis");
      expect(output).toContain("#2");
    });

    it("formatReadiness shows unsatisfied deps", () => {
      mockedListProposals.mockReturnValue([
        makeProposal(1, "Alpha", "open"),
        makeProposal(2, "Beta", "open", ["Requires #1"]),
      ]);
      mockedGetProposal.mockImplementation((id: number) => {
        if (id === 1) return makeProposal(1, "Alpha", "open");
        if (id === 2) return makeProposal(2, "Beta", "open", ["Requires #1"]);
        return undefined;
      });
      mockedGetState.mockReturnValue({ snapshots: {}, deliveryPlans: {} } as any);

      const check = checkReadiness(2)!;
      const output = formatReadiness(check);

      expect(output).toContain("Readiness Check");
      expect(output).toContain("#1");
    });
  });
});
