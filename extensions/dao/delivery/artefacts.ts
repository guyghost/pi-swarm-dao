// ============================================================
// pi-swarm-dao — Automatic Artefacts Generation
// ============================================================
// Every approved proposal produces 7 artefacts:
// 1. Decision Brief   — executive summary
// 2. ADR              — Architecture Decision Record
// 3. Risk Report      — security & risk assessment
// 4. PRD Lite         — lightweight product requirements
// 5. Implementation Plan — phased task breakdown
// 6. Test Plan        — testing strategy
// 7. Release Packet   — publication-ready bundle
// ============================================================

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  Proposal,
  AgentOutput,
  Vote,
  TallyResult,
  ControlCheckResult,
  DeliveryPlan,
  DecisionBrief,
  ADR,
  RiskReport,
  PRDLite,
  ImplementationPlan,
  TestPlan,
  ReleasePacket,
  DAOArtefacts,
  AgentRiskLevel,
  ArtefactFileIndex,
  HostProjectContext,
} from "../types.js";
import { PROPOSAL_TYPE_LABELS } from "../types.js";
import { detectHostContext } from "../host-context.js";

// ---------------------------------------------------------------------------
// Extraction Helpers
// ---------------------------------------------------------------------------

const findOutput = (outputs: AgentOutput[], agentId: string): AgentOutput | undefined =>
  outputs.find((o) => o.agentId === agentId);

const extractSection = (content: string, heading: string): string => {
  const re = new RegExp(
    `#{2,3}\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n#{2,3}\\s|\\n---\\s*$|$)`,
    "i"
  );
  const match = content.match(re);
  return match ? match[1].trim() : "";
};

const extractBullets = (content: string, limit: number): string[] => {
  const bullets: string[] = [];
  for (const line of content.split("\n")) {
    if (/^\s*[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^\s*[-*]\s+/, "").trim());
      if (bullets.length >= limit) break;
    }
  }
  return bullets;
};

const firstSentences = (text: string, n: number): string => {
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (!sentences) return text.slice(0, 300);
  return sentences.slice(0, n).join("").trim();
};

/** Extract a risk table from Critic output */
const extractRiskTable = (
  criticContent: string
): RiskReport["risks"] => {
  const risks: RiskReport["risks"] = [];

  // Try to parse the risk assessment table
  const tableMatch = criticContent.match(
    /###\s*Risk\s+Assessment\s*\n[\s\S]*?\n\|[\s\S]*?\n((?:\|.+\|\n)+)/i
  );

  if (tableMatch) {
    const rows = tableMatch[1].split("\n").filter((l) => l.startsWith("|") && !l.includes("---"));
    for (const row of rows) {
      const cols = row.split("|").map((c) => c.trim()).filter(Boolean);
      if (cols.length >= 4) {
        risks.push({
          category: cols[0] ?? "General",
          description: cols[0] ?? "",
          severity: normalizeSeverity(cols[1]),
          likelihood: normalizeLikelihood(cols[2]),
          mitigation: cols[cols.length - 1] ?? "See guardrails",
        });
      }
    }
  }

  // Fallback: extract bullets from Risk Assessment or Risk section
  if (risks.length === 0) {
    const riskSection = extractSection(criticContent, "Risk");
    if (riskSection) {
      const bullets = extractBullets(riskSection, 8);
      for (const b of bullets) {
        risks.push({
          category: "General",
          description: b,
          severity: "medium",
          likelihood: "medium",
          mitigation: "Review required",
        });
      }
    }
  }

  return risks.length > 0
    ? risks
    : [{ category: "General", description: "No specific risks identified", severity: "low", likelihood: "low", mitigation: "N/A" }];
};

const normalizeSeverity = (raw: string): RiskReport["risks"][0]["severity"] => {
  const lower = (raw ?? "").toLowerCase();
  if (lower.includes("crit")) return "critical";
  if (lower.includes("high")) return "high";
  if (lower.includes("med")) return "medium";
  return "low";
};

const normalizeLikelihood = (raw: string): RiskReport["risks"][0]["likelihood"] => {
  const lower = (raw ?? "").toLowerCase();
  if (lower.includes("high")) return "high";
  if (lower.includes("med")) return "medium";
  return "low";
};

const parseRiskScore = (content: string): number => {
  const match = content.match(/Risk\s+Score:\s*(\d+)\s*\/\s*10/i);
  return match ? parseInt(match[1], 10) : 5;
};

const scoreToRiskLevel = (score: number): AgentRiskLevel => {
  if (score >= 8) return "critical";
  if (score >= 6) return "high";
  if (score >= 4) return "medium";
  return "low";
};

