import { ForbiddenException } from '@nestjs/common';
import type { AuthPrincipal } from '@vpsy/contracts';
import { Role } from '@vpsy/contracts';
import { SchedulingService } from './scheduling.service';

/**
 * Phase 2 DoD (docs/technical/13-roadmap-and-phases.md, ctx 9 Scheduling):
 * booking is gated on an APPROVED/ACTIVE Assignment; a recorded NO_SHOW
 * publishes a domain event other contexts can react to; the availability
 * picker never surfaces booked or past slots.
 */

const clientPrincipal: AuthPrincipal = {
  userId: 'user_client',
  tenantId: 'tenant_demo',
  roles: [Role.CLIENT],
  permissions: [],
};

const managerPrincipal: AuthPrincipal = {
  userId: 'user_manager',
  tenantId: 'tenant_demo',
  roles: [Role.MANAGER],
  permissions: [],
};

const psychologistPrincipal: AuthPrincipal = {
  userId: 'user_psy_a',
  tenantId: 'tenant_demo',
  roles: [Role.PSYCHOLOGIST],
  permissions: [],
};

const clientRow = { id: 'client_1', tenantId: 'tenant_demo', userId: 'user_client' };
const psychologistRow = { id: 'psy_1', tenantId: 'tenant_demo', userId: 'user_psy_a' };

const appointmentRow = {
  id: 'appt_1',
  tenantId: 'tenant_demo',
  clientId: 'client_1',
  psychologistId: 'psy_1',
  status: 'BOOKED',
  startsAt: new Date('2026-08-01T15:00:00Z'),
  endsAt: new Date('2026-08-01T15:50:00Z'),
  timezone: 'UTC',
  format: 'VIDEO',
  isUrgent: false,
  client: { user: { fullName: 'Alex Chen' } },
  psychologist: { user: { fullName: 'Dr. Elena Rivera' } },
};

const bookInput = {
  psychologistId: 'psy_1',
  clientId: 'client_1',
  startsAt: '2026-08-01T15:00:00.000Z',
  endsAt: '2026-08-01T15:50:00.000Z',
  format: 'VIDEO' as const,
  timezone: 'UTC',
  isUrgent: false,
};

function makeService(overrides: Partial<Record<string, unknown>> = {}) {
  const prismaTx = {
    appointment: { create: jest.fn().mockResolvedValue(appointmentRow) },
    availabilitySlot: { update: jest.fn() },
  };
  const prisma = {
    client: { findFirst: jest.fn().mockResolvedValue(clientRow) },
    psychologist: { findFirst: jest.fn().mockResolvedValue(psychologistRow) },
    assignment: { findFirst: jest.fn().mockResolvedValue({ id: 'assignment_1', status: 'APPROVED' }) },
    availabilitySlot: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    appointment: {
      findFirst: jest.fn().mockResolvedValue(appointmentRow),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(appointmentRow),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prismaTx)),
    ...overrides,
  };
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const svc = new SchedulingService(prisma as any, audit as any, bus as any);
  return { svc, prisma, audit, bus, prismaTx };
}

