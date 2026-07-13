import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  approveAssignmentSchema,
  holdAssignmentSchema,
  Permission,
  rejectAssignmentSchema,
  type ApproveAssignmentInput,
  type AuthPrincipal,
  type HoldAssignmentInput,
  type RejectAssignmentInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { MatchingService } from './matching.service';

@ApiTags('matching')
@ApiBearerAuth()
@Controller('assignments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  /** Manager triage board. */
  @Get('proposals')
  @RequirePermissions(Permission.ASSIGNMENT_READ)
  listProposals(@CurrentUser() user: AuthPrincipal) {
    return this.matching.listProposals(user);
  }

  /** Manager approves an assignment — final authority. */
  @Post('approve')
  @RequirePermissions(Permission.ASSIGNMENT_APPROVE)
  approve(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(approveAssignmentSchema)) body: ApproveAssignmentInput,
  ) {
    return this.matching.approve(user, body);
  }

  /** Manager rejects a proposal (client returns to waitlist). */
  @Post('reject')
  @RequirePermissions(Permission.ASSIGNMENT_APPROVE)
  reject(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(rejectAssignmentSchema)) body: RejectAssignmentInput,
  ) {
    return this.matching.reject(user, body);
  }

  /** Manager holds a proposal for later review. */
  @Post('hold')
  @RequirePermissions(Permission.ASSIGNMENT_APPROVE)
  hold(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(holdAssignmentSchema)) body: HoldAssignmentInput,
  ) {
    return this.matching.hold(user, body);
  }
}
