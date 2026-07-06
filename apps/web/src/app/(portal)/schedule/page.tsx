'use client';

import { useEffect, useState } from 'react';
import { api, setToken, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import type { AppointmentDto, AvailabilitySlotDto, AppointmentStatus } from '@/lib/scheduling-types';

const statusClass: Record<AppointmentStatus, string> = {
  BOOKED: 'text-teal-soft/80',
  CONFIRMED: 'text-teal',
  COMPLETED: 'text-mist/50',
  NO_SHOW: 'text-signal',
  CANCELLED: 'text-mist/40 line-through',
};

/** Local <input type="datetime-local"> value → UTC ISO. */
function localToIso(v: string): string {
  return v ? new Date(v).toISOString() : '';
}
function defaultSlot(offsetDays: number): { start: string; end: string } {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(10, 0, 0, 0);
  const end = new Date(d.getTime() + 50 * 60 * 1000);
  const fmt = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}T${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
  return { start: fmt(d), end: fmt(end) };
}

export default function SchedulePage() {
  const { t } = useI18n();
  const [agenda, setAgenda] = useState<AppointmentDto[]>([]);
  const [slots, setSlots] = useState<AvailabilitySlotDto[]>([]);
  const [psychId, setPsychId] = useState<string | null>(null);
  const [live, setLive] = useState<'live' | 'offline' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLive('loading');
    setError(null);
    try {
      try {
        const tok = await api.login('dr.rivera@vpsy.health', 'Vpsy!2026');
        setToken(tok.accessToken);
      } catch { /* may already be signed in */ }
      const appts = await api.schedAgenda();
      setAgenda(appts);
      const pid = appts[0]?.psychologistId ?? null;
      setPsychId(pid);
      if (pid) {
        try { setSlots(await api.schedAvailability(pid)); } catch { /* none */ }
      }
      setLive('live');
    } catch (e) {
      setError(e instanceof ApiError ? t('schedule.errStatus', { status: e.status }) : t('schedule.errNetwork'));
      setLive('offline');
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t('schedule.eyebrow')}</p>
          <h1 className="mt-3 font-display text-3xl font-semibold text-mist">{t('schedule.title')}</h1>
        </div>
        <span role="status" className={`chip ${live === 'live' ? 'text-teal-soft/80' : live === 'offline' ? 'chip-signal' : 'text-mist/50'}`}>
          {live === 'live' ? t('common.liveData') : live === 'offline' ? t('common.offlineDemo') : t('common.loadingLive')}
        </span>
      </div>
      <p className="mt-3 max-w-3xl text-mist/60">{t('schedule.intro')}</p>
      {error && <div role="alert" className="mt-5 rounded-xl border border-signal/30 bg-signal/10 px-4 py-3 text-sm text-signal-soft">{error}</div>}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <p className="eyebrow mb-3">{t('schedule.agendaEyebrow')}</p>
          <div className="space-y-3">
            {agenda.length === 0 && <p className="card-inset px-4 py-6 text-center text-sm text-mist/40">{t('schedule.noAppointments')}</p>}
            {agenda.map((a) => <AppointmentCard key={a.id} appt={a} onChanged={load} />)}
          </div>
        </section>
        <aside>
          <AvailabilityPanel psychId={psychId} slots={slots} onChanged={load} />
        </aside>
      </div>
    </div>
  );
}

