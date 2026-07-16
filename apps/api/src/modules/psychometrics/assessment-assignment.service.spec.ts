import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, type AuthPrincipal } from '@vpsy/contracts';
import { AssessmentAssignmentService } from './assessment-assignment.service';

/**
 * Assessment-assignment workflow (doc 07 §9). These tests pin the behaviors
 * this service OWNS — role/authority gates, the CAT-rejection rule, the
 * one-open-per-instrument dedup, the compare-and-swap status transitions
 * (ASSIGNED→COMPLETED / ASSIGNED→CANCELLED that make a double-submit or
 * double-cancel impossible), the CLIENT-SELF completion gate, the
 * non-blocking governed AI briefing fire, and the PENDING-ledger briefing
 * reader. Scoring correctness itself is proven in psychometrics/scoring specs,
 * so PsychometricsService is mocked here: the scored pipeline is invoked
 * through the SAME methods the batch administer path uses, and we assert the
 * assignment service wires them, not that they re-derive a band.
 */

const MANAGER: AuthPrincipal = {
  userId: 'user_mgr',
  tenantId: 'tenant_demo',
  roles: [Role.MANAGER], // minimum-necessary mode off by default → caseload ABAC passes
  permissions: [],
};

const CLIENT_PRINCIPAL: AuthPrincipal = {
  userId: 'user_client_1',
  tenantId: 'tenant_demo',
  roles: [Role.CLIENT],
  permissions: [],
};

const CLIENT_ROW = { id: 'client_1', userId: 'user_client_1', riskLevel: 'LOW' };

/** Two-item PUBLIC_DOMAIN static version whose options carry {label,value}. */
function version(overrides: Record<string, unknown> = {}) {
  return {
    id: 'qv_1',
    published: true,
    cutoffs: { bands: [{ band: 'LOW', min: 0, max: 4 }], safetyItems: [] },
    questionnaire: {
      id: 'q_1',
      code: 'PHQ-9',
      name: 'Patient Health Questionnaire-9',
      construct: 'depression',
      scoringMethod: 'CLASSICAL',
      licensing: 'PUBLIC_DOMAIN',
    },
    items: [
      {
        id: 'item_q1',
        linkId: 'q1',
        orderIndex: 0,
        active: true,
        responseOptions: [
          { label: 'Not at all', value: 0 },
          { label: 'Nearly every day', value: 1 },
        ],
        parameters: [],
      },
      {
        id: 'item_q2',
        linkId: 'q2',
        orderIndex: 1,
        active: true,
        responseOptions: [
          { label: 'Not at all', value: 0 },
          { label: 'Nearly every day', value: 1 },
        ],
        parameters: [],
      },
    ],
    ...overrides,
  };
}

/** An assignment row shaped by ASSIGNMENT_INCLUDE (nested questionnaire + _count). */
function assignmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assign_1',
    clientId: 'client_1',
    questionnaireVersionId: 'qv_1',
    assignedBy: 'user_mgr',
    note: null,
    status: 'ASSIGNED',
    dueAt: null,
    responseId: null,
    completedAt: null,
    createdAt: new Date('2026-07-15T00:00:00Z'),
    questionnaireVersion: {
      id: 'qv_1',
      questionnaire: { code: 'PHQ-9', name: 'Patient Health Questionnaire-9', construct: 'depression' },
      _count: { items: 2 },
    },
    ...overrides,
  };
}

