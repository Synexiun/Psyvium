import { Module } from '@nestjs/common';
import { FieldCipherService } from './field-cipher';
import { EnvFieldKeyProvider, FIELD_KEY_PROVIDER, type FieldKeyProvider } from './field-key-provider';
import { KmsFieldKeyProvider } from './kms-field-key-provider';

/**
 * Binds `FieldCipherService` to the active key provider:
 *   VPSY_FIELD_KEY_PROVIDER=kms → KmsFieldKeyProvider (unwrap DEK via kms:Decrypt)
 *   else → EnvFieldKeyProvider (VPSY_FIELD_KEY base64 DEK)
 *
 * Call sites only depend on FieldCipherService; swap is DI-only.
 */
function resolveFieldKeyProvider(): FieldKeyProvider {
  const kms = KmsFieldKeyProvider.fromEnv();
  if (kms) return kms;
  return new EnvFieldKeyProvider();
}

@Module({
  providers: [
    { provide: FIELD_KEY_PROVIDER, useFactory: resolveFieldKeyProvider },
    FieldCipherService,
  ],
  exports: [FieldCipherService],
})
export class FieldCipherModule {}
