'use client';

/**
 * Clinician assignment browser (doc 07 §9): paste a caseload client's record
 * ID (the same pattern the CAT and risk pages use — there is deliberately no
 * cross-context client search here), load their assignments, cancel open ones,
 * and expand COMPLETED rows into the full results view.
 */
import { useState } from 'react';
import type { AssessmentAssignmentDto, InstrumentGuide } from '@vpsy/contracts';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { SkeletonStack } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import { AssignmentResults } from './AssignmentResults';

export function ClientAssignmentBrowser({
  guideFor,
}: {
  /** Scoring-key guide lookup by instrument code (from the loaded catalog). */
  guideFor: (instrumentCode: string) => InstrumentGuide | null;
}) {
  const { t, dict, fmtDate, fmtNumber } = useI18n();

  const [clientId, setClientId] = useState('');
  const [rows, setRows] = useState<AssessmentAssignmentDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openResultId, setOpenResultId] = useState<string | null>(null);
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null);
  const [cancelErr, setCancelErr] = useState<{ id: string; msg: string } | null>(null);

  async function load() {
    const id = clientId.trim();
    if (!id || busy) return;
    setBusy(true);
    setErr(null);
    setOpenResultId(null);
    try {
      const list = await api.clientAssignments(id);
      setRows([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch (e) {
      // Unknown ≠ empty: a failed read never renders as "no assignments".
      setRows(null);
      setErr(e instanceof ApiError ? t('assess.browseFailed') : t('assess.errNetwork'));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    if (cancelBusyId) return;
    if (typeof window !== 'undefined' && !window.confirm(t('assess.cancelConfirm'))) return;
    setCancelBusyId(id);
    setCancelErr(null);
    try {
      const updated = await api.cancelAssignment(id);
      setRows((prev) => prev?.map((r) => (r.id === id ? updated : r)) ?? null);
    } catch {
      setCancelErr({ id, msg: t('assess.cancelFailed') });
    } finally {
      setCancelBusyId(null);
    }
  }

  return (
    <section>
      <div className="card p-5">
        <p className="eyebrow">{t('assess.browseEyebrow')}</p>
        <label htmlFor="browse-client-id" className="field-label mt-4">
          {t('assess.clientIdLabel')}
        </label>
        <div className="flex flex-wrap items-stretch gap-2">
          <input
            id="browse-client-id"
            className="field min-w-0 flex-1 font-mono text-xs"
            dir="ltr"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void load();
            }}
          />
          <button
            type="button"
            className="btn-primary shrink-0 disabled:opacity-60"
            disabled={clientId.trim().length === 0 || busy}
            onClick={() => void load()}
          >
            {busy ? t('assess.browsing') : t('assess.browse')}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-mist/45">{t('assess.browseHint')}</p>
        {err && (
          <p role="alert" className="mt-3 text-sm text-risk">
            {err}
          </p>
        )}
      </div>

      {busy && <SkeletonStack count={2} className="mt-4 space-y-3" />}

      {!busy && rows && rows.length === 0 && <EmptyState className="mt-4" body={t('assess.browseEmpty')} />}

      {!busy && rows && rows.length > 0 && (
        <ul className="mt-4 space-y-3">
          {rows.map((a) => {
            const statusCls =
              a.status === 'COMPLETED'
                ? 'border-teal/25 text-teal-soft'
                : a.status === 'CANCELLED'
                  ? 'border-line/20 text-mist/45'
                  : 'border-line/25 text-mist/75';
            const resultsOpen = openResultId === a.id;
            return (
              <li key={a.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="chip" dir="ltr">{a.instrumentCode}</span>
                      <h3 className="font-display text-base font-medium text-mist">{a.instrumentName}</h3>
                    </div>
                    <p className="mt-1.5 text-[11px] text-mist/50">
                      {a.construct} · <span className="figure" dir="ltr">{fmtNumber(a.itemCount)}</span>{' '}
                      {t('assess.itemsUnit')}
                    </p>
                    <p className="mt-1 text-[11px] text-mist/45">
                      {t('assess.assignedOn', { date: fmtDate(a.createdAt, { day: 'numeric', month: 'short' }) })}
                      {a.dueAt && (
                        <> · {t('assess.dueBy', { date: fmtDate(a.dueAt, { day: 'numeric', month: 'short' }) })}</>
                      )}
                      {a.completedAt && (
                        <> · {t('assess.completedOn', { date: fmtDate(a.completedAt, { day: 'numeric', month: 'short' }) })}</>
                      )}
                    </p>
                  </div>
                  <span className={`chip shrink-0 border ${statusCls}`}>{dict.assess.statuses[a.status]}</span>
                </div>

                {a.note && <p className="card-inset mt-3 px-3.5 py-2.5 text-sm leading-relaxed text-mist/70">{a.note}</p>}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {a.status === 'ASSIGNED' && (
                    <button
                      type="button"
                      className="btn-ghost text-xs disabled:opacity-60"
                      disabled={cancelBusyId === a.id}
                      onClick={() => void cancel(a.id)}
                    >
                      {cancelBusyId === a.id ? t('assess.cancelling') : t('assess.cancel')}
                    </button>
                  )}
                  {a.status === 'COMPLETED' && (
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      aria-expanded={resultsOpen}
                      onClick={() => setOpenResultId(resultsOpen ? null : a.id)}
                    >
                      {resultsOpen ? t('assess.hideReview') : t('assess.review')}
                    </button>
                  )}
                </div>
                {cancelErr?.id === a.id && (
                  <p role="alert" className="mt-2 text-xs text-risk">
                    {cancelErr.msg}
                  </p>
                )}

                {resultsOpen && (
                  <div className="hairline-t mt-4 pt-4">
                    <AssignmentResults assignmentId={a.id} guide={guideFor(a.instrumentCode)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
