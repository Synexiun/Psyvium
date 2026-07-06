/**
 * Local response types for the Scheduling endpoints (context 9).
 * Mirror the shared backend contract exactly; kept local to apps/web.
 * All timestamps are UTC ISO strings — the UI formats them per the viewer's locale.
 *
 * Endpoints:
 *   POST  /scheduling/availability                     → AvailabilitySlotDto
 *   GET   /scheduling/availability/psychologist/:id    → AvailabilitySlotDto[]
 *   POST  /scheduling/appointments/book                → AppointmentDto
 *   GET   /scheduling/appointments                     → AppointmentDto[]
 *   PATCH /scheduling/appointments/:id/status          → AppointmentDto
 *   POST  /scheduling/appointments/:id/remind          → { ok: true }
 */

export type SessionFormat = 'VIDEO' | 'AUDIO' | 'IN_PERSON';
export type AppointmentStatus = 'BOOKED' | 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';

export interface AvailabilitySlotDto {
  id: string;
  psychologistId: string;
  startsAt: string;
  endsAt: string;
  isBooked: boolean;
}

export interface AppointmentDto {
  id: string;
  clientId: string;
  clientName: string;
  psychologistId: string;
  psychologistName: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  format: SessionFormat;
  status: AppointmentStatus;
  isUrgent: boolean;
}

/* ── Request payloads ─────────────────────────────────────────────────── */
export interface CreateAvailabilityInput {
  startsAt: string;
  endsAt: string;
}
export interface BookAppointmentInput {
  psychologistId: string;
  clientId: string;
  startsAt: string;
  endsAt: string;
  format: SessionFormat;
  timezone?: string;
  slotId?: string;
  isUrgent?: boolean;
}
