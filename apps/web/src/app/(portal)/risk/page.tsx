'use client';

import { useEffect, useState } from 'react';
import { api, setToken, getToken, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useLiveRefresh } from '@/lib/live-events';
import { RealtimeEventType } from '@vpsy/contracts';
import type { RiskBoardDto, EscalationDto, RiskFlagDto, SafetyPlanDto, Severity } from '@/lib/risk-types';

/** Live event types that mean "this board's numbers may be stale — reload it." */
const RISK_BOARD_LIVE_EVENTS = [
  RealtimeEventType.RiskFlagRaised,
  RealtimeEventType.EscalationRaised,
  RealtimeEventType.EscalationAssigned,
  RealtimeEventType.EscalationResolved,
];
import { SkeletonStack } from '@/components/Skeleton';
import { ErrorPanel } from '@/components/ErrorPanel';
import { EmptyState } from '@/components/EmptyState';
import { StatTile } from '@/components/StatTile';
import { ContextPanel } from '@/components/ContextPanel';

const sevClass: Record<Severity, string> = {
  SEVERE: 'text-risk border-risk/40 bg-risk/10',
  HIGH: 'text-signal border-signal/40 bg-signal/10',
  MODERATE: 'text-signal-soft border-signal/25 bg-signal/5',
  LOW: 'text-teal-soft border-teal/20 bg-teal/5',
};

/** Decode the JWT `sub` (userId) for "assign to me" — demo only. */
function currentUserId(): string {
  try {
    const t = getToken();
    if (!t) return '';
    return JSON.parse(atob(t.split('.')[1]!)).sub ?? '';
  } catch {
    return '';
  }
}

export default function RiskPage() {
  const { t, fmtNumber } = useI18n();
  const [board, setBoard] = useState<RiskBoardDto | null>(null);
  const [live, setLive] = useState<'live' | 'offline' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLive('loading');
    setError(null);
    try {
      try {
        // Psychologist holds every risk permission (board, escalation-handle,
        // safety-plan authoring, break-glass) — so the demo board is fully usable.
        const tok = await api.login('dr.rivera@vpsy.health', 'Vpsy!2026');
        setToken(tok.accessToken);
      } catch { /* may already be signed in */ }
      setBoard(await api.riskBoard());
      setLive('live');
    } catch (e) {
      setError(e instanceof ApiError ? t('risk.errStatus', { status: e.status }) : t('risk.errNetwork'));
      setBoard({ escalations: [], openFlags: [] });
      setLive('offline');
    }
  }
  useEffect(() => { load(); }, []);
  // Live push (SP3): reload the board the moment a risk flag/escalation
  // changes anywhere in the tenant — no polling, no manual refresh.
  useLiveRefresh(RISK_BOARD_LIVE_EVENTS, load);

  if (!board) return <SkeletonStack count={4} className="mt-6 space-y-3" />;

  const severe =
    board.escalations.filter((e) => e.severity === 'SEVERE').length +
    board.openFlags.filter((f) => f.severity === 'SEVERE').length;
  const slaBreached = board.escalations.filter((e) => e.slaBreached).length;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t('risk.eyebrow')}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('risk.title')}</h1>
        </div>
        <span role="status" className={`chip ${live === 'offline' ? 'chip-signal' : ''}`}>
          {live === 'live' ? t('common.liveData') : live === 'offline' ? t('common.offlineDemo') : t('common.loadingLive')}
        </span>
      </div>
      <p className="mt-3 max-w-3xl text-mist/60">{t('risk.intro')}</p>
      {error && <ErrorPanel className="mt-5 max-w-md" message={error} onRetry={load} />}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <section>
            <p className="eyebrow mb-3">{t('risk.escalationsEyebrow')}</p>
            <div className="space-y-3">
              {board.escalations.length === 0 && <EmptyState body={t('risk.noEscalations')} />}
              {board.escalations.map((e) => <EscalationCard key={e.id} esc={e} onChanged={load} />)}
            </div>
          </section>
          <section>
            <p className="eyebrow mb-3">{t('risk.flagsEyebrow')}</p>
            <div className="space-y-3">
              {board.openFlags.length === 0 && <EmptyState body={t('risk.noFlags')} />}
              {board.openFlags.map((f) => <FlagCard key={f.id} flag={f} onChanged={load} />)}
            </div>
          </section>
        </div>
        <aside className="space-y-6">
          <SafetyPlanPanel />
          <BreakGlassPanel />
        </aside>
      </div>

      {/* ── Context panel: live board summary from the fetched board ── */}
      <ContextPanel>
        <section className="card p-4">
          <p className="eyebrow">{t('risk.summaryEyebrow')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <StatTile label={t('risk.openEscalationsStat')} value={fmtNumber(board.escalations.length)} />
            <StatTile label={t('risk.openFlagsStat')} value={fmtNumber(board.openFlags.length)} />
            <StatTile label={t('risk.severeStat')} value={fmtNumber(severe)} />
            <StatTile label={t('risk.slaBreachedStat')} value={fmtNumber(slaBreached)} />
          </div>
        </section>
      </ContextPanel>
    </div>
  );
}

