import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
// NOTE: intentionally `import ... = require(...)`, NOT `import * as sodium`.
// `libsodium-wrappers` populates its real crypto functions onto its
// `module.exports` object asynchronously (after `sodium.ready` resolves).
// TypeScript's `import * as ns` (via the `__importStar` helper) takes a
// ONE-TIME snapshot of the module's own-property names at import time —
// before that lazy population happens — so every crypto function would
// silently resolve to `undefined` forever, even after awaiting `sodium.ready`.
// `require(...)` keeps the SAME object reference the library mutates in
// place, so property access here is always live.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import sodium = require('libsodium-wrappers');
import { FIELD_KEY_PROVIDER, type FieldKeyProvider } from './field-key-provider';

/** Algorithm tag stored in every envelope — lets a future migration recognize/reject old envelopes safely. */
export const FIELD_ENC_ALG = 'xchacha20poly1305' as const;

/**
 * Storable envelope for one encrypted field (docs/technical/06-security-and-rbac.md
 * §7). `n`/`c` are base64 (standard, not URL-safe — matches the rest of the
 * codebase's use of base64 for opaque blobs). Written into the EXISTING
 * Prisma `Json`/`String`/`String[]` columns — no schema change.
 */
export interface FieldEnvelope {
  __vpsy_enc: 1;
  alg: typeof FIELD_ENC_ALG;
  /** nonce, base64 */
  n: string;
  /** ciphertext (includes the Poly1305 tag), base64 */
  c: string;
}

function isFieldEnvelope(value: unknown): value is FieldEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).__vpsy_enc === 1 &&
    typeof (value as Record<string, unknown>).n === 'string' &&
    typeof (value as Record<string, unknown>).c === 'string'
  );
}

/**
 * Field-level PHI encryption (docs/technical/06-security-and-rbac.md §7):
 * app-managed libsodium XChaCha20-Poly1305 with the master key resolved
 * through `FieldKeyProvider` (see field-key-provider.ts for the AWS-KMS
 * swap-in story). This service is the ONLY place that touches libsodium —
 * callers (ClinicalDocumentationService, RiskService) only ever call
 * `encryptJson`/`decryptJson` (or the String/String[] shims below) and never
 * see nonces, keys, or the envelope shape directly.
 *
 * ACTIVATE-ON-CONFIG (never half-encrypt, never fake it):
 *  - `VPSY_FIELD_KEY` unset  -> `isActive === false` -> every method is a
 *    byte-identical passthrough. Existing behavior, existing tests, existing
 *    plaintext rows: nothing changes.
 *  - `VPSY_FIELD_KEY` set (valid 32-byte base64) -> `isActive === true` ->
 *    new writes are encrypted; reads transparently decrypt ciphertext AND
 *    still read old plaintext rows (see `isFieldEnvelope` passthrough below)
 *    — a mixed cleartext/ciphertext table is the expected steady state
 *    during rollout, not a bug.
 *  - `VPSY_FIELD_KEY` set but malformed (bad base64 / wrong length) -> throws
 *    at boot, same fail-fast contract as `common/config/jwt-secrets.ts`.
 *
 * AAD (additional authenticated data): every encrypt/decrypt binds `tenantId`
 * as AAD. An envelope's ciphertext can only be opened with the SAME tenantId
 * it was sealed under — if a row were ever misrouted/copied across tenants
 * (bug, restore-to-wrong-tenant, etc.), decryption fails loudly instead of
 * silently returning another tenant's PHI. This is defense-in-depth on top
 * of (not a replacement for) the Prisma `tenantId` WHERE-scoping and the
 * Postgres RLS backstop (rls.extension.ts).
 *
 * FOLLOW-UP (not this wave): `warningSigns`/`copingStrategies` on SafetyPlan
 * are native Postgres `String[]` columns, which cannot hold a JSON object.
 * `encryptStringArray`/`decryptStringArray` below store a single-element
 * array containing the STRINGIFIED envelope as a shim so encryption can ship
 * without a schema migration; a follow-up should migrate those two columns
 * to native `Json` (or a side table) so the shim can be retired.
 */
@Injectable()
export class FieldCipherService implements OnModuleInit {
  private readonly logger = new Logger(FieldCipherService.name);
  private key: Uint8Array | null = null;
  private readonly readyPromise: Promise<void>;

  constructor(@Inject(FIELD_KEY_PROVIDER) private readonly keyProvider: FieldKeyProvider) {
    this.readyPromise = this.init();
  }

  async onModuleInit(): Promise<void> {
    await this.readyPromise;
  }

