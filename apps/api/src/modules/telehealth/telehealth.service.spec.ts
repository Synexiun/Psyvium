const addGrant = jest.fn();
const toJwt = jest.fn().mockResolvedValue('signed.jwt.token');
const AccessTokenCtor = jest.fn().mockImplementation(() => ({ addGrant, toJwt }));

jest.mock('livekit-server-sdk', () => ({
  AccessToken: AccessTokenCtor,
}));

import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Role, type AuthPrincipal } from '@vpsy/contracts';
import { TelehealthService } from './telehealth.service';

/**
 * Telehealth (context 12) — core guarantees under test:
 *  - the TELEPSYCHOLOGY consent gate blocks session creation (doc §7);
 *  - a CLIENT's join lands them in WAITING_ROOM with no token, even with no
 *    LiveKit configured (doc §6 — authed but no media, never needs a real
 *    RTC call);
 *  - admitting the waiting client mints THEIR token on the admit response;
 *  - with LiveKit unconfigured, any join that WOULD need a token 503s
 *    honestly (VIDEO_NOT_CONFIGURED) rather than fabricating one;
 *  - participant ABAC (mirrors `MessagingService.resolveParticipantThread`)
 *    — a stranger 403s even on a simple read.
 */

const clientUser: AuthPrincipal = {
  userId: 'user_client_1',
  tenantId: 'tenant_demo',
  roles: [Role.CLIENT],
  permissions: ['scheduling:read'],
};

const strangerClientUser: AuthPrincipal = {
  userId: 'user_client_2',
  tenantId: 'tenant_demo',
  roles: [Role.CLIENT],
  permissions: ['scheduling:read'],
};

const psychologistUser: AuthPrincipal = {
  userId: 'user_psy_a',
  tenantId: 'tenant_demo',
  roles: [Role.PSYCHOLOGIST],
  permissions: ['scheduling:read', 'session:host'],
};

const appointmentRow = { id: 'appt_1', tenantId: 'tenant_demo', clientId: 'client_1', psychologistId: 'psy_1' };
const clientRow = { id: 'client_1', userId: 'user_client_1', tenantId: 'tenant_demo' };
const strangerClientRow = { id: 'client_2', userId: 'user_client_2', tenantId: 'tenant_demo' };
const psychologistRow = { id: 'psy_1', userId: 'user_psy_a', tenantId: 'tenant_demo' };
const consentRow = { id: 'consent_1', clientId: 'client_1', type: 'TELEPSYCHOLOGY', version: '1.0.0', revokedAt: null };

const baseTeleSessionRow = {
  id: 'tele_1',
  tenantId: 'tenant_demo',
  appointmentId: 'appt_1',
  clientId: 'client_1',
  psychologistId: 'psy_1',
  roomName: 'tele_appt_1_abcd1234',
  status: 'SCHEDULED',
  startedAt: null as Date | null,
  endedAt: null as Date | null,
  participantEvents: [] as unknown[],
  createdAt: new Date('2026-07-05T09:00:00Z'),
};

function makePrisma() {
  return {
    appointment: { findFirst: jest.fn().mockResolvedValue(appointmentRow) },
    client: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id === clientRow.id || where.userId === clientRow.userId) return clientRow;
        if (where.id === strangerClientRow.id || where.userId === strangerClientRow.userId) return strangerClientRow;
        return null;
      }),
    },
    psychologist: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id === psychologistRow.id || where.userId === psychologistRow.userId) return psychologistRow;
        return null;
      }),
    },
    consent: { findFirst: jest.fn().mockResolvedValue(consentRow) },
    teleSession: {
      findFirst: jest.fn().mockResolvedValue({ ...baseTeleSessionRow }),
      create: jest.fn().mockResolvedValue({ ...baseTeleSessionRow }),
      update: jest.fn(async ({ data }: any) => ({ ...baseTeleSessionRow, ...data })),
    },
  };
}

function setLiveKitEnv(configured: boolean) {
  if (configured) {
    process.env.LIVEKIT_API_KEY = 'key_123';
    process.env.LIVEKIT_API_SECRET = 'secret_123';
    process.env.LIVEKIT_URL = 'wss://demo.livekit.cloud';
  } else {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    delete process.env.LIVEKIT_URL;
  }
}

function makeService(liveKitConfigured: boolean, prisma = makePrisma()) {
  setLiveKitEnv(liveKitConfigured);
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const svc = new TelehealthService(prisma as any, audit as any, bus as any);
  return { svc, prisma, audit, bus };
}

