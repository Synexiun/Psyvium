import { ConflictException } from '@nestjs/common';
import { CrmErrorCode, type AuthPrincipal } from '@vpsy/contracts';
import { Role } from '@vpsy/contracts';
import { CrmService } from './crm.service';

/**
 * Wave E DoD (`docs/technical/16-crm-and-referrals.md` §6.2 — dedupe):
 * `createLead` never creates a duplicate `Lead` row when the submitted
 * contact deterministically matches an existing NON-converted lead (email or
 * E.164 phone, case/format normalized) — it enriches the existing row
 * instead. A match against an already-CONVERTED lead is routed to care, not
 * merged, via a 409 with a machine-readable code. `getStalledLeads` surfaces
 * active leads whose `updatedAt` is older than the requested cutoff.
 */

const managerPrincipal: AuthPrincipal = {
  userId: 'user_manager',
  tenantId: 'tenant_demo',
  roles: [Role.MANAGER],
  permissions: [],
};

const firstStage = { id: 'stage_new', tenantId: 'tenant_demo', order: 0, name: 'New', isWon: false, isLost: false };

function makeService(overrides: Partial<Record<string, unknown>> = {}) {
  const prisma = {
    referrer: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    pipelineStage: { findFirst: jest.fn().mockResolvedValue(firstStage), findMany: jest.fn().mockResolvedValue([firstStage]) },
    lead: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    engagementActivity: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn() };
  const svc = new CrmService(prisma as any, audit as any, bus as any);
  return { svc, prisma, audit, bus };
}

describe('CrmService.createLead — dedupe (16 §6.2)', () => {
  it('enriches the existing NON-converted lead on an email match instead of creating a duplicate', async () => {
    const existingLead = {
      id: 'lead_existing',
      tenantId: 'tenant_demo',
      source: 'WEB',
      contact: { name: 'J. Doe', email: 'J.Doe@Example.com' },
      presentingInterest: null,
      pipelineStageId: 'stage_new',
      status: 'active',
      referrerId: null,
      convertedClientId: null,
      createdAt: new Date('2026-06-01T00:00:00Z'),
      updatedAt: new Date('2026-06-01T00:00:00Z'),
      pipelineStage: { name: 'New' },
    };
    const updatedLead = {
      ...existingLead,
      contact: { name: 'J. Doe', email: 'j.doe@example.com', phone: '+15551230099' },
      presentingInterest: 'couples counseling',
    };
    const { svc, prisma, audit } = makeService({
      lead: {
        findMany: jest.fn().mockResolvedValue([existingLead]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(updatedLead),
      },
    });

    const result = await svc.createLead(managerPrincipal, {
      source: 'REFERRAL' as const,
      contact: { name: 'J. Doe', email: 'j.doe@example.com', phone: '+1 555-123-0099' },
      presentingInterest: 'couples counseling',
    } as any);

    expect(result.deduped).toBe(true);
    expect(prisma.lead.create).not.toHaveBeenCalled();
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'lead_existing' } }),
    );
    expect(prisma.engagementActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subjectId: 'lead_existing', kind: 'NOTE' }) }),
    );
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'lead.recontact' }));
  });

  it('matches on normalized E.164 phone even with different formatting', async () => {
    const existingLead = {
      id: 'lead_phone_match',
      tenantId: 'tenant_demo',
      source: 'WEB',
      contact: { name: 'Alex', phone: '+15551230099' },
      presentingInterest: null,
      pipelineStageId: 'stage_new',
      status: 'active',
      referrerId: null,
      convertedClientId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      pipelineStage: { name: 'New' },
    };
    const { svc, prisma } = makeService({
      lead: {
        findMany: jest.fn().mockResolvedValue([existingLead]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(existingLead),
      },
    });

    const result = await svc.createLead(managerPrincipal, {
      // Same digits as the existing lead's "+15551230099", just formatted
      // with spaces/dashes — `normalizePhone` strips non-digits but (being
      // an honest simplification, not full E.164 canonicalization) does not
      // add/infer a country code, so the digit count must match.
      source: 'WEB' as const,
      contact: { name: 'Alex', phone: '+1 555-123-0099' },
    } as any);

    expect(result.deduped).toBe(true);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });

  it('returns 409 with LEAD_ALREADY_CLIENT when the match is an already-converted lead', async () => {
    const convertedLead = {
      id: 'lead_converted',
      tenantId: 'tenant_demo',
      source: 'WEB',
      contact: { name: 'Sam Client', email: 'sam@example.com' },
      presentingInterest: null,
      pipelineStageId: 'stage_won',
      status: 'won',
      referrerId: null,
      convertedClientId: 'client_1',
      createdAt: new Date(),
      updatedAt: new Date(),
      pipelineStage: { name: 'Converted' },
    };
    const { svc, prisma, audit } = makeService({
      lead: {
        findMany: jest.fn().mockResolvedValue([convertedLead]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    });

    await expect(
      svc.createLead(managerPrincipal, {
        source: 'CAMPAIGN' as const,
        contact: { name: 'Sam Client', email: 'sam@example.com' },
      } as any),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: CrmErrorCode.LEAD_ALREADY_CLIENT }),
    });

    expect(prisma.lead.create).not.toHaveBeenCalled();
    expect(prisma.lead.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'lead.dedupe_blocked_already_client' }),
    );
  });

  it('creates a fresh lead when no dedupe match exists', async () => {
    const createdLead = {
      id: 'lead_new',
      source: 'WEB',
      contact: { name: 'New Person', email: 'new@example.com' },
      presentingInterest: null,
      pipelineStageId: 'stage_new',
      status: 'active',
      referrerId: null,
      createdAt: new Date(),
      pipelineStage: { name: 'New' },
    };
    const { svc, prisma } = makeService({
      lead: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue(createdLead),
        update: jest.fn(),
      },
    });

    const result = await svc.createLead(managerPrincipal, {
      source: 'WEB' as const,
      contact: { name: 'New Person', email: 'new@example.com' },
    } as any);

    expect(result.deduped).toBeUndefined();
    expect(prisma.lead.create).toHaveBeenCalled();
  });
});

describe('CrmService.getStalledLeads', () => {
  it('returns active leads whose updatedAt is older than the requested cutoff, tagged with the honest "updatedAt" basis', async () => {
    const staleLead = {
      id: 'lead_stale',
      source: 'WEB',
      contact: { name: 'Stale Lead' },
      presentingInterest: null,
      pipelineStageId: 'stage_new',
      status: 'active',
      referrerId: null,
      createdAt: new Date('2026-06-01T00:00:00Z'),
      updatedAt: new Date('2026-06-01T00:00:00Z'),
      pipelineStage: { name: 'New' },
    };
    const { svc, prisma } = makeService({
      lead: {
        findMany: jest.fn().mockResolvedValue([staleLead]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    });

    const result = await svc.getStalledLeads(managerPrincipal, 14);

    expect(prisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'active' }) }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].basis).toBe('updatedAt');
    expect(result[0].daysStalled).toBeGreaterThan(0);
    expect(result[0].staleSince).toBe(staleLead.updatedAt.toISOString());
  });
});
