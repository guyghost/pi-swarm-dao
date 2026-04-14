# ADR Template — Architecture Decision Record

Use this template for recording architecture decisions made by the DAO.

```markdown
# ADR-[NNN]: [Title]

**Status:** proposed | accepted | deprecated | superseded
**Date:** YYYY-MM-DD
**Proposal:** #[N] (link to DAO proposal)

## Context
What is the issue that we're seeing that is motivating this decision or change?

## Decision
What is the change that we're proposing and/or doing?

## Options Considered

### Option A: [Name] ✅ SELECTED
- **Approach:** Brief description
- **Pros:** Key advantages
- **Cons:** Key disadvantages
- **Effort:** Low / Medium / High
- **Scalability:** Assessment

### Option B: [Name]
- **Approach:** Brief description
- **Pros:** Key advantages
- **Cons:** Key disadvantages
- **Effort:** Low / Medium / High
- **Scalability:** Assessment

## Consequences
- **Consequence 1:** [description]
- **Consequence 2:** [description]

## Rejected Alternatives
- Option B: [why it was rejected]
```

## ADR Numbering

- ADRs are numbered sequentially: ADR-001, ADR-002, ...
- The number matches the DAO proposal ID when generated from deliberation
- Example: Proposal #2 → ADR-002

## Status Lifecycle

```
proposed → accepted → deprecated → superseded
                  ↘ (rejected)
```

| Status | Meaning |
|--------|---------|
| proposed | Under deliberation |
| accepted | Approved by DAO, in effect |
| deprecated | No longer recommended |
| superseded | Replaced by a newer ADR |
