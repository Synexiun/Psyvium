'use client';

import { useEffect, useState } from 'react';
import { api, setToken, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { SkeletonStack } from '@/components/Skeleton';
import { ErrorPanel } from '@/components/ErrorPanel';
import { DataTable, type DataColumn } from '@/components/DataTable';
import type { ExecutiveReportDto, ManagerReportDto, NationalAnalyticsDto, NationalMetricDto } from '@/lib/analytics-types';

function money(amount: string, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount)); }
  catch { return `${amount} ${currency}`; }
}
function humanize(metric: string): string {
  return metric.replace(/_/g, ' ').replace(/\bpct\b/i, '%').replace(/^\w/, (c) => c.toUpperCase());
}

export default function ReportsPage() {
  const { t } = useI18n();
  const [exec, setExec] = useState<ExecutiveReportDto | null>(null);
  const [mgr, setMgr] = useState<ManagerReportDto | null>(null);
  const [nat, setNat] = useState<NationalAnalyticsDto | null>(null);
  const [live, setLive] = useState<'live' | 'offline' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLive('loading'); setError(null);
    try {
      try {
        // Executive holds reports:read + national:read.
        const tok = await api.login('exec@vpsy.health', 'Vpsy!2026');
        setToken(tok.accessToken);
      } catch { /* may already be signed in */ }
      const [e, m, n] = await Promise.all([
        api.reportExecutive().catch(() => null),
        api.reportManager().catch(() => null),
        api.nationalAnalytics().catch(() => null),
      ]);
      setExec(e); setMgr(m); setNat(n);
      setLive(e || m || n ? 'live' : 'offline');
      if (!e && !m && !n) setError(t('analytics.errNetwork'));
    } catch (err) {
      setError(err instanceof ApiError ? t('analytics.errStatus', { status: err.status }) : t('analytics.errNetwork'));
      setLive('offline');
    }
  }
  useEffect(() => { load(); }, []);

  if (live === 'loading') return <SkeletonStack count={3} className="mt-8" />;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t('analytics.eyebrow')}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('analytics.title')}</h1>
        </div>
        <span role="status" className={`chip ${live === 'live' ? 'text-teal-soft/80' : 'chip-signal'}`}>
          {live === 'live' ? t('common.liveData') : t('common.offlineDemo')}
        </span>
      </div>
      <p className="mt-3 max-w-3xl text-mist/60">{t('analytics.intro')}</p>
      {error && <ErrorPanel className="mt-5 max-w-md" message={error} onRetry={load} />}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {exec && <ExecutivePanel r={exec} />}
        {mgr && <ManagerPanel r={mgr} />}
      </div>
      {nat && <NationalPanel r={nat} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-inset p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{label}</p>
      <p className="figure mt-1 text-lg font-medium text-mist" dir="ltr">{value}</p>
    </div>
  );
}

function ExecutivePanel({ r }: { r: ExecutiveReportDto }) {
  const { t, fmtDate, fmtNumber } = useI18n();
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <p className="eyebrow">{t('analytics.execEyebrow')}</p>
        <span className="font-mono text-[10px] text-mist/40">{t('analytics.generatedAt', { date: fmtDate(r.generatedAt) })}</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label={t('analytics.collected')} value={money(r.revenue.paidTotal, r.currency)} />
        <Stat label={t('analytics.outstanding')} value={money(r.revenue.outstanding, r.currency)} />
        <Stat label={t('analytics.payoutsPending')} value={money(r.revenue.payoutsPending, r.currency)} />
        <Stat label={t('analytics.clients')} value={fmtNumber(r.clients.total)} />
        <Stat label={t('analytics.clinicians')} value={fmtNumber(r.clinicians.count)} />
        <Stat label={t('analytics.avgOutcomeIndex')} value={fmtNumber(r.clinicians.avgOutcomeIndex)} />
        <Stat label={t('analytics.outcomeMeasures')} value={fmtNumber(r.outcomes.measureCount)} />
        <Stat label={t('analytics.avgOutcomeValue')} value={r.outcomes.avgValue == null ? '—' : fmtNumber(r.outcomes.avgValue)} />
        <Stat label={t('analytics.activeClients')} value={fmtNumber(r.clients.active)} />
      </div>
    </section>
  );
}

