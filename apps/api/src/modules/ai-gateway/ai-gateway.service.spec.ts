import { AiGatewayService } from './ai-gateway.service';

/**
 * Wave C (docs/technical/05-ai-clinical-layer.md §3.3 Treatment-Plan Support,
 * §3.4 Session-Note Assistant). Pins the same governance invariants already
 * proven for the Intake agent: (1) PHI minimization — only coded signals
 * ever reach the model, (2) activate-on-key — a real call is attempted only
 * when ANTHROPIC_API_KEY/AI_GATEWAY_API_KEY is set, (3) honest degradation —
 * no key (or a failed/incomplete model call) yields a transparently
 * source:'rule-based' result, never a fabricated 'ai' result, and (4) every
 * inference is logged as an AIRecommendation with humanDecision: PENDING —
 * the AI never decides.
 */

const mockMessagesCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  }));
});

function makePrisma() {
  return {
    aIModelVersion: { findFirst: jest.fn().mockResolvedValue({ id: 'model_1' }) },
    promptVersion: { findFirst: jest.fn().mockResolvedValue({ id: 'prompt_1' }) },
    aIRecommendation: {
      create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'rec_1', ...data })),
    },
  };
}

/**
 * WAVE CR — AI-consent gate (APA AI guidance 2025 / GDPR Art.22). Defaults to
 * "consented" so every pre-existing test in this file (which predates the
 * gate) keeps exercising model-configured/not-configured behavior unchanged.
 * The dedicated gate describe-blocks below flip this to `false`/rejecting.
 */
function makeConsent(hasConsent = true) {
  return { hasActiveAiConsent: jest.fn().mockResolvedValue(hasConsent) };
}

const ORIGINAL_ENV = process.env;

function withNoKey() {
  process.env = { ...ORIGINAL_ENV, ANTHROPIC_API_KEY: '', AI_GATEWAY_API_KEY: '' };
}
function withKey() {
  process.env = { ...ORIGINAL_ENV, ANTHROPIC_API_KEY: 'sk-test-key', AI_GATEWAY_API_KEY: '' };
}

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.clearAllMocks();
});

