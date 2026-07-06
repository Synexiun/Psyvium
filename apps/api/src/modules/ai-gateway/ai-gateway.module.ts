import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConsentModule } from '../consent/consent.module';
import { AiGatewayService } from './ai-gateway.service';
import { AiRiskContextController } from './ai-gateway.controller';

@Global()
@Module({
  // ConsentModule: WAVE CR AI-consent gate — AiGatewayService checks
  // ConsentService.hasActiveAiConsent before any real model call.
  // JwtModule.register({}): AiRiskContextController is guarded by
  // JwtAuthGuard, which needs JwtService injected in this module.
  imports: [ConsentModule, JwtModule.register({})],
  controllers: [AiRiskContextController],
  providers: [AiGatewayService],
  exports: [AiGatewayService],
})
export class AiGatewayModule {}
