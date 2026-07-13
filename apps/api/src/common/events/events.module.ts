import { Global, Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { SiemModule } from '../siem/siem.module';
import { DpoAlertSubscriber } from './dpo-alert.subscriber';
import { EventBus } from './event-bus.service';

@Global()
@Module({
  imports: [EmailModule, SiemModule],
  providers: [EventBus, DpoAlertSubscriber],
  exports: [EventBus],
})
export class EventsModule {}
