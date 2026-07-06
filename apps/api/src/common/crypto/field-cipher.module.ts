import { Module } from '@nestjs/common';
import { FieldCipherService } from './field-cipher';
import { EnvFieldKeyProvider, FIELD_KEY_PROVIDER } from './field-key-provider';

/**
 * Binds `FieldCipherService` to the env-based key provider. To swap to AWS
 * KMS later, replace ONLY the `useClass`/`useFactory` binding below (e.g.
 * `useFactory: () => new KmsFieldKeyProvider(...)`) — `FieldCipherService`
 * and every call site (ClinicalDocumentationService, RiskService) are
 * unaffected because they depend on the `FieldKeyProvider` interface, not on
 * this concrete provider.
 */
@Module({
  providers: [
    { provide: FIELD_KEY_PROVIDER, useClass: EnvFieldKeyProvider },
    FieldCipherService,
  ],
  exports: [FieldCipherService],
})
export class FieldCipherModule {}
