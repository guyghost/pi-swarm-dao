# Context: Typed Proposals

## Objective
Add 5 structured proposal types (feature, security, ux, release, policy) to the DAO so it only accepts typed proposals. Agents adapt their analysis per type.

## Constraints
- Platform: Pi extension (TypeScript)
- Use `StringEnum` from `@mariozechner/pi-ai` for tool parameters
- Security proposals: `security-review` gate promoted to blocker
- All 7 agent prompts must include type-specific guidance

## Technical Decisions
| Decision | Justification | Agent |
|----------|---------------|-------|
| StringEnum for type param | Google API compatibility | @orchestrator |
| Security gate promotion | Security proposals: `risk-threshold` gate promoted to blocker. Release proposals: `delivery-feasibility` promoted to blocker. | @orchestrator |
| Type-aware agent prompts | Agents adapt analysis per type | @orchestrator |

## Artifacts Produced
| File | Agent | Status |
|------|-------|--------|
| extensions/dao/types.ts | @codegen | ✅ Modified |
| extensions/dao/governance/proposals.ts | @codegen | ✅ Modified |
| extensions/dao/index.ts | @codegen | ✅ Modified |
| extensions/dao/intelligence/swarm.ts | @codegen | ✅ Modified |
| extensions/dao/intelligence/default-agents.ts | @codegen | ✅ Modified |
| extensions/dao/control/gates.ts | @codegen | ✅ Modified |
| extensions/dao/render.ts | @codegen | ✅ Modified |
| extensions/dao/persistence.ts | @codegen | ✅ Modified (backward compat) |
| extensions/dao/delivery/execution.ts | @codegen | ✅ Modified (type in exec prompt) |
| README.md | @codegen | ✅ Updated |
| skills/dao-governance/SKILL.md | @codegen | ✅ Updated |

## Inter-Agent Notes
<!-- Format: [@source → @destination] Message -->
