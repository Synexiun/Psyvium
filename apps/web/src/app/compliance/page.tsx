import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';

export const metadata: Metadata = {
  title: 'Compliance Evidence - Psyvium OS',
  description:
    'Inspect Psyvium OS control mapping, audit evidence, AI recommendation logs, PHI handling, tenant isolation, and crisis escalation protocols.',
};

const controlMap = [
  [
    'HIPAA',
    'Privacy, security, breach notification, minimum necessary, BAA-bound subprocessors.',
  ],
  [
    'GDPR',
    'Lawful basis, consent scopes, DPIA posture, data subject rights, residency, 72-hour breach notification.',
  ],
  [
    'EU AI Act',
    'High-risk posture, logging, transparency, human oversight, model registry, post-market monitoring.',
  ],
  [
    'WHO LMM Guidance',
    'Defined use, human oversight, equity monitoring, data protection, continuous evaluation.',
  ],
  [
    'SOC 2 / ISO 27001',
    'Access control, change management, incident response, logging, backup, vendor governance.',
  ],
  [
    'FDA CDS posture',
    'Clinician-facing recommendations with independently reviewable basis and no autonomous clinical action.',
  ],
  [
    'Data residency',
    'Tenant-region pinning, residency-aware stores, controlled cross-border basis, aggregate de-identification.',
  ],
  [
    'Clinical licensing',
    'Clinical writes gated by active license state, scope, jurisdiction, and cross-border telehealth rules.',
  ],
];

const artifacts = [
  [
    'Audit log example',
    'Immutable evidence for every clinical, administrative, and AI action.',
  ],
  [
    'Role-permission matrix',
    'Least privilege through RBAC narrowed by ABAC predicates.',
  ],
  [
    'AI recommendation ledger',
    'Model, prompt, hashes, confidence, status, reviewer, and human decision.',
  ],
  [
    'PHI handling diagram',
    'Purpose-limited access, encryption, redaction, retention, and aggregate de-identification.',
  ],
  [
    'Tenant isolation diagram',
    'Tenant context, repository scoping, Postgres RLS, audit chain, and region routing.',
  ],
  [
    'Crisis escalation protocol',
    'Risk flag, human review, SLA timer, break-glass audit, and crisis resources.',
  ],
  [
    'Data retention policy',
    'Retention class, legal hold, jurisdiction schedule, and crypto-shredding where lawful.',
  ],
  [
    'Synthetic demo data statement',
    'Demo records are fictional and separated from real PHI environments.',
  ],
];

const auditEvent = [
  ['Time UTC', '2026-06-01 14:37:22Z'],
  ['Actor', 'dr.james.lee'],
  ['Role', 'Psychologist'],
  ['Purpose', 'Create progress note'],
  ['Consent ref', 'cons_9c7e2b'],
  ['ABAC rule', 'patient.assigned_clinician && purpose.treatment'],
  ['Resource', 'note:nt_7d2c9a'],
  ['Previous hash', 'a7f2b0c9d3e4f5b1c7d8e9f0a1b2'],
  ['Event hash', '5c3d9e0f7a6b8c2d1e9f0a6b7c8'],
];

const aiLedger = [
  ['Agent', 'Risk-triage assistant'],
  ['Model version', 'psyvium-llm 1.3.2'],
  ['Prompt version', 'triage-risk v4.1.0'],
  ['Input hash', '3f6b8e9a1c7d4b2a9f0e6d3c1'],
  ['Confidence', '0.86'],
  ['Status', 'Pending clinician review'],
  ['Human decision', 'Proceed with clinical review'],
  ['Reviewer', 'dr.james.lee'],
];

const permissionRows = [
  ['Self intake and profile', 'Own data', '-', '-', '-', '-', 'Aggregate only'],
  [
    'Clinical notes',
    'Shared view',
    'Create / sign assigned',
    'Review assigned team',
    '-',
    '-',
    'Aggregate only',
  ],
  [
    'Risk and triage dashboard',
    'Limited own view',
    'Assigned clients',
    'All team queues',
    '-',
    '-',
    'Portfolio view',
  ],
  ['User and role management', '-', '-', '-', 'Configure', '-', '-'],
  [
    'Billing and payments',
    'Own invoices',
    '-',
    'Operational view',
    '-',
    'Full access',
    'Aggregate only',
  ],
  [
    'Audit logs',
    'Own access log',
    'Own actions',
    'Team actions',
    'All actions',
    'Financial actions',
    'Policy-based',
  ],
  [
    'Data export',
    'Own data / GDPR',
    'Minimum necessary',
    'Minimum necessary',
    'Controlled',
    'Controlled',
    'Policy-based',
  ],
  ['Break-glass access', '-', '-', 'With reason', 'With approval', '-', '-'],
];

