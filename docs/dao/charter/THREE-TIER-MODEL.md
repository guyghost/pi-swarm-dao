# 🏛️ Modèle de Gouvernance à 3 Cercles

> Les utilisateurs finaux créent la valeur réelle d'un outil par leur usage. La DAO les intègre via 3 cercles de participation.

## Les 3 Cercles

```
┌─────────────────────────────────────────────────────┐
│              🔴 GOVERNORS / STEWARDS                 │
│   Core DAO — Vision, gouvernance, sécurité          │
│   ┌─────────────────────────────────────────────┐   │
│   │       🟡 CONTRIBUTORS                       │   │
│   │   Devs, designers, PMs, power users         │   │
│   │   ┌─────────────────────────────────────┐   │   │
│   │   │       🟢 USERS                       │   │   │
│   │   │   Tous les utilisateurs              │   │   │
│   │   │   Feedback, votes consultatifs       │   │   │
│   │   └─────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Cercle 1 — Governors / Stewards (Core DAO)

| Attribut | Détail |
|----------|--------|
| **Qui** | Fondateurs + contributeurs clés de confiance |
| **Rôle** | Porter la vision, la gouvernance et la sécurité |
| **Agents** | Product Strategist, Critic / Risk Agent, Solution Architect |
| **Poids** | 3 chacun (forte influence) |
| **Droits** | Proposer, délibérer, voter, amendements, exécuter |
| **Scope** | Tous les types de propositions |

## Cercle 2 — Contributors

| Attribut | Détail |
|----------|--------|
| **Qui** | Devs, designers, PMs, power users actifs |
| **Rôle** | Contributions produit et techniques avec poids de vote élevé |
| **Agents** | Research Agent, Prioritization Agent, Spec Writer, Delivery Agent |
| **Poids** | 1-2 (influence modérée) |
| **Droits** | Proposer, délibérer, voter, générer specs et plans |
| **Scope** | Product, technique, release |

## Cercle 3 — Users

| Attribut | Détail |
|----------|--------|
| **Qui** | Tous les utilisateurs de l'extension |
| **Rôle** | Feedback, votes consultatifs, beta testing |
| **Agents** | Power User (Dev), Casual User (PM), New User (Skeptic) |
| **Poids** | 1 chacun (influence consultative) |
| **Droits** | Feedback structuré, vote consultatif sur roadmap et UX |
| **Scope** | Product features, technical UX, releases |

## Droits par Cercle

| Droit | Governors | Contributors | Users |
|-------|-----------|-------------|-------|
| Proposer des idées | ✅ | ✅ | ✅ (feedback) |
| Voter sur la roadmap | ✅ (fort) | ✅ (modéré) | ✅ (consultatif) |
| Voter sur la sécurité | ✅ | ✅ | ❌ |
| Amender la DAO | ✅ | ⚠️ (via proposal) | ❌ |
| Approuver des releases | ✅ | ✅ | ❌ |
| Beta testing | ✅ | ✅ | ✅ |
| Analyser les retours | ✅ | ✅ | — (source) |

## User Council

Le `user-council` représente le 3ème cercle. Il participe aux délibérations sur:

| Type de Proposition | User Council | Raison |
|--------------------|-------------|--------|
| product-feature | ✅ | Les utilisateurs vivent les features |
| security-change | ❌ | Sécurité = domaine technique |
| technical-change | ✅ | L'UX est impacté |
| release-change | ✅ | Les utilisateurs subissent les releases |
| governance-change | ❌ | Gouvernance = core DAO |

## Les 3 Agents Utilisateurs

### 🛠️ Power User (Dev)
- **Profil:** Utilise l'extension quotidiennement depuis 6 mois
- **Opinions:** Direct, exigeant sur la qualité production
- **Vote:** Pour la profondeur technique, contre la simplification excessive
- **Phrase type:** *"In production, this could break my workflow"*

### 📋 Casual User (PM)
- **Profil:** Utilise l'extension quelques fois par semaine
- **Opinions:** Pragmatique, tolérance zéro pour le jargon
- **Vote:** Pour la simplicité, contre la complexité
- **Phrase type:** *"If I need to read docs, it doesn't exist"*

### 🔍 New User (Skeptic)
- **Profil:** Commencé il y a 2 semaines, encore en découverte
- **Opinions:** Curieux mais sceptique, questionne tout
- **Vote:** Pour la clarté, contre le scope creep
- **Phrase type:** *"Wait, does this mean I need to understand...?"*

## Impact sur la Dynamique de Vote

Avec les 3 agents utilisateurs:

| Métrique | Avant | Après |
|----------|-------|-------|
| Agents totaux | 7 | **10** |
| Poids total | 15 | **18** |
| Voix utilisateur | 0% | **16.7%** |
| Quorum 60% | 9/15 | **10.8/18** (11 agents) |

### Scénarios de Dissension

Les agents utilisateurs peuvent diverger:

| Sujet | Power User | Casual User | New User |
|-------|-----------|-------------|----------|
| Nouvelle feature complexe | ✅ Pour | ❌ Contre | ❌ Contre |
| Simplification UX | ❌ Contre | ✅ Pour | ✅ Pour |
| Documentation enrichie | ⚠️ Mitigé | ✅ Pour | ✅ Pour |
| Breaking change | ❌ Contre | ⚠️ Mitigé | ❌ Contre |

Cette dissension naturelle enrichit la délibération — elle force les agents core à justifier leurs positions face à des perspectives utilisateurs réelles.

---

*Version: 1.0 · Dernière mise à jour: 2026-04-14*
