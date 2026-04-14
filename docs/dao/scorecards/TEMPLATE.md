# Scorecard Template — Agent Performance

Use this template to track agent performance across deliberations.

```markdown
# Scorecard — [Agent Name]

**Period:** YYYY-MM-DD to YYYY-MM-DD
**Agent ID:** [id]

## Performance Summary

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Response time | < 90s | -- | -- |
| Vote consistency | > 90% | -- | -- |
| Participation rate | > 80% | -- | -- |
| Timeout rate | < 5% | -- | -- |
| Error rate | < 2% | -- | -- |

## Deliberation History

| Proposal | Vote | Duration | Status | Notes |
|----------|------|----------|--------|-------|
| #1 | for/against/abstain | Xs | ✅/⚠️/❌ | ... |

## Trends
- [Observations about performance over time]

## Recommendations
- [Suggested changes: model, weight, system prompt, timeout]
```

## Scoring Dimensions

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Reliability | 30% | % of deliberations completed without error/timeout |
| Speed | 20% | Average response time vs target |
| Quality | 30% | Relevance and depth of analysis |
| Consistency | 20% | Vote alignment with analysis content |
