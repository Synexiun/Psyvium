# VPSY OS — Build Status vs. Plan

Living traceability of every bounded context against the roadmap (`technical/13-roadmap-and-phases.md`) and its spec. Updated as modules land. Principle held everywhere: **AI assists, licensed clinicians decide; every clinical action emits a tamper-evident audit event.**

**Legend:** ✅ Built & verified (live-tested) · 🟡 Partial / in progress · 📝 Documented + data-modeled, module not yet built.

> **Status honesty note (2026-07-06):** a three-audit review vs. the docs found this file previously **overclaimed** in places. Corrected below. The authoritative, doc-verified gap backlog and its execution waves now live in [`10-10-PROGRAM.md`](10-10-PROGRAM.md). Phase-level ✅ marks the *core slice* of a phase, not every context in it — contexts marked 🟡/📝 below are the honest per-context truth.
>
> **Production-readiness audit (2026-07-12):** overall platform scored **4/10** before Gate 0 (see [`PLATFORM-AUDIT-2026-07-12.md`](PLATFORM-AUDIT-2026-07-12.md)).
>
> **Engineering wave (2026-07-13):** Gate 0 + remaining code gates closed — `InstrumentLicenseGrant` 403 on administer/CAT, treatment-plan client acknowledgment API+UI, SMS templates, PolicyEngine skeleton, middleware matcher expansion, render.yaml web JWT notes. Prior Gate 0/1 items retained (auth/ABAC/MFA/password reset/SMS STOP/AI queue/CI migrate+audit).
>
> **Independent re-audit (2026-07-13):** see [`PLATFORM-AUDIT-2026-07-13.md`](PLATFORM-AUDIT-2026-07-13.md).  
> **Clinical excellence + staging-PHI wave (2026-07-13):** staging-PHI stack (blobs, ClamAV, field crypto, SIEM, boot refusals, pen-test probes, restore drill) plus **clinical validation register** and **vendor BAA inventory** (API + admin UI). See [`STAGING-PHI-RUNBOOK.md`](STAGING-PHI-RUNBOOK.md), [`CLINICAL-VALIDATION-REGISTER.md`](CLINICAL-VALIDATION-REGISTER.md), [`VENDOR-BAA-REGISTER.md`](VENDOR-BAA-REGISTER.md). Remaining for true PHI GA: **signed** BAAs, external pen-test execution, Object Lock on SIEM bucket, operator PITR attestation, clinical board signatures for marketed claims.
>
> **AI governance + forensic-audit wave (2026-07-14):** the last open Wave CR AI item closed — `AIRecommendation.inputSignals` persists the de-identified signal bundle verbatim (true replay, doc 05 §5); `AIModelVersion.approvedForProduction/approvedBy/approvedAt` are real columns with a fail-closed admin approval API (`POST /admin/ai-models/:id/approval` — no eval run, no approval) and a production gateway gate (unapproved runtime model → honest rule-based with `withheldReason: 'model-not-approved'`); the FDA time-sensitivity claim for the crisis agent is softened (doc 14 §6.1 — non-device status NOT claimed for the crisis path, pending counsel). **AuditEvent doc-02 forensic fields** (licenseSnapshot, jurisdiction, purpose, consentRef, abacRuleMatched, deviceId, sessionId, authLevel, obligations) landed — nullable, hash-covered, wired at break-glass. `10-10-PROGRAM.md` checkboxes reconciled against landed code. API suite: **647 tests green**.

## Context status (30 contexts)

