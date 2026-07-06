import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { REQUIRED_CONSENT_VERSIONS } from '@vpsy/contracts';
import type { AuthPrincipal } from '@vpsy/contracts';
import { CredentialingService } from '../modules/credentialing/credentialing.service';
import { ConsentService } from '../modules/consent/consent.service';
import { RiskService } from '../modules/risk/risk.service';
import { PsychometricsService } from '../modules/psychometrics/psychometrics.service';
import { ScoringService } from '../modules/psychometrics/scoring.service';
import { NationalAnalyticsService } from '../modules/analytics/national-analytics.service';

/**
 * Clinical-safety suite (docs/technical/12-testing-strategy.md §6).
 *
 * These invariants are ALREADY enforced in code and already covered
 * incidentally by each module's own spec file. This suite does not
 * re-derive new behavior — it gathers the platform's non-negotiable
 * clinical promises into one named, CI-blocking gate so that a regression
 * in any one of them fails loudly and specifically, instead of getting lost
 * among hundreds of unrelated module tests.
 *
 * Every `it` below corresponds 1:1 to a numbered bullet in §6 of the testing
 * strategy. If you are removing or weakening an assertion here, you are
 * weakening a clinical-safety guarantee — that requires clinical governance
 * board sign-off (§13), not just a green CI run.
 */
