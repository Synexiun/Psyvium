import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, type AuthPrincipal } from '@vpsy/contracts';
import { MessagingService } from './messaging.service';

/**
 * Messaging (context 14) — secure client<->clinician text threads reusing
 * the Thread/Message models `MediaMessage` has used opaquely since Phase 3.
 * Core guarantee under test: a thread/message is only ever reachable by its
 * two participants (client + the client's CURRENT APPROVED/ACTIVE assigned
 * psychologist), resolved live every call — never by a caller-supplied id
 * alone.
 */

const client: AuthPrincipal = {
  userId: 'user_client_1',
  tenantId: 'tenant_demo',
  roles: [Role.CLIENT],
  permissions: ['comms:read', 'comms:write'],
};

const strangerClient: AuthPrincipal = {
  userId: 'user_client_2',
  tenantId: 'tenant_demo',
  roles: [Role.CLIENT],
  permissions: ['comms:read', 'comms:write'],
};

const psychologist: AuthPrincipal = {
  userId: 'user_psy_a',
  tenantId: 'tenant_demo',
  roles: [Role.PSYCHOLOGIST],
  permissions: ['comms:read', 'comms:write'],
};

const strangerPsychologist: AuthPrincipal = {
  userId: 'user_psy_b',
  tenantId: 'tenant_demo',
  roles: [Role.PSYCHOLOGIST],
  permissions: ['comms:read', 'comms:write'],
};

function makeService() {
  const clientRow = { id: 'client_1', userId: 'user_client_1', tenantId: 'tenant_demo' };
  const strangerClientRow = { id: 'client_2', userId: 'user_client_2', tenantId: 'tenant_demo' };
  const psychologistRow = { id: 'psy_1', userId: 'user_psy_a', tenantId: 'tenant_demo' };
  const strangerPsychologistRow = { id: 'psy_2', userId: 'user_psy_b', tenantId: 'tenant_demo' };
  const assignmentRow = {
    id: 'assignment_1',
    clientId: 'client_1',
    psychologistId: 'psy_1',
    tenantId: 'tenant_demo',
    status: 'APPROVED',
  };
  const threadRow = {
    id: 'thread_1',
    tenantId: 'tenant_demo',
    clientId: 'client_1',
    subject: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
  };
  const messageRow = {
    id: 'msg_1',
    threadId: 'thread_1',
    senderId: 'user_client_1',
    body: 'Hi Dr. Rivera, quick question before our session.',
    readAt: null as Date | null,
    createdAt: new Date('2026-07-05T09:00:00Z'),
  };

  const prisma = {
    client: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.userId === clientRow.userId) return clientRow;
        if (where.userId === strangerClientRow.userId) return strangerClientRow;
        if (where.id === clientRow.id) return clientRow;
        if (where.id === strangerClientRow.id) return strangerClientRow;
        return null;
      }),
    },
    psychologist: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.userId === psychologistRow.userId) return psychologistRow;
        if (where.userId === strangerPsychologistRow.userId) return strangerPsychologistRow;
        if (where.id === psychologistRow.id) return psychologistRow;
        return null;
      }),
    },
    assignment: {
      // Only client_1<->psy_1 has a live APPROVED/ACTIVE assignment — every
      // other pairing (the stranger client, the stranger psychologist) has
      // none, which is exactly what should 403.
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.clientId === 'client_1' && (!where.psychologistId || where.psychologistId === 'psy_1')) {
          return assignmentRow;
        }
        return null;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        if (where.psychologistId === 'psy_1') return [assignmentRow];
        return [];
      }),
    },
    thread: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(threadRow),
    },
    message: {
      create: jest.fn().mockResolvedValue(messageRow),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn(),
    },
    engagementActivity: { create: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const svc = new MessagingService(prisma as any, audit as any, bus as any);
  return { svc, prisma, audit, bus, threadRow, messageRow, assignmentRow };
}

