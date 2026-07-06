import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  questionnaireCutoffsSchema,
  type AdministerResponseInput,
  type AuthPrincipal,
  type QuestionnaireResponseDto,
  type SeverityBand,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { ScoringService } from './scoring.service';

/**
 * Psychometrics. Administering a response is a single transactional unit:
 * the response and its computed PsychometricScore are created together, so a
 * response can never exist unscored. Scoring itself is deterministic
 * (ScoringService) — the AI layer is not consulted for safety-relevant
 * severity banding.
 */
@Injectable()
export class PsychometricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: ScoringService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  async administer(principal: AuthPrincipal, input: AdministerResponseInput): Promise<QuestionnaireResponseDto> {
    const version = await this.prisma.questionnaireVersion.findUnique({
      where: { id: input.versionId },
    });
    if (!version || !version.published) {
      throw new NotFoundException('Published questionnaire version not found');
    }

    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    const cutoffsParsed = questionnaireCutoffsSchema.safeParse(version.cutoffs);
    if (!cutoffsParsed.success) {
      throw new BadRequestException('Questionnaire version has no valid scoring cutoffs configured');
    }

    const computed = this.scoring.score(input.answers, cutoffsParsed.data);

    const result = await this.prisma.$transaction(async (tx) => {
      const response = await tx.questionnaireResponse.create({
        data: {
          tenantId: principal.tenantId,
          versionId: input.versionId,
          clientId: input.clientId,
          answers: input.answers as any,
          responseTimeMs: input.responseTimeMs,
        },
      });
      const score = await tx.psychometricScore.create({
        data: {
          tenantId: principal.tenantId,
          responseId: response.id,
          rawScore: computed.rawScore,
          severityBand: computed.severityBand ?? null,
          interpretation: computed.interpretation,
        },
      });
      return { response, score };
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'assessment.scored',
      entityType: 'QuestionnaireResponse',
      entityId: result.response.id,
      after: { rawScore: computed.rawScore, severityBand: computed.severityBand },
    });
    await this.bus.publish(Events.AssessmentScored, principal.tenantId, {
      responseId: result.response.id,
      clientId: input.clientId,
      severityBand: computed.severityBand,
    });

    return this.toDto(result.response, result.score);
  }

  async getResponse(principal: AuthPrincipal, id: string): Promise<QuestionnaireResponseDto> {
    const response = await this.prisma.questionnaireResponse.findFirst({
      where: { id, tenantId: principal.tenantId },
      include: { score: true },
    });
    if (!response) throw new NotFoundException('Response not found');
    return this.toDto(response, response.score);
  }

  private toDto(
    response: {
      id: string;
      versionId: string;
      clientId: string;
      answers: unknown;
      completedAt: Date;
    },
    score: {
      id: string;
      responseId: string;
      rawScore: number | null;
      severityBand: SeverityBand | null;
      interpretation: string | null;
      createdAt: Date;
    } | null,
  ): QuestionnaireResponseDto {
    return {
      id: response.id,
      versionId: response.versionId,
      clientId: response.clientId,
      answers: response.answers as Record<string, number>,
      completedAt: response.completedAt.toISOString(),
      score: score
        ? {
            id: score.id,
            responseId: score.responseId,
            rawScore: score.rawScore,
            severityBand: score.severityBand,
            interpretation: score.interpretation,
            createdAt: score.createdAt.toISOString(),
          }
        : null,
    };
  }
}
