// ============================================================
// Tests — Pipeline Dashboard Rendering
// ============================================================

import { describe, it, expect } from "vitest";
import {
  renderPipelineDashboard,
  renderProposalCard,
  parseFilterArgs,
  isStale,
  needsAction,
} from "../../extensions/dao/render-pipeline.ts";
import type { Proposal } from "../../extensions/dao/types.ts";

// ── Fixtures ─────────────────────────────────────────────────

const makeProposal = (overrides: Partial<Proposal> & { id: number }): Proposal => ({
  id: overrides.id,
  title: overrides.title ?? `Proposal #${overrides.id}`,
  type: overrides.type ?? "product-feature",
  description: overrides.description ?? "Test description",
  stage: overrides.stage ?? "intake",
  proposedBy: overrides.proposedBy ?? "test",
  status: overrides.status ?? "open",
  votes: overrides.votes ?? [],
  agentOutputs: overrides.agentOutputs ?? [],
  createdAt: overrides.createdAt ?? new Date().toISOString(),
  resolvedAt: overrides.resolvedAt,
  compositeScore: overrides.compositeScore,
  riskZone: overrides.riskZone,
});

// ── isStale ───────────────────────────────────────────────────

describe("isStale", () => {
  it("returns false for a proposal created 1 hour ago", () => {
    const p = makeProposal({
      id: 1,
      createdAt: new Date(Date.now() - 3600000).toISOString(),
    });
    expect(isStale(p, 24)).toBe(false);
  });

  it("returns true for a proposal created 48 hours ago", () => {
    const p = makeProposal({
      id: 1,
      createdAt: new Date(Date.now() - 48 * 3600000).toISOString(),
    });
    expect(isStale(p, 24)).toBe(true);
  });

  it("respects custom threshold", () => {
    const p = makeProposal({
      id: 1,
      createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    });
    expect(isStale(p, 1)).toBe(true);
    expect(isStale(p, 3)).toBe(false);
  });
});

// ── needsAction ───────────────────────────────────────────────

describe("needsAction", () => {
  it("returns true for approved proposal (needs check)", () => {
    const p = makeProposal({ id: 1, status: "approved" });
    expect(needsAction(p)).toBe(true);
  });

  it("returns true for controlled proposal (needs execute)", () => {
    const p = makeProposal({ id: 1, status: "controlled" });
    expect(needsAction(p)).toBe(true);
  });

  it("returns true for failed proposal (needs retry)", () => {
    const p = makeProposal({ id: 1, status: "failed" });
    expect(needsAction(p)).toBe(true);
  });

  it("returns true for amendment awaiting human approval", () => {
    const p = makeProposal({ id: 1, status: "open" } as any);
    (p as any).amendmentState = "approved-pending-human";
    expect(needsAction(p)).toBe(true);
  });

  it("returns false for open proposal", () => {
    const p = makeProposal({ id: 1, status: "open" });
    expect(needsAction(p)).toBe(false);
  });

  it("returns false for executed proposal", () => {
    const p = makeProposal({ id: 1, status: "executed" });
    expect(needsAction(p)).toBe(false);
  });

  it("returns false for rejected proposal", () => {
    const p = makeProposal({ id: 1, status: "rejected" });
    expect(needsAction(p)).toBe(false);
  });
});

// ── parseFilterArgs ───────────────────────────────────────────

describe("parseFilterArgs", () => {
  it("parses --stage open", () => {
    const filters = parseFilterArgs("--stage open");
    expect(filters.stage).toBe("open");
  });

  it("parses --type security-change", () => {
    const filters = parseFilterArgs("--type security-change");
    expect(filters.type).toBe("security-change");
  });

  it("parses --needs-action flag", () => {
    const filters = parseFilterArgs("--needs-action");
    expect(filters.needsActionOnly).toBe(true);
  });

  it("parses --stale flag", () => {
    const filters = parseFilterArgs("--stale");
    expect(filters.staleOnly).toBe(true);
  });

  it("parses multiple filters", () => {
    const filters = parseFilterArgs("--stage open --needs-action");
    expect(filters.stage).toBe("open");
    expect(filters.needsActionOnly).toBe(true);
  });

  it("returns empty filters for no args", () => {
    const filters = parseFilterArgs("");
    expect(filters).toEqual({});
  });
});

