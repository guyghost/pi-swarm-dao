import { describe, expect, it } from "vitest";
import type { Proposal } from "../../extensions/dao/types.ts";
import { createInitialState } from "../../extensions/dao/types.ts";
import { buildArtefactFileIndex } from "../../extensions/dao/delivery/artefacts.ts";
import {
  buildProposalBody,
  rebuildStateFromIssues,
  restoreProposalFromIssue,
  parseEventMetadata,
  rehydrateStateFromIssues,
} from "../../extensions/dao/github-persistence.ts";

const makeProposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  id: 7,
  title: "Canonical proposal",
  type: "technical-change",
  description: "Replace session-first persistence with GitHub-backed persistence.",
  context: "GitHub should be the canonical source of truth.",
  problemStatement: "Proposal state diverges between local memory and GitHub.",
  successMetrics: ["100% of proposals can be restored from GitHub issues"],
  rollbackConditions: ["Rollback if proposal restoration loses data"],
  acceptanceCriteria: [
    {
      id: "AC-1",
      given: "a DAO issue exists",
      when: "the extension restarts",
      then: "the proposal is restored from GitHub metadata",
    },
  ],
  stage: "intake",
  proposedBy: "user",
  status: "approved",
  riskZone: "orange",
  votes: [
    {
      agentId: "architect",
      agentName: "Solution Architect",
      position: "for",
      weight: 3,
      reasoning: "GitHub should be canonical.",
    },
  ],
  agentOutputs: [
    {
      agentId: "architect",
      agentName: "Solution Architect",
      role: "Architecture",
      content: "Use a machine-readable issue body.",
      durationMs: 1200,
    },
  ],
  synthesis: "Approved after consensus.",
  createdAt: "2026-04-18T10:00:00.000Z",
  ...overrides,
});

