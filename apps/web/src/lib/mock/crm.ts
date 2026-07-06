/**
 * ── DEMO MOCK DATA ─────────────────────────────────────────────────────────
 * Typed local fixtures for the CRM board (/crm). Used only when the live API
 * is unreachable so the screen never breaks. Everything here is fabricated;
 * shapes mirror src/lib/crm-types.ts exactly.
 * ───────────────────────────────────────────────────────────────────────────
 */
import type { CrmBoardDto, EngagementDto } from '../crm-types';

function daysAgo(days: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export const MOCK_CRM_BOARD: CrmBoardDto = {
  stages: [
    { id: 'stage_new', name: 'New', order: 1, isWon: false, isLost: false },
    { id: 'stage_contacted', name: 'Contacted', order: 2, isWon: false, isLost: false },
    { id: 'stage_qualified', name: 'Qualified', order: 3, isWon: false, isLost: false },
    { id: 'stage_intake', name: 'Intake scheduled', order: 4, isWon: false, isLost: false },
    { id: 'stage_converted', name: 'Converted', order: 5, isWon: true, isLost: false },
    { id: 'stage_lost', name: 'Lost', order: 6, isWon: false, isLost: true },
  ],
  leadsByStage: {
    stage_new: [
      {
        id: 'lead_demo_01',
        source: 'WEB',
        contact: { name: 'Maya R.', email: 'maya@example.com' },
        presentingInterest: 'Anxiety support for a teenager',
        pipelineStageId: 'stage_new',
        pipelineStageName: 'New',
        status: 'active',
        createdAt: daysAgo(1),
      },
      {
        id: 'lead_demo_02',
        source: 'CAMPAIGN',
        contact: { name: 'Daniel K.', phone: '+15550142' },
        presentingInterest: 'Sleep problems, work stress',
        pipelineStageId: 'stage_new',
        pipelineStageName: 'New',
        status: 'active',
        createdAt: daysAgo(2, 15),
      },
    ],
    stage_contacted: [
      {
        id: 'lead_demo_03',
        source: 'REFERRAL',
        contact: { name: 'Sofia L.', email: 'sofia@example.com', phone: '+15550178' },
        presentingInterest: 'Couples counseling',
        pipelineStageId: 'stage_contacted',
        pipelineStageName: 'Contacted',
        status: 'active',
        referrerId: 'ref_demo_doctor',
        createdAt: daysAgo(4),
      },
    ],
    stage_qualified: [
      {
        id: 'lead_demo_04',
        source: 'INSTITUTION',
        contact: { name: 'Omar B.', email: 'omar@example.com' },
        presentingInterest: 'EAP referral — burnout',
        pipelineStageId: 'stage_qualified',
        pipelineStageName: 'Qualified',
        status: 'active',
        referrerId: 'ref_demo_employer',
        createdAt: daysAgo(6, 9),
      },
      {
        id: 'lead_demo_05',
        source: 'REFERRAL',
        contact: { name: 'Elena P.', phone: '+15550190' },
        presentingInterest: 'School counselor referral for a minor',
        pipelineStageId: 'stage_qualified',
        pipelineStageName: 'Qualified',
        status: 'active',
        referrerId: 'ref_demo_school',
        createdAt: daysAgo(8, 13),
      },
    ],
    stage_intake: [
      {
        id: 'lead_demo_06',
        source: 'WEB',
        contact: { name: 'Jonas T.', email: 'jonas@example.com' },
        presentingInterest: 'Panic episodes',
        pipelineStageId: 'stage_intake',
        pipelineStageName: 'Intake scheduled',
        status: 'active',
        createdAt: daysAgo(10),
      },
    ],
    stage_converted: [
      {
        id: 'lead_demo_07',
        source: 'REFERRAL',
        contact: { name: 'Priya S.', email: 'priya@example.com' },
        presentingInterest: 'Court-ordered assessment',
        pipelineStageId: 'stage_converted',
        pipelineStageName: 'Converted',
        status: 'converted',
        referrerId: 'ref_demo_court',
        createdAt: daysAgo(16),
      },
    ],
    stage_lost: [
      {
        id: 'lead_demo_08',
        source: 'CAMPAIGN',
        contact: { name: 'Alex W.' },
        pipelineStageId: 'stage_lost',
        pipelineStageName: 'Lost',
        status: 'lost',
        createdAt: daysAgo(20, 17),
      },
    ],
  },
  referrers: [
    {
      id: 'ref_demo_doctor',
      type: 'DOCTOR',
      organizationName: 'Northside Family Medicine',
      contact: { name: 'Dr. H. Aymes', email: 'referrals@northsidefm.example' },
      referralSharePct: 8,
      active: true,
    },
    {
      id: 'ref_demo_school',
      type: 'SCHOOL',
      organizationName: 'Riverview High School',
      contact: { name: 'C. Ito (counselor)' },
      referralSharePct: 0,
      active: true,
    },
    {
      id: 'ref_demo_employer',
      type: 'EMPLOYER',
      organizationName: 'Vantek Systems — EAP',
      contact: { email: 'eap@vantek.example', phone: '+15550111' },
      referralSharePct: 10,
      active: true,
    },
    {
      id: 'ref_demo_court',
      type: 'COURT',
      organizationName: 'District Court, 4th Circuit',
      contact: { name: 'Clerk of Court' },
      referralSharePct: 0,
      active: false,
    },
  ],
};

/** Demo engagement timelines, keyed by lead id (absent id → empty timeline). */
export const MOCK_CRM_TIMELINES: Record<string, EngagementDto[]> = {
  lead_demo_03: [
    {
      id: 'eng_demo_01',
      subjectType: 'LEAD',
      subjectId: 'lead_demo_03',
      kind: 'CALL',
      direction: 'OUTBOUND',
      summary: 'Intro call — interested, prefers evening sessions.',
      occurredAt: daysAgo(3, 16),
    },
    {
      id: 'eng_demo_02',
      subjectType: 'LEAD',
      subjectId: 'lead_demo_03',
      kind: 'EMAIL',
      direction: 'INBOUND',
      summary: 'Asked about couples-session pricing.',
      occurredAt: daysAgo(2, 11),
    },
  ],
  lead_demo_04: [
    {
      id: 'eng_demo_03',
      subjectType: 'LEAD',
      subjectId: 'lead_demo_04',
      kind: 'NOTE',
      direction: 'OUTBOUND',
      summary: 'EAP cap: 8 sessions. Aggregate-only reporting back.',
      occurredAt: daysAgo(5, 14),
    },
  ],
};
