import { FieldCipherService } from './field-cipher';
import { FieldReencryptService } from './field-reencrypt.service';

const OLD_KEY = Buffer.alloc(32, 1);
const NEW_KEY = Buffer.alloc(32, 2);

function cipherWith(
  key: Buffer,
  kid: string,
  previous?: Array<{ id: string; key: Buffer }>,
): FieldCipherService {
  return new FieldCipherService({
    getKey: async () => key,
    getKeyId: async () => kid,
    getPreviousKeys: async () => previous ?? [],
  });
}

describe('FieldReencryptService', () => {
  it('rewrites session notes sealed under a previous kid', async () => {
    const oldCipher = cipherWith(OLD_KEY, 'v0');
    const envelope = await oldCipher.encryptJson({ format: 'SOAP', subjective: 'low mood' }, 'tenant_1');
    expect(envelope).toMatchObject({ kid: 'v0' });

    const newCipher = cipherWith(NEW_KEY, 'v1', [{ id: 'v0', key: OLD_KEY }]);
    const prisma = {
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: 'tenant_1' }]) },
      sessionNote: {
        findMany: jest.fn().mockResolvedValue([{ id: 'note_1', content: envelope }]),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'note_1', ...data })),
      },
      safetyPlan: { findMany: jest.fn().mockResolvedValue([]) },
      message: { findMany: jest.fn().mockResolvedValue([]) },
      smsMessage: { findMany: jest.fn().mockResolvedValue([]) },
      intake: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const audit = { record: jest.fn() };
    const svc = new FieldReencryptService(prisma as any, newCipher, audit as any);

    const result = await svc.runForTenant('tenant_1');
    expect(result.rewritten).toBe(1);
    expect(result.byTable.sessionNote!.rewritten).toBe(1);
    expect(prisma.sessionNote.update).toHaveBeenCalled();
    const written = prisma.sessionNote.update.mock.calls[0][0].data.content;
    expect(written.kid).toBe('v1');
    // New key can open it
    await expect(newCipher.decryptJson(written, 'tenant_1')).resolves.toEqual({
      format: 'SOAP',
      subjective: 'low mood',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'field.reencrypt_batch' }),
    );
  });

  it('skips rows already on active kid', async () => {
    const cipher = cipherWith(NEW_KEY, 'v1');
    const envelope = await cipher.encryptJson({ x: 1 }, 'tenant_1');
    const prisma = {
      sessionNote: {
        findMany: jest.fn().mockResolvedValue([{ id: 'note_1', content: envelope }]),
        update: jest.fn(),
      },
      safetyPlan: { findMany: jest.fn().mockResolvedValue([]) },
      message: { findMany: jest.fn().mockResolvedValue([]) },
      smsMessage: { findMany: jest.fn().mockResolvedValue([]) },
      intake: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new FieldReencryptService(prisma as any, cipher, { record: jest.fn() } as any);
    const result = await svc.runForTenant('tenant_1');
    expect(result.rewritten).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);
    expect(prisma.sessionNote.update).not.toHaveBeenCalled();
  });

  it('needsReencrypt seals plaintext only when requested', async () => {
    const cipher = cipherWith(NEW_KEY, 'v1');
    await expect(cipher.needsReencrypt(null)).resolves.toBe(false);
    await expect(cipher.needsReencrypt(null, { sealPlaintext: true })).resolves.toBe(true);
    await expect(cipher.needsReencrypt('v0')).resolves.toBe(true);
    await expect(cipher.needsReencrypt('v1')).resolves.toBe(false);
  });
});
