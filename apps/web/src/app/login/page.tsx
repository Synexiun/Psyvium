'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, setToken, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

const DEMO_PASSWORD = 'Vpsy!2026';

/** Demo accounts, with the space each role lands in after sign-in. */
const DEMO: { email: string; roleKey: 'login.roleManager' | 'login.rolePsychologist' | 'login.roleClient'; dest: string }[] = [
  { email: 'manager@vpsy.health', roleKey: 'login.roleManager', dest: '/manager' },
  { email: 'dr.rivera@vpsy.health', roleKey: 'login.rolePsychologist', dest: '/session' },
  { email: 'alex.client@example.com', roleKey: 'login.roleClient', dest: '/home' },
];

function destinationFor(email: string): string {
  return DEMO.find((d) => d.email === email)?.dest ?? '/home';
}

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [email, setEmail] = useState('manager@vpsy.health');
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [showPw, setShowPw] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const tok = await api.login(email, password);
      setToken(tok.accessToken);
      setMsg({ text: t('login.success'), ok: true });
      router.push(destinationFor(email));
    } catch (err) {
      setMsg({
        text:
          err instanceof ApiError
            ? t('login.errStatus', { status: err.status })
            : t('login.errNetwork'),
        ok: false,
      });
      setBusy(false);
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center bg-console-900 bg-aurora px-6 py-10">
      <div className="absolute end-5 top-5">
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm">
        <Link href="/" className="font-display text-xl font-semibold text-mist">
          VPSY<span className="text-teal"> OS</span>
        </Link>
        <form onSubmit={submit} className="mt-6 card p-7">
          <p className="eyebrow">{t('login.eyebrow')}</p>
          <h1 className="mt-3 font-display text-2xl font-semibold text-mist">{t('login.title')}</h1>

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
              className="absolute end-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-mist/50 transition hover:text-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-soft"
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

          <button type="submit" disabled={busy} className="btn-primary mt-6 w-full disabled:opacity-60">
            {busy ? t('login.submitting') : t('login.submit')}
          </button>

          {msg && (
            <p role="status" className={`mt-4 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>
              {msg.text}
            </p>
          )}

          <div className="mt-6 border-t border-white/[0.06] pt-5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">
              {t('login.demoTitle', { pw: DEMO_PASSWORD })}
            </p>
            <div className="mt-3 space-y-1.5">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => { setEmail(d.email); setPassword(DEMO_PASSWORD); }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-start text-sm text-mist/60 transition hover:bg-white/[0.04] hover:text-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-soft"
                >
                  <span dir="ltr" className="truncate">{d.email}</span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-teal-soft/70">{t(d.roleKey)}</span>
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
