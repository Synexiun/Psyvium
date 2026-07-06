# Sub-project 1 — Live Data + Clinical Command Center

**Status:** Approved 2026-07-06 · **Owner:** main thread (UI dispatched to `vpsy-ux-designer` / Fable)
**Part of:** the "no stubs, real data, real-time, distinctive design" initiative (4 sub-projects).

## Context

VPSY OS is a working TypeScript monorepo (NestJS + Prisma + Next.js) with 20+ bounded
contexts live on real PostgreSQL. A commit-review + a data-reliability audit established that
"fake/stub/hardcoded" surface is **bounded**, not pervasive:

- Every built API context already runs on real Postgres via Prisma; `apps/web/src/lib/api.ts`
  is fully wired to live endpoints.
- The only **fake-data UI** is two pages reading `apps/web/src/lib/mock/*`: `home` (patient
  portal) and `session` (clinician workspace).
- Provider stubs (Twilio/SMS, AI/LLM, video SFU) and the absence of a real-time layer are
  **separate sub-projects (2 & 3)** — explicitly out of scope here.

This sub-project delivers the *visible-first* slice: remove every fake a user can see and ship
the new design on real data. Decisions taken (2026-07-06): activate-on-key integrations;
NestJS WebSocket + managed Postgres for realtime; **Clinical Command Center** design;
visible-first sequencing.

## Goals

1. **Zero visible fakes** — `home` and `session` read live API data; `apps/web/src/lib/mock/`
   is deleted so no fallback-to-fake path can survive.
2. **Honest states** — every portal has real loading / empty / error states. No component
   holds a hardcoded clinical or financial value; all data flows from the API. An empty
   dataset renders truthfully ("No escalations"), never a fake `0` that reads as real.
3. **One distinctive, efficient design** — the "Clinical Command Center" system applied
   consistently across all 11 routes.

Non-goals (owned by later sub-projects): real Twilio/Claude/LiveKit (SP2); WebSocket live
push + DB pooling/indexes + managed host (SP3).

## Design

### A. Mock removal & live wiring

`home/page.tsx` (patient): replace `@/lib/mock/patient` with live reads —
`api.clientMe()` (ClinicalSummary), `api.clientOutcomes(clientId)`, `api.wearableRollup(...)`,
`api.schedAgenda()` (next appointment), `api.riskSafetyPlan(clientId)`. The mood check-in
persists via `api.recordOutcome(clientId, 'mood', value)` instead of local component state.

`session/page.tsx` (clinician): replace `@/lib/mock/clinician` with `api.myCaseload()`,
`api.clinicalSummary(clientId)`, `api.listSessionNotes(sessionId)`, `api.activePlan(clientId)`,
`api.getAssessment(...)`, `api.clientOutcomes(...)`, `api.wearableRollup(...)`. The "AI
formulation" panel calls the real `ai-gateway` endpoint and renders the returned
`AIRecommendation` in its **PENDING** (human-decision-gated) state — unchanged when SP2 swaps
the stub for a real Claude call.

Then delete `apps/web/src/lib/mock/` (patient.ts, clinician.ts, crm.ts) and remove the
`mock` module from any import graph.

### B. Data-fetching pattern (reliability)

Introduce a single small client hook `useResource<T>(fetcher)` returning
`{ data, loading, error }` (no new dependency — a thin wrapper over `useEffect` + the existing
`api`/`ApiError`). Every portal page uses it to render exactly one of: a **skeleton** while
loading, a typed **error panel** on `ApiError` (with the status and a retry), an **empty
state** when the live result is empty, or the data. This replaces the current "mock never
breaks" comments with real behavior.

### C. Clinical Command Center design system (Fable)

Redefine the Tailwind token layer and shared components (dispatched to `vpsy-ux-designer`):

- **Palette:** calm dark+light duo; a single restrained accent reserved for risk/critical.
- **Type:** tabular monospace numerals for every clinical/finance figure; a characterful but
  legible display face + efficient body face (self-hosted, no external font network calls —
  matches the existing `<link>`/system-fallback approach).
- **Layout:** persistent left rail (caseload/nav) + main + right context panel; hairline grid;
  dense data tables.
- **Efficiency:** a `⌘K` command palette and full keyboard navigation (jump to any client,
  action, or portal without the mouse).
- Applied consistently across all 11 routes; multilingual + RTL preserved (10 locales, zero
  raw i18n keys); accessibility floor (visible focus, reduced-motion respected).

### D. Testing / verification

- Existing `scripts/smoke.sh` stays green (23/23).
- Add an assertion that `apps/web/src/lib/mock` no longer exists and that `home`/`session`
  contain no `mock` import.
- `pnpm build` stays 4/4; `pnpm test` stays green.
- Manual/browser confirm both pages render from live endpoints and degrade truthfully on an
  empty dataset (per Definition of Done: tests pass + browser-confirmed + user-approved).

## Risks & mitigations

- **Empty-dataset rendering** — the seed provides a full demo trail, but pages must also be
  correct with no data. Mitigation: the empty state is a first-class branch in `useResource`,
  tested by pointing a page at a client with no outcomes.
- **Design regressions across 11 routes** — a token change touches everything. Mitigation:
  change tokens + shared components centrally; verify each route builds and renders.
- **Scope creep into SP2/SP3** — the "AI formulation" and comms panels stay on their current
  stubs here; only the *wiring/UI states* change, not the providers.
```
