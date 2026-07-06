'use client';

/**
 * Clinician Session Workspace — the center of the system.
 *
 * Wired entirely to the live clinical read model: signs in as the demo
 * psychologist (if no usable token), loads GET /clinicians/me/caseload,
 * picks the first client, and renders GET /clients/:id/clinical-summary —
 * real timeline (recent notes + outcome measures), active plan with goal
 * progress, the latest assessment, and the wearable rollup. "File note"
 * POSTs a structured note against the client's session and "Sign" locks it
 * via the API. There is no fallback-to-fake path: the workspace renders
 * loading / error / live (which may itself be empty — e.g. no clients yet).
 *
 * The AI case-formulation panel has no live endpoint yet (that ships in a
 * later sub-project) — it renders an honest "pending clinician review"
 * placeholder rather than fabricated model output.
 *
 * Command Center flagship: the client identity + latest assessment + wearable
 * rollup live in the shell's context panel; outcome measures render as a
 * dense hairline DataTable with mono/tabular figures.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { api, getToken, setToken, ApiError } from '@/lib/api';
import type { CaseloadEntry, ClinicalSummary, OutcomePoint, TrendDirection } from '@/lib/clinical-types';
import { Sparkline } from '@/components/Sparkline';
import { useResource } from '@/lib/use-resource';
import { ContextPanel } from '@/components/ContextPanel';
import { SkeletonCard, SkeletonStack } from '@/components/Skeleton';
import { ErrorPanel } from '@/components/ErrorPanel';
import { EmptyState } from '@/components/EmptyState';
import { StatTile } from '@/components/StatTile';
import { DataTable, type DataColumn } from '@/components/DataTable';

const NOTE_KEY = 'vpsy.session.note.draft';
const NOTE_TS_KEY = 'vpsy.session.note.ts';
const DEMO_PSYCHOLOGIST = { email: 'dr.rivera@vpsy.health', password: 'Vpsy!2026' };

const KIND_STYLE: Record<'note' | 'outcome', { dot: string; label: 'workspace.evNote' | 'workspace.evOutcome' }> = {
  note: { dot: 'bg-console-500 ring-1 ring-teal/50', label: 'workspace.evNote' },
  outcome: { dot: 'bg-teal', label: 'workspace.evOutcome' },
};

const TREND_KEY: Record<TrendDirection, 'common.trendIncreased' | 'common.trendDecreased' | 'common.trendUnchanged' | 'common.trendBaseline'> = {
  increased: 'common.trendIncreased',
  decreased: 'common.trendDecreased',
  unchanged: 'common.trendUnchanged',
  baseline: 'common.trendBaseline',
};

interface LiveEvent {
  id: string;
  kind: 'note' | 'outcome';
  /** null = unsigned draft (no timestamp yet) — sorts to the top. */
  date: string | null;
  title: string;
  detail: string;
}

async function fetchCaseload(): Promise<CaseloadEntry[]> {
  if (!getToken()) {
    const tok = await api.login(DEMO_PSYCHOLOGIST.email, DEMO_PSYCHOLOGIST.password);
    setToken(tok.accessToken);
  }
  try {
    return await api.myCaseload();
  } catch (e) {
    // Token may belong to another demo role (client/manager) — re-auth.
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      const tok = await api.login(DEMO_PSYCHOLOGIST.email, DEMO_PSYCHOLOGIST.password);
      setToken(tok.accessToken);
      return await api.myCaseload();
    }
    throw e;
  }
}

