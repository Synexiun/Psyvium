import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CredentialingModule } from '../credentialing/credentialing.module';
import { PsychometricsController } from './psychometrics.controller';
import { PsychometricsService } from './psychometrics.service';
import { ScoringService } from './scoring.service';
import { IrtScoringService } from './irt-scoring.service';
import { CatSelectionService } from './cat-selection.service';
import { CatService } from './cat.service';
import { DifService } from './dif.service';

@Module({
  imports: [JwtModule.register({}), CredentialingModule],
  controllers: [PsychometricsController],
  providers: [
    PsychometricsService,
    ScoringService,
    IrtScoringService,
    CatSelectionService,
    CatService,
    DifService,
  ],
  exports: [ScoringService, IrtScoringService, DifService],
})
export class PsychometricsModule {}
