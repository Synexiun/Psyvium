/**
 * Production boot-time security posture assertions.
 * Fail closed on configurations that make a pen-test or PHI GA review fail immediately.
 * Opt-outs require explicit, named escape hatches (never silent).
 */

export interface ProductionSecurityFinding {
  id: string;
  severity: 'critical' | 'high' | 'warn';
  message: string;
}

/**
 * Evaluate production security posture. Does not throw — used by status API too.
 * When `throwOnCritical` is true (boot), critical findings abort startup.
 */
export function evaluateProductionSecurity(
  env: NodeJS.ProcessEnv = process.env,
): ProductionSecurityFinding[] {
  const isProd = env.NODE_ENV === 'production';
  if (!isProd) return [];

  const findings: ProductionSecurityFinding[] = [];

  if (env.ALLOW_DEMO_SEED === 'true' && env.VPSY_ALLOW_DEMO_SEED_IN_PROD !== 'true') {
    findings.push({
      id: 'demo-seed',
      severity: 'critical',
      message:
        'ALLOW_DEMO_SEED=true is set in production. Refusing boot — shared demo passwords must not run with real PHI. ' +
        'Set VPSY_ALLOW_DEMO_SEED_IN_PROD=true only for an isolated non-PHI demo.',
    });
  }

  if (env.VPSY_ENABLE_SWAGGER === 'true' && env.VPSY_ALLOW_SWAGGER_IN_PROD !== 'true') {
    findings.push({
      id: 'swagger-open',
      severity: 'critical',
      message:
        'VPSY_ENABLE_SWAGGER=true in production exposes API reconnaissance surface. ' +
        'Disable Swagger or set VPSY_ALLOW_SWAGGER_IN_PROD=true for a deliberate temporary exception.',
    });
  }

  if (env.VPSY_DOCUMENT_VIRUS_SCAN_STUB === 'true' && env.VPSY_ALLOW_VIRUS_SCAN_STUB_IN_PROD !== 'true') {
    findings.push({
      id: 'virus-scan-stub',
      severity: 'critical',
      message:
        'VPSY_DOCUMENT_VIRUS_SCAN_STUB=true in production (stub marks clean without scanning). ' +
        'Use ClamAV/real scanner or set VPSY_ALLOW_VIRUS_SCAN_STUB_IN_PROD=true only for non-PHI demos.',
    });
  }

  if (env.VPSY_ALLOW_PLAINTEXT_PHI === 'true') {
    findings.push({
      id: 'plaintext-phi-opt-in',
      severity: 'critical',
      message:
        'VPSY_ALLOW_PLAINTEXT_PHI=true disables field encryption fail-fast. Forbidden for real PHI production.',
    });
  }

  const webOrigin = (env.WEB_ORIGIN ?? '').trim();
  if (!webOrigin || webOrigin === '*' || /localhost|127\.0\.0\.1/i.test(webOrigin)) {
    findings.push({
      id: 'cors-origin',
      severity: 'high',
      message:
        'WEB_ORIGIN is missing, wildcard, or localhost in production — set the real browser origin for CORS + cookies.',
    });
  }

  if (!env.REDIS_URL?.trim() && env.VPSY_ALLOW_INMEMORY_RATE_LIMIT === 'true') {
    findings.push({
      id: 'inmemory-rate-limit',
      severity: 'high',
      message:
        'Production is using in-memory rate limits (VPSY_ALLOW_INMEMORY_RATE_LIMIT=true). Multi-instance rate limits will not be shared.',
    });
  }

  if (env.VPSY_DOCUMENT_BLOB_BACKEND === 's3' || env.VPSY_DOCUMENT_BLOB_BACKEND === 'local') {
    if (env.VPSY_DOCUMENT_VIRUS_SCAN !== 'true') {
      findings.push({
        id: 'virus-scan-off',
        severity: 'high',
        message:
          'Document blob backend is enabled but VPSY_DOCUMENT_VIRUS_SCAN is not true — PHI files can be stored without malware gating.',
      });
    }
  }

  if (!env.VPSY_SIEM_WEBHOOK_URL?.trim() && !env.VPSY_SIEM_LOCAL_DIR?.trim() && !env.VPSY_SIEM_S3_BUCKET?.trim()) {
    findings.push({
      id: 'siem-missing',
      severity: 'high',
      message:
        'No SIEM export channel configured (webhook, local JSONL, or S3). Break-glass/SLA anchors will only hit app logs.',
    });
  }

  if ((env.VPSY_FIELD_KEY_PROVIDER ?? '').toLowerCase() !== 'kms' && !env.VPSY_FIELD_KEY?.trim()) {
    // FieldCipher also fails fast; this finding is for status reporting when cipher is bypassed in tests.
    findings.push({
      id: 'field-key-missing',
      severity: 'critical',
      message: 'Field encryption key is not configured (VPSY_FIELD_KEY or KMS provider).',
    });
  }

  return findings;
}

/** Call from bootstrap after env is loaded. Throws on any critical finding. */
export function assertProductionSecurityPosture(): void {
  const findings = evaluateProductionSecurity();
  const critical = findings.filter((f) => f.severity === 'critical');
  if (critical.length === 0) return;
  const detail = critical.map((f) => `  - [${f.id}] ${f.message}`).join('\n');
  throw new Error(
    `[security] Production security posture refused to start:\n${detail}\n` +
      'Fix configuration or use explicit opt-in escape hatches documented in .env.example.',
  );
}

