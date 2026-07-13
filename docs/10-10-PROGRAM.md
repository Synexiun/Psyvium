# VPSY OS — The 10/10 Program (doc-verified gap backlog)

**Mandate:** every module and procedure the docs promise, built to spec, verified, confirmed — 10/10, nothing skipped.
**Method:** the docs define "done." Three independent read-only audits (business, core-technical, delivery/cross-cutting) cross-checked every documented requirement against real code. This file is the program of record; each item is closed by *build → verify (build+test+smoke) → confirm against its doc*.

**Legend:** `[ ]` open · `[~]` in progress · `[x]` done & verified · **(infra)** = needs a deploy target/credential; built as code + activate-on-deploy so it never blocks.

> **Latest production-readiness audit:** [`PLATFORM-AUDIT-2026-07-12.md`](PLATFORM-AUDIT-2026-07-12.md) — overall **4/10** before Gate 0; engineering remediation wave in progress (infra deferred). Gate 0 closes stop-ship authorization/PHI/auth lifecycle issues before any pilot with real PHI.

---

## GATE 0 — stop-ship remediation (from 2026-07-12 audit)
- [x] **Remove demo privilege-escalation logins** from portal pages + public one-click admin accounts.
- [x] **Tenant-aware registration + active status gates** (opt-in `Tenant.selfRegistrationEnabled` + slug).
- [x] **Server-side refresh sessions** with rotation, family revoke on reuse, `authVersion` invalidation.
- [x] **Central clinical ABAC** (`ClinicalAccessService` + guard) on notes/plans/diagnosis/outcomes/interventions/risk/documents/wearables; risk boards caseload-scoped; break-glass honored.
- [x] **Realtime minimum-necessary** — no tenant-wide clinical broadcast; user + operational role rooms only.
- [x] **Browser PHI isolation** — drafts/outbox keyed by tenant+user+client+session; legacy global keys purged; no auto patient select.
- [x] **Crisis fail-safe UI** — risk board never renders empty after error; emergency card never substitutes US 988 without confirmed jurisdiction.
- [x] **Instrument response validation + safety config fail-closed** (`response-validation.ts`).
- [x] **Matching open-assignment uniqueness** + approve compare-and-swap + capacity check (no double caseload).
- [x] **Payment capture compare-and-swap** (OPEN→PAID) + unique captured-payment index.
- [x] **Audit chain serialization** (per-tenant advisory lock) + before/ip/ua in hash material; critical fail-closed retained.
- [x] **Production PHI encryption mandatory** unless explicit plaintext allow; documents metadata-only disabled in prod; security headers + Swagger opt-in.
- [ ] **Render/Docker JWT + public URL wiring** **(infra)**.
- [x] **CI `prisma migrate deploy`** — replaces `db push` so raw SQL (RLS, partial uniques) installs in CI.
- [x] **Shared Redis mandatory multi-instance** — production boot fails without `REDIS_URL` unless explicit single-instance allow.
- [x] **Dependency high/critical vulns blocking policy** — `pnpm audit --audit-level high` is blocking in CI.

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
- [x] **MFA/TOTP** — enroll + verify; mandatory clinical/admin roles get `mfaEnrollmentRequired` restricted sessions until TOTP is verified (`/security/mfa`).
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
- [x] **Wire the AI agents** (doc 05 §3): Differential-Hypothesis, Treatment-Plan, Session-Note, Outcome, Psychometric-Interpretation, and Allocation rationale. All PENDING/human-gated, PHI-minimized. **Human decision queue API** + **`/ai-queue` clinician UI** (accept / modify / reject) + FeatureFlagsService kill switch.
- [x] **Intervention/Homework** patient home surface — list + complete homework from live API; empty state only when none assigned.
- [x] **Diagnosis Support UI** — `/diagnosis` clinician surface for differentials + coded formulations (no AI write path).
- [x] **Password reset** — request/complete API (enumeration-safe; digest-only tokens; session revoke on complete).
- [ ] **Diagnosis Support** module (differential-hypothesis surface).
- [ ] **Documents** module (upload/version/e-sign).
- [x] **SMS STOP/opt-out + quiet-hours** — `SmsOptOut` model, staff opt-out API, inbound keyword STOP/START, quiet-hours gate on staff + system SMS.
- [x] **Twilio inbound SMS webhook** — signed `POST /comms/webhooks/twilio/sms-inbound` applies STOP/START and returns TwiML.
- [ ] **SMS templates** (doc 15) still open.
- [ ] **Comp-model composability** (doc 05): `computePayout` must read senior-override/supervisor/clinic/referral fields, not a flat pct.
- [x] **Audit-Read API** — `GET /audit/events` (cursor pagination, entity/actor filters) for `AUDIT_READ`.
- [ ] **Central PolicyEngine (ABAC)** (doc 03/06 §4.4): consentState, emergencyOverride, deviceTrust, dataResidency + `obligations[]`.
- [ ] **Refresh-token rotation/differentiation** + `/auth/refresh` + `sessionId` claim + reuse detection (doc 06 §3).

## WAVE D — Production hardening (build as code)
- [ ] **OpenTelemetry** traces/metrics/logs, PHI-safe attrs, correlation ids (doc 10 §7).
- [ ] **CI gates** (doc 10 §4): lint, typecheck, SAST/secret-scan, unit, clinical-safety, e2e, a11y, build.
- [ ] **Dockerfile(s)** + `/healthz`/`/readyz` probes (doc 10 §5).
- [x] **Feature-flag/kill-switch service** — `FeatureFlagsService` + AI_ASSISTED_ANALYSIS kill switch on every model path.
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

