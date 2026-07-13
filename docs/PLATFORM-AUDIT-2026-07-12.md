# Production-readiness audit

**Overall score: 4/10 — strong demonstration platform, not production-ready.**

The platform is much more than a prototype: it builds, has broad backend coverage, meaningful clinical-safety tests, polished UI, real integration seams, and thoughtful domain architecture. But it currently has multiple stop-ship problems involving authorization, PHI handling, demo credentials, crisis workflows, deployment wiring, migrations, transaction races, infrastructure, and compliance evidence.

I would not expose this version to real patients, clinicians, PHI, or production money.

Scoring guide:

- **1–2:** placeholder/demo only
- **3–4:** partially functional but unsafe/incomplete
- **5–6:** meaningful implementation, significant hardening needed
- **7–8:** production candidate after targeted remediation
- **9–10:** independently validated and operationally proven

A module scoring 6–7 is not safe by itself when shared authentication, ABAC, deployment, or infrastructure remain weak.

## What I verified

- `pnpm build`: **passes**, all four workspaces; 20 Next routes produced.
- API typecheck: **passes**.
- Web typecheck: **passes**.
- API tests: **48/48 suites, 487/487 tests pass**.
- Jest force-exits because timers/workers remain open, which can conceal resource leaks.
- `pnpm lint`: **fails**. Web lint starts an interactive ESLint setup; API, contracts, and database lint scripts only print `lint ok`.
- Production dependency audit: **16 vulnerabilities: 5 high, 11 moderate**.
- The repository contains real Playwright journeys, but browser coverage is narrow and the checked-in last-run result reports failure.
- No files were changed during this audit.

## Backend module scores