| # | Bounded context | Phase | Status | Evidence / notes |
|---|-----------------|:-----:|:------:|------------------|
| 1 | Identity & Access | 1 | ✅ | JWT+argon2, RBAC+ABAC guards, login + permission gates verified; hardened (no self-assign role, no hardcoded secret, DB-authoritative perms). **Refresh sessions** (rotate + reuse family revoke + authVersion). **Tenant-aware registration** (slug + opt-in). **ClinicalAccessService** ABAC on clinical PHI routes. **MFA TOTP** enroll/verify + mandatory-role restricted sessions. httpOnly cookie + server middleware; legacy token shim for Socket.IO. PolicyEngine pure-function skeleton (doc 06 §4.4). |
| 2 | Tenant / Clinic Network | 1 | 🟡 | Tenant/Clinic in schema + seed; no management module yet |
| 3 | Client Registry | 1 | 🟡 | Client model + `clients` read module (`/clients/me`, clinical-summary); no admin CRUD |
| 4 | Psychologist Registry | 1 | 🟡 | Psychologist model used by matching/clinicians; no dedicated registry CRUD |
| 5 | Audit & Compliance | 1 | ✅ | Hash-chained `AuditService`; chain-integrity verified live; daily anchor + SIEM export; **doc-02 forensic fields** (jurisdiction/purpose/consentRef/abacRuleMatched/sessionId/authLevel/obligations…) hash-covered |
| 6 | Admin Configuration | 1 | 📝 | `FeatureFlag` model exists; module pending |
| 7 | Credentialing & Contracts | 2 | ✅ | `assertClinicalEligibility` + `ClinicalWriteGuard`; inactive/wrong-jurisdiction → 403 verified |
| 8 | Intake & Screening | 2 | ✅ | Deterministic screening + risk flags; consent-gated; verified |
| 9 | Scheduling | 2 | ✅ | Availability, booking (assignment-gated), agenda, status (confirm/cancel/no-show/complete), reminders (event seam), timezone-aware; `/schedule` UI; verified live |
| 10 | Clinical Profile | 2 | 🟡 | Upserted during intake; no dedicated module |
| 11 | Matching & Assignment | 2 | ✅ | AI-ranked candidates, manager-approved; verified |
| 12 | Telehealth (in-house A/V) | 3 | 🟡 | RTC token + local-media call UI shipped (Comms Hub); live peer via self-hosted SFU/TURN = infra per doc |
| 13 | Clinical Documentation | 3 | ✅ | Signable, versioned notes; verified |
| 14 | Messaging | 3 | 🟡 | Secure client↔clinician text threads + `/messages` UI shipped; latest UI refresh flicker fixed (keeps conversation mounted during background thread reloads, guards read marking until user id is known). Targeted TS + Next build passed; full browser regression blocked by known `JWT_ACCESS_SECRET` build-time middleware requirement. Async voice/video `MediaMessage` remains shipped + verified. |
| 15 | Documents | 3 | 🟡 | Metadata module + admin capability card; blob storage + malware scan = infra |
| 16 | Psychometrics | 4 | ✅ | Classical + IRT EAP + CAT; safety-item → Risk; **InstrumentLicenseGrant** 403 gate; ItemTranslation provenance |
| 17 | Diagnosis Support | 4 | ✅ | Hypotheses + coded Formulations; clinician UI `/diagnosis`; no AI write path |
| 18 | Treatment Planning | 4 | ✅ | Plans + goals, auto-supersede; SMART goals; review cadence; **client acknowledgment** |
| 19 | Intervention Tracking | 4 | ✅ | Intervention/Homework API + patient home complete loop |
| 20 | Outcomes | 4 | ✅ | Measures + per-construct trend; verified |
| 21 | Risk & Crisis | 4 | ✅ | Escalation workflow (human-only resolve), append-only safety plans, break-glass (1h grant + HIGH audit + DPO-alert event), `/risk` board; verified live |
| 22 | AI Gateway | 5 | ✅ | Governed agents (activate-on-key + honest rule-based fallback), recommendation ledger with **verbatim replay bundle**, PENDING human-decision gate, consent + kill-switch + **production model-approval gate** (clinical-governance columns, fail-closed); verified |
| 23 | Wearables | 5 | ✅ | Ingest + 7-day rollup; verified |
| 24 | Payments | 6 | ✅ | Invoices + payment capture (atomic); `Decimal(18,4)`, no float math; `/finance` UI; verified live |
| 25 | Accounting | 6 | ✅ | Double-entry ledger + chart of accounts; **balanced postings verified** (Σdebit==Σcredit); atomic with payment |
| 26 | Revenue Share / Payouts | 6 | ✅ | Payout computation from contract revenue-share %; verified (60% → exact 216.0000) |
| 27 | Reports | 6 | ✅ | Executive + manager reports (live aggregates), persisted `Report` + audit; verified live |
| 28 | National Analytics | 6 | ✅ | De-identified population metrics with **k-anonymity suppression** (cohort < 5 → value nulled); verified live (US-VT suppressed) |
| 29 | CRM & Referrals | 2 | ✅ | Pipeline + referrers + lead→client convert; backend + `/crm` UI; verified |
| 30 | Communications Hub | 3 | ✅ | Telephony/SMS (offline-stub + Twilio activate-on-key), SMS templates, STOP/opt-out + quiet hours, inbound Twilio webhook, async MediaMessage, RTC token, `/comms` UI |

