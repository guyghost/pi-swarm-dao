# 🔒 Risk Report — Proposal #19

**Overall Risk Score:** 4/10 (medium)

## Risk Assessment
| Category | Description | Severity | Likelihood | Mitigation |
|----------|-------------|----------|------------|------------|
| Composite score gamification — agents optimize for score, not quality | Composite score gamification — agents optimize for score, no | medium | medium | Make score advisory, not a gate; weight outcome quality over |
| Sparse data produces misleading trends (low proposal volume per week) | Sparse data produces misleading trends (low proposal volume  | medium | high | Require minimum sample size before rendering trends; show co |
| Score formula becomes opinionated and contested | Score formula becomes opinionated and contested | medium | medium | Start with fixed weights documented openly; make weighting c |
| Performance regression scanning all historical proposals on every `dao_dashboard` call | Performance regression scanning all historical proposals on  | low | medium | Pre-compute and cache scores; incrementally update on propos |
| Metric definitions drift from implementation intent | Metric definitions drift from implementation intent | low | medium | Define each metric precisely in the PRD with edge cases (e.g |

## Permissions
- No specific permission changes identified

## Data Surfaces
- No critical data surfaces identified

## Guardrails
- Standard review practices apply
