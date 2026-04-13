# Context: Agent Registry

## Objective
Add a formal registry for each DAO agent with 11 mandatory fields to prevent agent sprawl and maintain visibility/control. Fields: name, owner, mission, authorizedInputs, authorizedTools, authorizedData, riskLevel, authorizedEnvironments, stopConditions, kpis, lastReviewDate.

## Constraints
- Platform: Web (Pi terminal extension)
- Backward compatible: agents restored from persistence without new fields get defaults
- No breaking changes to existing addAgent/removeAgent API
- New fields optional on DAOAgent interface (defaults provided)

## Technical Decisions
| Decision | Justification | Agent |
|----------|---------------|-------|
| Extend DAOAgent directly | Avoids duplication, reuses existing name/role/tools | @orchestrator |
| New fields optional with defaults | Backward compat for persisted state + existing callers | @orchestrator |
| New tool dao_agent_card | Users need single-agent deep-dive view | @orchestrator |

## Files to Modify
| File | Changes | Agent |
|------|---------|-------|
| `types.ts` | Add AgentRiskLevel, StopCondition, AgentKPI types + extend DAOAgent | @codegen |
| `intelligence/default-agents.ts` | Fill 11 registry fields for all 7 agents | @codegen |
| `intelligence/agents.ts` | Update addAgent params, add formatAgentRegistry/formatRegistryTable | @codegen |
| `index.ts` | Add dao_agent_card tool, update dao_add_agent params, update dao_list_agents | @codegen |
| `render.ts` | Add renderAgentCard, renderRegistry, update dashboard | @codegen |
| `persistence.ts` | Backward compat migration for agents without registry fields | @codegen |
| `control/gates.ts` | Optional: add agent-registry-compliance gate | @codegen |

## Artifacts Produced
| File | Agent | Status |
|------|-------|--------|
| `types.ts` | @codegen | ✅ Modified — AgentRiskLevel, StopCondition, AgentKPI + DAOAgent extended |
| `intelligence/default-agents.ts` | @codegen | ✅ Modified — 7 agents with full registry fields |
| `intelligence/agents.ts` | @codegen | ✅ Modified — addAgent defaults, formatAgentCard, formatRegistryTable |
| `index.ts` | @codegen | ✅ Modified — dao_agent_card tool, updated dao_add_agent, dao_list_agents |
| `render.ts` | @codegen | ✅ Modified — Dashboard risk column |
| `persistence.ts` | @codegen | ✅ Modified — Backward compat migration |
| `control/gates.ts` | @codegen | ✅ Modified — agent-registry-compliance gate |

## Review Result
- **Verdict**: APPROVED ✅
- **Issues**: 6 minor (non-blocking) — no critical or major issues
- **TypeScript**: Compiles with zero errors

## Inter-Agent Notes
<!-- Format: [@source → @destination] Message -->
