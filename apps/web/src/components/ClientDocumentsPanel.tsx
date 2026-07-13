'use client';

/**
 * Client document vault — presign upload → virus-scan status → download gate.
 *
 * Clinicians (CLIENT_WRITE) can upload; anyone with CLIENT_READ + clinical
 * access can list and download clean objects. Infected rows stay quarantined.
 */
import { useCallback, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useResource } from '@/lib/use-resource';
import { SkeletonCard } from '@/components/Skeleton';
import { ErrorPanel } from '@/components/ErrorPanel';
import { EmptyState } from '@/components/EmptyState';

const CATEGORIES = [
  'clinical_report',
  'consent_form',
  'referral',
  'assessment',
  'insurance',
  'other',
] as const;

type Category = (typeof CATEGORIES)[number];

const SCAN_CHIP: Record<string, string> = {
  clean: 'border-teal/40 text-teal-soft',
  pending: 'border-haze/40 text-haze',
  infected: 'border-risk/40 text-risk',
  error: 'chip-signal',
  skipped: 'border-line/40 text-mist/60',
};

const SCAN_STATUSES = ['pending', 'clean', 'infected', 'error', 'skipped'] as const;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isCategory(v: string): v is Category {
  return (CATEGORIES as readonly string[]).includes(v);
}

function isScanStatus(v: string): v is (typeof SCAN_STATUSES)[number] {
  return (SCAN_STATUSES as readonly string[]).includes(v);
}

export function ClientDocumentsPanel({
  clientId,
  className = '',
  compact = false,
}: {
  clientId: string;
  className?: string;
  /** Hide the section header when embedded under another card title. */
  compact?: boolean;
}) {
  const { t, fmtDate } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<Category>('clinical_report');
  const [busy, setBusy] = useState(false);
  const [scanBusyId, setScanBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const fetchDocs = useCallback(() => api.documentsForClient(clientId), [clientId]);
  const docs = useResource(fetchDocs, [clientId]);

  async function onUpload(file: File | null) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const registered = await api.uploadClientDocument({
        clientId,
        category,
        file,
      });
      setMsg({
        text: t('documents.uploadOk', { status: registered.virusScanStatus }),
        ok: true,
      });
      docs.reload();
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      setMsg({
        text:
          status === 403
            ? t('documents.uploadForbidden')
            : status === 503
              ? t('documents.uploadUnavailable')
              : t('documents.uploadFailed'),
        ok: false,
      });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function runScan(id: string) {
    setScanBusyId(id);
    setMsg(null);
    try {
      const result = await api.documentsVirusScan(id);
      setMsg({ text: t('documents.scanOk', { status: result.virusScanStatus }), ok: true });
      docs.reload();
    } catch {
      setMsg({ text: t('documents.scanFailed'), ok: false });
    } finally {
      setScanBusyId(null);
    }
  }

  async function download(id: string) {
    setMsg(null);
    try {
      await api.downloadClientDocument(id);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      setMsg({
        text: status === 403 ? t('documents.downloadQuarantined') : t('documents.downloadFailed'),
        ok: false,
      });
    }
  }

  return (
    <div className={className}>
      {!compact && (
        <>
          <p className="eyebrow">{t('documents.clientEyebrow')}</p>
          <h2 className="mt-1.5 font-display text-lg text-mist">{t('documents.clientTitle')}</h2>
          <p className="mt-2 text-xs leading-relaxed text-mist/55">{t('documents.clientIntro')}</p>
        </>
      )}

      <div className={`${compact ? '' : 'mt-4 '}grid gap-2 sm:grid-cols-[1fr_auto_auto]`}>
        <div>
          <label htmlFor={`doc-cat-${clientId}`} className="field-label">
            {t('documents.category')}
          </label>
          <select
            id={`doc-cat-${clientId}`}
            className="field text-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
            disabled={busy}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`documents.categories.${c}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
            id={`doc-file-${clientId}`}
            onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
          <label
            htmlFor={`doc-file-${clientId}`}
            className={`btn-primary cursor-pointer px-4 py-2 text-sm ${busy ? 'pointer-events-none opacity-60' : ''}`}
          >
            {busy ? t('documents.uploading') : t('documents.chooseFile')}
          </label>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => docs.reload()}
            disabled={docs.loading || busy}
            className="btn-ghost px-3 py-2 text-xs disabled:opacity-60"
          >
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {docs.loading && <SkeletonCard className="mt-4" />}
      {!!docs.error && (
        <ErrorPanel
          className="mt-4"
          message={
            docs.error instanceof ApiError && docs.error.status === 403
              ? t('documents.listForbidden')
              : t('documents.listFailed')
          }
          onRetry={docs.reload}
        />
      )}
      {!docs.loading && !docs.error && (docs.data?.length ?? 0) === 0 && (
        <EmptyState className="mt-4" body={t('documents.noDocs')} />
      )}
      {(docs.data?.length ?? 0) > 0 && (
        <ul className="mt-4 space-y-2">
          {docs.data!.map((d) => {
            const chip = SCAN_CHIP[d.virusScanStatus] ?? '';
            const canDownload = d.virusScanStatus === 'clean' || d.virusScanStatus === 'skipped';
            const canScan = d.virusScanStatus === 'pending' || d.virusScanStatus === 'error';
            return (
              <li key={d.id} className="card-inset flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-mist">
                    {isCategory(d.category) ? t(`documents.categories.${d.category}`) : d.category}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-mist/50" dir="ltr">
                    {d.mimeType} · {formatBytes(d.sizeBytes)} · {fmtDate(d.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <span className={`chip ${chip}`}>
                    {isScanStatus(d.virusScanStatus)
                      ? t(`documents.scanStatus.${d.virusScanStatus}`)
                      : d.virusScanStatus}
                  </span>
                  {canScan && (
                    <button
                      type="button"
                      onClick={() => void runScan(d.id)}
                      disabled={scanBusyId !== null}
                      className="btn-ghost px-2 py-1 text-[11px] disabled:opacity-60"
                    >
                      {scanBusyId === d.id ? t('documents.scanning') : t('documents.scanNow')}
                    </button>
                  )}
                  {canDownload && (
                    <button
                      type="button"
                      onClick={() => void download(d.id)}
                      className="btn-ghost px-2 py-1 text-[11px]"
                    >
                      {t('documents.download')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {msg && (
        <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
