# Agent Registry — Index

> Every agent in the DAO swarm has a registry card. This directory contains one card per agent.

## Cards

| # | Agent | File | Weight | Risk |
|---|-------|------|--------|------|
| 1 | Product Strategist | [01-product-strategist.md](01-product-strategist.md) | 3 | 🟢 low |
| 2 | Research Agent | [02-research-agent.md](02-research-agent.md) | 2 | 🟢 low |
| 3 | Solution Architect | [03-solution-architect.md](03-solution-architect.md) | 3 | 🟡 medium |
| 4 | Critic / Risk Agent | [04-critic-risk-agent.md](04-critic-risk-agent.md) | 3 | 🟢 low |
| 5 | Prioritization Agent | [05-prioritization-agent.md](05-prioritization-agent.md) | 2 | 🟢 low |
| 6 | Spec Writer | [06-spec-writer.md](06-spec-writer.md) | 1 | 🟢 low |
| 7 | Delivery Agent | [07-delivery-agent.md](07-delivery-agent.md) | 1 | 🟡 medium |
| 8 | Power User (Dev) | [08-power-user-dev.md](08-power-user-dev.md) | 1 | 🟢 low |
| 9 | Casual User (PM) | [09-casual-user-pm.md](09-casual-user-pm.md) | 1 | 🟢 low |
| 10 | New User (Skeptic) | [10-new-user-skeptic.md](10-new-user-skeptic.md) | 1 | 🟢 low |

## Registry Fields

Each card contains:

| Field | Description |
|-------|-------------|
| **ID** | Unique agent identifier |
| **Name** | Display name |
| **Owner** | Who owns this agent (system, team, individual) |
| **Mission** | Primary purpose in the DAO |
| **Weight** | Vote weight (1-10, default 1-3) |
| **Risk Level** | Agent's own risk classification |
| **Authorized Inputs** | What data the agent can receive |
| **Authorized Data** | What data the agent can access |
| **Authorized Environments** | Where the agent can operate |
| **Authorized Tools** | What tools the agent can use |
| **Stop Conditions** | When the agent should stop |
| **KPIs** | Performance targets |
| **Councils** | Council memberships and roles |
| **Last Review** | Date of last registry review |
| **Model** | LLM model used |

## Risk Profile Distribution

| Level | Count | Agents |
|-------|-------|--------|
| 🟢 Low | 8 | Product Strategist, Research, Critic, Prioritization, Spec Writer, Power User, Casual User, New User |
| 🟡 Medium | 2 | Solution Architect, Delivery Agent |
| 🔴 High | 0 | — |
| ⚫ Critical | 0 | — |

## Adding a New Agent

1. Copy the template from any existing card
2. Fill in all required fields
3. Submit a `dao_propose_amendment` with type `agent-add`
4. The governance-council must approve (70% quorum, 66% approval)
