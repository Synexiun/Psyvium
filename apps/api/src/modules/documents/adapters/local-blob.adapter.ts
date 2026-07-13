import { createHmac, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type {
  BlobStorageProvider,
  PresignDownloadResult,
  PresignUploadInput,
  PresignUploadResult,
} from '../ports/blob-storage.port';

/**
 * Local filesystem blob backend for staging (VPSY_DOCUMENT_BLOB_BACKEND=local).
 * Stores under VPSY_DOCUMENT_LOCAL_DIR (default ./data/document-blobs).
 * Upload/download "presign" URLs are opaque signed paths the API serves.
 */
export class LocalBlobAdapter implements BlobStorageProvider {
  readonly backend = 'local' as const;
  private readonly logger = new Logger(LocalBlobAdapter.name);
  private readonly root: string;
  private readonly secret: string;

  constructor(root?: string, secret?: string) {
    this.root = root ?? process.env.VPSY_DOCUMENT_LOCAL_DIR ?? join(process.cwd(), 'data', 'document-blobs');
    this.secret =
      secret ??
      process.env.VPSY_DOCUMENT_SIGNING_SECRET ??
      process.env.JWT_ACCESS_SECRET ??
      'local-doc-dev-secret-change-me';
  }

  static fromEnv(): LocalBlobAdapter | null {
    if (process.env.VPSY_DOCUMENT_BLOB_BACKEND === 'local') {
      return new LocalBlobAdapter();
    }
    return null;
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async presignUpload(input: PresignUploadInput): Promise<PresignUploadResult> {
    await this.ensureRoot();
    const safeName = (input.fileName ?? 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const storageKey = `${input.tenantId}/${input.ownerType}/${input.ownerId}/${randomUUID()}-${safeName}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const sig = this.sign(`PUT:${storageKey}:${expiresAt}`);
    const uploadUrl = `/api/v1/documents/blob/upload?key=${encodeURIComponent(storageKey)}&exp=${encodeURIComponent(expiresAt)}&sig=${sig}`;
    this.logger.debug(`Local presign upload key=${storageKey}`);
    return {
      storageKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresAt,
      backend: 'local',
    };
  }

  async presignDownload(storageKey: string, _mimeType: string): Promise<PresignDownloadResult> {
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const sig = this.sign(`GET:${storageKey}:${expiresAt}`);
    const downloadUrl = `/api/v1/documents/blob/download?key=${encodeURIComponent(storageKey)}&exp=${encodeURIComponent(expiresAt)}&sig=${sig}`;
    return { downloadUrl, expiresAt, backend: 'local' };
  }

  async putObject(storageKey: string, body: Buffer): Promise<void> {
    await this.ensureRoot();
    const full = join(this.root, storageKey);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, body);
  }

  async getObject(storageKey: string, opts?: { maxBytes?: number }): Promise<Buffer> {
    const buf = await readFile(join(this.root, storageKey));
    if (opts?.maxBytes != null && buf.length > opts.maxBytes) {
      throw new Error(`Local object ${buf.length} bytes exceeds max ${opts.maxBytes}`);
    }
    return buf;
  }

  async headObject(storageKey: string): Promise<{ exists: boolean; sizeBytes?: number }> {
    try {
      await access(join(this.root, storageKey));
      const buf = await readFile(join(this.root, storageKey));
      return { exists: true, sizeBytes: buf.length };
    } catch {
      return { exists: false };
    }
  }

  verifySignature(op: 'PUT' | 'GET', storageKey: string, exp: string, sig: string): boolean {
    if (new Date(exp).getTime() < Date.now()) return false;
    const expected = this.sign(`${op}:${storageKey}:${exp}`);
    return expected === sig;
  }

  private sign(material: string): string {
    return createHmac('sha256', this.secret).update(material).digest('hex');
  }
}