function AppointmentCard({ appt, onChanged }: { appt: AppointmentDto; onChanged: () => void }) {
  const { t, dict, fmtDate, fmtTime } = useI18n();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const terminal = appt.status === 'COMPLETED' || appt.status === 'CANCELLED' || appt.status === 'NO_SHOW';

  async function setStatus(s: AppointmentStatus) {
    setBusy(true); setMsg(null);
    try { await api.schedSetStatus(appt.id, s); onChanged(); }
    catch { setMsg(t('schedule.actionFailed')); } finally { setBusy(false); }
  }
  async function remind() {
    setBusy(true); setMsg(null);
    try { await api.schedRemind(appt.id); setMsg(t('schedule.reminded')); }
    catch { setMsg(t('schedule.actionFailed')); } finally { setBusy(false); }
  }

  return (
    <article className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-mist">{appt.clientName || '—'}</p>
          <p className="mt-0.5 text-sm text-mist/60">{fmtDate(appt.startsAt)} · {fmtTime(appt.startsAt)}–{fmtTime(appt.endsAt)}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="chip text-teal-soft/70">{dict.schedule.format[appt.format]}</span>
          {appt.isUrgent && <span className="chip chip-signal">{t('schedule.urgent')}</span>}
        </div>
      </div>
      <p className={`mt-2 font-mono text-[11px] uppercase tracking-wider ${statusClass[appt.status]}`}>{dict.schedule.status[appt.status]}</p>

      {!terminal && (
        <div className="mt-3 flex flex-wrap gap-2">
          {appt.status === 'BOOKED' && <button onClick={() => setStatus('CONFIRMED')} disabled={busy} className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-60">{t('schedule.confirm')}</button>}
          <button onClick={() => setStatus('COMPLETED')} disabled={busy} className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-60">{t('schedule.complete')}</button>
          <button onClick={() => setStatus('NO_SHOW')} disabled={busy} className="btn-ghost border-signal/40 px-3 py-1.5 text-xs text-signal-soft disabled:opacity-60">{t('schedule.markNoShow')}</button>
          <button onClick={() => setStatus('CANCELLED')} disabled={busy} className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-60">{t('schedule.cancel')}</button>
          <button onClick={remind} disabled={busy} className="btn-primary px-3 py-1.5 text-xs disabled:opacity-60">{busy ? t('schedule.reminding') : t('schedule.remind')}</button>
        </div>
      )}
      {msg && <p role="status" className="mt-2 text-xs text-mist/55">{msg}</p>}
    </article>
  );
}

function AvailabilityPanel({ psychId, slots, onChanged }: { psychId: string | null; slots: AvailabilitySlotDto[]; onChanged: () => void }) {
  const { t, fmtDate, fmtTime } = useI18n();
  const init = defaultSlot(1);
  const [start, setStart] = useState(init.start);
  const [end, setEnd] = useState(init.end);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function add() {
    if (!start || !end || new Date(end) <= new Date(start)) { setMsg({ text: t('schedule.invalidRange'), ok: false }); return; }
    setBusy(true); setMsg(null);
    try {
      await api.schedAddAvailability({ startsAt: localToIso(start), endsAt: localToIso(end) });
      setMsg({ text: t('schedule.slotAdded'), ok: true });
      onChanged();
    } catch { setMsg({ text: t('schedule.addSlotFailed'), ok: false }); } finally { setBusy(false); }
  }

  return (
    <div className="card p-5">
      <p className="eyebrow">{t('schedule.availabilityEyebrow')}</p>
      <p className="mt-2 text-xs text-mist/50">{t('schedule.availIntro')}</p>
      <label className="field-label mt-4">{t('schedule.startLabel')}</label>
      <input type="datetime-local" dir="ltr" className="field text-sm" value={start} onChange={(e) => setStart(e.target.value)} />
      <label className="field-label mt-3">{t('schedule.endLabel')}</label>
      <input type="datetime-local" dir="ltr" className="field text-sm" value={end} onChange={(e) => setEnd(e.target.value)} />
      <button onClick={add} disabled={busy || !psychId} className="btn-primary mt-4 w-full disabled:opacity-60">
        {busy ? t('schedule.adding') : t('schedule.addSlot')}
      </button>
      {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>{msg.text}</p>}

      <ul className="mt-4 space-y-2 border-t border-white/[0.06] pt-4">
        {slots.length === 0 && <li className="text-xs text-mist/30">{t('schedule.noSlots')}</li>}
        {slots.map((s) => (
          <li key={s.id} className="card-inset flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-sm text-mist/80">{fmtDate(s.startsAt)} · {fmtTime(s.startsAt)}–{fmtTime(s.endsAt)}</span>
            <span className={`font-mono text-[10px] uppercase tracking-wider ${s.isBooked ? 'text-mist/40' : 'text-teal-soft/70'}`}>
              {s.isBooked ? t('schedule.slotBooked') : t('schedule.slotOpen')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