// ── renderPipelineDashboard ──────────────────────────────────

describe("renderPipelineDashboard", () => {
  it("shows empty message when no proposals", () => {
    const result = renderPipelineDashboard([]);
    expect(result).toContain("No proposals found");
  });

  it("renders proposals grouped by stage", () => {
    const proposals = [
      makeProposal({ id: 1, status: "open", title: "Open Proposal" }),
      makeProposal({ id: 2, status: "executed", title: "Done Proposal" }),
    ];

    const result = renderPipelineDashboard(proposals);
    expect(result).toContain("Open Proposal");
    expect(result).toContain("Done Proposal");
    expect(result).toContain("📝 Open");
    expect(result).toContain("🚀 Executed");
  });

  it("filters by stage", () => {
    const proposals = [
      makeProposal({ id: 1, status: "open", title: "Open One" }),
      makeProposal({ id: 2, status: "executed", title: "Done One" }),
    ];

    const result = renderPipelineDashboard(proposals, { stage: "open" });
    expect(result).toContain("Open One");
    expect(result).not.toContain("Done One");
  });

  it("filters by type", () => {
    const proposals = [
      makeProposal({ id: 1, type: "product-feature", title: "Feature" }),
      makeProposal({ id: 2, type: "security-change", title: "Security" }),
    ];

    const result = renderPipelineDashboard(proposals, { type: "security-change" });
    expect(result).toContain("Security");
    expect(result).not.toContain("Feature");
  });

  it("shows needs attention section for approved proposals", () => {
    const proposals = [
      makeProposal({ id: 1, status: "approved", title: "Needs Check" }),
    ];

    const result = renderPipelineDashboard(proposals);
    expect(result).toContain("Needs Your Attention");
    expect(result).toContain("Needs Check");
  });

  it("shows score indicator", () => {
    const proposals = [
      makeProposal({
        id: 1,
        status: "executed",
        title: "Scored Proposal",
        compositeScore: { weighted: 75, axes: {} as any, riskZone: "green", breakdown: "" },
      }),
    ];

    const result = renderPipelineDashboard(proposals);
    expect(result).toContain("75");
  });

  it("shows stale flag for old proposals", () => {
    const proposals = [
      makeProposal({
        id: 1,
        status: "open",
        title: "Old Proposal",
        createdAt: new Date(Date.now() - 48 * 3600000).toISOString(),
      }),
    ];

    const result = renderPipelineDashboard(proposals, {}, 24);
    expect(result).toContain("⏰");
  });

  it("shows summary count", () => {
    const proposals = [
      makeProposal({ id: 1, status: "open" }),
      makeProposal({ id: 2, status: "open" }),
      makeProposal({ id: 3, status: "executed" }),
    ];

    const result = renderPipelineDashboard(proposals);
    expect(result).toContain("3 proposals");
  });
});

// ── renderProposalCard ────────────────────────────────────────

describe("renderProposalCard", () => {
  it("renders single proposal card", () => {
    const p = makeProposal({
      id: 5,
      title: "My Test Proposal",
      status: "approved",
      type: "product-feature",
    });

    const result = renderProposalCard(p);
    expect(result).toContain("Proposal #5");
    expect(result).toContain("My Test Proposal");
    expect(result).toContain("Approved");
  });

  it("shows action hint for approved proposal", () => {
    const p = makeProposal({ id: 1, status: "approved" });
    const result = renderProposalCard(p);
    expect(result).toContain("Action needed");
    expect(result).toContain("dao_check");
  });

  it("shows score when available", () => {
    const p = makeProposal({
      id: 1,
      status: "executed",
      compositeScore: { weighted: 57, axes: {} as any, riskZone: "orange", breakdown: "" },
    });
    const result = renderProposalCard(p);
    expect(result).toContain("57");
  });
});
