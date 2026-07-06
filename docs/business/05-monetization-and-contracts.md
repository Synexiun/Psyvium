# VPSY OS — Monetization & Clinician Contracts

> **AI assists, licensed clinicians decide.** The economics engine automates computation and disbursement; it never makes clinical decisions. Every dollar traces to a governed clinical event.

VPSY's Business OS (Layer 6) turns every session, package, subscription, referral, and outcome into correctly-attributed economics — across many client revenue models and many clinician compensation models, in many countries. This document specifies those models, the unit economics, and the LTV/CAC framing that makes the national-infrastructure play financeable.

---

## 1. Revenue Models (client-side)

VPSY supports multiple, concurrent client-side revenue models, selectable per tenant/clinic/country.

| Model | Description | Best fit | Billing trigger |
|---|---|---|---|
| **Session / fee-for-service** | Pay per session at a set rate | Cash-pay individual clients | Per completed session |
| **Package** | Prepaid bundle of N sessions (often discounted) | Committed treatment episodes | On package purchase; drawn down per session |
| **Subscription** | Recurring monthly/quarterly fee for a defined care level | Ongoing care, coaching-adjacent, maintenance | Recurring cycle |
| **Insurance-ready / third-party payer** | Claims-formatted billing to insurers/payers | Insured markets (e.g., US) | Per session, claim-submitted |
| **Institutional / corporate contract** | Employer (EAP), school, court, or government pays for a population | B2B2C, institutional referrals | Per contract terms (capitation, per-utilization, or block) |
| **Sliding scale / subsidized** | Income-adjusted or subsidized rate | Access-equity programs, public partners | Per session at adjusted rate |

Design notes:
- Every invoice ties to a governed clinical event (session, package draw, subscription period), so revenue reconciles to the clinical record with no leakage.
- Multi-currency and per-country tax handling are native.
- **Insurance-ready** means the data model captures the fields required for claims (codes, dates, provider, service) so payer billing is a configuration, not a rebuild — enabling entry into insured markets when contracts are in place.

---

## 2. Clinician Compensation Models

VPSY's contract engine encodes many compensation models — and, critically, **composites** of them (a single clinician's pay can combine several). This is the ERP capability generic tools lack.

| # | Model | How it computes | Typical use |
|---|---|---|---|
| 1 | **Fixed salary** | Flat periodic amount, independent of volume | Employed staff clinicians, guaranteed base |
| 2 | **Per-session** | Fixed amount per completed session | Contract clinicians, sessional staff |
| 3 | **Revenue share** | % of the revenue the clinician generates | Independent clinicians on a network |
| 4 | **Tiered commission** | Escalating % as the clinician crosses volume/revenue thresholds | Growth incentive for producers |
| 5 | **Senior override** | A senior clinician earns an override % on juniors they lead | Team leads, clinical seniority |
| 6 | **Supervisor share** | Supervisor earns a share of supervisees' billed work | Supervision relationships |
| 7 | **Clinic share** | The clinic/tenant retains a defined share of revenue | Platform/clinic sustainability |
| 8 | **Referral share** | The referral source (partner, or referring clinician) earns a share | Doctor/school/company/court referrals |
| 9 | **Equity grant** | Ownership stake in lieu of / alongside cash comp | Founding clinicians, key hires |
| 10 | **Country-specific** | Localized model reflecting local law, tax, norms, currency | Multi-country operations |
| 11 | **Group-session split** | Session revenue split across co-facilitators (and clinic) | Group therapy, workshops |
| 12 | **Corporate split** | Revenue split logic for corporate/institutional contracts | EAP, government, school programs |

### 2.1 Composite contracts
A real contract is often a stack. Example: *base salary (Model 1) + tiered commission above a threshold (Model 4) + supervisor share on two supervisees (Model 6), net of clinic share (Model 7).* VPSY's engine computes the composite automatically per pay period and produces an itemized statement so the clinician sees exactly how each component contributed.

### 2.2 Worked example (illustrative)

Assume a clinician on **base + tiered commission + supervisor share**, net of clinic share, in one period:

| Component | Basis | Amount (illustrative) |
|---|---|---|
| Fixed base | Monthly salary | 2,000 |
| Per-session / revenue share | 40 sessions, revenue share tier 1 (50%) on 6,000 revenue | 3,000 |
| Tiered commission uplift | Revenue above 5,000 threshold taxed at +10% | 100 |
| Supervisor share | 5% of two supervisees' 4,000 billed | 200 |
| Clinic share (deduction) | Clinic retains 10% of clinician-generated 6,000 | (600) |
| **Net clinician payout** | | **4,700** |

The engine computes this deterministically from the contract and the clinical event log; Finance disburses and reconciles. (Numbers illustrative only.)

### 2.3 Governance
- Contract terms are versioned and auditable; changes are attributable.
- Compensation computation is **downstream of governed clinical events** — you cannot get paid for a session that did not clinically occur.
- Referral-share disbursement is triggered by the attributed referral source captured at Stage A of the lifecycle (see `04-user-journeys.md`).

---

## 3. Unit Economics

VPSY's unit economics work at two levels: the **session/episode** (operational margin) and the **account/tenant** (platform margin).

### 3.1 Episode-level contribution (illustrative structure)

| Line | Note |
|---|---|
| Client revenue per episode | Sessions × rate, or package/subscription value |
| less Clinician compensation | Per the composite contract model |
| less Referral share | Where a partner referred the client |
| less Direct delivery cost | Telehealth, payment processing, assessment licensing |
| = **Episode contribution margin** | The clinic/platform's gross contribution per episode |

Levers that improve episode margin *without* compromising clinical quality:
- **CAT-shortened assessments** (Layer 5) reduce assessment time/cost per episode.
- **AI-drafted documentation** (Layer 4) reduces clinician admin time per session, raising effective clinical throughput.
- **Better matching** (Manager + allocation agent) improves retention and outcomes, lengthening healthy episodes and reducing early drop-off.

### 3.2 Platform-level economics
- **Gross margin** improves with scale as the shared kernel (record, psychometrics, AI, billing) amortizes across more clinicians and clinics.
- **Marketplace take** (clinic share + platform fees) plus **institutional contracts** form recurring, high-margin revenue.
- **Data asset** (longitudinal outcomes) is a non-cash compounding asset that underwrites payer/government contracts.

---

## 4. LTV / CAC Framing

### 4.1 Client LTV
- **LTV drivers:** episode length (retention), re-engagement across life episodes, package/subscription attach, and referral generation (a satisfied client becomes a referral source).
- **Outcome-driven retention:** measured, visible progress (Layer 5) improves retention — clients who *see* it working stay. Outcomes are thus not just clinical goods but LTV drivers.

### 4.2 CAC and the structural CAC advantage
- **Organic acquisition (Layer 1):** the programmatic-SEO public network structurally lowers blended CAC over time — organic entries cost far less than paid.
- **Referral network (Layer 1):** doctors, schools, employers, courts, and institutions supply attributed demand at low marginal CAC, with referral-share aligning incentives.
- **Institutional contracts:** a single government/employer/school contract acquires a *population* at once — the lowest CAC-per-client channel and the core of the national play.

### 4.3 The LTV:CAC thesis
VPSY's model is engineered so that:
- **CAC trends down** as organic + referral + institutional channels compound (network effects, SEO moat).
- **LTV trends up** as outcome-driven retention, re-engagement, and subscription/package attach compound.
- The widening LTV:CAC ratio is what makes country-scale expansion financeable and the infrastructure play viable.

### 4.4 Why institutional/government economics change the game
A national or institutional contract shifts the model from acquiring clients one at a time to acquiring and serving populations under a governed, outcomes-proven, compliant system. This:
- Collapses CAC (population acquired per contract).
- Creates durable, recurring revenue.
- Deepens the data and regulatory moats (more governed outcomes, more compliance lock-in).

---

## 5. Financial Governance & Controls

