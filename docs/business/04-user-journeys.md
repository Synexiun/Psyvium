# VPSY OS — End-to-End User Journeys

> **AI assists, licensed clinicians decide.** In every journey below, AI drafts, ranks, and flags; a licensed human reviews and owns each clinical decision. The Manager makes every assignment.

This document walks the core journeys end to end, using numbered steps and swimlane-style role annotations (who does what, and where AI assists). Four journeys:

1. **The Full Care Lifecycle** — intake → screening → triage → assignment → assessment → formulation → treatment → outcome → reporting → payment.
2. **The Psychologist's Daily Flow.**
3. **The Manager's Triage Flow.**
4. **The Crisis Escalation Flow.**

Swimlane legend: **[C]** Client · **[SYS]** System/automation · **[AI]** AI agent (assistive) · **[PSY]** Psychologist · **[MGR]** Manager/Clinical Director · **[SUP]** Supervisor · **[FIN]** Finance · **[ADM]** Admin.

---

## Journey 1 — The Full Care Lifecycle

### Stage A — Discovery & Entry (Layer 1)
1. **[C]** A person searches for help, or receives a referral link from a doctor / school / employer / court / institution.
2. **[SYS]** They land on a specialty/condition/location page (SEO) or a branded referral portal; referral source is attributed and tracked.
3. **[C]** They start intake from the public network.

### Stage B — Registration, Identity & Consent (Layer 2)
4. **[C]** Creates an account; completes identity capture and **2FA** setup.
5. **[SYS]** Presents **governed, versioned consent** objects (treatment, data-processing/GDPR, telehealth, optional aggregate-use). Each acceptance is recorded as an auditable consent object.
6. **[C]** For minors, guardian consent flow is triggered and recorded.

### Stage C — Screening (including risk) (Layer 2 + Layer 5)
7. **[C]** Completes initial screening — validated instruments (e.g., PHQ-9, GAD-7, network battery), delivered adaptively (**CAT**, Layer 5) in the client's language.
8. **[SYS]** Screening includes **explicit risk screening** (suicidality, self-harm, harm-to-others).
9. **[AI — crisis/risk agent]** Continuously scans responses; on a concerning signal, it **immediately escalates** to the Crisis Flow (Journey 4). It never silently closes a risk signal.

### Stage D — Clinical Profiling & Triage Packaging (Layer 2 + Layer 4)
10. **[C]** Completes clinical profiling: presenting problem, history, goals, preferences (modality, gender, language), constraints, payment context.
11. **[AI — intake agent]** Drafts a structured intake summary, identifies information gaps, and suggests clarifying questions. **It does not assign.**
12. **[AI — allocation agent]** Produces a **ranked list of candidate clinicians** with rationale (specialty fit, load, language, availability). Suggestion only.
13. **[SYS]** Assembles a **decision-ready triage packet** and routes it to the Manager's queue.

### Stage E — Manager Assignment (Layer 3, Manager as final authority)
14. **[MGR]** Reviews the triage packet: profile, screening, risk flags, and the allocation agent's ranked candidates.
15. **[MGR]** **Makes and owns the assignment.** No client reaches a clinician without this logged human decision. The Manager may override the AI ranking with one click and a recorded rationale.
16. **[SYS]** Notifies the assigned **[PSY]** and the **[C]**; opens an episode of care in the client master record.

### Stage F — Assessment & Formulation (Layers 3, 4, 5)
17. **[PSY]** Reviews the master record and, in the cockpit, orders assessment instruments as clinically indicated.
18. **[C]** Completes assessments via the PWA (adaptive, IRT-scored, validity-checked).
19. **[AI — psychometric-interpretation agent]** Drafts plain-language interpretation with validity context and norms.
20. **[AI — differential-hypothesis agent]** Surfaces **hypotheses to consider**, with supporting and contradicting signals — never a diagnosis.
21. **[PSY]** Reviews, edits, and **authors the clinical formulation and any diagnosis** — the human clinical act, recorded as such.

### Stage G — Treatment Planning (Layers 3, 4)
22. **[AI — treatment-plan agent]** Drafts an evidence-based treatment plan aligned to the formulation (goals, modality, cadence, measures).
23. **[PSY]** Reviews, edits, and **signs** the treatment plan. Establishes the measurement schedule (measurement-based care).

### Stage H — Intervention & Ongoing Care (Layers 3, 4, 5, 6)
24. **[SYS/ADM]** Books sessions; sends reminders; handles rescheduling and no-shows.
25. **[PSY + C]** Conduct sessions via embedded **telehealth** (or in person), with in-session note capture.
26. **[AI — session-note agent]** Drafts the session note (e.g., SOAP/DAP) from session content.
27. **[PSY]** Edits and **attests** the note. The attested note — not the AI draft — is the clinical record.
28. **[C]** Completes between-session tasks and periodic measures in the PWA.
29. **[AI — outcome agent]** Tracks the psychometric trajectory; flags response, non-response, or deterioration signals for human review.

