// ============================================================
// pi-swarm-dao — Type Definitions (V2 Governance)
// ============================================================

// ── Proposal Types ───────────────────────────────────────────

/** Typed proposal categories — each maps to a council and approval flow */
export type ProposalType =
  | "product-feature"
  | "security-change"
  | "technical-change"
  | "release-change"
  | "governance-change";

/** All valid proposal types */
export const PROPOSAL_TYPES: ProposalType[] = [
  "product-feature",
  "security-change",
  "technical-change",
  "release-change",
  "governance-change",
];

/** Human-readable labels for proposal types */
export const PROPOSAL_TYPE_LABELS: Record<ProposalType, string> = {
  "product-feature": "✨ Product Feature",
  "security-change": "🔒 Security Change",
  "technical-change": "⚙️ Technical Change",
  "release-change": "📦 Release Change",
  "governance-change": "📜 Governance Change",
};

/** Council responsible for each proposal type */
export type Council =
  | "product-council"
  | "security-council"
  | "delivery-council"
  | "governance-council"
  | "user-council";

/** Map proposal type → responsible council */
export const PROPOSAL_COUNCIL: Record<ProposalType, Council[]> = {
  "product-feature": ["product-council", "user-council"],
  "security-change": ["security-council"],
  "technical-change": ["product-council", "delivery-council", "user-council"],
  "release-change": ["delivery-council", "security-council", "user-council"],
  "governance-change": ["governance-council"],
};

// ── Risk Zones ───────────────────────────────────────────────

/** Risk zone classification — determines approval process */
export type RiskZone = "green" | "orange" | "red";

/** Risk zone definitions */
export const RISK_ZONE_LABELS: Record<RiskZone, string> = {
  green: "🟢 Green",
  orange: "🟠 Orange",
  red: "🔴 Red",
};

/** Risk zone criteria and process descriptions */
export const RISK_ZONE_DEFINITIONS: Record<RiskZone, {
  criteria: string;
  process: string;
  humanApprovals: number;
  requiresSecurityReview: boolean;
  requiresFormalVote: boolean;
}> = {
  green: {
    criteria: "Minor UI, docs, text, light instrumentation",
    process: "Agent auto-approval + async human review",
    humanApprovals: 1,
    requiresSecurityReview: false,
    requiresFormalVote: false,
  },
  orange: {
    criteria: "Non-trivial features, moderate refactors, limited new integrations",
    process: "Council review + QA checklist",
    humanApprovals: 2,
    requiresSecurityReview: false,
    requiresFormalVote: false,
  },
  red: {
    criteria: "New permissions, multi-site access, auth, sensitive storage, store publication",
    process: "Security Council + reinforced quorum + final human approval",
    humanApprovals: 2,
    requiresSecurityReview: true,
    requiresFormalVote: true,
  },
};

// ── Per-Type Quorum Configuration ───────────────────────────

/** Quorum settings per proposal type */
export interface TypeQuorumConfig {
  quorumPercent: number;
  approvalPercent: number;
  description: string;
}

export const TYPE_QUORUM: Record<ProposalType, TypeQuorumConfig> = {
  "governance-change": { quorumPercent: 70, approvalPercent: 66, description: "Governance / Policy" },
  "product-feature":   { quorumPercent: 60, approvalPercent: 55, description: "Product Roadmap" },
  "security-change":   { quorumPercent: 75, approvalPercent: 70, description: "Security-sensitive" },
  "technical-change":  { quorumPercent: 60, approvalPercent: 55, description: "Technical / Architecture" },
  "release-change":    { quorumPercent: 50, approvalPercent: 51, description: "Routine Release" },
};

// ── Pipeline Stages ──────────────────────────────────────────

/**
 * 10-stage pipeline:
 * intake → qualification → analysis → critique → scoring →
 * council → vote → spec → execution-gate → postmortem
 */
export type PipelineStage =
  | "intake"
  | "qualification"
  | "analysis"
  | "critique"
  | "scoring"
  | "council"
  | "vote"
  | "spec"
  | "execution-gate"
  | "postmortem";

