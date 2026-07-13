import { Injectable } from '@nestjs/common';
import type { AuthPrincipal, NationalAnalyticsDto, NationalMetricDto } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ALGORITHM_VERSIONS, stampAlgorithm } from '../../common/clinical/algorithm-provenance';

type PopulationMetricRow = {
  region: string;
  metric: string;
  value: number;
  window: string;
  cohortSize: number;
};

/**
 * National Analytics (`docs/technical/13-roadmap-and-phases.md`, context 28,
 * Phase 6 — "De-identified, aggregate population insights for
 * Government/Executive"). Reads the tenant-agnostic `PopulationMetric` table
 * (Group H, `docs/technical/02-data-model.md`) — an already-aggregated,
 * de-identified table with no PII and no client/psychologist foreign key.
 *
 * DE-IDENTIFICATION GUARANTEE (Phase 6 DoD: "National Analytics is aggregate
 * + de-identified only; no re-identification path"): this service enforces a
 * k-anonymity floor *in code*, in addition to whatever floor was applied when
 * the row was written (`PopulationMetric.cohortSize` doc-comment: "k-anonymity
 * floor enforced at write time"). Any row whose `cohortSize` is below the
 * floor has its `value` hard-nulled and `suppressed: true` set — the
 * underlying number is never read into the response object, let alone
 * serialized, so there is no path (bug, refactor, or otherwise) by which a
 * below-floor value could leak through this method.
 */
@Injectable()
export class NationalAnalyticsService {
  /** k-anonymity floor: a cohort smaller than this can never appear in the response. */
  static readonly K_ANONYMITY_FLOOR = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getNationalAnalytics(principal: AuthPrincipal): Promise<NationalAnalyticsDto> {
    const floor = NationalAnalyticsService.K_ANONYMITY_FLOOR;
    const rows = await this.prisma.populationMetric.findMany({
      orderBy: [{ region: 'asc' }, { metric: 'asc' }],
    });

    const metrics: NationalMetricDto[] = rows.map((row) => this.toSuppressedDto(row as PopulationMetricRow, floor));

    const generatedAt = new Date();
    const algorithm = stampAlgorithm(
      'analytics.k_anonymity',
      ALGORITHM_VERSIONS.analyticsKAnonymity,
      'k-anonymity floor suppression (Samarati/Sweeney); EU AI Act Art.13 transparency',
    );
    const dto: NationalAnalyticsDto = {
      generatedAt: generatedAt.toISOString(),
      kAnonymityFloor: floor,
      metrics,
      meta: {
        kAnonymityPolicy:
          `Cohorts with size < ${floor} have value hard-nulled and suppressed=true. ` +
          'The underlying aggregate is never serialized — no re-identification path through this API.',
        kAnonymityFloor: floor,
        algorithm: {
          family: algorithm.family,
          version: algorithm.version,
          citation: algorithm.citation,
          computedAt: algorithm.computedAt,
        },
      },
    };

    const report = await this.prisma.report.create({
      data: {
        tenantId: principal.tenantId,
        type: 'national_analytics',
        scope: 'national',
        parameters: {
          kAnonymityFloor: floor,
          algorithmFamily: algorithm.family,
          algorithmVersion: algorithm.version,
        },
        generatedAt,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'national.generated',
      entityType: 'Report',
      entityId: report.id,
      after: {
        kAnonymityFloor: floor,
        metricCount: metrics.length,
        suppressedCount: metrics.filter((m) => m.suppressed).length,
        deIdentification: {
          method: 'k-anonymity',
          floor,
          note: 'Cells with cohortSize < floor have value nulled; no row-level re-identification path through this API.',
        },
      },
      critical: true,
    });

    return dto;
  }

  /**
   * The single enforcement point for k-anonymity: below the floor, `value`
   * is never copied from `row.value` into the returned object.
   */
  private toSuppressedDto(row: PopulationMetricRow, floor: number): NationalMetricDto {
    const suppressed = row.cohortSize < floor;
    return {
      region: row.region,
      metric: row.metric,
      value: suppressed ? null : row.value,
      unit: this.inferUnit(row.metric),
      window: row.window,
      cohortSize: row.cohortSize,
      suppressed,
    };
  }

  /**
   * `PopulationMetric` has no `unit` column (schema kept unchanged per Phase 6
   * scope) — the unit is derived deterministically from the de-identified
   * metric name itself, never from any per-subject data.
   */
  private inferUnit(metric: string): string | null {
    if (metric.endsWith('_pct')) return '%';
    return null;
  }
}
