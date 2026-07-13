import { BadRequestException, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    formulation: {
      create: jest.fn().mockResolvedValue({
        id: 'form_1',
        clientId: 'client_1',
        authorId: 'user_psy_a',
        icdCode: 'F41.1',
        dsmCode: '300.02',
        description: 'Generalized Anxiety Disorder',
        status: 'PROVISIONAL',
        basedOnHypothesisId: null,
        specifiers: null,
        onsetDate: null,
        resolvedDate: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
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

  // ---------------------------------------------------------------------
  // WAVE CR item 7 — coded Formulation/Diagnosis. Distinct from
  // DiagnosisHypothesis above: this is the clinician's ACTUAL diagnosis.
  // ---------------------------------------------------------------------
  describe('Formulation (coded diagnosis)', () => {
    it('records a clinician-authored formulation, audits it as CRITICAL, and publishes formulation.recorded', async () => {
      const { svc, audit, bus } = makeService();

      const result = await svc.createFormulation(clinician, {
        clientId: 'client_1',
        icdCode: 'F41.1',
        dsmCode: '300.02',
        description: 'Generalized Anxiety Disorder',
        status: 'PROVISIONAL',
      } as any);

      expect(result.status).toBe('PROVISIONAL');
      expect(result.authorId).toBe('user_psy_a');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'formulation.recorded', critical: true }),
      );
      expect(bus.publish).toHaveBeenCalledWith('formulation.recorded', 'tenant_demo', expect.any(Object));
    });

    it('rejects formulation creation when the client does not exist in this tenant', async () => {
      const { svc, prisma } = makeService();
      (prisma.client.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        svc.createFormulation(clinician, {
          clientId: 'client_missing',
          icdCode: 'F41.1',
          description: 'x',
          status: 'PROVISIONAL',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects invalid ICD-10-CM code format before write', async () => {
      const { svc, prisma } = makeService();

      await expect(
        svc.createFormulation(clinician, {
          clientId: 'client_1',
          icdCode: 'depression maybe',
          description: 'x',
          status: 'PROVISIONAL',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.formulation.create).not.toHaveBeenCalled();
    });

    it('rejects a basedOnHypothesisId that does not belong to the client/tenant', async () => {
      const { svc, prisma } = makeService();
      (prisma.diagnosisHypothesis.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        svc.createFormulation(clinician, {
          clientId: 'client_1',
          icdCode: 'F41.1',
          description: 'x',
          status: 'PROVISIONAL',
          basedOnHypothesisId: 'dx_missing',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('transitions provisional -> confirmed via updateFormulationStatus and audits it as CRITICAL', async () => {
      const { svc, prisma, audit, bus } = makeService();
      (prisma.formulation.findFirst as jest.Mock).mockResolvedValue({ id: 'form_1', tenantId: 'tenant_demo' });
      (prisma.formulation.update as jest.Mock).mockResolvedValue({
        id: 'form_1',
        clientId: 'client_1',
        authorId: 'user_psy_a',
        icdCode: 'F41.1',
        dsmCode: null,
        description: 'Generalized Anxiety Disorder',
        status: 'CONFIRMED',
        basedOnHypothesisId: null,
        specifiers: null,
        onsetDate: null,
        resolvedDate: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      });

      const result = await svc.updateFormulationStatus(clinician, 'form_1', { status: 'CONFIRMED' } as any);

      expect(result.status).toBe('CONFIRMED');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'formulation.status_updated', critical: true }),
      );
      expect(bus.publish).toHaveBeenCalledWith('formulation.status_updated', 'tenant_demo', expect.any(Object));
    });

    it('rejects updateFormulationStatus when the formulation does not exist in this tenant', async () => {
      const { svc, prisma } = makeService();
      (prisma.formulation.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        svc.updateFormulationStatus(clinician, 'form_missing', { status: 'CONFIRMED' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lists a client’s formulations, excluding soft-deleted rows', async () => {
      const { svc, prisma } = makeService();
      (prisma.formulation.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'form_1',
          clientId: 'client_1',
          authorId: 'user_psy_a',
          icdCode: 'F41.1',
          dsmCode: null,
          description: 'x',
          status: 'PROVISIONAL',
          basedOnHypothesisId: null,
          specifiers: null,
          onsetDate: null,
          resolvedDate: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

      const result = await svc.listFormulationsForClient(clinician, 'client_1');
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe('form_1');
      expect(prisma.formulation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
      );
    });

    it('rejects listFormulationsForClient when the client does not exist in this tenant', async () => {
      const { svc, prisma } = makeService();
      (prisma.client.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(svc.listFormulationsForClient(clinician, 'client_missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    // -------------------------------------------------------------------
    // "AI must have NO write path to Formulation" — asserted structurally,
    // not just behaviorally: DiagnosisService (which owns every Formulation
    // write) never imports/injects AiGatewayService, and AiGatewayService's
    // own source never references Formulation at all. If either ever
    // changes, this test fails loudly instead of relying on an incidental
    // absence of a call in some other spec.
    // -------------------------------------------------------------------
    it('has no AI-write path to Formulation (structural guarantee)', () => {
      const diagnosisServiceSrc = readFileSync(join(__dirname, 'diagnosis.service.ts'), 'utf8');
      expect(diagnosisServiceSrc).not.toMatch(/AiGateway/);

      const aiGatewaySrc = readFileSync(
        join(__dirname, '..', 'ai-gateway', 'ai-gateway.service.ts'),
        'utf8',
      );
      expect(aiGatewaySrc.toLowerCase()).not.toContain('formulation');

      // DiagnosisService's constructor takes exactly (prisma, audit, bus) —
      // no AI Gateway dependency to ever call a write method through.
      expect(DiagnosisService.length).toBe(3);
    });
  });
});
