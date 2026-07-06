import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { OutboxRelayService } from './outbox-relay.service';

/**
 * `ScheduleModule.forRoot()` is imported here too, alongside its existing
 * import in `risk.module.ts` — Nest's scheduler discovery scans the whole
 * application's provider graph for `@Interval`/`@Cron`/`@Timeout` decorators
 * regardless of which module registers `ScheduleModule`, and `forRoot()` is
 * called identically (no options) at both sites, so Nest's dynamic-module
 * token dedup treats the two registrations as the same node rather than
 * double-wiring the scheduler — verified empirically at boot (RiskSlaService
 * and OutboxRelayService each fire their `@Interval` once per tick, not
 * twice).
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [OutboxRelayService],
})
export class OutboxModule {}
