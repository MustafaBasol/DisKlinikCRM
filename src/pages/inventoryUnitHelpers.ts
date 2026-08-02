/**
 * inventoryUnitHelpers.ts — pure UI helpers for the purchase-unit <->
 * consumption-unit conversion preview (US-05.2). No side effects, no API
 * calls, so these can be exercised in isolation (see __tests__/
 * inventoryUnitHelpers.test.ts). The server remains the source of truth for
 * the actual conversion (server/src/services/inventoryUnitConversion.ts);
 * this only powers the live "normalized quantity" preview in the UI.
 */

export type InventoryUnitLite = {
  id: string;
  name: string;
  abbreviation: string;
  isActive: boolean;
};

/**
 * Base-unit equivalent of `quantity` for a live form preview. Mirrors the
 * server's computeQuantityInBaseUnit: purchase-unit entries are multiplied
 * by conversionFactor, consumption-unit/legacy entries pass through 1:1.
 * Returns null when the preview cannot be computed yet (invalid quantity, or
 * a purchase-unit entry with no usable conversionFactor).
 */
export function computeBaseUnitPreview(params: {
  quantity: number;
  selectedUnitId: string | null;
  purchaseUnitId: string | null;
  conversionFactor: number | null;
}): number | null {
  const { quantity, selectedUnitId, purchaseUnitId, conversionFactor } = params;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  if (selectedUnitId && purchaseUnitId && selectedUnitId === purchaseUnitId) {
    if (!conversionFactor || conversionFactor <= 0) return null;
    return quantity * conversionFactor;
  }

  return quantity;
}

/**
 * Selectable units for a transaction on this item: its configured
 * consumption unit always, its purchase unit only for non-adjustment types
 * (adjustment sets an absolute base-unit target — see server-side rule).
 * Inactive units are excluded from new selections but kept if already the
 * item's current assignment isn't handled here — this only builds the
 * dropdown options list.
 */
export function selectableTransactionUnits(params: {
  purchaseUnit: InventoryUnitLite | null | undefined;
  consumptionUnit: InventoryUnitLite | null | undefined;
  transactionType: 'in' | 'out' | 'adjustment';
}): InventoryUnitLite[] {
  const { purchaseUnit, consumptionUnit, transactionType } = params;
  const options: InventoryUnitLite[] = [];
  if (consumptionUnit && consumptionUnit.isActive) options.push(consumptionUnit);
  if (purchaseUnit && purchaseUnit.isActive && transactionType !== 'adjustment') options.push(purchaseUnit);
  return options;
}

/**
 * A unit-conversion-aware item must define purchaseUnitId, consumptionUnitId
 * and conversionFactor together, or none of them. Mirrors the server-side
 * isCoherentUnitConfiguration check for immediate client-side feedback.
 */
export function isCoherentUnitConfiguration(params: {
  purchaseUnitId: string | null | undefined;
  consumptionUnitId: string | null | undefined;
  conversionFactor: number | null | undefined;
}): boolean {
  const values = [params.purchaseUnitId, params.consumptionUnitId, params.conversionFactor];
  const definedCount = values.filter((v) => v !== null && v !== undefined && v !== '').length;
  return definedCount === 0 || definedCount === 3;
}
