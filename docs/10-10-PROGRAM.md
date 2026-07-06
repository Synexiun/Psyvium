# VPSY OS — The 10/10 Program (doc-verified gap backlog)

**Mandate:** every module and procedure the docs promise, built to spec, verified, confirmed — 10/10, nothing skipped.
**Method:** the docs define "done." Three independent read-only audits (business, core-technical, delivery/cross-cutting) cross-checked every documented requirement against real code. This file is the program of record; each item is closed by *build → verify (build+test+smoke) → confirm against its doc*.

**Legend:** `[ ]` open · `[~]` in progress · `[x]` done & verified · **(infra)** = needs a deploy target/credential; built as code + activate-on-deploy so it never blocks.

---

## Verified strong (keep as the template — audits credited these)
- AI assists / clinicians decide; manager final authority; human-only risk resolution — architecturally enforced.
- Security fixes (this session): no self-assignable role at register; no hardcoded JWT secret; DB-authoritative permissions.
- Hash-chained `AuditService` (SHA-256 prevHash→hash); break-glass (reason≥10, 1h TTL, HIGH audit); national-analytics k-anonymity fail-safe; `Decimal(18,4)` money; Twilio SMS + Claude intake = real activate-on-key with honest fallback + PHI minimization.

## BUILD-STATUS.md corrections (overclaims found — fix to stay honest)
- Identity & Access marked ✅ but **MFA missing** → downgrade to 🟡.
- Phase 2 / Phase 6 "COMPLETE" oversell (Diagnosis/Intervention/Documents unbuilt; comp-models + subscription/take-rate billing unbuilt) → annotate.
- Bounded-context numbering conflict: `01-bounded-contexts.md` (28) vs `13-roadmap` (30) assign different numbers to the same names → reconcile to one scheme.

---

## WAVE A — P0 clinical-safety & security (build first)
- [ ] **Safety-item scoring hook** (doc 07 §4): any questionnaire item flagged `safetyItems` (e.g. PHQ-9 item 9) routes to Risk on a qualifying answer. *Highest safety severity — a standalone assessment with active SI raises no flag today.*
- [ ] **MFA/TOTP** (doc 06 §3): enrol + verify on login for mandatory roles; `User.mfaEnabled/mfaSecret` exist but are dead.
- [ ] **httpOnly cookie auth + server-side `middleware.ts`** (doc 06, 11 §9): move token out of `localStorage`; gate routes/roles server-side ("UI is not the security boundary").
- [ ] **Rate limiting** (doc 04 §9, 06): Redis/`@nestjs/throttler` per-principal/tenant on login, register, AI, break-glass.
- [ ] **Idempotency-Key** (doc 04 §8): dedup on money (`payInvoice`), assessment (`administer`), intake POSTs.
- [ ] **Audit completeness** (doc 06 §5): `AuditService.record()` must not silently swallow write errors — fail-closed for clinical/financial writes + alert metric.
- [ ] **Wearable ingest consent gate** (doc 09 §5): `consentId` mandatory; reject unconsented points (named blocking safety test).
- [ ] **Universal soft-delete** (doc 02): add `deletedAt` to clinical/financial tables missing it (Intake, ScreeningResult, Assignment, Appointment, Session, SessionNote, TreatmentPlan, Goal, RiskFlag, Escalation, SafetyPlan, QuestionnaireResponse, PsychometricScore, Invoice…).
- [ ] **Postgres RLS + real migrations** (doc 00/02/06): adopt `prisma migrate`; `CREATE POLICY` tenant-isolation backstop on every tenant table.
- [ ] **Clinical-safety test suite as a blocking CI gate** (doc 12 §6): gather license-gate, consent-gate, human-only-resolve, break-glass, safety-item routing, k-anon into one named suite.

## WAVE B — Real-time (in progress)
- [~] **WebSocket transport + EventBus→socket bridge**, tenant-isolated, PHI-minimized; live risk board + connection indicator; hot-path indexes. *(SP3 running)*
- [ ] **Transactional outbox** (doc 00 ADR-005): persist event rows in the same tx; relay publishes — no dropped events on crash.
- [ ] Tele-session lifecycle model + presence/waiting-room seam (pairs with Wave F video).

