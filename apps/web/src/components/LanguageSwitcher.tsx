'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { LOCALES, LOCALE_META, type Locale } from '@/i18n/config';
import { useI18n } from '@/i18n';

/**
 * Persistent language switcher. Accessible menu-button pattern:
 * Enter/Space/ArrowDown opens, Arrow keys move, Escape closes, outside
 * click closes. The choice is written to a cookie and applied instantly
 * (lang + dir flip without a reload).
 */
export function LanguageSwitcher({
  compact = false,
  tone = 'dark',
}: {
  compact?: boolean;
  tone?: 'dark' | 'light';
}) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const light = tone === 'light';
  const buttonClass = light
    ? 'inline-flex items-center gap-2 rounded border border-[#cfd8e3] bg-white px-2.5 py-1.5 text-sm text-[#475467] transition hover:border-[#3e5068] hover:text-[#111827] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3e5068]'
    : 'inline-flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-sm text-mist/70 transition hover:border-teal/40 hover:text-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-soft';
  const menuClass = light
    ? 'absolute end-0 top-full z-50 mt-2 max-h-80 w-48 overflow-auto rounded-md border border-[#cfd8e3] bg-white p-1.5 shadow-[0_18px_50px_-35px_rgba(15,23,42,0.45)]'
    : 'absolute end-0 top-full z-50 mt-2 max-h-80 w-48 overflow-auto rounded-xl border border-white/10 bg-console-800 p-1.5 shadow-lift';
  const itemClass = (active: boolean) =>
    light
      ? `flex w-full items-center justify-between rounded px-3 py-2 text-start text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3e5068] ${
          active
            ? 'bg-[#eef2f6] text-[#111827]'
            : 'text-[#475467] hover:bg-[#f8fafc] hover:text-[#111827]'
        }`
      : `flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-soft ${
          active
            ? 'bg-teal/15 text-teal-soft'
            : 'text-mist/75 hover:bg-white/[0.05] hover:text-mist'
        }`;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      const active = listRef.current?.querySelector<HTMLButtonElement>(
        '[data-active="true"]',
      );
      active?.focus();
    }
  }, [open]);

  function onListKeyDown(e: React.KeyboardEvent) {
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
    );
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    }
  }

  function choose(l: Locale) {
    setLocale(l);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t('common.language')}
        onClick={() => setOpen((o) => !o)}
        className={buttonClass}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
        </svg>
        {!compact && (
          <span className="font-mono text-[11px] uppercase tracking-wider">
            {locale}
          </span>
        )}
        <svg
          viewBox="0 0 24 24"
          className={`h-3 w-3 transition ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={t('common.language')}
          onKeyDown={onListKeyDown}
          className={menuClass}
        >
          {LOCALES.map((l) => {
            const meta = LOCALE_META[l];
            const active = l === locale;
            return (
              <li key={l} role="option" aria-selected={active}>
                <button
                  type="button"
                  data-active={active}
                  onClick={() => choose(l)}
                  dir={meta.dir}
                  className={itemClass(active)}
                >
                  <span>{meta.native}</span>
                  {active && (
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden
                    >
                      <path
                        d="M5 13l4 4L19 7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
