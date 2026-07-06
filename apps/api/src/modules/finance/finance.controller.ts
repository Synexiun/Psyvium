import { Body, Controller, Get, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
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