function makeHarness(opts: {
  versionRow?: ReturnType<typeof version> | null;
  clientRow?: typeof CLIENT_ROW | null;
  openDuplicate?: boolean;
  updateManyCount?: number;
  existingAssignment?: ReturnType<typeof assignmentRow> | null;
  recommendation?: unknown;
} = {}) {
  const created: any[] = [];
  const assessmentAssignment = {
    findUnique: jest.fn(),
    findFirst: jest.fn().mockImplementation(({ where }: any) => {
      // The dedup probe (status ASSIGNED, questionnaireVersionId present)
      if (where.status === 'ASSIGNED' && where.questionnaireVersionId) {
        return opts.openDuplicate ? { id: 'assign_existing' } : null;
      }
      return opts.existingAssignment ?? null;
    }),
    findMany: jest.fn().mockResolvedValue([assignmentRow()]),
    create: jest.fn().mockImplementation(({ data }: any) => {
      const row = assignmentRow({ id: `assign_${created.length + 1}`, ...data });
      created.push(row);
      return row;
    }),
    updateMany: jest.fn().mockResolvedValue({ count: opts.updateManyCount ?? 1 }),
    update: jest.fn().mockResolvedValue(assignmentRow()),
    findFirstOrThrow: jest.fn().mockImplementation(({ where }: any) =>
      assignmentRow({ id: where.id, status: 'COMPLETED', responseId: 'qr_1', completedAt: new Date() }),
    ),
  };

  const tx = { assessmentAssignment };
  const prisma = {
    questionnaireVersion: {
      findUnique: jest.fn().mockResolvedValue(opts.versionRow === undefined ? version() : opts.versionRow),
    },
    client: {
      findFirst: jest.fn().mockResolvedValue(opts.clientRow === undefined ? CLIENT_ROW : opts.clientRow),
    },
    assessmentAssignment,
    // Caseload ABAC collaborators (unused on the MANAGER/CLIENT fast paths, present for safety).
    psychologist: { findFirst: jest.fn().mockResolvedValue(null) },
    assignment: { findFirst: jest.fn().mockResolvedValue(null) },
    breakGlassGrant: { findFirst: jest.fn().mockResolvedValue(null) },
    instrumentLicenseGrant: { findUnique: jest.fn().mockResolvedValue(null) },
    psychometricScore: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'score_1',
        tenantId: 'tenant_demo',
        response: { client: { id: 'client_1', userId: 'user_client_1' } },
      }),
    },
    aIRecommendation: { findFirst: jest.fn().mockResolvedValue(opts.recommendation ?? null) },
    $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
  };

  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn().mockResolvedValue({ ok: true, errors: [] }), publishDurable: jest.fn() };
  const psychometrics = {
    buildScoreComputation: jest.fn().mockReturnValue({ rawScore: 1 }),
    persistScoredResponse: jest.fn().mockResolvedValue({
      response: { id: 'qr_1' },
      score: { id: 'score_1', severityBand: 'LOW', thetaEstimate: null, standardError: null, interpretation: 'x' },
      raisedFlagIds: [],
    }),
    publishScoredOutcome: jest.fn().mockResolvedValue(undefined),
    getResponse: jest.fn().mockResolvedValue({ id: 'qr_1', answers: { q1: 1, q2: 0 }, score: null }),
  };
  const ai = { interpretScore: jest.fn().mockResolvedValue({ recommendationId: 'rec_1' }) };

  const svc = new AssessmentAssignmentService(
    prisma as any,
    audit as any,
    bus as any,
    psychometrics as any,
    ai as any,
  );
  return { svc, prisma, tx, audit, bus, psychometrics, ai, assessmentAssignment };
}

