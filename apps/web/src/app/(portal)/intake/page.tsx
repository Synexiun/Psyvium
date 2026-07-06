'use client';

import { useState } from 'react';
import { api, setToken, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { LOCALES, LOCALE_META } from '@/i18n/config';

type Screening = {
  severityBand: string;
  riskScore: number;
  urgencyScore: number;
  suggestedSpecialty: string;
  virtualCareSuitable: boolean;
  contraindications: string[];
  riskFlagsRaised: string[];
  aiSummary: string | null;
};

const bandColor: Record<string, string> = {
  LOW: 'text-teal-soft',
  MODERATE: 'text-signal-soft',
  HIGH: 'text-signal',
  SEVERE: 'text-risk',
};

function Slider({ label, value, onChange, fmt }: { label: string; value: number; onChange: (v: number) => void; fmt: (n: number) => string }) {
  return (
    <label className="block">
      <div className="mb-2 flex items-center justify-between">
        <span className="field-label mb-0">{label}</span>
        <span className="font-mono text-xs text-teal-soft">{fmt(value)}</span>
      </div>
      <input type="range" min={0} max={10} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

const TOTAL_STEPS = 4;

export default function IntakePage() {
  const { t, dict, fmtNumber } = useI18n();
  const [step, setStep] = useState(0);
  const [triedNext, setTriedNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Screening | null>(null);

  const [form, setForm] = useState({
    presentingProblem: '',
    goals: '',
    sleepQuality: 5,
    energyLevel: 5,
    concentration: 5,
    work: 3,
    family: 3,
    social: 3,
    selfCare: 3,
    traumaExposure: false,
    previousTherapy: false,
    suicidalIdeation: false,
    suicidalPlan: false,
    selfHarm: false,
    harmToOthers: false,
    preferredLanguage: 'en',
    therapyFormat: 'INDIVIDUAL',
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const storyValid = form.presentingProblem.trim().length >= 12;

  function next() {
    if (step === 0 && !storyValid) {
      setTriedNext(true);
      return;
    }
    setTriedNext(false);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function ensureSession() {
    // Demo convenience: sign in as the seeded client if no token yet.
    try {
      const tok = await api.login('alex.client@example.com', 'Vpsy!2026');
      setToken(tok.accessToken);
    } catch {
      /* API may be offline; submit will surface the error */
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    await ensureSession();
    try {
      const payload = {
        presentingProblem: form.presentingProblem.trim(),
        previousTherapy: form.previousTherapy,
        traumaExposure: form.traumaExposure,
        sleepQuality: form.sleepQuality,
        appetiteChange: 0,
        energyLevel: form.energyLevel,
        concentration: form.concentration,
        substanceUse: { alcohol: 'none', tobacco: 'none', cannabis: 'none' },
        functionalImpairment: { work: form.work, family: form.family, social: form.social, selfCare: form.selfCare },
        safety: {
          suicidalIdeation: form.suicidalIdeation,
          suicidalPlan: form.suicidalPlan,
          selfHarm: form.selfHarm,
          harmToOthers: form.harmToOthers,
          recentLoss: false,
        },
        goals: form.goals ? form.goals.split(',').map((g) => g.trim()).filter(Boolean) : [],
        preferredTherapistGender: 'any',
        preferredLanguage: form.preferredLanguage,
        therapyFormat: form.therapyFormat,
      };
      const res = (await api.submitIntake(payload)) as Screening;
      setResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? t('intake.errStatus', { status: e.status }) : t('intake.errNetwork'));
    } finally {
      setBusy(false);
    }
  }

  const steps = dict.intake.steps;
  const safetyItems = [
    ['suicidalIdeation', t('intake.sIdeation')],
    ['suicidalPlan', t('intake.sPlan')],
    ['selfHarm', t('intake.sSelfHarm')],
    ['harmToOthers', t('intake.sHarmOthers')],
    ['traumaExposure', t('intake.sTrauma')],
    ['previousTherapy', t('intake.sPrevTherapy')],
  ] as const;

  if (result) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="card animate-rise p-7">
          <div className="flex items-center justify-between">
            <p className="eyebrow">{t('intake.resultEyebrow')}</p>
            <span className={`font-mono text-sm font-medium ${bandColor[result.severityBand] ?? 'text-mist'}`}>
              {dict.intake.bands[result.severityBand as keyof typeof dict.intake.bands] ?? result.severityBand}
            </span>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Metric label={t('intake.riskScore')} value={fmtNumber(result.riskScore)} />
            <Metric label={t('intake.urgency')} value={fmtNumber(result.urgencyScore)} />
            <Metric label={t('intake.specialty')} value={result.suggestedSpecialty} />
          </div>
          {result.riskFlagsRaised.length > 0 && (
            <div className="mt-5 rounded-xl border border-signal/30 bg-signal/10 px-4 py-3 text-sm text-signal-soft">
              {t('intake.flagsRaised')}
            </div>
          )}
          {!result.virtualCareSuitable && <p className="mt-4 text-sm text-signal">{t('intake.inPerson')}</p>}
          {result.contraindications.length > 0 && (
            <ul className="mt-4 space-y-1.5 text-sm text-mist/60">
              {result.contraindications.map((c) => (
                <li key={c}>• {c}</li>
              ))}
            </ul>
          )}
          {result.aiSummary && (
            <div className="mt-5 border-t border-white/[0.06] pt-5">
              <p className="eyebrow text-teal-soft/70">{t('intake.aiSummaryEyebrow')}</p>
              <p className="mt-2 text-sm leading-relaxed text-mist/70">{result.aiSummary}</p>
            </div>
          )}
          <p className="mt-5 text-xs text-mist/40">{t('intake.resultNext')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow">{t('intake.eyebrow')}</p>
      <h1 className="mt-3 font-display text-3xl font-semibold text-mist">{t('intake.title')}</h1>
      <p className="mt-3 text-mist/60">{t('intake.intro')}</p>

      {/* Progress */}
      <div className="mt-8" role="group" aria-label={t('intake.stepOf', { n: fmtNumber(step + 1), total: fmtNumber(TOTAL_STEPS) })}>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-wider text-mist/50">
            {t('intake.stepOf', { n: fmtNumber(step + 1), total: fmtNumber(TOTAL_STEPS) })}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-wider text-teal-soft/80">{steps[step]}</span>
        </div>
        <div className="mt-2 flex gap-1.5">
          {steps.map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-teal' : 'bg-console-600'}`}
              aria-hidden
            />
          ))}
        </div>
      </div>

      <div className="mt-6 space-y-6">
        {/* Step 1 — Your story */}
        {step === 0 && (
          <div className="card animate-rise p-6">
            <label htmlFor="presenting" className="field-label">{t('intake.presentingLabel')}</label>
            <textarea
              id="presenting"
              className="field min-h-[120px]"
              placeholder={t('intake.presentingPlaceholder')}
              value={form.presentingProblem}
              onChange={(e) => set('presentingProblem', e.target.value)}
              aria-invalid={triedNext && !storyValid}
              aria-describedby="presenting-hint"
            />
            <p id="presenting-hint" className={`mt-2 text-xs ${triedNext && !storyValid ? 'text-signal-soft' : 'text-mist/40'}`}>
              {triedNext && !storyValid ? t('intake.validationStory') : t('intake.presentingHint')}
            </p>
            <label htmlFor="goals" className="field-label mt-5">{t('intake.goalsLabel')}</label>
            <input
              id="goals"
              className="field"
              placeholder={t('intake.goalsPlaceholder')}
              value={form.goals}
              onChange={(e) => set('goals', e.target.value)}
              aria-describedby="goals-hint"
            />
            <p id="goals-hint" className="mt-2 text-xs text-mist/40">{t('intake.goalsHint')}</p>
          </div>
        )}

        {/* Step 2 — Daily life */}
        {step === 1 && (
          <div className="animate-rise space-y-6">
            <div className="card p-6">
              <p className="mb-5 text-sm text-mist/55">{t('intake.slidersIntro')}</p>
              <div className="grid gap-6 sm:grid-cols-2">
                <Slider label={t('intake.sleep')} value={form.sleepQuality} onChange={(v) => set('sleepQuality', v)} fmt={fmtNumber} />
                <Slider label={t('intake.energy')} value={form.energyLevel} onChange={(v) => set('energyLevel', v)} fmt={fmtNumber} />
                <Slider label={t('intake.concentration')} value={form.concentration} onChange={(v) => set('concentration', v)} fmt={fmtNumber} />
              </div>
            </div>
            <div className="card p-6">
              <p className="mb-5 text-sm text-mist/55">{t('intake.impairIntro')}</p>
              <div className="grid gap-6 sm:grid-cols-2">
                <Slider label={t('intake.work')} value={form.work} onChange={(v) => set('work', v)} fmt={fmtNumber} />
                <Slider label={t('intake.family')} value={form.family} onChange={(v) => set('family', v)} fmt={fmtNumber} />
                <Slider label={t('intake.social')} value={form.social} onChange={(v) => set('social', v)} fmt={fmtNumber} />
                <Slider label={t('intake.selfCare')} value={form.selfCare} onChange={(v) => set('selfCare', v)} fmt={fmtNumber} />
              </div>
            </div>
          </div>
        )}

        {/* Step 3 — Safety, handled with care */}
        {step === 2 && (
          <div className="card animate-rise p-6">
            <p className="field-label">{t('intake.safetyTitle')}</p>
            <p className="mb-5 text-sm leading-relaxed text-mist/55">{t('intake.safetyIntro')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {safetyItems.map(([key, label]) => (
                <label
                  key={key}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
                    form[key] ? 'border-signal/40 bg-signal/[0.07]' : 'border-white/10 bg-console-950/40 hover:border-white/20'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={form[key]}
                    onChange={(e) => set(key, e.target.checked)}
                    className="h-4 w-4 accent-[#F5A623]"
                  />
                  <span className="text-sm text-mist/80">{label}</span>
                </label>
              ))}
            </div>
            <p className="mt-5 rounded-xl border border-white/[0.08] bg-console-950/50 px-4 py-3 text-xs leading-relaxed text-mist/55">
              {t('intake.crisisNote')}
            </p>
          </div>
        )}

        {/* Step 4 — Preferences */}
        {step === 3 && (
          <div className="card animate-rise p-6">
            <p className="field-label">{t('intake.prefTitle')}</p>
            <div className="mt-2 grid gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="pref-lang" className="field-label">{t('intake.prefLanguage')}</label>
                <select
                  id="pref-lang"
                  className="field"
                  value={form.preferredLanguage}
                  onChange={(e) => set('preferredLanguage', e.target.value)}
                >
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>{LOCALE_META[l].native}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="pref-format" className="field-label">{t('intake.prefFormat')}</label>
                <select
                  id="pref-format"
                  className="field"
                  value={form.therapyFormat}
                  onChange={(e) => set('therapyFormat', e.target.value)}
                >
                  <option value="INDIVIDUAL">{t('intake.formatIndividual')}</option>
                  <option value="COUPLES">{t('intake.formatCouples')}</option>
                  <option value="FAMILY">{t('intake.formatFamily')}</option>
                  <option value="GROUP">{t('intake.formatGroup')}</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-xl border border-risk/30 bg-risk/10 px-4 py-3 text-sm text-risk">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <button onClick={back} disabled={step === 0} className="btn-ghost px-5 py-2.5 text-sm disabled:invisible">
            {t('common.back')}
          </button>
          {step < TOTAL_STEPS - 1 ? (
            <button onClick={next} className="btn-primary px-6 py-2.5 text-sm">
              {t('common.next')}
            </button>
          ) : (
            <button onClick={submit} disabled={busy} className="btn-primary px-6 py-2.5 text-sm disabled:opacity-60">
              {busy ? t('intake.submitting') : t('intake.submit')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-inset p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold capitalize text-mist">{value}</p>
    </div>
  );
}
