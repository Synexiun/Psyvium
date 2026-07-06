import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FinanceController } from './finance.controller';
import { AccountingService } from './accounting.service';
import { PaymentsService } from './payments.service';
import { PayoutsService } from './payouts.service';
import { StripeWebhookController } from './webhooks/stripe-webhook.controller';

@Module({
  imports: [JwtModule.register({})],
  // `StripeWebhookController` is deliberately separate from `FinanceController`
  // — it carries no `@UseGuards(JwtAuthGuard, PermissionsGuard)` (Stripe can't
  // authenticate as a VPSY user) and is instead signature-verified per request
  // (see the controller's doc comment).
  controllers: [FinanceController, StripeWebhookController],
  providers: [AccountingService, PaymentsService, PayoutsService],
})
export class FinanceModule {}
