import { NotFoundException } from '@nestjs/common';
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
