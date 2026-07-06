import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CredentialingModule } from '../credentialing/credentialing.module';
import { PsychometricsController } from './psychometrics.controller';
import { PsychometricsService } from './psychometrics.service';
import { ScoringService } from './scoring.service';

@Module({
  imports: [JwtModule.register({}), CredentialingModule],
  controllers: [PsychometricsController],
  providers: [PsychometricsService, ScoringService],
  exports: [ScoringService],
})
export class PsychometricsModule {}
