# 📦 Release Packet — Proposal #21

**Version:** 0.21.0

## Changelog
- [2026-05-05] **Proposal-Type-Specific Quality Gate Schemas** — # Deliberation Synthesis

## Vote Overview
- **For:** 9 agents (weighted: 17)
- **Against:** 0 agents (weighted: 0)
- **Abstain:** 1 agents

## Consensus Points
Agents expressed mixed views. (DAO approval: 100%)

## Pre-Release Checklist
- ✅ All control gates passed
- ✅ Risk assessment reviewed
- ✅ Test plan defined
- ✅ Rollback plan documented
- ⬜ Stakeholder sign-off obtained
- ⬜ Monitoring configured

## Rollback Plan
Revert to previous state via git revert

## Store Notes
⚙️ Technical Change Proposal-Type-Specific Quality Gate Schemas

Version 0.21.0 — 2026-05-05

# Deliberation Synthesis

## Vote Overview
- **For:** 9 agents (weighted: 17)
- **Against:** 0 agents (weighted: 0)
- **Abstain:** 1 agents

## Consensus Points
Agents expressed mixed views.

---
## Full Release Notes
# Release Notes: Proposal-Type-Specific Quality Gate Schemas

## Summary
# Deliberation Synthesis

## Vote Overview
- **For:** 9 agents (weighted: 17)
- **Against:** 0 agents (weighted: 0)
- **Abstain:** 1 agents

## Consensus Points
Agents expressed mixed views. See individual analyses below.

## Agent Analyses

### Product Strategist (Business strategy and user value)
### Vision Statement

Per-type quality gate schemas transform the DAO from a one-size-fits-all validation pipeline into an intelligent system that applies the right level of rigor at the right time.

## What's New
- [ ] AC1: A `gateSchemas` map exists keyed by all 5 proposal types, each containing `requiredFields`, `requiredSections`, and `riskThresholdOverrides` (optional)
- [ ] AC2: Adding a new proposal type to the system without a corresponding schema entry causes a clear error at schema resolution time
- [ ] AC3: Each schema is a plain data object (no behavior), consumable by `dao_check` without coupling to type-specific logic
- [ ] AC1: `security-change` proposals missing an `impactAssessment` field are rejected with a message listing the missing field
- [ ] AC2: `product-feature` proposals missing `userStories` are rejected with a descriptive error
- [ ] AC3: `governance-change` proposals missing a `migrationPath` field are rejected

## Known Risks
- **Assumption:** "All five proposal types need distinct schemas" — Challenge: Some types may share enough common requirements that 5 separate schemas create unnecessary maintenance burden. A base schema with type-specific extensions might be more appropriate, but this isn't explored.
- **Assumption:** "Requiring specific fields per type improves quality" — Challenge: Mandatory fields can produce cargo-cult compliance (people fill in user stories that are low quality just to pass the gate). Quality ≠ completeness of required fields.
- **Assumption:** "This is a technical change" — Challenge: Defining *what* each proposal type must contain is fundamentally a **governance decision**. The proposal blurs the line between the technical mechanism (schema enforcement) and the policy (what fields are required). These should be decoupled.
- **Assumption:** "The existing flat gate is a problem" — Challenge: The current system works. Breaking existing open proposals (#20, #22, #23, #26, #28) by retroactively applying new required fields is a real risk that isn't addressed.
- **Schema bypass risk:** If schemas are applied per-type but the type field is user-settable, a malicious actor could miscategorize a security-change as a product-feature to avoid threat model requirements. Type assignment needs its own integrity check.

## Approval
- Approved by DAO on 2026-05-05T08:35:06.420Z with 100% weighted approval
