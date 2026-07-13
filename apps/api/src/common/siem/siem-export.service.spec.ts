import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SiemExportService } from './siem-export.service';

describe('SiemExportService', () => {
  const prevUrl = process.env.VPSY_SIEM_WEBHOOK_URL;
  const prevSecret = process.env.VPSY_SIEM_WEBHOOK_SECRET;
  const prevDir = process.env.VPSY_SIEM_LOCAL_DIR;

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.VPSY_SIEM_WEBHOOK_URL;
    else process.env.VPSY_SIEM_WEBHOOK_URL = prevUrl;
    if (prevSecret === undefined) delete process.env.VPSY_SIEM_WEBHOOK_SECRET;
    else process.env.VPSY_SIEM_WEBHOOK_SECRET = prevSecret;
    if (prevDir === undefined) delete process.env.VPSY_SIEM_LOCAL_DIR;
    else process.env.VPSY_SIEM_LOCAL_DIR = prevDir;
  });

  it('logs only when no export channel configured', async () => {
    delete process.env.VPSY_SIEM_WEBHOOK_URL;
    delete process.env.VPSY_SIEM_LOCAL_DIR;
    const svc = new SiemExportService();
    const result = await svc.emit({
      type: 'test.event',
      severity: 'INFO',
      tenantId: 't1',
      payload: { ok: true },
    });
    expect(result.channels).toEqual(['log']);
    expect(result.delivered).toBe(false);
  });

  it('appends JSONL to local dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vpsy-siem-'));
    process.env.VPSY_SIEM_LOCAL_DIR = dir;
    delete process.env.VPSY_SIEM_WEBHOOK_URL;
    const svc = new SiemExportService();
    try {
      const result = await svc.emit({
        type: 'audit.daily_anchor',
        severity: 'INFO',
        tenantId: 'tenant_1',
        payload: { tipHash: 'abc' },
      });
      expect(result.delivered).toBe(true);
      expect(result.channels).toContain('local');
      const day = new Date().toISOString().slice(0, 10);
      const text = await readFile(join(dir, `siem-${day}.jsonl`), 'utf8');
      expect(text).toContain('audit.daily_anchor');
      expect(text).toContain('tenant_1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('POSTs webhook with HMAC signature when secret set', async () => {
    process.env.VPSY_SIEM_WEBHOOK_URL = 'https://siem.example/ingest';
    process.env.VPSY_SIEM_WEBHOOK_SECRET = 'test-secret';
    delete process.env.VPSY_SIEM_LOCAL_DIR;

    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    const prevFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    try {
      const svc = new SiemExportService();
      const result = await svc.emit({
        type: 'breakglass.invoked',
        severity: 'HIGH',
        tenantId: 't1',
        payload: { grantId: 'g1' },
      });
      expect(result.delivered).toBe(true);
      expect(result.channels).toContain('webhook');
      expect(fetchMock).toHaveBeenCalled();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://siem.example/ingest');
      expect(init.headers['x-vpsy-signature']).toMatch(/^sha256=[0-9a-f]+$/);
      expect(init.headers['content-type']).toBe('application/json');
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});
