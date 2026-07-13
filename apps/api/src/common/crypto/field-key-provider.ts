/**
 * Key-provider abstraction for field-level PHI encryption
 * (docs/technical/06-security-and-rbac.md §7 "Field-level (special category)").
 *
 * `FieldCipherService` (./field-cipher.ts) never reads `process.env` or talks
 * to a KMS directly — it only calls methods on whatever `FieldKeyProvider`
 * is bound to the `FIELD_KEY_PROVIDER` token in `field-cipher.module.ts`.
 * That is the seam: swapping the env-based provider below for one backed by
 * AWS KMS (e.g. `kms:GenerateDataKey` to mint a per-tenant DEK, unwrapped via
 * `kms:Decrypt` and cached in memory) is a change to ONE file plus ONE line
 * in the module's `provide: FIELD_KEY_PROVIDER` binding — every call site in
 * clinical-documentation/risk stays untouched because they only depend on
 * `FieldCipherService.encryptJson`/`decryptJson`, never on where the key
 * came from.
 */

export interface FieldKeyMaterial {
  /** Raw 32-byte symmetric key. */
  key: Buffer;
  /**
   * Key identifier written into envelopes (`kid`) so rotation can select the
   * correct decrypt key. Defaults to `v1` when unset.
   */
  id: string;
}

export interface FieldKeyProvider {
  /**
   * Resolves the raw 32-byte symmetric master key, or `null` when field-level
   * encryption is not configured (activate-on-config: absence is a valid,
   * fully-supported state — plaintext behavior, never a fabricated key).
   */
  getKey(): Promise<Buffer | null>;

  /**
   * Optional key id for envelopes. When omitted, cipher uses `v1` if a key
   * is present. KMS providers should return the CMK/alias version string.
   */
  getKeyId?(): Promise<string | null>;

  /**
   * Previous keys retained for decrypt-only during rotation.
   * Encrypt always uses `getKey()`; decrypt tries current then previous.
   */
  getPreviousKeys?(): Promise<FieldKeyMaterial[]>;
}

export const FIELD_KEY_PROVIDER = Symbol('FIELD_KEY_PROVIDER');

function decodeKey(raw: string, envName: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), 'base64');
  } catch {
    throw new Error(
      `[security] ${envName} is set but is not valid base64. Refusing to start with a malformed ` +
        'field-encryption key — generate one with: openssl rand -base64 32',
    );
  }
  if (key.length !== 32) {
    throw new Error(
      `[security] ${envName} must decode to exactly 32 bytes (got ${key.length}). Refusing to start with an ` +
        'insecure/malformed field-encryption key — generate one with: openssl rand -base64 32',
    );
  }
  return key;
}

/**
 * Default provider: resolves the master key from `VPSY_FIELD_KEY` (base64,
 * must decode to exactly 32 bytes) in the process environment. Follows the
 * same fail-fast contract as `common/config/jwt-secrets.ts`: a key that is
 * SET but malformed throws at resolution time (refuse to start with a
 * broken key) rather than silently falling back to plaintext or a weaker
 * derived key.
 *
 * Rotation (env dual-key, no KMS required for staging):
 *   VPSY_FIELD_KEY           — current encrypt key
 *   VPSY_FIELD_KEY_ID        — optional kid written into new envelopes (default v1)
 *   VPSY_FIELD_KEY_PREVIOUS  — optional previous key (decrypt-only)
 *   VPSY_FIELD_KEY_PREVIOUS_ID — optional kid for previous (default v0)
 *
 * Production path still swaps this class for a KMS-backed provider that
 * returns the same Buffer / id shapes.
 */
export class EnvFieldKeyProvider implements FieldKeyProvider {
  async getKey(): Promise<Buffer | null> {
    const raw = process.env.VPSY_FIELD_KEY;
    if (!raw || raw.trim().length === 0) return null;
    return decodeKey(raw, 'VPSY_FIELD_KEY');
  }

  async getKeyId(): Promise<string | null> {
    const key = await this.getKey();
    if (!key) return null;
    const id = process.env.VPSY_FIELD_KEY_ID?.trim();
    return id && id.length > 0 ? id : 'v1';
  }

  async getPreviousKeys(): Promise<FieldKeyMaterial[]> {
    const raw = process.env.VPSY_FIELD_KEY_PREVIOUS;
    if (!raw || raw.trim().length === 0) return [];
    const key = decodeKey(raw, 'VPSY_FIELD_KEY_PREVIOUS');
    const id = process.env.VPSY_FIELD_KEY_PREVIOUS_ID?.trim() || 'v0';
    return [{ key, id }];
  }
}
