/**
 * Decimal-string -> PSP minor-units conversion (Wave E, Payments/Stripe).
 *
 * MONEY RULE (see accounting.service.ts): every amount in this codebase is a
 * `Prisma.Decimal`, serialized to the wire as a decimal STRING
 * (`amount.toFixed(4)`) — never a JS float. Stripe (and every card-network
 * PSP) instead wants an INTEGER count of the currency's smallest unit (e.g.
 * cents for USD). Converting via `Math.round(parseFloat(x) * 100)` would
 * reintroduce exactly the IEEE-754 drift this codebase works so hard to
 * avoid elsewhere (see payments.service.spec.ts's 60.10 + 59.95 + 59.95
 * comment) — so this conversion is pure string/BigInt arithmetic, never a
 * float multiply.
 *
 * `currency` determines how many fractional digits the PSP expects ("the
 * exponent"): most currencies use 2 (cents), a documented minority use 0
 * (already integral, e.g. JPY) or 3 (e.g. BHD). If the Decimal string carries
 * MORE precision than the PSP's exponent can represent (e.g. "12.341" for a
 * 2-decimal currency), we do not silently round — silently rounding could
 * make a captured PSP charge disagree with the ledger by fractions of a
 * cent. We reject instead.
 */

/** ISO-4217 currencies with no minor unit (Stripe's "zero-decimal currencies"). */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/** ISO-4217 currencies whose minor unit is 3 digits (Stripe's "three-decimal currencies"). */
const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

/** Number of fractional digits the PSP expects for `currency`'s minor unit. */
export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

const DECIMAL_STRING = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Converts an exact decimal string (as produced by `Prisma.Decimal#toFixed`)
 * into the integer minor-units amount a PSP expects, e.g. `"180.0000"` USD
 * -> `18000`, `"59.95"` USD -> `5995`, `"500"` JPY -> `500`.
 *
 * Throws if `amount` is not a plain decimal string, or if it carries a
 * non-zero remainder past `currency`'s exponent (e.g. `"12.341"` for a
 * 2-decimal currency) — that amount cannot be represented exactly in the
 * PSP's minor unit, so we refuse to guess rather than silently rounding.
 */
export function decimalStringToMinorUnits(amount: string, currency: string): number {
  const match = DECIMAL_STRING.exec(amount.trim());
  if (!match) {
    throw new Error(`decimalStringToMinorUnits: "${amount}" is not a plain decimal string`);
  }
  const [, sign, intPart, fracPart = ''] = match;
  const exponent = currencyExponent(currency);

  const kept = fracPart.slice(0, exponent).padEnd(exponent, '0');
  const remainder = fracPart.slice(exponent);
  if (/[1-9]/.test(remainder)) {
    throw new Error(
      `decimalStringToMinorUnits: "${amount}" has sub-minor-unit precision that ` +
        `"${currency.toUpperCase()}" (exponent ${exponent}) cannot represent exactly`,
    );
  }

  const minorUnitsDigits = `${intPart}${kept}`.replace(/^0+(?=\d)/, '');
  const minorUnits = BigInt(minorUnitsDigits === '' ? '0' : minorUnitsDigits);
  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`decimalStringToMinorUnits: "${amount}" is too large to convert safely`);
  }

  const value = Number(minorUnits);
  return sign === '-' ? -value : value;
}
