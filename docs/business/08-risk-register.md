# VPSY OS — Risk Register

> **AI assists, licensed clinicians decide.** This principle is itself the primary control for the most severe risk class (clinical/AI-safety): no autonomous diagnosis, treatment, or risk determination exists to fail.

This register catalogs the material risks of building and operating a country-scale Clinical Psychology Operating System, organized by category. Each risk carries a **likelihood** (Low / Medium / High), an **impact** (Low / Medium / High / Severe), and a concrete **mitigation**. Risks are rated for the system *as designed with controls in place*; the mitigations are architectural commitments, not aspirations.

Scoring key:
- **Likelihood:** Low (<10%) · Medium (10–40%) · High (>40%) over the relevant horizon.
- **Impact:** Low (recoverable, contained) · Medium (material, managed) · High (serious harm to users/business) · Severe (catastrophic — loss of life, existential legal/regulatory failure).

---

## 1. Clinical Risk

Risks to client safety and quality of care.

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| C1 | **Missed or mishandled crisis** (suicidality/self-harm/harm-to-others not escalated in time) | Medium | Severe | Crisis/risk agent flags every signal and **always escalates to a human**; risk signals cannot die silently (persist until acknowledged); client always has one-tap crisis resources; escalation policy with on-call fallback; full audit of every risk event (see `04-user-journeys.md` Journey 4). |
| C2 | **Over-reliance on AI (automation bias)** — clinician defers to an AI draft/hypothesis without independent judgment | Medium | High | Human-in-the-loop is structural: AI outputs are drafts/hypotheses/rankings requiring logged human accept/edit/reject; differential agent argues both sides; transparency of evidence; supervision review; automation-bias training. |
| C3 | **Poor clinician-client match** producing harm or drop-out | Medium | High | Manager as final assignment authority; allocation agent provides interrogable ranking; profiling depth (Layer 2); outcome monitoring catches poor matches early; reassignment workflow. |
| C4 | **Invalid or misinterpreted assessment** driving wrong formulation | Medium | High | Validity scales flag suspect protocols; IRT scoring with standard errors; psychometric-interpretation agent provides norms/validity context; clinician owns interpretation; DIF ensures cross-population fairness. |
| C5 | **Scope-of-practice violation** (clinician acting beyond license/competence) | Low | High | Credential and scope records in the contract engine; Manager/Supervisor oversight; specialty-based matching; supervision co-sign for high-stakes cases. |
| C6 | **Continuity-of-care failure** (client falls through the cracks between clinicians/episodes) | Medium | Medium | Single governed master record; episode structure; Manager population view surfaces stalled/overdue cases; PWA keeps client engaged. |

---

## 2. Legal / Liability Risk

Risks of legal exposure from the delivery of care through the platform.

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| L1 | **Malpractice/liability attributed to the platform** for a clinical outcome | Medium | Severe | Clear allocation of clinical responsibility to licensed clinicians (the human decides); platform is documented as assistive tooling; comprehensive audit trail evidences human decision-making; professional-liability requirements for clinicians; clear terms delineating roles. |
| L2 | **Consent defects** (invalid, missing, or outdated consent) | Medium | High | Governed, versioned, auditable consent objects; consent required before care; guardian-consent flows for minors; consent gaps surfaced on the Manager exposure dashboard. |
| L3 | **Documentation inadequacy** exposing clinicians/network in disputes | Medium | High | AI-drafted, clinician-attested notes reduce documentation lag; attestation logged; Manager dashboard flags documentation gaps; retention policies. |
| L4 | **Cross-border liability** (care/data spanning jurisdictions) | Medium | High | Tenant/country residency and localized legal configuration; country-entry regulatory mapping (see `07-go-to-market-and-phasing.md` §3); local counsel per jurisdiction. |
| L5 | **Referral-relationship / fee-split legality** (e.g., anti-kickback constraints on referral-share) | Medium | High | Referral-share models configured per-jurisdiction legality; some markets disable fee-based referral-share; legal review of institutional contracts. |

---

## 3. Regulatory Risk (HIPAA / GDPR / EU AI Act)

