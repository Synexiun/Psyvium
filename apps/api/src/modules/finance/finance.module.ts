import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FinanceController } from './finance.controller';
import { AccountingService } from './accounting.service';
import { PaymentsService } from './payments.service';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [FinanceController],
  providers: [AccountingService, PaymentsService, PayoutsService],
})
export class FinanceModule {}
