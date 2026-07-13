/**
 * VPSY OS seed — provisions a demo tenant, the 8 roles + permissions,
 * a manager, two psychologists, a client, a public-domain screening
 * questionnaire, and the active AI model/prompt versions.
 *
 * Passwords are argon2-hashed. Demo password for every account: "Vpsy!2026".
 */
import { PrismaClient } from '@prisma/client';
import { AI_CONSENT_VERSION, REQUIRED_CONSENT_VERSIONS, ROLE_PERMISSIONS } from '@vpsy/contracts';
import argon2 from 'argon2';

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'Vpsy!2026';

async function main() {
  const hashed = await argon2.hash(DEMO_PASSWORD);

  const tenant = await prisma.tenant.upsert({
    where: { id: 'tenant_demo' },
    update: { slug: 'vpsy-demo', selfRegistrationEnabled: true },
    create: {
      id: 'tenant_demo',
      name: 'VPSY Demo Clinic Network',
      slug: 'vpsy-demo',
      countryCode: 'US',
      residencyRegion: 'us-east',
      selfRegistrationEnabled: true,
    },
  });

  // If the RLS tenant-isolation backstop migration has been applied, every
  // strict-table INSERT enforces a WITH CHECK on `app.current_tenant`. This raw
  // seed client isn't request-scoped, so set the session GUC to the demo tenant
  // once here — everything below belongs to it. Harmless (a no-op setting) when
  // RLS isn't enabled. Session-level (false) so it persists across the seed.
  await prisma.$executeRawUnsafe("SELECT set_config('app.current_tenant', $1, false)", tenant.id);

  const clinic = await prisma.clinic.upsert({
    where: { id: 'clinic_demo' },
    update: {},
    create: { id: 'clinic_demo', tenantId: tenant.id, name: 'VPSY Virtual Clinic', type: 'VIRTUAL' },
  });

  // Roles + permissions
  for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName as any },
      update: {},
      create: { name: roleName as any, description: `${roleName} role` },
    });
    for (const key of perms) {
      const permission = await prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  async function makeUser(id: string, email: string, fullName: string, roleName: string) {
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email } },
      update: {},
      create: { id, tenantId: tenant.id, email, fullName, hashedPassword: hashed, mfaEnabled: false },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName as any } });
    await prisma.roleAssignment.upsert({
      where: { userId_roleId_clinicId: { userId: user.id, roleId: role.id, clinicId: clinic.id } },
      update: {},
      create: { userId: user.id, roleId: role.id, clinicId: clinic.id, jurisdiction: 'US-NY' },
    });
    return user;
  }

  const manager = await makeUser('user_manager', 'manager@vpsy.health', 'Dr. Mara Osei (Clinical Director)', 'MANAGER');
  // Executive account — holds reports:read + national:read (powers the /reports dashboard).
  await makeUser('user_exec', 'exec@vpsy.health', 'Sam Okonkwo (Executive)', 'EXECUTIVE');
  // Admin account (Wave E — Admin Configuration, ctx 27): holds admin:config,
  // the only role that can drive /admin/tenant, /admin/clinics, and the
  // EU-AI-Act kill-switch /admin/feature-flags surface.
  await makeUser('user_admin', 'admin@vpsy.health', 'Priya Nair (System Admin)', 'ADMIN');

  const psyUserA = await makeUser('user_psy_a', 'dr.rivera@vpsy.health', 'Dr. Elena Rivera', 'PSYCHOLOGIST');
  const psyA = await prisma.psychologist.upsert({
    where: { userId: psyUserA.id },
    update: {},
    create: {
      userId: psyUserA.id,
      tenantId: tenant.id,
      specialties: ['anxiety', 'trauma', 'CBT'],
      languages: ['en', 'es'],
      yearsExperience: 11,
      caseloadCap: 30,
      currentCaseload: 18,
      outcomeIndex: 82,
      bio: 'Trauma-focused CBT specialist.',
    },
  });
  await prisma.credential.create({
    data: {
      psychologistId: psyA.id,
      licenseNumber: 'NY-PSY-44821',
      jurisdiction: 'US-NY',
      issuingBody: 'NY State Board of Psychology',
      verificationStatus: 'verified',
      malpracticeStatus: 'active',
    },
  });

  const psyUserB = await makeUser('user_psy_b', 'dr.okafor@vpsy.health', 'Dr. Daniel Okafor', 'PSYCHOLOGIST');
  const psyB = await prisma.psychologist.upsert({
    where: { userId: psyUserB.id },
    update: {},
    create: {
      userId: psyUserB.id,
      tenantId: tenant.id,
      specialties: ['depression', 'ADHD', 'DBT'],
      languages: ['en'],
      yearsExperience: 7,
      caseloadCap: 25,
      currentCaseload: 22,
      outcomeIndex: 74,
      bio: 'Mood and attention specialist.',
    },
  });
  await prisma.credential.create({
    data: {
      psychologistId: psyB.id,
      licenseNumber: 'NY-PSY-51002',
      jurisdiction: 'US-NY',
      issuingBody: 'NY State Board of Psychology',
      verificationStatus: 'verified',
      malpracticeStatus: 'active',
    },
  });

  const clientUser = await makeUser('user_client', 'alex.client@example.com', 'Alex Chen', 'CLIENT');
  const client = await prisma.client.upsert({
    where: { userId: clientUser.id },
    update: {},
    create: {
      userId: clientUser.id,
      tenantId: tenant.id,
      demographics: { dob: '1994-03-11', sex: 'M', gender: 'man', city: 'New York' },
      preferredLanguage: 'en',
      riskLevel: 'MODERATE',
    },
  });

  // Phase 2 consent gate: intake requires current-version TELEPSYCHOLOGY +
  // DATA_PROCESSING (see REQUIRED_CONSENT_VERSIONS); CRISIS_POLICY is also
  // granted so the demo client's consent record is representative. Idempotent
  // via fixed ids — never re-created, only left as-is on re-seed.
  // `consent_demo_wearable_data` is a dedicated DATA_PROCESSING-typed grant for
  // the wearable ingestion category (doc 09 §5 — P0 clinical-safety: consent is
  // mandatory at wearable ingest). There is no distinct `WEARABLE` ConsentType
  // in the shared enum yet, so DATA_PROCESSING is the category used to gate
  // physiological/behavioral signal ingestion, kept separate from the intake
  // consent so revoking one never silently revokes the other.
  // WAVE CR — AI-consent remediation (APA AI guidance 2025 / GDPR Art.22):
  // `consent_demo_ai_assisted_analysis` is a distinct, separately revocable
  // grant that lets the demo client's AI flows (intake summary, session-note
  // assist, treatment-plan assist) call the real model. It is intentionally
  // NOT in REQUIRED_CONSENT_VERSIONS — revoking it would only make those AI
  // Gateway calls degrade to their honest rule-based path, never block care.
  const demoConsents: Array<{ id: string; type: string; version: string }> = [
    { id: 'consent_demo_telepsychology', type: 'TELEPSYCHOLOGY', version: REQUIRED_CONSENT_VERSIONS.TELEPSYCHOLOGY! },
    { id: 'consent_demo_data_processing', type: 'DATA_PROCESSING', version: REQUIRED_CONSENT_VERSIONS.DATA_PROCESSING! },
    { id: 'consent_demo_crisis_policy', type: 'CRISIS_POLICY', version: '1.0.0' },
    { id: 'consent_demo_wearable_data', type: 'DATA_PROCESSING', version: '1.0.0' },
    { id: 'consent_demo_ai_assisted_analysis', type: 'AI_ASSISTED_ANALYSIS', version: AI_CONSENT_VERSION },
  ];
  for (const c of demoConsents) {
    await prisma.consent.upsert({
      where: { id: c.id },
      update: {},
      create: { id: c.id, clientId: client.id, type: c.type as any, version: c.version },
    });
  }

  // A public-domain screening questionnaire (generic depression screen; not a clone of a licensed instrument)
  const q = await prisma.questionnaire.upsert({
    where: { code: 'VPSY-DEP-SCREEN-9' },
    update: {},
    create: {
      code: 'VPSY-DEP-SCREEN-9',
      name: 'VPSY Depression Screen (9-item)',
      construct: 'depression',
      licensing: 'PUBLIC_DOMAIN',
      scoringMethod: 'CLASSICAL',
    },
  });
  const qv = await prisma.questionnaireVersion.upsert({
    where: { questionnaireId_version: { questionnaireId: q.id, version: '1.0.0' } },
    update: {},
    create: {
      questionnaireId: q.id,
      version: '1.0.0',
      published: true,
      // Shape consumed by the Psychometrics ScoringService: exhaustive inclusive raw-score bands,
      // plus the safety-item hook (07-psychometrics-engine.md §4) — item 9 is the
      // suicidal-ideation item; any endorsement (answer >= 1) raises a deterministic
      // HIGH RiskFlag + Escalation on a standalone assessment, same as intake's safety screen.
      // Band boundaries follow the widely-published 9-item-depression-screen raw-sum
      // convention (Kroenke, Spitzer & Williams 2001, "The PHQ-9: Validity of a Brief
      // Depression Severity Measure") — LOW/MODERATE/HIGH/SEVERE cut at 5/10/15 on a
      // 0-27 raw metric — while every item stem below is ORIGINAL VPSY content, not a
      // reproduction of any licensed instrument's wording.
      cutoffs: {
        bands: [
          { band: 'LOW', min: 0, max: 4 },
          { band: 'MODERATE', min: 5, max: 9 },
          { band: 'HIGH', min: 10, max: 14 },
          { band: 'SEVERE', min: 15, max: 27 },
        ],
        // WAVE CR (audit-flagged "PHQ-9 5-tier collapse"): the published
        // convention further splits the top raw-score band into "moderately
        // severe" (15-19) and "severe" (20-27). The shared `SeverityBand`
        // enum is deliberately left 4-valued (widening it is out of scope for
        // this wave) — the finer tier is documented here as an informational
        // sub-band and threaded into the persisted interpretation text by
        // `ScoringService.score` (`cutoffs.subBands`), so the distinction
        // reaches the clinician/patient record, not just this JSON blob.
        subBands: [
          { parentBand: 'SEVERE', label: 'MODERATELY_SEVERE', min: 15, max: 19 },
          { parentBand: 'SEVERE', label: 'SEVERE', min: 20, max: 27 },
        ],
        safetyItems: [{ itemId: 'q9', minAnswer: 1, category: 'suicidal_ideation' }],
      },
    },
  });

  // ─────────────────────────────────────────────────────────────
  // WAVE CR — "zero Item rows exist; content validity is unassessable for
  // items that don't exist" (AERA/APA/NCME Standards Ch.1). Nine ORIGINAL
  // item stems (first-person, ~6th-grade reading level, 0-3 frequency
  // anchors) giving content-valid coverage of: low mood, anhedonia, sleep,
  // energy/fatigue, appetite, self-worth/guilt, concentration, psychomotor
  // change, and self-harm/suicidal ideation (item 9 — the configured safety
  // item above). Deliberately DISTINCT phrasing from any licensed
  // instrument's item text (e.g. PHQ-9/BDI) — original content scored on a
  // public-domain-convention raw-sum metric, not a reproduction.
  // ─────────────────────────────────────────────────────────────
  const DEP_SCREEN_ANCHORS = [
    { label: 'Not at all', value: 0 },
    { label: 'Several days', value: 1 },
    { label: 'More than half the days', value: 2 },
    { label: 'Nearly every day', value: 3 },
  ];
  const depItems: Array<{ stem: string }> = [
    { stem: 'I have felt sad or down for a big part of the day.' }, // q1 — low mood
    { stem: 'I stopped enjoying things that usually matter to me.' }, // q2 — anhedonia
    { stem: 'My sleep has been unsettled — too little, too much, or just not restful.' }, // q3 — sleep
    { stem: 'I have felt drained of energy, even after resting.' }, // q4 — energy/fatigue
    { stem: 'My appetite has changed noticeably, eating a lot more or a lot less than usual.' }, // q5 — appetite
    { stem: 'I have been harder on myself than usual, feeling like a failure or a burden to others.' }, // q6 — self-worth/guilt
    { stem: 'My mind has felt foggy, making it hard to focus on tasks or conversations.' }, // q7 — concentration
    {
      stem:
        "I have noticed myself moving or speaking noticeably slower, or so restless I can't sit still — more than what's typical for me.",
    }, // q8 — psychomotor change
    { stem: "I have had thoughts that life isn't worth living or thoughts of harming myself." }, // q9 — self-harm/suicidal ideation (safety item)
  ];
  for (let i = 0; i < depItems.length; i++) {
    const def = depItems[i]!;
    await prisma.item.upsert({
      where: { id: `item_dep_screen_${i + 1}` },
      update: {},
      create: {
        id: `item_dep_screen_${i + 1}`,
        questionnaireVersionId: qv.id,
        linkId: `q${i + 1}`,
        stem: def.stem,
        responseOptions: DEP_SCREEN_ANCHORS,
        orderIndex: i,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // WAVE CR — ItemTranslation infrastructure (docs/technical/
  // 07-psychometrics-engine.md §9): "UI i18n is NOT validated clinical-item
  // translation". One demo Spanish (es) translation, provenance status
  // 'draft' — i.e. NOT yet validated. `PsychometricsService.getVersionItems`
  // must serve the SOURCE-language stem + an honest
  // `unvalidated-source-language` marker for these until a real
  // translation-validation study promotes provenance.status to 'validated'.
  // ─────────────────────────────────────────────────────────────
  const depItemIds = depItems.map((_, i) => `item_dep_screen_${i + 1}`);
  const esTranslations: Array<{ itemId: string; stem: string; responseOptions: typeof DEP_SCREEN_ANCHORS }> = [
    {
      itemId: depItemIds[0]!,
      stem: 'Me he sentido triste o decaído/a durante gran parte del día.',
      responseOptions: [
        { label: 'Para nada', value: 0 },
        { label: 'Varios días', value: 1 },
        { label: 'Más de la mitad de los días', value: 2 },
        { label: 'Casi todos los días', value: 3 },
      ],
    },
    {
      itemId: depItemIds[1]!,
      stem: 'Dejé de disfrutar cosas que normalmente me importan.',
      responseOptions: [
        { label: 'Para nada', value: 0 },
        { label: 'Varios días', value: 1 },
        { label: 'Más de la mitad de los días', value: 2 },
        { label: 'Casi todos los días', value: 3 },
      ],
    },
    {
      itemId: depItemIds[2]!,
      stem: 'Mi sueño ha sido irregular: demasiado poco, demasiado, o simplemente poco reparador.',
      responseOptions: [
        { label: 'Para nada', value: 0 },
        { label: 'Varios días', value: 1 },
        { label: 'Más de la mitad de los días', value: 2 },
        { label: 'Casi todos los días', value: 3 },
      ],
    },
  ];
  for (let i = 0; i < esTranslations.length; i++) {
    const t = esTranslations[i]!;
    await prisma.itemTranslation.upsert({
      where: { itemId_locale: { itemId: t.itemId, locale: 'es' } },
      update: {},
      create: {
        id: `itemtranslation_dep_screen_${i + 1}_es`,
        itemId: t.itemId,
        locale: 'es',
        stem: t.stem,
        responseOptions: t.responseOptions,
        provenance: {
          method: 'forward-back-translation',
          translator: 'demo-translator-1',
          backTranslator: 'demo-back-translator-1',
          cognitiveInterviewN: 0,
          status: 'draft', // NOT validated — must be served as source + honest marker.
        },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // IRT-calibrated demo instrument (07-psychometrics-engine.md §3/§5) — a
  // public-domain-style 7-item anxiety scale scored with the Graded Response
  // Model. Item parameters are FIXED calibration values (the engine only ever
  // scores against them; it never re-estimates at runtime). Answers are keyed
  // by Item.linkId (q1..q7), categories 0..3. Classical raw-sum banding still
  // runs alongside (bands on the 0..21 raw metric), so the safety/risk
  // pipeline is identical for IRT and classical instruments.
  // Worked example (pinned in irt-scoring.service.spec.ts): answers
  // {q1:2,q2:1,q3:3,q4:1,q5:2,q6:2,q7:3} → theta=0.803, SE=0.385.
  // ─────────────────────────────────────────────────────────────
  // WAVE C: scoringMethod flipped IRT → CAT so the demo instrument can also be
  // administered adaptively (POST /assessments/cat/start requires an explicit
  // CAT opt-in). Batch scoring is unchanged — computeIrt() accepts both IRT
  // and CAT — so the pinned worked example above still holds. The `update`
  // block flips an already-seeded database too (upsert would otherwise skip it).
  const qIrt = await prisma.questionnaire.upsert({
    where: { code: 'VPSY-ANX-IRT-7' },
    update: { scoringMethod: 'CAT' },
    create: {
      code: 'VPSY-ANX-IRT-7',
      name: 'VPSY Anxiety Scale (7-item, IRT)',
      construct: 'anxiety',
      licensing: 'PUBLIC_DOMAIN',
      scoringMethod: 'CAT',
    },
  });
  const qvIrt = await prisma.questionnaireVersion.upsert({
    where: { questionnaireId_version: { questionnaireId: qIrt.id, version: '1.0.0' } },
    // Band-convention fix must reach an ALREADY-seeded row too (update:{} left
    // the old drifted bands live in existing DBs — CAT-agent finding).
    update: {
      cutoffs: {
        bands: [
          { band: 'LOW', min: 0, max: 4 },
          { band: 'MODERATE', min: 5, max: 9 },
          { band: 'HIGH', min: 10, max: 14 },
          { band: 'SEVERE', min: 15, max: 21 },
        ],
        safetyItems: [],
      },
    },
    create: {
      questionnaireId: qIrt.id,
      version: '1.0.0',
      published: true,
      // WAVE CR (audit-flagged "GAD-7-pattern band drift"): the classical
      // raw-sum bands on the 0-21 metric now follow the source convention
      // exactly (Spitzer, Kroenke, Williams & Löwe 2006, "A Brief Measure for
      // Assessing Generalized Anxiety Disorder: The GAD-7") —
      // LOW 0-4 / MODERATE 5-9 / HIGH 10-14 / SEVERE 15-21 — replacing the
      // previous off-by-one bands (0-5/6-10/11-15/16-21).
      cutoffs: {
        bands: [
          { band: 'LOW', min: 0, max: 4 },
          { band: 'MODERATE', min: 5, max: 9 },
          { band: 'HIGH', min: 10, max: 14 },
          { band: 'SEVERE', min: 15, max: 21 },
        ],
        safetyItems: [],
      },
    },
  });
  const irtItems: Array<{ stem: string; a: number; thresholds: number[] }> = [
    { stem: 'I felt nervous, anxious, or on edge.', a: 1.8, thresholds: [-1.2, 0.0, 1.1] },
    { stem: 'I was not able to stop or control worrying.', a: 1.4, thresholds: [-0.8, 0.3, 1.5] },
    { stem: 'I worried too much about different things.', a: 2.1, thresholds: [-1.5, -0.4, 0.7] },
    { stem: 'I had trouble relaxing.', a: 1.1, thresholds: [-0.3, 0.8, 1.9] },
    { stem: 'I was so restless that it was hard to sit still.', a: 1.6, thresholds: [-1.0, 0.2, 1.3] },
    { stem: 'I became easily annoyed or irritable.', a: 1.3, thresholds: [-0.5, 0.6, 1.7] },
    { stem: 'I felt afraid, as if something awful might happen.', a: 1.9, thresholds: [-1.3, -0.2, 0.9] },
  ];
  const IRT_CALIBRATION = 'cal_demo_anx_2026_1';
  for (let i = 0; i < irtItems.length; i++) {
    const def = irtItems[i]!;
    const item = await prisma.item.upsert({
      where: { id: `item_anx_irt_${i + 1}` },
      update: {},
      create: {
        id: `item_anx_irt_${i + 1}`,
        questionnaireVersionId: qvIrt.id,
        linkId: `q${i + 1}`,
        stem: def.stem,
        responseOptions: ['Not at all', 'Several days', 'More than half the days', 'Nearly every day'],
        orderIndex: i,
      },
    });
    await prisma.itemParameter.upsert({
      where: { itemId_calibrationId: { itemId: item.id, calibrationId: IRT_CALIBRATION } },
      update: {},
      create: {
        id: `itemparam_anx_irt_${i + 1}`,
        itemId: item.id,
        calibrationId: IRT_CALIBRATION,
        model: 'GRM',
        a: def.a,
        thresholds: def.thresholds,
        seEstimates: { a: 0.08, thresholds: [0.06, 0.05, 0.07], sample: 'demo calibration N=1200 (synthetic)' },
      },
    });
  }

  // Active AI model + prompt versions
  await prisma.aIModelVersion.upsert({
    where: { provider_model_version: { provider: 'anthropic', model: 'claude-opus-4-8', version: '2026.01' } },
    update: {},
    create: { provider: 'anthropic', model: 'claude-opus-4-8', version: '2026.01', capability: 'clinical-reasoning' },
  });
  for (const agent of ['INTAKE', 'DIFFERENTIAL', 'ALLOCATION'] as const) {
    await prisma.promptVersion.upsert({
      where: { agent_version: { agent, version: '1.0.0' } },
      update: {},
      create: {
        agent,
        version: '1.0.0',
        template: `${agent} agent — assist only; never diagnose; require clinician confirmation.`,
        guardrails: { neverDiagnose: true, requireHumanApproval: true },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Demo dashboard trail — alex.client assigned to dr.rivera, with a full
  // clinical history (assignment → appointments/session/notes → plan/goals →
  // psychometrics → outcomes → wearables) so the flagship dashboards render
  // against real rows instead of empty states.
  // ─────────────────────────────────────────────────────────────
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

  const assignment = await prisma.assignment.upsert({
    where: { id: 'assignment_demo_1' },
    update: {},
    create: {
      id: 'assignment_demo_1',
      tenantId: tenant.id,
      clientId: client.id,
      psychologistId: psyA.id,
      status: 'APPROVED',
      proposedBy: 'AI',
      approvedBy: manager.id,
      managerNote: 'Strong specialty + language match; approved.',
      candidates: [],
      rank: 1,
    },
  });

  const futureStart = daysFromNow(3);
  const futureAppointment = await prisma.appointment.upsert({
    where: { id: 'appointment_demo_future' },
    update: {},
    create: {
      id: 'appointment_demo_future',
      tenantId: tenant.id,
      assignmentId: assignment.id,
      clientId: client.id,
      psychologistId: psyA.id,
      startsAt: futureStart,
      endsAt: new Date(futureStart.getTime() + 50 * 60 * 1000),
      timezone: 'America/New_York',
      format: 'VIDEO',
      status: 'CONFIRMED',
    },
  });

  const pastStart = daysAgo(7);
  const pastAppointment = await prisma.appointment.upsert({
    where: { id: 'appointment_demo_past' },
    update: {},
    create: {
      id: 'appointment_demo_past',
      tenantId: tenant.id,
      assignmentId: assignment.id,
      clientId: client.id,
      psychologistId: psyA.id,
      startsAt: pastStart,
      endsAt: new Date(pastStart.getTime() + 50 * 60 * 1000),
      timezone: 'America/New_York',
      format: 'VIDEO',
      status: 'COMPLETED',
    },
  });

  // ─────────────────────────────────────────────────────────────
  // Scheduling (ctx 9) — a few open AvailabilitySlots on dr.rivera's
  // calendar for the next 3 days, so the booking picker renders against
  // real rows. Idempotent (fixed ids); the demo appointments above already
  // cover the booked-appointment side of the contract.
  // ─────────────────────────────────────────────────────────────
  for (let i = 1; i <= 3; i++) {
    const slotStart = daysFromNow(i);
    slotStart.setUTCHours(15, 0, 0, 0); // 15:00 UTC each day
    await prisma.availabilitySlot.upsert({
      where: { id: `availability_demo_${i}` },
      update: {},
      create: {
        id: `availability_demo_${i}`,
        tenantId: tenant.id,
        psychologistId: psyA.id,
        startsAt: slotStart,
        endsAt: new Date(slotStart.getTime() + 50 * 60 * 1000),
        isBooked: false,
      },
    });
  }

  const session = await prisma.session.upsert({
    where: { id: 'session_demo_1' },
    update: {},
    create: {
      id: 'session_demo_1',
      tenantId: tenant.id,
      appointmentId: pastAppointment.id,
      startedAt: pastAppointment.startsAt,
      endedAt: pastAppointment.endsAt,
      modality: 'VIDEO',
    },
  });

  // Treatment plan + goals are created BEFORE the session notes below so the
  // notes' golden-thread FKs (planId/goalIds reference real rows, never
  // forward references) resolve cleanly.
  const plan = await prisma.treatmentPlan.upsert({
    where: { id: 'plan_demo_1' },
    update: {},
    create: {
      id: 'plan_demo_1',
      tenantId: tenant.id,
      clientId: client.id,
      problemList: ['Persistent low mood', 'Sleep disruption', 'Reduced motivation'],
      sessionFrequency: 'weekly',
      measurementSchedule: { depression: 'biweekly' },
      riskPlan: 'No current safety concerns; safety plan on file if risk escalates.',
      reviewDate: daysFromNow(60),
      status: 'active',
      version: 1,
    },
  });

  await prisma.goal.upsert({
    where: { id: 'goal_demo_1' },
    update: {},
    create: {
      id: 'goal_demo_1',
      tenantId: tenant.id,
      planId: plan.id,
      description: 'Reduce depressive symptom severity into the LOW band on the VPSY Depression Screen.',
      targetMetric: 'depression construct score',
      baseline: 18,
      target: 5,
      progressPct: 55,
      status: 'active',
    },
  });
  await prisma.goal.upsert({
    where: { id: 'goal_demo_2' },
    update: {},
    create: {
      id: 'goal_demo_2',
      tenantId: tenant.id,
      planId: plan.id,
      description: 'Establish a consistent sleep schedule of 7+ hours nightly.',
      targetMetric: 'avg sleep hours',
      baseline: 5.5,
      target: 7.5,
      progressPct: 30,
      status: 'active',
    },
  });

  // ─────────────────────────────────────────────────────────────
  // WAVE CR item 7 — coded Formulation (provisional) for alex.client, so
  // GET /formulations/client/:id renders against a real row and the demo
  // note below has a real formulationId to golden-thread against.
  // Idempotent (fixed id).
  // ─────────────────────────────────────────────────────────────
  const formulation = await prisma.formulation.upsert({
    where: { id: 'formulation_demo_1' },
    update: {},
    create: {
      id: 'formulation_demo_1',
      tenantId: tenant.id,
      clientId: client.id,
      authorId: psyUserA.id,
      icdCode: 'F41.1',
      dsmCode: '300.02',
      description: 'Generalized Anxiety Disorder, with prominent depressive features under evaluation.',
      status: 'PROVISIONAL',
      specifiers: { severity: 'moderate' },
      onsetDate: daysAgo(180),
    },
  });

  await prisma.sessionNote.upsert({
    where: { id: 'note_demo_signed' },
    update: {},
    create: {
      id: 'note_demo_signed',
      tenantId: tenant.id,
      sessionId: session.id,
      content: {
        format: 'SOAP',
        subjective: 'Client reports mood has been "a bit better" this week; sleep still inconsistent.',
        objective: 'Alert and oriented; mild psychomotor slowing; affect congruent with restricted range.',
        assessment:
          'Depressive symptoms trending downward per self-report and screening trend; sleep remains a target.',
        plan: 'Continue weekly CBT; add sleep hygiene homework; reassess depression screen in two weeks.',
      },
      continuitySummary: 'Third session; steady engagement, gradual symptom improvement.',
      signedAt: new Date(pastAppointment.endsAt.getTime() + 60 * 60 * 1000),
      signedBy: psyUserA.id,
      version: 1,
      // WAVE CR item 8 — golden thread: this seeded note is fully anchored
      // to the demo's active plan/goals + coded formulation, and carries a
      // note-time snapshot + risk-status-at-note (never recomputed later).
      planId: 'plan_demo_1',
      goalIds: ['goal_demo_1', 'goal_demo_2'],
      formulationId: formulation.id,
      riskStatusAtNote: client.riskLevel,
      sessionSnapshot: {
        date: pastAppointment.startsAt.toISOString(),
        durationMin: 50,
        modality: 'VIDEO',
      },
    },
  });

  await prisma.sessionNote.upsert({
    where: { id: 'note_demo_draft' },
    update: {},
    create: {
      id: 'note_demo_draft',
      tenantId: tenant.id,
      sessionId: session.id,
      content: {
        format: 'SOAP',
        subjective: 'Draft — pending review of homework completion before finalizing.',
        objective: 'TBD',
        assessment: 'TBD',
        plan: 'TBD',
      },
      version: 2,
      // Post-signature addendum to note_demo_signed above (WAVE CR P1
      // amendment semantics) — explicit, never silent.
      planId: 'plan_demo_1',
      goalIds: ['goal_demo_1', 'goal_demo_2'],
      formulationId: formulation.id,
      riskStatusAtNote: client.riskLevel,
      sessionSnapshot: {
        date: pastAppointment.startsAt.toISOString(),
        durationMin: 50,
        modality: 'VIDEO',
      },
      amendsVersionId: 'note_demo_signed',
      amendmentReason: 'Adding homework-completion follow-up after client provided sleep log at next check-in.',
    },
  });

  const response = await prisma.questionnaireResponse.upsert({
    where: { id: 'qr_demo_1' },
    update: {},
    create: {
      id: 'qr_demo_1',
      tenantId: tenant.id,
      versionId: qv.id,
      clientId: client.id,
      // WAVE CR — answers all 9 real items now that Item rows exist (q6-q9
      // unendorsed, no safety-item hit); raw sum is unchanged at 7 so the
      // demo PsychometricScore below (MODERATE) stays consistent.
      answers: { q1: 2, q2: 2, q3: 1, q4: 1, q5: 1, q6: 0, q7: 0, q8: 0, q9: 0 },
      administrationMode: 'STATIC',
      responseTimeMs: 46000,
      completedAt: daysAgo(10),
    },
  });
  await prisma.psychometricScore.upsert({
    where: { id: 'score_demo_1' },
    update: {},
    create: {
      id: 'score_demo_1',
      tenantId: tenant.id,
      responseId: response.id,
      rawScore: 7,
      severityBand: 'MODERATE',
      interpretation: 'Moderate depressive symptom severity; continue current plan and monitor.',
    },
  });

  const outcomeSeeds = [
    { id: 'outcome_demo_1', value: 18, occurredAt: daysAgo(21) },
    { id: 'outcome_demo_2', value: 14, occurredAt: daysAgo(14) },
    { id: 'outcome_demo_3', value: 11, occurredAt: daysAgo(7) },
  ];
  for (const o of outcomeSeeds) {
    await prisma.outcomeMeasure.upsert({
      where: { id: o.id },
      update: {},
      create: {
        id: o.id,
        tenantId: tenant.id,
        clientId: client.id,
        construct: 'depression',
        value: o.value,
        therapeuticResponse: 'improving',
        occurredAt: o.occurredAt,
      },
    });
  }

  const wearableDevice = await prisma.wearableDevice.upsert({
    where: { id: 'wearable_device_demo_1' },
    update: {},
    create: {
      id: 'wearable_device_demo_1',
      tenantId: tenant.id,
      clientId: client.id,
      provider: 'apple_health',
      externalId: 'demo-device-001',
      consentId: 'consent_demo_wearable_data',
      connectedAt: daysAgo(20),
      lastSyncAt: now,
    },
  });

  // ~14 days of hrv/sleep_minutes/rhr, HRV gently declining toward the present
  // (so the 7-day rollup surfaces a realistic "recovery trending down" note).
  const WEARABLE_DAYS = 14;
  for (let i = 0; i < WEARABLE_DAYS; i++) {
    const recordedAt = daysAgo(WEARABLE_DAYS - 1 - i);
    recordedAt.setUTCHours(7, 0, 0, 0);
    const hrv = Number((68 - i * 1.3).toFixed(1));
    const sleepMinutes = Math.round(420 - i * 3);
    const rhr = Number((58 + i * 0.3).toFixed(1));

    await prisma.wearableMetric.upsert({
      where: { id: `wearable_metric_demo_hrv_${i}` },
      update: {},
      create: {
        id: `wearable_metric_demo_hrv_${i}`,
        tenantId: tenant.id,
        deviceId: wearableDevice.id,
        kind: 'hrv',
        value: hrv,
        unit: 'ms',
        recordedAt,
        consentId: 'consent_demo_wearable_data',
      },
    });
    await prisma.wearableMetric.upsert({
      where: { id: `wearable_metric_demo_sleep_${i}` },
      update: {},
      create: {
        id: `wearable_metric_demo_sleep_${i}`,
        tenantId: tenant.id,
        deviceId: wearableDevice.id,
        kind: 'sleep_minutes',
        value: sleepMinutes,
        unit: 'min',
        recordedAt,
        consentId: 'consent_demo_wearable_data',
      },
    });
    await prisma.wearableMetric.upsert({
      where: { id: `wearable_metric_demo_rhr_${i}` },
      update: {},
      create: {
        id: `wearable_metric_demo_rhr_${i}`,
        tenantId: tenant.id,
        deviceId: wearableDevice.id,
        kind: 'rhr',
        value: rhr,
        unit: 'bpm',
        recordedAt,
        consentId: 'consent_demo_wearable_data',
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // CRM & Referrals (ctx 29) — default pipeline, demo referrers + leads so the
  // Manager CRM board renders against real rows. Idempotent (fixed ids).
  // ─────────────────────────────────────────────────────────────
  const stageDefs = [
    { id: 'crm_stage_new', name: 'New', order: 0, isWon: false, isLost: false },
    { id: 'crm_stage_screening', name: 'Screening', order: 1, isWon: false, isLost: false },
    { id: 'crm_stage_matched', name: 'Matched', order: 2, isWon: false, isLost: false },
    { id: 'crm_stage_won', name: 'Won', order: 3, isWon: true, isLost: false },
    { id: 'crm_stage_lost', name: 'Lost', order: 4, isWon: false, isLost: true },
  ];
  for (const s of stageDefs) {
    await prisma.pipelineStage.upsert({
      where: { id: s.id },
      update: {},
      create: { id: s.id, tenantId: tenant.id, name: s.name, order: s.order, isWon: s.isWon, isLost: s.isLost },
    });
  }

  const refDefs = [
    { id: 'crm_ref_doc', type: 'DOCTOR' as const, organizationName: 'Dr. Alan Pierce — Family Practice', contact: { name: 'Dr. Alan Pierce', email: 'referrals@pierceclinic.example' }, referralSharePct: 10 },
    { id: 'crm_ref_school', type: 'SCHOOL' as const, organizationName: 'Lincoln High School — Counseling', contact: { name: 'M. Alvarez', email: 'counseling@lincoln.example' }, referralSharePct: 0 },
    { id: 'crm_ref_employer', type: 'EMPLOYER' as const, organizationName: 'Northwind Corp — EAP', contact: { name: 'HR Wellbeing', email: 'eap@northwind.example' }, referralSharePct: 5 },
  ];
  for (const r of refDefs) {
    await prisma.referrer.upsert({
      where: { id: r.id },
      update: {},
      create: { id: r.id, tenantId: tenant.id, type: r.type, organizationName: r.organizationName, contact: r.contact, referralSharePct: r.referralSharePct, active: true },
    });
  }

  const leadDefs = [
    { id: 'crm_lead_1', source: 'WEB' as const, contact: { name: 'Jordan Blake', email: 'jordan.blake@example.com', phone: '+15551230001' }, presentingInterest: 'Anxiety and panic', pipelineStageId: 'crm_stage_new', referrerId: null },
    { id: 'crm_lead_2', source: 'REFERRAL' as const, contact: { name: 'Sam Rivera', email: 'sam.rivera@example.com' }, presentingInterest: 'Low mood, referred by GP', pipelineStageId: 'crm_stage_screening', referrerId: 'crm_ref_doc' },
    { id: 'crm_lead_3', source: 'INSTITUTION' as const, contact: { name: 'Taylor Kim', phone: '+15551230003' }, presentingInterest: 'Workplace burnout (EAP)', pipelineStageId: 'crm_stage_matched', referrerId: 'crm_ref_employer' },
  ];
  for (const l of leadDefs) {
    await prisma.lead.upsert({
      where: { id: l.id },
      update: {},
      create: {
        id: l.id, tenantId: tenant.id, source: l.source, contact: l.contact,
        presentingInterest: l.presentingInterest, pipelineStageId: l.pipelineStageId, referrerId: l.referrerId, status: 'active',
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Communications Hub (ctx 30, docs/technical/15-communications-and-telephony.md)
  // One provisioned PhoneNumber for the demo clinic, and 3 demo comms-log
  // entries (a call + an SMS + a voice MediaMessage) on the alex↔dr.rivera
  // thread, so the unified comms log renders against real rows. Idempotent
  // (fixed ids).
  // ─────────────────────────────────────────────────────────────
  const clinicPhoneNumber = await prisma.phoneNumber.upsert({
    where: { id: 'phone_demo_clinic' },
    update: {},
    create: {
      id: 'phone_demo_clinic',
      tenantId: tenant.id,
      e164: '+15551110000',
      provider: 'self_hosted',
      capabilities: ['VOICE', 'SMS'],
      assignedTo: clinic.id,
    },
  });

  const commsThreadId = `thread_${client.id}_${psyA.id}`;

  await prisma.callSession.upsert({
    where: { id: 'call_demo_1' },
    update: {},
    create: {
      id: 'call_demo_1',
      tenantId: tenant.id,
      direction: 'OUTBOUND',
      fromE164: clinicPhoneNumber.e164,
      toE164: '+15551230010',
      clientId: client.id,
      psychologistId: psyA.id,
      purpose: 'care',
      startedAt: new Date('2026-06-28T15:00:00Z'),
      endedAt: new Date('2026-06-28T15:00:45Z'),
      durationSec: 45,
      status: 'COMPLETED',
      providerRef: 'stub_call_demo',
    },
  });

  await prisma.smsMessage.upsert({
    where: { id: 'sms_demo_1' },
    update: {},
    create: {
      id: 'sms_demo_1',
      tenantId: tenant.id,
      direction: 'OUTBOUND',
      toE164: '+15551230010',
      fromE164: clinicPhoneNumber.e164,
      body: 'Your session with Dr. Rivera is tomorrow at 3pm. Reply C to confirm.',
      status: 'DELIVERED',
      clientId: client.id,
      providerRef: 'stub_sms_demo',
    },
  });

  await prisma.mediaMessage.upsert({
    where: { id: 'media_demo_1' },
    update: {},
    create: {
      id: 'media_demo_1',
      tenantId: tenant.id,
      threadId: commsThreadId,
      senderId: psyUserA.id,
      kind: 'VOICE',
      storageKey: 'demo/media/voice-check-in.webm',
      durationSec: 28,
      mimeType: 'audio/webm',
      transcript: 'Just checking in ahead of our session tomorrow — let me know if anything comes up before then.',
      deliveredAt: new Date('2026-06-29T10:00:00Z'),
    },
  });

  const commsLogDefs = [
    { id: 'engagement_comms_call_1', kind: 'CALL' as const, summary: 'Outbound call completed (45s)', occurredAt: new Date('2026-06-28T15:00:45Z') },
    { id: 'engagement_comms_sms_1', kind: 'SMS' as const, summary: 'SMS delivered: Your session with Dr. Rivera is tomorrow at 3pm...', occurredAt: new Date('2026-06-28T16:00:00Z') },
    { id: 'engagement_comms_media_1', kind: 'MEDIA_MESSAGE' as const, summary: 'Voice message (28s)', occurredAt: new Date('2026-06-29T10:00:00Z') },
  ];
  for (const e of commsLogDefs) {
    await prisma.engagementActivity.upsert({
      where: { id: e.id },
      update: {},
      create: {
        id: e.id, tenantId: tenant.id, subjectType: 'Client', subjectId: client.id,
        kind: e.kind, direction: 'OUTBOUND', summary: e.summary, actorId: psyUserA.id, occurredAt: e.occurredAt,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Messaging (ctx 14, docs/technical/13-roadmap-and-phases.md,
  // docs/technical/15-communications-and-telephony.md §6) — the first real
  // `Thread` row (previously `MediaMessage.threadId` only ever referenced
  // `commsThreadId` as an opaque string, per `02-data-model.md` §I) plus two
  // demo text messages on it: one read (client -> Dr. Rivera) and one unread
  // (Dr. Rivera -> client), so both the thread list's unread-count and the
  // paginated message view render against real rows. Idempotent (fixed ids).
  // ─────────────────────────────────────────────────────────────
  const messagingThread = await prisma.thread.upsert({
    where: { id: commsThreadId },
    update: {},
    create: {
      id: commsThreadId,
      tenantId: tenant.id,
      clientId: client.id,
    },
  });

  await prisma.message.upsert({
    where: { id: 'message_demo_1' },
    update: {},
    create: {
      id: 'message_demo_1',
      threadId: messagingThread.id,
      senderId: clientUser.id,
      body: 'Hi Dr. Rivera, quick question before our session tomorrow — is it still at 3pm?',
      readAt: new Date('2026-06-29T11:00:00Z'),
      createdAt: new Date('2026-06-29T10:30:00Z'),
    },
  });

  await prisma.message.upsert({
    where: { id: 'message_demo_2' },
    update: {},
    create: {
      id: 'message_demo_2',
      threadId: messagingThread.id,
      senderId: psyUserA.id,
      body: 'Yes, 3pm still works — see you then!',
      readAt: null,
      createdAt: new Date('2026-06-29T11:05:00Z'),
    },
  });

  const messageEngagementDefs = [
    {
      id: 'engagement_message_1',
      direction: 'INBOUND' as const,
      summary: 'Message: Hi Dr. Rivera, quick question before our session tomorrow...',
      actorId: clientUser.id,
      occurredAt: new Date('2026-06-29T10:30:00Z'),
    },
    {
      id: 'engagement_message_2',
      direction: 'OUTBOUND' as const,
      summary: 'Message: Yes, 3pm still works — see you then!',
      actorId: psyUserA.id,
      occurredAt: new Date('2026-06-29T11:05:00Z'),
    },
  ];
  for (const e of messageEngagementDefs) {
    await prisma.engagementActivity.upsert({
      where: { id: e.id },
      update: {},
      create: {
        id: e.id, tenantId: tenant.id, subjectType: 'Client', subjectId: client.id,
        // GAP (flagged, not fixed — schema out of scope this pass): `EngagementKind`
        // has no dedicated value for an in-platform text message; `EMAIL` is the
        // nearest existing analog (async, written, non-phone correspondence). See
        // the same note in MessagingService.sendMessage.
        kind: 'EMAIL', direction: e.direction, summary: e.summary, actorId: e.actorId, occurredAt: e.occurredAt,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Risk & Crisis (ctx 21) — one demo SafetyPlan on file for alex.client so
  // the Risk board's safety-plan lookup renders against a real row.
  // Idempotent (fixed id); safety plans are append-only, so re-seeding never
  // mutates this row — it would only ever gain a higher-version successor.
  // ─────────────────────────────────────────────────────────────
  await prisma.safetyPlan.upsert({
    where: { id: 'safetyplan_demo_1' },
    update: {},
    create: {
      id: 'safetyplan_demo_1',
      tenantId: tenant.id,
      clientId: client.id,
      warningSigns: ['Withdrawing from friends/family', 'Sleeping less than 4 hours', 'Skipping meals for a full day'],
      copingStrategies: ['5-minute breathing exercise', 'Call a support contact', 'Go for a walk outside'],
      supportContacts: ['Jordan Chen (sister) +1 555 010 2020'],
      professionalContacts: ['Dr. Elena Rivera (treating psychologist) +1 555 010 3030', 'Crisis line 988'],
      environmentSafety: 'No firearms in the home; medications stored with a trusted family member.',
      // Stanley-Brown SPI completeness (WAVE CR item 5) — distraction vs help
      // contacts split, structured means-restriction inventory, crisis-line
      // info, and a recorded client acknowledgment.
      distractionContacts: ['Walk the dog around the block', 'Coffee shop on 5th & Main (open until 9pm)'],
      helpContacts: ['Jordan Chen (sister) +1 555 010 2020', 'Dr. Elena Rivera (treating psychologist) +1 555 010 3030'],
      crisisLineInfo: { label: '988 Suicide & Crisis Lifeline', phone: '988', text: '988', chatUrl: 'https://988lifeline.org/chat' },
      meansRestriction: [
        { means: 'Prescription sleep medication', secured: true, how: 'Stored with sister, dispensed weekly', verifiedBy: 'Dr. Elena Rivera' },
      ],
      clientAcknowledgedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      version: 1,
    },
  });

  // ─────────────────────────────────────────────────────────────
  // Risk & Crisis (ctx 21) — WAVE CR demo data: a graduated C-SSRS-style
  // RiskFlag (docs/10-10-PROGRAM.md WAVE CR item 1) paired with an
  // Escalation whose per-severity SLA target (item 3) is already elapsed and
  // still unassigned — so the RiskSlaService sweep has a real row to breach
  // + auto-route to the least-loaded on-call psychologist on first run.
  // Idempotent (fixed ids).
  // ─────────────────────────────────────────────────────────────
  const demoRiskOpenedAt = new Date(now.getTime() - 90 * 60 * 1000); // opened 90 minutes ago
  const demoRiskFlag = await prisma.riskFlag.upsert({
    where: { id: 'riskflag_demo_cr_1' },
    update: {},
    create: {
      id: 'riskflag_demo_cr_1',
      tenantId: tenant.id,
      clientId: client.id,
      type: 'SUICIDAL_IDEATION',
      severity: 'SEVERE',
      source: 'SCREENING',
      evidence: 'Graduated C-SSRS triage: ideation level 4 (active ideation with some intent), no plan disclosed',
      evidenceDetail: {
        ideationLevel: 4,
        behaviorHistory: { priorAttempt: false, aborted: false, preparatory: false, recentSelfHarm: false },
        recentLoss: true,
        inputSource: 'graduated',
      },
      status: 'ESCALATED',
      createdAt: demoRiskOpenedAt,
    },
  });
  await prisma.escalation.upsert({
    where: { id: 'escalation_demo_sla_due' },
    update: {},
    create: {
      id: 'escalation_demo_sla_due',
      tenantId: tenant.id,
      riskFlagId: demoRiskFlag.id,
      openedAt: demoRiskOpenedAt,
      // SEVERE target is 60 minutes — opened 90 minutes ago, so this row is
      // already overdue and unassigned, exercising both RiskSlaService sweep
      // behaviors (breach + on-call auto-assign) the first time it runs.
      slaDueAt: new Date(demoRiskOpenedAt.getTime() + 60 * 60 * 1000),
    },
  });

  // ─────────────────────────────────────────────────────────────
  // Finance (ctx 24/25/26, docs/technical/13-roadmap-and-phases.md Phase 6)
  // — chart of accounts, a revenue-share contract for dr.rivera, and one
  // OPEN demo invoice for alex.client so the Finance cockpit renders against
  // real rows. Idempotent (fixed ids). Money literals are passed as decimal
  // strings — never JS numbers — matching the MONEY RULES the finance module
  // itself enforces at runtime.
  // ─────────────────────────────────────────────────────────────
  const chartOfAccounts = [
    { code: '1000', name: 'Cash', type: 'asset' },
    { code: '1100', name: 'Accounts Receivable', type: 'asset' },
    { code: '2000', name: 'Clinician Payable', type: 'liability' },
    { code: '4000', name: 'Service Revenue', type: 'revenue' },
    { code: '5000', name: 'Clinician Costs', type: 'expense' },
  ];
  for (const a of chartOfAccounts) {
    await prisma.ledgerAccount.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: a.code } },
      update: {},
      create: { tenantId: tenant.id, code: a.code, name: a.name, type: a.type },
    });
  }

  const financeContract = await prisma.contract.upsert({
    where: { id: 'contract_demo_rivera' },
    update: {},
    create: {
      id: 'contract_demo_rivera',
      tenantId: tenant.id,
      psychologistId: psyA.id,
      type: 'REVENUE_SHARE',
      currency: 'USD',
      status: 'active',
    },
  });
  await prisma.revenueShareRule.upsert({
    where: { id: 'revshare_demo_rivera' },
    update: {},
    create: {
      id: 'revshare_demo_rivera',
      tenantId: tenant.id,
      contractId: financeContract.id,
      basis: 'REVENUE',
      pct: 60,
    },
  });

  await prisma.invoice.upsert({
    where: { id: 'invoice_demo_1' },
    update: {},
    create: {
      id: 'invoice_demo_1',
      tenantId: tenant.id,
      clientId: client.id,
      lineItems: [
        { description: 'Individual therapy session — 50 min', amount: '120.0000' },
        { description: 'Intake assessment fee', amount: '60.0000' },
      ],
      amount: '180.0000',
      currency: 'USD',
      status: 'OPEN',
      dueDate: daysFromNow(14),
    },
  });

  // ─────────────────────────────────────────────────────────────
  // National Analytics (ctx 28, Phase 6) — de-identified, aggregate
  // PopulationMetric rows across 4 demo regions. No client/psychologist FK,
  // no PII: only region + metric + value + cohortSize. Two rows (US-VT) are
  // deliberately below the k-anonymity floor (5) so NationalAnalyticsService's
  // suppression is demonstrable end-to-end against seeded data, not only in
  // unit tests. Idempotent (fixed ids).
  // ─────────────────────────────────────────────────────────────
  const populationMetrics = [
    { id: 'popmetric_ny_depression', region: 'US-NY', metric: 'depression_prevalence_pct', value: 19.8, window: '2026-Q2', cohortSize: 52000 },
    { id: 'popmetric_ny_access', region: 'US-NY', metric: 'treatment_access_pct', value: 71.2, window: '2026-Q2', cohortSize: 52000 },
    { id: 'popmetric_ca_depression', region: 'US-CA', metric: 'depression_prevalence_pct', value: 21.1, window: '2026-Q2', cohortSize: 88000 },
    { id: 'popmetric_ca_utilization', region: 'US-CA', metric: 'clinician_utilization_pct', value: 64.5, window: '2026-Q2', cohortSize: 1200 },
    { id: 'popmetric_tx_improvement', region: 'US-TX', metric: 'avg_outcome_improvement_pct', value: 38.4, window: '2026-Q2', cohortSize: 15000 },
    { id: 'popmetric_tx_access', region: 'US-TX', metric: 'treatment_access_pct', value: 58.9, window: '2026-Q2', cohortSize: 15000 },
    // Below the k-anonymity floor (5) — demonstrates suppression, never real values, for a small region.
    { id: 'popmetric_vt_depression', region: 'US-VT', metric: 'depression_prevalence_pct', value: 24.0, window: '2026-Q2', cohortSize: 3 },
    { id: 'popmetric_vt_utilization', region: 'US-VT', metric: 'clinician_utilization_pct', value: 70.0, window: '2026-Q2', cohortSize: 4 },
  ];
  for (const m of populationMetrics) {
    await prisma.populationMetric.upsert({
      where: { id: m.id },
      update: {},
      create: {
        id: m.id,
        region: m.region,
        metric: m.metric,
        value: m.value,
        window: m.window,
        cohortSize: m.cohortSize,
      },
    });
  }

  console.log('✅ Seed complete. Demo login password for all accounts: Vpsy!2026');
  console.log('   Manager:', manager.email, '| Psychologists: dr.rivera@, dr.okafor@ | Client: alex.client@');
  console.log('   Demo dashboard client id (alex.client, assigned to dr.rivera):', client.id);
  console.log('   Psychometrics: classical VPSY-DEP-SCREEN-9 (version', qv.id, ', 9 original items + 3 draft es ItemTranslations) + IRT VPSY-ANX-IRT-7 (version', qvIrt.id, ', 7 GRM-calibrated items).');
  console.log('   CRM: 5 pipeline stages, 3 referrers, 3 demo leads.');
  console.log('   Communications Hub: 1 provisioned phone number, 1 demo call + 1 SMS + 1 voice media message.');
  console.log('   Scheduling: 3 open AvailabilitySlots on dr.rivera (next 3 days).');
  console.log('   Finance: 5-account chart of accounts, dr.rivera 60% revenue-share contract, 1 OPEN invoice ($180.00).');
  console.log('   National Analytics: 8 PopulationMetric rows across US-NY/US-CA/US-TX/US-VT (2 below k-anonymity floor 5).');
  console.log('   WAVE CR: Stanley-Brown-complete safety plan; 1 graduated C-SSRS SEVERE RiskFlag + SLA-overdue unassigned Escalation (auto-breach/auto-assign on first sweep).');
  console.log('   WAVE CR: 1 provisional Formulation (F41.1) on alex.client; note_demo_signed is golden-thread-anchored (plan+2 goals); note_demo_draft is a documented amendment.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
