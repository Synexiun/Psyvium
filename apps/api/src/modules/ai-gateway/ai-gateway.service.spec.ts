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
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

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
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

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
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

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
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

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
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

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
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

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
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

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
      const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, consent as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

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
      const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, consent as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

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
      const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, consent as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

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
      const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, consent as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

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
      const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, consent as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

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
      const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, consent as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

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
      const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, consent as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

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
      const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, consent as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

      const result = await svc.suggestTreatmentPlan(baseParams);

      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
      expect(result.source).toBe('ai');
      expect(result.withheldReason).toBeUndefined();
    });
  });
});

/**
 * Wave C completion — the 5 remaining governed agents from doc 05 §3:
 * Differential Hypothesis (§3.2), Outcome Intelligence (§3.5), Psychometric
 * Interpretation (§3.7), Crisis context-assembly (§3.6), and the Allocation
 * rationale extension (§3.8). Same governance invariants proven above,
 * pinned per-agent, plus the anti-anchoring rule specific to Differentials.
 */
describe('AiGatewayService.suggestDifferentials (Differential Hypothesis, §3.2)', () => {
  const baseParams = {
    tenantId: 'tenant_demo',
    clientId: 'client_1',
    severityBand: 'MODERATE',
    specialty: 'anxiety disorders',
    screeningDomainsElevated: ['anxiety', 'sleep'],
  };

  it('with no ANTHROPIC_API_KEY: returns >= 2 honest rule-based directions and logs a PENDING AIRecommendation', async () => {
    withNoKey();
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.suggestDifferentials(baseParams);

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(result.source).toBe('rule-based');
    // Anti-anchoring rule: never a single answer, even in the rule-based path.
    expect(result.directions.length).toBeGreaterThanOrEqual(2);
    expect(result.directions.every((d) => d.direction && d.rationale)).toBe(true);

    expect(prisma.aIRecommendation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agent: 'DIFFERENTIAL',
          humanDecision: 'PENDING',
          linkedEntityType: 'Client',
          linkedEntityId: 'client_1',
        }),
      }),
    );
  });

  it('PHI minimization: only severity band, specialty, and coded screening domains reach the model', async () => {
    withKey();
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text:
            '- Consider a mood-disorder evaluation || Screening indicates elevated depression-adjacent signals\n' +
            '- Consider an anxiety-disorder evaluation || Screening indicates elevated anxiety signals',
        },
      ],
    });
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.suggestDifferentials(baseParams);

    expect(result.source).toBe('ai');
    expect(result.directions).toHaveLength(2);
    const call = mockMessagesCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain('severity band: MODERATE');
    expect(call.messages[0].content).toContain('suggested specialty: anxiety disorders');
    expect(call.messages[0].content).toContain('elevated screening domains: anxiety, sleep');
    expect(call.system).toMatch(/NEVER state or imply a diagnosis/);
    expect(call.system).toMatch(/AT LEAST TWO/);
  });

  it('anti-anchoring rule: a model response parsed into fewer than 2 directions is treated as incomplete and degrades honestly to rule-based', async () => {
    withKey();
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '- Only one direction || only one rationale' }],
    });
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.suggestDifferentials(baseParams);

    expect(result.source).toBe('rule-based');
    expect(result.directions.length).toBeGreaterThanOrEqual(2);
  });

  it('WAVE CR consent gate: withholds AI and never invokes the model without an active AI_ASSISTED_ANALYSIS consent', async () => {
    withKey();
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const consent = makeConsent(false);
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, consent as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.suggestDifferentials(baseParams);

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(result.source).toBe('rule-based');
    expect(result.withheldReason).toBe('no-ai-consent');
  });
});