export const PIPELINE_STAGES: PipelineStage[] = [
  "intake",
  "qualification",
  "analysis",
  "critique",
  "scoring",
  "council",
  "vote",
  "spec",
  "execution-gate",
  "postmortem",
];

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  intake: "📋 Intake",
  qualification: "🔍 Qualification",
  analysis: "🧪 Analysis",
  critique: "🔎 Critique",
  scoring: "📊 Scoring",
  council: "🏛️ Council",
  vote: "🗳️ Vote",
  spec: "📝 Spec",
  "execution-gate": "🛡️ Execution Gate",
  postmortem: "📖 Postmortem",
};

// ── Composite Scoring ────────────────────────────────────────

/** Individual axis scores (0-10) */
export interface AxisScore {
  userImpact: number;     // 30% — value for end user
  businessImpact: number; // 20% — adoption, retention, differentiation
  effort: number;         // 15% — build & maintenance complexity (inverted)
  securityRisk: number;   // 20% — permissions, data, attack surface (inverted)
  confidence: number;     // 15% — evidence quality, analysis coherence
}

/** Weights for each scoring axis */
export const SCORING_WEIGHTS: Record<keyof AxisScore, number> = {
  userImpact: 0.30,
  businessImpact: 0.20,
  effort: 0.15,
  securityRisk: 0.20,
  confidence: 0.15,
};

/** Composite score result */
export interface CompositeScore {
  axes: AxisScore;
  weighted: number;      // 0-100 final score
  riskZone: RiskZone;    // derived from score + permissions
  breakdown: string;     // human-readable formula
}

// ── Structured Proposal Content ──────────────────────────────

/** Mandatory structured fields for every proposal */
export interface ProposalContent {
  title: string;
  type: ProposalType;
  problemStatement: string;
  targetUser: string;
  expectedOutcome: string;
  successMetrics: string[];
  scopeIn: string[];
  scopeOut: string[];
  permissionsImpact: string[];
  dataImpact: string[];
  technicalOptions: string[];
  risks: string[];
  dependencies: string[];
  estimatedEffort: string;  // e.g. "2 weeks", "3-5 days"
  confidenceScore: number;  // 1-10
  recommendedDecision: string;
}

// ── Dry-Run & Rollback (Proposal #8) ────────────────────────

/** Snapshot of files/state before execution for rollback */
export interface ExecutionSnapshot {
  proposalId: number;
  timestamp: string;
  branch: string;
  commitSha: string;
  filesChanged: string[];
  stateSnapshot: string;  // JSON stringified DAOState
}

/** Result of a dry-run execution */
export interface DryRunResult {
  proposalId: number;
  preview: string;        // What would happen
  filesAffected: string[];
  risks: string[];
  estimatedDuration: string;
  canProceed: boolean;
}

// ── Outcome Tracking (Proposal #6) ───────────────────────────

/** Rating for a proposal outcome (post-execution) */
export interface OutcomeRating {
  proposalId: number;
  rater: string;           // who rated (human or agent id)
  score: 1 | 2 | 3 | 4 | 5;  // 1=failure, 5=exceeded expectations
  comment: string;
  ratedAt: string;
}

/** Before/after metric snapshot for outcome tracking */
export interface MetricSnapshot {
  name: string;
  before: string;
  after: string;
  unit?: string;
  capturedAt: string;
}

/** Full outcome record for a proposal */
export interface ProposalOutcome {
  proposalId: number;
  ratings: OutcomeRating[];
  metrics: MetricSnapshot[];
  overallScore: number;    // average of ratings, 0 if unrated
  status: "pending" | "tracked" | "reviewed";
  createdAt: string;
  updatedAt: string;
}

// ── Acceptance Criteria (Given/When/Then) ──────────────────────

