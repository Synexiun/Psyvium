import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createThreadSchema,
  listMessagesQuerySchema,
  Permission,
  sendMessageSchema,
  type AuthPrincipal,
  type CreateThreadInput,
  type ListMessagesQuery,
  type SendMessageInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MessagingService } from './messaging.service';

/**
 * Messaging (context 14) — secure client<->clinician text threads. Gated on
 * the same `comms:read`/`comms:write` permissions CLIENT/PSYCHOLOGIST/MANAGER
 * already hold for async media messages (`packages/contracts/src/rbac.ts`);
 * participant ABAC (a stranger 403s) is enforced inside `MessagingService`.
 */
@ApiTags('messaging')
@ApiBearerAuth()
@Controller('messaging')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Post('threads')
  @RequirePermissions(Permission.COMMS_WRITE)
  createOrFindThread(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createThreadSchema)) body: CreateThreadInput,
  ) {
    return this.messaging.createOrFindThread(user, body);
  }

  @Get('threads')
  @RequirePermissions(Permission.COMMS_READ)
  listMyThreads(@CurrentUser() user: AuthPrincipal) {
    return this.messaging.listMyThreads(user);
  }

  @Post('threads/:id/messages')
  @RequirePermissions(Permission.COMMS_WRITE)
  sendMessage(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
  ) {
    return this.messaging.sendMessage(user, id, body);
  }

  @Get('threads/:id/messages')
  @RequirePermissions(Permission.COMMS_READ)
  listMessages(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(listMessagesQuerySchema)) query: ListMessagesQuery,
  ) {
    return this.messaging.listMessages(user, id, query);
  }

  @Patch('messages/:id/read')
  @RequirePermissions(Permission.COMMS_WRITE)
  markMessageRead(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.messaging.markMessageRead(user, id);
  }

  /** Soft-retract: sender only, within 15 minutes of send. */
  @Delete('messages/:id')
  @RequirePermissions(Permission.COMMS_WRITE)
  retractMessage(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.messaging.retractMessage(user, id);
  }
}
