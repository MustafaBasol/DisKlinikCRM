/**
 * money.ts — bounded, deterministic money summation for Float-backed schema fields.
 *
 * TreatmentPlanProcedure.estimatedCost (and sibling monetary fields across the
 * schema) are stored as Prisma Float, not Decimal, and no shared rounding
 * helper exists yet. Summing raw floats can accumulate drift (0.1 + 0.2 !==
 * 0.3). This rounds each amount to minor units (cents) before summing as
 * integers, then converts back — deterministic regardless of summation order.
 * Scope is intentionally narrow: this does not change how estimatedCost/
 * estimatedAmount are stored or displayed anywhere else in the app.
 *
 * Assumption: rounds to 2-decimal minor units (cents) for every currency, matching this
 * app's currently-supported currencies (TRY/USD/EUR/GBP/CAD/CHF, see clinicOperatingPreferences.ts
 * currencySchema — all 2-decimal). Zero-decimal (e.g. JPY) or three-decimal (e.g. KWD)
 * currencies are out of scope for this helper.
 */

/**
 * Converts a single finite amount to signed integer minor units (cents), rounding the
 * third decimal half-up. `Math.round(amount * 100)` is NOT used here: binary floating-point
 * multiplication can shift a value like 1.005 to 100.49999999999999 before rounding, which
 * rounds DOWN to 100 (1.00) instead of the intended 101 (1.01). `toFixed(6)` instead asks the
 * engine for its spec-correct, correctly-rounded decimal string of the double — doubles carry
 * ~15-17 significant decimal digits, so 6 fractional digits reliably reconstructs the original
 * literal's true third-decimal digit for realistic currency magnitudes without drifting into
 * the double's own imprecise tail. Concatenating the whole and first-two-fraction digits into
 * one integer string (rather than rounding the fraction and re-adding it to the whole part)
 * lets a carry — e.g. 99.999 -> 9999 + 1 -> 10000 — resolve via plain integer addition, with
 * no separate cents-overflow branch needed.
 */
function toCanonicalMinorUnits(amount: number): number {
  const sign = amount < 0 ? -1 : 1;
  const [wholePart, fractionPart = ''] = Math.abs(amount).toFixed(6).split('.');
  const centsDigits = fractionPart.slice(0, 2).padEnd(2, '0');
  const roundUp = Number(fractionPart.charAt(2) || '0') >= 5;
  const minorUnits = BigInt(wholePart + centsDigits) + (roundUp ? 1n : 0n);
  return sign * Number(minorUnits);
}

export function sumMoney(amounts: Array<number | null | undefined>): number {
  const totalMinorUnits = amounts.reduce<number>((sum, amount) => {
    if (amount === null || amount === undefined || !Number.isFinite(amount)) return sum;
    return sum + toCanonicalMinorUnits(amount);
  }, 0);
  return totalMinorUnits / 100;
}
