import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { AuthPrincipal } from '@vpsy/contracts';
import { Role } from '@vpsy/contracts';
import { Prisma } from '@vpsy/database';
import { PaymentsService } from './payments.service';

/**
 * Phase 6 DoD (docs/technical/13-roadmap-and-phases.md, ctx 24 Payments):
 * invoice amount is an exact Decimal sum of its lines (no float drift);
 * paying an invoice is a single atomic transaction that flips it to PAID and
 * posts a balanced ledger entry; paying an already-settled invoice is
 * rejected.
 */

const managerPrincipal: AuthPrincipal = {
  userId: 'user_manager',
  tenantId: 'tenant_demo',
  roles: [Role.MANAGER],
  permissions: [],
};

const clientRow = { id: 'client_1', tenantId: 'tenant_demo' };

const openInvoiceRow = {
  id: 'invoice_1',
  tenantId: 'tenant_demo',
  clientId: 'client_1',
  amount: new Prisma.Decimal('180.0000'),
  currency: 'USD',
  status: 'OPEN',
  lineItems: [{ description: 'Session 1', amount: '60.1000' }],
  dueDate: null,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  client: { user: { fullName: 'Alex Chen' } },
};

function makeService(overrides: Partial<Record<string, unknown>> = {}) {
  const prismaTx = {
    payment: {
      create: jest.fn(async ({ data }: any) => ({ id: 'payment_1', ...data })),
    },
    invoice: {
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    outboxEvent: { create: jest.fn() },
  };

  const prisma = {
    client: { findFirst: jest.fn().mockResolvedValue(clientRow) },
    invoice: {
      findFirst: jest.fn().mockResolvedValue(openInvoiceRow),
      findMany: jest.fn().mockResolvedValue([openInvoiceRow]),
      create: jest.fn(async ({ data }: any) => ({
        id: 'invoice_1',
        createdAt: new Date('2026-07-01T00:00:00Z'),
        client: { user: { fullName: 'Alex Chen' } },
        ...data,
      })),
    },
    payment: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prismaTx)),
    ...overrides,
  };
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn(), publishDurable: jest.fn() };
  const accounting = { postBalancedEntry: jest.fn() };
  const svc = new PaymentsService(prisma as any, audit as any, bus as any, accounting as any);
  return { svc, prisma, audit, bus, accounting, prismaTx };
}

describe('PaymentsService.createInvoice', () => {
  it('sums line-item amounts as an exact Decimal — no float drift', async () => {
    const { svc, audit, bus } = makeService();

    const result = await svc.createInvoice(managerPrincipal, {
      clientId: 'client_1',
      lineItems: [
        { description: 'Session A', amount: '60.10' },
        { description: 'Session B', amount: '59.95' },
        { description: 'Session C', amount: '59.95' },
      ],
      currency: 'USD',
    });

    // 60.10 + 59.95 + 59.95 === 179.99999999999997 as IEEE-754 floats.
    // Decimal arithmetic must land exactly on 180.0000.
    expect(result.amount).toBe('180.0000');
    expect(result.status).toBe('OPEN');
    expect(typeof result.amount).toBe('string');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'invoice.created' }));
    expect(bus.publish).toHaveBeenCalledWith(
      'invoice.created',
      'tenant_demo',
      expect.objectContaining({ amount: '180.0000' }),
    );
  });

  it('rejects an invoice for a client outside the tenant', async () => {
    const { svc } = makeService({ client: { findFirst: jest.fn().mockResolvedValue(null) } });

    await expect(
      svc.createInvoice(managerPrincipal, {
        clientId: 'client_missing',
        lineItems: [{ description: 'X', amount: '10.00' }],
        currency: 'USD',
      }),
    ).rejects.toThrow();
  });
});

describe('PaymentsService.payInvoice', () => {
  it('rejects paying an already-PAID invoice', async () => {
    const { svc, prisma } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({ ...openInvoiceRow, status: 'PAID' }),
        findMany: jest.fn(),
        create: jest.fn(),
      },
    });

    await expect(svc.payInvoice(managerPrincipal, 'invoice_1', { method: 'card' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects paying a VOID invoice', async () => {
    const { svc } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({ ...openInvoiceRow, status: 'VOID' }),
        findMany: jest.fn(),
        create: jest.fn(),
      },
    });

    await expect(svc.payInvoice(managerPrincipal, 'invoice_1', { method: 'card' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('captures the payment, flips the invoice to PAID, and posts a balanced ledger entry — atomically', async () => {
    const { svc, prismaTx, accounting, bus, audit } = makeService();

    const result = await svc.payInvoice(managerPrincipal, 'invoice_1', { method: 'card' });

    expect(result.status).toBe('captured');
    expect(result.amount).toBe('180.0000');

    // All three writes happen inside the same $transaction callback.
    // Compare-and-swap on OPEN prevents concurrent double-capture.
    expect(prismaTx.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 'invoice_1', tenantId: 'tenant_demo', status: 'OPEN' },
      data: { status: 'PAID' },
    });
    expect(accounting.postBalancedEntry).toHaveBeenCalledWith(
      prismaTx,
      expect.objectContaining({ debitAccountCode: '1000', creditAccountCode: '4000', invoiceId: 'invoice_1' }),
    );
    const postedAmount = (accounting.postBalancedEntry as jest.Mock).mock.calls[0][1].amount as Prisma.Decimal;
    expect(postedAmount.toFixed(4)).toBe('180.0000');

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'payment.captured' }));
    // Durable (ADR-005): published inside captureTx's transaction, not via
    // the direct fire-and-forget publish().
    expect(bus.publishDurable).toHaveBeenCalledWith(
      prismaTx,
      'payment.captured',
      'tenant_demo',
      expect.objectContaining({ invoiceId: 'invoice_1', amount: '180.0000' }),
    );
  });
});

describe('PaymentsService.requestRefund', () => {
  const capturedPayment = {
    id: 'payment_1',
    tenantId: 'tenant_demo',
    invoiceId: 'invoice_1',
    amount: new Prisma.Decimal('180.0000'),
    currency: 'USD',
    method: 'card',
    status: 'captured',
    pspRef: null as string | null,
    capturedAt: new Date('2026-07-01T00:00:00Z'),
    deletedAt: null,
  };

  it('fails closed with 503 and critical audit when Stripe is not configured', async () => {
    const { svc, audit, prisma } = makeService({
      payment: {
        findFirst: jest.fn().mockResolvedValue(capturedPayment),
        create: jest.fn(),
      },
    });

    await expect(
      svc.requestRefund(managerPrincipal, 'payment_1', { reason: 'Client cancelled within 24h' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payment.refund_refused',
        critical: true,
        after: expect.objectContaining({ refusedBecause: 'stripe_not_configured' }),
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
