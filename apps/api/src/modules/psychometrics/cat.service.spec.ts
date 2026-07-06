import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Role, type AuthPrincipal, type CatSessionStateDto } from '@vpsy/contracts';
import { CatService } from './cat.service';
import { CatSelectionService } from './cat-selection.service';
import { IrtScoringService } from './irt-scoring.service';
import { PsychometricsService } from './psychometrics.service';
import { ScoringService } from './scoring.service';

/**
 * CAT session-flow validation (docs/technical/07-psychometrics-engine.md §6).
 * Selection math is pinned in cat-selection.service.spec.ts; here the
 * STATEFUL flow gets the correctness bar: adaptive selection at the running
 * θ̂, SE trajectory, the three termination rules, and — critically — that
 * completion persists through the SAME pipeline as a batch administration
 * (administrationMode CAT, honest IRT/synthetic labeling, and the
 * deterministic safety-item hook firing exactly as it would on a batch form).
 */

const principal: AuthPrincipal = {
  userId: 'user_psy_a',
  tenantId: 'tenant_demo',
  roles: [],
  permissions: [],
};

const CUTOFFS = {
  bands: [
    { band: 'LOW', min: 0, max: 4 },
    { band: 'MODERATE', min: 5, max: 9 },
    { band: 'HIGH', min: 10, max: 14 },
    { band: 'SEVERE', min: 15, max: 99 },
  ],
  safetyItems: [{ itemId: 'q9', minAnswer: 1, category: 'suicidal_ideation' }],
};

interface BankItem {
  linkId: string;
  a: number;
  thresholds?: number[]; // GRM when present
  b?: number; // 2PL when present
  seEstimates?: unknown;
}

function grmBank(defs: BankItem[]) {
  return defs.map((d, i) => ({
    id: `item_${d.linkId}`,
    linkId: d.linkId,
    stem: `Stem ${d.linkId}`,
    responseOptions: ['0', '1', '2', '3'],
    orderIndex: i,
    parameters: [
      d.thresholds
        ? { model: 'GRM', a: d.a, b: 0, c: null, thresholds: d.thresholds, seEstimates: d.seEstimates ?? null }
        : { model: 'TWO_PL', a: d.a, b: d.b ?? 0, c: null, thresholds: [], seEstimates: d.seEstimates ?? null },
    ],
  }));
}

function makeHarness(opts: {
  items: ReturnType<typeof grmBank>;
  scoringMethod?: string;
  cutoffs?: unknown;
  published?: boolean;
  rng?: () => number;
  clientUserId?: string;
}) {
  const version = {
    id: 'qv_cat',
    published: opts.published ?? true,
    cutoffs: opts.cutoffs ?? CUTOFFS,
    questionnaire: { scoringMethod: opts.scoringMethod ?? 'CAT' },
    items: opts.items,
  };
  const client = {
    id: 'client_1',
    tenantId: 'tenant_demo',
    userId: opts.clientUserId ?? 'user_client_1',
    riskLevel: 'LOW',
  };

  const sessions = new Map<string, any>();
  let seq = 0;
  const catSession = {
    create: jest.fn().mockImplementation(({ data }: any) => {
      const row = {
        id: `cat_${++seq}`,
        terminationReason: null,
        responseId: null,
        completedAt: null,
        deletedAt: null,
        startedAt: new Date(),
        ...data,
      };
      sessions.set(row.id, row);
      return row;
    }),
    findFirst: jest.fn().mockImplementation(({ where }: any) => {
      const row = sessions.get(where.id);
      return row && row.tenantId === where.tenantId ? row : null;
    }),
    update: jest.fn().mockImplementation(({ where, data }: any) => {
      const row = { ...sessions.get(where.id), ...data };
      sessions.set(where.id, row);
      return row;
    }),
  };

  const createdResponses: any[] = [];
  const createdScores: any[] = [];
  const createdRiskFlags: any[] = [];
  const createdEscalations: any[] = [];
  const tx = {
    questionnaireResponse: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        const row = { id: `qr_${createdResponses.length + 1}`, completedAt: new Date(), ...data };
        createdResponses.push(row);
        return row;
      }),
    },
    psychometricScore: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        const row = { id: `score_${createdScores.length + 1}`, createdAt: new Date(), ...data };
        createdScores.push(row);
        return row;
      }),
    },
    riskFlag: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        const row = { id: `flag_${createdRiskFlags.length + 1}`, ...data };
        createdRiskFlags.push(row);
        return row;
      }),
    },
    escalation: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        const row = { id: `esc_${createdEscalations.length + 1}`, ...data };
        createdEscalations.push(row);
        return row;
      }),
    },
    client: { update: jest.fn().mockImplementation(({ data }: any) => ({ ...client, ...data })) },
    outboxEvent: { create: jest.fn() },
    catSession,
  };

  const prisma = {
    questionnaireVersion: { findUnique: jest.fn().mockResolvedValue(version) },
    client: { findFirst: jest.fn().mockResolvedValue(client) },
    questionnaireResponse: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        const r = createdResponses.find((x) => x.id === where.id) ?? null;
        return r ? { ...r, score: createdScores.find((s) => s.responseId === r.id) ?? null } : null;
      }),
    },
    catSession,
    $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  };

  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn(), publishDurable: jest.fn() };
  const scoring = new ScoringService();
  const irt = new IrtScoringService();
  const selection = new CatSelectionService();
  selection.rng = opts.rng ?? (() => 0); // pinned: always THE max-information item
  const ai = { interpretScore: jest.fn() };
  const psychometrics = new PsychometricsService(prisma as any, scoring, irt, audit as any, bus as any, ai as any);
  const cat = new CatService(prisma as any, selection, irt, psychometrics, audit as any);

  return { cat, irt, selection, prisma, tx, audit, bus, sessions, createdResponses, createdScores, createdRiskFlags, createdEscalations };
}

