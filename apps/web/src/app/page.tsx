'use client';

import Image from 'next/image';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { useI18n } from '@/i18n';

const lifecycleStages = [
  'Intake',
  'Screening',
  'Triage',
  'Assignment',
  'Assessment',
  'Formulation',
  'Treatment',
  'Intervention',
  'Outcomes',
  'Analytics',
];

const directorQuestions = [
  {
    q: 'Who needs help right now?',
    a: 'Risk screening, open escalations, waiting clients, and SLA pressure are visible from one clinical command view.',
  },
  {
    q: 'Who is treating them?',
    a: 'Assignments are manager-approved, credential-aware, jurisdiction-aware, and auditable from intake to active care.',
  },
  {
    q: 'Is the intervention working?',
    a: 'Outcomes, psychometrics, attendance, homework, and deterioration signals stay linked to the treatment plan.',
  },
  {
    q: 'Are we exposed clinically, legally, or financially?',
    a: 'Consent gaps, risk flags, documentation lag, utilization, revenue, and payouts sit on the same governed spine.',
  },
];

const roleEntrances = [
  {
    role: 'Client',
    href: '/home',
    label: 'Patient PWA',
    body: 'Appointments, assessments, secure messages, progress, homework, documents, payments, and crisis resources.',
  },
  {
    role: 'Psychologist',
    href: '/session',
    label: 'Clinical cockpit',
    body: 'Caseload, session notes, treatment plans, risk alerts, outcome measures, and AI drafts awaiting signature.',
  },
  {
    role: 'Clinical Director',
    href: '/manager',
    label: 'Triage command',
    body: 'Risk-aware intake review, clinician ranking, assignment authority, caseload balance, and audit events.',
  },
  {
    role: 'Executive',
    href: '/reports',
    label: 'Enterprise view',
    body: 'Demand, utilization, outcomes, margin, payout liabilities, and aggregate population analytics.',
  },
  {
    role: 'Admin',
    href: '/admin',
    label: 'Tenant operations',
    body: 'Clinics, users, feature flags, client and psychologist registries, and governed operational changes.',
  },
];

const featureSuites = [
  {
    title: 'Public network and CRM',
    body: 'Referral partners, lead capture, source attribution, engagement timelines, and a one-way audited handoff into intake.',
  },
  {
    title: 'Intake, screening, and triage',
    body: 'Structured intake, risk screening, clinical profiling, urgency bands, and manager-reviewed assignment packets.',
  },
  {
    title: 'Clinical HIS',
    body: 'Client record, treatment plan, session workspace, notes, documents, consent, messaging, risk, and longitudinal timeline.',
  },
  {
    title: 'Telehealth and communications',
    body: 'Video sessions, waiting rooms, voice, SMS, async media messages, and consent-gated communication records.',
  },
  {
    title: 'Psychometrics and outcomes',
    body: 'IRT scoring, CAT sessions, validity context, reliable-change thinking, outcome trajectories, and reportable measurement.',
  },
  {
    title: 'Business operating system',
    body: 'Scheduling, billing, payments, accounting, revenue share, clinician payouts, contract models, and executive finance reports.',
  },
];

const aiControls = [
  {
    control: 'Human decision gate',
    proof:
      'AI output waits for accept, edit, or reject before it touches the clinical record.',
  },
  {
    control: 'Recommendation ledger',
    proof:
      'Model version, prompt version, input hash, confidence, and reviewer action are logged.',
  },
  {
    control: 'No autonomous diagnosis',
    proof:
      'Agents suggest hypotheses, summaries, plans, and drafts. Licensed clinicians decide.',
  },
  {
    control: 'Kill-switch posture',
    proof:
      'AI-assisted surfaces are tenant-gated and can be disabled without breaking the clinical record.',
  },
];

