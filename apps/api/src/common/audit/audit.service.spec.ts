import { AuditService } from './audit.service';

describe('AuditService chain integrity', () => {
  function makeService(rows: Array<{ id: string; hash: string; prevHash: string | null }>) {
    const prisma = {
      auditEvent: {
        findMany: jest.fn().mockResolvedValue(
          // service queries newest-first
          [...rows].reverse().map((r) => ({
            ...r,
            tenantId: 'tenant_1',
            actorId: null,
            action: 'test',
            entityType: 'X',
            entityId: null,
            before: null,
            after: null,
            ip: null,
            userAgent: null,
            occurredAt: new Date('2026-07-13T00:00:00.000Z'),
          })),
        ),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) => fn(prisma)),
      $executeRaw: jest.fn(),
    };
    // transaction uses tx which needs $executeRaw and auditEvent
    const tx = {
      $executeRaw: jest.fn(),
      auditEvent: prisma.auditEvent,
    };
    prisma.$transaction = jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx));
    const bus = { publish: jest.fn().mockResolvedValue(undefined) };
    return { svc: new AuditService(prisma as any, bus as any), prisma, tx, bus };
  }

  it('verifyChain accepts a well-linked window', async () => {
    const { svc } = makeService([
      { id: 'a', hash: 'h1', prevHash: null },
      { id: 'b', hash: 'h2', prevHash: 'h1' },
      { id: 'c', hash: 'h3', prevHash: 'h2' },
    ]);
    const result = await svc.verifyChain('tenant_1', 50);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(3);
    expect(result.tipHash).toBe('h3');
  });

  it('verifyChain detects prevHash fork', async () => {
    const { svc } = makeService([
      { id: 'a', hash: 'h1', prevHash: null },
      { id: 'b', hash: 'h2', prevHash: 'WRONG' },
      { id: 'c', hash: 'h3', prevHash: 'h2' },
    ]);
    const result = await svc.verifyChain('tenant_1', 50);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe('b');
    expect(result.reason).toBe('prevHash_mismatch');
  });

  it('recordDailyAnchor writes critical anchor with tip and publishes SIEM events', async () => {
    const rows = [
      { id: 'a', hash: 'h1', prevHash: null },
      { id: 'b', hash: 'h2', prevHash: 'h1' },
    ];
    const { svc, tx, bus } = makeService(rows);
    tx.auditEvent.findFirst = jest.fn().mockResolvedValue({ hash: 'h2' });
    tx.auditEvent.create = jest.fn().mockResolvedValue({});

    const result = await svc.recordDailyAnchor('tenant_1');
    expect(result.ok).toBe(true);
    expect(result.tipHash).toBe('h2');
    expect(tx.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'audit.daily_anchor',
          entityType: 'AuditChain',
        }),
      }),
    );
    expect(bus.publish).toHaveBeenCalledWith(
      'audit.daily_anchor',
      'tenant_1',
      expect.objectContaining({ chainOk: true, tipHash: 'h2' }),
    );
  });

  it('recordDailyAnchor publishes audit.chain_broken when links fail', async () => {
    const rows = [
      { id: 'a', hash: 'h1', prevHash: null },
      { id: 'b', hash: 'h2', prevHash: 'WRONG' },
    ];
    const { svc, tx, bus } = makeService(rows);
    tx.auditEvent.findFirst = jest.fn().mockResolvedValue({ hash: 'h2' });
    tx.auditEvent.create = jest.fn().mockResolvedValue({});

    const result = await svc.recordDailyAnchor('tenant_1');
    expect(result.ok).toBe(false);
    expect(bus.publish).toHaveBeenCalledWith('audit.daily_anchor', 'tenant_1', expect.any(Object));
    expect(bus.publish).toHaveBeenCalledWith(
      'audit.chain_broken',
      'tenant_1',
      expect.objectContaining({ chainOk: false }),
    );
  });
});

/**
 * WAVE D (10-10 program) — doc 02 forensic fields. All optional, persisted
 * as given (never fabricated), and covered by the event hash so they cannot
 * be rewritten without breaking the chain.
 */
describe('AuditService forensic fields (doc 02)', () => {
  function makeWriteService() {
    const tx = {
      $executeRaw: jest.fn(),
      auditEvent: {
        findFirst: jest.fn().mockResolvedValue({ hash: 'prev_hash' }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (t: unknown) => Promise<void>) => fn(tx)),
    };
    return { svc: new AuditService(prisma as any), tx };
  }

  it('persists every provided forensic field and includes them in the hash material', async () => {
    const { svc, tx } = makeWriteService();

    await svc.record({
      tenantId: 'tenant_1',
      actorId: 'user_1',
      action: 'breakglass.invoked',
      entityType: 'BreakGlassGrant',
      entityId: 'grant_1',
      licenseSnapshot: { licenseNo: 'PSY-123', status: 'active' },
      jurisdiction: 'US-CA',
      purpose: 'client unreachable after SEVERE flag',
      consentRef: 'consent_v3',
      abacRuleMatched: 'break-glass',
      deviceId: 'dev_1',
      sessionId: 'sess_1',
      authLevel: 'standard',
      obligations: ['dpo-alert'],
      critical: true,
    });

    const created = (tx.auditEvent.create as jest.Mock).mock.calls[0][0].data;
    expect(created).toEqual(
      expect.objectContaining({
        licenseSnapshot: { licenseNo: 'PSY-123', status: 'active' },
        jurisdiction: 'US-CA',
        purpose: 'client unreachable after SEVERE flag',
        consentRef: 'consent_v3',
        abacRuleMatched: 'break-glass',
        deviceId: 'dev_1',
        sessionId: 'sess_1',
        authLevel: 'standard',
        obligations: ['dpo-alert'],
      }),
    );

    // Hash covers the forensic fields: same event with a different purpose
    // must produce a different hash.
    const firstHash = created.hash;
    await svc.record({
      tenantId: 'tenant_1',
      actorId: 'user_1',
      action: 'breakglass.invoked',
      entityType: 'BreakGlassGrant',
      entityId: 'grant_1',
      purpose: 'a DIFFERENT purpose',
      critical: true,
    });
    const secondHash = (tx.auditEvent.create as jest.Mock).mock.calls[1][0].data.hash;
    expect(secondHash).not.toBe(firstHash);
  });

  it('omitted forensic fields persist as undefined (never fabricated)', async () => {
    const { svc, tx } = makeWriteService();

    await svc.record({
      tenantId: 'tenant_1',
      action: 'note.signed',
      entityType: 'SessionNote',
      entityId: 'note_1',
    });

    const created = (tx.auditEvent.create as jest.Mock).mock.calls[0][0].data;
    expect(created.purpose).toBeUndefined();
    expect(created.abacRuleMatched).toBeUndefined();
    expect(created.obligations).toBeUndefined();
  });

  it('forensicsFromPrincipal derives only what the principal honestly carries', () => {
    expect(
      AuditService.forensicsFromPrincipal({
        userId: 'u1',
        tenantId: 't1',
        roles: [],
        permissions: [],
        jurisdiction: 'US-NY',
        sessionId: 'sess_9',
      } as any),
    ).toEqual({ jurisdiction: 'US-NY', sessionId: 'sess_9', authLevel: 'standard' });

    expect(
      AuditService.forensicsFromPrincipal({
        userId: 'u1',
        tenantId: 't1',
        roles: [],
        permissions: [],
        mfaEnrollmentRequired: true,
      } as any),
    ).toEqual({ authLevel: 'restricted-mfa-pending' });
  });
});
