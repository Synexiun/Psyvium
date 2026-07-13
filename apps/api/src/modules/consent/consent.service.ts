import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AI_CONSENT_VERSION,
  ConsentType,
  REQUIRED_CONSENT_VERSIONS,
  type AuthPrincipal,
  type ConsentDto,
  type GrantConsentInput,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

type ConsentRow = {
  id: string;
  clientId: string;
  type: string;
  version: string;
  grantedAt: Date;
  revokedAt: Date | null;
  documentUrl: string | null;
  policyContentHash?: string | null;
};

/**
 * Consent (part of Intake & Screening, Phase 2). Consent is versioned and
 * append-only: a new grant supersedes a prior one for the same type but the
 * prior row is never deleted; revoking only ever sets `revokedAt`. Enforced
 * by `IntakeService.submit` via `assertRequiredConsents` before an intake is
 * ever created ("intake respects purpose scope" — Phase 2 DoD).
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async grant(principal: AuthPrincipal, input: GrantConsentInput): Promise<ConsentDto> {
    const client = await this.resolveClient(principal);

    const consent = await this.prisma.consent.create({
      data: {
        clientId: client.id,
        type: input.type,
        version: input.version,
        documentUrl: input.documentUrl,
        policyContentHash: input.policyContentHash,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'consent.granted',
      entityType: 'Consent',
      entityId: consent.id,
      after: {
        type: consent.type,
        version: consent.version,
        policyContentHash: consent.policyContentHash ?? null,
      },
      critical: true,
    });

    return this.toDto(consent);
  }

  async listMine(principal: AuthPrincipal): Promise<ConsentDto[]> {
    const client = await this.resolveClient(principal);
    const consents = await this.prisma.consent.findMany({
      where: { clientId: client.id },
      orderBy: { grantedAt: 'desc' },
    });
    return consents.map((c) => this.toDto(c));
  }

  async revoke(principal: AuthPrincipal, id: string): Promise<ConsentDto> {
    const client = await this.resolveClient(principal);
    const consent = await this.prisma.consent.findFirst({ where: { id, clientId: client.id } });
    if (!consent) throw new NotFoundException('Consent not found');
    if (consent.revokedAt) throw new BadRequestException('Consent already revoked');

    const revoked = await this.prisma.consent.update({
      where: { id: consent.id },
      data: { revokedAt: new Date() },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'consent.revoked',
      entityType: 'Consent',
      entityId: revoked.id,
      after: { type: revoked.type, version: revoked.version },
    });

    return this.toDto(revoked);
  }

  /**
   * Gate for purpose-scoped clinical intake: requires a current-version,
   * non-revoked grant for every consent type in REQUIRED_CONSENT_VERSIONS
   * (today: TELEPSYCHOLOGY + DATA_PROCESSING). Throws with the specific
   * missing consent types so the caller can surface exactly what's needed.
   */
  async assertRequiredConsents(clientId: string): Promise<void> {
    const consents = await this.prisma.consent.findMany({ where: { clientId, revokedAt: null } });

    const missing = Object.entries(REQUIRED_CONSENT_VERSIONS).filter(
      ([type, version]) => !consents.some((c) => c.type === type && c.version === version),
    );

    if (missing.length > 0) {
      throw new ConflictException({
        type: 'https://vpsy.health/errors/consent-required',
        title: 'Consent required',
        missing: missing.map(([type, version]) => ({ type, requiredVersion: version })),
      });
    }
  }

  /**
   * WAVE CR — AI gate (APA AI guidance 2025 / GDPR Art.22). Checks for a
   * non-revoked, current-version `AI_ASSISTED_ANALYSIS` grant for this
   * client. Unlike `assertRequiredConsents`, this NEVER throws and never
   * blocks a clinical workflow — it only tells `AiGatewayService` whether a
   * real model call is permitted for this client. Missing/revoked consent
   * simply means the AI Gateway degrades honestly to its rule-based path.
   */
  async hasActiveAiConsent(clientId: string): Promise<boolean> {
    const consent = await this.prisma.consent.findFirst({
      where: {
        clientId,
        type: ConsentType.AI_ASSISTED_ANALYSIS,
        version: AI_CONSENT_VERSION,
        revokedAt: null,
      },
    });
    return consent !== null;
  }

  private async resolveClient(principal: AuthPrincipal) {
    const client = await this.prisma.client.findFirst({
      where: { userId: principal.userId, tenantId: principal.tenantId },
    });
    if (!client) throw new BadRequestException('No client profile for principal');
    return client;
  }

  private toDto(c: ConsentRow): ConsentDto {
    return {
      id: c.id,
      clientId: c.clientId,
      type: c.type as ConsentDto['type'],
      version: c.version,
      grantedAt: c.grantedAt.toISOString(),
      revokedAt: c.revokedAt ? c.revokedAt.toISOString() : null,
      documentUrl: c.documentUrl,
      policyContentHash: c.policyContentHash ?? null,
    };
  }
}
