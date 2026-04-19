# Offline-First Storage Policy

## Decision

The DAO now uses an **offline-first storage model**.

This means:

1. The local project directory `.dao/` is the primary durable store.
2. GitHub sync is **optional** and can be enabled or disabled.
3. Pi runtime state is a cache only.
4. If local `.dao/` state and runtime memory diverge, `.dao/` wins.
5. If GitHub sync is enabled, GitHub acts as a remote mirror and collaboration surface, not the only source of truth.

## Storage Layers

| Layer | Role | Required |
|------|------|----------|
| `.dao/` | Primary local durable store | Yes |
| GitHub Issues + comments | Optional remote sync and audit trail | No |
| Pi runtime memory | Working cache / read model | No |

## `.dao/` Directory Layout

The DAO stores its local state inside the current project root:

```text
.dao/
  config.json
  state.json
  proposals/
    001.json
    002.json
  decisions/
    index.json
    001.json
    002.json
```

### Files

- `config.json` — offline-first storage settings
- `state.json` — full local DAO state snapshot
- `proposals/*.json` — per-proposal local records
- `decisions/index.json` — compact list of resolved or governed decisions
- `decisions/*.json` — decision records for proposals that reached a meaningful decision state

## Configuration

Storage is configured through `.dao/config.json`.

Example:

```json
{
  "version": 1,
  "mode": "offline-first",
  "githubSyncEnabled": true
}
```

### Rules

- `githubSyncEnabled: true` → DAO writes to local `.dao/` and mirrors to GitHub
- `githubSyncEnabled: false` → DAO writes only to local `.dao/`

## Canonical Rules

### Local canonical state
The canonical local state lives in `.dao/state.json` and `.dao/proposals/*.json`.

### GitHub optional sync
If GitHub sync is enabled:

- proposals may be mirrored to GitHub Issues
- lifecycle events may be mirrored to GitHub comments
- artefact links may be mirrored to GitHub comments

If GitHub is unavailable or disabled, the DAO must still function normally.

## Restore Order

On startup, restore should follow this priority:

1. `.dao/state.json`
2. session cache (if available)
3. GitHub restore (only as fallback and only if sync is enabled)
4. empty initial state

This preserves offline resilience and avoids remote state unexpectedly overwriting local work.

## Artefacts

Durable artefacts remain versioned in the repository under `docs/dao/`.

The `.dao/` directory tracks DAO state and decisions; `docs/dao/` tracks the durable project-facing records.

## Operational Guarantees

With this policy:

- the DAO can run without network access
- local decision history remains attached to the project
- GitHub can be disabled without breaking DAO behavior
- GitHub can be re-enabled later for remote visibility and audit

## Relationship to Previous GitHub-First Policy

The earlier GitHub-first model is now superseded by this offline-first policy.

GitHub remains useful, but it is no longer required for the DAO to be durable or operational.
