/**
 * Cross-Proposal Dependency Graph Engine (Proposal #3 — Full Implementation)
 *
 * Provides:
 * - DAG construction from proposal dependencies
 * - Cycle detection (prevents circular dependencies)
 * - Transitive closure (finds all indirect dependencies)
 * - Topological sort (execution order)
 * - Conflict detection (mutually exclusive proposals)
 * - Impact analysis (what happens if a proposal is blocked/removed)
 * - Readiness check (are all deps satisfied for a proposal?)
 */

import type { Proposal } from "../types.js";
import { getState } from "../persistence.js";
import { getProposal, listProposals } from "../governance/proposals.js";

// ─── Types ──────────────────────────────────────────────────────────

/** Edge in the dependency graph */
export interface DependencyEdge {
  from: number; // proposal ID (depends on)
  to: number;   // proposal ID (required by)
  type: "hard" | "soft"; // hard = blocking, soft = recommended
  reason?: string;
}

/** Node in the dependency graph */
export interface DependencyNode {
  proposalId: number;
  title: string;
  status: string;
  type: string;
  riskZone: string;
  depth: number; // 0 = no dependencies, 1 = depends on depth-0, etc.
}

/** The full DAG */
export interface DependencyGraph {
  nodes: Map<number, DependencyNode>;
  edges: DependencyEdge[];
  /** proposalId → Set of proposalIds it depends on (direct + transitive) */
  transitiveDeps: Map<number, Set<number>>;
  /** proposalId → Set of proposalIds that depend on it (direct + transitive) */
  transitiveDependents: Map<number, Set<number>>;
  /** Topologically sorted proposal IDs (safe execution order) */
  executionOrder: number[];
  /** Detected cycles */
  cycles: number[][];
  /** Detected conflicts */
  conflicts: DependencyConflict[];
}

/** A conflict between proposals */
export interface DependencyConflict {
  proposalA: number;
  proposalB: number;
  conflictType: "file_overlap" | "resource_contention" | "mutually_exclusive" | "type_conflict";
  description: string;
  severity: "warning" | "blocker";
  affectedFiles?: string[];
}

/** Impact of blocking/removing a proposal */
export interface ImpactAnalysis {
  proposalId: number;
  directlyBlocked: number[];  // proposals that directly depend on this
  transitivelyBlocked: number[]; // all proposals affected (cascading)
  executionOrderAffected: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
}

/** Readiness status for a proposal */
export interface ReadinessCheck {
  proposalId: number;
  ready: boolean;
  unsatisfiedDeps: { proposalId: number; status: string; type: "hard" | "soft" }[];
  partiallySatisfied: { proposalId: number; status: string }[];
}

// ─── Graph Construction ─────────────────────────────────────────────

/** Extract dependency edges from proposal content analysis */
function extractDependencies(proposal: Proposal): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const content = proposal.content;
  if (!content?.dependencies) return edges;

  for (const dep of content.dependencies) {
    // Try to parse "Proposal #N" or just "#N" patterns
    const match = dep.match(/#(\d+)/);
    if (match) {
      const depId = parseInt(match[1], 10);
      if (depId !== proposal.id) {
        edges.push({
          from: proposal.id,
          to: depId,
          type: dep.toLowerCase().includes("recommended") || dep.toLowerCase().includes("soft") ? "soft" : "hard",
          reason: dep,
        });
      }
    }
  }

  return edges;
}

/** Build the full dependency graph from all proposals */
export function buildDependencyGraph(): DependencyGraph {
  const proposals = listProposals();
  const nodes = new Map<number, DependencyNode>();
  const edges: DependencyEdge[] = [];

  // Create nodes
  for (const p of proposals) {
    nodes.set(p.id, {
      proposalId: p.id,
      title: p.title,
      status: p.status,
      type: p.type,
      riskZone: p.riskZone ?? "green",
      depth: 0,
    });

    // Extract edges
    edges.push(...extractDependencies(p));
  }

  // Compute transitive closure
  const transitiveDeps = computeTransitiveClosure(edges, "forward");
  const transitiveDependents = computeTransitiveClosure(edges, "reverse");

  // Compute depth for each node
  for (const [id, node] of nodes) {
    node.depth = transitiveDeps.get(id)?.size ?? 0;
  }

  // Detect cycles
  const cycles = detectCycles(edges, nodes);

  // Topological sort (ignoring cycles)
  const executionOrder = topologicalSort(edges, nodes);

  // Detect conflicts
  const conflicts = detectConflicts(proposals);

  return { nodes, edges, transitiveDeps, transitiveDependents, executionOrder, cycles, conflicts };
}

