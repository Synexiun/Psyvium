import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';
import { CommunicationsService } from '../communications/communications.service';
import { OfflineStubAdapter } from '../communications/adapters/offline-stub.adapter';

@Module({
  imports: [JwtModule.register({})],
  controllers: [SchedulingController],
  // `CommunicationsService` (+ its offline-stub SMS/telephony dependency) is
  // registered here too, not only in `CommunicationsModule` — it isn't
  // exported there, so Scheduling gets its own module-scoped instance rather
  // than a cross-module export change. Both instances are stateless beyond
  // provider selection at construction (env-driven, `sendSystemSms` reuses
  // the same Twilio-or-offline-stub selection as every other comms send), so
  // this is safe: the reminder seam (`sendReminder` below) now actually
  // delivers via `CommunicationsService.sendSystemSms` instead of a no-op event.
  providers: [SchedulingService, CommunicationsService, OfflineStubAdapter],
})
export class SchedulingModule {}
