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
export function sumMoney(amounts: Array<number | null | undefined>): number {
  const totalMinorUnits = amounts.reduce<number>((sum, amount) => {
    if (amount === null || amount === undefined || !Number.isFinite(amount)) return sum;
    return sum + Math.round(amount * 100);
  }, 0);
  return totalMinorUnits / 100;
}