/** A structured acceptance criterion in Given/When/Then format */
export interface AcceptanceCriterion {
  id: string;            // e.g. "AC-1"
  given: string;         // precondition
  when: string;          // action/trigger
  then: string;          // expected result
  met?: boolean;         // checked during control gate
  evidence?: string;     // how it was verified
}

// ── Proposal Status (backward compat with lifecycle) ─────────

export type ProposalStatus =
  | "open"
  | "deliberating"
  | "approved"
  | "controlled"
  | "rejected"
  | "executed"
  | "failed";

// ── Self-Amending Types ──────────────────────────────────────

/** What kind of amendment is being proposed */
export type AmendmentType =
  | "agent-update"
  | "agent-add"
  | "agent-remove"
  | "config-update"
  | "quorum-update"
  | "gate-update"
  | "council-update";

/** Who initiated the amendment */
export interface AmendmentOrigin {
  source: "human" | "agent";
  agentId?: string;
}

/** Lifecycle states for an amendment */
export type AmendmentState =
  | "pending-vote"
  | "approved-pending-human"
  | "approved"
  | "executed"
  | "rolled-back";

/** Payload for agent-update amendments */
export interface AgentUpdatePayload {
  type: "agent-update";
  agentId: string;
  changes: Partial<Omit<DAOAgent, "id">>;
}

/** Payload for agent-add amendments */
export interface AgentAddPayload {
  type: "agent-add";
  agent: Omit<DAOAgent, "systemPrompt"> & { systemPrompt?: string };
}

/** Payload for agent-remove amendments */
export interface AgentRemovePayload {
  type: "agent-remove";
  agentId: string;
}

/** Payload for config-update amendments */
export interface ConfigUpdatePayload {
  type: "config-update";
  changes: Partial<Omit<DAOConfig, "typeQuorum">>;
}

/** Payload for quorum-update amendments */
export interface QuorumUpdatePayload {
  type: "quorum-update";
  typeQuorum: Partial<Record<ProposalType, Partial<TypeQuorumConfig>>>;
}

/** Payload for gate-update amendments */
export interface GateUpdatePayload {
  type: "gate-update";
  addGates?: string[];
  removeGates?: string[];
}

/** Payload for council-update amendments */
export interface CouncilUpdatePayload {
  type: "council-update";
  agentId: string;
  councils: CouncilMembership[];
}

/** Discriminated union of all amendment payloads */
export type AmendmentPayload =
  | AgentUpdatePayload
  | AgentAddPayload
  | AgentRemovePayload
  | ConfigUpdatePayload
  | QuorumUpdatePayload
  | GateUpdatePayload
  | CouncilUpdatePayload;

/** Snapshot of state before amendment was applied (for rollback) */
export interface AmendmentSnapshot {
  agents: DAOAgent[];
  config: DAOConfig;
  capturedAt: string;
}

// ── Core Domain Types ────────────────────────────────────────

/** Agent risk classification */
export type AgentRiskLevel = "low" | "medium" | "high" | "critical";

/** Condition under which an agent should stop */
export interface StopCondition {
  type: "timeout" | "error" | "threshold" | "manual";
  description: string;
  value?: string;
}

/** Key Performance Indicator for an agent */
export interface AgentKPI {
  name: string;
  description: string;
  target: string;
}

/** Council membership for an agent */
export interface CouncilMembership {
  council: Council;
  role: "lead" | "member" | "advisor";
}

/** Configuration for a DAO agent */
export interface DAOAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  weight: number;
  systemPrompt: string;
  model?: string;
  tools?: string[];

  // Registry Fields
  owner?: string;
  mission?: string;
  authorizedInputs?: string[];
  authorizedData?: string[];
  riskLevel?: AgentRiskLevel;
  authorizedEnvironments?: string[];
  stopConditions?: StopCondition[];
  kpis?: AgentKPI[];
  lastReviewDate?: string;

  // Council memberships
  councils?: CouncilMembership[];
}

/** A proposal submitted to the DAO for deliberation */
export interface Proposal {
  id: number;
  title: string;
  type: ProposalType;
  description: string;         // Legacy: free-form description (now derived from problemStatement)
  context?: string;

