import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuthPrincipal } from '@vpsy/contracts';
import { ClinicalDocumentationService } from './clinical-documentation.service';
import { FieldCipherService } from '../../common/crypto/field-cipher';
import type { FieldKeyProvider } from '../../common/crypto/field-key-provider';

/** VPSY_FIELD_KEY unset — disabled-mode cipher whose methods are byte-identical passthroughs. */
function disabledCipher(): FieldCipherService {
  const noKeyProvider: FieldKeyProvider = { getKey: async () => null };
  return new FieldCipherService(noKeyProvider);
}

/** A fixed, valid 32-byte test key so keyed-mode tests are deterministic. */
function keyedCipher(key: Buffer = Buffer.alloc(32, 7)): FieldCipherService {
  const provider: FieldKeyProvider = { getKey: async () => key };
  return new FieldCipherService(provider);
}

/**
 * Wave C — Session-Note Assistant wiring (docs/technical/05-ai-clinical-layer.md
 * §3.4). `aiAssist` must forward ONLY the coded signals already present on the
 * request DTO to the AI Gateway (never the session/note content, which this
 * endpoint never even receives) and must never create or mutate a SessionNote.
 */

const principal: AuthPrincipal = {
  userId: 'user_psy_a',
  tenantId: 'tenant_demo',
  roles: [],
  permissions: [],
};

function makeService() {
  const prisma = {
    session: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'sess_1', tenantId: 'tenant_demo', appointment: { clientId: 'client_1' } }),
    },
    sessionNote: { findFirst: jest.fn(), create: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const ai = {
    summarizeSessionNote: jest.fn().mockResolvedValue({
      watermark: 'AI-DRAFT — unsigned; clinician review and edit required before signing',
      draft: { subjective: 's', objective: 'o', assessment: 'a', plan: 'p' },
      source: 'rule-based',
      aiConfigured: false,
      recommendationId: 'rec_1',
    }),
  };
  const svc = new ClinicalDocumentationService(prisma as any, audit as any, bus as any, ai as any, disabledCipher());
  return { svc, prisma, audit, bus, ai };
}

