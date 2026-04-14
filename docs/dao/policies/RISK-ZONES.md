# Risk Zone Policy

## Zone Classification

The composite score (0-100) determines the risk zone. The score is calculated from 5 weighted axes:

| Axis | Weight | Description |
|------|--------|-------------|
| User Impact | 30% | Value for end user (0-10) |
| Business Impact | 20% | Adoption, retention, differentiation (0-10) |
| Effort | 15% | Build & maintenance complexity — **inverted** (higher = less effort) |
| Security Risk | 20% | Permissions, data, attack surface — **inverted** (higher = less risk) |
| Confidence | 15% | Evidence quality, analysis coherence (0-10) |

**Formula:** `score = Σ(axis × weight) × 10`

## Zones

### 🟢 Green — Auto-Approve

| Attribute | Value |
|-----------|-------|
| **Criteria** | Minor UI, docs, text, light instrumentation |
| **Process** | Agent auto-approval + async human review |
| **Human approvals** | 1 |
| **Security review** | ❌ Not required |
| **Formal vote** | ❌ Not required |

### 🟠 Orange — Council Review

| Attribute | Value |
|-----------|-------|
| **Criteria** | Non-trivial features, moderate refactors, limited new integrations |
| **Process** | Council review + QA checklist |
| **Human approvals** | 2 |
| **Security review** | ❌ Not required |
| **Formal vote** | ❌ Not required |

### 🔴 Red — Security Council

| Attribute | Value |
|-----------|-------|
| **Criteria** | New permissions, multi-site access, auth, sensitive storage, store publication |
| **Process** | Security Council + reinforced quorum + final human approval |
| **Human approvals** | 2 |
| **Security review** | ✅ Required |
| **Formal vote** | ✅ Required |

## Control Gates

| Gate | Severity | Description |
|------|----------|-------------|
| `quorum-quality` | blocker | Was quorum participation met? |
| `risk-threshold` | warning | Is risk score below threshold (7/10)? |
| `vote-consensus` | warning | Did any high-weight agents vote against? |
| `zone-compliance` | warning | Does the risk zone match the proposal scope? |

## Checklist Categories

| Category | Items | Auto-checked |
|----------|-------|-------------|
| 🔒 Security | Security reviewed, data/privacy assessed | ✅ Yes |
| 📋 Compliance | Regulatory compliance verified | ✅ Yes |
| ✨ Quality | Spec defined, architecture reviewed | ✅ Yes |
| ⚙️ Operational | Rollback plan, monitoring configured | Partial |

## Risk Threshold

Proposals with risk score ≥ 7/10 are **blocked** regardless of zone.
