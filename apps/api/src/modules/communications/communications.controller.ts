import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  clickToCallSchema,
  createMediaMessageSchema,
  Permission,
  rtcTokenRequestSchema,
  sendSmsSchema,
  setSmsOptOutSchema,
  type AuthPrincipal,
  type ClickToCallInput,
  type CreateMediaMessageInput,
  type RtcTokenInput,
  type SendSmsInput,
  type SetSmsOptOutInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CommunicationsService } from './communications.service';

@ApiTags('communications')
@ApiBearerAuth()
@Controller('comms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CommunicationsController {
  constructor(private readonly comms: CommunicationsService) {}

  @Post('calls/click-to-call')
  @RequirePermissions(Permission.COMMS_WRITE)
  clickToCall(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(clickToCallSchema)) body: ClickToCallInput,
  ) {
    return this.comms.clickToCall(user, body);
  }

  @Post('sms')
  @RequirePermissions(Permission.COMMS_WRITE)
  sendSms(@CurrentUser() user: AuthPrincipal, @Body(new ZodValidationPipe(sendSmsSchema)) body: SendSmsInput) {
    return this.comms.sendSms(user, body);
  }

  /** Staff STOP/START preference management (TCPA-style suppression list). */
  @Post('sms/opt-out')
  @RequirePermissions(Permission.COMMS_WRITE)
  setSmsOptOut(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(setSmsOptOutSchema)) body: SetSmsOptOutInput,
  ) {
    return this.comms.setSmsOptOut(user, body);
  }

  @Get('log')
  @RequirePermissions(Permission.COMMS_READ)
  getLog(@CurrentUser() user: AuthPrincipal, @Query('clientId') clientId?: string) {
    return this.comms.getLog(user, clientId);
  }

  @Post('media-messages')
  @RequirePermissions(Permission.COMMS_WRITE)
  createMediaMessage(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createMediaMessageSchema)) body: CreateMediaMessageInput,
  ) {
    return this.comms.createMediaMessage(user, body);
  }

  @Get('media-messages/thread/:threadId')
  @RequirePermissions(Permission.COMMS_READ)
  listMediaMessagesByThread(@CurrentUser() user: AuthPrincipal, @Param('threadId') threadId: string) {
    return this.comms.listMediaMessagesByThread(user, threadId);
  }

  @Patch('media-messages/:id/read')
  @RequirePermissions(Permission.COMMS_WRITE)
  markMediaMessageRead(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.comms.markMediaMessageRead(user, id);
  }

  @Post('rtc/token')
  @RequirePermissions(Permission.COMMS_WRITE)
  getRtcToken(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(rtcTokenRequestSchema)) body: RtcTokenInput,
  ) {
    return this.comms.getRtcToken(user, body);
  }
}
