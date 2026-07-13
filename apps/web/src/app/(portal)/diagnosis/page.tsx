'use client';

/**
 * Diagnosis Support — clinician surface for non-diagnostic differentials and
 * coded formulations. AI never writes these records; clinicians author them.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, getPrincipal, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useResource } from '@/lib/use-resource';
import { ErrorPanel } from '@/components/ErrorPanel';
import { SkeletonStack } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';
import type { CaseloadEntry } from '@/lib/clinical-types';

type Hypothesis = {
  id: string;
  hypothesis: string;
  confidence: number;
  evidence: string[];
  referralFlags: string[];
  clinicianConfirmed: boolean;
  createdAt: string;
};

type Formulation = {
  id: string;
  icdCode: string;
  dsmCode: string | null;
  description: string;
  status: string;
  createdAt: string;
};

export default function DiagnosisPage() {
  const { t, fmtDate, fmtPercent } = useI18n();
  const [clientId, setClientId] = useState<string>('');
  const [caseload, setCaseload] = useState<CaseloadEntry[]>([]);

  useEffect(() => {
    if (!getPrincipal()) return;
    void api.myCaseload().then(setCaseload).catch(() => setCaseload([]));
  }, []);

  const loadHypos = useCallback(async () => {
    if (!clientId) return [] as Hypothesis[];
    return api.diagnosisList(clientId) as Promise<Hypothesis[]>;
  }, [clientId]);
  const loadForms = useCallback(async () => {
    if (!clientId) return [] as Formulation[];
    return api.formulationList(clientId) as Promise<Formulation[]>;
  }, [clientId]);

  const hypos = useResource(loadHypos, [clientId]);
  const forms = useResource(loadForms, [clientId]);

  const [hypText, setHypText] = useState('');
  const [hypBusy, setHypBusy] = useState(false);
  const [icd, setIcd] = useState('');
  const [dsm, setDsm] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function addHypothesis() {
    if (!clientId || hypText.trim().length < 3) return;
    setHypBusy(true);
    setMsg(null);
    try {
      await api.diagnosisCreate({ clientId, hypothesis: hypText.trim(), confidence: 0.5 });
      setHypText('');
      hypos.reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? t('diagnosis.errStatus', { status: e.status }) : t('diagnosis.errNetwork'));
    } finally {
      setHypBusy(false);
    }
  }

  async function toggleConfirm(h: Hypothesis) {
    try {
      await api.diagnosisConfirm(h.id, !h.clinicianConfirmed);
      hypos.reload();
    } catch {
      setMsg(t('diagnosis.actionFailed'));
    }
  }

  async function addFormulation() {
    if (!clientId || icd.trim().length < 2 || formDesc.trim().length < 3) return;
    setFormBusy(true);
    setMsg(null);
    try {
      await api.formulationCreate({
        clientId,
        icdCode: icd.trim(),
        dsmCode: dsm.trim() || undefined,
        description: formDesc.trim(),
        status: 'PROVISIONAL',
      });
      setIcd('');
      setDsm('');
      setFormDesc('');
      forms.reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? t('diagnosis.errStatus', { status: e.status }) : t('diagnosis.errNetwork'));
    } finally {
      setFormBusy(false);
    }
  }

  return (
    <div>
      <p className="eyebrow">{t('diagnosis.eyebrow')}</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('diagnosis.title')}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-mist/60">{t('diagnosis.intro')}</p>

      <label className="field-label mt-6" htmlFor="dx-client">
        {t('diagnosis.selectClient')}
      </label>
      <select
        id="dx-client"
        className="field mt-1 max-w-md"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
      >
        <option value="">{t('diagnosis.selectClientPlaceholder')}</option>
        {caseload.map((c) => (
          <option key={c.clientId} value={c.clientId}>
            {c.displayName} · {c.riskLevel}
          </option>
        ))}
      </select>

      {msg && (
        <p role="alert" className="mt-3 text-sm text-risk">
          {msg}
        </p>
      )}

      {!clientId && <EmptyState className="mt-6" body={t('diagnosis.pickClient')} />}

      {clientId && (
        <div className="mt-8 grid gap-6 xl:grid-cols-2">
          <section className="card p-5">
            <p className="eyebrow">{t('diagnosis.hypEyebrow')}</p>
            <h2 className="mt-1.5 font-display text-lg text-mist">{t('diagnosis.hypTitle')}</h2>
            <p className="mt-1 text-xs text-mist/50">{t('diagnosis.hypHint')}</p>

            <label className="field-label mt-4" htmlFor="hyp-text">
              {t('diagnosis.hypLabel')}
            </label>
            <textarea
              id="hyp-text"
              className="field mt-1 min-h-[72px]"
              value={hypText}
              onChange={(e) => setHypText(e.target.value)}
              placeholder={t('diagnosis.hypPlaceholder')}
            />
            <button
              type="button"
              className="btn-primary mt-3"
              disabled={hypBusy || hypText.trim().length < 3}
              onClick={() => void addHypothesis()}
            >
              {hypBusy ? t('diagnosis.saving') : t('diagnosis.addHyp')}
            </button>

            {hypos.loading && <SkeletonStack count={2} className="mt-4 space-y-2" />}
            {!!hypos.error && (
              <ErrorPanel
                className="mt-4"
                message={t('diagnosis.errNetwork')}
                onRetry={hypos.reload}
              />
            )}
            {!hypos.loading && !hypos.error && (hypos.data?.length ?? 0) === 0 && (
              <p className="mt-4 text-sm text-mist/45">{t('diagnosis.hypEmpty')}</p>
            )}
            <ul className="mt-4 space-y-2">
              {(hypos.data ?? []).map((h) => (
                <li key={h.id} className="card-inset p-3">
                  <p className="text-sm text-mist/90">{h.hypothesis}</p>
                  <p className="mt-1 font-mono text-[10px] text-haze/80">
                    conf {fmtPercent(h.confidence)} · {fmtDate(h.createdAt)}
                  </p>
                  <button
                    type="button"
                    className="btn-ghost mt-2 px-2 py-1 text-xs"
                    onClick={() => void toggleConfirm(h)}
                  >
                    {h.clinicianConfirmed ? t('diagnosis.confirmed') : t('diagnosis.confirm')}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="card p-5">
            <p className="eyebrow">{t('diagnosis.formEyebrow')}</p>
            <h2 className="mt-1.5 font-display text-lg text-mist">{t('diagnosis.formTitle')}</h2>
            <p className="mt-1 text-xs text-mist/50">{t('diagnosis.formHint')}</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="icd">
                  {t('diagnosis.icd')}
                </label>
                <input id="icd" className="field mt-1" value={icd} onChange={(e) => setIcd(e.target.value)} dir="ltr" />
              </div>
              <div>
                <label className="field-label" htmlFor="dsm">
                  {t('diagnosis.dsm')}
                </label>
                <input id="dsm" className="field mt-1" value={dsm} onChange={(e) => setDsm(e.target.value)} dir="ltr" />
              </div>
            </div>
            <label className="field-label mt-3" htmlFor="form-desc">
              {t('diagnosis.formDesc')}
            </label>
            <textarea
              id="form-desc"
              className="field mt-1 min-h-[72px]"
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
            />
            <button
              type="button"
              className="btn-primary mt-3"
              disabled={formBusy || icd.trim().length < 2 || formDesc.trim().length < 3}
              onClick={() => void addFormulation()}
            >
              {formBusy ? t('diagnosis.saving') : t('diagnosis.addForm')}
            </button>

            {forms.loading && <SkeletonStack count={2} className="mt-4 space-y-2" />}
            {!forms.loading && (forms.data?.length ?? 0) === 0 && (
              <p className="mt-4 text-sm text-mist/45">{t('diagnosis.formEmpty')}</p>
            )}
            <ul className="mt-4 space-y-2">
              {(forms.data ?? []).map((f) => (
                <li key={f.id} className="card-inset p-3">
                  <p className="font-mono text-xs text-teal" dir="ltr">
                    {f.icdCode}
                    {f.dsmCode ? ` · ${f.dsmCode}` : ''}
                  </p>
                  <p className="mt-1 text-sm text-mist/90">{f.description}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-haze/80">
                    {f.status} · {fmtDate(f.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
