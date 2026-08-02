/**
 * inventoryUnitHelpers.test.ts — pure logic for the purchase-unit <->
 * consumption-unit conversion preview (US-05.2).
 *
 * Run with: tsx src/pages/__tests__/inventoryUnitHelpers.test.ts
 * No external test framework — mirrors the style of
 * src/pages/__tests__/bookingWidgetHelpers.test.ts.
 */

import assert from 'node:assert/strict';

import {
  computeBaseUnitPreview,
  selectableTransactionUnits,
  isCoherentUnitConfiguration,
  type InventoryUnitLite,
} from '../inventoryUnitHelpers';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

const KOLI: InventoryUnitLite = { id: 'unit-koli', name: 'Koli', abbreviation: 'Koli', isActive: true };
const ADET: InventoryUnitLite = { id: 'unit-adet', name: 'Adet', abbreviation: 'Adet', isActive: true };
const INACTIVE_PALET: InventoryUnitLite = { id: 'unit-palet', name: 'Palet', abbreviation: 'Palet', isActive: false };

async function main() {
  section('── computeBaseUnitPreview ────────────────────────────────────────');

  await test('3 Koli selected with a x100 factor previews as 300', () => {
    const result = computeBaseUnitPreview({ quantity: 3, selectedUnitId: KOLI.id, purchaseUnitId: KOLI.id, conversionFactor: 100 });
    assert.equal(result, 300);
  });

  await test('consumption unit selected previews 1:1 (no conversion)', () => {
    const result = computeBaseUnitPreview({ quantity: 2, selectedUnitId: ADET.id, purchaseUnitId: KOLI.id, conversionFactor: 100 });
    assert.equal(result, 2);
  });

  await test('no unit selected (legacy item) previews 1:1', () => {
    const result = computeBaseUnitPreview({ quantity: 5, selectedUnitId: null, purchaseUnitId: null, conversionFactor: null });
    assert.equal(result, 5);
  });

  await test('invalid quantity (0 or negative) has no preview', () => {
    assert.equal(computeBaseUnitPreview({ quantity: 0, selectedUnitId: KOLI.id, purchaseUnitId: KOLI.id, conversionFactor: 100 }), null);
    assert.equal(computeBaseUnitPreview({ quantity: -1, selectedUnitId: KOLI.id, purchaseUnitId: KOLI.id, conversionFactor: 100 }), null);
  });

  await test('purchase unit selected but no usable conversionFactor has no preview', () => {
    assert.equal(computeBaseUnitPreview({ quantity: 3, selectedUnitId: KOLI.id, purchaseUnitId: KOLI.id, conversionFactor: null }), null);
    assert.equal(computeBaseUnitPreview({ quantity: 3, selectedUnitId: KOLI.id, purchaseUnitId: KOLI.id, conversionFactor: 0 }), null);
  });

  section('── selectableTransactionUnits ────────────────────────────────────');

  await test('in/out transactions offer both purchase and consumption units when configured', () => {
    const inOptions = selectableTransactionUnits({ purchaseUnit: KOLI, consumptionUnit: ADET, transactionType: 'in' });
    assert.deepEqual(inOptions.map((u) => u.id), [ADET.id, KOLI.id]);
  });

  await test('adjustment transactions never offer the purchase unit (ambiguous absolute target)', () => {
    const options = selectableTransactionUnits({ purchaseUnit: KOLI, consumptionUnit: ADET, transactionType: 'adjustment' });
    assert.deepEqual(options.map((u) => u.id), [ADET.id]);
  });

  await test('an inactive unit is never offered for a new transaction', () => {
    const options = selectableTransactionUnits({ purchaseUnit: INACTIVE_PALET, consumptionUnit: ADET, transactionType: 'in' });
    assert.deepEqual(options.map((u) => u.id), [ADET.id]);
  });

  await test('an item with no configured units offers no unit choices (legacy behavior unchanged)', () => {
    const options = selectableTransactionUnits({ purchaseUnit: null, consumptionUnit: null, transactionType: 'in' });
    assert.equal(options.length, 0);
  });

  section('── isCoherentUnitConfiguration ───────────────────────────────────');

  await test('all unset is coherent (legacy item)', () => {
    assert.equal(isCoherentUnitConfiguration({ purchaseUnitId: '', consumptionUnitId: '', conversionFactor: '' as any }), true);
  });

  await test('all three set together is coherent', () => {
    assert.equal(isCoherentUnitConfiguration({ purchaseUnitId: KOLI.id, consumptionUnitId: ADET.id, conversionFactor: 100 }), true);
  });

  await test('partial configuration is rejected', () => {
    assert.equal(isCoherentUnitConfiguration({ purchaseUnitId: KOLI.id, consumptionUnitId: '', conversionFactor: '' as any }), false);
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
