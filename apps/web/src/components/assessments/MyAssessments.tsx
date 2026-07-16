'use client';

/**
 * Client-facing assignment list ("My assessments", doc 07 §9). The calm side
 * of the workflow: what the clinician asked for, when it is due, and a single
 * Start action per open assignment. COMPLETED rows show a quiet done chip —
 * never a score, band, or interpretation (score suppression; results are
 * discussed together in session). CANCELLED assignments are simply not the
 * client's to act on and are omitted from the list.
 */
import { useMemo, useState } from 'react';
import type { AssessmentAssignmentDto } from '@vpsy/contracts';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useResource } from '@/lib/use-resource';
import { SkeletonStack } from '@/components/Skeleton';
import { ErrorPanel } from '@/components/ErrorPanel';
import { EmptyState } from '@/components/EmptyState';
import { TakeAssessmentForm } from './TakeAssessmentForm';

/** Open first (soonest due, then oldest), completed after (newest first). */
function sortAssignments(list: AssessmentAssignmentDto[]): AssessmentAssignmentDto[] {
  const open = list
    .filter((a) => a.status === 'ASSIGNED')
    .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999') || a.createdAt.localeCompare(b.createdAt));
  const doneRows = list
    .filter((a) => a.status === 'COMPLETED')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  return [...open, ...doneRows];
}

export function MyAssessments() {
  const { t } = useI18n();
  const { data, loading, error, reload } = useResource(() => api.myAssignments(), []);
  const [taking, setTaking] = useState<AssessmentAssignmentDto | null>(null);

  if (taking) {
    return (
      <div className="mx-auto max-w-2xl xl:mx-0">
        <TakeAssessmentForm
          assignment={taking}
          onExit={() => {
            setTaking(null);
            reload();
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl xl:mx-0">
      <p className="eyebrow">{t('assess.eyebrow')}</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('assess.myTitle')}</h1>
      <p className="mt-3 text-sm leading-relaxed text-mist/60">{t('assess.myIntro')}</p>
      <p className="mt-2 text-xs leading-relaxed text-mist/45">{t('cat.crisisNote')}</p>

      <div className="mt-6">
        {loading && <SkeletonStack count={3} className="space-y-3" />}
        {!loading && !!error && (
          // 403/404 = the signed-in user has no client profile (e.g. staff
          // opening this surface without interpret rights) — say so honestly.
          error instanceof ApiError && (error.status === 403 || error.status === 404) ? (
            <EmptyState eyebrow={t('assess.eyebrow')} body={t('assess.myNoAccess')} />
          ) : (
            <ErrorPanel
              message={
                error instanceof ApiError
                  ? t('assess.errStatus', { status: error.status })
                  : t('assess.errNetwork')
              }
              onRetry={reload}
            />
          )
        )}
        {!loading && !error && data && <AssignmentList list={data} onStart={setTaking} />}
      </div>
    </div>
  );
}

function AssignmentList({
  list,
  onStart,
}: {
  list: AssessmentAssignmentDto[];
  onStart: (a: AssessmentAssignmentDto) => void;
}) {
  const { t, fmtDate, fmtNumber } = useI18n();
  const rows = useMemo(() => sortAssignments(list), [list]);

  if (rows.length === 0) {
    return <EmptyState eyebrow={t('assess.eyebrow')} body={t('assess.myEmpty')} />;
  }

  return (
    <ul className="space-y-3">
      {rows.map((a) => (
        <li key={a.id} className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-wider text-haze/90">{a.construct}</p>
              <h2 className="mt-1 font-display text-lg font-medium text-mist">{a.instrumentName}</h2>
              <p className="mt-1.5 text-xs text-mist/50">
                <span className="figure" dir="ltr">{fmtNumber(a.itemCount)}</span> {t('assess.itemsUnit')}
                {a.dueAt && (
                  <span className="ms-2 text-mist/60">
                    · {t('assess.dueBy', { date: fmtDate(a.dueAt, { day: 'numeric', month: 'short' }) })}
                  </span>
                )}
              </p>
            </div>
            {a.status === 'ASSIGNED' ? (
              <button type="button" className="btn-primary shrink-0" onClick={() => onStart(a)}>
                {t('assess.start')}
              </button>
            ) : (
              <span className="chip shrink-0 border border-teal/25 text-teal-soft">
                {t('assess.doneChip')}
                {a.completedAt && (
                  <span className="text-mist/50">
                    · {fmtDate(a.completedAt, { day: 'numeric', month: 'short' })}
                  </span>
                )}
              </span>
            )}
          </div>
          {a.note && (
            <div className="card-inset mt-3 px-3.5 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-haze/90">
                {t('assess.noteFromClinician')}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-mist/80">{a.note}</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
