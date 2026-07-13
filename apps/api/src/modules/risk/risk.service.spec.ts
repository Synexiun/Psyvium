import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SeverityBand, type AuthPrincipal } from '@vpsy/contracts';
import { RiskService } from './risk.service';
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
 * Phase 4 DoD (docs/technical/13-roadmap-and-phases.md): "Break-glass access
 * flow audited + alerts DPO" and the CORE PRINCIPLE that risk escalation
 * resolution is always a human decision, never automated. These tests pin
 * the three safety-critical behaviors of RiskService.
 */

const principal: AuthPrincipal = {
  userId: 'user_psy_a',
  tenantId: 'tenant_demo',
  roles: [],
  permissions: [],
};

const escalationRow = {
  id: 'esc_1',
  riskFlagId: 'flag_1',
  openedAt: new Date('2026-01-01T00:00:00Z'),
  assignedTo: null as string | null,
  resolvedAt: null as Date | null,
  resolution: null as string | null,
  slaBreached: false,
  riskFlag: {
    id: 'flag_1',
    clientId: 'client_1',
    type: 'SUICIDAL_IDEATION',
    severity: 'SEVERE',
    source: 'SCREENING',
    evidence: 'Endorsed active ideation on intake safety screen',
    status: 'ESCALATED',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    client: { user: { fullName: 'Alex Chen' } },
  },
};