export default function SessionWorkspacePage() {
  const { t, dict, fmtDate, fmtTime, fmtNumber, fmtPercent } = useI18n();

  // ── Live caseload → clinical summary for the first client — no fallback-to-fake ──
  const { data: caseload, loading: caseloadLoading, error: caseloadError, reload: reloadCaseload } =
    useResource(fetchCaseload, []);

  const clientId = caseload && caseload.length > 0 ? caseload[0]!.clientId : null;

  const fetchSummary = useCallback(async (): Promise<ClinicalSummary | null> => {
    if (!clientId) return null;
    return api.clinicalSummary(clientId);
  }, [clientId]);

  const { data: summary, loading: summaryLoading, error: summaryError, reload: reloadSummary } =
    useResource(fetchSummary, [clientId]);

  const loading = caseloadLoading || summaryLoading;
  const error = caseloadError ?? summaryError;
  const caseloadSize = caseload?.length ?? 0;
  const emptyCaseload = !loading && !error && caseloadSize === 0;

  function reloadAll() {
    reloadCaseload();
    reloadSummary();
  }

  // ── Note drafting (local autosave) + real file/sign actions ──
  const [note, setNote] = useState('');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [filed, setFiled] = useState<{ id: string; signedAt: Date | null } | null>(null);
  const [noteBusy, setNoteBusy] = useState<'idle' | 'filing' | 'signing'>('idle');
  const [noteError, setNoteError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [ackedAt, setAckedAt] = useState<Date | null>(null);

  useEffect(() => {
    try {
      const draft = localStorage.getItem(NOTE_KEY);
      if (draft) setNote(draft);
      const ts = localStorage.getItem(NOTE_TS_KEY);
      if (ts) setSavedAt(new Date(ts));
    } catch {}
  }, []);

  function onNoteChange(v: string) {
    setNote(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveDraft(v), 1200);
  }

  function saveDraft(v = note) {
    try {
      localStorage.setItem(NOTE_KEY, v);
      const now = new Date();
      localStorage.setItem(NOTE_TS_KEY, now.toISOString());
      setSavedAt(now);
    } catch {}
  }

  // The session to attach the note to: the client's session from the summary.
  const sessionId = summary?.nextAppointment?.id ?? null;
  const canFile = !!sessionId && note.trim().length > 0 && noteBusy === 'idle' && !filed;

  async function fileNote() {
    if (!sessionId || !note.trim()) return;
    setNoteBusy('filing');
    setNoteError(null);
    try {
      const created = (await api.createSessionNote(sessionId, {
        format: 'narrative',
        narrative: note.trim(),
      })) as { id: string };
      setFiled({ id: created.id, signedAt: null });
      saveDraft();
      reloadSummary();
    } catch {
      setNoteError(t('workspace.noteFailed'));
    } finally {
      setNoteBusy('idle');
    }
  }

  async function signFiledNote() {
    if (!filed || filed.signedAt) return;
    setNoteBusy('signing');
    setNoteError(null);
    try {
      await api.signSessionNote(filed.id);
      setFiled({ ...filed, signedAt: new Date() });
      reloadSummary();
    } catch {
      setNoteError(t('workspace.signFailed'));
    } finally {
      setNoteBusy('idle');
    }
  }

  // ── Derived view model ──
  const clientName = summary?.client.displayName ?? '';
  const riskRaw = summary?.client.riskLevel ?? '';
  const bandLabel = riskRaw
    ? dict.intake.bands[riskRaw.toUpperCase() as keyof typeof dict.intake.bands] ?? riskRaw
    : '—';
  const highRisk = !!summary && ['HIGH', 'SEVERE'].includes(riskRaw.toUpperCase());
  const nextSessionDate = summary?.nextAppointment ? new Date(summary.nextAppointment.startsAt) : null;

  const liveTimeline = useMemo<LiveEvent[]>(() => {
    if (!summary) return [];
    const events: LiveEvent[] = [];
    for (const n of summary.recentNotes) {
      events.push({
        id: `note-${n.id}`,
        kind: 'note',
        date: n.signedAt,
        title: n.signedAt
          ? t('workspace.signedBy', { name: n.signedBy ?? '—' })
          : t('workspace.unsigned'),
        detail: n.excerpt,
      });
    }
    for (const o of summary.outcomes) {
      const dir = t(TREND_KEY[o.trend.direction] ?? 'common.trendBaseline');
      const delta =
        o.trend.delta === null
          ? ''
          : ` · ${o.trend.delta > 0 ? '+' : ''}${fmtNumber(o.trend.delta, { maximumFractionDigits: 1 })}`;
      events.push({
        id: `out-${o.construct}-${o.occurredAt}`,
        kind: 'outcome',
        date: o.occurredAt,
        title: `${o.construct} · ${fmtNumber(o.value, { maximumFractionDigits: 1 })}`,
        detail: `${dir}${delta}`,
      });
    }
    // Unsigned drafts (no date) first, then newest → oldest.
    return events.sort((a, b) => {
      if (a.date === null) return -1;
      if (b.date === null) return 1;
      return b.date.localeCompare(a.date);
    });
  }, [summary, t, fmtNumber]);

  // Outcome measures, newest first — the dense DataTable view of the signal.
  const measureRows = useMemo<OutcomePoint[]>(
    () => (summary ? [...summary.outcomes].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)) : []),
    [summary],
  );

  const measureColumns = useMemo<DataColumn<OutcomePoint>[]>(
    () => [
      {
        id: 'construct',
        header: t('workspace.tblConstruct'),
        cell: (o) => <span className="font-mono text-[11px] uppercase tracking-wider text-mist/80">{o.construct}</span>,
      },
      {
        id: 'value',
        header: t('workspace.tblValue'),
        numeric: true,
        cell: (o) => fmtNumber(o.value, { maximumFractionDigits: 1 }),
      },
      {
        id: 'delta',
        header: t('workspace.tblChange'),
        numeric: true,
        cell: (o) =>
          o.trend.delta === null
            ? '—'
            : `${o.trend.delta > 0 ? '+' : ''}${fmtNumber(o.trend.delta, { maximumFractionDigits: 1 })}`,
      },
      {
        id: 'trend',
        header: t('workspace.tblTrend'),
        cell: (o) => <span className="text-xs text-mist/60">{t(TREND_KEY[o.trend.direction] ?? 'common.trendBaseline')}</span>,
      },
      {
        id: 'date',
        header: t('workspace.tblDate'),
        numeric: true,
        cell: (o) => fmtDate(new Date(o.occurredAt), { day: '2-digit', month: 'short' }),
      },
    ],
    [t, fmtNumber, fmtDate],
  );

  const planGoals = summary?.activePlan?.goals ?? [];
  const assessment = summary?.latestAssessment ?? null;
  const wearable = summary?.wearable ?? null;

  const statusLabel = loading
    ? t('workspace.loadingCase')
    : error
      ? t('common.connectionIssue')
      : t('common.liveData');
  const errorMessage = error instanceof ApiError ? t('workspace.errStatus', { status: error.status }) : t('workspace.errNetwork');

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t('workspace.eyebrow')}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('workspace.title')}</h1>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-wider text-haze/70" role="status">
          {statusLabel}
        </p>
      </div>

      {loading && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[300px_1fr]" aria-hidden>
          <SkeletonCard className="h-64" />
          <SkeletonStack count={2} />
        </div>
      )}

      {!loading && !!error && <ErrorPanel className="mt-5" message={errorMessage} onRetry={reloadAll} />}

      {emptyCaseload && <EmptyState className="mt-5" body={t('workspace.emptyCaseload')} />}

      {!loading && !error && summary && (
        <>
          <div className="mt-5 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            {/* ── Timeline rail — the client's signal, vertical ── */}
            <aside className="card h-fit p-4">
              <p className="eyebrow">{t('workspace.timelineEyebrow')}</p>
              <ol className="relative mt-4 space-y-4 border-s border-line/20 ps-4">
                {liveTimeline.map((ev) => (
                  <li key={ev.id} className="relative">
                    <span
                      className={`absolute -start-[21.5px] top-1 h-2.5 w-2.5 rounded-full ${KIND_STYLE[ev.kind].dot}`}
                      aria-hidden
                    />
                    <p className="font-mono text-[10px] uppercase tracking-wider text-haze/90">
                      {ev.date ? fmtDate(new Date(ev.date), { day: 'numeric', month: 'short' }) : '—'} ·{' '}
                      {t(KIND_STYLE[ev.kind].label)}
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-mist/90">{ev.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-mist/50">{ev.detail}</p>
                  </li>
                ))}
                {liveTimeline.length === 0 && <li className="relative text-xs text-mist/40">—</li>}
              </ol>
            </aside>

            {/* ── Main column ── */}
            <div className="space-y-4">
              {/* Risk banner — only when the live record actually flags high/severe risk */}
              {highRisk && (
                <section className="rounded-md border border-signal/45 bg-signal/[0.07] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-signal" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                        <path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <div>
                        <p className="eyebrow text-signal">{t('workspace.alertsEyebrow')}</p>
                        <p className="mt-1 max-w-xl text-sm leading-relaxed text-mist/80">
                          {t('workspace.riskBanner', { band: bandLabel })}
                        </p>
                      </div>
                    </div>
                    {ackedAt ? (
                      <span className="chip" role="status">
                        ✓ {t('workspace.acked', { time: fmtTime(ackedAt) })}
                      </span>
                    ) : (
                      <button
                        onClick={() => setAckedAt(new Date())}
                        className="rounded border border-signal/60 px-3.5 py-1.5 text-sm font-medium text-signal transition hover:bg-signal/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
                      >
                        {t('workspace.ack')}
                      </button>
                    )}
                  </div>
                </section>
              )}

              {/* Session notes — draft locally, file + sign through the API */}
              <section className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="eyebrow">{t('workspace.notesEyebrow')}</p>
                    <h2 className="mt-1 font-display text-lg font-medium text-mist">{t('workspace.notesTitle')}</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => saveDraft()} className="btn-ghost">
                      {t('workspace.saveDraft')}
                    </button>
                    {!filed && (
                      <button
                        onClick={fileNote}
                        disabled={!canFile}
                        title={!sessionId ? t('workspace.noSessionForNote') : undefined}
                        className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {noteBusy === 'filing' ? t('workspace.filingNote') : t('workspace.fileNote')}
                      </button>
                    )}
                    {filed && !filed.signedAt && (
                      <button
                        onClick={signFiledNote}
                        disabled={noteBusy !== 'idle'}
                        className="btn-primary disabled:opacity-60"
                      >
                        {noteBusy === 'signing' ? t('workspace.signingNote') : t('workspace.signNote')}
                      </button>
                    )}
                    {filed?.signedAt && (
                      <span className="chip" role="status">
                        ✓ {t('workspace.noteSignedAt', { time: fmtTime(filed.signedAt) })}
                      </span>
                    )}
                  </div>
                </div>
                <textarea
                  value={note}
                  onChange={(e) => onNoteChange(e.target.value)}
                  placeholder={t('workspace.notesPlaceholder')}
                  aria-label={t('workspace.notesTitle')}
                  readOnly={!!filed}
                  className="field mt-4 min-h-[160px] leading-relaxed read-only:opacity-70"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-haze/90" role="status">
                    {filed && !filed.signedAt
                      ? t('workspace.noteFiled')
                      : savedAt
                        ? t('workspace.draftSaved', { time: fmtTime(savedAt) })
                        : t('workspace.draftEmpty')}
                  </p>
                  {!sessionId && !filed && (
                    <p className="text-xs text-mist/40">{t('workspace.noSessionForNote')}</p>
                  )}
                </div>
                {noteError && (
                  <p role="alert" className="mt-2 text-sm text-risk">
                    {noteError}
                  </p>
                )}
              </section>

              {/* Outcome measures — the dense hairline grid of the client's signal */}
              {measureRows.length > 0 && (
                <section>
                  <p className="eyebrow mb-2">{t('workspace.measuresEyebrow')}</p>
                  <DataTable
                    columns={measureColumns}
                    rows={measureRows}
                    rowKey={(o) => `${o.construct}-${o.occurredAt}`}
                    caption={t('workspace.measuresCaption')}
                  />
                </section>
              )}

              {/* AI case formulation — no live endpoint yet; honest pending state, never fabricated */}
              <section className="card overflow-hidden">
                <div className="hairline-b flex flex-wrap items-center justify-between gap-3 bg-console-700/40 px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-7 w-7 place-items-center rounded-sm border border-line/30" aria-hidden>
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-haze" fill="none" stroke="currentColor" strokeWidth="1.6">
                        <path d="M12 3a4.5 4.5 0 00-4.4 5.5A4 4 0 006 16h2m4-13a4.5 4.5 0 014.4 5.5A4 4 0 0118 16h-2m-4-13v18m0 0l-2.5-2.5M12 21l2.5-2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <p className="eyebrow mb-0">{t('workspace.aiEyebrow')}</p>
                  </div>
                </div>
                <div className="p-5">
                  <p className="text-sm leading-relaxed text-mist/75">{t('workspace.aiPending')}</p>
                  <p className="mt-2 text-xs leading-relaxed text-mist/45">{t('workspace.aiPendingBody')}</p>
                  <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-wider text-haze/70">
                    {t('common.aiMotto')}
                  </p>
                </div>
              </section>

              {/* Treatment plan snapshot */}
              <section className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="eyebrow">{t('workspace.planEyebrow')}</p>
                  {summary.activePlan && (
                    <span className="chip">
                      {t('workspace.planVersion', { n: fmtNumber(summary.activePlan.version) })}
                    </span>
                  )}
                </div>
                <ul className="mt-4 space-y-4">
                  {planGoals.length > 0 ? (
                    planGoals.map((g) => (
                      <li key={g.id}>
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-sm font-medium text-mist/85">{g.description}</p>
                          <span className="figure text-xs text-mist" dir="ltr">{fmtPercent(g.progressPct / 100)}</span>
                        </div>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-console-600" dir="ltr">
                          <div
                            className="h-full rounded-full bg-teal"
                            style={{ width: `${Math.max(0, Math.min(100, g.progressPct))}%` }}
                          />
                        </div>
                        {g.targetMetric && (
                          <p className="mt-1 text-[11px] text-mist/40">
                            {t('workspace.goalTarget', { metric: g.targetMetric })}
                          </p>
                        )}
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-mist/40">—</li>
                  )}
                </ul>
              </section>
            </div>
          </div>

          {/* ── Context panel: client identity + latest assessment + wearable ── */}
          <ContextPanel>
            <section className="card p-4">
              <p className="eyebrow">{t('workspace.clientEyebrow')}</p>
              <div className="mt-3 flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border border-line/30 bg-console-700/60 font-display text-sm font-semibold text-mist">
                  {clientName.split(' ').map((p) => p[0]).join('').slice(0, 2)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-display text-base font-medium text-mist">{clientName}</p>
                  <p className="figure text-[11px] text-haze/90" dir="ltr">
                    {t('workspace.recordId', { id: summary.client.id.slice(0, 8) })}
                  </p>
                </div>
              </div>
              <dl className="hairline-t mt-3 space-y-2 pt-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-mist/55">{t('workspace.riskLevel')}</dt>
                  <dd>
                    <span className={highRisk ? 'chip-signal' : 'chip'}>{bandLabel}</span>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-mist/55">{t('workspace.nextSession')}</dt>
                  <dd className="figure text-mist" dir="ltr">
                    {nextSessionDate
                      ? fmtDate(nextSessionDate, { weekday: 'short', day: 'numeric', month: 'short' })
                      : '—'}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-mist/55">{t('workspace.caseloadCount', { n: fmtNumber(caseloadSize) })}</p>
            </section>

            {assessment && (
              <section className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="eyebrow">{t('workspace.assessEyebrow')}</p>
                </div>
                <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-haze/80">
                  {t('workspace.assessCompleted', {
                    date: fmtDate(new Date(assessment.completedAt), { day: 'numeric', month: 'short' }),
                  })}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <StatTile
                    label={t('workspace.assessScore')}
                    value={assessment.rawScore === null ? '—' : fmtNumber(assessment.rawScore)}
                  />
                  <div className="card-inset p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-haze/90">{t('workspace.assessBand')}</p>
                    <p className="mt-1.5 text-lg font-medium leading-none text-mist">
                      {assessment.severityBand
                        ? dict.intake.bands[assessment.severityBand.toUpperCase() as keyof typeof dict.intake.bands] ??
                          assessment.severityBand
                        : '—'}
                    </p>
                  </div>
                </div>
                {assessment.interpretation && (
                  <p className="mt-3 text-xs leading-relaxed text-mist/60">{assessment.interpretation}</p>
                )}
              </section>
            )}

            {wearable && (
              <section className="card p-4">
                <p className="eyebrow">{t('workspace.wearableEyebrow', { n: fmtNumber(wearable.windowDays) })}</p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <StatTile
                    label={t('patient.avgHrv')}
                    value={wearable.avgHrvMs === null ? '—' : fmtNumber(Math.round(wearable.avgHrvMs))}
                    unit={wearable.avgHrvMs === null ? undefined : t('patient.unitMs')}
                  />
                  <StatTile
                    label={t('patient.avgSleep')}
                    value={
                      wearable.avgSleepHours === null
                        ? '—'
                        : fmtNumber(wearable.avgSleepHours, { maximumFractionDigits: 1 })
                    }
                    unit={wearable.avgSleepHours === null ? undefined : t('patient.unitHours')}
                  />
                  <StatTile
                    label={t('patient.restingHr')}
                    value={wearable.restingHrBpm === null ? '—' : fmtNumber(Math.round(wearable.restingHrBpm))}
                    unit={wearable.restingHrBpm === null ? undefined : t('patient.unitBpm')}
                  />
                </div>
                {wearable.series.length > 0 && (
                  <div className="card-inset mt-2 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-haze/90">{t('patient.hrvDaily')}</p>
                    <div className="mt-2 text-teal" dir="ltr">
                      <Sparkline values={wearable.series.map((d) => d.hrvMs)} className="h-7 w-full" />
                    </div>
                  </div>
                )}
                {wearable.arousalNote && (
                  <p className="mt-3 text-xs leading-relaxed text-mist/60">{wearable.arousalNote}</p>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-mist/40">{t('patient.wearableNote')}</p>
              </section>
            )}
          </ContextPanel>
        </>
      )}
    </div>
  );
}
