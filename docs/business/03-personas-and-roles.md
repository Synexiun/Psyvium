# VPSY OS — Personas & Roles

> **AI assists, licensed clinicians decide.** Each persona below interacts with intelligence that *supports* their judgment. The Manager persona holds final assignment authority; no AI overrides a licensed human.

VPSY serves eight distinct roles. Each has a cockpit tuned to the questions that role must answer instantly. This document profiles each: who they are, their goals, their pains, their key jobs-to-be-done (JTBD), and the questions the system must let them answer in seconds.

Role summary:

| Role | Center of gravity | The system must let them... |
|---|---|---|
| Client / Patient | Their own care | ...get the right help fast and see it working |
| Psychologist | Their caseload | ...deliver rigorous care with minimal admin |
| Manager / Clinical Director | The population | ...answer the four governing questions |
| Admin | Operations | ...keep the machine running |
| Finance | The money | ...bill, pay, and close the books cleanly |
| Supervisor | Clinical quality | ...ensure care meets standard and clinicians grow |
| Executive | The enterprise | ...steer growth, margin, and mission |
| Government / Institutional | The population's health | ...see and govern behavioral health at scale |

---

## 1. Client / Patient

**Who they are:** A person seeking psychological help — self-referred through the public network, or referred by a doctor, school, employer, court, or institution. Anxious, often at a vulnerable moment, sometimes in crisis. Ranges from a first-time help-seeker to a long-term client tracking progress.

**Goals**
- Get to the *right* clinician quickly, without navigating a maze.
- Feel safe, understood, and in control of their data and consent.
- See tangible evidence that treatment is helping.
- Manage the logistics (appointments, homework, payments) with minimal friction.

**Pains**
- Long waits and opaque matching ("who is this person and are they right for me?").
- Repeating their story to every new provider.
- No sense of whether therapy is actually working.
- Privacy anxiety — where does my most sensitive data go?
- Crisis moments with no clear, immediate path to help.

**Key jobs-to-be-done**
- "Help me find and reach the right clinician for *my* problem, in my language."
- "Let me complete intake and assessments quickly, on my phone."
- "Keep my appointments, tasks, and messages in one place."
- "Show me my progress in a way I can understand."
- "Give me help *now* if I'm in crisis."

**Questions the system must answer instantly (via the Patient PWA)**
- When is my next session and how do I join?
- What do I need to complete before it?
- Is my treatment working?
- How do I get help right now if I'm not safe?

---

## 2. Psychologist

**Who they are:** A licensed clinician (independent or employed) delivering assessment and therapy. Wants to practice at the top of their license; resents administrative overhead; cares about clinical rigor and outcomes.

**Goals**
- Spend time on clients, not paperwork.
- Make well-founded clinical decisions with good information.
- Demonstrate and improve their outcomes.
- Be compensated fairly and transparently.

**Pains**
- Documentation burden — notes, treatment plans, reports consume clinical energy.
- Fragmented tools — one app for scheduling, another for video, paper for tests.
- Thin measurement — no rigorous, longitudinal read on client progress.
- Opaque pay — unclear how compensation is computed.

**Key jobs-to-be-done**
- "Draft my session note and treatment plan so I can edit, not author from scratch."
- "Show me the psychometric change since last session, scored properly."
- "Surface hypotheses to consider — I'll decide the formulation."
- "Run the session (video, notes, assessment) in one place."
- "Tell me clearly what I'll be paid and why."

**Questions the system must answer instantly (via the Clinical Cockpit)**
- Who am I seeing today and what's changed since I last saw them?
- Which client needs my attention most (risk, deterioration, overdue review)?
- What does the latest assessment mean, and is the change reliable and significant?
- What's drafted for me to review and sign?

**AI-assist boundary:** The psychologist reviews, edits, and owns every AI draft. The differential agent offers hypotheses; the psychologist decides. The session-note agent drafts; the psychologist attests.

