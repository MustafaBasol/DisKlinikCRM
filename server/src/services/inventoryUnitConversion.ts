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
 * Entered-quantity validity gate for transactions: finite and strictly
 * positive. Replaces a bare `isNaN()` check, which lets Infinity/-Infinity
 * through — those would otherwise reach computeQuantityInBaseUnit's
 * multiplication and, for a purchase-unit entry, could overflow to a
 * non-finite quantityInBaseUnit.
 */
export function isValidQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Resolves which role (purchase/consumption) the given unitId plays for this
 * item.
 *
 * unitId is mandatory for any item with a purchase or consumption unit
 * configured — legacy 1:1 passthrough is reserved for items that have never
 * been migrated to the conversion model. Concretely:
 *   1. No configured units + no unitId  -> 'legacy' (pre-conversion item).
 *   2. Configured units + no unitId     -> throws INVENTORY_TRANSACTION_UNIT_REQUIRED.
 *   3. unitId matches purchaseUnitId    -> 'purchase'.
 *   4. unitId matches consumptionUnitId -> 'consumption'.
 *   5. unitId matches neither           -> throws INVENTORY_UNIT_NOT_ASSIGNED.
 *
 * Transaction type ('in'/'out'/'adjustment') is deliberately NOT used to
 * infer purchase vs. consumption: an 'in' can be entered in either unit, and
 * so can an 'out' when product rules allow it — type is not a safe unit
 * discriminator.
 *
 * "Configured" is checked with OR (either purchaseUnitId or consumptionUnitId
 * set), not AND: a coherent item always has both-or-neither (see
 * isCoherentUnitConfiguration), but should a partial configuration ever slip
 * through, failing safe means requiring an explicit unitId rather than
 * silently falling back to legacy 1:1 passthrough.
 */
export function resolveUnitRole(
  item: { purchaseUnitId: string | null; consumptionUnitId: string | null },
  unitId: string | null | undefined,
): InventoryUnitRole {
  const hasConfiguredUnits = Boolean(item.purchaseUnitId || item.consumptionUnitId);

  if (!unitId) {
    if (hasConfiguredUnits) {
      throw new InventoryUnitConversionError(
        'INVENTORY_TRANSACTION_UNIT_REQUIRED',
        'unitId is required for items with a purchase/consumption unit configured',
      );
    }
    return 'legacy';
  }

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
 *
 * Legacy items (role 'legacy') always persist unitId = null and
 * quantityInBaseUnit = quantity — this mirrors pre-conversion-model behavior
 * exactly and is intentionally preserved rather than backfilled/rebased.
 *
 * Always finite-checks the result: a purchase-unit entry's multiplication
 * could in principle overflow to Infinity (extreme quantity x factor), which
 * must never reach Prisma as quantityInBaseUnit.
 */
export function computeQuantityInBaseUnit(params: {
  quantity: number;
  role: InventoryUnitRole;
  conversionFactor: number | null;
}): number {
  const { quantity, role, conversionFactor } = params;

  let result: number;
  if (role === 'purchase') {
    if (!isValidConversionFactor(conversionFactor)) {
      throw new InventoryUnitConversionError(
        'INVENTORY_CONVERSION_FACTOR_MISSING',
        'Item has no valid conversionFactor configured for its purchase unit',
      );
    }
    result = quantity * conversionFactor;
  } else {
    result = quantity;
  }

  if (!Number.isFinite(result)) {
    throw new InventoryUnitConversionError(
      'INVENTORY_QUANTITY_INVALID',
      'Computed base-unit quantity is not a finite number',
    );
  }

  return result;
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
 * currentStock, minimumStock, and every normalized InventoryTransaction are
 * denominated in consumptionUnitId — it is the item's base unit. Changing or
 * clearing it after any of those exist would silently reinterpret quantities
 * that were truthfully recorded against the old base unit, so it is blocked.
 *
 * This also covers assigning a consumption unit for the first time (current
 * value null): that is only safe when stock, minimum stock, and history are
 * all still empty, i.e. the same three conditions apply uniformly whether
 * consumptionUnitId is being set, swapped, or cleared. A no-op (next value
 * equal to current, or the field not present in the request at all) is never
 * blocked.
 *
 * This does not, by itself, close the race between reading these three
 * conditions and applying the update — callers must hold them inside one
 * atomic/locked transaction (see PUT /inventory/:id in inventory.ts).
 */
export function isConsumptionUnitChangeBlocked(params: {
  currentConsumptionUnitId: string | null;
  nextConsumptionUnitId: string | null | undefined;
  currentStock: number;
  minimumStock: number;
  hasTransactions: boolean;
}): boolean {
  const { currentConsumptionUnitId, nextConsumptionUnitId, currentStock, minimumStock, hasTransactions } = params;
  if (nextConsumptionUnitId === undefined) return false;
  if (nextConsumptionUnitId === currentConsumptionUnitId) return false;
  return currentStock !== 0 || minimumStock !== 0 || hasTransactions;
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
