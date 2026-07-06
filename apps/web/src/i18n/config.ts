/**
 * VPSY i18n — supported locales and metadata.
 *
 * The locale is persisted in a cookie (read server-side in the root layout so
 * `lang`/`dir` are correct on first paint) and mirrored client-side by the
 * I18nProvider for instant switching without a reload.
 */
export const LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'ar', 'zh', 'hi', 'ru', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'vpsy.locale';

export const LOCALE_META: Record<Locale, { native: string; english: string; dir: 'ltr' | 'rtl' }> = {
  en: { native: 'English', english: 'English', dir: 'ltr' },
  es: { native: 'Español', english: 'Spanish', dir: 'ltr' },
  fr: { native: 'Français', english: 'French', dir: 'ltr' },
  de: { native: 'Deutsch', english: 'German', dir: 'ltr' },
  pt: { native: 'Português', english: 'Portuguese', dir: 'ltr' },
  ar: { native: 'العربية', english: 'Arabic', dir: 'rtl' },
  zh: { native: '简体中文', english: 'Chinese (Simplified)', dir: 'ltr' },
  hi: { native: 'हिन्दी', english: 'Hindi', dir: 'ltr' },
  ru: { native: 'Русский', english: 'Russian', dir: 'ltr' },
  ja: { native: '日本語', english: 'Japanese', dir: 'ltr' },
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(value: string | undefined | null): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function dirOf(locale: Locale): 'ltr' | 'rtl' {
  return LOCALE_META[locale].dir;
}
