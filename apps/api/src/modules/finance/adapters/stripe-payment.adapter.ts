import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { decimalStringToMinorUnits } from '../money/minor-units';
import type { ChargeResult, CheckoutSessionResult, PaymentProvider } from '../ports/payment-provider.port';

/**
 * Real Stripe adapter (activate-on-key, same pattern as
 * `communications/adapters/twilio-sms.adapter.ts`). Selected by
 * `PaymentsService` only when `STRIPE_SECRET_KEY` is present; with no key the
 * service keeps the honest offline/manual capture path. We never fabricate a
 * captured payment:
 *
 * - `chargeInvoice` creates a Stripe `PaymentIntent`. Without an attached,
 *   confirmed payment method (which this v1 has no UI to collect) a
 *   PaymentIntent cannot synchronously reach `succeeded` — Stripe itself
 *   reports it as `requires_payment_method`, and that is exactly what we
 *   return; we do not round it up to `succeeded`. A hard PSP/network error
 *   maps to `failed`.
 * - `createCheckoutSession` is the realistic v1 "client pays" flow: a
 *   Stripe-hosted Checkout Session. The invoice is marked PAID only when the
 *   `checkout.session.completed` webhook arrives (see
 *   `webhooks/stripe-webhook.controller.ts`), never optimistically here.
 */
export class StripePaymentAdapter implements PaymentProvider {
  private readonly logger = new Logger(StripePaymentAdapter.name);
  private readonly client: Stripe;

  constructor(secretKey: string) {
    this.client = new Stripe(secretKey);
  }

  /** Build from env, or null when `STRIPE_SECRET_KEY` is unset. */
  static fromEnv(): StripePaymentAdapter | null {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return null;
    return new StripePaymentAdapter(key);
  }

  async chargeInvoice(amount: string, currency: string, metadata: Record<string, string>): Promise<ChargeResult> {
    let minorUnits: number;
    try {
      minorUnits = decimalStringToMinorUnits(amount, currency);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`chargeInvoice: refusing invalid amount "${amount}" ${currency}: ${message}`);
      return { providerRef: 'invalid_amount', status: 'failed', failureReason: message };
    }

    try {
      const intent = await this.client.paymentIntents.create({
        amount: minorUnits,
        currency: currency.toLowerCase(),
        capture_method: 'automatic',
        metadata,
      });
      // Honesty over convenience: a freshly created PaymentIntent with no
      // attached/confirmed payment method always reports
      // `requires_payment_method` — we surface that distinct status exactly
      // rather than claiming `succeeded`. The realistic capture path for a
      // real charge is `createCheckoutSession()` + the completion webhook.
      const status: ChargeResult['status'] = intent.status === 'succeeded' ? 'succeeded' : 'requires_payment_method';
      this.logger.log(`[stripe] paymentIntent ${intent.id} status=${intent.status} -> mapped ${status}`);
      return { providerRef: intent.id, status };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      this.logger.warn(`[stripe] chargeInvoice failed: ${e.code ?? ''} ${e.message ?? String(err)}`);
      return { providerRef: `stripe_error_${e.code ?? 'unknown'}`, status: 'failed', failureReason: e.message };
    }
  }

  async createCheckoutSession(
    invoiceId: string,
    amount: string,
    currency: string,
    successUrl: string,
    cancelUrl: string,
    metadata: Record<string, string>,
  ): Promise<CheckoutSessionResult> {
    const minorUnits = decimalStringToMinorUnits(amount, currency);
    const session = await this.client.checkout.sessions.create({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: minorUnits,
            product_data: { name: `VPSY invoice ${invoiceId}` },
          },
          quantity: 1,
        },
      ],
      // invoiceId always lands in metadata (not just as a URL param) so the
      // webhook — which only ever sees the Stripe event body — can resolve
      // the invoice without trusting anything client-supplied.
      metadata: { invoiceId, ...metadata },
    });

    if (!session.url) {
      throw new Error(`Stripe Checkout Session ${session.id} was created without a redirect URL`);
    }
    this.logger.log(`[stripe] checkout session ${session.id} created for invoice ${invoiceId}`);
    return { sessionId: session.id, url: session.url };
  }

  /** Verifies the `Stripe-Signature` header against the raw request body; throws `Stripe.errors.StripeSignatureVerificationError` on mismatch. */
  constructWebhookEvent(rawBody: Buffer, signature: string, webhookSecret: string): Stripe.Event {
    return this.client.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }
}
