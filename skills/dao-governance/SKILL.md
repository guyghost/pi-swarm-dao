---
name: dao-governance
description: DAO governance with 4-layer architecture (Governance, Intelligence, Control, Delivery) and 7 specialized AI agents that deliberate on typed proposals (feature, security, ux, release, policy) through weighted voting, quality gates, and delivery plans. Proposal type focuses agent analysis and adjusts gate severity. Use when you need structured multi-perspective analysis, risk assessment, quality-controlled execution, and audit trails for product decisions, architecture changes, or strategic initiatives.
---

# DAO Governance Skill

A 4-layer decentralized autonomous organization (DAO) of specialized AI agents that deliberate on proposals through weighted voting, quality gates, and actionable delivery plans.

## When to Use

- When you need structured multi-perspective analysis of a decision
- When you want risk assessment, quality gates, and a delivery plan — not just a vote
- When you need an audit trail for governance decisions
- When you want to go from proposal → deliberation → controlled execution

## Architecture — 4 Layers

| Layer | Name | Mission |
|-------|------|---------|
| L1 | Governance | Proposal lifecycle, voting, quorum |
| L2 | Intelligence | 7 specialized agents analyzing in parallel |
| L3 | Control | Quality gates, audit trail, checklists |
| L4 | Delivery | Execution plans, tasks, release artifacts |

## Proposal Lifecycle

```
open → deliberating → approved → controlled → executed
                   ↘ rejected  ↘ rejected   ↘ failed
```

Each transition is recorded in the audit trail. The `controlled` status means all quality gates have passed and the delivery plan is ready.

## Proposal Types

Every proposal must specify a type. The type scopes agent analysis and can promote gate severity for high-stakes domains.

| Type | Emoji | Domain | Example |
|------|-------|--------|---------|
| `feature` | ✨ | New functionality | Add search, dark mode, API endpoint |
| `security` | 🔒 | Permissions, CSP, access, storage | Migrate to OAuth2, tighten CSP headers |
| `ux` | 🎨 | Popup, onboarding, options, feedback | Redesign onboarding flow, add tooltips |
| `release` | 📦 | Publication, rollback, version pinning | Ship v2.0, rollback v1.9.3, pin Chrome MVP |
| `policy` | 📜 | Governance rules, quorum, agent roles | Change quorum to 75%, add "Legal" agent |

## Quick Start

```
1. Initialize:  ask Pi to "set up the DAO"            → triggers `dao_setup`
2. Propose:     describe what you want to evaluate      → triggers `dao_propose` (select type interactively)
3. Deliberate:  ask to "run the deliberation"           → triggers `dao_deliberate`
4. Check:       ask to "run the control gates"          → triggers `dao_check`
5. Plan:        ask to "generate the delivery plan"     → triggers `dao_plan`
6. Execute:     if approved, ask to "execute"           → triggers `dao_execute`
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

## Available Tools (11)

| Tool | Layer | Description |
|------|-------|-------------|
| `dao_setup` | L1 | Initialize DAO with 7 default agents |
| `dao_add_agent` | L1 | Add a custom agent (name, role, weight 1-10) |
| `dao_remove_agent` | L1 | Remove an agent by ID |
| `dao_list_agents` | L1 | List all agents and weights |
| `dao_propose` | L1 | Create a new proposal |
| `dao_deliberate` | L2 | Run full deliberation cycle (parallel agents → synthesis → vote) |
| `dao_tally` | L1 | View detailed vote results |
| `dao_check` | L3 | Run control gates before execution |
| `dao_plan` | L4 | Generate or view delivery plan |
| `dao_execute` | L4 | Execute an approved proposal via Delivery Agent |
| `dao_audit` | L3 | View audit trail for a proposal |

## Control Layer — 5 Quality Gates

The `dao_check` tool runs all gates after approval. Results determine whether execution is safe.

| Gate | Severity | Purpose |
|------|----------|---------|
| quorum-quality | blocker | Quorum met with meaningful participation |
| risk-threshold | warning | Average risk score within config threshold |
| vote-consensus | warning | No strong dissent among high-weight agents |
| spec-completeness | info | Spec Writer produced actionable artifacts |
| delivery-feasibility | warning | Delivery plan is realistic and resourced |

## Slash Commands (17)

| Command | Description |
|---------|-------------|
| `/dao` | Dashboard: agents, proposals, config |
| `/dao:propose` | Interactive proposal creation |
| `/dao:update-proposal` | Update structured fields on an open proposal |
| `/dao:config` | View/modify quorum, threshold, model, concurrency |
| `/dao:history` | Full history of proposals and votes |
| `/dao:audit` | Audit trail for all governance decisions |
| `/dao:deliberate` | Run swarm deliberation on open proposals |
| `/dao:check` | Run control gates on approved proposals |
| `/dao:plan` | Generate or view the delivery plan |
| `/dao:execute` | Execute an approved or controlled proposal |
| `/dao:artefacts` | View generated artefacts for a proposal |
| `/dao:verify` | Run post-execution verification |
| `/dao:status` | View the proposal pipeline dashboard |
| `/dao:roundtable` | Ask agents to suggest proposal ideas |
| `/dao:ship` | Run deliberate → check → execute |
| `/dao:hello` | Guided onboarding tour |
| `/dao:quickstart` | Guided first proposal demo |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Quorum | 60% | Minimum agent participation (non-abstain) |
| Approval | 51% | Weighted "for" percentage to approve |
| Model | z.ai/GLM-5.1 | Default LLM for sub-agents |
| Max Concurrent | 4 | Parallel agent limit |
| Risk Threshold | 7/10 | Max average risk score for `dao_check` to pass |

## Example Workflow

```
User: Set up the DAO and propose migrating our auth system to OAuth2

→ dao_setup     (7 agents initialized)
→ dao_propose   (Proposal #1 created, type="security")
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

→ dao_check     (5 quality gates — all passed, risk-threshold promoted to blocker for security type)
→ dao_plan      (delivery plan: 3 phases, 47 tasks)
→ dao_execute   (tasks dispatched)
→ dao_audit     (full audit trail available)
```

## Tips

- **Customize agents**: Add domain-specific agents (e.g., "Security Expert", "UX Researcher") for specialized proposals
- **Adjust weights**: Higher weight = more voting influence. Use for agents whose perspective matters most
- **Context matters**: Add rich context to proposals (market data, constraints, prior decisions) for better analysis
- **Iterative**: Create multiple proposals and compare deliberation results
- **Use the control layer**: Run `dao_check` before execution — it catches issues the vote alone won't
- **Audit everything**: Use `dao_audit` or `/dao:audit` to review the full decision trail post-execution
- **Type-specific gates**: `security` proposals promote `risk-threshold` to blocker; `release` proposals promote `delivery-feasibility` to blocker. Pick the right type for stricter (or lighter) gate enforcement.
