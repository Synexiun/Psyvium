import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { OfflineStubAdapter } from './adapters/offline-stub.adapter';

@Module({
  imports: [JwtModule.register({})],
  controllers: [CommunicationsController],
  providers: [CommunicationsService, OfflineStubAdapter],
})
export class CommunicationsModule {}
