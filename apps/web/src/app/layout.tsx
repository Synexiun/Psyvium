import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { LOCALE_COOKIE, dirOf, normalizeLocale } from '@/i18n/config';
import { I18nProvider } from '@/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'VPSY OS — Clinical Psychology Operating System',
  description:
    'A country-scale behavioral-health operating system. Intake to national analytics, governed end-to-end. AI assists, licensed clinicians decide.',
  applicationName: 'VPSY OS',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#0B1020',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Fonts load via a stylesheet link (not next/font) so the build never depends
 * on network access to Google Fonts. Noto families cover Arabic, CJK, and
 * Devanagari via unicode-range, so only the scripts actually rendered are
 * downloaded. The Tailwind token stack falls back to system-ui offline.
 *
 * The locale cookie is read server-side so lang/dir are correct on first
 * paint — SSR and hydration always agree, and RTL never flashes LTR.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const locale = normalizeLocale(store.get(LOCALE_COOKIE)?.value);

  return (
    <html lang={locale} dir={dirOf(locale)} className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans+Arabic:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Sans+JP:wght@400;500;700&family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
