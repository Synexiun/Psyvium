import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

jest.mock('../adapters/stripe-payment.adapter');
import { StripePaymentAdapter } from '../adapters/stripe-payment.adapter';
import { StripeWebhookController } from './stripe-webhook.controller';

/**
 * Wave E — Stripe webhook is PUBLIC (no JwtAuthGuard) but must never trust an
 * unverified payload: a bad/missing signature is rejected with 400 and the
 * money-moving `PaymentsService.capturePaymentFromWebhook` is never invoked.
 * Only a verified `checkout.session.completed` event reaches it.
 */
function makeReq(rawBody?: Buffer) {
  return { rawBody } as any;
}

describe('StripeWebhookController', () => {
  const originalSecretKey = process.env.STRIPE_SECRET_KEY;
  const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  });

  afterAll(() => {
    if (originalSecretKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalSecretKey;
    if (originalWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
  });

  it('rejects with 400 on an invalid signature, and never calls the payments handler', async () => {
    const constructWebhookEvent = jest.fn().mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });
    (StripePaymentAdapter.fromEnv as jest.Mock).mockReturnValue({ constructWebhookEvent });
    const payments = { capturePaymentFromWebhook: jest.fn() };
    const controller = new StripeWebhookController(payments as any);

    await expect(controller.handleStripeWebhook(makeReq(Buffer.from('{}')), 'bad_sig')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(payments.capturePaymentFromWebhook).not.toHaveBeenCalled();
  });

  it('rejects with 400 when the Stripe-Signature header is missing', async () => {
    (StripePaymentAdapter.fromEnv as jest.Mock).mockReturnValue({ constructWebhookEvent: jest.fn() });
    const payments = { capturePaymentFromWebhook: jest.fn() };
    const controller = new StripeWebhookController(payments as any);

    await expect(controller.handleStripeWebhook(makeReq(Buffer.from('{}')), undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(payments.capturePaymentFromWebhook).not.toHaveBeenCalled();
  });

  it('rejects with 400 when the raw body was not captured', async () => {
    (StripePaymentAdapter.fromEnv as jest.Mock).mockReturnValue({ constructWebhookEvent: jest.fn() });
    const payments = { capturePaymentFromWebhook: jest.fn() };
    const controller = new StripeWebhookController(payments as any);

    await expect(controller.handleStripeWebhook(makeReq(undefined), 'good_sig')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(payments.capturePaymentFromWebhook).not.toHaveBeenCalled();
  });

  it('rejects with 503 when Stripe is not configured', async () => {
    (StripePaymentAdapter.fromEnv as jest.Mock).mockReturnValue(null);
    const payments = { capturePaymentFromWebhook: jest.fn() };
    const controller = new StripeWebhookController(payments as any);

    await expect(controller.handleStripeWebhook(makeReq(Buffer.from('{}')), 'sig')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(payments.capturePaymentFromWebhook).not.toHaveBeenCalled();
  });

  it('captures the invoice on a verified checkout.session.completed event', async () => {
    const constructWebhookEvent = jest.fn().mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          metadata: { invoiceId: 'invoice_1', tenantId: 'tenant_demo' },
          payment_intent: 'pi_test_1',
        },
      },
    });
    (StripePaymentAdapter.fromEnv as jest.Mock).mockReturnValue({ constructWebhookEvent });
    const payments = {
      capturePaymentFromWebhook: jest.fn().mockResolvedValue({ id: 'payment_1', status: 'captured' }),
    };
    const controller = new StripeWebhookController(payments as any);

    const result = await controller.handleStripeWebhook(makeReq(Buffer.from('{}')), 'good_sig');

    expect(result).toEqual({ received: true });
    expect(payments.capturePaymentFromWebhook).toHaveBeenCalledWith('tenant_demo', 'invoice_1', 'pi_test_1');
  });

  it('ignores an unhandled event type without calling the payments handler', async () => {
    const constructWebhookEvent = jest.fn().mockReturnValue({ type: 'payment_intent.created', data: { object: {} } });
    (StripePaymentAdapter.fromEnv as jest.Mock).mockReturnValue({ constructWebhookEvent });
    const payments = { capturePaymentFromWebhook: jest.fn() };
    const controller = new StripeWebhookController(payments as any);

    const result = await controller.handleStripeWebhook(makeReq(Buffer.from('{}')), 'good_sig');

    expect(result).toEqual({ received: true });
    expect(payments.capturePaymentFromWebhook).not.toHaveBeenCalled();
  });

  it('acks (200) but skips capture when metadata is missing invoiceId/tenantId', async () => {
    const constructWebhookEvent = jest.fn().mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_2', metadata: {} } },
    });
    (StripePaymentAdapter.fromEnv as jest.Mock).mockReturnValue({ constructWebhookEvent });
    const payments = { capturePaymentFromWebhook: jest.fn() };
    const controller = new StripeWebhookController(payments as any);

    const result = await controller.handleStripeWebhook(makeReq(Buffer.from('{}')), 'good_sig');

    expect(result).toEqual({ received: true });
    expect(payments.capturePaymentFromWebhook).not.toHaveBeenCalled();
  });
});
