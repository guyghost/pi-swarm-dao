# 🏛️ DAO Charter — pi-swarm-dao

## Mission

pi-swarm-dao implements a **4-layer multi-agent governance system** that deliberates on product decisions through weighted voting, quality gates, and structured delivery plans. It transforms individual proposals into collectively-analyzed, risk-assessed, and execution-ready decisions.

## Principles

### 1. Collective Intelligence
No single agent decides alone. Every proposal is analyzed from 7 specialized perspectives — business strategy, market research, architecture, risk, prioritization, specification, and delivery.

### 2. Weighted Representation
Agents carry different weights (1–3) reflecting the impact of their domain. Total weight: 15. Decisions require both quorum (participation) and approval (consensus) thresholds.

### 3. Risk-Calibrated Gates
Control gates scale with risk. Green-zone proposals flow quickly. Orange and red zones require progressively more human oversight, security review, and formal voting.

### 4. Typed Governance
Five proposal types — product-feature, security-change, technical-change, release-change, governance-change — each with per-type quorum thresholds and assigned councils.

### 5. Audit Trail
Every action is recorded: proposal creation, deliberation votes, gate checks, execution results. The audit log provides full traceability for every decision.

### 6. Self-Amendment
The DAO can modify its own agents, configuration, quorum rules, gates, and councils through governance-change proposals with human confirmation.

### 7. Fail-Safe Defaults
- Quorum floor: 60% (governance changes can never go below this)
- Risk threshold: 7/10 (proposals above this are blocked)
- Terminal state protection: executed/rejected proposals cannot be modified
- Rollback on amendment failure

## Governance Model

```
┌─────────────────────────────────────────────────┐
│                 GOVERNANCE LAYER                 │
│  Propose → Deliberate → Vote → Tally → Resolve  │
└───────────────────────┬─────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────┐
│               INTELLIGENCE LAYER                 │
│  7 Agents (parallel) → Synthesis → Composite    │
└───────────────────────┬─────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────┐
│                 CONTROL LAYER                    │
│  4 Gates → Checklist → Risk Zone → Approval     │
└───────────────────────┬─────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────┐
│                DELIVERY LAYER                    │
│  Plan → Artefacts → Execute → Release           │
└─────────────────────────────────────────────────┘
```

## Proposal Types & Councils

| Type | Icon | Council | Quorum | Approval |
|------|------|---------|--------|----------|
| Product Feature | ✨ | product-council | 60% | 55% |
| Security Change | 🔒 | security-council | 75% | 70% |
| Technical Change | ⚙️ | product + delivery | 60% | 55% |
| Release Change | 📦 | delivery + security | 50% | 51% |
| Governance Change | 📜 | governance-council | 70% | 66% |

## Agent Roster

| # | Agent | Weight | Risk | Role |
|---|-------|--------|------|------|
| 1 | Product Strategist | 3 | 🟢 low | Business strategy and user value |
| 2 | Research Agent | 2 | 🟢 low | Market and user research |
| 3 | Solution Architect | 3 | 🟡 medium | Functional and technical architecture |
| 4 | Critic / Risk Agent | 3 | 🟢 low | Risk assessment and challenge |
| 5 | Prioritization Agent | 2 | 🟢 low | Impact scoring and roadmap positioning |
| 6 | Spec Writer | 1 | 🟢 low | PRD, user stories, and acceptance criteria |
| 7 | Delivery Agent | 1 | 🟡 medium | Implementation planning and execution |

## Configuration

| Parameter | Value |
|-----------|-------|
| Default quorum | 60% |
| Approval threshold | 55% |
| Risk threshold | 7/10 |
| Max concurrent agents | 4 |
| Quorum floor | 60% |
| Default model | z.ai/GLM-5.1 |

## Version

- **Charter version:** 1.0
- **Last updated:** 2026-04-14
- **Status:** Active
