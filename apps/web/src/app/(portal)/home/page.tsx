'use client';

/**
 * Patient PWA home — the client's calm daily surface.
 *
 * Wired to the live clinical read model: on load it signs in as the demo
 * client (if no token yet, same convenience as intake) and fetches
 * GET /clients/me → ClinicalSummary. Next appointment, plan-goal progress,
 * outcome trends, and the wearable rollup all render from real data.
 * If the API is unreachable the screen falls back to the typed mocks in
 * src/lib/mock/patient.ts — it never breaks. The mood check-in stays local
 * (localStorage) by design; exercises have no endpoint yet and remain mocked.
 */
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/i18n';
import { api, getToken, setToken, ApiError } from '@/lib/api';
import type { ClinicalSummary, OutcomePoint, TrendDirection } from '@/lib/clinical-types';
import { Sparkline } from '@/components/Sparkline';
import {
  MOCK_EXERCISES,
  MOCK_MOOD_HISTORY,
  MOCK_NEXT_SESSION,
  MOCK_WEARABLE,
} from '@/lib/mock/patient';

const MOOD_KEY_PREFIX = 'vpsy.mood.';
const EXERCISES_KEY = 'vpsy.exercises.done';
const DEMO_CLIENT = { email: 'alex.client@example.com', password: 'Vpsy!2026' };

type Source = 'loading' | 'live' | 'fallback';

function todayKey(): string {
  return MOOD_KEY_PREFIX + new Date().toISOString().slice(0, 10);
}

const TREND_KEY: Record<TrendDirection, 'common.trendIncreased' | 'common.trendDecreased' | 'common.trendUnchanged' | 'common.trendBaseline'> = {
  increased: 'common.trendIncreased',
  decreased: 'common.trendDecreased',
  unchanged: 'common.trendUnchanged',
  baseline: 'common.trendBaseline',
};

/** Group the flat outcome list into per-construct series, oldest → newest. */
function groupOutcomes(points: OutcomePoint[]): { construct: string; series: OutcomePoint[] }[] {
  const byConstruct = new Map<string, OutcomePoint[]>();
  for (const p of points) {
    const arr = byConstruct.get(p.construct) ?? [];
    arr.push(p);
    byConstruct.set(p.construct, arr);
  }
  return [...byConstruct.entries()].map(([construct, series]) => ({
    construct,
    series: [...series].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
  }));
}

