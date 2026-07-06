'use client';

/**
 * Clinician Session Workspace — the center of the system.
 *
 * Wired to the live clinical read model: signs in as the demo psychologist
 * (if no usable token), loads GET /clinicians/me/caseload, picks the first
 * client, and renders GET /clients/:id/clinical-summary — real timeline
 * (recent notes + outcome measures), active plan with goal progress, the
 * latest assessment, and the wearable rollup. "File note" POSTs a structured
 * note against the client's session and "Sign" locks it via the API.
 * If the API is unreachable everything falls back to the typed mocks in
 * src/lib/mock/clinician.ts — the screen never breaks. The AI formulation
 * stays behind its explicit clinician-confirmation gate.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { api, getToken, setToken, ApiError } from '@/lib/api';
import type { ClinicalSummary, TrendDirection } from '@/lib/clinical-types';
import { Sparkline } from '@/components/Sparkline';
import {
  MOCK_ALERTS,
  MOCK_CLIENT,
  MOCK_FORMULATION,
  MOCK_PLAN,
  MOCK_TIMELINE,
  type TimelineKind,
} from '@/lib/mock/clinician';

const NOTE_KEY = 'vpsy.session.note.draft';
const NOTE_TS_KEY = 'vpsy.session.note.ts';
const DEMO_PSYCHOLOGIST = { email: 'dr.rivera@vpsy.health', password: 'Vpsy!2026' };

type Source = 'loading' | 'live' | 'fallback';

const KIND_STYLE: Record<TimelineKind | 'note' | 'outcome', { dot: string; label: string }> = {
  intake: { dot: 'bg-teal', label: 'evIntake' },
  assessment: { dot: 'bg-teal-soft', label: 'evAssessment' },
  session: { dot: 'bg-console-500 ring-1 ring-teal/40', label: 'evSession' },
  risk: { dot: 'bg-signal', label: 'evRisk' },
  plan: { dot: 'bg-teal-deep', label: 'evPlan' },
  note: { dot: 'bg-console-500 ring-1 ring-teal/40', label: 'evNote' },
  outcome: { dot: 'bg-teal-soft', label: 'evOutcome' },
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

function daysAgoDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}
function daysAheadDate(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

export default function SessionWorkspacePage() {
  const { t, dict, fmtDate, fmtTime, fmtNumber, fmtPercent } = useI18n();

  // ── Live caseload + clinical summary ──
  const [source, setSource] = useState<Source>('loading');
  const [summary, setSummary] = useState<ClinicalSummary | null>(null);
  const [caseloadSize, setCaseloadSize] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!getToken()) {
          const tok = await api.login(DEMO_PSYCHOLOGIST.email, DEMO_PSYCHOLOGIST.password);
          setToken(tok.accessToken);
        }
        let caseload;
        try {
          caseload = await api.myCaseload();
        } catch (e) {
          // Token may belong to another demo role (client/manager) — re-auth.
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            const tok = await api.login(DEMO_PSYCHOLOGIST.email, DEMO_PSYCHOLOGIST.password);
            setToken(tok.accessToken);
            caseload = await api.myCaseload();
          } else {
            throw e;
          }
        }
        if (!caseload.length) throw new Error('empty caseload');
        const s = await api.clinicalSummary(caseload[0].clientId);
        if (!cancelled) {
          setSummary(s);
          setCaseloadSize(caseload.length);
          setSource('live');
        }
      } catch {
        if (!cancelled) setSource('fallback');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Note drafting (local autosave) + real file/sign actions ──
  const [note, setNote] = useState('');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [filed, setFiled] = useState<{ id: string; signedAt: Date | null } | null>(null);
  const [noteBusy, setNoteBusy] = useState<'idle' | 'filing' | 'signing'>('idle');
  const [noteError, setNoteError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [ackedAt, setAckedAt] = useState<Date | null>(null);
  const [aiState, setAiState] = useState<'pending' | 'confirmed' | 'dismissed'>('pending');
  const [aiDecidedAt, setAiDecidedAt] = useState<Date | null>(null);

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
  const sessionId = source === 'live' ? summary?.nextAppointment?.id ?? null : null;
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
    } catch {
      setNoteError(t('workspace.signFailed'));
    } finally {
      setNoteBusy('idle');
    }
  }

  function decideAi(decision: 'confirmed' | 'dismissed') {
    setAiState(decision);
    setAiDecidedAt(new Date());
  }

  // ── Derived view model ──
  const live = source === 'live' && summary !== null;
  const clientName = live ? summary.client.displayName : MOCK_CLIENT.name;
  const riskRaw = live ? summary.client.riskLevel : MOCK_CLIENT.riskBand;
  const bandLabel =
    dict.intake.bands[riskRaw.toUpperCase() as keyof typeof dict.intake.bands] ?? riskRaw;
  const highRisk = live && ['HIGH', 'SEVERE'].includes(riskRaw.toUpperCase());
  const nextSessionDate = live
    ? summary.nextAppointment
      ? new Date(summary.nextAppointment.startsAt)
      : null
    : daysAheadDate(MOCK_CLIENT.nextSessionDays);

  const liveTimeline = useMemo<LiveEvent[]>(() => {
    if (!live) return [];
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
  }, [live, summary, t, fmtNumber]);

  const planGoals = live ? summary.activePlan?.goals ?? [] : [];
  const assessment = live ? summary.latestAssessment : null;
  const wearable = live ? summary.wearable : null;
  const confidencePct = fmtPercent(MOCK_FORMULATION.confidence);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t('workspace.eyebrow')}</p>
          <h1 className="mt-3 font-display text-3xl font-semibold text-mist">{t('workspace.title')}</h1>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-wider text-mist/30" role="status">
          {source === 'live'
            ? t('common.liveData')
            : source === 'loading'
              ? t('workspace.loadingCase')
              : t('common.offlineDemo')}
        </p>
      </div>

      {/* Client band */}
      <div className="mt-6 card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-4">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-teal/15 font-display text-base font-semibold text-teal-soft ring-1 ring-teal/30">
            {clientName.split(' ').map((p) => p[0]).join('').slice(0, 2)}
          </span>
          <div>
            <p className="font-display text-lg font-medium text-mist">{clientName}</p>
            <p className="text-xs text-mist/50">
              {live ? (
                <>
                  {t('workspace.recordId', { id: summary.client.id.slice(0, 8) })} ·{' '}
                  {t('workspace.caseloadCount', { n: fmtNumber(caseloadSize) })}
                </>
              ) : (
                <>
                  {t('workspace.inCareSince', { date: fmtDate(daysAgoDate(MOCK_CLIENT.careStartDaysAgo)) })} ·{' '}
                  {t('workspace.week', { n: fmtNumber(MOCK_CLIENT.week) })}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={highRisk || !live ? 'chip-signal' : 'chip text-teal-soft/80'}>
            {t('workspace.riskLevel')}: {bandLabel}
          </span>
          <span className="chip text-teal-soft/80">
            {t('workspace.nextSession')}:{' '}
            {nextSessionDate
              ? fmtDate(nextSessionDate, { weekday: 'short', day: 'numeric', month: 'short' })
              : '—'}
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* ── Timeline rail — the client's signal, vertical ── */}
        <aside className="card h-fit p-5">
          <p className="eyebrow">{t('workspace.timelineEyebrow')}</p>
          <ol className="relative mt-5 space-y-5 border-s border-white/[0.08] ps-5">
            {live
              ? liveTimeline.map((ev) => (
                  <li key={ev.id} className="relative">
                    <span
                      className={`absolute -start-[26.5px] top-1 h-3 w-3 rounded-full ${KIND_STYLE[ev.kind].dot}`}
                      aria-hidden
                    />
                    <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">
                      {ev.date ? fmtDate(new Date(ev.date), { day: 'numeric', month: 'short' }) : '—'} ·{' '}
                      {t(`workspace.${KIND_STYLE[ev.kind].label}` as 'workspace.evNote')}
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-mist/90">{ev.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-mist/50">{ev.detail}</p>
                  </li>
                ))
              : MOCK_TIMELINE.map((ev) => (
                  <li key={ev.id} className="relative">
                    <span
                      className={`absolute -start-[26.5px] top-1 h-3 w-3 rounded-full ${KIND_STYLE[ev.kind].dot}`}
                      aria-hidden
                    />
                    <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">
                      {fmtDate(daysAgoDate(ev.daysAgo), { day: 'numeric', month: 'short' })} ·{' '}
                      {t(`workspace.${KIND_STYLE[ev.kind].label}` as 'workspace.evIntake')}
                    </p>
                    <p className={`mt-0.5 text-sm font-medium ${ev.kind === 'risk' ? 'text-signal-soft' : 'text-mist/90'}`}>
                      {ev.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-mist/50">{ev.detail}</p>
                  </li>
                ))}
            {live && liveTimeline.length === 0 && (
              <li className="relative text-xs text-mist/40">—</li>
            )}
          </ol>
        </aside>

        {/* ── Main column ── */}
        <div className="space-y-6">
          {/* Risk — live banner from the summary, mock alerts otherwise */}
          {live && highRisk && (
            <section className="rounded-2xl border border-signal/30 bg-signal/[0.07] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-signal" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div>
                    <p className="eyebrow text-signal-soft/90">{t('workspace.alertsEyebrow')}</p>
                    <p className="mt-1 max-w-xl text-sm leading-relaxed text-mist/80">
                      {t('workspace.riskBanner', { band: bandLabel })}
                    </p>
                  </div>
                </div>
                {ackedAt ? (
                  <span className="chip border-teal/25 bg-teal/10 text-teal-soft">
                    ✓ {t('workspace.acked', { time: fmtTime(ackedAt) })}
                  </span>
                ) : (
                  <button
                    onClick={() => setAckedAt(new Date())}
                    className="rounded-xl border border-signal/50 px-4 py-2 text-sm font-medium text-signal-soft transition hover:bg-signal/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal-soft"
                  >
                    {t('workspace.ack')}
                  </button>
                )}
              </div>
            </section>
          )}
          {!live &&
            MOCK_ALERTS.map((al) => (
              <section key={al.id} className="rounded-2xl border border-signal/30 bg-signal/[0.07] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-signal" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                      <path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <div>
                      <p className="eyebrow text-signal-soft/90">{t('workspace.alertsEyebrow')}</p>
                      <p className="mt-1 font-medium text-mist">{al.title}</p>
                      <p className="mt-1 max-w-xl text-sm leading-relaxed text-mist/60">{al.detail}</p>
                      <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-mist/40">
                        {fmtDate(daysAgoDate(al.daysAgo))}
                      </p>
                    </div>
                  </div>
                  {ackedAt ? (
                    <span className="chip border-teal/25 bg-teal/10 text-teal-soft">
                      ✓ {t('workspace.acked', { time: fmtTime(ackedAt) })}
                    </span>
                  ) : (
                    <button
                      onClick={() => setAckedAt(new Date())}
                      className="rounded-xl border border-signal/50 px-4 py-2 text-sm font-medium text-signal-soft transition hover:bg-signal/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal-soft"
                    >
                      {t('workspace.ack')}
                    </button>
                  )}
                </div>
              </section>
            ))}

          {/* Session notes — draft locally, file + sign through the API */}
          <section className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="eyebrow">{t('workspace.notesEyebrow')}</p>
                <h2 className="mt-1 font-display text-xl font-medium text-mist">{t('workspace.notesTitle')}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => saveDraft()} className="btn-ghost px-4 py-2 text-sm">
                  {t('workspace.saveDraft')}
                </button>
                {!filed && (
                  <button
                    onClick={fileNote}
                    disabled={!canFile}
                    title={!sessionId ? t('workspace.noSessionForNote') : undefined}
                    className="btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {noteBusy === 'filing' ? t('workspace.filingNote') : t('workspace.fileNote')}
                  </button>
                )}
                {filed && !filed.signedAt && (
                  <button
                    onClick={signFiledNote}
                    disabled={noteBusy !== 'idle'}
                    className="btn-primary px-4 py-2 text-sm disabled:opacity-60"
                  >
                    {noteBusy === 'signing' ? t('workspace.signingNote') : t('workspace.signNote')}
                  </button>
                )}
                {filed?.signedAt && (
                  <span className="chip border-teal/25 bg-teal/10 text-teal-soft" role="status">
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
              <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40" role="status">
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

          {/* Latest assessment + wearable rollup — live signal row */}
          {(assessment || wearable) && (
            <div className="grid gap-6 xl:grid-cols-2">
              {assessment && (
                <section className="card p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="eyebrow">{t('workspace.assessEyebrow')}</p>
                    <span className="chip text-teal-soft/80">
                      {t('workspace.assessCompleted', {
                        date: fmtDate(new Date(assessment.completedAt), { day: 'numeric', month: 'short' }),
                      })}
                    </span>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-4">
                    <div className="card-inset p-4 text-center">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{t('workspace.assessScore')}</p>
                      <p className="mt-1.5 font-display text-3xl font-semibold text-mist">
                        {assessment.rawScore === null ? '—' : fmtNumber(assessment.rawScore)}
                      </p>
                    </div>
                    <div className="card-inset p-4 text-center">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{t('workspace.assessBand')}</p>
                      <p className="mt-1.5 font-display text-3xl font-semibold text-mist">
                        {assessment.severityBand
                          ? dict.intake.bands[assessment.severityBand.toUpperCase() as keyof typeof dict.intake.bands] ??
                            assessment.severityBand
                          : '—'}
                      </p>
                    </div>
                  </div>
                  {assessment.interpretation && (
                    <p className="mt-4 text-sm leading-relaxed text-mist/60">{assessment.interpretation}</p>
                  )}
                </section>
              )}
              {wearable && (
                <section className="card p-6">
                  <p className="eyebrow">{t('workspace.wearableEyebrow', { n: fmtNumber(wearable.windowDays) })}</p>
                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <div className="card-inset p-3 text-center">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{t('patient.avgHrv')}</p>
                      <p className="mt-1 font-display text-xl font-semibold text-mist">
                        {wearable.avgHrvMs === null ? '—' : fmtNumber(Math.round(wearable.avgHrvMs))}
                        {wearable.avgHrvMs !== null && (
                          <span className="ms-1 text-xs font-normal text-mist/50">{t('patient.unitMs')}</span>
                        )}
                      </p>
                    </div>
                    <div className="card-inset p-3 text-center">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{t('patient.avgSleep')}</p>
                      <p className="mt-1 font-display text-xl font-semibold text-mist">
                        {wearable.avgSleepHours === null
                          ? '—'
                          : fmtNumber(wearable.avgSleepHours, { maximumFractionDigits: 1 })}
                        {wearable.avgSleepHours !== null && (
                          <span className="ms-1 text-xs font-normal text-mist/50">{t('patient.unitHours')}</span>
                        )}
                      </p>
                    </div>
                    <div className="card-inset p-3 text-center">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{t('patient.restingHr')}</p>
                      <p className="mt-1 font-display text-xl font-semibold text-mist">
                        {wearable.restingHrBpm === null ? '—' : fmtNumber(Math.round(wearable.restingHrBpm))}
                        {wearable.restingHrBpm !== null && (
                          <span className="ms-1 text-xs font-normal text-mist/50">{t('patient.unitBpm')}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  {wearable.series.length > 0 && (
                    <div className="mt-4 card-inset p-4">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{t('patient.hrvDaily')}</p>
                      <div className="mt-2 text-teal" dir="ltr">
                        <Sparkline values={wearable.series.map((d) => d.hrvMs)} className="h-8 w-full" />
                      </div>
                    </div>
                  )}
                  {wearable.arousalNote && (
                    <p className="mt-4 text-sm leading-relaxed text-mist/60">{wearable.arousalNote}</p>
                  )}
                  <p className="mt-3 text-xs leading-relaxed text-mist/40">{t('patient.wearableNote')}</p>
                </section>
              )}
            </div>
          )}

          {/* AI case formulation — assistive, gated */}
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] bg-console-950/40 px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-teal/15 ring-1 ring-teal/30" aria-hidden>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-teal-soft" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M12 3a4.5 4.5 0 00-4.4 5.5A4 4 0 006 16h2m4-13a4.5 4.5 0 014.4 5.5A4 4 0 0118 16h-2m-4-13v18m0 0l-2.5-2.5M12 21l2.5-2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <p className="eyebrow mb-0">{t('workspace.aiEyebrow')}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2" title={`${t('workspace.aiConfidence')} ${confidencePct}`}>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-mist/50">{t('workspace.aiConfidence')}</span>
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-console-600" dir="ltr" aria-hidden>
                    <div className="h-full rounded-full bg-teal" style={{ width: `${MOCK_FORMULATION.confidence * 100}%` }} />
                  </div>
                  <span className="font-mono text-xs text-teal-soft">{confidencePct}</span>
                </div>
              </div>
            </div>
            <div className="p-6">
              <p className="text-sm leading-relaxed text-mist/75">{MOCK_FORMULATION.summary}</p>
              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                {MOCK_FORMULATION.factors.map((f) => (
                  <div key={f.label} className="card-inset p-3.5">
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-teal-soft/70">{f.label}</dt>
                    <dd className="mt-1 text-xs leading-relaxed text-mist/60">{f.text}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-mist/35">
                {t('workspace.aiModelLine', { model: MOCK_FORMULATION.modelVersion, prompt: MOCK_FORMULATION.promptVersion })}
              </p>

              {/* The human decision gate */}
              <div className="mt-5 rounded-xl border border-signal/25 bg-signal/[0.05] p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-signal-soft">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <rect x="5" y="11" width="14" height="9" rx="2" />
                    <path d="M8 11V7a4 4 0 018 0v4" strokeLinecap="round" />
                  </svg>
                  {t('workspace.aiGate')}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-mist/55">{t('workspace.aiGateBody')}</p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {aiState === 'pending' && (
                    <>
                      <button onClick={() => decideAi('confirmed')} className="btn-primary px-4 py-2 text-sm">
                        {t('workspace.aiConfirm')}
                      </button>
                      <button onClick={() => decideAi('dismissed')} className="btn-ghost px-4 py-2 text-sm">
                        {t('workspace.aiDismiss')}
                      </button>
                    </>
                  )}
                  {aiState === 'confirmed' && aiDecidedAt && (
                    <span className="chip border-teal/25 bg-teal/10 text-teal-soft" role="status">
                      ✓ {t('workspace.aiConfirmed', { time: fmtTime(aiDecidedAt) })}
                    </span>
                  )}
                  {aiState === 'dismissed' && (
                    <span className="chip text-mist/60" role="status">{t('workspace.aiDismissed')}</span>
                  )}
                </div>
              </div>
              <p className="mt-4 text-center text-xs text-mist/35">{t('common.aiMotto')}</p>
            </div>
          </section>

          {/* Treatment plan snapshot */}
          <section className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="eyebrow">{t('workspace.planEyebrow')}</p>
              {live ? (
                summary.activePlan && (
                  <span className="chip text-teal-soft/80">
                    {t('workspace.planVersion', { n: fmtNumber(summary.activePlan.version) })}
                  </span>
                )
              ) : (
                <span className="chip text-teal-soft/80">
                  {t('workspace.planReview', { date: fmtDate(daysAheadDate(MOCK_PLAN.reviewInDays)) })}
                </span>
              )}
            </div>
            <ul className="mt-5 space-y-4">
              {live ? (
                planGoals.length > 0 ? (
                  planGoals.map((g) => (
                    <li key={g.id}>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-medium text-mist/85">{g.description}</p>
                        <span className="font-mono text-xs text-teal-soft">{fmtPercent(g.progressPct / 100)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-console-600" dir="ltr">
                        <div
                          className="h-full rounded-full bg-teal/70"
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
                )
              ) : (
                MOCK_PLAN.goals.map((g) => (
                  <li key={g.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-medium text-mist/85">{g.label}</p>
                      <span className="font-mono text-xs text-teal-soft">
                        {g.progress === null ? '—' : fmtPercent(g.progress)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-console-600" dir="ltr">
                      {g.progress !== null && (
                        <div className="h-full rounded-full bg-teal/70" style={{ width: `${g.progress * 100}%` }} />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-mist/40">{g.measure}</p>
                  </li>
                ))
              )}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
