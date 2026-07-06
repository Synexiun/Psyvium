import {
  BadRequestException,
  Controller,
  Headers,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { TenantContext } from '../../../common/prisma/tenant-context';
import { StripePaymentAdapter } from '../adapters/stripe-payment.adapter';
import { PaymentsService } from '../payments.service';

/**
 * Stripe webhook receiver. Deliberately its OWN controller (not a route on
 * `FinanceController`) because it must be PUBLIC — Stripe cannot present a
 * VPSY session cookie or bearer token, so `FinanceController`'s
 * `@UseGuards(JwtAuthGuard, PermissionsGuard)` cannot apply here. "Public" is
 * safe only because every request is SIGNATURE-verified against
 * `STRIPE_WEBHOOK_SECRET` before any side effect runs — an unsigned or
 * mis-signed request is rejected with 400 and never reaches
 * `PaymentsService`. The global `PrincipalThrottlerGuard` (IP-keyed for an
 * unauthenticated caller) still applies, tightened further below.
 *
 * RAW BODY GOTCHA: Stripe's signature covers the exact bytes it sent — a
 * verification attempt against Nest's JSON-parsed-then-reserialized
 * `req.body` will not match. This route relies on `rawBody: true` passed to
 * `NestFactory.create()` in `main.ts`, which makes Nest capture the original
 * buffer onto `req.rawBody` in addition to normal JSON parsing.
 *
 * TENANT CONTEXT: this route runs with no JWT, so the global
 * `TenantContextMiddleware` leaves the RLS backstop's tenant GUC unset — and
 * `Invoice`/`Payment` are STRICT-RLS tables (unset GUC = zero rows / rejected
 * writes, see the RLS migration). Once the signature verifies, the event's
 * `metadata.tenantId` (set by us, server-side, at `createCheckoutSession`
 * time, and now cryptographically vouched for by Stripe's signature) is a
 * trustworthy tenant id — we explicitly bind it via `TenantContext.run(...)`
 * for the capture call, the same primitive the authenticated-request
 * middleware uses, so the RLS-scoped Prisma calls inside
 * `PaymentsService.capturePaymentFromWebhook` see the right tenant.
 */
@ApiExcludeController()
@Controller('finance/webhooks')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private readonly payments: PaymentsService) {}

  @Post('stripe')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: boolean }> {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const provider = StripePaymentAdapter.fromEnv();
    if (!provider || !webhookSecret) {
      this.logger.warn(
        'Stripe webhook received but STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET is unset — rejecting ' +
          '(cannot verify signature, so we never risk trusting an unverified payload).',
      );
      throw new ServiceUnavailableException('Stripe webhook is not configured.');
    }
    if (!signature) {
      throw new BadRequestException('Missing Stripe-Signature header.');
    }
    if (!req.rawBody) {
      // Should never happen once `rawBody: true` is set in main.ts — fail
      // loud rather than ever falling back to the parsed (re-serialized)
      // req.body, which would not match Stripe's signature anyway.
      this.logger.error('Stripe webhook: no raw body captured — check NestFactory({ rawBody: true }) in main.ts.');
      throw new BadRequestException('Raw body unavailable for signature verification.');
    }

    let event: ReturnType<StripePaymentAdapter['constructWebhookEvent']>;
    try {
      event = provider.constructWebhookEvent(req.rawBody, signature, webhookSecret);
    } catch (err) {
      this.logger.warn(`Stripe webhook signature verification FAILED: ${(err as Error).message}`);
      throw new BadRequestException('Invalid Stripe webhook signature.');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as {
        id: string;
        metadata?: Record<string, string> | null;
        payment_intent?: string | { id: string } | null;
      };
      const invoiceId = session.metadata?.invoiceId;
      const tenantId = session.metadata?.tenantId;
      const pspRef = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? session.id);

      if (!invoiceId || !tenantId) {
        this.logger.error(
          `Stripe webhook: checkout.session.completed (session=${session.id}) is missing invoiceId/tenantId ` +
            'metadata — ignoring (nothing to capture against).',
        );
        return { received: true };
      }

      await TenantContext.run({ tenantId }, () => this.payments.capturePaymentFromWebhook(tenantId, invoiceId, pspRef));
    } else {
      this.logger.debug(`Stripe webhook: ignoring unhandled event type "${event.type}".`);
    }

    return { received: true };
  }
}
