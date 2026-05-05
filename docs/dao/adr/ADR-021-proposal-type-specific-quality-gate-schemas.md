# 🏗️ ADR-021: Proposal-Type-Specific Quality Gate Schemas

**Status:** accepted

## Context
### Title
Proposal-Type-Specific Quality Gate Schemas

### Type
technical-change

### Problem
All five proposal types currently pass through identical quality gate checks. A security-change and a product-feature have the same required fields, risk thresholds, and review criteria, which means low-risk proposals face unnecessary friction while high-risk ones slip through with insufficient scrutiny.

### Solution
Define per-type gate schemas (required fields, mandatory sections, risk threshold overrides) so that `security-change` requires an impact assessment and threat model, `product-feature` requires user stories and success metrics, and `governance-change` requires a migration path.

## Decision
**Option A (Schema Registry)** — This is the right level of abstraction for the current system. The project has 5 well-known proposal types and no evidence of user demand for custom types. Shipping static schemas keeps the implementation simple, type-safe, and testable. If/when custom proposal types or per-project overrides become a real requirement, Option C's config override layer can be added on top without rearchitecting. YAGNI applies here.

## Options
### Schema Registry with Per-Type Gate Definitions ✅ SELECTED
**Approach:*Create a `GateSchemaRegistry` that maps each proposal type to a typed schema object defining: required fields, mandatory description sections (via heading detection), and risk threshold overrides. The existing `qualityGate()` function dispatches to the correct schema based on `proposal.
**Pros:**
- **Approach:** Create a `GateSchemaRegistry` that maps each proposal type to a typed schema object defining: required fields, mandatory description sections (via heading detection), and risk threshold overrides. The existing `qualityGate()` function dispatches to the correct schema based on `proposal.type` and validates accordingly. Schemas are defined as static TypeScript objects in a new `src/gates/schemas/` directory.
- **Pros:** Minimal change to existing architecture — extends the current qualityGate module. Schemas are type-safe, discoverable, and easy to unit test in isolation. Fits naturally with the existing `ProposalType` enum.
- **Cons:** Schema definitions are code changes, not user-configurable. Adding a new proposal type requires a code change + PR. Risk of schema drift if types are added without corresponding schemas.
- **Effort:** Medium — new module + refactoring `qualityGate()` + per-type tests.
- **Scalability:** Good for the 5 current types. Would need a plugin mechanism if types become dynamic.
**Cons:**
- **Approach:** Create a `GateSchemaRegistry` that maps each proposal type to a typed schema object defining: required fields, mandatory description sections (via heading detection), and risk threshold overrides. The existing `qualityGate()` function dispatches to the correct schema based on `proposal.type` and validates accordingly. Schemas are defined as static TypeScript objects in a new `src/gates/schemas/` directory.
- **Pros:** Minimal change to existing architecture — extends the current qualityGate module. Schemas are type-safe, discoverable, and easy to unit test in isolation. Fits naturally with the existing `ProposalType` enum.
- **Cons:** Schema definitions are code changes, not user-configurable. Adding a new proposal type requires a code change + PR. Risk of schema drift if types are added without corresponding schemas.
- **Effort:** Medium — new module + refactoring `qualityGate()` + per-type tests.
- **Scalability:** Good for the 5 current types. Would need a plugin mechanism if types become dynamic.

### Configurable Schema with YAML/JSON Definitions
**Approach:*Define gate schemas in a configuration file (e.g.
**Pros:**
- **Approach:** Define gate schemas in a configuration file (e.g., `.dao/gate-schemas.yml`) that users can customize per project. The quality gate reads the config at validation time and checks against the matching type schema. Includes a built-in default schema that ships with the extension.
- **Pros:** Fully user-configurable — teams can tighten or relax gates per project without code changes. Decouples schema evolution from release cycles. Aligns with the existing `DaoConfig` pattern.
- **Cons:** More complex to implement — schema validation for the schema definitions themselves (meta-validation). Harder to test. Configuration errors produce confusing failures. YAML parsing adds a dependency.
- **Effort:** High — config parsing, meta-validation, default schemas, migration, docs.
- **Scalability:** Excellent — supports custom proposal types, per-project overrides, and community-shared schemas.
**Cons:**
- **Approach:** Define gate schemas in a configuration file (e.g., `.dao/gate-schemas.yml`) that users can customize per project. The quality gate reads the config at validation time and checks against the matching type schema. Includes a built-in default schema that ships with the extension.
- **Pros:** Fully user-configurable — teams can tighten or relax gates per project without code changes. Decouples schema evolution from release cycles. Aligns with the existing `DaoConfig` pattern.
- **Cons:** More complex to implement — schema validation for the schema definitions themselves (meta-validation). Harder to test. Configuration errors produce confusing failures. YAML parsing adds a dependency.
- **Effort:** High — config parsing, meta-validation, default schemas, migration, docs.
- **Scalability:** Excellent — supports custom proposal types, per-project overrides, and community-shared schemas.

### Hybrid — Code-Defined Defaults + Config Overrides
**Approach:*Ship per-type schemas as code (like Option A) but allow optional overrides via a `gateOverrides` field in `DaoConfig`. The quality gate merges defaults with config overrides (config wins).
**Pros:**
- **Approach:** Ship per-type schemas as code (like Option A) but allow optional overrides via a `gateOverrides` field in `DaoConfig`. The quality gate merges defaults with config overrides (config wins). This gives sensible defaults out-of-the-box while allowing project-specific tuning.
- **Pros:** Best of both worlds — works immediately with zero config, but customizable when needed. Incremental — start with code-only defaults, add config override layer later.
- **Cons:** Merge logic adds complexity (deep merge of schema objects). Two sources of truth can confuse debugging ("why is my gate failing?" → check config overrides).
- **Effort:** Medium-High — Option A scope + config merge layer.
- **Scalability:** Very good — handles current needs and future customization.
**Cons:**
- **Approach:** Ship per-type schemas as code (like Option A) but allow optional overrides via a `gateOverrides` field in `DaoConfig`. The quality gate merges defaults with config overrides (config wins). This gives sensible defaults out-of-the-box while allowing project-specific tuning.
- **Pros:** Best of both worlds — works immediately with zero config, but customizable when needed. Incremental — start with code-only defaults, add config override layer later.
- **Cons:** Merge logic adds complexity (deep merge of schema objects). Two sources of truth can confuse debugging ("why is my gate failing?" → check config overrides).
- **Effort:** Medium-High — Option A scope + config merge layer.
- **Scalability:** Very good — handles current needs and future customization.

## Consequences
- **Risk 1: Schema too strict for legitimate edge cases.** Mitigation: include an "escape hatch" in each schema (e.g., a `bypassReason` optional field that agents can set, logged for audit). Start with minimal required fields and tighten based on observed quality issues.
- **Risk 2: Breaking existing proposals that would fail new required fields.** Mitigation: schemas only apply to proposals created after the change. Add a `schemaVersion` field to proposals; legacy proposals skip new gates or get auto-migrated.

## Rejected Alternatives
- Configurable Schema with YAML/JSON Definitions
- Hybrid — Code-Defined Defaults + Config Overrides
