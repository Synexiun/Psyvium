const callsCreate = jest.fn();

jest.mock('twilio', () => {
  const fn: any = jest.fn().mockImplementation(() => ({ calls: { create: callsCreate }, messages: { create: jest.fn() } }));
  return fn;
});

import { ForbiddenException } from '@nestjs/common';
import { Role, type AuthPrincipal } from '@vpsy/contracts';
import { CommunicationsService } from './communications.service';
import { OfflineStubAdapter } from './adapters/offline-stub.adapter';

/**
 * Phase 3 DoD: the offline SMS stub transitions QUEUED → SENT → DELIVERED
 * and logs an `EngagementActivity`; the click-to-call stub produces a
 * `CallSession` with a duration. Both exercise the real `OfflineStubAdapter`
 * (deterministic, no network) behind the shared `TelephonyProvider`/
 * `SmsProvider` ports (`docs/technical/15-communications-and-telephony.md` §2).
 */
describe('CommunicationsService', () => {
  const psychologist: AuthPrincipal = {
    userId: 'user_psy_a',
    tenantId: 'tenant_demo',
    roles: [Role.PSYCHOLOGIST],
    permissions: ['comms:read', 'comms:write'],
  };
  const clientPrincipal: AuthPrincipal = {
    userId: 'user_client',
    tenantId: 'tenant_demo',
    roles: [Role.CLIENT],
    permissions: ['comms:read', 'comms:write'],
  };

  // Quiet hours default 21:00–08:00 UTC — disable so tests don't flake at night.
  const prevQuietDisabled = process.env.VPSY_SMS_QUIET_HOURS_DISABLED;
  beforeAll(() => {
    process.env.VPSY_SMS_QUIET_HOURS_DISABLED = 'true';
  });
  afterAll(() => {
    if (prevQuietDisabled === undefined) delete process.env.VPSY_SMS_QUIET_HOURS_DISABLED;
    else process.env.VPSY_SMS_QUIET_HOURS_DISABLED = prevQuietDisabled;
  });

  function makeService() {
    const smsStatuses: string[] = [];

    const smsRow = {
      id: 'sms_1',
      tenantId: 'tenant_demo',
      direction: 'OUTBOUND',
      toE164: '+15551230099',
      fromE164: '+15551110000',
      body: 'Your session is tomorrow at 3pm.',
      status: 'QUEUED',
      clientId: 'client_1',
      createdAt: new Date('2026-07-05T09:00:00Z'),
    };

    const callRow = {
      id: 'call_1',
      tenantId: 'tenant_demo',
      direction: 'OUTBOUND',
      fromE164: '+15551110000',
      toE164: '+15551230099',
      clientId: 'client_1',
      purpose: 'care',
      startedAt: new Date('2026-07-05T09:00:00Z'),
      endedAt: null as Date | null,
      durationSec: null as number | null,
      status: 'RINGING',
    };

    const prisma = {
      phoneNumber: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'phone_1',
          tenantId: 'tenant_demo',
          e164: '+15551110000',
          provider: 'self_hosted',
          capabilities: ['VOICE', 'SMS'],
        }),
      },
      smsMessage: {
        create: jest.fn().mockImplementation(({ data }) => {
          Object.assign(smsRow, data);
          smsStatuses.push(smsRow.status);
          return Promise.resolve({ ...smsRow });
        }),
        update: jest.fn().mockImplementation(({ data }) => {
          Object.assign(smsRow, data);
          smsStatuses.push(smsRow.status);
          return Promise.resolve({ ...smsRow });
        }),
      },
      callSession: {
        create: jest.fn().mockImplementation(({ data }) => {
          Object.assign(callRow, data);
          return Promise.resolve({ ...callRow });
        }),
      },
      engagementActivity: { create: jest.fn().mockResolvedValue({}) },
      mediaMessage: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      smsOptOut: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      smsTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'tpl_1',
          tenantId: 'tenant_demo',
          key: 'appt_reminder',
          body: 'Hi {name}, your session is on {date}.',
          locale: 'en',
          active: true,
        }),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
      },
      client: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const bus = { publish: jest.fn().mockResolvedValue(undefined) };
    const stub = new OfflineStubAdapter();

    const cipher = {
      encryptString: jest.fn(async (v: string) => v),
      decryptString: jest.fn(async (v: string) => v),
      isActive: false,
    };
    const service = new CommunicationsService(prisma as any, audit as any, bus as any, stub, cipher as any);
    return { service, prisma, audit, bus, smsStatuses };
  }

  it('offline SMS stub transitions QUEUED → SENT → DELIVERED and logs an EngagementActivity', async () => {
    const { service, prisma, audit, bus, smsStatuses } = makeService();

    const result = await service.sendSms(psychologist, {
      toE164: '+15551230099',
      body: 'Your session is tomorrow at 3pm.',
      clientId: 'client_1',
    });

    expect(smsStatuses).toEqual(['QUEUED', 'SENT', 'DELIVERED']);
    expect(result.status).toBe('DELIVERED');
    expect(prisma.engagementActivity.create).toHaveBeenCalledTimes(1);
    expect(prisma.engagementActivity.create.mock.calls[0][0].data).toMatchObject({ kind: 'SMS', direction: 'OUTBOUND' });
    expect(audit.record).toHaveBeenCalled();
    expect(bus.publish).toHaveBeenCalledWith('sms.delivered', 'tenant_demo', expect.objectContaining({ smsId: 'sms_1' }));
  });

  it('sendSmsByTemplate interpolates placeholders and stamps templateId', async () => {
    const { service, prisma } = makeService();

    const result = await service.sendSmsByTemplate(psychologist, {
      toE164: '+15551230099',
      templateKey: 'appt_reminder',
      locale: 'en',
      vars: { name: 'Alex', date: 'Tuesday 3pm' },
      clientId: 'client_1',
    });

    expect(result.status).toBe('DELIVERED');
    expect(prisma.smsMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: 'Hi Alex, your session is on Tuesday 3pm.',
          templateId: 'tpl_1',
        }),
      }),
    );
  });

  it('click-to-call stub produces a CallSession with a duration', async () => {
    const { service, prisma, bus } = makeService();

    const result = await service.clickToCall(psychologist, { toE164: '+15551230099', clientId: 'client_1', purpose: 'care' });

    expect(result.status).toBe('COMPLETED');
    expect(result.durationSec).toBeGreaterThan(0);
    expect(prisma.callSession.create).toHaveBeenCalledTimes(1);
    const createData = prisma.callSession.create.mock.calls[0][0].data;
    expect(createData.durationSec).toBeGreaterThan(0);
    expect(createData.status).toBe('COMPLETED');
    expect(bus.publish).toHaveBeenCalledWith('call.completed', 'tenant_demo', expect.objectContaining({ callId: 'call_1' }));
  });

  it('rejects click-to-call from a CLIENT principal (ABAC-in-service)', async () => {
    const { service } = makeService();
    await expect(
      service.clickToCall(clientPrincipal, { toE164: '+15551230099', purpose: 'care' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  /**
   * Wave E — real Twilio voice is activate-on-config: `CommunicationsService`
   * only selects the async `TwilioVoiceAdapter` (instead of the offline
   * stub) when TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + PUBLIC_API_URL are
   * ALL set (`twilio-voice.adapter.spec.ts` already covers `fromEnv()` in
   * isolation; here we cover the service wiring + persistence path it
   * drives). Unlike `makeService()` above (single fixed `callRow`), this
   * helper's `callSession` mock supports multiple rows keyed by id, plus
   * `update`/`findFirst`, because the async path creates a row, updates it
   * after `placeCall` resolves, and `applyVoiceStatusWebhook` later looks it
   * up and updates it again from the status-callback webhook.
   */
  function makeAsyncVoiceService() {
    process.env.TWILIO_ACCOUNT_SID = 'ACxxx';
    process.env.TWILIO_AUTH_TOKEN = 'authtoken';
    process.env.PUBLIC_API_URL = 'https://api.example.com';

    const rows: Record<string, any> = {};
    let seq = 1;

    const prisma = {
      phoneNumber: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'phone_1',
          tenantId: 'tenant_demo',
          e164: '+15551110000',
          provider: 'twilio',
          capabilities: ['VOICE', 'SMS'],
        }),
      },
      callSession: {
        create: jest.fn().mockImplementation(({ data }) => {
          const id = `call_${seq++}`;
          const row = { id, endedAt: null, durationSec: null, providerRef: null, clientId: null, ...data };
          rows[id] = row;
          return Promise.resolve({ ...row });
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const row = rows[where.id];
          Object.assign(row, data);
          return Promise.resolve({ ...row });
        }),
        findFirst: jest.fn().mockImplementation(({ where }) => {
          const row = Object.values(rows).find((r: any) => r.id === where.id && r.tenantId === where.tenantId);
          return Promise.resolve(row ? { ...row } : null);
        }),
      },
      engagementActivity: { create: jest.fn().mockResolvedValue({}) },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const bus = { publish: jest.fn().mockResolvedValue(undefined) };
    const stub = new OfflineStubAdapter();

    const cipher = {
      encryptString: jest.fn(async (v: string) => v),
      decryptString: jest.fn(async (v: string) => v),
      isActive: false,
    };
    const service = new CommunicationsService(prisma as any, audit as any, bus as any, stub, cipher as any);
    return { service, prisma, audit, bus, rows };
  }

  describe('Wave E — real Twilio voice (async, activate-on-config)', () => {
    const originalSid = process.env.TWILIO_ACCOUNT_SID;
    const originalToken = process.env.TWILIO_AUTH_TOKEN;
    const originalPublicUrl = process.env.PUBLIC_API_URL;

    afterEach(() => {
      jest.clearAllMocks();
      if (originalSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
      else process.env.TWILIO_ACCOUNT_SID = originalSid;
      if (originalToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
      else process.env.TWILIO_AUTH_TOKEN = originalToken;
      if (originalPublicUrl === undefined) delete process.env.PUBLIC_API_URL;
      else process.env.PUBLIC_API_URL = originalPublicUrl;
    });

    it('persists CallSession as RINGING with providerRef set (not a fabricated COMPLETED+45s) when all 3 envs select the async adapter', async () => {
      callsCreate.mockResolvedValue({ sid: 'CA999', status: 'queued' });
      const { service, prisma, audit, bus } = makeAsyncVoiceService();

      const result = await service.clickToCall(psychologist, {
        toE164: '+15551230099',
        clientId: 'client_1',
        purpose: 'care',
      });

      expect(result.status).toBe('RINGING');
      expect(result.durationSec).toBeUndefined();
      expect(result.endedAt).toBeUndefined();

      expect(prisma.callSession.create).toHaveBeenCalledTimes(1);
      const createData = prisma.callSession.create.mock.calls[0][0].data;
      expect(createData.status).toBe('RINGING');
      expect(createData.durationSec).toBeUndefined();

      expect(prisma.callSession.update).toHaveBeenCalledTimes(1);
      const updateData = prisma.callSession.update.mock.calls[0][0].data;
      expect(updateData.providerRef).toBe('CA999');
      expect(updateData.status).toBe('RINGING');

      expect(callsCreate).toHaveBeenCalledTimes(1);
      const callArgs = callsCreate.mock.calls[0][0];
      expect(callArgs.statusCallback).toContain('tenantId=tenant_demo');
      expect(callArgs.statusCallback).toContain(`callSessionId=${result.id}`);

      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'comms.call.initiated' }));
      // No terminal event yet — the async path never fabricates a completed
      // outcome; that only happens later, driven by the webhook.
      expect(prisma.engagementActivity.create).not.toHaveBeenCalled();
      expect(bus.publish).not.toHaveBeenCalled();
    });

    it('closes the CallSession out as FAILED immediately when Twilio synchronously fails to originate the call', async () => {
      callsCreate.mockRejectedValue({ code: 21211, message: "Invalid 'To' Phone Number" });
      const { service, prisma, bus } = makeAsyncVoiceService();

      const result = await service.clickToCall(psychologist, { toE164: 'not-a-number', purpose: 'care' });

      expect(result.status).toBe('FAILED');
      expect(result.durationSec).toBe(0);
      expect(prisma.engagementActivity.create).toHaveBeenCalledTimes(1);
      expect(bus.publish).toHaveBeenCalledWith(
        'call.completed',
        'tenant_demo',
        expect.objectContaining({ status: 'FAILED', durationSec: 0 }),
      );
    });
  });

  describe('CommunicationsService.applyVoiceStatusWebhook', () => {
    const originalSid = process.env.TWILIO_ACCOUNT_SID;
    const originalToken = process.env.TWILIO_AUTH_TOKEN;
    const originalPublicUrl = process.env.PUBLIC_API_URL;

    afterEach(() => {
      jest.clearAllMocks();
      if (originalSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
      else process.env.TWILIO_ACCOUNT_SID = originalSid;
      if (originalToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
      else process.env.TWILIO_AUTH_TOKEN = originalToken;
      if (originalPublicUrl === undefined) delete process.env.PUBLIC_API_URL;
      else process.env.PUBLIC_API_URL = originalPublicUrl;
    });

    it('drives a RINGING CallSession to COMPLETED, sets durationSec/endedAt, writes an EngagementActivity, publishes CallCompleted, and audits', async () => {
      const { service, prisma, audit, bus, rows } = makeAsyncVoiceService();
      rows['call_seed'] = {
        id: 'call_seed',
        tenantId: 'tenant_demo',
        direction: 'OUTBOUND',
        fromE164: '+15551110000',
        toE164: '+15551230099',
        clientId: 'client_1',
        purpose: 'care',
        status: 'RINGING',
        startedAt: new Date('2026-07-05T09:00:00Z'),
        endedAt: null,
        durationSec: null,
        providerRef: 'CA123',
      };

      await service.applyVoiceStatusWebhook('tenant_demo', 'call_seed', 'CA123', 'completed', 42);

      expect(prisma.callSession.update).toHaveBeenCalledWith({
        where: { id: 'call_seed' },
        data: { status: 'COMPLETED', providerRef: 'CA123', durationSec: 42, endedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'comms.call.completed' }));
      expect(prisma.engagementActivity.create).toHaveBeenCalledTimes(1);
      expect(bus.publish).toHaveBeenCalledWith(
        'call.completed',
        'tenant_demo',
        expect.objectContaining({ callId: 'call_seed', durationSec: 42, status: 'COMPLETED' }),
      );
    });

    it('is idempotent: a duplicate delivery to an already-terminal CallSession is a no-op', async () => {
      const { service, prisma, audit, bus, rows } = makeAsyncVoiceService();
      rows['call_seed2'] = {
        id: 'call_seed2',
        tenantId: 'tenant_demo',
        direction: 'OUTBOUND',
        fromE164: '+1',
        toE164: '+1',
        clientId: null,
        status: 'COMPLETED',
        startedAt: new Date(),
        endedAt: new Date(),
        durationSec: 42,
        providerRef: 'CA1',
      };

      await service.applyVoiceStatusWebhook('tenant_demo', 'call_seed2', 'CA1', 'completed', 42);

      expect(prisma.callSession.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(bus.publish).not.toHaveBeenCalled();
    });

    it('refuses to update when the CallSid conflicts with the providerRef already on the CallSession (stale/foreign callSessionId defense)', async () => {
      const { service, prisma, rows } = makeAsyncVoiceService();
      rows['call_seed3'] = {
        id: 'call_seed3',
        tenantId: 'tenant_demo',
        direction: 'OUTBOUND',
        fromE164: '+1',
        toE164: '+1',
        clientId: null,
        status: 'RINGING',
        startedAt: new Date(),
        endedAt: null,
        durationSec: null,
        providerRef: 'CA_REAL',
      };

      await service.applyVoiceStatusWebhook('tenant_demo', 'call_seed3', 'CA_FOREIGN', 'completed', 42);

      expect(prisma.callSession.update).not.toHaveBeenCalled();
    });

    it('ignores an unrecognized Twilio CallStatus value without touching the CallSession', async () => {
      const { service, prisma, rows } = makeAsyncVoiceService();
      rows['call_seed4'] = {
        id: 'call_seed4',
        tenantId: 'tenant_demo',
        direction: 'OUTBOUND',
        fromE164: '+1',
        toE164: '+1',
        clientId: null,
        status: 'RINGING',
        startedAt: new Date(),
        endedAt: null,
        durationSec: null,
        providerRef: 'CA1',
      };

      await service.applyVoiceStatusWebhook('tenant_demo', 'call_seed4', 'CA1', 'some-unknown-status', undefined);

      expect(prisma.callSession.update).not.toHaveBeenCalled();
    });
  });
});
