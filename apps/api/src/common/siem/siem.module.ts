import { Global, Module } from '@nestjs/common';
import { SiemExportService } from './siem-export.service';

@Global()
@Module({
  providers: [SiemExportService],
  exports: [SiemExportService],
})
export class SiemModule {}
