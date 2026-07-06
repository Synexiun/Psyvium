'use client';

import { useI18n } from '@/i18n';
import { useLiveEvents, type LiveStatus } from '@/lib/live-events';

const DOT_CLASS: Record<LiveStatus, string> = {
  live: 'bg-teal',
  connecting: 'bg-signal-soft animate-pulse',
  reconnecting: 'bg-signal animate-pulse',
  offline: 'bg-mist/30',
};

const LABEL_KEY: Record<LiveStatus, 'shell.liveConnected' | 'shell.liveConnecting' | 'shell.liveReconnecting' | 'shell.liveOffline'> = {
  live: 'shell.liveConnected',
  connecting: 'shell.liveConnecting',
  reconnecting: 'shell.liveReconnecting',
  offline: 'shell.liveOffline',
};

/**
 * Global command-strip indicator for the real-time push connection (SP3).
 * Deliberately honest: it never shows "live" while a reconnect is pending,
 * so clinicians never mistake a stale board for a fresh one.
 */
export function LiveStatusIndicator({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  const { status } = useLiveEvents();
  const label = t(LABEL_KEY[status]);

  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={`inline-flex h-7 items-center gap-1.5 rounded-sm border border-line/25 px-2 font-mono text-[10px] uppercase tracking-wider text-mist/70 ${className}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[status]}`} aria-hidden />
      <span className="hidden lg:inline">{label}</span>
    </span>
  );
}
