import { KmsFieldKeyProvider } from './kms-field-key-provider';

describe('KmsFieldKeyProvider', () => {
  const prev: Record<string, string | undefined> = {};
  const keys = [
    'VPSY_FIELD_KEY_PROVIDER',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'VPSY_FIELD_DEK_CIPHERTEXT',
    'VPSY_FIELD_KEY_ID',
    'VPSY_FIELD_KEY_PREVIOUS',
    'VPSY_FIELD_KEY_PREVIOUS_ID',
  ];

  beforeEach(() => {
    for (const k of keys) prev[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it('fromEnv returns null when provider is not kms', () => {
    process.env.VPSY_FIELD_KEY_PROVIDER = 'env';
    expect(KmsFieldKeyProvider.fromEnv()).toBeNull();
  });

  it('fromEnv fails fast when kms selected but credentials incomplete', () => {
    process.env.VPSY_FIELD_KEY_PROVIDER = 'kms';
    delete process.env.AWS_ACCESS_KEY_ID;
    expect(() => KmsFieldKeyProvider.fromEnv()).toThrow(/VPSY_FIELD_DEK_CIPHERTEXT|AWS_/);
  });

  it('unwraps DEK from mocked KMS Decrypt response', async () => {
    const dek = Buffer.alloc(32, 3);
    const provider = new KmsFieldKeyProvider(
      'AKIATEST',
      'secretsecretsecret',
      'us-east-1',
      Buffer.from('cipher').toString('base64'),
      undefined,
      undefined,
      'cmk-v3',
    );

    const prevFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          KeyId: 'arn:aws:kms:us-east-1:123:key/cmk-v3',
          Plaintext: dek.toString('base64'),
        }),
    }) as any;

    try {
      const key = await provider.getKey();
      expect(key).toEqual(dek);
      expect(await provider.getKeyId()).toBe('cmk-v3');
      expect(globalThis.fetch).toHaveBeenCalled();
      const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(init.method).toBe('POST');
      expect(init.headers['x-amz-target']).toBe('TrentService.Decrypt');
      expect(init.headers.authorization).toMatch(/AWS4-HMAC-SHA256/);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it('refuses non-32-byte plaintext from KMS', async () => {
    const provider = new KmsFieldKeyProvider(
      'AKIATEST',
      'secretsecretsecret',
      'us-east-1',
      'Y2lwaGVy',
    );
    const prevFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          Plaintext: Buffer.alloc(16, 1).toString('base64'),
        }),
    }) as any;

    try {
      await expect(provider.getKey()).rejects.toThrow(/32 bytes/);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});
