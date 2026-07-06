import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { Role } from '@vpsy/contracts';
import type {
  AuthPrincipal,
  ClientRegistryDto,
  ClientRegistryListDto,
  CreateClientRegistryInput,
  CreatePsychologistRegistryInput,
  CredentialSummary,
  PatchClientRegistryInput,
  PatchPsychologistRegistryInput,
  PsychologistRegistryDto,
  PsychologistRegistryListDto,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus } from '../../common/events/event-bus.service';

/**
 * Canonical event names for contexts 3/4 (Client / Psychologist Registry),
 * per docs/technical/01-bounded-contexts.md ("Emits": ClientRegistered,
 * PsychologistOnboarded). Published as literal strings rather than added to
 * the shared `Events` const in `common/events/event-bus.service.ts` — same
 * documented choice as `intervention.service.ts` (that const is out of scope
 * for this wave; `EventBus.publish` accepts any string name).
 */
const CLIENT_REGISTERED = 'client.registered';
const CLIENT_UPDATED = 'client.registry_updated';
const CLIENT_DEREGISTERED = 'client.deregistered';
const PSYCHOLOGIST_ONBOARDED = 'psychologist.onboarded';
const PSYCHOLOGIST_UPDATED = 'psychologist.registry_updated';
const PSYCHOLOGIST_OFFBOARDED = 'psychologist.offboarded';

type UserRow = { id: string; email: string; fullName: string; status: string };

type ClientRow = {
  id: string;
  userId: string;
  status: string;
  preferredLanguage: string;
  culturalContext: string | null;
  demographics: unknown;
  riskLevel: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  user: UserRow;
};

type CredentialRow = {
  jurisdiction: string;
  verificationStatus: string;
  malpracticeStatus: string;
  expiresAt: Date | null;
};

type PsychologistRow = {
  id: string;
  userId: string;
  specialties: string[];
  languages: string[];
  bio: string | null;
  caseloadCap: number;
  currentCaseload: number;
  acceptingClients: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  user: UserRow;
  credentials?: CredentialRow[];
};

/**
 * Registry (contexts 3/4, Wave E) — the ADMIN write surface for Client and
 * Psychologist master records. See the honesty/permission notes in
 * `packages/contracts/src/dto/registry.ts`. Every write additionally checks
 * `assertRegistryWriter` (MANAGER/ADMIN only) since the reused
 * `Permission.CLIENT_WRITE` gate at the controller is broader (also granted
 * to PSYCHOLOGIST for unrelated clinical-context writes).
 */
