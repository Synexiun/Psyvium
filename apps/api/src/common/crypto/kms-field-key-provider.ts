import { createHash, createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { FieldKeyMaterial, FieldKeyProvider } from './field-key-provider';

/**
 * AWS KMS-backed field key provider (activate-on-config).
 *
 * Required env when VPSY_FIELD_KEY_PROVIDER=kms:
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (or AWS_DEFAULT_REGION)
 *   VPSY_FIELD_DEK_CIPHERTEXT — base64 CiphertextBlob from kms:Encrypt of a 32-byte DEK
 *
 * Optional:
 *   AWS_SESSION_TOKEN
 *   VPSY_FIELD_KEY_ID — kid written into envelopes (defaults to KMS KeyId suffix or "kms")
 *   VPSY_FIELD_KEY_PREVIOUS / VPSY_FIELD_KEY_PREVIOUS_ID — still supported for dual-DEK rotation
 *   VPSY_KMS_ENDPOINT — custom endpoint (LocalStack / VPC endpoint)
 *
 * On boot: one kms:Decrypt call; DEK cached in memory for process lifetime.
 * Never falls back to plaintext when provider=kms and decrypt fails — throws.
 *
 * Pure Node SigV4 — no @aws-sdk dependency (matches S3 blob adapter pattern).
 */
export class KmsFieldKeyProvider implements FieldKeyProvider {
  private readonly logger = new Logger(KmsFieldKeyProvider.name);
  private cached: { key: Buffer; id: string } | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(
    private readonly accessKeyId: string,
    private readonly secretAccessKey: string,
    private readonly region: string,
    private readonly ciphertextBlobB64: string,
    private readonly sessionToken?: string,
    private readonly endpoint?: string,
    private readonly explicitKeyId?: string,
  ) {}

  static fromEnv(): KmsFieldKeyProvider | null {
    if ((process.env.VPSY_FIELD_KEY_PROVIDER ?? '').toLowerCase() !== 'kms') return null;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
    const region = (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || '').trim();
    const ciphertext = process.env.VPSY_FIELD_DEK_CIPHERTEXT?.trim();
    if (!accessKeyId || !secretAccessKey || !region || !ciphertext) {
      throw new Error(
        '[security] VPSY_FIELD_KEY_PROVIDER=kms requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, ' +
          'AWS_REGION, and VPSY_FIELD_DEK_CIPHERTEXT (base64 KMS CiphertextBlob of a 32-byte DEK).',
      );
    }
    return new KmsFieldKeyProvider(
      accessKeyId,
      secretAccessKey,
      region,
      ciphertext,
      process.env.AWS_SESSION_TOKEN?.trim() || undefined,
      process.env.VPSY_KMS_ENDPOINT?.trim() || undefined,
      process.env.VPSY_FIELD_KEY_ID?.trim() || undefined,
    );
  }

  async getKey(): Promise<Buffer | null> {
    await this.ensureLoaded();
    return this.cached?.key ?? null;
  }

  async getKeyId(): Promise<string | null> {
    await this.ensureLoaded();
    return this.cached?.id ?? null;
  }

  async getPreviousKeys(): Promise<FieldKeyMaterial[]> {
    // Same dual-key env rotation as EnvFieldKeyProvider (previous plaintext DEKs).
    const raw = process.env.VPSY_FIELD_KEY_PREVIOUS;
    if (!raw || raw.trim().length === 0) return [];
    let key: Buffer;
    try {
      key = Buffer.from(raw.trim(), 'base64');
    } catch {
      throw new Error('[security] VPSY_FIELD_KEY_PREVIOUS is not valid base64');
    }
    if (key.length !== 32) {
      throw new Error(
        `[security] VPSY_FIELD_KEY_PREVIOUS must decode to 32 bytes (got ${key.length})`,
      );
    }
    const id = process.env.VPSY_FIELD_KEY_PREVIOUS_ID?.trim() || 'v0';
    return [{ key, id }];
  }

  private async ensureLoaded(): Promise<void> {
    if (this.cached) return;
    if (!this.loadPromise) {
      this.loadPromise = this.decryptDek().catch((err) => {
        this.loadPromise = null;
        throw err;
      });
    }
    await this.loadPromise;
  }

  private async decryptDek(): Promise<void> {
    const body = JSON.stringify({ CiphertextBlob: this.ciphertextBlobB64 });
    const host = this.endpoint
      ? new URL(this.endpoint).host
      : `kms.${this.region}.amazonaws.com`;
    const url = this.endpoint
      ? `${this.endpoint.replace(/\/+$/, '')}/`
      : `https://kms.${this.region}.amazonaws.com/`;

    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body);
    const headers: Record<string, string> = {
      'content-type': 'application/x-amz-json-1.1',
      host,
      'x-amz-date': amzDate,
      'x-amz-target': 'TrentService.Decrypt',
    };
    if (this.sessionToken) {
      headers['x-amz-security-token'] = this.sessionToken;
    }

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${headers[k]!.trim()}\n`).join('');
    const signedHeaders = signedHeaderNames.join(';');
    const canonicalRequest = [
      'POST',
      '/',
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${this.region}/kms/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');
    const signingKey = getSignatureKey(this.secretAccessKey, dateStamp, this.region, 'kms');
    const signature = hmacHex(signingKey, stringToSign);
    headers.authorization =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `[security] KMS Decrypt failed status=${res.status}: ${text.slice(0, 200)}`,
      );
    }
    let parsed: { Plaintext?: string; KeyId?: string };
    try {
      parsed = JSON.parse(text) as { Plaintext?: string; KeyId?: string };
    } catch {
      throw new Error('[security] KMS Decrypt returned non-JSON body');
    }
    if (!parsed.Plaintext) {
      throw new Error('[security] KMS Decrypt response missing Plaintext');
    }
    const key = Buffer.from(parsed.Plaintext, 'base64');
    if (key.length !== 32) {
      throw new Error(
        `[security] KMS-unwrapped DEK must be 32 bytes (got ${key.length}) — refuse to start`,
      );
    }
    const id =
      this.explicitKeyId ||
      (parsed.KeyId ? parsed.KeyId.split('/').pop() || 'kms' : 'kms');
    this.cached = { key, id };
    this.logger.log(`[security] Field DEK unwrapped via KMS (kid=${id})`);
  }
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