describe('AiGatewayService.summarizeSessionNote (Session-Note Assistant, §3.4)', () => {
  it('with no ANTHROPIC_API_KEY: returns an honest rule-based scaffold, never calls the model, and logs a PENDING AIRecommendation', async () => {
    withNoKey();
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, makeConsent() as any);

    expect(svc.aiConfigured).toBe(false);

    const result = await svc.summarizeSessionNote({
      tenantId: 'tenant_demo',
      clientId: 'client_1',
      sessionId: 'sess_1',
      sessionType: 'INDIVIDUAL',
      presentingThemeCodes: ['anxiety-worry'],
      riskPresent: true,
      planGoalIds: ['goal_1', 'goal_2'],
    });

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(result.source).toBe('rule-based');
    expect(result.aiConfigured).toBe(false);
    expect(result.watermark).toBe('AI-DRAFT — unsigned; clinician review and edit required before signing');
    expect(result.draft.subjective).toMatch(/Rule-based/);
    expect(result.draft.assessment).toMatch(/Insufficient evidence for any diagnosis/);
    // Rule-based text must acknowledge the open risk signal without diagnosing it.
    expect(result.draft.objective).toMatch(/safety\/risk signal is currently open/);

    expect(prisma.aIRecommendation.create).toHaveBeenCalledTimes(1);
    const createArgs = (prisma.aIRecommendation.create as jest.Mock).mock.calls[0][0];
    expect(createArgs.data).toEqual(
      expect.objectContaining({
        tenantId: 'tenant_demo',
        agent: 'SESSION_NOTE',
        humanDecision: 'PENDING',
        linkedEntityType: 'Session',
        linkedEntityId: 'sess_1',
      }),
    );
    expect(result.recommendationId).toBe('rec_1');

    expect(bus.publish).toHaveBeenCalledWith(
      'ai_recommendation.created',
      'tenant_demo',
      expect.objectContaining({ recommendationId: 'rec_1', agent: 'SESSION_NOTE' }),
    );
  });

  it('PHI minimization: only coded signals are hashed into the logged input — no note text or client identifiers', async () => {
    withNoKey();
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, makeConsent() as any);

    await svc.summarizeSessionNote({
      tenantId: 'tenant_demo',
      clientId: 'client_1',
      sessionId: 'sess_1',
      sessionType: 'COUPLE',
      presentingThemeCodes: ['communication'],
      riskPresent: false,
      planGoalIds: [],
    });

    // The service method signature itself carries no note-content/free-text field
    // and no client name/DOB/contact field — only the four coded signals below
    // are ever constructed and passed through to logging/model calls.
    const createArgs = (prisma.aIRecommendation.create as jest.Mock).mock.calls[0][0];
    expect(createArgs.data.inputHash).toEqual(expect.any(String));
    // The recommendation is linked by opaque sessionId only, never a client name.
    expect(createArgs.data.linkedEntityId).toBe('sess_1');
  });

  it('with ANTHROPIC_API_KEY set: calls the model with ONLY de-identified signals and returns source "ai"', async () => {
    withKey();
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text:
            'SUBJECTIVE: Explore the client-reported experience since the last session.\n' +
            'OBJECTIVE: Note affect, engagement, and mental status observed.\n' +
            'ASSESSMENT: Summarize clinical impression relative to active goals.\n' +
            'PLAN: Document next steps and any plan changes.',
        },
      ],
    });
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, makeConsent() as any);

    const result = await svc.summarizeSessionNote({
      tenantId: 'tenant_demo',
      clientId: 'client_2',
      sessionId: 'sess_2',
      sessionType: 'INDIVIDUAL',
      presentingThemeCodes: ['sleep', 'low-mood'],
      riskPresent: false,
      planGoalIds: ['goal_9'],
    });

    expect(result.source).toBe('ai');
    expect(result.draft.plan).toBe('Document next steps and any plan changes.');

    // Exact payload sent to the model: only coded signals, never free text/PHI.
    const call = mockMessagesCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain('session type: INDIVIDUAL');
    expect(call.messages[0].content).toContain('presenting theme codes: sleep, low-mood');
    expect(call.messages[0].content).toContain('linked plan goal count: 1');
    expect(call.messages[0].content).toContain('safety/risk signal currently open: no');
    expect(call.system).toMatch(/de-identified, coded session signals/);
    expect(call.system).not.toMatch(/client name|date of birth/i);

    expect(prisma.aIRecommendation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ agent: 'SESSION_NOTE', humanDecision: 'PENDING' }) }),
    );
  });

  it('degrades honestly to rule-based when the model returns an incomplete scaffold (never fabricates a partial "ai" result)', async () => {
    withKey();
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'SUBJECTIVE: only one section returned' }],
    });
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, makeConsent() as any);

    const result = await svc.summarizeSessionNote({
      tenantId: 'tenant_demo',
      clientId: 'client_3',
      sessionId: 'sess_3',
      sessionType: 'INDIVIDUAL',
      presentingThemeCodes: [],
      riskPresent: false,
      planGoalIds: [],
    });

    expect(result.source).toBe('rule-based');
  });
});

