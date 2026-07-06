import { Logger } from '@nestjs/common';
import { OutboxRelayService } from './outbox-relay.service';

/**
 * Transactional outbox relay (ADR-005). `EventBus.publishDurable(tx, ...)`
 * writing a row atomically with the domain-state change is only half the
 * guarantee — this pins the OTHER half: the sweep that finds PENDING rows
 * and republishes them, including the crash-semantics the whole feature
 * exists for (docs/00-architecture-overview.md ADR-005): "a crash between
 * commit and publish must never silently drop an event."
 */

const tenant = { id: 'tenant_demo' };

const baseRow = {
  id: 'outbox_1',
  tenantId: 'tenant_demo',
  eventName: 'risk.flag.raised',
  payload: { riskFlagId: 'flag_1' },
  attempts: 0,
  availableAt: new Date('2026-07-06T00:00:00Z'),
};

function makeService(overrides: { rows?: (typeof baseRow)[]; claimCount?: number; publishResult?: { ok: boolean; errors: string[] } } = {}) {
  const rows = overrides.rows ?? [baseRow];
  const prisma = {
    tenant: { findMany: jest.fn().mockResolvedValue([tenant]) },
    outboxEvent: {
      findMany: jest.fn().mockResolvedValue(rows),
      updateMany: jest.fn().mockResolvedValue({ count: overrides.claimCount ?? 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const bus = { publish: jest.fn().mockResolvedValue(overrides.publishResult ?? { ok: true, errors: [] }) };
  const svc = new OutboxRelayService(prisma as any, bus as any);
  return { svc, prisma, bus };
}

describe('OutboxRelayService.sweep', () => {
  it('publishes a due PENDING row through the existing in-process EventBus and marks it PUBLISHED', async () => {
    const { svc, prisma, bus } = makeService();

    await svc.sweep();

    expect(bus.publish).toHaveBeenCalledWith('risk.flag.raised', 'tenant_demo', { riskFlagId: 'flag_1' });
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'outbox_1' },
      data: expect.objectContaining({ status: 'PUBLISHED', lastError: null }),
    });
  });

  it('claims via CAS on availableAt before publishing — a row already claimed by another instance (count 0) is never published twice', async () => {
    const { svc, prisma, bus } = makeService({ claimCount: 0 });

    await svc.sweep();

    expect(prisma.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'outbox_1', status: 'PENDING', availableAt: baseRow.availableAt },
      data: expect.any(Object),
    });
    expect(bus.publish).not.toHaveBeenCalled();
    expect(prisma.outboxEvent.update).not.toHaveBeenCalled();
  });

  it('CRASH-SEMANTICS: when a subscriber throws after the claim, the outbox row is neither PUBLISHED nor lost — it is rescheduled with backoff so the relay retries', async () => {
    const { svc, prisma } = makeService({
      rows: [{ ...baseRow, attempts: 0 }],
      publishResult: { ok: false, errors: ['subscriber threw: boom'] },
    });

    await svc.sweep();

    expect(prisma.outboxEvent.update).toHaveBeenCalledTimes(1);
    const call = (prisma.outboxEvent.update as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ id: 'outbox_1' });
    // Never marked PUBLISHED or FAILED on a retryable failure — attempts +1
    // and a future availableAt is exactly "the row survives, relay retries".
    expect(call.data.status).toBeUndefined();
    expect(call.data.attempts).toBe(1);
    expect(call.data.lastError).toContain('boom');
    expect(call.data.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('gives up loudly at the 10th attempt: marks FAILED (terminal) and logs a loud ERROR — never silent', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { svc, prisma } = makeService({
      rows: [{ ...baseRow, attempts: 9 }],
      publishResult: { ok: false, errors: ['still broken'] },
    });

    await svc.sweep();

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'outbox_1' },
      data: expect.objectContaining({ status: 'FAILED', attempts: 10, lastError: 'still broken' }),
    });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('gave up after 10 attempts'));
    errorSpy.mockRestore();
  });

  it('one tenant\'s sweep failure never blocks the others or crashes the scheduler', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const rowsForTenantB = [{ ...baseRow, id: 'outbox_2', tenantId: 'tenant_b' }];
    const prisma = {
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: 'tenant_a' }, { id: 'tenant_b' }]) },
      outboxEvent: {
        findMany: jest
          .fn()
          .mockImplementationOnce(() => Promise.reject(new Error('RLS GUC not set')))
          .mockImplementationOnce(() => Promise.resolve(rowsForTenantB)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const bus = { publish: jest.fn().mockResolvedValue({ ok: true, errors: [] }) };
    const svc = new OutboxRelayService(prisma as any, bus as any);

    await svc.sweep();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('tenant_a'));
    expect(bus.publish).toHaveBeenCalledWith('risk.flag.raised', 'tenant_b', { riskFlagId: 'flag_1' });
    errorSpy.mockRestore();
  });
});
