# VPSY OS — Independent platform audit (2026-07-13)

**Date:** 2026-07-13  
**Baseline:** post Gate 0 / 10-10 eng wave (`56b725c` and prior Gate 0 commits)  
**Method:** adversarial read of code, CI, deploy configs, tests, and docs; cross-check against `PLATFORM-AUDIT-2026-07-12.md` (pre–Gate 0, **4/10** overall).

> **Code upgrade wave (same day):** in-repo hardening landed (ABAC parity, escalate-only intake risk, matching credential re-check, outcomes→risk, message field encryption, MFA recovery + lockout, cookie-aware rate limits, durable break-glass + DPO logger, consent policy hash, note/safety-plan version uniques, Playwright real login, seed prod guard). Infra/external items (SMTP, blob, BAAs, pen test, PITR, clinical validation) remain out of code scope.

---

## Executive verdict

| Lens | Score | Meaning |
|------|------:|---------|
| **Production readiness (real PHI + real money)** | **5 / 10** | Hardened demonstration / supervised technical pilot at best — **not** safe for live patients, regulated PHI, or production payments. |
| **Engineering completeness (code exists, honest fallbacks)** | **7.5 / 10** | Far beyond prototype; Gate 0 closed many stop-ships. Still incomplete on documents, disbursement, SMTP, HA, E2E drift, encryption coverage. |
| **Clinical-core strength (risk, notes, psychometrics, AI gate)** | **~6.3 / 10** | Strong invariants in unit tests; algorithms not externally validated; ABAC coverage uneven; crisis paging is a seam only. |
| **Security spine (auth, ABAC, audit, crypto, rate limit)** | **~6.5 / 10** | Session model and critical fail-closed paths are real; seed secrets, plaintext PHI surface, manager over-broad access remain. |

### One-line truth

> The July 12 stop-ships (demo privilege logins, no refresh, dead ABAC, break-glass no-op, silent audit, no prod key fail-fast) are **largely closed**.  
> The platform is **not** a 10/10 product and is **not production-ready** for PHI. Calling eng “≈10/10” overstates residual gaps.

### Scoring guide (used throughout)

| Band | Meaning |
|------|---------|
| 1–2 | Placeholder / deliberately disabled |
| 3–4 | Partial or unsafe for pilot |
| 5–6 | Meaningful implementation; significant hardening needed |
| 7–8 | Production *candidate* after targeted work |
| 9–10 | Independently validated + operationally proven |

---

## Delta since 2026-07-12 audit

| Old stop-ship | Status now |
|---------------|------------|
| Demo privilege-escalation logins on portal pages | **Fixed** (credential login only) |
| No refresh rotation / family revoke | **Fixed** |
| ClinicalAccessService unwired | **Mostly fixed** (core clinical routes) |
| Break-glass does not authorize | **Fixed** on ClinicalAccessService path |
| Payment / assignment races | **Mostly fixed** (CAS + partial uniques) |
| Production field key / Redis fail-fast | **Fixed** (with escape hatches) |
| SMS STOP / quiet hours | **Fixed** |
| AI accept/modify/reject queue | **Fixed** |
| Instrument LicenseGrant | **Fixed** (administer + CAT) |
| Plan client acknowledgment | **Fixed** |
| Shared seed password `Vpsy!2026` | **Still present** (local demo only — catastrophic if public) |
| Documents blob + malware | **Still missing** (honestly disabled in prod) |
| SMTP password-reset delivery | **Still missing** |
| Clinical algorithm external validation | **Still missing** |
| Pen test / BAAs / HA / PITR | **Still missing** |

---

## 1. Backend module scores

