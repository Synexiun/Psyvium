import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CredentialingModule } from '../credentialing/credentialing.module';
import { TreatmentPlanningController } from './treatment-planning.controller';
import { TreatmentPlanningService } from './treatment-planning.service';

@Module({
  imports: [JwtModule.register({}), CredentialingModule],
  controllers: [TreatmentPlanningController],
  providers: [TreatmentPlanningService],
})
export class TreatmentPlanningModule {}
