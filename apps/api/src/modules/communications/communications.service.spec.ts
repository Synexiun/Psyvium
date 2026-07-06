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
      client: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const bus = { publish: jest.fn().mockResolvedValue(undefined) };
    const stub = new OfflineStubAdapter();

    const service = new CommunicationsService(prisma as any, audit as any, bus as any, stub);
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
});