---

## 3. Manager / Clinical Director — the final authority

**Who they are:** A senior licensed clinician who governs the clinical operation: triage, assignment, oversight, and accountability for the population of clients and clinicians. **The final assignment authority** — the human at the center of gravity of VPSY.

**Goals**
- Match every client to the right clinician — and own that decision.
- Keep the whole population safe and well-treated.
- Prove outcomes and manage exposure.
- Balance caseloads and keep clinicians effective and supported.

**Pains**
- No single view of the population — who's waiting, who's at risk, who's stalled.
- Assignment by gut or spreadsheet, with no rigor and no audit.
- Blind spots on clinical, legal, and financial exposure until they become incidents.
- Reactive rather than proactive risk management.

**Key jobs-to-be-done**
- "Give me a decision-ready triage packet and ranked candidate clinicians — I'll assign."
- "Show me my whole population at a glance, with risk surfaced."
- "Tell me which interventions are working and which aren't."
- "Warn me where I'm exposed before it becomes an incident."

### The Manager's Four Questions (the product's organizing prompt)

VPSY is validated against the Manager's ability to answer these four questions instantly, accurately, and with an audit trail:

| # | Question | Layer that answers it | Command-center surface |
|---|---|---|---|
| 1 | **Who needs help?** | Intake / screening / risk (Layer 2) | Incoming & waiting queue, risk-flagged |
| 2 | **Who is treating them?** | Allocation under Manager authority (Layers 2–3) | Assignment map, caseload balance |
| 3 | **Is the intervention working?** | Psychometrics & outcomes (Layer 5) | Outcome dashboards by clinician/cohort/condition |
| 4 | **Are we exposed — clinically, legally, financially?** | Governance & Business OS (Layers 3, 6) | Exposure dashboard: risk, consent/doc gaps, utilization/payout |

**AI-assist boundary:** The allocation agent ranks candidates and explains its reasoning; the Manager makes and owns every assignment. No client is assigned without a Manager's logged decision.

---

## 4. Admin

**Who they are:** Operations staff who keep the clinic/network running — onboarding, scheduling support, records, front-desk, coordination across clinics and referral partners.

**Goals**
- Smooth operations with minimal manual toil.
- Clean records, kept-appointments, and responsive coordination.
- Reliable onboarding of clinicians and clients.

**Pains**
- Manual scheduling, reminders, and no-show chasing.
- Data entry and reconciliation across disconnected tools.
- Referral-partner coordination without tracking.

**Key jobs-to-be-done**
- "Onboard clinicians and clients cleanly, with credentials and consents captured."
- "Keep the calendar full and no-shows low."
- "Manage referral-partner links and track their volume."
- "Maintain accurate records without duplicate entry."

**Questions the system must answer instantly**
- What onboarding/verification tasks are pending?
- Which appointments are at risk (unconfirmed, likely no-show)?
- Which referral partners are sending volume?

---

## 5. Finance

**Who they are:** Finance staff/controllers responsible for billing, collections, clinician payouts, accounting, and month-end close across a multi-clinic, multi-country operation.

**Goals**
- Bill accurately and collect efficiently.
- Compute and disburse clinician compensation correctly across many models.
- Close the books cleanly and report margin.
- Stay tax-compliant per country.

**Pains**
- Compensation complexity — dozens of contract models (per-session, revenue share, tiered commission, overrides, splits) done by spreadsheet.
- Revenue leakage between clinical events and billing.
- Reconciliation pain at month-end; multi-currency, multi-tax.

**Key jobs-to-be-done**
- "Turn every session/package/subscription into a correct invoice."
- "Compute each clinician's pay automatically from their exact contract model."
- "Reconcile clinical events to revenue with no leakage."
- "Give me margin, receivables, and payout-liability reports on demand."

**Questions the system must answer instantly (via the Finance surface, Layer 6)**
- What did we bill and collect this period?
- What do we owe each clinician, and why (itemized)?
- Where is revenue leaking?
- Are we ready to close the month?

