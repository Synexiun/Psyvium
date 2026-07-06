'use client';

/**
 * Telehealth (context 12) — entry surface. A video session always starts
 * from a BOOKED appointment: the clinician "starts" it, the client "joins"
 * it — both resolve through the same idempotent POST /telehealth/sessions
 * (an existing live session for the appointment is returned, never
 * duplicated), then the room page (/telehealth/[id]) runs the waiting-room
 * flow. The TELEPSYCHOLOGY consent gate 409s server-side before any room is
 * minted — surfaced here as an honest, plain-language message.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getPrincipal, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useResource } from '@/lib/use-resource';
import type { AppointmentDto } from '@/lib/scheduling-types';
import { SkeletonStack } from '@/components/Skeleton';
import { ErrorPanel } from '@/components/ErrorPanel';
import { EmptyState } from '@/components/EmptyState';

/** Appointment statuses a video session can start from. */
const JOINABLE: AppointmentDto['status'][] = ['BOOKED', 'CONFIRMED'];

export default function TelehealthPage() {
  const { t, dict, fmtDate, fmtTime } = useI18n();
  const router = useRouter();

  const [roles, setRoles] = useState<string[]>([]);
  useEffect(() => {
    setRoles(getPrincipal()?.roles ?? []);
  }, []);
  const isPsychologist = roles.includes('PSYCHOLOGIST');

  const agenda = useResource<AppointmentDto[]>(() => api.schedAgenda(), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ id: string; text: string } | null>(null);

  async function openSession(appointmentId: string) {
    setBusyId(appointmentId);
    setRowErr(null);
    try {
      const session = await api.teleCreateSession(appointmentId);
      router.push(`/telehealth/${session.id}`);
    } catch (e) {
      const isConsent =
        e instanceof ApiError &&
        e.status === 409 &&
        typeof e.body === 'object' &&
        e.body !== null &&
        String((e.body as { type?: string }).type ?? '').includes('consent-required');
      setRowErr({ id: appointmentId, text: isConsent ? t('tele.consentRequired') : t('tele.createFailed') });
      setBusyId(null);
    }
  }

  const joinable = (agenda.data ?? []).filter((a) => JOINABLE.includes(a.status));
  const errorMessage =
    agenda.error instanceof ApiError
      ? t('tele.errStatus', { status: agenda.error.status })
      : t('tele.errNetwork');

  return (
    <div>
      <p className="eyebrow">{t('tele.eyebrow')}</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('tele.title')}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-mist/60">{t('tele.intro')}</p>

      <section className="mt-6">
        <p className="eyebrow mb-3">{t('tele.agendaEyebrow')}</p>
        {agenda.loading && <SkeletonStack count={3} className="space-y-3" />}
        {!agenda.loading && !!agenda.error && (
          <ErrorPanel className="max-w-md" message={errorMessage} onRetry={agenda.reload} />
        )}
        {!agenda.loading && !agenda.error && joinable.length === 0 && (
          <EmptyState body={t('tele.noAppointments')} />
        )}
        {!agenda.loading && !agenda.error && joinable.length > 0 && (
          <ul className="space-y-3">
            {joinable.map((a) => (
              <li key={a.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-mist">
                    {isPsychologist ? a.clientName : a.psychologistName}
                  </p>
                  <p className="mt-1 text-xs text-mist/60">
                    {fmtDate(a.startsAt, { weekday: 'short', day: 'numeric', month: 'short' })}
                    {' · '}
                    <span className="figure" dir="ltr">{fmtTime(a.startsAt)}</span>
                    {' – '}
                    <span className="figure" dir="ltr">{fmtTime(a.endsAt)}</span>
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <span className="chip">{dict.schedule.format[a.format] ?? a.format}</span>
                    <span className="chip">{dict.schedule.status[a.status] ?? a.status}</span>
                  </div>
                </div>
                <div className="shrink-0">
                  <button
                    type="button"
                    onClick={() => openSession(a.id)}
                    disabled={busyId !== null}
                    className="btn-primary px-4 py-2 text-sm disabled:opacity-60"
                  >
                    {busyId === a.id
                      ? t('tele.opening')
                      : isPsychologist
                        ? t('tele.startSession')
                        : t('tele.joinSession')}
                  </button>
                  {rowErr?.id === a.id && (
                    <p role="alert" className="mt-2 max-w-[240px] text-xs text-risk">
                      {rowErr.text}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
