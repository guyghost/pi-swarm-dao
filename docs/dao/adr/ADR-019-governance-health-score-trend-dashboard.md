# 🏗️ ADR-019: Governance Health Score & Trend Dashboard

**Status:** accepted

## Context
### Title
Governance Health Score & Trend Dashboard

### Type
product-feature

### Problem
Teams have no way to assess whether their DAO governance process is actually working well over time — outcome ratings (#13) exist in isolation, with no aggregate signal on proposal velocity, deliberation quality, or agent participation trends.

### Solution
Compute a composite Governance Health Score (0–100) from proposal pass rate, average outcome rating, deliberation depth, and agent participation, then expose it via `dao_dashboard` with week-over-week trend tracking and per-metric breakdowns so teams can diagnose what's working and what's drifting.

### Why Now
The safety layer is complete (#14, #15); the strategic next step is observability — without a health signal, teams can't justify the DAO overhead or iteratively improve their configuration, which is the #1 adoption risk.

## Decision
Let me examine the existing codebase to understand the current architecture before proposing options.

## Options
### Primary approach ✅ SELECTED
See architect analysis for details

## Consequences
- To be defined during implementation

## Rejected Alternatives
- None explicitly documented
