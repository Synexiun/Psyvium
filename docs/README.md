# VPSY OS — Documentation

> **VPSY OS** — a multi-tenant, country-scale **Clinical Psychology Operating System + Behavioral-Health Intelligence Infrastructure**.
>
> Not a therapy app. Not a scheduling tool. Not a generic EHR. VPSY manages the **entire psychological care lifecycle**:
>
> `Intake → Screening → Triage → Manager Assignment → Assessment → Formulation → Treatment Plan → Intervention → Outcome Tracking → Risk Monitoring → Reporting → Payment → Clinician Compensation → Population Analytics`

**Founding principle:** _AI assists, licensed clinicians decide._ The system never diagnoses autonomously; it surfaces evidence, flags risk, and routes to humans. Every clinical action produces a tamper-evident audit event.

---

> 📊 **Current build progress vs. this plan:** [`BUILD-STATUS.md`](./BUILD-STATUS.md) — a live traceability matrix of all 30 contexts (built & verified / partial / documented), phase completion, and recorded deviations.
>
> 🎬 **See it running:** [`DEMO-WALKTHROUGH.md`](./DEMO-WALKTHROUGH.md) — how to run the app + a click-by-click tour of all 9 portals.

## How this documentation is organized

Documentation is split into two tracks — **Business** (what we are building and why) and **Technical** (how we build it).

### 📈 Business track — [`docs/business/`](./business/)

| # | Document | What it covers |
|---|----------|----------------|
| 00 | [Vision & Category](./business/00-vision-and-category.md) | The category we are creating and the north-star thesis |
| 01 | [Product Overview](./business/01-product-overview.md) | The six operating layers and full feature inventory |
| 02 | [Market & Differentiation](./business/02-market-and-differentiation.md) | Competitors, positioning, moats |
| 03 | [Personas & Roles](./business/03-personas-and-roles.md) | Deep profiles of the 8 platform roles |
| 04 | [User Journeys](./business/04-user-journeys.md) | End-to-end lifecycle flows |
| 05 | [Monetization & Contracts](./business/05-monetization-and-contracts.md) | Revenue + clinician compensation models |
| 07 | [Go-to-Market & Phasing](./business/07-go-to-market-and-phasing.md) | The 6 phases and national-infrastructure play |
| 08 | [Risk Register](./business/08-risk-register.md) | Clinical, legal, regulatory, AI, operational risk |

### 🛠 Technical track — [`docs/technical/`](./technical/)

| # | Document | What it covers |
|---|----------|----------------|
| 00 | [Architecture Overview](./technical/00-architecture-overview.md) | System topology, modular monolith, hexagonal design |
| 01 | [Bounded Contexts](./technical/01-bounded-contexts.md) | The 28 DDD contexts and their boundaries |
| 02 | [Data Model](./technical/02-data-model.md) | The ~50-entity clinical + business backbone |
| 03 | [Tech Stack & Decisions (ADRs)](./technical/03-tech-stack-and-decisions.md) | Every major architectural decision, recorded |
| 04 | [API Design](./technical/04-api-design.md) | REST conventions, module→endpoint map |
| 05 | [AI Clinical Layer](./technical/05-ai-clinical-layer.md) | The 8 supervised AI agents |
| 06 | [Security & RBAC](./technical/06-security-and-rbac.md) | Threat model, RBAC/ABAC, tamper-evidence |
| 07 | [Psychometrics Engine](./technical/07-psychometrics-engine.md) | IRT, CAT, norms, validity, DIF |
| 08 | [Telehealth & Realtime](./technical/08-telehealth-and-realtime.md) | Secure video, waiting room, session lifecycle |
| 09 | [Wearables & Time-series](./technical/09-wearables-and-timeseries.md) | Physiological signal ingestion & correlation |
| 10 | [Observability & DevOps](./technical/10-observability-and-devops.md) | CI/CD, OTel, DR, deploy strategy |
| 11 | [Frontend Architecture](./technical/11-frontend-architecture.md) | Next.js portals, PWA, design system |
| 12 | [Testing Strategy](./technical/12-testing-strategy.md) | Test pyramid, clinical safety, AI red-team |
| 13 | [Roadmap & Phases](./technical/13-roadmap-and-phases.md) | Engineering roadmap → bounded contexts |
| 14 | [Compliance & Governance](./technical/14-compliance-and-governance.md) | HIPAA, GDPR, EU AI Act, WHO, SOC2/ISO |
| 15 | [Communications & Telephony](./technical/15-communications-and-telephony.md) | SIP/IP phones, SMS hubs, in-house WebRTC video+voice, async media messages |
| 16 | [CRM & Referrals](./technical/16-crm-and-referrals.md) | Leads, referrers, pipeline, campaigns, engagement timeline |

---

## The category, in one paragraph

Most competitors are **practice-management systems** — they manage appointments, notes, billing, and reminders. VPSY manages the **entire psychological care lifecycle** as one governed, auditable, AI-augmented system, from a citizen's first anonymous screening to national de-identified mental-health analytics. That is a different category:

> **Clinical Psychology Operating System + Behavioral-Health Intelligence Infrastructure.**

We build it that way from day one — the first release is architected as the final system, even where modules are dormant.

---

## Repository layout

```
VPSY/
├── docs/                      # ← you are here
│   ├── business/
│   └── technical/
├── apps/
│   ├── api/                   # NestJS modular monolith (bounded contexts as modules)
│   └── web/                   # Next.js 15 App Router (public site + 8 role portals)
├── packages/
│   ├── database/              # Prisma schema + client + migrations + seed
│   ├── contracts/             # Shared DTOs / zod schemas / API types
│   ├── ui/                    # Shared design system (tokens + shadcn/ui components)
│   └── config/                # Shared tsconfig / eslint / tailwind presets
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## Guiding engineering principles

1. **AI assists, clinicians decide** — every AI output is a *suggestion* with a human approval gate and an audit trail.
2. **Compliance is law, not a feature** — RBAC/ABAC, tamper-evident audit, consent versioning, and data-residency are foundational, present from the first line.
3. **The manager is the final assignment authority** — no blind algorithmic matching reaches a patient.
4. **Every clinical action emits an audit event** — the record is append-only and hash-chained.
5. **FHIR-compatible where it counts** — structured assessments as `Questionnaire`/`QuestionnaireResponse`, trendable facts as `Observation`.
6. **Modular monolith first, microservice-ready always** — bounded contexts are hard module boundaries with an event bus abstraction, so extraction is mechanical, not a rewrite.
