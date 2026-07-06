'use client';

/**
 * Patient PWA home — the client's calm daily surface.
 *
 * Wired entirely to the live clinical read model: GET /clients/me →
 * ClinicalSummary, using whichever role's token is already on file from a
 * real /login sign-in (this page never signs anyone in itself — a token
 * carries exactly one role in production, and the portal layout redirects
 * here only after authentication). There is no fallback-to-fake path —
 * every section renders one of three honest states: loading (skeleton),
 * error (a real failure + retry), or the live data (which may itself be
 * empty, e.g. no next session yet). The mood check-in persists to the
 * outcome record (POST /outcomes) with localStorage kept only as a same-day
 * echo of the pick. Homework/exercises have no backend yet (Intervention
 * Tracking, context 19, is not built) so that section is an honest
 * "nothing here yet" placeholder — never fabricated content.
 *
 * Command Center flagship: the wearable rollup + quick links live in the
 * shell's context panel (<ContextPanel>); figures are mono/tabular.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import { api, getToken, ApiError } from '@/lib/api';
import type { ClinicalSummary, OutcomePoint, TrendDirection } from '@/lib/clinical-types';
import { Sparkline } from '@/components/Sparkline';
import { useResource } from '@/lib/use-resource';
import { ContextPanel } from '@/components/ContextPanel';
import { SkeletonStack } from '@/components/Skeleton';
import { ErrorPanel } from '@/components/ErrorPanel';
import { EmptyState } from '@/components/EmptyState';
import { StatTile } from '@/components/StatTile';

const MOOD_KEY_PREFIX = 'vpsy.mood.';

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

/** Last 7 calendar days (oldest → newest) of real 'mood' outcomes; null = no check-in that day. */
function buildMoodWeek(outcomes: OutcomePoint[]): (number | null)[] {
  const byDay = new Map<string, number>();
  for (const o of outcomes) {
    if (o.construct !== 'mood') continue;
    byDay.set(o.occurredAt.slice(0, 10), o.value);
  }
  const days: (number | null)[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push(byDay.has(key) ? byDay.get(key)! : null);
  }
  return days;
}

async function fetchPatientSummary(): Promise<ClinicalSummary | null> {
  // No session on file — the effect below is redirecting to /login; skip the call.
  if (!getToken()) return null;
  return api.clientMe();
}

