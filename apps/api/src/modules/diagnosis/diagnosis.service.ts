import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AuthPrincipal,
  CreateDiagnosisHypothesisInput,
  DiagnosisHypothesisDto,
  UpdateDiagnosisHypothesisStatusInput,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus } from '../../common/events/event-bus.service';

/**
 * Canonical event name for context 13 (Diagnosis Support), per
 * docs/technical/01-bounded-contexts.md ("Emits: HypothesisSuggested").
 * Published as a literal string — see the same note in intervention.service.ts
 * for why this isn't added to the shared `Events` const.
 */
const HYPOTHESIS_SUGGESTED = 'hypothesis.suggested';

type HypothesisRow = {
  id: string;
  clientId: string;
  hypothesis: string;
  confidence: number;
  evidence: string[];
  referralFlags: string[];
  clinicianConfirmed: boolean;
  aiRecommendationId: string | null;
  createdAt: Date;
};

/**
 * Diagnosis Support (context 13). `DiagnosisHypothesis` is a
 * clinician-authored DIFFERENTIAL — the AI Gateway may only ever SUGGEST
 * (via `aiRecommendationId` provenance), never write this record itself.
 * There is no AI-write path in this service by design.
 */
@Injectable()
export class DiagnosisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  async create(
    principal: AuthPrincipal,
    input: CreateDiagnosisHypothesisInput,
  ): Promise<DiagnosisHypothesisDto> {
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    const hypothesis = await this.prisma.diagnosisHypothesis.create({
      data: {
        tenantId: principal.tenantId,
        clientId: input.clientId,
        hypothesis: input.hypothesis,
        confidence: input.confidence,
        evidence: input.evidence,
        referralFlags: input.referralFlags,
        aiRecommendationId: input.aiRecommendationId,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'hypothesis.suggested',
      entityType: 'DiagnosisHypothesis',
      entityId: hypothesis.id,
      after: { clientId: input.clientId, confidence: hypothesis.confidence },
    });
    await this.bus.publish(HYPOTHESIS_SUGGESTED, principal.tenantId, {
      hypothesisId: hypothesis.id,
      clientId: input.clientId,
    });

    return this.toDto(hypothesis);
  }

  /**
   * Toggles `clinicianConfirmed`. The Prisma model has no richer status enum
   * (e.g. ruled_out/active/confirmed) — flagged as a missing field; a real
   * status lifecycle is a documented follow-up, not added here since
   * schema.prisma is out of scope for Wave C.
   */
  async updateStatus(
    principal: AuthPrincipal,
    input: UpdateDiagnosisHypothesisStatusInput,
  ): Promise<DiagnosisHypothesisDto> {
    const existing = await this.prisma.diagnosisHypothesis.findFirst({
      where: { id: input.hypothesisId, tenantId: principal.tenantId },
    });
    if (!existing) throw new NotFoundException('Diagnosis hypothesis not found');

    const updated = await this.prisma.diagnosisHypothesis.update({
      where: { id: input.hypothesisId },
      data: { clinicianConfirmed: input.clinicianConfirmed },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'hypothesis.status_updated',
      entityType: 'DiagnosisHypothesis',
      entityId: updated.id,
      after: { clinicianConfirmed: updated.clinicianConfirmed },
    });

    return this.toDto(updated);
  }

  async listForClient(principal: AuthPrincipal, clientId: string): Promise<DiagnosisHypothesisDto[]> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    const hypotheses = await this.prisma.diagnosisHypothesis.findMany({
      where: { tenantId: principal.tenantId, clientId },
      orderBy: { createdAt: 'desc' },
    });
    return hypotheses.map((h) => this.toDto(h));
  }

  private toDto(h: HypothesisRow): DiagnosisHypothesisDto {
    return {
      id: h.id,
      clientId: h.clientId,
      hypothesis: h.hypothesis,
      confidence: h.confidence,
      evidence: h.evidence,
      referralFlags: h.referralFlags,
      clinicianConfirmed: h.clinicianConfirmed,
      aiRecommendationId: h.aiRecommendationId,
      createdAt: h.createdAt.toISOString(),
    };
  }
}
