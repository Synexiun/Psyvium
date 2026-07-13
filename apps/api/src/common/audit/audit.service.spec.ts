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
    return { svc: new AuditService(prisma as any), prisma, tx };
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

  it('recordDailyAnchor writes critical anchor with tip', async () => {
    const rows = [
      { id: 'a', hash: 'h1', prevHash: null },
      { id: 'b', hash: 'h2', prevHash: 'h1' },
    ];
    const { svc, tx } = makeService(rows);
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
  });
});
