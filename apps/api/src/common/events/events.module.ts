import { Global, Module } from '@nestjs/common';
import { DpoAlertSubscriber } from './dpo-alert.subscriber';
import { EventBus } from './event-bus.service';

@Global()
@Module({
  providers: [EventBus, DpoAlertSubscriber],
  exports: [EventBus],
})
export class EventsModule {}
