import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, type AuthPrincipal } from '@vpsy/contracts';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuditService } from './audit.service';

/**
 * Audit-Read surface (doc 04/06). Holders of AUDIT_READ (managers, admins)
 * can page the tenant's hash-chained trail. Writes still go only through
 * AuditService.record() from domain services.
 */
@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('events')
  @RequirePermissions(Permission.AUDIT_READ)
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
  ) {
    const parsed = limit ? Number(limit) : 50;
    return this.audit.listForTenant(user, {
      limit: Number.isFinite(parsed) ? parsed : 50,
      cursor,
      entityType,
      entityId,
      actorId,
      action,
    });
  }
}
