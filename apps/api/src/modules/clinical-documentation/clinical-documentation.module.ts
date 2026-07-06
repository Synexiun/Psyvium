import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { FieldCipherModule } from '../../common/crypto/field-cipher.module';
import { CredentialingModule } from '../credentialing/credentialing.module';
import { ClinicalDocumentationController } from './clinical-documentation.controller';
import { ClinicalDocumentationService } from './clinical-documentation.service';

@Module({
  imports: [JwtModule.register({}), CredentialingModule, FieldCipherModule],
  controllers: [ClinicalDocumentationController],
  providers: [ClinicalDocumentationService],
})
export class ClinicalDocumentationModule {}
