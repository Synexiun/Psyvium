/**
 * Answer-key convention (doc 07 §9) — shared by the take-form and the
 * clinician results view so both sides read an item's options identically.
 *
 * `responseOptions` is served as an array of `{ label, value }` objects (the
 * seed instrument pack stores them this way). The LABEL is what the person
 * reads; the VALUE is what is recorded — never the array index, because
 * several instruments are reverse-keyed or use 0/2/4 anchors (index ≠ value).
 *
 * Defensive fallback: if options ever arrive as a plain `string[]` (older
 * banks), fall back to index-as-value — the same convention the CAT flow uses.
 * Anything else is treated as "no renderable options" so the UI can be honest
 * about it instead of guessing.
 */
export interface AnswerOption {
  label: string;
  value: number;
}

export function normalizeOptions(raw: unknown): AnswerOption[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (raw.every((o) => typeof o === 'string')) {
    return (raw as string[]).map((label, i) => ({ label, value: i }));
  }
  const out: AnswerOption[] = [];
  for (const o of raw) {
    if (
      o !== null &&
      typeof o === 'object' &&
      typeof (o as { label?: unknown }).label === 'string' &&
      typeof (o as { value?: unknown }).value === 'number'
    ) {
      out.push({ label: (o as { label: string }).label, value: (o as { value: number }).value });
    }
  }
  return out;
}