  private async init(): Promise<void> {
    await sodium.ready;
    const key = await this.keyProvider.getKey();
    if (key) {
      this.key = new Uint8Array(key);
      this.logger.log(
        '[security] Field-level PHI encryption ACTIVE (VPSY_FIELD_KEY set) — new SessionNote.content and ' +
          'SafetyPlan writes are encrypted at rest (XChaCha20-Poly1305, tenant-bound AAD).',
      );
    } else {
      // Production must never store clinical fields in cleartext by accident.
      // Local/dev and test keep the honest passthrough so unit suites and
      // offline demos still boot without a KMS key.
      if (process.env.NODE_ENV === 'production' && process.env.VPSY_ALLOW_PLAINTEXT_PHI !== 'true') {
        throw new Error(
          'VPSY_FIELD_KEY is required in production (field-level PHI encryption). ' +
            'Set VPSY_FIELD_KEY (openssl rand -base64 32) or, only for an explicit non-PHI demo, VPSY_ALLOW_PLAINTEXT_PHI=true.',
        );
      }
      this.logger.warn(
        '[security] Field-level PHI encryption DISABLED (VPSY_FIELD_KEY not set) — PHI fields are stored in ' +
          'cleartext. Set VPSY_FIELD_KEY to activate (see .env.example: openssl rand -base64 32).',
      );
    }
  }

  /** True once boot-time key resolution has completed AND a valid key was found. */
  get isActive(): boolean {
    return this.key !== null;
  }

  private async ready(): Promise<void> {
    await this.readyPromise;
  }

  /**
   * Encrypts any JSON-serializable value into a storable envelope, bound to
   * `tenantId` as AAD. Passthrough (returns `value` unchanged) when
   * encryption is disabled.
   */
  async encryptJson(value: unknown, tenantId: string): Promise<unknown> {
    await this.ready();
    if (!this.key) return value;

    const plaintext = sodium.from_string(JSON.stringify(value));
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const aad = sodium.from_string(tenantId);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, aad, null, nonce, this.key);

    const envelope: FieldEnvelope = {
      __vpsy_enc: 1,
      alg: FIELD_ENC_ALG,
      n: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
      c: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    };
    return envelope;
  }

  /**
   * Decrypts a value that MAY be a `FieldEnvelope`.
   *  - Not an envelope (plain old row, or encryption disabled at write time)
   *    -> returned unchanged. This is the backward-compatibility path: rows
   *    written before `VPSY_FIELD_KEY` existed stay readable forever.
   *  - Is an envelope but the tenantId (AAD) doesn't match the one it was
   *    sealed under, or the configured key is wrong/missing -> throws. We
   *    never fabricate a plaintext fallback for ciphertext we can't open.
   */
  async decryptJson(value: unknown, tenantId: string): Promise<unknown> {
    await this.ready();
    if (!isFieldEnvelope(value)) return value;
    if (!this.key) {
      throw new Error(
        '[security] Encountered an encrypted field but VPSY_FIELD_KEY is not set in this process — cannot decrypt.',
      );
    }

    const nonce = sodium.from_base64(value.n, sodium.base64_variants.ORIGINAL);
    const ciphertext = sodium.from_base64(value.c, sodium.base64_variants.ORIGINAL);
    const aad = sodium.from_string(tenantId);

    let plaintext: Uint8Array;
    try {
      plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, aad, nonce, this.key);
    } catch {
      throw new Error(
        '[security] Field decryption failed (wrong key or tenant/AAD mismatch) — refusing to return corrupted ' +
          'or cross-tenant PHI.',
      );
    }
    return JSON.parse(sodium.to_string(plaintext));
  }

  /**
   * Shim for `String[]` columns (SafetyPlan.warningSigns / .copingStrategies)
   * that cannot hold a JSON envelope object natively (see class doc for the
   * documented follow-up). Encrypts the WHOLE array as one envelope and
   * stores it as the sole element of a length-1 string array.
   */
  async encryptStringArray(value: string[], tenantId: string): Promise<string[]> {
    await this.ready();
    if (!this.key) return value;
    const envelope = await this.encryptJson(value, tenantId);
    return [JSON.stringify(envelope)];
  }

  /**
   * Inverse of `encryptStringArray`. Passthrough for anything that isn't the
   * length-1-stringified-envelope shape (plain legacy `String[]` rows).
   */
  async decryptStringArray(value: string[], tenantId: string): Promise<string[]> {
    await this.ready();
    if (!Array.isArray(value) || value.length !== 1) return value;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value[0]!);
    } catch {
      return value; // Not our shim shape — an ordinary one-item legacy array.
    }
    if (!isFieldEnvelope(parsed)) return value;
    const decrypted = await this.decryptJson(parsed, tenantId);
    return decrypted as string[];
  }

  /**
   * Shim for the `environmentSafety` plain `String?` column (SafetyPlan):
   * stores the JSON-stringified envelope directly in the text column.
   */
  async encryptString(value: string | null | undefined, tenantId: string): Promise<string | null | undefined> {
    if (value === null || value === undefined) return value;
    await this.ready();
    if (!this.key) return value;
    const envelope = await this.encryptJson(value, tenantId);
    return JSON.stringify(envelope);
  }

  /** Inverse of `encryptString`. Passthrough for plain legacy text (including text that isn't valid JSON at all). */
  async decryptString(value: string | null | undefined, tenantId: string): Promise<string | null | undefined> {
    if (value === null || value === undefined) return value;
    await this.ready();
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return value; // Plain legacy text (the common case), not JSON at all.
    }
    if (!isFieldEnvelope(parsed)) return value;
    const decrypted = await this.decryptJson(parsed, tenantId);
    return decrypted as string;
  }
}
