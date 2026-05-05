# 🧪 Test Plan — Proposal #19

## Unit Tests
| Target | Description |
|--------|-------------|
| US-1 | Verify View Composite Health Score: [ ] AC1: `dao_dashboard` output includes a "Governance Health Score" line displaying an integer 0–100 |
| US-2 | Verify Per-Metric Breakdown: [ ] AC1: Dashboard displays a table listing all 4 metrics with columns: Metric Name, Raw Value, Normalized Score (0–100), Weight (%) |
| US-3 | Verify Week-Over-Week Trend: [ ] AC1: Dashboard displays a trend section with one entry per week for the trailing 8 weeks |
| US-4 | Verify Configurable Scoring Weights: [ ] AC1: A `healthWeights` config object exists with 4 numeric keys (passRate, avgRating, deliberationDepth, participation) defaulting to 25 each |

## Integration Tests
- **End-to-end flow:** Verify the complete user flow from proposal description

## E2E Tests
### View Composite Health Score
As user, View Composite Health Score — verify I achieve my goal

### Per-Metric Breakdown
As user, Per-Metric Breakdown — verify I achieve my goal

### Week-Over-Week Trend
As user, Week-Over-Week Trend — verify I achieve my goal

### Configurable Scoring Weights
As user, Configurable Scoring Weights — verify I achieve my goal

## Non-Regression Checks
- Existing functionality remains unchanged

## Test Environments
- dev
- staging
- prod
