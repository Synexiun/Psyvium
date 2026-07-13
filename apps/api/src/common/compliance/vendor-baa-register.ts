/**
 * Subprocessor / BAA (or DPA) inventory for PHI / special-category data.
 *
 * Status is operational honesty, not a legal determination. Update when
 * contracts are signed. Optional env overrides:
 *   VPSY_BAA_STATUS_JSON = { "resend": { "status": "signed", "signedAt": "..." } }
 */

export type BaaStatus =
  | 'required-not-signed'
  | 'signed'
  | 'not-required'
  | 'under-negotiation'
  | 'n-a-self-hosted';

export interface VendorBaaEntry {
  id: string;
  name: string;
  category:
    | 'hosting'
    | 'database'
    | 'email'
    | 'sms-voice'
    | 'video'
    | 'payments'
    | 'ai'
    | 'storage'
    | 'observability'
    | 'auth-edge';
  /** What PHI / special-category data may flow. */
  dataClasses: string[];
  /** Env / code activate-on-key seam. */
  activateEnv?: string[];
  codeAnchors: string[];
  baaOrDpa: BaaStatus;
  notes?: string;
  signedAt?: string;
  agreementRef?: string;
}

const BASE_VENDORS: VendorBaaEntry[] = [
  {
    id: 'render',
    name: 'Render (or equivalent app host)',
    category: 'hosting',
    dataClasses: ['PHI in transit/at rest if API hosts clinical services'],
    activateEnv: ['DATABASE_URL', 'PORT'],
    codeAnchors: ['render.yaml', 'apps/api/'],
    baaOrDpa: 'required-not-signed',
    notes: 'Use HIPAA-eligible workspace + BAA before production PHI. See vendor HIPAA docs.',
  },
  {
    id: 'vercel',
    name: 'Vercel (web)',
    category: 'hosting',
    dataClasses: ['Session cookies; no long-term PHI store if API holds records'],
    activateEnv: ['WEB_ORIGIN', 'JWT_ACCESS_SECRET'],
    codeAnchors: ['apps/web/'],
    baaOrDpa: 'required-not-signed',
    notes: 'HIPAA-eligible plan + BAA required if portal handles PHI in production.',
  },
  {
    id: 'postgres',
    name: 'Managed Postgres (Neon/Render/AWS RDS/etc.)',
    category: 'database',
    dataClasses: ['All clinical PHI, audit chain, encrypted field envelopes'],
    activateEnv: ['DATABASE_URL'],
    codeAnchors: ['packages/database/'],
    baaOrDpa: 'required-not-signed',
    notes: 'PITR + encryption at rest + BAA with cloud DB provider.',
  },
  {
    id: 'aws-s3',
    name: 'AWS S3 / MinIO (documents + SIEM archive)',
    category: 'storage',
    dataClasses: ['Document blobs; SIEM event objects (minimized)'],
    activateEnv: [
      'VPSY_DOCUMENT_BLOB_BACKEND',
      'VPSY_DOCUMENT_S3_BUCKET',
      'VPSY_SIEM_S3_BUCKET',
      'AWS_ACCESS_KEY_ID',
    ],
    codeAnchors: [
      'apps/api/src/modules/documents/adapters/s3-blob.adapter.ts',
      'apps/api/src/common/siem/siem-s3-archive.ts',
    ],
    baaOrDpa: 'required-not-signed',
    notes: 'Prefer Object Lock bucket for SIEM WORM; BAA via AWS Artifact for HIPAA.',
  },
  {
    id: 'aws-kms',
    name: 'AWS KMS (field DEK unwrap)',
    category: 'storage',
    dataClasses: ['Encryption keys for field-level PHI envelopes'],
    activateEnv: ['VPSY_FIELD_KEY_PROVIDER', 'VPSY_FIELD_DEK_CIPHERTEXT'],
    codeAnchors: ['apps/api/src/common/crypto/kms-field-key-provider.ts'],
    baaOrDpa: 'required-not-signed',
  },
  {
    id: 'resend',
    name: 'Resend (transactional email)',
    category: 'email',
    dataClasses: ['Email addresses; password-reset links; security alert metadata'],
    activateEnv: ['RESEND_API_KEY', 'EMAIL_FROM', 'DPO_ALERT_EMAIL'],
    codeAnchors: ['apps/api/src/common/email/'],
    baaOrDpa: 'required-not-signed',
    notes: 'Minimize PHI in email bodies; activate-on-key.',
  },
  {
    id: 'twilio',
    name: 'Twilio (SMS / voice)',
    category: 'sms-voice',
    dataClasses: ['E.164 phone numbers; SMS bodies (field-encrypted at rest in VPSY)'],
    activateEnv: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'],
    codeAnchors: ['apps/api/src/modules/communications/'],
    baaOrDpa: 'required-not-signed',
    notes: 'STOP/opt-out + quiet hours enforced in-app; BAA required for production PHI SMS.',
  },
  {
    id: 'livekit',
    name: 'LiveKit (telehealth media)',
    category: 'video',
    dataClasses: ['Real-time A/V streams; room metadata'],
    activateEnv: ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_URL'],
    codeAnchors: ['apps/api/src/modules/telehealth/', 'apps/web/src/components/VideoRoom.tsx'],
    baaOrDpa: 'required-not-signed',
    notes: 'Honest 503 when unconfigured; waiting room + ABAC on join.',
  },
  {
    id: 'stripe',
    name: 'Stripe (payments)',
    category: 'payments',
    dataClasses: ['Billing identifiers; payment amounts — avoid clinical notes in descriptors'],
    activateEnv: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
    codeAnchors: ['apps/api/src/modules/finance/'],
    baaOrDpa: 'under-negotiation',
    notes: 'Signed webhook with rawBody; money Decimal(18,4). Confirm Stripe healthcare terms.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude (AI assistance)',
    category: 'ai',
    dataClasses: ['Prompts may include clinical context when AI_ASSISTED_ANALYSIS consent granted'],
    activateEnv: ['ANTHROPIC_API_KEY'],
    codeAnchors: ['apps/api/src/modules/ai-gateway/', 'docs/technical/05-ai-clinical-layer.md'],
    baaOrDpa: 'required-not-signed',
    notes: 'Consent-gated; PENDING human decision; no autonomous diagnosis. DPA/BAA before PHI prompts.',
  },
  {
    id: 'redis',
    name: 'Redis (rate limit / idempotency)',
    category: 'hosting',
    dataClasses: ['Rate-limit keys (user/IP ids); no clinical free text'],
    activateEnv: ['REDIS_URL'],
    codeAnchors: ['apps/api/src/common/rate-limit/'],
    baaOrDpa: 'required-not-signed',
    notes: 'Required in multi-instance production.',
  },
  {
    id: 'otel',
    name: 'OpenTelemetry backend (Grafana/Datadog/etc.)',
    category: 'observability',
    dataClasses: ['Hashed tenant labels; no PHI in spans by design'],
    activateEnv: ['OTEL_EXPORTER_OTLP_ENDPOINT'],
    codeAnchors: ['apps/api/src/common/observability/'],
    baaOrDpa: 'under-negotiation',
    notes: 'Tenant hashing; never export free-text clinical content to OTel.',
  },
  {
    id: 'clamav',
    name: 'ClamAV (malware scan)',
    category: 'storage',
    dataClasses: ['Transient document bytes during scan'],
    activateEnv: ['CLAMAV_HOST', 'VPSY_DOCUMENT_VIRUS_SCAN'],
    codeAnchors: ['apps/api/src/modules/documents/document-virus-scan.service.ts'],
    baaOrDpa: 'n-a-self-hosted',
    notes: 'Self-hosted scanner; ensure host is in PHI boundary.',
  },
];

