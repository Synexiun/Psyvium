# VPSY OS — Go-to-Market & Phasing

> **AI assists, licensed clinicians decide.** The phasing below deliberately ships the governed clinical core *before* the AI layer — intelligence is added on top of a system that is already safe, compliant, and human-authoritative.

This document lays out the six product phases, the go-to-market motion, the rollout by country, and the national-infrastructure play that is VPSY's ultimate destination.

---

## 1. Product Phasing — Six Phases

VPSY is built in six phases. The ordering is a strategic safety decision: **clinical rigor and governance first, intelligence second, scale infrastructure last.** You cannot responsibly layer AI onto care you have not first made governed and measurable.

### Phase 1 — Clinical Core
**Goal:** a safe, compliant, human-authoritative system of record that can run real clinical work.
- Client master record (FHIR-compatible), consent/2FA/identity (Layer 2 basics).
- Psychologist clinical cockpit, Manager command center (assignment as human decision), Patient PWA.
- Booking/calendar, embedded telehealth.
- Compliance foundation: audit trail, RBAC, residency-aware storage.
- Manual/basic screening; static assessments.

**Exit criteria:** a real clinic can run intake → Manager assignment → sessions → notes → billing entirely inside VPSY, with full audit and consent governance.

### Phase 2 — Real Clinic Operations
**Goal:** turn the clinical core into a running business — the Business OS/ERP.
- Clinician hiring, contracts, and the compensation engine (12+ models and composites).
- Accounting, invoicing, revenue share, automated payouts, financial dashboards.
- Referral portals (doctors/schools/companies/courts/institutions) with attribution and referral-share.
- Public clinic network (Layer 1) with directory and specialty pages.

**Exit criteria:** VPSY runs the full operational and financial life of a multi-clinician clinic, including complex compensation and referral economics, with clean month-end close.

### Phase 3 — AI Clinical Assistant
**Goal:** layer assistive intelligence onto the governed core — human-in-the-loop from day one.
- The 8 specialized agents (intake, differential-hypothesis, treatment-plan, session-note, outcome, crisis/risk, psychometric-interpretation, manager-allocation).
- Full traceability, transparency, and human sign-off logging (EU AI Act high-risk posture).
- Crisis/risk escalation hardened as the highest-priority path.

**Exit criteria:** every AI surface produces reviewable drafts/rankings/flags that a licensed human owns; no autonomous clinical action anywhere; crisis signals cannot die silently.

### Phase 4 — Advanced Psychometrics
**Goal:** the scientific moat — modern measurement at scale.
- IRT scoring, Computerized Adaptive Testing (CAT), norms/standardization.
- Validity scales, reliable-change and clinically-significant-change tracking.
- Multi-language administration and DIF/measurement-invariance analysis.
- Item-bank management and instrument governance.

**Exit criteria:** assessments are adaptive, IRT-scored, validity-checked, longitudinally comparable, and demonstrably fair across languages/populations (DIF evidence).

### Phase 5 — Wearables & Outcomes
**Goal:** longitudinal, real-world monitoring feeding measurement-based care.
- Wearable/device ingestion (sleep, activity, physiological signals) into the outcome record.
- Longitudinal outcome dashboards blending psychometric and passive-sensing signals.
- Outcome benchmarking across cohorts, conditions, clinicians (aggregate, de-identified).

**Exit criteria:** care is continuously informed by longitudinal, multi-source outcome data — the deepest expression of the data moat.

### Phase 6 — Country-Scale Infrastructure
**Goal:** the national play — behavioral-health intelligence infrastructure for a country.
- Full multi-tenant, multi-country kernel: residency, localization, currency, regulation, compensation law per jurisdiction.
- Institutional/government dashboards (aggregate, de-identified, governed).
- Population-level visibility and outcomes proof for public-health authorities.
- Interoperability with national health records where permitted (FHIR).

**Exit criteria:** a government or national health system can run its behavioral-health program on VPSY with population visibility, proven outcomes, data residency, and regulatory-grade governance.

### Phasing summary

