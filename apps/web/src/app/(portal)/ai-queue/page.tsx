'use client';

/**
 * AI human-decision queue (ADR-007 / doc 05).
 * Every recommendation is PENDING until a licensed clinician accepts,
 * modifies, or rejects it. AI never self-accepts.
 */
import { useCallback, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useResource } from '@/lib/use-resource';
import { ErrorPanel } from '@/components/ErrorPanel';
import { SkeletonStack } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';

type Rec = {
  id: string;
  agent: string;
  confidence: number;
  humanDecision: string;
  linkedEntityType: string | null;
  linkedEntityId: string | null;
  output: unknown;
  createdAt: string;
};

export default function AiQueuePage() {
  const { t, fmtDate, fmtTime, fmtPercent } = useI18n();
  const fetchQueue = useCallback(() => api.aiPendingRecommendations(50), []);
  const { data, loading, error, reload } = useResource(fetchQueue, []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modNote, setModNote] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  async function decide(id: string, decision: 'ACCEPTED' | 'MODIFIED' | 'REJECTED') {
    if (decision === 'MODIFIED' && !(modNote[id]?.trim().length >= 3)) {
      setMsg(t('aiQueue.modNoteRequired'));
      return;
    }
    setBusyId(id);
    setMsg(null);
    try {
      await api.aiDecideRecommendation(id, {
        decision,
        modificationNote: decision === 'MODIFIED' ? modNote[id]?.trim() : undefined,
        rationale: decision !== 'MODIFIED' ? undefined : undefined,
      });
      reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? t('aiQueue.errStatus', { status: e.status }) : t('aiQueue.errNetwork'));
    } finally {
      setBusyId(null);
    }
  }

  const items = data ?? [];
  const errMsg =
    error instanceof ApiError ? t('aiQueue.errStatus', { status: error.status }) : t('aiQueue.errNetwork');

  return (
    <div>
      <p className="eyebrow">{t('aiQueue.eyebrow')}</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('aiQueue.title')}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-mist/60">{t('aiQueue.intro')}</p>

      {msg && (
        <p role="alert" className="mt-4 text-sm text-risk">
          {msg}
        </p>
      )}

      {loading && <SkeletonStack count={4} className="mt-6 space-y-3" />}
      {!!error && <ErrorPanel className="mt-6 max-w-md" message={errMsg} onRetry={reload} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState className="mt-6" eyebrow={t('aiQueue.emptyEyebrow')} body={t('aiQueue.empty')} />
      )}

      <ul className="mt-6 space-y-4">
        {items.map((rec) => (
          <li key={rec.id} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-wider text-teal">{rec.agent}</p>
                <p className="mt-1 text-sm text-mist/70">
                  {rec.linkedEntityType ?? '—'}
                  {rec.linkedEntityId ? (
                    <span className="text-mist/40"> · {rec.linkedEntityId}</span>
                  ) : null}
                </p>
                <p className="mt-1 font-mono text-[10px] text-haze/80" dir="ltr">
                  conf {fmtPercent(rec.confidence)} · {fmtDate(rec.createdAt)} {fmtTime(rec.createdAt)}
                </p>
              </div>
              <span className="chip text-signal/90">{t('aiQueue.pending')}</span>
            </div>

            <pre className="mt-4 max-h-48 overflow-auto rounded border border-line/15 bg-console-900/50 p-3 font-mono text-[11px] leading-relaxed text-mist/70" dir="ltr">
              {summarizeOutput(rec.output)}
            </pre>

            <label className="field-label mt-4" htmlFor={`mod-${rec.id}`}>
              {t('aiQueue.modNote')}
            </label>
            <textarea
              id={`mod-${rec.id}`}
              className="field mt-1 min-h-[56px] text-sm"
              value={modNote[rec.id] ?? ''}
              onChange={(e) => setModNote((prev) => ({ ...prev, [rec.id]: e.target.value }))}
              placeholder={t('aiQueue.modPlaceholder')}
            />

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary px-3 py-1.5 text-xs"
                disabled={busyId === rec.id}
                onClick={() => void decide(rec.id, 'ACCEPTED')}
              >
                {t('aiQueue.accept')}
              </button>
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-xs"
                disabled={busyId === rec.id}
                onClick={() => void decide(rec.id, 'MODIFIED')}
              >
                {t('aiQueue.modify')}
              </button>
              <button
                type="button"
                className="btn-ghost border-signal/40 px-3 py-1.5 text-xs text-signal-soft"
                disabled={busyId === rec.id}
                onClick={() => void decide(rec.id, 'REJECTED')}
              >
                {t('aiQueue.reject')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function summarizeOutput(output: unknown): string {
  if (output == null) return '—';
  try {
    return JSON.stringify(output, null, 2).slice(0, 4000);
  } catch {
    return String(output);
  }
}
