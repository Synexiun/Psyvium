import { Injectable } from '@nestjs/common';
import type { FeatureFlagDto } from '@vpsy/contracts';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Runtime feature-flag evaluation (doc 10 §13 / EU AI Act staged rollout).
 * Admin CRUD already writes `FeatureFlag` rows; this service is what product
 * code must call so a flag is actually consumed rather than decorative.
 *
 * Fail-closed for safety-critical flags: a missing/errored row returns
 * `defaultEnabled` (callers choose true/false per use case).
 */
@Injectable()
export class FeatureFlagsService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(tenantId: string, key: string, defaultEnabled = false): Promise<boolean> {
    try {
      // Prefer tenant-scoped flag; fall back to a global (tenantId null) row.
      const flag =
        (await this.prisma.featureFlag.findFirst({
          where: { key, tenantId },
          select: { enabled: true },
        })) ??
        (await this.prisma.featureFlag.findFirst({
          where: { key, tenantId: null },
          select: { enabled: true },
        }));
      return flag?.enabled ?? defaultEnabled;
    } catch {
      return defaultEnabled;
    }
  }

  /** All flags for a tenant (tenant-scoped rows only), key-sorted. */
  async listForTenant(tenantId: string): Promise<FeatureFlagDto[]> {
    const flags = await this.prisma.featureFlag.findMany({
      where: { tenantId },
      orderBy: { key: 'asc' },
    });
    return flags.map((f) => ({
      id: f.id,
      key: f.key,
      enabled: f.enabled,
      updatedAt: f.updatedAt.toISOString(),
    }));
  }
}