const evidenceControls = [
  {
    title: 'Audit log example',
    body: 'Every clinical mutation emits an attributable event with actor, role, tenant, purpose, timestamp, and chain integrity.',
  },
  {
    title: 'Role-permission matrix',
    body: 'RBAC is narrowed by ABAC predicates such as consent state, tenant, clinic, purpose, and license jurisdiction.',
  },
  {
    title: 'PHI handling',
    body: 'Purpose-scoped access, TLS in transit, field-level encryption support, and de-identified aggregate analytics.',
  },
  {
    title: 'Tenant isolation',
    body: 'Tenant context is injected into requests and backed by row-level security as a database-level control.',
  },
  {
    title: 'Crisis escalation',
    body: 'Risk flags route to a human review path with SLA pressure, break-glass auditing, and crisis resources.',
  },
];

const journey = [
  'Client begins intake and states goals, symptoms, preferences, and safety answers.',
  'Screening raises urgency and packages risk, profile, and missing information.',
  'Clinical Director reviews triage and approves the clinician assignment.',
  'Psychologist receives an assessment battery suggestion and drafts a treatment plan.',
  'Session note is structured, edited, signed, and linked back to goals and interventions.',
  'Outcome score changes, risk board updates, director dashboard reflects exposure, and audit records every step.',
];

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <path
        d="M5 12h14M13 6l6 6-6 6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path
        d="M5 12.5l4.2 4L19 7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SectionHeader({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#667085]">
        {label}
      </p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#111827] md:text-5xl">
        {title}
      </h2>
      {body && (
        <p className="mt-4 max-w-2xl text-base leading-7 text-[#5b6472] md:text-lg">
          {body}
        </p>
      )}
    </div>
  );
}