### Stage I — Outcome Measurement (Layer 5)
30. **[SYS]** Re-administers outcome measures on schedule (adaptive), computes **reliable change** and **clinically-significant change**.
31. **[PSY]** Reviews the outcome trajectory; adjusts the plan (re-entering Stage G) as clinically indicated.
32. **[SUP]** For flagged/complex/risk cases, reviews and co-signs as required.

### Stage J — Reporting (Layers 3, 5)
33. **[SYS]** Generates clinical reports (assessment reports, progress summaries) and, where consented, referral-back reports to the originating doctor/school/court/institution.
34. **[MGR/EXEC]** Aggregate, de-identified outcomes feed the command center and institutional dashboards.

### Stage K — Payment & Economics (Layer 6)
35. **[SYS]** Each session/package/subscription generates the correct invoice (session, package, subscription, or insurance-ready).
36. **[C]** Pays via the PWA; receivables tracked by **[FIN]**.
37. **[SYS]** Computes clinician compensation from the exact contract model (per-session, revenue share, tiered commission, senior override, supervisor share, clinic share, referral share, etc.) and routes **referral-share** to the originating partner where contracted.
38. **[FIN]** Reviews statements, disburses payouts, reconciles clinical events to revenue, and closes the period.

**Lifecycle invariant:** at every clinical decision point (assignment, formulation/diagnosis, treatment plan, note, risk, plan-change), a licensed human reviews and owns the decision; AI only assists.

---

## Journey 2 — The Psychologist's Daily Flow

1. **[PSY]** Opens the **Clinical Cockpit**; authenticates (2FA).
2. **[SYS/AI]** Presents today's caseload prioritized: sessions, tasks, and **attention flags** (risk shifts, deteriorations, overdue reviews, drafts awaiting sign-off).
3. **[PSY]** Reviews the top-flagged client first. **[AI — outcome agent]** shows what changed since last session (scored psychometric delta with reliability).
4. **[PSY]** Before each session, reviews the client timeline; **[AI]** surfaces the latest interpretation and any hypotheses to consider.
5. **[PSY + C]** Conducts the session via embedded telehealth with in-session note capture.
6. **[AI — session-note agent]** Drafts the note as the session concludes.
7. **[PSY]** Edits and **attests** the note; updates the treatment plan if indicated (**[AI]** drafts changes, **[PSY]** signs).
8. **[PSY]** Orders any assessments due; assigns between-session tasks to the client's PWA.
9. **[SYS]** Repeats the loop across the day's caseload.
10. **[PSY]** End of day: clears the sign-off queue (all AI drafts reviewed and attested); reviews own outcome dashboard; sees transparent running compensation for the day's sessions (Layer 6).

**Design goal:** the clinician spends the day on clinical judgment and human connection; the system removes documentation drudgery and surfaces rigor — always as assistance the clinician owns.

---

## Journey 3 — The Manager's Triage Flow

1. **[MGR]** Opens the **Command Center**; authenticates (2FA).
2. **[SYS]** Presents the four-question dashboard: **Who needs help / Who is treating them / Is it working / Are we exposed.**
3. **[MGR]** Opens the **incoming & waiting queue** (Question 1). Cases are risk-ranked; risk-flagged cases sit at the top.
4. **[MGR]** Selects a case; reviews the decision-ready triage packet (profile, screening, risk flags).
5. **[AI — allocation agent]** Presents ranked candidate clinicians with rationale (specialty fit, current load, language, availability).
6. **[MGR]** Interrogates the ranking (can inspect *why* each candidate ranks where they do), then **assigns** — accepting the top suggestion, or overriding with a recorded rationale.
7. **[SYS]** Logs the assignment as the Manager's decision; notifies clinician and client; opens the episode.
8. **[MGR]** Reviews **caseload balance** (Question 2): reassigns or rebalances load as needed.
9. **[MGR]** Reviews **outcome oversight** (Question 3): which clinicians/cohorts/conditions are responding; drills into non-responders.
10. **[MGR]** Reviews the **exposure dashboard** (Question 4): clinical (high-risk, overdue reviews), legal (consent/documentation gaps), financial (utilization, payout liabilities). Acts on the top exposures.
11. **[MGR]** Coordinates with **[SUP]** on cases needing supervision/co-sign.

**Governing invariant:** the Manager is the final assignment authority. AI ranks; the Manager decides and owns every match, with a full audit trail.

---

## Journey 4 — The Crisis Escalation Flow

This is the highest-priority path in VPSY. It can trigger from screening, from a session, from a PWA check-in, or from a client's explicit "I need help now."

