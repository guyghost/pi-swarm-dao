# Self-Amendment Policy

## Overview

The DAO can modify itself — agents, configuration, quorum rules, gates, and councils — through the same governance process used for product decisions, with additional safety guards.

## Amendment Types

| Type | Description | Example |
|------|-------------|---------|
| `agent-update` | Change agent properties | Increase weight, change model, update risk level |
| `agent-add` | Add a new agent | Add a QA Agent to the swarm |
| `agent-remove` | Remove an agent | Retire an obsolete agent |
| `config-update` | Change DAO configuration | Modify default model, max concurrent |
| `quorum-update` | Change per-type quorum | Raise security-change quorum to 80% |
| `gate-update` | Add/remove control gates | Add a compliance gate |
| `council-update` | Change council memberships | Move an agent to lead a different council |

## Safety Guards

### 1. Snapshot & Rollback
Before any amendment is applied, a snapshot of the current agents and configuration is captured. If execution fails, the snapshot is automatically restored.

### 2. Human Confirmation
Agent-initiated amendments require explicit human confirmation via `dao_approve_amendment`. Human-initiated amendments execute automatically after passing gates.

### 3. Weight Conservation
Amendments that change agent weights are validated to ensure total weight doesn't exceed reasonable bounds.

### 4. Prompt Integrity
Changes to agent system prompts are flagged for review to prevent prompt injection or manipulation.

### 5. Circular Amendment Prevention
Agent-initiated amendments that would modify the initiating agent are blocked.

## Amendment Flow

```
1. dao_propose_amendment (or dao_update_agent / dao_update_config)
   ↓
2. Creates governance-change proposal with amendment payload
   ↓
3. dao_deliberate — full swarm deliberation (70% quorum, 66% approval)
   ↓
4. dao_check — all standard gates + amendment-specific gates:
   - self-amendment-safety
   - weight-conservation
   - prompt-integrity
   - circular-amendment
   ↓
5. dao_preview_amendment (optional) — show before/after diff
   ↓
6. dao_approve_amendment — human confirmation (if agent-initiated)
   ↓
7. Execute — apply changes, capture snapshot for rollback
```

## Amendment Payload

Each amendment carries a typed payload:

```typescript
// Agent update
{ type: "agent-update", agentId: "strategist", changes: { weight: 4 } }

// Agent add
{ type: "agent-add", agent: { id: "qa", name: "QA Agent", ... } }

// Config update
{ type: "config-update", changes: { maxConcurrent: 6 } }

// Quorum update
{ type: "quorum-update", typeQuorum: { "security-change": { quorumPercent: 80 } } }
```

## Restrictions

- **Quorum floor**: Governance-change quorum cannot go below 60%
- **Terminal agents**: Cannot remove agents that are in terminal states
- **Last agent**: Cannot remove the last agent in the DAO
- **Weight bounds**: Agent weight must be between 1 and 10
- **Risk levels**: Only `low`, `medium`, `high`, `critical` are valid