export default function PatientHomePage() {
  const { t, dict, fmtDate, fmtTime, fmtNumber, fmtPercent } = useI18n();

  // ── Live clinical summary ──
  const [summary, setSummary] = useState<ClinicalSummary | null>(null);
  const [source, setSource] = useState<Source>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!getToken()) {
          const tok = await api.login(DEMO_CLIENT.email, DEMO_CLIENT.password);
          setToken(tok.accessToken);
        }
        let s: ClinicalSummary;
        try {
          s = await api.clientMe();
        } catch (e) {
          // Stale token from an earlier role/session — retry once fresh.
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            const tok = await api.login(DEMO_CLIENT.email, DEMO_CLIENT.password);
            setToken(tok.accessToken);
            s = await api.clientMe();
          } else {
            throw e;
          }
        }
        if (!cancelled) {
          setSummary(s);
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

  // ── Mood check-in (stays local by design) ──
  const [mood, setMood] = useState<number | null>(null);
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const m = localStorage.getItem(todayKey());
      if (m) setMood(Number(m));
      const d = localStorage.getItem(EXERCISES_KEY);
      if (d) setDoneIds(JSON.parse(d));
    } catch {
      /* storage unavailable — the page still works */
    }
    setLoaded(true);
  }, []);

  function pickMood(level: number) {
    setMood(level);
    try {
      localStorage.setItem(todayKey(), String(level));
    } catch {}
  }

  function toggleExercise(id: string) {
    setDoneIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(EXERCISES_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? t('patient.greetingMorning') : hour < 18 ? t('patient.greetingAfternoon') : t('patient.greetingEvening');
  const firstName =
    source === 'live' && summary ? summary.client.displayName.split(' ')[0] : 'Alex';

  const weekSignal = useMemo(() => [...MOCK_MOOD_HISTORY, mood], [mood]);
  const doneCount = MOCK_EXERCISES.filter((e) => doneIds.includes(e.id)).length;

  // Next appointment: live when available, mock otherwise.
  const nextAppt = source === 'live' ? summary?.nextAppointment ?? null : null;
  const showMockSession = source !== 'live';
  const apptDate = nextAppt ? new Date(nextAppt.startsAt) : new Date(MOCK_NEXT_SESSION.startsAt);
  const apptFormatLabel = (fmt: string) =>
    /video|virtual|online/i.test(fmt) ? t('patient.videoSession') : t('patient.inPersonSession');

  const goals = source === 'live' ? summary?.activePlan?.goals ?? [] : [];
  const outcomeGroups = useMemo(
    () => (source === 'live' && summary ? groupOutcomes(summary.outcomes) : []),
    [source, summary],
  );
  const wearable = source === 'live' ? summary?.wearable ?? null : null;

  const mockSleepMin = MOCK_WEARABLE.sleepMin;
  const mockSleepText =
    mockSleepMin === null
      ? '—'
      : `${fmtNumber(Math.floor(mockSleepMin / 60))} h ${fmtNumber(mockSleepMin % 60)} min`;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Greeting */}
      <p className="eyebrow">{fmtDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-mist">{greeting}, {firstName}.</h1>
      <p className="mt-2 text-mist/55">{t('patient.subtitle')}</p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-mist/30" role="status">
        {source === 'live'
          ? t('common.liveData')
          : source === 'loading'
            ? t('common.loadingLive')
            : t('common.offlineDemo')}
      </p>

      <div className="mt-8 space-y-6">
        {/* Next session — the anchor card */}
        <section className="card relative overflow-hidden p-6 shadow-console">
          <div className="pointer-events-none absolute inset-0 bg-aurora opacity-50" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="eyebrow">{t('patient.nextSessionEyebrow')}</p>
              {source === 'live' && !nextAppt ? (
                <p className="mt-2 max-w-md text-sm leading-relaxed text-mist/60">{t('patient.noUpcoming')}</p>
              ) : (
                <>
                  <p className="mt-2 font-display text-2xl font-semibold text-mist">
                    {fmtDate(apptDate, { weekday: 'long', day: 'numeric', month: 'long' })} · {fmtTime(apptDate)}
                  </p>
                  <p className="mt-1 text-sm text-mist/60">
                    {nextAppt ? (
                      apptFormatLabel(nextAppt.format)
                    ) : (
                      <>
                        {t('patient.withName', { name: MOCK_NEXT_SESSION.clinicianName })} · {t('patient.videoSession')} ·{' '}
                        {fmtNumber(MOCK_NEXT_SESSION.durationMin)} min
                      </>
                    )}
                  </p>
                  <p className="mt-2 text-xs text-mist/40">{t('patient.joinFrom')}</p>
                </>
              )}
            </div>
            {(nextAppt || showMockSession) && (
              <div className="flex shrink-0 flex-col gap-2">
                <button className="btn-primary px-5 py-2.5 text-sm">{t('patient.join')}</button>
                <button className="btn-ghost px-5 py-2 text-sm">{t('patient.reschedule')}</button>
              </div>
            )}
          </div>
        </section>

        {/* Active-plan goal progress — live only */}
        {goals.length > 0 && (
          <section className="card p-6">
            <p className="eyebrow">{t('patient.planEyebrow')}</p>
            <h2 className="mt-2 font-display text-xl font-medium text-mist">{t('patient.planTitle')}</h2>
            <ul className="mt-5 space-y-4">
              {goals.map((g) => (
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
                  {g.targetMetric && <p className="mt-1 text-[11px] text-mist/40">{g.targetMetric}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Outcomes trend — live only */}
        {outcomeGroups.length > 0 && (
          <section className="card p-6">
            <p className="eyebrow">{t('patient.outcomesEyebrow')}</p>
            <h2 className="mt-2 font-display text-xl font-medium text-mist">{t('patient.outcomesTitle')}</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {outcomeGroups.map(({ construct, series }) => {
                const latest = series[series.length - 1];
                const dirKey = TREND_KEY[latest.trend.direction] ?? 'common.trendBaseline';
                return (
                  <div key={construct} className="card-inset p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{construct}</p>
                      <p className="font-display text-xl font-semibold text-mist">
                        {fmtNumber(latest.value, { maximumFractionDigits: 1 })}
                      </p>
                    </div>
                    <div className="mt-2 text-teal" dir="ltr">
                      <Sparkline values={series.map((p) => p.value)} className="h-6 w-full" />
                    </div>
                    <p className="mt-2 text-[11px] text-mist/50">
                      {t(dirKey)}
                      {latest.trend.delta !== null && (
                        <span className="ms-1 font-mono text-teal-soft/80">
                          {latest.trend.delta > 0 ? '+' : ''}
                          {fmtNumber(latest.trend.delta, { maximumFractionDigits: 1 })}
                        </span>
                      )}
                      <span className="ms-1 text-mist/35">· {fmtDate(new Date(latest.occurredAt), { day: 'numeric', month: 'short' })}</span>
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Mood check-in — the patient's own point on the signal */}
        <section className="card p-6">
          <p className="eyebrow">{t('patient.moodEyebrow')}</p>
          <h2 className="mt-2 font-display text-xl font-medium text-mist">{t('patient.moodTitle')}</h2>
          <div className="mt-5 grid grid-cols-5 gap-2" role="radiogroup" aria-label={t('patient.moodTitle')}>
            {dict.patient.moodLevels.map((label, i) => {
              const level = i + 1;
              const active = mood === level;
              return (
                <button
                  key={label}
                  role="radio"
                  aria-checked={active}
                  onClick={() => pickMood(level)}
                  className={`flex flex-col items-center gap-2 rounded-xl border px-1 py-3 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-soft ${
                    active
                      ? 'border-teal/60 bg-teal/10'
                      : 'border-white/[0.08] bg-console-950/40 hover:border-teal/30'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`block rounded-full transition-all ${active ? 'bg-teal' : 'bg-console-500'}`}
                    style={{ width: `${8 + i * 3}px`, height: `${8 + i * 3}px` }}
                  />
                  <span className={`text-center text-[11px] leading-tight ${active ? 'text-teal-soft' : 'text-mist/55'}`}>
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
          {loaded && mood !== null && (
            <p role="status" className="mt-4 text-sm text-teal-soft/90">{t('patient.moodSaved')}</p>
          )}

          {/* 7-day mood signal */}
          <div className="mt-6 border-t border-white/[0.06] pt-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{t('patient.moodWeek')}</p>
            <div className="mt-3 flex h-16 items-end gap-2" dir="ltr" aria-hidden>
              {weekSignal.map((v, i) => (
                <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1.5 self-stretch">
                  {v === null ? (
                    <span className="mb-1 text-xs text-mist/25">—</span>
                  ) : (
                    <div
                      className={`w-full max-w-[28px] rounded-t-md ${i === weekSignal.length - 1 ? 'bg-teal' : 'bg-teal/35'}`}
                      style={{ height: `${(v / 5) * 100}%` }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Exercises */}
        <section className="card p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">{t('patient.exercisesEyebrow')}</p>
              <h2 className="mt-2 font-display text-xl font-medium text-mist">
                {t('patient.exercisesTitle', { name: MOCK_NEXT_SESSION.clinicianName })}
              </h2>
            </div>
            <span className="chip text-teal-soft/80">
              {t('patient.progress', { done: fmtNumber(doneCount), total: fmtNumber(MOCK_EXERCISES.length) })}
            </span>
          </div>
          <ul className="mt-5 space-y-3">
            {MOCK_EXERCISES.map((ex) => {
              const done = doneIds.includes(ex.id);
              return (
                <li key={ex.id} className={`card-inset flex items-start justify-between gap-4 p-4 ${done ? 'opacity-70' : ''}`}>
                  <div>
                    <p className={`font-medium ${done ? 'text-mist/60 line-through' : 'text-mist'}`}>{ex.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-mist/50">{ex.detail}</p>
                    <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-mist/35">
                      {fmtNumber(ex.minutes)} min
                    </p>
                  </div>
                  <button
                    onClick={() => toggleExercise(ex.id)}
                    aria-pressed={done}
                    className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-soft ${
                      done
                        ? 'border-teal/40 bg-teal/10 text-teal-soft'
                        : 'border-white/10 text-mist/70 hover:border-teal/40 hover:text-mist'
                    }`}
                  >
                    {done ? `✓ ${t('patient.done')}` : t('patient.markDone')}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Wearable insight — longitudinal rollup when live, snapshot mock otherwise */}
        <section className="card p-6">
          <p className="eyebrow">{t('patient.wearableEyebrow')}</p>
          <h2 className="mt-2 font-display text-xl font-medium text-mist">
            {wearable
              ? t('patient.wearableRollupTitle', { n: fmtNumber(wearable.windowDays) })
              : t('patient.wearableTitle')}
          </h2>
          {wearable ? (
            <>
              <div className="mt-5 grid grid-cols-3 gap-4">
                <VitalTile
                  label={t('patient.avgHrv')}
                  value={wearable.avgHrvMs === null ? '—' : fmtNumber(Math.round(wearable.avgHrvMs))}
                  unit={wearable.avgHrvMs === null ? '' : t('patient.unitMs')}
                />
                <VitalTile
                  label={t('patient.avgSleep')}
                  value={
                    wearable.avgSleepHours === null
                      ? '—'
                      : fmtNumber(wearable.avgSleepHours, { maximumFractionDigits: 1 })
                  }
                  unit={wearable.avgSleepHours === null ? '' : t('patient.unitHours')}
                />
                <VitalTile
                  label={t('patient.restingHr')}
                  value={wearable.restingHrBpm === null ? '—' : fmtNumber(Math.round(wearable.restingHrBpm))}
                  unit={wearable.restingHrBpm === null ? '' : t('patient.unitBpm')}
                />
              </div>
              {wearable.series.length > 0 && (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="card-inset p-4">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{t('patient.hrvDaily')}</p>
                    <div className="mt-2 text-teal" dir="ltr">
                      <Sparkline values={wearable.series.map((d) => d.hrvMs)} className="h-8 w-full" />
                    </div>
                  </div>
                  <div className="card-inset p-4">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{t('patient.sleepDaily')}</p>
                    <div className="mt-2 text-teal-soft" dir="ltr">
                      <Sparkline
                        values={wearable.series.map((d) => d.sleepHours)}
                        className="h-8 w-full"
                        strokeClass="stroke-teal-soft"
                        dotClass="fill-teal-soft"
                      />
                    </div>
                  </div>
                </div>
              )}
              {wearable.arousalNote && (
                <p className="mt-4 rounded-xl border border-white/[0.08] bg-console-950/50 px-4 py-3 text-sm leading-relaxed text-mist/70">
                  {wearable.arousalNote}
                </p>
              )}
            </>
          ) : (
            <div className="mt-5 grid grid-cols-3 gap-4">
              <VitalTile
                label={t('patient.hrv')}
                value={MOCK_WEARABLE.hrvMs === null ? '—' : fmtNumber(MOCK_WEARABLE.hrvMs)}
                unit={MOCK_WEARABLE.hrvMs === null ? '' : t('patient.unitMs')}
              />
              <VitalTile label={t('patient.sleepLabel')} value={mockSleepText} unit="" />
              <VitalTile
                label={t('patient.restingHr')}
                value={MOCK_WEARABLE.restingHr === null ? '—' : fmtNumber(MOCK_WEARABLE.restingHr)}
                unit={MOCK_WEARABLE.restingHr === null ? '' : t('patient.unitBpm')}
              />
            </div>
          )}
          <p className="mt-4 text-xs leading-relaxed text-mist/45">{t('patient.wearableNote')}</p>
        </section>

        {/* Quick links */}
        <section>
          <p className="eyebrow">{t('patient.quickEyebrow')}</p>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {[
              [t('patient.assessments'), 'M9 12h6m-6 4h6M7 3h7l5 5v13H7a2 2 0 01-2-2V5a2 2 0 012-2z'],
              [t('patient.reports'), 'M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14M9 8h6M9 12h6M9 16h4'],
              [t('patient.messages'), 'M21 11.5a8.38 8.38 0 01-8.5 8.4 8.5 8.5 0 01-3.8-.9L3 21l2-5.7a8.4 8.4 0 116-3.8'],
            ].map(([label, icon]) => (
              <button
                key={label}
                className="card flex flex-col items-center gap-2 p-4 text-center transition hover:border-teal/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-soft"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-teal-soft/80" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d={icon} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-xs text-mist/70">{label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Emergency help — calm, always reachable, unmistakable */}
        <section className="rounded-2xl border border-signal/25 bg-signal/[0.06] p-6">
          <p className="eyebrow text-signal-soft/90">{t('patient.helpEyebrow')}</p>
          <h2 className="mt-2 font-display text-xl font-medium text-mist">{t('patient.helpTitle')}</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-mist/60">{t('patient.helpBody')}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="tel:988"
              className="inline-flex items-center gap-2 rounded-xl bg-signal px-5 py-2.5 text-sm font-medium text-console-950 transition hover:bg-signal-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-soft"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 2 .7 2.9a2 2 0 01-.5 2.1L8 10a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.3 1.9.6 2.9.7a2 2 0 011.7 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('patient.helpCall')}
            </a>
            <button className="inline-flex items-center gap-2 rounded-xl border border-signal/40 px-5 py-2.5 text-sm font-medium text-signal-soft transition hover:bg-signal/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal-soft">
              {t('patient.helpChat')}
            </button>
          </div>
          <p className="mt-4 text-xs text-mist/50">{t('patient.helpEmergency')}</p>
        </section>
      </div>
    </div>
  );
}

function VitalTile({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="card-inset p-4 text-center">
      <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{label}</p>
      <p className="mt-1.5 font-display text-2xl font-semibold text-mist">
        {value}
        {unit && <span className="ms-1 text-sm font-normal text-mist/50">{unit}</span>}
      </p>
    </div>
  );
}
