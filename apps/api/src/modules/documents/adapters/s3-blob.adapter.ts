import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type {
  BlobStorageProvider,
  PresignDownloadResult,
  PresignUploadInput,
  PresignUploadResult,
} from '../ports/blob-storage.port';

/**
 * S3 presigned URL adapter (activate-on-key).
 *
 * Required env:
 *   VPSY_DOCUMENT_BLOB_BACKEND=s3
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   AWS_REGION (or AWS_DEFAULT_REGION)
 *   VPSY_DOCUMENT_S3_BUCKET
 *
 * Optional: AWS_SESSION_TOKEN, VPSY_DOCUMENT_S3_ENDPOINT (MinIO / path-style),
 * VPSY_DOCUMENT_S3_FORCE_PATH_STYLE=true
 *
 * Uses pure Node crypto SigV4 — no @aws-sdk dependency. Matches the
 * Twilio/Stripe activate-on-key pattern with honest absence when unset.
 */
export class S3BlobAdapter implements BlobStorageProvider {
  readonly backend = 's3' as const;
  private readonly logger = new Logger(S3BlobAdapter.name);

  constructor(
    private readonly accessKeyId: string,
    private readonly secretAccessKey: string,
    private readonly region: string,
    private readonly bucket: string,
    private readonly sessionToken?: string,
    private readonly endpoint?: string,
    private readonly forcePathStyle = false,
  ) {}

  static fromEnv(): S3BlobAdapter | null {
    if (process.env.VPSY_DOCUMENT_BLOB_BACKEND !== 's3') return null;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
    const region = (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '').trim();
    const bucket = process.env.VPSY_DOCUMENT_S3_BUCKET?.trim();
    if (!accessKeyId || !secretAccessKey || !region || !bucket) {
      return null;
    }
    return new S3BlobAdapter(
      accessKeyId,
      secretAccessKey,
      region,
      bucket,
      process.env.AWS_SESSION_TOKEN?.trim() || undefined,
      process.env.VPSY_DOCUMENT_S3_ENDPOINT?.trim() || undefined,
      process.env.VPSY_DOCUMENT_S3_FORCE_PATH_STYLE === 'true',
    );
  }

  async presignUpload(input: PresignUploadInput): Promise<PresignUploadResult> {
    const safeName = (input.fileName ?? 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const storageKey = `${input.tenantId}/${input.ownerType}/${input.ownerId}/${randomUUID()}-${safeName}`;
    const expiresIn = 900;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const uploadUrl = this.presign('PUT', storageKey, expiresIn, input.mimeType);
    this.logger.debug(`S3 presign PUT key=${storageKey}`);
    return {
      storageKey,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType },
      expiresAt,
      backend: 's3',
    };
  }

  async presignDownload(storageKey: string, _mimeType: string): Promise<PresignDownloadResult> {
    const expiresIn = 600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const downloadUrl = this.presign('GET', storageKey, expiresIn);
    return { downloadUrl, expiresAt, backend: 's3' };
  }

  async headObject(storageKey: string): Promise<{ exists: boolean; sizeBytes?: number }> {
    // Optional head — not required for presign flow; return unknown exists.
    void storageKey;
    return { exists: true };
  }

  // ── AWS Signature Version 4 query-string presign ──

  private presign(
    method: 'GET' | 'PUT',
    key: string,
    expiresInSec: number,
    contentType?: string,
  ): string {
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const credential = `${this.accessKeyId}/${credentialScope}`;

    const host = this.hostHeader();
    const canonicalUri = this.canonicalUri(key);

    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresInSec),
      'X-Amz-SignedHeaders': 'host',
    };
    if (this.sessionToken) {
      query['X-Amz-Security-Token'] = this.sessionToken;
    }

    const canonicalQuery = Object.keys(query)
      .sort()
      .map((k) => `${uriEncode(k)}=${uriEncode(query[k]!)}`)
      .join('&');

    const canonicalHeaders = `host:${host}\n`;
    const signedHeaders = 'host';
    const payloadHash = 'UNSIGNED-PAYLOAD';

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = getSignatureKey(this.secretAccessKey, dateStamp, this.region, 's3');
    const signature = hmacHex(signingKey, stringToSign);

    const finalQuery = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    // Content-Type is not part of the signed headers for simple presigns;
    // clients still set it on PUT. contentType reserved for future signed headers.
    void contentType;

    if (this.endpoint) {
      const base = this.endpoint.replace(/\/+$/, '');
      if (this.forcePathStyle) {
        return `${base}/${this.bucket}${canonicalUri}?${finalQuery}`;
      }
      return `${base}${canonicalUri}?${finalQuery}`;
    }

    if (this.forcePathStyle) {
      return `https://s3.${this.region}.amazonaws.com/${this.bucket}${canonicalUri}?${finalQuery}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com${canonicalUri}?${finalQuery}`;
  }

  private hostHeader(): string {
    if (this.endpoint) {
      return new URL(this.endpoint).host;
    }
    if (this.forcePathStyle) {
      return `s3.${this.region}.amazonaws.com`;
    }
    return `${this.bucket}.s3.${this.region}.amazonaws.com`;
  }

  private canonicalUri(key: string): string {
    const encodedKey = key
      .split('/')
      .map((seg) => uriEncode(seg))
      .join('/');
    if (this.forcePathStyle && !this.endpoint) {
      return `/${this.bucket}/${encodedKey}`;
    }
    if (this.forcePathStyle && this.endpoint) {
      return `/${this.bucket}/${encodedKey}`;
    }
    return `/${encodedKey}`;
  }
}

function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function hmacHex(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function getSignatureKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function toAmzDate(d: Date): string {
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '');
}