| # | Module | Score | Strengths | Must-have gaps (production PHI) | Nice-to-have |
|---|--------|------:|-----------|---------------------------------|--------------|
| 1 | **Identity & Access** | **7** | Argon2, refresh rotation + reuse family revoke + `authVersion`, MFA TOTP + restricted sessions, tenant-aware registration, password-reset tokens, JWT fail-fast | Shared seed password; **no SMTP** delivery; no account lockout; permissions baked into JWT; no MFA recovery codes | WebAuthn, device trust, invite lifecycle, asymmetric JWT |
| 2 | **Tenant / Clinic Network** | **4** | Schema + seed + admin CRUD seeds | No full onboarding, residency, multi-clinic ops, public network | SEO clinic directory, SLA portals |
| 3 | **Client Registry** | **5** | Read model + registry CRUD + soft delete | Incomplete invite activation; no full DSAR/erasure orchestration | Guardian/minor model, advanced search |
| 4 | **Psychologist Registry** | **5** | Registry + caseload | Invite activation; offboarding does not fully revoke sessions | Public profiles, PSYPACT multi-jurisdiction |
| 5 | **Audit & Compliance** | **7** | SHA-256 hash chain, advisory lock, critical fail-closed on key actions, audit-read API | Default non-critical still swallows after ERROR; no SIEM/WORM; incomplete PHI-read audit | Daily chain anchor, DPO SIEM export |
| 6 | **Admin Configuration** | **5** | Tenant/clinic/feature-flag CRUD; AI kill switch used | No full user/role governance; flags not universally consumed | Policy CMS, integration catalog |
| 7 | **Credentialing & Contracts** | **6** | `ClinicalWriteGuard` + jurisdiction/expiry/malpractice; safety tests | Manual verify only; **not** re-checked on matching approve / risk auto-assign | NPI/NPDB, renewal alerts, privilege matrix |
| 8 | **Intake & Screening** | **6.5** | Consent gate; deterministic safety → Risk; durable events | Risk level can **downgrade** prior SEVERE; algorithm not validated; PHI plaintext | Progressive intake, guardian flows |
| 9 | **Scheduling** | **6.5** | Assignment-gated book; CAS slot claim; overlap check; agenda UI | No DB exclusion constraint; reminders not a durable worker | Recurrence, external calendars, waitlist |
| 10 | **Clinical Profile** | **5** | Upserted at intake | No dedicated module/lifecycle | Longitudinal profile UI |
| 11 | **Matching & Assignment** | **6** | Deterministic rank; manager authority; open-assignment unique; approve CAS + capacity | Approve can skip credential re-check; no reject/hold/reassign API | Preference matching, waitlist, outcome-based ranking |
| 12 | **Telehealth** | **6.5** | LiveKit tokens, participant ABAC, honest 503, waiting-room without media | Consent re-check at join; recording policy; TURN/HA topology | In-session tools, post-session QA |
| 13 | **Clinical Documentation** | **7** | Sign/amend, golden-thread, field encryption on content, ABAC | App-level immutability only; version races; audit not in same TX | Cosign, templates, legal PDF |
| 14 | **Messaging** | **7.5** | Strong participant ABAC; pagination; mark-read; solid tests; polished UI | Message bodies **plaintext**; retention/legal hold; reassignment history rules | Attachments, retract, search |
| 15 | **Documents** | **2.5** | Honest capability status; prod disabled without blob | **No** real blob, malware scan, download, versioning, legal hold | OCR, e-sign packets |
| 16 | **Psychometrics** | **7** | Classical + IRT + CAT; safety→Risk; license grant 403; response validation; strong tests | Read/interpret ABAC weak; algorithms not validated; answers plaintext; no DIF | Norms, exposure control, royalty metering UI |
| 17 | **Diagnosis Support** | **6** | Human-only formulations; ABAC; critical audit | Free-text codes (no ICD/DSM pack); thin lifecycle | Terminology service, problem-list sync |
| 18 | **Treatment Planning** | **6.5** | Supersede + one-active unique; SMART goals; review cadence; client ack | Overdue list tenant-wide; ack not identity-proved to client role only | Co-sign, payer printables |
| 19 | **Intervention / Homework** | **6** | Anchored to active plan; review loop; patient complete UI | Completion overwrites history; plaintext reports | Homework library, adherence analytics |
| 20 | **Outcomes** | **5.5** | Honest RCI + unknown-reliability | Caller-controlled values; **no risk raise** on reliably-worsened; no MBC schedule automation | Full instrument tables, dashboards |
| 21 | **Risk & Crisis** | **7** | Human-only resolve; SLA; safety plans; break-glass authorizes; fail-safe UI | **No DPO/on-call consumer**; auto-assign ignores credential eligibility | Duty roster, SMS fan-out, drills |
| 22 | **AI Gateway** | **7** | De-ID inputs; consent; PENDING ledger; decide UI; kill switch | Model registry / eval / EU AI Act package incomplete | Offline eval, multi-provider failover |
| 23 | **Wearables** | **4** | Consent gate; non-diagnostic rollup | No OAuth/webhook/dedup; no Timescale | Apple/Google Fit, research exports |
| 24 | **Payments** | **6** | Decimal; OPEN→PAID CAS; Stripe seam + webhook; idempotency | Refunds/chargebacks; amount verify; client self-pay model | Dunning, multi-PSP |
| 25 | **Accounting** | **6** | Balanced double-entry with capture | Currency isolation; close/correction lifecycle | Multi-entity, multi-currency |
| 26 | **Payouts** | **4** | Compute + composite share | **Disburse 503**; no approval/tax/ACH | Stripe Connect, 1099 |
| 27 | **Reports** | **5.5** | Live aggregates + persisted Report | Periods, export artifacts, currency | Scheduled delivery, BI warehouse |
| 28 | **National Analytics** | **5.5** | k=5 suppression | No DP/differencing; seed-heavy metrics | Governed ETL, jurisdiction exports |
| 29 | **CRM & Referrals** | **5.5** | Pipeline, dedupe, convert | DNC/consent for outreach; invite/password on convert | Sequences, public referral forms |
| 30 | **Communications Hub** | **6.5** | Twilio SMS/voice; STOP; quiet hours; templates; signed webhooks | Fake DELIVERED without DLR; media not real storage; UTC quiet hours | 10DLC, two-way threads, recording gates |

