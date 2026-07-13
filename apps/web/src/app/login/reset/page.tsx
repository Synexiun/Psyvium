'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function PasswordResetPage() {
  const { t } = useI18n();
  const [step, setStep] = useState<'request' | 'complete'>('request');
  const [email, setEmail] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const result = await api.passwordResetRequest(email, tenantSlug.trim() || undefined);
      setMsg({ text: t('reset.requestOk'), ok: true });
      // Local/dev only — production never returns a token.
      if (result.devResetToken) {
        setToken(result.devResetToken);
        setStep('complete');
        setMsg({ text: t('reset.devTokenShown'), ok: true });
      }
    } catch (err) {
      setMsg({
        text: err instanceof ApiError ? t('reset.errStatus', { status: err.status }) : t('reset.errNetwork'),
        ok: false,
      });
    } finally {
      setBusy(false);
    }
  }

  async function completeReset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.passwordResetComplete(token.trim(), password);
      setMsg({ text: t('reset.completeOk'), ok: true });
    } catch {
      setMsg({ text: t('reset.completeFailed'), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center bg-console-900 bg-aurora px-6 py-10">
      <div className="absolute end-5 top-5 flex items-center gap-2">
        <ThemeToggle />
        <LanguageSwitcher />
      </div>
      <div className="w-full max-w-sm rounded-md border border-line/20 bg-console-800/80 p-6">
        <p className="eyebrow">{t('reset.eyebrow')}</p>
        <h1 className="mt-2 font-display text-xl font-semibold text-mist">{t('reset.title')}</h1>
        <p className="mt-2 text-sm text-mist/60">{t('reset.body')}</p>

        {step === 'request' ? (
          <form className="mt-5 space-y-3" onSubmit={requestReset}>
            <label className="field-label" htmlFor="reset-email">
              {t('login.emailLabel')}
            </label>
            <input
              id="reset-email"
              type="email"
              className="field"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label className="field-label" htmlFor="reset-tenant">
              {t('login.tenantLabel')}
            </label>
            <input
              id="reset-tenant"
              className="field"
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              placeholder={t('login.tenantPlaceholder')}
            />
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? t('reset.requesting') : t('reset.request')}
            </button>
            <button type="button" className="btn-ghost w-full text-xs" onClick={() => setStep('complete')}>
              {t('reset.haveToken')}
            </button>
          </form>
        ) : (
          <form className="mt-5 space-y-3" onSubmit={completeReset}>
            <label className="field-label" htmlFor="reset-token">
              {t('reset.tokenLabel')}
            </label>
            <input
              id="reset-token"
              className="field font-mono text-xs"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              dir="ltr"
            />
            <label className="field-label" htmlFor="reset-pw">
              {t('reset.newPassword')}
            </label>
            <input
              id="reset-pw"
              type="password"
              className="field"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="submit" className="btn-primary w-full" disabled={busy || password.length < 8}>
              {busy ? t('reset.completing') : t('reset.complete')}
            </button>
            <button type="button" className="btn-ghost w-full text-xs" onClick={() => setStep('request')}>
              {t('reset.back')}
            </button>
          </form>
        )}

        {msg && (
          <p role={msg.ok ? 'status' : 'alert'} className={`mt-4 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>
            {msg.text}
          </p>
        )}

        <p className="mt-5 text-center text-sm">
          <Link href="/login" className="text-teal hover:underline">
            {t('reset.backToLogin')}
          </Link>
        </p>
      </div>
    </main>
  );
}
