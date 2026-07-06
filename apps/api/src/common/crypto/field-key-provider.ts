/**
 * Key-provider abstraction for field-level PHI encryption
 * (docs/technical/06-security-and-rbac.md §7 "Field-level (special category)").
 *
 * `FieldCipherService` (./field-cipher.ts) never reads `process.env` or talks
 * to a KMS directly — it only calls `getKey()` on whatever `FieldKeyProvider`
 * is bound to the `FIELD_KEY_PROVIDER` token in `field-cipher.module.ts`.
 * That is the seam: swapping the env-based provider below for one backed by
 * AWS KMS (e.g. `kms:GenerateDataKey` to mint a per-tenant DEK, unwrapped via
 * `kms:Decrypt` and cached in memory) is a change to ONE file plus ONE line
 * in the module's `provide: FIELD_KEY_PROVIDER` binding — every call site in
 * clinical-documentation/risk stays untouched because they only depend on
 * `FieldCipherService.encryptJson`/`decryptJson`, never on where the key
 * came from.
 */
export interface FieldKeyProvider {
  /**
   * Resolves the raw 32-byte symmetric master key, or `null` when field-level
   * encryption is not configured (activate-on-config: absence is a valid,
   * fully-supported state — plaintext behavior, never a fabricated key).
   */
  getKey(): Promise<Buffer | null>;
}

export const FIELD_KEY_PROVIDER = Symbol('FIELD_KEY_PROVIDER');

/**
 * Default provider: resolves the master key from `VPSY_FIELD_KEY` (base64,
 * must decode to exactly 32 bytes) in the process environment. Follows the
 * same fail-fast contract as `common/config/jwt-secrets.ts`: a key that is
 * SET but malformed throws at resolution time (refuse to start with a
 * broken key) rather than silently falling back to plaintext or a weaker
 * derived key.
 */
export class EnvFieldKeyProvider implements FieldKeyProvider {
  async getKey(): Promise<Buffer | null> {
    const raw = process.env.VPSY_FIELD_KEY;
    if (!raw || raw.trim().length === 0) return null;

    let key: Buffer;
    try {
      key = Buffer.from(raw.trim(), 'base64');
    } catch {
      throw new Error(
        '[security] VPSY_FIELD_KEY is set but is not valid base64. Refusing to start with a malformed ' +
          'field-encryption key — generate one with: openssl rand -base64 32',
      );
    }
    if (key.length !== 32) {
      throw new Error(
        `[security] VPSY_FIELD_KEY must decode to exactly 32 bytes (got ${key.length}). Refusing to start with an ` +
          'insecure/malformed field-encryption key — generate one with: openssl rand -base64 32',
      );
    }
    return key;
  }
}