describe('AssessmentAssignmentService.assign — authority + instrument gates', () => {
  it('rejects a non-clinical role (a client cannot assign, even to themselves)', async () => {
    const { svc } = makeHarness();
    await expect(
      svc.assign(CLIENT_PRINCIPAL, { clientId: 'client_1', versionId: 'qv_1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects assigning a CAT instrument (it is administered through the adaptive flow)', async () => {
    const { svc } = makeHarness({
      versionRow: version({ questionnaire: { ...version().questionnaire, scoringMethod: 'CAT' } }),
    });
    await expect(svc.assign(MANAGER, { clientId: 'client_1', versionId: 'qv_1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a second open assignment of the same instrument (one-open-per-instrument dedup)', async () => {
    const { svc } = makeHarness({ openDuplicate: true });
    await expect(svc.assign(MANAGER, { clientId: 'client_1', versionId: 'qv_1' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404s an unpublished/absent version before any write', async () => {
    const { svc, assessmentAssignment } = makeHarness({ versionRow: null });
    await expect(svc.assign(MANAGER, { clientId: 'client_1', versionId: 'qv_1' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(assessmentAssignment.create).not.toHaveBeenCalled();
  });

  it('creates, audits, and publishes on the happy path', async () => {
    const { svc, assessmentAssignment, audit, bus } = makeHarness();
    const dto = await svc.assign(MANAGER, { clientId: 'client_1', versionId: 'qv_1', note: 'weekly check-in' });
    expect(assessmentAssignment.create).toHaveBeenCalledTimes(1);
    expect(dto.status).toBe('ASSIGNED');
    expect(dto.instrumentCode).toBe('PHQ-9');
    expect(dto.itemCount).toBe(2);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'assessment.assigned' }));
    expect(bus.publish).toHaveBeenCalledWith('assessment.assigned', 'tenant_demo', expect.any(Object));
  });
});

describe('AssessmentAssignmentService.complete — CLIENT-SELF gate + CAS + AI briefing', () => {
  it('forbids completion by anyone but the assigned client', async () => {
    const { svc } = makeHarness({
      existingAssignment: assignmentRow(),
      clientRow: { ...CLIENT_ROW, userId: 'someone_else' },
    });
    await expect(
      svc.complete(CLIENT_PRINCIPAL, 'assign_1', { answers: { q1: 1, q2: 0 } }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects completing an assignment that is not ASSIGNED', async () => {
    const { svc } = makeHarness({ existingAssignment: assignmentRow({ status: 'COMPLETED' }) });
    await expect(
      svc.complete(CLIENT_PRINCIPAL, 'assign_1', { answers: { q1: 1, q2: 0 } }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('CAS-claims ASSIGNED→COMPLETED, links the response, and fires the governed AI briefing', async () => {
    const { svc, assessmentAssignment, psychometrics, ai, bus } = makeHarness({
      existingAssignment: assignmentRow(),
    });
    const out = await svc.complete(CLIENT_PRINCIPAL, 'assign_1', { answers: { q1: 1, q2: 0 } });

    // CAS-first: the status flip is a guarded updateMany (status: ASSIGNED).
    expect(assessmentAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ASSIGNED' }) }),
    );
    expect(psychometrics.persistScoredResponse).toHaveBeenCalledTimes(1);
    expect(assessmentAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ responseId: 'qr_1' }) }),
    );
    expect(out.responseId).toBe('qr_1');
    expect(bus.publish).toHaveBeenCalledWith('assessment.assignment_completed', 'tenant_demo', expect.any(Object));
    // The briefing is requested for the persisted score, non-blocking.
    await Promise.resolve();
    expect(ai.interpretScore).toHaveBeenCalledWith(expect.objectContaining({ scoreId: 'score_1' }));
  });

  it('does not throw to the client when the AI briefing request fails (fire-and-forget)', async () => {
    const { svc, ai } = makeHarness({ existingAssignment: assignmentRow() });
    ai.interpretScore.mockRejectedValueOnce(new Error('gateway down'));
    await expect(
      svc.complete(CLIENT_PRINCIPAL, 'assign_1', { answers: { q1: 1, q2: 0 } }),
    ).resolves.toEqual(expect.objectContaining({ responseId: 'qr_1' }));
  });

  it('surfaces the CAS loser as a conflict when the guarded updateMany matches no row', async () => {
    const { svc } = makeHarness({ existingAssignment: assignmentRow(), updateManyCount: 0 });
    await expect(
      svc.complete(CLIENT_PRINCIPAL, 'assign_1', { answers: { q1: 1, q2: 0 } }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AssessmentAssignmentService.cancel — clinician CAS ASSIGNED→CANCELLED', () => {
  it('rejects cancellation by a non-clinical role', async () => {
    const { svc } = makeHarness({ existingAssignment: assignmentRow() });
    await expect(svc.cancel(CLIENT_PRINCIPAL, 'assign_1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('conflicts when the assignment is no longer ASSIGNED (CAS miss)', async () => {
    const { svc } = makeHarness({ existingAssignment: assignmentRow(), updateManyCount: 0 });
    await expect(svc.cancel(MANAGER, 'assign_1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancels an open assignment and audits it', async () => {
    const { svc, audit } = makeHarness({ existingAssignment: assignmentRow() });
    await svc.cancel(MANAGER, 'assign_1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assessment.assignment_cancelled' }),
    );
  });
});

describe('AssessmentAssignmentService.getScoreBriefing — PENDING-ledger reader (never calls a model)', () => {
  it('returns null when no briefing has been generated yet', async () => {
    const { svc, ai } = makeHarness({ recommendation: null });
    const res = await svc.getScoreBriefing(MANAGER, 'score_1');
    expect(res).toBeNull();
    expect(ai.interpretScore).not.toHaveBeenCalled();
  });

  it('returns the latest recommendation without triggering inference', async () => {
    const { svc, ai } = makeHarness({
      recommendation: {
        id: 'rec_1',
        output: { interpretation: 'assistive draft', source: 'rule-based' },
        humanDecision: 'PENDING',
        createdAt: new Date('2026-07-15T01:00:00Z'),
      },
    });
    const res = await svc.getScoreBriefing(MANAGER, 'score_1');
    expect(res).toEqual(
      expect.objectContaining({ recommendationId: 'rec_1', humanDecision: 'PENDING' }),
    );
    expect(ai.interpretScore).not.toHaveBeenCalled();
  });
});
