import { NotFoundException } from '@nestjs/common';
import type { AuthPrincipal } from '@vpsy/contracts';
import { TreatmentPlanningService } from './treatment-planning.service';

/**
 * Wave C — Treatment-Plan Support wiring (docs/technical/05-ai-clinical-layer.md
 * §3.3). `aiAssist` must forward ONLY severity band / specialty / outcome-trend
 * signals to the AI Gateway (never history, hypotheses, or client identifiers)
 * and must never create, activate, or supersede a TreatmentPlan.
 */

const principal: AuthPrincipal = {
  userId: 'user_psy_a',
  tenantId: 'tenant_demo',
  roles: [],
  permissions: [],
};

function makeService() {
  const prisma = {
    client: { findFirst: jest.fn().mockResolvedValue({ id: 'client_1', tenantId: 'tenant_demo' }) },
    treatmentPlan: { create: jest.fn(), updateMany: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const ai = {
    suggestTreatmentPlan: jest.fn().mockResolvedValue({
      suggestions: {
        goalSuggestions: ['g1'],
        interventionSuggestions: ['CBT: rationale'],
        measurementCadenceSuggestion: 'every 3 sessions',
      },
      source: 'rule-based',
      aiConfigured: false,
      recommendationId: 'rec_1',
    }),
  };
  const svc = new TreatmentPlanningService(prisma as any, audit as any, bus as any, ai as any);
  return { svc, prisma, audit, bus, ai };
}

describe('TreatmentPlanningService.aiAssist', () => {
  it('forwards only de-identified severity/specialty/outcome-trend signals to the AI Gateway', async () => {
    const { svc, ai } = makeService();

    const result = await svc.aiAssist(principal, {
      clientId: 'client_1',
      severityBand: 'SEVERE',
      specialty: 'anxiety disorders',
      outcomeTrend: 'declining',
    });

    expect(ai.suggestTreatmentPlan).toHaveBeenCalledWith({
      tenantId: 'tenant_demo',
      clientId: 'client_1',
      severityBand: 'SEVERE',
      specialty: 'anxiety disorders',
      outcomeTrend: 'declining',
    });
    // No client history, working hypotheses, or free-text field is part of the call above.
    expect(result.source).toBe('rule-based');
    expect(result.recommendationId).toBe('rec_1');
  });

  it('never creates, activates, or supersedes a TreatmentPlan', async () => {
    const { svc, prisma } = makeService();
    await svc.aiAssist(principal, {
      clientId: 'client_1',
      severityBand: 'LOW',
      specialty: 'general',
      outcomeTrend: 'insufficient-data',
    });
    expect(prisma.treatmentPlan.create).not.toHaveBeenCalled();
    expect(prisma.treatmentPlan.updateMany).not.toHaveBeenCalled();
  });

  it('rejects when the client does not exist in this tenant', async () => {
    const { svc, prisma } = makeService();
    (prisma.client.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      svc.aiAssist(principal, {
        clientId: 'client_missing',
        severityBand: 'LOW',
        specialty: 'general',
        outcomeTrend: 'stable',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
