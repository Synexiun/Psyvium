import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Role } from '@vpsy/contracts';
import type { AuthPrincipal, CreateDocumentInput, DocumentDto } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { EventBus } from '../../common/events/event-bus.service';

/**
 * Canonical event name for context 23 (Documents), per
 * docs/technical/01-bounded-contexts.md ("Emits: DocumentUploaded"). Named
 * "uploaded" in the docs even though this module only registers metadata
 * (no binary transfer happens here) — kept as-is to match the documented
 * event vocabulary other contexts may already expect to subscribe to.
 * Published as a literal string — see the same note in intervention.service.ts.
 */
const DOCUMENT_UPLOADED = 'document.uploaded';

const CLIENT_OWNER_TYPE = 'client';

type DocumentRow = {
  id: string;
  ownerType: string;
  ownerId: string;
  category: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  virusScanStatus: string;
  createdAt: Date;
};

/**
 * Documents (context 23). Registers METADATA for a document only — see the
 * honesty note in packages/contracts/src/dto/documents.ts. There is no real
 * blob storage/virus-scan pipeline wired up here; `storageKey` is accepted
 * and returned as an opaque string, and `virusScanStatus` is whatever the
 * DB default ('pending') leaves it at.
 *
 * Production honesty gate (audit Gate 0 §16): metadata-only registration is
 * disabled unless `VPSY_ALLOW_DOCUMENT_METADATA_ONLY=true`. Prefer real blob
 * storage + malware scan before enabling this path for PHI.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly bus: EventBus,
  ) {}

  /**
   * Honest capability status for UI/API consumers.
   *
   * `virusScanStatus` workflow (Document.virusScanStatus string column):
   *   pending  → just registered; not yet scanned (default on create)
   *   clean    → scanner reported no threat (download permitted when blob live)
   *   infected → scanner reported threat; quarantine — never serve bytes
   *   error    → scanner failed; treat as not-clean until re-scanned
   *   skipped  → metadata-only mode; no scanner configured
   * Advancement from `pending` requires a real malware-scan worker (not wired
   * in this module). Admin can list pending rows via `listPendingVirusScan`.
   */
  capabilityStatus(): {
    mode: 'disabled' | 'metadata-only' | 'blob';
    canUpload: boolean;
    canDownload: boolean;
    virusScan: boolean;
    message: string;
    virusScanWorkflow: {
      statuses: Array<'pending' | 'clean' | 'infected' | 'error' | 'skipped'>;
      defaultOnCreate: 'pending' | 'skipped';
      notes: string;
    };
  } {
    const allowMeta =
      process.env.NODE_ENV !== 'production' || process.env.VPSY_ALLOW_DOCUMENT_METADATA_ONLY === 'true';
    const blobReady = process.env.VPSY_DOCUMENT_BLOB_BACKEND === 's3';
    const virusScanEnabled = process.env.VPSY_DOCUMENT_VIRUS_SCAN === 'true';
    const statuses = ['pending', 'clean', 'infected', 'error', 'skipped'] as const;

    if (blobReady) {
      return {
        mode: 'blob',
        canUpload: true,
        canDownload: true,
        virusScan: virusScanEnabled,
        message: virusScanEnabled
          ? 'Object storage + malware scan configured. Downloads should only serve virusScanStatus=clean.'
          : 'Object storage configured but malware scan is OFF (VPSY_DOCUMENT_VIRUS_SCAN≠true) — treat all as untrusted.',
        virusScanWorkflow: {
          statuses: [...statuses],
          defaultOnCreate: virusScanEnabled ? 'pending' : 'skipped',
          notes:
            'Worker must advance pending → clean|infected|error. Never serve infected or error rows to clients.',
        },
      };
    }
    if (allowMeta) {
      return {
        mode: 'metadata-only',
        canUpload: false,
        canDownload: false,
        virusScan: false,
        message:
          'Metadata registration only — no blob storage or malware scan. Not for real PHI documents.',
        virusScanWorkflow: {
          statuses: [...statuses],
          defaultOnCreate: 'skipped',
          notes:
            'DB default is still "pending"; no scanner will advance it in metadata-only mode. Do not trust for PHI.',
        },
      };
    }
    return {
      mode: 'disabled',
      canUpload: false,
      canDownload: false,
      virusScan: false,
      message:
        'Document storage is disabled in production until blob storage + malware scan are configured.',
      virusScanWorkflow: {
        statuses: [...statuses],
        defaultOnCreate: 'skipped',
        notes: 'Create path is ServiceUnavailable until blob + scan are ready.',
      },
    };
  }

  /**
   * Admin/ops view of documents still awaiting malware scan (`virusScanStatus
   * = pending`). Useful once a scanner worker is wired — until then this
   * simply surfaces every metadata registration still sitting at the default.
   */
  async listPendingVirusScan(principal: AuthPrincipal, take = 50): Promise<DocumentDto[]> {
    const documents = await this.prisma.document.findMany({
      where: {
        tenantId: principal.tenantId,
        virusScanStatus: 'pending',
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(take, 1), 200),
    });
    return documents.map((d) => this.toDto(d));
  }

  async create(principal: AuthPrincipal, input: CreateDocumentInput): Promise<DocumentDto> {
    const status = this.capabilityStatus();
    if (status.mode === 'disabled') {
      throw new ServiceUnavailableException(status.message);
    }

    if (input.ownerType === CLIENT_OWNER_TYPE) {
      const client = await this.prisma.client.findFirst({
        where: { id: input.ownerId, tenantId: principal.tenantId },
      });
      if (!client) throw new NotFoundException('Client not found');
    }

    const document = await this.prisma.document.create({
      data: {
        tenantId: principal.tenantId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        category: input.category,
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      },
    });

    await this.audit.record({
      tenantId: principal.tenantId,
      actorId: principal.userId,
      action: 'document.registered',
      entityType: 'Document',
      entityId: document.id,
      after: { ownerType: document.ownerType, ownerId: document.ownerId, category: document.category },
    });
    await this.bus.publish(DOCUMENT_UPLOADED, principal.tenantId, {
      documentId: document.id,
      ownerType: document.ownerType,
      ownerId: document.ownerId,
    });

    return this.toDto(document);
  }

  /**
   * A client's own documents (ownerType='client'); clinician/manager may
   * list any client's. Non-client owner types (should any ever be created)
   * are tenant-scoped only — this module's Wave C brief is client documents.
   */
  async listForClient(principal: AuthPrincipal, clientId: string): Promise<DocumentDto[]> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId: principal.tenantId },
    });
    if (!client) throw new NotFoundException('Client not found');

    if (principal.roles.includes(Role.CLIENT) && client.userId !== principal.userId) {
      throw new ForbiddenException('A client may only view their own documents');
    }

    const documents = await this.prisma.document.findMany({
      where: { tenantId: principal.tenantId, ownerType: CLIENT_OWNER_TYPE, ownerId: clientId },
      orderBy: { createdAt: 'desc' },
    });
    return documents.map((d) => this.toDto(d));
  }

  async getById(principal: AuthPrincipal, id: string): Promise<DocumentDto> {
    const document = await this.prisma.document.findFirst({
      where: { id, tenantId: principal.tenantId },
    });
    if (!document) throw new NotFoundException('Document not found');

    if (document.ownerType === CLIENT_OWNER_TYPE && principal.roles.includes(Role.CLIENT)) {
      const client = await this.prisma.client.findFirst({
        where: { id: document.ownerId, tenantId: principal.tenantId },
      });
      if (!client || client.userId !== principal.userId) {
        throw new ForbiddenException('A client may only view their own documents');
      }
    }

    return this.toDto(document);
  }

  private toDto(d: DocumentRow): DocumentDto {
    return {
      id: d.id,
      ownerType: d.ownerType,
      ownerId: d.ownerId,
      category: d.category,
      storageKey: d.storageKey,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      virusScanStatus: d.virusScanStatus,
      createdAt: d.createdAt.toISOString(),
    };
  }
}
