import type { AuditEntry } from "../types.js";
import { getState, setState } from "../persistence.js";
import { ghAddAuditEntry } from "../github-persistence.js";

/**
 * Record an audit entry — appends to state.auditLog with auto-incremented ID.
 */
export const recordAudit = (
  proposalId: number,
  layer: AuditEntry["layer"],
  action: string,
  actor: string,
  details: string,
  metadata?: Record<string, any>,
): AuditEntry => {
  const state = getState();

  const entry: AuditEntry = {
    id: state.nextAuditId,
    timestamp: new Date().toISOString(),
    proposalId,
    layer,
    action,
    actor,
    details,
    ...(metadata && { metadata }),
  };

  state.auditLog.push(entry);
  state.nextAuditId++;
  setState(state);

  ghAddAuditEntry(proposalId, layer, action, details);

  return entry;
};

/**
 * Get all audit entries for a proposal, sorted by timestamp ascending.
 */
export const getProposalAudit = (proposalId: number): AuditEntry[] =>
  getState()
    .auditLog.filter((e) => e.proposalId === proposalId)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

/**
 * Get all audit entries for a specific layer, sorted by timestamp ascending.
 */
export const getLayerAudit = (layer: AuditEntry["layer"]): AuditEntry[] =>
  getState()
    .auditLog.filter((e) => e.layer === layer)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

const LAYER_EMOJI: Record<AuditEntry["layer"], string> = {
  governance: "🗳️",
  intelligence: "🧠",
  delivery: "🚀",
  control: "🛡️",
};

/**
 * Format audit trail entries as readable markdown.
 */
export const formatAuditTrail = (entries: AuditEntry[]): string => {
  if (entries.length === 0) return "No audit entries found.";

  const lines = [
    "## Audit Trail",
    "",
    "| # | Timestamp | Layer | Action | Actor | Details |",
    "|---|-----------|-------|--------|-------|---------|",
  ];

  for (const e of entries) {
    const ts = e.timestamp.replace("T", " ").slice(0, 19);
    const emoji = LAYER_EMOJI[e.layer];
    lines.push(
      `| ${e.id} | ${ts} | ${emoji} ${e.layer} | ${e.action} | ${e.actor} | ${e.details} |`,
    );
  }

  return lines.join("\n");
};
