'use client';

import { useI18n } from '@/i18n';

/**
 * Honest failure state + retry. This is a RISK surface, so it may use the
 * reserved signal accent. Title/retry label default to the shared catalog;
 * the message is the caller's specific, already-translated failure text.
 */
export function ErrorPanel({
  message,
  onRetry,
  title,
  retryLabel,
  className = '',
}: {
  message: string;
  onRetry: () => void;
  title?: string;
  retryLabel?: string;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <section role="alert" className={`rounded-md border border-signal/40 bg-signal/[0.07] p-5 ${className}`}>
      <p className="eyebrow text-signal">{title ?? t('common.connectionIssue')}</p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-mist/75">{message}</p>
      <button onClick={onRetry} className="btn-primary mt-4">
        {retryLabel ?? t('common.refresh')}
      </button>
    </section>
  );
}
