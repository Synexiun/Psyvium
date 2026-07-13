import { createHash, createHmac, randomUUID } from 'node:crypto';

/**
 * Append-only SIEM event archive to S3 (one object per event — never overwrite).
 * Optional Object Lock headers when the bucket has Object Lock enabled.
 *
 * Env:
 *   VPSY_SIEM_S3_BUCKET
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION
 *   Optional: AWS_SESSION_TOKEN, VPSY_SIEM_S3_PREFIX, VPSY_SIEM_S3_ENDPOINT,
 *             VPSY_SIEM_S3_FORCE_PATH_STYLE=true,
 *             VPSY_SIEM_S3_OBJECT_LOCK_MODE=GOVERNANCE|COMPLIANCE,
 *             VPSY_SIEM_S3_OBJECT_LOCK_DAYS=2555
 */
export class SiemS3Archive {
  constructor(
    private readonly accessKeyId: string,
    private readonly secretAccessKey: string,
    private readonly region: string,
    private readonly bucket: string,
    private readonly prefix: string,
    private readonly sessionToken?: string,
    private readonly endpoint?: string,
    private readonly forcePathStyle = false,
    private readonly lockMode?: 'GOVERNANCE' | 'COMPLIANCE',
    private readonly lockDays?: number,
  ) {}

  static fromEnv(): SiemS3Archive | null {
    const bucket = process.env.VPSY_SIEM_S3_BUCKET?.trim();
    if (!bucket) return null;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
    const region = (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '').trim();
    if (!accessKeyId || !secretAccessKey || !region) {
      throw new Error(
        '[siem] VPSY_SIEM_S3_BUCKET set but AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION incomplete',
      );
    }
    const modeRaw = process.env.VPSY_SIEM_S3_OBJECT_LOCK_MODE?.trim().toUpperCase();
    const lockMode =
      modeRaw === 'GOVERNANCE' || modeRaw === 'COMPLIANCE' ? modeRaw : undefined;
    const lockDays = Number(process.env.VPSY_SIEM_S3_OBJECT_LOCK_DAYS ?? 0) || undefined;
    return new SiemS3Archive(
      accessKeyId,
      secretAccessKey,
      region,
      bucket,
      (process.env.VPSY_SIEM_S3_PREFIX?.trim() || 'siem/').replace(/^\/+/, ''),
      process.env.AWS_SESSION_TOKEN?.trim() || undefined,
      process.env.VPSY_SIEM_S3_ENDPOINT?.trim() || process.env.VPSY_DOCUMENT_S3_ENDPOINT?.trim(),
      process.env.VPSY_SIEM_S3_FORCE_PATH_STYLE === 'true' ||
        process.env.VPSY_DOCUMENT_S3_FORCE_PATH_STYLE === 'true',
      lockMode,
      lockDays && lockDays > 0 ? lockDays : undefined,
    );
  }

  /** Write one immutable event object; returns storage key. */
  async putEvent(jsonLine: string): Promise<string> {
    const day = new Date().toISOString().slice(0, 10);
    const key = `${this.prefix}${day}/${randomUUID()}.json`;
    const body = Buffer.from(`${jsonLine}\n`, 'utf8');
    await this.putObject(key, body, 'application/json');
    return key;
  }

  private async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const host = this.hostHeader();
    const canonicalUri = this.canonicalUri(key);
    const payloadHash = sha256HexBuf(body);

    const headers: Record<string, string> = {
      'content-type': contentType,
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (this.sessionToken) {
      headers['x-amz-security-token'] = this.sessionToken;
    }
    if (this.lockMode && this.lockDays) {
      const until = new Date(Date.now() + this.lockDays * 86_400_000);
      headers['x-amz-object-lock-mode'] = this.lockMode;
      headers['x-amz-object-lock-retain-until-date'] = until.toISOString().replace(/\.\d{3}Z$/, '.000Z');
    }

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${headers[k]!.trim()}\n`).join('');
    const signedHeaders = signedHeaderNames.join(';');
    const canonicalRequest = [
      'PUT',
      canonicalUri,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    const signingKey = getSignatureKey(this.secretAccessKey, dateStamp, this.region, 's3');
    const signature = hmacHex(signingKey, stringToSign);
    headers.authorization =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const url = this.objectUrl(key);
    const res = await fetch(url, { method: 'PUT', headers, body });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`S3 SIEM PUT failed status=${res.status} ${text.slice(0, 200)}`);
    }
  }

  private hostHeader(): string {
    if (this.endpoint) return new URL(this.endpoint).host;
    if (this.forcePathStyle) return `s3.${this.region}.amazonaws.com`;
    return `${this.bucket}.s3.${this.region}.amazonaws.com`;
  }

  private canonicalUri(key: string): string {
    const encodedKey = key
      .split('/')
      .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
      .join('/');
    if (this.forcePathStyle) return `/${this.bucket}/${encodedKey}`;
    return `/${encodedKey}`;
  }

  private objectUrl(key: string): string {
    const encodedKey = key
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    if (this.endpoint) {
      const base = this.endpoint.replace(/\/+$/, '');
      if (this.forcePathStyle) return `${base}/${this.bucket}/${encodedKey}`;
      return `${base}/${encodedKey}`;
    }
    if (this.forcePathStyle) {
      return `https://s3.${this.region}.amazonaws.com/${this.bucket}/${encodedKey}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${encodedKey}`;
  }
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function sha256HexBuf(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
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
