import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, submitIntakeSchema, type SubmitIntakeInput } from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthPrincipal } from '@vpsy/contracts';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IntakeService } from './intake.service';

@ApiTags('intake')
@ApiBearerAuth()
@Controller('intake')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Post()
  @RequirePermissions(Permission.INTAKE_SUBMIT)
  submit(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(submitIntakeSchema)) body: SubmitIntakeInput,
  ) {
    return this.intake.submit(user, body);
  }
}
