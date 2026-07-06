# 03 — Tech Stack & Architecture Decision Records (ADRs)

Each decision is recorded in ADR form: **Context → Decision → Consequences → Alternatives**. ADRs are immutable; superseding decisions get a new number.

## Stack at a glance

| Layer | Choice |
|-------|--------|
| Monorepo | Turborepo + pnpm workspaces |
| API | NestJS (TypeScript), modular monolith, hexagonal, DDD |
| ORM / DB | Prisma + PostgreSQL |
| Time-series | TimescaleDB (wearables) |
| Search | OpenSearch |
| Analytics warehouse | ClickHouse-compatible (start: Postgres read models) |
| Cache / sessions | Redis |
| Eventing | In-process typed bus + transactional outbox → NATS at extraction |
| Web | Next.js 15 App Router, React 19, PWA |
| Design system | Tailwind CSS + shadcn/ui + custom tokens |
| Data fetching | RSC + Route Handlers + TanStack Query (client islands) |
| AI | Vercel AI Gateway (`provider/model` strings), governed AI-Gateway context |
| AuthN | JWT (access+refresh), argon2 hashing, TOTP 2FA |
| AuthZ | RBAC + ABAC (CASL-style ability layer) |
| Validation | Zod (shared contracts) |
| Observability | OpenTelemetry (traces/metrics/logs) |
| Deploy | Vercel (web) + Render (API/DB), container + K8s-ready |
| CI | pnpm + Turbo remote cache, typecheck/lint/test/build gates |

---

## ADR-001 — TypeScript monorepo instead of Kotlin/Spring Boot

**Context.** The original brief proposed Kotlin/Spring Boot for the backend. The surrounding Synexiun ecosystem (Neurovium, PoliSophic, ORDR Mind, etc.) is uniformly TypeScript/Node/Prisma/Postgres, deployed on Vercel + Render.

**Decision.** Build VPSY as a **TypeScript monorepo**: NestJS API + Next.js web + shared packages.

**Why this preserves every architectural requirement of the brief:**
- NestJS provides first-class **modules** (bounded contexts), **providers/DI** (hexagonal ports), **guards/interceptors** (RBAC/ABAC/audit cross-cutting), and a **CQRS + EventBus** package — a direct analogue to Spring's structure.
- One language across API, web, and shared contracts eliminates DTO drift and lets the AI features share the Vercel AI Gateway.
- Hiring, deployment tooling, and operational runbooks stay consistent with the rest of the org.

**Consequences.**
- (+) Faster delivery, shared types end-to-end, native Vercel AI + deploy path, one CI toolchain.
- (+) Hexagonal + DDD + modular monolith fully expressible; extraction to services stays mechanical.
- (−) JVM-grade CPU-bound throughput is lower than Kotlin; mitigated because our hot paths are I/O-bound (DB, LLM, video signaling), and CPU-heavy psychometrics (IRT/CAT) can be isolated in a worker (Node worker threads or a Python sidecar) if profiling demands.

**Alternatives considered.** Kotlin/Spring (rejected: ecosystem mismatch); Go (rejected: weaker ORM/DDD ergonomics for this domain); Python/FastAPI (kept as an optional psychometrics/ML sidecar, not the core).

---

## ADR-002 — Modular monolith over microservices (initially)

**Context.** Country-scale ambition tempts a microservice fleet early.

**Decision.** Ship a **modular monolith** with hard context boundaries and a transactional outbox, extraction-ready.

**Consequences.** (+) ACID for safety-critical flows (assignment, risk, payment), one deploy, simple local dev. (−) Requires discipline to keep boundaries clean — enforced by ESLint boundary rules + dependency-cruiser in CI. Extraction path documented in [Architecture Overview §8](./00-architecture-overview.md).

---

## ADR-003 — Prisma + PostgreSQL as the clinical system of record

**Decision.** Prisma over Postgres for the operational store; `Decimal(18,4)` for money; JSON columns for flexible clinical payloads with zod-validated shape at the edge.

