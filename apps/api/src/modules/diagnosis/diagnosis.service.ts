import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AuthPrincipal,
  CreateDiagnosisHypothesisInput,
  CreateFormulationInput,
  DiagnosisHypothesisDto,
  FormulationDto,
  UpdateDiagnosisHypothesisStatusInput,
  UpdateFormulationStatusInput,
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

/**
 * WAVE CR item 7 — Formulation lifecycle events. Also a literal string for
 * the same reason as HYPOTHESIS_SUGGESTED above (context 13 is not yet
 * represented in the shared `Events` const).
 */
const FORMULATION_RECORDED = 'formulation.recorded';
const FORMULATION_STATUS_UPDATED = 'formulation.status_updated';

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

type FormulationRow = {
  id: string;
  clientId: string;
  authorId: string;
  icdCode: string;
  dsmCode: string | null;
  description: string;
  status: string;
  basedOnHypothesisId: string | null;
  specifiers: unknown;
  onsetDate: Date | null;
  resolvedDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Diagnosis Support (context 13). `DiagnosisHypothesis` is a
 * clinician-authored DIFFERENTIAL — the AI Gateway may only ever SUGGEST
 * (via `aiRecommendationId` provenance), never write this record itself.
 * There is no AI-write path in this service by design.
 *
 * WAVE CR item 7 adds `Formulation` — the clinician's ACTUAL coded diagnosis
 * (DSM-5-TR/ICD-10/11), anchoring the golden thread (docs/10-10-PROGRAM.md).
 * It is a DISTINCT record from DiagnosisHypothesis: a Formulation is the
 * human clinical act, recorded as such. Every write is audited `critical:
 * true` — a diagnosis record must never silently fail its audit trail — and,
 * like DiagnosisHypothesis, there is no AI-write path to it anywhere in this
 * service (see diagnosis.service.spec.ts for the explicit assertion).
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

  // ---------------------------------------------------------------------
  // WAVE CR item 7 — Formulation (coded Formulation/Diagnosis)
  // ---------------------------------------------------------------------

  /**
   * Records the clinician's actual coded diagnosis. Audited `critical: true`
   * (docs/technical/06-security-and-rbac.md §5): if the audit write fails,
   * this action fails closed rather than silently succeeding without its
   * tamper-evident trail — appropriate for a diagnosis record.
   */
  async createFormulation(principal: AuthPrincipal, input: CreateFormulationInput): Promise<FormulationDto> {
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    if (input.basedOnHypothesisId) {
      const hypothesis = await this.prisma.diagnosisHypothesis.findFirst({
        where: { id: input.basedOnHypothesisId, tenantId: principal.tenantId, clientId: input.clientId },
      });
      if (!hypothesis) throw new NotFoundException('Referenced diagnosis hypothesis not found for this client');
    }

    const formulation = await this.prisma.formulation.create({
      data: {
        tenantId: principal.tenantId,
        clientId: input.clientId,
        authorId: principal.userId,
        icdCode: input.icdCode,
        dsmCode: input.dsmCode,
        description: input.description,
        status: input.status,
        basedOnHypothesisId: input.basedOnHypothesisId,
        specifiers: input.specifiers as any,
        onsetDate: input.onsetDate ? new Date(input.onsetDate) : undefined,
        resolvedDate: input.resolvedDate ? new Date(input.resolvedDate) : undefined,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'formulation.recorded',
      entityType: 'Formulation',
      entityId: formulation.id,
      after: { clientId: input.clientId, icdCode: input.icdCode, status: formulation.status },
      critical: true,
    });
    await this.bus.publish(FORMULATION_RECORDED, principal.tenantId, {
      formulationId: formulation.id,
      clientId: input.clientId,
    });

    return this.toFormulationDto(formulation);
  }

  /** Provisional -> confirmed / ruled_out (or any other status transition). Audited `critical: true`. */
  async updateFormulationStatus(
    principal: AuthPrincipal,
    formulationId: string,
    input: UpdateFormulationStatusInput,
  ): Promise<FormulationDto> {
    const existing = await this.prisma.formulation.findFirst({
      where: { id: formulationId, tenantId: principal.tenantId },
    });
    if (!existing) throw new NotFoundException('Formulation not found');

    const updated = await this.prisma.formulation.update({
      where: { id: formulationId },
      data: {
        status: input.status,
        resolvedDate: input.resolvedDate ? new Date(input.resolvedDate) : undefined,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'formulation.status_updated',
      entityType: 'Formulation',
      entityId: updated.id,
      after: { status: updated.status },
      critical: true,
    });
    await this.bus.publish(FORMULATION_STATUS_UPDATED, principal.tenantId, {
      formulationId: updated.id,
      status: updated.status,
    });

    return this.toFormulationDto(updated);
  }

  async listFormulationsForClient(principal: AuthPrincipal, clientId: string): Promise<FormulationDto[]> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    const formulations = await this.prisma.formulation.findMany({
      where: { tenantId: principal.tenantId, clientId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return formulations.map((f) => this.toFormulationDto(f));
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

  private toFormulationDto(f: FormulationRow): FormulationDto {
    return {
      id: f.id,
      clientId: f.clientId,
      authorId: f.authorId,
      icdCode: f.icdCode,
      dsmCode: f.dsmCode,
      description: f.description,
      status: f.status as FormulationDto['status'],
      basedOnHypothesisId: f.basedOnHypothesisId,
      specifiers: (f.specifiers as Record<string, unknown> | null) ?? null,
      onsetDate: f.onsetDate ? f.onsetDate.toISOString() : null,
      resolvedDate: f.resolvedDate ? f.resolvedDate.toISOString() : null,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    };
  }
}
