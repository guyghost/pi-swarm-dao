# pi-swarm-dao

A DAO extension for the [Pi coding agent](https://github.com/badlogic/pi-mono) where specialized AI agents deliberate on proposals via weighted voting.

## What is this?

**pi-swarm-dao** is a Pi extension that implements a four-layer DAO governance system. Seven specialized AI agents analyze proposals in parallel, each from their own domain perspective, then cast weighted votes. The system handles the full lifecycle — from proposal creation through deliberation, quality control, and execution — with a complete audit trail throughout. Every proposal must be typed (feature, security, ux, release, or policy), which focuses agent analysis and adjusts quality gate severity.

It installs as a Pi package and adds 11 tools, 5 slash commands, and 3 event hooks to your Pi session.

## Installation

```bash
pi install git:github.com/guyghost/pi-swarm-dao
```

Initialize the DAO with default agents:

```
> /dao
```

This runs `dao_setup` automatically and displays the dashboard.

## Quick Start

```
# 1. Create a proposal interactively (includes type selection)
> /dao-propose

# Or create directly with a type:
> dao_propose title="Add dark mode" description="..." type="feature"

# 2. Run swarm deliberation (7 agents analyze + vote in parallel)
> dao_deliberate proposal_id="prop-001"

# 3. Run quality control gates before execution
> dao_check proposal_id="prop-001"

# 4. Execute the approved proposal
> dao_execute proposal_id="prop-001"
```

## Architecture

The system is organized in four layers, each with a clear mission:

```
┌─────────────────────────────────────────────────┐
│  L1  Governance                                  │
│  Proposals · Voting · Quorum · State Machine     │
├─────────────────────────────────────────────────┤
│  L2  Intelligence                                │
│  7 Specialized Agents · Parallel Deliberation    │
├─────────────────────────────────────────────────┤
│  L3  Delivery                                    │
│  Execution Plans · Tasks · Release Artifacts     │
├─────────────────────────────────────────────────┤
│  L4  Control                                     │
│  Quality Gates · Audit Trail · Checklists        │
└─────────────────────────────────────────────────┘
```

| Layer | Name | Mission |
|-------|------|---------|
| L1 | Governance | Decide what enters the roadmap — proposal lifecycle, voting, quorum |
| L2 | Intelligence | Produce analysis and recommendations — 7 agents in parallel |
| L3 | Delivery | Convert decisions into execution — plans, tasks, release artifacts |
| L4 | Control | Reduce risk before publication — quality gates, audit trail, checklists |

## The 7 Default Agents

| Agent | ID | Weight | Role |
|-------|-----|--------|------|
| Product Strategist | `strategist` | 3 | Vision, objectives, hypotheses |
| Research Agent | `researcher` | 2 | Market, competition, user signals |
| Solution Architect | `architect` | 3 | Technical options, tradeoffs |
| Critic / Risk Agent | `critic` | 3 | Risk scoring, objections, guardrails |
| Prioritization Agent | `prioritizer` | 2 | Impact/cost/risk scoring, roadmap fit |
| Spec Writer | `spec-writer` | 1 | PRD, user stories, acceptance criteria |
| Delivery Agent | `delivery` | 1 | Implementation plan, tasks, CI/CD |

**Total weight:** 15 · **Quorum:** 60% · **Approval:** 51%

Add or remove agents with `dao_add_agent` and `dao_remove_agent`. Each agent's model is independently configurable.

## Proposal Types

Every proposal requires a type that scopes agent analysis and adjusts control behavior.

| Type | Emoji | Domain | Example |
|------|-------|--------|---------|
| `feature` | ✨ | New functionality | Add search, dark mode, API endpoint |
| `security` | 🔒 | Permissions, CSP, access, storage | Migrate to OAuth2, tighten CSP headers |
| `ux` | 🎨 | Popup, onboarding, options, feedback | Redesign onboarding flow, add tooltips |
| `release` | 📦 | Publication, rollback, version pinning | Ship v2.0, rollback v1.9.3, pin Chrome MVP |
| `policy` | 📜 | Governance rules, quorum, agent roles | Change quorum to 75%, add "Legal" agent |

## Tools

| Tool | Description |
|------|-------------|
| `dao_setup` | Initialize DAO with default agents |
| `dao_add_agent` | Add a custom agent |
| `dao_remove_agent` | Remove an agent |
| `dao_list_agents` | List all registered agents |
| `dao_propose` | Create a typed proposal (type is required) |
| `dao_deliberate` | Run full parallel swarm deliberation + weighted vote |
| `dao_tally` | View detailed vote results |
| `dao_check` | Run quality control gates before execution |
| `dao_plan` | Generate or view structured delivery plan |
| `dao_execute` | Execute an approved proposal |
| `dao_audit` | View audit trail |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/dao` | Dashboard |
| `/dao-propose` | Interactive proposal creation |
| `/dao-config` | View or modify configuration |
| `/dao-history` | Full proposal history |
| `/dao-audit` | Full audit trail |

## Proposal Lifecycle

```
open ──► deliberating ──► approved ──► controlled ──► executed
                       ╲              ╲              ╲
                     rejected       rejected        failed
```

A proposal moves through five terminal-eligible states. It can be rejected at deliberation or control, and execution can fail — each transition is logged to the audit trail.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Quorum | 60% | Minimum participation threshold |
| Approval threshold | 51% | Weighted vote percentage to approve |
| Default model | `z.ai/GLM-5.1` | LLM used by agents (overridable per agent) |
| Max concurrent | 4 | Parallel sub-agent limit |
| Risk threshold | 7/10 | Maximum acceptable risk score |

Configuration is viewable and editable via `/dao-config`.

## Control Layer

Five deterministic quality gates run before execution. No LLM involved — results are reproducible.

| Gate | Severity | Check |
|------|----------|-------|
| `quorum-quality` | blocker | Quorum was actually met |
| `risk-threshold` | warning | Risk score below threshold |
| `vote-consensus` | warning | No heavy-weight agent voted against |
| `spec-completeness` | info | User stories exist |
| `delivery-feasibility` | warning | Proposal is deliverable |

Seven checklist items are auto-verified:

`security-review` · `data-handling` · `compliance-check` · `specs-written` · `architecture-reviewed` · `rollback-plan` · `monitoring-plan`

**Type-specific severity promotions:** `security` proposals promote `risk-threshold` from warning → blocker. `release` proposals promote `delivery-feasibility` from warning → blocker. These ensure high-stakes proposal types face stricter gates.

## Project Structure

```
extensions/dao/
├── index.ts                    # Entry point (11 tools, 5 commands, 3 events)
├── types.ts                    # All type definitions
├── persistence.ts              # State via tool result details + getBranch()
├── pi-json.ts                  # Pi JSON event stream parser
├── render.ts                   # TUI rendering (dashboard, progress, history)
├── governance/                 # Layer 1 — Proposals, voting, state machine
│   ├── proposals.ts
│   ├── voting.ts
│   └── lifecycle.ts
├── intelligence/               # Layer 2 — Agents, swarm dispatch, synthesis
│   ├── agents.ts
│   ├── default-agents.ts
│   ├── swarm.ts
│   └── synthesis.ts
├── delivery/                   # Layer 3 — Execution, plans, artifacts
│   ├── execution.ts
│   ├── plan.ts
│   └── artifacts.ts
└── control/                    # Layer 4 — Gates, audit, checklists
    ├── gates.ts
    ├── audit.ts
    └── checklist.ts
```

## How Sub-Agents Work

Each agent runs as an isolated Pi subprocess:

```bash
pi --mode json -p --no-session --model <model> \
   --no-tools --append-system-prompt <promptFile> "Task: ..."
```

During deliberation, up to 4 agents run concurrently. Each receives the proposal and its specialized system prompt, returns a structured JSON response with analysis and vote, and the synthesis layer aggregates results into a final recommendation with weighted tally.

## Persistence

State is embedded in Pi's `tool result details` and restored from the session branch via `ctx.sessionManager.getBranch()`. This makes DAO state compatible with Pi's session branching — no external database or file required.

## License

[MIT](LICENSE)
