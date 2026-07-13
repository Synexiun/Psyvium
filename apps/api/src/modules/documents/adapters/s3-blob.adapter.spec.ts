import { S3BlobAdapter } from './s3-blob.adapter';

describe('S3BlobAdapter', () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [
      'VPSY_DOCUMENT_BLOB_BACKEND',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_REGION',
      'VPSY_DOCUMENT_S3_BUCKET',
    ]) {
      prev[k] = process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('returns null fromEnv when credentials incomplete', () => {
    process.env.VPSY_DOCUMENT_BLOB_BACKEND = 's3';
    delete process.env.AWS_ACCESS_KEY_ID;
    expect(S3BlobAdapter.fromEnv()).toBeNull();
  });

  it('presigns PUT/GET URLs with SigV4 query params when configured', async () => {
    process.env.VPSY_DOCUMENT_BLOB_BACKEND = 's3';
    process.env.AWS_ACCESS_KEY_ID = 'AKIATEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secretsecretsecret';
    process.env.AWS_REGION = 'us-east-1';
    process.env.VPSY_DOCUMENT_S3_BUCKET = 'vpsy-docs';

    const adapter = S3BlobAdapter.fromEnv();
    expect(adapter).not.toBeNull();

    const put = await adapter!.presignUpload({
      tenantId: 'tenant_1',
      ownerType: 'client',
      ownerId: 'client_1',
      category: 'intake',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      fileName: 'note.pdf',
    });

    expect(put.backend).toBe('s3');
    expect(put.method).toBe('PUT');
    expect(put.uploadUrl).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(put.uploadUrl).toContain('X-Amz-Signature=');
    expect(put.storageKey).toContain('tenant_1/client/client_1/');

    const get = await adapter!.presignDownload(put.storageKey, 'application/pdf');
    expect(get.downloadUrl).toContain('X-Amz-Signature=');
  });
});
