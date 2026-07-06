'use client';

/**
 * VPSY i18n runtime.
 *
 * - Dictionaries are typed against the English catalog (`Dict`); locale files
 *   are DeepPartial and deep-merged over English at module init, so lookups
 *   never surface a raw key.
 * - The locale is chosen server-side (cookie, root layout) and passed in as
 *   `initialLocale` — SSR and hydration render the same language, no flash.
 * - `setLocale` re-renders instantly, persists the cookie for a year, and
 *   flips `lang`/`dir` on <html> so RTL applies without a reload.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_META, dirOf, type Locale } from './config';
import en, { type Dict } from './dictionaries/en';
import es from './dictionaries/es';
import fr from './dictionaries/fr';
import de from './dictionaries/de';
import pt from './dictionaries/pt';
import ar from './dictionaries/ar';
import zh from './dictionaries/zh';
import hi from './dictionaries/hi';
import ru from './dictionaries/ru';
import ja from './dictionaries/ja';

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** Dot-paths of every string leaf in the catalog (arrays accessed via useDict). */
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends readonly unknown[]
      ? never
      : T[K] extends object
        ? `${K}.${Paths<T[K]>}`
        : never;
}[keyof T & string];
export type MessageKey = Paths<Dict>;

function mergeDeep<T extends object>(base: T, override: NoInfer<DeepPartial<T>> | undefined): T {
  if (!override) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    if (v === undefined) continue;
    const b = (base as Record<string, unknown>)[k];
    if (Array.isArray(v) || typeof v !== 'object' || v === null || typeof b !== 'object' || b === null) {
      out[k] = v;
    } else {
      out[k] = mergeDeep(b as object, v as DeepPartial<object>);
    }
  }
  return out as T;
}

const DICTS: Record<Locale, Dict> = {
  en,
  es: mergeDeep(en, es),
  fr: mergeDeep(en, fr),
  de: mergeDeep(en, de),
  pt: mergeDeep(en, pt),
  ar: mergeDeep(en, ar),
  zh: mergeDeep(en, zh),
  hi: mergeDeep(en, hi),
  ru: mergeDeep(en, ru),
  ja: mergeDeep(en, ja),
};

type Vars = Record<string, string | number>;

function resolve(dict: Dict, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : m,
  );
}

export interface I18n {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  dict: Dict;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  fmtDate: (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string;
  fmtTime: (d: Date | string | number) => string;
  fmtNumber: (n: number, opts?: Intl.NumberFormatOptions) => string;
  fmtPercent: (ratio: number) => string;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof document !== 'undefined') {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax`;
      document.documentElement.lang = next;
      document.documentElement.dir = dirOf(next);
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
    const t = (key: MessageKey, vars?: Vars) =>
      interpolate(resolve(dict, key) ?? resolve(en, key) ?? key, vars);
    const toDate = (d: Date | string | number) => (d instanceof Date ? d : new Date(d));
    return {
      locale,
      dir: dirOf(locale),
      dict,
      setLocale,
      t,
      fmtDate: (d, opts) =>
        new Intl.DateTimeFormat(locale, opts ?? { dateStyle: 'medium' }).format(toDate(d)),
      fmtTime: (d) =>
        new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(toDate(d)),
      fmtNumber: (n, opts) => new Intl.NumberFormat(locale, opts).format(n),
      fmtPercent: (ratio) =>
        new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(ratio),
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** Convenience: the merged (never-partial) dictionary for array/object access. */
export function useDict(): Dict {
  return useI18n().dict;
}

export { LOCALE_META };
export type { Dict, Locale };