describe('TelehealthService', () => {
  const originalKey = process.env.LIVEKIT_API_KEY;
  const originalSecret = process.env.LIVEKIT_API_SECRET;
  const originalUrl = process.env.LIVEKIT_URL;

  beforeEach(() => jest.clearAllMocks());

  afterAll(() => {
    if (originalKey === undefined) delete process.env.LIVEKIT_API_KEY;
    else process.env.LIVEKIT_API_KEY = originalKey;
    if (originalSecret === undefined) delete process.env.LIVEKIT_API_SECRET;
    else process.env.LIVEKIT_API_SECRET = originalSecret;
    if (originalUrl === undefined) delete process.env.LIVEKIT_URL;
    else process.env.LIVEKIT_URL = originalUrl;
  });

  describe('createSession', () => {
    it('blocks creation when the client has no current TELEPSYCHOLOGY consent (doc §7 pre-media gate)', async () => {
      const prisma = makePrisma();
      // No existing (non-terminal) TeleSession for this appointment yet, so
      // createSession must fall through to the consent gate rather than
      // short-circuiting on the idempotent-duplicate check.
      (prisma.teleSession.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.consent.findFirst as jest.Mock).mockResolvedValue(null);
      const { svc } = makeService(false, prisma);

      await expect(svc.createSession(clientUser, { appointmentId: 'appt_1' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.teleSession.create).not.toHaveBeenCalled();
    });

    it('creates a SCHEDULED TeleSession once consent is present', async () => {
      const prisma = makePrisma();
      // Same as above: no existing session for this appointment, so the
      // create path actually runs instead of returning the idempotent row.
      (prisma.teleSession.findFirst as jest.Mock).mockResolvedValue(null);
      const { svc, audit, bus } = makeService(false, prisma);

      const result = await svc.createSession(clientUser, { appointmentId: 'appt_1' });

      expect(prisma.teleSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ appointmentId: 'appt_1', clientId: 'client_1', psychologistId: 'psy_1', status: 'SCHEDULED' }),
        }),
      );
      expect(result.status).toBe('SCHEDULED');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'telehealth.session.created' }));
      expect(bus.publish).toHaveBeenCalledWith('telesession.created', 'tenant_demo', expect.any(Object));
    });

    it('403s a stranger (not the client or assigned psychologist on the appointment)', async () => {
      const { svc } = makeService(false);

      await expect(svc.createSession(strangerClientUser, { appointmentId: 'appt_1' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('joinSession', () => {
    it("CLIENT join lands in WAITING_ROOM with no token — even with LiveKit unconfigured (doc §6, no media needed yet)", async () => {
      const { svc, prisma } = makeService(false);

      const result = await svc.joinSession(clientUser, 'tele_1');

      expect(result.token).toBeNull();
      expect(result.session.status).toBe('WAITING_ROOM');
      expect(prisma.teleSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'WAITING_ROOM' }) }),
      );
    });

    it('unkeyed environment: PSYCHOLOGIST join needs a real token and 503s honestly (VIDEO_NOT_CONFIGURED), never a fabricated one', async () => {
      const { svc } = makeService(false);

      await expect(svc.joinSession(psychologistUser, 'tele_1')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(AccessTokenCtor).not.toHaveBeenCalled();
    });

    it('403s a non-participant reading/joining a session', async () => {
      const { svc } = makeService(false);

      await expect(svc.joinSession(strangerClientUser, 'tele_1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('admitClient', () => {
    it("PSYCHOLOGIST admit mints the CLIENT's token (mocked SDK) and flips the session to IN_PROGRESS", async () => {
      const prisma = makePrisma();
      (prisma.teleSession.findFirst as jest.Mock).mockResolvedValue({ ...baseTeleSessionRow, status: 'WAITING_ROOM' });
      const { svc, audit, bus } = makeService(true, prisma);

      const result = await svc.admitClient(psychologistUser, 'tele_1');

      expect(AccessTokenCtor).toHaveBeenCalledWith(
        'key_123',
        'secret_123',
        expect.objectContaining({ identity: 'user_client_1' }),
      );
      expect(addGrant).toHaveBeenCalledWith(
        expect.objectContaining({ roomJoin: true, room: 'tele_appt_1_abcd1234', canPublish: true, canSubscribe: true }),
      );
      expect(result.token?.token).toBe('signed.jwt.token');
      expect(result.session.status).toBe('IN_PROGRESS');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'telehealth.session.client_admitted' }));
      expect(bus.publish).toHaveBeenCalledWith('telesession.started', 'tenant_demo', expect.any(Object));
    });

    it('409s an admit attempt when no one is waiting (still SCHEDULED)', async () => {
      const prisma = makePrisma();
      (prisma.teleSession.findFirst as jest.Mock).mockResolvedValue({ ...baseTeleSessionRow, status: 'SCHEDULED' });
      const { svc } = makeService(true, prisma);

      await expect(svc.admitClient(psychologistUser, 'tele_1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('403s a CLIENT trying to admit (admit is psychologist-only)', async () => {
      const prisma = makePrisma();
      (prisma.teleSession.findFirst as jest.Mock).mockResolvedValue({ ...baseTeleSessionRow, status: 'WAITING_ROOM' });
      const { svc } = makeService(true, prisma);

      await expect(svc.admitClient(clientUser, 'tele_1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getSession', () => {
    it('403s a non-participant', async () => {
      const { svc } = makeService(false);

      await expect(svc.getSession(strangerClientUser, 'tele_1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns state for a participant', async () => {
      const { svc } = makeService(false);

      const result = await svc.getSession(clientUser, 'tele_1');

      expect(result.id).toBe('tele_1');
    });
  });

  describe('endSession', () => {
    it('either participant may end a live session', async () => {
      const prisma = makePrisma();
      (prisma.teleSession.findFirst as jest.Mock).mockResolvedValue({ ...baseTeleSessionRow, status: 'IN_PROGRESS' });
      const { svc, audit, bus } = makeService(false, prisma);

      const result = await svc.endSession(psychologistUser, 'tele_1');

      expect(result.status).toBe('ENDED');
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'telehealth.session.ended' }));
      expect(bus.publish).toHaveBeenCalledWith('telesession.ended', 'tenant_demo', expect.any(Object));
    });

    it('403s a non-participant trying to end a session', async () => {
      const { svc } = makeService(false);

      await expect(svc.endSession(strangerClientUser, 'tele_1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