// ─── Transitive Closure ─────────────────────────────────────────────

/** Compute transitive closure using Floyd-Warshall-like approach */
function computeTransitiveClosure(
  edges: DependencyEdge[],
  direction: "forward" | "reverse",
): Map<number, Set<number>> {
  const closure = new Map<number, Set<number>>();

  // Initialize with direct edges
  for (const edge of edges) {
    const source = direction === "forward" ? edge.from : edge.to;
    const target = direction === "forward" ? edge.to : edge.from;

    if (!closure.has(source)) closure.set(source, new Set());
    closure.get(source)!.add(target);
  }

  // Expand transitively (BFS)
  let changed = true;
  while (changed) {
    changed = false;
    for (const [source, deps] of closure) {
      const toAdd = new Set<number>();
      for (const dep of deps) {
        const depDeps = closure.get(dep);
        if (depDeps) {
          for (const dd of depDeps) {
            if (!deps.has(dd)) {
              toAdd.add(dd);
            }
          }
        }
      }
      if (toAdd.size > 0) {
        for (const d of toAdd) deps.add(d);
        changed = true;
      }
    }
  }

  return closure;
}

// ─── Cycle Detection ────────────────────────────────────────────────

/** Detect cycles using DFS with coloring (white/gray/black) */
function detectCycles(edges: DependencyEdge[], nodes: Map<number, DependencyNode>): number[][] {
  const adjList = new Map<number, number[]>();
  for (const edge of edges) {
    if (!adjList.has(edge.from)) adjList.set(edge.from, []);
    adjList.get(edge.from)!.push(edge.to);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<number, number>();
  for (const id of nodes.keys()) color.set(id, WHITE);

  const cycles: number[][] = [];
  const path: number[] = [];

  function dfs(node: number): void {
    color.set(node, GRAY);
    path.push(node);

    const neighbors = adjList.get(node) ?? [];
    for (const next of neighbors) {
      if (color.get(next) === GRAY) {
        // Found a cycle — extract it
        const cycleStart = path.indexOf(next);
        if (cycleStart >= 0) {
          cycles.push(path.slice(cycleStart));
        }
      } else if (color.get(next) === WHITE) {
        dfs(next);
      }
    }

    path.pop();
    color.set(node, BLACK);
  }

  for (const id of nodes.keys()) {
    if (color.get(id) === WHITE) {
      dfs(id);
    }
  }

  return cycles;
}

// ─── Topological Sort ───────────────────────────────────────────────

/** Kahn's algorithm for topological sort */
function topologicalSort(edges: DependencyEdge[], nodes: Map<number, DependencyNode>): number[] {
  const inDegree = new Map<number, number>();
  const adjList = new Map<number, number[]>();

  for (const id of nodes.keys()) {
    inDegree.set(id, 0);
    adjList.set(id, []);
  }

  for (const edge of edges) {
    adjList.get(edge.to)?.push(edge.from); // edge.to must come before edge.from
    inDegree.set(edge.from, (inDegree.get(edge.from) ?? 0) + 1);
  }

  // Start with nodes that have no dependencies
  const queue: number[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: number[] = [];
  while (queue.length > 0) {
    // Sort queue for deterministic ordering (lower ID first)
    queue.sort((a, b) => a - b);
    const node = queue.shift()!;
    result.push(node);

    for (const neighbor of adjList.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // Nodes not in result are part of cycles — append them
  for (const id of nodes.keys()) {
    if (!result.includes(id)) result.push(id);
  }

  return result;
}

// ─── Conflict Detection ─────────────────────────────────────────────

/** Detect conflicts between proposals */
function detectConflicts(proposals: Proposal[]): DependencyConflict[] {
  const conflicts: DependencyConflict[] = [];

  for (let i = 0; i < proposals.length; i++) {
    for (let j = i + 1; j < proposals.length; j++) {
      const a = proposals[i];
      const b = proposals[j];

      // Skip if both are already executed/closed
      if (isTerminal(a.status) && isTerminal(b.status)) continue;

      // Check for mutually exclusive types
      if (areMutuallyExclusive(a, b)) {
        conflicts.push({
          proposalA: a.id,
          proposalB: b.id,
          conflictType: "mutually_exclusive",
          description: `Proposals #${a.id} and #${b.id} have conflicting objectives`,
          severity: "blocker",
        });
      }

      // Check for file overlap in execution results
      const filesA = getAffectedFiles(a);
      const filesB = getAffectedFiles(b);
      const overlap = filesA.filter(f => filesB.includes(f));
      if (overlap.length > 0 && !isTerminal(a.status) && !isTerminal(b.status)) {
        conflicts.push({
          proposalA: a.id,
          proposalB: b.id,
          conflictType: "file_overlap",
          description: `Both proposals modify: ${overlap.join(", ")}`,
          severity: overlap.some(f => f.includes("types.ts") || f.includes("index.ts")) ? "blocker" : "warning",
          affectedFiles: overlap,
        });
      }
    }
  }

  return conflicts;
}

function isTerminal(status: string): boolean {
  return status === "executed" || status === "rejected" || status === "closed";
}

function areMutuallyExclusive(a: Proposal, b: Proposal): boolean {
  // Two security changes to the same area are likely exclusive
  // A proposal and its rollback are exclusive
  const aTitle = a.title.toLowerCase();
  const bTitle = b.title.toLowerCase();

  // Check for explicit "remove" / "add" of same feature
  if ((aTitle.includes("add") && bTitle.includes("remove")) || (aTitle.includes("remove") && bTitle.includes("add"))) {
    const aFeature = aTitle.replace(/add|remove|implement|delete/gi, "").trim();
    const bFeature = bTitle.replace(/add|remove|implement|delete/gi, "").trim();
    if (aFeature === bFeature) return true;
  }

  return false;
}

function getAffectedFiles(proposal: Proposal): string[] {
  // Check execution snapshot for actual files
  const state = getState();
  const snapshot = state.snapshots[proposal.id];
  if (snapshot?.filesChanged && snapshot.filesChanged.length > 0) {
    return snapshot.filesChanged;
  }

  // Fallback: parse from delivery plan
  const plan = state.deliveryPlans[proposal.id];
  if (plan?.phases) {
    return plan.phases.flatMap((p: any) =>
      p.tasks.map((t: any) => t.title).filter((t: string) => t.endsWith(".ts") || t.endsWith(".md"))
    );
  }

  return [];
}

// ─── Impact Analysis ────────────────────────────────────────────────

/** Analyze the impact of blocking or removing a proposal */
export function analyzeImpact(proposalId: number): ImpactAnalysis | null {
  const proposal = getProposal(proposalId);
  if (!proposal) return null;

  const graph = buildDependencyGraph();
  const dependents = graph.transitiveDependents.get(proposalId) ?? new Set();
  const directDependents = graph.edges
    .filter(e => e.to === proposalId)
    .map(e => e.from);

  const transitivelyBlocked = [...dependents].filter(id => {
    const p = getProposal(id);
    return p && !isTerminal(p.status);
  });

  let riskLevel: ImpactAnalysis["riskLevel"] = "low";
  if (transitivelyBlocked.length >= 3) riskLevel = "critical";
  else if (transitivelyBlocked.length >= 2) riskLevel = "high";
  else if (transitivelyBlocked.length >= 1) riskLevel = "medium";

  return {
    proposalId,
    directlyBlocked: directDependents,
    transitivelyBlocked,
    executionOrderAffected: transitivelyBlocked.length > 0,
    riskLevel,
  };
}

// ─── Readiness Check ────────────────────────────────────────────────

/** Check if a proposal is ready to be deliberated/executed */
export function checkReadiness(proposalId: number): ReadinessCheck | null {
  const proposal = getProposal(proposalId);
  if (!proposal) return null;

  const graph = buildDependencyGraph();
  const directDeps = graph.edges.filter(e => e.from === proposalId);

  const unsatisfied: ReadinessCheck["unsatisfiedDeps"] = [];
  const partially: ReadinessCheck["partiallySatisfied"] = [];

  for (const edge of directDeps) {
    const dep = getProposal(edge.to);
    if (!dep) {
      unsatisfied.push({ proposalId: edge.to, status: "not_found", type: edge.type });
    } else if (dep.status === "executed") {
      // Fully satisfied
    } else if (dep.status === "approved" || dep.status === "controlled") {
      partially.push({ proposalId: edge.to, status: dep.status });
    } else {
      unsatisfied.push({ proposalId: edge.to, status: dep.status, type: edge.type });
    }
  }

  const hardUnsatisfied = unsatisfied.filter(u => u.type === "hard");
  const ready = hardUnsatisfied.length === 0;

  return {
    proposalId,
    ready,
    unsatisfiedDeps: unsatisfied,
    partiallySatisfied: partially,
  };
}

// ─── Formatting ─────────────────────────────────────────────────────

/** Format the full dependency graph as a readable report */
export function formatDependencyGraph(graph: DependencyGraph): string {
  const lines: string[] = [];

  lines.push("# 🔗 Cross-Proposal Dependency Graph");
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push(`- **Nodes:** ${graph.nodes.size} proposals`);
  lines.push(`- **Edges:** ${graph.edges.length} dependencies`);
  lines.push(`- **Cycles:** ${graph.cycles.length}`);
  lines.push(`- **Conflicts:** ${graph.conflicts.length}`);
  lines.push("");

  // Execution Order
  if (graph.executionOrder.length > 0) {
    lines.push("## Execution Order (Topological)");
    lines.push("");
    graph.executionOrder.forEach((id, i) => {
      const node = graph.nodes.get(id);
      const icon = node?.status === "executed" ? "✅" : node?.status === "open" ? "📝" : "🔒";
      lines.push(`${i + 1}. ${icon} #${id}: ${node?.title ?? "Unknown"}`);
    });
    lines.push("");
  }

  // Dependencies Detail
  if (graph.edges.length > 0) {
    lines.push("## Dependencies");
    lines.push("");
    for (const edge of graph.edges) {
      const typeIcon = edge.type === "hard" ? "🔴" : "🟡";
      lines.push(`- ${typeIcon} #${edge.from} → #${edge.to} (${edge.type})${edge.reason ? ": " + edge.reason : ""}`);
    }
    lines.push("");
  }

  // Cycles
  if (graph.cycles.length > 0) {
    lines.push("## ⚠️ Cycles Detected");
    lines.push("");
    for (const cycle of graph.cycles) {
      lines.push(`- ${cycle.map(id => "#" + id).join(" → ")} → #${cycle[0]}`);
    }
    lines.push("");
  }

  // Conflicts
  if (graph.conflicts.length > 0) {
    lines.push("## ⚔️ Conflicts");
    lines.push("");
    for (const conflict of graph.conflicts) {
      const icon = conflict.severity === "blocker" ? "🔴" : "🟡";
      lines.push(`- ${icon} #${conflict.proposalA} ↔ #${conflict.proposalB} (${conflict.conflictType}): ${conflict.description}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Format impact analysis */
export function formatImpactAnalysis(impact: ImpactAnalysis): string {
  const riskIcon = { low: "🟢", medium: "🟡", high: "🟠", critical: "🔴" }[impact.riskLevel];

  const lines = [
    `# ${riskIcon} Impact Analysis — Proposal #${impact.proposalId}`,
    "",
    `**Risk Level:** ${impact.riskLevel.toUpperCase()}`,
    `**Directly Blocked:** ${impact.directlyBlocked.length} proposal(s)`,
    `**Transitively Blocked:** ${impact.transitivelyBlocked.length} proposal(s)`,
    `**Execution Order Affected:** ${impact.executionOrderAffected ? "Yes" : "No"}`,
  ];

  if (impact.directlyBlocked.length > 0) {
    lines.push("", "### Directly Blocked");
    for (const id of impact.directlyBlocked) {
      const p = getProposal(id);
      lines.push(`- #${id}: ${p?.title ?? "Unknown"} (${p?.status ?? "?"})`);
    }
  }

  if (impact.transitivelyBlocked.length > 0) {
    lines.push("", "### Transitively Blocked (Cascading)");
    for (const id of impact.transitivelyBlocked) {
      const p = getProposal(id);
      lines.push(`- #${id}: ${p?.title ?? "Unknown"} (${p?.status ?? "?"})`);
    }
  }

  return lines.join("\n");
}

/** Format readiness check */
export function formatReadiness(check: ReadinessCheck): string {
  const icon = check.ready ? "✅" : "❌";

  const lines = [
    `# ${icon} Readiness Check — Proposal #${check.proposalId}`,
    "",
    `**Ready:** ${check.ready ? "Yes" : "No"}`,
  ];

  if (check.unsatisfiedDeps.length > 0) {
    lines.push("", "### Unsatisfied Dependencies");
    for (const dep of check.unsatisfiedDeps) {
      const p = getProposal(dep.proposalId);
      const typeIcon = dep.type === "hard" ? "🔴" : "🟡";
      lines.push(`- ${typeIcon} #${dep.proposalId} (${dep.status}) — ${p?.title ?? "Unknown"}`);
    }
  }

  if (check.partiallySatisfied.length > 0) {
    lines.push("", "### Partially Satisfied");
    for (const dep of check.partiallySatisfied) {
      const p = getProposal(dep.proposalId);
      lines.push(`- 🟡 #${dep.proposalId} (${dep.status}) — ${p?.title ?? "Unknown"}`);
    }
  }

  return lines.join("\n");
}
