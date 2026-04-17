// ============================================================
// pi-swarm-dao — XState v5 Proposal State Machine
// ============================================================
// Replaces homegrown FSM (states.ts + evaluate.ts) internally.
// Uses XState v5 setup() pattern with typed context, events,
// named guards, and assign() actions.
// ============================================================

import { setup, assign } from 'xstate';

// ── Types ────────────────────────────────────────────────────

export interface MachineContext {
  proposalId: number;
  quorumMet: boolean;
  gatesPassed: boolean;
  approvalScore: number;
}

export type MachineEvents =
  | { type: 'deliberate' }
  | { type: 'approve'; quorumMet: boolean; approvalScore?: number }
  | { type: 'reject'; quorumMet?: boolean; approvalScore?: number; hasVotes?: boolean }
  | { type: 'pass_gates'; gatesPassed?: boolean; quorumMet?: boolean }
  | { type: 'fail_gates' }
  | { type: 'execute'; gatesPassed: boolean }
  | { type: 'fail_execution' }
  | { type: 'retry' }
  | { type: 'abandon' };

export interface MachineInput {
  proposalId: number;
}

// ── Machine ──────────────────────────────────────────────────

export const proposalMachine = setup({
  types: {
    context: {} as MachineContext,
    events: {} as MachineEvents,
    input: {} as MachineInput,
  },
  guards: {
    quorumMet: ({ event }) =>
      (event as { quorumMet?: boolean }).quorumMet === true,

    gatesPassed: ({ event }) =>
      (event as { gatesPassed?: boolean }).gatesPassed === true,

    quorumMetForGates: ({ event }) =>
      (event as { quorumMet?: boolean }).quorumMet === true,

    hasVotes: ({ event }) =>
      (event as { hasVotes?: boolean }).hasVotes === true,
  },
  actions: {
    setQuorumMet: assign(({ event }) => ({
      quorumMet: (event as { quorumMet?: boolean }).quorumMet ?? false,
    })),

    setGatesPassed: assign(({ event }) => ({
      gatesPassed: (event as { gatesPassed?: boolean }).gatesPassed ?? false,
    })),

    setApprovalScore: assign(({ event }) => ({
      approvalScore: (event as { approvalScore?: number }).approvalScore ?? 0,
    })),
  },
}).createMachine({
  id: 'proposal',
  initial: 'open',
  context: ({ input }) => ({
    proposalId: input.proposalId,
    quorumMet: false,
    gatesPassed: false,
    approvalScore: 0,
  }),
  states: {
    open: {
      on: {
        deliberate: { target: 'deliberating' },
      },
    },

    deliberating: {
      on: {
        approve: {
          guard: 'quorumMet',
          target: 'approved',
          actions: ['setQuorumMet', 'setApprovalScore'],
        },
        reject: {
          guard: 'hasVotes',
          target: 'rejected',
        },
        pass_gates: {
          guard: 'quorumMetForGates',
          target: 'controlled',
          actions: ['setGatesPassed'],
        },
      },
    },

    approved: {
      on: {
        pass_gates: {
          guard: 'gatesPassed',
          target: 'controlled',
          actions: ['setGatesPassed'],
        },
        reject: {
          target: 'rejected',
        },
      },
    },

    controlled: {
      on: {
        execute: {
          guard: 'gatesPassed',
          target: 'executed',
        },
        fail_execution: {
          target: 'failed',
        },
      },
    },

    failed: {
      on: {
        retry: { target: 'controlled' },
        abandon: { target: 'rejected' },
      },
    },

    executed: {
      type: 'final',
    },

    rejected: {
      type: 'final',
    },
  },
});