describe('SchedulingService.bookAppointment', () => {
  it('rejects booking when no APPROVED/ACTIVE assignment links client and psychologist', async () => {
    const { svc, prisma, audit } = makeService({
      assignment: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(svc.bookAppointment(managerPrincipal, bookInput)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.assignment.findFirst).toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('books the appointment and emits AppointmentBooked when an approved assignment exists', async () => {
    const { svc, audit, bus } = makeService();

    const result = await svc.bookAppointment(managerPrincipal, bookInput);

    expect(result.id).toBe('appt_1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'appointment.booked' }));
    expect(bus.publish).toHaveBeenCalledWith(
      'appointment.booked',
      'tenant_demo',
      expect.objectContaining({ appointmentId: 'appt_1', clientId: 'client_1', psychologistId: 'psy_1' }),
    );
  });

  it('marks the slot booked when a slotId is supplied', async () => {
    const { svc, prisma, prismaTx } = makeService({
      availabilitySlot: {
        findFirst: jest.fn().mockResolvedValue({ id: 'slot_1', isBooked: false }),
        findMany: jest.fn(),
        create: jest.fn(),
      },
    });

    await svc.bookAppointment(managerPrincipal, { ...bookInput, slotId: 'slot_1' });

    expect(prisma.availabilitySlot.findFirst).toHaveBeenCalled();
    expect(prismaTx.availabilitySlot.update).toHaveBeenCalledWith({
      where: { id: 'slot_1' },
      data: { isBooked: true },
    });
  });

  it('rejects a CLIENT principal booking on behalf of a different client', async () => {
    const { svc } = makeService({
      client: { findFirst: jest.fn().mockResolvedValue({ ...clientRow, userId: 'someone_else' }) },
    });

    await expect(svc.bookAppointment(clientPrincipal, bookInput)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SchedulingService.updateAppointmentStatus', () => {
  it('emits NoShowRecorded when the status transitions to NO_SHOW', async () => {
    const { svc, prisma, bus } = makeService({
      appointment: {
        findFirst: jest.fn().mockResolvedValue(appointmentRow),
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({ ...appointmentRow, status: 'NO_SHOW' }),
      },
    });

    const result = await svc.updateAppointmentStatus(psychologistPrincipal, 'appt_1', { status: 'NO_SHOW' as const });

    expect(result.status).toBe('NO_SHOW');
    expect(prisma.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'NO_SHOW' } }),
    );
    expect(bus.publish).toHaveBeenCalledWith(
      'appointment.no_show_recorded',
      'tenant_demo',
      expect.objectContaining({ appointmentId: 'appt_1' }),
    );
  });

  it('does not emit NoShowRecorded for a non-NO_SHOW status change, but does emit the real-time AppointmentStatusChanged event', async () => {
    const { svc, bus } = makeService({
      appointment: {
        findFirst: jest.fn().mockResolvedValue(appointmentRow),
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({ ...appointmentRow, status: 'CONFIRMED' }),
      },
    });

    await svc.updateAppointmentStatus(psychologistPrincipal, 'appt_1', { status: 'CONFIRMED' as const });

    expect(bus.publish).not.toHaveBeenCalledWith(
      'appointment.no_show_recorded',
      expect.anything(),
      expect.anything(),
    );
    expect(bus.publish).toHaveBeenCalledWith(
      'appointment.status_changed',
      'tenant_demo',
      expect.objectContaining({ appointmentId: 'appt_1', status: 'CONFIRMED' }),
    );
  });

  it('emits AppointmentStatusChanged alongside NoShowRecorded on a NO_SHOW transition', async () => {
    const { svc, bus } = makeService({
      appointment: {
        findFirst: jest.fn().mockResolvedValue(appointmentRow),
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({ ...appointmentRow, status: 'NO_SHOW' }),
      },
    });

    await svc.updateAppointmentStatus(psychologistPrincipal, 'appt_1', { status: 'NO_SHOW' as const });

    expect(bus.publish).toHaveBeenCalledWith(
      'appointment.status_changed',
      'tenant_demo',
      expect.objectContaining({ appointmentId: 'appt_1', status: 'NO_SHOW' }),
    );
  });
});

describe('SchedulingService.listOpenAvailability', () => {
  it('queries only unbooked, future slots for the given psychologist', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'slot_open',
        psychologistId: 'psy_1',
        startsAt: new Date('2026-08-01T15:00:00Z'),
        endsAt: new Date('2026-08-01T15:50:00Z'),
        isBooked: false,
      },
    ]);
    const { svc } = makeService({
      availabilitySlot: { findFirst: jest.fn(), findMany, create: jest.fn() },
    });

    const result = await svc.listOpenAvailability(managerPrincipal, 'psy_1');

    expect(result).toHaveLength(1);
    expect(result[0].isBooked).toBe(false);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          psychologistId: 'psy_1',
          isBooked: false,
          startsAt: expect.objectContaining({ gte: expect.any(Date) }),
        }),
      }),
    );
  });
});
