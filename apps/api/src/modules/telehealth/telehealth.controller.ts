import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createTeleSessionSchema,
  Permission,
  type AuthPrincipal,
  type CreateTeleSessionInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TelehealthService } from './telehealth.service';

/**
 * Telehealth (context 12) — LiveKit-backed video/voice session lifecycle
 * (doc 08-telehealth-and-realtime.md §5/§6). Gated on the existing
 * `scheduling:read` (CLIENT/PSYCHOLOGIST/MANAGER already hold it) for the
 * read/lifecycle paths, and `session:host` (PSYCHOLOGIST-only) for admit —
 * participant ABAC (a stranger, including a MANAGER, 403s) is enforced
 * inside `TelehealthService`.
 */
@ApiTags('telehealth')
@ApiBearerAuth()
@Controller('telehealth')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TelehealthController {
  constructor(private readonly telehealth: TelehealthService) {}

  @Post('sessions')
  @RequirePermissions(Permission.SCHEDULING_READ)
  createSession(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createTeleSessionSchema)) body: CreateTeleSessionInput,
  ) {
    return this.telehealth.createSession(user, body);
  }

  @Post('sessions/:id/join')
  @RequirePermissions(Permission.SCHEDULING_READ)
  joinSession(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.telehealth.joinSession(user, id);
  }

  @Post('sessions/:id/admit')
  @RequirePermissions(Permission.SESSION_HOST)
  admitClient(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.telehealth.admitClient(user, id);
  }

  @Post('sessions/:id/end')
  @RequirePermissions(Permission.SCHEDULING_READ)
  endSession(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.telehealth.endSession(user, id);
  }

  @Get('sessions/:id')
  @RequirePermissions(Permission.SCHEDULING_READ)
  getSession(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.telehealth.getSession(user, id);
  }
}
