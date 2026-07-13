import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { TenantContext } from '../../common/prisma/tenant-context';

const SWEEP_MS = 30_000;
const SYSTEM_ACTOR = 'system.document-virus-scan';

export type VirusScanOutcome = 'clean' | 'infected' | 'error' | 'skipped';

/**
 * Document malware-scan worker skeleton.
 *
 * Activate with VPSY_DOCUMENT_VIRUS_SCAN=true.
 *
 * Scanners (in priority order):
 *  1. CLAMAV_HOST (+ optional CLAMAV_PORT, default 3310) — TCP INSTREAM if reachable
 *  2. VPSY_DOCUMENT_VIRUS_SCAN_STUB=true — staging stub marks clean (never for real PHI)
 *  3. otherwise leaves rows pending and logs (fail-closed honesty)
 *
 * Never serves bytes — DocumentsService download gate still enforces status.
 */
@Injectable()
export class DocumentVirusScanService {
  private readonly logger = new Logger(DocumentVirusScanService.name);
  private running = false;

  /**
   * Test seam for ClamAV TCP — production uses node:net.createConnection.
   * Specs replace this with a fake duplex that emits connect/data/end.
   */
  static createSocket: (opts: { host: string; port: number }) => import('node:net').Socket = (
    opts,
  ) => {
    // Lazy require so jest can still run without binding native net at load time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const net = require('node:net') as typeof import('node:net');
    return net.createConnection(opts);
  };

