---
name: dao-governance
description: DAO governance with 7 specialized AI agents (Strategist, Researcher, Architect, Critic, Prioritizer, Spec Writer, Delivery) that deliberate on proposals through weighted voting. Use when you need structured multi-perspective analysis of a product decision, architecture change, or strategic initiative — or when you want risk assessment, prioritization, and actionable specs from a single deliberation cycle.
---

# DAO Governance Skill

A decentralized autonomous organization (DAO) of specialized AI agents that deliberate on proposals through weighted voting.

## When to Use

- When you need structured multi-perspective analysis of a decision
- When you want to evaluate a product proposal, architecture change, or strategic initiative
- When you need risk assessment, prioritization, and actionable specs from a single deliberation

## Quick Start

```
1. Initialize: ask Pi to "set up the DAO" → triggers `dao_setup`
2. Propose: describe what you want to evaluate → triggers `dao_propose`
3. Deliberate: ask to "run the deliberation" → triggers `dao_deliberate`
4. Execute: if approved, ask to "execute the proposal" → triggers `dao_execute`
```

## The 7 Default Agents

| Agent | Weight | Focus |
|-------|--------|-------|
| Product Strategist | 3/15 | Business vision, objectives, hypotheses |
| Research Agent | 2/15 | Market, competition, user signals |
| Solution Architect | 3/15 | Technical options, tradeoffs, integration |
| Critic / Risk Agent | 3/15 | Risk scoring, objections, guardrails |
| Prioritization Agent | 2/15 | Impact/cost/risk scoring, roadmap position |
| Spec Writer | 1/15 | PRD, user stories, acceptance criteria |
| Delivery Agent | 1/15 | Implementation plan, tasks, CI/CD |

## How Deliberation Works

1. All 7 agents analyze the proposal **in parallel** (max 4 concurrent)
2. Each agent produces a structured analysis from their domain perspective
3. Each agent casts a weighted vote (for / against / abstain) with reasoning
4. Votes are tallied: `weighted_for / total_voting_weight >= 51%` → approved
5. Quorum required: at least 60% of agents must cast a non-abstain vote
6. A synthesis document aggregates all perspectives

## Available Tools

| Tool | Description |
|------|-------------|
| `dao_setup` | Initialize DAO with 7 default agents |
| `dao_add_agent` | Add a custom agent (name, role, weight 1-10) |
| `dao_remove_agent` | Remove an agent by ID |
| `dao_list_agents` | List all agents and weights |
| `dao_propose` | Create a new proposal |
| `dao_deliberate` | Run full deliberation cycle (parallel agents → synthesis → vote) |
| `dao_tally` | View detailed vote results |
| `dao_execute` | Execute an approved proposal via Delivery Agent |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/dao` | Dashboard: agents, proposals, config |
| `/dao-propose` | Interactive proposal creation |
| `/dao-config` | Modify quorum, threshold, model, concurrency |
| `/dao-history` | Full history of proposals and votes |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Quorum | 60% | Minimum agent participation (non-abstain) |
| Approval | 51% | Weighted "for" percentage to approve |
| Model | claude-sonnet-4-20250514 | Default LLM for sub-agents |
| Max Concurrent | 4 | Parallel agent limit |

## Example Workflow

```
User: Set up the DAO and propose migrating our auth system to OAuth2

→ dao_setup (7 agents initialized)
→ dao_propose (Proposal #1 created)
→ dao_deliberate (7 agents analyze in parallel)

Result:
- Strategist: FOR — aligns with platform strategy
- Researcher: FOR — industry standard, user expectation
- Architect: FOR — recommends Option B (OIDC + PKCE)
- Critic: FOR (with guardrails) — risk score 4/10
- Prioritizer: FOR — priority score 7.2/10, "Now"
- Spec Writer: FOR — 5 user stories drafted
- Delivery: FOR — 3-phase plan, 4 weeks

Verdict: ✅ APPROVED (100% for, 15/15 weighted)
```

## Tips

- **Customize agents**: Add domain-specific agents (e.g., "Security Expert", "UX Researcher") for specialized proposals
- **Adjust weights**: Higher weight = more voting influence. Use this for agents whose perspective matters most for your domain
- **Context matters**: Add rich context to proposals (market data, constraints, prior decisions) for better agent analysis
- **Iterative**: You can create multiple proposals and compare deliberation results
