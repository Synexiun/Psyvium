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
};

/**
 * Clinical Documentation. Session notes are append-only: `create` always adds
 * the next version for a session rather than mutating an existing row, and
 * `sign` is a one-way transition that makes that row immutable thereafter.
 */
@Injectable()
export class ClinicalDocumentationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    private readonly ai: AiGatewayService,
  ) {}

  async create(principal: AuthPrincipal, input: CreateSessionNoteInput): Promise<SessionNoteDto> {
    const session = await this.prisma.session.findFirst({
      where: { id: input.sessionId, tenantId: principal.tenantId },
    });
    if (!session) throw new NotFoundException('Session not found');

    const latest = await this.prisma.sessionNote.findFirst({
      where: { tenantId: principal.tenantId, sessionId: input.sessionId },
      orderBy: { version: 'desc' },
    });

    const note = await this.prisma.sessionNote.create({
      data: {
        tenantId: principal.tenantId,
        sessionId: input.sessionId,
        content: input.content as any,
        continuitySummary: input.continuitySummary,
        version: (latest?.version ?? 0) + 1,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'note.created',
      entityType: 'SessionNote',
      entityId: note.id,
      after: { sessionId: input.sessionId, version: note.version },
    });

    return this.toDto(note);
  }

  async listBySession(principal: AuthPrincipal, sessionId: string): Promise<SessionNoteDto[]> {
    const notes = await this.prisma.sessionNote.findMany({
      where: { tenantId: principal.tenantId, sessionId },
      orderBy: { version: 'desc' },
    });
    return notes.map((n) => this.toDto(n));
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
    });
    await this.bus.publish(Events.NoteSigned, principal.tenantId, {
      noteId: signed.id,
      sessionId: signed.sessionId,
      signedBy: principal.userId,
    });

    return this.toDto(signed);
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
    });
    if (!session) throw new NotFoundException('Session not found');

    return this.ai.summarizeSessionNote({
      tenantId: principal.tenantId,
      sessionId: input.sessionId,
      sessionType: input.sessionType,
      presentingThemeCodes: input.presentingThemeCodes,
      riskPresent: input.riskPresent,
      planGoalIds: input.planGoalIds,
    });
  }

  private toDto(note: NoteRow): SessionNoteDto {
    return {
      id: note.id,
      sessionId: note.sessionId,
      content: note.content as SessionNoteDto['content'],
      continuitySummary: note.continuitySummary,
      signedAt: note.signedAt ? note.signedAt.toISOString() : null,
      signedBy: note.signedBy,
      version: note.version,
      createdAt: note.createdAt.toISOString(),
    };
  }
}