function SevChip({ s }: { s: Severity }) {
  const { dict } = useI18n();
  return <span className={`chip border ${sevClass[s]}`}>{dict.risk.severity[s]}</span>;
}

function EscalationCard({ esc, onChanged }: { esc: EscalationDto; onChanged: () => void }) {
  const { t, dict, fmtDate } = useI18n();
  const [busy, setBusy] = useState<'assign' | 'resolve' | null>(null);
  const [resolution, setResolution] = useState('');
  const [showResolve, setShowResolve] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function assign() {
    setBusy('assign'); setErr(null);
    try { await api.riskAssignEscalation(esc.id, currentUserId()); onChanged(); }
    catch { setErr(t('risk.actionFailed')); } finally { setBusy(null); }
  }
  async function resolve() {
    if (!resolution.trim()) return;
    setBusy('resolve'); setErr(null);
    try { await api.riskResolveEscalation(esc.id, resolution.trim()); onChanged(); }
    catch { setErr(t('risk.actionFailed')); } finally { setBusy(null); }
  }

  return (
    <article className={`card border-l-2 p-4 ${esc.severity === 'SEVERE' ? 'border-l-risk' : esc.severity === 'HIGH' ? 'border-l-signal' : 'border-l-line/25'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-mist">{esc.clientName || '—'}</p>
          <p className="mt-0.5 text-sm text-mist/70">{dict.risk.types[esc.riskType as keyof typeof dict.risk.types] ?? esc.riskType}</p>
        </div>
        <SevChip s={esc.severity} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-mist/40">
        <span>{t('risk.opened', { date: fmtDate(esc.openedAt) })}</span>
        <span>{esc.assignedTo ? `${t('risk.assignedTo')}: …${esc.assignedTo.slice(-6)}` : t('risk.unassigned')}</span>
        {esc.slaBreached && <span className="text-risk">{t('risk.slaBreached')}</span>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {!esc.assignedTo && (
          <button onClick={assign} disabled={busy !== null} className="btn-ghost px-3 py-2 text-xs disabled:opacity-60">
            {busy === 'assign' ? t('risk.assigning') : t('risk.assignSelf')}
          </button>
        )}
        {!showResolve && (
          <button onClick={() => setShowResolve(true)} className="btn-primary px-3 py-2 text-xs">{t('risk.resolve')}</button>
        )}
      </div>
      {showResolve && (
        <div className="mt-3">
          <p className="text-[11px] text-mist/45">{t('risk.resolveHint')}</p>
          <textarea className="field mt-1.5 min-h-[64px] text-sm" placeholder={t('risk.resolvePlaceholder')} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          <button onClick={resolve} disabled={busy !== null || !resolution.trim()} className="btn-primary mt-2 px-3 py-2 text-xs disabled:opacity-60">
            {busy === 'resolve' ? t('risk.resolving') : t('risk.resolve')}
          </button>
        </div>
      )}
      {err && <p role="alert" className="mt-2 text-xs text-risk">{err}</p>}
    </article>
  );
}

function FlagCard({ flag, onChanged }: { flag: RiskFlagDto; onChanged: () => void }) {
  const { t, dict } = useI18n();
  const [busy, setBusy] = useState(false);
  async function ack() {
    setBusy(true);
    try { await api.riskAcknowledgeFlag(flag.id); onChanged(); } catch { /* noop */ } finally { setBusy(false); }
  }
  return (
    <article className="card-inset flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-medium text-mist">{flag.clientName || '—'}</p>
          <SevChip s={flag.severity} />
        </div>
        <p className="mt-1 text-sm text-mist/70">{dict.risk.types[flag.type as keyof typeof dict.risk.types] ?? flag.type}</p>
        <p className="mt-0.5 text-[11px] text-mist/40">
          {dict.risk.source[flag.source as keyof typeof dict.risk.source] ?? flag.source}
          {flag.evidence ? ` · ${flag.evidence}` : ''}
        </p>
      </div>
      <button onClick={ack} disabled={busy} className="btn-ghost shrink-0 px-3 py-2 text-xs disabled:opacity-60">
        {busy ? t('risk.acknowledging') : t('risk.acknowledge')}
      </button>
    </article>
  );
}

function StringList({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      <label className="field-label">{label}</label>
      <ul className="mb-2 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-center justify-between gap-2 rounded-sm bg-console-700/50 px-3 py-1.5 text-sm text-mist/80">
            <span className="min-w-0 truncate">{it}</span>
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="shrink-0 text-mist/40 hover:text-risk" aria-label="remove">×</button>
          </li>
        ))}
      </ul>
      <input
        className="field text-sm"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) { e.preventDefault(); onChange([...items, draft.trim()]); setDraft(''); }
        }}
      />
    </div>
  );
}

function SafetyPlanPanel() {
  const { t } = useI18n();
  const [clientId, setClientId] = useState('');
  const [plan, setPlan] = useState<SafetyPlanDto | null>(null);
  const [form, setForm] = useState({ warningSigns: [] as string[], copingStrategies: [] as string[], supportContacts: [] as string[], professionalContacts: [] as string[], environmentSafety: '' });
  const [busy, setBusy] = useState<'load' | 'save' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadPlan() {
    if (!clientId.trim()) return;
    setBusy('load'); setMsg(null);
    try {
      const p = await api.riskSafetyPlan(clientId.trim());
      setPlan(p);
      if (p) setForm({ warningSigns: p.warningSigns, copingStrategies: p.copingStrategies, supportContacts: p.supportContacts, professionalContacts: p.professionalContacts, environmentSafety: p.environmentSafety ?? '' });
    } catch { setMsg(t('risk.actionFailed')); } finally { setBusy(null); }
  }
  async function save() {
    if (!clientId.trim()) return;
    setBusy('save'); setMsg(null);
    try {
      const p = await api.riskCreateSafetyPlan({ clientId: clientId.trim(), ...form, environmentSafety: form.environmentSafety || undefined });
      setPlan(p);
      setMsg(t('risk.planSaved'));
    } catch { setMsg(t('risk.planFailed')); } finally { setBusy(null); }
  }

  return (
    <div className="card p-5">
      <p className="eyebrow">{t('risk.safetyEyebrow')}</p>
      <p className="mt-2 text-xs text-mist/50">{t('risk.safetyIntro')}</p>
      <label className="field-label mt-4">{t('risk.clientIdLabel')}</label>
      <div className="flex gap-2">
        <input className="field text-sm" dir="ltr" placeholder={t('risk.clientIdPlaceholder')} value={clientId} onChange={(e) => setClientId(e.target.value)} />
        <button onClick={loadPlan} disabled={busy !== null || !clientId.trim()} className="btn-ghost shrink-0 px-3 text-sm disabled:opacity-60">
          {busy === 'load' ? '…' : t('risk.loadPlan')}
        </button>
      </div>
      {plan && <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-teal-soft/70">{t('risk.planVersion', { n: plan.version })}</p>}
      {!plan && clientId && busy === null && <p className="mt-2 text-xs text-mist/40">{t('risk.noSafetyPlan')}</p>}

      <div className="mt-4 space-y-4">
        <StringList label={t('risk.warningSigns')} items={form.warningSigns} onChange={(v) => setForm((f) => ({ ...f, warningSigns: v }))} placeholder={t('risk.itemPlaceholder')} />
        <StringList label={t('risk.copingStrategies')} items={form.copingStrategies} onChange={(v) => setForm((f) => ({ ...f, copingStrategies: v }))} placeholder={t('risk.itemPlaceholder')} />
        <StringList label={t('risk.supportContacts')} items={form.supportContacts} onChange={(v) => setForm((f) => ({ ...f, supportContacts: v }))} placeholder={t('risk.itemPlaceholder')} />
        <StringList label={t('risk.professionalContacts')} items={form.professionalContacts} onChange={(v) => setForm((f) => ({ ...f, professionalContacts: v }))} placeholder={t('risk.itemPlaceholder')} />
        <div>
          <label className="field-label">{t('risk.environmentSafety')}</label>
          <input className="field text-sm" placeholder={t('risk.envPlaceholder')} value={form.environmentSafety} onChange={(e) => setForm((f) => ({ ...f, environmentSafety: e.target.value }))} />
        </div>
      </div>
      <button onClick={save} disabled={busy !== null || !clientId.trim()} className="btn-primary mt-4 w-full disabled:opacity-60">
        {busy === 'save' ? t('risk.savingPlan') : t('risk.savePlan')}
      </button>
      {msg && <p role="status" className="mt-3 text-sm text-mist/60">{msg}</p>}
    </div>
  );
}

function BreakGlassPanel() {
  const { t, fmtTime } = useI18n();
  const [clientId, setClientId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function invoke() {
    if (!clientId.trim() || !reason.trim()) { setMsg({ text: t('risk.breakGlassFailed'), ok: false }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await api.riskBreakGlass(clientId.trim(), reason.trim());
      setMsg({ text: t('risk.breakGlassGranted', { time: fmtTime(r.expiresAt) }), ok: true });
      setReason('');
    } catch { setMsg({ text: t('risk.breakGlassFailed'), ok: false }); } finally { setBusy(false); }
  }

  return (
    <div className="card border border-signal/20 p-5">
      <p className="eyebrow text-signal-soft/80">{t('risk.breakGlassEyebrow')}</p>
      <p className="mt-2 text-xs text-mist/55">{t('risk.breakGlassIntro')}</p>
      <label className="field-label mt-4">{t('risk.clientIdLabel')}</label>
      <input className="field text-sm" dir="ltr" placeholder={t('risk.clientIdPlaceholder')} value={clientId} onChange={(e) => setClientId(e.target.value)} />
      <label className="field-label mt-3">{t('risk.breakGlassReason')}</label>
      <textarea className="field min-h-[64px] text-sm" placeholder={t('risk.breakGlassReasonPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button onClick={invoke} disabled={busy} className="mt-3 inline-flex w-full items-center justify-center rounded border border-signal/50 bg-signal/10 px-5 py-3 font-medium text-signal transition hover:bg-signal/20 disabled:opacity-60">
        {busy ? t('risk.invoking') : t('risk.invokeBreakGlass')}
      </button>
      {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-signal-soft' : 'text-risk'}`}>{msg.text}</p>}
    </div>
  );
}
