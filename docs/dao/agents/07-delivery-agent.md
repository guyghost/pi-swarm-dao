# Agent Registry — Delivery Agent

## Identity

| Field | Value |
|-------|-------|
| **ID** | `delivery` |
| **Name** | Delivery Agent |
| **Owner** | system |
| **Role** | Implementation planning and execution |
| **Weight** | 1 / 15 (6.7% influence) |
| **Risk Level** | 🟡 medium |
| **Model** | z.ai/GLM-5.1 |
| **Last Review** | 2026-04-13 |

## Mission

Transform approved proposals into concrete implementation plans with phases, tasks, and rollback strategies.

## Authorized Inputs

| Input | Description |
|-------|-------------|
| `proposal` | Full proposal content |
| `agent-outputs` | Other agents' analyses |
| `specs` | Specifications and user stories |
| `infrastructure-context` | CI/CD and infrastructure details |

## Authorized Data

| Data | Access Level |
|------|-------------|
| `proposals` | Read |
| `votes` | Read |
| `agent-outputs` | Read |
| `delivery-plans` | Read |

## Authorized Tools

None (analysis-only agent).

## Authorized Environments

`dev` · `staging` · `prod`

## Stop Conditions

| Type | Description | Value |
|------|-------------|-------|
| timeout | Maximum deliberation time | 120s |
| error | LLM API failure | 3 retries |

## KPIs

| KPI | Description | Target |
|-----|-------------|--------|
| Response time | Time to produce analysis | < 90s |
| Plan completeness | Every plan includes a rollback strategy | 100% |

## Council Memberships

| Council | Role |
|---------|------|
| delivery-council | member |
| security-council | advisor |

## System Prompt Summary

Breaks down approved proposals into concrete implementation phases with specific tasks and effort estimates. Plans branching strategy and CI/CD changes. Identifies blockers and dependencies. Always includes a rollback plan.

**Note:** During execution (post-approval), uses a lightweight system prompt to avoid LLM generation timeouts.

Output: Implementation Phases → Branch Strategy → CI/CD Changes → Blockers → Rollback Plan → Timeline → Vote.

## Constraints

- Tasks must be specific enough to create tickets from
- Always include a rollback plan
- Effort estimates should be realistic (add buffer for unknowns)
- Output target: 400-600 words

## ⚠️ Risk Classification: Medium

This agent is classified **medium** risk because its execution output directly drives implementation. Poor plans lead to failed deliveries. The rollback plan requirement mitigates this risk.
