'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MfaErrorCode } from '@vpsy/contracts';
import { api, rememberPrincipal, getPrincipal, setToken, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';

const DEMO_PASSWORD = 'Vpsy!2026';

/** Every real user has exactly one primary role in production — this maps that
 * role (as carried in the access-token payload) to its landing space. Unknown
 * or missing roles fall back to /home. */
const ROLE_ROUTE: Record<string, string> = {
  CLIENT: '/home',
  PSYCHOLOGIST: '/session',
  MANAGER: '/manager',
  EXECUTIVE: '/reports',
};

function destinationForPrincipal(): string {
  const principal = getPrincipal();
  const role = principal?.roles.find((r) => r in ROLE_ROUTE);
  return role ? ROLE_ROUTE[role]! : '/home';
}

/** Demo accounts — real seeded logins, one per role, password is the same demo secret. */
const DEMO: { email: string; roleKey: 'login.roleManager' | 'login.rolePsychologist' | 'login.roleClient' | 'login.roleExecutive' }[] = [
  { email: 'alex.client@example.com', roleKey: 'login.roleClient' },
  { email: 'dr.rivera@vpsy.health', roleKey: 'login.rolePsychologist' },
  { email: 'manager@vpsy.health', roleKey: 'login.roleManager' },
  { email: 'exec@vpsy.health', roleKey: 'login.roleExecutive' },
];

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('manager@vpsy.health');
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [showPw, setShowPw] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // MFA (doc 06-security-and-rbac.md §3): shown only once the API tells us
  // this account has TOTP enrolled — most accounts (incl. every demo login)
  // never see this, since MFA is opt-in per user, not globally required.
  const [mfaPrompt, setMfaPrompt] = useState(false);
  const [totp, setTotp] = useState('');

  /** Real login for any email/password pair — used by the form submit AND
   * by each one-click demo button (those are real logins, not fake sessions). */
  async function doLogin(loginEmail: string, loginPassword: string, loginTotp?: string) {
    setBusy(true);
    setMsg(null);
    setEmail(loginEmail);
    setPassword(loginPassword);
    // A fresh attempt (no code carried over) starts clean — only the
    // MFA_REQUIRED/MFA_INVALID branch below re-opens the code prompt.
    if (!loginTotp) {
      setMfaPrompt(false);
      setTotp('');
    }
    try {
      const tok = await api.login(loginEmail, loginPassword, loginTotp);
      rememberPrincipal(
        tok.principal
          ? { sub: tok.principal.userId, roles: tok.principal.roles, permissions: tok.principal.permissions }
          : null,
      );
      // Compat only: the real session is the httpOnly cookie the API just set.
      // This also populates the legacy client-token shim a few out-of-scope
      // pages/the realtime socket handshake still read (see lib/api.ts).
      setToken(tok.accessToken);
      setMsg({ text: t('login.success'), ok: true });
      router.push(destinationForPrincipal());
    } catch (err) {
      const mfaCode = err instanceof ApiError && (err.body as { code?: string } | undefined)?.code;
      if (mfaCode === MfaErrorCode.MFA_REQUIRED || mfaCode === MfaErrorCode.MFA_INVALID) {
        setMfaPrompt(true);
        setTotp('');
        setMsg({
          text: mfaCode === MfaErrorCode.MFA_INVALID ? t('login.errMfaInvalid') : t('login.mfaPrompt'),
          ok: false,
        });
        setBusy(false);
        return;
      }
      setMsg({
        text:
          err instanceof ApiError && err.status === 401
            ? t('login.errInvalidCredentials')
            : err instanceof ApiError
              ? t('login.errStatus', { status: err.status })
              : t('login.errNetwork'),
        ok: false,
      });
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await doLogin(email, password, mfaPrompt ? totp : undefined);
  }

  return (
    <main className="relative grid min-h-screen place-items-center bg-console-900 bg-aurora px-6 py-10">
      <div className="absolute end-5 top-5 flex items-center gap-2">
        <ThemeToggle />
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-sm border border-teal/30 bg-teal/10" aria-hidden>
            <span className="h-1.5 w-1.5 rounded-full bg-teal animate-pulseline" />
          </span>
          <span className="font-display text-xl font-semibold text-mist">
            VPSY<span className="text-haze"> OS</span>
          </span>
        </Link>
        <form onSubmit={submit} className="mt-6 card p-6">
          <p className="eyebrow">{t('login.eyebrow')}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('login.title')}</h1>

          <label htmlFor="login-email" className="field-label mt-6">{t('login.emailLabel')}</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label htmlFor="login-password" className="field-label mt-4">{t('login.passwordLabel')}</label>
          <div className="relative">
            <input
              id="login-password"
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              className="field pe-12"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? t('login.hidePassword') : t('login.showPassword')}
              aria-pressed={showPw}
              className="absolute end-2 top-1/2 -translate-y-1/2 rounded-sm p-2 text-mist/50 transition hover:text-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
            >
              {showPw ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d="M3 3l18 18M10.6 10.7a2.5 2.5 0 003.5 3.5M6.7 6.9C4.6 8.2 3 10 2 12c1.8 3.7 5.5 6 10 6 1.5 0 3-.3 4.3-.8M9.9 4.2A10.9 10.9 0 0112 4c4.5 0 8.2 2.3 10 6-.6 1.2-1.4 2.3-2.4 3.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d="M2 12c1.8-3.7 5.5-6 10-6s8.2 2.3 10 6c-1.8 3.7-5.5 6-10 6s-8.2-2.3-10-6z" />
                  <circle cx="12" cy="12" r="2.5" />
                </svg>
              )}
            </button>
          </div>

          {mfaPrompt && (
            <>
              <label htmlFor="login-totp" className="field-label mt-4">{t('login.mfaCodeLabel')}</label>
              <input
                id="login-totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                className="field font-mono tracking-widest"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoFocus
              />
            </>
          )}

          <button type="submit" disabled={busy} className="btn-primary mt-6 w-full disabled:opacity-60">
            {busy ? t('login.submitting') : t('login.submit')}
          </button>

          {msg && (
            <p role="status" className={`mt-4 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>
              {msg.text}
            </p>
          )}

          <div className="hairline-t mt-6 pt-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-haze/90">
              {t('login.demoTitle', { pw: DEMO_PASSWORD })}
            </p>
            <div className="mt-3 space-y-1">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  disabled={busy}
                  onClick={() => doLogin(d.email, DEMO_PASSWORD)}
                  className="flex w-full items-center justify-between gap-2 rounded-sm border border-line/15 px-2.5 py-2 text-start text-sm text-mist/70 transition hover:border-line/35 hover:bg-line/5 hover:text-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal disabled:opacity-60"
                >
                  <span dir="ltr" className="truncate font-mono text-xs">{d.email}</span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-haze">{t(d.roleKey)}</span>
                </button>
              ))}
            </div>
          </div>
        </form>
        <p className="mt-5 text-center text-xs text-mist/40">{t('common.aiMotto')}</p>
      </div>
    </main>
  );
}
