import { EventBus } from './event-bus.service';

/**
 * Transactional outbox (ADR-005) — the EventBus half. `publishDurable`
 * writes into whatever transaction client the caller passes; the caller's
 * own `$transaction` commit/rollback is what actually determines whether
 * the row persists (that's exercised end-to-end against a real Postgres
 * transaction as part of the outbox verification, not re-derived here from
 * a mock). What IS pinned here: `publishDurable` writes the row through the
 * given `tx`, and `publish()`'s return contract lets a caller (the outbox
 * relay) distinguish "every subscriber ran clean" from "at least one threw"
 * without changing behavior for existing fire-and-forget callers.
 */
describe('EventBus.publishDurable', () => {
  it('writes the event into the outbox via the CALLER-SUPPLIED transaction client, not the bus itself', async () => {
    const bus = new EventBus();
    const create = jest.fn().mockResolvedValue({ id: 'outbox_1' });
    const tx = { outboxEvent: { create } };

    await bus.publishDurable(tx, 'risk.flag.raised', 'tenant_demo', { riskFlagId: 'flag_1' });

    expect(create).toHaveBeenCalledWith({
      data: { tenantId: 'tenant_demo', eventName: 'risk.flag.raised', payload: { riskFlagId: 'flag_1' } },
    });
  });

  it('never touches in-process subscribers — that is the relay sweep\'s job, not publishDurable\'s', async () => {
    const bus = new EventBus();
    const handler = jest.fn();
    bus.subscribe('risk.flag.raised', handler);
    const tx = { outboxEvent: { create: jest.fn().mockResolvedValue({}) } };

    await bus.publishDurable(tx, 'risk.flag.raised', 'tenant_demo', { riskFlagId: 'flag_1' });

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('EventBus.publish', () => {
  it('resolves { ok: true, errors: [] } when every subscriber succeeds', async () => {
    const bus = new EventBus();
    bus.subscribe('escalation.resolved', jest.fn());
    bus.subscribe('escalation.resolved', jest.fn());

    const result = await bus.publish('escalation.resolved', 'tenant_demo', { escalationId: 'esc_1' });

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('does NOT throw when a subscriber throws — stays fire-and-forget for the ~22 direct callers — but reports the failure in its return value', async () => {
    const bus = new EventBus();
    bus.subscribe('escalation.resolved', jest.fn());
    bus.subscribe('escalation.resolved', jest.fn().mockRejectedValue(new Error('subscriber blew up')));

    const result = await expect(
      bus.publish('escalation.resolved', 'tenant_demo', { escalationId: 'esc_1' }),
    ).resolves.toEqual({ ok: false, errors: ['subscriber blew up'] });
    void result;
  });

  it('runs every subscriber even when an earlier one throws (one bad handler never blocks the rest)', async () => {
    const bus = new EventBus();
    const second = jest.fn();
    bus.subscribe('escalation.resolved', jest.fn().mockRejectedValue(new Error('first handler failed')));
    bus.subscribe('escalation.resolved', second);

    await bus.publish('escalation.resolved', 'tenant_demo', {});

    expect(second).toHaveBeenCalled();
  });
});