| Module | Score | Strengths | Main gaps |
|---|---:|---|---|
| Authentication | **3** | Argon2, TOTP, throttling, server-controlled self-registration role | Hardcoded `tenant_demo`; tenant-ambiguous login; inactive users can log in; no complete refresh, rotation, revocation, recovery or invite lifecycle |
| Credentialing | **6** | License, jurisdiction, expiry and malpractice gates | Manual verification; not consistently enforced by matching or crisis auto-assignment |
| Consent | **6** | Versioned grant/revoke model and AI-consent checks | No signed policy artifact/hash, guardian/capacity model, active-grant uniqueness or complete downstream revocation |
| Intake and screening | **7** | Deterministic screening, consent gate, transactional write, durable risk event | Clinical algorithms need formal validation; PHI remains broadly plaintext; orchestration has limited integration testing |
| Matching | **3** | Explainable scoring and human approval | Candidate ranking ignores several credential/capacity checks; arbitrary psychologist may be approved; retry can double-increment caseload |
| Clinical documentation | **5** | Signatures, amendments, golden-thread checks, field encryption support | Missing caseload ABAC; version races; immutability is not DB-enforced; encryption optional |
| Treatment planning | **5** | Plan supersession, goals and review dates | Any authorized tenant clinician can modify many clients; concurrent active plans possible; incomplete acknowledgement/version lifecycle |
| Psychometrics/CAT/IRT | **6** | Strong algorithms and test coverage; honest calibration warnings | Client can target arbitrary client IDs; answers are not fully validated against instrument items/options; safety config may fail open |
| Outcomes | **5** | Deterministic RCI and honest unknown-reliability handling | Weak client ABAC; caller-controlled clinical facts; deterioration does not reliably enter risk workflow |
| Wearables | **4** | Consent and tenant/device association | No real provider OAuth/webhook verification/deduplication; Timescale path remains unimplemented |
| Client read model | **4** | Primary summary has some assignment checks | May expose draft note excerpts; incomplete encryption-aware projection; no PHI-read audit |
| Clinician read model | **5** | Self-scoped caseload | Thin, no dedicated tests, pagination, access auditing or workload projections |
| CRM/referrals | **4** | Pipeline, deduplication, conversion and timeline foundation | Unsafe account activation/password lifecycle; plaintext lead data; no DNC, consent or campaign execution |
| Communications/telephony | **3** | Real Twilio abstraction and signed voice webhook | SMS is marked delivered without delivery confirmation; no STOP/quiet-hours workflow; media path is not real |
| Risk/crisis | **6** | Deterministic flags, SLAs, safety plans, break-glass records, good tests | Broad tenant access; break-glass grants do not actually alter authorization; no DPO alert consumer; auto-assignment ignores eligibility |
| Scheduling | **4** | Booking transaction, participant checks, agenda and reminder seam | Double-booking/overlap races, weak state machine, incomplete recurrence/reminder execution |
| Payments | **4** | Decimal money, Stripe seam, signed webhook, ledger integration | Concurrent double-capture race; incomplete webhook settlement validation; client checkout authorization problems |
| Accounting | **5** | Balanced-entry enforcement | Entries lack currency isolation; mixed-currency reporting; reconciliation/close/correction lifecycle incomplete |
| Payouts | **3** | Revenue-share calculation exists | Hardcoded USD, duplicate calculations, multi-provider double counting, no approval/disbursement/tax workflow |
| Reports | **4** | Real operational and executive aggregates | Mixed currencies, weak clinical aggregation semantics, no date periods/export artifacts |
| National analytics | **4** | `k=5` small-cell suppression | No differential-privacy/differencing protection or governed population metric pipeline |
| Intervention tracking | **5** | Plan/goal/session links and homework review loop | Missing assignment ABAC; completion may overwrite history; sensitive reports plaintext |
| Diagnosis/formulation | **5** | Human-authored formulation and golden-thread links | No terminology/code-set governance; incomplete lifecycle; missing caseload ABAC; audit is non-atomic |
| Documents | **2** | Metadata records only | No upload/download, blob storage, malware scanning, encryption, retention, versioning, legal hold or watermarking |
| Messaging | **7** | Strong participant checks, pagination, mark-read and solid tests | Plaintext content; transfer can expose history; thread race; tenant-wide realtime metadata |
| Registry | **4** | Transactions, pagination, soft deletion and manager/admin checks | Invited accounts cannot activate; auth ignores account status; deletion does not fully revoke related access |
| Admin/configuration | **4** | Tenant, clinic and feature-flag CRUD | Flags are not consumed; no user/role/permission governance or controlled tenant lifecycle |
| Telehealth | **5** | Real LiveKit tokens, room scoping, participant checks, honest 503 fallback | Consent checked only at creation; waiting-room bypass; weak appointment validation; event/session races |
| AI Gateway | **5** | Deidentified structured inputs, consent gate, deterministic fallback, restrained prompts | Provenance is best-effort; prompt/model registry can diverge from actual calls; no accept/modify/reject API or monitoring loop |
| Health/readiness | **6** | Separate liveness/readiness and DB-dependent 503 | Deployment checks liveness only; startup tolerates DB failure; Redis/outbox/providers omitted; raw errors returned |

## Frontend and portal scores