## Phase completion

| Phase | Theme | State |
|-------|-------|-------|
| 1 | Foundation & compliance spine | Core built (Auth, Audit, RBAC/ABAC); tenant/registry admin modules partial |
| 2 | Access to care | ✅ **COMPLETE** — Credentialing gate, Consent, Intake, Clinical Profile, Matching, Scheduling, CRM all built & verified |
| 3 | Care delivery | In progress — Documentation ✅; Telehealth/Comms landing now; Messaging text threads shipped but browser E2E still blocked by env/build setup; Documents pending |
| 4 | Clinical depth | Psychometrics/Treatment/Outcomes ✅; **Risk & Crisis ✅ (hardened: human-only resolve, break-glass, safety plans)**; Diagnosis/Intervention modules remain |
| 5 | Intelligence | AI Gateway + Wearables ✅ (AI as governed stub) |
| 6 | Business & national scale | ✅ **COMPLETE** — Payments/Accounting/Payouts (money-correct: Decimal, atomic, balanced), Reports, National Analytics (k-anonymity) all built & verified |

## Cross-cutting (verified)

- **Compliance gates** — license/jurisdiction gate on clinical writes + consent-gated intake (roadmap Phase-2 DoD), live-verified (403 / 409).
- **Multilingual** — 10 languages incl. Arabic RTL, cookie-driven SSR locale, zero raw keys.
- **Tamper-evident audit** — SHA-256 hash chain, integrity verified.
- **Quality gates** — full turbo build 4/4; **647 API tests** (incl. blocking clinical-safety suite); **real API lint gate** (ESLint 9, type-aware async-correctness rules, `--max-warnings 0` — replaced the `echo 'lint ok'` stub the audit scored 3/10); **OSV dependency gate** (replaced the endpoint-retired `pnpm audit`; 9 hidden high/critical advisories found + remediated to 0 blocking); live end-to-end smokes per wave.
- **Browser E2E restored (2026-07-15)** — the full Playwright suite (journeys + axe a11y) is **15/15 green, twice consecutively**, against the real stack. `auth.setup.ts` now completes REAL TOTP MFA enrollment through the product API (inline RFC-6238 codes, no test-only auth bypass). Two product bugs found and fixed by the suite: the web client did not parse `application/problem+json` error bodies (MFA-enrolled users could never log in through the UI — the MFA_REQUIRED prompt never appeared), and no product path assigned a client a location jurisdiction (matching's scope-of-practice gate therefore yielded zero candidates for every non-seed client; registration + registry-create now accept self-reported `jurisdiction`).
- **CI pipeline fully green (2026-07-15, run 29416127061 @ `8467fe1`)** — first complete pass of every gate: OSV dependency audit, gitleaks, migrate deploy, seed, real ESLint, typecheck, build, blocking clinical-safety suite, 653 unit tests, **blocking browser E2E (15/15)**, and Docker build proof. Fixed to get there: three latent step-ordering bugs (audit endpoint retirement had masked them since the steps landed) and the E2E root cause — CI's web build baked the production Render API into the `/api/backend/*` rewrite (`next build` forces NODE_ENV=production; `API_URL` was unset), so logins were proxied to production, whose Secure cookie the browser refused on http://localhost. `API_URL` is now set in CI and part of turbo's cache key.
- **DevOps** — `docker-compose.yml` (Postgres+Redis) + GitHub Actions CI (validate→push→seed→build→test).

## Deviations from plan (recorded)

- **Stack** — TypeScript/NestJS instead of Kotlin/Spring (ADR-001).
- **Sequencing** — built demonstrable vertical slices across phases (to show value + the requested multilingual UI) rather than strict phase-by-phase; the mandatory Phase-2 compliance gates were then backfilled before continuing.
- **AI Gateway** — stood up early as a governed, human-gated *stub* (honors the invariant though it appears ahead of Phase 5's live-AI sequence).
- **Psychometrics** — classical scoring now; IRT/CAT (Phase-4 advanced) is future.
