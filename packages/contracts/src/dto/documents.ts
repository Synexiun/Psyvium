import { z } from 'zod';

/**
 * Documents DTOs (context 23 — "Secure uploads, reports, file lifecycle").
 *
 * IMPORTANT — honesty about scope: this registers DOCUMENT METADATA only.
 * The Prisma `Document` model has no `title`/`kind` field and no direct
 * `clientId` — it models ownership generically as `ownerType` + `ownerId`
 * (e.g. ownerType: 'client', ownerId: <Client.id>) plus `category`,
 * `storageKey`, `mimeType`, `sizeBytes`. There is no `title` field on the
 * model at all (flagged as a missing field — not added here per Wave C
 * scope, which excludes schema.prisma changes).
 *
 * Actual binary upload/storage (e.g. presigned S3 URL, virus scan pipeline)
 * is NOT implemented — `storageKey` is accepted/returned as an opaque string
 * the caller already has (or will have) from a real storage integration.
 * `virusScanStatus` defaults to 'pending' at the DB level and is not
 * advanced by this module; wiring a real scanner is a documented follow-up.
 */

export const createDocumentSchema = z.object({
  ownerType: z.string().min(2).max(50).default('client'),
  ownerId: z.string(),
  category: z.string().min(2).max(100),
  storageKey: z.string().min(1).max(1000),
  mimeType: z.string().min(3).max(200),
  sizeBytes: z.number().int().nonnegative(),
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

/** Request a presigned upload URL before registering metadata. */
export const presignDocumentUploadSchema = z.object({
  ownerType: z.string().min(2).max(50).default('client'),
  ownerId: z.string(),
  category: z.string().min(2).max(100),
  mimeType: z.string().min(3).max(200),
  sizeBytes: z.number().int().nonnegative().max(50 * 1024 * 1024),
  fileName: z.string().max(200).optional(),
});
export type PresignDocumentUploadInput = z.infer<typeof presignDocumentUploadSchema>;

export const documentSchema = z.object({
  id: z.string(),
  ownerType: z.string(),
  ownerId: z.string(),
  category: z.string(),
  storageKey: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  virusScanStatus: z.string(),
  createdAt: z.string(),
});
export type DocumentDto = z.infer<typeof documentSchema>;
