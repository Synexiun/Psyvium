'use client';

import { useEffect, useState } from 'react';
import { api, setToken, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import type {
  CrmBoardDto,
  LeadDto,
  ReferrerDto,
  LeadSource,
  ReferrerType,
} from '@/lib/crm-types';

const SOURCES: LeadSource[] = ['WEB', 'REFERRAL', 'CAMPAIGN', 'INSTITUTION'];
const REF_TYPES: ReferrerType[] = ['DOCTOR', 'SCHOOL', 'EMPLOYER', 'COURT', 'INSTITUTION', 'SELF'];

export default function CrmPage() {
  const { t, dict, fmtDate, fmtPercent } = useI18n();
  const [board, setBoard] = useState<CrmBoardDto | null>(null);
  const [live, setLive] = useState<'live' | 'loading' | 'offline'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const referrerName = (id?: string) =>
    board?.referrers.find((r) => r.id === id)?.organizationName;

  async function load() {
    setLive('loading');
    setError(null);
    try {
      // Demo convenience: sign in as the manager if there's no session yet.
      try {
        const tok = await api.login('manager@vpsy.health', 'Vpsy!2026');
        setToken(tok.accessToken);
      } catch {
        /* may already be signed in or offline */
      }
      const data = await api.crmBoard();
      setBoard(data);
      setLive('live');
    } catch (e) {
      // No fallback-to-fake: keep whatever real board was already loaded (if
      // any) and surface the failure honestly instead of overwriting it.
      setError(e instanceof ApiError ? t('crm.errStatus', { status: e.status }) : t('crm.errNetwork'));
      setLive('offline');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function moveLead(lead: LeadDto, toStageId: string) {
    if (toStageId === lead.pipelineStageId) return;
    setBusy(lead.id);
    setError(null);
    try {
      await api.crmMoveLeadStage(lead.id, toStageId);
      await load();
    } catch {
      setError(t('crm.moveFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function convertLead(lead: LeadDto) {
    setBusy(lead.id);
    setError(null);
    try {
      await api.crmConvertLead(lead.id);
      await load();
    } catch {
      setError(t('crm.convertFailed'));
    } finally {
      setBusy(null);
    }
  }

  if (!board && live === 'loading') {
    return <p className="mt-10 font-mono text-sm text-mist/40">{t('crm.loading')}</p>;
  }

  if (!board) {
    return (
      <div className="mt-10 max-w-md">
        <div role="alert" className="rounded-xl border border-signal/30 bg-signal/10 px-4 py-3 text-sm text-signal-soft">
          {error}
        </div>
        <button onClick={load} className="btn-primary mt-4 px-5 py-2.5 text-sm">
          {t('common.refresh')}
        </button>
      </div>
    );
  }

  const stages = [...board.stages].sort((a, b) => a.order - b.order);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t('crm.eyebrow')}</p>
          <h1 className="mt-3 font-display text-3xl font-semibold text-mist">{t('crm.title')}</h1>
        </div>
        <span
          role="status"
          className={`chip ${live === 'live' ? 'text-teal-soft/80' : live === 'offline' ? 'chip-signal' : 'text-mist/50'}`}
        >
          {live === 'live' ? t('common.liveData') : live === 'offline' ? t('common.offlineDemo') : t('common.loadingLive')}
        </span>
      </div>
      <p className="mt-3 max-w-3xl text-mist/60">{t('crm.intro')}</p>

      {error && (
        <div role="alert" className="mt-5 rounded-xl border border-signal/30 bg-signal/10 px-4 py-3 text-sm text-signal-soft">
          {error}
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Pipeline board ── */}
        <section>
          <p className="eyebrow mb-3">{t('crm.boardEyebrow')}</p>
          <div className="flex gap-4 overflow-x-auto pb-3">
            {stages.map((stage) => {
              const leads = board.leadsByStage[stage.id] ?? [];
              return (
                <div key={stage.id} className="w-72 shrink-0">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className={`font-mono text-[11px] uppercase tracking-wider ${stage.isWon ? 'text-teal-soft' : stage.isLost ? 'text-mist/40' : 'text-mist/60'}`}>
                      {stage.name}
                    </span>
                    <span className="font-mono text-[11px] text-mist/40">{t('crm.leadsCount', { n: leads.length })}</span>
                  </div>
                  <div className="space-y-3">
                    {leads.length === 0 && (
                      <p className="card-inset px-3 py-6 text-center text-xs text-mist/30">{t('crm.emptyStage')}</p>
                    )}
                    {leads.map((lead) => (
                      <article key={lead.id} className="card p-4">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-medium text-mist">{lead.contact.name || '—'}</p>
                          <span className="chip text-teal-soft/70">{dict.crm.source[lead.source]}</span>
                        </div>
                        <p className="mt-1.5 text-xs text-mist/55">{lead.presentingInterest || '—'}</p>
                        {lead.referrerId && (
                          <p className="mt-1.5 text-[11px] text-mist/40">
                            {t('crm.referrer')}: {referrerName(lead.referrerId) || '—'}
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-mist/35">{t('crm.capturedOn', { date: fmtDate(lead.createdAt) })}</p>

                        <div className="mt-3 flex items-center gap-2">
                          <select
                            aria-label={t('crm.stageFor', { name: lead.contact.name || '—' })}
                            className="field py-2 text-xs"
                            value={lead.pipelineStageId}
                            disabled={busy === lead.id}
                            onChange={(e) => moveLead(lead, e.target.value)}
                          >
                            {stages.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                          {!stage.isWon && !stage.isLost && (
                            <button
                              onClick={() => convertLead(lead)}
                              disabled={busy === lead.id}
                              className="btn-primary shrink-0 px-3 py-2 text-xs disabled:opacity-60"
                            >
                              {busy === lead.id ? t('crm.converting') : t('crm.convert')}
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Side: new lead + referrer registry ── */}
        <aside className="space-y-6">
          <NewLeadForm referrers={board.referrers} onDone={load} />
          <ReferrerRegistry referrers={board.referrers} onDone={load} fmtPercent={fmtPercent} />
        </aside>
      </div>
    </div>
  );
}

function NewLeadForm({ referrers, onDone }: { referrers: ReferrerDto[]; onDone: () => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: '', email: '', phone: '', source: 'WEB' as LeadSource, presentingInterest: '', referrerId: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setMsg(t('crm.leadNameRequired')); return; }
    setBusy(true);
    setMsg(null);
    try {
      await api.crmCreateLead({
        source: form.source,
        contact: { name: form.name.trim(), email: form.email || undefined, phone: form.phone || undefined },
        presentingInterest: form.presentingInterest || undefined,
        referrerId: form.referrerId || undefined,
      });
      setForm({ name: '', email: '', phone: '', source: 'WEB', presentingInterest: '', referrerId: '' });
      setMsg(t('crm.leadAdded'));
      onDone();
    } catch {
      setMsg(t('crm.addLeadFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card p-5">
      <p className="eyebrow">{t('crm.newLeadEyebrow')}</p>
      <h2 className="mt-2 font-display text-lg font-medium text-mist">{t('crm.newLeadTitle')}</h2>
      <p className="mt-1 text-xs text-mist/45">{t('crm.newLeadHint')}</p>
      <label className="field-label mt-4">{t('crm.leadName')}</label>
      <input className="field" value={form.name} onChange={(e) => set('name', e.target.value)} />
      <label className="field-label mt-3">{t('crm.leadSource')}</label>
      <select className="field" value={form.source} onChange={(e) => set('source', e.target.value as LeadSource)}>
        {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <label className="field-label mt-3">{t('crm.leadEmail')}</label>
      <input type="email" className="field" value={form.email} onChange={(e) => set('email', e.target.value)} />
      <label className="field-label mt-3">{t('crm.leadInterest')}</label>
      <input className="field" placeholder={t('crm.leadInterestPlaceholder')} value={form.presentingInterest} onChange={(e) => set('presentingInterest', e.target.value)} />
      <label className="field-label mt-3">{t('crm.leadReferrer')}</label>
      <select className="field" value={form.referrerId} onChange={(e) => set('referrerId', e.target.value)}>
        <option value="">{t('crm.noReferrer')}</option>
        {referrers.map((r) => <option key={r.id} value={r.id}>{r.organizationName}</option>)}
      </select>
      <button type="submit" disabled={busy} className="btn-primary mt-4 w-full disabled:opacity-60">
        {busy ? t('crm.addingLead') : t('crm.addLead')}
      </button>
      {msg && <p role="status" className="mt-3 text-sm text-mist/60">{msg}</p>}
    </form>
  );
}

function ReferrerRegistry({ referrers, onDone, fmtPercent }: { referrers: ReferrerDto[]; onDone: () => void; fmtPercent: (n: number) => string }) {
  const { t, dict } = useI18n();
  const [form, setForm] = useState({ type: 'DOCTOR' as ReferrerType, organizationName: '', name: '', email: '', referralSharePct: 0 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.organizationName.trim()) { setMsg(t('crm.refOrgRequired')); return; }
    setBusy(true);
    setMsg(null);
    try {
      await api.crmCreateReferrer({
        type: form.type,
        organizationName: form.organizationName.trim(),
        contact: { name: form.name || undefined, email: form.email || undefined },
        referralSharePct: Number(form.referralSharePct) || 0,
      });
      setForm({ type: 'DOCTOR', organizationName: '', name: '', email: '', referralSharePct: 0 });
      setMsg(t('crm.referrerAdded'));
      onDone();
    } catch {
      setMsg(t('crm.addRefFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <p className="eyebrow">{t('crm.refEyebrow')}</p>
      <h2 className="mt-2 font-display text-lg font-medium text-mist">{t('crm.refTitle')}</h2>
      <p className="mt-1 text-xs text-mist/45">{t('crm.refHint')}</p>

      <ul className="mt-4 space-y-2">
        {referrers.length === 0 && <li className="text-xs text-mist/30">{t('crm.refEmpty')}</li>}
        {referrers.map((r) => (
          <li key={r.id} className="card-inset flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm text-mist/85">{r.organizationName}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-teal-soft/60">{dict.crm.refTypes[r.type]}</p>
            </div>
            <div className="shrink-0 text-end">
              <p className="text-sm text-mist">{fmtPercent(r.referralSharePct / 100)}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{r.active ? t('crm.refActive') : t('crm.refInactive')}</p>
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} className="mt-4 border-t border-white/[0.06] pt-4">
        <p className="eyebrow">{t('crm.addRefEyebrow')}</p>
        <label className="field-label mt-3">{t('crm.refType')}</label>
        <select className="field" value={form.type} onChange={(e) => set('type', e.target.value as ReferrerType)}>
          {REF_TYPES.map((rt) => <option key={rt} value={rt}>{dict.crm.refTypes[rt]}</option>)}
        </select>
        <label className="field-label mt-3">{t('crm.refOrg')}</label>
        <input className="field" value={form.organizationName} onChange={(e) => set('organizationName', e.target.value)} />
        <label className="field-label mt-3">{t('crm.refSharePct')}</label>
        <input type="number" min={0} max={100} step={0.5} className="field" value={form.referralSharePct} onChange={(e) => set('referralSharePct', Number(e.target.value))} />
        <button type="submit" disabled={busy} className="btn-ghost mt-4 w-full disabled:opacity-60">
          {busy ? t('crm.addingReferrer') : t('crm.addReferrer')}
        </button>
        {msg && <p role="status" className="mt-3 text-sm text-mist/60">{msg}</p>}
      </form>
    </div>
  );
}
