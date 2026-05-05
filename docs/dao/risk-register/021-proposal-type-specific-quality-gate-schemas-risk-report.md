# 🔒 Risk Report — Proposal #21

**Overall Risk Score:** 4/10 (medium)

## Risk Assessment
| Category | Description | Severity | Likelihood | Mitigation |
|----------|-------------|----------|------------|------------|
| Over-engineering: 5 schemas to maintain instead of 1 | Over-engineering: 5 schemas to maintain instead of 1 | medium | medium | Start with a base schema + per-type deltas, not 5 independen |
| Governance creep: schema defines policy, not just structure | Governance creep: schema defines policy, not just structure | medium | high | Separate schema definitions into configurable policies amend |
| Breaking existing proposals with new required fields | Breaking existing proposals with new required fields | high | medium | Grandfather existing proposals; schemas apply only to new pr |
| Overlap/conflict with Proposal #24 (templates) | Overlap/conflict with Proposal #24 (templates) | medium | medium | Clarify scope boundary: #24 = input templates, #21 = gate va |
| Vague spec leads to implementation ambiguity | Vague spec leads to implementation ambiguity | low | high | Require concrete schema definitions (field names, types, val |

## Permissions
- No specific permission changes identified

## Data Surfaces
- No critical data surfaces identified

## Guardrails
- **Guardrail 1:** Implement a base schema with shared fields, then per-type extension schemas — not 5 fully independent schemas.
- **Guardrail 2:** Grandfather all existing proposals (open and future proposals created before deployment) from new required fields.
- **Guardrail 3:** Make per-type schema definitions configurable (JSON/YAML), not hardcoded, so they can be amended through governance-change proposals without code changes.
- **Guardrail 4:** Add a type-integrity check — proposal type should be validated or locked after creation to prevent type-reclassification to bypass stricter schemas.
- **Guardrail 5:** Coordinate scope with Proposal #24 before implementation to avoid duplicated template/gate enforcement logic.