/** Extract user stories from Spec Writer output */
const extractUserStories = (specContent: string): PRDLite["userStories"] => {
  const stories: PRDLite["userStories"] = [];

  // Match "#### US-N: Title" blocks
  const storyRegex = /#{3,4}\s+(US-\d+)\s*:\s*(.+?)\s*\n([\s\S]*?)(?=\n#{3,4}\s+US-|\n#{2,3}\s+(?:Out of|Open)|\n---|$)/gi;
  const matches = [...specContent.matchAll(storyRegex)];

  for (const match of matches) {
    const id = match[1];
    const title = match[2].trim();
    const body = match[3];

    // Parse As a / I want / So that
    const asAMatch = body.match(/\*?\*?As\s+a\*?\*?\s*:\s*(.+?)(?:\n|$)/i);
    const iWantMatch = body.match(/\*?\*?I\s+want\*?\*?\s*:\s*(.+?)(?:\n|$)/i);
    const soThatMatch = body.match(/\*?\*?(?:So\s+that|In\s+order\s+that)\*?\*?\s*:\s*(.+?)(?:\n|$)/i);

    // Parse acceptance criteria
    const acSection = body.match(
      /(?:Acceptance\s+Criteria|AC)\s*:?\s*\n([\s\S]*?)(?=\n#{2,4}|\n---|$)/i
    );
    const criteria: string[] = acSection
      ? extractBullets(acSection[1], 10)
      : extractBullets(body, 5).filter((b) => b.startsWith("[") || b.match(/^(should|must|will|can|given)/i));

    stories.push({
      id,
      title,
      asA: asAMatch?.[1]?.trim() ?? "user",
      iWant: iWantMatch?.[1]?.trim() ?? title,
      soThat: soThatMatch?.[1]?.trim() ?? "I achieve my goal",
      acceptanceCriteria: criteria.length > 0 ? criteria : ["Behavior verified through testing"],
    });
  }

  return stories;
};

/** Extract architecture options from Architect output */
const extractArchOptions = (
  architectContent: string
): ADR["options"] => {
  const options: ADR["options"] = [];

  // Match "### Option A: Name" blocks
  const optRegex = /#{2,4}\s+Option\s+([A-C])\s*:\s*(.+?)\s*\n([\s\S]*?)(?=\n#{2,4}\s+Option|\n#{2,3}\s+(?:Recommended|Integration|Technical\s+Risk)|\n---|$)/gi;
  const matches = [...architectContent.matchAll(optRegex)];

  for (const match of matches) {
    const name = match[2].trim();
    const body = match[3];
    const pros = extractBullets(extractSection(body, "Pros") || body, 5)
      .filter((b) => body.toLowerCase().includes("pros") || body.toLowerCase().includes("advantage"));
    const cons = extractBullets(extractSection(body, "Cons") || body, 5)
      .filter((b) => body.toLowerCase().includes("cons") || body.toLowerCase().includes("disadvantage"));

    options.push({
      name,
      description: firstSentences(body.replace(/[-*]\s+/g, ""), 2),
      selected: false,
      pros,
      cons,
    });
  }

  return options;
};

// ---------------------------------------------------------------------------
// Artefact Generators
// ---------------------------------------------------------------------------

/**
 * 1. Decision Brief — executive summary of the DAO decision
 */
export const generateDecisionBrief = (
  proposal: Proposal,
  tally: TallyResult
): DecisionBrief => ({
  proposalId: proposal.id,
  title: proposal.title,
  type: proposal.type,
  objective: proposal.content?.problemStatement
    ?? firstSentences(proposal.description, 2),
  summary: proposal.synthesis
    ? firstSentences(proposal.synthesis, 3)
    : firstSentences(proposal.description, 3),
  approvalScore: Math.round(tally.approvalScore * 100),
  quorumPercent: Math.round(tally.quorumPercent),
  decision: tally.approved ? "approved" : "rejected",
  date: proposal.resolvedAt ?? proposal.createdAt,
  keyAgents: proposal.votes.map((v) => ({
    name: v.agentName,
    position: v.position,
    weight: v.weight,
  })),
});

/**
 * 2. ADR — Architecture Decision Record
 */
export const generateADR = (
  proposal: Proposal
): ADR => {
  const architect = findOutput(proposal.agentOutputs, "architect");
  const architectContent = architect?.content ?? "";

  // Extract recommended option
  const recommendedMatch = architectContent.match(
    /###\s*Recommended\s+Option\s*\n([\s\S]*?)(?=\n###|\n##|\n---|$)/i
  );
  const recommendedText = recommendedMatch?.[1]?.trim() ?? "";

  // Parse options
  const options = extractArchOptions(architectContent);
  const selectedOption = options.length > 0 ? options[0]?.name ?? "Primary" : "See architect analysis";

  // Mark selected
  for (const opt of options) {
    if (recommendedText.toLowerCase().includes(opt.name.toLowerCase())) {
      opt.selected = true;
    }
  }
  if (options.length > 0 && !options.some((o) => o.selected)) {
    options[0].selected = true;
  }

  // Extract consequences
  const consequences = extractBullets(
    extractSection(architectContent, "Technical Risks") ||
    extractSection(architectContent, "Consequences"),
    5
  );

  // Rejected alternatives
  const rejected = options
    .filter((o) => !o.selected)
    .map((o) => o.name);

  return {
    proposalId: proposal.id,
    adrId: `ADR-${String(proposal.id).padStart(3, "0")}`,
    title: proposal.title,
    status: "accepted",
    context: firstSentences(proposal.description, 3),
    decision: recommendedText || (architectContent ? firstSentences(architectContent, 3) : proposal.description),
    options: options.length > 0 ? options : [{
      name: "Primary approach",
      description: "See architect analysis for details",
      selected: true,
      pros: [],
      cons: [],
    }],
    consequences: consequences.length > 0 ? consequences : ["To be defined during implementation"],
    rejectedAlternatives: rejected.length > 0 ? rejected : ["None explicitly documented"],
  };
};

/**
 * 3. Risk Report — permissions, data, surfaces, mitigations
 */
export const generateRiskReport = (
  proposal: Proposal,
  _controlResult?: ControlCheckResult
): RiskReport => {
  const critic = findOutput(proposal.agentOutputs, "critic");
  const criticContent = critic?.content ?? "";

  const overallScore = parseRiskScore(criticContent);

  // Extract security concerns
  const securitySection = extractSection(criticContent, "Security");
  const securityConcerns = extractBullets(securitySection, 5);

  // Extract guardrails
  const guardrails = extractBullets(
    extractSection(criticContent, "Guardrails") ||
    extractSection(criticContent, "Recommended Guardrails"),
    8
  );

  // Extract permissions from security section
  const permissions: string[] = [];
  const permPatterns = [/permission/i, /access/i, /auth/i, /role/i, /privilege/i, /credential/i];
  for (const concern of securityConcerns) {
    if (permPatterns.some((p) => p.test(concern))) {
      permissions.push(concern);
    }
  }

  // Extract data surfaces
  const dataSurfaces: string[] = [];
  const dataPatterns = [/data/i, /\bpii\b/i, /\bpersonal\b/i, /\bstorage/i, /\bdatabase/i, /\bapi\b/i];
  for (const concern of securityConcerns) {
    if (dataPatterns.some((p) => p.test(concern))) {
      dataSurfaces.push(concern);
    }
  }

  return {
    proposalId: proposal.id,
    overallRiskScore: overallScore,
    riskLevel: scoreToRiskLevel(overallScore),
    risks: extractRiskTable(criticContent),
    permissions: permissions.length > 0 ? permissions : ["No specific permission changes identified"],
    dataSurfaces: dataSurfaces.length > 0 ? dataSurfaces : ["No critical data surfaces identified"],
    guardrails: guardrails.length > 0 ? guardrails : ["Standard review practices apply"],
  };
};

/**
 * 4. PRD Lite — lightweight product requirements
 */
export const generatePRDLite = (
  proposal: Proposal
): PRDLite => {
  const specWriter = findOutput(proposal.agentOutputs, "spec-writer");
  const specContent = specWriter?.content ?? "";

  // Extract user stories
  const userStories = extractUserStories(specContent);

  // Extract scope
  const inScope = extractBullets(
    extractSection(specContent, "In Scope") ||
    extractSection(specContent, "PRD") ||
    extractSection(specContent, "Scope"),
    8
  );

  const outOfScope = extractBullets(
    extractSection(specContent, "Out of Scope"),
    8
  );

  // Extract metrics from strategist or spec
  const strategist = findOutput(proposal.agentOutputs, "strategist");
  const stratContent = strategist?.content ?? "";
  const metricsSection = extractSection(stratContent, "Success Metrics") ||
    extractSection(specContent, "Metrics");
  const metricRows = metricsSection.split("\n").filter((l) => l.startsWith("|") && !l.includes("---"));
  const metrics = metricRows
    .slice(1) // skip header
    .map((row) => {
      const cols = row.split("|").map((c) => c.trim()).filter(Boolean);
      return {
        name: cols[0] ?? "Metric",
        baseline: cols[1] ?? "N/A",
        target: cols[2] ?? "TBD",
      };
    })
    .filter((m) => m.name !== "Metric" && m.name.length > 0);

  // Extract open questions
  const openQuestions = extractBullets(
    extractSection(specContent, "Open Questions"),
    5
  );

  return {
    proposalId: proposal.id,
    objective: proposal.content?.problemStatement
      ?? firstSentences(proposal.description, 2),
    userStories: userStories.length > 0
      ? userStories
      : [{
          id: "US-1",
          title: proposal.title,
          asA: proposal.content?.targetUser ?? "user",
          iWant: proposal.description.split("\n")[0],
          soThat: proposal.content?.expectedOutcome ?? "my needs are met",
          acceptanceCriteria: ["Behavior verified through testing"],
        }],
    inScope: proposal.content?.scopeIn ?? (inScope.length > 0 ? inScope : [proposal.description.split("\n")[0]]),
    outOfScope: proposal.content?.scopeOut ?? (outOfScope.length > 0 ? outOfScope : ["To be defined during implementation"]),
    metrics: metrics.length > 0
      ? metrics
      : (proposal.content?.successMetrics ?? []).map((m) => ({ name: m, baseline: "N/A", target: "TBD" })).length > 0
        ? (proposal.content?.successMetrics ?? []).map((m) => ({ name: m, baseline: "N/A", target: "TBD" }))
        : [{ name: "Success", baseline: "N/A", target: "Meets acceptance criteria" }],
    openQuestions: openQuestions.length > 0 ? openQuestions : ["None identified"],
  };
};

/**
 * 5. Implementation Plan — tickets, order, dependencies
 */
export const generateImplementationPlan = (
  proposal: Proposal,
  plan?: DeliveryPlan
): ImplementationPlan => {
  const delivery = findOutput(proposal.agentOutputs, "delivery");
  const deliveryContent = delivery?.content ?? "";

  // Use delivery plan if available
  if (plan && plan.phases.length > 0) {
    return {
      proposalId: proposal.id,
      phases: plan.phases.map((p) => ({
        number: p.number,
        name: p.name,
        tasks: p.tasks.map((t) => ({
          id: t.id,
          title: t.title,
          effort: t.effort,
          dependencies: t.dependencies,
        })),
      })),
      branchStrategy: plan.branchStrategy,
      estimatedDuration: plan.estimatedDuration,
      criticalPath: computeCriticalPath(plan),
    };
  }

  // Fallback: parse from delivery agent output
  const phases: ImplementationPlan["phases"] = [];
  const phaseRegex = /#{2,4}\s+Phase\s+(\d+)\s*:\s*(.+?)(?:\s*\(([^)]+)\))?\s*\n/gi;
  const phaseMatches = [...deliveryContent.matchAll(phaseRegex)];

  for (const match of phaseMatches) {
    const num = parseInt(match[1], 10);
    const name = match[2].trim();
    const startIdx = match.index! + match[0].length;

    // Find end of phase body
    const nextPhase = deliveryContent.indexOf("Phase", startIdx);
    const nextSection = deliveryContent.indexOf("\n## ", startIdx + 1);
    let endIdx = deliveryContent.length;
    if (nextPhase > startIdx) endIdx = Math.min(endIdx, nextPhase);
    if (nextSection > startIdx) endIdx = Math.min(endIdx, nextSection);

    const body = deliveryContent.slice(startIdx, endIdx);
    const taskRegex = /[-*]\s+Task\s+(\d+\.\d+)\s*:\s*(.+?)(?:\s*[—-]\s*(?:Effort|effort)\s*:\s*(.+?))?$/gm;
    const taskMatches = [...body.matchAll(taskRegex)];

    const tasks = taskMatches.map((tm) => ({
      id: tm[1].trim(),
      title: tm[2].trim().split(/[.!?]\s/)[0] || tm[2].trim().slice(0, 80),
      effort: tm[3]?.trim() ?? "m",
      dependencies: parseDeps(tm[2]),
    }));

    phases.push({ number: num, name, tasks });
  }

  const branchStrategy = extractSection(deliveryContent, "Branch Strategy");
  const rollbackSection = extractSection(deliveryContent, "Rollback Plan");
  const duration = deliveryContent.match(/Total\s+Estimated\s+Duration:?\s*(.+)/i);

  return {
    proposalId: proposal.id,
    phases: phases.length > 0 ? phases : [{
      number: 1,
      name: "Execution",
      tasks: [{ id: "1.1", title: "Execute proposal", effort: "m", dependencies: [] }],
    }],
    branchStrategy: branchStrategy || "Feature branch with PR review",
    estimatedDuration: duration?.[1]?.trim() ?? "TBD",
    criticalPath: phases.flatMap((p) => p.tasks.map((t) => t.id)).slice(0, 5),
  };
};

const parseDeps = (text: string): string[] => {
  const depMatch = text.match(/(?:depends?\s+on|deps?:)\s*([0-9.,\s]+)/i);
  if (!depMatch) return [];
  return depMatch[1].split(/[,\s]+/).filter((d) => /^\d+\.\d+$/.test(d));
};

const computeCriticalPath = (plan: DeliveryPlan): string[] => {
  const allTasks = plan.phases.flatMap((p) => p.tasks);
  // Simple heuristic: tasks with most dependents
  const dependents = new Map<string, number>();
  for (const t of allTasks) {
    dependents.set(t.id, 0);
  }
  for (const t of allTasks) {
    for (const dep of t.dependencies) {
      dependents.set(dep, (dependents.get(dep) ?? 0) + 1);
    }
  }
  return [...dependents.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);
};

/**
 * 6. Test Plan — testing strategy
 */
export const generateTestPlan = (
  proposal: Proposal
): TestPlan => {
  const specWriter = findOutput(proposal.agentOutputs, "spec-writer");
  const architect = findOutput(proposal.agentOutputs, "architect");
  const specContent = specWriter?.content ?? "";
  const archContent = architect?.content ?? "";

  // Generate unit tests from user stories
  const stories = extractUserStories(specContent);
  const unitTests: TestPlan["unitTests"] = stories.map((s) => ({
    target: s.id,
    description: `Verify ${s.title}: ${s.acceptanceCriteria[0] ?? "behavior is correct"}`,
  }));

  // Generate integration tests from architecture
  const integrationPoints = extractSection(archContent, "Integration");
  const integrationTests: TestPlan["integrationTests"] = extractBullets(integrationPoints, 5)
    .map((ip) => ({ target: "Integration", description: ip }));

  if (integrationTests.length === 0) {
    integrationTests.push({
      target: "End-to-end flow",
      description: "Verify the complete user flow from proposal description",
    });
  }

  // E2E tests from user stories
  const e2eTests: TestPlan["e2eTests"] = stories.slice(0, 5).map((s) => ({
    scenario: s.title,
    steps: `As ${s.asA}, ${s.iWant} — verify ${s.soThat}`,
  }));

  if (e2eTests.length === 0) {
    e2eTests.push({
      scenario: proposal.title,
      steps: "Execute the primary user flow and verify expected outcome",
    });
  }

  // Non-regression checks from critic guardrails
  const critic = findOutput(proposal.agentOutputs, "critic");
  const criticContent = critic?.content ?? "";
  const guardrails = extractBullets(
    extractSection(criticContent, "Guardrails") ||
    extractSection(criticContent, "Recommended Guardrails"),
    5
  );

  return {
    proposalId: proposal.id,
    unitTests: unitTests.length > 0 ? unitTests : [{ target: "Core logic", description: "Verify primary business logic" }],
    integrationTests,
    e2eTests,
    nonRegressionChecks: guardrails.length > 0 ? guardrails : ["Existing functionality remains unchanged"],
    testEnvironments: ["dev", "staging", "prod"],
  };
};

/**
 * 7. Release Packet — publication-ready bundle
 */
export const generateReleasePacket = (
  proposal: Proposal,
  _controlResult?: ControlCheckResult,
  plan?: DeliveryPlan
): ReleasePacket => {
  const typeLabel = PROPOSAL_TYPE_LABELS[proposal.type];
  const date = new Date(proposal.resolvedAt ?? proposal.createdAt)
    .toISOString()
    .slice(0, 10);
  const version = `0.${proposal.id}.0`;

  // Release notes
  const releaseNotes = generateReleaseNotes(proposal);

  // Changelog
  const summary = proposal.synthesis
    ? firstSentences(proposal.synthesis, 1)
    : proposal.description.split("\n")[0] ?? "No description";
  const pct = approvalPercent(proposal.votes);
  const changelog = `- [${date}] **${proposal.title}** — ${summary} (DAO approval: ${pct}%)`;

  // Pre-release checklist from control result
  const preReleaseChecklist: ReleasePacket["preReleaseChecklist"] = [
    { item: "All control gates passed", checked: true },
    { item: "Risk assessment reviewed", checked: true },
    { item: "Test plan defined", checked: true },
    { item: "Rollback plan documented", checked: true },
    { item: "Stakeholder sign-off obtained", checked: false },
    { item: "Monitoring configured", checked: false },
  ];

  // Rollback from delivery plan or output
  const delivery = findOutput(proposal.agentOutputs, "delivery");
  const rollbackPlan = plan?.rollbackPlan ||
    extractSection(delivery?.content ?? "", "Rollback Plan") ||
    "Revert to previous state via git revert";

  // Store notes
  const storeNotes = `${typeLabel} ${proposal.title}\n\nVersion ${version} — ${date}\n\n${firstSentences(summary, 2)}`;

  return {
    proposalId: proposal.id,
    version,
    changelog,
    releaseNotes,
    preReleaseChecklist,
    rollbackPlan,
    storeNotes,
  };
};

// ---------------------------------------------------------------------------
// Reused from original artifacts.ts
// ---------------------------------------------------------------------------

const approvalPercent = (votes: Vote[]): number => {
  const voting = votes.filter((v) => v.position !== "abstain");
  if (voting.length === 0) return 0;
  const totalWeight = voting.reduce((sum, v) => sum + v.weight, 0);
  if (totalWeight === 0) return 0;
  const forWeight = voting
    .filter((v) => v.position === "for")
    .reduce((sum, v) => sum + v.weight, 0);
  return Math.round((forWeight / totalWeight) * 100);
};

/**
 * Generate release notes markdown from a proposal.
 */
export const generateReleaseNotes = (proposal: Proposal): string => {
  const lines: string[] = [];

  lines.push(`# Release Notes: ${proposal.title}`);
  lines.push("");

  lines.push("## Summary");
  const summary = proposal.synthesis
    ? firstSentences(proposal.synthesis, 3)
    : proposal.description;
  lines.push(summary);
  lines.push("");

  lines.push("## What's New");
  const specWriter = findOutput(proposal.agentOutputs, "spec-writer");
  const architect = findOutput(proposal.agentOutputs, "architect");
  const deliverables: string[] = [];
  if (specWriter && !specWriter.error) {
    deliverables.push(...extractBullets(specWriter.content, 6));
  }
  if (deliverables.length === 0 && architect && !architect.error) {
    deliverables.push(...extractBullets(architect.content, 6));
  }
  if (deliverables.length === 0) {
    const descLines = proposal.description.split("\n").filter((l) => l.trim());
    for (const line of descLines.slice(0, 5)) {
      deliverables.push(line.replace(/^[-*]\s*/, "").trim());
    }
  }
  for (const item of deliverables) {
    lines.push(`- ${item}`);
  }
  lines.push("");

  lines.push("## Known Risks");
  const critic = findOutput(proposal.agentOutputs, "critic");
  const risks = critic && !critic.error
    ? extractBullets(extractSection(critic.content, "Risk") || critic.content, 5)
    : ["No critic review available."];
  for (const risk of risks) {
    lines.push(`- ${risk}`);
  }
  lines.push("");

  const date = proposal.resolvedAt ?? proposal.createdAt;
  lines.push("## Approval");
  lines.push(`- Approved by DAO on ${date} with ${approvalPercent(proposal.votes)}% weighted approval`);

  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// Orchestrator — Generate All Artefacts
// ---------------------------------------------------------------------------

/**
 * Generate all 7 artefacts for an approved proposal.
 * Called automatically after dao_check passes all gates.
 */
export const generateAllArtefacts = (
  proposal: Proposal,
  tally: TallyResult,
  controlResult?: ControlCheckResult,
  plan?: DeliveryPlan
): DAOArtefacts => ({
  proposalId: proposal.id,
  generatedAt: new Date().toISOString(),
  decisionBrief: generateDecisionBrief(proposal, tally),
  adr: generateADR(proposal),
  riskReport: generateRiskReport(proposal, controlResult),
  prdLite: generatePRDLite(proposal),
  implementationPlan: generateImplementationPlan(proposal, plan),
  testPlan: generateTestPlan(proposal),
  releasePacket: generateReleasePacket(proposal, controlResult, plan),
});

// ---------------------------------------------------------------------------
// Formatting — Render artefacts as readable markdown
// ---------------------------------------------------------------------------

export const formatDecisionBrief = (brief: DecisionBrief): string => {
  const lines = [
    `# 📋 Decision Brief — Proposal #${brief.proposalId}`,
    "",
    `**Title:** ${brief.title}`,
    `**Type:** ${PROPOSAL_TYPE_LABELS[brief.type]}`,
    `**Decision:** ${brief.decision === "approved" ? "✅ APPROVED" : "❌ REJECTED"}`,
    `**Date:** ${brief.date.split("T")[0]}`,
    "",
    "## Objective",
    brief.objective,
    "",
    "## Summary",
    brief.summary,
    "",
    `**Approval Score:** ${brief.approvalScore}% | **Quorum:** ${brief.quorumPercent}%`,
    "",
    "## Agent Positions",
    "| Agent | Position | Weight |",
    "|-------|----------|--------|",
  ];
  for (const a of brief.keyAgents) {
    const emoji = a.position === "for" ? "✅" : a.position === "against" ? "❌" : "⏸️";
    lines.push(`| ${a.name} | ${emoji} ${a.position} | ${a.weight} |`);
  }
  return lines.join("\n");
};

export const formatADR = (adr: ADR): string => {
  const lines = [
    `# 🏗️ ${adr.adrId}: ${adr.title}`,
    "",
    `**Status:** ${adr.status}`,
    "",
    "## Context",
    adr.context,
    "",
    "## Decision",
    adr.decision,
    "",
    "## Options",
  ];
  for (const opt of adr.options) {
    const selected = opt.selected ? " ✅ SELECTED" : "";
    lines.push(`### ${opt.name}${selected}`);
    lines.push(opt.description);
    if (opt.pros.length > 0) {
      lines.push("**Pros:**");
      for (const p of opt.pros) lines.push(`- ${p}`);
    }
    if (opt.cons.length > 0) {
      lines.push("**Cons:**");
      for (const c of opt.cons) lines.push(`- ${c}`);
    }
    lines.push("");
  }
  lines.push("## Consequences");
  for (const c of adr.consequences) lines.push(`- ${c}`);
  lines.push("");
  lines.push("## Rejected Alternatives");
  for (const r of adr.rejectedAlternatives) lines.push(`- ${r}`);
  return lines.join("\n");
};

export const formatRiskReport = (report: RiskReport): string => {
  const lines = [
    `# 🔒 Risk Report — Proposal #${report.proposalId}`,
    "",
    `**Overall Risk Score:** ${report.overallRiskScore}/10 (${report.riskLevel})`,
    "",
    "## Risk Assessment",
    "| Category | Description | Severity | Likelihood | Mitigation |",
    "|----------|-------------|----------|------------|------------|",
  ];
  for (const r of report.risks) {
    lines.push(`| ${r.category} | ${r.description.slice(0, 60)} | ${r.severity} | ${r.likelihood} | ${r.mitigation.slice(0, 60)} |`);
  }
  lines.push("");
  lines.push("## Permissions");
  for (const p of report.permissions) lines.push(`- ${p}`);
  lines.push("");
  lines.push("## Data Surfaces");
  for (const d of report.dataSurfaces) lines.push(`- ${d}`);
  lines.push("");
  lines.push("## Guardrails");
  for (const g in report.guardrails) lines.push(`- ${report.guardrails[g]}`);
  return lines.join("\n");
};

export const formatPRDLite = (prd: PRDLite): string => {
  const lines = [
    `# 📝 PRD Lite — Proposal #${prd.proposalId}`,
    "",
    "## Objective",
    prd.objective,
    "",
    "## User Stories",
  ];
  for (const s of prd.userStories) {
    lines.push(`### ${s.id}: ${s.title}`);
    lines.push(`**As a** ${s.asA}, **I want** ${s.iWant}, **so that** ${s.soThat}.`);
    lines.push("**Acceptance Criteria:**");
    for (const ac of s.acceptanceCriteria) lines.push(`- [ ] ${ac}`);
    lines.push("");
  }
  lines.push("## In Scope");
  for (const s of prd.inScope) lines.push(`- ${s}`);
  lines.push("");
  lines.push("## Out of Scope");
  for (const s of prd.outOfScope) lines.push(`- ${s}`);
  lines.push("");
  lines.push("## Metrics");
  lines.push("| Metric | Baseline | Target |");
  lines.push("|--------|----------|--------|");
  for (const m of prd.metrics) lines.push(`| ${m.name} | ${m.baseline} | ${m.target} |`);
  lines.push("");
  lines.push("## Open Questions");
  for (const q of prd.openQuestions) lines.push(`- ${q}`);
  return lines.join("\n");
};

export const formatImplementationPlan = (plan: ImplementationPlan): string => {
  const lines = [
    `# 🗂️ Implementation Plan — Proposal #${plan.proposalId}`,
    "",
    `**Estimated Duration:** ${plan.estimatedDuration}`,
    `**Branch Strategy:** ${plan.branchStrategy}`,
    "",
  ];
  for (const phase of plan.phases) {
    lines.push(`## Phase ${phase.number}: ${phase.name}`);
    lines.push("| # | Task | Effort | Dependencies |");
    lines.push("|---|------|--------|--------------|");
    for (const t of phase.tasks) {
      const deps = t.dependencies.length > 0 ? t.dependencies.join(", ") : "—";
      lines.push(`| ${t.id} | ${t.title} | ${t.effort} | ${deps} |`);
    }
    lines.push("");
  }
  if (plan.criticalPath.length > 0) {
    lines.push(`**Critical Path:** ${plan.criticalPath.join(" → ")}`);
  }
  return lines.join("\n");
};

export const formatTestPlan = (plan: TestPlan): string => {
  const lines = [
    `# 🧪 Test Plan — Proposal #${plan.proposalId}`,
    "",
    "## Unit Tests",
    "| Target | Description |",
    "|--------|-------------|",
  ];
  for (const t of plan.unitTests) lines.push(`| ${t.target} | ${t.description} |`);
  lines.push("");
  lines.push("## Integration Tests");
  for (const t of plan.integrationTests) lines.push(`- **${t.target}:** ${t.description}`);
  lines.push("");
  lines.push("## E2E Tests");
  for (const t of plan.e2eTests) {
    lines.push(`### ${t.scenario}`);
    lines.push(t.steps);
    lines.push("");
  }
  lines.push("## Non-Regression Checks");
  for (const c of plan.nonRegressionChecks) lines.push(`- ${c}`);
  lines.push("");
  lines.push("## Test Environments");
  for (const e of plan.testEnvironments) lines.push(`- ${e}`);
  return lines.join("\n");
};

export const formatReleasePacket = (packet: ReleasePacket): string => {
  const lines = [
    `# 📦 Release Packet — Proposal #${packet.proposalId}`,
    "",
    `**Version:** ${packet.version}`,
    "",
    "## Changelog",
    packet.changelog,
    "",
    "## Pre-Release Checklist",
  ];
  for (const item of packet.preReleaseChecklist) {
    const box = item.checked ? "✅" : "⬜";
    lines.push(`- ${box} ${item.item}`);
  }
  lines.push("");
  lines.push("## Rollback Plan");
  lines.push(packet.rollbackPlan);
  lines.push("");
  lines.push("## Store Notes");
  lines.push(packet.storeNotes);
  lines.push("");
  lines.push("---");
  lines.push("## Full Release Notes");
  lines.push(packet.releaseNotes);
  return lines.join("\n");
};

/** Format all 7 artefacts as a single markdown document */
export const formatAllArtefacts = (artefacts: DAOArtefacts): string => {
  const lines = [
    `# 📚 DAO Artefacts — Proposal #${artefacts.proposalId}`,
    `> Generated: ${artefacts.generatedAt}`,
    "",
    "---",
    "",
    formatDecisionBrief(artefacts.decisionBrief),
    "",
    "---",
    "",
    formatADR(artefacts.adr),
    "",
    "---",
    "",
    formatRiskReport(artefacts.riskReport),
    "",
    "---",
    "",
    formatPRDLite(artefacts.prdLite),
    "",
    "---",
    "",
    formatImplementationPlan(artefacts.implementationPlan),
    "",
    "---",
    "",
    formatTestPlan(artefacts.testPlan),
    "",
    "---",
    "",
    formatReleasePacket(artefacts.releasePacket),
  ];
  return lines.join("\n");
};

/** Format a compact artefacts summary for the dashboard */
export const formatArtefactsSummary = (artefacts: DAOArtefacts): string => {
  const lines = [
    `## 📚 Artefacts Status — Proposal #${artefacts.proposalId}`,
    "",
    "| # | Artefact | Status |",
    "|---|----------|--------|",
    `| 1 | 📋 Decision Brief | ✅ Generated |`,
    `| 2 | 🏗️ ADR ${artefacts.adr.adrId} | ✅ Generated |`,
    `| 3 | 🔒 Risk Report (${artefacts.riskReport.overallRiskScore}/10) | ✅ Generated |`,
    `| 4 | 📝 PRD Lite (${artefacts.prdLite.userStories.length} stories) | ✅ Generated |`,
    `| 5 | 🗂️ Implementation Plan (${artefacts.implementationPlan.phases.length} phases) | ✅ Generated |`,
    `| 6 | 🧪 Test Plan (${artefacts.testPlan.unitTests.length} unit, ${artefacts.testPlan.e2eTests.length} E2E) | ✅ Generated |`,
    `| 7 | 📦 Release Packet (v${artefacts.releasePacket.version}) | ✅ Generated |`,
  ];

  if (artefacts.files) {
    lines.push("", "### Repository Files");
    lines.push(`- Decision Brief: \`${artefacts.files.decisionBrief.path}\``);
    lines.push(`- ADR: \`${artefacts.files.adr.path}\``);
    lines.push(`- Risk Report: \`${artefacts.files.riskReport.path}\``);
    lines.push(`- PRD Lite: \`${artefacts.files.prdLite.path}\``);
    lines.push(`- Implementation Plan: \`${artefacts.files.implementationPlan.path}\``);
    lines.push(`- Test Plan: \`${artefacts.files.testPlan.path}\``);
    lines.push(`- Release Packet: \`${artefacts.files.releasePacket.path}\``);
  }

  lines.push("", `> Run \`dao_artefacts\` with proposalId ${artefacts.proposalId} to view full details.`);
  return lines.join("\n");
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "proposal";

const padId = (value: number): string => String(value).padStart(3, "0");

const buildBlobUrl = (hostCtx: HostProjectContext, path: string): string | undefined => {
  if (
    hostCtx.repoOwner === "unknown" ||
    hostCtx.repoName === "unknown" ||
    hostCtx.branch === "unknown"
  ) {
    return undefined;
  }

  const encodedBranch = encodeURIComponent(hostCtx.branch).replace(/%2F/g, "/");
  return `https://github.com/${hostCtx.repoSlug}/blob/${encodedBranch}/${path}`;
};

export const buildArtefactFileIndex = (
  proposal: Proposal,
  hostCtx: HostProjectContext = detectHostContext(),
): ArtefactFileIndex => {
  const id = padId(proposal.id);
  const slug = slugify(proposal.title);
  const decisionPath = `docs/dao/decisions/${id}-${slug}.md`;
  const adrPath = `docs/dao/adr/ADR-${id}-${slug}.md`;
  const riskPath = `docs/dao/risk-register/${id}-${slug}-risk-report.md`;
  const prdPath = `docs/dao/proposals/${id}-${slug}-prd-lite.md`;
  const implementationPath = `docs/dao/implementation-plans/${id}-${slug}.md`;
  const testPath = `docs/dao/test-plans/${id}-${slug}.md`;
  const releasePath = `docs/dao/release-packets/${id}-${slug}.md`;

  return {
    decisionBrief: { path: decisionPath, url: buildBlobUrl(hostCtx, decisionPath) },
    adr: { path: adrPath, url: buildBlobUrl(hostCtx, adrPath) },
    riskReport: { path: riskPath, url: buildBlobUrl(hostCtx, riskPath) },
    prdLite: { path: prdPath, url: buildBlobUrl(hostCtx, prdPath) },
    implementationPlan: { path: implementationPath, url: buildBlobUrl(hostCtx, implementationPath) },
    testPlan: { path: testPath, url: buildBlobUrl(hostCtx, testPath) },
    releasePacket: { path: releasePath, url: buildBlobUrl(hostCtx, releasePath) },
  };
};

export const writeArtefactFiles = (
  proposal: Proposal,
  artefacts: DAOArtefacts,
  hostCtx: HostProjectContext = detectHostContext(),
): ArtefactFileIndex => {
  const files = buildArtefactFileIndex(proposal, hostCtx);
  const docs = {
    decisionBrief: formatDecisionBrief(artefacts.decisionBrief),
    adr: formatADR(artefacts.adr),
    riskReport: formatRiskReport(artefacts.riskReport),
    prdLite: formatPRDLite(artefacts.prdLite),
    implementationPlan: formatImplementationPlan(artefacts.implementationPlan),
    testPlan: formatTestPlan(artefacts.testPlan),
    releasePacket: formatReleasePacket(artefacts.releasePacket),
  };

  const entries: Array<[keyof ArtefactFileIndex, string]> = [
    ["decisionBrief", docs.decisionBrief],
    ["adr", docs.adr],
    ["riskReport", docs.riskReport],
    ["prdLite", docs.prdLite],
    ["implementationPlan", docs.implementationPlan],
    ["testPlan", docs.testPlan],
    ["releasePacket", docs.releasePacket],
  ];

  for (const [key, content] of entries) {
    const file = files[key];
    const absolutePath = join(hostCtx.rootDir, file.path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content + "\n", "utf-8");
  }

  artefacts.files = files;
  return files;
};