  // Structured content (V2)
  content?: ProposalContent;

  // Acceptance Criteria (V2 — Proposal #10)
  acceptanceCriteria?: AcceptanceCriterion[];

  // Risk & Scoring
  riskZone?: RiskZone;
  compositeScore?: CompositeScore;

  // Pipeline
  stage: PipelineStage;

  proposedBy: string;
  status: ProposalStatus;
  votes: Vote[];
  agentOutputs: AgentOutput[];
  synthesis?: string;
  executionResult?: string;

  // Postmortem
  postmortem?: Postmortem;

  // Self-Amending
  amendmentPayload?: AmendmentPayload;
  amendmentOrigin?: AmendmentOrigin;
  amendmentState?: AmendmentState;
  preAmendmentSnapshot?: AmendmentSnapshot;

  createdAt: string;
  resolvedAt?: string;
}

/** Postmortem journal entry */
export interface Postmortem {
  outcome: "success" | "partial" | "failed";
  metrics: { name: string; expected: string; actual: string }[];
  learnings: string[];
  followUpActions: string[];
  recordedAt: string;
  recordedBy: string;
}

export type VotePosition = "for" | "against" | "abstain";

/** A vote cast by an agent */
export interface Vote {
  agentId: string;
  agentName: string;
  position: VotePosition;
  reasoning: string;
  weight: number;
}

/** Output from a single agent during deliberation */
export interface AgentOutput {
  agentId: string;
  agentName: string;
  role: string;
  content: string;
  vote?: Vote;
  durationMs: number;
  error?: string;
}

// ── Configuration ────────────────────────────────────────────

/** Per-type quorum overrides */
export type TypeQuorumMap = Partial<Record<ProposalType, TypeQuorumConfig>>;

/** DAO configuration */
export interface DAOConfig {
  quorumPercent: number;
  approvalThreshold: number;
  defaultModel: string;
  maxConcurrent: number;
  riskThreshold: number;
  requiredGates: string[];
  /** Per-type quorum overrides (falls back to quorumPercent/approvalThreshold if not set) */
  typeQuorum: TypeQuorumMap;
  /** Minimum quorum floor — governance-change can never go below this (default 60%) */
  quorumFloor: number;
  /** Hours before a proposal is flagged as stale in dashboard (default 24) */
  staleThresholdHours?: number;
}

// ── State ────────────────────────────────────────────────────

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
  artefacts: Record<number, DAOArtefacts>;
  // Outcome Tracking (Proposal #6)
  outcomes: Record<number, ProposalOutcome>;
  // Dry-Run & Rollback (Proposal #8)
  snapshots: Record<number, ExecutionSnapshot>;
}