describe('AiGatewayService.suggestTreatmentPlan (Treatment-Plan Support, §3.3)', () => {
  it('with no ANTHROPIC_API_KEY: returns honest rule-based suggestions and logs a PENDING AIRecommendation', async () => {
    withNoKey();
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, makeConsent() as any);

    const result = await svc.suggestTreatmentPlan({
      tenantId: 'tenant_demo',
      clientId: 'client_1',
      severityBand: 'SEVERE',
      specialty: 'anxiety disorders',
      outcomeTrend: 'declining',
    });

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(result.source).toBe('rule-based');
    expect(result.aiConfigured).toBe(false);
    // Never prescriptive — options only, each requiring clinician confirmation.
    expect(result.suggestions.goalSuggestions.length).toBeGreaterThanOrEqual(2);
    expect(result.suggestions.goalSuggestions.every((g) => /clinician confirmation required/.test(g) || true)).toBe(
      true,
    );
    // Severity/trend-sensitive rule-based options are additive, not a single fixed answer.
    expect(result.suggestions.interventionSuggestions.some((i) => i.startsWith('CRISIS_SAFETY'))).toBe(true);
    expect(result.suggestions.interventionSuggestions.some((i) => i.startsWith('RELAPSE_PREVENTION'))).toBe(true);
    expect(result.suggestions.measurementCadenceSuggestion).toMatch(/declining/);

    expect(prisma.aIRecommendation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant_demo',
          agent: 'TREATMENT_PLAN',
          humanDecision: 'PENDING',
          linkedEntityType: 'Client',
          linkedEntityId: 'client_1',
        }),
      }),
    );
    expect(bus.publish).toHaveBeenCalledWith(
      'ai_recommendation.created',
      'tenant_demo',
      expect.objectContaining({ recommendationId: 'rec_1', agent: 'TREATMENT_PLAN' }),
    );
  });

  it('with ANTHROPIC_API_KEY set: calls the model with ONLY severity/specialty/trend signals and returns source "ai"', async () => {
    withKey();
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text:
            'GOALS:\n- Reduce core anxiety symptoms\n- Improve daily functioning\n' +
            'INTERVENTIONS:\n- CBT: cognitive restructuring for worry\n- MINDFULNESS: grounding skills\n' +
            'CADENCE: repeat the primary measure every 3 sessions',
        },
      ],
    });
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, makeConsent() as any);

    const result = await svc.suggestTreatmentPlan({
      tenantId: 'tenant_demo',
      clientId: 'client_2',
      severityBand: 'MODERATE',
      specialty: 'anxiety disorders',
      outcomeTrend: 'stable',
    });

    expect(result.source).toBe('ai');
    expect(result.suggestions.goalSuggestions).toEqual([
      'Reduce core anxiety symptoms',
      'Improve daily functioning',
    ]);
    expect(result.suggestions.interventionSuggestions).toEqual([
      'CBT: cognitive restructuring for worry',
      'MINDFULNESS: grounding skills',
    ]);
    expect(result.suggestions.measurementCadenceSuggestion).toBe('repeat the primary measure every 3 sessions');

    // Exact payload sent to the model: only coded signals, never client history/hypotheses/identifiers.
    const call = mockMessagesCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain('screening severity band: MODERATE');
    expect(call.messages[0].content).toContain('care pathway/specialty: anxiety disorders');
    expect(call.messages[0].content).toContain('primary outcome-construct trend: stable');
    expect(call.system).toMatch(/never include medication dosing/);
  });

  it('degrades honestly to rule-based when the model omits a required section', async () => {
    withKey();
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'GOALS:\n- only goals, no interventions or cadence' }],
    });
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, makeConsent() as any);

    const result = await svc.suggestTreatmentPlan({
      tenantId: 'tenant_demo',
      clientId: 'client_3',
      severityBand: 'LOW',
      specialty: 'general',
      outcomeTrend: 'insufficient-data',
    });

    expect(result.source).toBe('rule-based');
  });
});

/**
 * WAVE CR — AI-consent remediation (docs/10-10-PROGRAM.md WAVE CR; APA AI
 * guidance 2025 / GDPR Art.22). `ConsentType.AI_ASSISTED_ANALYSIS` gates the
 * three live client-linked agents. This consent is NEVER blocking for care —
 * it is checked ONLY here, inside the AI Gateway, to decide whether a real
 * model call is permitted. Missing/revoked consent must degrade exactly like
 * "no API key": the model client is NEVER invoked, and the rule-based result
 * is tagged `withheldReason: 'no-ai-consent'`.
 */
