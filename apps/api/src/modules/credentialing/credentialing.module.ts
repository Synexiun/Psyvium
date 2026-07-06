import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CredentialingController } from './credentialing.controller';
import { CredentialingService } from './credentialing.service';

/**
 * Exports CredentialingService so clinical-write modules (session notes,
 * treatment planning, psychometrics) can resolve `ClinicalWriteGuard`'s
 * dependency without a circular import back into common/auth.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [CredentialingController],
  providers: [CredentialingService],
  exports: [CredentialingService],
})
export class CredentialingModule {}
