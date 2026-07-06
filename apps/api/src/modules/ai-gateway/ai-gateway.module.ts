import { Global, Module } from '@nestjs/common';
import { ConsentModule } from '../consent/consent.module';
import { AiGatewayService } from './ai-gateway.service';

@Global()
@Module({
  // ConsentModule: WAVE CR AI-consent gate — AiGatewayService checks
  // ConsentService.hasActiveAiConsent before any real model call.
  imports: [ConsentModule],
  providers: [AiGatewayService],
  exports: [AiGatewayService],
})
export class AiGatewayModule {}
