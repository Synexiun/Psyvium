import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FieldCipherModule } from '../../common/crypto/field-cipher.module';
import { CommunicationsController } from './communications.controller';
import { CommunicationsService } from './communications.service';
import { OfflineStubAdapter } from './adapters/offline-stub.adapter';
import { TwilioVoiceWebhookController } from './webhooks/twilio-voice-webhook.controller';
import { TwilioSmsWebhookController } from './webhooks/twilio-sms-webhook.controller';

@Module({
  imports: [JwtModule.register({}), FieldCipherModule],
  controllers: [CommunicationsController, TwilioVoiceWebhookController, TwilioSmsWebhookController],
  providers: [CommunicationsService, OfflineStubAdapter],
})
export class CommunicationsModule {}
