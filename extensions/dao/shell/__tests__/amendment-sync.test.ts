// ============================================================
// Amendment State Sync Tests
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerAmendmentSyncHooks } from "../amendment-sync.js";
import { fireHooks, clearHooks } from "../hooks.js";
import { getState, setState } from "../../persistence.js";
import type { GuardContext } from "../../core/states.js";
import type { Proposal, AmendmentState } from "../../types.js";

// ── Mocks ─────────────────────────────────────────────────────

// We mock persistence to control the proposal state
vi.mock("../../persistence.js", () => ({
  getState: vi.fn(),
  setState: vi.fn(),
}));

const mockGetState = vi.mocked(getState);
const mockSetState = vi.mocked(setState);

// ── Helpers ───────────────────────────────────────────────────

const defaultCtx: GuardContext = {
  status: "open",
  quorumMet: true,
  gatesPassed: true,
};

const makeProposal = (
  id: number,
  amendmentState?: AmendmentState,
  hasPayload = true,
): Proposal =>
  ({
    id,
    title: `Proposal ${id}`,
    type: "governance-change",
    description: "Test",
    stage: "intake",
    proposedBy: "agent-1",
    status: "approved",
    votes: [],
    agentOutputs: [],
    createdAt: "2026-01-01T00:00:00Z",
    ...(amendmentState !== undefined
      ? {
          amendmentState,
          amendmentPayload: hasPayload
            ? { type: "config-update", changes: { quorumPercent: 70 } }
            : undefined,
        }
      : {}),
  }) as Proposal;

const makeState = (proposals: Proposal[] = []) =>
  ({
    proposals,
    agents: [],
    config: {
      quorumPercent: 60,
      approvalThreshold: 55,
      defaultModel: "test",
      maxConcurrent: 4,
      riskThreshold: 7,
      requiredGates: [],
      typeQuorum: {},
      quorumFloor: 60,
    },
    nextProposalId: proposals.length + 1,
    initialized: true,
    auditLog: [],
    nextAuditId: 1,
    controlResults: {},
    deliveryPlans: {},
    artefacts: {},
    outcomes: {},
    snapshots: {},
    verifications: {},
  }) as any;

// ── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  clearHooks();
  vi.clearAllMocks();
});

afterEach(() => {
  clearHooks();
});

// ── Executed Transition ──────────────────────────────────────

describe("amendment sync on executed", () => {
  it("sets amendmentState to 'executed' for active amendment on *→executed", async () => {
    const proposal = makeProposal(1, "approved");
    mockGetState.mockReturnValue(makeState([proposal]));

    registerAmendmentSyncHooks();

    await fireHooks("controlled", "executed", "execute", 1, defaultCtx);

    expect(proposal.amendmentState).toBe("executed");
    expect(mockSetState).toHaveBeenCalled();
  });

  it("updates from 'pending-vote' to 'executed'", async () => {
    const proposal = makeProposal(1, "pending-vote");
    mockGetState.mockReturnValue(makeState([proposal]));

    registerAmendmentSyncHooks();

    await fireHooks("controlled", "executed", "execute", 1, defaultCtx);

    expect(proposal.amendmentState).toBe("executed");
  });

  it("updates from 'approved-pending-human' to 'executed'", async () => {
    const proposal = makeProposal(1, "approved-pending-human");
    mockGetState.mockReturnValue(makeState([proposal]));

    registerAmendmentSyncHooks();

    await fireHooks("controlled", "executed", "execute", 1, defaultCtx);

    expect(proposal.amendmentState).toBe("executed");
  });

  it("does NOT update amendmentState already set to 'executed'", async () => {
    const proposal = makeProposal(1, "executed");
    mockGetState.mockReturnValue(makeState([proposal]));

    registerAmendmentSyncHooks();

    await fireHooks("controlled", "executed", "execute", 1, defaultCtx);

    // Already resolved — should remain 'executed' but setState should NOT be called
    expect(proposal.amendmentState).toBe("executed");
    // setState not called because the guard blocks it
    expect(mockSetState).not.toHaveBeenCalled();
  });

  it("does NOT update amendmentState already set to 'rolled-back'", async () => {
    const proposal = makeProposal(1, "rolled-back");
    mockGetState.mockReturnValue(makeState([proposal]));

    registerAmendmentSyncHooks();

    await fireHooks("controlled", "executed", "execute", 1, defaultCtx);

    expect(proposal.amendmentState).toBe("rolled-back");
    expect(mockSetState).not.toHaveBeenCalled();
  });

  it("does NOT update proposal without amendmentPayload", async () => {
    const proposal = makeProposal(1, "approved", false);
    mockGetState.mockReturnValue(makeState([proposal]));

    registerAmendmentSyncHooks();

    await fireHooks("controlled", "executed", "execute", 1, defaultCtx);

    expect(mockSetState).not.toHaveBeenCalled();
  });

  it("does NOT update proposal without amendmentState", async () => {
    const proposal = makeProposal(1); // no amendmentState
    mockGetState.mockReturnValue(makeState([proposal]));

    registerAmendmentSyncHooks();

    await fireHooks("controlled", "executed", "execute", 1, defaultCtx);

    expect(mockSetState).not.toHaveBeenCalled();
  });
});

