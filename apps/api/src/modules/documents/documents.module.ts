import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentVirusScanService } from './document-virus-scan.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentVirusScanService],
  exports: [DocumentsService, DocumentVirusScanService],
})
export class DocumentsModule {}
