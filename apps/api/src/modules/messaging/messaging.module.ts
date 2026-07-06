import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [MessagingController],
  providers: [MessagingService],
})
export class MessagingModule {}
