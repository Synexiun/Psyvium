import { currencyExponent, decimalStringToMinorUnits } from './minor-units';

/**
 * Money correctness is the bar for Wave E (Stripe adapter): the Decimal-string
 * -> PSP-minor-units conversion must be exact — no float multiply anywhere in
 * the path — and must refuse (not silently round) an amount that carries more
 * precision than the target currency's minor unit can represent.
 */
describe('decimalStringToMinorUnits', () => {
  it.each([
    ['180.0000', 'USD', 18000],
    ['59.95', 'USD', 5995],
    ['59.9500', 'USD', 5995],
    ['0.05', 'USD', 5],
    ['100', 'USD', 10000],
    ['12.34', 'usd', 1234], // lower-case currency code
    ['0', 'USD', 0],
  ])('converts %s %s -> %i minor units', (amount, currency, expected) => {
    expect(decimalStringToMinorUnits(amount, currency)).toBe(expected);
  });

  it('handles zero-decimal currencies (e.g. JPY) with no fractional minor unit', () => {
    expect(decimalStringToMinorUnits('500', 'JPY')).toBe(500);
    expect(decimalStringToMinorUnits('500.0000', 'JPY')).toBe(500);
  });

  it('handles three-decimal currencies (e.g. BHD)', () => {
    expect(decimalStringToMinorUnits('1.234', 'BHD')).toBe(1234);
    expect(decimalStringToMinorUnits('1.2340', 'BHD')).toBe(1234);
  });

  it('rejects a 2-decimal-currency amount with a non-zero sub-cent remainder', () => {
    expect(() => decimalStringToMinorUnits('12.341', 'USD')).toThrow(/sub-minor-unit precision/);
    expect(() => decimalStringToMinorUnits('59.9501', 'USD')).toThrow(/sub-minor-unit precision/);
  });

  it('rejects a zero-decimal-currency amount with any fractional remainder', () => {
    expect(() => decimalStringToMinorUnits('500.50', 'JPY')).toThrow(/sub-minor-unit precision/);
  });

  it('accepts a trailing-zero remainder past the exponent (no real precision loss)', () => {
    expect(decimalStringToMinorUnits('180.0000', 'USD')).toBe(18000);
  });

  it('rejects a non-decimal-string amount', () => {
    expect(() => decimalStringToMinorUnits('abc', 'USD')).toThrow(/not a plain decimal string/);
    expect(() => decimalStringToMinorUnits('12.34.5', 'USD')).toThrow(/not a plain decimal string/);
  });

  it('preserves sign', () => {
    expect(decimalStringToMinorUnits('-10.00', 'USD')).toBe(-1000);
  });
});

describe('currencyExponent', () => {
  it('defaults to 2 for common currencies', () => {
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('EUR')).toBe(2);
  });

  it('is 0 for zero-decimal currencies', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KRW')).toBe(0);
  });

  it('is 3 for three-decimal currencies', () => {
    expect(currencyExponent('BHD')).toBe(3);
    expect(currencyExponent('KWD')).toBe(3);
  });
});
