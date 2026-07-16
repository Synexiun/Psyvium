# VPSY OS

**Clinical Psychology Operating System + Behavioral-Health Intelligence Infrastructure.**

> Not a therapy app. Not a scheduler. Not a generic EHR. VPSY governs an entire psychological
> care lifecycle — intake → screening → triage → manager assignment → assessment → formulation →
> treatment → intervention → outcomes → risk → reporting → payment → clinician compensation →
> population analytics — as one continuous, auditable, AI-augmented system.

**Founding principle:** _AI assists, licensed clinicians decide._ No autonomous diagnosis. Every clinical action emits a tamper-evident audit event.

Full documentation: [`docs/`](./docs/README.md) — [Business track](./docs/business/) · [Technical track](./docs/technical/).

---

## Stack

| Layer | Choice |
|-------|--------|
| Monorepo | Turborepo + pnpm |
| API | NestJS — modular monolith, hexagonal, 28 DDD bounded contexts |
| DB / ORM | PostgreSQL + Prisma (TimescaleDB for wearables, planned) |
| Web | Next.js 15 App Router · PWA · Tailwind ("Clinical Aurora" design system) |
| Shared | `@vpsy/contracts` (zod DTOs + enums + RBAC) — one source of truth for API & web |
| AI | Governed AI-Gateway context · Vercel AI Gateway seam · deterministic offline stub |
| Security | JWT · RBAC + ABAC · append-only hash-chained audit |

See [ADR-001](./docs/technical/03-tech-stack-and-decisions.md) for why TypeScript/NestJS replaced the originally-proposed Kotlin/Spring.

## Layout

```
apps/
  api/    NestJS modular monolith — ~19 bounded-context modules live (auth, intake, matching,
          credentialing, consent, clinical-docs, treatment-planning, psychometrics, outcomes,
          wearables, clients, clinicians, crm, communications, risk, scheduling, finance,
          ai-gateway, audit)
  web/    Next.js 15 PWA — public site + 10 role portals, 10 languages incl. Arabic RTL
packages/
  contracts/  shared zod DTOs, enums, RBAC matrix
  database/   Prisma schema (~60 models) + seed
docs/       business/ (8) + technical/ (16) + BUILD-STATUS + DEMO-WALKTHROUGH
```

**Portals** (`apps/web`): `/` landing · `/login` · `/intake` · `/manager` triage · `/session` clinician workspace · `/home` patient PWA · `/assessments` (role-aware: client take-a-test vs clinician assign + results) · `/crm` · `/comms` · `/risk` · `/schedule` (+ `/finance`). Every screen is multilingual + RTL-ready.

**Build status:** [`docs/BUILD-STATUS.md`](./docs/BUILD-STATUS.md) tracks all 30 contexts (built & verified / partial / documented) — Phase 2 is complete; Phases 3–5 substantially built.

## Quickstart

Prerequisites: Node ≥ 20, pnpm 10, PostgreSQL (any 12+).

```bash
pnpm install

# 1. Point the DB env (already set for the demo DB below)
#    packages/database/.env and apps/api/.env → DATABASE_URL

# 2. Create schema + seed demo data
pnpm --filter @vpsy/database exec prisma db push
pnpm --filter @vpsy/database run seed

# 3. Run
pnpm --filter @vpsy/api run dev     # API  → http://localhost:4000  (docs at /api/docs)
pnpm --filter @vpsy/web run dev     # Web  → http://localhost:3000
```

**Demo accounts** (password `Vpsy!2026`): `manager@vpsy.health` (Clinical Director) · `dr.rivera@vpsy.health` (Psychologist) · `alex.client@example.com` (Client).

**See it running:** [`docs/DEMO-WALKTHROUGH.md`](./docs/DEMO-WALKTHROUGH.md) is a click-by-click tour of all portals. Quick taste: open `/intake`, submit a screening → open `/manager`, approve the AI-proposed match. Switch to **العربية** anywhere to see full RTL.

## Build & test

```bash
pnpm build       # turbo builds contracts → database → api + web
pnpm test        # clinical-safety unit tests (screening)
```

## Verified working

- ✅ `pnpm build` — 4/4 workspaces build clean · Prisma schema valid · seed idempotent
- ✅ Full API test suite green; every wave live-smoke-tested end-to-end through the web proxy
- ✅ **Care spine:** intake → deterministic screening → AI-ranked proposal → manager approval → clinician workspace (signable notes) → assessment → outcomes
- ✅ **Standard assessments:** clinician assigns a keyed instrument → client completes it from their dashboard (score suppressed) → clinician reviews answers/score/band/scoring-key + a governed AI briefing (PENDING human gate); no double-scoring under concurrent submits
- ✅ **Compliance enforced:** clinical writes blocked without an active/in-jurisdiction license (403); intake blocked with a withdrawn consent (409); audit hash-chain integrity verified
- ✅ **AI governance:** every AI recommendation logged and gated `PENDING` behind a human decision
- ✅ **Risk & Crisis:** escalations resolved by humans only; break-glass = time-boxed + audited + DPO alert
- ✅ **Business:** CRM lead→client conversion; communications (call/SMS/async media); scheduling booking loop; finance double-entry ledger balances
- ✅ **Multilingual:** 10 languages incl. Arabic RTL, cookie-driven SSR locale, zero raw keys

## Local demo database

Verification provisioned an **isolated** `vpsy` database + role in the local Postgres (non-destructive to any existing DBs). To remove it:

```sql
DROP DATABASE vpsy; DROP ROLE vpsy;
```
