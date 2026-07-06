import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@vpsy/database';
import type {
  AuthPrincipal,
  CreateInvoiceInput,
  InvoiceDto,
  InvoiceLineDto,
  PayInvoiceInput,
  PaymentDto,
} from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus, Events } from '../../common/events/event-bus.service';
import { AccountingService } from './accounting.service';

/**
 * Payments (`docs/technical/13-roadmap-and-phases.md`, context 24, Phase 6 —
 * "Billing, invoicing, client payments, reconciliation"). Invoice creation is
 * a plain write; capturing a payment is the money-critical path — it MUST
 * create the Payment, flip the Invoice to PAID, and post a balanced
 * double-entry ledger posting in a single `$transaction` (see MONEY RULES).
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
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
    private readonly accounting: AccountingService,
  ) {}

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
   * Captures payment for an OPEN invoice. Single transaction: create the
   * Payment (captured), flip Invoice → PAID, and post the balanced
   * debit-Cash / credit-Service-Revenue entry — all-or-nothing.
   */
  async payInvoice(principal: AuthPrincipal, invoiceId: string, input: PayInvoiceInput): Promise<PaymentDto> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, tenantId: principal.tenantId },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'PAID' || invoice.status === 'VOID') {
      throw new ForbiddenException(`Invoice is already ${invoice.status}`);
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          tenantId: principal.tenantId,
          invoiceId: invoice.id,
          amount: invoice.amount,
          currency: invoice.currency,
          method: input.method,
          status: 'captured',
          capturedAt: new Date(),
        },
      });
      await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });
      await this.accounting.postBalancedEntry(tx, {
        tenantId: principal.tenantId,
        debitAccountCode: '1000', // Cash
        creditAccountCode: '4000', // Service Revenue
        amount: invoice.amount,
        memo: `Invoice ${invoice.id} payment`,
        invoiceId: invoice.id,
      });
      return created;
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'payment.captured',
      entityType: 'Payment',
      entityId: payment.id,
      before: { invoiceStatus: invoice.status },
      after: { invoiceId: invoice.id, amount: invoice.amount.toFixed(4), invoiceStatus: 'PAID' },
    });
    await this.bus.publish(Events.PaymentCaptured, principal.tenantId, {
      invoiceId: invoice.id,
      paymentId: payment.id,
      amount: invoice.amount.toFixed(4),
      currency: invoice.currency,
    });

    return this.toPaymentDto(payment as unknown as PaymentRow);
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
