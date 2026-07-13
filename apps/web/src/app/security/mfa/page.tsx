'use client';

/**
 * Forced MFA enrollment for mandatory clinical/admin roles (doc 06 §3).
 * The API issues a restricted session until TOTP is verified; this page is
 * the only client surface that can complete enrollment.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getPrincipal, rememberPrincipal, setToken, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function MfaEnrollmentPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    const principal = getPrincipal();
    if (!principal) {
      router.replace('/login');
      return;
    }
    // Already enrolled — return to role landing.
    if (!principal.mfaEnrollmentRequired) {
      router.replace('/home');
    }
  }, [router]);

  async function startEnroll() {
    setBusy(true);
    setMsg(null);
    try {
      const result = await api.mfaEnroll();
      setSecret(result.secret);
      setOtpauthUrl(result.otpauthUrl);
      setMsg({ text: t('mfa.enrollReady'), ok: true });
    } catch (err) {
      setMsg({
        text: err instanceof ApiError ? t('mfa.enrollFailed', { status: err.status }) : t('mfa.enrollFailedNetwork'),
        ok: false,
      });
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (code.trim().length !== 6) return;
    setBusy(true);
    setMsg(null);
    try {
      const tokens = await api.mfaVerify(code.trim());
      rememberPrincipal(
        tokens.principal
          ? {
              sub: tokens.principal.userId,
              tenantId: tokens.principal.tenantId,
              roles: tokens.principal.roles,
              permissions: tokens.principal.permissions,
              mfaEnrollmentRequired: tokens.principal.mfaEnrollmentRequired,
            }
          : null,
      );
      setToken(tokens.accessToken);
      setMsg({ text: t('mfa.verifySuccess'), ok: true });
      router.replace('/home');
    } catch {
      setMsg({ text: t('mfa.verifyFailed'), ok: false });
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
      <div className="w-full max-w-md rounded-md border border-line/20 bg-console-800/80 p-6 shadow-glow">
        <p className="eyebrow text-signal">{t('mfa.eyebrow')}</p>
        <h1 className="mt-2 font-display text-xl font-semibold text-mist">{t('mfa.title')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-mist/65">{t('mfa.body')}</p>

        {!secret ? (
          <button type="button" className="btn-primary mt-6 w-full" disabled={busy} onClick={() => void startEnroll()}>
            {busy ? t('mfa.starting') : t('mfa.start')}
          </button>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="rounded border border-line/20 bg-console-900/60 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-haze/90">{t('mfa.secretLabel')}</p>
              <p className="mt-1 break-all font-mono text-sm text-teal" dir="ltr">
                {secret}
              </p>
              {otpauthUrl && (
                <p className="mt-2 break-all text-[11px] text-mist/45" dir="ltr">
                  {otpauthUrl}
                </p>
              )}
            </div>
            <label className="field-label" htmlFor="mfa-code">
              {t('mfa.codeLabel')}
            </label>
            <input
              id="mfa-code"
              className="field"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              dir="ltr"
            />
            <button type="button" className="btn-primary w-full" disabled={busy || code.length !== 6} onClick={() => void verify()}>
              {busy ? t('mfa.verifying') : t('mfa.verify')}
            </button>
          </div>
        )}

        {msg && (
          <p role={msg.ok ? 'status' : 'alert'} className={`mt-4 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>
            {msg.text}
          </p>
        )}
      </div>
    </main>
  );
}