**Backend average (unweighted): ~6.0**

---

## 2. Frontend / portal scores

| Surface | Score | Notes |
|---------|------:|-------|
| Marketing / landing | **6** | Polished, i18n; avoid overclaiming production readiness |
| Login / MFA / password reset | **7** | Real credentials + MFA gate; reset UX exists (SMTP missing) |
| Portal shell / middleware | **7** | Permission-aware; Edge JWT; expanded matcher |
| Patient home | **6.5** | Live summary, homework, plan ack, crisis card (jurisdiction-aware) |
| Intake UI | **6** | Real submit path (no auto demo-login) |
| Session workspace | **6.5** | Live caseload + notes; offline outbox scoped |
| Manager matching | **6** | Real approve; limited reject/hold UX |
| Assessments / CAT | **6.5** | Real CAT; catalog/inbox thin |
| Risk board | **7** | Fail-safe empty-state; real workflows |
| Schedule | **6.5** | Real agenda/book/status |
| Messaging | **8** | Strongest portal surface |
| Telehealth | **6.5** | LiveKit UI + honest unconfigured |
| Comms hub | **5.5** | Improved vs old demo; media still stubby |
| CRM | **6** | Functional pipeline |
| Finance | **6** | Real APIs; limited reconciliation UX |
| Reports | **5.5** | Aggregates; executive semantics thin |
| Diagnosis / AI queue / Audit / Admin | **6–6.5** | Present and wired |

**Frontend average: ~6.4**

---

## 3. Cross-cutting scores

| Area | Score | Must-have residual |
|------|------:|--------------------|
| Architecture / hexagonal modules | **8** | Keep contracts+EventBus discipline |
| Shared contracts / RBAC | **7** | Manager over-broad; PolicyEngine unused in enforcement |
| Database / migrations / RLS | **6.5** | Expand RLS; version uniqueness; migrate on deploy |
| Security & PHI privacy | **5.5** | Encryption coverage; seed isolation; pen test |
| Audit integrity | **7** | Critical by default for clinical writes |
| Eventing / outbox | **6.5** | Break-glass still non-durable; multi-replica proof |
| Realtime | **6** | Minimum-necessary rooms; HA scale |
| API unit tests | **7.5** | 557 tests; forceExit hides leaks |
| Clinical-safety CI gate | **8** | Blocking named suite |
| E2E / a11y | **4** | **auth.setup still expects removed demo buttons** |
| Lint quality | **3** | API lint is `echo 'lint ok'` |
| Dependency hygiene | **4** | **8 high** vulns still reported by `pnpm audit` |
| CI pipeline shape | **7.5** | migrate deploy + safety + audit + gitleaks + docker |
| Deploy (Render/Docker) | **5** | Manual secrets/migrate; web JWT copy |
| Observability | **5** | OTel code present; no on-call SLOs/alerts proven |
| Backup / DR | **2** | Documented only |
| Performance / scale | **4** | No load tests; single-instance patterns |
| Accessibility | **6** | Axe in e2e when e2e works |
| i18n / RTL | **7** | 10 locales + deep merge fallback |
| PWA / offline | **5** | Note outbox only |
| Compliance evidence | **3** | No BAA pack, DPIA pack, pen-test report |
| Documentation honesty | **6** | Improved after Gate 0; eng-10 claim overstated |

---

## 4. What you have vs what you should have vs nice-to-have

### A. Already strong (keep as foundation)

