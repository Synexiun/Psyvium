import { NotFoundException } from '@nestjs/common';
import type { AuthPrincipal } from '@vpsy/contracts';
import { DiagnosisService } from './diagnosis.service';

/**
 * Wave C — Diagnosis Support (context 13). `DiagnosisHypothesis` is always
 * clinician-authored — this service has no AI-write path (only an optional
 * `aiRecommendationId` for provenance when a clinician is confirming/
 * overriding an AI Gateway suggestion).
 */

const clinician: AuthPrincipal = {
  userId: 'user_psy_a',
  tenantId: 'tenant_demo',
  roles: [],
  permissions: [],
};

function makeService() {
  const prisma = {
    client: { findFirst: jest.fn().mockResolvedValue({ id: 'client_1', tenantId: 'tenant_demo' }) },
    diagnosisHypothesis: {
      create: jest.fn().mockResolvedValue({
        id: 'dx_1',
        clientId: 'client_1',
        hypothesis: 'Generalized anxiety pattern (non-diagnostic)',
        confidence: 0.6,
        evidence: ['reported worry >6mo'],
        referralFlags: [],
        clinicianConfirmed: false,
        aiRecommendationId: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const svc = new DiagnosisService(prisma as any, audit as any, bus as any);
  return { svc, prisma, audit, bus };
}

describe('DiagnosisService', () => {
  it('creates a clinician-authored hypothesis, audits it, and publishes HypothesisSuggested', async () => {
    const { svc, audit, bus } = makeService();

    const result = await svc.create(clinician, {
      clientId: 'client_1',
      hypothesis: 'Generalized anxiety pattern (non-diagnostic)',
      confidence: 0.6,
      evidence: ['reported worry >6mo'],
      referralFlags: [],
    });

    expect(result.clinicianConfirmed).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'hypothesis.suggested' }));
    expect(bus.publish).toHaveBeenCalledWith('hypothesis.suggested', 'tenant_demo', expect.any(Object));
  });

  it('rejects creation when the client does not exist in this tenant', async () => {
    const { svc, prisma } = makeService();
    (prisma.client.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      svc.create(clinician, {
        clientId: 'client_missing',
        hypothesis: 'x',
        confidence: 0,
        evidence: [],
        referralFlags: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('toggles clinicianConfirmed via updateStatus and audits it', async () => {
    const { svc, prisma, audit } = makeService();
    (prisma.diagnosisHypothesis.findFirst as jest.Mock).mockResolvedValue({ id: 'dx_1', tenantId: 'tenant_demo' });
    (prisma.diagnosisHypothesis.update as jest.Mock).mockResolvedValue({
      id: 'dx_1',
      clientId: 'client_1',
      hypothesis: 'Generalized anxiety pattern (non-diagnostic)',
      confidence: 0.6,
      evidence: [],
      referralFlags: [],
      clinicianConfirmed: true,
      aiRecommendationId: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const result = await svc.updateStatus(clinician, { hypothesisId: 'dx_1', clinicianConfirmed: true });

    expect(result.clinicianConfirmed).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'hypothesis.status_updated' }));
  });

  it('rejects updateStatus when the hypothesis does not exist in this tenant', async () => {
    const { svc, prisma } = makeService();
    (prisma.diagnosisHypothesis.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      svc.updateStatus(clinician, { hypothesisId: 'dx_missing', clinicianConfirmed: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists a client’s hypotheses', async () => {
    const { svc, prisma } = makeService();
    (prisma.diagnosisHypothesis.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'dx_1',
        clientId: 'client_1',
        hypothesis: 'x',
        confidence: 0.6,
        evidence: [],
        referralFlags: [],
        clinicianConfirmed: false,
        aiRecommendationId: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const result = await svc.listForClient(clinician, 'client_1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('dx_1');
  });
});
