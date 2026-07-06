import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CredentialingModule } from '../credentialing/credentialing.module';
import { DiagnosisController, FormulationController } from './diagnosis.controller';
import { DiagnosisService } from './diagnosis.service';

@Module({
  imports: [JwtModule.register({}), CredentialingModule],
  controllers: [DiagnosisController, FormulationController],
  providers: [DiagnosisService],
})
export class DiagnosisModule {}