const architectureSteps = [
  [
    'Browser / PWA',
    'TLS, MFA, service worker, client-side session boundaries.',
  ],
  [
    'Next.js edge',
    'Rate limits, middleware session boundary, public and portal separation.',
  ],
  [
    'NestJS API',
    'JWT auth guard, RBAC, ABAC, input validation, audit middleware.',
  ],
  [
    'Data layer',
    'Postgres tenant scoping, RLS backstop, immutable audit store, encrypted object storage.',
  ],
  [
    'AI Gateway',
    'Policy checks, prompt logging, PHI minimization, recommendation ledger, kill-switches.',
  ],
  [
    'Analytics warehouse',
    'De-identified projections only, privacy floor for small cohorts.',
  ],
];

const crisisSteps = [
  [
    'Screening flag',
    'Structured safety answers raise risk flags for ideation, self-harm, harm-to-others, abuse, or psychosis.',
  ],
  [
    'Human review',
    'A clinician or clinical director reviews the case inside a defined SLA.',
  ],
  [
    'Escalation timer',
    'Critical cases have shorter timers and visible SLA pressure.',
  ],
  [
    'Break-glass access',
    'Emergency access requires reason, scope, actor, expiry, and full audit.',
  ],
  [
    'Crisis resources',
    'Client receives local emergency resources and safety-plan guidance.',
  ],
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

function EvidenceTable({ rows }: { rows: string[][] }) {
  return (
    <div className="overflow-hidden rounded-md border border-[#cfd8e3] bg-white">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="grid gap-3 border-b border-[#e4e9f0] px-4 py-3 last:border-b-0 md:grid-cols-[220px_1fr]"
        >
          <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#667085]">
            {label}
          </dt>
          <dd className="min-w-0 break-words text-sm leading-6 text-[#344054]">
            {value}
          </dd>
        </div>
      ))}
    </div>
  );
}