| Phase | Theme | Primary buyer unlocked | Moat deepened |
|---|---|---|---|
| 1 | Clinical core | Individual clinics | Workflow, compliance |
| 2 | Clinic operations (ERP) | Clinic networks | Workflow, economics |
| 3 | AI assistant | Quality-driven networks | Regulatory (governed AI) |
| 4 | Advanced psychometrics | Outcome-focused buyers, payers | Data / outcome science |
| 5 | Wearables & outcomes | Payers, research partners | Data (longitudinal) |
| 6 | Country-scale infra | Governments, national systems | Regulatory + network + data |

---

## 2. Go-to-Market Motion

VPSY's GTM is **B2B2C via clinics, expanding to institutional and government.** We do not acquire clients one at a time as a consumer brand; we equip clinics and institutions who bring populations of clients.

### 2.1 Primary motion — B2B2C via clinics
- **Land:** onboard a clinic or clinic network onto the clinical core + ERP (Phases 1–2). The clinic gets a system that runs its clinical and financial life better than any point-solution stack.
- **Expand within the clinic:** more clinicians, more locations, the AI assistant, advanced psychometrics — each phase deepens dependence and value.
- **The clinic brings the clients (the second B2C leg):** VPSY serves the clinic's clients through the PWA and public network, but the *sale* is to the clinic.
- **Why this works:** clinics have the clinicians, the demand, the referral relationships, and the regulatory standing. Winning the clinic wins its whole population with one sale.

### 2.2 Secondary motion — institutional referral partners
- Integrate **doctors, schools, employers (EAP), courts, and institutions** as referral sources (Layer 1 referral portals).
- Each partner gets tracking, reporting, and referral-share economics — aligning incentives and creating attributed, low-CAC demand.
- Institutional partners are the bridge from clinic-scale to population-scale.

### 2.3 Ultimate motion — government / national
- Sell VPSY as **behavioral-health infrastructure** to health authorities, ministries, and national systems.
- Value proposition: population visibility, proven outcomes, data residency, compliance by design, and the ability to route citizens/students/employees into rigorous, governed care.
- One contract acquires a population and deepens all three compounding moats (data, regulatory, network).

### 2.4 GTM sequencing by phase

| Phase | GTM focus |
|---|---|
| 1–2 | Land and operate individual clinics and small networks (prove the core + ERP) |
| 3–4 | Expand to quality/outcome-driven networks; AI and psychometrics as differentiators |
| 5 | Engage payers and research partners on longitudinal outcomes |
| 6 | Institutional and government contracts; national-infrastructure sales |

---

## 3. Rollout by Country

VPSY's multi-tenant, multi-country kernel makes country-by-country rollout a configuration exercise, not a rebuild — but each country requires deliberate localization.

### 3.1 Country-entry checklist
- **Regulatory mapping:** local health, privacy (GDPR-equivalent), and clinical-practice regulation; AI governance (EU AI Act where applicable).
- **Data residency:** stand up tenant storage within the jurisdiction where required.
- **Language & norms:** localize the UI, instruments, and — critically — psychometric **norms and DIF calibration** for the population (Phase 4 dependency).
- **Currency, tax, compensation law:** configure the ERP for local billing and clinician-compensation law (Model 10, country-specific).
- **Clinician licensing:** encode local scope-of-practice and credential verification.
- **Referral ecosystem:** map local institutional referral sources (health, education, employment, justice).

### 3.2 Rollout sequencing
1. **Beachhead country** — launch where regulatory fit, clinical demand, and go-to-market access are strongest; prove the full stack.
2. **Adjacent markets** — expand to countries sharing language, regulatory framework (e.g., EU/GDPR bloc), or clinical norms, reusing localization work.
3. **Institutional anchor** — in each country, land a flagship institutional or government partner to seed population-scale credibility.
4. **National infrastructure** — convert the flagship into a national behavioral-health infrastructure engagement.

---

## 4. The National-Infrastructure Play

The destination of VPSY is not to be a successful clinic-software vendor. It is to be **the operating system on which countries run their psychological care** — behavioral-health intelligence infrastructure.