@Injectable()
export class RegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  // ───────────────────────────── Client Registry ─────────────────────────

  async createClient(principal: AuthPrincipal, input: CreateClientRegistryInput): Promise<ClientRegistryDto> {
    this.assertRegistryWriter(principal);
    const tenantId = principal.tenantId;

    const existing = await this.prisma.user.findFirst({ where: { tenantId, email: input.email } });
    if (existing) throw new ConflictException('A user with this email already exists in this tenant');

    const { user, client } = await this.prisma.$transaction(async (tx) => {
      // No temp-password/invite-email flow in this wave (out of scope per
      // Wave E brief) — the account is created with an unusable,
      // never-communicated random password and an honest `INVITED` status
      // (the existing UserStatus enum value) so it is visibly not yet
      // activated until a real invite/password-reset flow lands.
      const hashedPassword = await argon2.hash(randomBytes(32).toString('hex'));
      const createdUser = await tx.user.create({
        data: {
          tenantId,
          email: input.email,
          fullName: input.fullName,
          locale: input.locale,
          timezone: input.timezone,
          status: 'INVITED',
          hashedPassword,
        },
      });

      const clientRole = await tx.role.findUnique({ where: { name: 'CLIENT' } });
      if (clientRole) {
        await tx.roleAssignment.create({ data: { userId: createdUser.id, roleId: clientRole.id } });
      }

      const createdClient = await tx.client.create({
        data: {
          tenantId,
          userId: createdUser.id,
          preferredLanguage: input.preferredLanguage,
          culturalContext: input.culturalContext,
          demographics: input.demographics as object,
        },
      });

      return { user: createdUser, client: createdClient };
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'registry.client.created',
      entityType: 'Client',
      entityId: client.id,
      after: { userId: user.id, email: user.email },
    });
    await this.bus.publish(CLIENT_REGISTERED, tenantId, { clientId: client.id, userId: user.id });

    return this.toClientDto({ ...client, user } as ClientRow);
  }

  async patchClient(
    principal: AuthPrincipal,
    id: string,
    input: PatchClientRegistryInput,
  ): Promise<ClientRegistryDto> {
    this.assertRegistryWriter(principal);
    const tenantId = principal.tenantId;

    const existing = await this.prisma.client.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { user: true },
    });
    if (!existing) throw new NotFoundException('Client not found');

    const updated = await this.prisma.client.update({
      where: { id },
      data: {
        preferredLanguage: input.preferredLanguage,
        culturalContext: input.culturalContext,
        demographics: input.demographics as object | undefined,
        status: input.status,
      },
      include: { user: true },
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'registry.client.updated',
      entityType: 'Client',
      entityId: id,
      before: { status: existing.status, preferredLanguage: existing.preferredLanguage },
      after: { status: updated.status, preferredLanguage: updated.preferredLanguage },
    });
    await this.bus.publish(CLIENT_UPDATED, tenantId, { clientId: id });

    return this.toClientDto(updated as ClientRow);
  }

  async softDeleteClient(principal: AuthPrincipal, id: string): Promise<ClientRegistryDto> {
    this.assertRegistryWriter(principal);
    const tenantId = principal.tenantId;

    const existing = await this.prisma.client.findFirst({
      where: { id, tenantId },
      include: { user: true },
    });
    if (!existing) throw new NotFoundException('Client not found');
    if (existing.deletedAt) throw new ConflictException('Client is already deleted');

    const updated = await this.prisma.client.update({
      where: { id },
      data: { deletedAt: new Date() },
      include: { user: true },
    });

    // Person-record deletes are critical: the audit write must never fail
    // silently (docs/technical/06-security-and-rbac.md §5).
    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'registry.client.deleted',
      entityType: 'Client',
      entityId: id,
      before: { deletedAt: null },
      after: { deletedAt: updated.deletedAt },
      critical: true,
    });
    await this.bus.publish(CLIENT_DEREGISTERED, tenantId, { clientId: id });

    return this.toClientDto(updated as ClientRow);
  }

  async listClients(principal: AuthPrincipal, take: number, cursor?: string): Promise<ClientRegistryListDto> {
    this.assertRegistryWriter(principal);
    const tenantId = principal.tenantId;

    const rows = await this.prisma.client.findMany({
      where: { tenantId, deletedAt: null },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? page[page.length - 1]!.id : null;

    return { items: page.map((r) => this.toClientDto(r as ClientRow)), nextCursor };
  }

  // ─────────────────────────── Psychologist Registry ──────────────────────

  async createPsychologist(
    principal: AuthPrincipal,
    input: CreatePsychologistRegistryInput,
  ): Promise<PsychologistRegistryDto> {
    this.assertRegistryWriter(principal);
    const tenantId = principal.tenantId;

    const existing = await this.prisma.user.findFirst({ where: { tenantId, email: input.email } });
    if (existing) throw new ConflictException('A user with this email already exists in this tenant');

    const { user, psychologist } = await this.prisma.$transaction(async (tx) => {
      // Same honest no-invite-email placeholder as createClient above.
      const hashedPassword = await argon2.hash(randomBytes(32).toString('hex'));
      const createdUser = await tx.user.create({
        data: {
          tenantId,
          email: input.email,
          fullName: input.fullName,
          locale: input.locale,
          timezone: input.timezone,
          status: 'INVITED',
          hashedPassword,
        },
      });

      const psyRole = await tx.role.findUnique({ where: { name: 'PSYCHOLOGIST' } });
      if (psyRole) {
        await tx.roleAssignment.create({ data: { userId: createdUser.id, roleId: psyRole.id } });
      }

      const createdPsychologist = await tx.psychologist.create({
        data: {
          tenantId,
          userId: createdUser.id,
          specialties: input.specialties,
          languages: input.languages,
          bio: input.bio,
          caseloadCap: input.caseloadCap,
        },
      });

      return { user: createdUser, psychologist: createdPsychologist };
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'registry.psychologist.created',
      entityType: 'Psychologist',
      entityId: psychologist.id,
      after: { userId: user.id, email: user.email },
    });
    await this.bus.publish(PSYCHOLOGIST_ONBOARDED, tenantId, { psychologistId: psychologist.id, userId: user.id });

    return this.toPsychologistDto({ ...psychologist, user, credentials: [] } as PsychologistRow);
  }

  async patchPsychologist(
    principal: AuthPrincipal,
    id: string,
    input: PatchPsychologistRegistryInput,
  ): Promise<PsychologistRegistryDto> {
    this.assertRegistryWriter(principal);
    const tenantId = principal.tenantId;

    const existing = await this.prisma.psychologist.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { user: true, credentials: true },
    });
    if (!existing) throw new NotFoundException('Psychologist not found');

    const updated = await this.prisma.psychologist.update({
      where: { id },
      data: {
        specialties: input.specialties,
        languages: input.languages,
        bio: input.bio,
        caseloadCap: input.caseloadCap,
        acceptingClients: input.acceptingClients,
      },
      include: { user: true, credentials: true },
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'registry.psychologist.updated',
      entityType: 'Psychologist',
      entityId: id,
      before: { caseloadCap: existing.caseloadCap, acceptingClients: existing.acceptingClients },
      after: { caseloadCap: updated.caseloadCap, acceptingClients: updated.acceptingClients },
    });
    await this.bus.publish(PSYCHOLOGIST_UPDATED, tenantId, { psychologistId: id });

    return this.toPsychologistDto(updated as PsychologistRow);
  }

  async softDeletePsychologist(principal: AuthPrincipal, id: string): Promise<PsychologistRegistryDto> {
    this.assertRegistryWriter(principal);
    const tenantId = principal.tenantId;

    const existing = await this.prisma.psychologist.findFirst({
      where: { id, tenantId },
      include: { user: true, credentials: true },
    });
    if (!existing) throw new NotFoundException('Psychologist not found');
    if (existing.deletedAt) throw new ConflictException('Psychologist is already deleted');

    const updated = await this.prisma.psychologist.update({
      where: { id },
      data: { deletedAt: new Date() },
      include: { user: true, credentials: true },
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'registry.psychologist.deleted',
      entityType: 'Psychologist',
      entityId: id,
      before: { deletedAt: null },
      after: { deletedAt: updated.deletedAt },
      critical: true,
    });
    await this.bus.publish(PSYCHOLOGIST_OFFBOARDED, tenantId, { psychologistId: id });

    return this.toPsychologistDto(updated as PsychologistRow);
  }

  async listPsychologists(
    principal: AuthPrincipal,
    take: number,
    cursor?: string,
  ): Promise<PsychologistRegistryListDto> {
    this.assertRegistryWriter(principal);
    const tenantId = principal.tenantId;

    const rows = await this.prisma.psychologist.findMany({
      where: { tenantId, deletedAt: null },
      include: { user: true, credentials: true },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? page[page.length - 1]!.id : null;

    return { items: page.map((r) => this.toPsychologistDto(r as PsychologistRow)), nextCursor };
  }

  // ─────────────────────────────── Helpers ─────────────────────────────────

  /**
   * The registry admin write surface is MANAGER/ADMIN only — see the
   * permission-gap note atop `registry.ts` in @vpsy/contracts. Applied on
   * every write AND on the tenant-wide list (a PII-enumeration surface), not
   * just the four mutating verbs.
   */
  private assertRegistryWriter(principal: AuthPrincipal): void {
    if (!principal.roles.includes(Role.MANAGER) && !principal.roles.includes(Role.ADMIN)) {
      throw new ForbiddenException('Only a MANAGER or ADMIN may access the person registry admin surface');
    }
  }

  private latestCredential(credentials: CredentialRow[] | undefined): CredentialSummary {
    if (!credentials || credentials.length === 0) return null;
    const latest = credentials[0]!;
    return {
      jurisdiction: latest.jurisdiction,
      verificationStatus: latest.verificationStatus,
      malpracticeStatus: latest.malpracticeStatus,
      expiresAt: latest.expiresAt ? latest.expiresAt.toISOString() : null,
    };
  }

  private toClientDto(c: ClientRow): ClientRegistryDto {
    return {
      id: c.id,
      userId: c.userId,
      email: c.user.email,
      fullName: c.user.fullName,
      userStatus: c.user.status,
      status: c.status,
      preferredLanguage: c.preferredLanguage,
      culturalContext: c.culturalContext,
      demographics: c.demographics as Record<string, unknown>,
      riskLevel: c.riskLevel,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
    };
  }

  private toPsychologistDto(p: PsychologistRow): PsychologistRegistryDto {
    return {
      id: p.id,
      userId: p.userId,
      email: p.user.email,
      fullName: p.user.fullName,
      userStatus: p.user.status,
      specialties: p.specialties,
      languages: p.languages,
      bio: p.bio,
      caseloadCap: p.caseloadCap,
      currentCaseload: p.currentCaseload,
      acceptingClients: p.acceptingClients,
      credentialSummary: this.latestCredential(p.credentials),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
    };
  }
}
