'use client';

import { useEffect, useState } from 'react';
import { api, getPrincipal, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import type { AppointmentDto, AvailabilitySlotDto, AppointmentStatus } from '@/lib/scheduling-types';
import { ErrorPanel } from '@/components/ErrorPanel';
import { EmptyState } from '@/components/EmptyState';

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
  const [clientId, setClientId] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [live, setLive] = useState<'live' | 'offline' | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLive('loading');
    setError(null);
    const principal = getPrincipal();
    const clientRole = !!principal?.roles.includes('CLIENT');
    const staffRole =
      !!principal?.roles.includes('PSYCHOLOGIST') ||
      !!principal?.roles.includes('MANAGER') ||
      !!principal?.roles.includes('SUPERVISOR');
    setIsClient(clientRole);
    setIsStaff(staffRole);

    try {
      const appts = await api.schedAgenda();
      setAgenda(appts);
      const pid = appts[0]?.psychologistId ?? null;
      setPsychId(pid);
      if (clientRole) {
        try {
          const me = await api.clientMe();
          setClientId(me.client.id);
          // Prefer assigned clinician from next appointment or any agenda row.
          const assigned = appts.find((a) => a.status === 'BOOKED' || a.status === 'CONFIRMED')?.psychologistId
            ?? appts[0]?.psychologistId
            ?? pid;
          if (assigned) {
            setPsychId(assigned);
            try {
              setSlots(await api.schedAvailability(assigned));
            } catch {
              setSlots([]);
            }
          }
        } catch {
          /* client summary optional for staff */
        }
      } else if (pid) {
        try {
          setSlots(await api.schedAvailability(pid));
        } catch {
          /* none */
        }
      }
      setLive('live');
    } catch (e) {
      setError(e instanceof ApiError ? t('schedule.errStatus', { status: e.status }) : t('schedule.errNetwork'));
      setLive('offline');
    }
  }
  useEffect(() => {
    void load();
  }, []);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t('schedule.eyebrow')}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('schedule.title')}</h1>
        </div>
        <span
          role="status"
          className={`chip ${live === 'live' ? 'text-teal-soft/80' : live === 'offline' ? 'chip-signal' : 'text-mist/50'}`}
        >
          {live === 'live'
            ? t('common.liveData')
            : live === 'offline'
              ? t('common.connectionIssue')
              : t('common.loadingLive')}
        </span>
      </div>
      <p className="mt-3 max-w-3xl text-mist/60">{t('schedule.intro')}</p>
      {error && <ErrorPanel className="mt-5 max-w-md" message={error} onRetry={load} />}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <p className="eyebrow mb-3">{t('schedule.agendaEyebrow')}</p>
          <div className="space-y-3">
            {agenda.length === 0 && <EmptyState body={t('schedule.noAppointments')} />}
            {agenda.map((a) => (
              <AppointmentCard key={a.id} appt={a} isStaff={isStaff} isClient={isClient} onChanged={load} />
            ))}
          </div>
        </section>
        <aside>
          {isStaff && <AvailabilityPanel psychId={psychId} slots={slots} onChanged={load} />}
          {isClient && (
            <BookSlotPanel
              psychId={psychId}
              clientId={clientId}
              slots={slots.filter((s) => !s.isBooked)}
              onChanged={load}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function AppointmentCard({
  appt,
  isStaff,
  isClient,
  onChanged,
}: {
  appt: AppointmentDto;
  isStaff: boolean;
  isClient: boolean;
  onChanged: () => void;
}) {
  const { t, dict, fmtDate, fmtTime } = useI18n();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const terminal = appt.status === 'COMPLETED' || appt.status === 'CANCELLED' || appt.status === 'NO_SHOW';

  async function setStatus(s: AppointmentStatus) {
    setBusy(true);
    setMsg(null);
    try {
      await api.schedSetStatus(appt.id, s);
      onChanged();
    } catch {
      setMsg(t('schedule.actionFailed'));
    } finally {
      setBusy(false);
    }
  }
  async function remind() {
    setBusy(true);
    setMsg(null);
    try {
      await api.schedRemind(appt.id);
      setMsg(t('schedule.reminded'));
    } catch {
      setMsg(t('schedule.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-mist">
            {isClient ? appt.psychologistName || '—' : appt.clientName || '—'}
          </p>
          <p dir="ltr" className="figure mt-0.5 text-sm text-mist/60">
            {fmtDate(appt.startsAt)} · {fmtTime(appt.startsAt)}–{fmtTime(appt.endsAt)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="chip text-teal-soft/70">{dict.schedule.format[appt.format]}</span>
          {appt.isUrgent && <span className="chip chip-signal">{t('schedule.urgent')}</span>}
        </div>
      </div>
      <p className={`mt-2 font-mono text-[11px] uppercase tracking-wider ${statusClass[appt.status]}`}>
        {dict.schedule.status[appt.status]}
      </p>

      {!terminal && isStaff && (
        <div className="mt-3 flex flex-wrap gap-2">
          {appt.status === 'BOOKED' && (
            <button
              onClick={() => setStatus('CONFIRMED')}
              disabled={busy}
              className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-60"
            >
              {t('schedule.confirm')}
            </button>
          )}
          <button
            onClick={() => setStatus('COMPLETED')}
            disabled={busy}
            className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {t('schedule.complete')}
          </button>
          <button
            onClick={() => setStatus('NO_SHOW')}
            disabled={busy}
            className="btn-ghost border-signal/40 px-3 py-1.5 text-xs text-signal-soft disabled:opacity-60"
          >
            {t('schedule.markNoShow')}
          </button>
          <button
            onClick={() => setStatus('CANCELLED')}
            disabled={busy}
            className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {t('schedule.cancel')}
          </button>
          <button
            onClick={remind}
            disabled={busy}
            className="btn-primary px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {busy ? t('schedule.reminding') : t('schedule.remind')}
          </button>
        </div>
      )}
      {!terminal && isClient && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setStatus('CANCELLED')}
            disabled={busy}
            className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {t('schedule.cancel')}
          </button>
        </div>
      )}
      {msg && (
        <p role="status" className="mt-2 text-xs text-mist/55">
          {msg}
        </p>
      )}
    </article>
  );
}

function AvailabilityPanel({
  psychId,
  slots,
  onChanged,
}: {
  psychId: string | null;
  slots: AvailabilitySlotDto[];
  onChanged: () => void;
}) {
  const { t, fmtDate, fmtTime } = useI18n();
  const init = defaultSlot(1);
  const [start, setStart] = useState(init.start);
  const [end, setEnd] = useState(init.end);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function add() {
    if (!start || !end || new Date(end) <= new Date(start)) {
      setMsg({ text: t('schedule.invalidRange'), ok: false });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api.schedAddAvailability({ startsAt: localToIso(start), endsAt: localToIso(end) });
      setMsg({ text: t('schedule.slotAdded'), ok: true });
      onChanged();
    } catch {
      setMsg({ text: t('schedule.addSlotFailed'), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <p className="eyebrow">{t('schedule.availabilityEyebrow')}</p>
      <p className="mt-2 text-xs text-mist/50">{t('schedule.availIntro')}</p>
      <label className="field-label mt-4">{t('schedule.startLabel')}</label>
      <input
        type="datetime-local"
        dir="ltr"
        className="field text-sm"
        value={start}
        onChange={(e) => setStart(e.target.value)}
      />
      <label className="field-label mt-3">{t('schedule.endLabel')}</label>
      <input
        type="datetime-local"
        dir="ltr"
        className="field text-sm"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
      />
      <button onClick={add} disabled={busy || !psychId} className="btn-primary mt-4 w-full disabled:opacity-60">
        {busy ? t('schedule.adding') : t('schedule.addSlot')}
      </button>
      {msg && (
        <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>
          {msg.text}
        </p>
      )}

      <ul className="mt-4 space-y-2 border-t border-line/15 pt-4">
        {slots.length === 0 && <li className="text-xs text-mist/30">{t('schedule.noSlots')}</li>}
        {slots.map((s) => (
          <li key={s.id} className="card-inset flex items-center justify-between gap-2 px-3 py-2">
            <span dir="ltr" className="figure text-sm text-mist/80">
              {fmtDate(s.startsAt)} · {fmtTime(s.startsAt)}–{fmtTime(s.endsAt)}
            </span>
            <span
              className={`font-mono text-[10px] uppercase tracking-wider ${s.isBooked ? 'text-mist/40' : 'text-teal-soft/70'}`}
            >
              {s.isBooked ? t('schedule.slotBooked') : t('schedule.slotOpen')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Client books an open slot from their assigned psychologist. */
function BookSlotPanel({
  psychId,
  clientId,
  slots,
  onChanged,
}: {
  psychId: string | null;
  clientId: string | null;
  slots: AvailabilitySlotDto[];
  onChanged: () => void;
}) {
  const { t, fmtDate, fmtTime } = useI18n();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function book(slot: AvailabilitySlotDto) {
    if (!psychId || !clientId) {
      setMsg({ text: t('schedule.bookMissingContext'), ok: false });
      return;
    }
    setBusyId(slot.id);
    setMsg(null);
    try {
      await api.schedBook({
        psychologistId: psychId,
        clientId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        format: 'VIDEO',
        slotId: slot.id,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      });
      setMsg({ text: t('schedule.booked'), ok: true });
      onChanged();
    } catch {
      setMsg({ text: t('schedule.bookFailed'), ok: false });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card p-5">
      <p className="eyebrow">{t('schedule.bookEyebrow')}</p>
      <p className="mt-2 text-xs text-mist/50">{t('schedule.bookIntro')}</p>
      {msg && (
        <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>
          {msg.text}
        </p>
      )}
      <ul className="mt-4 space-y-2">
        {slots.length === 0 && <li className="text-xs text-mist/30">{t('schedule.noOpenSlots')}</li>}
        {slots.map((s) => (
          <li key={s.id} className="card-inset flex items-center justify-between gap-2 px-3 py-2">
            <span dir="ltr" className="figure text-sm text-mist/80">
              {fmtDate(s.startsAt)} · {fmtTime(s.startsAt)}–{fmtTime(s.endsAt)}
            </span>
            <button
              type="button"
              className="btn-primary px-3 py-1.5 text-xs disabled:opacity-60"
              disabled={!!busyId || !clientId || !psychId}
              onClick={() => void book(s)}
            >
              {busyId === s.id ? t('schedule.booking') : t('schedule.bookSlot')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