### Why VPSY can credibly aim there
- **Compliance-by-design** clears the regulatory bar that consumer and bolt-on competitors cannot.
- **Data residency and multi-tenancy** at the kernel level satisfy sovereignty requirements.
- **Proven, psychometrically-anchored outcomes** give governments what they most lack: evidence that funded behavioral-health interventions actually work.
- **The Manager-as-authority governance model** provides the clinical accountability a public system requires.
- **Population dashboards** (aggregate, de-identified, governed) give health authorities the visibility to set policy and direct resources.

### What the national play unlocks
- Population acquisition per contract (lowest possible CAC).
- Durable, recurring, high-margin institutional revenue.
- The deepest data and regulatory moats — a national outcome dataset and a sovereign-compliant footprint no competitor can replicate quickly.
- A mission outcome: measurably improving a nation's behavioral health, with access *and* rigor.

**GTM north star:** every phase, every clinic won, and every country entered is a step toward VPSY becoming the behavioral-health intelligence infrastructure of the nations it serves — with AI that assists and licensed clinicians who decide.

---

## 5. Land-and-Expand Motion in Detail

The clinic sale is the wedge; expansion is where the value compounds. The expansion path within a single clinic customer:

| Stage | Trigger | Expansion | Value to customer |
|---|---|---|---|
| **Land** | Clinic adopts clinical core (Phase 1) | Replaces fragmented tool stack | One system of record, compliant, human-authoritative |
| **Operationalize** | Clinic runs its business on VPSY (Phase 2) | ERP, compensation engine, referral portals | No revenue leakage, automated payouts, referral economics |
| **Intelligize** | Clinic turns on AI assistant (Phase 3) | 8 agents reduce admin, add rigor | Clinicians practice at top of license; Manager gets the four-question command center |
| **Prove** | Clinic adopts advanced psychometrics (Phase 4) | IRT/CAT/DIF, measured outcomes | Outcome evidence for payers, partners, differentiation |
| **Extend** | Wearables + longitudinal outcomes (Phase 5) | Continuous monitoring | Deeper measurement-based care |
| **Scale** | Clinic joins / becomes institutional network (Phase 6) | Multi-tenant, population dashboards | Path to institutional and government contracts |

Each stage raises switching costs and net revenue per customer. A clinic that has reached "Prove" is running its clinical record, its economics, and its outcome science on VPSY — effectively impossible to displace.

---

## 6. Beachhead Selection Criteria

Choosing the first country and first flagship customers is the highest-leverage GTM decision. VPSY evaluates candidate beachheads against:

- **Regulatory clarity and fit** — a jurisdiction whose health/privacy/AI regime is navigable and whose compliance-by-design posture is an advantage.
- **Clinical demand density** — a market with acute, underserved behavioral-health need where access-with-rigor is valued.
- **Go-to-market access** — existing relationships, language fit, and a reachable clinic/institutional ecosystem.
- **Institutional anchor potential** — presence of a health system, employer, or public authority that could become a flagship population-scale partner.
- **Localization cost** — availability of instruments, norms, and language resources to stand up the psychometrics layer credibly.

The ideal beachhead scores high on regulatory fit and institutional-anchor potential — because the fastest path to the national play is proving the full stack in one country and converting a flagship institution into national infrastructure.

---

## 7. Success Metrics by Phase

Each phase carries the metrics that prove it is working before the next phase is pursued.

| Phase | Leading metrics | Proof-of-phase |
|---|---|---|
| 1 Clinical core | Clinics live, episodes managed end-to-end, audit completeness | A clinic runs entirely on VPSY with full governance |
| 2 Clinic ops | Revenue reconciled, payout accuracy, referral volume | Clean month-end close, zero leakage |
| 3 AI assistant | Clinician admin-time saved, sign-off rates, crisis-path reliability | Measurable admin reduction with zero autonomous action |
| 4 Psychometrics | CAT length reduction, reliable-change tracking, DIF coverage | Adaptive, valid, cross-population-fair measurement |
| 5 Wearables/outcomes | Longitudinal data coverage, outcome-benchmark depth | Continuous, multi-source measurement-based care |
| 6 Country-scale | Institutional contracts, population coverage, residency compliance | A government/health-system runs its program on VPSY |

Gating discipline: VPSY does not chase a later phase's buyer before the current phase's proof metrics are met — this protects clinical safety and unit economics as the system scales toward national infrastructure.
