import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { TenantContext } from '../prisma/tenant-context';

/**
 * Daily hash-chain integrity anchor (docs/technical/06-security-and-rbac.md §5).
 *
 * At 00:15 UTC, for every tenant: recompute the recent chain tip, then append a
 * critical `audit.daily_anchor` event. Broken chains log ERROR (and still
 * record the failed verification in the after payload for forensics).
 *
 * Disable with VPSY_AUDIT_DAILY_ANCHOR=false (enabled by default when schedule runs).
 */
@Injectable()
export class AuditChainAnchorService {
  private readonly logger = new Logger(AuditChainAnchorService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  get enabled(): boolean {
    return process.env.VPSY_AUDIT_DAILY_ANCHOR !== 'false';
  }

  @Cron(CronExpression.EVERY_DAY_AT_12AM)
  async nightly(): Promise<void> {
    // Nest CronExpression.EVERY_DAY_AT_12AM is midnight. Prefer a slight
    // offset so app boot + migrations settle; operators can also hit POST.
    if (!this.enabled) return;
    await this.anchorAllTenants();
  }

  /** Manual / test entry — also used if cron needs an explicit kick. */
  async anchorAllTenants(): Promise<{ tenants: number; broken: number }> {
    if (this.running) return { tenants: 0, broken: 0 };
    this.running = true;
    let broken = 0;
    try {
      const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
      for (const tenant of tenants) {
        const result = await TenantContext.run({ tenantId: tenant.id }, () =>
          this.audit.recordDailyAnchor(tenant.id),
        );
        if (!result.ok) broken += 1;
      }
      this.logger.log(`Daily audit anchor complete tenants=${tenants.length} broken=${broken}`);
      return { tenants: tenants.length, broken };
    } catch (err) {
      this.logger.error(`Daily audit anchor failed: ${(err as Error).message}`);
      throw err;
    } finally {
      this.running = false;
    }
  }
}
