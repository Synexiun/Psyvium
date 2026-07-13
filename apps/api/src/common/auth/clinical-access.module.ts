import { Global, Module } from '@nestjs/common';
import { ClinicalAccessGuard } from './clinical-access.guard';
import { ClinicalAccessService } from './clinical-access.service';

@Global()
@Module({
  providers: [ClinicalAccessService, ClinicalAccessGuard],
  exports: [ClinicalAccessService, ClinicalAccessGuard],
})
export class ClinicalAccessModule {}
