import {
  assertProductionSecurityPosture,
  evaluatePenTestReadiness,
  evaluateProductionSecurity,
} from './production-security';

describe('production-security', () => {
  const baseProd: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
    JWT_REFRESH_SECRET: 'y'.repeat(32),
    VPSY_FIELD_KEY: Buffer.alloc(32, 1).toString('base64'),
    WEB_ORIGIN: 'https://app.example.com',
    REDIS_URL: 'redis://localhost:6379',
    VPSY_SIEM_WEBHOOK_URL: 'https://siem.example/ingest',
  };

  it('returns no findings for a well-configured production env', () => {
    expect(evaluateProductionSecurity(baseProd)).toEqual([]);
  });

  it('flags demo seed and swagger as critical in production', () => {
    const findings = evaluateProductionSecurity({
      ...baseProd,
      ALLOW_DEMO_SEED: 'true',
      VPSY_ENABLE_SWAGGER: 'true',
    });
    expect(findings.map((f) => f.id).sort()).toEqual(['demo-seed', 'swagger-open']);
    expect(findings.every((f) => f.severity === 'critical')).toBe(true);
  });

  it('assertProductionSecurityPosture throws on critical findings', () => {
    const keys = [
      'NODE_ENV',
      'ALLOW_DEMO_SEED',
      'VPSY_ALLOW_DEMO_SEED_IN_PROD',
      'VPSY_FIELD_KEY',
      'WEB_ORIGIN',
      'REDIS_URL',
      'VPSY_SIEM_LOCAL_DIR',
      'VPSY_ENABLE_SWAGGER',
    ] as const;
    const prev: Record<string, string | undefined> = {};
    for (const k of keys) prev[k] = process.env[k];
    try {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_DEMO_SEED = 'true';
      delete process.env.VPSY_ALLOW_DEMO_SEED_IN_PROD;
      process.env.VPSY_FIELD_KEY = Buffer.alloc(32, 1).toString('base64');
      process.env.WEB_ORIGIN = 'https://app.example.com';
      process.env.REDIS_URL = 'redis://x';
      process.env.VPSY_SIEM_LOCAL_DIR = './data/siem';
      delete process.env.VPSY_ENABLE_SWAGGER;
      expect(() => assertProductionSecurityPosture()).toThrow(/demo-seed|Production security posture/);
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  });

  it('pen-test readiness reports jwt and cors probes', () => {
    const items = evaluatePenTestReadiness({
      NODE_ENV: 'development',
      JWT_ACCESS_SECRET: 'a'.repeat(20),
      JWT_REFRESH_SECRET: 'b'.repeat(20),
      WEB_ORIGIN: 'https://clinic.example',
    });
    expect(items.find((i) => i.id === 'jwt-secrets')?.status).toBe('pass');
    expect(items.find((i) => i.id === 'cors-lockdown')?.status).toBe('pass');
  });
});