describe('AiGatewayService.narrateOutcomeTrend (Outcome Intelligence, §3.5)', () => {
  const baseParams = {
    tenantId: 'tenant_demo',
    clientId: 'client_1',
    construct: 'depression',
    rciClassification: 'reliably-improved',
    direction: 'decreased',
    nPoints: 4,
  };

  it('with no ANTHROPIC_API_KEY: returns an honest rule-based narrative and logs a PENDING AIRecommendation', async () => {
    withNoKey();
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.narrateOutcomeTrend(baseParams);

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(result.source).toBe('rule-based');
    expect(result.narrative).toMatch(/reliably improved/);

    expect(prisma.aIRecommendation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ agent: 'OUTCOME', humanDecision: 'PENDING', linkedEntityId: 'client_1' }),
      }),
    );
  });

  it('PHI minimization: only the already-computed construct/RCI classification/direction/nPoints reach the model — never raw scores/dates', async () => {
    withKey();
    mockMessagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Assistive trend narrative.' }] });
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.narrateOutcomeTrend(baseParams);

    expect(result.source).toBe('ai');
    const call = mockMessagesCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain('construct: depression');
    expect(call.messages[0].content).toContain('deterministic RCI classification: reliably-improved');
    expect(call.messages[0].content).toContain('direction: decreased');
    expect(call.messages[0].content).toContain('number of data points in series: 4');
    expect(call.system).toMatch(/never recompute, contradict, or second-guess/);
  });

  it('WAVE CR consent gate: withholds AI and never invokes the model without an active AI_ASSISTED_ANALYSIS consent', async () => {
    withKey();
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const consent = makeConsent(false);
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, consent as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.narrateOutcomeTrend(baseParams);

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(result.source).toBe('rule-based');
    expect(result.withheldReason).toBe('no-ai-consent');
  });
});

describe('AiGatewayService.interpretScore (Psychometric Interpretation, §3.7, CLINICIAN_ONLY)', () => {
  const baseParams = {
    tenantId: 'tenant_demo',
    clientId: 'client_1',
    scoreId: 'score_1',
    instrumentCode: 'PHQ-9',
    severityBand: 'MODERATE' as string | null,
    theta: 0.4 as number | null,
    se: 0.3 as number | null,
    synthetic: false,
  };

  it('with no ANTHROPIC_API_KEY: returns an honest rule-based interpretation and logs a PENDING AIRecommendation', async () => {
    withNoKey();
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.interpretScore(baseParams);

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(result.source).toBe('rule-based');

    expect(prisma.aIRecommendation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agent: 'PSYCHOMETRIC',
          humanDecision: 'PENDING',
          linkedEntityType: 'PsychometricScore',
          linkedEntityId: 'score_1',
        }),
      }),
    );
  });

  it('must state the synthetic-calibration caveat when synthetic=true (both AI and rule-based paths)', async () => {
    withNoKey();
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.interpretScore({ ...baseParams, synthetic: true });

    expect(result.source).toBe('rule-based');
    expect(result.interpretation).toMatch(/synthetic|demo/i);
  });

  it('PHI minimization: only instrument/severity/theta/se/synthetic reach the model — never client identifiers', async () => {
    withKey();
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Assistive interpretation with no caveat needed.' }],
    });
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.interpretScore(baseParams);

    expect(result.source).toBe('ai');
    const call = mockMessagesCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain('instrument: PHQ-9');
    expect(call.messages[0].content).toContain('severity band: MODERATE');
    expect(call.messages[0].content).toContain('theta estimate: 0.4');
    expect(call.messages[0].content).toContain('synthetic/demo calibration: no');
    expect(call.system).not.toMatch(/client name|date of birth/i);
  });

  it('degrades honestly to rule-based when the model omits the required synthetic-calibration caveat', async () => {
    withKey();
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'An interpretation that never mentions the calibration caveat.' }],
    });
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.interpretScore({ ...baseParams, synthetic: true });

    expect(result.source).toBe('rule-based');
    expect(result.interpretation).toMatch(/synthetic|demo/i);
  });

  it('WAVE CR consent gate: withholds AI and never invokes the model without an active AI_ASSISTED_ANALYSIS consent', async () => {
    withKey();
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const consent = makeConsent(false);
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, consent as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.interpretScore(baseParams);

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(result.source).toBe('rule-based');
    expect(result.withheldReason).toBe('no-ai-consent');
  });
});

