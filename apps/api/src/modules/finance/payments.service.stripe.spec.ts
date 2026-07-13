import type { AuthPrincipal } from '@vpsy/contracts';
import { Role } from '@vpsy/contracts';
import { Prisma } from '@vpsy/database';

jest.mock('./adapters/stripe-payment.adapter');
import { StripePaymentAdapter } from './adapters/stripe-payment.adapter';
import { PaymentsService } from './payments.service';

/**
 * Wave E — Stripe made REAL. These specs cover the KEYED paths (a
 * `PaymentProvider` is configured): direct-charge succeeded / not-settled,
 * checkout-session creation, and webhook-driven capture (including its
 * idempotent no-op on a replayed event). The keyless/offline path stays
 * covered — unchanged — by `payments.service.spec.ts`.
 */

const managerPrincipal: AuthPrincipal = {
  userId: 'user_manager',
  tenantId: 'tenant_demo',
  roles: [Role.MANAGER],
  permissions: [],
};

const openInvoiceRow = {
  id: 'invoice_1',
  tenantId: 'tenant_demo',
  clientId: 'client_1',
  amount: new Prisma.Decimal('180.0000'),
  currency: 'USD',
  status: 'OPEN',
  lineItems: [{ description: 'Session 1', amount: '180.0000' }],
  dueDate: null,
  createdAt: new Date('2026-07-01T00:00:00Z'),
  client: { user: { fullName: 'Alex Chen' } },
};

function makeService(provider: Record<string, jest.Mock> | null, overrides: Partial<Record<string, unknown>> = {}) {
  (StripePaymentAdapter.fromEnv as jest.Mock).mockReturnValue(provider);

  const prismaTx = {
    payment: {
      create: jest.fn(async ({ data }: any) => ({ id: 'payment_1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirstOrThrow: jest.fn(async () => ({
        id: 'payment_1',
        invoiceId: 'invoice_1',
        amount: new Prisma.Decimal('180.0000'),
        currency: 'USD',
        method: 'card',
        status: 'refunded',
        capturedAt: new Date('2026-07-01T00:00:00Z'),
      })),
    },
    invoice: {
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    outboxEvent: { create: jest.fn() },
  };

  const prisma = {
    invoice: {
      findFirst: jest.fn().mockResolvedValue(openInvoiceRow),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    payment: {
      create: jest.fn(async ({ data }: any) => ({ id: 'payment_attempt_1', ...data })),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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

describe('PaymentsService.payInvoice — keyed (Stripe configured)', () => {
  afterEach(() => jest.clearAllMocks());

  it('captures atomically when Stripe reports the PaymentIntent succeeded', async () => {
    const provider = {
      chargeInvoice: jest.fn().mockResolvedValue({ providerRef: 'pi_ok', status: 'succeeded' }),
      createCheckoutSession: jest.fn(),
    };
    const { svc, prismaTx, accounting, bus, audit } = makeService(provider);

    const result = await svc.payInvoice(managerPrincipal, 'invoice_1', { method: 'card' });

    expect(provider.chargeInvoice).toHaveBeenCalledWith('180.0000', 'USD', {
      invoiceId: 'invoice_1',
      tenantId: 'tenant_demo',
    });
    expect(result.status).toBe('captured');
    expect(prismaTx.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 'invoice_1', tenantId: 'tenant_demo', status: 'OPEN' },
      data: { status: 'PAID' },
    });
    expect(accounting.postBalancedEntry).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'payment.captured' }));
    expect(bus.publishDurable).toHaveBeenCalledWith(prismaTx, 'payment.captured', 'tenant_demo', expect.anything());
  });

  it('honestly records requires_payment_method WITHOUT flipping the invoice or touching the ledger', async () => {
    const provider = {
      chargeInvoice: jest.fn().mockResolvedValue({ providerRef: 'pi_pending', status: 'requires_payment_method' }),
      createCheckoutSession: jest.fn(),
    };
    const { svc, prismaTx, accounting, prisma } = makeService(provider);

    const result = await svc.payInvoice(managerPrincipal, 'invoice_1', { method: 'card' });

    expect(result.status).toBe('requires_payment_method');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prismaTx.invoice.updateMany).not.toHaveBeenCalled();
    expect(accounting.postBalancedEntry).not.toHaveBeenCalled();
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'requires_payment_method', pspRef: 'pi_pending' }) }),
    );
  });

  it('honestly records a failed charge without fabricating a capture', async () => {
    const provider = {
      chargeInvoice: jest.fn().mockResolvedValue({ providerRef: 'stripe_error_card_declined', status: 'failed' }),
      createCheckoutSession: jest.fn(),
    };
    const { svc, prisma } = makeService(provider);

    const result = await svc.payInvoice(managerPrincipal, 'invoice_1', { method: 'card' });

    expect(result.status).toBe('failed');
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
  });
});

describe('PaymentsService.createCheckoutSession', () => {
  afterEach(() => jest.clearAllMocks());

  it('rejects when Stripe is not configured', async () => {
    const { svc } = makeService(null);

    await expect(
      svc.createCheckoutSession(managerPrincipal, 'invoice_1', 'https://s', 'https://c'),
    ).rejects.toThrow(/Stripe is not configured/);
  });

  it('creates a checkout session (mocked) for an OPEN invoice and audits it', async () => {
    const provider = {
      chargeInvoice: jest.fn(),
      createCheckoutSession: jest.fn().mockResolvedValue({ sessionId: 'cs_1', url: 'https://checkout/cs_1' }),
    };
    const { svc, audit } = makeService(provider);

    const result = await svc.createCheckoutSession(managerPrincipal, 'invoice_1', 'https://s', 'https://c');

    expect(provider.createCheckoutSession).toHaveBeenCalledWith(
      'invoice_1',
      '180.0000',
      'USD',
      'https://s',
      'https://c',
      { tenantId: 'tenant_demo' },
    );
    expect(result).toEqual({ sessionId: 'cs_1', url: 'https://checkout/cs_1' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'payment.checkout_session_created' }));
  });
});

