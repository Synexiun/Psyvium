'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
import { applyThemePref, getThemePref, type ThemePref } from '@/lib/theme';

const CYCLE: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };

/**
 * Three-state theme control: system → light → dark. "System" tracks
 * prefers-color-scheme live; explicit picks persist across sessions.
 * Rendered as a compact mono button so it sits in the command strip.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  // SSR renders the neutral default; the real preference mounts client-side.
  const [pref, setPref] = useState<ThemePref>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setPref(getThemePref());
    setMounted(true);
  }, []);

  // In system mode, follow live OS changes.
  useEffect(() => {
    if (!mounted || pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyThemePref('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mounted, pref]);

  function cycle() {
    const next = CYCLE[pref];
    setPref(next);
    applyThemePref(next);
  }

  const label =
    pref === 'system' ? t('common.themeSystem') : pref === 'light' ? t('common.themeLight') : t('common.themeDark');

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`${t('common.theme')}: ${label}`}
      title={`${t('common.theme')}: ${label}`}
      className={`inline-flex h-7 items-center gap-1.5 rounded-sm border border-line/25 px-2 font-mono text-[10px] uppercase tracking-wider text-mist/70 transition hover:border-line/45 hover:text-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal ${className}`}
    >
      <ThemeIcon pref={mounted ? pref : 'system'} />
      <span className="hidden lg:inline">{mounted ? label : t('common.theme')}</span>
    </button>
  );
}

function ThemeIcon({ pref }: { pref: ThemePref }) {
  const common = { viewBox: '0 0 24 24', className: 'h-3.5 w-3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true } as const;
  if (pref === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" strokeLinecap="round" />
      </svg>
    );
  }
  if (pref === 'dark') {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="13" rx="1.5" />
      <path d="M9 21h6M12 17v4" strokeLinecap="round" />
    </svg>
  );
}
