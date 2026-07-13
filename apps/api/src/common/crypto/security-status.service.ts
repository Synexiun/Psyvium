import { Injectable } from '@nestjs/common';
import type { AuthPrincipal } from '@vpsy/contracts';
import { AuditService } from '../audit/audit.service';
import { SiemExportService } from '../siem/siem-export.service';
import { FieldCipherService } from './field-cipher';
import { FieldReencryptService } from './field-reencrypt.service';

/**
 * Ops-facing security posture for ADMIN (PHI staging readiness).
 * Aggregates cipher, re-encrypt, SIEM, documents blob env, and audit chain tip.
 */
@Injectable()
export class SecurityStatusService {
  constructor(
    private readonly cipher: FieldCipherService,
    private readonly reencrypt: FieldReencryptService,
    private readonly siem: SiemExportService,
    private readonly audit: AuditService,
  ) {}

  async status(principal: AuthPrincipal) {
    await this.cipher.whenReady();
    const chain = await this.audit.verifyChain(principal.tenantId, 200);
    const docs = documentCapabilityFromEnv();
    const reenc = await this.reencrypt.status();

    const restoreDrill = this.restoreDrillChecklist({
      cipherActive: this.cipher.isActive,
      siemConfigured: this.siem.isConfigured,
      docsBlob: docs.mode === 'blob',
      chainOk: chain.ok,
      virusScan: docs.virusScan,
    });

    return {
      fieldCipher: {
        active: this.cipher.isActive,
        activeKeyId: this.cipher.activeKeyId,
        provider:
          (process.env.VPSY_FIELD_KEY_PROVIDER ?? 'env').toLowerCase() === 'kms' ? 'kms' : 'env',
      },
      reencrypt: reenc,
      siem: {
        configured: this.siem.isConfigured,
        webhook: this.siem.webhookConfigured,
        local: this.siem.localConfigured,
      },
      documents: docs,
      auditChain: {
        ok: chain.ok,
        checked: chain.checked,
        tipHash: chain.tipHash,
        tipId: chain.tipId,
        brokenAt: chain.brokenAt ?? null,
        reason: chain.reason ?? null,
      },
      restoreDrill,
    };
  }

  /**
   * PITR / restore-drill checklist — automated probes where possible;
   * remaining items are operator attestation.
   */
  restoreDrillChecklist(probes: {
    cipherActive: boolean;
    siemConfigured: boolean;
    docsBlob: boolean;
    chainOk: boolean;
    virusScan: boolean;
  }) {
    const items = [
      {
        id: 'backup-exists',
        label: 'Confirmed PITR / snapshot exists for the staging/prod database',
        automated: false,
        status: 'manual' as const,
      },
      {
        id: 'restore-to-isolated',
        label: 'Restored into an isolated database (not production write path)',
        automated: false,
        status: 'manual' as const,
      },
      {
        id: 'migrate-deploy',
        label: 'Ran prisma migrate deploy on restored DB',
        automated: false,
        status: 'manual' as const,
      },
      {
        id: 'field-cipher',
        label: 'Field encryption key available (env or KMS unwrap succeeds)',
        automated: true,
        status: probes.cipherActive ? ('pass' as const) : ('fail' as const),
      },
      {
        id: 'audit-chain',
        label: 'Audit prevHash chain verifies on restored tenant',
        automated: true,
        status: probes.chainOk ? ('pass' as const) : ('fail' as const),
      },
      {
        id: 'documents-blob',
        label: 'Document blob backend reachable (local or S3)',
        automated: true,
        status: probes.docsBlob ? ('pass' as const) : ('fail' as const),
      },
      {
        id: 'virus-scan',
        label: 'Malware scan worker configured for PHI documents',
        automated: true,
        status: probes.virusScan ? ('pass' as const) : ('warn' as const),
      },
      {
        id: 'siem-export',
        label: 'SIEM export channel configured (webhook and/or local JSONL)',
        automated: true,
        status: probes.siemConfigured ? ('pass' as const) : ('warn' as const),
      },
      {
        id: 'login-smoke',
        label: 'Clinician login + caseload read smoke on restored stack',
        automated: false,
        status: 'manual' as const,
      },
      {
        id: 'rto-rpo-recorded',
        label: 'Measured RTO/RPO recorded in ops log',
        automated: false,
        status: 'manual' as const,
      },
    ];
    const automated = items.filter((i) => i.automated);
    const passed = automated.filter((i) => i.status === 'pass').length;
    return {
      items,
      automatedPass: passed,
      automatedTotal: automated.length,
      readyForAttestation: automated.every((i) => i.status === 'pass' || i.status === 'warn'),
    };
  }
}

function documentCapabilityFromEnv(): {
  mode: 'disabled' | 'metadata-only' | 'blob';
  canUpload: boolean;
  canDownload: boolean;
  virusScan: boolean;
  message: string;
} {
  const backend = process.env.VPSY_DOCUMENT_BLOB_BACKEND?.trim();
  const virusScan = process.env.VPSY_DOCUMENT_VIRUS_SCAN === 'true';
  if (backend === 'local' || backend === 's3') {
    return {
      mode: 'blob',
      canUpload: true,
      canDownload: true,
      virusScan,
      message: `Object storage (${backend})${virusScan ? ' + malware scan' : ''}`,
    };
  }
  const allowMeta =
    process.env.NODE_ENV !== 'production' || process.env.VPSY_ALLOW_DOCUMENT_METADATA_ONLY === 'true';
  if (allowMeta) {
    return {
      mode: 'metadata-only',
      canUpload: false,
      canDownload: false,
      virusScan: false,
      message: 'Metadata-only document registration (no blob backend).',
    };
  }
  return {
    mode: 'disabled',
    canUpload: false,
    canDownload: false,
    virusScan: false,
    message: 'Document storage disabled.',
  };
}