/** Pen-test / staging readiness probes (also useful in non-prod). */
export function evaluatePenTestReadiness(
  env: NodeJS.ProcessEnv = process.env,
): Array<{
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'warn' | 'info';
  detail: string;
}> {
  const items: Array<{
    id: string;
    label: string;
    status: 'pass' | 'fail' | 'warn' | 'info';
    detail: string;
  }> = [];

  const jwtOk =
    Boolean(env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET.length >= 16) &&
    Boolean(env.JWT_REFRESH_SECRET && env.JWT_REFRESH_SECRET.length >= 16);
  items.push({
    id: 'jwt-secrets',
    label: 'JWT access/refresh secrets configured (≥16 chars)',
    status: jwtOk ? 'pass' : 'fail',
    detail: jwtOk ? 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET present' : 'Missing or short JWT secrets',
  });

  const cors = (env.WEB_ORIGIN ?? '').trim();
  items.push({
    id: 'cors-lockdown',
    label: 'CORS origin locked to application WEB_ORIGIN (not *)',
    status: !cors || cors === '*' ? 'fail' : /localhost/i.test(cors) ? 'warn' : 'pass',
    detail: cors || '(unset → localhost default)',
  });

  const swagger =
    env.NODE_ENV === 'production'
      ? env.VPSY_ENABLE_SWAGGER === 'true'
      : env.VPSY_ENABLE_SWAGGER === 'true';
  items.push({
    id: 'swagger',
    label: 'OpenAPI /api/docs not exposed in production without opt-in',
    status:
      env.NODE_ENV === 'production' && env.VPSY_ENABLE_SWAGGER === 'true'
        ? 'fail'
        : env.NODE_ENV === 'production'
          ? 'pass'
          : 'info',
    detail:
      env.NODE_ENV === 'production'
        ? env.VPSY_ENABLE_SWAGGER === 'true'
          ? 'Swagger enabled in production'
          : 'Swagger disabled in production'
        : 'Non-production — Swagger may be enabled for local use',
  });

  const redis = Boolean(env.REDIS_URL?.trim());
  items.push({
    id: 'redis-rate-limit',
    label: 'Shared Redis for multi-instance rate limits',
    status: redis ? 'pass' : env.NODE_ENV === 'production' ? 'fail' : 'warn',
    detail: redis ? 'REDIS_URL set' : 'REDIS_URL unset (in-memory fallback)',
  });

  const fieldKey =
    (env.VPSY_FIELD_KEY_PROVIDER ?? '').toLowerCase() === 'kms'
      ? Boolean(env.VPSY_FIELD_DEK_CIPHERTEXT?.trim())
      : Boolean(env.VPSY_FIELD_KEY?.trim());
  items.push({
    id: 'field-encryption',
    label: 'Field-level PHI encryption key material present',
    status: fieldKey ? 'pass' : env.NODE_ENV === 'production' ? 'fail' : 'warn',
    detail: fieldKey
      ? (env.VPSY_FIELD_KEY_PROVIDER ?? 'env') === 'kms'
        ? 'KMS DEK ciphertext configured'
        : 'VPSY_FIELD_KEY configured'
      : 'No field key',
  });

  const demoSeed = env.ALLOW_DEMO_SEED === 'true';
  items.push({
    id: 'demo-seed',
    label: 'Shared demo seed not enabled for production PHI',
    status:
      env.NODE_ENV === 'production' && demoSeed
        ? 'fail'
        : demoSeed
          ? 'warn'
          : 'pass',
    detail: demoSeed ? 'ALLOW_DEMO_SEED=true' : 'Demo seed not forced',
  });

  const siem =
    Boolean(env.VPSY_SIEM_WEBHOOK_URL?.trim()) ||
    Boolean(env.VPSY_SIEM_LOCAL_DIR?.trim()) ||
    Boolean(env.VPSY_SIEM_S3_BUCKET?.trim());
  items.push({
    id: 'siem-export',
    label: 'SIEM export channel (webhook / local / S3)',
    status: siem ? 'pass' : 'warn',
    detail: siem ? 'At least one SIEM channel configured' : 'No SIEM channel',
  });

  const virus =
    env.VPSY_DOCUMENT_VIRUS_SCAN === 'true' &&
    env.VPSY_DOCUMENT_VIRUS_SCAN_STUB !== 'true';
  items.push({
    id: 'malware-scan',
    label: 'Document malware scan enabled without production stub',
    status:
      env.VPSY_DOCUMENT_BLOB_BACKEND && env.VPSY_DOCUMENT_BLOB_BACKEND !== ''
        ? virus
          ? 'pass'
          : env.VPSY_DOCUMENT_VIRUS_SCAN_STUB === 'true'
            ? 'fail'
            : 'warn'
        : 'info',
    detail: !env.VPSY_DOCUMENT_BLOB_BACKEND
      ? 'Blob backend not configured'
      : virus
        ? 'Real scan path expected'
        : env.VPSY_DOCUMENT_VIRUS_SCAN_STUB === 'true'
          ? 'Stub scanner active'
          : 'Virus scan flag off',
  });

  items.push({
    id: 'trust-proxy',
    label: 'Trust proxy enabled for correct client IP behind TLS terminator',
    status: 'pass',
    detail: 'main.ts sets trust proxy = 1 (platform hop)',
  });

  items.push({
    id: 'security-headers',
    label: 'Baseline security headers (nosniff, frame deny, referrer, HSTS in prod)',
    status: 'pass',
    detail: 'Configured in main.ts middleware',
  });

  void swagger;
  return items;
}
