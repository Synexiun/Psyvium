import type { AuthPrincipal } from '@vpsy/contracts';
import { PsychometricsService } from './psychometrics.service';
import { ScoringService } from './scoring.service';

/**
 * Safety-item scoring hook (docs/technical/07-psychometrics-engine.md §4).
 * This is the P0 gap fix: a STANDALONE assessment (not routed through Intake)
 * must raise a HIGH RiskFlag + Escalation deterministically when a configured
 * safety item is endorsed — e.g. a PHQ-9 taken outside of intake with a
 * positive item 9 (active suicidal ideation) must never pass through silent.
 */

const principal: AuthPrincipal = {
  userId: 'user_psy_a',
  tenantId: 'tenant_demo',
  roles: [],
  permissions: [],
};

const CUTOFFS_WITH_SAFETY_ITEM = {
  bands: [
    { band: 'LOW', min: 0, max: 4 },
    { band: 'MODERATE', min: 5, max: 9 },
    { band: 'HIGH', min: 10, max: 14 },
    { band: 'SEVERE', min: 15, max: 27 },
  ],
  safetyItems: [{ itemId: 'q9', minAnswer: 1, category: 'suicidal_ideation' }],
};

function makeService() {
  const createdRiskFlags: any[] = [];
  const createdEscalations: any[] = [];
  const clientUpdates: any[] = [];

  const version = {
    id: 'qv_1',
    published: true,
    cutoffs: CUTOFFS_WITH_SAFETY_ITEM,
  };
  const client = { id: 'client_1', tenantId: 'tenant_demo', riskLevel: 'LOW' };

  const tx = {
    questionnaireResponse: {
      create: jest.fn().mockImplementation(({ data }: any) => ({
        id: 'qr_1',
        versionId: data.versionId,
        clientId: data.clientId,
        answers: data.answers,
        completedAt: new Date('2026-01-01T00:00:00Z'),
      })),
    },
    psychometricScore: {
      create: jest.fn().mockImplementation(({ data }: any) => ({
        id: 'score_1',
        responseId: data.responseId,
        rawScore: data.rawScore,
        severityBand: data.severityBand,
        interpretation: data.interpretation,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      })),
    },
    riskFlag: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        const rf = { id: `flag_${createdRiskFlags.length + 1}`, ...data };
        createdRiskFlags.push(rf);
        return rf;
      }),
    },
    escalation: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        const esc = { id: `esc_${createdEscalations.length + 1}`, ...data };
        createdEscalations.push(esc);
        return esc;
      }),
    },
    client: {
      update: jest.fn().mockImplementation(({ data }: any) => {
        clientUpdates.push(data);
        return { ...client, ...data };
      }),
    },
  };

  const prisma = {
    questionnaireVersion: { findUnique: jest.fn().mockResolvedValue(version) },
    client: { findFirst: jest.fn().mockResolvedValue(client) },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
  };

  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const scoring = new ScoringService();

  const svc = new PsychometricsService(prisma as any, scoring, audit as any, bus as any);
  return { svc, prisma, tx, audit, bus, createdRiskFlags, createdEscalations, clientUpdates };
}

describe('PsychometricsService.administer — safety-item hook', () => {
  it('raises a HIGH RiskFlag + Escalation for a positive safety item, and routes it like intake', async () => {
    const { svc, tx, bus, createdRiskFlags, createdEscalations, clientUpdates } = makeService();

    await svc.administer(principal, {
      versionId: 'qv_1',
      clientId: 'client_1',
      answers: { q1: 1, q2: 1, q9: 2 }, // q9 (safety item) endorsed >= minAnswer(1)
    });

    expect(tx.riskFlag.create).toHaveBeenCalledTimes(1);
    expect(createdRiskFlags[0]).toMatchObject({
      clientId: 'client_1',
      type: 'SUICIDAL_IDEATION',
      severity: 'HIGH',
      source: 'SCREENING',
      status: 'ESCALATED',
    });

    expect(tx.escalation.create).toHaveBeenCalledTimes(1);
    expect(createdEscalations[0]).toMatchObject({ riskFlagId: createdRiskFlags[0].id });

    // Client's reflected risk level is escalated (was LOW).
    expect(clientUpdates).toEqual([{ riskLevel: 'HIGH' }]);

    // Same events Intake emits for its own safety flags.
    expect(bus.publish).toHaveBeenCalledWith(
      'risk.flag.raised',
      'tenant_demo',
      expect.objectContaining({ riskFlagId: createdRiskFlags[0].id, clientId: 'client_1' }),
    );
    expect(bus.publish).toHaveBeenCalledWith(
      'escalation.raised',
      'tenant_demo',
      expect.objectContaining({ escalationId: createdEscalations[0].id, riskFlagId: createdRiskFlags[0].id }),
    );
  });

  it('never raises a flag when the safety item is answered below the threshold', async () => {
    const { svc, tx, bus } = makeService();

    await svc.administer(principal, {
      versionId: 'qv_1',
      clientId: 'client_1',
      answers: { q1: 1, q2: 1, q9: 0 }, // q9 below minAnswer(1) — no endorsement
    });

    expect(tx.riskFlag.create).not.toHaveBeenCalled();
    expect(tx.escalation.create).not.toHaveBeenCalled();
    expect(tx.client.update).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalledWith('risk.flag.raised', expect.anything(), expect.anything());
    expect(bus.publish).not.toHaveBeenCalledWith('escalation.raised', expect.anything(), expect.anything());
  });

  it('never raises a flag when the safety item is simply absent from the answers', async () => {
    const { svc, tx } = makeService();

    await svc.administer(principal, {
      versionId: 'qv_1',
      clientId: 'client_1',
      answers: { q1: 1, q2: 1 }, // q9 never answered
    });

    expect(tx.riskFlag.create).not.toHaveBeenCalled();
    expect(tx.escalation.create).not.toHaveBeenCalled();
  });
});
