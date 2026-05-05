# 🧪 Test Plan — Proposal #21

## Unit Tests
| Target | Description |
|--------|-------------|
| US-1 | Verify Gate Schema Registry Definition: [ ] AC1: A `gateSchemas` map exists keyed by all 5 proposal types, each containing `requiredFields`, `requiredSections`, and `riskThresholdOverrides` (optional) |
| US-2 | Verify Type-Specific Required Fields Validation: [ ] AC1: `security-change` proposals missing an `impactAssessment` field are rejected with a message listing the missing field |
| US-3 | Verify Type-Specific Required Sections Validation: [ ] AC1: `security-change` descriptions must contain a `## Threat Model` section heading (case-insensitive match) |
| US-4 | Verify Per-Type Risk Threshold Overrides: [ ] AC1: If a schema defines `riskThresholdOverrides`, `dao_check` applies those thresholds instead of global defaults for that proposal type |
| US-5 | Verify Graceful Gate Failure with Actionable Feedback: [ ] AC1: Validation failures return a structured object with `passed: false` and a `failures` array listing each failed check with field/section name and expected vs. actual state |

## Integration Tests
- **End-to-end flow:** Verify the complete user flow from proposal description

## E2E Tests
### Gate Schema Registry Definition
As user, Gate Schema Registry Definition — verify I achieve my goal

### Type-Specific Required Fields Validation
As user, Type-Specific Required Fields Validation — verify I achieve my goal

### Type-Specific Required Sections Validation
As user, Type-Specific Required Sections Validation — verify I achieve my goal

### Per-Type Risk Threshold Overrides
As user, Per-Type Risk Threshold Overrides — verify I achieve my goal

### Graceful Gate Failure with Actionable Feedback
As user, Graceful Gate Failure with Actionable Feedback — verify I achieve my goal

## Non-Regression Checks
- **Guardrail 1:** Implement a base schema with shared fields, then per-type extension schemas — not 5 fully independent schemas.
- **Guardrail 2:** Grandfather all existing proposals (open and future proposals created before deployment) from new required fields.
- **Guardrail 3:** Make per-type schema definitions configurable (JSON/YAML), not hardcoded, so they can be amended through governance-change proposals without code changes.
- **Guardrail 4:** Add a type-integrity check — proposal type should be validated or locked after creation to prevent type-reclassification to bypass stricter schemas.
- **Guardrail 5:** Coordinate scope with Proposal #24 before implementation to avoid duplicated template/gate enforcement logic.

## Test Environments
- dev
- staging
- prod
