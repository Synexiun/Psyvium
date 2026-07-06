import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
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
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditInput): Promise<void> {
    try {
      const prev = await this.prisma.auditEvent.findFirst({
        where: { tenantId: input.tenantId },
        orderBy: { occurredAt: 'desc' },
        select: { hash: true },
      });
      const prevHash = prev?.hash ?? null;
      const occurredAt = new Date();
      const material = JSON.stringify({
        prevHash,
        tenantId: input.tenantId,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        after: input.after ?? null,
        occurredAt: occurredAt.toISOString(),
      });
      const hash = createHash('sha256').update(material).digest('hex');

      await this.prisma.auditEvent.create({
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
