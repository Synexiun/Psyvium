/**
 * `PaymentProvider` port (Wave E — Payments made REAL). A real PSP adapter
 * (`../adapters/stripe-payment.adapter.ts`) satisfies this when configured;
 * with no PSP configured, `PaymentsService` keeps the honest offline/manual
 * capture path (see its constructor) — this port is simply never called.
 *
 * Mirrors the activate-on-key shape of `communications/ports/sms-provider.port.ts`:
 * a provider-agnostic seam so a second PSP can be added later without
 * touching `PaymentsService`'s money-moving transaction logic.
 */

export type ChargeStatus = 'succeeded' | 'failed' | 'requires_payment_method';

export interface ChargeResult {
  /** PSP-side reference (e.g. a Stripe PaymentIntent id) — stored as `Payment.pspRef`. */
  providerRef: string;
  status: ChargeStatus;
  /** Present when `status` is `'failed'` (or occasionally `'requires_payment_method'`). */
  failureReason?: string;
}

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

export interface PaymentProvider {
  /**
   * Attempts to charge `amount` (an exact decimal STRING, e.g. `"180.0000"`
   * — never a float) in `currency` for the given invoice. Without an
   * attached, confirmed payment method there is no synchronous way to make
   * this land as `'succeeded'` — see `createCheckoutSession` for the
   * realistic v1 client-pays flow. Never returns a fabricated `'succeeded'`.
   */
  chargeInvoice(amount: string, currency: string, metadata: Record<string, string>): Promise<ChargeResult>;

  /**
   * Creates a PSP-hosted checkout page the client completes to pay online.
   * The invoice is marked PAID only once the PSP confirms completion via its
   * webhook (`checkout.session.completed` for Stripe) — never optimistically
   * on session creation.
   */
  createCheckoutSession(
    invoiceId: string,
    amount: string,
    currency: string,
    successUrl: string,
    cancelUrl: string,
    metadata: Record<string, string>,
  ): Promise<CheckoutSessionResult>;
}