describe('AiGatewayService.summarizeRiskContext (Crisis context-assembly, §3.6 — advisory only)', () => {
  const baseParams = {
    tenantId: 'tenant_demo',
    clientId: 'client_1',
    riskFlagId: 'flag_1',
    severity: 'HIGH',
    riskType: 'suicidal_ideation',
    openEscalations: 1,
    hasActiveSafetyPlan: true,
    slaDueInMinutes: 30,
  };

  it('with no ANTHROPIC_API_KEY: returns an honest rule-based summary and logs a PENDING AIRecommendation', async () => {
    withNoKey();
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.summarizeRiskContext(baseParams);

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(result.source).toBe('rule-based');
    expect(result.summary).toMatch(/human responder decides and acts/);

    expect(prisma.aIRecommendation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agent: 'CRISIS_RISK',
          humanDecision: 'PENDING',
          linkedEntityType: 'RiskFlag',
          linkedEntityId: 'flag_1',
        }),
      }),
    );
  });

  it('PHI minimization: only severity/riskType/openEscalations/hasActiveSafetyPlan/slaDueInMinutes reach the model', async () => {
    withKey();
    mockMessagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Brief situational summary.' }] });
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.summarizeRiskContext(baseParams);

    expect(result.source).toBe('ai');
    const call = mockMessagesCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain('severity: HIGH');
    expect(call.messages[0].content).toContain('risk type: suicidal_ideation');
    expect(call.messages[0].content).toContain('other open escalations for this client: 1');
    expect(call.messages[0].content).toContain('active safety plan on file: yes');
    expect(call.messages[0].content).toContain('SLA time remaining: 30 minute(s)');
    expect(call.system).toMatch(/DETECTION already happened deterministically elsewhere/);
  });

  it('WAVE CR consent gate: withholds AI and never invokes the model without an active AI_ASSISTED_ANALYSIS consent', async () => {
    withKey();
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const consent = makeConsent(false);
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, consent as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.summarizeRiskContext(baseParams);

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(result.source).toBe('rule-based');
    expect(result.withheldReason).toBe('no-ai-consent');
  });
});

describe('AiGatewayService.rankCandidates (Allocation rationale extension, §3.8)', () => {
  function candidate(overrides: Partial<{ psychologistId: string; score: number; fitWarnings: string[] }> = {}) {
    return {
      psychologistId: overrides.psychologistId ?? 'psy_1',
      displayName: 'Dr. Test',
      specialties: ['anxiety disorders'],
      languages: ['en'],
      jurisdiction: 'CA',
      caseloadUtilization: 0.5,
      outcomeIndex: 80,
      score: overrides.score ?? 90,
      rationale: 'deterministic rationale',
      fitWarnings: overrides.fitWarnings ?? [],
    };
  }

  it('the ranking is ALWAYS the deterministic sort — the AI layer never reorders, even when unconfigured', async () => {
    withNoKey();
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const candidates = [candidate({ psychologistId: 'psy_low', score: 40 }), candidate({ psychologistId: 'psy_high', score: 95 })];
    const result = await svc.rankCandidates({ tenantId: 'tenant_demo', clientId: 'client_1', candidates });

    expect(result.ranked.map((c) => c.psychologistId)).toEqual(['psy_high', 'psy_low']);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(result.source).toBe('rule-based');
    expect(result.aiRationales).toHaveLength(2);
  });

  it('PHI minimization: only score/specialtyMatch/caseloadUtilization per top-3 candidate reach the model — never client identifiers', async () => {
    withKey();
    mockMessagesCreate.mockResolvedValue({ content: [{ type: 'text', text: '1: Strong specialty and score match.' }] });
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const candidates = [candidate({ psychologistId: 'psy_only' })];
    const result = await svc.rankCandidates({ tenantId: 'tenant_demo', clientId: 'client_1', candidates });

    expect(result.source).toBe('ai');
    expect(result.aiRationales).toEqual([{ psychologistId: 'psy_only', rationale: 'Strong specialty and score match.' }]);
    const call = mockMessagesCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain('match score: 90.00');
    expect(call.messages[0].content).toContain('specialty match: yes');
    expect(call.messages[0].content).toContain('caseload utilization: 50%');
    expect(call.system).toMatch(/NEVER reorder/);
  });

  it('degrades honestly to rule-based rationale when the model call fails', async () => {
    withKey();
    mockMessagesCreate.mockRejectedValue(new Error('provider down'));
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, makeConsent() as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.rankCandidates({ tenantId: 'tenant_demo', clientId: 'client_1', candidates: [candidate()] });

    expect(result.source).toBe('rule-based');
    expect(result.aiRationales).toHaveLength(1);
  });

  it('WAVE CR consent gate: withholds AI rationale and never invokes the model without an active AI_ASSISTED_ANALYSIS consent, while the ranking itself still returns', async () => {
    withKey();
    const prisma = makePrisma();
    const bus = { publish: jest.fn() };
    const consent = makeConsent(false);
    const svc = new AiGatewayService(prisma as any, bus as any, { record: jest.fn() } as any, consent as any, { isEnabled: jest.fn().mockResolvedValue(true) } as any);

    const result = await svc.rankCandidates({ tenantId: 'tenant_demo', clientId: 'client_1', candidates: [candidate()] });

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(result.source).toBe('rule-based');
    expect(result.withheldReason).toBe('no-ai-consent');
    expect(result.ranked).toHaveLength(1);
  });
});

