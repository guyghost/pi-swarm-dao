# Decisions — Index

This directory contains decision records for all resolved proposals.

## Naming Convention

```
NNN-[status]-[slug].md
```

Examples:
- `001-rejected-performance-optimization.md`
- `002-approved-performance-optimization-v2.md`
- `003-executed-performance-optimization.md`

## Status Labels

| Status | Icon | Description |
|--------|------|-------------|
| Rejected | ❌ | Failed quorum or approval |
| Approved | ✅ | Passed deliberation (may not be executed yet) |
| Controlled | 🔒 | Passed control gates |
| Executed | 🚀 | Fully executed |
| Failed | ⚠️ | Execution failed |

## Decision Record Template

```markdown
# Decision #[NNN]: [Title]

**Date:** YYYY-MM-DD
**Type:** [proposal type]
**Status:** [status]
**Zone:** [risk zone]
**Score:** [composite score]/100

## Decision
[Brief summary of what was decided]

## Rationale
[Why this decision was made — from deliberation synthesis]

## Vote Tally
| Agent | Vote | Weight | Key Point |
|-------|------|--------|-----------|
| ... | for/against/abstain | N | ... |

## Risks Accepted
- [Risks identified during deliberation that were accepted]

## Follow-up Actions
- [ ] [Action 1]
- [ ] [Action 2]
```

## Current Decisions

| # | Title | Status | Score | Date |
|---|-------|--------|-------|------|
| 1 | Performance Optimization & Refactoring | ❌ Rejected | 53 | 2026-04-14 |
| 2 | Performance Optimization & Refactoring v2 | ⚠️ Failed | 55 | 2026-04-14 |
| 3 | Performance Optimization & Refactoring | 🚀 Executed | 55 | 2026-04-14 |