- **No leakage:** every invoice and every payout traces to a governed clinical event; Finance reconciles clinical activity to revenue and to payout liabilities each period (see Finance persona, `03-personas-and-roles.md`).
- **Auditability:** contract versions, compensation computations, disbursements, and referral-share allocations are all attributable and auditable.
- **Multi-country compliance:** currency, tax, and country-specific compensation law handled at the tenant level.
- **Separation of concerns:** the economics engine consumes clinical events but never influences clinical decisions — pay logic is strictly downstream of care, preserving the integrity of "clinicians decide."

---

## 6. Monetization Summary

VPSY monetizes the **whole lifecycle**, not a single transaction:
- **Client-side:** sessions, packages, subscriptions, insurance-ready claims, and institutional/government contracts.
- **Clinician-side:** a contract engine encoding 12+ compensation models and their composites, computed automatically from governed clinical events.
- **Platform-side:** clinic share, platform fees, and recurring institutional revenue, amortized over a shared kernel.
- **Compounding assets:** a longitudinal outcome data moat and a compliance/regulatory moat that together underwrite the national-infrastructure business.

The result is a business whose unit economics improve with scale, whose CAC falls as organic/referral/institutional channels compound, and whose LTV rises with proven outcomes — the financial foundation for building behavioral-health infrastructure at the scale of a country.

---

## 7. Pricing Architecture

VPSY earns across three distinct pricing surfaces, each independently configurable per tenant and country.

| Surface | What is priced | Pricing mechanism | Who pays |
|---|---|---|---|
| **Platform / SaaS** | Access to the operating system (cockpit, command center, ERP, psychometrics, AI) | Per-seat and/or per-tenant subscription, tiered by phase/capability | Clinic / network / institution |
| **Marketplace take** | The clinic/platform share of clinical revenue | Clinic share (Model 7) + platform fee on transacted care | Deducted at the point of care |
| **Institutional contract** | Population-scale access and outcomes | Capitation, per-utilization, or block funding | Government / employer / insurer / school system |

Design intent: no single pricing surface carries the whole business. Platform SaaS provides predictable recurring revenue; marketplace take scales with clinical volume; institutional contracts provide large, durable, population-scale revenue. Together they de-risk the model against any one channel underperforming.

---

## 8. Contract-Engine Design Requirements

For the compensation engine to encode 12+ models and their composites correctly across countries, it must satisfy a set of hard requirements:

- **Composable rules:** any contract is a stack of rule components (base, share, tier, override, split, deduction) evaluated in a defined precedence order.
- **Event-sourced inputs:** the engine consumes the immutable log of governed clinical events (completed sessions, package draws, group co-facilitations, referred conversions) — never free-typed amounts.
- **Deterministic and reproducible:** the same inputs and contract version always produce the same payout; every computation is reproducible for audit.
- **Versioned terms:** contract changes create new versions; historical periods are computed against the terms in force at the time.
- **Itemized transparency:** every clinician receives a statement showing each component's contribution — the antidote to the "opaque pay" pain (see Psychologist persona).
- **Jurisdiction-aware:** country-specific tax, currency, and compensation-law constraints (including where referral-share or fee-splits are legally restricted — see risk L5) are applied automatically.
- **Reconcilable:** payout liabilities reconcile to the clinical event log and to the general ledger, closing the loop with accounting.

---

## 9. Revenue-Model Fit by Buyer

Different buyers monetize through different combinations of the models above. The table maps the primary buyer to their natural revenue and compensation configuration.

| Buyer | Client revenue models | Clinician comp models | Notes |
|---|---|---|---|
| Solo / small clinic | Session, package, subscription | Per-session, revenue share, clinic share | Simplicity and cash-pay focus |
| Clinic network | All of the above + referral | Composite: base + tiered + override + supervisor + clinic share | Full ERP complexity, multi-clinician |
| Insured market | Insurance-ready + session | Per-session, revenue share | Requires claims data capture |
| Employer / EAP | Institutional/corporate contract | Corporate split, per-session | Population access via employer |
| Government / national | Institutional (capitation/block) + subsidized | Country-specific, salary, corporate split | Population-scale, residency-bound |

This mapping is why the multi-model engine is not over-engineering: as VPSY moves from a solo clinic (Phase 1) to national infrastructure (Phase 6), the *same* engine expresses each buyer's economics without a rebuild — a direct expression of the operating-system thesis applied to money.
