# Risk Matrix

## Risk Assessment Framework

Every proposal receives a composite risk score from the Critic / Risk Agent (1-10) and a composite score from the Prioritization Agent's scoring matrix.

## Composite Scoring

### Axes & Weights

| Axis | Weight | Inverted? | Description |
|------|--------|-----------|-------------|
| User Impact | 30% | No | Value for end user (0-10) |
| Business Impact | 20% | No | Adoption, retention, differentiation (0-10) |
| Effort | 15% | **Yes** | Higher score = less effort |
| Security Risk | 20% | **Yes** | Higher score = less risk |
| Confidence | 15% | No | Evidence quality, analysis coherence (0-10) |

### Formula

```
score = (userImpact × 0.30 + businessImpact × 0.20 + effort_inverted × 0.15 + securityRisk_inverted × 0.20 + confidence × 0.15) × 10
```

## Risk Classification

| Score Range | Zone | Process |
|-------------|------|---------|
| 0–33 | 🔴 Red | Security Council + reinforced quorum + formal vote |
| 34–66 | 🟠 Orange | Council review + QA checklist |
| 67–100 | 🟢 Green | Auto-approve + async review |

## Risk Categories

### Security Risks
- New permissions or capabilities
- Data exposure or access changes
- Authentication/authorization modifications
- Third-party integration trust boundaries

### Technical Risks
- Architecture changes (hard to reverse)
- Dependency additions or removals
- Performance regression potential
- Data migration requirements

### Operational Risks
- Deployment complexity
- Rollback difficulty
- Monitoring gaps
- Infrastructure dependencies

### Strategic Risks
- Market timing
- Competitive positioning
- User trust impact
- Opportunity cost

## Risk Register Template

| ID | Category | Description | Severity | Likelihood | Mitigation | Owner |
|----|----------|-------------|----------|------------|------------|-------|
| R1 | Security | ... | High/Med/Low | High/Med/Low | ... | ... |

## Blocking Threshold

Proposals with risk score ≥ 7/10 are **blocked** regardless of zone classification. The risk threshold can be modified via `dao_update_config` with a governance-change proposal.
