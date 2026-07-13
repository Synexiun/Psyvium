import { Global, Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { DpoAlertSubscriber } from './dpo-alert.subscriber';
import { EventBus } from './event-bus.service';

@Global()
@Module({
  imports: [EmailModule],
  providers: [EventBus, DpoAlertSubscriber],
  exports: [EventBus],
})
export class EventsModule {}
