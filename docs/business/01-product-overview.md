# VPSY OS — Product Overview

> **AI assists, licensed clinicians decide.** Every intelligent surface in this product produces recommendations for a licensed human to review, edit, and own. Nothing described here diagnoses, treats, or determines risk autonomously.

VPSY OS is organized into **six operating layers**. Each layer is a coherent product in its own right; together they form the operating system for a country's psychological care — a native **HIS + ERP + CRM + telehealth** stack (`business/00-vision-and-category.md` §1), where the CRM (Layer 1's referral/acquisition engine) and telehealth-plus-telephony (Layer 3's Communications Hub) are first-class, not bolted-on integrations. This document describes each layer in depth, inventories its features, and defines what "10/10 futuristic" means concretely rather than as a slogan.

---

## The Six Layers at a Glance

| # | Layer | One-line purpose | Primary roles served |
|---|---|---|---|
| 1 | Public Clinic Network | Be found; convert need into an intake | Client, Institutional partners |
| 2 | Intake, Screening, Registration & Profiling | Turn a stranger into a governed, triaged clinical case | Client, Manager |
| 3 | Clinical HIS Modules | Run the actual clinical work of care | Psychologist, Manager, Client |
| 4 | AI Clinical Intelligence Layer | Assist clinicians with rigor at every step | Psychologist, Manager, Supervisor |
| 5 | Psychometrics Engine | Measure, adaptively, with psychometric validity | Psychologist, Supervisor, Executive |
| 6 | Business OS / ERP | Make the whole system economically sustainable | Finance, Admin, Executive, Psychologist |

---

## Layer 1 — Public Clinic Network (the digital hospital for psychology)

The public, SEO-optimized face of the network. It is a **digital hospital for psychology**: the front door through which need enters the system, and the referral surface through which institutions send people in.

### Purpose
Convert a person's moment of need — a search, a referral, a crisis — into a governed intake, while building the brand and organic-acquisition engine of the network.

### Feature inventory
- **Clinic directory & specialty pages** — browsable network of clinics and clinicians, with structured specialty taxonomy (anxiety, mood, trauma/PTSD, OCD, eating disorders, ADHD, autism assessment, couples, family, child/adolescent, geriatric, addiction, forensic, occupational).
- **Clinician profiles** — verified credentials, specialties, languages, modalities (CBT, DBT, ACT, EMDR, psychodynamic, systemic), availability signals. Profiles are marketing surfaces backed by the same verified record used in contracts (Layer 6).
- **SEO engine** — programmatic specialty × location × condition landing pages, structured data (schema.org MedicalClinic / Physician), content hub for evidence-based psychoeducation. Organic acquisition is a strategic moat: it lowers CAC structurally.
- **Referral pages** — dedicated, trackable referral portals for **doctors, schools, companies (EAP), courts, and institutions**. Each referral source gets a branded intake link, referral tracking, and (where contracted) referral-share economics (Layer 6).
- **Multi-language, multi-country storefronts** — each tenant/country presents in its own language, currency, and regulatory framing.
- **Public trust surfaces** — outcome transparency (aggregate, de-identified), accreditation, compliance posture.
- **CRM & Referrals engine** (technical: `16-crm-and-referrals.md`) — the governed system behind the referral pages and the acquisition funnel: a configurable lead pipeline (new → contacted → qualified → intake-scheduled → converted), a **referrer registry** for doctors/schools/employers/courts/institutions with attached agreements that drive referral-share, multi-channel campaigns (organic, paid, email, SMS), and a **unified engagement timeline** (every call, text, email, and touch, from first contact through conversion) shared with the Communications Hub (3.6). Marketing consent and clinical care consent are kept strictly separate — a lead can be nurtured with zero clinical data ever touched.

### "10/10 futuristic" means
Programmatic SEO that ranks for the long tail of "psychologist for [condition] in [city] speaking [language]," referral portals that institutions actually adopt because they get tracking and reporting back, a CRM pipeline that hands the Manager a fully attributed, de-duplicated lead the moment it converts, and a directory whose data is *the same governed record* that runs the clinic — not a marketing copy that drifts from reality.

---

## Layer 2 — Intake, Screening, Registration & Profiling

The pipeline that turns an anonymous visitor into a **verified, consented, screened, profiled, and triaged clinical case** ready for Manager assignment.

### Purpose
Safely and rigorously convert need into a clinical case, surfacing risk early, and delivering the Manager a complete profile on which to base the final assignment decision.

### Feature inventory
- **Identity & registration** — account creation, identity capture, **two-factor authentication (2FA)** from the first session. Minors handled with guardian consent flows.
- **Governed consent** — versioned, auditable consent objects (treatment consent, data-processing consent under GDPR, telehealth consent, research/aggregate-use consent). Consent is a first-class object, not a checkbox.
- **Initial screening, including risk** — structured self-report screening using validated instruments (e.g., PHQ-9, GAD-7, and network-configured batteries). Screening explicitly includes **risk screening** (suicidality, self-harm, harm-to-others) with immediate escalation paths (see Crisis flow, Layer 4 and journeys doc).
- **Clinical profiling** — presenting problem, history, goals, preferences (modality, gender, language), scheduling constraints, insurance/payment context. Builds the structured profile the Manager and clinician will use.
- **Triage packaging** — the screening + profile is assembled into a triage summary. The **intake AI agent** (Layer 4) drafts a structured summary and flags; it does **not** assign.
- **Manager review — the final assignment authority** — every triaged case lands in the Manager's queue. The Manager reviews the profile, screening, risk flags, and the allocation agent's ranked suggestions, then **makes and owns the assignment.** No client reaches a clinician without this human decision.

### "10/10 futuristic" means
An intake that feels effortless to the client, adaptively shortens (via CAT, Layer 5) without losing psychometric validity, surfaces risk within seconds of a concerning response, and hands the Manager a decision-ready packet — while never letting a machine make the assignment.

---

## Layer 3 — Clinical HIS Modules

The clinical health information system: the modules where care is actually delivered and recorded. This is the **system of record.**

### 3.1 Client Master Record (FHIR-compatible)
The single source of clinical truth. FHIR-compatible so it can interoperate with the broader health ecosystem (referrals from medical providers, integration with national health records where permitted).
- Demographics, consents, problem list, history, medications (as reported / reconciled), risk register, episode-of-care structure, documents, assessment results (Layer 5), outcome trajectories.
- Immutable, attributable audit trail on every access and change.
- Residency-aware storage (tenant/country-scoped).

### 3.2 Psychologist Clinical Cockpit (portal)
The clinician's primary workspace — designed so clinicians practice at the top of their license and administration recedes.
- Caseload dashboard, today's sessions, tasks, alerts.
- Client timeline: sessions, assessments, outcomes, notes, risk events.
- **AI-drafted session notes** (Layer 4) the clinician edits and attests.
- Treatment plan authoring (AI-drafted, clinician-owned).
- Embedded **telehealth** (3.5) with in-session note capture.
- Assessment ordering and interpretation (Layer 5) inline.
- Secure messaging with clients and supervisors.
- Outcome dashboards for their own caseload.

### 3.3 Manager / Clinical-Director Command Center
The cockpit for the role that holds final authority and answers the four governing questions.
- **Assignment queue** (final-authority workflow) with allocation-agent suggestions.
- **Population view:** who needs help, who is being treated, who is at risk.
- **Outcome oversight:** are interventions working, by clinician, cohort, condition, clinic.
- **Exposure dashboard:** clinical (high-risk cases, overdue reviews), legal (consent gaps, documentation lag), financial (utilization, payouts).
- Supervision oversight, caseload balancing, credential/scope monitoring.

### 3.4 Patient PWA (progressive web app, bottom-nav mobile experience)
The client's ongoing companion — installable, offline-tolerant, mobile-first with a bottom navigation bar.
- Appointments, join-telehealth, reschedule.
- Assessments to complete (adaptive, Layer 5).
- Homework / between-session tasks and psychoeducation.
- Outcome self-tracking and mood/measure check-ins.
- Secure messaging, documents, billing/payments.
- Crisis resources always one tap away.

### 3.5 Telehealth
Native video **and voice** sessions embedded in the cockpit and PWA, running on VPSY's own **in-house WebRTC SFU** (mediasoup/LiveKit-class) — not a Zoom/Doxy.me-style third-party bolt-on (technical detail: `08-telehealth-and-realtime.md`).
- In-session note capture, screen/assessment sharing, waiting room, consent capture, session recording (where consented and lawful), audio-only and phone-bridge fallback for low-bandwidth/no-smartphone clients, quality/connection handling, session lifecycle tied to billing (Layer 6).

### 3.6 Communications Hub — telephony, SMS, and async voice/video messages
The channel layer that reaches a client or referrer outside a scheduled telehealth session — built provider-agnostic so VPSY is never locked into one vendor (technical detail: `15-communications-and-telephony.md`).
- **IP-phone (SIP) telephony** — provisioned clinic/clinician numbers, click-to-call from the cockpit, inbound call routing/IVR, and consent-gated call recording, running on either a self-hosted SIP/PBX stack or a cloud communications API depending on tenant residency needs.
- **SMS / text hubs** — templated appointment reminders and clinician-triggered safety check-ins, inbound reply handling, STOP/opt-out honored immediately, and quiet-hours enforcement.
- **In-house real-time voice**, sharing the same WebRTC SFU as Telehealth (3.5) for ad hoc calls outside a scheduled session.
- **Async (store-and-forward) voice/video messages** — a client or clinician can record and send a short voice/video note when a live call isn't necessary; it's recorded, encrypted client-side, scanned, transcoded, and delivered the moment the recipient is next online, with optional transcript and delivered/read receipts.
- Every call, text, and media message lands in one unified engagement timeline shared with CRM & Referrals (Layer 1), fully audited.

### "10/10 futuristic" means
A clinician opens the cockpit and the system has already drafted the note, surfaced the relevant psychometric change since last session, flagged the one client whose risk trajectory shifted, and teed up the assessment due today — all as *assistance*, all requiring the clinician's sign-off. Reaching that client, by video, voice, text, or an async voice note, and having every one of those touches show up in the same governed timeline, is table stakes underneath it.

---

## Layer 4 — AI Clinical Intelligence Layer (8 specialized agents)

The intelligence layer. **Every agent is assistive.** Each produces structured, reviewable output for a licensed human; each logs the human decision as the clinical act.

| # | Agent | What it produces (assistive) | Who reviews & owns |
|---|---|---|---|
| 1 | **Intake agent** | Structured intake summary, gaps, suggested clarifying questions | Manager / clinician |
| 2 | **Differential-hypothesis agent** | *Hypotheses to consider* with supporting/contradicting signals — never a diagnosis | Psychologist |
| 3 | **Treatment-plan agent** | Draft, evidence-based treatment plan aligned to formulation | Psychologist |
| 4 | **Session-note agent** | Draft session documentation (e.g., SOAP/DAP) from session content | Psychologist attests |
| 5 | **Outcome agent** | Interpreted outcome trajectories, response/deterioration signals | Psychologist / Manager |
| 6 | **Crisis/risk agent** | Risk signals flagged for immediate human review; always escalates, never closes | Clinician / Manager / on-call |
| 7 | **Psychometric-interpretation agent** | Plain-language interpretation of test results with validity context | Psychologist / Supervisor |
| 8 | **Manager-allocation agent** | Ranked candidate clinicians with rationale (fit, specialty, load, language) | Manager assigns |

Cross-cutting guarantees:
- **Human-in-the-loop is structural** — no agent output acts on the world without a logged human decision.
- **Traceability** — every recommendation records its inputs, model version, and the reviewer's accept/edit/reject action (EU AI Act high-risk posture).
- **Transparency** — clinicians see *why* an agent suggested something (supporting evidence), never a black-box verdict.
- **Safety routing** — the crisis/risk agent has the highest-priority escalation path and cannot be the terminal decision-maker.

### "10/10 futuristic" means
Eight agents that each remove drudgery or add rigor without ever crossing the line into deciding — a differential agent that argues *both sides* of a hypothesis, a crisis agent that never lets a risk signal die silently, an allocation agent whose ranking a Manager can interrogate and override in one click.

---

## Layer 5 — Psychometrics Engine

The scientific core: a modern psychometrics engine that makes VPSY's measurement rigorous, adaptive, fair across languages and populations, and longitudinally comparable.

### Feature inventory
- **Item Response Theory (IRT)** scoring — moving beyond raw sum-scores to latent-trait estimation with standard errors.
- **Computerized Adaptive Testing (CAT)** — administer the fewest items needed for a target precision; shorten assessments dramatically without losing validity.
- **Norms & standardization** — population norms by age, sex, region, language; percentile and standardized scoring.
- **Validity scales** — detect inconsistent, over-/under-reporting, and careless responding.
- **Longitudinal outcomes** — reliable-change and clinically-significant-change tracking; measurement-based-care trajectories over an episode of care.
- **Multi-language administration** — instruments delivered in the client's language.
- **DIF / measurement invariance** — Differential Item Functioning analysis and invariance testing so scores mean the same thing across languages, cultures, and demographic groups. This is what makes cross-country comparison scientifically defensible.
- **Instrument library & governance** — versioned instruments, licensing, scoring keys, translation/back-translation records.
- **Item bank management** — calibrated item banks powering CAT.

### "10/10 futuristic" means
A depression measure that adapts to eight items instead of twenty-one, scores on a latent trait with a standard error, flags a possible invalid protocol, tells the clinician whether the change since last month is *reliable* and *clinically significant*, and does all of this identically well in six languages — with DIF evidence to prove it.

---

## Layer 6 — Business OS / ERP

The economic and operational engine. Without this layer, the clinical layers are a beautiful hospital that cannot pay its clinicians or bill its clients. (Full detail in `05-monetization-and-contracts.md`.)

### Feature inventory
- **Clinician hiring & contracts** — onboarding, credential verification, scope-of-practice records, and **many compensation models** (fixed salary, per-session, revenue share, tiered commission, senior override, supervisor share, clinic share, referral share, equity grant, country-specific, group-session split, corporate split).
- **Accounting** — chart of accounts, invoices, receivables, ledger, tax handling per country.
- **Revenue share & payouts** — automated computation and disbursement per each clinician's contract model, with statements and audit.
- **Booking & calendar** — availability, scheduling, reminders, no-show handling, session lifecycle tied to billing and to telehealth (Layer 3).
- **Client billing** — session, package, subscription, and insurance-ready invoicing; payment capture.
- **Financial reporting & dashboards** — utilization, revenue, margin, payout liabilities, for Finance and Executive roles.

### "10/10 futuristic" means
A clinician's pay is computed automatically from a contract that can encode a tiered commission with a senior override and a clinic share, a referral from a partner school automatically routes its referral-share, and Finance closes the month from a ledger that reconciles to the clinical session record — no spreadsheets, no leakage.

---

## How the Layers Compose

The power of VPSY is not any single layer — every layer has some standalone competitor. The power is **composition on one governed kernel:**

- Layer 1's CRM & Referrals engine fills Layer 2's funnel with attributed, referral-tracked demand.
- Layer 2 hands Layer 3 a consented, triaged case under Manager authority.
- Layer 3 runs care — telehealth and its Communications Hub reach every client and referrer by video, voice, text, or async message — while Layer 4 assists at every step and Layer 5 measures it.
- Layer 5's outcomes feed Layer 3's cockpits and the Manager's four-question command center.
- Layer 6 turns every session, package, referral, and outcome into correctly-attributed economics.

One record. One consent. One audit trail. One outcome science. One compensation engine. **That composition is the product, and it is the moat.**
