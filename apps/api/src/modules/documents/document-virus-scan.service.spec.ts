import { DocumentVirusScanService } from './document-virus-scan.service';

describe('DocumentVirusScanService', () => {
  const prevStub = process.env.VPSY_DOCUMENT_VIRUS_SCAN_STUB;
  const prevEnabled = process.env.VPSY_DOCUMENT_VIRUS_SCAN;
  const prevNode = process.env.NODE_ENV;

  afterEach(() => {
    if (prevStub === undefined) delete process.env.VPSY_DOCUMENT_VIRUS_SCAN_STUB;
    else process.env.VPSY_DOCUMENT_VIRUS_SCAN_STUB = prevStub;
    if (prevEnabled === undefined) delete process.env.VPSY_DOCUMENT_VIRUS_SCAN;
    else process.env.VPSY_DOCUMENT_VIRUS_SCAN = prevEnabled;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
  });

  function makeService() {
    const prisma = {
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: 'tenant_1' }]) },
      document: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'doc_1', storageKey: 'tenant_1/client/c1/file.pdf' },
          { id: 'doc_eicar', storageKey: 'tenant_1/client/c1/EICAR-test.txt' },
        ]),
        findFirst: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve({
            id: where.id,
            storageKey: where.id === 'doc_eicar' ? 'x/EICAR' : 'x/ok.pdf',
            tenantId: 'tenant_1',
          }),
        ),
        update: jest.fn().mockImplementation(({ where, data }) =>
          Promise.resolve({ id: where.id, virusScanStatus: data.virusScanStatus }),
        ),
      },
    };
    const audit = { record: jest.fn() };
    const svc = new DocumentVirusScanService(prisma as any, audit as any);
    return { svc, prisma, audit };
  }

  it('stub scanner marks clean and infected (EICAR key)', async () => {
    process.env.VPSY_DOCUMENT_VIRUS_SCAN = 'true';
    process.env.VPSY_DOCUMENT_VIRUS_SCAN_STUB = 'true';
    process.env.NODE_ENV = 'test';
    const { svc, audit } = makeService();

    const clean = await svc.scanDocument('tenant_1', 'doc_1');
    expect(clean.virusScanStatus).toBe('clean');

    const infected = await svc.scanDocument('tenant_1', 'doc_eicar');
    expect(infected.virusScanStatus).toBe('infected');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.virus_scan', critical: true }),
    );
  });

  it('leaves pending when scan enabled but no scanner configured', async () => {
    process.env.VPSY_DOCUMENT_VIRUS_SCAN = 'true';
    delete process.env.VPSY_DOCUMENT_VIRUS_SCAN_STUB;
    delete process.env.CLAMAV_HOST;
    process.env.NODE_ENV = 'test';
    const { svc } = makeService();
    const result = await svc.scanDocument('tenant_1', 'doc_1');
    expect(result.virusScanStatus).toBe('pending');
  });
});
