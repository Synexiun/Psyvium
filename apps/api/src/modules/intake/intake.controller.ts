import { Body, Controller, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Permission, submitIntakeSchema, type SubmitIntakeInput } from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthPrincipal } from '@vpsy/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { IntakeService } from './intake.service';

@ApiTags('intake')
@ApiBearerAuth()
@Controller('intake')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  // Clinical-record mutation AND AI-invoking (IntakeService synchronously
  // calls AiGatewayService#summarizeIntake) — requires Idempotency-Key so a
  // retried submit never creates a duplicate intake/AI summary, and is
  // throttled tighter than the global default to bound AI-gateway cost/load.
  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(Permission.INTAKE_SUBMIT)
  @UseInterceptors(IdempotencyInterceptor)
  submit(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(submitIntakeSchema)) body: SubmitIntakeInput,
  ) {
    return this.intake.submit(user, body);
  }
}
