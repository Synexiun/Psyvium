import type { Config } from 'tailwindcss';

/**
 * VPSY "Clinical Aurora" design tokens. Deliberately not the AI-default cream/
 * serif or acid-green looks — a slate-indigo monitoring-console base with a calm
 * therapeutic teal primary and a signal-amber reserved for risk/attention.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        console: {
          950: '#070B16',
          900: '#0B1020',
          800: '#0E1428',
          700: '#161E38',
          600: '#1F2A4A',
          500: '#2B3862',
        },
        teal: {
          DEFAULT: '#38BDC9',
          soft: '#7CD9E1',
          deep: '#1B7E88',
        },
        signal: {
          DEFAULT: '#F5A623',
          soft: '#FBCB72',
          deep: '#B9761A',
        },
        risk: '#F26D6D',
        mist: '#F6F7F9',
        haze: '#E7EBF0',
        ink: '#0B1020',
      },
      fontFamily: {
        // Noto families cover Arabic / CJK / Devanagari so the identity holds
        // across every supported script (unicode-range keeps downloads lean).
        display: ['var(--font-display)', 'Space Grotesk', 'Noto Sans Arabic', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans Devanagari', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'Inter', 'Noto Sans Arabic', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans Devanagari', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'IBM Plex Mono', 'monospace'],
      },
      letterSpacing: {
        eyebrow: '0.22em',
      },
      boxShadow: {
        console: '0 20px 60px -20px rgba(56, 189, 201, 0.25)',
        lift: '0 24px 80px -32px rgba(7, 11, 22, 0.55)',
      },
      backgroundImage: {
        aurora:
          'radial-gradient(60% 80% at 20% 10%, rgba(56,189,201,0.18) 0%, transparent 60%), radial-gradient(50% 60% at 90% 0%, rgba(245,166,35,0.10) 0%, transparent 55%)',
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
      },
      animation: {
        pulseline: 'pulseline 3s ease-in-out infinite',
        rise: 'rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};

export default config;
