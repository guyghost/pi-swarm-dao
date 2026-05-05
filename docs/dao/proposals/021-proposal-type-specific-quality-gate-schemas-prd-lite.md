# 📝 PRD Lite — Proposal #21

## Objective
### Title
Proposal-Type-Specific Quality Gate Schemas

### Type
technical-change

### Problem
All five proposal types currently pass through identical quality gate checks. A security-change and a product-feature have the same required fields, risk thresholds, and review criteria, which means low-risk proposals face unnecessary friction while high-risk ones slip through with insufficient scrutiny.

## User Stories
### US-1: Gate Schema Registry Definition
**As a** user, **I want** Gate Schema Registry Definition, **so that** I achieve my goal.
**Acceptance Criteria:**
- [ ] [ ] AC1: A `gateSchemas` map exists keyed by all 5 proposal types, each containing `requiredFields`, `requiredSections`, and `riskThresholdOverrides` (optional)
- [ ] [ ] AC2: Adding a new proposal type to the system without a corresponding schema entry causes a clear error at schema resolution time
- [ ] [ ] AC3: Each schema is a plain data object (no behavior), consumable by `dao_check` without coupling to type-specific logic

### US-2: Type-Specific Required Fields Validation
**As a** user, **I want** Type-Specific Required Fields Validation, **so that** I achieve my goal.
**Acceptance Criteria:**
- [ ] [ ] AC1: `security-change` proposals missing an `impactAssessment` field are rejected with a message listing the missing field
- [ ] [ ] AC2: `product-feature` proposals missing `userStories` are rejected with a descriptive error
- [ ] [ ] AC3: `governance-change` proposals missing a `migrationPath` field are rejected
- [ ] [ ] AC4: Proposals satisfying all type-required fields pass this validation step

### US-3: Type-Specific Required Sections Validation
**As a** user, **I want** Type-Specific Required Sections Validation, **so that** I achieve my goal.
**Acceptance Criteria:**
- [ ] [ ] AC1: `security-change` descriptions must contain a `## Threat Model` section heading (case-insensitive match)
- [ ] [ ] AC2: `product-feature` descriptions must contain a `## User Stories` section heading
- [ ] [ ] AC3: `technical-change` descriptions must contain a `## Technical Design` section heading
- [ ] [ ] AC4: Missing sections produce a validation error listing which sections are absent

### US-4: Per-Type Risk Threshold Overrides
**As a** user, **I want** Per-Type Risk Threshold Overrides, **so that** I achieve my goal.
**Acceptance Criteria:**
- [ ] [ ] AC1: If a schema defines `riskThresholdOverrides`, `dao_check` applies those thresholds instead of global defaults for that proposal type
- [ ] [ ] AC2: If no override is defined, global config thresholds apply unchanged (backward compatible)
- [ ] [ ] AC3: Override values are validated to be within acceptable ranges (e.g., risk score 1-10)

### US-5: Graceful Gate Failure with Actionable Feedback
**As a** user, **I want** Graceful Gate Failure with Actionable Feedback, **so that** I achieve my goal.
**Acceptance Criteria:**
- [ ] [ ] AC1: Validation failures return a structured object with `passed: false` and a `failures` array listing each failed check with field/section name and expected vs. actual state
- [ ] [ ] AC2: Validation failures are appended to the proposal's audit trail
- [ ] [ ] AC3: Successful validation returns `passed: true` with a list of checks performed

## In Scope
- ### Title

## Out of Scope
- Auto-generation or scaffolding of required fields/sections (covered by separate template proposal #20)
- Type-specific review queues or routing to councils
- Changes to the `dao_deliberate` or `dao_execute` pipelines beyond `dao_check`
- UI/TUI rendering of validation reports
- Migration of existing proposals to conform to new schemas (only new proposals are validated)

## Metrics
| Metric | Baseline | Target |
|--------|----------|--------|
| Avg. proposal revision cycles | ~2-3 (estimated) | ≤1.5 |
| First-pass approval rate | Unknown/low | 60%+ |
| Security proposals missing impact assessment | Unknown | 0% |
| Time from draft to approved submission | High (friction) | -30% reduction |

## Open Questions
- Should `release-change` and `technical-change` have distinct schemas or share a common "delivery" schema? The current description only specifies 3 of 5 types explicitly.
- What is the expected behavior for proposals created before this change — should `dao_check` apply schemas retroactively, or only to proposals created after the feature is active?
- Are risk threshold overrides intended to be configurable per-project (in DAO config), or hardcoded in the schema definitions?