## WAVE CR — Clinical Rigor (from the 2026-07-06 evidence-based audit; each item cites its literature)
Three read-only clinical auditors graded the clinical sections against the published evidence base (AERA/APA/NCME Standards, COSMIN, C-SSRS, Stanley-Brown SPI, Zero Suicide, Joint Commission NPSG 15.01.01, APA Record Keeping, Kazantzis homework meta-analyses, FDA CDS 2022, EU AI Act, APA AI guidance 2025). IRT math, break-glass, human-only resolution, and EU-AI-Act oversight/logging were **credited as sound**. Gaps, ranked:

**Done immediately (commit `10f5cf5`):**
- [x] Dead crisis-chat button → real 988 chat link (top patient-safety hazard).
- [x] Persisted-score hedge clause + "assumed-normal, no empirical norm sample" + "⚠ SYNTHETIC CALIBRATION — DEMO ONLY" branding (Standards Ch.4/6).

**P0 — patient safety & scientific integrity**
- [x] Graduated C-SSRS-style triage (`5c102ed`): ideation-intensity 0–5 + behavior-history; severity from C-SSRS decision logic; safety-item raw answer drives flag severity; recentLoss feeds the score; legacy boolean payloads unchanged.
- [x] `Escalation.slaBreached` real (`5c102ed`): slaDueAt per severity (SEVERE 60min/HIGH 4h); sweep sets breach + audits + event; unassigned SEVERE auto-assigned to least-loaded clinician after 15min. RLS-safe per-tenant.
- [x] Follow-up/caring contacts (`5c102ed`): followUpDueAt REQUIRED for HIGH/SEVERE resolutions + completion endpoint; board shows resolved-awaiting-follow-up (`d54f5b9`).
- [x] Structured resolution (`5c102ed`): riskLevelAtResolution + interventionsApplied[] + followUpDueAt.
- [x] Stanley-Brown-complete SafetyPlan (`5c102ed`+`d54f5b9`): distraction/help split, structured means-restriction, crisisLineInfo, client acknowledgment, client-visible copy (GET /risk/safety-plans/me + home-page card with real tel/sms/chat links).
- [x] Jurisdiction-aware crisis resources (`4a54b55`): country→line registry + GET /risk/crisis-resources; emergency card renders the resolved jurisdiction's real numbers (988 only when US-confirmed). Session-start location confirmation = telehealth-wave follow-up.
- [x] Coded `Formulation` model (`ae5587a`): ICD+DSM codes, PROVISIONAL/CONFIRMED/RULED_OUT, hypothesis lineage, clinician-only, critical-audited, no AI write path.
- [x] Golden-thread enforcement (`ae5587a`): note with an active plan must reference planId + ≥1 valid goalId (400 lists valid goals); sessionSnapshot + riskStatusAtNote; no-active-plan honestly flagged.
- [x] `AI_ASSISTED_ANALYSIS` consent gate (`ba97ee6`): model never invoked without a live grant (withheldReason recorded, honest fallback); never intake-blocking. Client-facing disclosure surface = follow-up (web).
- [x] Real item content (`2f54183`): 9 original stems seeded; PHQ-9-convention subBands restored; GAD-7 band drift fixed to Spitzer 2006; ItemTranslation w/ back-translation provenance — only 'validated' served as localized, else honest 'unvalidated-source-language'.

**P1 — clinical quality**
- [x] SMART-goal enforcement + review cadence + overdue tracking (`e5076b6`). Client acknowledgment on TreatmentPlan = follow-up.
- [x] Amendment semantics (`ae5587a`): post-signature notes require amendmentReason; amendsVersionId.
- [x] Homework loop per Kazantzis (`ba97ee6`): rationale, difficulty, review-at-next-session endpoint (reviewedAt/By/Notes/reviewOutcome).
- [x] Reliable Change Index (`e5076b6`): Jacobson-Truax w/ cited PHQ-9/GAD-7 psychometrics; honest 'unknown-reliability' fallback.
- [ ] Validate-or-replace the intake composite risk score (recentLoss now feeds it — the validation study remains).
- [ ] DIF pipeline (min. Mantel-Haenszel); TIF/conditional-SE reporting; LicenseGrant 403 gate.
- [x] Post-incident review (`4a54b55`): IncidentReview (reviewer/co-sign/action items) + pending "never ages silently" list for SEVERE resolutions + break-glass; deliberately not a resolution gate. Transition-of-care record = follow-up.
- [ ] AI: persist the de-identified signal bundle (not just hash) for true replay; promote approvedForProduction/approvedBy to real columns; soften the FDA time-sensitivity claim for the crisis agent pending regulatory review.

## WAVE F — In-house telehealth video (infra)
- [ ] **LiveKit/mediasoup SFU + TURN**, signaling, waiting room, session state machine, in-session tooling, recording, audio-only fallback, post-session summary (doc 08) — activate-on-deploy.

---

## Infra decisions to batch (so Wave D/E/F don't stall)
Managed Postgres host (Neon/Render) · KMS provider · LiveKit (cloud vs self-host) + TURN · Stripe account · Twilio voice number + public webhook URL · OTel backend (Grafana/Datadog). All code + config written ahead; you provision/key when ready.
