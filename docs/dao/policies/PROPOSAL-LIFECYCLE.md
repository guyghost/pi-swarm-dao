# Proposal Lifecycle Policy

## Pipeline Stages

Every proposal follows a 10-stage pipeline:

```
intake → qualification → analysis → critique → scoring →
council → vote → spec → execution-gate → postmortem
```

## Status Mapping

| Pipeline Stage | Status |
|---------------|--------|
| intake, qualification | `open` |
| analysis, critique, scoring, council, vote | `deliberating` |
| spec, execution-gate | `controlled` |
| postmortem | `executed` |

## Status Transitions

```
open → deliberating → approved → controlled → executed
                            ↓          ↓
                         rejected    failed
                                        ↓
                                    controlled (retry)
```

| From | To |
|------|----|
| `open` | `deliberating` |
| `deliberating` | `approved`, `rejected`, `controlled` |
| `approved` | `controlled`, `rejected` |
| `controlled` | `executed`, `failed` |
| `failed` | `controlled` (retry) |
| `rejected`, `executed` | — (terminal) |

## Deliberation Flow

1. **Propose** — User creates a proposal via `dao_propose`
2. **Deliberate** — All 7 agents analyze in parallel via `dao_deliberate`
   - Agents receive the proposal + their specialized system prompt
   - Max concurrency: `config.maxConcurrent` (default: 4)
   - Per-agent timeout: 120s (from `stopConditions`)
   - Timed-out agents are retried once with 1.5x timeout
3. **Tally** — Votes are counted by weight
   - Quorum: % of total weight that voted (not just agents)
   - Approval: % of voting weight that voted "for"
4. **Resolve** — Approved or rejected based on thresholds

## Control Flow

5. **Check** — `dao_check` runs 4 gates + checklist
   - `quorum-quality`: Was quorum met?
   - `risk-threshold`: Is risk score below 7?
   - `vote-consensus`: Did any high-weight agents vote against?
   - `zone-compliance`: Is the risk zone appropriate?
6. **Plan** — `dao_plan` generates phased delivery plan
7. **Artefacts** — `dao_artefacts` generates 7 documents

## Delivery Flow

8. **Execute** — `dao_execute` delegates to Delivery Agent
   - Uses lightweight execution prompt (not full deliberation prompt)
   - Internal timeout: 300s
   - Pi's AbortSignal is NOT forwarded (prevents premature kill)
9. **Audit** — Full trail recorded via `dao_audit`

## Proposal Types

| Type | Quorum | Approval | Council |
|------|--------|----------|---------|
| product-feature | 60% | 55% | product-council |
| security-change | 75% | 70% | security-council |
| technical-change | 60% | 55% | product + delivery |
| release-change | 50% | 51% | delivery + security |
| governance-change | 70% | 66% | governance-council |
