import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AuthPrincipal,
  CreateSessionNoteInput,
  SessionNoteAiAssistInput,
  SessionNoteAiAssistResult,
  SessionNoteDto,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { FieldCipherService } from '../../common/crypto/field-cipher';
import { ALGORITHM_VERSIONS, stampAlgorithm } from '../../common/clinical';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';

type NoteRow = {
  id: string;
  sessionId: string;
  content: unknown;
  continuitySummary: string | null;
  signedAt: Date | null;
  signedBy: string | null;
  version: number;
  createdAt: Date;
  planId: string | null;
  goalIds: string[];
  formulationId: string | null;
  riskStatusAtNote: string | null;
  sessionSnapshot: unknown;
  amendsVersionId: string | null;
  amendmentReason: string | null;
};

/**
 * Clinical Documentation. Session notes are append-only: `create` always adds
 * the next version for a session rather than mutating an existing row, and
 * `sign` is a one-way transition that makes that row immutable thereafter.
 *
 * WAVE CR item 8 — golden-thread enforcement (docs/10-10-PROGRAM.md): the CMS/
 * Medicaid audit standard that diagnosis -> plan -> note is traceable.
 * `create()` requires `planId` + >=1 valid `goalId` whenever the client has
 * an ACTIVE TreatmentPlan (400 with the valid goal list otherwise); when
 * there is no active plan, the note is still allowed but honestly flagged
 * `sessionSnapshot.goldenThread = 'no-active-plan'` rather than silently
 * looking complete. `sessionSnapshot`/`riskStatusAtNote` are populated from
 * the Session/Client rows AT CREATE TIME — a note-time snapshot, never
 * recomputed later.
 *
 * WAVE CR P1 — amendment semantics: once a session already has a prior
 * SIGNED note, any further note for that session is a post-signature
 * addendum and `amendmentReason` is required (400 otherwise) — no silent
 * addenda.
 *
 * WAVE D P0 — field-level PHI encryption (docs/technical/06-security-and-rbac.md
 * §7): `content` (the highest-value PHI field on this context) is encrypted
 * at rest via `FieldCipherService` whenever `VPSY_FIELD_KEY` is configured
 * (activate-on-config; plaintext behavior is byte-identical when it isn't).
 * Encryption/decryption happens ONLY in `create()` (write) and `toDto()`
 * (every read path — `create`, `listBySession`, `sign` all return through
 * it), so the controller/DTO layer is completely unaware ciphertext exists.
 */