function CommandCenterMockup() {
  return (
    <div className="relative rounded-md border border-[#cfd8e3] bg-white shadow-[0_24px_80px_-42px_rgba(15,23,42,0.45)]">
      <div className="flex items-center justify-between border-b border-[#d9e0ea] px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#667085]">
            Clinical director
          </p>
          <p className="mt-1 text-sm font-semibold text-[#1f2937]">
            Triage and assignment command
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#475467]">
          <span className="h-2 w-2 rounded-full bg-[#d18d2b]" aria-hidden />
          Risk-aware live view
        </div>
      </div>

      <div className="grid gap-px bg-[#d9e0ea] md:grid-cols-[1.2fr_0.8fr]">
        <div className="bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['Open intakes', '24', '+6 today'],
              ['Need review', '7', '3 severe'],
              ['Avg time to assign', '38m', 'SLA on track'],
            ].map(([label, value, foot]) => (
              <div
                key={label}
                className="rounded border border-[#d9e0ea] bg-[#f8fafc] p-3"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#667085]">
                  {label}
                </p>
                <p className="mt-3 font-mono text-2xl font-semibold text-[#111827]">
                  {value}
                </p>
                <p className="mt-1 text-xs text-[#667085]">{foot}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 overflow-hidden rounded border border-[#d9e0ea]">
            <div className="grid grid-cols-[1fr_0.75fr_0.5fr] bg-[#f1f5f9] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#667085]">
              <span>Client signal</span>
              <span>Assignment</span>
              <span>Outcome</span>
            </div>
            {[
              ['Severe ideation flag', 'Dr. Rivera - trauma', 'Baseline'],
              ['Moderate anxiety', 'Dr. Okafor - CBT', '+12%'],
              ['Review overdue', 'Clinical director', '-4%'],
              ['New school referral', 'Pending approval', 'n/a'],
            ].map((row, i) => (
              <div
                key={row[0]}
                className="grid grid-cols-[1fr_0.75fr_0.5fr] border-t border-[#e4e9f0] px-3 py-3 text-xs text-[#344054]"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${i === 0 ? 'bg-[#b32630]' : i === 2 ? 'bg-[#d18d2b]' : 'bg-[#3e5068]'}`}
                    aria-hidden
                  />
                  {row[0]}
                </span>
                <span>{row[1]}</span>
                <span className="font-mono">{row[2]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#f8fafc] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#667085]">
            Care lifecycle
          </p>
          <div className="mt-4 space-y-2">
            {lifecycleStages.slice(0, 6).map((stage, i) => (
              <div
                key={stage}
                className="flex items-center gap-3 rounded border border-[#d9e0ea] bg-white px-3 py-2 text-xs text-[#344054]"
              >
                <span className="grid h-5 w-5 place-items-center rounded-sm bg-[#eef2f6] font-mono text-[10px] text-[#3e5068]">
                  {i + 1}
                </span>
                <span>{stage}</span>
              </div>
            ))}
          </div>
          <PhonePreview />
        </div>
      </div>
    </div>
  );
}

function PhonePreview() {
  const nav = ['Home', 'Intake', 'Session', 'Risk'];
  return (
    <div className="mt-5 rounded-[28px] border border-[#cfd8e3] bg-[#0b0d11] p-2 shadow-[0_18px_45px_-32px_rgba(15,23,42,0.9)]">
      <div className="overflow-hidden rounded-[22px] bg-[#f8fafc]">
        <div className="border-b border-[#d9e0ea] px-4 py-3">
          <p className="text-sm font-semibold text-[#111827]">Patient PWA</p>
          <p className="text-xs text-[#667085]">
            Next session, assessments, messages, progress.
          </p>
        </div>
        <div className="space-y-2 px-4 py-4">
          <div className="rounded border border-[#d9e0ea] bg-white p-3">
            <p className="text-xs text-[#667085]">Next session</p>
            <p className="mt-1 text-sm font-semibold text-[#111827]">
              Today - 4:30 PM
            </p>
          </div>
          <div className="rounded border border-[#d9e0ea] bg-white p-3">
            <p className="text-xs text-[#667085]">Progress signal</p>
            <div className="mt-2 h-1.5 rounded-full bg-[#e4e9f0]">
              <div className="h-1.5 w-2/3 rounded-full bg-[#3e5068]" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-4 border-t border-[#d9e0ea] bg-white px-1 py-1.5">
          {nav.map((item) => (
            <span
              key={item}
              className="flex flex-col items-center gap-1 rounded px-1 py-1 text-[9px] uppercase tracking-[0.12em] text-[#667085]"
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-[#3e5068]"
                aria-hidden
              />
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function MobileCommandMockup() {
  const nav = ['Home', 'Intake', 'Session', 'Risk', 'More'];
  return (
    <div className="mx-auto max-w-[340px] rounded-[30px] border border-[#cfd8e3] bg-[#0b0d11] p-2 shadow-[0_22px_60px_-38px_rgba(15,23,42,0.9)]">
      <div className="overflow-hidden rounded-[24px] bg-[#f8fafc]">
        <div className="flex items-center justify-between border-b border-[#d9e0ea] px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-[#111827]">
              Psyvium mobile
            </p>
            <p className="text-xs text-[#667085]">Native shell preview</p>
          </div>
          <span className="rounded-sm bg-[#eef2f6] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[#3e5068]">
            Live
          </span>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="rounded border border-[#d9e0ea] bg-white p-3">
            <p className="text-xs text-[#667085]">Next step</p>
            <p className="mt-1 text-sm font-semibold text-[#111827]">
              Complete assessment before session
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded border border-[#d9e0ea] bg-white p-3">
              <p className="text-xs text-[#667085]">Risk</p>
              <p className="mt-1 font-mono text-lg font-semibold text-[#b32630]">
                Review
              </p>
            </div>
            <div className="rounded border border-[#d9e0ea] bg-white p-3">
              <p className="text-xs text-[#667085]">Outcome</p>
              <p className="mt-1 font-mono text-lg font-semibold text-[#111827]">
                +12%
              </p>
            </div>
          </div>
          <div className="rounded border border-[#d9e0ea] bg-white p-3">
            <p className="text-xs text-[#667085]">Care lifecycle</p>
            <div className="mt-3 grid grid-cols-4 gap-1">
              {['Intake', 'Triage', 'Care', 'Outcome'].map((item) => (
                <span
                  key={item}
                  className="rounded bg-[#eef2f6] px-1.5 py-1 text-center text-[10px] text-[#475467]"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-5 border-t border-[#d9e0ea] bg-white px-1 py-1.5">
          {nav.map((item) => (
            <span
              key={item}
              className="flex flex-col items-center gap-1 rounded px-1 py-1 text-[8px] uppercase tracking-[0.1em] text-[#667085]"
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-[#3e5068]"
                aria-hidden
              />
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
export default function Home() {
  const { t } = useI18n();

  return (
    <main className="min-h-screen bg-[#f7f9fb] text-[#111827]">
      <a href="#content" className="skip-link">
        {t('common.skipToContent')}
      </a>
      <SiteNav />

      <section
        id="content"
        className="relative overflow-hidden border-b border-[#d9e0ea] bg-[#f7f9fb]"
      >
        <div
          className="absolute inset-x-0 top-0 h-96 bg-[linear-gradient(180deg,#ffffff_0%,rgba(255,255,255,0)_100%)]"
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-6 pb-10 pt-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:pb-14 lg:pt-14">
          <div>
            <h1 className="text-5xl font-semibold tracking-tight text-[#101828] md:text-7xl">
              Psyvium OS
            </h1>
            <h2 className="mt-4 max-w-2xl text-3xl font-semibold leading-tight tracking-tight text-[#1f2937] md:text-5xl">
              The operating system for psychological care.
            </h2>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#5b6472]">
              Psyvium helps psychology organizations intake, triage, assign,
              treat, monitor, and govern care through one auditable clinical
              lifecycle.
            </p>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[#344054]">
              It connects intake, screening, triage, clinician assignment,
              assessment, treatment planning, intervention tracking, outcomes,
              payments, and risk governance into one continuous system.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded bg-[#111827] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2d3748]"
              >
                View product demo <ArrowIcon />
              </Link>
              <Link
                href="/intake"
                className="inline-flex items-center justify-center gap-2 rounded border border-[#b8c2d0] bg-white px-5 py-3 text-sm font-semibold text-[#111827] transition hover:border-[#3e5068] hover:bg-[#f8fafc]"
              >
                Start clinical intake
              </Link>
            </div>
            <div className="mt-8 border-l-2 border-[#3e5068] pl-4 text-sm leading-6 text-[#344054]">
              <strong className="font-semibold text-[#111827]">
                AI assists. Licensed clinicians decide.
              </strong>{' '}
              Every action is auditable. Powered by the VPSY clinical
              intelligence engine.
            </div>
          </div>

          <div className="relative">
            <div className="absolute -right-6 top-2 hidden h-72 w-72 overflow-hidden rounded-md border border-[#d9e0ea] bg-white shadow-[0_20px_70px_-48px_rgba(15,23,42,0.7)] lg:block">
              <Image
                src="/psyvium-clinical-operations.png"
                alt="Clinical operations workspace with behavioral health command displays"
                fill
                priority
                sizes="320px"
                className="object-cover"
              />
            </div>
            <div className="relative lg:mr-16 lg:mt-20">
              <div className="hidden md:block">
                <CommandCenterMockup />
              </div>
              <div className="md:hidden">
                <MobileCommandMockup />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="problem"
        className="border-b border-[#d9e0ea] bg-white py-16 md:py-20"
      >
        <div className="mx-auto max-w-7xl px-6">
          <SectionHeader
            label="The director problem"
            title="Clinical leaders need command over care quality, risk, assignments, and exposure."
            body="The buyer is not only the therapist. Psyvium is built for clinic owners, clinical directors, hospital behavioral-health leaders, payer networks, universities, government programs, and multi-location psychology groups."
          />
          <div className="mt-10 grid gap-px overflow-hidden rounded-md border border-[#d9e0ea] bg-[#d9e0ea] md:grid-cols-2">
            {directorQuestions.map((item, i) => (
              <article key={item.q} className="bg-white p-6 md:p-8">
                <p className="font-mono text-xs text-[#667085]">0{i + 1}</p>
                <h3 className="mt-5 text-2xl font-semibold tracking-tight text-[#111827]">
                  {item.q}
                </h3>
                <p className="mt-3 leading-7 text-[#5b6472]">{item.a}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="platform"
        className="border-b border-[#d9e0ea] bg-[#f1f5f9] py-16 md:py-24"
      >
        <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <SectionHeader
            label="Operating system thesis"
            title="Not a therapy app. Not a scheduler. Not a generic EHR."
            body="Psyvium OS is clinical command infrastructure for psychology organizations: one governed record, one lifecycle, one audit trail, and one operating layer for care, operations, finance, and risk."
          />
          <div className="rounded-md border border-[#cfd8e3] bg-white p-6 shadow-[0_18px_55px_-42px_rgba(15,23,42,0.45)] md:p-8">
            <p className="text-xl font-semibold leading-8 tracking-tight text-[#111827]">
              The value is continuity. Most healthcare tools break the chain
              between acquisition, intake, treatment, measurement, billing, and
              governance. Psyvium keeps clinical, financial, operational, and
              risk signals in the same governed system.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {['One record', 'One consent', 'One audit trail'].map((item) => (
                <div
                  key={item}
                  className="rounded border border-[#d9e0ea] bg-[#f8fafc] p-4"
                >
                  <CheckIcon />
                  <p className="mt-3 text-sm font-semibold text-[#1f2937]">
                    {item}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="lifecycle"
        className="border-b border-[#d9e0ea] bg-white py-16 md:py-24"
      >
        <div className="mx-auto max-w-7xl px-6">
          <SectionHeader
            label="Clinical lifecycle"
            title="From first signal to measured outcome."
            body="The public funnel and the live product should tell the same story: continuity from intake through analytics, with no autonomous clinical decision hidden in the middle."
          />
          <div className="mt-10 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {lifecycleStages.map((stage, i) => (
              <div
                key={stage}
                className="min-h-28 rounded border border-[#d9e0ea] bg-[#f8fafc] p-4"
              >
                <p className="font-mono text-xs text-[#667085]">
                  {String(i + 1).padStart(2, '0')}
                </p>
                <p className="mt-6 text-lg font-semibold text-[#111827]">
                  {stage}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="roles"
        className="border-b border-[#d9e0ea] bg-[#101828] py-16 text-white md:py-24"
      >
        <div className="mx-auto max-w-7xl px-6">
          <SectionHeader
            label="Role-based demo entry"
            title="One product. Five governed demo lenses."
            body="Each entry opens a real product surface already represented in the codebase. The same lifecycle is rendered differently for clients, clinicians, directors, executives, and administrators."
          />
          <div className="mt-10 grid gap-px overflow-hidden rounded-md border border-white/15 bg-white/15 lg:grid-cols-5">
            {roleEntrances.map((entry) => (
              <Link
                key={entry.role}
                href={entry.href}
                className="group bg-[#101828] p-5 transition hover:bg-[#172033]"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#98a2b3]">
                  {entry.label}
                </p>
                <h3 className="mt-5 text-xl font-semibold text-white">
                  {entry.role}
                </h3>
                <p className="mt-3 text-sm leading-6 text-[#cbd5e1]">
                  {entry.body}
                </p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-white">
                  Open view <ArrowIcon />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section
        id="his"
        className="border-b border-[#d9e0ea] bg-[#f7f9fb] py-16 md:py-24"
      >
        <div className="mx-auto max-w-7xl px-6">
          <SectionHeader
            label="HIS feature suite"
            title="A behavioral-health HIS with CRM, telehealth, psychometrics, finance, and governance built in."
            body="The product is not a pile of dashboards. It is a native HIS plus ERP plus CRM plus telehealth stack for psychological care."
          />
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {featureSuites.map((feature) => (
              <article
                key={feature.title}
                className="rounded-md border border-[#d9e0ea] bg-white p-6 shadow-[0_14px_40px_-34px_rgba(15,23,42,0.55)]"
              >
                <h3 className="text-xl font-semibold tracking-tight text-[#111827]">
                  {feature.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-[#5b6472]">
                  {feature.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="governance"
        className="border-b border-[#d9e0ea] bg-white py-16 md:py-24"
      >
        <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionHeader
            label="AI governance"
            title="AI assists. Licensed clinicians decide."
            body="That line is the trust anchor. It belongs on the landing page, login page, dashboards, intake flow, AI suggestions, clinical notes, and risk alerts."
          />
          <div className="rounded-md border border-[#cfd8e3] bg-[#f8fafc] p-5 md:p-6">
            <div className="overflow-hidden rounded border border-[#d9e0ea] bg-white">
              <div className="grid grid-cols-[0.8fr_1.2fr] bg-[#f1f5f9] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[#667085]">
                <span>Control</span>
                <span>Evidence in product architecture</span>
              </div>
              {aiControls.map((item) => (
                <div
                  key={item.control}
                  className="grid grid-cols-[0.8fr_1.2fr] border-t border-[#e4e9f0] px-4 py-4 text-sm text-[#344054]"
                >
                  <strong className="font-semibold text-[#111827]">
                    {item.control}
                  </strong>
                  <span className="leading-6">{item.proof}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section
        id="compliance"
        className="border-b border-[#d9e0ea] bg-[#f1f5f9] py-16 md:py-24"
      >
        <div className="mx-auto max-w-7xl px-6">
          <SectionHeader
            label="Compliance evidence"
            title="Trust proof should be inspectable, not decorative."
            body="HIPAA, GDPR, EU AI Act, WHO LMM guidance, SOC 2, and ISO 27001 claims need artifacts buyers can diligence: control maps, ledgers, audit examples, tenancy diagrams, and crisis protocols."
          />
          <div className="mt-10 grid gap-px overflow-hidden rounded-md border border-[#cfd8e3] bg-[#cfd8e3] md:grid-cols-5">
            {evidenceControls.map((item) => (
              <article key={item.title} className="bg-white p-5">
                <h3 className="text-base font-semibold text-[#111827]">
                  {item.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-[#5b6472]">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
          <div className="mt-8">
            <Link
              href="/compliance"
              className="inline-flex items-center justify-center gap-2 rounded bg-[#111827] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2d3748]"
            >
              Review compliance evidence <ArrowIcon />
            </Link>
          </div>
        </div>
      </section>

      <section
        id="story"
        className="border-b border-[#d9e0ea] bg-white py-16 md:py-24"
      >
        <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[0.8fr_1.2fr]">
          <SectionHeader
            label="Live demo story"
            title="Show one complete fictional patient journey."
            body="A buyer should understand the product by watching one case move through the governed lifecycle from first intake to director dashboard update."
          />
          <ol className="rounded-md border border-[#d9e0ea] bg-[#f8fafc] p-4 md:p-6">
            {journey.map((step, i) => (
              <li
                key={step}
                className="grid grid-cols-[44px_1fr] gap-4 border-b border-[#d9e0ea] py-4 last:border-b-0"
              >
                <span className="grid h-8 w-8 place-items-center rounded-sm bg-[#111827] font-mono text-xs text-white">
                  {i + 1}
                </span>
                <p className="leading-7 text-[#344054]">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-[#101828] px-6 py-16 text-white md:py-20">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">
            Clinical command infrastructure for psychological care.
          </h2>
          <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-[#cbd5e1]">
            From intake to outcomes, with auditable AI assistance, human
            clinical control, and the operational machinery to run a serious
            psychology organization.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded bg-white px-5 py-3 text-sm font-semibold text-[#111827] transition hover:bg-[#e5e7eb]"
            >
              View product demo <ArrowIcon />
            </Link>
            <Link
              href="/intake"
              className="inline-flex items-center justify-center rounded border border-white/30 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Start clinical intake
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#d9e0ea] bg-white py-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 text-sm text-[#667085] md:flex-row md:items-center md:justify-between">
          <span className="font-semibold text-[#111827]">Psyvium OS</span>
          <span>Powered by the VPSY clinical intelligence engine.</span>
          <span>{t('common.aiMotto')}</span>
        </div>
      </footer>
    </main>
  );
}
