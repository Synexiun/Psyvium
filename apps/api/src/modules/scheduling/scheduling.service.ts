import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AssignmentStatus,
  Role,
  type AppointmentDto,
  type AuthPrincipal,
  type AvailabilitySlotDto,
  type BookAppointmentInput,
  type CreateAvailabilitySlotInput,
  type UpdateAppointmentStatusInput,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';

type AvailabilitySlotRow = {
  id: string;
  psychologistId: string;
  startsAt: Date;
  endsAt: Date;
  isBooked: boolean;
};

type AppointmentRow = {
  id: string;
  clientId: string;
  psychologistId: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  format: string;
  status: string;
  isUrgent: boolean;
  client: { user: { fullName: string } };
  psychologist: { user: { fullName: string } };
};

const APPOINTMENT_INCLUDE = {
  client: { include: { user: true } },
  psychologist: { include: { user: true } },
} as const;

/**
 * Scheduling (`docs/technical/13-roadmap-and-phases.md`, context 9, Phase 2 —
 * "Availability, booking, reminders, timezone + residency aware"). All
 * timestamps are stored/compared in UTC; `timezone` on an Appointment is a
 * presentation concern only. Booking always requires an APPROVED/ACTIVE
 * Assignment linking the client and psychologist (Matching & Assignment,
 * context 11, is the upstream authority on that pairing).
 */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  /** A psychologist opens a slot on their own calendar. */
  async addAvailability(
    principal: AuthPrincipal,
    input: CreateAvailabilitySlotInput,
  ): Promise<AvailabilitySlotDto> {
    const psychologist = await this.prisma.psychologist.findFirst({
      where: { userId: principal.userId, tenantId: principal.tenantId },
    });
    if (!psychologist) {
      throw new ForbiddenException('Only a psychologist may manage their own availability');
    }

    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    if (!(endsAt > startsAt)) {
      throw new ForbiddenException('endsAt must be after startsAt');
    }

    const slot = await this.prisma.availabilitySlot.create({
      data: {
        tenantId: principal.tenantId,
        psychologistId: psychologist.id,
        startsAt,
        endsAt,
        isBooked: false,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'availability.created',
      entityType: 'AvailabilitySlot',
      entityId: slot.id,
      after: { psychologistId: psychologist.id, startsAt: slot.startsAt, endsAt: slot.endsAt },
    });

    return this.toSlotDto(slot);
  }

  /** Open (unbooked, future) slots for a given psychologist — used to build a booking picker. */
  async listOpenAvailability(principal: AuthPrincipal, psychologistId: string): Promise<AvailabilitySlotDto[]> {
    const slots = await this.prisma.availabilitySlot.findMany({
      where: {
        tenantId: principal.tenantId,
        psychologistId,
        isBooked: false,
        startsAt: { gte: new Date() },
      },
      orderBy: { startsAt: 'asc' },
    });
    return slots.map((s) => this.toSlotDto(s));
  }

  /**
   * Books an appointment. Requires an APPROVED/ACTIVE Assignment linking the
   * client and psychologist (403 otherwise). A CLIENT principal may only
   * book for themselves; MANAGER may book on behalf of any client in tenant.
   */
  async bookAppointment(principal: AuthPrincipal, input: BookAppointmentInput): Promise<AppointmentDto> {
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    if (principal.roles.includes(Role.CLIENT) && client.userId !== principal.userId) {
      throw new ForbiddenException('A client may only book appointments for themselves');
    }

    const psychologist = await this.prisma.psychologist.findFirst({
      where: { id: input.psychologistId, tenantId: principal.tenantId },
    });
    if (!psychologist) throw new NotFoundException('Psychologist not found');

    const assignment = await this.prisma.assignment.findFirst({
      where: {
        clientId: input.clientId,
        psychologistId: input.psychologistId,
        tenantId: principal.tenantId,
        status: { in: [AssignmentStatus.APPROVED, AssignmentStatus.ACTIVE] },
      },
    });
    if (!assignment) {
      throw new ForbiddenException('No approved assignment links this client and psychologist');
    }

    let slot: AvailabilitySlotRow | null = null;
    if (input.slotId) {
      slot = await this.prisma.availabilitySlot.findFirst({
        where: { id: input.slotId, tenantId: principal.tenantId, psychologistId: input.psychologistId },
      });
      if (!slot) throw new NotFoundException('Availability slot not found');
      if (slot.isBooked) throw new ForbiddenException('Availability slot is already booked');
    }

    const appointment = await this.prisma.$transaction(async (tx) => {
      const appt = await tx.appointment.create({
        data: {
          tenantId: principal.tenantId,
          assignmentId: assignment.id,
          clientId: input.clientId,
          psychologistId: input.psychologistId,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          timezone: input.timezone ?? 'UTC',
          format: input.format,
          isUrgent: input.isUrgent ?? false,
        },
        include: APPOINTMENT_INCLUDE,
      });
      if (slot) {
        await tx.availabilitySlot.update({ where: { id: slot.id }, data: { isBooked: true } });
      }
      return appt;
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'appointment.booked',
      entityType: 'Appointment',
      entityId: appointment.id,
      after: {
        clientId: input.clientId,
        psychologistId: input.psychologistId,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
      },
    });
    await this.bus.publish(Events.AppointmentBooked, principal.tenantId, {
      appointmentId: appointment.id,
      clientId: input.clientId,
      psychologistId: input.psychologistId,
      startsAt: appointment.startsAt.toISOString(),
    });

    return this.toAppointmentDto(appointment as unknown as AppointmentRow);
  }

  /** The authenticated user's agenda — CLIENT/PSYCHOLOGIST see their own; MANAGER sees the tenant's. */
  async getMyAppointments(principal: AuthPrincipal): Promise<AppointmentDto[]> {
    const where: Record<string, unknown> = { tenantId: principal.tenantId };

    if (principal.roles.includes(Role.MANAGER)) {
      // tenant-wide agenda — no further scoping
    } else if (principal.roles.includes(Role.PSYCHOLOGIST)) {
      const psychologist = await this.prisma.psychologist.findFirst({
        where: { userId: principal.userId, tenantId: principal.tenantId },
      });
      if (!psychologist) return [];
      where.psychologistId = psychologist.id;
    } else {
      const client = await this.prisma.client.findFirst({
        where: { userId: principal.userId, tenantId: principal.tenantId },
      });
      if (!client) return [];
      where.clientId = client.id;
    }

    const now = new Date();
    const [future, past] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { ...where, startsAt: { gte: now } },
        include: APPOINTMENT_INCLUDE,
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.appointment.findMany({
        where: { ...where, startsAt: { lt: now } },
        include: APPOINTMENT_INCLUDE,
        orderBy: { startsAt: 'desc' },
      }),
    ]);

    return [...future, ...past].map((a) => this.toAppointmentDto(a as unknown as AppointmentRow));
  }

  /** Manager/psychologist marks status; NO_SHOW emits a domain event for downstream contexts. */
  async updateAppointmentStatus(
    principal: AuthPrincipal,
    appointmentId: string,
    input: UpdateAppointmentStatusInput,
  ): Promise<AppointmentDto> {
    const existing = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId: principal.tenantId },
    });
    if (!existing) throw new NotFoundException('Appointment not found');

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: input.status },
      include: APPOINTMENT_INCLUDE,
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'appointment.status_updated',
      entityType: 'Appointment',
      entityId: updated.id,
      before: { status: existing.status },
      after: { status: updated.status },
    });

    if (input.status === 'NO_SHOW') {
      await this.bus.publish(Events.NoShowRecorded, principal.tenantId, {
        appointmentId: updated.id,
        clientId: updated.clientId,
        psychologistId: updated.psychologistId,
      });
    }

    // Real-time layer (SP3): every status transition is pushed (booked is
    // covered separately by AppointmentBooked); the bridge derives
    // "changed" vs "cancelled" from `status` so live dashboards refresh
    // without polling.
    await this.bus.publish(Events.AppointmentStatusChanged, principal.tenantId, {
      appointmentId: updated.id,
      clientId: updated.clientId,
      psychologistId: updated.psychologistId,
      status: updated.status,
    });

    return this.toAppointmentDto(updated as unknown as AppointmentRow);
  }

  /**
   * Fires the decoupled reminder seam: a Communications-Hub subscriber turns
   * this into an SMS. This service never imports the communications module.
   */
  async sendReminder(principal: AuthPrincipal, appointmentId: string): Promise<{ ok: true }> {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId: principal.tenantId },
    });
    if (!appointment) throw new NotFoundException('Appointment not found');

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'appointment.reminder_sent',
      entityType: 'Appointment',
      entityId: appointment.id,
    });
    await this.bus.publish(Events.AppointmentReminderDue, principal.tenantId, {
      appointmentId: appointment.id,
      clientId: appointment.clientId,
      psychologistId: appointment.psychologistId,
      startsAt: appointment.startsAt.toISOString(),
    });

    return { ok: true };
  }

  private toSlotDto(slot: AvailabilitySlotRow): AvailabilitySlotDto {
    return {
      id: slot.id,
      psychologistId: slot.psychologistId,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      isBooked: slot.isBooked,
    };
  }

  private toAppointmentDto(appt: AppointmentRow): AppointmentDto {
    return {
      id: appt.id,
      clientId: appt.clientId,
      clientName: appt.client.user.fullName,
      psychologistId: appt.psychologistId,
      psychologistName: appt.psychologist.user.fullName,
      startsAt: appt.startsAt.toISOString(),
      endsAt: appt.endsAt.toISOString(),
      timezone: appt.timezone,
      format: appt.format as AppointmentDto['format'],
      status: appt.status as AppointmentDto['status'],
      isUrgent: appt.isUrgent,
    };
  }
}
