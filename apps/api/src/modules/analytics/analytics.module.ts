import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AnalyticsController } from './analytics.controller';
import { ReportsService } from './reports.service';
import { NationalAnalyticsService } from './national-analytics.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AnalyticsController],
  providers: [ReportsService, NationalAnalyticsService],
})
export class AnalyticsModule {}