describe('PaymentsService.capturePaymentFromWebhook', () => {
  afterEach(() => jest.clearAllMocks());

  it('captures atomically via the same captureTx path as every other capture', async () => {
    const { svc, prismaTx, accounting, audit, bus } = makeService({ chargeInvoice: jest.fn(), createCheckoutSession: jest.fn() });

    const result = await svc.capturePaymentFromWebhook('tenant_demo', 'invoice_1', 'pi_webhook_1');

    expect(result?.status).toBe('captured');
    expect(prismaTx.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 'invoice_1', tenantId: 'tenant_demo', status: 'OPEN' },
      data: { status: 'PAID' },
    });
    expect(accounting.postBalancedEntry).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment.captured', actorId: 'system:stripe-webhook' }),
    );
    expect(bus.publishDurable).toHaveBeenCalledWith(prismaTx, 'payment.captured', 'tenant_demo', expect.anything());
  });

  it('is idempotent — a replayed webhook for an already-PAID invoice is a no-op, not a double capture', async () => {
    const { svc, prismaTx, accounting, prisma } = makeService(
      { chargeInvoice: jest.fn(), createCheckoutSession: jest.fn() },
      { invoice: { findFirst: jest.fn().mockResolvedValue({ ...openInvoiceRow, status: 'PAID' }) } },
    );

    const result = await svc.capturePaymentFromWebhook('tenant_demo', 'invoice_1', 'pi_webhook_2');

    expect(result).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prismaTx.invoice.updateMany).not.toHaveBeenCalled();
    expect(accounting.postBalancedEntry).not.toHaveBeenCalled();
  });

  it('returns null and logs when the invoice cannot be found for the tenant', async () => {
    const { svc, prisma } = makeService(
      { chargeInvoice: jest.fn(), createCheckoutSession: jest.fn() },
      { invoice: { findFirst: jest.fn().mockResolvedValue(null) } },
    );

    const result = await svc.capturePaymentFromWebhook('tenant_demo', 'invoice_missing', 'pi_webhook_3');

    expect(result).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.requestRefund — keyed (Stripe configured)', () => {
  afterEach(() => jest.clearAllMocks());

  const capturedWithPsp = {
    id: 'payment_1',
    tenantId: 'tenant_demo',
    invoiceId: 'invoice_1',
    amount: new Prisma.Decimal('180.0000'),
    currency: 'USD',
    method: 'card',
    status: 'captured',
    pspRef: 'pi_ok',
    capturedAt: new Date('2026-07-01T00:00:00Z'),
    deletedAt: null,
  };

  it('fails closed with 501 + critical audit when payment has no pspRef', async () => {
    const provider = {
      chargeInvoice: jest.fn(),
      createCheckoutSession: jest.fn(),
      refundPayment: jest.fn(),
    };
    const { svc, audit, prisma } = makeService(provider, {
      payment: {
        findFirst: jest.fn().mockResolvedValue({ ...capturedWithPsp, pspRef: null }),
        create: jest.fn(),
        updateMany: jest.fn(),
        findFirstOrThrow: jest.fn(),
      },
    });

    await expect(
      svc.requestRefund(managerPrincipal, 'payment_1', { reason: 'Duplicate charge' }),
    ).rejects.toThrow(/no PSP charge reference/);

    expect(provider.refundPayment).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payment.refund_refused',
        critical: true,
        after: expect.objectContaining({ refusedBecause: 'no_psp_ref' }),
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refunds via Stripe, reopens invoice, reverses ledger, and critically audits', async () => {
    const provider = {
      chargeInvoice: jest.fn(),
      createCheckoutSession: jest.fn(),
      refundPayment: jest.fn().mockResolvedValue({ providerRef: 're_1', status: 'succeeded' }),
    };
    const { svc, prismaTx, accounting, audit, bus } = makeService(provider, {
      payment: {
        findFirst: jest.fn().mockResolvedValue(capturedWithPsp),
        create: jest.fn(),
        updateMany: jest.fn(),
        findFirstOrThrow: jest.fn(),
      },
    });

    const result = await svc.requestRefund(managerPrincipal, 'payment_1', {
      reason: 'Client cancelled within cooling-off period',
    });

    expect(provider.refundPayment).toHaveBeenCalledWith(
      'pi_ok',
      '180.0000',
      'USD',
      'Client cancelled within cooling-off period',
      expect.objectContaining({ paymentId: 'payment_1', tenantId: 'tenant_demo' }),
    );
    expect(result.status).toBe('refunded');
    expect(prismaTx.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'payment_1', tenantId: 'tenant_demo', status: 'captured' },
      data: { status: 'refunded' },
    });
    expect(prismaTx.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 'invoice_1', tenantId: 'tenant_demo', status: 'PAID' },
      data: { status: 'OPEN' },
    });
    expect(accounting.postBalancedEntry).toHaveBeenCalledWith(
      prismaTx,
      expect.objectContaining({ debitAccountCode: '4000', creditAccountCode: '1000' }),
    );
    expect(bus.publishDurable).toHaveBeenCalledWith(
      prismaTx,
      'payment.refunded',
      'tenant_demo',
      expect.objectContaining({ paymentId: 'payment_1', pspRefundRef: 're_1' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment.refunded', critical: true }),
    );
  });
});
