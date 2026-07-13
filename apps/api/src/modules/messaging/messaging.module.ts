import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FieldCipherModule } from '../../common/crypto/field-cipher.module';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';

@Module({
  imports: [JwtModule.register({}), FieldCipherModule],
  controllers: [MessagingController],
  providers: [MessagingService],
})
export class MessagingModule {}