function ManagerPanel({ r }: { r: ManagerReportDto }) {
  const { t, dict, fmtNumber } = useI18n();
  const sev = r.intakes.bySeverity;
  const max = Math.max(1, sev.LOW, sev.MODERATE, sev.HIGH, sev.SEVERE);
  const bars: { k: keyof typeof sev; cls: string }[] = [
    { k: 'LOW', cls: 'bg-teal/50' }, { k: 'MODERATE', cls: 'bg-signal-soft/60' }, { k: 'HIGH', cls: 'bg-signal/70' }, { k: 'SEVERE', cls: 'bg-risk/70' },
  ];
  return (
    <section className="card p-5">
      <p className="eyebrow">{t('analytics.mgrEyebrow')}</p>
      <p className="mt-4 field-label">{t('analytics.intakeSeverity')} ({fmtNumber(r.intakes.total)})</p>
      <div className="mt-2 space-y-1.5">
        {bars.map(({ k, cls }) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-20 shrink-0 text-xs text-mist/60">{dict.risk.severity[k]}</span>
            <div className="h-2 flex-1 rounded-full bg-console-950">
              <div className={`h-2 rounded-full ${cls}`} style={{ width: `${(sev[k] / max) * 100}%` }} />
            </div>
            <span className="w-6 shrink-0 text-end font-mono text-xs text-mist/60 tabular-nums">{sev[k]}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label={t('analytics.approved')} value={fmtNumber(r.assignments.approved)} />
        <Stat label={t('analytics.openEscalations')} value={fmtNumber(r.risk.openEscalations)} />
        <Stat label={t('analytics.openFlags')} value={fmtNumber(r.risk.openFlags)} />
        <Stat label={t('analytics.upcoming')} value={fmtNumber(r.appointments.upcoming)} />
        <Stat label={t('analytics.noShows')} value={fmtNumber(r.appointments.noShows)} />
        <Stat label={t('analytics.proposed')} value={fmtNumber(r.assignments.proposed)} />
      </div>
    </section>
  );
}

function NationalPanel({ r }: { r: NationalAnalyticsDto }) {
  const { t, fmtNumber } = useI18n();
  const columns: DataColumn<NationalMetricDto>[] = [
    { id: 'region', header: t('analytics.region'), cell: (m) => <span className="font-mono text-xs text-mist/70">{m.region}</span> },
    { id: 'metric', header: t('analytics.metric'), cell: (m) => humanize(m.metric) },
    { id: 'value', header: t('analytics.value'), numeric: true, cell: (m) => m.suppressed ? <span className="chip-signal" title={t('analytics.suppressedNote')}>{t('analytics.suppressed')}</span> : <span>{m.value == null ? '—' : fmtNumber(m.value)}{m.unit ? ` ${m.unit}` : ''}</span> },
    { id: 'cohort', header: t('analytics.cohort'), numeric: true, cell: (m) => m.suppressed ? `< ${r.kAnonymityFloor}` : fmtNumber(m.cohortSize) },
  ];
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">{t('analytics.natEyebrow')}</p>
        <span className="chip text-teal-soft/70">{t('analytics.kFloor', { n: r.kAnonymityFloor })}</span>
      </div>
      <p className="mt-2 max-w-3xl text-xs text-mist/50">{t('analytics.natIntro')}</p>
      <DataTable className="mt-3" columns={columns} rows={r.metrics} rowKey={(m, i) => String(i)} empty={t('analytics.noMetrics')} />
    </section>
  );
}
