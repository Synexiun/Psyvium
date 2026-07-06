'use client';

/**
 * ⌘K / Ctrl-K COMMAND PALETTE — the signature of the Clinical Command Center.
 *
 * - Fuzzy subsequence matching (word-start + adjacency bonuses) over every
 *   route plus key actions; matched characters are emphasized.
 * - Keyboard-first: ⌘K/Ctrl-K toggles, ArrowUp/Down/Home/End move, Enter
 *   runs, Esc closes. Focus is trapped while open and restored on close.
 * - Accessible: role=dialog + aria-modal, combobox/listbox wiring with
 *   aria-activedescendant, results count announced politely.
 * - RTL-correct (logical properties only) and reduced-motion aware (the
 *   entrance animation is disabled globally under prefers-reduced-motion).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n';
import type { MessageKey } from '@/i18n';
import { applyThemePref, getThemePref, resolveDark } from '@/lib/theme';

interface Command {
  id: string;
  labelKey: MessageKey;
  group: 'navigate' | 'actions';
  /** Route commands navigate; action commands run. */
  href?: string;
  run?: () => void;
  /** Untranslated synonyms so power users can type the route slug. */
  keywords?: string;
}

const ROUTE_COMMANDS: Command[] = [
  { id: 'nav-home', labelKey: 'nav.home', group: 'navigate', href: '/home', keywords: 'home patient' },
  { id: 'nav-intake', labelKey: 'nav.intake', group: 'navigate', href: '/intake', keywords: 'intake screening' },
  { id: 'nav-session', labelKey: 'nav.workspace', group: 'navigate', href: '/session', keywords: 'session workspace clinician' },
  { id: 'nav-manager', labelKey: 'nav.triage', group: 'navigate', href: '/manager', keywords: 'manager triage assignment' },
  { id: 'nav-crm', labelKey: 'nav.crm', group: 'navigate', href: '/crm', keywords: 'crm clients' },
  { id: 'nav-comms', labelKey: 'nav.comms', group: 'navigate', href: '/comms', keywords: 'comms messages calls' },
  { id: 'nav-risk', labelKey: 'nav.risk', group: 'navigate', href: '/risk', keywords: 'risk safety alerts' },
  { id: 'nav-schedule', labelKey: 'nav.schedule', group: 'navigate', href: '/schedule', keywords: 'schedule calendar appointments' },
  { id: 'nav-finance', labelKey: 'nav.finance', group: 'navigate', href: '/finance', keywords: 'finance billing payments' },
  { id: 'nav-reports', labelKey: 'nav.reports', group: 'navigate', href: '/reports', keywords: 'reports analytics' },
  { id: 'nav-login', labelKey: 'common.signIn', group: 'navigate', href: '/login', keywords: 'login sign in auth' },
];

/** Fuzzy subsequence score; higher is better, null = no match. */
function fuzzyScore(query: string, target: string): { score: number; indices: number[] } | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!;
    if (ch === ' ') continue;
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti;
        break;
      }
      ti++;
    }
    if (found === -1) return null;
    // Bonuses: adjacency, word start, exact start.
    score += 1;
    if (found === prev + 1) score += 3;
    if (found === 0 || t[found - 1] === ' ' || t[found - 1] === '/') score += 2;
    indices.push(found);
    prev = found;
    ti = found + 1;
  }
  // Shorter targets rank higher on equal match quality.
  score -= t.length * 0.01;
  return { score, indices };
}

