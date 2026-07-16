'use client';

/**
 * Clinician assign panel (doc 07 §9): pick a published instrument from the
 * license-aware catalog, name the caseload client, optionally add a note and
 * due date, and assign.
 *
 * Honest gating mirrors the API exactly:
 *  - only entries with `administerAllowed && latestPublishedVersionId` are
 *    selectable;
 *  - `scoringMethod === 'CAT'` instruments are NOT assignable (the API rejects
 *    them) — they carry an honest note and a real deep-link into the adaptive
 *    flow instead;
 *  - license problems (missing/expired/revoked) render as attention chips,
 *    never silently hidden.
 */
import { useState } from 'react';
import type { InstrumentCatalogEntry } from '@vpsy/contracts';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { SkeletonCard } from '@/components/Skeleton';
import { ErrorPanel } from '@/components/ErrorPanel';
import { EmptyState } from '@/components/EmptyState';

function isAssignable(e: InstrumentCatalogEntry): boolean {
  return e.administerAllowed && !!e.latestPublishedVersionId && e.scoringMethod !== 'CAT';
}

export function AssignPanel({
  catalog,
  loading,
  error,
  onRetry,
}: {
  catalog: InstrumentCatalogEntry[] | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const { t, dict } = useI18n();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clientId, setClientId] = useState('');
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const selected = catalog?.find((e) => e.questionnaireId === selectedId) ?? null;
  const canAssign = !!selected && isAssignable(selected) && clientId.trim().length > 0 && !busy;

  async function assign() {
    if (!canAssign || !selected?.latestPublishedVersionId) return;
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    try {
      await api.assignAssessment({
        clientId: clientId.trim(),
        versionId: selected.latestPublishedVersionId,
        note: note.trim() ? note.trim() : undefined,
        // Date-only input → end of that local day, sent as ISO UTC.
        dueAt: due ? new Date(`${due}T23:59:00`).toISOString() : undefined,
      });
      setOkMsg(t('assess.assignedOk', { name: selected.name }));
      setNote('');
      setDue('');
    } catch (e) {
      setErr(e instanceof ApiError ? t('assess.assignFailed') : t('assess.errNetwork'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <p className="eyebrow">{t('assess.assignEyebrow')}</p>

      {loading && <SkeletonCard className="mt-4" />}
      {!loading && error && <ErrorPanel className="mt-4" message={t('assess.errNetwork')} onRetry={onRetry} />}

      {!loading && !error && catalog && (
        <>
          {catalog.length === 0 ? (
            <EmptyState className="mt-4" body={t('assess.catalogEmpty')} />
          ) : (
            <>
              <p className="field-label mt-4">{t('assess.instrumentLabel')}</p>
              <div
                role="radiogroup"
                aria-label={t('assess.instrumentLabel')}
                className="max-h-80 space-y-2 overflow-y-auto pe-1"
              >
                {catalog.map((e) => {
                  const assignable = isAssignable(e);
                  const active = selectedId === e.questionnaireId;
                  const isCat = e.scoringMethod === 'CAT';
                  const licenseBad =
                    e.licenseGrantStatus === 'missing' ||
                    e.licenseGrantStatus === 'expired' ||
                    e.licenseGrantStatus === 'revoked';
                  return (
                    <div
                      key={e.questionnaireId}
                      className={`rounded-md border transition ${
                        active
                          ? 'border-teal/60 bg-teal/10'
                          : 'border-line/20 bg-console-700/40'
                      } ${assignable ? 'hover:border-line/40' : 'opacity-80'}`}
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={!assignable || busy}
                        onClick={() => setSelectedId(e.questionnaireId)}
                        className="w-full p-3 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal disabled:cursor-not-allowed"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="chip" dir="ltr">{e.code}</span>
                          <span className={`text-sm font-medium ${assignable ? 'text-mist' : 'text-mist/55'}`}>
                            {e.name}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[11px] text-mist/50">
                          {e.construct} · {e.licensing}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {licenseBad ? (
                            <span className="chip-signal">
                              {dict.assess.licenseStatuses[e.licenseGrantStatus]}
                            </span>
                          ) : (
                            <span className="chip text-mist/60">
                              {dict.assess.licenseStatuses[e.licenseGrantStatus]}
                            </span>
                          )}
                          {!e.latestPublishedVersionId && (
                            <span className="chip text-mist/60">{t('assess.noPublishedVersion')}</span>
                          )}
                        </div>
                        {isCat && (
                          <p className="mt-2 text-[11px] leading-relaxed text-mist/55">{t('assess.adaptiveOnly')}</p>
                        )}
                      </button>
                      {/* CAT deep-link — a real destination (the adaptive flow), outside
                          the radio button so keyboard focus order stays sane. */}
                      {isCat && e.administerAllowed && e.latestPublishedVersionId && (
                        <div className="px-3 pb-3">
                          <a
                            href={`/assessments?version=${encodeURIComponent(e.latestPublishedVersionId)}`}
                            className="text-xs font-medium text-teal underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
                          >
                            {t('assess.openAdaptive')}
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <label htmlFor="assign-client-id" className="field-label mt-5">
                {t('assess.clientIdLabel')}
              </label>
              <input
                id="assign-client-id"
                className="field font-mono text-xs"
                dir="ltr"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                disabled={busy}
              />
              <p className="mt-1 text-[11px] text-mist/45">{t('assess.clientIdHint')}</p>

              <label htmlFor="assign-note" className="field-label mt-4">
                {t('assess.noteLabel')}
              </label>
              <textarea
                id="assign-note"
                className="field min-h-[56px] text-sm"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
              />

              <label htmlFor="assign-due" className="field-label mt-4">
                {t('assess.dueAtLabel')}
              </label>
              <input
                id="assign-due"
                type="date"
                className="field font-mono text-xs"
                dir="ltr"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                disabled={busy}
              />

              <button
                type="button"
                className="btn-primary mt-5 disabled:opacity-60"
                disabled={!canAssign}
                onClick={() => void assign()}
              >
                {busy ? t('assess.assigning') : t('assess.assign')}
              </button>
              {okMsg && (
                <p role="status" className="mt-3 text-sm text-teal-soft">
                  {okMsg}
                </p>
              )}
              {err && (
                <p role="alert" className="mt-3 text-sm text-risk">
                  {err}
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
