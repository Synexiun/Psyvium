/**
 * Document object storage port (presigned upload/download).
 * Activate-on-key backends; metadata-only mode remains the fail-closed default.
 */

export interface PresignUploadInput {
  tenantId: string;
  ownerType: string;
  ownerId: string;
  category: string;
  mimeType: string;
  sizeBytes: number;
  /** Original filename for key suffix only — never trusted as path. */
  fileName?: string;
}

export interface PresignUploadResult {
  storageKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
  backend: 'local' | 's3';
}

export interface PresignDownloadResult {
  downloadUrl: string;
  expiresAt: string;
  backend: 'local' | 's3';
}

export interface BlobStorageProvider {
  readonly backend: 'local' | 's3';
  presignUpload(input: PresignUploadInput): Promise<PresignUploadResult>;
  presignDownload(storageKey: string, mimeType: string): Promise<PresignDownloadResult>;
  /**
   * Server-side object load for malware scan (and similar workers).
   * Local: filesystem read. S3: short-lived SigV4 GET + fetch.
   */
  getObject?(storageKey: string, opts?: { maxBytes?: number }): Promise<Buffer>;
  /** Optional: mark scan status externally; local backend can no-op. */
  headObject?(storageKey: string): Promise<{ exists: boolean; sizeBytes?: number }>;
}