describe('Clinical-safety gate (docs/technical/12-testing-strategy.md §6)', () => {
  const principal: AuthPrincipal = {
    userId: 'user_psy_a',
    tenantId: 'tenant_demo',
    roles: [],
    permissions: [],
  };

  // ---------------------------------------------------------------------
  // §6.5 License gates — premium instruments / clinical writes blocked
  // without an active, jurisdiction-matched LicenseGrant/Credential.
  // ---------------------------------------------------------------------
  describe('License/credential gate — CredentialingService.assertClinicalEligibility', () => {
    const verifiedActive = {
      id: 'cred_1',
      psychologistId: 'psy_1',
      licenseNumber: 'NY-PSY-1',
      jurisdiction: 'US-NY',
      issuingBody: 'NY State Board',
      expiresAt: null as Date | null,
      verificationStatus: 'verified',
      malpracticeStatus: 'active',
      createdAt: new Date(),
    };

    function makeService(psychologist: { userId: string; credentials: Array<typeof verifiedActive> } | null) {
      const prisma = { psychologist: { findFirst: jest.fn().mockResolvedValue(psychologist) } };
      const audit = { record: jest.fn() };
      return new CredentialingService(prisma as any, audit as any);
    }

    it('blocks an unlicensed clinical write: no psychologist/credential profile at all', async () => {
      const svc = makeService(null);
      await expect(svc.assertClinicalEligibility('user_no_profile', 'US-NY')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('blocks a clinical write when no credential is verified', async () => {
      const svc = makeService({
        userId: 'user_psy_a',
        credentials: [{ ...verifiedActive, verificationStatus: 'pending' }],
      });
      await expect(svc.assertClinicalEligibility('user_psy_a', 'US-NY')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('blocks a clinical write when the matching credential has expired', async () => {
      const svc = makeService({
        userId: 'user_psy_a',
        credentials: [{ ...verifiedActive, expiresAt: new Date(Date.now() - 86_400_000) }],
      });
      await expect(svc.assertClinicalEligibility('user_psy_a', 'US-NY')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('blocks a clinical write on jurisdiction mismatch even with an otherwise valid credential', async () => {
      const svc = makeService({ userId: 'user_psy_a', credentials: [verifiedActive] });
      await expect(svc.assertClinicalEligibility('user_psy_a', 'US-CA')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a clinical write with a verified, active, jurisdiction-matched credential', async () => {
      const svc = makeService({ userId: 'user_psy_a', credentials: [verifiedActive] });
      await expect(svc.assertClinicalEligibility('user_psy_a', 'US-NY')).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // §6.4 Consent gates — intake/telehealth/wearables blocked without the
  // current-version, non-revoked required consents.
  // ---------------------------------------------------------------------
  describe('Consent gate — ConsentService.assertRequiredConsents', () => {
    function makeService(consents: Array<{ type: string; version: string; revokedAt: Date | null }>) {
      const prisma = { consent: { findMany: jest.fn().mockResolvedValue(consents) } };
      const audit = { record: jest.fn() };
      return new ConsentService(prisma as any, audit as any);
    }

    const currentTelepsychologyVersion = REQUIRED_CONSENT_VERSIONS.TELEPSYCHOLOGY!;
    const currentDataProcessingVersion = REQUIRED_CONSENT_VERSIONS.DATA_PROCESSING!;

    it('blocks intake when a required consent is entirely missing', async () => {
      const svc = makeService([{ type: 'TELEPSYCHOLOGY', version: currentTelepsychologyVersion, revokedAt: null }]);
      await expect(svc.assertRequiredConsents('client_1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('blocks intake when a required consent is on a stale version', async () => {
      const svc = makeService([
        { type: 'TELEPSYCHOLOGY', version: '0.9.0', revokedAt: null },
        { type: 'DATA_PROCESSING', version: currentDataProcessingVersion, revokedAt: null },
      ]);
      await expect(svc.assertRequiredConsents('client_1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('blocks intake when a required consent was revoked (revoked rows never satisfy the gate)', async () => {
      const svc = makeService([{ type: 'DATA_PROCESSING', version: currentDataProcessingVersion, revokedAt: null }]);
      await expect(svc.assertRequiredConsents('client_1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows intake when all required consents are granted at the current version', async () => {
      const svc = makeService([
        { type: 'TELEPSYCHOLOGY', version: currentTelepsychologyVersion, revokedAt: null },
        { type: 'DATA_PROCESSING', version: currentDataProcessingVersion, revokedAt: null },
      ]);
      await expect(svc.assertRequiredConsents('client_1')).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // §6.2 Human-in-the-loop invariants — risk escalation resolution is
  // always a human decision, never automated.
  // ---------------------------------------------------------------------
  describe('Human-only escalation resolution — RiskService.resolveEscalation', () => {
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

    function makeService() {
      const prismaTx = {
        escalation: {
          update: jest.fn().mockImplementation(({ data }: any) => ({
            ...escalationRow,
            ...data,
            riskFlag: escalationRow.riskFlag,
          })),
        },
        riskFlag: { update: jest.fn() },
      };
      const prisma = {
        escalation: { findFirst: jest.fn().mockResolvedValue(escalationRow), update: jest.fn() },
        riskFlag: { update: jest.fn() },
        client: { findFirst: jest.fn().mockResolvedValue({ id: 'client_1', tenantId: 'tenant_demo' }) },
        safetyPlan: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
        breakGlassGrant: { create: jest.fn() },
        $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prismaTx)),
      };
      const audit = { record: jest.fn() };
      const bus = { publish: jest.fn() };
      return { svc: new RiskService(prisma as any, audit as any, bus as any), prisma, audit };
    }

    it('rejects resolution when no human principal is present — an AI/automation actor can never resolve an escalation', async () => {
      const { svc, prisma, audit } = makeService();
      await expect(
        svc.resolveEscalation({ tenantId: 'tenant_demo' } as AuthPrincipal, 'esc_1', {
          resolution: 'Auto-resolved by risk-triage agent',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // Fails closed before ever touching storage — proves this is a hard
      // gate, not a check that happens to run after the mutation.
      expect(prisma.escalation.findFirst).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('resolves and audits for a real, authenticated human principal', async () => {
      const { svc, audit } = makeService();
      const result = await svc.resolveEscalation(principal, 'esc_1', {
        resolution: 'Contacted client by phone; safety plan reviewed; no acute risk, follow-up booked.',
      });
      expect(result.resolvedAt).not.toBeNull();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'escalation.resolved', actorId: 'user_psy_a' }),
      );
    });
  });

  // ---------------------------------------------------------------------
  // §6.2 / §8 — Break-glass emergency access: reason-gated and time-boxed.
  // ---------------------------------------------------------------------
  describe('Break-glass gate — RiskService.breakGlass', () => {
    function makeService() {
      const prisma = {
        client: { findFirst: jest.fn().mockResolvedValue({ id: 'client_1', tenantId: 'tenant_demo' }) },
        breakGlassGrant: {
          create: jest.fn().mockImplementation(({ data }: any) => ({ ...data, id: 'grant_1' })),
        },
      };
      const audit = { record: jest.fn() };
      const bus = { publish: jest.fn() };
      return { svc: new RiskService(prisma as any, audit as any, bus as any), audit, bus };
    }

    it('rejects a break-glass request whose reason is missing or under 10 characters', async () => {
      const { svc } = makeService();
      await expect(svc.breakGlass(principal, { clientId: 'client_1', reason: 'too short' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(svc.breakGlass(principal, { clientId: 'client_1', reason: '' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('grants access with a reason >= 10 characters, time-boxed to exactly 1 hour, and audits it as HIGH severity', async () => {
      const { svc, audit, bus } = makeService();
      const result = await svc.breakGlass(principal, {
        clientId: 'client_1',
        reason: 'Client unreachable after a SEVERE risk flag; welfare check required immediately.',
      });

      expect(result.reason.length).toBeGreaterThanOrEqual(10);
      const grantedAt = new Date(result.grantedAt).getTime();
      const expiresAt = new Date(result.expiresAt).getTime();
      expect(expiresAt - grantedAt).toBe(60 * 60 * 1000);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'breakglass.invoked', after: expect.objectContaining({ severity: 'HIGH' }) }),
      );
      expect(bus.publish).toHaveBeenCalledWith(
        'breakglass.invoked',
        'tenant_demo',
        expect.objectContaining({ grantId: 'grant_1', clientId: 'client_1' }),
      );
    });
  });

  // ---------------------------------------------------------------------
  // §6.3 Crisis routing — a configured safetyItem (PHQ-9 item 9) raises a
  // HIGH RiskFlag deterministically, even outside the intake flow.
  // ---------------------------------------------------------------------
  describe('Safety-item routing — PsychometricsService.administer', () => {
    const CUTOFFS_WITH_SAFETY_ITEM = {
      bands: [
        { band: 'LOW', min: 0, max: 4 },
        { band: 'MODERATE', min: 5, max: 9 },
        { band: 'HIGH', min: 10, max: 14 },
        { band: 'SEVERE', min: 15, max: 27 },
      ],
      safetyItems: [{ itemId: 'q9', minAnswer: 1, category: 'suicidal_ideation' }],
    };

    function makeService() {
      const createdRiskFlags: any[] = [];
      const createdEscalations: any[] = [];

      const version = { id: 'qv_1', published: true, cutoffs: CUTOFFS_WITH_SAFETY_ITEM };
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
          create: jest.fn().mockImplementation(({ data }: any) => ({
            id: 'score_1',
            responseId: data.responseId,
            rawScore: data.rawScore,
            severityBand: data.severityBand,
            interpretation: data.interpretation,
            createdAt: new Date('2026-01-01T00:00:00Z'),
          })),
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
          update: jest.fn().mockImplementation(({ data }: any) => ({ ...client, ...data })),
        },
      };

      const prisma = {
        questionnaireVersion: { findUnique: jest.fn().mockResolvedValue(version) },
        client: { findFirst: jest.fn().mockResolvedValue(client) },
        $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
      };

      const audit = { record: jest.fn() };
      const bus = { publish: jest.fn() };
      const svc = new PsychometricsService(prisma as any, new ScoringService(), audit as any, bus as any);
      return { svc, tx, bus, createdRiskFlags, createdEscalations };
    }

    it('raises a HIGH RiskFlag + human Escalation for a positive PHQ-9 item-9 endorsement', async () => {
      const { svc, tx, bus, createdRiskFlags, createdEscalations } = makeService();

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
        status: 'ESCALATED',
      });
      expect(tx.escalation.create).toHaveBeenCalledTimes(1);
      expect(createdEscalations[0]).toMatchObject({ riskFlagId: createdRiskFlags[0].id });
      expect(bus.publish).toHaveBeenCalledWith(
        'risk.flag.raised',
        'tenant_demo',
        expect.objectContaining({ riskFlagId: createdRiskFlags[0].id, clientId: 'client_1' }),
      );
    });

    it('never raises a flag when the safety item is answered below threshold or is simply absent', async () => {
      const belowThreshold = makeService();
      await belowThreshold.svc.administer(principal, {
        versionId: 'qv_1',
        clientId: 'client_1',
        answers: { q1: 1, q2: 1, q9: 0 },
      });
      expect(belowThreshold.tx.riskFlag.create).not.toHaveBeenCalled();
      expect(belowThreshold.tx.escalation.create).not.toHaveBeenCalled();

      const absentItem = makeService();
      await absentItem.svc.administer(principal, {
        versionId: 'qv_1',
        clientId: 'client_1',
        answers: { q1: 1, q2: 1 },
      });
      expect(absentItem.tx.riskFlag.create).not.toHaveBeenCalled();
      expect(absentItem.tx.escalation.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // §6 (national analytics de-identification) — k-anonymity floor: any
  // cohort under 5 is suppressed and the raw value never serialized.
  // ---------------------------------------------------------------------
  describe('National-analytics k-anonymity — NationalAnalyticsService.getNationalAnalytics', () => {
    const govPrincipal: AuthPrincipal = {
      userId: 'user_gov',
      tenantId: 'tenant_demo',
      roles: [],
      permissions: [],
    };

    it('suppresses a below-floor cohort (value null, suppressed true) and never lets the raw value leak into the response', async () => {
      const rows = [
        { region: 'US-NY', metric: 'depression_prevalence_pct', value: 21.4, window: '2026-Q2', cohortSize: 48210 },
        { region: 'US-VT', metric: 'depression_prevalence_pct', value: 33.0, window: '2026-Q2', cohortSize: 3 }, // below floor
      ];
      const prisma = {
        populationMetric: { findMany: jest.fn().mockResolvedValue(rows) },
        report: { create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'report_national_1', ...data })) },
      };
      const audit = { record: jest.fn() };
      const svc = new NationalAnalyticsService(prisma as any, audit as any);

      const result = await svc.getNationalAnalytics(govPrincipal);

      expect(result.kAnonymityFloor).toBe(5);
      const vt = result.metrics.find((m) => m.region === 'US-VT')!;
      expect(vt.suppressed).toBe(true);
      expect(vt.value).toBeNull();
      // The suppressed row's underlying real value must never appear anywhere in the response.
      expect(JSON.stringify(result)).not.toContain('33');

      const ny = result.metrics.find((m) => m.region === 'US-NY')!;
      expect(ny.suppressed).toBe(false);
      expect(ny.value).toBe(21.4);
    });

    it('suppresses exactly at floor-1 and passes exactly at the floor (boundary case)', async () => {
      const prisma = {
        populationMetric: {
          findMany: jest.fn().mockResolvedValue([
            { region: 'US-TX', metric: 'avg_outcome_improvement_pct', value: 40, window: '2026-Q2', cohortSize: 4 },
            { region: 'US-TX', metric: 'treatment_access_pct', value: 55, window: '2026-Q2', cohortSize: 5 },
          ]),
        },
        report: { create: jest.fn().mockResolvedValue({ id: 'r1' }) },
      };
      const audit = { record: jest.fn() };
      const svc = new NationalAnalyticsService(prisma as any, audit as any);

      const result = await svc.getNationalAnalytics(govPrincipal);

      const below = result.metrics.find((m) => m.metric === 'avg_outcome_improvement_pct')!;
      expect(below.suppressed).toBe(true);
      expect(below.value).toBeNull();

      const atFloor = result.metrics.find((m) => m.metric === 'treatment_access_pct')!;
      expect(atFloor.suppressed).toBe(false);
      expect(atFloor.value).toBe(55);
    });
  });
});