/** Drives a session to completion with a scripted per-step answer rule. */
async function runSession(
  cat: CatService,
  who: AuthPrincipal,
  answerFor: (state: CatSessionStateDto, step: number) => number,
): Promise<CatSessionStateDto[]> {
  const states: CatSessionStateDto[] = [];
  let state = await cat.start(who, { versionId: 'qv_cat', clientId: 'client_1' });
  states.push(state);
  let step = 0;
  while (state.status === 'ACTIVE') {
    if (!state.nextItem) throw new Error('ACTIVE session without a pending item');
    state = await cat.answer(who, state.sessionId, { itemId: state.nextItem.itemId, answer: answerFor(state, step++) });
    states.push(state);
    if (step > 50) throw new Error('runaway session');
  }
  return states;
}

// Strong GRM bank (a=3) — reaches SE ≤ 0.30 in a handful of items.
const STRONG_BANK: BankItem[] = [
  { linkId: 'q1', a: 3.0, thresholds: [-0.6, 0, 0.6] },
  { linkId: 'q2', a: 3.0, thresholds: [-1.0, -0.4, 0.2] },
  { linkId: 'q3', a: 3.0, thresholds: [-0.2, 0.4, 1.0] },
  { linkId: 'q4', a: 3.0, thresholds: [-1.4, -0.8, -0.2] },
  { linkId: 'q5', a: 3.0, thresholds: [0.2, 0.8, 1.4] },
  { linkId: 'q6', a: 3.0, thresholds: [-0.8, -0.2, 0.4] },
  { linkId: 'q7', a: 3.0, thresholds: [-0.4, 0.2, 0.8] },
  { linkId: 'q8', a: 3.0, thresholds: [-1.2, -0.6, 0.0] },
];

