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
  | "controlled"
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
  riskThreshold: number; // Proposals with risk score >= this require extra review (default: 7)
  requiredGates: string[]; // Gate IDs that must pass before execution
}

/** Complete DAO state — persisted between sessions */
export interface DAOState {
  agents: DAOAgent[];
  proposals: Proposal[];
  config: DAOConfig;
  nextProposalId: number;
  initialized: boolean;
  auditLog: AuditEntry[];
  nextAuditId: number;
  controlResults: Record<number, ControlCheckResult>;
  deliveryPlans: Record<number, DeliveryPlan>;
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

// ============================================================
// Control Layer — Quality Gates, Audit Trail, Checklists
// ============================================================

/** Single entry in the immutable audit trail */
export interface AuditEntry {
  id: number;
  timestamp: string; // ISO 8601
  proposalId: number;
  layer: "governance" | "intelligence" | "delivery" | "control";
  action: string; // e.g. "proposal_created", "vote_cast", "gate_passed", "checklist_completed"
  actor: string; // agent ID or "system" or "user"
  details: string; // Human-readable description
  metadata?: Record<string, any>;
}

/** Result of a single quality gate evaluation */
export interface GateResult {
  gateId: string; // e.g. "risk-threshold", "quorum-quality", "security-review"
  name: string;
  passed: boolean;
  severity: "blocker" | "warning" | "info";
  message: string;
  details?: Record<string, any>;
}

/** Aggregate result of all control checks for a proposal */
export interface ControlCheckResult {
  proposalId: number;
  timestamp: string;
  allGatesPassed: boolean;
  blockerCount: number;
  warningCount: number;
  gates: GateResult[];
  checklist: ChecklistItem[];
}

/** A single checklist item in the control layer */
export interface ChecklistItem {
  id: string;
  category: "security" | "compliance" | "quality" | "operational";
  label: string;
  checked: boolean;
  autoChecked: boolean; // true if system verified, false if manual
  details?: string;
}

// ============================================================
// Delivery Layer — Execution Plans, Tasks, Phases
// ============================================================

/** A single task within a delivery phase */
export interface DeliveryTask {
  id: string;
  title: string;
  description: string;
  effort: "xs" | "s" | "m" | "l" | "xl";
  phase: number;
  dependencies: string[]; // task IDs
  status: "pending" | "in_progress" | "done";
}

/** A phase within a delivery plan */
export interface DeliveryPhase {
  number: number;
  name: string;
  tasks: DeliveryTask[];
  duration: string;
}

/** Full delivery plan for an approved proposal */
export interface DeliveryPlan {
  proposalId: number;
  createdAt: string;
  phases: DeliveryPhase[];
  branchStrategy: string;
  rollbackPlan: string;
  estimatedDuration: string;
}

/** Default DAO configuration */
export const DEFAULT_CONFIG: DAOConfig = {
  quorumPercent: 60,
  approvalThreshold: 51,
  defaultModel: "claude-sonnet-4-20250514",
  maxConcurrent: 4,
  riskThreshold: 7,
  requiredGates: ["quorum-quality", "risk-threshold", "vote-consensus"],
};

/** Create an empty initial state */
export function createInitialState(): DAOState {
  return {
    agents: [],
    proposals: [],
    config: { ...DEFAULT_CONFIG },
    nextProposalId: 1,
    initialized: false,
    auditLog: [],
    nextAuditId: 1,
    controlResults: {},
    deliveryPlans: {},
  };
}
