import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { FieldCipherModule } from '../../common/crypto/field-cipher.module';
import { RiskController } from './risk.controller';
import { RiskService } from './risk.service';
import { RiskSlaService } from './risk-sla.service';

/**
 * `ScheduleModule.forRoot()` is imported here (not in the root `AppModule`)
 * deliberately — Nest's scheduler discovery scans the whole application's
 * provider graph for `@Interval`/`@Cron`/`@Timeout` decorators regardless of
 * which module registers `ScheduleModule`, and this wave's ownership is
 * scoped to the Risk & Crisis module.
 */
@Module({
  imports: [JwtModule.register({}), ScheduleModule.forRoot(), FieldCipherModule],
  controllers: [RiskController],
  providers: [RiskService, RiskSlaService],
})
export class RiskModule {}
