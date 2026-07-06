'use client';

/**
 * The Command Rail — persistent inline-start navigation of the portal shell.
 * Dense, hairline-bounded, keyboard-friendly. Icon-only at md, full labels at
 * lg. A compact live status block (local clock + UTC offset + locale) sits at
 * the bottom: honest instrument data only. RTL-correct via logical properties.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
import type { MessageKey } from '@/i18n';

export const PORTAL_NAV: { href: string; key: MessageKey; icon: string }[] = [
  { href: '/home', key: 'nav.home', icon: 'M3 11l9-8 9 8M5 10v10h14V10' },
  { href: '/intake', key: 'nav.intake', icon: 'M12 4v16m8-8H4' },
  { href: '/session', key: 'nav.workspace', icon: 'M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14M8 7h8M8 11h8M8 15h5' },
  { href: '/manager', key: 'nav.triage', icon: 'M4 6h16M4 12h16M4 18h10' },
  { href: '/crm', key: 'nav.crm', icon: 'M3 5h18l-7 8v5l-4 2v-7z' },
  { href: '/comms', key: 'nav.comms', icon: 'M4 4h16v12H7l-3 3z' },
  { href: '/risk', key: 'nav.risk', icon: 'M12 3l9 16H3zM12 10v4M12 17v.5' },
  { href: '/schedule', key: 'nav.schedule', icon: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4' },
  { href: '/finance', key: 'nav.finance', icon: 'M3 6h18v12H3zM3 10h18M7 15h4' },
  { href: '/reports', key: 'nav.reports', icon: 'M4 20V10M10 20V4M16 20v-7M20 20H3' },
];

function RailClock() {
  const { locale, t } = useI18n();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);

  if (!now) {
    return <p className="figure text-xs text-mist/70">--:--</p>;
  }
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '−';
  const abs = Math.abs(offsetMin);
  const offset = `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? ':' + String(abs % 60).padStart(2, '0') : ''}`;

  return (
    <div>
      <p className="figure text-sm text-mist" dir="ltr">
        {new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(now)}
      </p>
      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-haze/80" dir="ltr">
        {offset} · {new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(now)}
      </p>
      <span className="sr-only">{t('shell.localTime')}</span>
    </div>
  );
}

export function CommandRail() {
  const { t, locale } = useI18n();
  const pathname = usePathname();

  return (
    <nav
      aria-label={t('shell.mainMenu')}
      className="hidden h-dvh flex-col border-e border-line/15 bg-console-800/60 md:sticky md:top-0 md:flex md:w-14 lg:w-56"
    >
      {/* Brand */}
      <Link
        href="/"
        className="hairline-b flex h-11 items-center gap-2.5 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-sm border border-line/30" aria-hidden>
          <span className="h-1.5 w-1.5 rounded-full bg-teal animate-pulseline" />
        </span>
        <span className="hidden font-display text-sm font-semibold tracking-tight text-mist lg:inline">
          VPSY<span className="text-haze"> OS</span>
        </span>
      </Link>

      {/* Destinations */}
      <ul className="flex-1 overflow-y-auto py-2">
        <li aria-hidden className="hidden px-3 pb-1 pt-2 lg:block">
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-haze/70">{t('shell.navEyebrow')}</span>
        </li>
        {PORTAL_NAV.map((n) => {
          const active = pathname?.startsWith(n.href);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={active ? 'page' : undefined}
                title={t(n.key)}
                className={`relative flex h-9 items-center gap-3 px-3 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal ${
                  active ? 'bg-line/10 text-mist' : 'text-mist/60 hover:bg-line/5 hover:text-mist'
                }`}
              >
                {/* Active marker: a 2px inline-start bar — flips sides in RTL */}
                {active && <span aria-hidden className="absolute inset-y-1.5 start-0 w-0.5 bg-teal" />}
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d={n.icon} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="hidden truncate lg:inline">{t(n.key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Live status block */}
      <div className="hairline-t hidden px-3 py-3 lg:block">
        <p className="font-mono text-[10px] uppercase tracking-eyebrow text-haze/70">{t('shell.statusEyebrow')}</p>
        <div className="mt-2">
          <RailClock />
        </div>
        <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-haze/80">{locale}</p>
      </div>
    </nav>
  );
}
