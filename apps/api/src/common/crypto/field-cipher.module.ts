import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { FieldCipherService } from './field-cipher';
import { EnvFieldKeyProvider, FIELD_KEY_PROVIDER, type FieldKeyProvider } from './field-key-provider';
import { KmsFieldKeyProvider } from './kms-field-key-provider';
import { FieldReencryptService } from './field-reencrypt.service';
import { SecurityStatusService } from './security-status.service';
import { SiemModule } from '../siem/siem.module';

/**
 * Binds `FieldCipherService` to the active key provider:
 *   VPSY_FIELD_KEY_PROVIDER=kms → KmsFieldKeyProvider (unwrap DEK via kms:Decrypt)
 *   else → EnvFieldKeyProvider (VPSY_FIELD_KEY base64 DEK)
 *
 * Also hosts field re-encrypt worker + security status aggregate.
 */
function resolveFieldKeyProvider(): FieldKeyProvider {
  const kms = KmsFieldKeyProvider.fromEnv();
  if (kms) return kms;
  return new EnvFieldKeyProvider();
}

@Module({
  imports: [ScheduleModule.forRoot(), SiemModule],
  providers: [
    { provide: FIELD_KEY_PROVIDER, useFactory: resolveFieldKeyProvider },
    FieldCipherService,
    FieldReencryptService,
    SecurityStatusService,
  ],
  exports: [FieldCipherService, FieldReencryptService, SecurityStatusService],
})
export class FieldCipherModule {}
