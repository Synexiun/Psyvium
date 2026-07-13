/**
 * Clinical coding helpers — format-level validation for ICD-10-CM / DSM-style
 * codes. This is NOT a licensed terminology server (no UMLS/SNOMED content).
 * It prevents garbage codes while remaining honest about lacking full
 * code-set governance.
 */

export type CodingSystem = 'ICD-10-CM' | 'ICD-11' | 'DSM-5-TR' | 'SNOMED-CT' | 'LOCAL';

export interface CodingValidation {
  valid: boolean;
  system: CodingSystem;
  normalized: string;
  /** Human-readable reason when invalid. */
  reason?: string;
  /** Assistive only — never a diagnosis. */
  disclaimer: string;
}

const DISCLAIMER =
  'Code format check only — not a diagnosis and not a complete terminology validation. Clinician confirms all coded formulations.';

/** ICD-10-CM: letter + 2 digits, optional decimal + 1–4 alphanumerics (e.g. F32.1, F41.1). */
const ICD10_CM = /^[A-TV-Z][0-9][0-9AB](?:\.[0-9A-TV-Z]{1,4})?$/i;

/** Loose ICD-11 (e.g. 6A70). */
const ICD11 = /^[0-9A-Z]{2,4}(?:\.[0-9A-Z]{1,4})?$/i;

export function validateClinicalCode(
  raw: string,
  preferred: CodingSystem = 'ICD-10-CM',
): CodingValidation {
  const normalized = raw.trim().toUpperCase();
  if (normalized.length < 2 || normalized.length > 20) {
    return {
      valid: false,
      system: preferred,
      normalized,
      reason: 'Code length must be 2–20 characters',
      disclaimer: DISCLAIMER,
    };
  }

  if (preferred === 'ICD-10-CM' || preferred === 'DSM-5-TR') {
    if (ICD10_CM.test(normalized)) {
      return { valid: true, system: 'ICD-10-CM', normalized, disclaimer: DISCLAIMER };
    }
    return {
      valid: false,
      system: preferred,
      normalized,
      reason: 'Does not match ICD-10-CM pattern (e.g. F32.1, F41.1)',
      disclaimer: DISCLAIMER,
    };
  }

  if (preferred === 'ICD-11') {
    if (ICD11.test(normalized)) {
      return { valid: true, system: 'ICD-11', normalized, disclaimer: DISCLAIMER };
    }
    return {
      valid: false,
      system: 'ICD-11',
      normalized,
      reason: 'Does not match ICD-11 pattern',
      disclaimer: DISCLAIMER,
    };
  }

  // LOCAL / SNOMED: accept non-empty structured tokens
  if (/^[A-Z0-9][A-Z0-9._-]{1,31}$/i.test(normalized)) {
    return { valid: true, system: preferred, normalized, disclaimer: DISCLAIMER };
  }
  return {
    valid: false,
    system: preferred,
    normalized,
    reason: 'Invalid local/SNOMED-style token',
    disclaimer: DISCLAIMER,
  };
}