export default function PatientHomePage() {
  const { t, dict, fmtDate, fmtTime, fmtNumber, fmtPercent } = useI18n();
  const router = useRouter();

  // A real session is required — this page never signs anyone in itself.
  useEffect(() => {
    if (!getToken()) router.replace('/login');
  }, [router]);

  // ── Live clinical summary — no fallback-to-fake; three honest states only ──
  const { data: summary, loading, error, reload } = useResource(fetchPatientSummary, []);

  // ── Mood check-in — persists to the outcome record; localStorage is only a same-day echo ──
  const [localMood, setLocalMood] = useState<number | null>(null);
  const [moodBusy, setMoodBusy] = useState(false);
  const [moodError, setMoodError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const m = localStorage.getItem(todayKey());
      if (m) setLocalMood(Number(m));
    } catch {
      /* storage unavailable — the page still works */
    }
    setHydrated(true);
  }, []);

  async function pickMood(level: number) {
    if (!summary || moodBusy) return;
    setMoodBusy(true);
    setMoodError(null);
    try {
      await api.recordOutcome(summary.client.id, 'mood', level);
      try {
        localStorage.setItem(todayKey(), String(level));
      } catch {}
      setLocalMood(level);
      reload();
    } catch {
      setMoodError(t('patient.moodFailed'));
    } finally {
      setMoodBusy(false);
    }
  }

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? t('patient.greetingMorning') : hour < 18 ? t('patient.greetingAfternoon') : t('patient.greetingEvening');
  const firstName = summary?.client.displayName.split(' ')[0];

  const nextAppt = summary?.nextAppointment ?? null;
  const apptFormatLabel = (fmt: string) =>
    /video|virtual|online/i.test(fmt) ? t('patient.videoSession') : t('patient.inPersonSession');

  const goals = summary?.activePlan?.goals ?? [];
  const outcomeGroups = useMemo(() => (summary ? groupOutcomes(summary.outcomes) : []), [summary]);
  const wearable = summary?.wearable ?? null;
  const moodWeek = useMemo(() => buildMoodWeek(summary?.outcomes ?? []), [summary]);
  const todayMood = localMood ?? moodWeek[moodWeek.length - 1] ?? null;

  const statusLabel = loading ? t('common.loadingLive') : error ? t('common.connectionIssue') : t('common.liveData');
  const errorMessage = error instanceof ApiError ? t('patient.errStatus', { status: error.status }) : t('patient.errNetwork');

  return (
    <div className="mx-auto max-w-3xl xl:mx-0 xl:max-w-none">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{fmtDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-mist">
            {firstName ? `${greeting}, ${firstName}.` : `${greeting}.`}
          </h1>
          <p className="mt-1 text-sm text-mist/55">{t('patient.subtitle')}</p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-wider text-haze/70" role="status">
          {statusLabel}
        </p>
      </div>

      <div className="mt-6 space-y-4">
        {loading && <SkeletonStack count={3} />}

        {!loading && !!error && <ErrorPanel message={errorMessage} onRetry={reload} />}

        {!loading && !error && summary && (
          <>
            {/* Next session — the anchor card, on the hairline grid */}
            <section className="card relative overflow-hidden p-5">
              <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />
              <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="eyebrow">{t('patient.nextSessionEyebrow')}</p>
                  {!nextAppt ? (
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-mist/60">{t('patient.noUpcoming')}</p>
                  ) : (
                    <>
                      <p className="mt-2 font-display text-xl font-semibold text-mist">
                        {fmtDate(new Date(nextAppt.startsAt), { weekday: 'long', day: 'numeric', month: 'long' })}
                        {' · '}
                        <span className="figure">{fmtTime(new Date(nextAppt.startsAt))}</span>
                      </p>
                      <p className="mt-1 text-sm text-mist/60">{apptFormatLabel(nextAppt.format)}</p>
                      <p className="mt-2 text-xs text-mist/40">{t('patient.joinFrom')}</p>
                    </>
                  )}
                </div>
                {nextAppt && (
                  <div className="flex shrink-0 flex-col gap-2">
                    <button className="btn-primary">{t('patient.join')}</button>
                    <button className="btn-ghost">{t('patient.reschedule')}</button>
                  </div>
                )}
              </div>
            </section>

            {/* Active-plan goal progress */}
            {goals.length > 0 && (
              <section className="card p-5">
                <p className="eyebrow">{t('patient.planEyebrow')}</p>
                <h2 className="mt-1.5 font-display text-lg font-medium text-mist">{t('patient.planTitle')}</h2>
                <ul className="mt-4 space-y-4">
                  {goals.map((g) => (
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
                      {g.targetMetric && <p className="mt-1 text-[11px] text-mist/40">{g.targetMetric}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Outcomes trend */}
            {outcomeGroups.length > 0 && (
              <section className="card p-5">
                <p className="eyebrow">{t('patient.outcomesEyebrow')}</p>
                <h2 className="mt-1.5 font-display text-lg font-medium text-mist">{t('patient.outcomesTitle')}</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {outcomeGroups.map(({ construct, series }) => {
                    const latest = series[series.length - 1];
                    const dirKey = TREND_KEY[latest.trend.direction] ?? 'common.trendBaseline';
                    return (
                      <div key={construct} className="card-inset p-3.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="font-mono text-[10px] uppercase tracking-wider text-haze/90">{construct}</p>
                          <p className="figure text-xl font-medium text-mist" dir="ltr">
                            {fmtNumber(latest.value, { maximumFractionDigits: 1 })}
                          </p>
                        </div>
                        <div className="mt-2 text-teal" dir="ltr">
                          <Sparkline values={series.map((p) => p.value)} className="h-6 w-full" />
                        </div>
                        <p className="mt-2 text-[11px] text-mist/50">
                          {t(dirKey)}
                          {latest.trend.delta !== null && (
                            <span className="figure ms-1 text-mist/70" dir="ltr">
                              {latest.trend.delta > 0 ? '+' : ''}
                              {fmtNumber(latest.trend.delta, { maximumFractionDigits: 1 })}
                            </span>
                          )}
                          <span className="ms-1 text-mist/35">
                            · {fmtDate(new Date(latest.occurredAt), { day: 'numeric', month: 'short' })}
                          </span>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Mood check-in — the patient's own point on the signal, persisted to the outcome record */}
            <section className="card p-5">
              <p className="eyebrow">{t('patient.moodEyebrow')}</p>
              <h2 className="mt-1.5 font-display text-lg font-medium text-mist">{t('patient.moodTitle')}</h2>
              <div className="mt-4 grid grid-cols-5 gap-2" role="radiogroup" aria-label={t('patient.moodTitle')}>
                {dict.patient.moodLevels.map((label, i) => {
                  const level = i + 1;
                  const active = todayMood === level;
                  return (
                    <button
                      key={label}
                      role="radio"
                      aria-checked={active}
                      disabled={moodBusy}
                      onClick={() => pickMood(level)}
                      className={`flex flex-col items-center gap-2 rounded border px-1 py-3 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal disabled:opacity-60 ${
                        active
                          ? 'border-teal/70 bg-teal/10'
                          : 'border-line/15 bg-console-700/40 hover:border-line/35'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`block rounded-full transition-all ${active ? 'bg-teal' : 'bg-console-500'}`}
                        style={{ width: `${8 + i * 3}px`, height: `${8 + i * 3}px` }}
                      />
                      <span className={`text-center text-[11px] leading-tight ${active ? 'text-mist' : 'text-mist/55'}`}>
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {hydrated && todayMood !== null && (
                <p role="status" className="mt-4 text-sm text-mist/70">{t('patient.moodSaved')}</p>
              )}
              {moodError && (
                <p role="alert" className="mt-3 text-sm text-risk">{moodError}</p>
              )}

              {/* 7-day mood signal — derived from real 'mood' outcomes */}
              <div className="hairline-t mt-5 pt-4">
                <p className="font-mono text-[10px] uppercase tracking-wider text-haze/90">{t('patient.moodWeek')}</p>
                <div className="mt-3 flex h-16 items-end gap-2" dir="ltr" aria-hidden>
                  {moodWeek.map((v, i) => (
                    <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1.5 self-stretch">
                      {v === null ? (
                        <span className="mb-1 text-xs text-mist/25">—</span>
                      ) : (
                        <div
                          className={`w-full max-w-[28px] rounded-t-sm ${i === moodWeek.length - 1 ? 'bg-teal' : 'bg-teal/35'}`}
                          style={{ height: `${(v / 5) * 100}%` }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Exercises / homework — no backend yet (Intervention Tracking, context 19, is not built) */}
            <EmptyState eyebrow={t('patient.exercisesEyebrow')} body={t('patient.exercisesEmpty')} />
          </>
        )}

        {/* Emergency help — calm, always reachable, unmistakable. Stays in the
            main flow (never the collapsible panel) and uses the reserved
            risk/critical accent. */}
        <section className="rounded-md border border-signal/40 bg-signal/[0.06] p-5">
          <p className="eyebrow text-signal">{t('patient.helpEyebrow')}</p>
          <h2 className="mt-1.5 font-display text-lg font-medium text-mist">{t('patient.helpTitle')}</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-mist/60">{t('patient.helpBody')}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href="tel:988"
              className="inline-flex items-center gap-2 rounded bg-signal px-4 py-2 text-sm font-medium text-ink transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 2 .7 2.9a2 2 0 01-.5 2.1L8 10a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.3 1.9.6 2.9.7a2 2 0 011.7 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('patient.helpCall')}
            </a>
            {/* REAL crisis channel (clinical audit 2026-07-06, P0): this was a dead
                <button> with no handler — a visible but non-functional crisis
                control is a patient-safety hazard. Now links to the 988 Suicide &
                Crisis Lifeline's actual chat service. US-only; jurisdiction-aware
                localized crisis resources are the tracked follow-up. */}
            <a
              href="https://988lifeline.org/chat"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded border border-signal/50 px-4 py-2 text-sm font-medium text-signal transition hover:bg-signal/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
            >
              {t('patient.helpChat')}
            </a>
          </div>
          <p className="mt-4 text-xs text-mist/50">{t('patient.helpEmergency')}</p>
        </section>
      </div>

      {/* ── Context panel: wearable rollup + quick links ── */}
      <ContextPanel>
        <section className="card p-4">
          <p className="eyebrow">{t('patient.wearableEyebrow')}</p>
          {wearable ? (
            <>
              <h2 className="mt-1.5 text-sm font-medium text-mist">
                {t('patient.wearableRollupTitle', { n: fmtNumber(wearable.windowDays) })}
              </h2>
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
                <div className="mt-3 space-y-2">
                  <div className="card-inset p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-haze/90">{t('patient.hrvDaily')}</p>
                    <div className="mt-2 text-teal" dir="ltr">
                      <Sparkline values={wearable.series.map((d) => d.hrvMs)} className="h-7 w-full" />
                    </div>
                  </div>
                  <div className="card-inset p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-haze/90">{t('patient.sleepDaily')}</p>
                    <div className="mt-2 text-teal-soft" dir="ltr">
                      <Sparkline
                        values={wearable.series.map((d) => d.sleepHours)}
                        className="h-7 w-full"
                        strokeClass="stroke-teal-soft"
                        dotClass="fill-teal-soft"
                      />
                    </div>
                  </div>
                </div>
              )}
              {wearable.arousalNote && (
                <p className="card-inset mt-3 px-3 py-2.5 text-xs leading-relaxed text-mist/70">{wearable.arousalNote}</p>
              )}
              <p className="mt-3 text-[11px] leading-relaxed text-mist/45">{t('patient.wearableNote')}</p>
            </>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-mist/55">{t('patient.wearableEmpty')}</p>
          )}
        </section>

        {/* Quick links — static navigation, no clinical data */}
        <section className="card p-4">
          <p className="eyebrow">{t('patient.quickEyebrow')}</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              [t('patient.assessments'), 'M9 12h6m-6 4h6M7 3h7l5 5v13H7a2 2 0 01-2-2V5a2 2 0 012-2z'],
              [t('patient.reports'), 'M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14M9 8h6M9 12h6M9 16h4'],
              [t('patient.messages'), 'M21 11.5a8.38 8.38 0 01-8.5 8.4 8.5 8.5 0 01-3.8-.9L3 21l2-5.7a8.4 8.4 0 116-3.8'],
            ].map(([label, icon]) => (
              <button
                key={label}
                className="card-inset flex flex-col items-center gap-2 p-3 text-center transition hover:border-line/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-haze" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d={icon} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-[11px] leading-tight text-mist/70">{label}</span>
              </button>
            ))}
          </div>
        </section>
      </ContextPanel>
    </div>
  );
}
