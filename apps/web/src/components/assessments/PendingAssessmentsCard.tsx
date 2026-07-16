'use client';

/**
 * Patient-home pending-assessments card (doc 07 §9). A calm pointer near the
 * top of the client's day: how many assigned check-ins are waiting, the
 * earliest due date, one link to /assessments. Client-role sessions only;
 * a 403/404 (staff opening the patient surface) stays silent — mirroring
 * MySafetyPlanCard. Counts come from the live list, never fabricated: while
 * data is absent nothing numeric renders at all.
 */
import { useEffect, useState } from 'react';
import { api, getPrincipal, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useResource } from '@/lib/use-resource';
import { SkeletonCard } from '@/components/Skeleton';
import { ErrorPanel } from '@/components/ErrorPanel';
import { EmptyState } from '@/components/EmptyState';

export function PendingAssessmentsCard() {
  const { t, fmtDate, fmtNumber } = useI18n();

  // Role gate is hydration-safe: false on the server render, resolved in an
  // effect — the same pattern the CAT flow uses for its role checks.
  const [isClientRole, setIsClientRole] = useState(false);
  useEffect(() => {
    setIsClientRole(getPrincipal()?.roles.includes('CLIENT') ?? false);
  }, []);

  const { data, loading, error, reload } = useResource(
    // No session / not a client — skip the call entirely (the page-level
    // effect is redirecting to /login, or this is a staff session).
    () => (getPrincipal()?.roles.includes('CLIENT') ? api.myAssignments() : Promise.resolve(null)),
    [],
  );

  if (!isClientRole) return null;
  if (loading) return <SkeletonCard />;
  if (error) {
    // 403/404 = no client profile behind this session — not this card's user.
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null;
    return <ErrorPanel message={t('assess.errNetwork')} onRetry={reload} />;
  }
  if (!data) return null;

  const pending = data.filter((a) => a.status === 'ASSIGNED');
  if (pending.length === 0) {
    return <EmptyState eyebrow={t('assess.eyebrow')} body={t('assess.homeAllDone')} />;
  }

  const soonestDue = pending
    .map((a) => a.dueAt)
    .filter((d): d is string => d !== null)
    .sort()[0];

  return (
    <section className="card relative overflow-hidden p-5">
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">{t('assess.eyebrow')}</p>
          <p className="mt-2 font-display text-lg font-medium leading-snug text-mist">
            {pending.length === 1
              ? t('assess.homePendingOne')
              : t('assess.homePendingMany', { n: fmtNumber(pending.length) })}
          </p>
          {soonestDue && (
            <p className="mt-1 text-xs text-mist/50">
              {t('assess.homeDueSoonest', { date: fmtDate(soonestDue, { day: 'numeric', month: 'long' }) })}
            </p>
          )}
        </div>
        <a href="/assessments" className="btn-primary shrink-0 self-start sm:self-center">
          {t('assess.homeOpen')}
        </a>
      </div>
    </section>
  );
}
