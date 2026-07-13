'use client';

/**
 * The Command Rail — persistent inline-start navigation of the portal shell.
 * Dense, hairline-bounded, keyboard-friendly. Icon-only at md, full labels at
 * lg. A compact live status block (local clock + UTC offset + locale) sits at
 * the bottom: honest instrument data only. RTL-correct via logical properties.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Permission } from '@vpsy/contracts';
import { useI18n } from '@/i18n';
import type { MessageKey } from '@/i18n';
import { getPrincipal } from '@/lib/api';

export interface PortalNavEntry {
  href: string;
  key: MessageKey;
  icon: string;
  /** Show only when the signed-in principal holds ANY of these permissions —
   * mirrors `src/middleware.ts` ROUTE_REQUIREMENTS (UI courtesy only; the
   * middleware + API remain the actual boundary). Omitted = session-only. */
  anyOf?: string[];
}

export const PORTAL_NAV: PortalNavEntry[] = [
  { href: '/home', key: 'nav.home', icon: 'M3 11l9-8 9 8M5 10v10h14V10' },
  { href: '/intake', key: 'nav.intake', icon: 'M12 4v16m8-8H4', anyOf: [Permission.INTAKE_SUBMIT, Permission.INTAKE_READ] },
  { href: '/session', key: 'nav.workspace', icon: 'M4 19V5a2 2 0 012-2h12a2 2 0 012 2v14M8 7h8M8 11h8M8 15h5', anyOf: [Permission.SESSION_HOST] },
  { href: '/diagnosis', key: 'nav.diagnosis', icon: 'M12 3v18M3 12h18M8 8l8 8M16 8l-8 8', anyOf: [Permission.NOTE_READ] },
  { href: '/ai-queue', key: 'nav.aiQueue', icon: 'M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z', anyOf: [Permission.AI_DECISION] },
  { href: '/manager', key: 'nav.triage', icon: 'M4 6h16M4 12h16M4 18h10', anyOf: [Permission.ASSIGNMENT_APPROVE] },
  { href: '/crm', key: 'nav.crm', icon: 'M3 5h18l-7 8v5l-4 2v-7z', anyOf: [Permission.CRM_READ] },
  { href: '/comms', key: 'nav.comms', icon: 'M4 4h16v12H7l-3 3z', anyOf: [Permission.COMMS_READ] },
  { href: '/messages', key: 'nav.messages', icon: 'M4 5h16v12H9l-5 4zM8 9h8M8 13h5', anyOf: [Permission.COMMS_READ] },
  { href: '/telehealth', key: 'nav.telehealth', icon: 'M3 7h12v10H3zM15 10l6-3v10l-6-3', anyOf: [Permission.SCHEDULING_READ] },
  { href: '/assessments', key: 'nav.assessments', icon: 'M9 3h6v4H9zM7 5H5v16h14V5h-2M9 12h6M9 16h6', anyOf: [Permission.ASSESSMENT_ADMINISTER] },
  { href: '/risk', key: 'nav.risk', icon: 'M12 3l9 16H3zM12 10v4M12 17v.5', anyOf: [Permission.RISK_READ] },
  { href: '/schedule', key: 'nav.schedule', icon: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4', anyOf: [Permission.SCHEDULING_READ] },
  { href: '/finance', key: 'nav.finance', icon: 'M3 6h18v12H3zM3 10h18M7 15h4', anyOf: [Permission.FINANCE_READ, Permission.FINANCE_MANAGE] },
  { href: '/reports', key: 'nav.reports', icon: 'M4 20V10M10 20V4M16 20v-7M20 20H3', anyOf: [Permission.REPORTS_READ] },
  { href: '/admin', key: 'nav.admin', icon: 'M4 8h9M17 8h3M13 5v6M4 16h3M11 16h9M7 13v6', anyOf: [Permission.ADMIN_CONFIG] },
  { href: '/audit', key: 'nav.audit', icon: 'M9 5h6M9 9h6M9 13h4M5 3h14v18H5z', anyOf: [Permission.AUDIT_READ] },
];

/**
 * Nav entries visible to the CURRENT principal. Before hydration (or signed
 * out) this returns the full list — the SSR markup and first client render
 * match, then the post-mount principal read narrows it. Purely cosmetic
 * gating: middleware redirects and the API 403s regardless.
 */
export function useVisibleNav(): PortalNavEntry[] {
  const pathname = usePathname();
  const [perms, setPerms] = useState<Set<string> | null>(null);
  useEffect(() => {
    const p = getPrincipal();
    setPerms(p ? new Set(p.permissions) : null);
  }, [pathname]);
  return useMemo(() => {
    if (!perms) return PORTAL_NAV;
    return PORTAL_NAV.filter((n) => !n.anyOf || n.anyOf.some((x) => perms.has(x)));
  }, [perms]);
}

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
  const nav = useVisibleNav();

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
        {nav.map((n) => {
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
