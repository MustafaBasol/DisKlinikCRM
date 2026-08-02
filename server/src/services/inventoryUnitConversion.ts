/**
 * inventoryUnitConversion.ts — US-05.2 purchase-unit <-> consumption-unit
 * conversion math (koli <-> adet). Pure, DB-free helpers so the conversion
 * and validation rules can be exercised without a live Postgres instance
 * (see server/src/tests/inventoryUnitConversion.test.ts).
 *
 * Canonical invariant: InventoryItem.currentStock is always stored in the
 * consumption/base unit. These helpers only ever compute the base-unit
 * equivalent of an entered quantity — they never mutate stock themselves.
 */

export type InventoryUnitRole = 'purchase' | 'consumption' | 'legacy';

export class InventoryUnitConversionError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'InventoryUnitConversionError';
    this.code = code;
  }
}

export function isValidConversionFactor(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Resolves which role (purchase/consumption) the given unitId plays for this
 * item. Returns 'legacy' when no unitId was supplied and the item has no
 * purchase/consumption unit configured (pre-conversion-model item, quantity
 * is interpreted 1:1 exactly as before this feature existed).
 *
 * Throws INVENTORY_UNIT_NOT_ASSIGNED when a unitId is supplied that matches
 * neither the item's purchaseUnitId nor its consumptionUnitId.
 */
export function resolveUnitRole(
  item: { purchaseUnitId: string | null; consumptionUnitId: string | null },
  unitId: string | null | undefined,
): InventoryUnitRole {
  if (!unitId) return 'legacy';
  if (item.purchaseUnitId && unitId === item.purchaseUnitId) return 'purchase';
  if (item.consumptionUnitId && unitId === item.consumptionUnitId) return 'consumption';
  throw new InventoryUnitConversionError(
    'INVENTORY_UNIT_NOT_ASSIGNED',
    'unitId must match the item\'s configured purchase or consumption unit',
  );
}

/**
 * quantityInBaseUnit = entered quantity x conversionFactor for a purchase-unit
 * entry (e.g. 3 Koli x 100 = 300 Adet); 1:1 for consumption-unit/legacy entries.
 */
export function computeQuantityInBaseUnit(params: {
  quantity: number;
  role: InventoryUnitRole;
  conversionFactor: number | null;
}): number {
  const { quantity, role, conversionFactor } = params;

  if (role === 'purchase') {
    if (!isValidConversionFactor(conversionFactor)) {
      throw new InventoryUnitConversionError(
        'INVENTORY_CONVERSION_FACTOR_MISSING',
        'Item has no valid conversionFactor configured for its purchase unit',
      );
    }
    return quantity * conversionFactor;
  }

  return quantity;
}

/**
 * True when changing conversionFactor to `nextConversionFactor` would
 * reinterpret history: the item already has a factor AND at least one
 * transaction was normalized against it (quantityInBaseUnit computed via a
 * purchase-unit entry). Setting a factor for the first time is always safe
 * — no prior transaction could have been computed with it.
 */
export function isConversionFactorChangeBlocked(params: {
  currentConversionFactor: number | null;
  nextConversionFactor: number | null | undefined;
  hasNormalizedPurchaseTransactions: boolean;
}): boolean {
  const { currentConversionFactor, nextConversionFactor, hasNormalizedPurchaseTransactions } = params;
  if (nextConversionFactor === undefined) return false;
  if (currentConversionFactor === null) return false;
  if (nextConversionFactor === currentConversionFactor) return false;
  return hasNormalizedPurchaseTransactions;
}

/**
 * A unit-conversion-aware item must define all three fields together, or
 * none of them (partial configuration is rejected — it would leave
 * conversionFactor ambiguous relative to a missing unit, or a unit without
 * a factor to normalize against).
 */
export function isCoherentUnitConfiguration(params: {
  purchaseUnitId: string | null | undefined;
  consumptionUnitId: string | null | undefined;
  conversionFactor: number | null | undefined;
}): boolean {
  const values = [params.purchaseUnitId, params.consumptionUnitId, params.conversionFactor];
  const definedCount = values.filter((v) => v !== null && v !== undefined).length;
  return definedCount === 0 || definedCount === 3;
}