Risks of non-compliance with health, privacy, and AI regulation.

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **HIPAA violation** (US PHI handling) | Medium | Severe | Compliance-by-design: RBAC, audit trail, encryption, minimum-necessary access, BAAs with subprocessors; breach-response procedures. |
| R2 | **GDPR violation** (EU personal/health data) | Medium | Severe | Lawful basis + explicit consent for health data (special category); data-subject rights (access/erasure/portability); DPIAs; residency in-region; DPO governance. |
| R3 | **EU AI Act high-risk non-compliance** — clinical decision-support AI is high-risk | High | Severe | Designed to the high-risk regime: documented risk management, human oversight, transparency, traceability, data governance, logging, and conformity documentation for the AI layer; no autonomous clinical action. |
| R4 | **Medical-device / SaMD classification** of clinical AI features | Medium | High | Careful feature scoping to remain assistive (not diagnostic device); regulatory-affairs review per jurisdiction; pursue applicable clearances where a feature crosses the device threshold. |
| R5 | **Instrument licensing/copyright** (psychometric tests) | Medium | Medium | Instrument governance with licensing records; use appropriately licensed or open instruments; per-jurisdiction license management. |
| R6 | **Evolving/ divergent national AI & health regulation** | High | Medium | Multi-country configurable compliance layer; regulatory monitoring; conservative default posture (strictest applicable standard). |

---

## 4. AI Safety Risk

Risks arising specifically from the AI intelligence layer.

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A1 | **Hallucinated/incorrect AI output** (fabricated content in a draft note, plan, or interpretation) | High | High | Human review and attestation of every AI output before it enters the record; evidence/transparency surfacing; grounding in the governed record; the attested human version is the record, not the AI draft. |
| A2 | **Harmful crisis-handling by AI** (agent mishandles a risk signal) | Medium | Severe | Crisis agent never terminal; always escalates to a human; cannot close a case; highest-priority routing; extensive testing of the crisis path (C1 controls). |
| A3 | **Bias/inequity in AI recommendations** (allocation or interpretation biased across demographics) | Medium | High | DIF/measurement-invariance on instruments; bias auditing of agent outputs; transparent rationale; human override; monitoring of allocation fairness. |
| A4 | **Model/version drift** degrading quality over time | Medium | Medium | Model versioning captured per recommendation (traceability); performance monitoring; evaluation gates before model updates; rollback capability. |
| A5 | **Prompt-injection / adversarial manipulation** of agents via client-supplied content | Medium | Medium | Input sanitization; least-privilege agent tooling; human review as backstop; monitoring for anomalous outputs. |
| A6 | **Confidentiality leakage through AI** (PHI exposed via model/subprocessor) | Medium | Severe | Data-processing agreements with model providers; no training on client data without governed consent; residency-respecting inference; PHI-minimizing prompts; audit. |

---

## 5. Data Residency & Sovereignty Risk

Risks tied to where and how data lives across jurisdictions.

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| D1 | **Data leaving its required jurisdiction** | Medium | Severe | Tenant-level residency as a first-class property; in-region storage and inference; residency-aware architecture from the kernel (not retrofitted). |
| D2 | **Sub-processor non-compliance** (a vendor stores/processes data unlawfully) | Medium | High | Vetted sub-processors with DPAs/BAAs; residency guarantees flowed down; sub-processor register; periodic audit. |
| D3 | **Government access / sovereignty conflict** (conflicting jurisdictional demands) | Low | High | Per-country data isolation; legal review of lawful-access regimes; transparency governance; jurisdictional data segregation. |
| D4 | **Cross-tenant data bleed** (multi-tenant isolation failure) | Low | Severe | Strong tenant isolation; access controls tested; penetration testing; least-privilege; audit of cross-tenant access attempts. |

---

## 6. Operational Risk

Risks to the reliable running of the system and the clinical operation.

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| O1 | **System outage during care** (telehealth/cockpit unavailable mid-session) | Medium | High | High-availability architecture; degraded-mode fallbacks; offline-tolerant PWA; incident response; status transparency; alternative-contact procedures for sessions. |
| O2 | **Security breach / ransomware** on PHI | Medium | Severe | Defense-in-depth, encryption at rest/in transit, RBAC, monitoring, backups, breach-response plan, regular security audits and pen-testing. |
| O3 | **Clinician onboarding/credential-verification failure** (unverified clinician treating clients) | Low | High | Mandatory credential verification in the contract engine before assignment eligibility; Manager oversight; periodic re-verification. |
| O4 | **Scaling/performance degradation** as tenants/countries grow | Medium | Medium | Horizontally-scalable multi-tenant kernel; performance monitoring; capacity planning; load testing per phase. |
| O5 | **Change/deployment regression** harming a live clinical workflow | Medium | High | Staged rollout; automated testing gates; deployment monitoring; rollback; clinical-safety review for changes to crisis/assessment paths. |
| O6 | **Key-person / knowledge concentration** in a founder-led build | Medium | Medium | Documentation, code/architecture governance, knowledge-sharing, and phased team expansion as the platform matures. |