- **Clinical principle enforced in architecture:** AI assists, humans decide; manager assignment authority; human-only risk resolve.
- **Auth session model:** refresh rotation, reuse detection, MFA enrollment gate, cookie + middleware defense-in-depth.
- **Money correctness spine:** `Decimal`, payment CAS, ledger balance checks, Stripe activate-on-key.
- **Psychometrics depth unusual for a startup EHR:** classical + IRT EAP + CAT + safety routing + license grants.
- **Risk product:** SLAs, follow-ups, safety plans, break-glass, jurisdiction crisis resources.
- **Honest incomplete paths:** documents disabled in prod; telehealth 503 without LiveKit; payouts disburse 503.

### B. Must-have for a **controlled clinical pilot** (real PHI, limited sites)

| Priority | Item | Why |
|----------|------|-----|
| P0 | **Never seed shared passwords** on any networked env; force unique secrets + MFA | Single credential = total compromise |
| P0 | **SMTP (or transactional email)** for password reset + security alerts | Recovery is non-functional in prod today |
| P0 | **Field encryption on by default** + inventory remaining plaintext PHI (messages, SMS, intake) | HIPAA/GDPR baseline |
| P0 | **Universal caseload ABAC** (psychometrics read/interpret, clients summary break-glass parity, manager minimum-necessary options) | Minimum-necessary |
| P0 | **DPO / on-call consumer** for break-glass + SEVERE SLA breach | Crisis ops DoD |
| P0 | **Matching approve re-check credentials**; risk auto-assign eligibility | Scope-of-practice |
| P0 | **Intake risk non-downgrade** (escalate-only like psychometrics) | Patient safety |
| P0 | **Fix Playwright E2E auth** after demo-button removal | Release gate is currently lying |
| P0 | **Deploy pipeline:** migrate deploy, shared secrets, HTTPS origins, no demo seed in prod | Ops safety |
| P0 | **Backup PITR + restore drill** | Ransomware / disk failure |
| P0 | **BAAs** with host, DB, email, SMS, video, AI, storage | Legal prerequisite for PHI |
| P0 | **External pen test** + fix criticals | Independent security proof |
| P1 | **Documents:** S3 + presign + malware scan + encryption | Care delivery incomplete without files |
| P1 | **Critical audit by default** on clinical writes; durable BreakGlass event | Non-repudiation |
| P1 | **Cookie-aware rate limits** + account lockout | Credential stuffing |
| P1 | **Signed consent artifacts** (policy hash) | Consent defects risk |
| P1 | **Clinical algorithm sign-off** (screening, cutoffs, C-SSRS-style mapping) | Liability / claims |
| P1 | **Triage dependency highs** (multer et al.) | Supply chain |

### C. Must-have for **production money / national scale**

- Refunds, chargebacks, reconciliation, client self-pay.
- Real payout disbursement + tax reporting.
- HA multi-replica (Redis-backed everything, no process-local assumption).
- Load/chaos tests; multi-tenant isolation integration tests.
- National analytics re-identification resistance beyond k=5.
- Comp-model composability and marketplace take-rate if monetizing that way.

### D. Nice-to-have (product excellence, not day-1 blockers)

- DIF / TIF psychometrics, PROMIS banks, licensed instrument marketplace.
- Wearables OAuth + Timescale.
- Full PWA offline charting.
- Supervisor cosign workflows; government portal.
- Public clinic network SEO.
- WebAuthn, step-up MFA, device trust obligations from PolicyEngine.
- k6 load, Testcontainers, SBOM/image signing.
- AI offline eval harness and multi-provider failover.

---

## 5. Roadmap to a true **10/10 product**

A 10/10 product is not “all modules written.” It is **safe, proven, operated, and clinically defensible**.

### Phase G1 — Pilot-ready (target: **7.5–8 / 10 production**)

**Goal:** 1–3 clinics, real clinicians, limited PHI, no autonomous money movement.

1. Security ops: seed lock, SMTP, MFA recovery codes, lockout, pen test, fix high CVEs.  
2. ABAC completeness: one access path; manager scopes; psychometrics reads.  
3. Crisis ops: real DPO/pager consumer; credentialed auto-assign.  
4. Data protection: encrypt message/SMS/intake hot fields; KMS plan.  
5. Documents MVP: S3 + ClamAV/comparable + download audit.  
6. Release: auto migrate, backup restore drill, fixed E2E, no force-exit blindness.  
7. Legal: BAAs, DPIA draft, clinical algorithm review memo (even if “demo-calibrated only”).

