import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AuthPrincipal } from '@vpsy/contracts';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditInput {
  tenantId: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  /**
   * When true, a failed audit write is re-thrown so the triggering action
   * fails closed instead of silently succeeding without its audit trail
   * (docs/technical/06-security-and-rbac.md §5 — "every clinical action
   * emits a tamper-evident audit event"). Defaults to false so existing
   * callers keep today's best-effort (log-and-continue) behavior.
   */
  critical?: boolean;
}

/**
 * Append-only, hash-chained audit log. Each event's hash covers the previous
 * hash, making silent tampering detectable (any altered row breaks the chain).
 * See docs/technical/06-security-and-rbac.md.
 *
 * Serialization: concurrent writers for the same tenant take a Postgres
 * transaction-scoped advisory lock derived from the tenant id so two
 * simultaneous inserts cannot both read the same prevHash and fork the chain.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read-only audit trail for holders of AUDIT_READ. Returns the newest
   * events first. Forensic payload is tenant-scoped; never cross-tenant.
   */
  async listForTenant(
    principal: AuthPrincipal,
    opts: {
      limit?: number;
      cursor?: string;
      entityType?: string;
      entityId?: string;
      actorId?: string;
      action?: string;
    } = {},
  ): Promise<{
    items: Array<{
      id: string;
      action: string;
      entityType: string;
      entityId: string | null;
      actorId: string | null;
      occurredAt: string;
      ip: string | null;
      userAgent: string | null;
      before: unknown;
      after: unknown;
      hash: string;
      prevHash: string | null;
    }>;
    nextCursor: string | null;
  }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        tenantId: principal.tenantId,
        ...(opts.entityType ? { entityType: opts.entityType } : {}),
        ...(opts.entityId ? { entityId: opts.entityId } : {}),
        ...(opts.actorId ? { actorId: opts.actorId } : {}),
        ...(opts.action ? { action: opts.action } : {}),
        ...(opts.cursor ? { id: { lt: opts.cursor } } : {}),
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const next = rows.length > limit ? page[page.length - 1]?.id ?? null : null;
    return {
      items: page.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        actorId: row.actorId,
        occurredAt: row.occurredAt.toISOString(),
        ip: row.ip,
        userAgent: row.userAgent,
        before: row.before,
        after: row.after,
        hash: row.hash,
        prevHash: row.prevHash,
      })),
      nextCursor: next,
    };
  }

  async record(input: AuditInput): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Serialize per-tenant chain appends. Key is a stable 32-bit digest of
        // the tenant id so concurrent writers never share a prevHash snapshot.
        const lockKey = tenantAdvisoryLockKey(input.tenantId);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

        const prev = await tx.auditEvent.findFirst({
          where: { tenantId: input.tenantId },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          select: { hash: true },
        });
        const prevHash = prev?.hash ?? null;
        const occurredAt = new Date();
        // Full material — before/ip/userAgent participate in the hash so an
        // attacker cannot rewrite those forensic fields without breaking the chain.
        const material = JSON.stringify({
          prevHash,
          tenantId: input.tenantId,
          actorId: input.actorId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          before: input.before ?? null,
          after: input.after ?? null,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          occurredAt: occurredAt.toISOString(),
        });
        const hash = createHash('sha256').update(material).digest('hex');

        await tx.auditEvent.create({
          data: {
            tenantId: input.tenantId,
            actorId: input.actorId,
            action: input.action,
            entityType: input.entityType,
            entityId: input.entityId,
            before: input.before as any,
            after: input.after as any,
            ip: input.ip,
            userAgent: input.userAgent,
            prevHash,
            hash,
            occurredAt,
          },
        });
      });
    } catch (err) {
      // A failed audit write is never silent: always log at ERROR with full
      // context so it surfaces to on-call/monitoring even when the caller
      // swallows the rejection.
      this.logger.error(
        `audit write FAILED action=${input.action} entityType=${input.entityType} entityId=${
          input.entityId ?? 'n/a'
        } tenantId=${input.tenantId} actorId=${input.actorId ?? 'n/a'} critical=${Boolean(input.critical)}: ${
          (err as Error).message
        }`,
        (err as Error).stack,
      );
      if (input.critical) {
        // Fail closed: the caller's action must not silently succeed without
        // its audit record for critical (e.g. break-glass, escalation
        // resolution) events.
        throw err;
      }
    }
  }
}

/** Stable signed 32-bit advisory lock key from a tenant id. */
function tenantAdvisoryLockKey(tenantId: string): number {
  const digest = createHash('sha256').update(`vpsy:audit:${tenantId}`).digest();
  // Use first 4 bytes as unsigned int, then coerce to signed 32-bit for Postgres.
  return digest.readInt32BE(0);
}
