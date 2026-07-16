'use client';

/**
 * Static take-assessment form (assignment workflow, doc 07 §9) — the client's
 * side of an assigned instrument. Calm, one screen, every item visible, with
 * an HONEST progress line ({answered} of {total} — the total is known here,
 * unlike CAT).
 *
 * Answer-key convention: render `opt.label`, record `opt.value` (never the
 * array index), keyed by `item.linkId ?? item.id` — see options.ts. The API
 * rejects incomplete submissions, so the submit button stays disabled until
 * every item is answered.
 *
 * Score suppression: on completion the client sees a calm thank-you — never a
 * score, band, or interpretation. Results are reviewed with the clinician.
 */
import { useMemo, useRef, useState } from 'react';
import type { AssessmentAssignmentDto, AssessmentItemDto } from '@vpsy/contracts';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useResource } from '@/lib/use-resource';
import { SkeletonStack } from '@/components/Skeleton';
import { ErrorPanel } from '@/components/ErrorPanel';
import { normalizeOptions } from './options';

function keyOf(item: AssessmentItemDto): string {
  return item.linkId ?? item.id;
}

export function TakeAssessmentForm({
  assignment,
  onExit,
}: {
  assignment: AssessmentAssignmentDto;
  onExit: () => void;
}) {
  const { t, locale, fmtDate, fmtNumber } = useI18n();

  const { data, loading, error, reload } = useResource(
    () => api.versionItems(assignment.versionId, locale),
    [assignment.versionId, locale],
  );

  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const startedAt = useRef<number>(Date.now());

  const items = useMemo(
    () => (data ? [...data.items].sort((a, b) => a.orderIndex - b.orderIndex) : []),
    [data],
  );
  const hasUnvalidated = items.some((it) => it.translationStatus === 'unvalidated-source-language');
  const answered = items.filter((it) => answers[keyOf(it)] !== undefined).length;
  const allAnswered = items.length > 0 && answered === items.length;

  async function submit() {
    if (!allAnswered || busy) return;
    setBusy(true);
    setErr(null);
    try {
      // Submit ALL items — the record is keyed by linkId (fallback: item id).
      const payload: Record<string, number> = {};
      for (const it of items) payload[keyOf(it)] = answers[keyOf(it)]!;
      await api.completeAssignment(assignment.id, payload, Date.now() - startedAt.current);
      setDone(true);
    } catch (e) {
      setErr(e instanceof ApiError ? t('assess.errStatus', { status: e.status }) : t('assess.submitFailed'));
    } finally {
      setBusy(false);
    }
  }

  // ── Completed: calm thank-you — NO score, band, or interpretation (client) ──
  if (done) {
    return (
      <section className="card relative overflow-hidden p-6">
        <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />
        <div className="relative">
          <p className="eyebrow">{t('assess.doneEyebrow')}</p>
          <h2 className="mt-3 font-display text-xl font-semibold text-mist">{t('assess.doneTitle')}</h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-mist/70">{t('cat.doneBodyClient')}</p>
          <button type="button" className="btn-ghost mt-5" onClick={onExit}>
            {t('assess.backToList')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div>
      {/* Header: what this is + honest progress */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{t('assess.formEyebrow')}</p>
          <h2 className="mt-2 font-display text-xl font-semibold text-mist">{assignment.instrumentName}</h2>
          {assignment.dueAt && (
            <p className="mt-1 text-xs text-mist/50">
              {t('assess.dueBy', { date: fmtDate(assignment.dueAt, { day: 'numeric', month: 'long' }) })}
            </p>
          )}
        </div>
        <button type="button" className="btn-ghost shrink-0" onClick={onExit} disabled={busy}>
          {t('common.back')}
        </button>
      </div>

      {assignment.note && (
        <div className="card-inset mt-4 px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-haze/90">{t('assess.noteFromClinician')}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-mist/80">{assignment.note}</p>
        </div>
      )}

      {loading && <SkeletonStack count={3} className="mt-6 space-y-3" />}
      {!loading && !!error && (
        <ErrorPanel className="mt-6" message={t('assess.itemsLoadFailed')} onRetry={reload} />
      )}

      {!loading && !error && data && (
        <>
          {hasUnvalidated && (
            <p className="card-inset mt-4 px-4 py-3 text-xs leading-relaxed text-mist/60" role="note">
              {t('assess.translationNotice')}
            </p>
          )}

          {/* Honest progress: total is known for a static form */}
          <div className="mt-6" aria-hidden>
            <div className="h-1 overflow-hidden rounded-full bg-console-600" dir="ltr">
              <div
                className="h-full rounded-full bg-teal transition-all"
                style={{ width: `${items.length ? (answered / items.length) * 100 : 0}%` }}
              />
            </div>
          </div>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-haze" role="status" dir="ltr">
            {t('assess.formProgress', { answered: fmtNumber(answered), total: fmtNumber(items.length) })}
          </p>

          <ol className="mt-4 space-y-4">
            {items.map((item, idx) => {
              const k = keyOf(item);
              const opts = normalizeOptions(item.responseOptions);
              const stemId = `assess-item-${item.id}`;
              return (
                <li key={item.id} className="card p-5">
                  <p className="flex items-baseline gap-2.5">
                    <span className="figure shrink-0 text-xs text-teal-soft" dir="ltr">
                      {fmtNumber(idx + 1)}
                    </span>
                    <span id={stemId} className="font-display text-base font-medium leading-snug text-mist">
                      {item.stem}
                    </span>
                  </p>
                  <div role="radiogroup" aria-labelledby={stemId} className="mt-4 space-y-2">
                    {opts.map((opt) => {
                      const active = answers[k] === opt.value;
                      return (
                        <button
                          key={`${opt.value}:${opt.label}`}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          disabled={busy}
                          onClick={() => setAnswers((prev) => ({ ...prev, [k]: opt.value }))}
                          className={`w-full rounded-md border p-3 text-start text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal disabled:opacity-60 ${
                            active
                              ? 'border-teal/60 bg-teal/10 text-mist'
                              : 'border-line/20 bg-console-700/40 text-mist/80 hover:border-line/40'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                    {opts.length === 0 && (
                      // Honest edge: an item without renderable options blocks
                      // submission (it can never be answered) — say so.
                      <p className="text-xs text-mist/45">—</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              type="button"
              className="btn-primary disabled:opacity-60"
              disabled={!allAnswered || busy}
              onClick={() => void submit()}
            >
              {busy ? t('assess.submitting') : t('assess.submit')}
            </button>
            {!allAnswered && <p className="text-xs text-mist/50">{t('assess.answerAll')}</p>}
          </div>
          {err && (
            <p role="alert" className="mt-3 text-sm text-risk">
              {err}
            </p>
          )}
        </>
      )}
    </div>
  );
}