describe('MessagingService', () => {
  describe('createOrFindThread', () => {
    it('creates a thread when a live APPROVED/ACTIVE assignment links the client and psychologist', async () => {
      const { svc, prisma, audit, threadRow } = makeService();

      const result = await svc.createOrFindThread(client, {});

      expect(prisma.thread.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { tenantId: 'tenant_demo', clientId: 'client_1' } }),
      );
      expect(result.id).toBe(threadRow.id);
      expect(result.psychologistId).toBe('psy_1');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'messaging.thread.created' }));
    });

    it('finds (does not duplicate) an existing thread for the same client', async () => {
      const { svc, prisma, threadRow } = makeService();
      (prisma.thread.findFirst as jest.Mock).mockResolvedValue(threadRow);

      const result = await svc.createOrFindThread(client, {});

      expect(prisma.thread.create).not.toHaveBeenCalled();
      expect(result.id).toBe(threadRow.id);
    });

    it('403s a client with no live assignment (stranger — no clinician relationship to open a thread with)', async () => {
      const { svc } = makeService();

      await expect(svc.createOrFindThread(strangerClient, {})).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('403s a psychologist who is not assigned to the named client', async () => {
      const { svc } = makeService();

      await expect(svc.createOrFindThread(strangerPsychologist, { clientId: 'client_1' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('blocks a client from opening a thread on behalf of another client', async () => {
      const { svc } = makeService();

      await expect(svc.createOrFindThread(client, { clientId: 'client_2' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('sendMessage', () => {
    it('lets a participant (the client) send a message, logs EngagementActivity + audit, and publishes a body-free realtime event', async () => {
      const { svc, prisma, audit, bus, threadRow, messageRow } = makeService();
      (prisma.thread.findFirst as jest.Mock).mockResolvedValue(threadRow);

      const result = await svc.sendMessage(client, 'thread_1', { body: messageRow.body });

      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { threadId: 'thread_1', senderId: 'user_client_1', body: messageRow.body } }),
      );
      expect(prisma.engagementActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kind: 'EMAIL', subjectId: 'client_1' }) }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'messaging.message.sent' }));

      // PHI minimization on the wire: the published event payload must never
      // carry the message body, only ids/refs.
      expect(bus.publish).toHaveBeenCalledWith(
        'message.sent',
        'tenant_demo',
        { messageId: 'msg_1', threadId: 'thread_1', senderId: 'user_client_1' },
      );
      const publishedPayload = (bus.publish as jest.Mock).mock.calls[0][2];
      expect(publishedPayload).not.toHaveProperty('body');
      expect(result.body).toBe(messageRow.body);
    });

    it('lets the assigned psychologist (the other participant) send a message', async () => {
      const { svc, prisma, threadRow } = makeService();
      (prisma.thread.findFirst as jest.Mock).mockResolvedValue(threadRow);

      await expect(svc.sendMessage(psychologist, 'thread_1', { body: 'Sure, go ahead.' })).resolves.toBeDefined();
    });

    it('403s a non-participant (stranger psychologist, no assignment to this client)', async () => {
      const { svc, prisma, threadRow } = makeService();
      (prisma.thread.findFirst as jest.Mock).mockResolvedValue(threadRow);

      await expect(svc.sendMessage(strangerPsychologist, 'thread_1', { body: 'hello' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('404s when the thread does not exist in this tenant', async () => {
      const { svc, prisma } = makeService();
      (prisma.thread.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(svc.sendMessage(client, 'thread_missing', { body: 'hi' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listMessages', () => {
    it('403s a non-participant reading a thread', async () => {
      const { svc, prisma, threadRow } = makeService();
      (prisma.thread.findFirst as jest.Mock).mockResolvedValue(threadRow);

      await expect(svc.listMessages(strangerClient, 'thread_1', { limit: 50 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('paginates for a participant and returns a nextCursor only when a further page exists', async () => {
      const { svc, prisma, threadRow } = makeService();
      (prisma.thread.findFirst as jest.Mock).mockResolvedValue(threadRow);
      const rows = Array.from({ length: 3 }, (_, i) => ({
        id: `msg_${i}`,
        threadId: 'thread_1',
        senderId: 'user_client_1',
        body: `message ${i}`,
        readAt: null,
        createdAt: new Date(`2026-07-0${5 - i}T09:00:00Z`),
      }));
      (prisma.message.findMany as jest.Mock).mockResolvedValue(rows);

      const result = await svc.listMessages(client, 'thread_1', { limit: 2 });

      expect(result.messages).toHaveLength(2);
      expect(result.nextCursor).toBe('msg_1');
    });
  });

  describe('markMessageRead', () => {
    it('lets the recipient (non-sender participant) mark a message read and audits it', async () => {
      const { svc, prisma, audit, threadRow, messageRow } = makeService();
      (prisma.message.findFirst as jest.Mock).mockResolvedValue(messageRow);
      (prisma.thread.findFirst as jest.Mock).mockResolvedValue(threadRow);
      (prisma.message.update as jest.Mock).mockResolvedValue({ ...messageRow, readAt: new Date('2026-07-05T09:05:00Z') });

      const result = await svc.markMessageRead(psychologist, 'msg_1');

      expect(prisma.message.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'msg_1' } }),
      );
      expect(result.readAt).toBeDefined();
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'messaging.message.read' }));
    });

    it('blocks a sender from marking their own message read', async () => {
      const { svc, prisma, threadRow, messageRow } = makeService();
      (prisma.message.findFirst as jest.Mock).mockResolvedValue(messageRow);
      (prisma.thread.findFirst as jest.Mock).mockResolvedValue(threadRow);

      await expect(svc.markMessageRead(client, 'msg_1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('403s a non-participant trying to mark a message read', async () => {
      const { svc, prisma, threadRow, messageRow } = makeService();
      (prisma.message.findFirst as jest.Mock).mockResolvedValue(messageRow);
      (prisma.thread.findFirst as jest.Mock).mockResolvedValue(threadRow);

      await expect(svc.markMessageRead(strangerClient, 'msg_1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404s when the message does not exist', async () => {
      const { svc, prisma } = makeService();
      (prisma.message.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(svc.markMessageRead(client, 'msg_missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listMyThreads', () => {
    it("returns the client's own thread with a last-message preview and unread count", async () => {
      const { svc, prisma, threadRow, messageRow } = makeService();
      (prisma.thread.findMany as jest.Mock).mockResolvedValue([threadRow]);
      (prisma.message.findFirst as jest.Mock).mockResolvedValue(messageRow);
      (prisma.message.count as jest.Mock).mockResolvedValue(2);

      const result = await svc.listMyThreads(client);

      expect(result).toHaveLength(1);
      expect(result[0].psychologistId).toBe('psy_1');
      expect(result[0].lastMessage?.body).toBe(messageRow.body);
      expect(result[0].unreadCount).toBe(2);
    });

    it("returns the psychologist's threads across their currently assigned clients", async () => {
      const { svc, prisma, threadRow } = makeService();
      (prisma.thread.findMany as jest.Mock).mockResolvedValue([threadRow]);

      const result = await svc.listMyThreads(psychologist);

      expect(result).toHaveLength(1);
      expect(result[0].clientId).toBe('client_1');
    });

    it('returns no threads for a client with no live assignment', async () => {
      const { svc } = makeService();

      const result = await svc.listMyThreads(strangerClient);

      expect(result).toEqual([]);
    });
  });
});
