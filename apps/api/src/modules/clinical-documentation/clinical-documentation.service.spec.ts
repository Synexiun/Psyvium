import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuthPrincipal } from '@vpsy/contracts';
import { ClinicalDocumentationService } from './clinical-documentation.service';

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
    session: { findFirst: jest.fn().mockResolvedValue({ id: 'sess_1', tenantId: 'tenant_demo' }) },
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
  const svc = new ClinicalDocumentationService(prisma as any, audit as any, bus as any, ai as any);
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
    const svc = new ClinicalDocumentationService(prisma as any, audit as any, bus as any, ai as any);
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
        after: expect.objectContaining({ goldenThread: 'anchored' }),
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
