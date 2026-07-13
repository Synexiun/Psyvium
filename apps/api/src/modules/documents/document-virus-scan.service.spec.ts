import { EventEmitter } from 'node:events';
import { DocumentVirusScanService } from './document-virus-scan.service';

describe('DocumentVirusScanService', () => {
  const prevStub = process.env.VPSY_DOCUMENT_VIRUS_SCAN_STUB;
  const prevEnabled = process.env.VPSY_DOCUMENT_VIRUS_SCAN;
  const prevNode = process.env.NODE_ENV;
  const prevClam = process.env.CLAMAV_HOST;
  const prevBlob = process.env.VPSY_DOCUMENT_BLOB_BACKEND;

  const originalCreateSocket = DocumentVirusScanService.createSocket;
  const originalLoadOverride = DocumentVirusScanService.loadObjectBytesOverride;

  afterEach(() => {
    if (prevStub === undefined) delete process.env.VPSY_DOCUMENT_VIRUS_SCAN_STUB;
    else process.env.VPSY_DOCUMENT_VIRUS_SCAN_STUB = prevStub;
    if (prevEnabled === undefined) delete process.env.VPSY_DOCUMENT_VIRUS_SCAN;
    else process.env.VPSY_DOCUMENT_VIRUS_SCAN = prevEnabled;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevClam === undefined) delete process.env.CLAMAV_HOST;
    else process.env.CLAMAV_HOST = prevClam;
    if (prevBlob === undefined) delete process.env.VPSY_DOCUMENT_BLOB_BACKEND;
    else process.env.VPSY_DOCUMENT_BLOB_BACKEND = prevBlob;
    DocumentVirusScanService.createSocket = originalCreateSocket;
    DocumentVirusScanService.loadObjectBytesOverride = originalLoadOverride;
  });

  function makeService(storageKey = 'x/ok.pdf') {
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
            storageKey: where.id === 'doc_eicar' ? 'x/EICAR' : storageKey,
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

  function fakeSocketThatReplies(reply: string) {
    class FakeSocket extends EventEmitter {
      write = jest.fn();
      destroy = jest.fn();
      end = jest.fn();
    }
    const socket = new FakeSocket();
    DocumentVirusScanService.createSocket = () => {
      queueMicrotask(() => {
        socket.emit('connect');
        queueMicrotask(() => {
          socket.emit('data', Buffer.from(reply));
          socket.emit('end');
        });
      });
      return socket as any;
    };
    return socket;
  }

  it('stub scanner marks clean and infected (EICAR key)', async () => {
    process.env.VPSY_DOCUMENT_VIRUS_SCAN = 'true';
    process.env.VPSY_DOCUMENT_VIRUS_SCAN_STUB = 'true';
    delete process.env.CLAMAV_HOST;
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

  it('ClamAV path fail-closes as error when blob bytes unavailable', async () => {
    process.env.VPSY_DOCUMENT_VIRUS_SCAN = 'true';
    process.env.CLAMAV_HOST = '127.0.0.1';
    delete process.env.VPSY_DOCUMENT_VIRUS_SCAN_STUB;
    process.env.VPSY_DOCUMENT_BLOB_BACKEND = 's3';
    process.env.NODE_ENV = 'test';
    DocumentVirusScanService.loadObjectBytesOverride = async () => null;
    const { svc } = makeService();
    const result = await svc.scanDocument('tenant_1', 'doc_1');
    expect(result.virusScanStatus).toBe('error');
  });

  it('ClamAV INSTREAM marks clean when clamd returns OK', async () => {
    process.env.VPSY_DOCUMENT_VIRUS_SCAN = 'true';
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.VPSY_DOCUMENT_BLOB_BACKEND = 'local';
    delete process.env.VPSY_DOCUMENT_VIRUS_SCAN_STUB;
    process.env.NODE_ENV = 'test';

    DocumentVirusScanService.loadObjectBytesOverride = async () => Buffer.from('hello clean file');
    const socket = fakeSocketThatReplies('stream: OK\0');

    const { svc } = makeService('tenant_1/client/c1/ok.pdf');
    const result = await svc.scanDocument('tenant_1', 'doc_1');
    expect(result.virusScanStatus).toBe('clean');
    expect(socket.write).toHaveBeenCalled();
  });

  it('ClamAV INSTREAM marks infected when clamd returns FOUND', async () => {
    process.env.VPSY_DOCUMENT_VIRUS_SCAN = 'true';
    process.env.CLAMAV_HOST = '127.0.0.1';
    process.env.VPSY_DOCUMENT_BLOB_BACKEND = 'local';
    delete process.env.VPSY_DOCUMENT_VIRUS_SCAN_STUB;
    process.env.NODE_ENV = 'test';

    DocumentVirusScanService.loadObjectBytesOverride = async () =>
      Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR');
    fakeSocketThatReplies('stream: Eicar-Test-Signature FOUND\0');

    const { svc, audit } = makeService('tenant_1/client/c1/eicar.txt');
    const result = await svc.scanDocument('tenant_1', 'doc_1');
    expect(result.virusScanStatus).toBe('infected');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.virus_scan', critical: true }),
    );
  });
});
