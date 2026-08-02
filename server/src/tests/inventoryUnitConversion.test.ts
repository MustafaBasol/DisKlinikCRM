/**
 * inventoryUnitConversion.test.ts — US-05.2 purchase-unit <-> consumption-unit
 * conversion math and validation rules (koli <-> adet).
 *
 * Run with: cd server && npx tsx src/tests/inventoryUnitConversion.test.ts
 *
 * Pure, DB-free unit tests against server/src/services/inventoryUnitConversion.ts
 * — no live Postgres available in this task's environment (mirrors the
 * established pattern in kvkkHigh006Batch2ClinicScope.test.ts).
 */

import assert from 'node:assert/strict';
import {
  computeQuantityInBaseUnit,
  isCoherentUnitConfiguration,
  isConversionFactorChangeBlocked,
  isValidConversionFactor,
  InventoryUnitConversionError,
  resolveUnitRole,
} from '../services/inventoryUnitConversion.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err?.message ?? err}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

const ITEM_WITH_CONVERSION = { purchaseUnitId: 'unit-koli', consumptionUnitId: 'unit-adet' };
const LEGACY_ITEM = { purchaseUnitId: null, consumptionUnitId: null };

section('── isValidConversionFactor ──────────────────────────────────────────');

await test('positive conversion factor is accepted', () => {
  assert.equal(isValidConversionFactor(100), true);
  assert.equal(isValidConversionFactor(1), true, 'factor of 1 is valid when purchase and consumption units are equivalent');
  assert.equal(isValidConversionFactor(0.5), true);
});

await test('zero conversion factor is rejected', () => {
  assert.equal(isValidConversionFactor(0), false);
});

await test('negative conversion factor is rejected', () => {
  assert.equal(isValidConversionFactor(-10), false);
});

await test('non-finite / non-numeric values are rejected', () => {
  assert.equal(isValidConversionFactor(NaN), false);
  assert.equal(isValidConversionFactor(Infinity), false);
  assert.equal(isValidConversionFactor(null), false);
  assert.equal(isValidConversionFactor('100'), false);
});

section('── resolveUnitRole ───────────────────────────────────────────────────');

await test('no unitId supplied → legacy role (backward-compatible, pre-conversion items)', () => {
  assert.equal(resolveUnitRole(LEGACY_ITEM, undefined), 'legacy');
  assert.equal(resolveUnitRole(ITEM_WITH_CONVERSION, null), 'legacy');
});

await test('unitId matching purchaseUnitId → purchase role', () => {
  assert.equal(resolveUnitRole(ITEM_WITH_CONVERSION, 'unit-koli'), 'purchase');
});

await test('unitId matching consumptionUnitId → consumption role', () => {
  assert.equal(resolveUnitRole(ITEM_WITH_CONVERSION, 'unit-adet'), 'consumption');
});

await test('unitId matching neither unit on the item → INVENTORY_UNIT_NOT_ASSIGNED', () => {
  assert.throws(
    () => resolveUnitRole(ITEM_WITH_CONVERSION, 'unit-from-another-item'),
    (err: unknown) => err instanceof InventoryUnitConversionError && err.code === 'INVENTORY_UNIT_NOT_ASSIGNED',
  );
});

section('── computeQuantityInBaseUnit ─────────────────────────────────────────');

await test('3 Koli x 100 = 300 base units (purchase-unit receipt)', () => {
  const result = computeQuantityInBaseUnit({ quantity: 3, role: 'purchase', conversionFactor: 100 });
  assert.equal(result, 300);
});

await test('consumption of 2 Adet → quantityInBaseUnit is 2 (1:1, no conversion)', () => {
  const result = computeQuantityInBaseUnit({ quantity: 2, role: 'consumption', conversionFactor: 100 });
  assert.equal(result, 2);
});

await test('legacy role (pre-conversion item) → 1:1 passthrough regardless of conversionFactor', () => {
  const result = computeQuantityInBaseUnit({ quantity: 5, role: 'legacy', conversionFactor: null });
  assert.equal(result, 5);
});

await test('purchase role with no configured conversionFactor → INVENTORY_CONVERSION_FACTOR_MISSING', () => {
  assert.throws(
    () => computeQuantityInBaseUnit({ quantity: 3, role: 'purchase', conversionFactor: null }),
    (err: unknown) => err instanceof InventoryUnitConversionError && err.code === 'INVENTORY_CONVERSION_FACTOR_MISSING',
  );
});

await test('purchase role with an invalid (zero) conversionFactor → INVENTORY_CONVERSION_FACTOR_MISSING', () => {
  assert.throws(
    () => computeQuantityInBaseUnit({ quantity: 3, role: 'purchase', conversionFactor: 0 }),
    (err: unknown) => err instanceof InventoryUnitConversionError && err.code === 'INVENTORY_CONVERSION_FACTOR_MISSING',
  );
});

section('── isConversionFactorChangeBlocked (historical immutability) ────────');

await test('first-time factor assignment (currently null) is never blocked, even with prior transactions', () => {
  const blocked = isConversionFactorChangeBlocked({
    currentConversionFactor: null,
    nextConversionFactor: 100,
    hasNormalizedPurchaseTransactions: true,
  });
  assert.equal(blocked, false);
});

await test('changing an established factor is blocked once purchase-unit transactions were normalized against it', () => {
  const blocked = isConversionFactorChangeBlocked({
    currentConversionFactor: 100,
    nextConversionFactor: 50,
    hasNormalizedPurchaseTransactions: true,
  });
  assert.equal(blocked, true);
});

await test('changing an established factor is allowed when no purchase-unit transaction has used it yet', () => {
  const blocked = isConversionFactorChangeBlocked({
    currentConversionFactor: 100,
    nextConversionFactor: 50,
    hasNormalizedPurchaseTransactions: false,
  });
  assert.equal(blocked, false);
});

await test('setting the same value is a no-op, never blocked', () => {
  const blocked = isConversionFactorChangeBlocked({
    currentConversionFactor: 100,
    nextConversionFactor: 100,
    hasNormalizedPurchaseTransactions: true,
  });
  assert.equal(blocked, false);
});

await test('field not present in the request (undefined) is never blocked', () => {
  const blocked = isConversionFactorChangeBlocked({
    currentConversionFactor: 100,
    nextConversionFactor: undefined,
    hasNormalizedPurchaseTransactions: true,
  });
  assert.equal(blocked, false);
});

section('── isCoherentUnitConfiguration ───────────────────────────────────────');

await test('all three unset (legacy item) is coherent', () => {
  assert.equal(isCoherentUnitConfiguration({ purchaseUnitId: null, consumptionUnitId: null, conversionFactor: null }), true);
});

await test('all three set together is coherent', () => {
  assert.equal(isCoherentUnitConfiguration({ purchaseUnitId: 'u1', consumptionUnitId: 'u2', conversionFactor: 100 }), true);
});

await test('partial configuration (missing conversionFactor) is rejected', () => {
  assert.equal(isCoherentUnitConfiguration({ purchaseUnitId: 'u1', consumptionUnitId: 'u2', conversionFactor: null }), false);
});

await test('partial configuration (only purchaseUnitId) is rejected', () => {
  assert.equal(isCoherentUnitConfiguration({ purchaseUnitId: 'u1', consumptionUnitId: null, conversionFactor: null }), false);
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`Total: ${passed + failed} tests | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test(s) failed!`);
  process.exit(1);
}
