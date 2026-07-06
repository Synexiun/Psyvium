const paymentIntentsCreate = jest.fn();
const checkoutSessionsCreate = jest.fn();
const constructEvent = jest.fn();

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: { create: paymentIntentsCreate },
    checkout: { sessions: { create: checkoutSessionsCreate } },
    webhooks: { constructEvent },
  }));
});

import { StripePaymentAdapter } from './stripe-payment.adapter';

/**
 * Wave E — Stripe adapter is activate-on-key (`fromEnv()` returns null with
 * no `STRIPE_SECRET_KEY`, same pattern as `TwilioSmsAdapter.fromEnv()`), and
 * never fabricates a captured payment: a fresh PaymentIntent with no attached
 * payment method must surface as `requires_payment_method`, not `succeeded`.
 */
describe('StripePaymentAdapter.fromEnv', () => {
  const originalKey = process.env.STRIPE_SECRET_KEY;
  afterEach(() => {
    if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalKey;
  });

  it('returns null when STRIPE_SECRET_KEY is unset', () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(StripePaymentAdapter.fromEnv()).toBeNull();
  });

  it('returns an adapter instance when STRIPE_SECRET_KEY is set', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    expect(StripePaymentAdapter.fromEnv()).toBeInstanceOf(StripePaymentAdapter);
  });
});

describe('StripePaymentAdapter.chargeInvoice', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps an unattached PaymentIntent to requires_payment_method — never a fabricated succeeded', async () => {
    paymentIntentsCreate.mockResolvedValue({ id: 'pi_123', status: 'requires_payment_method' });
    const adapter = new StripePaymentAdapter('sk_test_123');

    const result = await adapter.chargeInvoice('180.0000', 'USD', { invoiceId: 'inv_1' });

    expect(paymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 18000, currency: 'usd', capture_method: 'automatic' }),
    );
    expect(result).toEqual({ providerRef: 'pi_123', status: 'requires_payment_method' });
  });

  it('maps a succeeded PaymentIntent to succeeded', async () => {
    paymentIntentsCreate.mockResolvedValue({ id: 'pi_456', status: 'succeeded' });
    const adapter = new StripePaymentAdapter('sk_test_123');

    const result = await adapter.chargeInvoice('59.95', 'USD', {});

    expect(result).toEqual({ providerRef: 'pi_456', status: 'succeeded' });
  });

  it('maps a PSP/network error to failed, never throwing out of chargeInvoice', async () => {
    paymentIntentsCreate.mockRejectedValue({ code: 'api_key_expired', message: 'The API key has expired' });
    const adapter = new StripePaymentAdapter('sk_test_bad');

    const result = await adapter.chargeInvoice('10.00', 'USD', {});

    expect(result.status).toBe('failed');
    expect(result.providerRef).toBe('stripe_error_api_key_expired');
    expect(result.failureReason).toBe('The API key has expired');
  });

  it('refuses an amount with a sub-minor-unit remainder without calling Stripe', async () => {
    const adapter = new StripePaymentAdapter('sk_test_123');

    const result = await adapter.chargeInvoice('12.341', 'USD', {});

    expect(result.status).toBe('failed');
    expect(paymentIntentsCreate).not.toHaveBeenCalled();
  });
});

describe('StripePaymentAdapter.createCheckoutSession', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a mocked Checkout Session with the exact minor-units amount and invoiceId metadata', async () => {
    checkoutSessionsCreate.mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.com/pay/cs_test_1' });
    const adapter = new StripePaymentAdapter('sk_test_123');

    const result = await adapter.createCheckoutSession(
      'inv_1',
      '180.0000',
      'USD',
      'https://app.example.com/success',
      'https://app.example.com/cancel',
      { tenantId: 'tenant_demo' },
    );

    expect(checkoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        success_url: 'https://app.example.com/success',
        cancel_url: 'https://app.example.com/cancel',
        metadata: { invoiceId: 'inv_1', tenantId: 'tenant_demo' },
        line_items: [expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 18000 }) })],
      }),
    );
    expect(result).toEqual({ sessionId: 'cs_test_1', url: 'https://checkout.stripe.com/pay/cs_test_1' });
  });

  it('throws if Stripe returns a session with no redirect URL', async () => {
    checkoutSessionsCreate.mockResolvedValue({ id: 'cs_test_2', url: null });
    const adapter = new StripePaymentAdapter('sk_test_123');

    await expect(
      adapter.createCheckoutSession('inv_1', '10.00', 'USD', 'https://s', 'https://c', {}),
    ).rejects.toThrow(/redirect URL/);
  });
});

describe('StripePaymentAdapter.constructWebhookEvent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('delegates to the Stripe SDK for signature verification', () => {
    constructEvent.mockReturnValue({ type: 'checkout.session.completed' });
    const adapter = new StripePaymentAdapter('sk_test_123');

    const event = adapter.constructWebhookEvent(Buffer.from('{}'), 'sig_abc', 'whsec_123');

    expect(constructEvent).toHaveBeenCalledWith(Buffer.from('{}'), 'sig_abc', 'whsec_123');
    expect(event).toEqual({ type: 'checkout.session.completed' });
  });

  it('propagates a signature mismatch as a thrown error', () => {
    constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });
    const adapter = new StripePaymentAdapter('sk_test_123');

    expect(() => adapter.constructWebhookEvent(Buffer.from('{}'), 'bad_sig', 'whsec_123')).toThrow(
      /No signatures found/,
    );
  });
});