**Consequences.** (+) Type-safe queries, migrations, great DX. (−) Prisma's raw-SQL story is weaker for complex analytics — hence a separate warehouse read path (ADR-006). RLS policies are applied via migration SQL Prisma doesn't natively model.

---

## ADR-004 — FHIR-compatible clinical layer, not full FHIR server

**Context.** Behavioral-health interoperability increasingly uses FHIR (US Core, US Behavioral Health Profiles).

**Decision.** Model our native schema **FHIR-alignable**: structured assessments map to `Questionnaire`/`QuestionnaireResponse`, trendable facts to `Observation`. Expose a FHIR **facade** (read + selected write) rather than adopting a FHIR server as the primary store.

**Consequences.** (+) Interoperability without paying full FHIR-store complexity/perf cost for every internal operation. (−) Mapping layer to maintain — isolated in a `fhir` adapter module.

---

## ADR-005 — In-process event bus + transactional outbox now, NATS later

**Decision.** Use NestJS EventBus in-process, persist events to an `outbox` table in the same transaction as the state change, relay via poller. When a context is extracted, the relay targets NATS/JetStream instead.

**Consequences.** (+) Exactly-the-guarantees-we-need (state ⇔ event), simple ops today. (−) A poller to run and monitor; acceptable and observable.

---

## ADR-006 — CQRS-lite, not event sourcing

**Decision.** Canonical mutable-but-audited store (Prisma) for writes; denormalized read models + warehouse for dashboards and National Analytics.

**Consequences.** (+) Clinical records stay canonical and correctable; dashboards stay fast. (−) Read-model sync to build (driven off the same events).

---

## ADR-007 — AI Gateway as a governed bounded context

**Decision.** All inference flows through one AI-Gateway context that: minimizes PHI in payloads, records `AIRecommendation` + model/prompt versions, enforces a human-decision gate, runs safety classifiers, and never writes to clinical tables directly.

**Consequences.** (+) One place for governance, audit, eval, red-team, and EU-AI-Act/WHO compliance. (−) Slight indirection for feature teams — worth it for a regulated clinical product.

---

## ADR-008 — Next.js 15 App Router, PWA-first, one app / many portals

**Decision.** A single Next.js app hosts the public site and all 8 role portals behind auth-gated route groups, PWA-enabled (manifest + service worker + offline intake forms + push), mobile fixed bottom nav.

**Consequences.** (+) Shared design system, one deploy, instant native-like mobile. (−) Careful code-splitting per portal so a patient never ships executive-dashboard JS — handled by route-group boundaries and dynamic imports.

---

## ADR-009 — RBAC + ABAC via a central ability layer

**Decision.** Roles grant coarse permissions (`context:action`); ABAC attributes (`tenantId`, `clinicId`, `jurisdiction`, `consentState`, `licenseState`) refine them at decision time via a CASL-style ability builder, enforced by a NestJS guard and mirrored in the frontend for UI gating (server remains source of truth).

**Consequences.** (+) Fine-grained, jurisdiction-aware access; testable authorization. (−) Ability rules must be unit-tested exhaustively (they are — see Testing Strategy).

---

## ADR-010 — Money, time, and identifiers

- **Money:** `Decimal(18,4)`, currency-tagged, never `float`. All arithmetic in a `Money` value object.
- **Time:** everything `timestamptz` in UTC; timezones are presentation concerns resolved per user/clinic.
- **IDs:** `cuid` opaque keys; no sequential exposure; external references (PSP, license bodies) stored as separate typed fields.

---

## ADR-011 — Tenancy & data residency

**Decision.** Shared-DB row-level tenancy + Postgres RLS as backstop; per-region DB routing for residency (EU data in EU). Promotion to dedicated DB per national tenant requires no code change.

**Consequences.** (+) Cost-efficient at pilot scale, compliant at national scale. (−) RLS policies and region routing to maintain and test.