function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const set = new Set(indices);
  return (
    <>
      {text.split('').map((ch, i) =>
        set.has(i) ? (
          <span key={i} className="font-semibold text-mist underline decoration-teal/60 decoration-2 underline-offset-2">
            {ch}
          </span>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const listboxId = 'vpsy-palette-listbox';

  const commands = useMemo<Command[]>(
    () => [
      ...ROUTE_COMMANDS,
      {
        id: 'act-theme',
        labelKey: 'palette.actionTheme',
        group: 'actions',
        keywords: 'theme dark light mode',
        run: () => {
          // Flip the *resolved* theme and persist it as an explicit choice.
          applyThemePref(resolveDark(getThemePref()) ? 'light' : 'dark');
        },
      },
      {
        id: 'act-reload',
        labelKey: 'palette.actionReload',
        group: 'actions',
        keywords: 'reload refresh data',
        run: () => window.location.reload(),
      },
      {
        id: 'act-overview',
        labelKey: 'palette.actionOverview',
        group: 'actions',
        href: '/',
        keywords: 'overview landing about',
      },
    ],
    [],
  );

  const results = useMemo(() => {
    const scored = commands
      .map((cmd) => {
        const label = t(cmd.labelKey);
        const byLabel = fuzzyScore(query, label);
        const byKeyword = cmd.keywords ? fuzzyScore(query, cmd.keywords) : null;
        const best =
          byLabel && byKeyword
            ? byLabel.score >= byKeyword.score
              ? { ...byLabel, viaLabel: true }
              : { ...byKeyword, viaLabel: false }
            : byLabel
              ? { ...byLabel, viaLabel: true }
              : byKeyword
                ? { ...byKeyword, viaLabel: false }
                : null;
        return best ? { cmd, label, score: best.score, indices: best.viaLabel ? best.indices : [] } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    return scored;
  }, [commands, query, t]);

  // Reset + capture focus origin when opening.
  useEffect(() => {
    if (open) {
      restoreRef.current = (document.activeElement as HTMLElement) ?? null;
      setQuery('');
      setActive(0);
      // Focus after paint so the dialog exists.
      requestAnimationFrame(() => inputRef.current?.focus());
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
    return undefined;
  }, [open]);

  const close = useCallback(() => {
    onClose();
    restoreRef.current?.focus?.();
  }, [onClose]);

  const runCommand = useCallback(
    (cmd: Command) => {
      close();
      if (cmd.href) router.push(cmd.href);
      else cmd.run?.();
    },
    [close, router],
  );

  // Keyboard handling inside the dialog (also traps Tab).
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (results.length === 0 ? 0 : (a + 1) % results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (results.length === 0 ? 0 : (a - 1 + results.length) % results.length));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(0, results.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[active];
      if (r) runCommand(r.cmd);
    } else if (e.key === 'Tab') {
      // Single-field dialog: keep focus on the input (trap).
      e.preventDefault();
      inputRef.current?.focus();
    }
  }

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listboxId}-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  const groups: { group: Command['group']; labelKey: MessageKey }[] = [
    { group: 'navigate', labelKey: 'palette.navigateGroup' },
    { group: 'actions', labelKey: 'palette.actionsGroup' },
  ];

  return (
    <div className="fixed inset-0 z-[90]" onKeyDown={onKeyDown}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-console-950/70 backdrop-blur-[2px]" onClick={close} aria-hidden />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        className="card animate-palettein absolute inset-x-4 top-[12vh] mx-auto max-w-xl overflow-hidden shadow-lift sm:inset-x-6"
      >
        {/* Input row */}
        <div className="hairline-b flex items-center gap-3 px-4 py-3">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-haze" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={results.length > 0 ? `${listboxId}-opt-${active}` : undefined}
            aria-autocomplete="list"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder={t('palette.placeholder')}
            className="w-full bg-transparent text-sm text-mist placeholder:text-mist/35 focus:outline-none"
          />
          <kbd className="chip shrink-0 normal-case">esc</kbd>
        </div>

        {/* Results */}
        <ul id={listboxId} role="listbox" aria-label={t('palette.title')} className="max-h-[46vh] overflow-y-auto p-1.5">
          {groups.map(({ group, labelKey }) => {
            const groupResults = results
              .map((r, i) => ({ ...r, flatIndex: i }))
              .filter((r) => r.cmd.group === group);
            if (groupResults.length === 0) return null;
            return (
              <li key={group} role="presentation">
                <p className="px-2.5 pb-1 pt-2 font-mono text-[10px] uppercase tracking-eyebrow text-haze/80" aria-hidden>
                  {t(labelKey)}
                </p>
                <ul role="presentation">
                  {groupResults.map((r) => {
                    const isActive = r.flatIndex === active;
                    return (
                      <li
                        key={r.cmd.id}
                        id={`${listboxId}-opt-${r.flatIndex}`}
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActive(r.flatIndex)}
                        onMouseDown={(e) => e.preventDefault() /* keep input focus */}
                        onClick={() => runCommand(r.cmd)}
                        className={`flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-sm transition ${
                          isActive ? 'bg-teal/15 text-mist' : 'text-mist/75'
                        }`}
                      >
                        <span>
                          <Highlight text={r.label} indices={r.indices} />
                        </span>
                        {r.cmd.href && (
                          <span className="font-mono text-[10px] text-haze/70" dir="ltr">
                            {r.cmd.href}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
          {results.length === 0 && (
            <li className="px-2.5 py-6 text-center text-xs text-mist/45">{t('palette.noResults')}</li>
          )}
        </ul>

        {/* Hint bar */}
        <div className="hairline-t flex items-center gap-4 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-haze/70">
          <span>
            <kbd className="me-1">↑↓</kbd>
            {t('palette.hintNavigate')}
          </span>
          <span>
            <kbd className="me-1">↵</kbd>
            {t('palette.hintSelect')}
          </span>
          <span aria-live="polite" className="ms-auto tabular-nums">
            {results.length}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Global hotkey hook: ⌘K (mac) / Ctrl-K toggles the palette. */
export function useCommandPaletteHotkey(toggle: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
}