export interface BaaStatusOverride {
  status: BaaStatus;
  signedAt?: string;
  agreementRef?: string;
  notes?: string;
}

export function parseBaaStatusOverrides(
  raw: string | undefined = process.env.VPSY_BAA_STATUS_JSON,
): Record<string, BaaStatusOverride> {
  if (!raw || raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, BaaStatusOverride>;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed;
  } catch {
    throw new Error('[compliance] VPSY_BAA_STATUS_JSON is set but is not valid JSON.');
  }
}

export function listVendorBaaRegister(
  overrides: Record<string, BaaStatusOverride> = parseBaaStatusOverrides(),
): VendorBaaEntry[] {
  return BASE_VENDORS.map((v) => {
    const o = overrides[v.id];
    if (!o?.status) return { ...v };
    return {
      ...v,
      baaOrDpa: o.status,
      signedAt: o.signedAt ?? v.signedAt,
      agreementRef: o.agreementRef ?? v.agreementRef,
      notes: o.notes ?? v.notes,
    };
  });
}

export function vendorBaaSummary(entries = listVendorBaaRegister()) {
  const required = entries.filter((e) => e.baaOrDpa === 'required-not-signed');
  const signed = entries.filter((e) => e.baaOrDpa === 'signed');
  const negotiation = entries.filter((e) => e.baaOrDpa === 'under-negotiation');
  return {
    total: entries.length,
    signed: signed.length,
    requiredNotSigned: required.length,
    underNegotiation: negotiation.length,
    /** Staging may proceed; production PHI GA needs requiredNotSigned === 0. */
    productionPhiReady: required.length === 0,
    blockingVendors: required.map((e) => e.id),
  };
}
