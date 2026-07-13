import { BadRequestException } from '@nestjs/common';
import { validateSafetyConfiguration, validateStaticResponses } from './response-validation';

const items = [
  {
    id: 'item_1',
    linkId: 'q1',
    responseOptions: [
      { label: 'Never', value: 0 },
      { label: 'Sometimes', value: 1 },
      { label: 'Often', value: 2 },
    ],
  },
  { id: 'item_2', linkId: 'q2', responseOptions: ['Never', 'Sometimes', 'Often'] },
];

describe('static psychometric response validation', () => {
  it('accepts exactly one allowed response for every active item', () => {
    expect(() => validateStaticResponses(items, { q1: 2, q2: 1 })).not.toThrow();
  });

  it('rejects responses for items outside the published version', () => {
    expect(() => validateStaticResponses(items, { q1: 1, q2: 1, q999: 1 })).toThrow(/unknown item/i);
  });

  it('rejects incomplete static administrations', () => {
    expect(() => validateStaticResponses(items, { q1: 1 })).toThrow(/incomplete.*q2/i);
  });

  it('rejects numeric values outside the item response options', () => {
    expect(() => validateStaticResponses(items, { q1: 3, q2: 1 })).toThrow(/not an allowed option/i);
  });

  it('rejects malformed and duplicate option definitions instead of guessing', () => {
    expect(() =>
      validateStaticResponses([{ id: 'bad', responseOptions: [{ label: 'missing value' }] }], { bad: 0 }),
    ).toThrow(/malformed response options/i);
    expect(() =>
      validateStaticResponses([{ id: 'dup', responseOptions: [0, 0] }], { dup: 0 }),
    ).toThrow(/duplicate response option/i);
  });
});

describe('psychometric safety configuration validation', () => {
  it('accepts an explicit empty safetyItems array for an instrument reviewed as having no safety item', () => {
    expect(() => validateSafetyConfiguration({ bands: [], safetyItems: [] }, items)).not.toThrow();
  });

  it('accepts a valid safety hook referencing an active item', () => {
    expect(() =>
      validateSafetyConfiguration(
        { safetyItems: [{ itemId: 'q2', minAnswer: 1, category: 'suicidal_ideation' }] },
        items,
      ),
    ).not.toThrow();
  });

  it.each([
    [{ bands: [] }, /safety-item configuration/i],
    [{ safetyItems: 'none' }, /safety-item configuration/i],
    [{ safetyItems: [{ itemId: 'q2', minAnswer: 1, category: 'not_a_risk_type' }] }, /safety-item configuration/i],
    [{ safetyItems: [{ itemId: 'missing', minAnswer: 1, category: 'self_harm' }] }, /not an active/i],
    [{ safetyItems: [{ itemId: 'q2', minAnswer: 99, category: 'self_harm' }] }, /outside.*range/i],
  ])('fails closed for missing or malformed safety configuration %#', (configuration, message) => {
    expect(() => validateSafetyConfiguration(configuration, items)).toThrow(message as RegExp);
  });

  it('rejects duplicate safety hooks for the same item', () => {
    expect(() =>
      validateSafetyConfiguration(
        {
          safetyItems: [
            { itemId: 'q2', minAnswer: 1, category: 'self_harm' },
            { itemId: 'q2', minAnswer: 2, category: 'suicidal_ideation' },
          ],
        },
        items,
      ),
    ).toThrow(BadRequestException);
  });
});
