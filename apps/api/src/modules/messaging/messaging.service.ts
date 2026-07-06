import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AssignmentStatus,
  Role,
  type AuthPrincipal,
  type CreateThreadInput,
  type ListMessagesQuery,
  type MessageDto,
  type PaginatedMessagesDto,
  type SendMessageInput,
  type ThreadDto,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';

type ThreadRow = {
  id: string;
  tenantId: string;
  clientId: string;
  subject: string | null;
  createdAt: Date;
};

type MessageRow = {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  readAt: Date | null;
  createdAt: Date;
};

type ClientRow = { id: string; userId: string; tenantId: string };
type PsychologistRow = { id: string; userId: string; tenantId: string };

/** ACTIVE per the codebase-wide convention (`scheduling.service.ts`, `clients.service.ts`, `clinicians.service.ts`): an Assignment counts once a manager has APPROVED it, through ACTIVE — never PROPOSED, TRANSFERRED, or CLOSED. */
const LINKED_ASSIGNMENT_STATUSES = [AssignmentStatus.APPROVED, AssignmentStatus.ACTIVE];

/**
 * Messaging (context 14, `docs/technical/13-roadmap-and-phases.md`,
 * `docs/technical/15-communications-and-telephony.md` §6). Secure, in-
 * platform TEXT threads between a client and their currently assigned
 * psychologist over the `Thread`/`Message` models that `MediaMessage` has
 * used opaquely (by `threadId` string) since Phase 3.
 *
 * Design note — `Thread` has no `psychologistId` column of its own
 * (`02-data-model.md` §I: only `clientId`). Rather than freezing the
 * counterpart at creation time, every read resolves the "current" clinician
 * live from the client's APPROVED/ACTIVE `Assignment` — so a thread survives
 * (and correctly re-points after) a clinician transfer, at the cost of an
 * extra query per thread. This is a deliberate reuse of the existing
 * Assignment-derived-identity pattern (`scheduling.service.ts`
 * `bookAppointment`), not a new concept.
 *
 * Supporting, not clinical-decision: Messaging transports text, it never
 * diagnoses or triages (same posture as Communications Hub, context 30).
 * There is deliberately NO PHI-scrubbing here — this in-platform channel IS
 * the clinical communication, which is the point: sensitive content never
 * has to leave the platform. Every send/read is participant-gated ABAC (a
 * stranger 403s even if they hold `comms:write`) and every send both writes
 * an `EngagementActivity` + audit record and publishes a PHI-minimized
 * real-time event (ids/refs only, never the message body).
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  // ── Threads ──

  /**
   * Creates (or finds the existing) thread between the caller and their
   * counterpart, gated on a live APPROVED/ACTIVE `Assignment` linking them —
   * there is no path to open a thread with a stranger. A CLIENT resolves
   * their own client record + current assignment; a PSYCHOLOGIST/MANAGER
   * must name `clientId` (a psychologist may have many clients).
   */
  async createOrFindThread(principal: AuthPrincipal, input: CreateThreadInput): Promise<ThreadDto> {
    const tenantId = principal.tenantId;
    const isClient = principal.roles.includes(Role.CLIENT);
    const isPsychologist = principal.roles.includes(Role.PSYCHOLOGIST);

    let client: ClientRow | null;
    if (isClient) {
      client = await this.prisma.client.findFirst({ where: { userId: principal.userId, tenantId } });
      if (!client) throw new NotFoundException('Client profile not found');
      if (input.clientId && input.clientId !== client.id) {
        throw new ForbiddenException('A client may only open a thread for themselves');
      }
    } else {
      if (!input.clientId) throw new ForbiddenException('clientId is required to open a thread on behalf of a client');
      client = await this.prisma.client.findFirst({ where: { id: input.clientId, tenantId } });
      if (!client) throw new NotFoundException('Client not found');
    }

    const assignmentWhere: Record<string, unknown> = {
      clientId: client.id,
      tenantId,
      status: { in: LINKED_ASSIGNMENT_STATUSES },
    };
    if (isPsychologist) {
      const psychologist = await this.prisma.psychologist.findFirst({ where: { userId: principal.userId, tenantId } });
      if (!psychologist) throw new NotFoundException('Psychologist profile not found');
      assignmentWhere.psychologistId = psychologist.id;
    } else if (input.psychologistId) {
      assignmentWhere.psychologistId = input.psychologistId;
    }

    const assignment = await this.prisma.assignment.findFirst({
      where: assignmentWhere,
      orderBy: { updatedAt: 'desc' },
    });
    if (!assignment?.psychologistId) {
      throw new ForbiddenException('No active assignment links this client and psychologist — cannot open a thread with a stranger');
    }

    let thread = (await this.prisma.thread.findFirst({
      where: { tenantId, clientId: client.id, deletedAt: null },
    })) as ThreadRow | null;

    if (!thread) {
      thread = (await this.prisma.thread.create({ data: { tenantId, clientId: client.id } })) as ThreadRow;
      await this.audit.record({
        tenantId,
        actorId: principal.userId,
        action: 'messaging.thread.created',
        entityType: 'Thread',
        entityId: thread.id,
        after: { clientId: thread.clientId },
      });
    }

    return this.toThreadDto(thread, assignment.psychologistId, null, 0);
  }

  /**
   * Threads belonging to the caller: a CLIENT's own thread, or a
   * PSYCHOLOGIST's threads with each currently-assigned client. Any other
   * `comms:read` holder (MANAGER etc.) has no personal thread — participant
   * ABAC, not blanket oversight, governs this context (unlike the unified
   * comms log in Communications Hub).
   */
  async listMyThreads(principal: AuthPrincipal): Promise<ThreadDto[]> {
    const tenantId = principal.tenantId;

    let clientIds: string[] = [];
    let psychologistIdByClient = new Map<string, string>();

    if (principal.roles.includes(Role.CLIENT)) {
      const client = await this.prisma.client.findFirst({ where: { userId: principal.userId, tenantId } });
      if (!client) return [];
      const assignment = await this.prisma.assignment.findFirst({
        where: { clientId: client.id, tenantId, status: { in: LINKED_ASSIGNMENT_STATUSES } },
        orderBy: { updatedAt: 'desc' },
      });
      if (!assignment?.psychologistId) return [];
      clientIds = [client.id];
      psychologistIdByClient.set(client.id, assignment.psychologistId);
    } else if (principal.roles.includes(Role.PSYCHOLOGIST)) {
      const psychologist = await this.prisma.psychologist.findFirst({ where: { userId: principal.userId, tenantId } });
      if (!psychologist) return [];
      const assignments = await this.prisma.assignment.findMany({
        where: { psychologistId: psychologist.id, tenantId, status: { in: LINKED_ASSIGNMENT_STATUSES } },
      });
      for (const a of assignments as Array<{ clientId: string; psychologistId: string | null }>) {
        if (a.psychologistId) psychologistIdByClient.set(a.clientId, a.psychologistId);
      }
      clientIds = [...psychologistIdByClient.keys()];
    } else {
      return [];
    }

    if (clientIds.length === 0) return [];

    const threads = (await this.prisma.thread.findMany({
      where: { tenantId, clientId: { in: clientIds }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })) as ThreadRow[];

    return Promise.all(
      threads.map(async (thread) => {
        const psychologistId = psychologistIdByClient.get(thread.clientId)!;
        const [lastMessage, unreadCount] = await Promise.all([
          this.prisma.message.findFirst({
            where: { threadId: thread.id, deletedAt: null },
            orderBy: { createdAt: 'desc' },
          }),
          this.prisma.message.count({
            where: { threadId: thread.id, deletedAt: null, readAt: null, senderId: { not: principal.userId } },
          }),
        ]);
        return this.toThreadDto(thread, psychologistId, lastMessage as MessageRow | null, unreadCount);
      }),
    );
  }

  // ── Messages ──

  /**
   * Sends a text message. Participants only — resolved fresh from the
   * thread's client + its current APPROVED/ACTIVE assignment, so a
   * transferred-away clinician loses send access the moment the assignment
   * changes. No PHI scrubbing: the body is stored and delivered verbatim.
   */
  async sendMessage(principal: AuthPrincipal, threadId: string, input: SendMessageInput): Promise<MessageDto> {
    const { thread } = await this.resolveParticipantThread(principal, threadId);

    const message = (await this.prisma.message.create({
      data: { threadId: thread.id, senderId: principal.userId, body: input.body },
    })) as MessageRow;

    await this.prisma.engagementActivity.create({
      data: {
        tenantId: principal.tenantId,
        subjectType: 'Client',
        subjectId: thread.clientId,
        // GAP (flagged, not fixed — schema is out of scope this pass):
        // `EngagementKind` (schema.prisma) has no dedicated value for an
        // in-platform text message (only CALL|SMS|EMAIL|MEDIA_MESSAGE|NOTE|
        // MEETING). EMAIL is the nearest existing analog — async, written,
        // non-phone correspondence — until the enum grows a MESSAGE value.
        kind: 'EMAIL',
        direction: 'OUTBOUND',
        summary: `Message: ${input.body.slice(0, 80)}`,
        actorId: principal.userId,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'messaging.message.sent',
      entityType: 'Message',
      entityId: message.id,
      after: { threadId: message.threadId },
    });

    await this.bus.publish(Events.MessageSent, principal.tenantId, {
      messageId: message.id,
      threadId: message.threadId,
      senderId: message.senderId,
    });

    return this.toMessageDto(message);
  }

  /** Paginated (cursor = last-seen message id, oldest-first cursor over `createdAt` desc). Participants only. */
  async listMessages(
    principal: AuthPrincipal,
    threadId: string,
    query: ListMessagesQuery,
  ): Promise<PaginatedMessagesDto> {
    await this.resolveParticipantThread(principal, threadId);

    const rows = (await this.prisma.message.findMany({
      where: { threadId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })) as MessageRow[];

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      messages: page.map((m) => this.toMessageDto(m)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /** Marks a message read. Only the thread participant who is NOT the sender may mark it read (mirrors `markMediaMessageRead`'s idempotent, one-way `readAt`). */
  async markMessageRead(principal: AuthPrincipal, messageId: string): Promise<MessageDto> {
    const tenantId = principal.tenantId;
    const existing = (await this.prisma.message.findFirst({ where: { id: messageId } })) as MessageRow | null;
    if (!existing) throw new NotFoundException('Message not found');

    const { thread } = await this.resolveParticipantThread(principal, existing.threadId);
    if (thread.tenantId !== tenantId) throw new NotFoundException('Message not found');

    if (existing.senderId === principal.userId) {
      throw new ForbiddenException('A sender cannot mark their own message read');
    }

    const message = existing.readAt
      ? existing
      : ((await this.prisma.message.update({ where: { id: messageId }, data: { readAt: new Date() } })) as MessageRow);

    if (!existing.readAt) {
      await this.audit.record({
        tenantId,
        actorId: principal.userId,
        action: 'messaging.message.read',
        entityType: 'Message',
        entityId: messageId,
      });
    }

    return this.toMessageDto(message);
  }

  // ── ABAC ──

  /**
   * Resolves the thread + verifies the caller is a participant (the client
   * on `Thread.clientId`, or the psychologist on that client's current
   * APPROVED/ACTIVE assignment). Anyone else — including a MANAGER who only
   * holds `comms:write` but is neither party — 403s. This is the single
   * choke point every send/read/mark-read path goes through.
   */
  private async resolveParticipantThread(
    principal: AuthPrincipal,
    threadId: string,
  ): Promise<{ thread: ThreadRow; client: ClientRow; psychologist: PsychologistRow | null }> {
    const tenantId = principal.tenantId;
    const thread = (await this.prisma.thread.findFirst({
      where: { id: threadId, tenantId, deletedAt: null },
    })) as ThreadRow | null;
    if (!thread) throw new NotFoundException('Thread not found');

    const client = (await this.prisma.client.findFirst({
      where: { id: thread.clientId, tenantId },
    })) as ClientRow | null;
    if (!client) throw new NotFoundException('Thread not found');

    const assignment = await this.prisma.assignment.findFirst({
      where: { clientId: thread.clientId, tenantId, status: { in: LINKED_ASSIGNMENT_STATUSES } },
      orderBy: { updatedAt: 'desc' },
    });
    const psychologist = assignment?.psychologistId
      ? ((await this.prisma.psychologist.findFirst({
          where: { id: assignment.psychologistId, tenantId },
        })) as PsychologistRow | null)
      : null;

    const isClientParticipant = principal.roles.includes(Role.CLIENT) && client.userId === principal.userId;
    const isPsychologistParticipant =
      principal.roles.includes(Role.PSYCHOLOGIST) && psychologist?.userId === principal.userId;

    if (!isClientParticipant && !isPsychologistParticipant) {
      throw new ForbiddenException("Only this thread's client and currently assigned psychologist may access it");
    }

    return { thread, client, psychologist };
  }

  // ── Mappers ──

  private toThreadDto(
    thread: ThreadRow,
    psychologistId: string,
    lastMessage: MessageRow | null,
    unreadCount: number,
  ): ThreadDto {
    return {
      id: thread.id,
      clientId: thread.clientId,
      psychologistId,
      subject: thread.subject ?? undefined,
      createdAt: thread.createdAt.toISOString(),
      lastMessage: lastMessage
        ? {
            id: lastMessage.id,
            senderId: lastMessage.senderId,
            body: lastMessage.body,
            createdAt: lastMessage.createdAt.toISOString(),
          }
        : undefined,
      unreadCount,
    };
  }

  private toMessageDto(message: MessageRow): MessageDto {
    return {
      id: message.id,
      threadId: message.threadId,
      senderId: message.senderId,
      body: message.body,
      readAt: message.readAt?.toISOString() ?? undefined,
      createdAt: message.createdAt.toISOString(),
    };
  }
}
