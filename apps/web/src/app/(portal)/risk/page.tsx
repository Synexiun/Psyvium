'use client';

import { useEffect, useState } from 'react';
import { api, setToken, getToken, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useLiveRefresh } from '@/lib/live-events';
import { RealtimeEventType } from '@vpsy/contracts';
import type {
  RiskBoardDto,
  EscalationDto,
  RiskFlagDto,
  SafetyPlanDto,
  Severity,
  MeansRestrictionItem,
} from '@/lib/risk-types';

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

/** Ordered severity options for the resolution risk-level select. */
const SEVERITY_OPTIONS: Severity[] = ['LOW', 'MODERATE', 'HIGH', 'SEVERE'];

/** Mirror of the contract's superRefine: these levels REQUIRE a follow-up date. */
function requiresFollowUp(level: Severity | ''): boolean {
  return level === 'HIGH' || level === 'SEVERE';
}

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

/**
 * A per-minute "now" tick so SLA countdowns stay honest without re-rendering
 * per second (minute granularity — the SLA targets are minutes/hours; no fake
 * second-level precision).
 */
function useNowMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Locale-aware relative time at honest granularity: minutes under 90 min,
 * hours under 48 h, days beyond — the largest sensible unit, never seconds.
 */
function relativeTo(locale: string, targetIso: string, nowMs: number): string {
  const diffMs = new Date(targetIso).getTime() - nowMs;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'narrow' });
  const absMs = Math.abs(diffMs);
  if (absMs < 90 * 60_000) return rtf.format(Math.round(diffMs / 60_000), 'minute');
  if (absMs < 48 * 3_600_000) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
  return rtf.format(Math.round(diffMs / 86_400_000), 'day');
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

  // Open escalations vs resolved ones awaiting their caring-contact follow-up
  // (Zero Suicide). The board may carry both; the split keeps each lane honest.
  const openEscalations = board.escalations.filter((e) => !e.resolvedAt);
  const followUps = board.escalations.filter((e) => e.resolvedAt && e.followUpDueAt);

  const severe =
    openEscalations.filter((e) => e.severity === 'SEVERE').length +
    board.openFlags.filter((f) => f.severity === 'SEVERE').length;
  const slaBreached = openEscalations.filter((e) => e.slaBreached).length;

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
              {openEscalations.length === 0 && <EmptyState body={t('risk.noEscalations')} />}
              {openEscalations.map((e) => <EscalationCard key={e.id} esc={e} onChanged={load} />)}
            </div>
          </section>
          <section>
            <p className="eyebrow mb-3">{t('risk.followUpsEyebrow')}</p>
            <div className="space-y-3">
              {followUps.length === 0 && <EmptyState body={t('risk.noFollowUps')} />}
              {followUps.map((e) => <FollowUpCard key={e.id} esc={e} onChanged={load} />)}
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
            <StatTile label={t('risk.openEscalationsStat')} value={fmtNumber(openEscalations.length)} />
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

/**
 * SLA response-target line. Breached (flag from the record, or the target
 * time already passed) uses the reserved risk accent; the countdown itself is
 * mono, minute-granular, and locale-relative — no fake second precision.
 */
function SlaLine({ esc }: { esc: EscalationDto }) {
  const { t, locale } = useI18n();
  const now = useNowMinute();
  if (!esc.slaDueAt) return null;
  const breached = esc.slaBreached || new Date(esc.slaDueAt).getTime() <= now;
  const rel = relativeTo(locale, esc.slaDueAt, now);
  if (breached) {
    return (
      <span className="text-risk">
        {t('risk.slaBreached')} · <span className="figure" dir="ltr">{rel}</span>
      </span>
    );
  }
  return (
    <span>
      {t('risk.slaDueLabel')} <span className="figure text-mist/70" dir="ltr">{rel}</span>
    </span>
  );
}