describe('CatService.start — CAT opt-in gate + first-item selection', () => {
  it('rejects an instrument that does not DECLARE CAT scoring (IRT batch-only stays batch-only)', async () => {
    const { cat } = makeHarness({ items: grmBank(STRONG_BANK), scoringMethod: 'IRT' });
    await expect(cat.start(principal, { versionId: 'qv_cat', clientId: 'client_1' })).rejects.toThrow(
      /does not declare CAT/i,
    );
  });

  it('rejects a CAT instrument with no calibrated items', async () => {
    const items = grmBank(STRONG_BANK.slice(0, 2)).map((i) => ({ ...i, parameters: [] }));
    const { cat } = makeHarness({ items });
    await expect(cat.start(principal, { versionId: 'qv_cat', clientId: 'client_1' })).rejects.toThrow(
      /no calibrated items/i,
    );
  });

  it('selects the first item by maximum Fisher information at the prior mean theta=0 (rng pinned)', async () => {
    const { cat, irt, selection } = makeHarness({ items: grmBank(STRONG_BANK) });
    const state = await cat.start(principal, { versionId: 'qv_cat', clientId: 'client_1' });

    // Independent argmax over the bank at theta = 0.
    let best = '';
    let bestInfo = -1;
    for (const d of STRONG_BANK) {
      const info = selection.itemInformation(
        irt.parseParams({ model: 'GRM', a: d.a, b: 0, c: null, thresholds: d.thresholds }, d.linkId),
        0,
      );
      if (info > bestInfo) {
        bestInfo = info;
        best = `item_${d.linkId}`;
      }
    }
    expect(state.nextItem?.itemId).toBe(best);
    expect(state.status).toBe('ACTIVE');
    expect(state.itemsAnswered).toBe(0);
    expect(state.currentTheta).toBe(0); // prior mean
    expect(state.currentSE).toBe(1); // prior SD
    // Calibration parameters must never leak to the respondent.
    expect(JSON.stringify(state.nextItem)).not.toMatch(/thresholds|"a":|params/);
  });

  it('ABAC: a CLIENT cannot start a session for another client', async () => {
    const { cat } = makeHarness({ items: grmBank(STRONG_BANK), clientUserId: 'user_someone_else' });
    const clientPrincipal: AuthPrincipal = { ...principal, userId: 'user_client_1', roles: [Role.CLIENT] };
    await expect(cat.start(clientPrincipal, { versionId: 'qv_cat', clientId: 'client_1' })).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('CatService.answer — stateful adaptive flow', () => {
  it('rejects an answer that does not target the pending item (stale/duplicate submit fails loudly)', async () => {
    const { cat } = makeHarness({ items: grmBank(STRONG_BANK) });
    const state = await cat.start(principal, { versionId: 'qv_cat', clientId: 'client_1' });
    await expect(cat.answer(principal, state.sessionId, { itemId: 'item_q_wrong', answer: 2 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an out-of-range category BEFORE mutating any session state', async () => {
    const { cat, prisma } = makeHarness({ items: grmBank(STRONG_BANK) });
    const state = await cat.start(principal, { versionId: 'qv_cat', clientId: 'client_1' });
    await expect(
      cat.answer(principal, state.sessionId, { itemId: state.nextItem!.itemId, answer: 7 }),
    ).rejects.toThrow(/must be an integer in \[0, 3\]/);
    expect(prisma.catSession.update).not.toHaveBeenCalled();
  });

  it('SE is monotonically non-increasing across a scripted session, and theta history tracks every answer', async () => {
    const { cat } = makeHarness({ items: grmBank(STRONG_BANK) });
    const states = await runSession(cat, principal, () => 2); // fixed scripted pattern

    const final = states[states.length - 1]!;
    expect(final.status).toBe('COMPLETED');
    const ses = final.thetaHistory.map((p) => p.standardError);
    expect(ses.length).toBe(final.itemsAnswered);
    expect(ses[0]!).toBeLessThan(1); // first answer already beats the prior SD
    for (let i = 1; i < ses.length; i++) {
      expect(ses[i]!).toBeLessThanOrEqual(ses[i - 1]! + 1e-9);
    }
  });

  it('terminates with SE_TARGET_REACHED once SE(theta) <= 0.30 and persists via the batch pipeline (administrationMode CAT)', async () => {
    const { cat, createdResponses, createdScores, bus } = makeHarness({ items: grmBank(STRONG_BANK) });
    const states = await runSession(cat, principal, () => 2);
    const final = states[states.length - 1]!;

    expect(final.terminationReason).toBe('SE_TARGET_REACHED');
    expect(final.currentSE!).toBeLessThanOrEqual(0.3);
    expect(final.itemsAnswered).toBeLessThan(STRONG_BANK.length); // adaptive: fewer items than the bank

    // Persisted through the SAME pipeline as a batch administration.
    expect(createdResponses).toHaveLength(1);
    expect(createdResponses[0].administrationMode).toBe('CAT');
    expect(createdResponses[0].answers).toEqual(
      Object.fromEntries(final.thetaHistory.map((p) => [p.linkId, p.answer])),
    );
    expect(createdScores).toHaveLength(1);
    // The persisted theta/SE ARE the session's final EAP estimate (same estimator, same answers).
    expect(createdScores[0].thetaEstimate).toBeCloseTo(final.currentTheta!, 10);
    expect(createdScores[0].standardError).toBeCloseTo(final.currentSE!, 10);
    expect(createdScores[0].interpretation).toMatch(/IRT EAP theta=/);
    expect(createdScores[0].interpretation).toMatch(/requires clinician confirmation/);
    expect(final.responseId).toBe(createdResponses[0].id);
    expect(final.score?.thetaEstimate).toBeCloseTo(final.currentTheta!, 10);
    expect(bus.publish).toHaveBeenCalledWith(
      'assessment.scored',
      'tenant_demo',
      expect.objectContaining({ responseId: createdResponses[0].id, clientId: 'client_1' }),
    );

    // A completed session refuses further answers.
    await expect(
      cat.answer(principal, final.sessionId, { itemId: 'item_q1', answer: 1 }),
    ).rejects.toThrow(ConflictException);
  });

  it('terminates with MAX_ITEMS_REACHED at 12 items when the bank is too weak to hit the SE target', async () => {
    const weak: BankItem[] = Array.from({ length: 20 }, (_, i) => ({
      linkId: `q${i + 1}`,
      a: 0.5,
      b: (i % 5) - 2,
    }));
    const { cat } = makeHarness({ items: grmBank(weak) });
    const states = await runSession(cat, principal, (_s, step) => step % 2); // alternating 1/0

    const final = states[states.length - 1]!;
    expect(final.terminationReason).toBe('MAX_ITEMS_REACHED');
    expect(final.itemsAnswered).toBe(12);
    expect(final.currentSE!).toBeGreaterThan(0.3);
  });

  it('terminates with ITEM_BANK_EXHAUSTED when every calibrated item was administered before the SE target', async () => {
    const tiny: BankItem[] = [
      { linkId: 'q1', a: 0.9, thresholds: [-1, 0, 1] },
      { linkId: 'q2', a: 0.8, thresholds: [-0.5, 0.5, 1.5] },
      { linkId: 'q3', a: 0.7, thresholds: [-1.5, -0.5, 0.5] },
    ];
    const { cat } = makeHarness({ items: grmBank(tiny) });
    const states = await runSession(cat, principal, () => 1);

    const final = states[states.length - 1]!;
    expect(final.terminationReason).toBe('ITEM_BANK_EXHAUSTED');
    expect(final.itemsAnswered).toBe(3);
    expect(final.currentSE!).toBeGreaterThan(0.3);
  });

  it('fires the deterministic safety-item hook on completion when an administered safety item was endorsed', async () => {
    // Two items only, one of them the configured safety item q9 → both get
    // administered, bank exhausts, and the endorsed q9 (answer 2 >= minAnswer 1)
    // must raise a SEVERE RiskFlag + Escalation exactly like a batch form.
    const bank: BankItem[] = [
      { linkId: 'q1', a: 1.2, thresholds: [-1, 0, 1] },
      { linkId: 'q9', a: 1.0, thresholds: [-0.5, 0.5, 1.5] },
    ];
    const { cat, createdRiskFlags, createdEscalations, bus, tx } = makeHarness({ items: grmBank(bank) });
    const states = await runSession(cat, principal, () => 2); // every item answered 2 → q9 endorsed at 2

    expect(states[states.length - 1]!.status).toBe('COMPLETED');
    expect(createdRiskFlags).toHaveLength(1);
    expect(createdRiskFlags[0]).toMatchObject({
      clientId: 'client_1',
      type: 'SUICIDAL_IDEATION',
      severity: 'SEVERE', // graduated: answer 2 >= 2
      source: 'SCREENING',
      status: 'ESCALATED',
    });
    expect(createdEscalations).toHaveLength(1);
    expect(tx.client.update).toHaveBeenCalledWith({ where: { id: 'client_1' }, data: { riskLevel: 'SEVERE' } });
    // Durable (ADR-005): published in the same transaction as the CatSession
    // close, not via the direct fire-and-forget publish().
    expect(bus.publishDurable).toHaveBeenCalledWith(
      tx,
      'risk.flag.raised',
      'tenant_demo',
      expect.objectContaining({ riskFlagId: createdRiskFlags[0].id, clientId: 'client_1' }),
    );
  });

  it('never raises a safety flag when the safety item was administered but NOT endorsed', async () => {
    const bank: BankItem[] = [
      { linkId: 'q1', a: 1.2, thresholds: [-1, 0, 1] },
      { linkId: 'q9', a: 1.0, thresholds: [-0.5, 0.5, 1.5] },
    ];
    const { cat, createdRiskFlags } = makeHarness({ items: grmBank(bank) });
    await runSession(cat, principal, () => 0); // q9 answered 0 < minAnswer 1
    expect(createdRiskFlags).toHaveLength(0);
  });

  it('brands the persisted interpretation with the synthetic-calibration warning when the calibration is demo-only', async () => {
    const synthetic = STRONG_BANK.map((d) => ({ ...d, seEstimates: { sample: 'demo calibration (synthetic)' } }));
    const { cat, createdScores } = makeHarness({ items: grmBank(synthetic) });
    await runSession(cat, principal, () => 2);
    expect(createdScores[0].interpretation).toMatch(/SYNTHETIC CALIBRATION — DEMO ONLY/);
  });

  it('ABAC: a CLIENT cannot answer another client\'s session', async () => {
    const { cat, sessions } = makeHarness({ items: grmBank(STRONG_BANK), clientUserId: 'user_owner' });
    const state = await cat.start(principal, { versionId: 'qv_cat', clientId: 'client_1' });
    const intruder: AuthPrincipal = { ...principal, userId: 'user_intruder', roles: [Role.CLIENT] };
    await expect(
      cat.answer(intruder, state.sessionId, { itemId: state.nextItem!.itemId, answer: 1 }),
    ).rejects.toThrow(ForbiddenException);
    expect(sessions.get(state.sessionId).answers).toEqual({});
  });
});

describe('CatService — full simulated session recovers the generating theta', () => {
  it('a scripted respondent at theta_true = 1.2 lands the EAP estimate near 1.2', async () => {
    // 15-item GRM bank with locations spread across the trait range.
    const bank: BankItem[] = Array.from({ length: 15 }, (_, i) => {
      const center = -2 + (4 * i) / 14; // -2 .. +2
      return { linkId: `q${i + 1}`, a: 1.8 + 0.4 * (i % 3), thresholds: [center - 0.7, center, center + 0.7] };
    });
    const { cat, irt } = makeHarness({ items: grmBank(bank) });
    const THETA_TRUE = 1.2;
    const byItemId = new Map(bank.map((d) => [`item_${d.linkId}`, d]));

    // Deterministic scripted respondent: always the MOST LIKELY category at theta_true.
    const states = await runSession(cat, principal, (state) => {
      const def = byItemId.get(state.nextItem!.itemId)!;
      const probs = irt.categoryProbabilities(
        irt.parseParams({ model: 'GRM', a: def.a, b: 0, c: null, thresholds: def.thresholds }, def.linkId),
        THETA_TRUE,
      );
      return probs.indexOf(Math.max(...probs));
    });

    const final = states[states.length - 1]!;
    expect(final.status).toBe('COMPLETED');
    expect(Math.abs(final.currentTheta! - THETA_TRUE)).toBeLessThan(0.4);
    // Adaptive selection concentrated items near theta_true, so the session is efficient:
    expect(final.itemsAnswered).toBeLessThanOrEqual(12);
    expect(final.currentSE!).toBeLessThan(0.5);
  });
});

describe('CatService.getState', () => {
  it('returns the pending item + trajectory for an ACTIVE session and the final score once COMPLETED', async () => {
    const { cat } = makeHarness({ items: grmBank(STRONG_BANK) });
    const s0 = await cat.start(principal, { versionId: 'qv_cat', clientId: 'client_1' });
    const s1 = await cat.answer(principal, s0.sessionId, { itemId: s0.nextItem!.itemId, answer: 2 });

    const active = await cat.getState(principal, s0.sessionId);
    expect(active.status).toBe('ACTIVE');
    expect(active.itemsAnswered).toBe(1);
    expect(active.nextItem?.itemId).toBe(s1.nextItem?.itemId);
    expect(active.thetaHistory).toHaveLength(1);

    // Drive to completion.
    let state = s1;
    while (state.status === 'ACTIVE') {
      state = await cat.answer(principal, state.sessionId, { itemId: state.nextItem!.itemId, answer: 2 });
    }
    const done = await cat.getState(principal, s0.sessionId);
    expect(done.status).toBe('COMPLETED');
    expect(done.nextItem).toBeNull();
    expect(done.responseId).toBe(state.responseId);
    expect(done.score?.thetaEstimate).toBeCloseTo(state.currentTheta!, 10);
  });
});