| Module | Score | Main assessment |
|---|---:|---|
| Static marketing site | **5** | Attractive and multilingual, but incomplete SEO/legal/conversion setup and materially overclaims readiness |
| Next landing page | **6** | Polished, accessible and responsive; branding drifts from the static site |
| Login/authentication UI | **1** | Publicly exposes shared password and one-click privileged demo accounts |
| Portal shell/navigation | **4** | Permission-aware and responsive, but identity is split across cookies/local/session storage; mobile sign-out is hidden |
| Patient home | **3** | Real clinical summary and safety-plan features; dead reschedule control and unsafe US-only crisis fallback |
| Intake | **2** | Good form flow but submission automatically logs in as the demo client |
| Clinician session workspace | **3** | Real API integration, but always selects the first client and can associate drafts with the wrong patient/session |
| Manager matching | **2** | Real approval flow, but automatically logs in as demo manager and lacks reject/hold/reassign controls |
| Assessments | **4** | Real CAT flow; no instrument catalog, assignment inbox, history or reliable resume |
| Risk board | **2** | Broad workflow surface, but demo-login behavior and failed loads display an empty board |
| Scheduling | **2** | Real agenda/status UI; automatically switches users into a demo psychologist session |
| Secure messaging | **6** | One of the strongest screens; real thread, pagination, sending and mark-read |
| Telehealth | **6** | Actual LiveKit room integration and honest unconfigured states; needs network/device/reconnect hardening |
| Communications hub | **1** | Fixed demo thread, fake media storage, demo login and local-camera “call” behavior |
| CRM | **3** | Functional pipeline and conversion; demo session takeover and incomplete engagement tools |
| Finance | **3** | Real API calls; demo login, swallowed payment errors and missing reconciliation/refund tooling |
| Reports | **2** | Real aggregates, but managers are automatically logged in as the executive account |
| Admin/registries | **4** | Broadest CRUD UI; missing staff/role/audit/integration/security governance |

## Cross-cutting scores

| Area | Score |
|---|---:|
| Architecture/modular design | **7** |
| Shared contracts and RBAC foundation | **6** |
| Database/RLS design | **5** |
| Security and PHI privacy | **3** |
| Audit integrity | **4** |
| Eventing/outbox | **5** |
| Realtime | **3** |
| Test implementation | **5** |
| CI quality gates | **6** |
| Deployment/release automation | **2** |
| Observability/on-call | **4** |
| Backup/disaster recovery | **2** |
| Performance/scalability | **3** |
| Accessibility | **5** |
| i18n/RTL completeness | **4** |
| PWA/offline safety | **3** |
| Operational compliance evidence | **3** |
| Documentation accuracy | **4** |

## Stop-ship findings

### 1. Demo authentication enables privilege escalation

Several pages call the login endpoint with fixed demo credentials and overwrite the current httpOnly session. For example:

- A client permitted to open communications or scheduling can be switched into the psychologist account.
- A manager opening reports can be switched into the executive account.
- The public login page exposes one-click administrator and clinical accounts.

Evidence: [login page](</D:/Synexiun/11-HealthSynex/VPSY/apps/web/src/app/login/page.tsx:12>), [communications](</D:/Synexiun/11-HealthSynex/VPSY/apps/web/src/app/(portal)/comms/page.tsx:15>), [reports](</D:/Synexiun/11-HealthSynex/VPSY/apps/web/src/app/(portal)/reports/page.tsx:27>).

If seeded users exist on an internet-accessible deployment, this is a catastrophic authorization failure.

### 2. Patient-level authorization is missing across many backend modules

The system has permissions, tenant scoping, and some service-specific checks, but no mandatory global ABAC layer enforcing:

- client-self;
- active clinician assignment;
- supervising relationship;
- clinic/jurisdiction;
- consent purpose;
- temporary break-glass authorization.

Consequently, an authorized clinician can operate tenant-wide in several notes, plans, diagnoses, outcomes, risk, interventions and document paths. The RBAC file itself describes ABAC as required, but that promise is not systematically implemented: [rbac.ts](</D:/Synexiun/11-HealthSynex/VPSY/packages/contracts/src/rbac.ts:3>).

### 3. Cross-patient PHI contamination is possible in the browser

Session-note drafts use origin-global plaintext `localStorage`. The clinician screen loads that draft before resolving the client/session, then defaults to `caseload[0]`. The IndexedDB outbox is also not scoped by tenant, user or client and survives logout.

This can display or submit one patient’s draft against another patient.

Evidence: [session workspace](</D:/Synexiun/11-HealthSynex/VPSY/apps/web/src/app/(portal)/session/page.tsx:100>), [offline outbox](</D:/Synexiun/11-HealthSynex/VPSY/apps/web/src/lib/offline-outbox.ts:31>).

### 4. Crisis and risk degraded states are unsafe

