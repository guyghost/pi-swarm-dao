# 📝 PRD Lite — Proposal #19

## Objective
### Title
Governance Health Score & Trend Dashboard

### Type
product-feature

### Problem
Teams have no way to assess whether their DAO governance process is actually working well over time — outcome ratings (#13) exist in isolation, with no aggregate signal on proposal velocity, deliberation quality, or agent participation trends.

### Solution
Compute a composite Governance Health Score (0–100) from proposal pass rate, average outcome rating, deliberation depth, and agent participation, then expose it via `dao_dashboard` with week-over-week trend tracking and per-metric breakdowns so teams can diagnose what's working and what's drifting.

## User Stories
### US-1: View Composite Health Score
**As a** user, **I want** View Composite Health Score, **so that** I achieve my goal.
**Acceptance Criteria:**
- [ ] [ ] AC1: `dao_dashboard` output includes a "Governance Health Score" line displaying an integer 0–100
- [ ] [ ] AC2: Score is `—` (dash) when fewer than 3 proposals exist in the data window (insufficient data signal)
- [ ] [ ] AC3: Score is computed from the 4 defined metrics: pass rate, avg outcome rating, deliberation depth, agent participation
- [ ] [ ] AC4: Each metric is normalized to 0–100 before weighting and aggregation
- [ ] [ ] AC5: Default weights are 25% per metric; total weights sum to 100%

### US-2: Per-Metric Breakdown
**As a** user, **I want** Per-Metric Breakdown, **so that** I achieve my goal.
**Acceptance Criteria:**
- [ ] [ ] AC1: Dashboard displays a table listing all 4 metrics with columns: Metric Name, Raw Value, Normalized Score (0–100), Weight (%)
- [ ] [ ] AC2: Each raw value is human-readable (e.g., "72% pass rate", "3.8/5 avg rating", "4.2 avg comments", "78% participation")
- [ ] [ ] AC3: Weighted contributions sum to the composite health score

### US-3: Week-Over-Week Trend
**As a** user, **I want** Week-Over-Week Trend, **so that** I achieve my goal.
**Acceptance Criteria:**
- [ ] [ ] AC1: Dashboard displays a trend section with one entry per week for the trailing 8 weeks
- [ ] [ ] AC2: Each entry shows the week label (e.g., "W18", "W19") and the composite score for that period
- [ ] [ ] AC3: Trend reflects only proposals whose lifecycle (creation → outcome) falls within each respective week
- [ ] [ ] AC4: Weeks with zero proposals show `—` rather than 0 (distinguishing inactivity from poor health)
- [ ] [ ] AC5: An arrow indicator (↑ ↓ →) shows direction vs. prior non-dash week

### US-4: Configurable Scoring Weights
**As a** user, **I want** Configurable Scoring Weights, **so that** I achieve my goal.
**Acceptance Criteria:**
- [ ] [ ] AC1: A `healthWeights` config object exists with 4 numeric keys (passRate, avgRating, deliberationDepth, participation) defaulting to 25 each
- [ ] [ ] AC2: Setting weights via `dao_update_config` triggers validation that values are positive numbers summing to 100
- [ ] [ ] AC3: Custom weights are persisted and applied on subsequent `dao_dashboard` calls

## In Scope
- ### Title

## Out of Scope
- Alerting or notifications when the health score drops below a threshold
- Historical data export (CSV/JSON) of the health score time series
- Projected/forecasted health scores
- Per-agent individual health contributions
- Integration with external dashboards (Grafana, Datadog)
- Health score influencing governance flow (e.g., auto-adjusting quorum)

## Metrics
| Metric | Baseline | Target |
|--------|----------|--------|
| Composite score availability | N/A | Exposed in `dao_dashboard` |
| Trend history depth | N/A | ≥8 weeks of weekly snapshots |
| Config adjustment rate | Unknown (baseline) | 2x baseline increase |
| Time to diagnose governance drift | Manual log review | <5 min via dashboard |

## Open Questions
- **Deliberation depth metric:** Should "depth" be measured as average comments per proposal, average deliberation rounds, or a combination? The current deliberation artefact structure needs to be checked.
- **Lookback window:** Should the 8-week trend use calendar weeks (Mon–Sun) or rolling 7-day periods from the current date?
- **Insufficient-data threshold:** Is 3 proposals the right minimum for a meaningful score, or should it scale with team size?
