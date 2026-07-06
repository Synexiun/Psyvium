import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@vpsy/contracts';
import type { AuthPrincipal } from '@vpsy/contracts';
import { InterventionService } from './intervention.service';

/**
 * Wave C — Intervention Tracking (context 15). Interventions anchor to the
 * client's ACTIVE TreatmentPlan (never a caller-supplied planId); homework
 * completion enforces that a CLIENT principal may only complete their OWN
 * homework, while a clinician may record it on the client's behalf.
 */

const clinician: AuthPrincipal = {
  userId: 'user_psy_a',
  tenantId: 'tenant_demo',
  roles: [Role.PSYCHOLOGIST],
  permissions: [],
};

const clientOwner: AuthPrincipal = {
  userId: 'user_client_1',
  tenantId: 'tenant_demo',
  roles: [Role.CLIENT],
  permissions: [],
};

const otherClient: AuthPrincipal = {
  userId: 'user_client_2',
  tenantId: 'tenant_demo',
  roles: [Role.CLIENT],
  permissions: [],
};

function makeService() {
  const prisma = {
    client: { findFirst: jest.fn().mockResolvedValue({ id: 'client_1', tenantId: 'tenant_demo' }) },
    treatmentPlan: {
      findFirst: jest.fn().mockResolvedValue({ id: 'plan_1', clientId: 'client_1', status: 'active' }),
    },
    goal: { findFirst: jest.fn() },
    session: { findFirst: jest.fn() },
    intervention: {
      create: jest.fn().mockResolvedValue({
        id: 'iv_1',
        planId: 'plan_1',
        goalId: null,
        sessionId: null,
        clinicalTarget: 'panic frequency',
        type: 'CBT',
        modality: 'individual',
        durationMin: null,
        rationale: null,
        clientResponse: null,
        followUpDate: null,
        effectivenessRating: null,
        adverseEffects: null,
        clinicianApproved: false,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
      findFirst: jest.fn().mockResolvedValue({ id: 'iv_1', tenantId: 'tenant_demo' }),
      findMany: jest.fn(),
    },
    homework: {
      create: jest.fn().mockResolvedValue({
        id: 'hw_1',
        interventionId: 'iv_1',
        description: 'Practice diaphragmatic breathing 2x/day',
        dueDate: null,
        completionPct: 0,
        clientReport: null,
        rationale: null,
        difficulty: null,
        reviewedAt: null,
        reviewedBy: null,
        reviewNotes: null,
        reviewOutcome: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const svc = new InterventionService(prisma as any, audit as any, bus as any);
  return { svc, prisma, audit, bus };
}

describe('InterventionService', () => {
  it('creates an Intervention anchored to the client’s active plan and audits it', async () => {
    const { svc, prisma, audit, bus } = makeService();

    const result = await svc.create(clinician, {
      clientId: 'client_1',
      clinicalTarget: 'panic frequency',
      type: 'CBT' as any,
      modality: 'individual',
    });

    expect(prisma.intervention.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ planId: 'plan_1', tenantId: 'tenant_demo' }) }),
    );
    expect(result.planId).toBe('plan_1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'intervention.delivered' }));
    expect(bus.publish).toHaveBeenCalledWith('intervention.delivered', 'tenant_demo', expect.any(Object));
  });

  it('rejects intervention creation when the client has no active treatment plan', async () => {
    const { svc, prisma } = makeService();
    (prisma.treatmentPlan.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      svc.create(clinician, { clientId: 'client_1', clinicalTarget: 'x', type: 'CBT' as any, modality: 'individual' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assigns homework to an existing intervention and audits it', async () => {
    const { svc, prisma, audit } = makeService();

    const result = await svc.assignHomework(clinician, {
      interventionId: 'iv_1',
      description: 'Practice diaphragmatic breathing 2x/day',
    });

    expect(result.interventionId).toBe('iv_1');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'homework.assigned' }));
  });

  it('accepts rationale and difficulty when assigning homework (Kazantzis mechanisms 1 & 2)', async () => {
    const { svc, prisma } = makeService();
    (prisma.homework.create as jest.Mock).mockResolvedValue({
      id: 'hw_1',
      interventionId: 'iv_1',
      description: 'Practice diaphragmatic breathing 2x/day',
      dueDate: null,
      completionPct: 0,
      clientReport: null,
      rationale: 'Builds distress tolerance before next exposure step',
      difficulty: 'gentle',
      reviewedAt: null,
      reviewedBy: null,
      reviewNotes: null,
      reviewOutcome: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const result = await svc.assignHomework(clinician, {
      interventionId: 'iv_1',
      description: 'Practice diaphragmatic breathing 2x/day',
      rationale: 'Builds distress tolerance before next exposure step',
      difficulty: 'gentle',
    });

    expect(prisma.homework.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rationale: 'Builds distress tolerance before next exposure step',
          difficulty: 'gentle',
        }),
      }),
    );
    expect(result.rationale).toBe('Builds distress tolerance before next exposure step');
    expect(result.difficulty).toBe('gentle');
  });

  it('rejects homework assignment when the intervention does not exist in this tenant', async () => {
    const { svc, prisma } = makeService();
    (prisma.intervention.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      svc.assignHomework(clinician, { interventionId: 'iv_missing', description: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets a CLIENT complete their own homework', async () => {
    const { svc, prisma, audit } = makeService();
    (prisma.homework.findFirst as jest.Mock).mockResolvedValue({
      id: 'hw_1',
      interventionId: 'iv_1',
      description: 'Practice diaphragmatic breathing 2x/day',
      dueDate: null,
      completionPct: 0,
      clientReport: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      intervention: { plan: { client: { userId: 'user_client_1' } } },
    });
    (prisma.homework.update as jest.Mock).mockResolvedValue({
      id: 'hw_1',
      interventionId: 'iv_1',
      description: 'Practice diaphragmatic breathing 2x/day',
      dueDate: null,
      completionPct: 100,
      clientReport: 'done, felt calmer',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const result = await svc.completeHomework(clientOwner, 'hw_1', {
      completionPct: 100,
      clientReport: 'done, felt calmer',
    });

    expect(result.completionPct).toBe(100);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'homework.completed' }));
  });

  it('blocks a CLIENT from completing another client’s homework', async () => {
    const { svc, prisma } = makeService();
    (prisma.homework.findFirst as jest.Mock).mockResolvedValue({
      id: 'hw_1',
      interventionId: 'iv_1',
      intervention: { plan: { client: { userId: 'user_client_1' } } },
    });

    await expect(svc.completeHomework(otherClient, 'hw_1', { completionPct: 100 })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets a clinician review homework at the next session and audits it (Kazantzis mechanism 3)', async () => {
    const { svc, prisma, audit } = makeService();
    (prisma.homework.findFirst as jest.Mock).mockResolvedValue({
      id: 'hw_1',
      interventionId: 'iv_1',
      tenantId: 'tenant_demo',
    });
    (prisma.homework.update as jest.Mock).mockResolvedValue({
      id: 'hw_1',
      interventionId: 'iv_1',
      description: 'Practice diaphragmatic breathing 2x/day',
      dueDate: null,
      completionPct: 100,
      clientReport: 'done, felt calmer',
      rationale: null,
      difficulty: null,
      reviewedAt: new Date('2026-01-08T00:00:00Z'),
      reviewedBy: 'user_psy_a',
      reviewNotes: 'Discussed in session; client generalized the skill well',
      reviewOutcome: 'helped',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const result = await svc.reviewHomework(clinician, {
      homeworkId: 'hw_1',
      reviewNotes: 'Discussed in session; client generalized the skill well',
      outcomeAlignment: 'helped',
    });

    expect(prisma.homework.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'hw_1' },
        data: expect.objectContaining({
          reviewedBy: 'user_psy_a',
          reviewNotes: 'Discussed in session; client generalized the skill well',
          reviewOutcome: 'helped',
        }),
      }),
    );
    expect(result.reviewedBy).toBe('user_psy_a');
    expect(result.reviewOutcome).toBe('helped');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'homework.reviewed' }));
  });

  it('rejects homework review when the homework does not exist in this tenant', async () => {
    const { svc, prisma } = makeService();
    (prisma.homework.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      svc.reviewHomework(clinician, { homeworkId: 'hw_missing', reviewNotes: 'n/a' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks a CLIENT from reviewing homework', async () => {
    const { svc, prisma } = makeService();

    await expect(
      svc.reviewHomework(clientOwner, { homeworkId: 'hw_1', reviewNotes: 'trying to self-approve' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.homework.findFirst).not.toHaveBeenCalled();
  });

  it('blocks a CLIENT from listing another client’s interventions', async () => {
    const { svc, prisma } = makeService();
    (prisma.client.findFirst as jest.Mock).mockResolvedValue({
      id: 'client_1',
      tenantId: 'tenant_demo',
      userId: 'user_client_1',
    });

    await expect(svc.listForClient(otherClient, 'client_1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
