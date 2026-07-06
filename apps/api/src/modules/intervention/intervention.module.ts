import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CredentialingModule } from '../credentialing/credentialing.module';
import { InterventionController } from './intervention.controller';
import { InterventionService } from './intervention.service';

@Module({
  imports: [JwtModule.register({}), CredentialingModule],
  controllers: [InterventionController],
  providers: [InterventionService],
})
export class InterventionModule {}
