import { SetMetadata } from '@nestjs/common';

export const CLINICAL_ACCESS_KEY = 'vpsy:clinical-access';

export type ClinicalResourceKind =
  | 'client'
  | 'session'
  | 'note'
  | 'goal'
  | 'hypothesis'
  | 'formulation'
  | 'intervention'
  | 'homework'
  | 'riskFlag'
  | 'escalation'
  | 'document'
  | 'wearableDevice';

export interface ClinicalAccessRule {
  resource: ClinicalResourceKind;
  source: 'body' | 'params';
  key: string;
}

/** Declares how an endpoint resolves the client whose PHI it touches. */
export const RequireClinicalAccess = (rule: ClinicalAccessRule) => SetMetadata(CLINICAL_ACCESS_KEY, rule);