  /**
   * Test seam for local blob byte load (avoids real filesystem in unit tests).
   * Null = use LocalBlobAdapter.fromEnv() default path.
   */
  static loadObjectBytesOverride: ((storageKey: string) => Promise<Buffer | null>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  get enabled(): boolean {
    return process.env.VPSY_DOCUMENT_VIRUS_SCAN === 'true';
  }

  @Interval(SWEEP_MS)
  async sweep(): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    try {
      const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
      for (const tenant of tenants) {
        await TenantContext.run({ tenantId: tenant.id }, () => this.scanTenant(tenant.id));
      }
    } catch (err) {
      this.logger.error(`Virus scan sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Manual single-document scan (admin / tests). */
  async scanDocument(tenantId: string, documentId: string): Promise<{ id: string; virusScanStatus: string }> {
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, tenantId, deletedAt: null },
    });
    if (!doc) return { id: documentId, virusScanStatus: 'missing' };

    const outcome = await this.scanKey(doc.storageKey);
    return this.applyOutcome(tenantId, doc.id, outcome);
  }

  private async scanTenant(tenantId: string): Promise<void> {
    const pending = await this.prisma.document.findMany({
      where: { tenantId, virusScanStatus: 'pending', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 25,
      select: { id: true, storageKey: true },
    });
    for (const doc of pending) {
      const outcome = await this.scanKey(doc.storageKey);
      if (outcome === 'skipped') {
        this.logger.warn(
          `Virus scan enabled but no scanner configured — leaving ${doc.id} pending. Set CLAMAV_HOST or VPSY_DOCUMENT_VIRUS_SCAN_STUB=true for staging.`,
        );
        return; // don't spam every row every cycle
      }
      await this.applyOutcome(tenantId, doc.id, outcome);
    }
  }

  private async scanKey(storageKey: string): Promise<VirusScanOutcome> {
    const clamHost = process.env.CLAMAV_HOST?.trim();
    if (clamHost) {
      try {
        const bytes = await this.loadObjectBytes(storageKey);
        if (!bytes) {
          this.logger.warn(
            `ClamAV: could not load object bytes for ${storageKey} (check VPSY_DOCUMENT_BLOB_BACKEND + credentials) — fail-closed error`,
          );
          return 'error';
        }
        return await this.scanWithClamavInstream(clamHost, bytes);
      } catch (err) {
        this.logger.warn(`ClamAV scan error for ${storageKey}: ${(err as Error).message}`);
        return 'error';
      }
    }
    if (process.env.VPSY_DOCUMENT_VIRUS_SCAN_STUB === 'true') {
      // Staging-only: mark clean without a real scanner. Forbidden in real PHI policy.
      if (process.env.NODE_ENV === 'production' && process.env.VPSY_ALLOW_VIRUS_SCAN_STUB_IN_PROD !== 'true') {
        this.logger.error('Virus scan stub refused in production without VPSY_ALLOW_VIRUS_SCAN_STUB_IN_PROD');
        return 'skipped';
      }
      // Deterministic "EICAR" key suffix fails closed for demo.
      if (storageKey.toUpperCase().includes('EICAR')) return 'infected';
      return 'clean';
    }
    return 'skipped';
  }

  /**
   * Load object bytes from the configured blob backend (local filesystem or S3
   * SigV4 GET). Both feed ClamAV INSTREAM in-process — no separate Lambda
   * required for staging/single-node; large multi-GB fleets may still prefer
   * a dedicated stream worker to keep API memory bounded.
   */
  private async loadObjectBytes(storageKey: string): Promise<Buffer | null> {
    if (DocumentVirusScanService.loadObjectBytesOverride) {
      return DocumentVirusScanService.loadObjectBytesOverride(storageKey);
    }
    const maxBytes = Number(process.env.VPSY_DOCUMENT_VIRUS_SCAN_MAX_BYTES ?? 25 * 1024 * 1024);
    try {
      const backend = process.env.VPSY_DOCUMENT_BLOB_BACKEND?.trim();
      if (backend === 'local') {
        const { LocalBlobAdapter } = await import('./adapters/local-blob.adapter');
        const local = LocalBlobAdapter.fromEnv();
        if (!local?.getObject) return null;
        return await local.getObject(storageKey, { maxBytes });
      }
      if (backend === 's3') {
        const { S3BlobAdapter } = await import('./adapters/s3-blob.adapter');
        const s3 = S3BlobAdapter.fromEnv();
        if (!s3?.getObject) return null;
        return await s3.getObject(storageKey, { maxBytes });
      }
      return null;
    } catch (err) {
      this.logger.warn(`loadObjectBytes failed for ${storageKey}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * ClamAV INSTREAM over TCP (zINSTREAM). Streams object bytes to clamd.
   * Bytes come from local disk or S3 getObject (see loadObjectBytes).
   */
  private async scanWithClamavInstream(host: string, bytes: Buffer): Promise<VirusScanOutcome> {
    const port = Number(process.env.CLAMAV_PORT ?? 3310);
    const maxBytes = Number(process.env.VPSY_DOCUMENT_VIRUS_SCAN_MAX_BYTES ?? 25 * 1024 * 1024);
    if (bytes.length > maxBytes) {
      this.logger.warn(`ClamAV: object ${bytes.length} bytes exceeds max ${maxBytes} — error`);
      return 'error';
    }

    return new Promise<VirusScanOutcome>((resolve, reject) => {
      const socket = DocumentVirusScanService.createSocket({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('ClamAV INSTREAM timeout'));
      }, 30_000);

      let response = '';
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const chunkSize = 2048;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length, 0);
          socket.write(size);
          socket.write(chunk);
        }
        const zero = Buffer.alloc(4);
        zero.writeUInt32BE(0, 0);
        socket.write(zero);
      });
      socket.on('data', (data) => {
        response += data.toString('utf8');
      });
      socket.on('end', () => {
        clearTimeout(timer);
        const text = response.trim();
        if (/OK$/i.test(text) || /: OK/i.test(text)) {
          resolve('clean');
          return;
        }
        if (/FOUND/i.test(text)) {
          resolve('infected');
          return;
        }
        this.logger.warn(`ClamAV unexpected response: ${text.slice(0, 200)}`);
        resolve('error');
      });
      socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private async applyOutcome(
    tenantId: string,
    documentId: string,
    outcome: VirusScanOutcome,
  ): Promise<{ id: string; virusScanStatus: string }> {
    if (outcome === 'skipped') {
      return { id: documentId, virusScanStatus: 'pending' };
    }
    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: { virusScanStatus: outcome },
    });
    await this.audit.record({
      tenantId,
      actorId: SYSTEM_ACTOR,
      action: 'document.virus_scan',
      entityType: 'Document',
      entityId: documentId,
      after: { virusScanStatus: outcome },
      critical: outcome === 'infected',
    });
    return { id: updated.id, virusScanStatus: updated.virusScanStatus };
  }
}
