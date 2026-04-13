# DAO Automatic Artefacts Generation

## Goal
Every approved proposal must automatically produce 7 artefacts after `dao_check` passes.

## Checklist
- [x] Extend types.ts with artefact types and state (8 interfaces: DecisionBrief, ADR, RiskReport, PRDLite, ImplementationPlan, TestPlan, ReleasePacket, DAOArtefacts)
- [x] Create delivery/artefacts.ts with all 7 generators + 8 formatters + orchestrator
- [x] Integrate artefact generation in dao_check tool (auto-generate when all gates pass)
- [x] Add dao_artefacts tool to index.ts (with per-artefact filtering)
- [x] Update render.ts with artefacts section in dashboard
- [x] Update persistence.ts with backward-compatible migration for artefacts field
- [x] Remove old artifacts.ts (replaced by artefacts.ts)
- [x] Verify TypeScript compiles cleanly

## Status: COMPLETE
