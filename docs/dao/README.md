# 🏛️ DAO Swarm — Documentation Architecture

> Governance documentation for the pi-swarm-dao multi-agent decision system.

## Directory Structure

```
/docs/dao/
├── README.md              ← You are here
├── charter/               — DAO mission, principles, governance model
│   └── CHARTER.md
├── agents/                — Agent registry cards (one per agent)
│   ├── README.md
│   ├── 01-product-strategist.md
│   ├── 02-research-agent.md
│   ├── 03-solution-architect.md
│   ├── 04-critic-risk-agent.md
│   ├── 05-prioritization-agent.md
│   ├── 06-spec-writer.md
│   └── 07-delivery-agent.md
├── proposals/             — Proposal templates and active proposals
│   └── TEMPLATE.md
├── decisions/             — Decision records (approved/rejected)
│   └── README.md
├── risk-register/         — Risk assessments and risk matrix
│   └── RISK-MATRIX.md
├── adr/                   — Architecture Decision Records
│   └── TEMPLATE.md
├── release-packets/       — Release packets per version
│   └── README.md
├── implementation-plans/  — Generated implementation plans per proposal
├── test-plans/            — Generated test plans per proposal
├── scorecards/            — Agent performance scorecards
│   └── TEMPLATE.md
└── policies/              — DAO policies and procedures
    ├── PROPOSAL-LIFECYCLE.md
    ├── RISK-ZONES.md
    ├── QUORUM.md
    ├── AMENDMENT.md
    └── GITHUB-FIRST-SOURCE-OF-TRUTH.md
```

## 4-Layer Architecture

| Layer | Mission | Components |
|-------|---------|------------|
| 🗳️ Governance | Decide what enters the roadmap | Proposals, voting, lifecycle |
| 🧠 Intelligence | Produce analysis and recommendations | 7 agents, swarm dispatch, synthesis |
| 🛡️ Control | Reduce risk before publication | Gates, checklist, risk zones |
| 🚀 Delivery | Convert decisions into execution | Plans, artefacts, execution |

## Quick Links

- [DAO Charter](charter/CHARTER.md) — Mission, principles, governance model
- [Agent Registry](agents/README.md) — All 7 agent cards
- [Proposal Lifecycle](policies/PROPOSAL-LIFECYCLE.md) — From intake to execution
- [GitHub-First Source of Truth](policies/GITHUB-FIRST-SOURCE-OF-TRUTH.md) — Canonical persistence model for proposals, events, and artefacts
- [Risk Zones](policies/RISK-ZONES.md) — Green / Orange / Red classification
- [Quorum Policy](policies/QUORUM.md) — Participation and approval thresholds
- [Self-Amendment](policies/AMENDMENT.md) — Changing the DAO from within
- [Risk Matrix](risk-register/RISK-MATRIX.md) — Risk assessment framework
- [ADR Template](adr/TEMPLATE.md) — Architecture Decision Record format
