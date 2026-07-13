import { BadRequestException } from '@nestjs/common';
import { RiskType } from '@vpsy/contracts';
import { z } from 'zod';

export interface ResponseItemDefinition {
  id: string;
  linkId?: string | null;
  responseOptions: unknown;
}

const safetyItemSchema = z.object({
  itemId: z.string().min(1),
  minAnswer: z.number().finite(),
  category: z.preprocess(
    (value) => (typeof value === 'string' ? value.toUpperCase() : value),
    z.nativeEnum(RiskType),
  ),
});

const requiredSafetyConfigurationSchema = z
  .object({
    // An explicit empty array means the published instrument was reviewed and
    // contains no safety item. An absent property is ambiguous and fails shut.
    safetyItems: z.array(safetyItemSchema),
  })
  .passthrough();

/**
 * Validates a static (batch) administration against the immutable active item
 * set. The accepted answer keys and values are always derived server-side.
 */
export function validateStaticResponses(
  items: ResponseItemDefinition[],
  answers: Record<string, number>,
): void {
  if (items.length === 0) {
    throw new BadRequestException('Questionnaire version has no active items');
  }

  const allowedByKey = buildAllowedValues(items);
  const submittedKeys = Object.keys(answers);
  const unknownKeys = submittedKeys.filter((key) => !allowedByKey.has(key));
  if (unknownKeys.length > 0) {
    throw new BadRequestException(`Assessment contains unknown item responses: ${unknownKeys.join(', ')}`);
  }

  const missingKeys = [...allowedByKey.keys()].filter((key) => !Object.prototype.hasOwnProperty.call(answers, key));
  if (missingKeys.length > 0) {
    throw new BadRequestException(`Assessment is incomplete; missing responses: ${missingKeys.join(', ')}`);
  }

  for (const [key, answer] of Object.entries(answers)) {
    const allowed = allowedByKey.get(key)!;
    if (!Number.isFinite(answer) || !allowed.includes(answer)) {
      throw new BadRequestException(
        `Response for item ${key} is not an allowed option (${allowed.join(', ')})`,
      );
    }
  }
}

/**
 * Requires a deliberate safety configuration on every published version and
 * verifies each hook points at an active item with a reachable threshold.
 */
export function validateSafetyConfiguration(raw: unknown, items: ResponseItemDefinition[]): void {
  const parsed = requiredSafetyConfigurationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException(
      'Questionnaire version has no valid safety-item configuration; publish an explicit safetyItems array',
    );
  }

  const allowedByKey = buildAllowedValues(items);
  const seen = new Set<string>();
  for (const safetyItem of parsed.data.safetyItems) {
    if (seen.has(safetyItem.itemId)) {
      throw new BadRequestException(`Duplicate safety-item configuration for ${safetyItem.itemId}`);
    }
    seen.add(safetyItem.itemId);

    const allowed = allowedByKey.get(safetyItem.itemId);
    if (!allowed) {
      throw new BadRequestException(`Safety item ${safetyItem.itemId} is not an active questionnaire item`);
    }
    const minimum = Math.min(...allowed);
    const maximum = Math.max(...allowed);
    if (safetyItem.minAnswer < minimum || safetyItem.minAnswer > maximum) {
      throw new BadRequestException(
        `Safety threshold for ${safetyItem.itemId} is outside its allowed response range`,
      );
    }
  }
}

function buildAllowedValues(items: ResponseItemDefinition[]): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const item of items) {
    const key = item.linkId?.trim() || item.id;
    if (result.has(key)) {
      throw new BadRequestException(`Questionnaire contains duplicate response key ${key}`);
    }
    result.set(key, responseOptionValues(key, item.responseOptions));
  }
  return result;
}

function responseOptionValues(itemKey: string, raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BadRequestException(`Item ${itemKey} has no valid response options`);
  }

  let values: number[];
  if (raw.every((option) => typeof option === 'string')) {
    values = raw.map((_, index) => index);
  } else if (raw.every((option) => typeof option === 'number' && Number.isFinite(option))) {
    values = raw as number[];
  } else if (
    raw.every(
      (option) =>
        option !== null &&
        typeof option === 'object' &&
        typeof (option as { value?: unknown }).value === 'number' &&
        Number.isFinite((option as { value: number }).value),
    )
  ) {
    values = raw.map((option) => (option as { value: number }).value);
  } else {
    throw new BadRequestException(`Item ${itemKey} has malformed response options`);
  }

  if (new Set(values).size !== values.length) {
    throw new BadRequestException(`Item ${itemKey} has duplicate response option values`);
  }
  return values;
}