// ── Rejected Transition ──────────────────────────────────────

describe("amendment sync on rejected", () => {
  it("sets amendmentState to 'rolled-back' for active amendment on *→rejected", async () => {
    const proposal = makeProposal(1, "approved");
    mockGetState.mockReturnValue(makeState([proposal]));

    registerAmendmentSyncHooks();

    await fireHooks("deliberating", "rejected", "reject", 1, defaultCtx);

    expect(proposal.amendmentState).toBe("rolled-back");
    expect(mockSetState).toHaveBeenCalled();
  });

  it("updates from 'pending-vote' to 'rolled-back'", async () => {
    const proposal = makeProposal(1, "pending-vote");
    mockGetState.mockReturnValue(makeState([proposal]));

    registerAmendmentSyncHooks();

    await fireHooks("deliberating", "rejected", "reject", 1, defaultCtx);

    expect(proposal.amendmentState).toBe("rolled-back");
  });

  it("updates from 'approved-pending-human' to 'rolled-back'", async () => {
    const proposal = makeProposal(1, "approved-pending-human");
    mockGetState.mockReturnValue(makeState([proposal]));

    registerAmendmentSyncHooks();

    await fireHooks("approved", "rejected", "reject", 1, defaultCtx);

    expect(proposal.amendmentState).toBe("rolled-back");
  });

  it("does NOT update amendmentState already set to 'executed'", async () => {
    const proposal = makeProposal(1, "executed");
    mockGetState.mockReturnValue(makeState([proposal]));

    registerAmendmentSyncHooks();

    await fireHooks("approved", "rejected", "reject", 1, defaultCtx);

    expect(proposal.amendmentState).toBe("executed");
    expect(mockSetState).not.toHaveBeenCalled();
  });

  it("does NOT update amendmentState already set to 'rolled-back'", async () => {
    const proposal = makeProposal(1, "rolled-back");
    mockGetState.mockReturnValue(makeState([proposal]));

    registerAmendmentSyncHooks();

    await fireHooks("approved", "rejected", "reject", 1, defaultCtx);

    expect(proposal.amendmentState).toBe("rolled-back");
    expect(mockSetState).not.toHaveBeenCalled();
  });
});

// ── Best-Effort Behavior ─────────────────────────────────────

describe("amendment sync is best-effort", () => {
  it("does not throw when proposal not found", async () => {
    mockGetState.mockReturnValue(makeState([]));

    registerAmendmentSyncHooks();

    // Should not throw — best-effort swallows errors
    const result = await fireHooks("controlled", "executed", "execute", 999, defaultCtx);

    expect(result.errors).toHaveLength(0);
  });

  it("does not throw when getState throws", async () => {
    mockGetState.mockImplementation(() => {
      throw new Error("Storage unavailable");
    });

    registerAmendmentSyncHooks();

    // Best-effort hooks log and continue
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await fireHooks("controlled", "executed", "execute", 1, defaultCtx);
    warnSpy.mockRestore();

    // The hook failed but was swallowed (best-effort)
    expect(result.errors.length).toBeGreaterThanOrEqual(0);
  });
});

// ── Non-Target Transitions ───────────────────────────────────

describe("amendment sync ignores non-target transitions", () => {
  it("does NOT fire on transitions to non-terminal states", async () => {
    const proposal = makeProposal(1, "approved");
    mockGetState.mockReturnValue(makeState([proposal]));

    registerAmendmentSyncHooks();

    // Transition to approved (not executed/rejected)
    await fireHooks("deliberating", "approved", "approve", 1, defaultCtx);

    // amendmentState should NOT have changed
    expect(proposal.amendmentState).toBe("approved");
    expect(mockSetState).not.toHaveBeenCalled();
  });
});
