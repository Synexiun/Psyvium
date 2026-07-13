import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  ServiceUnavailableException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  computePayoutSchema,
  createInvoiceSchema,
  payInvoiceSchema,
  Permission,
  type AuthPrincipal,
  type ComputePayoutInput,
  type CreateInvoiceInput,
  type PayInvoiceInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { AccountingService } from './accounting.service';
import { PaymentsService } from './payments.service';
import { PayoutsService } from './payouts.service';

/**
 * Finance (`docs/technical/13-roadmap-and-phases.md`, contexts 24 Payments /
 * 25 Accounting / 26 Revenue Share & Payouts, Phase 6). One module, three
 * sub-services — the controller is a thin dispatcher onto whichever owns the
 * route.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FinanceController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly accounting: AccountingService,
    private readonly payouts: PayoutsService,
  ) {}

  @Post('invoices')
  @RequirePermissions(Permission.FINANCE_MANAGE)
  createInvoice(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createInvoiceSchema)) body: CreateInvoiceInput,
  ) {
    return this.payments.createInvoice(user, body);
  }

  @Get('invoices')
  @RequirePermissions(Permission.FINANCE_READ)
  listInvoices(@CurrentUser() user: AuthPrincipal) {
    return this.payments.listInvoices(user);
  }

  // Money-moving mutation (doc 04-api-design.md §8): requires Idempotency-Key
  // and replays the original response on a duplicate submit, so a double-tap
  // / client retry never captures the payment twice.
  @Post('invoices/:id/pay')
  @RequirePermissions(Permission.FINANCE_MANAGE)
  @UseInterceptors(IdempotencyInterceptor)
  payInvoice(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(payInvoiceSchema)) body: PayInvoiceInput,
  ) {
    return this.payments.payInvoice(user, id, body);
  }

  // Stripe-hosted Checkout is the realistic v1 "client pays online" flow (see
  // payments.service.ts's class doc): this only starts the session — the
  // invoice is marked PAID later, by StripeWebhookController, once Stripe
  // confirms `checkout.session.completed`.
  @Post('invoices/:id/checkout')
  @RequirePermissions(Permission.FINANCE_MANAGE)
  createCheckoutSession(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    const origin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    const successUrl = `${origin}/finance/invoices/${id}?checkout=success`;
    const cancelUrl = `${origin}/finance/invoices/${id}?checkout=cancelled`;
    return this.payments.createCheckoutSession(user, id, successUrl, cancelUrl);
  }

  @Get('ledger')
  @RequirePermissions(Permission.FINANCE_READ)
  listLedger(@CurrentUser() user: AuthPrincipal) {
    return this.accounting.listLedger(user.tenantId);
  }

  @Post('payouts/compute')
  @RequirePermissions(Permission.FINANCE_MANAGE)
  computePayout(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(computePayoutSchema)) body: ComputePayoutInput,
  ) {
    return this.payouts.computePayout(user, body);
  }

  /**
   * Bank-rail disbursement is not implemented (audit Gate 0 §16 / Gate 2).
   * Compute remains available for statements; this endpoint exists so clients
   * never invent a fake "paid out" transition.
   */
  @Post('payouts/:id/disburse')
  @RequirePermissions(Permission.FINANCE_MANAGE)
  disbursePayout(@Param('id') id: string) {
    if (process.env.VPSY_ALLOW_PAYOUT_DISBURSE === 'true') {
      // Reserved for a real ACH/wire adapter. Still not wired.
      throw new ServiceUnavailableException(
        `Payout disbursement adapter is not configured (payout ${id}).`,
      );
    }
    throw new ServiceUnavailableException(
      'Payout disbursement to bank rails is not production-ready. ' +
        'Use POST /finance/payouts/compute for calculated entitlements only. ' +
        'Set VPSY_ALLOW_PAYOUT_DISBURSE=true only after a real disbursement provider is integrated.',
    );
  }

  @Get('payouts')
  @RequirePermissions(Permission.FINANCE_READ)
  listPayouts(@CurrentUser() user: AuthPrincipal) {
    return this.payouts.listPayouts(user);
  }

  @Get('summary')
  @RequirePermissions(Permission.FINANCE_READ)
  getSummary(@CurrentUser() user: AuthPrincipal) {
    return this.accounting.getSummary(user.tenantId);
  }
}
