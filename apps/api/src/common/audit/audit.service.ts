import { Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AuthPrincipal } from '@vpsy/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { EventBus, Events } from '../events/event-bus.service';

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
   * doc 02 forensic fields (Wave D). All optional — a call site populates
   * only what it actually knows (never fabricated). Every populated field is
   * covered by the event hash, so it cannot be rewritten without breaking
   * the chain. `AuditService.forensicsFromPrincipal` derives the
   * principal-borne subset (jurisdiction/sessionId/authLevel).
   */
  licenseSnapshot?: unknown;
  jurisdiction?: string;
  purpose?: string;
  consentRef?: string;
  abacRuleMatched?: string;
  deviceId?: string;
  sessionId?: string;
  authLevel?: string;
  obligations?: unknown;
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

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly bus?: EventBus,
  ) {}

  /**
   * The principal-borne subset of the doc-02 forensic fields. Call sites
   * spread this into `record()` and add what only they know (purpose,
   * consentRef, abacRuleMatched, licenseSnapshot, obligations).
   */
  static forensicsFromPrincipal(principal: AuthPrincipal): {
    jurisdiction?: string;
    sessionId?: string;
    authLevel: string;
  } {
    return {
      ...(principal.jurisdiction ? { jurisdiction: principal.jurisdiction } : {}),
      ...(principal.sessionId ? { sessionId: principal.sessionId } : {}),
      // Honest labels only: we know whether this session is restricted
      // pending MFA enrollment — not the original credential ceremony.
      authLevel: principal.mfaEnrollmentRequired ? 'restricted-mfa-pending' : 'standard',
    };
  }

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
      licenseSnapshot: unknown;
      jurisdiction: string | null;
      purpose: string | null;
      consentRef: string | null;
      abacRuleMatched: string | null;
      deviceId: string | null;
      sessionId: string | null;
      authLevel: string | null;
      obligations: unknown;
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
        licenseSnapshot: row.licenseSnapshot,
        jurisdiction: row.jurisdiction,
        purpose: row.purpose,
        consentRef: row.consentRef,
        abacRuleMatched: row.abacRuleMatched,
        deviceId: row.deviceId,
        sessionId: row.sessionId,
        authLevel: row.authLevel,
        obligations: row.obligations,
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
        const hash = computeEventHash({
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
          licenseSnapshot: input.licenseSnapshot ?? null,
          jurisdiction: input.jurisdiction ?? null,
          purpose: input.purpose ?? null,
          consentRef: input.consentRef ?? null,
          abacRuleMatched: input.abacRuleMatched ?? null,
          deviceId: input.deviceId ?? null,
          sessionId: input.sessionId ?? null,
          authLevel: input.authLevel ?? null,
          obligations: input.obligations ?? null,
          occurredAt: occurredAt.toISOString(),
        });

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
            licenseSnapshot: input.licenseSnapshot as any,
            jurisdiction: input.jurisdiction,
            purpose: input.purpose,
            consentRef: input.consentRef,
            abacRuleMatched: input.abacRuleMatched,
            deviceId: input.deviceId,
            sessionId: input.sessionId,
            authLevel: input.authLevel,
            obligations: input.obligations as any,
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

  /**
   * Verify prevHash linkage for the newest `limit` events (oldest→newest
   * within the window). Detects silent deletion/reordering of middle rows.
   *
   * Note: full material re-hash is intentionally not done on read — JSONB
   * key order is not stable across drivers, so recomputing would false-fail
   * honest history. Integrity against field rewrite relies on the stored
   * hash + daily tip anchor export (SIEM/WORM) and the write-path hash.
   */
  async verifyChain(
    tenantId: string,
    limit = 500,
  ): Promise<{
    ok: boolean;
    checked: number;
    tipHash: string | null;
    tipId: string | null;
    brokenAt?: string;
    reason?: string;
  }> {
    const take = Math.min(Math.max(limit, 1), 5000);
    const newestFirst = await this.prisma.auditEvent.findMany({
      where: { tenantId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take,
    });
    if (newestFirst.length === 0) {
      return { ok: true, checked: 0, tipHash: null, tipId: null };
    }
    const tip = newestFirst[0]!;
    const rows = [...newestFirst].reverse(); // oldest → newest within window

    // Within the window every consecutive prevHash must equal the prior hash.
    // The window's first row may point outside (genesis or older tip).
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const row = rows[i]!;
      if (row.prevHash !== prev.hash) {
        return {
          ok: false,
          checked: i,
          tipHash: tip.hash,
          tipId: tip.id,
          brokenAt: row.id,
          reason: 'prevHash_mismatch',
        };
      }
    }
    return {
      ok: true,
      checked: rows.length,
      tipHash: tip.hash,
      tipId: tip.id,
    };
  }

  /**
   * Daily integrity proof: verify recent chain then append a critical
   * `audit.daily_anchor` event binding the tip hash to the UTC calendar day.
   */
  async recordDailyAnchor(tenantId: string): Promise<{
    ok: boolean;
    day: string;
    tipHash: string | null;
    verified: boolean;
    checked: number;
  }> {
    const day = new Date().toISOString().slice(0, 10);
    const verification = await this.verifyChain(tenantId, 1000);
    const after = {
      day,
      tipHash: verification.tipHash,
      tipId: verification.tipId,
      checked: verification.checked,
      chainOk: verification.ok,
      brokenAt: verification.brokenAt ?? null,
      reason: verification.reason ?? null,
    };
    await this.record({
      tenantId,
      actorId: 'system.audit-anchor',
      action: 'audit.daily_anchor',
      entityType: 'AuditChain',
      entityId: day,
      after,
      critical: true,
    });
    if (!verification.ok) {
      this.logger.error(
        `audit chain BROKEN tenantId=${tenantId} day=${day} brokenAt=${verification.brokenAt} reason=${verification.reason}`,
      );
    }
    if (this.bus) {
      await this.bus.publish(Events.AuditDailyAnchor, tenantId, after);
      if (!verification.ok) {
        await this.bus.publish(Events.AuditChainBroken, tenantId, after);
      }
    }
    return {
      ok: verification.ok,
      day,
      tipHash: verification.tipHash,
      verified: verification.ok,
      checked: verification.checked,
    };
  }
}

function computeEventHash(fields: {
  prevHash: string | null;
  tenantId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  licenseSnapshot: unknown;
  jurisdiction: string | null;
  purpose: string | null;
  consentRef: string | null;
  abacRuleMatched: string | null;
  deviceId: string | null;
  sessionId: string | null;
  authLevel: string | null;
  obligations: unknown;
  occurredAt: string;
}): string {
  // Full material — before/ip/userAgent and every doc-02 forensic field
  // participate in the hash so an attacker cannot rewrite them without
  // breaking the chain. (Historical rows are unaffected: verification checks
  // prevHash linkage, not recomputation — see verifyChain's note.)
  const material = JSON.stringify(fields);
  return createHash('sha256').update(material).digest('hex');
}

/** Stable signed 32-bit advisory lock key from a tenant id. */
function tenantAdvisoryLockKey(tenantId: string): number {
  const digest = createHash('sha256').update(`vpsy:audit:${tenantId}`).digest();
  // Use first 4 bytes as unsigned int, then coerce to signed 32-bit for Postgres.
  return digest.readInt32BE(0);
}