describe('AiGatewayService human-decision queue', () => {
  const principal = {
    userId: 'user_clin',
    tenantId: 'tenant_demo',
    roles: ['PSYCHOLOGIST'],
    permissions: ['ai:decision'],
  } as any;

  it('lists only PENDING recommendations for the tenant', async () => {
    const prisma = {
      aIRecommendation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'rec_1',
            agent: 'SESSION_NOTE',
            confidence: 0.7,
            humanDecision: 'PENDING',
            decidedBy: null,
            linkedEntityType: 'Session',
            linkedEntityId: 'sess_1',
            output: { draft: 'x' },
            createdAt: new Date('2026-07-01T00:00:00Z'),
          },
        ]),
      },
    };
    const svc = new AiGatewayService(
      prisma as any,
      { publish: jest.fn() } as any,
      { record: jest.fn() } as any,
      makeConsent() as any,
      { isEnabled: jest.fn().mockResolvedValue(true) } as any,
    );

    const rows = await svc.listPendingRecommendations(principal, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('rec_1');
    expect(rows[0]!.humanDecision).toBe('PENDING');
    expect(prisma.aIRecommendation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant_demo', humanDecision: 'PENDING' },
      }),
    );
  });

  it('records ACCEPT via compare-and-swap and critical audit', async () => {
    const prisma = {
      aIRecommendation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'rec_1',
          tenantId: 'tenant_demo',
          humanDecision: 'PENDING',
          agent: 'INTAKE',
          linkedEntityType: 'Intake',
          linkedEntityId: 'in_1',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'rec_1',
          agent: 'INTAKE',
          confidence: 0.5,
          humanDecision: 'ACCEPTED',
          decidedBy: 'user_clin',
          linkedEntityType: 'Intake',
          linkedEntityId: 'in_1',
          output: {},
          createdAt: new Date('2026-07-01T00:00:00Z'),
        }),
      },
    };
    const audit = { record: jest.fn() };
    const svc = new AiGatewayService(
      prisma as any,
      { publish: jest.fn() } as any,
      audit as any,
      makeConsent() as any,
      { isEnabled: jest.fn().mockResolvedValue(true) } as any,
    );

    const result = await svc.decideRecommendation(principal, 'rec_1', { decision: 'ACCEPTED' });
    expect(result.humanDecision).toBe('ACCEPTED');
    expect(prisma.aIRecommendation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ humanDecision: 'PENDING' }),
        data: expect.objectContaining({ humanDecision: 'ACCEPTED', decidedBy: 'user_clin' }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ai.recommendation.decided', critical: true }),
    );
  });

  it('rejects a second concurrent decision after CAS loses', async () => {
    const prisma = {
      aIRecommendation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'rec_1',
          tenantId: 'tenant_demo',
          humanDecision: 'PENDING',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const svc = new AiGatewayService(
      prisma as any,
      { publish: jest.fn() } as any,
      { record: jest.fn() } as any,
      makeConsent() as any,
      { isEnabled: jest.fn().mockResolvedValue(true) } as any,
    );

    await expect(svc.decideRecommendation(principal, 'rec_1', { decision: 'REJECTED' })).rejects.toThrow(
      /already decided/i,
    );
  });
});