**Exit criteria:** pen test clean of criticals; restore drill pass; e2e green; no shared demo passwords; documents usable or explicitly out-of-scope with paper process.

### Phase G2 — Production clinic (target: **8.5–9 / 10**)

1. Money: refunds, reconciliation, limited Stripe live with dual control.  
2. Payouts: approval + ACH/Connect.  
3. Telehealth: production LiveKit/TURN, recording policy, join consent re-check.  
4. Observability: SLOs, paging, audit chain daily verify job.  
5. HA: multi-instance API, Redis sole shared state.  
6. Consent e-sign + policy hash; staff lifecycle + session revoke-all.

**Exit criteria:** 30-day live clinic with zero P1 security incidents; financial reconciliation day-close; crisis drill tabletop complete.

### Phase G3 — Scale / national claims (target: **9–10 / 10**)

1. Clinical validation studies for screening/RCI/IRT claims you market.  
2. EU AI Act / CDS documentation pack if AI claims persist.  
3. National analytics governed ETL + re-id resistance.  
4. Multi-region residency; formal DR multi-AZ.  
5. Independent SOC2 / HITRUST / ISO as go-to-market requires.  
6. Load-tested at target concurrent sessions; chaos proven.

**Exit criteria:** external audit + clinical governance board sign-off + uptime/SLO evidence — not unit test counts.

---

## 6. Production readiness decision matrix

| Use case | Ready? | Conditions |
|----------|:------:|------------|
| Local demo / investor walkthrough | **Yes** | Use seed; label synthetic calibration |
| Internal staff dogfood (no real PHI) | **Yes** | Synthetic data only |
| Supervised technical pilot (PHI) | **Conditional** | Complete Phase G1 must-haves first |
| Multi-clinic production PHI | **No** | Needs G1+G2 |
| Production money at scale | **No** | Refunds, reconciliation, payouts, dual control |
| National government analytics claims | **No** | Governed pipeline + legal + re-id science |
| Market as “production-ready EHR” | **No** | Would be a material overclaim today |

---

## 7. Top residual risks (ordered)

1. **Shared demo credentials in seed** on any public DB.  
2. **Documents / media not real** — care packaging incomplete.  
3. **Plaintext PHI** in messaging, SMS, intake, many clinical JSON fields.  
4. **ABAC inconsistency** — not every PHI path uses the same enforcer; manager is tenant-wide.  
5. **Crisis notifications are seams** — break-glass / SLA without human pager.  
6. **E2E release gate drift** — Playwright expects removed demo logins.  
7. **High severity npm advisories still open.**  
8. **No SMTP, no PITR proof, no pen test, no BAAs.**  
9. **Clinical algorithms are implementable math, not validated care protocols.**  
10. **Docs “eng ≈ 10/10” language** can create false confidence — treat as program aspiration, not independent audit.

---

## 8. Composite scorecard (one page)

```
Production PHI readiness ..............  5.0 / 10
Engineering completeness ..............  7.5 / 10
Clinical-core safety ..................  6.3 / 10
Security spine ........................  6.5 / 10
Money correctness .....................  6.0 / 10
Ops / DR / compliance evidence ........  3.0 / 10
Frontend product quality ..............  6.4 / 10
Test confidence (unit strong, e2e weak)  6.0 / 10
```

**Compared to 2026-07-12 overall 4/10:**  
roughly **+1.0 to +1.5** on true production readiness, **+3 to +4** on engineering maturity for a modular monolith of this breadth.

---

## 9. Recommended next 30 days (maximum leverage)

1. Fix Playwright auth → restore blocking E2E truth.  
2. Guard seed: refuse shared password unless `ALLOW_DEMO_SEED=true`.  
3. Wire SMTP + password-reset delivery test.  
4. Encrypt messaging bodies under field cipher.  
5. Unify psychometrics read/interpret under ClinicalAccessService.  
6. Matching approve credential re-check + intake risk escalate-only.  
7. DPO alert subscriber (even email) for break-glass + SEVERE breach.  
8. Document blob MVP or formal “paper documents only” pilot SOP.  
9. `pnpm audit` high remediation / reviewed exceptions.  
10. Staging restore drill + pen-test kickoff + BAA draft pack.

---

*This report is engineering-adversarial. It is not a legal opinion, clinical validation, or pen-test certificate. For production PHI, obtain counsel, security testing, and clinical governance sign-off independently of this document.*
