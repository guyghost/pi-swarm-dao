# GitHub-First Source of Truth Policy

> **Superseded:** The DAO now uses the offline-first model described in [OFFLINE-FIRST-STORAGE.md](OFFLINE-FIRST-STORAGE.md).

## Historical Decision

Before offline-first storage, the DAO used **GitHub + git as the canonical source of truth**.

This means:

1. **GitHub Issues** are the canonical record for proposals and lifecycle events.
2. **Git-tracked files in the repository** are the canonical record for durable artefacts.
3. **Pi runtime state** is a cache and read model only. If runtime state and GitHub diverge, **GitHub wins**.

## Canonical Mapping

| DAO concept | Canonical location |
|-------------|--------------------|
| Proposal | GitHub Issue |
| Proposal ID | GitHub issue number |
| Status | GitHub labels |
| Type | GitHub labels |
| Risk zone | GitHub labels |
| Deliberation votes | GitHub issue comments |
| Synthesis | GitHub issue comments |
| Control results | GitHub issue comments |
| Execution results | GitHub issue comments |
| Verification results | GitHub issue comments |
| Outcome tracking | GitHub issue comments |
| Dry-run / snapshot / rollback trail | GitHub issue comments |
| Decision brief / ADR / risk report / PRD / plans / release packet | Versioned files under `docs/dao/` |

## Proposal Model

Each DAO proposal is represented by **one GitHub issue**.

### Issue body
The issue body contains:

- human-readable proposal summary
- structured proposal sections when available
- a **machine-readable JSON snapshot** embedded in the body

The machine-readable block is the durable serialization used to reconstruct proposal state.

### Labels
Labels are the canonical source for proposal classification:

- `dao-proposal`
- `dao-status:*`
- `dao-type:*`
- `dao-zone:*`

Examples:

- `dao-status:approved`
- `dao-type:technical-change`
- `dao-zone:orange`

## Event Model

DAO lifecycle events are appended as **structured issue comments**.

Each event comment starts with a parseable marker:

```html
<!-- dao:event { ...json... } -->
```

Current event families include:

- `audit`
- `vote`
- `synthesis`
- `control`
- `plan`
- `artefacts`
- `execution`
- `verification`
- `outcome`
- `snapshot`
- `rollback`
- `implemented`

These comments are both:

- readable by humans in GitHub
- reconstructible by the DAO read model on session restore

## Durable Artefacts

Long-lived artefacts must exist as files in the repository, not only in memory or comments.

Current file families:

- `docs/dao/decisions/`
- `docs/dao/adr/`
- `docs/dao/risk-register/`
- `docs/dao/proposals/`
- `docs/dao/implementation-plans/`
- `docs/dao/test-plans/`
- `docs/dao/release-packets/`

The GitHub issue stores a summary comment plus links or paths to these files.

## Reconstruction Rules

On startup or restore:

1. list DAO issues from GitHub
2. parse issue bodies and labels
3. load structured event comments
4. rebuild proposal state
5. rebuild derived stores such as:
   - control results
   - delivery plans
   - artefact file references
   - verification results
   - outcomes
   - snapshots

If local cache and GitHub differ, the restored GitHub state is authoritative.

## Conflict Resolution

### GitHub vs runtime memory
**GitHub is authoritative.**

### GitHub comment vs derived runtime object
**GitHub event data is authoritative.**

### GitHub issue vs versioned artefact file
- issue is authoritative for lifecycle and event trail
- git file is authoritative for the final durable artefact content

## Operational Rules

- Do not create DAO proposals only in memory.
- Do not treat Pi session snapshots as the durable store.
- Do not keep final artefacts only in issue comments.
- Always prefer a reconstructible GitHub event over opaque runtime-only state.

## Why this policy exists

Without this policy, the DAO has two competing truths:

- session/runtime state
- GitHub project history

That causes drift, weak auditability, and poor restart behavior.

With this policy:

- every important proposal event is visible on the project GitHub
- durable artefacts live in git history
- the DAO can recover after restart from the project repository itself
- humans and agents share the same reference system
