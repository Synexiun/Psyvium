import { Global, Module } from '@nestjs/common';
import { AiGatewayService } from './ai-gateway.service';

@Global()
@Module({
  providers: [AiGatewayService],
  exports: [AiGatewayService],
})
export class AiGatewayModule {}