- Risk-board load failure is replaced with an empty board, potentially communicating “no active risks.”
- Session-workspace risk acknowledgement is only local React state and is neither persisted nor audited.
- A failed or pending jurisdiction lookup displays US 988 resources to users in every country.

Evidence: [risk page](</D:/Synexiun/11-HealthSynex/VPSY/apps/web/src/app/(portal)/risk/page.tsx:89>), [patient crisis fallback](</D:/Synexiun/11-HealthSynex/VPSY/apps/web/src/app/(portal)/home/page.tsx:587>).

### 5. Authentication lifecycle is incomplete

Backend registration hardcodes `tenant_demo`, does not atomically establish the complete client identity, and login searches by email without an explicit tenant boundary or status enforcement. Thirty-day refresh tokens are minted but have no rotation, persistence, reuse detection or revocation workflow.

Evidence: [auth service](</D:/Synexiun/11-HealthSynex/VPSY/apps/api/src/auth/auth.service.ts:14>), [auth controller](</D:/Synexiun/11-HealthSynex/VPSY/apps/api/src/auth/auth.controller.ts:55>).

### 6. Production deployment wiring is broken

The Render configuration has several incompatible assumptions:

- The web middleware needs the API JWT signing secret, but the web service does not receive it.
- Web rewrites are resolved during image build, but `API_URL` is supplied only at runtime.
- Realtime can be compiled to `localhost`.
- Render `host` values are private-network hostnames without a browser-usable public scheme.
- `WEB_ORIGIN` and `PUBLIC_API_URL` are incorrectly absent or derived.
- The hardcoded fallback API hostname does not match the Blueprint service.

Evidence: [render.yaml](</D:/Synexiun/11-HealthSynex/VPSY/render.yaml:35>), [web Dockerfile](</D:/Synexiun/11-HealthSynex/VPSY/apps/web/Dockerfile:52>), [Next config](</D:/Synexiun/11-HealthSynex/VPSY/apps/web/next.config.mjs:21>), [middleware](</D:/Synexiun/11-HealthSynex/VPSY/apps/web/src/middleware.ts:104>).

The current Blueprint is unlikely to sustain authenticated portal sessions as deployed.

### 7. Row-level security is not proven or reliably deployed

CI labels `prisma db push` as migration proof, but `db push` does not execute raw SQL migrations. The tenant RLS policies live in raw SQL, so CI can pass without installing or testing them.

Production has no automated `prisma migrate deploy` pre-deploy step; a comment tells an operator to run it manually.

Evidence: [CI workflow](</D:/Synexiun/11-HealthSynex/VPSY/.github/workflows/ci.yml:77>), [RLS migration](</D:/Synexiun/11-HealthSynex/VPSY/packages/database/prisma/migrations/20260706120000_rls_tenant_isolation_backstop/migration.sql:72>).

### 8. Realtime broadcasts exceed minimum necessary

Every authenticated socket joins a tenant-wide room, and realtime events include risk, escalation, client, appointment, clinician and thread metadata. Users may observe unrelated patient activity.

It is also process-local, so a second API replica will not receive events emitted on the first.

Evidence: [realtime gateway](</D:/Synexiun/11-HealthSynex/VPSY/apps/api/src/common/realtime/realtime.gateway.ts:41>), [realtime bridge](</D:/Synexiun/11-HealthSynex/VPSY/apps/api/src/common/realtime/realtime-bridge.service.ts:39>).

### 9. Audit integrity is weaker than advertised

The audit service reads the latest row and then inserts without serialization, so concurrent events can fork the chain. `before`, IP and user-agent values are not included in the hash. Most audit failures are swallowed.

Even “critical” audits often happen after the business transaction commits, so throwing cannot roll back the clinical mutation.

Evidence: [audit service](</D:/Synexiun/11-HealthSynex/VPSY/apps/api/src/common/audit/audit.service.ts:36>).

### 10. Financial and workflow transactions can race

Examples include:

- matching approval double-incrementing caseload;
- payment capture double-creating payment/ledger rows;
- overlapping schedule bookings;
- concurrent active treatment plans;
- duplicate note/safety-plan versions;
- duplicate telehealth sessions;
- duplicate payout computation.

These need database uniqueness/exclusion constraints and compare-and-swap state transitions, not only service-level “check then write.”

### 11. PHI encryption is optional and incomplete

When `VPSY_FIELD_KEY` is absent, note and safety-plan encryption becomes plaintext passthrough. Other PHI—intake, demographics, messages, SMS bodies, outcomes, CRM and wearable data—is generally not field encrypted.

The single environment master key has no key version, per-tenant DEK, KMS integration or rotation pathway.

Evidence: [field cipher](</D:/Synexiun/11-HealthSynex/VPSY/apps/api/src/common/crypto/field-cipher.ts:52>).

### 12. Some “complete” modules remain API-shaped placeholders

Most important examples:

- Documents: metadata only.
- Communications media: opaque fake storage keys.
- Communications RTC: not real provider-backed telehealth.
- Feature flags: writable but not consumed.
- Payouts: calculation but no actual release/disbursement.
- CRM invitations: no activation delivery.
- Wearables: no provider ingestion.
- AI governance: no human decision queue/API.
- Reminder and recurrence workers: incomplete.

Evidence: [documents service](</D:/Synexiun/11-HealthSynex/VPSY/apps/api/src/modules/documents/documents.service.ts:32>).

## Major strengths

Preserve these during remediation:

- Broad modular-monolith structure with clear bounded contexts.
- Central Zod contracts and strict TypeScript.
- Strong deterministic screening, CAT/IRT and financial arithmetic.
- Meaningful clinical-safety negative tests.
- Human approval gates around matching and AI intent.
- Real Stripe, Twilio and LiveKit seams with honest unconfigured fallbacks.
- Webhook signature checks.
- Participant-aware messaging.
- Transactional outbox adoption for some critical events.
- Non-root, multi-stage containers.
- CI includes safety tests, Playwright/a11y, secret scanning and Docker build proof.
- UI design, responsive behavior and RTL architecture are ahead of most early-stage clinical products.

## What is not completed

At the product level, the following still need real production implementations:

- tenant-aware onboarding, invitations, password reset and MFA recovery;
- user, role and permission administration;
- complete supervisor, finance and government experiences;
- clinician patient/session selection;
- client booking and rescheduling;
- credential evidence and verification integration;
- consent review/revocation UI and guardian consent;
- document upload/download/scanning/storage;
- real media upload/transcoding;
- SMS status, opt-out and quiet-hours compliance;
- intervention/homework patient experience;
- treatment-plan authoring and acknowledgement;
- diagnosis and formulation UI;
- assessment catalog, assignments, history and resume;
- incident-review queue;
- audit-log viewer and disclosure accounting;
- payout approval, disbursement and reconciliation;
- AI recommendation accept/modify/reject governance;
- complete translations with clinical review;
- frontend telemetry, error boundaries and safe degraded states.

Operationally missing:

- production-like staging;
- immutable artifact promotion;
- automatic migrations;
- HA database and API topology;
- structured/redacted logs;
- dashboards, alerts and on-call runbooks;
- backup automation and successful restore drills;
- load/soak/failover testing;
- SBOM, image signing and blocking vulnerability policy;
- completed DPIA, HIPAA risk analysis, vendor/BAA register, retention policy, access reviews and incident exercises.

## Required path to production

### Gate 0 — stop-ship remediation

Before any external pilot or PHI:

1. Remove all automatic demo logins and privileged demo credentials from production bundles.
2. Replace demo registration with tenant-aware invitation/onboarding and enforce user/tenant status.
3. Implement rotating, revocable server-side refresh sessions and MFA recovery.
4. Build a centralized client/caseload ABAC service and apply it to every PHI read and clinical write.
5. Replace tenant-wide realtime rooms with explicit user/care-team/operational rooms.
6. Scope and protect browser drafts/outbox by tenant, user, client and session; clear or quarantine them on logout.
7. Make crisis resource lookup fail safely and never render an empty risk board after an error.
8. Persist and audit every risk acknowledgement.
9. Fix Render/Docker URL and authentication configuration; use asymmetric JWT signing so the web tier only gets a public verification key.
10. Run `prisma migrate deploy` automatically and prove RLS policies with cross-tenant integration tests.
11. Make KMS/encryption and shared Redis mandatory in production.
12. Replace the audit service with a transactional, DB-enforced append-only ledger.
13. Fix matching, payment, scheduling, plan, versioning and payout concurrency using DB constraints.
14. Patch the high dependency vulnerabilities and make high/critical findings blocking.
15. Add Helmet, CSRF/strict-origin protection, proxy configuration, error redaction and production Swagger restrictions.
16. Disable documents, fake communications/media, payout and other incomplete paths until they are real.

### Gate 1 — controlled clinical pilot

Before a limited supervised pilot:

1. Complete session/patient selection, booking/rescheduling, account recovery and all required role landing pages.
2. Build real document/media pipelines with scanning, encryption and retention.
3. Complete Twilio SMS delivery/STOP handling and provider sandbox verification.
4. Validate psychometric responses against immutable instrument versions and fail closed on safety configuration.
5. Obtain documented clinical approval for screening, crisis and psychometric algorithms.
6. Add Postgres/RLS/Redis/provider integration tests and full role×endpoint authorization tests.
7. Add real ESLint, frontend unit/component tests, coverage thresholds and fix Jest’s leaked handles.
8. Deploy a production-like staging environment with mandatory readiness checks and graceful shutdown.
9. Add structured PHI-redacted logging, OTel backend, dashboards, alerts and on-call runbooks.
10. Implement automated backups and record a successful restore/failover drill.

### Gate 2 — general availability

Before normal commercial operation:

1. Complete finance reconciliation, refunds, payout approval/disbursement and currency isolation.
2. Complete AI model/prompt registry linkage, human decisions, eval gates, drift/bias monitoring and kill switches.
3. Finish translations with clinical/legal review.
4. Expand Playwright to mobile, Firefox/WebKit, RTL, offline, token expiry, telehealth recovery and failed-provider paths.
5. Perform external penetration testing and remediate findings.
6. Complete DPIA, HIPAA risk analysis, retention/deletion/legal-hold policies, access recertification and incident exercises.
7. Confirm BAAs/DPAs for every vendor receiving PHI. Render requires an appropriate HIPAA-enabled workspace and signed BAA; Vercel likewise requires a compliant plan and BAA where PHI is involved. See [Render HIPAA guidance](https://render.com/docs/hipaa-compliance) and [Vercel HIPAA guidance](https://vercel.com/kb/guide/hipaa-compliance-guide-vercel).

### Gate 3 — scale readiness

Before multi-instance or national-scale claims:

1. Extract schedulers/outbox into workers with leader election or queue semantics.
2. Replace process-local events/realtime with NATS/Redis Streams and a Redis Socket.IO adapter.
3. Add dead-letter, replay and subscriber-idempotency tooling.
4. Add explicit regional/residency topology, connection pooling, HA, replicas and tested capacity.
5. Run spike, soak, failover and chaos tests against documented SLOs.
6. Stop presenting target-state architecture as implemented status.

## Bottom line

VPSY has an impressive breadth of implementation and a credible architectural foundation. The best modules—intake, messaging, psychometrics, consent and parts of risk—are around **6–7/10**. But the platform’s launch readiness is governed by its weakest shared boundaries: authentication, patient-level authorization, PHI handling, crisis degraded states, migrations, deployment and operations.

Today it is a **strong internal demonstration / engineering alpha**. Closing Gate 0 would make it suitable for deeper controlled testing. Gates 1 and 2 are necessary before real clinical production.
