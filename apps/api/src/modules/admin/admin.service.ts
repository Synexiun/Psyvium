import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AiModelVersionDto,
  AuthPrincipal,
  ClinicDto,
  CreateClinicInput,
  FeatureFlagDto,
  PatchClinicInput,
  PatchTenantInput,
  SetAiModelApprovalInput,
  TenantDto,
  UpsertFeatureFlagInput,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus } from '../../common/events/event-bus.service';
import { FeatureFlagsService } from '../../common/feature-flags/feature-flags.service';

/**
 * Admin Configuration (context 27, and context 2 — Tenant / Clinic Network —
 * Wave E). Same local-literal-event-name choice as RegistryService: these
 * names are not yet in the shared `Events` const in
 * `common/events/event-bus.service.ts`, which is out of scope for this wave.
 */
const CONFIG_CHANGED = 'admin.config_changed';
const CLINIC_CREATED = 'admin.clinic_created';
const CLINIC_UPDATED = 'admin.clinic_updated';

type TenantRow = {
  id: string;
  name: string;
  countryCode: string;
  residencyRegion: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type ClinicRow = {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    private readonly flags: FeatureFlagsService,
  ) {}

  // ─────────────────────────────── Tenant (ctx 2) ───────────────────────────

  async getTenant(principal: AuthPrincipal): Promise<TenantDto> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: principal.tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return this.toTenantDto(tenant as TenantRow);
  }

  async patchTenant(principal: AuthPrincipal, input: PatchTenantInput): Promise<TenantDto> {
    const tenantId = principal.tenantId;
    const existing = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!existing) throw new NotFoundException('Tenant not found');

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        name: input.name,
        countryCode: input.countryCode,
        residencyRegion: input.residencyRegion,
      },
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'admin.tenant.updated',
      entityType: 'Tenant',
      entityId: tenantId,
      before: { name: existing.name, countryCode: existing.countryCode, residencyRegion: existing.residencyRegion },
      after: { name: updated.name, countryCode: updated.countryCode, residencyRegion: updated.residencyRegion },
    });
    await this.bus.publish(CONFIG_CHANGED, tenantId, { entity: 'Tenant', tenantId });

    return this.toTenantDto(updated as TenantRow);
  }

  // ─────────────────────────────── Clinics (ctx 2) ──────────────────────────

  async createClinic(principal: AuthPrincipal, input: CreateClinicInput): Promise<ClinicDto> {
    const tenantId = principal.tenantId;
    const clinic = await this.prisma.clinic.create({
      data: { tenantId, name: input.name, type: input.type, timezone: input.timezone },
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'admin.clinic.created',
      entityType: 'Clinic',
      entityId: clinic.id,
      after: { name: clinic.name, type: clinic.type },
    });
    await this.bus.publish(CLINIC_CREATED, tenantId, { clinicId: clinic.id });

    return this.toClinicDto(clinic as ClinicRow);
  }

  async listClinics(principal: AuthPrincipal): Promise<ClinicDto[]> {
    const clinics = await this.prisma.clinic.findMany({
      where: { tenantId: principal.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return clinics.map((c) => this.toClinicDto(c as ClinicRow));
  }

  async patchClinic(principal: AuthPrincipal, id: string, input: PatchClinicInput): Promise<ClinicDto> {
    const tenantId = principal.tenantId;
    const existing = await this.prisma.clinic.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Clinic not found');

    const updated = await this.prisma.clinic.update({
      where: { id },
      data: { name: input.name, type: input.type, timezone: input.timezone },
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'admin.clinic.updated',
      entityType: 'Clinic',
      entityId: id,
      before: { name: existing.name, type: existing.type, timezone: existing.timezone },
      after: { name: updated.name, type: updated.type, timezone: updated.timezone },
    });
    await this.bus.publish(CLINIC_UPDATED, tenantId, { clinicId: id });

    return this.toClinicDto(updated as ClinicRow);
  }

  // ───────────────────── Feature flags (ctx 27 — kill-switch seam) ─────────

  /** GET admin/feature-flags — lists all tenant-scoped flags via FeatureFlagsService. */
  async listFeatureFlags(principal: AuthPrincipal): Promise<FeatureFlagDto[]> {
    return this.flags.listForTenant(principal.tenantId);
  }

  async upsertFeatureFlag(principal: AuthPrincipal, input: UpsertFeatureFlagInput): Promise<FeatureFlagDto> {
    const tenantId = principal.tenantId;
    const existing = await this.prisma.featureFlag.findUnique({
      where: { tenantId_key: { tenantId, key: input.key } },
    });

    const flag = await this.prisma.featureFlag.upsert({
      where: { tenantId_key: { tenantId, key: input.key } },
      create: { tenantId, key: input.key, enabled: input.enabled },
      update: { enabled: input.enabled },
    });

    // The EU-AI-Act kill-switch seam: flipping a flag (e.g. AI_ASSISTED_ANALYSIS)
    // must always leave an audit trail, so this write is never optional.
    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'admin.feature_flag.upserted',
      entityType: 'FeatureFlag',
      entityId: flag.id,
      before: existing ? { enabled: existing.enabled } : null,
      after: { key: flag.key, enabled: flag.enabled },
    });
    await this.bus.publish(CONFIG_CHANGED, tenantId, { entity: 'FeatureFlag', key: flag.key, enabled: flag.enabled });

    return {
      id: flag.id,
      key: flag.key,
      enabled: flag.enabled,
      updatedAt: flag.updatedAt.toISOString(),
    };
  }

  // ──────────── AI model registry governance (doc 05 §5, doc 12 §6) ────────
  // AIModelVersion is a PLATFORM-LEVEL registry table (not tenant-scoped);
  // the audit trail records which tenant's admin acted. Approval is the
  // clinical-governance sign-off that lets the gateway call this model in
  // production (`AiGatewayService.isRuntimeModelApprovedForProduction`).

  async listAiModelVersions(): Promise<AiModelVersionDto[]> {
    const rows = await this.prisma.aIModelVersion.findMany({ orderBy: { activatedAt: 'desc' } });
    return rows.map((row) => this.toAiModelVersionDto(row));
  }

  async setAiModelApproval(
    principal: AuthPrincipal,
    id: string,
    input: SetAiModelApprovalInput,
  ): Promise<AiModelVersionDto> {
    const existing = await this.prisma.aIModelVersion.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('AI model version not found');

    // FAIL-CLOSED (doc 12 §6): a version with no recorded eval run cannot be
    // approved for production — governance sign-off must reference evidence.
    if (input.approved) {
      const metrics = existing.evalMetrics;
      const hasEvalEvidence =
        metrics !== null &&
        typeof metrics === 'object' &&
        !Array.isArray(metrics) &&
        Object.keys(metrics as object).length > 0;
      if (!hasEvalEvidence) {
        throw new ConflictException(
          'Cannot approve for production: AIModelVersion.evalMetrics carries no eval run. ' +
            'Record a passing offline eval before clinical-governance approval (doc 12 §6).',
        );
      }
    }

    const updated = await this.prisma.aIModelVersion.update({
      where: { id },
      data: {
        approvedForProduction: input.approved,
        approvedBy: input.approved ? principal.userId : null,
        approvedAt: input.approved ? new Date() : null,
      },
    });

    // Critical: a model reaching (or being pulled from) production is a
    // governance event that must never be silently lost.
    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: input.approved ? 'admin.ai_model.approved' : 'admin.ai_model.approval_revoked',
      entityType: 'AIModelVersion',
      entityId: id,
      before: {
        approvedForProduction: existing.approvedForProduction,
        approvedBy: existing.approvedBy,
      },
      after: {
        provider: updated.provider,
        model: updated.model,
        version: updated.version,
        approvedForProduction: updated.approvedForProduction,
        approvedBy: updated.approvedBy,
        ...(input.notes ? { notes: input.notes } : {}),
      },
      critical: true,
    });
    await this.bus.publish(CONFIG_CHANGED, principal.tenantId, {
      entity: 'AIModelVersion',
      id,
      approvedForProduction: updated.approvedForProduction,
    });

    return this.toAiModelVersionDto(updated);
  }

  // ─────────────────────────────── Helpers ─────────────────────────────────

  private toTenantDto(t: TenantRow): TenantDto {
    return {
      id: t.id,
      name: t.name,
      countryCode: t.countryCode,
      residencyRegion: t.residencyRegion,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private toClinicDto(c: ClinicRow): ClinicDto {
    return {
      id: c.id,
      tenantId: c.tenantId,
      name: c.name,
      type: c.type,
      timezone: c.timezone,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private toAiModelVersionDto(row: {
    id: string;
    provider: string;
    model: string;
    version: string;
    capability: string;
    evalMetrics: unknown;
    activatedAt: Date;
    approvedForProduction: boolean;
    approvedBy: string | null;
    approvedAt: Date | null;
  }): AiModelVersionDto {
    return {
      id: row.id,
      provider: row.provider,
      model: row.model,
      version: row.version,
      capability: row.capability,
      evalMetrics: row.evalMetrics,
      activatedAt: row.activatedAt.toISOString(),
      approvedForProduction: row.approvedForProduction,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    };
  }
}
