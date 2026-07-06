import type { Config } from 'tailwindcss';

/**
 * VPSY "Clinical Command Center" design tokens.
 *
 * Every color resolves through a CSS custom property (RGB triplet) defined in
 * globals.css, so the SAME utility class renders correctly in both the dark
 * and light themes — pages never branch on theme.
 *
 * Legacy token NAMES are preserved (console/teal/signal/risk/mist/haze) so all
 * routes keep compiling, but their VALUES are remapped to the Command Center
 * palette:
 *   console.* → the neutral graphite/paper surface scale
 *   mist/haze → primary / secondary ink (text)
 *   teal.*    → "steel" — the calm, nearly-neutral interactive tone
 *   signal.*  → THE single reserved accent: risk / attention amber
 *   risk      → critical red
 */
const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

/**
 * Ink tokens with a THEME-CONTROLLED ALPHA FLOOR (a11y P0, WCAG 1.4.3).
 *
 * Root cause of the audited 71 serious color-contrast nodes: opacity-modified
 * text utilities (`text-mist/40`, `text-haze/70`, …) cap out at ~2.5–4.2:1 on
 * the light theme's paper surfaces — even pure black at 40% alpha over white
 * is only ~2.9:1, so no amount of darkening the base triplet alone can fix a
 * low-alpha utility. The fix stays AT THE TOKEN LAYER: the alpha every
 * `text-mist/NN` utility resolves to is clamped through `max()` against a
 * per-theme CSS variable (`--vc-ink-floor` / `--vc-ink-2-floor`,
 * globals.css). Light mode floors secondary ink at an opacity that keeps
 * ≥4.5:1 on every light surface text sits on; dark mode sets the floors to 0,
 * so the as-designed dark hierarchy is untouched. No callsite changes, no
 * per-page branching — the same utility class is now contrast-safe in both
 * themes.
 */
const inkWithFloor = (v: string, floorVar: string) =>
  `rgb(var(${v}) / max(var(${floorVar}, 0), <alpha-value>))`;

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        console: {
          950: rgb('--vc-surface-deep'),
          900: rgb('--vc-surface-0'),
          800: rgb('--vc-surface-1'),
          700: rgb('--vc-surface-2'),
          600: rgb('--vc-surface-3'),
          500: rgb('--vc-surface-4'),
        },
        teal: {
          DEFAULT: rgb('--vc-steel'),
          // steel-soft/signal-soft are TEXT-ROLE tokens (labels, eyebrows,
          // status lines) — their opacity-modified utilities get the same
          // light-theme alpha floor as mist/haze (see inkWithFloor).
          soft: inkWithFloor('--vc-steel-soft', '--vc-steel-soft-floor'),
          deep: rgb('--vc-steel-deep'),
        },
        signal: {
          DEFAULT: rgb('--vc-signal'),
          soft: inkWithFloor('--vc-signal-soft', '--vc-signal-soft-floor'),
          deep: rgb('--vc-signal-deep'),
        },
        risk: rgb('--vc-risk'),
        mist: inkWithFloor('--vc-ink', '--vc-ink-floor'),
        haze: inkWithFloor('--vc-ink-2', '--vc-ink-2-floor'),
        ink: rgb('--vc-ink-inverse'),
        line: rgb('--vc-line'),
      },
      fontFamily: {
        // System stacks only — zero network font fetches. Bahnschrift (a DIN
        // grotesque, ships with Windows 10+) gives the display voice its
        // instrument-panel character; Avenir Next covers macOS; everything
        // else falls to the platform UI face, which also covers Arabic/CJK/
        // Devanagari natively.
        display: ['var(--font-display)', 'Bahnschrift', 'Avenir Next', 'Segoe UI Variable Display', 'Segoe UI', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'Segoe UI Variable Text', 'Segoe UI', '-apple-system', 'SF Pro Text', 'Helvetica Neue', 'Arial', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'Cascadia Mono', 'Cascadia Code', 'ui-monospace', 'SF Mono', 'JetBrains Mono', 'IBM Plex Mono', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      letterSpacing: {
        eyebrow: '0.18em',
      },
      boxShadow: {
        // Hairline-first elevation: a crisp 1px ring + a soft neutral drop.
        console: '0 0 0 1px rgb(var(--vc-line) / 0.35), 0 12px 32px -16px rgb(var(--vc-shadow) / 0.5)',
        lift: '0 0 0 1px rgb(var(--vc-line) / 0.4), 0 24px 56px -24px rgb(var(--vc-shadow) / 0.65)',
      },
      keyframes: {
        pulseline: {
          '0%,100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
        rise: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        palettein: {
          '0%': { opacity: '0', transform: 'translateY(-8px) scale(0.99)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        pulseline: 'pulseline 3s ease-in-out infinite',
        rise: 'rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both',
        palettein: 'palettein 0.16s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};

export default config;
