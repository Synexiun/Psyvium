import type { AuthPrincipal } from '@vpsy/contracts';
import { PsychometricsService } from './psychometrics.service';
import { ScoringService } from './scoring.service';
import { IrtScoringService } from './irt-scoring.service';

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

function makeService(versionOverrides: Record<string, unknown> = {}) {
  const createdRiskFlags: any[] = [];
  const createdEscalations: any[] = [];
  const clientUpdates: any[] = [];
  const createdScores: any[] = [];

  const version = {
    id: 'qv_1',
    published: true,
    cutoffs: CUTOFFS_WITH_SAFETY_ITEM,
    ...versionOverrides,
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
      create: jest.fn().mockImplementation(({ data }: any) => {
        createdScores.push(data);
        return {
          id: 'score_1',
          responseId: data.responseId,
          rawScore: data.rawScore,
          thetaEstimate: data.thetaEstimate ?? null,
          standardError: data.standardError ?? null,
          severityBand: data.severityBand,
          interpretation: data.interpretation,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        };
      }),
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
  const irt = new IrtScoringService();

  const svc = new PsychometricsService(prisma as any, scoring, irt, audit as any, bus as any);
  return { svc, prisma, tx, audit, bus, createdRiskFlags, createdEscalations, clientUpdates, createdScores };
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

/**
 * IRT wiring (07-psychometrics-engine.md §5): an instrument that opted in
 * (scoringMethod IRT + calibrated items) persists thetaEstimate/standardError
 * alongside the untouched classical rawScore/severityBand; everything else
 * stays on the classical path with theta null. Scoring stays 100%
 * deterministic — AI is never consulted.
 */
describe('PsychometricsService.administer — IRT latent-trait scoring', () => {
  const IRT_VERSION = {
    questionnaire: { scoringMethod: 'IRT' },
    items: [
      // GRM anxiety-style items, categories 0..3, answers keyed by linkId
      { id: 'item_1', linkId: 'q1', parameters: [{ model: 'GRM', a: 1.8, b: 0, c: null, thresholds: [-1.2, 0, 1.1] }] },
      { id: 'item_2', linkId: 'q2', parameters: [{ model: 'GRM', a: 1.4, b: 0, c: null, thresholds: [-0.8, 0.3, 1.5] }] },
      { id: 'item_3', linkId: 'q3', parameters: [{ model: 'GRM', a: 2.1, b: 0, c: null, thresholds: [-1.5, -0.4, 0.7] }] },
    ],
  };

  it('persists thetaEstimate + standardError (EAP) while classical rawScore/severityBand stay intact', async () => {
    const { svc, createdScores } = makeService(IRT_VERSION);

    const dto = await svc.administer(principal, {
      versionId: 'qv_1',
      clientId: 'client_1',
      answers: { q1: 2, q2: 1, q3: 3 },
    });

    // Independent reference (trapezoid [-8,8], step 1e-3): theta=0.56026, SE=0.52040
    expect(createdScores[0].thetaEstimate).toBeCloseTo(0.5602645996038873, 2);
    expect(createdScores[0].standardError).toBeCloseTo(0.5204017879877768, 2);
    expect(createdScores[0].reliabilityAtTheta).toBeGreaterThan(0);
    expect(createdScores[0].percentile).toBeGreaterThan(50);
    // Classical path untouched: raw sum 6 -> MODERATE per the same cutoffs
    expect(createdScores[0].rawScore).toBe(6);
    expect(createdScores[0].severityBand).toBe('MODERATE');
    expect(createdScores[0].interpretation).toMatch(/IRT EAP theta=0\.5\d+ \(SE=0\.5\d+/);
    expect(dto.score?.thetaEstimate).toBeCloseTo(0.5602645996038873, 2);
    expect(dto.score?.standardError).toBeCloseTo(0.5204017879877768, 2);
  });

  it('classical instrument (no IRT opt-in) persists a null theta and is otherwise unchanged', async () => {
    const { svc, createdScores } = makeService(); // no questionnaire/items on the version

    const dto = await svc.administer(principal, {
      versionId: 'qv_1',
      clientId: 'client_1',
      answers: { q1: 1, q2: 1 },
    });

    expect(createdScores[0].thetaEstimate).toBeNull();
    expect(createdScores[0].standardError).toBeNull();
    expect(createdScores[0].rawScore).toBe(2);
    expect(createdScores[0].severityBand).toBe('LOW');
    expect(createdScores[0].interpretation).not.toMatch(/IRT/);
    expect(dto.score?.thetaEstimate).toBeNull();
  });

  it('IRT-declared instrument WITHOUT calibrated parameters falls back to classical (theta null)', async () => {
    const { svc, createdScores } = makeService({
      questionnaire: { scoringMethod: 'IRT' },
      items: [{ id: 'item_1', linkId: 'q1', parameters: [] }],
    });

    await svc.administer(principal, { versionId: 'qv_1', clientId: 'client_1', answers: { q1: 1 } });

    expect(createdScores[0].thetaEstimate).toBeNull();
    expect(createdScores[0].rawScore).toBe(1);
  });

  it('refuses to score against a mis-calibrated parameter row (fails loudly, nothing persisted)', async () => {
    const { svc, tx } = makeService({
      questionnaire: { scoringMethod: 'IRT' },
      items: [
        // Unordered GRM thresholds — a wrong theta is worse than none.
        { id: 'item_1', linkId: 'q1', parameters: [{ model: 'GRM', a: 1.8, b: 0, c: null, thresholds: [1.1, -0.2, 0.4] }] },
      ],
    });

    await expect(
      svc.administer(principal, { versionId: 'qv_1', clientId: 'client_1', answers: { q1: 2 } }),
    ).rejects.toThrow(/invalid and cannot be scored/i);
    expect(tx.psychometricScore.create).not.toHaveBeenCalled();
  });
});
