import { z } from 'zod';
import { AppointmentStatus, SessionModality } from '../enums';

/**
 * Scheduling DTOs (`docs/technical/13-roadmap-and-phases.md`, context 9,
 * Phase 2 — "Availability, booking, reminders, timezone + residency aware").
 * This is the SHARED CONTRACT the web cockpit is built against in parallel —
 * shapes here must not drift without updating both sides.
 *
 * All timestamps are UTC ISO-8601 strings. `timezone` on an appointment is a
 * presentation concern only — the server always stores/compares in UTC.
 */

// ── Read models ──

export const availabilitySlotSchema = z.object({
  id: z.string(),
  psychologistId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  isBooked: z.boolean(),
});
export type AvailabilitySlotDto = z.infer<typeof availabilitySlotSchema>;

export const appointmentSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  psychologistId: z.string(),
  psychologistName: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  timezone: z.string(),
  format: z.nativeEnum(SessionModality),
  status: z.nativeEnum(AppointmentStatus),
  isUrgent: z.boolean(),
});
export type AppointmentDto = z.infer<typeof appointmentSchema>;

// ── Write models ──

export const createAvailabilitySlotSchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});
export type CreateAvailabilitySlotInput = z.infer<typeof createAvailabilitySlotSchema>;

/**
 * `clientId` is explicit (not derived) so a MANAGER can book on a client's
 * behalf; the service still enforces that a CLIENT principal may only pass
 * their own clientId (ABAC-in-service, see SchedulingService.bookAppointment).
 */
export const bookAppointmentSchema = z.object({
  psychologistId: z.string().min(1),
  clientId: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  format: z.nativeEnum(SessionModality),
  timezone: z.string().default('UTC'),
  slotId: z.string().optional(),
  isUrgent: z.boolean().default(false),
});
export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;

export const updateAppointmentStatusSchema = z.object({
  status: z.nativeEnum(AppointmentStatus),
});
export type UpdateAppointmentStatusInput = z.infer<typeof updateAppointmentStatusSchema>;

/**
 * Result of `POST /scheduling/appointments/:id/remind` (`15-communications-
 * and-telephony.md` / `09-*` reminder seam). `sent` is only ever true once an
 * SMS provider has actually accepted the message (offline stub or Twilio) —
 * never fabricated. `reason` is set whenever `sent` is false, e.g.
 * `'no-phone-on-record'` when the client has no phone on file.
 */
export const sendReminderResultSchema = z.object({
  sent: z.boolean(),
  smsId: z.string().optional(),
  reason: z.string().optional(),
});
export type SendReminderResult = z.infer<typeof sendReminderResultSchema>;
