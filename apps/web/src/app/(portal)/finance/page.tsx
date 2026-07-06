'use client';

import { useEffect, useState } from 'react';
import { api, setToken, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import type { InvoiceDto, LedgerEntryDto, PayoutDto, FinanceSummaryDto, InvoiceLineDto } from '@/lib/finance-types';

/** Format a Decimal-string money value for display only (never for math). */
function money(amount: string, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

export default function FinancePage() {
  const { t } = useI18n();
  const [summary, setSummary] = useState<FinanceSummaryDto | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [ledger, setLedger] = useState<LedgerEntryDto[]>([]);
  const [payouts, setPayouts] = useState<PayoutDto[]>([]);
  const [live, setLive] = useState<'live' | 'offline' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLive('loading');
    setError(null);
    try {
      try {
        const tok = await api.login('manager@vpsy.health', 'Vpsy!2026');
        setToken(tok.accessToken);
      } catch { /* may already be signed in */ }
      const [s, inv, led, po] = await Promise.all([api.financeSummary(), api.financeInvoices(), api.financeLedger(), api.financePayouts()]);
      setSummary(s); setInvoices(inv); setLedger(led); setPayouts(po);
      setLive('live');
    } catch (e) {
      setError(e instanceof ApiError ? t('finance.errStatus', { status: e.status }) : t('finance.errNetwork'));
      setLive('offline');
    }
  }
  useEffect(() => { load(); }, []);

  if (!summary) return <p className="mt-10 font-mono text-sm text-mist/40">{t('finance.loading')}</p>;
  const cur = summary.currency;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t('finance.eyebrow')}</p>
          <h1 className="mt-3 font-display text-3xl font-semibold text-mist">{t('finance.title')}</h1>
        </div>
        <span role="status" className={`chip ${live === 'live' ? 'text-teal-soft/80' : live === 'offline' ? 'chip-signal' : 'text-mist/50'}`}>
          {live === 'live' ? t('common.liveData') : live === 'offline' ? t('common.offlineDemo') : t('common.loadingLive')}
        </span>
      </div>
      <p className="mt-3 max-w-3xl text-mist/60">{t('finance.intro')}</p>
      {error && <div role="alert" className="mt-5 rounded-xl border border-signal/30 bg-signal/10 px-4 py-3 text-sm text-signal-soft">{error}</div>}

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label={t('finance.openInvoices')} value={String(summary.openInvoiceCount)} />
        <Tile label={t('finance.paidTotal')} value={money(summary.paidTotal, cur)} accent />
        <Tile label={t('finance.outstanding')} value={money(summary.outstandingTotal, cur)} />
        <Tile label={t('finance.payoutsPending')} value={money(summary.payoutsPendingTotal, cur)} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <InvoicesPanel invoices={invoices} onChanged={load} money={money} />
          <LedgerPanel ledger={ledger} money={money} />
        </div>
        <aside className="space-y-6">
          <NewInvoiceForm onChanged={load} />
          <PayoutsPanel payouts={payouts} onChanged={load} money={money} />
        </aside>
      </div>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card-inset p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">{label}</p>
      <p className={`mt-1 font-display text-xl font-semibold ${accent ? 'text-teal-soft' : 'text-mist'}`}>{value}</p>
    </div>
  );
}

