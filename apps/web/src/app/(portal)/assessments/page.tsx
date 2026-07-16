'use client';

/**
 * Assessments — role-aware entry (doc 07 §9 + psychometrics §6).
 *
 * Three surfaces behind one route:
 *  - `?version=<id>` deep-link → the adaptive (CAT) flow below, unchanged.
 *    That link is how a clinician launches CAT for a client.
 *  - CLIENT (no assessment:interpret) → "My assessments": the assignments a
 *    clinician created for them, each completed as a calm static form.
 *  - Clinician (assessment:interpret) → assign panel + client assignment
 *    browser with the full results review (answers, deterministic score,
 *    scoring key, governed AI briefing).
 *
 * Result gating (interpretationMode = CLINICIAN_ONLY, doc 07 §"score
 * suppression"): a CLIENT completing their own assessment sees a calm
 * completion note — never the score, band, or interpretation text. Only a
 * principal holding assessment:interpret (clinician) sees the numbers.
 */
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Permission, type CatSessionStateDto } from '@vpsy/contracts';
import { api, getPrincipal, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { SkeletonCard } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { MyAssessments } from '@/components/assessments/MyAssessments';
import { ClinicianAssessments } from '@/components/assessments/ClinicianAssessments';
import { SeverityChip } from '@/components/assessments/SeverityChip';

/** Doc §6 stopping rule — the only honest upper bound we can show. */
const MAX_ITEMS = 12;

export default function AssessmentsPage() {
  // useSearchParams requires a Suspense boundary in the app router.
  return (
    <Suspense fallback={<SkeletonCard className="mt-6" />}>
      <AssessmentsRouter />
    </Suspense>
  );
}

function AssessmentsRouter() {
  const searchParams = useSearchParams();
  // The CAT deep-link keeps its historical meaning — launch the adaptive flow.
  const hasVersionDeepLink = !!searchParams?.get('version');

  // Role resolution is hydration-safe: the principal hint lives in
  // localStorage, so the first client render matches SSR (resolving), then an
  // effect branches. This is UI routing only — the API re-authorizes every call.
  const [role, setRole] = useState<'resolving' | 'clinician' | 'client'>('resolving');
  useEffect(() => {
    const p = getPrincipal();
    setRole(p?.permissions.includes(Permission.ASSESSMENT_INTERPRET) ? 'clinician' : 'client');
  }, []);

  if (hasVersionDeepLink) return <CatFlow />;
  if (role === 'resolving') return <SkeletonCard className="mt-6" />;
  return role === 'clinician' ? <ClinicianAssessments /> : <MyAssessments />;
}

function CatFlow() {
  const { t, dict, fmtNumber } = useI18n();
  const searchParams = useSearchParams();

  const [canInterpret, setCanInterpret] = useState(false);
  const [isClientRole, setIsClientRole] = useState(false);
  useEffect(() => {
    const p = getPrincipal();
    setCanInterpret(p?.permissions.includes(Permission.ASSESSMENT_INTERPRET) ?? false);
    setIsClientRole(p?.roles.includes('CLIENT') ?? false);
  }, []);

  // ── Who is being assessed ──
  // CLIENT: their own client id, resolved from /clients/me.
  // Clinician: pastes the client id (they administer for someone else).
  const [ownClientId, setOwnClientId] = useState<string | null>(null);
  const [ownIdResolved, setOwnIdResolved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api
      .clientMe()
      .then((s) => {
        if (!cancelled) setOwnClientId(s.client.id);
      })
      .catch(() => {
        /* not a client (staff) — the manual field below covers it */
      })
      .finally(() => {
        if (!cancelled) setOwnIdResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [versionId, setVersionId] = useState('');
  const [manualClientId, setManualClientId] = useState('');
  useEffect(() => {
    const v = searchParams?.get('version');
    if (v) setVersionId(v);
  }, [searchParams]);

  const [session, setSession] = useState<CatSessionStateDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  const effectiveClientId = ownClientId ?? manualClientId.trim();
  const canStart = versionId.trim().length > 0 && effectiveClientId.length > 0 && !busy;

  async function start() {
    if (!canStart) return;
    setBusy(true);
    setErr(null);
    try {
      const s = await api.catStart(versionId.trim(), effectiveClientId);
      setSession(s);
      setPicked(null);
    } catch (e) {
      setErr(e instanceof ApiError ? t('cat.startFailed') : t('cat.errNetwork'));
    } finally {
      setBusy(false);
    }
  }

  async function answer() {
    if (!session?.nextItem || picked === null || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const s = await api.catAnswer(session.sessionId, session.nextItem.itemId, picked);
      setSession(s);
      setPicked(null);
    } catch (e) {
      setErr(e instanceof ApiError ? t('cat.answerFailed') : t('cat.errNetwork'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl xl:mx-0">
      <p className="eyebrow">{t('cat.eyebrow')}</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('cat.title')}</h1>
      <p className="mt-3 text-sm leading-relaxed text-mist/60">{t('cat.intro')}</p>
      {isClientRole && <p className="mt-2 text-xs leading-relaxed text-mist/45">{t('cat.crisisNote')}</p>}

      {/* ── Not started: the begin panel ── */}
      {!session && (
        <section className="card mt-6 p-5">
          <p className="eyebrow">{t('cat.startEyebrow')}</p>
          <label htmlFor="cat-version" className="field-label mt-4">{t('cat.versionLabel')}</label>
          <input
            id="cat-version"
            className="field font-mono text-xs"
            dir="ltr"
            value={versionId}
            onChange={(e) => setVersionId(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-mist/45">{t('cat.versionHint')}</p>

          {/* Staff administering for a client name the client explicitly. */}
          {ownIdResolved && !ownClientId && (
            <>
              <label htmlFor="cat-client-id" className="field-label mt-4">{t('cat.clientIdLabel')}</label>
              <input
                id="cat-client-id"
                className="field font-mono text-xs"
                dir="ltr"
                value={manualClientId}
                onChange={(e) => setManualClientId(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-mist/45">{t('cat.clientIdHint')}</p>
            </>
          )}

          <button type="button" onClick={start} disabled={!canStart} className="btn-primary mt-5 disabled:opacity-60">
            {busy ? t('cat.starting') : t('cat.start')}
          </button>
          {err && <p role="alert" className="mt-3 text-sm text-risk">{err}</p>}
        </section>
      )}

      {/* ── Active: one item, single focus ── */}
      {session && session.status === 'ACTIVE' && session.nextItem && (
        <section className="card relative mt-6 overflow-hidden p-6">
          <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />
          <div className="relative">
            <div className="flex items-baseline justify-between gap-3">
              <p className="eyebrow">{t('cat.questionEyebrow')}</p>
              <p className="font-mono text-[11px] uppercase tracking-wider text-haze" dir="ltr">
                {t('cat.itemProgress', { n: fmtNumber(session.itemsAnswered) })}{' '}
                <span className="text-haze/80">{t('cat.itemProgressMax', { max: fmtNumber(MAX_ITEMS) })}</span>
              </p>
            </div>

            <h2 className="mt-4 font-display text-xl font-medium leading-snug text-mist">
              {session.nextItem.stem}
            </h2>

            <div role="radiogroup" aria-label={session.nextItem.stem} className="mt-6 space-y-2">
              {Array.isArray(session.nextItem.responseOptions) &&
                (session.nextItem.responseOptions as unknown[]).map((opt, i) =>
                  typeof opt === 'string' ? (
                    <button
                      key={i}
                      type="button"
                      role="radio"
                      aria-checked={picked === i}
                      onClick={() => setPicked(i)}
                      className={`w-full rounded-md border p-3.5 text-start text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal ${
                        picked === i
                          ? 'border-teal/60 bg-teal/10 text-mist'
                          : 'border-line/20 bg-console-700/40 text-mist/80 hover:border-line/40'
                      }`}
                    >
                      {opt}
                    </button>
                  ) : null,
                )}
            </div>

            <p className="mt-3 text-[11px] text-mist/45">{t('cat.answerRequired')}</p>
            <button
              type="button"
              onClick={answer}
              disabled={picked === null || busy}
              className="btn-primary mt-4 disabled:opacity-60"
            >
              {busy ? t('cat.submitting') : t('cat.submitAnswer')}
            </button>
            {err && <p role="alert" className="mt-3 text-sm text-risk">{err}</p>}
          </div>
        </section>
      )}

      {/* ── Completed ── */}
      {session && session.status === 'COMPLETED' && (
        <div className="mt-6 space-y-4">
          <section className="card p-6">
            <p className="eyebrow">{t('cat.doneEyebrow')}</p>
            <h2 className="mt-3 font-display text-xl font-semibold text-mist">{t('cat.doneTitle')}</h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-mist/70">{t('cat.doneBodyClient')}</p>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-haze" dir="ltr">
              {t('cat.doneItems', { n: fmtNumber(session.itemsAnswered) })}
            </p>
            <Link href="/home" className="btn-ghost mt-5 inline-flex text-sm">
              {t('cat.backHome')}
            </Link>
          </section>

          {/* Clinician-only score presentation — same gate as the batch path. */}
          {canInterpret && session.score && (
            <section className="card p-5">
              <p className="eyebrow">{t('cat.clinicianResultEyebrow')}</p>
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-haze">{t('cat.theta')}</p>
                  <p className="figure mt-1 text-lg text-mist" dir="ltr">
                    {session.score.thetaEstimate === null ? '—' : fmtNumber(session.score.thetaEstimate, { maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-haze">{t('cat.se')}</p>
                  <p className="figure mt-1 text-lg text-mist" dir="ltr">
                    {session.score.standardError === null ? '—' : fmtNumber(session.score.standardError, { maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-haze">{t('cat.band')}</p>
                  <p className="mt-1">
                    {session.score.severityBand ? (
                      <SeverityChip band={session.score.severityBand} />
                    ) : (
                      <span className="text-mist/45">—</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-haze">{t('cat.stopReason')}</p>
                  <p className="mt-1 text-xs text-mist/75">
                    {session.terminationReason ? dict.cat.stopReasons[session.terminationReason] : '—'}
                  </p>
                </div>
              </div>
              {session.score.interpretation && (
                <div className="card-inset mt-4 p-3.5">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-haze">{t('cat.interpretation')}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-mist/80">{session.score.interpretation}</p>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Session started but the bank had nothing to serve — honest edge. */}
      {session && session.status === 'ACTIVE' && !session.nextItem && (
        <EmptyState className="mt-6" body={t('cat.notCat')} />
      )}
    </div>
  );
}
