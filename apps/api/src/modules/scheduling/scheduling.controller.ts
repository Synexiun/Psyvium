import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  bookAppointmentSchema,
  createAvailabilitySlotSchema,
  updateAppointmentStatusSchema,
  Permission,
  type AuthPrincipal,
  type BookAppointmentInput,
  type CreateAvailabilitySlotInput,
  type UpdateAppointmentStatusInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SchedulingService } from './scheduling.service';

@ApiTags('scheduling')
@ApiBearerAuth()
@Controller('scheduling')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  /** A psychologist opens a slot on their own calendar. */
  @Post('availability')
  @RequirePermissions(Permission.SCHEDULING_MANAGE)
  addAvailability(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createAvailabilitySlotSchema)) body: CreateAvailabilitySlotInput,
  ) {
    return this.scheduling.addAvailability(user, body);
  }

  /** Open (unbooked, future) slots for a given psychologist — booking picker. */
  @Get('availability/psychologist/:id')
  @RequirePermissions(Permission.SCHEDULING_READ)
  listAvailability(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.scheduling.listOpenAvailability(user, id);
  }

  /** Requires an APPROVED/ACTIVE Assignment linking client and psychologist. */
  @Post('appointments/book')
  @RequirePermissions(Permission.SCHEDULING_BOOK)
  book(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(bookAppointmentSchema)) body: BookAppointmentInput,
  ) {
    return this.scheduling.bookAppointment(user, body);
  }

  /** The authenticated user's agenda (client/psychologist own; manager tenant-wide). */
  @Get('appointments')
  @RequirePermissions(Permission.SCHEDULING_READ)
  myAppointments(@CurrentUser() user: AuthPrincipal) {
    return this.scheduling.getMyAppointments(user);
  }

  @Patch('appointments/:id/status')
  @RequirePermissions(Permission.SCHEDULING_MANAGE)
  updateStatus(
    @CurrentUser() user: AuthPrincipal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAppointmentStatusSchema)) body: UpdateAppointmentStatusInput,
  ) {
    return this.scheduling.updateAppointmentStatus(user, id, body);
  }

  /** Sends a real reminder SMS via CommunicationsService (offline stub or Twilio); still emits AppointmentReminderDue. */
  @Post('appointments/:id/remind')
  @RequirePermissions(Permission.SCHEDULING_MANAGE)
  remind(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.scheduling.sendReminder(user, id);
  }
}
