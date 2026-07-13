'use client';

/**
 * Audit log viewer for holders of audit:read (managers/admins).
 * Read-only; never fabricates rows. Paginates via cursor from GET /audit/events.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { ErrorPanel } from '@/components/ErrorPanel';
import { SkeletonStack } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';

type AuditItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  occurredAt: string;
  ip: string | null;
  hash: string;
};

export default function AuditPage() {
  const { t, fmtDate, fmtTime } = useI18n();
  const [items, setItems] = useState<AuditItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [entityType, setEntityType] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [appliedEntity, setAppliedEntity] = useState('');
  const [appliedAction, setAppliedAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: 'reset' | 'more', cursor?: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const page = await api.auditEvents({
          limit: 40,
          cursor: mode === 'more' ? cursor ?? undefined : undefined,
          entityType: appliedEntity || undefined,
          action: appliedAction || undefined,
        });
        setItems((prev) => (mode === 'reset' ? page.items : [...prev, ...page.items]));
        setNextCursor(page.nextCursor);
      } catch (e) {
        setError(
          e instanceof ApiError ? t('audit.errStatus', { status: e.status }) : t('audit.errNetwork'),
        );
      } finally {
        setLoading(false);
      }
    },
    [appliedEntity, appliedAction, t],
  );

  useEffect(() => {
    void load('reset');
  }, [load]);

  return (
    <div>
      <p className="eyebrow">{t('audit.eyebrow')}</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('audit.title')}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-mist/60">{t('audit.intro')}</p>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="audit-entity">
            {t('audit.entityType')}
          </label>
          <input
            id="audit-entity"
            className="field mt-1"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="Assignment"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="audit-action">
            {t('audit.action')}
          </label>
          <input
            id="audit-action"
            className="field mt-1"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="assignment.approved"
          />
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={loading}
          onClick={() => {
            setAppliedEntity(entityType.trim());
            setAppliedAction(actionFilter.trim());
            setNextCursor(null);
          }}
        >
          {t('audit.applyFilters')}
        </button>
      </div>

      {loading && items.length === 0 && <SkeletonStack count={5} className="mt-6 space-y-2" />}
      {error && <ErrorPanel className="mt-6 max-w-md" message={error} onRetry={() => void load('reset')} />}
      {!loading && !error && items.length === 0 && <EmptyState body={t('audit.empty')} />}

      {items.length > 0 && (
        <ul className="mt-6 space-y-2">
          {items.map((row) => (
            <li key={row.id} className="card-inset px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-xs text-teal">{row.action}</p>
                  <p className="mt-1 text-sm text-mist/80">
                    {row.entityType}
                    {row.entityId ? <span className="text-mist/45"> · {row.entityId}</span> : null}
                  </p>
                  {row.actorId && (
                    <p className="mt-0.5 font-mono text-[10px] text-haze/80">actor {row.actorId}</p>
                  )}
                </div>
                <div className="text-end">
                  <p className="figure text-xs text-mist/60" dir="ltr">
                    {fmtDate(row.occurredAt)} · {fmtTime(row.occurredAt)}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-mist/35" dir="ltr" title={row.hash}>
                    {row.hash.slice(0, 12)}…
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <button
          type="button"
          className="btn-ghost mt-4"
          disabled={loading}
          onClick={() => void load('more', nextCursor)}
        >
          {loading ? t('audit.loading') : t('audit.loadMore')}
        </button>
      )}
    </div>
  );
}
