'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, setToken, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';

type Candidate = {
  psychologistId: string;
  displayName: string;
  specialties: string[];
  languages: string[];
  jurisdiction: string;
  caseloadUtilization: number;
  outcomeIndex: number;
  score: number;
  rationale: string;
  fitWarnings: string[];
};
type Proposal = {
  id: string;
  clientId: string;
  candidates: Candidate[];
  client?: { user?: { fullName?: string } };
  createdAt: string;
};

/** How much a proposal needs a human eye: warnings + caseload saturation. */
function attentionScore(p: Proposal): number {
  return p.candidates.reduce(
    (acc, c) => acc + c.fitWarnings.length * 2 + (c.caseloadUtilization > 0.85 ? 1 : 0),
    0,
  );
}

export default function ManagerPage() {
  const { t, fmtNumber, fmtPercent, fmtDate } = useI18n();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);
  const [riskLens, setRiskLens] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Demo convenience: authenticate as the seeded clinical director.
      const tok = await api.login('manager@vpsy.health', 'Vpsy!2026');
      setToken(tok.accessToken);
      setProposals(await api.listProposals());
    } catch (e) {
      setError(e instanceof ApiError ? t('manager.errStatus', { status: e.status }) : t('manager.errNetwork'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(p: Proposal, c: Candidate) {
    setApproving(p.id);
    setError(null);
    try {
      await api.approveAssignment(p.id, c.psychologistId, `Approved ${c.displayName} — top-ranked fit.`);
      setProposals((prev) => prev.filter((x) => x.id !== p.id));
    } catch {
      setError(t('manager.approveFailed'));
    } finally {
      setApproving(null);
    }
  }

  const shown = riskLens
    ? [...proposals].sort((a, b) => attentionScore(b) - attentionScore(a))
    : proposals;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t('manager.eyebrow')}</p>
          <h1 className="mt-3 font-display text-3xl font-semibold text-mist">{t('manager.title')}</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Risk lens — signal-amber because it is an attention tool */}
          <button
            onClick={() => setRiskLens((r) => !r)}
            aria-pressed={riskLens}
            title={t('manager.riskLensHint')}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-soft ${
              riskLens
                ? 'border-signal/50 bg-signal/15 text-signal-soft'
                : 'border-white/10 text-mist/70 hover:border-signal/40 hover:text-mist'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35M11 8v3.5M11 14.2v.1" strokeLinecap="round" />
            </svg>
            {t('manager.riskLens')}
          </button>
          <button onClick={load} className="btn-ghost px-4 py-2 text-sm">{t('common.refresh')}</button>
        </div>
      </div>
      <p className="mt-3 max-w-2xl text-mist/60">{t('manager.intro')}</p>
      {riskLens && <p className="mt-2 text-xs text-signal-soft/80">{t('manager.riskLensHint')}</p>}

      {error && (
        <div role="alert" className="mt-6 rounded-xl border border-signal/30 bg-signal/10 px-4 py-3 text-sm text-signal-soft">
          {error}
        </div>
      )}

      {loading ? (
        <p className="mt-10 font-mono text-sm text-mist/40" role="status">{t('manager.loading')}</p>
      ) : shown.length === 0 && !error ? (
        <div className="mt-10 card p-10 text-center text-mist/50">{t('manager.empty')}</div>
      ) : (
        <div className="mt-8 space-y-6">
          {shown.map((p) => {
            const needsAttention = attentionScore(p) > 0;
            return (
              <article key={p.id} className={`card p-6 ${riskLens && needsAttention ? 'border-signal/30' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
                  <div>
                    <p className="font-display text-lg font-medium text-mist">
                      {p.client?.user?.fullName ?? t('manager.client')}
                    </p>
                    <p className="font-mono text-[11px] uppercase tracking-wider text-mist/40">
                      {t('manager.assignment')} {p.id.slice(-6)}
                      {p.createdAt ? <> · {fmtDate(p.createdAt)}</> : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {riskLens && needsAttention && <span className="chip-signal">{t('manager.attention')}</span>}
                    <span className="chip text-teal-soft/80">{t('manager.candidates', { n: fmtNumber(p.candidates.length) })}</span>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {p.candidates.map((c, i) => {
                    const saturated = c.caseloadUtilization > 0.85;
                    return (
                      <div
                        key={c.psychologistId}
                        className={`flex flex-col gap-4 rounded-xl border p-4 md:flex-row md:items-center md:justify-between ${
                          riskLens && (c.fitWarnings.length > 0 || saturated)
                            ? 'border-signal/25 bg-signal/[0.04]'
                            : 'border-white/[0.06] bg-console-950/40'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <span className={`mt-0.5 font-mono text-sm ${i === 0 ? 'text-teal' : 'text-mist/40'}`}>
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-mist">{c.displayName}</p>
                              {i === 0 && (
                                <span className="chip border-teal/25 bg-teal/10 px-2 py-0.5 text-teal-soft">{t('manager.topFit')}</span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-mist/50">
                              {c.specialties.join(' · ')} — {c.languages.join('/')} — {c.jurisdiction}
                            </p>
                            <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-mist/45">{c.rationale}</p>
                            {c.fitWarnings.length > 0 && (
                              <p className="mt-1.5 text-xs text-signal-soft/90">⚠ {c.fitWarnings.join(' · ')}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-5 md:flex-col md:items-end md:gap-3">
                          <div className="flex items-center gap-5">
                            <MiniStat
                              label={t('manager.caseload')}
                              value={Number.isFinite(c.caseloadUtilization) ? fmtPercent(c.caseloadUtilization) : '—'}
                              warn={saturated}
                            />
                            <MiniStat
                              label={t('manager.outcome')}
                              value={Number.isFinite(c.outcomeIndex) ? fmtNumber(c.outcomeIndex) : '—'}
                            />
                            <MiniStat label={t('manager.fitScore')} value={Number.isFinite(c.score) ? fmtNumber(c.score) : '—'} accent />
                          </div>
                          <button
                            onClick={() => approve(p, c)}
                            disabled={approving === p.id}
                            className="btn-primary px-4 py-2 text-sm disabled:opacity-60"
                          >
                            {approving === p.id ? t('manager.approving') : t('manager.approve')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, accent = false, warn = false }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="text-end">
      <p className={`font-display text-base font-semibold ${warn ? 'text-signal-soft' : accent ? 'text-teal-soft' : 'text-mist/85'}`}>
        {value}
      </p>
      <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{label}</p>
    </div>
  );
}