function EscalationCard({ esc, onChanged }: { esc: EscalationDto; onChanged: () => void }) {
  const { t, dict, fmtDate } = useI18n();
  const [busy, setBusy] = useState<'assign' | 'resolve' | null>(null);
  const [showResolve, setShowResolve] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Structured resolution (SAFE-T / NPSG 15.01.01) — mirrors the contract:
  // riskLevelAtResolution is a required clinical judgment (never pre-filled),
  // interventionsApplied documents what was done, and followUpDueAt is
  // REQUIRED when the resolution-time level is HIGH/SEVERE (Zero Suicide).
  const [resolution, setResolution] = useState('');
  const [riskLevel, setRiskLevel] = useState<Severity | ''>('');
  const [interventions, setInterventions] = useState<string[]>([]);
  const [followUpDueAt, setFollowUpDueAt] = useState('');

  const followUpNeeded = requiresFollowUp(riskLevel);
  const canResolve =
    resolution.trim().length >= 5 && riskLevel !== '' && (!followUpNeeded || !!followUpDueAt);

  async function assign() {
    setBusy('assign'); setErr(null);
    try { await api.riskAssignEscalation(esc.id, currentUserId()); onChanged(); }
    catch { setErr(t('risk.actionFailed')); } finally { setBusy(null); }
  }
  async function resolve() {
    // `canResolve` already narrows riskLevel to a concrete Severity.
    if (!canResolve) return;
    setBusy('resolve'); setErr(null);
    try {
      await api.riskResolveEscalation(esc.id, {
        resolution: resolution.trim(),
        riskLevelAtResolution: riskLevel,
        interventionsApplied: interventions,
        ...(followUpDueAt ? { followUpDueAt: new Date(followUpDueAt).toISOString() } : {}),
      });
      onChanged();
    } catch { setErr(t('risk.actionFailed')); } finally { setBusy(null); }
  }

  return (
    <article className={`card border-s-2 p-4 ${esc.severity === 'SEVERE' ? 'border-s-risk' : esc.severity === 'HIGH' ? 'border-s-signal' : 'border-s-line/25'}`}>
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
        <SlaLine esc={esc} />
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
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-[11px] text-mist/45">{t('risk.resolveHint')}</p>
            <textarea className="field mt-1.5 min-h-[64px] text-sm" placeholder={t('risk.resolvePlaceholder')} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor={`risk-level-${esc.id}`}>{t('risk.riskLevelAtResolution')}</label>
            <select
              id={`risk-level-${esc.id}`}
              className="field text-sm"
              value={riskLevel}
              onChange={(e) => setRiskLevel(e.target.value as Severity | '')}
            >
              <option value="">{t('risk.selectRiskLevel')}</option>
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>{dict.risk.severity[s]}</option>
              ))}
            </select>
          </div>
          <StringList
            label={t('risk.interventionsApplied')}
            items={interventions}
            onChange={setInterventions}
            placeholder={t('risk.interventionPlaceholder')}
          />
          <div>
            <label className="field-label" htmlFor={`follow-up-${esc.id}`}>{t('risk.followUpDueAtLabel')}</label>
            <input
              id={`follow-up-${esc.id}`}
              type="datetime-local"
              dir="ltr"
              className="field text-sm"
              value={followUpDueAt}
              required={followUpNeeded}
              aria-required={followUpNeeded}
              onChange={(e) => setFollowUpDueAt(e.target.value)}
            />
            {followUpNeeded && !followUpDueAt && (
              <p className="mt-1 text-[11px] text-signal-soft">{t('risk.followUpRequiredHint')}</p>
            )}
          </div>
          <button onClick={resolve} disabled={busy !== null || !canResolve} className="btn-primary px-3 py-2 text-xs disabled:opacity-60">
            {busy === 'resolve' ? t('risk.resolving') : t('risk.resolve')}
          </button>
        </div>
      )}
      {err && <p role="alert" className="mt-2 text-xs text-risk">{err}</p>}
    </article>
  );
}

/**
 * A resolved escalation whose Zero Suicide caring-contact follow-up is
 * scheduled: shows due/completed honestly and lets a human record the
 * contact via PATCH /risk/escalations/:id/follow-up.
 */
