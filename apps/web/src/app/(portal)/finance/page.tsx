'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import type { InvoiceDto, LedgerEntryDto, PayoutDto, FinanceSummaryDto, InvoiceLineDto } from '@/lib/finance-types';
import { SkeletonStack } from '@/components/Skeleton';
import { ErrorPanel } from '@/components/ErrorPanel';
import { EmptyState } from '@/components/EmptyState';
import { StatTile } from '@/components/StatTile';
import { DataTable, type DataColumn } from '@/components/DataTable';
import { ContextPanel } from '@/components/ContextPanel';

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
      const [s, inv, led, po] = await Promise.all([api.financeSummary(), api.financeInvoices(), api.financeLedger(), api.financePayouts()]);
      setSummary(s); setInvoices(inv); setLedger(led); setPayouts(po);
      setLive('live');
    } catch (e) {
      setError(e instanceof ApiError ? t('finance.errStatus', { status: e.status }) : t('finance.errNetwork'));
      setLive('offline');
    }
  }
  useEffect(() => { load(); }, []);

  if (!summary) {
    return error
      ? <ErrorPanel className="mt-6 max-w-md" message={error} onRetry={load} />
      : <SkeletonStack count={3} className="mt-6 space-y-3" />;
  }
  const cur = summary.currency;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t('finance.eyebrow')}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('finance.title')}</h1>
        </div>
        <span role="status" className={`chip ${live === 'offline' ? 'chip-signal' : ''}`}>
          {live === 'live' ? t('common.liveData') : live === 'offline' ? t('common.connectionIssue') : t('common.loadingLive')}
        </span>
      </div>
      <p className="mt-3 max-w-3xl text-mist/60">{t('finance.intro')}</p>
      {error && <ErrorPanel className="mt-5 max-w-md" message={error} onRetry={load} />}

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('finance.openInvoices')} value={String(summary.openInvoiceCount)} />
        <StatTile label={t('finance.paidTotal')} value={money(summary.paidTotal, cur)} />
        <StatTile label={t('finance.outstanding')} value={money(summary.outstandingTotal, cur)} />
        <StatTile label={t('finance.payoutsPending')} value={money(summary.payoutsPendingTotal, cur)} />
      </div>

      <div className="mt-6 space-y-6">
        <InvoicesPanel invoices={invoices} onChanged={load} money={money} />
        <LedgerPanel ledger={ledger} money={money} />
      </div>

      {/* ── Context panel: AR snapshot + invoice & payout actions ── */}
      <ContextPanel>
        <section className="card p-4">
          <p className="eyebrow">{t('finance.arEyebrow')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <StatTile label={t('finance.outstanding')} value={money(summary.outstandingTotal, cur)} />
            <StatTile label={t('finance.paidTotal')} value={money(summary.paidTotal, cur)} />
          </div>
        </section>
        <NewInvoiceForm onChanged={load} />
        <PayoutsPanel payouts={payouts} onChanged={load} money={money} />
      </ContextPanel>
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
        {invoices.length === 0 && <EmptyState body={t('finance.noInvoices')} />}
        {invoices.map((inv) => (
          <article key={inv.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-mist">{inv.clientName || '—'}</p>
                <p className="figure mt-0.5 text-[11px] text-mist/40" dir="ltr">{fmtDate(inv.createdAt)}</p>
              </div>
              <div className="text-end">
                <p className="figure text-lg font-medium text-mist" dir="ltr">{money(inv.amount, inv.currency)}</p>
                <p className="font-mono text-[10px] uppercase tracking-wider text-haze/90">{dict.finance.invStatus[inv.status]}</p>
              </div>
            </div>
            <ul className="mt-2 space-y-0.5">
              {inv.lineItems.map((l: InvoiceLineDto, i) => (
                <li key={i} className="flex justify-between text-xs text-mist/55"><span>{l.description}</span><span className="figure" dir="ltr">{money(l.amount, inv.currency)}</span></li>
              ))}
            </ul>
            {inv.status === 'OPEN' && (
              <button onClick={() => pay(inv)} disabled={busy === inv.id} className="btn-primary mt-3 disabled:opacity-60">
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
    <div className="card p-4">
      <p className="eyebrow">{t('finance.newInvoiceEyebrow')}</p>
      <label className="field-label mt-4">{t('finance.clientIdLabel')}</label>
      <input className="field text-sm" dir="ltr" placeholder={t('finance.clientIdPlaceholder')} value={clientId} onChange={(e) => setClientId(e.target.value)} />
      <div className="mt-3 space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <input className="field text-sm" placeholder={t('finance.lineDescPlaceholder')} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} />
            <input className="field w-24 text-sm" dir="ltr" inputMode="decimal" placeholder="0.00" value={l.amount} onChange={(e) => setLine(i, 'amount', e.target.value)} />
          </div>
        ))}
      </div>
      <button onClick={() => setLines((ls) => [...ls, { description: '', amount: '' }])} className="mt-2 font-mono text-[11px] uppercase tracking-wider text-haze hover:text-mist">+ {t('finance.addLine')}</button>
      <button onClick={submit} disabled={busy} className="btn-primary mt-4 w-full disabled:opacity-60">{busy ? t('finance.creating') : t('finance.createInvoice')}</button>
      {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>{msg.text}</p>}
    </div>
  );
}

function LedgerPanel({ ledger, money }: { ledger: LedgerEntryDto[]; money: (a: string, c: string) => string }) {
  const { t } = useI18n();
  const columns: DataColumn<LedgerEntryDto>[] = [
    {
      id: 'account',
      header: t('finance.account'),
      cell: (e) => (
        <div>
          <span className="font-mono text-[11px] text-mist/40">{e.accountCode}</span> <span className="text-mist/80">{e.accountName}</span>
          {e.memo && <span className="block text-[11px] text-mist/35">{e.memo}</span>}
        </div>
      ),
    },
    { id: 'debit', header: t('finance.debit'), numeric: true, cell: (e) => (Number(e.debit) ? money(e.debit, 'USD') : '—') },
    { id: 'credit', header: t('finance.credit'), numeric: true, cell: (e) => (Number(e.credit) ? money(e.credit, 'USD') : '—') },
  ];
  return (
    <section>
      <p className="eyebrow mb-3">{t('finance.ledgerEyebrow')}</p>
      <DataTable columns={columns} rows={ledger} rowKey={(e) => e.id} empty={t('finance.noLedger')} />
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
    <div className="card p-4">
      <p className="eyebrow">{t('finance.payoutsEyebrow')}</p>
      <ul className="mt-3 space-y-2">
        {payouts.length === 0 && <li className="text-xs text-mist/40">{t('finance.noPayouts')}</li>}
        {payouts.map((p) => (
          <li key={p.id} className="card-inset flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm text-mist/85">{p.psychologistName || '—'}</p>
              <p className="figure text-[10px] text-mist/40" dir="ltr">{t('finance.period')}: {fmtDate(p.periodStart)}–{fmtDate(p.periodEnd)}</p>
            </div>
            <div className="text-end">
              <p className="figure text-sm text-mist" dir="ltr">{money(p.computedAmount, p.currency)}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-haze/80">{dict.finance.payoutStatus[p.status]}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="hairline-t mt-4 pt-4">
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
