/**
 * Central PolicyEngine skeleton (docs/technical/06-security-and-rbac.md §4.4).
 *
 * Pure function — no I/O — so every ABAC decision is deterministic, unit-testable,
 * and explainable. RBAC still decides *capability* at the guard layer; this engine
 * evaluates *this-instance* predicates and returns obligations the caller must apply.
 *
 * Full attribute wiring (live consent lookup, device trust signals, residency maps)
 * is intentionally out of scope for this skeleton: callers pass resolved attributes
 * in. ClinicalAccessService remains the production enforcement path; this module is
 * the documented pure-function core to grow into.
 */

export type PolicyPurpose = 'care' | 'billing' | 'safety' | 'research' | 'ops';
export type ConsentState = 'active' | 'missing' | 'revoked' | 'not_required';
export type DeviceTrust = 'trusted' | 'untrusted' | 'unknown';
export type Relationship =
  | 'self'
  | 'assigned'
  | 'supervisor'
  | 'manager'
  | 'break_glass'
  | 'none';

export type PolicyObligation =
  | 'audit.mandatory'
  | 'audit.high_severity'
  | 'redact.ssn'
  | 'watermark.export'
  | 'emit.break_glass_alert'
  | 'require.mfa'
  | 'limit.minimum_necessary';

export interface PolicyContext {
  /** Resource tenant — hard isolation boundary. */
  resourceTenantId: string;
  /** Subject (caller) tenant from the JWT. */
  subjectTenantId: string;
  purpose: PolicyPurpose;
  consentState?: ConsentState;
  emergencyOverride?: boolean;
  deviceTrust?: DeviceTrust;
  /** ISO country/region codes; mismatch requires cross-border consent. */
  dataResidency?: { subject: string; resource: string; crossBorderConsent?: boolean };
  relationship?: Relationship;
  sensitivity?: 'normal' | 'restricted' | 'highly_restricted';
  mfaSatisfied?: boolean;
}

export interface PolicyDecision {
  allow: boolean;
  matchedRule: string;
  obligations: PolicyObligation[];
  reason?: string;
}

/**
 * Evaluate ABAC predicates. Order matters: hard denies first, then override
 * paths, then relationship + consent, then soft obligations on allow.
 */
export function evaluatePolicy(ctx: PolicyContext): PolicyDecision {
  if (ctx.resourceTenantId !== ctx.subjectTenantId) {
    return {
      allow: false,
      matchedRule: 'tenant.isolation',
      obligations: ['audit.mandatory'],
      reason: 'Cross-tenant access is never permitted',
    };
  }

  if (ctx.emergencyOverride) {
    return {
      allow: true,
      matchedRule: 'emergency.break_glass',
      obligations: [
        'audit.high_severity',
        'emit.break_glass_alert',
        'limit.minimum_necessary',
      ],
      reason: 'Time-boxed emergency override',
    };
  }

  if (ctx.deviceTrust === 'untrusted') {
    return {
      allow: false,
      matchedRule: 'device.untrusted',
      obligations: ['audit.mandatory', 'require.mfa'],
      reason: 'Untrusted device cannot access clinical resources',
    };
  }

  if (
    ctx.dataResidency &&
    ctx.dataResidency.subject !== ctx.dataResidency.resource &&
    !ctx.dataResidency.crossBorderConsent
  ) {
    return {
      allow: false,
      matchedRule: 'residency.cross_border',
      obligations: ['audit.mandatory'],
      reason: 'Cross-border access requires explicit consent',
    };
  }

  const relationship = ctx.relationship ?? 'none';
  if (relationship === 'none') {
    return {
      allow: false,
      matchedRule: 'relationship.missing',
      obligations: ['audit.mandatory'],
      reason: 'No care relationship to the resource',
    };
  }

  if (
    ctx.purpose !== 'safety' &&
    ctx.consentState &&
    (ctx.consentState === 'missing' || ctx.consentState === 'revoked')
  ) {
    return {
      allow: false,
      matchedRule: 'consent.required',
      obligations: ['audit.mandatory'],
      reason: `Consent is ${ctx.consentState} for purpose ${ctx.purpose}`,
    };
  }

  if (ctx.mfaSatisfied === false && relationship !== 'self') {
    return {
      allow: false,
      matchedRule: 'mfa.required',
      obligations: ['require.mfa', 'audit.mandatory'],
      reason: 'Clinical staff must complete MFA before PHI access',
    };
  }

  const obligations: PolicyObligation[] = ['audit.mandatory', 'limit.minimum_necessary'];
  if (ctx.sensitivity === 'highly_restricted') {
    obligations.push('redact.ssn');
  }
  if (ctx.purpose === 'research' || ctx.purpose === 'ops') {
    obligations.push('watermark.export');
  }
  if (relationship === 'break_glass') {
    obligations.push('audit.high_severity', 'emit.break_glass_alert');
  }

  return {
    allow: true,
    matchedRule: `relationship.${relationship}`,
    obligations,
  };
}