## WAVE C — Differentiators & core features
- [ ] **IRT/CAT/DIF psychometrics** (doc 07 §5-6): `ItemParameter`, EAP θ, adaptive `startCat`/`nextItem`, norms/`NormSet`, `ItemTranslation`. *The flagship "data moat."*
- [ ] **Instrument licensing + `LicenseGrant` 403 gate** (doc 07 §2).
- [ ] **Wire the AI agents** (doc 05 §3): Differential-Hypothesis, Treatment-Plan, Session-Note, Outcome, Psychometric-Interpretation, and a real Allocation model (today it's a sort). All PENDING/human-gated, PHI-minimized, + input/output safety classifiers (§7).
- [ ] **Intervention/Homework** module (patient-facing) — unblocks the home empty-state.
- [ ] **Diagnosis Support** module (differential-hypothesis surface).
- [ ] **Documents** module (upload/version/e-sign).
- [ ] **Text-messaging threads** (doc 15) + STOP/opt-out + quiet-hours + templates.
- [ ] **Comp-model composability** (doc 05): `computePayout` must read senior-override/supervisor/clinic/referral fields, not a flat pct.
- [ ] **Audit-Read API** (doc 04/06): endpoint for the granted `AUDIT_READ` permission.
- [ ] **Central PolicyEngine (ABAC)** (doc 03/06 §4.4): consentState, emergencyOverride, deviceTrust, dataResidency + `obligations[]`.
- [ ] **Refresh-token rotation/differentiation** + `/auth/refresh` + `sessionId` claim + reuse detection (doc 06 §3).

## WAVE D — Production hardening (build as code)
- [ ] **OpenTelemetry** traces/metrics/logs, PHI-safe attrs, correlation ids (doc 10 §7).
- [ ] **CI gates** (doc 10 §4): lint, typecheck, SAST/secret-scan, unit, clinical-safety, e2e, a11y, build.
- [ ] **Dockerfile(s)** + `/healthz`/`/readyz` probes (doc 10 §5).
- [ ] **Feature-flag/kill-switch service** (doc 10 §13, 14 §4 — EU AI Act staged rollout).
- [ ] **Playwright E2E** + **axe a11y gate** (doc 12); Testcontainers integration; k6 load.
- [ ] **IaC** (Terraform/render.yaml/Helm) **(infra)**; **backups/DR** PITR + restore tests **(infra)**.
- [ ] **Field-level PHI encryption + KMS + crypto-shredding** (doc 06 §7) **(infra: KMS)**.
- [ ] **PWA**: service worker + IndexedDB offline note outbox + background sync (doc 11 §5).
- [ ] **AuditEvent forensic fields** (doc 02): licenseSnapshot, jurisdiction, purpose, consentRef, abacRuleMatched, deviceId, sessionId, authLevel, obligations; + daily anchor; + DPO-alert subscriber.

## WAVE E — Business surfaces & remaining integrations
- [ ] **SaaS subscription + marketplace take-rate billing** (doc 05) + **Payments→Stripe** (infra: key).
- [ ] **Public Clinic Network**: directory, public psychologist profiles, SEO/city pages, public referral (doc 01 Layer 1).
- [ ] **Admin Configuration** + **Tenant/Clinic onboarding** UI+API (doc 01/03/07).
- [ ] **Supervisor portal** (co-sign/oversight) + **Government/Institutional portal** (SLA, referral volume) (doc 03).
- [ ] **Twilio Voice** click-to-call + status-callback webhook + recording (consent+jurisdiction gated) (doc 15) (infra: number/webhook).
- [ ] Pagination/cursor on all list endpoints (doc 04); RFC-9457 error filter app-wide; FHIR-alignable facade (doc 03).

## WAVE F — In-house telehealth video (infra)
- [ ] **LiveKit/mediasoup SFU + TURN**, signaling, waiting room, session state machine, in-session tooling, recording, audio-only fallback, post-session summary (doc 08) — activate-on-deploy.

---

## Infra decisions to batch (so Wave D/E/F don't stall)
Managed Postgres host (Neon/Render) · KMS provider · LiveKit (cloud vs self-host) + TURN · Stripe account · Twilio voice number + public webhook URL · OTel backend (Grafana/Datadog). All code + config written ahead; you provision/key when ready.