---

## 6. Supervisor

**Who they are:** A senior clinician responsible for clinical supervision and quality — reviewing cases, supporting clinician development, ensuring care meets standard, and (often) sharing in the economics of supervisees (supervisor share).

**Goals**
- Ensure care quality and clinical safety across supervisees.
- Develop clinicians and catch problems early.
- Sign off on high-stakes cases (e.g., risk, complex formulations).

**Pains**
- No visibility into supervisees' caseloads and outcomes without asking.
- Risk cases surfacing late.
- Manual, memory-based tracking of who needs review.

**Key jobs-to-be-done**
- "Show me my supervisees' caseloads, outcomes, and risk cases."
- "Flag cases that need my review or co-sign."
- "Track clinician development over time."
- "Compute my supervisor share transparently."

**Questions the system must answer instantly**
- Which supervisee cases need my attention or sign-off now?
- How are my supervisees' outcomes trending?
- Where is clinical quality or safety at risk?

---

## 7. Executive

**Who they are:** Enterprise leadership (founder, CEO, COO, CCO) steering growth, margin, clinical mission, and expansion across clinics and countries.

**Goals**
- Grow the network and demand engine.
- Maintain healthy unit economics and margin.
- Prove clinical outcomes as the core brand asset.
- Expand into new clinics, countries, and institutional/government contracts.

**Pains**
- No single, trustworthy view of enterprise health (growth, margin, outcomes, risk).
- Difficulty proving outcomes to payers, partners, and governments.
- Balancing growth against clinical quality and compliance.

**Key jobs-to-be-done**
- "Give me enterprise KPIs: demand, utilization, outcomes, margin, risk."
- "Prove our outcomes to a payer/government partner."
- "Show me expansion readiness by clinic and country."

**Questions the system must answer instantly**
- Is the network growing profitably?
- Are our clinical outcomes strong and improving?
- Where are we exposed at the enterprise level?
- Are we ready to expand into the next clinic/country/contract?

---

## 8. Government / Institutional

**Who they are:** A public-health authority, ministry, health system, insurer, large employer (EAP), school system, or court system — a buyer/partner who cares about the behavioral health of a *population*, and who governs, funds, or refers into the system at scale.

**Goals**
- Improve population behavioral-health outcomes.
- Get transparent, de-identified, aggregate visibility and proof of impact.
- Ensure compliance, data residency, and governance at national/institutional scale.
- Route their population (citizens, students, employees, referred individuals) into rigorous care.

**Pains**
- No population-level visibility into behavioral-health need, treatment, and outcomes.
- Unproven interventions and untracked spend.
- Data-sovereignty and compliance concerns with foreign or bolt-on systems.

**Key jobs-to-be-done**
- "Show me, in aggregate and de-identified, the behavioral-health state of my population."
- "Prove that funded interventions produce measured outcomes."
- "Keep my population's data resident and compliant within my jurisdiction."
- "Give my referral sources (schools, doctors, courts) a governed path into care."

**Questions the system must answer instantly (aggregate, de-identified, governed)**
- What is the level and distribution of behavioral-health need in my population?
- Is funded care reaching people and working?
- Is the system compliant, resident, and auditable?
- Where should we direct policy and resources next?

**AI-assist boundary:** Even at population scale, VPSY reports measured, human-governed outcomes. No autonomous determination is made about any individual; institutional views are aggregate and de-identified, and all individual care remains under licensed-clinician authority.

---

## Cross-Role Design Principle

Every cockpit in VPSY is a lens onto **the same governed record**, tuned to answer *that role's* defining questions. The Client sees their care; the Psychologist sees their caseload; the Manager sees the population and its four questions; Finance sees the money; the Government sees the aggregate. One source of truth, eight lenses — and at the clinical core, always: **AI assists, licensed clinicians decide.**
