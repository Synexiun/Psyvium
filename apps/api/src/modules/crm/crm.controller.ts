import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  convertLeadSchema,
  createLeadSchema,
  createReferrerSchema,
  logEngagementSchema,
  moveLeadStageSchema,
  stalledLeadsQuerySchema,
  Permission,
  type AuthPrincipal,
  type ConvertLeadInput,
  type CreateLeadInput,
  type CreateReferrerInput,
  type LogEngagementInput,
  type MoveLeadStageInput,
  type StalledLeadsQuery,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CrmService } from './crm.service';

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('board')
  @RequirePermissions(Permission.CRM_READ)
  getBoard(@CurrentUser() user: AuthPrincipal) {
    return this.crm.getBoard(user);
  }

  @Post('leads')
  @RequirePermissions(Permission.CRM_WRITE)
  createLead(@CurrentUser() user: AuthPrincipal, @Body(new ZodValidationPipe(createLeadSchema)) body: CreateLeadInput) {
    return this.crm.createLead(user, body);
  }

  /** Leads unchanged in-stage past N days (default 14) — `16` §2 "operational nudge." */
  @Get('leads/stalled')
  @RequirePermissions(Permission.CRM_READ)
  getStalledLeads(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(stalledLeadsQuerySchema)) query: StalledLeadsQuery,
  ) {
    return this.crm.getStalledLeads(user, query.days);
  }

  @Patch('leads/:id/stage')
  @RequirePermissions(Permission.CRM_WRITE)
  moveLeadStage(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moveLeadStageSchema)) body: MoveLeadStageInput,
  ) {
    return this.crm.moveLeadStage(user, id, body);
  }

  @Post('leads/:id/convert')
  @RequirePermissions(Permission.CRM_WRITE)
  convertLead(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(convertLeadSchema)) body: ConvertLeadInput,
  ) {
    return this.crm.convertLead(user, id, body);
  }

  @Post('referrers')
  @RequirePermissions(Permission.CRM_WRITE)
  createReferrer(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createReferrerSchema)) body: CreateReferrerInput,
  ) {
    return this.crm.createReferrer(user, body);
  }

  @Get('referrers')
  @RequirePermissions(Permission.CRM_READ)
  listReferrers(@CurrentUser() user: AuthPrincipal) {
    return this.crm.listReferrers(user);
  }

  @Post('engagement')
  @RequirePermissions(Permission.CRM_WRITE)
  logEngagement(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(logEngagementSchema)) body: LogEngagementInput,
  ) {
    return this.crm.logEngagement(user, body);
  }

  @Get('timeline/:subjectType/:subjectId')
  @RequirePermissions(Permission.CRM_READ)
  getTimeline(
    @CurrentUser() user: AuthPrincipal,
    @Param('subjectType') subjectType: string,
    @Param('subjectId') subjectId: string,
  ) {
    return this.crm.getTimeline(user, subjectType, subjectId);
  }
}