describe("github persistence canonical metadata", () => {
  it("embeds a machine-readable proposal snapshot in the issue body", () => {
    const proposal = makeProposal();

    const body = buildProposalBody(proposal);
    const restored = restoreProposalFromIssue({
      number: 7,
      title: "Proposal #7: Canonical proposal",
      body,
      createdAt: proposal.createdAt,
      labels: [
        { name: "dao-proposal" },
        { name: "dao-type:technical-change" },
        { name: "dao-status:approved" },
        { name: "dao-zone:orange" },
      ],
    });

    expect(body).toContain("<!-- dao:proposal:start -->");
    expect(restored?.id).toBe(7);
    expect(restored?.title).toBe("Canonical proposal");
    expect(restored?.votes).toHaveLength(1);
    expect(restored?.synthesis).toBe("Approved after consensus.");
  });

  it("treats the GitHub issue number and labels as canonical on restore", () => {
    const proposal = makeProposal({ id: 99, status: "open", type: "product-feature", riskZone: "green" });

    const restored = restoreProposalFromIssue({
      number: 42,
      title: "Proposal #42: Canonical proposal",
      body: buildProposalBody(proposal),
      createdAt: proposal.createdAt,
      labels: [
        { name: "dao-proposal" },
        { name: "dao-type:technical-change" },
        { name: "dao-status:approved" },
        { name: "dao-zone:red" },
      ],
    });

    expect(restored?.id).toBe(42);
    expect(restored?.type).toBe("technical-change");
    expect(restored?.status).toBe("approved");
    expect(restored?.riskZone).toBe("red");
  });

  it("rebuilds a sorted proposal list from GitHub issues", () => {
    const proposals = rebuildStateFromIssues([
      {
        number: 12,
        title: "Proposal #12: B",
        body: buildProposalBody(makeProposal({ id: 12, title: "B" })),
        labels: [{ name: "dao-proposal" }, { name: "dao-type:technical-change" }, { name: "dao-status:approved" }],
      },
      {
        number: 3,
        title: "Proposal #3: A",
        body: buildProposalBody(makeProposal({ id: 3, title: "A" })),
        labels: [{ name: "dao-proposal" }, { name: "dao-type:technical-change" }, { name: "dao-status:approved" }],
      },
    ]);

    expect(proposals.map((proposal) => proposal.id)).toEqual([3, 12]);
  });

  it("rehydrates control results, delivery plans, audit log, artefacts, verifications, outcomes, and snapshots from GitHub comments", () => {
    const proposal = makeProposal({ status: "controlled" });
    const body = buildProposalBody(proposal);
    const baseState = createInitialState();
    const planMarkdown = [
      "# Delivery Plan — Proposal #7",
      "",
      "## Phase 1: Foundation (1-2 days)",
      "",
      "| # | Task | Effort | Dependencies | Status |",
      "|---|------|--------|--------------|--------|",
      "| 1.1 | Implement canonical GitHub state | m | — | pending |",
      "",
      "## Branch Strategy",
      "feature/dao-github-canonical",
      "",
      "## Rollback Plan",
      "Revert the branch",
      "",
      "**Estimated Duration:** 1-2 days",
    ].join("\n");
    const auditEvent = JSON.stringify({
      version: 1,
      kind: "audit",
      proposalId: 7,
      timestamp: "2026-04-18T10:05:00.000Z",
      payload: { layer: "governance", action: "proposal_created", details: "Created from GitHub" },
    });
    const controlEvent = JSON.stringify({
      version: 1,
      kind: "control",
      proposalId: 7,
      timestamp: "2026-04-18T10:06:00.000Z",
      payload: {
        proposalId: 7,
        timestamp: "2026-04-18T10:06:00.000Z",
        allGatesPassed: true,
        blockerCount: 0,
        warningCount: 0,
        gates: [],
        checklist: [],
      },
    });
    const planEvent = JSON.stringify({
      version: 1,
      kind: "plan",
      proposalId: 7,
      timestamp: "2026-04-18T10:07:00.000Z",
      payload: { plan: planMarkdown },
    });
    const files = buildArtefactFileIndex(proposal, {
      rootDir: "/tmp/repo",
      repoName: "pi-swarm-dao",
      repoOwner: "guyghost",
      repoSlug: "guyghost/pi-swarm-dao",
      branch: "main",
      language: "TypeScript",
      framework: "Pi Extension",
      packageManager: "npm",
      isSelfRepo: true,
    });
    const artefactsEvent = JSON.stringify({
      version: 1,
      kind: "artefacts",
      proposalId: 7,
      timestamp: "2026-04-18T10:08:00.000Z",
      payload: { artefactCount: 7, files },
    });
    const verificationEvent = JSON.stringify({
      version: 1,
      kind: "verification",
      proposalId: 7,
      timestamp: "2026-04-18T10:09:00.000Z",
      payload: {
        proposalId: 7,
        status: "success",
        timestamp: "2026-04-18T10:09:00.000Z",
        filesChanged: ["extensions/dao/github-persistence.ts"],
        missingFiles: [],
        testsPassed: 268,
        testsFailed: 0,
        compilationOk: true,
        gitClean: false,
        summary: "✅ Verification: SUCCESS",
      },
    });
    const outcomeEvent = JSON.stringify({
      version: 1,
      kind: "outcome",
      proposalId: 7,
      timestamp: "2026-04-18T10:10:00.000Z",
      payload: {
        proposalId: 7,
        ratings: [
          {
            proposalId: 7,
            rater: "user",
            score: 4,
            comment: "GitHub-first worked well",
            ratedAt: "2026-04-18T10:10:00.000Z",
          },
        ],
        metrics: [
          {
            name: "restore_time",
            before: "n/a",
            after: "fast",
            capturedAt: "2026-04-18T10:10:00.000Z",
          },
        ],
        overallScore: 4,
        status: "tracked",
        createdAt: "2026-04-18T10:10:00.000Z",
        updatedAt: "2026-04-18T10:10:00.000Z",
      },
    });
    const snapshotEvent = JSON.stringify({
      version: 1,
      kind: "snapshot",
      proposalId: 7,
      timestamp: "2026-04-18T10:11:00.000Z",
      payload: {
        snapshot: {
          proposalId: 7,
          timestamp: "2026-04-18T10:11:00.000Z",
          branch: "main",
          commitSha: "abc123",
          filesChanged: [],
          stateSnapshot: "{}",
        },
        dryRun: {
          proposalId: 7,
          preview: "Preview",
          filesAffected: ["extensions/dao/github-persistence.ts"],
          risks: [],
          estimatedDuration: "1-5 minutes",
          canProceed: true,
        },
      },
    });

    const restored = rehydrateStateFromIssues([
      {
        number: 7,
        title: "Proposal #7: Canonical proposal",
        body,
        createdAt: proposal.createdAt,
        labels: [
          { name: "dao-proposal" },
          { name: "dao-type:technical-change" },
          { name: "dao-status:controlled" },
          { name: "dao-zone:orange" },
        ],
        comments: [
          {
            createdAt: "2026-04-18T10:05:00.000Z",
            body: `<!-- dao:event ${auditEvent} -->\n\nAudit entry`,
          },
          {
            createdAt: "2026-04-18T10:06:00.000Z",
            body: `<!-- dao:event ${controlEvent} -->\n\nControl result`,
          },
          {
            createdAt: "2026-04-18T10:07:00.000Z",
            body: `<!-- dao:event ${planEvent} -->\n\nPlan`,
          },
          {
            createdAt: "2026-04-18T10:08:00.000Z",
            body: `<!-- dao:event ${artefactsEvent} -->\n\nArtefacts generated`,
          },
          {
            createdAt: "2026-04-18T10:09:00.000Z",
            body: `<!-- dao:event ${verificationEvent} -->\n\nVerification complete`,
          },
          {
            createdAt: "2026-04-18T10:10:00.000Z",
            body: `<!-- dao:event ${outcomeEvent} -->\n\nOutcome tracked`,
          },
          {
            createdAt: "2026-04-18T10:11:00.000Z",
            body: `<!-- dao:event ${snapshotEvent} -->\n\nSnapshot captured`,
          },
        ],
      },
    ], baseState);

    expect(restored.controlResults[7]?.allGatesPassed).toBe(true);
    expect(restored.deliveryPlans[7]?.proposalId).toBe(7);
    expect(restored.auditLog).toHaveLength(1);
    expect(restored.auditLog[0]?.action).toBe("proposal_created");
    expect(restored.artefacts[7]?.proposalId).toBe(7);
    expect(restored.artefacts[7]?.decisionBrief.title).toBe("Canonical proposal");
    expect(restored.artefacts[7]?.files?.adr.path).toBe("docs/dao/adr/ADR-007-canonical-proposal.md");
    expect(restored.verifications[7]?.status).toBe("success");
    expect(restored.outcomes[7]?.overallScore).toBe(4);
    expect(restored.snapshots[7]?.commitSha).toBe("abc123");
  });

  it("builds deterministic repo paths for artefact files", () => {
    const files = buildArtefactFileIndex(makeProposal({ id: 12, title: "Hello World / GitHub First" }), {
      rootDir: "/tmp/repo",
      repoName: "demo",
      repoOwner: "acme",
      repoSlug: "acme/demo",
      branch: "main",
      language: "TypeScript",
      framework: "",
      packageManager: "npm",
      isSelfRepo: false,
    });

    expect(files.decisionBrief.path).toBe("docs/dao/decisions/012-hello-world-github-first.md");
    expect(files.releasePacket.url).toBe("https://github.com/acme/demo/blob/main/docs/dao/release-packets/012-hello-world-github-first.md");
  });

  it("parses structured DAO event metadata from comments", () => {
    const comment =
      '<!-- dao:event {"version":1,"kind":"audit","proposalId":7,"timestamp":"2026-04-18T10:00:00.000Z","payload":{"layer":"governance","action":"proposal_created","details":"Created from GitHub"}} -->\n\nAudit entry';

    const parsed = parseEventMetadata(comment);

    expect(parsed?.kind).toBe("audit");
    expect(parsed?.proposalId).toBe(7);
    expect(parsed?.payload).toEqual({
      layer: "governance",
      action: "proposal_created",
      details: "Created from GitHub",
    });
  });
});
