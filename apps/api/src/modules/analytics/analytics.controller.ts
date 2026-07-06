import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, type AuthPrincipal } from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ReportsService } from './reports.service';
import { NationalAnalyticsService } from './national-analytics.service';

/**
 * Reports (`docs/technical/13-roadmap-and-phases.md`, context 27, Phase 6) +
 * National Analytics (context 28, Phase 6). Two sub-services, one thin
 * dispatching controller — matches the Finance module's shape
 * (`modules/finance/finance.controller.ts`).
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AnalyticsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly nationalAnalytics: NationalAnalyticsService,
  ) {}

  @Get('reports/executive')
  @RequirePermissions(Permission.REPORTS_READ)
  getExecutiveReport(@CurrentUser() user: AuthPrincipal) {
    return this.reports.getExecutiveReport(user);
  }

  @Get('reports/manager')
  @RequirePermissions(Permission.REPORTS_READ)
  getManagerReport(@CurrentUser() user: AuthPrincipal) {
    return this.reports.getManagerReport(user);
  }

  @Get('analytics/national')
  @RequirePermissions(Permission.NATIONAL_ANALYTICS_READ)
  getNationalAnalytics(@CurrentUser() user: AuthPrincipal) {
    return this.nationalAnalytics.getNationalAnalytics(user);
  }
}
