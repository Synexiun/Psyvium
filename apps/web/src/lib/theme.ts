/**
 * Theme preference — the calm dark+light duo.
 *
 * Resolution order: explicit user choice (localStorage) → OS preference
 * (prefers-color-scheme). A tiny inline script in the root layout applies the
 * same logic before first paint, so there is never a theme flash and SSR
 * markup (default dark) is corrected pre-hydration.
 */
export type ThemePref = 'system' | 'light' | 'dark';

export const THEME_KEY = 'vpsy.theme';

/** Inline (pre-hydration) script body — keep in sync with resolveDark(). */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('${THEME_KEY}');var d=p==='dark'||(p!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export function getThemePref(): ThemePref {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function resolveDark(pref: ThemePref): boolean {
  if (pref === 'dark') return true;
  if (pref === 'light') return false;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyThemePref(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* storage unavailable — the class still applies for this page view */
  }
  document.documentElement.classList.toggle('dark', resolveDark(pref));
}