function InvoicesPanel({ invoices, onChanged, money }: { invoices: InvoiceDto[]; onChanged: () => void; money: (a: string, c: string) => string }) {
  const { t, dict, fmtDate } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  async function pay(inv: InvoiceDto) {
    setBusy(inv.id);
    try { await api.financePayInvoice(inv.id); onChanged(); } catch { /* noop */ } finally { setBusy(null); }
  }
  return (
    <section>
      <p className="eyebrow mb-3">{t('finance.invoicesEyebrow')}</p>
      <div className="space-y-3">
        {invoices.length === 0 && <p className="card-inset px-4 py-6 text-center text-sm text-mist/40">{t('finance.noInvoices')}</p>}
        {invoices.map((inv) => (
          <article key={inv.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-mist">{inv.clientName || '—'}</p>
                <p className="mt-0.5 text-[11px] text-mist/40">{fmtDate(inv.createdAt)}</p>
              </div>
              <div className="text-end">
                <p className="font-display text-lg font-semibold text-mist">{money(inv.amount, inv.currency)}</p>
                <p className="font-mono text-[10px] uppercase tracking-wider text-teal-soft/70">{dict.finance.invStatus[inv.status]}</p>
              </div>
            </div>
            <ul className="mt-2 space-y-0.5">
              {inv.lineItems.map((l: InvoiceLineDto, i) => (
                <li key={i} className="flex justify-between text-xs text-mist/55"><span>{l.description}</span><span className="font-mono">{money(l.amount, inv.currency)}</span></li>
              ))}
            </ul>
            {inv.status === 'OPEN' && (
              <button onClick={() => pay(inv)} disabled={busy === inv.id} className="btn-primary mt-3 px-4 py-2 text-sm disabled:opacity-60">
                {busy === inv.id ? t('finance.paying') : t('finance.pay')}
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function NewInvoiceForm({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const [clientId, setClientId] = useState('');
  const [lines, setLines] = useState<InvoiceLineDto[]>([{ description: '', amount: '' }]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const setLine = (i: number, k: keyof InvoiceLineDto, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function submit() {
    const valid = lines.filter((l) => l.description.trim() && l.amount.trim() && !Number.isNaN(Number(l.amount)));
    if (!clientId.trim() || valid.length === 0) { setMsg({ text: t('finance.needClientAndLine'), ok: false }); return; }
    setBusy(true); setMsg(null);
    try {
      await api.financeCreateInvoice({ clientId: clientId.trim(), lineItems: valid.map((l) => ({ description: l.description.trim(), amount: l.amount.trim() })) });
      setLines([{ description: '', amount: '' }]);
      setMsg({ text: t('finance.invoiceCreated'), ok: true });
      onChanged();
    } catch { setMsg({ text: t('finance.invoiceFailed'), ok: false }); } finally { setBusy(false); }
  }

  return (
    <div className="card p-5">
      <p className="eyebrow">{t('finance.newInvoiceEyebrow')}</p>
      <label className="field-label mt-4">{t('finance.clientIdLabel')}</label>
      <input className="field text-sm" dir="ltr" placeholder={t('finance.clientIdPlaceholder')} value={clientId} onChange={(e) => setClientId(e.target.value)} />
      <div className="mt-3 space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <input className="field text-sm" placeholder={t('finance.lineDescPlaceholder')} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} />
            <input className="field w-28 text-sm" dir="ltr" inputMode="decimal" placeholder="0.00" value={l.amount} onChange={(e) => setLine(i, 'amount', e.target.value)} />
          </div>
        ))}
      </div>
      <button onClick={() => setLines((ls) => [...ls, { description: '', amount: '' }])} className="mt-2 font-mono text-[11px] uppercase tracking-wider text-teal-soft/70 hover:text-teal-soft">+ {t('finance.addLine')}</button>
      <button onClick={submit} disabled={busy} className="btn-primary mt-4 w-full disabled:opacity-60">{busy ? t('finance.creating') : t('finance.createInvoice')}</button>
      {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>{msg.text}</p>}
    </div>
  );
}

function LedgerPanel({ ledger, money }: { ledger: LedgerEntryDto[]; money: (a: string, c: string) => string }) {
  const { t } = useI18n();
  return (
    <section>
      <p className="eyebrow mb-3">{t('finance.ledgerEyebrow')}</p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-start font-mono text-[10px] uppercase tracking-wider text-mist/40">
              <th className="p-3 text-start">{/* account */}</th>
              <th className="p-3 text-end">{t('finance.debit')}</th>
              <th className="p-3 text-end">{t('finance.credit')}</th>
            </tr>
          </thead>
          <tbody>
            {ledger.length === 0 && <tr><td colSpan={3} className="p-6 text-center text-xs text-mist/30">{t('finance.noLedger')}</td></tr>}
            {ledger.map((e) => (
              <tr key={e.id} className="border-b border-white/[0.04]">
                <td className="p-3">
                  <span className="font-mono text-[11px] text-mist/40">{e.accountCode}</span> <span className="text-mist/80">{e.accountName}</span>
                  {e.memo && <span className="block text-[11px] text-mist/35">{e.memo}</span>}
                </td>
                <td className="p-3 text-end font-mono text-mist/85">{Number(e.debit) ? money(e.debit, 'USD') : '—'}</td>
                <td className="p-3 text-end font-mono text-mist/85">{Number(e.credit) ? money(e.credit, 'USD') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PayoutsPanel({ payouts, onChanged, money }: { payouts: PayoutDto[]; onChanged: () => void; money: (a: string, c: string) => string }) {
  const { t, dict, fmtDate } = useI18n();
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 30 * 24 * 3600 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [psychId, setPsychId] = useState('');
  const [start, setStart] = useState(iso(monthAgo));
  const [end, setEnd] = useState(iso(today));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function compute() {
    if (!psychId.trim()) { setMsg({ text: t('finance.payoutFailed'), ok: false }); return; }
    setBusy(true); setMsg(null);
    try {
      await api.financeComputePayout({ psychologistId: psychId.trim(), periodStart: new Date(start).toISOString(), periodEnd: new Date(end).toISOString() });
      setMsg({ text: t('finance.payoutComputed'), ok: true });
      onChanged();
    } catch { setMsg({ text: t('finance.payoutFailed'), ok: false }); } finally { setBusy(false); }
  }

  return (
    <div className="card p-5">
      <p className="eyebrow">{t('finance.payoutsEyebrow')}</p>
      <ul className="mt-3 space-y-2">
        {payouts.length === 0 && <li className="text-xs text-mist/30">{t('finance.noPayouts')}</li>}
        {payouts.map((p) => (
          <li key={p.id} className="card-inset flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm text-mist/85">{p.psychologistName || '—'}</p>
              <p className="text-[10px] text-mist/40">{t('finance.period')}: {fmtDate(p.periodStart)}–{fmtDate(p.periodEnd)}</p>
            </div>
            <div className="text-end">
              <p className="font-mono text-sm text-mist">{money(p.computedAmount, p.currency)}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-teal-soft/60">{dict.finance.payoutStatus[p.status]}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-white/[0.06] pt-4">
        <label className="field-label">{t('finance.psychIdLabel')}</label>
        <input className="field text-sm" dir="ltr" value={psychId} onChange={(e) => setPsychId(e.target.value)} />
        <div className="mt-2 flex gap-2">
          <div className="flex-1">
            <label className="field-label">{t('finance.periodStart')}</label>
            <input type="date" dir="ltr" className="field text-sm" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="field-label">{t('finance.periodEnd')}</label>
            <input type="date" dir="ltr" className="field text-sm" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <button onClick={compute} disabled={busy} className="btn-ghost mt-4 w-full disabled:opacity-60">{busy ? t('finance.computing') : t('finance.computePayout')}</button>
        {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
