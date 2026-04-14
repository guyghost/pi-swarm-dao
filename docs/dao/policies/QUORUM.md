# Quorum Policy

## Overview

Quorum ensures that enough agents participate in deliberation to make decisions legitimate. Two thresholds govern approval:

1. **Quorum** — Minimum % of total agent weight that must vote
2. **Approval** — Minimum % of voting weight that must be "for"

## Global Defaults

| Parameter | Value |
|-----------|-------|
| Default quorum | 60% |
| Default approval | 55% |
| Risk threshold | 7/10 |
| Max concurrent agents | 4 |
| Quorum floor | 60% |

## Per-Type Thresholds

| Proposal Type | Quorum | Approval | Rationale |
|---------------|--------|----------|-----------|
| product-feature | 60% | 55% | Standard — balances speed with representation |
| security-change | 75% | 70% | Higher bar — security decisions are hard to reverse |
| technical-change | 60% | 55% | Standard — technical changes are reversible |
| release-change | 50% | 51% | Lower bar — releases are operational and reversible |
| governance-change | 70% | 66% | Higher bar — affects the DAO itself |

## Quorum Calculation

Quorum is calculated on **weighted participation**, not agent count:

```
quorumPercent = (sum of weights of agents that voted) / (sum of all agent weights) × 100
```

With 7 agents and total weight 15:
- 3 agents voting (weight 8/15) = 53.3% — **below 60% quorum**
- 4 agents voting (weight 8/15) = 53.3% — **below 60% quorum** (if low-weight agents)
- 5 agents voting (weight 11/15) = 73.3% — **above 60% quorum**

## Approval Calculation

```
approvalScore = (sum of weights voting "for") / (sum of all voting weights) × 100
```

Abstentions count toward quorum but not toward approval.

## Quorum Floor

The quorum floor (60%) is a hard minimum — even governance-change amendments cannot lower quorum below this threshold. This prevents a small minority from making decisions.

## Failed Quorum Recovery

If a proposal fails quorum:
1. The proposal is **rejected** (not failed — it can be resubmitted)
2. Identify which agents didn't participate (timeout, error, abstain)
3. Resubmit a revised proposal addressing gaps
4. Agent reliability issues may be addressed via `dao_update_agent`

## Modifying Quorum

Quorum thresholds can only be changed through:
- `dao_update_config` — changes global defaults
- `dao_propose_amendment` with type `quorum-update` — changes per-type thresholds
- Must pass governance-change flow (70% quorum, 66% approval)
- Cannot go below the quorum floor (60%)
