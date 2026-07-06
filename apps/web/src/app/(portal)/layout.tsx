'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

/**
 * Portal shell. Mobile-first: a fixed bottom navigation that makes the PWA
 * feel native. On desktop the same destinations sit in a slim top bar.
 * All four role surfaces share this shell in the demo.
 */
const NAV: { href: string; key: 'nav.home' | 'nav.intake' | 'nav.workspace' | 'nav.triage' | 'nav.crm' | 'nav.comms' | 'nav.risk' | 'nav.schedule' | 'nav.finance' | 'nav.reports'; icon: string }[] = [
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

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-console-900 pb-24 md:pb-0">
      <a href="#portal-content" className="skip-link">{t('common.skipToContent')}</a>
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-console-900/85 backdrop-blur-md">
        <div className="container-vpsy flex h-14 items-center justify-between gap-3">
          <Link href="/" className="font-display text-base font-semibold text-mist">
            VPSY<span className="text-teal"> OS</span>
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            {NAV.map((n) => {
              const active = pathname?.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? 'page' : undefined}
                  className={`text-sm transition ${active ? 'text-teal-soft' : 'text-mist/60 hover:text-mist'}`}
                >
                  {t(n.key)}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3">
            <LanguageSwitcher compact />
            <Link
              href="/login"
              className="font-mono text-[11px] uppercase tracking-wider text-mist/50 transition hover:text-mist"
            >
              {t('common.signIn')}
            </Link>
          </div>
        </div>
      </header>

      <main id="portal-content" className="container-vpsy py-8">{children}</main>

      {/* Fixed bottom navigation — mobile */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.06] bg-console-950/90 backdrop-blur-lg md:hidden">
        <div className="mx-auto flex max-w-md items-center justify-around px-2 py-2">
          {NAV.map((n) => {
            const active = pathname?.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 px-3 py-2 transition ${active ? 'text-teal-soft' : 'text-mist/60 hover:text-teal'}`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d={n.icon} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="font-mono text-[10px] uppercase tracking-wider">{t(n.key)}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
