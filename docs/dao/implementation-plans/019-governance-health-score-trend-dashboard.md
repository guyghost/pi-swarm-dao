# 🗂️ Implementation Plan — Proposal #19

**Estimated Duration:** ** 2 weeks (36 hours effort across 10 days)
**Branch Strategy:** - **Main branch:** `main` — protected, requires passing CI + 1 review
- **Feature branch:** `feat/19-governance-health-dashboard`
- **Review process:** Single PR with squashed merge after CI green; tag `proposal-19` on PR

## Phase 1: Health Score Computation Engine
| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 1.1 | Define `HealthScore` type with per-metric breakdowns (passRate, avgRating, deliberationDepth, agentParticipation) | 2h | — |
| 1.2 | Implement `computeHealthScore()` in new `src/health-score.ts` — reads proposals from storage, calculates each sub-metric, returns composite 0–100 score with weights | 6h | — |
| 1.3 | Implement week-over-week snapshotting — store weekly score snapshots in a new `healthSnapshots` field in storage (append-only, keyed by ISO week) | 3h | — |
| 1.4 | Unit tests for score computation (edge cases: no proposals, all rejected, single agent) | 3h | — |

## Phase 2: Trend Tracking & Diff Logic
| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 2.1 | Implement `computeTrend(current, previous)` — returns per-metric deltas and overall direction (↑↓→) | 2h | — |
| 2.2 | Add `snapshotWeeklyScore()` hook — call after each `dao_deliberate` completion to auto-capture the week's score | 2h | — |
| 2.3 | Unit tests for trend calculation (direction detection, boundary weeks, missing snapshots) | 2h | — |

## Phase 3: Dashboard Integration
| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 3.1 | Extend `dao_dashboard` command to render Health Score section (overall score, per-metric bars, trend arrows) above existing content | 4h | — |
| 3.2 | Add `--trend` flag to `dao_dashboard` showing week-over-week table (last 8 weeks) | 3h | — |
| 3.3 | Add `--json` output for programmatic consumption | 1h | — |
| 3.4 | Integration tests (full dashboard output with mock data) | 3h | — |

## Phase 4: Polish & Edge Cases
| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 4.1 | Handle cold-start gracefully — show "building baseline" message when <2 weeks of data | 1h | — |
| 4.2 | Add configurable metric weights via DAO config (default: 25/25/25/25) | 2h | — |
| 4.3 | Update README with dashboard screenshots/docs | 2h | — |

**Critical Path:** 1.1 → 1.2 → 1.3 → 1.4 → 2.1
