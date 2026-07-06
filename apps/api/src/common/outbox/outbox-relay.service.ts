import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EventBus } from '../events/event-bus.service';
import { TenantContext } from '../prisma/tenant-context';

/** How often the sweep runs. Critical events (risk flags/escalations,
 * payment captures) reach subscribers within this window instead of
 * instantly — acceptable for risk/finance flows since the UI already has
 * realtime pushes for everything else. */
const SWEEP_INTERVAL_MS = 2_000;

/** Terminal give-up point. Never silent: the 10th failed attempt logs a loud
 * ERROR and the row is marked FAILED (no further retries). */
const MAX_ATTEMPTS = 10;

/** Rows claimed per tenant per sweep tick. */
const BATCH_SIZE = 25;

/** Lease window used while a row is being published: `availableAt` is pushed
 * this far into the future so a second relay instance's concurrent sweep
 * can't also pick it up. If this process crashes mid-publish, the lease
 * simply expires and the row becomes claimable again on a later sweep — no
 * separate "CLAIMED" status is needed, and nothing can get permanently stuck
 * the way a literal claimed-status row would if the claimer died before
 * flipping it back. */
const LEASE_MS = 10_000;

type OutboxRow = {
  id: string;
  tenantId: string;
  eventName: string;
  payload: unknown;
  attempts: number;
  availableAt: Date;
};

/**
 * Transactional outbox relay (ADR-005). `EventBus.publishDurable(tx, ...)`
 * writes `OutboxEvent` rows atomically with the domain-state change that
 * caused them; this service is the other half — a background sweep that
 * finds PENDING rows past their `availableAt` and republishes them through
 * the existing in-process `EventBus.publish()`, so every current subscriber
 * (realtime bridge, metrics bridge, matching) keeps working unchanged.
 *
 * Structured like `RiskSlaService` (apps/api/src/modules/risk/risk-sla.
 * service.ts): `OutboxEvent` sits under the same strict tenant RLS policy as
 * everything else, so this lists tenants from the RLS-exempt `Tenant` table
 * and re-enters `TenantContext.run` per tenant before querying, synthesizing
 * the per-request tenant GUC a background sweep doesn't get from a JWT. One
 * tenant's failure is caught and logged, never allowed to block the others
 * or crash the scheduler (which would silently stop all future sweeps).
 *
 * Claiming uses a compare-and-swap on `availableAt` (see `LEASE_MS` above)
 * rather than a transient "CLAIMED" status, so a crash mid-lease self-heals
 * instead of leaving a row stuck forever.
 */
@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {
    this.logger.log(
      `Outbox relay active — sweeping every ${SWEEP_INTERVAL_MS}ms, up to ${MAX_ATTEMPTS} attempts with exponential backoff before giving up loudly. Only publishers migrated to publishDurable() (intake/psychometrics risk flags + escalations, risk-service assign/resolve, finance payment capture) flow through here — everything else still publishes directly and instantly.`,
    );
  }

  @Interval(SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
    for (const tenant of tenants) {
      try {
        await TenantContext.run({ tenantId: tenant.id }, () => this.sweepTenant(tenant.id));
      } catch (err) {
        this.logger.error(`Outbox sweep failed for tenant ${tenant.id}: ${(err as Error).message}`);
      }
    }
  }

  private async sweepTenant(tenantId: string): Promise<void> {
    const due = (await this.prisma.outboxEvent.findMany({
      where: { tenantId, status: 'PENDING', availableAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    })) as OutboxRow[];

    for (const row of due) {
      await this.claimAndPublish(row);
    }
  }

  private async claimAndPublish(row: OutboxRow): Promise<void> {
    const lease = new Date(Date.now() + LEASE_MS);
    // CAS: only succeeds if the row is still PENDING with EXACTLY the
    // `availableAt` we just read. If another instance (or an earlier tick)
    // already claimed/rescheduled it, `count` is 0 and we back off quietly —
    // that instance owns this attempt, not us.
    const claim = await this.prisma.outboxEvent.updateMany({
      where: { id: row.id, status: 'PENDING', availableAt: row.availableAt },
      data: { availableAt: lease },
    });
    if (claim.count === 0) return;

    const result = await this.bus.publish(row.eventName, row.tenantId, row.payload);

    if (result.ok) {
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), lastError: null },
      });
      return;
    }

    const attempts = row.attempts + 1;
    const message = result.errors.join('; ').slice(0, 2000);

    if (attempts >= MAX_ATTEMPTS) {
      this.logger.error(
        `Outbox event ${row.id} (${row.eventName}, tenant=${row.tenantId}) gave up after ${attempts} attempts: ${message}`,
      );
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: { status: 'FAILED', attempts, lastError: message },
      });
      return;
    }

    const backoffMs = Math.min(2 ** attempts * 1000, 5 * 60_000);
    this.logger.warn(
      `Outbox event ${row.id} (${row.eventName}, tenant=${row.tenantId}) attempt ${attempts} failed, retrying in ${backoffMs}ms: ${message}`,
    );
    await this.prisma.outboxEvent.update({
      where: { id: row.id },
      data: { attempts, availableAt: new Date(Date.now() + backoffMs), lastError: message },
    });
  }
}
