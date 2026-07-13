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
        return await this.scanWithClamav(clamHost, storageKey);
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
   * Minimal ClamAV INSTREAM over TCP. Expects clamav listening on CLAMAV_HOST:PORT.
   * Does not stream object bytes from S3 here — production should pipe S3 → clamd.
   * This call sends a ping (zPING) to verify reachability, then returns error
   * until a full stream pipeline is wired (honest partial implementation).
   */
  private async scanWithClamav(host: string, _storageKey: string): Promise<VirusScanOutcome> {
    const net = await import('node:net');
    const port = Number(process.env.CLAMAV_PORT ?? 3310);
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host, port }, () => {
        socket.write('zPING\0');
      });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('ClamAV ping timeout'));
      }, 3000);
      socket.on('data', (data) => {
        clearTimeout(timer);
        socket.end();
        if (data.toString().includes('PONG')) resolve();
        else reject(new Error(`Unexpected ClamAV response: ${data.toString()}`));
      });
      socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    // Reachable but full object stream not yet wired — fail closed as error
    // so ops sees pending→error and can attach a real stream worker.
    this.logger.warn(
      'ClamAV is reachable but object-byte streaming is not wired — marking scan error (fail-closed).',
    );
    return 'error';
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