function FollowUpCard({ esc, onChanged }: { esc: EscalationDto; onChanged: () => void }) {
  const { t, dict, fmtDate, fmtTime } = useI18n();
  const now = useNowMinute();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const overdue =
    !esc.followUpCompletedAt && !!esc.followUpDueAt && new Date(esc.followUpDueAt).getTime() <= now;

  async function record() {
    setBusy(true); setErr(null);
    try {
      await api.riskCompleteFollowUp(esc.id, notes.trim() ? { notes: notes.trim() } : {});
      onChanged();
    } catch { setErr(t('risk.actionFailed')); } finally { setBusy(false); }
  }

  return (
    <article className={`card-inset border-s-2 p-4 ${overdue ? 'border-s-risk' : 'border-s-line/25'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-mist">{esc.clientName || '—'}</p>
          <p className="mt-0.5 text-sm text-mist/70">{dict.risk.types[esc.riskType as keyof typeof dict.risk.types] ?? esc.riskType}</p>
        </div>
        {esc.riskLevelAtResolution && <SevChip s={esc.riskLevelAtResolution} />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-mist/40">
        {esc.resolvedAt && <span>{t('risk.resolvedOn', { date: fmtDate(esc.resolvedAt) })}</span>}
        {esc.followUpDueAt && (
          <span className={overdue ? 'text-risk' : undefined}>
            {t('risk.followUpDue', { date: `${fmtDate(esc.followUpDueAt)} · ${fmtTime(esc.followUpDueAt)}` })}
            {overdue && ` — ${t('risk.followUpOverdue')}`}
          </span>
        )}
        {esc.followUpCompletedAt && (
          <span className="text-teal-soft">{t('risk.followUpCompletedOn', { date: fmtDate(esc.followUpCompletedAt) })}</span>
        )}
      </div>
      {esc.interventionsApplied.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {esc.interventionsApplied.map((iv, i) => (
            <span key={i} className="chip border border-line/20 text-[11px] text-mist/60">{iv}</span>
          ))}
        </div>
      )}
      {!esc.followUpCompletedAt && (
        <div className="mt-3">
          <input
            className="field text-sm"
            placeholder={t('risk.followUpNotesPlaceholder')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button onClick={record} disabled={busy} className="btn-primary mt-2 px-3 py-2 text-xs disabled:opacity-60">
            {busy ? t('risk.recordingFollowUp') : t('risk.recordFollowUp')}
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

/** Structured means-restriction inventory editor (Stanley-Brown SPI step 6). */
function MeansRestrictionList({
  label,
  items,
  onChange,
  placeholder,
  securedLabel,
  howPlaceholder,
}: {
  label: string;
  items: MeansRestrictionItem[];
  onChange: (v: MeansRestrictionItem[]) => void;
  placeholder: string;
  securedLabel: string;
  howPlaceholder: string;
}) {
  const [draft, setDraft] = useState('');
  const update = (i: number, patch: Partial<MeansRestrictionItem>) =>
    onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  return (
    <div>
      <label className="field-label">{label}</label>
      <ul className="mb-2 space-y-2">
        {items.map((it, i) => (
          <li key={i} className="rounded-sm bg-console-700/50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm text-mist/80">{it.means}</span>
              <div className="flex shrink-0 items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-mist/60">
                  <input
                    type="checkbox"
                    checked={it.secured}
                    onChange={(e) => update(i, { secured: e.target.checked })}
                  />
                  {securedLabel}
                </label>
                <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-mist/40 hover:text-risk" aria-label="remove">×</button>
              </div>
            </div>
            <input
              className="field mt-1.5 text-xs"
              placeholder={howPlaceholder}
              value={it.how ?? ''}
              onChange={(e) => update(i, { how: e.target.value || undefined })}
            />
          </li>
        ))}
      </ul>
      <input
        className="field text-sm"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            e.preventDefault();
            onChange([...items, { means: draft.trim(), secured: false }]);
            setDraft('');
          }
        }}
      />
    </div>
  );
}

const EMPTY_PLAN_FORM = {
  warningSigns: [] as string[],
  copingStrategies: [] as string[],
  supportContacts: [] as string[],
  professionalContacts: [] as string[],
  environmentSafety: '',
  distractionContacts: [] as string[],
  helpContacts: [] as string[],
  crisisLabel: '',
  crisisPhone: '',
  crisisText: '',
  crisisChat: '',
  meansRestriction: [] as MeansRestrictionItem[],
  clientAcknowledged: false,
};

function SafetyPlanPanel() {
  const { t } = useI18n();
  const [clientId, setClientId] = useState('');
  const [plan, setPlan] = useState<SafetyPlanDto | null>(null);
  const [form, setForm] = useState({ ...EMPTY_PLAN_FORM });
  const [busy, setBusy] = useState<'load' | 'save' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadPlan() {
    if (!clientId.trim()) return;
    setBusy('load'); setMsg(null);
    try {
      const p = await api.riskSafetyPlan(clientId.trim());
      setPlan(p);
      if (p) {
        setForm({
          warningSigns: p.warningSigns,
          copingStrategies: p.copingStrategies,
          supportContacts: p.supportContacts,
          professionalContacts: p.professionalContacts,
          environmentSafety: p.environmentSafety ?? '',
          distractionContacts: p.distractionContacts ?? [],
          helpContacts: p.helpContacts ?? [],
          crisisLabel: p.crisisLineInfo?.label ?? '',
          crisisPhone: p.crisisLineInfo?.phone ?? '',
          crisisText: p.crisisLineInfo?.text ?? '',
          crisisChat: p.crisisLineInfo?.chatUrl ?? '',
          meansRestriction: p.meansRestriction ?? [],
          // A new version is a fresh collaborative artifact: acknowledgment is
          // attested per save, never carried forward from a prior version.
          clientAcknowledged: false,
        });
      }
    } catch { setMsg(t('risk.actionFailed')); } finally { setBusy(null); }
  }
  async function save() {
    if (!clientId.trim()) return;
    setBusy('save'); setMsg(null);
    try {
      const hasCrisisLine = !!(form.crisisLabel || form.crisisPhone || form.crisisText || form.crisisChat);
      const p = await api.riskCreateSafetyPlan({
        clientId: clientId.trim(),
        warningSigns: form.warningSigns,
        copingStrategies: form.copingStrategies,
        supportContacts: form.supportContacts,
        professionalContacts: form.professionalContacts,
        environmentSafety: form.environmentSafety || undefined,
        // Stanley-Brown SPI fields — all optional/additive (back-compat).
        ...(form.distractionContacts.length > 0 ? { distractionContacts: form.distractionContacts } : {}),
        ...(form.helpContacts.length > 0 ? { helpContacts: form.helpContacts } : {}),
        ...(hasCrisisLine
          ? {
              crisisLineInfo: {
                ...(form.crisisLabel ? { label: form.crisisLabel } : {}),
                ...(form.crisisPhone ? { phone: form.crisisPhone } : {}),
                ...(form.crisisText ? { text: form.crisisText } : {}),
                ...(form.crisisChat ? { chatUrl: form.crisisChat } : {}),
              },
            }
          : {}),
        ...(form.meansRestriction.length > 0 ? { meansRestriction: form.meansRestriction } : {}),
        ...(form.clientAcknowledged ? { clientAcknowledgedAt: new Date().toISOString() } : {}),
      });
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
        <StringList label={t('risk.distractionContacts')} items={form.distractionContacts} onChange={(v) => setForm((f) => ({ ...f, distractionContacts: v }))} placeholder={t('risk.itemPlaceholder')} />
        <StringList label={t('risk.helpContacts')} items={form.helpContacts} onChange={(v) => setForm((f) => ({ ...f, helpContacts: v }))} placeholder={t('risk.itemPlaceholder')} />
        <StringList label={t('risk.supportContacts')} items={form.supportContacts} onChange={(v) => setForm((f) => ({ ...f, supportContacts: v }))} placeholder={t('risk.itemPlaceholder')} />
        <StringList label={t('risk.professionalContacts')} items={form.professionalContacts} onChange={(v) => setForm((f) => ({ ...f, professionalContacts: v }))} placeholder={t('risk.itemPlaceholder')} />
        <div>
          <label className="field-label">{t('risk.crisisLineLabelField')}</label>
          <input className="field text-sm" placeholder={t('risk.crisisLineLabelPlaceholder')} value={form.crisisLabel} onChange={(e) => setForm((f) => ({ ...f, crisisLabel: e.target.value }))} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className="field-label">{t('risk.crisisLinePhoneField')}</label>
              <input className="field text-sm" dir="ltr" value={form.crisisPhone} onChange={(e) => setForm((f) => ({ ...f, crisisPhone: e.target.value }))} />
            </div>
            <div>
              <label className="field-label">{t('risk.crisisLineTextField')}</label>
              <input className="field text-sm" dir="ltr" value={form.crisisText} onChange={(e) => setForm((f) => ({ ...f, crisisText: e.target.value }))} />
            </div>
          </div>
          <label className="field-label mt-2">{t('risk.crisisLineChatField')}</label>
          <input className="field text-sm" dir="ltr" value={form.crisisChat} onChange={(e) => setForm((f) => ({ ...f, crisisChat: e.target.value }))} />
          <p className="mt-1 text-[11px] text-mist/40">{t('risk.crisisLineDefaultNote')}</p>
        </div>
        <MeansRestrictionList
          label={t('risk.meansRestriction')}
          items={form.meansRestriction}
          onChange={(v) => setForm((f) => ({ ...f, meansRestriction: v }))}
          placeholder={t('risk.meansPlaceholder')}
          securedLabel={t('risk.meansSecured')}
          howPlaceholder={t('risk.meansHowPlaceholder')}
        />
        <div>
          <label className="field-label">{t('risk.environmentSafety')}</label>
          <input className="field text-sm" placeholder={t('risk.envPlaceholder')} value={form.environmentSafety} onChange={(e) => setForm((f) => ({ ...f, environmentSafety: e.target.value }))} />
        </div>
        <label className="flex items-start gap-2 text-xs text-mist/60">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.clientAcknowledged}
            onChange={(e) => setForm((f) => ({ ...f, clientAcknowledged: e.target.checked }))}
          />
          {t('risk.clientAcknowledged')}
        </label>
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