---

## 7. Financial Risk

Risks to the economic sustainability of the platform and its participants.

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| F1 | **Revenue leakage** (care delivered but not billed; payouts miscomputed) | Medium | High | Every invoice/payout traces to a governed clinical event; automated reconciliation; Finance dashboards; compensation computed deterministically from the event log (see `05-monetization-and-contracts.md`). |
| F2 | **Compensation-model errors** (composite contracts miscalculated) | Medium | High | Deterministic contract engine; itemized statements clinicians can verify; versioned, auditable contract terms; test coverage of comp logic. |
| F3 | **Payer/insurance non-payment or clawback** | Medium | Medium | Insurance-ready data capture; claim-quality validation; receivables tracking; diversified revenue (cash, subscription, institutional). |
| F4 | **CAC exceeding LTV in a market** | Medium | High | Organic SEO + referral + institutional channels to structurally lower CAC; outcome-driven retention to raise LTV; unit-economics gating before market expansion. |
| F5 | **Multi-currency / tax exposure** | Medium | Medium | Native multi-currency and per-country tax handling; local tax counsel; automated tax configuration per tenant. |
| F6 | **Capital intensity of the national play** (long institutional sales cycles) | High | Medium | Phase revenue from clinics/networks funds the march to institutional; land-and-expand cash flow; institutional deals as milestone-gated. |

---

## 8. Risk Governance

- **Ownership:** each risk category has an accountable owner (clinical → Clinical Director; regulatory/legal → compliance/legal; AI safety → AI governance; data/security/ops → engineering; financial → Finance/Executive).
- **Review cadence:** the register is reviewed on a fixed cadence and on any material change (new country, new AI feature, new institutional contract).
- **Highest-priority controls** (never compromised): the crisis-escalation path (C1/A2), human-in-the-loop AI (C2/A1/R3), consent governance (L2/R1/R2), and tenant/residency isolation (D1/D4).
- **The governing principle** — *AI assists, licensed clinicians decide* — is the master control: it eliminates the entire class of "autonomous clinical action" failures by construction.

VPSY treats compliance and safety not as costs but as the moat and the license to operate national behavioral-health infrastructure. The register is a living document; its mitigations are commitments enforced in the architecture.

---

## 9. Top-Risk Heat Map

The register's most severe residual risks — those rated High/Severe impact — concentrate in four zones. These receive the deepest, non-negotiable controls and the most frequent review.

| Zone | Governing risks | Residual severity | Why it is top-priority |
|---|---|---|---|
| **Crisis mishandling** | C1, A2 | Severe / Medium likelihood | A single failure can cost a life; the entire crisis path is engineered so no signal dies silently and no machine is terminal. |
| **AI clinical error / over-reliance** | C2, A1, A3, R3 | High / Medium–High likelihood | The novel risk class of the product; controlled by structural human-in-the-loop and EU-AI-Act-grade governance. |
| **PHI breach / confidentiality** | O2, A6, D4 | Severe / Medium likelihood | Behavioral-health data is among the most sensitive that exists; breach is existential to trust and license. |
| **Consent & residency defects** | L2, R1, R2, D1 | Severe / Medium likelihood | The legal foundation of lawful operation; gaps void the right to operate in a jurisdiction. |

Any change touching these zones (a new AI feature, a new country, a change to the crisis or consent flow) triggers a mandatory clinical-safety and compliance review before release.

---

## 10. Residual-Risk Acceptance Philosophy

Not all risk can be eliminated; some must be consciously accepted with controls. VPSY's philosophy on residual risk:

- **Zero tolerance** for uncontrolled autonomous clinical action, silent crisis-signal loss, or uncontrolled cross-jurisdiction data movement. These are designed out by construction, not merely mitigated.
- **Managed tolerance** for AI-quality risk (hallucination, drift): accepted only because human attestation is the backstop — the attested human artifact, never the AI draft, is the record.
- **Commercial tolerance** for financial and market risks (CAC/LTV, payer clawback, long institutional cycles): accepted as normal business risk, gated by phase-by-phase unit-economics discipline.
- **Escalating scrutiny with scale:** as VPSY moves from single clinics (Phase 1) to national infrastructure (Phase 6), the bar on every control rises. A control adequate for one clinic is re-validated before it governs a nation's data.

The register exists to make these choices explicit and auditable — so that when a regulator, a partner, or a government asks "how do you manage this risk?", the answer is documented, architected, and demonstrable.
