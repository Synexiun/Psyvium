import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