export default function CompliancePage() {
  return (
    <main className="min-h-screen bg-[#f7f9fb] text-[#111827]">
      <a href="#content" className="skip-link">
        Skip to content
      </a>
      <SiteNav />

      <section id="content" className="border-b border-[#d9e0ea] bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 lg:grid-cols-[1fr_360px] lg:items-start lg:py-20">
          <div>
            <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-[#101828] md:text-7xl">
              Compliance evidence for psychological care infrastructure.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-[#5b6472]">
              Psyvium OS maps clinical safety, privacy, AI oversight, tenant
              isolation, and auditability to concrete controls buyers can
              inspect.
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
                className="inline-flex items-center justify-center rounded border border-[#b8c2d0] bg-white px-5 py-3 text-sm font-semibold text-[#111827] transition hover:border-[#3e5068] hover:bg-[#f8fafc]"
              >
                Start clinical intake
              </Link>
            </div>
          </div>
          <aside className="rounded-md border border-[#cfd8e3] bg-[#f8fafc] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#667085]">
              Evidence you can inspect
            </p>
            <ul className="mt-5 space-y-4 text-sm leading-6 text-[#344054]">
              {[
                'Control mapping and policies',
                'Live auditability and ledgers',
                'Architecture and isolation',
                'Clinical safety and escalation',
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <span
                    className="mt-1 grid h-4 w-4 place-items-center rounded-sm border border-[#3e5068] text-[#3e5068]"
                    aria-hidden
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        d="M5 13l4 4L19 7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section className="border-b border-[#d9e0ea] bg-[#f7f9fb] py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <SectionHeader
            label="Control map"
            title="Regulatory claims mapped to platform controls."
          />
          <div className="mt-10 grid gap-px overflow-hidden rounded-md border border-[#cfd8e3] bg-[#cfd8e3] md:grid-cols-2 lg:grid-cols-4">
            {controlMap.map(([title, body]) => (
              <article key={title} className="bg-white p-5">
                <h3 className="text-lg font-semibold text-[#111827]">
                  {title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-[#5b6472]">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[#d9e0ea] bg-white py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <SectionHeader
            label="Evidence artifacts"
            title="The artifacts a healthcare buyer should ask to see."
          />
          <div className="mt-10 grid gap-px overflow-hidden rounded-md border border-[#cfd8e3] bg-[#cfd8e3] md:grid-cols-2 lg:grid-cols-4">
            {artifacts.map(([title, body]) => (
              <article key={title} className="bg-white p-5">
                <h3 className="text-base font-semibold text-[#111827]">
                  {title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-[#5b6472]">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[#d9e0ea] bg-[#f1f5f9] py-16 md:py-20">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 lg:grid-cols-2">
          <div>
            <SectionHeader
              label="Audit event example"
              title="Every clinical action produces an evidentiary event."
            />
            <div className="mt-8">
              <EvidenceTable rows={auditEvent} />
            </div>
          </div>
          <div>
            <SectionHeader
              label="AI recommendation ledger"
              title="AI output is logged before a human decides."
            />
            <div className="mt-8">
              <EvidenceTable rows={aiLedger} />
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#d9e0ea] bg-white py-16 md:py-20">
        <div className="mx-auto max-w-7xl px-6">
          <SectionHeader
            label="Role and permission evidence"
            title="Access starts with RBAC and is narrowed by ABAC."
            body="This public matrix is illustrative. In product, permission checks are enforced by route middleware, API guards, tenant context, and policy predicates."
          />
          <div className="mt-10 overflow-x-auto rounded-md border border-[#cfd8e3] bg-white">
            <table className="min-w-[980px] w-full border-collapse text-left text-sm">
              <thead className="bg-[#101828] text-white">
                <tr>
                  {[
                    'Capability',
                    'Client',
                    'Psychologist',
                    'Clinical Director',
                    'Admin',
                    'Finance',
                    'Executive / Government',
                  ].map((head) => (
                    <th
                      key={head}
                      className="border-r border-white/10 px-4 py-3 font-semibold last:border-r-0"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permissionRows.map((row) => (
                  <tr
                    key={row[0]}
                    className="border-b border-[#e4e9f0] last:border-b-0"
                  >
                    {row.map((cell, i) => (
                      <td
                        key={`${row[0]}-${i}`}
                        className="border-r border-[#e4e9f0] px-4 py-3 text-[#344054] last:border-r-0"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="border-b border-[#d9e0ea] bg-[#f7f9fb] py-16 md:py-20">
        <div className="mx-auto grid max-w-7xl gap-8 px-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <SectionHeader
              label="PHI and tenancy architecture"
              title="Sensitive data flows through governed boundaries."
            />
            <div className="mt-10 grid gap-3 md:grid-cols-3">
              {architectureSteps.map(([title, body], i) => (
                <article
                  key={title}
                  className="relative rounded-md border border-[#cfd8e3] bg-white p-5"
                >
                  <p className="font-mono text-[11px] text-[#667085]">
                    0{i + 1}
                  </p>
                  <h3 className="mt-4 text-lg font-semibold text-[#111827]">
                    {title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-[#5b6472]">
                    {body}
                  </p>
                </article>
              ))}
            </div>
          </div>
          <div>
            <SectionHeader
              label="Crisis and risk protocol"
              title="Risk is routed to people, not autonomous counseling."
            />
            <ol className="mt-10 rounded-md border border-[#cfd8e3] bg-white p-5">
              {crisisSteps.map(([title, body], i) => (
                <li
                  key={title}
                  className="grid grid-cols-[40px_1fr] gap-4 border-b border-[#e4e9f0] py-4 last:border-b-0"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-sm bg-[#f1f5f9] font-mono text-xs text-[#3e5068]">
                    {i + 1}
                  </span>
                  <span>
                    <strong className="block text-sm font-semibold text-[#111827]">
                      {title}
                    </strong>
                    <span className="mt-1 block text-sm leading-6 text-[#5b6472]">
                      {body}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="bg-[#101828] px-6 py-16 text-white md:py-20">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">
            AI assists. Licensed clinicians decide. Every clinical action
            produces evidence.
          </h2>
          <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-[#cbd5e1]">
            Compliance in Psyvium is engineered into identity, consent, tenancy,
            audit, AI governance, and crisis escalation rather than appended as
            marketing language.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded bg-white px-5 py-3 text-sm font-semibold text-[#111827] transition hover:bg-[#e5e7eb]"
            >
              View product demo <ArrowIcon />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded border border-white/30 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Back to overview
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
