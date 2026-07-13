import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@vpsy/database';
import type {
  AuthPrincipal,
  CreateInvoiceInput,
  InvoiceDto,
  InvoiceLineDto,
  PayInvoiceInput,
  PaymentDto,
  RequestRefundInput,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { AccountingService } from './accounting.service';
import { StripePaymentAdapter } from './adapters/stripe-payment.adapter';
import type { CheckoutSessionResult, PaymentProvider } from './ports/payment-provider.port';

/**
 * Payments (`docs/technical/13-roadmap-and-phases.md`, context 24, Phase 6 —
 * "Billing, invoicing, client payments, reconciliation"). Invoice creation is
 * a plain write; capturing a payment is the money-critical path — it MUST
 * create the Payment, flip the Invoice to PAID, and post a balanced
 * double-entry ledger posting in a single `$transaction` (see MONEY RULES).
 *
 * PSP integration (Wave E) is activate-on-key, same shape as
 * `communications/adapters/twilio-sms.adapter.ts`: with no `STRIPE_SECRET_KEY`
 * this service behaves exactly as before (an internal, honestly-logged
 * offline/manual capture — never a fabricated PSP success). With a key
 * configured, `payInvoice` attempts a direct PaymentIntent charge (which,
 * absent an attached payment method, honestly reports
 * `requires_payment_method` rather than a fake `captured`), and
 * `createCheckoutSession` + the Stripe webhook (`stripe-webhook.controller.ts`)
 * is the realistic v1 "client pays" flow — both routes funnel the actual
 * money-moving write through the same `captureTx` used by the offline path,
 * so the ledger only ever moves atomically and stays balanced.
 */

const INVOICE_INCLUDE = { client: { include: { user: true } } } as const;

type InvoiceRow = {
  id: string;
  clientId: string;
  amount: Prisma.Decimal;
  currency: string;
  status: string;
  lineItems: unknown;
  dueDate: Date | null;
  createdAt: Date;
  client: { user: { fullName: string } };
};

type PaymentRow = {
  id: string;
  invoiceId: string;
  amount: Prisma.Decimal;
  currency: string;
  method: string;
  status: string;
  capturedAt: Date | null;
  pspRef?: string | null;
  tenantId?: string;
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly provider: PaymentProvider | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    private readonly accounting: AccountingService,
  ) {
    // Provider selection seam, activate-on-key: a real PSP is selected only
    // when its credentials are present; otherwise we keep the honest
    // offline/manual capture path — never silently pretending an
    // unconfigured PSP integration is live (see class doc above).
    this.provider = StripePaymentAdapter.fromEnv();
    if (this.provider) {
      this.logger.log('Payment provider: Stripe (live) — PaymentIntent charge + Checkout/webhook capture active.');
    } else {
      this.logger.log(
        'Payment provider: none configured (STRIPE_SECRET_KEY unset) — invoices are captured via the ' +
          'offline/manual path (no PSP call, no fabricated success). Set STRIPE_SECRET_KEY to activate Stripe.',
      );
    }
  }

  /**
   * `amount` is the exact `Prisma.Decimal` sum of the line items — computed
   * with Decimal arithmetic throughout so e.g. 60.10 + 59.95 + 59.95 never
   * drifts the way IEEE-754 floats would.
   */
  async createInvoice(principal: AuthPrincipal, input: CreateInvoiceInput): Promise<InvoiceDto> {
    const client = await this.prisma.client.findFirst({
      where: { id: input.clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    const amount = input.lineItems.reduce(
      (sum, line) => sum.plus(new Prisma.Decimal(line.amount)),
      new Prisma.Decimal(0),
    );

    const invoice = await this.prisma.invoice.create({
      data: {
        tenantId: principal.tenantId,
        clientId: input.clientId,
        lineItems: input.lineItems,
        amount,
        currency: input.currency,
        status: 'OPEN',
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      },
      include: INVOICE_INCLUDE,
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'invoice.created',
      entityType: 'Invoice',
      entityId: invoice.id,
      after: { clientId: input.clientId, amount: amount.toFixed(4), currency: input.currency },
    });
    await this.bus.publish(Events.InvoiceCreated, principal.tenantId, {
      invoiceId: invoice.id,
      clientId: input.clientId,
      amount: amount.toFixed(4),
      currency: input.currency,
    });

    return this.toInvoiceDto(invoice as unknown as InvoiceRow);
  }

  /** Newest first, joined to the client's display name. */
  async listInvoices(principal: AuthPrincipal): Promise<InvoiceDto[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: { tenantId: principal.tenantId },
      include: INVOICE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return invoices.map((i) => this.toInvoiceDto(i as unknown as InvoiceRow));
  }

  /**
   * Captures payment for an OPEN invoice.
   *
   * - No PSP configured (`this.provider === null`): unchanged v0 behavior —
   *   an internal, honestly-logged offline/manual capture, immediately
   *   `captured`, via `captureTx` below.
   * - PSP configured: attempts a direct Stripe PaymentIntent charge. Without
   *   an attached/confirmed payment method that PaymentIntent cannot
   *   synchronously settle — Stripe reports (and we honestly record)
   *   `requires_payment_method` rather than a fabricated `captured`. Only a
   *   PSP-confirmed `succeeded` result runs through `captureTx`. The
   *   realistic way to actually collect card payment in v1 is
   *   `createCheckoutSession` below + the `checkout.session.completed`
   *   webhook, which also runs through `captureTx`.
   */
  async payInvoice(principal: AuthPrincipal, invoiceId: string, input: PayInvoiceInput): Promise<PaymentDto> {
    const invoice = await this.findOpenInvoice(principal.tenantId, invoiceId);

    if (!this.provider) {
      const payment = await this.captureTx(principal.tenantId, invoice, {
        method: input.method,
        status: 'captured',
        pspRef: null,
      });
      await this.recordCapture(principal.tenantId, principal.userId, invoice, payment);
      return this.toPaymentDto(payment);
    }

    const charge = await this.provider.chargeInvoice(invoice.amount.toFixed(4), invoice.currency, {
      invoiceId: invoice.id,
      tenantId: principal.tenantId,
    });

    if (charge.status === 'succeeded') {
      const payment = await this.captureTx(principal.tenantId, invoice, {
        method: input.method,
        status: 'captured',
        pspRef: charge.providerRef,
      });
      await this.recordCapture(principal.tenantId, principal.userId, invoice, payment);
      return this.toPaymentDto(payment);
    }

    // `requires_payment_method` or `failed`: no money moved. Record the
    // honest attempt on the Payment row WITHOUT flipping the invoice or
    // touching the ledger — see class doc for why we never round this up.
    const attempt = await this.prisma.payment.create({
      data: {
        tenantId: principal.tenantId,
        invoiceId: invoice.id,
        amount: invoice.amount,
        currency: invoice.currency,
        method: input.method,
        status: charge.status,
        pspRef: charge.providerRef,
      },
    });
    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'payment.attempt_recorded',
      entityType: 'Payment',
      entityId: attempt.id,
      after: { invoiceId: invoice.id, status: charge.status, pspRef: charge.providerRef },
    });
    this.logger.warn(
      `payInvoice: invoice ${invoice.id} did not settle via direct charge (status=${charge.status}, ` +
        `ref=${charge.providerRef}). Use POST /finance/invoices/:id/checkout for the client-pays flow.`,
    );
    return this.toPaymentDto(attempt as unknown as PaymentRow);
  }

  /**
   * Creates a Stripe-hosted Checkout Session for an OPEN invoice — the
   * realistic v1 "client pays" flow. The invoice is marked PAID only when
   * the `checkout.session.completed` webhook arrives
   * (`webhooks/stripe-webhook.controller.ts` -> `capturePaymentFromWebhook`),
   * never optimistically here.
   */
  async createCheckoutSession(
    principal: AuthPrincipal,
    invoiceId: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<CheckoutSessionResult> {
    if (!this.provider) {
      throw new ServiceUnavailableException(
        'Stripe is not configured (STRIPE_SECRET_KEY unset) — online checkout is unavailable; use the offline capture path.',
      );
    }
    const invoice = await this.findOpenInvoice(principal.tenantId, invoiceId);

    const session = await this.provider.createCheckoutSession(
      invoice.id,
      invoice.amount.toFixed(4),
      invoice.currency,
      successUrl,
      cancelUrl,
      { tenantId: principal.tenantId },
    );

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'payment.checkout_session_created',
      entityType: 'Invoice',
      entityId: invoice.id,
      after: { sessionId: session.sessionId },
    });

    return session;
  }

  /**
   * Requests a refund for a previously captured payment.
   *
   * Fail-closed honesty:
   *  - No Stripe key → 503 (PSP refund path not available; offline captures
   *    have no bank-rail reverse).
   *  - Stripe key present but payment has no `pspRef` (offline/manual capture)
   *    → 501 (refund cannot be automated against a non-PSP payment).
   *  - Stripe key + pspRef → real Stripe Refund; status is whatever Stripe
   *    reports (never fabricated success). On `succeeded`, flips Payment to
   *    `refunded` and Invoice back to `OPEN` so a re-charge is possible.
   *
   * Every attempt — success or refuse — emits a **critical** audit event.
   */
  async requestRefund(
    principal: AuthPrincipal,
    paymentId: string,
    input: RequestRefundInput,
  ): Promise<PaymentDto> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, tenantId: principal.tenantId, deletedAt: null },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    if (payment.status === 'refunded') {
      throw new ForbiddenException('Payment is already refunded');
    }
    if (payment.status !== 'captured') {
      throw new ForbiddenException(
        `Only captured payments can be refunded (current status=${payment.status})`,
      );
    }

    // ── No PSP configured: fail closed 503 ──
    if (!this.provider) {
      await this.audit.record({
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: 'payment.refund_refused',
        entityType: 'Payment',
        entityId: paymentId,
        after: {
          reason: input.reason,
          refusedBecause: 'stripe_not_configured',
          message:
            'STRIPE_SECRET_KEY unset — automated refunds unavailable for offline/manual captures.',
        },
        critical: true,
      });
      throw new ServiceUnavailableException(
        'Refund path not available: Stripe is not configured (STRIPE_SECRET_KEY unset). ' +
          'Offline/manual captures cannot be reverse-settled through a PSP.',
      );
    }

    // ── PSP configured but no charge ref (offline capture under a keyed deploy) ──
    if (!payment.pspRef) {
      await this.audit.record({
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: 'payment.refund_refused',
        entityType: 'Payment',
        entityId: paymentId,
        after: {
          reason: input.reason,
          refusedBecause: 'no_psp_ref',
          message: 'Payment has no PSP charge reference — cannot issue a Stripe refund.',
        },
        critical: true,
      });
      throw new NotImplementedException(
        'Refund not automated: this payment has no PSP charge reference (offline/manual capture). ' +
          'Process the bank-rail reverse outside VPSY and reconcile the ledger manually.',
      );
    }

    const refund = await this.provider.refundPayment(
      payment.pspRef,
      payment.amount.toFixed(4),
      payment.currency,
      input.reason,
      { paymentId: payment.id, tenantId: principal.tenantId, invoiceId: payment.invoiceId },
    );

    if (refund.status !== 'succeeded') {
      await this.audit.record({
        tenantId: principal.tenantId,
        actorId: principal.userId,
        action: 'payment.refund_failed',
        entityType: 'Payment',
        entityId: paymentId,
        after: {
          reason: input.reason,
          pspRefundRef: refund.providerRef,
          status: refund.status,
          failureReason: refund.failureReason ?? null,
        },
        critical: true,
      });
      throw new ServiceUnavailableException(
        `Stripe refund did not succeed (status=${refund.status}` +
          `${refund.failureReason ? `, detail=${refund.failureReason}` : ''}). Payment left unchanged.`,
      );
    }

    // Atomic: mark payment refunded, reopen invoice, reverse ledger (debit
    // Service Revenue / credit Cash) so books stay balanced.
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, tenantId: principal.tenantId, status: 'captured' },
        data: { status: 'refunded' },
      });
      if (claimed.count !== 1) {
        throw new ForbiddenException('Payment is no longer in a refundable state');
      }
      await tx.invoice.updateMany({
        where: { id: payment.invoiceId, tenantId: principal.tenantId, status: 'PAID' },
        data: { status: 'OPEN' },
      });
      await this.accounting.postBalancedEntry(tx, {
        tenantId: principal.tenantId,
        debitAccountCode: '4000', // Service Revenue (reverse)
        creditAccountCode: '1000', // Cash (out)
        amount: payment.amount,
        memo: `Refund payment ${payment.id} (Stripe ${refund.providerRef}): ${input.reason}`,
        invoiceId: payment.invoiceId,
      });
      await this.bus.publishDurable(tx, Events.PaymentRefunded, principal.tenantId, {
        paymentId: payment.id,
        invoiceId: payment.invoiceId,
        amount: payment.amount.toFixed(4),
        currency: payment.currency,
        pspRefundRef: refund.providerRef,
      });
      return tx.payment.findFirstOrThrow({ where: { id: payment.id } });
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'payment.refunded',
      entityType: 'Payment',
      entityId: paymentId,
      before: { status: 'captured' },
      after: {
        status: 'refunded',
        reason: input.reason,
        pspRefundRef: refund.providerRef,
        amount: payment.amount.toFixed(4),
      },
      critical: true,
    });

    return this.toPaymentDto(updated as unknown as PaymentRow);
  }

  /**
   * Called only by the Stripe webhook controller after signature
   * verification, on `checkout.session.completed`. Reuses `captureTx` so the
   * webhook-driven capture is exactly as atomic/balanced as every other
   * capture path. Idempotent: a replayed webhook for an invoice that is no
   * longer OPEN (already captured by an earlier delivery) is a no-op, not an
   * error — Stripe retries webhook deliveries and this must never double-post
   * the ledger.
   */
  async capturePaymentFromWebhook(tenantId: string, invoiceId: string, pspRef: string): Promise<PaymentDto | null> {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) {
      this.logger.error(`stripe webhook: invoice ${invoiceId} not found for tenant ${tenantId} (pspRef=${pspRef}).`);
      return null;
    }
    if (invoice.status !== 'OPEN') {
      this.logger.log(
        `stripe webhook: invoice ${invoiceId} is already ${invoice.status} — treating this ` +
          `checkout.session.completed delivery as an idempotent duplicate (pspRef=${pspRef}).`,
      );
      return null;
    }

    const payment = await this.captureTx(tenantId, invoice, { method: 'card', status: 'captured', pspRef });
    await this.recordCapture(tenantId, 'system:stripe-webhook', invoice, payment, { pspRef });
    return this.toPaymentDto(payment);
  }

  private async findOpenInvoice(tenantId: string, invoiceId: string): Promise<InvoiceRow> {
    const invoice = await this.prisma.invoice.findFirst({ where: { id: invoiceId, tenantId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'PAID' || invoice.status === 'VOID') {
      throw new ForbiddenException(`Invoice is already ${invoice.status}`);
    }
    return invoice as unknown as InvoiceRow;
  }

  /**
   * The one atomic money-moving write, shared by every capture path (offline,
   * direct-charge-succeeded, and webhook): create the Payment (captured), flip
   * Invoice → PAID, and post the balanced debit-Cash / credit-Service-Revenue
   * entry — all-or-nothing in a single `$transaction`.
   */
  private async captureTx(
    tenantId: string,
    invoice: { id: string; amount: Prisma.Decimal; currency: string },
    opts: { method: string; status: 'captured'; pspRef: string | null },
  ): Promise<PaymentRow> {
    return this.prisma.$transaction(async (tx) => {
      // Compare-and-swap: only one concurrent capture can flip OPEN → PAID.
      // A second racer (webhook retry + direct charge, or double-click) aborts
      // before creating a second Payment or balanced ledger pair.
      const claimed = await tx.invoice.updateMany({
        where: { id: invoice.id, tenantId, status: 'OPEN' },
        data: { status: 'PAID' },
      });
      if (claimed.count !== 1) {
        throw new ForbiddenException('Invoice is no longer open for capture');
      }

      const created = await tx.payment.create({
        data: {
          tenantId,
          invoiceId: invoice.id,
          amount: invoice.amount,
          currency: invoice.currency,
          method: opts.method,
          status: opts.status,
          pspRef: opts.pspRef ?? undefined,
          capturedAt: new Date(),
        },
      });
      await this.accounting.postBalancedEntry(tx, {
        tenantId,
        debitAccountCode: '1000', // Cash
        creditAccountCode: '4000', // Service Revenue
        amount: invoice.amount,
        memo: `Invoice ${invoice.id} payment`,
        invoiceId: invoice.id,
      });
      // Durable (ADR-005): written in this same money-moving transaction so a
      // crash between commit and publish can never silently drop a captured
      // payment (which downstream ledger/notification subscribers rely on).
      await this.bus.publishDurable(tx, Events.PaymentCaptured, tenantId, {
        invoiceId: invoice.id,
        paymentId: created.id,
        amount: invoice.amount.toFixed(4),
        currency: invoice.currency,
      });
      return created as unknown as PaymentRow;
    });
  }

  private async recordCapture(
    tenantId: string,
    actorId: string | undefined,
    invoice: { id: string; amount: Prisma.Decimal; currency: string; status?: string },
    payment: PaymentRow,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      tenantId,
      actorId,
      action: 'payment.captured',
      entityType: 'Payment',
      entityId: payment.id,
      before: { invoiceStatus: invoice.status ?? 'OPEN' },
      after: { invoiceId: invoice.id, amount: invoice.amount.toFixed(4), invoiceStatus: 'PAID', ...extra },
    });
    // PaymentCaptured now publishes durably from inside captureTx (ADR-005)
    // — nothing left to publish here.
  }

  private toInvoiceDto(invoice: InvoiceRow): InvoiceDto {
    return {
      id: invoice.id,
      clientId: invoice.clientId,
      clientName: invoice.client.user.fullName,
      amount: invoice.amount.toFixed(4),
      currency: invoice.currency,
      status: invoice.status as InvoiceDto['status'],
      lineItems: invoice.lineItems as unknown as InvoiceLineDto[],
      dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
      createdAt: invoice.createdAt.toISOString(),
    };
  }

  private toPaymentDto(payment: PaymentRow): PaymentDto {
    return {
      id: payment.id,
      invoiceId: payment.invoiceId,
      amount: payment.amount.toFixed(4),
      currency: payment.currency,
      method: payment.method,
      status: payment.status,
      capturedAt: payment.capturedAt ? payment.capturedAt.toISOString() : null,
    };
  }
}
