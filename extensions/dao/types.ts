// ============================================================
// pi-swarm-dao — Type Definitions
// ============================================================

/** Configuration for a DAO agent */
export interface DAOAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  weight: number; // Vote weight (1-10)
  systemPrompt: string;
  model?: string; // LLM model override
  tools?: string[]; // Allowed tools for this agent
}

/** A proposal submitted to the DAO for deliberation */
export interface Proposal {
  id: number;
  title: string;
  description: string;
  context?: string; // Additional context
  proposedBy: string; // Agent ID or "user"
  status: ProposalStatus;
  votes: Vote[];
  agentOutputs: AgentOutput[];
  synthesis?: string; // Facilitator synthesis document
  executionResult?: string;
  createdAt: string; // ISO 8601
  resolvedAt?: string; // ISO 8601
}

export type ProposalStatus =
  | "open"
  | "deliberating"
  | "approved"
  | "rejected"
  | "executed"
  | "failed";

/** A vote cast by an agent */
export interface Vote {
  agentId: string;
  agentName: string;
  position: VotePosition;
  reasoning: string;
  weight: number; // Agent's weight at time of vote
}

export type VotePosition = "for" | "against" | "abstain";

/** Output from a single agent during deliberation */
export interface AgentOutput {
  agentId: string;
  agentName: string;
  role: string;
  content: string; // Full markdown output
  vote?: Vote; // Parsed vote from output
  durationMs: number;
  error?: string; // If agent failed
}

/** DAO configuration */
export interface DAOConfig {
  quorumPercent: number; // Min participation % (default: 60)
  approvalThreshold: number; // Min weighted "for" % to approve (default: 51)
  defaultModel: string; // Default LLM model for sub-agents
  maxConcurrent: number; // Max parallel sub-agents (default: 4)
}

/** Complete DAO state — persisted between sessions */
export interface DAOState {
  agents: DAOAgent[];
  proposals: Proposal[];
  config: DAOConfig;
  nextProposalId: number;
  initialized: boolean;
}

/** Result of a vote tally */
export interface TallyResult {
  proposalId: number;
  approved: boolean;
  quorumMet: boolean;
  totalAgents: number;
  votingAgents: number; // Excluding abstentions
  quorumPercent: number; // Actual participation %
  weightedFor: number;
  weightedAgainst: number;
  totalVotingWeight: number;
  approvalScore: number; // weightedFor / totalVotingWeight (0-1)
  votes: Vote[];
}

/** Result of a full deliberation cycle */
export interface DeliberationResult {
  proposalId: number;
  proposal: Proposal;
  agentOutputs: AgentOutput[];
  synthesis: string;
  tally: TallyResult;
  status: "approved" | "rejected";
  durationMs: number;
}

/** Default DAO configuration */
export const DEFAULT_CONFIG: DAOConfig = {
  quorumPercent: 60,
  approvalThreshold: 51,
  defaultModel: "claude-sonnet-4-20250514",
  maxConcurrent: 4,
};

/** Create an empty initial state */
export function createInitialState(): DAOState {
  return {
    agents: [],
    proposals: [],
    config: { ...DEFAULT_CONFIG },
    nextProposalId: 1,
    initialized: false,
  };
}