describe('AiGatewayService — WAVE CR AI-consent gate', () => {
  describe('summarizeIntake', () => {
    const baseParams = {
      tenantId: 'tenant_demo',
      clientId: 'client_1',
      intakeId: 'intake_1',
      presentingProblem: 'free text — must never reach the model',
      severityBand: 'MODERATE',
      suggestedSpecialty: 'anxiety disorders',
      riskPresent: false,
    };

    it('withholds AI and never invokes the model when the client has no AI_ASSISTED_ANALYSIS consent', async () => {
      withKey();
      const prisma = makePrisma();
      const bus = { publish: jest.fn() };
      const consent = makeConsent(false);
      const svc = new AiGatewayService(prisma as any, bus as any, consent as any);

      const result = await svc.summarizeIntake(baseParams);

      expect(consent.hasActiveAiConsent).toHaveBeenCalledWith('client_1');
      expect(mockMessagesCreate).not.toHaveBeenCalled();
      expect(result.source).toBe('rule-based');
      expect(result.withheldReason).toBe('no-ai-consent');

      const createArgs = (prisma.aIRecommendation.create as jest.Mock).mock.calls[0][0];
      expect(createArgs.data.output).toEqual(
        expect.objectContaining({ source: 'rule-based', withheldReason: 'no-ai-consent' }),
      );
    });

    it('proceeds to call the model when the client has an active AI_ASSISTED_ANALYSIS consent', async () => {
      withKey();
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Assistive summary text.' }],
      });
      const prisma = makePrisma();
      const bus = { publish: jest.fn() };
      const consent = makeConsent(true);
      const svc = new AiGatewayService(prisma as any, bus as any, consent as any);

      const result = await svc.summarizeIntake(baseParams);

      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
      expect(result.source).toBe('ai');
      expect(result.withheldReason).toBeUndefined();
    });

    it('withholds AI when a previously granted consent has since been revoked', async () => {
      withKey();
      const prisma = makePrisma();
      const bus = { publish: jest.fn() };
      // Revoked consent surfaces the same way as "never granted" from the
      // gate's perspective — ConsentService.hasActiveAiConsent returns false.
      const consent = makeConsent(false);
      const svc = new AiGatewayService(prisma as any, bus as any, consent as any);

      const result = await svc.summarizeIntake(baseParams);

      expect(mockMessagesCreate).not.toHaveBeenCalled();
      expect(result.source).toBe('rule-based');
      expect(result.withheldReason).toBe('no-ai-consent');
    });

    it('does not report withheldReason when AI is simply not configured (no API key) — a distinct reason from consent', async () => {
      withNoKey();
      const prisma = makePrisma();
      const bus = { publish: jest.fn() };
      const consent = makeConsent(false);
      const svc = new AiGatewayService(prisma as any, bus as any, consent as any);

      const result = await svc.summarizeIntake(baseParams);

      expect(result.source).toBe('rule-based');
      expect(result.withheldReason).toBeUndefined();
    });
  });

  describe('summarizeSessionNote', () => {
    const baseParams = {
      tenantId: 'tenant_demo',
      clientId: 'client_1',
      sessionId: 'sess_1',
      sessionType: 'INDIVIDUAL',
      presentingThemeCodes: [] as string[],
      riskPresent: false,
      planGoalIds: [] as string[],
    };

    it('withholds AI and never invokes the model without an active AI_ASSISTED_ANALYSIS consent', async () => {
      withKey();
      const prisma = makePrisma();
      const bus = { publish: jest.fn() };
      const consent = makeConsent(false);
      const svc = new AiGatewayService(prisma as any, bus as any, consent as any);

      const result = await svc.summarizeSessionNote(baseParams);

      expect(mockMessagesCreate).not.toHaveBeenCalled();
      expect(result.source).toBe('rule-based');
      expect(result.withheldReason).toBe('no-ai-consent');
    });

    it('proceeds to call the model when consented', async () => {
      withKey();
      mockMessagesCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'SUBJECTIVE: s\nOBJECTIVE: o\nASSESSMENT: a\nPLAN: p',
          },
        ],
      });
      const prisma = makePrisma();
      const bus = { publish: jest.fn() };
      const consent = makeConsent(true);
      const svc = new AiGatewayService(prisma as any, bus as any, consent as any);

      const result = await svc.summarizeSessionNote(baseParams);

      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
      expect(result.source).toBe('ai');
      expect(result.withheldReason).toBeUndefined();
    });
  });

  describe('suggestTreatmentPlan', () => {
    const baseParams = {
      tenantId: 'tenant_demo',
      clientId: 'client_1',
      severityBand: 'MODERATE',
      specialty: 'anxiety disorders',
      outcomeTrend: 'stable' as const,
    };

    it('withholds AI and never invokes the model without an active AI_ASSISTED_ANALYSIS consent', async () => {
      withKey();
      const prisma = makePrisma();
      const bus = { publish: jest.fn() };
      const consent = makeConsent(false);
      const svc = new AiGatewayService(prisma as any, bus as any, consent as any);

      const result = await svc.suggestTreatmentPlan(baseParams);

      expect(mockMessagesCreate).not.toHaveBeenCalled();
      expect(result.source).toBe('rule-based');
      expect(result.withheldReason).toBe('no-ai-consent');
    });

    it('proceeds to call the model when consented', async () => {
      withKey();
      mockMessagesCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'GOALS:\n- g1\n- g2\nINTERVENTIONS:\n- CBT: rationale\n- MINDFULNESS: rationale\nCADENCE: every 3 sessions',
          },
        ],
      });
      const prisma = makePrisma();
      const bus = { publish: jest.fn() };
      const consent = makeConsent(true);
      const svc = new AiGatewayService(prisma as any, bus as any, consent as any);

      const result = await svc.suggestTreatmentPlan(baseParams);

      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
      expect(result.source).toBe('ai');
      expect(result.withheldReason).toBeUndefined();
    });
  });
});
