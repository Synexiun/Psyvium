import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeBridgeService } from './realtime-bridge.service';

/**
 * Real-time push infrastructure (SP3 — "live push, without lag"). Depends
 * only on the EventBus abstraction (global) — never on another bounded
 * context's internals — so this stays cross-cutting infrastructure, exactly
 * like `EventsModule`/`AuditModule`, rather than a context of its own.
 */
@Module({
  imports: [JwtModule.register({})],
  providers: [RealtimeGateway, RealtimeBridgeService],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
