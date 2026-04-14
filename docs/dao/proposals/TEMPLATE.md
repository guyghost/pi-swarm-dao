# Proposal Template

Use this template when creating a new DAO proposal.

```markdown
# [Proposal Title]

## Type
[product-feature | security-change | technical-change | release-change | governance-change]

## Problem Statement
What specific problem does this solve? Why now?

## Proposed Solution
Brief description of the approach.

## Target User
Who benefits from this?

## Expected Outcome
What changes after this is implemented?

## Success Metrics
| Metric | Current | Target | Timeframe |
|--------|---------|--------|-----------|
| ... | ... | ... | ... |

## Scope
### In Scope
- Item 1
- Item 2

### Out of Scope
- Explicitly excluded item 1

## Technical Options
1. Option A: [brief description]
2. Option B: [brief description]

## Risks
- Risk 1: [description + mitigation]

## Dependencies
- Dependency 1: [description]

## Estimated Effort
[e.g., "2 weeks", "3-5 days"]

## Confidence Score
[1-10 — how confident are you this is the right approach?]
```

## Creating a Proposal

```
dao_propose(
  title: "Your Proposal Title",
  type: "technical-change",
  description: "... (fill in the sections above) ...",
  context: "Additional context (market data, prior decisions, etc.)"
)
```

## Tips

1. **Be specific** — Vague proposals get rejected or returned for revision (see Proposal #1)
2. **Include metrics** — Quantitative targets make acceptance criteria testable
3. **Define exclusions** — Explicit "out of scope" prevents scope creep
4. **Reference history** — If resubmitting, note what changed from the prior attempt
5. **Choose the right type** — Each type has different quorum/approval thresholds