function makeService(overrides: Partial<Record<string, unknown>> = {}, cipher: FieldCipherService = disabledCipher()) {
  const prisma = {
    escalation: {
      findFirst: jest.fn().mockResolvedValue(escalationRow),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    riskFlag: {
      update: jest.fn(),
    },
    client: {
      findFirst: jest.fn().mockResolvedValue({ id: 'client_1', tenantId: 'tenant_demo' }),
    },
    safetyPlan: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    breakGlassGrant: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    incidentReview: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ countryCode: 'US' }),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prismaTx)),
    ...overrides,
  };
  const prismaTx = {
    escalation: {
      update: jest.fn().mockImplementation(({ data }: any) => ({
        ...escalationRow,
        ...data,
        riskFlag: escalationRow.riskFlag,
      })),
    },
    riskFlag: { update: jest.fn() },
    outboxEvent: { create: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const bus = { publish: jest.fn(), publishDurable: jest.fn() };
  const clinicalAccess = {
    listAccessibleClientIds: jest.fn().mockResolvedValue(null),
    assertCanAccessClient: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new RiskService(prisma as any, audit as any, bus as any, cipher, clinicalAccess as any);
  return { svc, prisma, audit, bus, prismaTx, clinicalAccess };
}

describe('RiskService.resolveEscalation', () => {
  it('rejects when no human principal is present — AI/automation can never resolve an escalation', async () => {
    const { svc, prisma, audit } = makeService();
    await expect(
      svc.resolveEscalation({ tenantId: 'tenant_demo' } as AuthPrincipal, 'esc_1', {
        resolution: 'Auto-resolved by risk-triage agent',
        riskLevelAtResolution: SeverityBand.LOW,
        interventionsApplied: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.escalation.findFirst).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('sets resolvedAt + resolution and records an audit event for a real human principal', async () => {
    const { svc, audit, bus, prismaTx } = makeService();
    const result = await svc.resolveEscalation(principal, 'esc_1', {
      resolution: 'Contacted client by phone; safety plan reviewed; no acute risk, follow-up booked.',
      riskLevelAtResolution: SeverityBand.LOW,
      interventionsApplied: ['Phone contact', 'Safety plan review'],
    });

    expect(result.resolvedAt).not.toBeNull();
    expect(result.resolution).toBe(
      'Contacted client by phone; safety plan reviewed; no acute risk, follow-up booked.',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'escalation.resolved', actorId: 'user_psy_a' }),
    );
    expect(bus.publishDurable).toHaveBeenCalledWith(
      prismaTx,
      'escalation.resolved',
      'tenant_demo',
      expect.objectContaining({ escalationId: 'esc_1' }),
    );
  });

  it('rejects re-resolving an already-resolved escalation', async () => {
    const { svc } = makeService({
      escalation: {
        findFirst: jest.fn().mockResolvedValue({ ...escalationRow, resolvedAt: new Date() }),
        update: jest.fn(),
      },
    });
    await expect(
      svc.resolveEscalation(principal, 'esc_1', {
        resolution: 'Second attempt',
        riskLevelAtResolution: SeverityBand.LOW,
        interventionsApplied: [],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects when the escalation does not exist in this tenant', async () => {
    const { svc } = makeService({ escalation: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } });
    await expect(
      svc.resolveEscalation(principal, 'esc_missing', {
        resolution: 'x'.repeat(10),
        riskLevelAtResolution: SeverityBand.LOW,
        interventionsApplied: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects resolving with riskLevelAtResolution SEVERE/HIGH and no followUpDueAt (SAFE-T / NPSG 15.01.01)', async () => {
    const { svc, prisma } = makeService();
    await expect(
      svc.resolveEscalation(principal, 'esc_1', {
        resolution: 'Client stabilized, still at elevated risk, needs caring-contact follow-up.',
        riskLevelAtResolution: SeverityBand.SEVERE,
        interventionsApplied: ['Safety plan updated'],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('accepts resolving with riskLevelAtResolution SEVERE when followUpDueAt is supplied', async () => {
    const { svc } = makeService();
    const followUpDueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const result = await svc.resolveEscalation(principal, 'esc_1', {
      resolution: 'Client stabilized, still at elevated risk, follow-up scheduled within 24h.',
      riskLevelAtResolution: SeverityBand.SEVERE,
      interventionsApplied: ['Safety plan updated', 'Means restriction counseling'],
      followUpDueAt,
    });
    expect(result.resolvedAt).not.toBeNull();
  });
});

describe('RiskService.assignEscalation', () => {
  it('publishes EscalationAssigned durably, in the same transaction as the assignment (ADR-005)', async () => {
    const { svc, prisma, bus, prismaTx } = makeService();
    const result = await svc.assignEscalation(principal, 'esc_1', { assignedTo: 'user_psy_b' });

    expect(result.assignedTo).toBe('user_psy_b');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(bus.publishDurable).toHaveBeenCalledWith(
      prismaTx,
      'escalation.assigned',
      'tenant_demo',
      expect.objectContaining({ escalationId: 'esc_1', assignedTo: 'user_psy_b' }),
    );
    expect(bus.publish).not.toHaveBeenCalled();
  });
});

describe('RiskService.completeFollowUp', () => {
  it('rejects completing follow-up on an escalation with no followUpDueAt scheduled', async () => {
    const { svc } = makeService();
    await expect(svc.completeFollowUp(principal, 'esc_1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects double-completion of the same follow-up (idempotency guard)', async () => {
    const { svc } = makeService({
      escalation: {
        findFirst: jest.fn().mockResolvedValue({
          ...escalationRow,
          followUpDueAt: new Date('2026-01-02T00:00:00Z'),
          followUpCompletedAt: new Date('2026-01-02T01:00:00Z'),
        }),
        update: jest.fn(),
      },
    });
    await expect(svc.completeFollowUp(principal, 'esc_1', {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('records followUpCompletedAt and an audit event when a follow-up is due and not yet completed', async () => {
    const { svc, prisma, audit } = makeService({
      escalation: {
        findFirst: jest.fn().mockResolvedValue({
          ...escalationRow,
          followUpDueAt: new Date('2026-01-02T00:00:00Z'),
          followUpCompletedAt: null,
        }),
        update: jest.fn().mockImplementation(({ data }: any) => ({
          ...escalationRow,
          followUpDueAt: new Date('2026-01-02T00:00:00Z'),
          ...data,
        })),
      },
    });
    const result = await svc.completeFollowUp(principal, 'esc_1', { notes: 'Reached client by phone.' });
    expect(result.followUpCompletedAt).not.toBeNull();
    expect(prisma.escalation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'esc_1' } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'escalation.followup_completed', actorId: 'user_psy_a' }),
    );
  });
});

describe('RiskService.getMySafetyPlan', () => {
  it('rejects when the authenticated principal has no Client row in this tenant', async () => {
    const { svc } = makeService({
      client: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(svc.getMySafetyPlan(principal)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the latest safety plan for the client owned by the authenticated principal (own-only)', async () => {
    const plan = {
      id: 'plan_1',
      clientId: 'client_1',
      version: 1,
      warningSigns: ['Isolating from friends'],
      copingStrategies: ['Call support contact'],
      supportContacts: [],
      professionalContacts: [],
      distractionContacts: null,
      helpContacts: null,
      crisisLineInfo: { label: '988 Suicide & Crisis Lifeline', phone: '988' },
      meansRestriction: null,
      clientAcknowledgedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const { svc, prisma } = makeService({
      client: { findFirst: jest.fn().mockResolvedValue({ id: 'client_1', tenantId: 'tenant_demo' }) },
      safetyPlan: { findFirst: jest.fn().mockResolvedValue(plan), create: jest.fn() },
    });
    const result = await svc.getMySafetyPlan(principal);
    expect(result?.id).toBe('plan_1');
    expect(prisma.client.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: principal.userId, tenantId: principal.tenantId }) }),
    );
  });
});

describe('RiskService.breakGlass', () => {
  it('creates a grant with exactly a 1-hour expiry and records a HIGH-priority audit + DPO-alert event', async () => {
    const { svc, prisma, audit, bus } = makeService();
    (prisma.breakGlassGrant.create as jest.Mock).mockImplementation(({ data }: any) => ({ ...data, id: 'grant_1' }));

    const result = await svc.breakGlass(principal, {
      clientId: 'client_1',
      reason: 'Client unreachable after a SEVERE risk flag; welfare check required immediately.',
    });

    const grantedAt = new Date(result.grantedAt).getTime();
    const expiresAt = new Date(result.expiresAt).getTime();
    expect(expiresAt - grantedAt).toBe(60 * 60 * 1000);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'breakglass.invoked',
        actorId: 'user_psy_a',
        after: expect.objectContaining({ severity: 'HIGH' }),
      }),
    );
    expect(bus.publish).toHaveBeenCalledWith(
      'breakglass.invoked',
      'tenant_demo',
      expect.objectContaining({ grantId: 'grant_1', clientId: 'client_1' }),
    );
  });

  it('rejects a break-glass request without a client', async () => {
    const { svc } = makeService({ client: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(
      svc.breakGlass(principal, { clientId: 'nope', reason: 'A' + 'x'.repeat(20) }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RiskService.listPendingIncidentReviews', () => {
  it('surfaces an unreviewed SEVERE escalation resolution and an unreviewed break-glass grant — "never ages silently"', async () => {
    const resolvedSevereEscalation = {
      id: 'esc_severe_1',
      resolvedAt: new Date('2026-01-01T00:00:00Z'),
      resolution: 'Client stabilized after welfare check.',
      riskFlag: {
        clientId: 'client_1',
        severity: 'SEVERE',
        client: { user: { fullName: 'Alex Chen' } },
      },
    };
    const unreviewedGrant = {
      id: 'grant_1',
      clientId: 'client_2',
      reason: 'Client unreachable after a SEVERE risk flag; welfare check required immediately.',
      grantedAt: new Date('2026-01-02T00:00:00Z'),
      client: { user: { fullName: 'Jordan Lee' } },
    };
    const { svc, prisma } = makeService({
      escalation: {
        findFirst: jest.fn().mockResolvedValue(escalationRow),
        findMany: jest.fn().mockResolvedValue([resolvedSevereEscalation]),
        update: jest.fn(),
      },
      incidentReview: {
        create: jest.fn(),
        // Neither review lookup (escalation-kind or break-glass-kind) has an
        // existing row yet, so both subjects below must surface as pending.
        findMany: jest.fn().mockResolvedValue([]),
      },
      breakGlassGrant: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([unreviewedGrant]),
      },
    });

    const result = await svc.listPendingIncidentReviews(principal);

    expect(prisma.escalation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant_demo',
          resolvedAt: { not: null },
          riskFlag: { severity: 'SEVERE' },
        }),
      }),
    );
    expect(result.items).toHaveLength(2);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'ESCALATION_RESOLUTION', subjectId: 'esc_severe_1', clientName: 'Alex Chen' }),
        expect.objectContaining({ kind: 'BREAK_GLASS', subjectId: 'grant_1', clientName: 'Jordan Lee' }),
      ]),
    );
  });

  it('omits a SEVERE resolution and a break-glass grant once each has an IncidentReview row', async () => {
    const resolvedSevereEscalation = {
      id: 'esc_severe_1',
      resolvedAt: new Date('2026-01-01T00:00:00Z'),
      resolution: 'Client stabilized.',
      riskFlag: { clientId: 'client_1', severity: 'SEVERE', client: { user: { fullName: 'Alex Chen' } } },
    };
    const reviewedGrant = {
      id: 'grant_1',
      clientId: 'client_2',
      reason: 'Welfare check.',
      grantedAt: new Date('2026-01-02T00:00:00Z'),
      client: { user: { fullName: 'Jordan Lee' } },
    };
    const { svc } = makeService({
      escalation: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([resolvedSevereEscalation]), update: jest.fn() },
      incidentReview: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([{ subjectId: 'esc_severe_1' }, { subjectId: 'grant_1' }]),
      },
      breakGlassGrant: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([reviewedGrant]) },
    });

    const result = await svc.listPendingIncidentReviews(principal);
    expect(result.items).toHaveLength(0);
  });
});

describe('RiskService.createIncidentReview', () => {
  it('records a critical, tamper-evident audit event on creation (post-incident review is part of the safety record)', async () => {
    const { svc, prisma, audit } = makeService({
      breakGlassGrant: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: 'grant_1', tenantId: 'tenant_demo' }),
        findMany: jest.fn(),
      },
      incidentReview: {
        create: jest.fn().mockImplementation(({ data }: any) => ({
          ...data,
          id: 'review_1',
          reviewedAt: new Date('2026-01-03T00:00:00Z'),
          createdAt: new Date('2026-01-03T00:00:00Z'),
        })),
        findMany: jest.fn(),
      },
    });

    const result = await svc.createIncidentReview(principal, {
      kind: 'BREAK_GLASS',
      subjectId: 'grant_1',
      findings: 'Access was clinically justified; client welfare confirmed within the hour.',
      actionItems: ['Document outcome in chart'],
      cosignedBy: 'user_supervisor_a',
    });

    expect(result.id).toBe('review_1');
    expect(prisma.breakGlassGrant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'grant_1', tenantId: 'tenant_demo' } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'incidentreview.created',
        actorId: 'user_psy_a',
        entityType: 'IncidentReview',
        entityId: 'review_1',
        critical: true,
      }),
    );
  });

  it('rejects a review of a break-glass grant that does not exist in this tenant', async () => {
    const { svc } = makeService({
      breakGlassGrant: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn() },
    });
    await expect(
      svc.createIncidentReview(principal, {
        kind: 'BREAK_GLASS',
        subjectId: 'grant_missing',
        findings: 'x'.repeat(25),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RiskService.getCrisisResources', () => {
  it('returns the US 988 entry for the demo tenant (countryCode "US")', async () => {
    const { svc } = makeService({ tenant: { findUnique: jest.fn().mockResolvedValue({ countryCode: 'US' }) } });
    const result = await svc.getCrisisResources(principal);
    expect(result.isFallback).toBe(false);
    expect(result.countryCode).toBe('US');
    expect(result.resolved).toEqual(expect.objectContaining({ countryCode: 'US', phone: '988' }));
  });

  it('returns the generic fallback (never a wrong/dead number) for an unregistered country code', async () => {
    const { svc } = makeService({ tenant: { findUnique: jest.fn().mockResolvedValue({ countryCode: 'ZZ' }) } });
    const result = await svc.getCrisisResources(principal);
    expect(result.isFallback).toBe(true);
    expect(result.resolved).toEqual(result.fallback);
    expect(result.resolved.phone).toBe('112');
  });
});

describe('RiskService.createSafetyPlan', () => {
  const input = {
    clientId: 'client_1',
    warningSigns: ['Isolating from friends'],
    copingStrategies: ['Call support contact'],
    supportContacts: [] as string[],
    professionalContacts: [] as string[],
  };

  it('starts at version 1 for a client with no prior plan', async () => {
    const { svc, prisma } = makeService();
    (prisma.safetyPlan.create as jest.Mock).mockImplementation(({ data }: any) => ({
      ...data,
      id: 'plan_1',
      createdAt: new Date(),
      supportContacts: data.supportContacts,
      professionalContacts: data.professionalContacts,
    }));

    const plan = await svc.createSafetyPlan(principal, input);
    expect(plan.version).toBe(1);
    // SPI completeness is assistive quality metric attached on every read path.
    expect(plan.completeness).toEqual(
      expect.objectContaining({
        score: expect.any(Number),
        missing: expect.any(Array),
        algorithmVersion: expect.any(String),
      }),
    );
    expect(plan.completeness!.score).toBeGreaterThanOrEqual(0);
    expect(plan.completeness!.score).toBeLessThanOrEqual(100);
  });

  it('increments the version on the second plan for the same client (append-only, never mutated)', async () => {
    const { svc, prisma } = makeService();
    (prisma.safetyPlan.findFirst as jest.Mock).mockResolvedValue({ id: 'plan_1', version: 1 });
    (prisma.safetyPlan.create as jest.Mock).mockImplementation(({ data }: any) => ({
      ...data,
      id: 'plan_2',
      createdAt: new Date(),
      supportContacts: data.supportContacts,
      professionalContacts: data.professionalContacts,
    }));

    const plan = await svc.createSafetyPlan(principal, input);
    expect(plan.version).toBe(2);
    expect(prisma.safetyPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 2 }) }),
    );
  });
});

/**
 * WAVE D P0 — field-level PHI encryption (docs/technical/06-security-and-rbac.md
 * §7, PHI-Critical): SafetyPlan is the risk-side counterpart to the
 * SessionNote.content coverage in clinical-documentation.service.spec.ts.
 * Cipher-internal behavior (round-trip, cross-tenant AAD failure, disabled
 * passthrough, malformed-key fail-fast) is pinned once in
 * common/crypto/field-cipher.spec.ts; these tests pin the SERVICE-level wiring
 * (write path encrypts, read path decrypts transparently, DTO shape unchanged).
 */
describe('RiskService — field-level encryption of SafetyPlan', () => {
  const input = {
    clientId: 'client_1',
    warningSigns: ['Isolating from friends', 'Giving away possessions'],
    copingStrategies: ['Call support contact', 'Go for a walk'],
    supportContacts: ['Jordan (sister) 555-0100'],
    professionalContacts: ['Dr. Lee 555-0200'],
    environmentSafety: 'Firearms removed from the home by a family member.',
  };

  it('with a key configured: the row persisted to Prisma is ciphertext, but createSafetyPlan() returns decrypted plaintext', async () => {
    const { svc, prisma } = makeService({}, keyedCipher());
    (prisma.safetyPlan.create as jest.Mock).mockImplementation(({ data }: any) => ({
      ...data,
      id: 'plan_1',
      createdAt: new Date(),
    }));

    const plan = await svc.createSafetyPlan(principal, input);

    const persisted = (prisma.safetyPlan.create as jest.Mock).mock.calls[0][0].data;
    // warningSigns/copingStrategies: String[] shim — single element, not the plaintext array.
    expect(persisted.warningSigns).toHaveLength(1);
    expect(JSON.stringify(persisted.warningSigns)).not.toContain('Isolating');
    // supportContacts/professionalContacts: Json envelope, not the plaintext array.
    expect(persisted.supportContacts).toMatchObject({ __vpsy_enc: 1, alg: 'xchacha20poly1305' });
    expect(JSON.stringify(persisted.supportContacts)).not.toContain('Jordan');
    // environmentSafety: stringified envelope in the text column.
    expect(persisted.environmentSafety).not.toContain('Firearms');

    // The caller gets plaintext back — controllers/DTOs never see ciphertext.
    expect(plan.warningSigns).toEqual(input.warningSigns);
    expect(plan.copingStrategies).toEqual(input.copingStrategies);
    expect(plan.supportContacts).toEqual(input.supportContacts);
    expect(plan.professionalContacts).toEqual(input.professionalContacts);
    expect(plan.environmentSafety).toBe(input.environmentSafety);
  });

  it('round-trips through getLatestSafetyPlan / getMySafetyPlan (clinician + own-client read paths)', async () => {
    const cipher = keyedCipher();
    const { svc: writeSvc, prisma: writePrisma } = makeService({}, cipher);
    (writePrisma.safetyPlan.create as jest.Mock).mockImplementation(({ data }: any) => ({
      ...data,
      id: 'plan_1',
      createdAt: new Date(),
    }));
    await writeSvc.createSafetyPlan(principal, input);
    const persistedRow = (writePrisma.safetyPlan.create as jest.Mock).mock.results[0]!.value;

    // A fresh service instance (different prisma mock, same cipher/key) reading back the persisted row —
    // proves the read path decrypts independently of the write call, exactly like a real DB round-trip.
    const { svc: readSvc } = makeService(
      { safetyPlan: { findFirst: jest.fn().mockResolvedValue(persistedRow), create: jest.fn() } },
      cipher,
    );
    const plan = await readSvc.getLatestSafetyPlan(principal, 'client_1');
    expect(plan?.warningSigns).toEqual(input.warningSigns);
    expect(plan?.supportContacts).toEqual(input.supportContacts);
    expect(plan?.environmentSafety).toBe(input.environmentSafety);
  });

  it('cross-tenant AAD failure: a safety plan sealed for one tenant cannot be decrypted under another', async () => {
    const cipher = keyedCipher();
    const { svc: writeSvc, prisma: writePrisma } = makeService({}, cipher);
    (writePrisma.safetyPlan.create as jest.Mock).mockImplementation(({ data }: any) => ({
      ...data,
      id: 'plan_1',
      createdAt: new Date(),
    }));
    await writeSvc.createSafetyPlan(principal, input);
    const persistedRow = (writePrisma.safetyPlan.create as jest.Mock).mock.results[0]!.value;

    const otherTenantPrincipal: AuthPrincipal = { ...principal, tenantId: 'tenant_other' };
    const { svc: readSvc } = makeService(
      {
        safetyPlan: { findFirst: jest.fn().mockResolvedValue(persistedRow), create: jest.fn() },
        client: { findFirst: jest.fn().mockResolvedValue({ id: 'client_1', tenantId: 'tenant_other' }) },
      },
      cipher,
    );
    await expect(readSvc.getLatestSafetyPlan(otherTenantPrincipal, 'client_1')).rejects.toThrow(/decryption failed/i);
  });

  it('disabled mode (no VPSY_FIELD_KEY): the persisted row is plaintext, byte-identical to pre-encryption behavior', async () => {
    const { svc, prisma } = makeService({}, disabledCipher());
    (prisma.safetyPlan.create as jest.Mock).mockImplementation(({ data }: any) => ({
      ...data,
      id: 'plan_1',
      createdAt: new Date(),
    }));

    const plan = await svc.createSafetyPlan(principal, input);
    const persisted = (prisma.safetyPlan.create as jest.Mock).mock.calls[0][0].data;

    expect(persisted.warningSigns).toEqual(input.warningSigns); // no envelope shim applied
    expect(persisted.supportContacts).toEqual(input.supportContacts);
    expect(persisted.environmentSafety).toBe(input.environmentSafety);
    expect(plan.warningSigns).toEqual(input.warningSigns);
  });

  it('backward-compat passthrough: a pre-existing plaintext SafetyPlan is still readable once VPSY_FIELD_KEY is later configured', async () => {
    const legacyPlaintextRow = {
      id: 'plan_legacy',
      clientId: 'client_1',
      warningSigns: input.warningSigns, // ordinary multi-element array — never the shim shape
      copingStrategies: input.copingStrategies,
      supportContacts: input.supportContacts,
      professionalContacts: input.professionalContacts,
      environmentSafety: input.environmentSafety, // ordinary text, not JSON
      distractionContacts: null,
      helpContacts: null,
      crisisLineInfo: { label: '988 Suicide & Crisis Lifeline', phone: '988' },
      meansRestriction: null,
      clientAcknowledgedAt: null,
      version: 1,
      createdAt: new Date(),
    };
    const { svc } = makeService(
      { safetyPlan: { findFirst: jest.fn().mockResolvedValue(legacyPlaintextRow), create: jest.fn() } },
      keyedCipher(),
    );

    const plan = await svc.getLatestSafetyPlan(principal, 'client_1');
    expect(plan?.warningSigns).toEqual(input.warningSigns);
    expect(plan?.environmentSafety).toBe(input.environmentSafety);
    expect(plan?.crisisLineInfo).toEqual({ label: '988 Suicide & Crisis Lifeline', phone: '988' });
  });
});