@Injectable()
export class ClinicalDocumentationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    private readonly ai: AiGatewayService,
    private readonly cipher: FieldCipherService,
  ) {}

  async create(principal: AuthPrincipal, input: CreateSessionNoteInput): Promise<SessionNoteDto> {
    const session = await this.prisma.session.findFirst({
      where: { id: input.sessionId, tenantId: principal.tenantId },
      include: { appointment: { include: { client: true } } },
    });
    if (!session) throw new NotFoundException('Session not found');

    const latest = await this.prisma.sessionNote.findFirst({
      where: { tenantId: principal.tenantId, sessionId: input.sessionId },
      orderBy: { version: 'desc' },
    });

    // Amendment semantics (WAVE CR P1): once this session already has a
    // SIGNED note, any further note is a post-signature addendum — never a
    // silent one.
    const priorSigned = await this.prisma.sessionNote.findFirst({
      where: { tenantId: principal.tenantId, sessionId: input.sessionId, signedAt: { not: null } },
    });
    if (priorSigned && !input.amendmentReason) {
      throw new BadRequestException(
        'This session already has a signed note; amendmentReason is required to file a post-signature amendment.',
      );
    }

    const clientId = session.appointment.clientId;
    const activePlan = await this.prisma.treatmentPlan.findFirst({
      where: { tenantId: principal.tenantId, clientId, status: 'active' },
      include: { goals: true },
    });

    let planId: string | null | undefined = input.planId;
    let goalIds: string[] = input.goalIds ?? [];
    let goldenThreadFlag: string | undefined;

    if (activePlan) {
      const validGoalIds = activePlan.goals.map((g) => g.id);
      if (!planId || goalIds.length === 0) {
        throw new BadRequestException(
          `Golden-thread enforcement: client has an active treatment plan (${activePlan.id}) — the note must reference planId and at least one goalId. Valid goals: [${validGoalIds.join(', ')}]`,
        );
      }
      if (planId !== activePlan.id) {
        throw new BadRequestException(
          `planId must reference the client's active treatment plan (${activePlan.id}), not ${planId}.`,
        );
      }
      const validSet = new Set(validGoalIds);
      const invalidGoalIds = goalIds.filter((id) => !validSet.has(id));
      if (invalidGoalIds.length > 0) {
        throw new BadRequestException(
          `goalIds must belong to the active plan (${activePlan.id}). Invalid: [${invalidGoalIds.join(', ')}]. Valid goals: [${validGoalIds.join(', ')}]`,
        );
      }
    } else {
      // Honest, not silently green: no active plan exists to anchor to.
      planId = null;
      goalIds = [];
      goldenThreadFlag = 'no-active-plan';
    }

    if (input.formulationId) {
      const formulation = await this.prisma.formulation.findFirst({
        where: { id: input.formulationId, tenantId: principal.tenantId, clientId },
      });
      if (!formulation) throw new NotFoundException('Referenced formulation not found for this client');
    }

    const durationMin =
      session.startedAt && session.endedAt
        ? Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 60000)
        : null;
    const sessionSnapshot = {
      date: (session.startedAt ?? session.appointment.startsAt).toISOString(),
      durationMin,
      modality: session.modality,
      ...(goldenThreadFlag ? { goldenThread: goldenThreadFlag } : {}),
    };

    const encryptedContent = await this.cipher.encryptJson(input.content, principal.tenantId);

    const note = await this.prisma.sessionNote.create({
      data: {
        tenantId: principal.tenantId,
        sessionId: input.sessionId,
        content: encryptedContent as any,
        continuitySummary: input.continuitySummary,
        version: (latest?.version ?? 0) + 1,
        planId,
        goalIds,
        formulationId: input.formulationId,
        riskStatusAtNote: session.appointment.client.riskLevel,
        sessionSnapshot,
        amendsVersionId: input.amendsVersionId,
        amendmentReason: input.amendmentReason,
      },
    });

    const qualityChecklist =
      input.content && typeof input.content === 'object' && 'qualityChecklist' in input.content
        ? (input.content as { qualityChecklist?: Record<string, boolean | string> }).qualityChecklist
        : undefined;
    const checklistEntries = qualityChecklist ? Object.entries(qualityChecklist) : [];
    const checklistChecked = checklistEntries.filter(([, v]) => v === true || v === 'true').length;

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'note.created',
      entityType: 'SessionNote',
      entityId: note.id,
      after: {
        sessionId: input.sessionId,
        version: note.version,
        goldenThread: goldenThreadFlag ?? 'anchored',
        qualityChecklistPresent: checklistEntries.length > 0,
        qualityChecklistChecked: checklistChecked,
        qualityChecklistTotal: checklistEntries.length,
        algorithm: stampAlgorithm(
          'documentation.note_quality',
          ALGORITHM_VERSIONS.noteQuality,
          'Optional clinical note quality checklist (assistive documentation excellence; never blocks save).',
        ),
      },
      critical: true,
    });

    return this.toDto(note, principal.tenantId);
  }

  async listBySession(principal: AuthPrincipal, sessionId: string): Promise<SessionNoteDto[]> {
    const notes = await this.prisma.sessionNote.findMany({
      where: { tenantId: principal.tenantId, sessionId },
      orderBy: { version: 'desc' },
    });
    return Promise.all(notes.map((n) => this.toDto(n, principal.tenantId)));
  }

  async sign(principal: AuthPrincipal, noteId: string): Promise<SessionNoteDto> {
    const note = await this.prisma.sessionNote.findFirst({
      where: { id: noteId, tenantId: principal.tenantId },
    });
    if (!note) throw new NotFoundException('Note not found');
    if (note.signedAt) throw new BadRequestException('Note is already signed and immutable');

    const signed = await this.prisma.sessionNote.update({
      where: { id: noteId },
      data: { signedAt: new Date(), signedBy: principal.userId },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'note.signed',
      entityType: 'SessionNote',
      entityId: signed.id,
      after: { signedBy: principal.userId, version: signed.version },
      critical: true,
    });
    await this.bus.publish(Events.NoteSigned, principal.tenantId, {
      noteId: signed.id,
      sessionId: signed.sessionId,
      signedBy: principal.userId,
    });

    return this.toDto(signed, principal.tenantId);
  }

  /**
   * Session-Note Assistant (doc 05 §3.4). Sends the AI Gateway ONLY the
   * coded, de-identified signals in `input` (session type, theme codes,
   * risk-present flag, plan-goal ids) — never the session/note content or
   * any client identifier. Returns an assistive draft SCAFFOLD; it does not
   * create or mutate any SessionNote row.
   */
  async aiAssist(principal: AuthPrincipal, input: SessionNoteAiAssistInput): Promise<SessionNoteAiAssistResult> {
    const session = await this.prisma.session.findFirst({
      where: { id: input.sessionId, tenantId: principal.tenantId },
      include: { appointment: true },
    });
    if (!session) throw new NotFoundException('Session not found');

    return this.ai.summarizeSessionNote({
      tenantId: principal.tenantId,
      clientId: session.appointment.clientId,
      sessionId: input.sessionId,
      sessionType: input.sessionType,
      presentingThemeCodes: input.presentingThemeCodes,
      riskPresent: input.riskPresent,
      planGoalIds: input.planGoalIds,
    });
  }

  private async toDto(note: NoteRow, tenantId: string): Promise<SessionNoteDto> {
    const content = await this.cipher.decryptJson(note.content, tenantId);
    return {
      id: note.id,
      sessionId: note.sessionId,
      content: content as SessionNoteDto['content'],
      continuitySummary: note.continuitySummary,
      signedAt: note.signedAt ? note.signedAt.toISOString() : null,
      signedBy: note.signedBy,
      version: note.version,
      createdAt: note.createdAt.toISOString(),
      planId: note.planId,
      goalIds: note.goalIds,
      formulationId: note.formulationId,
      riskStatusAtNote: note.riskStatusAtNote,
      sessionSnapshot: (note.sessionSnapshot as Record<string, unknown> | null) ?? null,
      amendsVersionId: note.amendsVersionId,
      amendmentReason: note.amendmentReason,
    };
  }
}