describe('ClinicalDocumentationService.aiAssist', () => {
  it('forwards only coded signals to the AI Gateway and returns its assistive draft untouched', async () => {
    const { svc, ai } = makeService();

    const result = await svc.aiAssist(principal, {
      sessionId: 'sess_1',
      sessionType: 'INDIVIDUAL',
      presentingThemeCodes: ['anxiety-worry'],
      riskPresent: true,
      planGoalIds: ['goal_1'],
    });

    expect(ai.summarizeSessionNote).toHaveBeenCalledWith({
      tenantId: 'tenant_demo',
      clientId: 'client_1',
      sessionId: 'sess_1',
      sessionType: 'INDIVIDUAL',
      presentingThemeCodes: ['anxiety-worry'],
      riskPresent: true,
      planGoalIds: ['goal_1'],
    });
    // No note content/free text/client identifier appears anywhere in the call args above.
    expect(result.source).toBe('rule-based');
    expect(result.recommendationId).toBe('rec_1');
  });

  it('never creates or mutates a SessionNote row', async () => {
    const { svc, prisma } = makeService();
    await svc.aiAssist(principal, {
      sessionId: 'sess_1',
      sessionType: 'INDIVIDUAL',
      presentingThemeCodes: [],
      riskPresent: false,
      planGoalIds: [],
    });
    expect(prisma.sessionNote.create).not.toHaveBeenCalled();
  });

  it('rejects when the session does not exist in this tenant', async () => {
    const { svc, prisma } = makeService();
    (prisma.session.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      svc.aiAssist(principal, {
        sessionId: 'sess_missing',
        sessionType: 'INDIVIDUAL',
        presentingThemeCodes: [],
        riskPresent: false,
        planGoalIds: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * WAVE CR item 8 — golden-thread enforcement (docs/10-10-PROGRAM.md): the
 * CMS/Medicaid audit standard that diagnosis -> plan -> note is traceable,
 * plus the P1 amendment-semantics guard (a signed note is immutable; any
 * further note for that session is a post-signature amendment and must say
 * why).
 */
describe('ClinicalDocumentationService.create — golden-thread enforcement (WAVE CR item 8)', () => {
  const content = { format: 'SOAP' as const, subjective: 's', objective: 'o', assessment: 'a', plan: 'p' };

  function makeCreateService() {
    const prisma = {
      session: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sess_1',
          tenantId: 'tenant_demo',
          startedAt: new Date('2026-01-01T10:00:00Z'),
          endedAt: new Date('2026-01-01T10:50:00Z'),
          modality: 'VIDEO',
          appointment: {
            clientId: 'client_1',
            startsAt: new Date('2026-01-01T10:00:00Z'),
            client: { riskLevel: 'LOW' },
          },
        }),
      },
      sessionNote: {
        findFirst: jest.fn(),
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: 'note_1',
          createdAt: new Date('2026-01-01T11:00:00Z'),
          ...data,
        })),
      },
      treatmentPlan: { findFirst: jest.fn().mockResolvedValue(null) },
      formulation: { findFirst: jest.fn() },
    };
    const audit = { record: jest.fn() };
    const bus = { publish: jest.fn() };
    const ai = { summarizeSessionNote: jest.fn() };
    const svc = new ClinicalDocumentationService(prisma as any, audit as any, bus as any, ai as any, disabledCipher());
    return { svc, prisma, audit, bus };
  }

  const activePlan = {
    id: 'plan_1',
    status: 'active',
    goals: [{ id: 'goal_1' }, { id: 'goal_2' }],
  };

  it('accepts a note that references the active plan + a valid goal, and computes the note-time snapshot', async () => {
    const { svc, prisma, audit } = makeCreateService();
    (prisma.sessionNote.findFirst as jest.Mock)
      .mockResolvedValueOnce(null) // latest
      .mockResolvedValueOnce(null); // priorSigned
    (prisma.treatmentPlan.findFirst as jest.Mock).mockResolvedValue(activePlan);

    const result = await svc.create(principal, {
      sessionId: 'sess_1',
      content,
      planId: 'plan_1',
      goalIds: ['goal_1'],
    } as any);

    expect(result.planId).toBe('plan_1');
    expect(result.goalIds).toEqual(['goal_1']);
    expect(result.sessionSnapshot).toMatchObject({ modality: 'VIDEO', durationMin: 50 });
    expect((result.sessionSnapshot as any)?.goldenThread).toBeUndefined();
    expect(result.riskStatusAtNote).toBe('LOW');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'note.created',
        after: expect.objectContaining({
          goldenThread: 'anchored',
          algorithm: expect.objectContaining({ family: 'documentation.note_quality' }),
        }),
      }),
    );
  });

  it('records optional qualityChecklist presence on note.created audit', async () => {
    const { svc, prisma, audit } = makeCreateService();
    (prisma.sessionNote.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    (prisma.treatmentPlan.findFirst as jest.Mock).mockResolvedValue(activePlan);
    const withChecklist = {
      ...content,
      qualityChecklist: { problemListUpdated: true, riskAssessed: false, goalsLinked: true },
    };

    await svc.create(principal, {
      sessionId: 'sess_1',
      content: withChecklist,
      planId: 'plan_1',
      goalIds: ['goal_1'],
    } as any);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'note.created',
        after: expect.objectContaining({
          qualityChecklistPresent: true,
          qualityChecklistChecked: 2,
          qualityChecklistTotal: 3,
        }),
      }),
    );
  });

  it('rejects (400) a note with no plan/goal refs when the client has an active treatment plan', async () => {
    const { svc, prisma } = makeCreateService();
    (prisma.sessionNote.findFirst as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    (prisma.treatmentPlan.findFirst as jest.Mock).mockResolvedValue(activePlan);

    await expect(svc.create(principal, { sessionId: 'sess_1', content } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects (400) goalIds that do not belong to the active plan', async () => {
    const { svc, prisma } = makeCreateService();
    (prisma.sessionNote.findFirst as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    (prisma.treatmentPlan.findFirst as jest.Mock).mockResolvedValue(activePlan);

    await expect(
      svc.create(principal, {
        sessionId: 'sess_1',
        content,
        planId: 'plan_1',
        goalIds: ['goal_other'],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('flags sessionSnapshot.goldenThread = "no-active-plan" (honest, not silently green) when there is no active plan', async () => {
    const { svc, prisma } = makeCreateService();
    (prisma.sessionNote.findFirst as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    (prisma.treatmentPlan.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await svc.create(principal, { sessionId: 'sess_1', content } as any);

    expect(result.planId).toBeNull();
    expect(result.goalIds).toEqual([]);
    expect(result.sessionSnapshot).toMatchObject({ goldenThread: 'no-active-plan' });
  });

  it('requires amendmentReason (400) when the session already has a prior signed note', async () => {
    const { svc, prisma } = makeCreateService();
    (prisma.sessionNote.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: 'note_0', version: 1 }) // latest
      .mockResolvedValueOnce({ id: 'note_0', signedAt: new Date() }); // priorSigned
    (prisma.treatmentPlan.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(svc.create(principal, { sessionId: 'sess_1', content } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('accepts a post-signature amendment when amendmentReason is provided', async () => {
    const { svc, prisma } = makeCreateService();
    (prisma.sessionNote.findFirst as jest.Mock)
      .mockResolvedValueOnce({ id: 'note_0', version: 1 })
      .mockResolvedValueOnce({ id: 'note_0', signedAt: new Date() });
    (prisma.treatmentPlan.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await svc.create(principal, {
      sessionId: 'sess_1',
      content,
      amendmentReason: 'Correction: client reported additional risk factor post-signature.',
    } as any);

    expect(result.amendmentReason).toBe('Correction: client reported additional risk factor post-signature.');
  });

  it('rejects (404) a formulationId that does not belong to the client/tenant', async () => {
    const { svc, prisma } = makeCreateService();
    (prisma.sessionNote.findFirst as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    (prisma.treatmentPlan.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.formulation.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      svc.create(principal, { sessionId: 'sess_1', content, formulationId: 'form_missing' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * WAVE D P0 — field-level PHI encryption (docs/technical/06-security-and-rbac.md
 * §7): `SessionNote.content` is the highest-value PHI field on this context.
 * These pin the service-level contract on top of the FieldCipherService unit
 * tests in common/crypto/field-cipher.spec.ts.
 */
describe('ClinicalDocumentationService — field-level encryption of content', () => {
  const content = { format: 'SOAP' as const, subjective: 'Client endorsed passive suicidal ideation.', objective: 'o', assessment: 'a', plan: 'p' };

  function makeServiceWithCipher(cipher: FieldCipherService) {
    const prisma = {
      session: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sess_1',
          tenantId: 'tenant_demo',
          startedAt: new Date('2026-01-01T10:00:00Z'),
          endedAt: new Date('2026-01-01T10:50:00Z'),
          modality: 'VIDEO',
          appointment: { clientId: 'client_1', startsAt: new Date('2026-01-01T10:00:00Z'), client: { riskLevel: 'LOW' } },
        }),
      },
      sessionNote: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
        findMany: jest.fn(),
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'note_1', createdAt: new Date(), ...data })),
      },
      treatmentPlan: { findFirst: jest.fn().mockResolvedValue(null) },
      formulation: { findFirst: jest.fn() },
    };
    const audit = { record: jest.fn() };
    const bus = { publish: jest.fn() };
    const ai = { summarizeSessionNote: jest.fn() };
    const svc = new ClinicalDocumentationService(prisma as any, audit as any, bus as any, ai as any, cipher);
    return { svc, prisma };
  }

  it('with a key configured: the row persisted to Prisma is ciphertext, but create() returns the decrypted content transparently', async () => {
    const { svc, prisma } = makeServiceWithCipher(keyedCipher());

    const result = await svc.create(principal, { sessionId: 'sess_1', content } as any);

    // What actually went to Prisma.create is NOT plaintext.
    const persisted = (prisma.sessionNote.create as jest.Mock).mock.calls[0][0].data.content;
    expect(persisted).toMatchObject({ __vpsy_enc: 1, alg: 'xchacha20poly1305' });
    expect(JSON.stringify(persisted)).not.toContain('suicidal');

    // What the caller gets back is the plaintext DTO — controllers/DTOs never see ciphertext.
    expect(result.content).toEqual(content);
  });

  it('round-trips through listBySession as well (every read path decrypts transparently)', async () => {
    const { svc, prisma } = makeServiceWithCipher(keyedCipher());
    await svc.create(principal, { sessionId: 'sess_1', content } as any);
    const persistedNote = (prisma.sessionNote.create as jest.Mock).mock.results[0]!.value;
    (prisma.sessionNote.findMany as jest.Mock).mockResolvedValue([persistedNote]);

    const notes = await svc.listBySession(principal, 'sess_1');
    expect(notes[0]!.content).toEqual(content);
  });

  it('disabled mode (no VPSY_FIELD_KEY): the persisted row is plaintext, byte-identical to pre-encryption behavior', async () => {
    const { svc, prisma } = makeServiceWithCipher(disabledCipher());

    const result = await svc.create(principal, { sessionId: 'sess_1', content } as any);

    const persisted = (prisma.sessionNote.create as jest.Mock).mock.calls[0][0].data.content;
    expect(persisted).toEqual(content); // no envelope — exactly what was passed in
    expect(result.content).toEqual(content);
  });

  it('backward-compat passthrough: a pre-existing plaintext row is still readable once VPSY_FIELD_KEY is later configured', async () => {
    const { svc, prisma } = makeServiceWithCipher(keyedCipher());
    const legacyPlaintextNote = {
      id: 'note_legacy',
      sessionId: 'sess_1',
      content, // never an envelope — written before the key existed
      continuitySummary: null,
      signedAt: null,
      signedBy: null,
      version: 1,
      createdAt: new Date(),
      planId: null,
      goalIds: [],
      formulationId: null,
      riskStatusAtNote: null,
      sessionSnapshot: null,
      amendsVersionId: null,
      amendmentReason: null,
    };
    (prisma.sessionNote.findMany as jest.Mock).mockResolvedValue([legacyPlaintextNote]);

    const notes = await svc.listBySession(principal, 'sess_1');
    expect(notes[0]!.content).toEqual(content);
  });
});