1. **[Trigger]** A risk signal arises: a concerning screening response, an in-session disclosure, a PWA measure crossing threshold, or a direct crisis request from the **[C]**.
2. **[AI — crisis/risk agent]** Detects/flags the signal **immediately**. It classifies severity and assembles context — but it **never** makes the terminal determination and **never** closes the case.
3. **[SYS]** Fires the highest-priority escalation: surfaces the client's crisis resources in the PWA **immediately** (help is always one tap away), and routes an urgent alert.
4. **[SYS]** Routes to the responsible human path — the assigned **[PSY]** if available, otherwise the on-call clinician / **[MGR]**, per the network's escalation policy. The alert cannot be silently dismissed; it persists until a human acknowledges and acts.
5. **[PSY/MGR/on-call]** A licensed human **takes ownership** of the risk case: reviews context, contacts the client, conducts risk assessment, and determines the response (safety planning, escalation to emergency services, increased contact, referral) — the human clinical act.
6. **[SYS]** Records every step: the signal, the escalation, who acknowledged, what was decided, and the outcome — a complete audit trail.
7. **[SUP/MGR]** Reviews the risk event; ensures follow-up, documentation, and any required co-sign.
8. **[SYS]** Keeps the risk register on the client master record updated; schedules follow-up measures and reviews.

**Non-negotiable invariants of the crisis flow:**
- The crisis/risk agent **always escalates to a human** and is **never** the final decision-maker.
- A risk signal **cannot die silently** — it persists until a licensed human acknowledges and acts.
- The client **always** has immediate access to crisis resources.
- Every step is logged for clinical, legal, and quality review.

---

## Journey Summary

| Journey | Trigger | AI assists with | Human who decides |
|---|---|---|---|
| Full lifecycle | A person seeks help | Intake summary, allocation ranking, interpretation, hypotheses, plan draft, note draft, outcome flags | Manager (assignment), Psychologist (formulation, plan, note), Supervisor (co-sign) |
| Psychologist daily | Start of clinical day | Prioritization, deltas, note drafts | Psychologist |
| Manager triage | Case enters queue | Ranked candidates, exposure surfacing | Manager (final authority) |
| Crisis escalation | Risk signal | Detection, classification, context, routing | Licensed clinician / Manager / on-call |

Across all four, the same contract holds: **AI assists, licensed clinicians decide — and the Manager makes every assignment.**

---

## Journey 5 — Institutional Referral Journey (partner-originated)

A parallel entry path where the referral source is a doctor, school, employer, court, or institution rather than a self-referring client.

1. **[Partner]** A referral source (e.g., a physician or school counselor) uses their branded referral portal (Layer 1) to refer an individual into the network.
2. **[SYS]** Captures and attributes the referral source (enabling tracking and referral-share economics, Layer 6); generates a governed intake link.
3. **[C]** The referred individual completes registration, consent, screening, and profiling (Stages B–D of Journey 1) — including any partner-provided context.
4. **[MGR]** Receives the triage packet, which notes the referral source and any institutional constraints (e.g., an EAP session cap, a court-ordered assessment scope), and **makes the assignment**.
5. **[PSY]** Delivers care per Journey 1, with awareness of the referral context and any required reporting-back.
6. **[SYS]** Where consented and contracted, generates a referral-back report to the originating partner (e.g., a progress summary to the referring physician, an assessment report to a court).
7. **[SYS]** Routes referral-share to the partner (Layer 6) and rolls the individual's de-identified outcome into the institution's aggregate dashboard (Layer 6 / Government persona).

**Governance note:** even court- or employer-originated referrals preserve the client's consent governance and the clinician's authority over care. Institutional context informs scope and reporting; it never overrides clinical judgment or the human-decides principle.

---

## Cross-Journey Data Flow

The journeys are not isolated — they write to and read from the same governed record, which is what makes full-lifecycle intelligence possible.

| Journey stage | Writes to | Later read by |
|---|---|---|
| Screening & risk (J1 C, J4) | Risk register, assessment results | Manager triage (J3), crisis flow (J4), clinician cockpit (J2) |
| Manager assignment (J1 E, J3) | Episode of care, assignment log | Clinician cockpit (J2), exposure dashboard (J3) |
| Assessment & outcomes (J1 F/I) | Psychometric record, outcome trajectory | Outcome agent, Manager Question 3, institutional dashboard (J5) |
| Attested notes (J1 H, J2) | Clinical record | Supervision (J1 stage I), documentation-gap exposure (J3) |
| Billing & payout (J1 K) | Ledger, payout liabilities | Finance close, referral-share to partner (J5) |

One record, many journeys, one audit trail — and at every clinical decision point, a licensed human who owns the decision.
