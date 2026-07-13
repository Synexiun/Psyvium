import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { CrmErrorCode } from '@vpsy/contracts';
import type {
  AuthPrincipal,
  ConvertLeadInput,
  ConvertLeadResult,
  CreateLeadInput,
  CreateReferrerInput,
  CrmBoardDto,
  CrmContact,
  EngagementDto,
  LeadDto,
  LogEngagementInput,
  MoveLeadStageInput,
  PipelineStageDto,
  ReferrerDto,
  StalledLeadDto,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';

type LeadRow = {
  id: string;
  source: string;
  contact: unknown;
  presentingInterest: string | null;
  pipelineStageId: string;
  status: string;
  referrerId: string | null;
  convertedClientId?: string | null;
  createdAt: Date;
  updatedAt?: Date;
  pipelineStage: { name: string };
};

/**
 * CRM & Referrals (context 29, `docs/technical/16-crm-and-referrals.md`).
 * Owns the lead pipeline, the referrer registry, and the unified engagement
 * timeline up to the conversion boundary — once a `Lead` becomes a `Client`,
 * ownership of care passes to Intake & Screening (context 6). CRM data is
 * never clinical data: no method here reads or writes a care `Consent`.
 */
@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  // ── Board ──

  async getBoard(principal: AuthPrincipal): Promise<CrmBoardDto> {
    const tenantId = principal.tenantId;
    const [stages, leads, referrers] = await Promise.all([
      this.prisma.pipelineStage.findMany({ where: { tenantId }, orderBy: { order: 'asc' } }),
      this.prisma.lead.findMany({
        where: { tenantId },
        include: { pipelineStage: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.referrer.findMany({ where: { tenantId, active: true }, orderBy: { organizationName: 'asc' } }),
    ]);

    const leadsByStage: Record<string, LeadDto[]> = {};
    for (const stage of stages) leadsByStage[stage.id] = [];
    for (const lead of leads as LeadRow[]) {
      const dto = this.toLeadDto(lead);
      (leadsByStage[lead.pipelineStageId] ??= []).push(dto);
    }

    return {
      stages: stages.map((s) => this.toStageDto(s)),
      leadsByStage,
      referrers: referrers.map((r) => this.toReferrerDto(r)),
    };
  }

  // ── Leads ──

  async createLead(principal: AuthPrincipal, input: CreateLeadInput): Promise<LeadDto> {
    const tenantId = principal.tenantId;

    if (input.referrerId) {
      const referrer = await this.prisma.referrer.findFirst({ where: { id: input.referrerId, tenantId } });
      if (!referrer) throw new NotFoundException('Referrer not found');
    }

    // ── Dedupe (`16-crm-and-referrals.md` §6.2) — deterministic match on
    // normalized email OR E.164 phone within the tenant, checked before any
    // new `Lead` row is created. ──
    const normalizedEmail = input.contact.email ? CrmService.normalizeEmail(input.contact.email) : undefined;
    const normalizedPhone = input.contact.phone ? CrmService.normalizePhone(input.contact.phone) : undefined;

    if (normalizedEmail || normalizedPhone) {
      const existing = await this.findDuplicateLead(tenantId, normalizedEmail, normalizedPhone);
      if (existing) {
        const alreadyConverted = Boolean(existing.convertedClientId) || existing.status === 'won';
        if (alreadyConverted) {
          await this.audit.record({
            tenantId,
            actorId: principal.userId,
            action: 'lead.dedupe_blocked_already_client',
            entityType: 'Lead',
            entityId: existing.id,
            after: { attemptedSource: input.source, convertedClientId: existing.convertedClientId ?? null },
          });
          throw new ConflictException({
            code: CrmErrorCode.LEAD_ALREADY_CLIENT,
            message: 'This contact is already a client — route them to care, not marketing.',
            leadId: existing.id,
            clientId: existing.convertedClientId ?? null,
          });
        }
        return this.enrichExistingLead(principal, existing, input);
      }
    }

    // Default to the first configured stage in the funnel (lowest `order`).
    const firstStage = await this.prisma.pipelineStage.findFirst({
      where: { tenantId },
      orderBy: { order: 'asc' },
    });
    if (!firstStage) throw new ConflictException('No pipeline stages configured for this tenant');

    const lead = await this.prisma.lead.create({
      data: {
        tenantId,
        source: input.source,
        contact: input.contact as object,
        presentingInterest: input.presentingInterest,
        pipelineStageId: firstStage.id,
        referrerId: input.referrerId,
        campaignId: input.campaignId,
        status: 'active',
      },
      include: { pipelineStage: true },
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'lead.captured',
      entityType: 'Lead',
      entityId: lead.id,
      after: { source: lead.source, referrerId: lead.referrerId, pipelineStageId: lead.pipelineStageId },
    });

    await this.bus.publish(Events.LeadCaptured, tenantId, {
      leadId: lead.id,
      source: lead.source,
      referrerId: lead.referrerId,
    });
    if (lead.referrerId) {
      await this.bus.publish(Events.ReferralReceived, tenantId, {
        leadId: lead.id,
        referrerId: lead.referrerId,
      });
    }

    return this.toLeadDto(lead as LeadRow);
  }

  /**
   * Advance (or otherwise move) a lead's pipeline stage. Every transition is
   * a domain event (`LeadStageChanged`) AND an `EngagementActivity` entry —
   * the pipeline is part of the unified timeline, never a silent state machine
   * (`16-crm-and-referrals.md` §2).
   */
  async moveLeadStage(principal: AuthPrincipal, leadId: string, input: MoveLeadStageInput): Promise<LeadDto> {
    const tenantId = principal.tenantId;
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead) throw new NotFoundException('Lead not found');

    const toStage = await this.prisma.pipelineStage.findFirst({ where: { id: input.toStageId, tenantId } });
    if (!toStage) throw new NotFoundException('Target pipeline stage not found');

    const fromStageId = lead.pipelineStageId;
    const nextStatus = toStage.isLost ? 'lost' : toStage.isWon ? 'won' : 'active';

    const updated = await this.prisma.lead.update({
      where: { id: leadId },
      data: { pipelineStageId: toStage.id, status: nextStatus },
      include: { pipelineStage: true },
    });

    await this.prisma.engagementActivity.create({
      data: {
        tenantId,
        subjectType: 'Lead',
        subjectId: leadId,
        kind: 'NOTE',
        direction: 'OUTBOUND',
        summary: input.note ?? `Stage moved to ${toStage.name}`,
        actorId: principal.userId,
      },
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'lead.stage_changed',
      entityType: 'Lead',
      entityId: leadId,
      before: { pipelineStageId: fromStageId },
      after: { pipelineStageId: toStage.id, status: nextStatus },
    });

    await this.bus.publish(Events.LeadStageChanged, tenantId, {
      leadId,
      fromStageId,
      toStageId: toStage.id,
    });

    return this.toLeadDto(updated as LeadRow);
  }

  /**
   * Lead → Client conversion (`16-crm-and-referrals.md` §6.1). Creates a
   * `Client` (+ `User` with the CLIENT role) from the lead, moves the lead to
   * a terminal `isWon` stage, and preserves the referrer attribution that
   * downstream Revenue Share / Payouts (context 22) consumes off
   * `LeadConverted`. One-way and audited — never a shortcut around Intake.
   */
  async convertLead(principal: AuthPrincipal, leadId: string, input: ConvertLeadInput): Promise<ConvertLeadResult> {
    const tenantId = principal.tenantId;
    const lead = await this.prisma.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead) throw new NotFoundException('Lead not found');
    if (lead.convertedClientId || lead.status === 'won') {
      throw new ConflictException('Lead has already been converted');
    }

    const contact = (lead.contact ?? {}) as CrmContact;
    if (contact.doNotContact === true) {
      throw new BadRequestException(
        'Lead is marked doNotContact — conversion/outreach blocked. Clear the flag only with documented consent.',
      );
    }
    const email = input.email ?? contact.email;
    if (!email) {
      throw new BadRequestException('Lead has no email on file — provide one to convert');
    }
    const fullName = contact.name ?? 'New Client';

    const wonStage = await this.prisma.pipelineStage.findFirst({
      where: { tenantId, isWon: true },
      orderBy: { order: 'asc' },
    });
    if (!wonStage) throw new ConflictException('No won (terminal) pipeline stage configured for this tenant');

    const rawPassword = input.password ?? randomBytes(24).toString('base64url');
    const hashedPassword = await argon2.hash(rawPassword);

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { tenantId, email, fullName, hashedPassword },
      });

      const clientRole = await tx.role.findUnique({ where: { name: 'CLIENT' } });
      if (clientRole) {
        await tx.roleAssignment.create({ data: { userId: user.id, roleId: clientRole.id } });
      }

      const client = await tx.client.create({
        data: { tenantId, userId: user.id, demographics: {}, preferredLanguage: 'en' },
      });

      const updatedLead = await tx.lead.update({
        where: { id: leadId },
        data: { pipelineStageId: wonStage.id, status: 'won', convertedClientId: client.id },
      });

      return { user, client, lead: updatedLead };
    });

    // Schema note: `Lead` has no dedicated `doNotContact` column (contact is a
    // JSON blob). Care-side consent (TELEPSYCHOLOGY / DATA_PROCESSING / etc.)
    // is NOT granted by conversion — Intake & Consent contexts own that. We
    // record an explicit engagement note so operators never assume marketing
    // capture implies clinical consent.
    await this.prisma.engagementActivity.create({
      data: {
        tenantId,
        subjectType: 'Lead',
        subjectId: leadId,
        kind: 'NOTE',
        // EngagementDirection only has INBOUND|OUTBOUND (no INTERNAL) — schema-honest.
        direction: 'OUTBOUND',
        summary:
          'Converted to Client — care-side consent (TELEPSYCHOLOGY / DATA_PROCESSING / CRISIS_POLICY) ' +
          'is still required before clinical work; CRM capture is not clinical consent.',
        actorId: principal.userId,
      },
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'lead.converted',
      entityType: 'Lead',
      entityId: leadId,
      after: {
        clientId: result.client.id,
        userId: result.user.id,
        referrerId: lead.referrerId,
        consentNote: 'care_consent_still_required',
      },
    });

    await this.bus.publish(Events.LeadConverted, tenantId, {
      leadId,
      clientId: result.client.id,
      userId: result.user.id,
      referrerId: lead.referrerId,
    });

    return {
      leadId,
      clientId: result.client.id,
      userId: result.user.id,
      pipelineStageId: wonStage.id,
      convertedAt: result.lead.updatedAt.toISOString(),
    };
  }

  /**
   * Deterministic dedupe lookup (`16-crm-and-referrals.md` §6.2). `contact`
   * is a JSON blob, so this is an in-memory scan over the tenant's leads
   * rather than an indexed query — honest trade-off for now; at real scale
   * this wants a normalized, indexed `contactEmailKey`/`contactPhoneKey`
   * column populated at write time.
   */
  private async findDuplicateLead(
    tenantId: string,
    normalizedEmail: string | undefined,
    normalizedPhone: string | undefined,
  ): Promise<LeadRow | null> {
    const candidates = await this.prisma.lead.findMany({
      where: { tenantId },
      include: { pipelineStage: true },
    });
    for (const lead of candidates as LeadRow[]) {
      const contact = (lead.contact ?? {}) as CrmContact;
      const candidateEmail = contact.email ? CrmService.normalizeEmail(contact.email) : undefined;
      const candidatePhone = contact.phone ? CrmService.normalizePhone(contact.phone) : undefined;
      if ((normalizedEmail && candidateEmail === normalizedEmail) || (normalizedPhone && candidatePhone === normalizedPhone)) {
        return lead;
      }
    }
    return null;
  }

  /**
   * A dedupe match against a NON-converted lead never creates a duplicate
   * pipeline row — it enriches the existing lead (fills in fields the first
   * touch didn't have) and records the re-contact on the unified timeline.
   * Referrer attribution is immutable once set (§3.1): a later touch can
   * fill a previously-null `referrerId`, but never overwrite one.
   */
  private async enrichExistingLead(
    principal: AuthPrincipal,
    existing: LeadRow,
    input: CreateLeadInput,
  ): Promise<LeadDto> {
    const tenantId = principal.tenantId;
    const existingContact = (existing.contact ?? {}) as CrmContact;
    const mergedContact: CrmContact = {
      name: existingContact.name || input.contact.name,
      email: existingContact.email ?? input.contact.email,
      phone: existingContact.phone ?? input.contact.phone,
    };

    const updated = await this.prisma.lead.update({
      where: { id: existing.id },
      data: {
        contact: mergedContact as object,
        presentingInterest: existing.presentingInterest ?? input.presentingInterest ?? null,
        ...(existing.referrerId ? {} : input.referrerId ? { referrerId: input.referrerId } : {}),
      },
      include: { pipelineStage: true },
    });

    await this.prisma.engagementActivity.create({
      data: {
        tenantId,
        subjectType: 'Lead',
        subjectId: existing.id,
        kind: 'NOTE',
        direction: 'INBOUND',
        summary: `Re-contact via ${input.source}${
          input.referrerId ? ` (referrer ${input.referrerId})` : ''
        } — deduped against an existing lead, no duplicate created`,
        actorId: principal.userId,
      },
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'lead.recontact',
      entityType: 'Lead',
      entityId: existing.id,
      after: { attemptedSource: input.source },
    });

    return { ...this.toLeadDto(updated as LeadRow), deduped: true };
  }

  /**
   * Best-effort dedupe-matching normalization — case-folds the email and
   * strips all non-digit characters from the phone (no leading `+`, so
   * "+1 555-123-0099" and "15551230099" collapse to the same key). Not full
   * E.164 validation (`libphonenumber`-class), only a matching key.
   */
  private static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private static normalizePhone(phone: string): string {
    return phone.trim().replace(/\D/g, '');
  }

  /**
   * Stalled-lead surfacing (`16-crm-and-referrals.md` §2 — "an operational
   * nudge, not a clinical escalation"). Honesty note: `Lead` has no dedicated
   * "entered current stage" timestamp, so this uses `updatedAt` as the basis
   * — any field edit resets the clock, not only a `LeadStageChanged` move.
   * Only active (non-won, non-lost) leads are considered "stalled."
   */
  async getStalledLeads(principal: AuthPrincipal, days: number): Promise<StalledLeadDto[]> {
    const tenantId = principal.tenantId;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const leads = await this.prisma.lead.findMany({
      where: { tenantId, status: 'active', updatedAt: { lte: cutoff } },
      include: { pipelineStage: true },
      orderBy: { updatedAt: 'asc' },
    });

    const now = Date.now();
    return (leads as LeadRow[]).map((lead) => {
      const updatedAt = lead.updatedAt ?? lead.createdAt;
      const daysStalled = Math.floor((now - updatedAt.getTime()) / (24 * 60 * 60 * 1000));
      return {
        ...this.toLeadDto(lead),
        daysStalled,
        staleSince: updatedAt.toISOString(),
        basis: 'updatedAt' as const,
      };
    });
  }

  // ── Referrers ──

  async createReferrer(principal: AuthPrincipal, input: CreateReferrerInput): Promise<ReferrerDto> {
    const tenantId = principal.tenantId;
    const referrer = await this.prisma.referrer.create({
      data: {
        tenantId,
        type: input.type,
        organizationName: input.organizationName,
        contact: input.contact as object,
        agreementId: input.agreementId,
        referralSharePct: input.referralSharePct,
      },
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'referrer.created',
      entityType: 'Referrer',
      entityId: referrer.id,
      after: { type: referrer.type, organizationName: referrer.organizationName },
    });

    return this.toReferrerDto(referrer);
  }

  async listReferrers(principal: AuthPrincipal): Promise<ReferrerDto[]> {
    const referrers = await this.prisma.referrer.findMany({
      where: { tenantId: principal.tenantId },
      orderBy: { organizationName: 'asc' },
    });
    return referrers.map((r) => this.toReferrerDto(r));
  }

  // ── Engagement timeline ──

  async logEngagement(principal: AuthPrincipal, input: LogEngagementInput): Promise<EngagementDto> {
    const tenantId = principal.tenantId;

    // Lead model has no dedicated doNotContact column — honor the optional
    // flag inside the contact JSON when present, for OUTBOUND outreach only.
    if (input.subjectType === 'Lead' && input.direction === 'OUTBOUND') {
      const lead = await this.prisma.lead.findFirst({ where: { id: input.subjectId, tenantId } });
      if (lead) {
        const contact = (lead.contact ?? {}) as CrmContact;
        if (contact.doNotContact === true) {
          throw new BadRequestException(
            'Lead is marked doNotContact — outbound engagement is blocked.',
          );
        }
      }
    }

    const activity = await this.prisma.engagementActivity.create({
      data: {
        tenantId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        kind: input.kind,
        direction: input.direction,
        summary: input.summary,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        actorId: principal.userId,
      },
    });

    await this.audit.record({
      tenantId,
      actorId: principal.userId,
      action: 'engagement.logged',
      entityType: 'EngagementActivity',
      entityId: activity.id,
      after: { subjectType: activity.subjectType, subjectId: activity.subjectId, kind: activity.kind },
    });

    return this.toEngagementDto(activity);
  }

  async getTimeline(principal: AuthPrincipal, subjectType: string, subjectId: string): Promise<EngagementDto[]> {
    const activities = await this.prisma.engagementActivity.findMany({
      where: { tenantId: principal.tenantId, subjectType, subjectId },
      orderBy: { occurredAt: 'desc' },
    });
    return activities.map((a) => this.toEngagementDto(a));
  }

  // ── Mappers ──

  private toStageDto(stage: { id: string; name: string; order: number; isWon: boolean; isLost: boolean }): PipelineStageDto {
    return { id: stage.id, name: stage.name, order: stage.order, isWon: stage.isWon, isLost: stage.isLost };
  }

  private toLeadDto(lead: LeadRow): LeadDto {
    return {
      id: lead.id,
      source: lead.source as LeadDto['source'],
      contact: (lead.contact ?? {}) as CrmContact,
      presentingInterest: lead.presentingInterest,
      pipelineStageId: lead.pipelineStageId,
      pipelineStageName: lead.pipelineStage.name,
      status: lead.status,
      referrerId: lead.referrerId,
      createdAt: lead.createdAt.toISOString(),
    };
  }

  private toReferrerDto(referrer: {
    id: string;
    type: string;
    organizationName: string;
    contact: unknown;
    referralSharePct: number;
    active: boolean;
  }): ReferrerDto {
    return {
      id: referrer.id,
      type: referrer.type as ReferrerDto['type'],
      organizationName: referrer.organizationName,
      contact: (referrer.contact ?? {}) as ReferrerDto['contact'],
      referralSharePct: referrer.referralSharePct,
      active: referrer.active,
    };
  }

  private toEngagementDto(activity: {
    id: string;
    subjectType: string;
    subjectId: string;
    kind: string;
    direction: string;
    summary: string;
    occurredAt: Date;
  }): EngagementDto {
    return {
      id: activity.id,
      subjectType: activity.subjectType,
      subjectId: activity.subjectId,
      kind: activity.kind as EngagementDto['kind'],
      direction: activity.direction as EngagementDto['direction'],
      summary: activity.summary,
      occurredAt: activity.occurredAt.toISOString(),
    };
  }
}
