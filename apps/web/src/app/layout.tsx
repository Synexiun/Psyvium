import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, dirOf, normalizeLocale } from '@/i18n/config';
import { I18nProvider } from '@/i18n';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import './globals.css';

export const metadata: Metadata = {
  title: 'VPSY OS — Clinical Psychology Operating System',
  description:
    'A country-scale behavioral-health operating system. Intake to national analytics, governed end-to-end. AI assists, licensed clinicians decide.',
  applicationName: 'VPSY OS',
  // No explicit `manifest` field: `app/manifest.ts` (the dynamic PWA
  // manifest — see docs/technical/11-frontend-architecture.md §5) is served
  // at this same /manifest.webmanifest path and Next injects the <link>
  // tag for it automatically.
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0B0D11' },
    { media: '(prefers-color-scheme: light)', color: '#F3F4F7' },
  ],
  width: 'device-width',
  initialScale: 1,
};

/**
 * Typography is a refined SYSTEM stack (Bahnschrift/Avenir Next display,
 * Segoe/SF body, Cascadia/SF Mono numerals) — zero network font fetches, so
 * the app renders identically offline. System UI faces also cover Arabic,
 * CJK and Devanagari natively across platforms.
 *
 * The locale cookie is read server-side so lang/dir are correct on first
 * paint — SSR and hydration always agree, and RTL never flashes LTR.
 *
 * Theme: SSR renders the dark default; the inline script re-resolves the
 * user's stored preference / prefers-color-scheme before first paint
 * (suppressHydrationWarning covers the class-only divergence).
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const locale = normalizeLocale(store.get(LOCALE_COOKIE)?.value);

  return (
    <html lang={locale} dir={dirOf(locale)} className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ServiceWorkerRegistration />
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
