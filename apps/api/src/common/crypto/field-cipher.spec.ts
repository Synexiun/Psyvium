import { FieldCipherService } from './field-cipher';
import { EnvFieldKeyProvider, type FieldKeyProvider } from './field-key-provider';

/**
 * Wave D P0 — field-level PHI encryption (docs/technical/06-security-and-rbac.md
 * §7). These pin the cipher's core contract in isolation, independent of the
 * clinical-documentation/risk call sites that consume it.
 */

const TEST_KEY = Buffer.alloc(32, 7); // deterministic, valid 32-byte key
const OTHER_KEY = Buffer.alloc(32, 9);

function cipherWithKey(key: Buffer | null): FieldCipherService {
  const provider: FieldKeyProvider = { getKey: async () => key };
  return new FieldCipherService(provider);
}

describe('FieldCipherService', () => {
  it('round-trips a JSON value under a configured key (encryptJson -> decryptJson)', async () => {
    const cipher = cipherWithKey(TEST_KEY);
    const value = { format: 'SOAP', subjective: 'Client reports low mood.', objective: 'Flat affect.' };

    const envelope = await cipher.encryptJson(value, 'tenant_a');
    expect(envelope).toMatchObject({ __vpsy_enc: 1, alg: 'xchacha20poly1305' });
    expect(JSON.stringify(envelope)).not.toContain('low mood'); // ciphertext, not plaintext, at rest

    const decrypted = await cipher.decryptJson(envelope, 'tenant_a');
    expect(decrypted).toEqual(value);
  });

  it('round-trips the String[] shim (encryptStringArray -> decryptStringArray)', async () => {
    const cipher = cipherWithKey(TEST_KEY);
    const value = ['Isolating from friends', 'Giving away possessions'];

    const stored = await cipher.encryptStringArray(value, 'tenant_a');
    expect(stored).toHaveLength(1); // shim: single-element array holding the stringified envelope
    expect(stored[0]).not.toContain('Isolating');

    const decrypted = await cipher.decryptStringArray(stored, 'tenant_a');
    expect(decrypted).toEqual(value);
  });

  it('round-trips the String shim (encryptString -> decryptString) used for environmentSafety', async () => {
    const cipher = cipherWithKey(TEST_KEY);
    const value = 'Firearms removed from the home by a family member.';

    const stored = await cipher.encryptString(value, 'tenant_a');
    expect(stored).not.toBe(value);
    expect(stored).not.toContain('Firearms');

    const decrypted = await cipher.decryptString(stored, 'tenant_a');
    expect(decrypted).toBe(value);
  });

  it('passthrough: plaintext written before VPSY_FIELD_KEY existed stays readable once a key IS configured', async () => {
    const cipher = cipherWithKey(TEST_KEY);

    // Old plaintext JSON row (never an envelope).
    const plainJson = { format: 'SOAP', subjective: 'legacy plaintext note' };
    await expect(cipher.decryptJson(plainJson, 'tenant_a')).resolves.toEqual(plainJson);

    // Old plaintext String[] row (ordinary multi-element array, not the shim shape).
    const plainArray = ['Isolating from friends', 'Reduced sleep'];
    await expect(cipher.decryptStringArray(plainArray, 'tenant_a')).resolves.toEqual(plainArray);

    // Old plaintext String row (ordinary text, not JSON at all).
    const plainText = 'Means restriction counseling provided.';
    await expect(cipher.decryptString(plainText, 'tenant_a')).resolves.toBe(plainText);
  });

  it('cross-tenant AAD failure: an envelope sealed under one tenantId cannot be decrypted under another', async () => {
    const cipher = cipherWithKey(TEST_KEY);
    const envelope = await cipher.encryptJson({ secret: 'tenant A PHI' }, 'tenant_a');

    await expect(cipher.decryptJson(envelope, 'tenant_b')).rejects.toThrow(/decryption failed/i);
    // Sanity: the SAME tenantId still opens it.
    await expect(cipher.decryptJson(envelope, 'tenant_a')).resolves.toEqual({ secret: 'tenant A PHI' });
  });

  it('cross-tenant AAD failure also applies when the wrong master key is used', async () => {
    const sealed = cipherWithKey(TEST_KEY);
    const envelope = await sealed.encryptJson({ secret: 'x' }, 'tenant_a');

    const wrongKey = cipherWithKey(OTHER_KEY);
    await expect(wrongKey.decryptJson(envelope, 'tenant_a')).rejects.toThrow(/decryption failed/i);
  });

  it('disabled mode (no key configured): every method is a byte-identical passthrough, never half-encrypts', async () => {
    const cipher = cipherWithKey(null);
    expect(cipher.isActive).toBe(false);

    const jsonValue = { format: 'SOAP', subjective: 'plaintext by design' };
    await expect(cipher.encryptJson(jsonValue, 'tenant_a')).resolves.toBe(jsonValue);
    await expect(cipher.decryptJson(jsonValue, 'tenant_a')).resolves.toBe(jsonValue);

    const arrayValue = ['Isolating from friends'];
    await expect(cipher.encryptStringArray(arrayValue, 'tenant_a')).resolves.toBe(arrayValue);
    await expect(cipher.decryptStringArray(arrayValue, 'tenant_a')).resolves.toBe(arrayValue);

    const stringValue = 'Firearms secured off-site.';
    await expect(cipher.encryptString(stringValue, 'tenant_a')).resolves.toBe(stringValue);
    await expect(cipher.decryptString(stringValue, 'tenant_a')).resolves.toBe(stringValue);
  });

  it('an encrypted field encountered with no key configured throws rather than fabricating plaintext', async () => {
    const sealed = cipherWithKey(TEST_KEY);
    const envelope = await sealed.encryptJson({ secret: 'x' }, 'tenant_a');

    const disabled = cipherWithKey(null);
    await expect(disabled.decryptJson(envelope, 'tenant_a')).rejects.toThrow(/VPSY_FIELD_KEY is not set/);
  });

  it('writes kid on new envelopes and decrypts after key rotation via previous key', async () => {
    const oldKey = TEST_KEY;
    const newKey = OTHER_KEY;
    const sealed = new FieldCipherService({
      getKey: async () => oldKey,
      getKeyId: async () => 'v0',
    });
    const envelope = await sealed.encryptJson({ secret: 'rotate-me' }, 'tenant_a');
    expect(envelope).toMatchObject({ kid: 'v0' });

    const rotated = new FieldCipherService({
      getKey: async () => newKey,
      getKeyId: async () => 'v1',
      getPreviousKeys: async () => [{ id: 'v0', key: oldKey }],
    });
    await expect(rotated.decryptJson(envelope, 'tenant_a')).resolves.toEqual({ secret: 'rotate-me' });

    // New writes use the new kid
    const next = await rotated.encryptJson({ secret: 'new' }, 'tenant_a');
    expect(next).toMatchObject({ kid: 'v1' });
    await expect(rotated.decryptJson(next, 'tenant_a')).resolves.toEqual({ secret: 'new' });
  });

  describe('EnvFieldKeyProvider — fail-fast (jwt-secrets.ts pattern)', () => {
    const ORIGINAL_ENV = process.env.VPSY_FIELD_KEY;
    const ORIGINAL_ID = process.env.VPSY_FIELD_KEY_ID;
    const ORIGINAL_PREV = process.env.VPSY_FIELD_KEY_PREVIOUS;
    const ORIGINAL_PREV_ID = process.env.VPSY_FIELD_KEY_PREVIOUS_ID;
    afterEach(() => {
      if (ORIGINAL_ENV === undefined) delete process.env.VPSY_FIELD_KEY;
      else process.env.VPSY_FIELD_KEY = ORIGINAL_ENV;
      if (ORIGINAL_ID === undefined) delete process.env.VPSY_FIELD_KEY_ID;
      else process.env.VPSY_FIELD_KEY_ID = ORIGINAL_ID;
      if (ORIGINAL_PREV === undefined) delete process.env.VPSY_FIELD_KEY_PREVIOUS;
      else process.env.VPSY_FIELD_KEY_PREVIOUS = ORIGINAL_PREV;
      if (ORIGINAL_PREV_ID === undefined) delete process.env.VPSY_FIELD_KEY_PREVIOUS_ID;
      else process.env.VPSY_FIELD_KEY_PREVIOUS_ID = ORIGINAL_PREV_ID;
    });

    it('resolves null (disabled) when VPSY_FIELD_KEY is unset', async () => {
      delete process.env.VPSY_FIELD_KEY;
      await expect(new EnvFieldKeyProvider().getKey()).resolves.toBeNull();
    });

    it('fails fast when VPSY_FIELD_KEY does not decode to 32 bytes', async () => {
      process.env.VPSY_FIELD_KEY = Buffer.alloc(16, 1).toString('base64'); // too short
      await expect(new EnvFieldKeyProvider().getKey()).rejects.toThrow(/32 bytes/);
    });

    it('resolves a valid 32-byte base64 key', async () => {
      process.env.VPSY_FIELD_KEY = TEST_KEY.toString('base64');
      const key = await new EnvFieldKeyProvider().getKey();
      expect(key).toEqual(TEST_KEY);
    });

    it('exposes key id and previous key for rotation', async () => {
      process.env.VPSY_FIELD_KEY = TEST_KEY.toString('base64');
      process.env.VPSY_FIELD_KEY_ID = 'v2';
      process.env.VPSY_FIELD_KEY_PREVIOUS = OTHER_KEY.toString('base64');
      process.env.VPSY_FIELD_KEY_PREVIOUS_ID = 'v1';
      const provider = new EnvFieldKeyProvider();
      await expect(provider.getKeyId()).resolves.toBe('v2');
      await expect(provider.getPreviousKeys()).resolves.toEqual([{ id: 'v1', key: OTHER_KEY }]);
    });
  });
});
