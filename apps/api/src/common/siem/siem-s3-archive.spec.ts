import { SiemS3Archive } from './siem-s3-archive';

describe('SiemS3Archive', () => {
  it('fromEnv returns null without bucket', () => {
    const prev = process.env.VPSY_SIEM_S3_BUCKET;
    delete process.env.VPSY_SIEM_S3_BUCKET;
    expect(SiemS3Archive.fromEnv()).toBeNull();
    if (prev !== undefined) process.env.VPSY_SIEM_S3_BUCKET = prev;
  });

  it('putEvent PUTs a unique object with SigV4', async () => {
    const archive = new SiemS3Archive(
      'AKIATEST',
      'secretsecretsecret',
      'us-east-1',
      'vpsy-siem',
      'siem/',
    );
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    const prevFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;
    try {
      const key = await archive.putEvent('{"type":"test"}');
      expect(key).toMatch(/^siem\/\d{4}-\d{2}-\d{2}\//);
      expect(fetchMock).toHaveBeenCalled();
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('vpsy-siem');
      expect(init.method).toBe('PUT');
      expect(init.headers.authorization).toMatch(/AWS4-HMAC-SHA256/);
      expect(init.headers['content-type']).toBe('application/json');
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});
