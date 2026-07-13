'use client';

/**
 * Portal shell — the CLINICAL COMMAND CENTER.
 *
 * Anatomy (all logical-property based, so RTL mirrors correctly):
 *   ┌ rail ┬ command strip ──────────────────────────────┐
 *   │ nav  ├ main column          ┊ context panel (xl)   │
 *   │ +    │                      ┊ pages fill via       │
 *   │ live │                      ┊ <ContextPanel>       │
 *   └──────┴──────────────────────┴──────────────────────┘
 * - The rail collapses to icons at md and disappears below md, where the
 *   mobile bottom bar takes over (PWA-native).
 * - The thin command strip carries the current section, the ⌘K trigger,
 *   language, theme, and sign-in.
 * - ⌘K / Ctrl-K opens the command palette anywhere in the portal.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/i18n';
import { getPrincipal, logout, type Principal } from '@/lib/api';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LiveStatusIndicator } from '@/components/LiveStatusIndicator';
import { CommandPalette, useCommandPaletteHotkey } from '@/components/CommandPalette';
import { CommandRail, useVisibleNav } from '@/components/CommandRail';
import { ContextPanelHostProvider } from '@/components/ContextPanel';
import { LiveEventsProvider } from '@/lib/live-events';

/** Role code (as carried in the access token) → the existing role-label i18n key. */
const ROLE_LABEL_KEY: Record<string, 'login.roleClient' | 'login.rolePsychologist' | 'login.roleManager' | 'login.roleExecutive' | 'login.roleAdmin'> = {
  CLIENT: 'login.roleClient',
  PSYCHOLOGIST: 'login.rolePsychologist',
  MANAGER: 'login.roleManager',
  EXECUTIVE: 'login.roleExecutive',
  ADMIN: 'login.roleAdmin',
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  useCommandPaletteHotkey(togglePalette);

  // ⌘K vs Ctrl-K label — resolved after mount to avoid hydration mismatch.
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/mac|iphone|ipad/i.test(navigator.platform ?? ''));
  }, []);

  // Signed-in identity — read from the token after mount only (localStorage is
  // unavailable during SSR; resolving it there would also risk a hydration mismatch).
  const [principal, setPrincipal] = useState<Principal | null>(null);
  useEffect(() => {
    const p = getPrincipal();
    setPrincipal(p);
    // Mandatory clinical/admin MFA must complete before any portal surface.
    if (p?.mfaEnrollmentRequired) {
      router.replace('/security/mfa');
    }
  }, [pathname, router]);

  async function signOut() {
    await logout();
    setPrincipal(null);
    router.push('/login');
  }

  const [panelHost, setPanelHost] = useState<HTMLElement | null>(null);

  const nav = useVisibleNav();
  const current = nav.find((n) => pathname?.startsWith(n.href));

  return (
    <LiveEventsProvider>
    <ContextPanelHostProvider value={panelHost}>
      <div className="flex min-h-dvh bg-console-900">
        <a href="#portal-content" className="skip-link">{t('common.skipToContent')}</a>

        <CommandRail />

        <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
          {/* ── Command strip — thin, persistent, keyboard-first ── */}
          <header className="hairline-b sticky top-0 z-40 flex h-11 items-center gap-3 bg-console-900/90 px-4 backdrop-blur-sm">
            <Link href="/" className="font-display text-sm font-semibold tracking-tight text-mist md:hidden">
              VPSY<span className="text-haze"> OS</span>
            </Link>
            <p className="hidden font-mono text-[11px] uppercase tracking-eyebrow text-haze md:block">
              {current ? t(current.key) : t('common.appName')}
            </p>

            <div className="ms-auto flex items-center gap-2">
              <button
                type="button"
                onClick={togglePalette}
                aria-haspopup="dialog"
                aria-expanded={paletteOpen}
                className="inline-flex h-7 items-center gap-2 rounded-sm border border-line/25 px-2 font-mono text-[10px] uppercase tracking-wider text-mist/70 transition hover:border-line/45 hover:text-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <circle cx="11" cy="11" r="7" />
                  <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
                </svg>
                <span className="hidden sm:inline">{t('shell.openPalette')}</span>
                <kbd className="rounded-sm border border-line/25 bg-console-700/60 px-1 py-px normal-case" dir="ltr">
                  {isMac ? '⌘K' : 'Ctrl K'}
                </kbd>
              </button>
              <LiveStatusIndicator />
              <ThemeToggle />
              <LanguageSwitcher compact />
              {principal ? (
                <div className="hidden items-center gap-2 sm:flex">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-mist/55" role="status">
                    {t('shell.signedInAs', {
                      role: t(principal.roles.map((r) => ROLE_LABEL_KEY[r]).find(Boolean) ?? 'login.roleClient'),
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={signOut}
                    className="rounded-sm border border-line/25 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-mist/70 transition hover:border-line/45 hover:text-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
                  >
                    {t('common.signOut')}
                  </button>
                </div>
              ) : (
                <Link
                  href="/login"
                  className="hidden font-mono text-[10px] uppercase tracking-wider text-mist/55 transition hover:text-mist sm:block"
                >
                  {t('common.signIn')}
                </Link>
              )}
            </div>
          </header>

          {/* ── Main + context panel ── */}
          <div className="mx-auto w-full max-w-7xl flex-1 gap-6 px-4 py-6 sm:px-6 xl:grid xl:grid-cols-[minmax(0,1fr)_300px]">
            <main id="portal-content" className="min-w-0">{children}</main>
            {/* Pages portal content here via <ContextPanel>. Below xl the aside
                stacks after main; when empty it collapses entirely. */}
            <aside
              ref={setPanelHost}
              aria-label={t('shell.contextEyebrow')}
              className="mt-6 space-y-4 empty:hidden xl:mt-0"
            />
          </div>
        </div>

        {/* ── Mobile bottom bar — all destinations, dense mono labels ── */}
        <nav
          aria-label={t('shell.mainMenu')}
          className="pb-safe hairline-t fixed inset-x-0 bottom-0 z-40 bg-console-950/95 backdrop-blur-lg md:hidden"
        >
          <div className="flex items-stretch overflow-x-auto px-1 py-1.5">
            {nav.map((n) => {
              const active = pathname?.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-w-[64px] flex-col items-center gap-1 rounded-sm px-2 py-1.5 transition ${
                    active ? 'text-mist' : 'text-mist/55 hover:text-mist'
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                    <path d={n.icon} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="font-mono text-[9px] uppercase tracking-wider">{t(n.key)}</span>
                </Link>
              );
            })}
            {principal && (
              <button
                type="button"
                onClick={signOut}
                className="flex min-w-[64px] flex-col items-center gap-1 rounded-sm px-2 py-1.5 text-mist/55 transition hover:text-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d="M10 5H5v14h5M14 8l4 4-4 4m4-4H9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="font-mono text-[9px] uppercase tracking-wider">{t('common.signOut')}</span>
              </button>
            )}
          </div>
        </nav>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      </div>
    </ContextPanelHostProvider>
    </LiveEventsProvider>
  );
}
