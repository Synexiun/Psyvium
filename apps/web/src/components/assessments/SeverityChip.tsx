'use client';

import { useI18n } from '@/i18n';

/**
 * Severity-band chip — CLINICIAN-ONLY surface (score suppression, doc 07 §9).
 * Signal amber / risk red are reserved accents: MODERATE/HIGH use signal,
 * SEVERE uses risk, LOW stays on the calm teal. Never render this for a
 * CLIENT-role session.
 */
export function SeverityChip({ band }: { band: string }) {
  const { dict } = useI18n();
  const cls =
    band === 'SEVERE'
      ? 'border-risk/40 text-risk bg-risk/10'
      : band === 'HIGH'
        ? 'border-signal/40 text-signal bg-signal/10'
        : band === 'MODERATE'
          ? 'border-signal/25 text-signal-soft bg-signal/5'
          : 'border-teal/20 text-teal-soft bg-teal/5';
  return (
    <span className={`chip border ${cls}`}>
      {dict.cat.bands[band as keyof typeof dict.cat.bands] ?? band}
    </span>
  );
}