/** Result of a vote tally */
export interface TallyResult {
  proposalId: number;
  approved: boolean;
  quorumMet: boolean;
  totalAgents: number;
  votingAgents: number;
  quorumPercent: number;
  weightedFor: number;
  weightedAgainst: number;
  totalVotingWeight: number;
  approvalScore: number;
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
// Control Layer
// ============================================================

export interface AuditEntry {
  id: number;
  timestamp: string;
  proposalId: number;
  layer: "governance" | "intelligence" | "delivery" | "control";
  action: string;
  actor: string;
  details: string;
  metadata?: Record<string, any>;
}

export interface GateResult {
  gateId: string;
  name: string;
  passed: boolean;
  severity: "blocker" | "warning" | "info";
  message: string;
  details?: Record<string, any>;
}

export interface ControlCheckResult {
  proposalId: number;
  timestamp: string;
  allGatesPassed: boolean;
  blockerCount: number;
  warningCount: number;
  gates: GateResult[];
  checklist: ChecklistItem[];
}

export interface ChecklistItem {
  id: string;
  category: "security" | "compliance" | "quality" | "operational";
  label: string;
  checked: boolean;
  autoChecked: boolean;
  details?: string;
}

// ============================================================
// Artefacts
// ============================================================

export interface DecisionBrief {
  proposalId: number;
  title: string;
  type: ProposalType;
  objective: string;
  summary: string;
  approvalScore: number;
  quorumPercent: number;
  decision: "approved" | "rejected";
  date: string;
  keyAgents: { name: string; position: VotePosition; weight: number }[];
}

export interface ADR {
  proposalId: number;
  adrId: string;
  title: string;
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  context: string;
  decision: string;
  options: { name: string; description: string; selected: boolean; pros: string[]; cons: string[] }[];
  consequences: string[];
  rejectedAlternatives: string[];
}

export interface RiskReport {
  proposalId: number;
  overallRiskScore: number;
  riskLevel: AgentRiskLevel;
  risks: { category: string; description: string; severity: "low" | "medium" | "high" | "critical"; likelihood: "low" | "medium" | "high"; mitigation: string }[];
  permissions: string[];
  dataSurfaces: string[];
  guardrails: string[];
}

export interface PRDLite {
  proposalId: number;
  objective: string;
  userStories: { id: string; title: string; asA: string; iWant: string; soThat: string; acceptanceCriteria: string[] }[];
  inScope: string[];
  outOfScope: string[];
  metrics: { name: string; baseline: string; target: string }[];
  openQuestions: string[];
}

export interface ImplementationPlan {
  proposalId: number;
  phases: { number: number; name: string; tasks: { id: string; title: string; effort: string; dependencies: string[] }[] }[];
  branchStrategy: string;
  estimatedDuration: string;
  criticalPath: string[];
}

export interface TestPlan {
  proposalId: number;
  unitTests: { target: string; description: string }[];
  integrationTests: { target: string; description: string }[];
  e2eTests: { scenario: string; steps: string }[];
  nonRegressionChecks: string[];
  testEnvironments: string[];
}

export interface ReleasePacket {
  proposalId: number;
  version: string;
  changelog: string;
  releaseNotes: string;
  preReleaseChecklist: { item: string; checked: boolean }[];
  rollbackPlan: string;
  storeNotes: string;
}

export interface DAOArtefacts {
  proposalId: number;
  generatedAt: string;
  decisionBrief: DecisionBrief;
  adr: ADR;
  riskReport: RiskReport;
  prdLite: PRDLite;
  implementationPlan: ImplementationPlan;
  testPlan: TestPlan;
  releasePacket: ReleasePacket;
}

// ============================================================
// Delivery Layer
// ============================================================

export interface DeliveryTask {
  id: string;
  title: string;
  description: string;
  effort: "xs" | "s" | "m" | "l" | "xl";
  phase: number;
  dependencies: string[];
  status: "pending" | "in_progress" | "done";
}

export interface DeliveryPhase {
  number: number;
  name: string;
  tasks: DeliveryTask[];
  duration: string;
}

export interface DeliveryPlan {
  proposalId: number;
  createdAt: string;
  phases: DeliveryPhase[];
  branchStrategy: string;
  rollbackPlan: string;
  estimatedDuration: string;
}

// ============================================================
// Defaults
// ============================================================

/** Default DAO configuration */
export const DEFAULT_CONFIG: DAOConfig = {
  quorumPercent: 60,
  approvalThreshold: 55,
  defaultModel: "z.ai/GLM-5.1",
  maxConcurrent: 4,
  riskThreshold: 7,
  requiredGates: ["quorum-quality", "risk-threshold", "vote-consensus", "zone-compliance"],
  typeQuorum: TYPE_QUORUM,
  quorumFloor: 60,
};

/** Create an empty initial state */
export function createInitialState(): DAOState {
  return {
    agents: [],
    proposals: [],
    config: { ...DEFAULT_CONFIG, typeQuorum: { ...TYPE_QUORUM } },
    nextProposalId: 1,
    initialized: false,
    auditLog: [],
    nextAuditId: 1,
    controlResults: {},
    deliveryPlans: {},
    artefacts: {},
    outcomes: {},
    snapshots: {},
  };
}
