import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthPrincipal, CreateCredentialInput, CredentialDto, VerifyCredentialInput } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

type CredentialRow = {
  id: string;
  psychologistId: string;
  licenseNumber: string;
  jurisdiction: string;
  issuingBody: string;
  expiresAt: Date | null;
  verificationStatus: string;
  malpracticeStatus: string;
  createdAt: Date;
};

/**
 * Credentialing & Contracts (Phase 2, bounded context 7). Owns license
 * capture + verification and is the cross-cutting eligibility check that
 * `ClinicalWriteGuard` calls before any clinical write is allowed to proceed
 * (see docs/technical/13-roadmap-and-phases.md Phase 2 DoD: "Clinical writes
 * blocked when license inactive or jurisdiction/scope mismatched").
 */
@Injectable()
export class CredentialingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Manager/ops: credentials expiring within N days (renewal pipeline).
   * Includes already-expired verified credentials so nothing ages silently.
   */
  async listExpiring(principal: AuthPrincipal, withinDays = 60): Promise<CredentialDto[]> {
    const horizon = new Date();
    horizon.setUTCDate(horizon.getUTCDate() + Math.max(1, Math.min(withinDays, 365)));
    const rows = await this.prisma.credential.findMany({
      where: {
        psychologist: { tenantId: principal.tenantId, deletedAt: null },
        verificationStatus: 'verified',
        expiresAt: { not: null, lte: horizon },
      },
      orderBy: { expiresAt: 'asc' },
      take: 200,
    });
    return rows.map((c) => this.toDto(c as CredentialRow));
  }

  async create(principal: AuthPrincipal, input: CreateCredentialInput): Promise<CredentialDto> {
    const psychologistId = input.psychologistId ?? (await this.resolveOwnPsychologistId(principal));

    const psychologist = await this.prisma.psychologist.findFirst({
      where: { id: psychologistId, tenantId: principal.tenantId },
    });
    if (!psychologist) throw new NotFoundException('Psychologist not found');

    const credential = await this.prisma.credential.create({
      data: {
        psychologistId,
        licenseNumber: input.licenseNumber,
        jurisdiction: input.jurisdiction,
        issuingBody: input.issuingBody,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        malpracticeStatus: input.malpracticeStatus,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'credential.captured',
      entityType: 'Credential',
      entityId: credential.id,
      after: { psychologistId, jurisdiction: credential.jurisdiction, licenseNumber: credential.licenseNumber },
    });

    return this.toDto(credential);
  }

  async verify(principal: AuthPrincipal, id: string, input: VerifyCredentialInput): Promise<CredentialDto> {
    const credential = await this.prisma.credential.findFirst({
      where: { id, psychologist: { tenantId: principal.tenantId } },
    });
    if (!credential) throw new NotFoundException('Credential not found');

    const updated = await this.prisma.credential.update({
      where: { id },
      data: {
        verificationStatus: input.verificationStatus,
        malpracticeStatus: input.malpracticeStatus ?? credential.malpracticeStatus,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'credential.verified',
      entityType: 'Credential',
      entityId: updated.id,
      before: { verificationStatus: credential.verificationStatus, malpracticeStatus: credential.malpracticeStatus },
      after: { verificationStatus: updated.verificationStatus, malpracticeStatus: updated.malpracticeStatus },
    });

    return this.toDto(updated);
  }

  async listByPsychologist(principal: AuthPrincipal, psychologistId: string): Promise<CredentialDto[]> {
    const psychologist = await this.prisma.psychologist.findFirst({
      where: { id: psychologistId, tenantId: principal.tenantId },
    });
    if (!psychologist) throw new NotFoundException('Psychologist not found');

    const credentials = await this.prisma.credential.findMany({
      where: { psychologistId },
      orderBy: { createdAt: 'desc' },
    });
    return credentials.map((c) => this.toDto(c));
  }

  /**
   * The clinical-write eligibility gate. Resolves user → Psychologist →
   * Credential(s) and requires at least one credential that is verified,
   * has an active malpractice status, is not expired, and matches the
   * acting principal's jurisdiction. Called by `ClinicalWriteGuard`; denies
   * by default (no psychologist profile, no jurisdiction claim, or no
   * matching credential all result in a 403).
   */
  async assertClinicalEligibility(userId: string, jurisdiction?: string): Promise<void> {
    const psychologist = await this.prisma.psychologist.findFirst({
      where: { userId },
      include: { credentials: true },
    });
    if (!psychologist) {
      throw new ForbiddenException('Clinical write blocked: no psychologist/credential profile for this user');
    }

    const now = new Date();
    const eligible = psychologist.credentials.some(
      (c) =>
        !!jurisdiction &&
        c.jurisdiction === jurisdiction &&
        c.verificationStatus === 'verified' &&
        c.malpracticeStatus === 'active' &&
        (c.expiresAt === null || c.expiresAt > now),
    );

    if (!eligible) {
      throw new ForbiddenException(
        'Clinical write blocked: no verified, active, non-expired credential matching the acting jurisdiction',
      );
    }
  }

  private async resolveOwnPsychologistId(principal: AuthPrincipal): Promise<string> {
    const psychologist = await this.prisma.psychologist.findFirst({
      where: { userId: principal.userId, tenantId: principal.tenantId },
    });
    if (!psychologist) throw new BadRequestException('No psychologist profile for principal');
    return psychologist.id;
  }

  private toDto(c: CredentialRow): CredentialDto {
    return {
      id: c.id,
      psychologistId: c.psychologistId,
      licenseNumber: c.licenseNumber,
      jurisdiction: c.jurisdiction,
      issuingBody: c.issuingBody,
      expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
      verificationStatus: c.verificationStatus,
      malpracticeStatus: c.malpracticeStatus,
      createdAt: c.createdAt.toISOString(),
    };
  }
}
