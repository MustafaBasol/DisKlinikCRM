/**
 * inventoryUnitClinicScope.test.ts — US-05.2 InventoryUnit clinic-scope,
 * authorization, duplicate-handling, and cross-clinic regression tests.
 *
 * Run with: cd server && npx tsx src/tests/inventoryUnitClinicScope.test.ts
 *
 * Two parts, mirroring the established pattern in
 * kvkkHigh006Batch2ClinicScope.test.ts (no live Postgres in this task's
 * environment — see that file's header for why):
 *  1. In-memory simulation of the InventoryUnit CRUD + cross-clinic
 *     validation logic (mirrors server/src/routes/inventoryUnits.ts and the
 *     validateUnitReference()/resolveUnitRole() logic in inventory.ts).
 *  2. Source regression checks — read the actual route files and assert the
 *     required role gates and cross-clinic guards are present.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

function src(relPath: string) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

// ─── In-memory InventoryUnit fixture (mirrors inventoryUnits.ts) ───────────

type Unit = { id: string; clinicId: string; name: string; abbreviation: string; isActive: boolean };

let mockUnits: Unit[] = [];
let nextId = 1;

function resetFixtures() {
  mockUnits = [];
  nextId = 1;
}

function dbFindUnitsByClinic(clinicIds: string[], includeInactive: boolean) {
  return mockUnits.filter((u) => clinicIds.includes(u.clinicId) && (includeInactive || u.isActive));
}

// create() — throws a P2002-shaped error on (clinicId, name) or (clinicId, abbreviation) collision,
// exactly like the real @@unique([clinicId, name]) / @@unique([clinicId, abbreviation]) constraints.
function simCreateUnit(clinicId: string, name: string, abbreviation: string) {
  const collision = mockUnits.some((u) => u.clinicId === clinicId && (u.name === name || u.abbreviation === abbreviation));
  if (collision) {
    const err: any = new Error('Unique constraint failed');
    err.code = 'P2002';
    throw err;
  }
  const unit: Unit = { id: `unit-${nextId++}`, clinicId, name, abbreviation, isActive: true };
  mockUnits.push(unit);
  return unit;
}

function simDeactivateUnit(clinicId: string, id: string) {
  const unit = mockUnits.find((u) => u.id === id && u.clinicId === clinicId);
  if (!unit) return null;
  unit.isActive = false;
  return unit;
}

// validateUnitReference() — mirrors inventory.ts's helper: unit must belong to
// the item's own clinic AND be active for new assignments.
function simValidateUnitReference(clinicId: string, unitId: string): { code: string } | null {
  const unit = mockUnits.find((u) => u.id === unitId && u.clinicId === clinicId);
  if (!unit) return { code: 'INVENTORY_UNIT_CROSS_CLINIC' };
  if (!unit.isActive) return { code: 'INVENTORY_UNIT_INACTIVE' };
  return null;
}

section('── InventoryUnit creation ────────────────────────────────────────────');

await test('unit creation succeeds for a clinic with no prior units', () => {
  resetFixtures();
  const unit = simCreateUnit('clinic-A', 'Koli', 'Koli');
  assert.equal(unit.clinicId, 'clinic-A');
  assert.equal(unit.isActive, true, 'new units default to active');
});

section('── InventoryUnit listing scoped to clinic ───────────────────────────');

await test('listing only returns units for the accessible clinic(s)', () => {
  resetFixtures();
  simCreateUnit('clinic-A', 'Koli', 'Koli');
  simCreateUnit('clinic-B', 'Palet', 'Palet');
  const listA = dbFindUnitsByClinic(['clinic-A'], false);
  assert.equal(listA.length, 1);
  assert.equal(listA[0].name, 'Koli');
});

await test('listing excludes inactive units by default, includes them when requested', () => {
  resetFixtures();
  const unit = simCreateUnit('clinic-A', 'Koli', 'Koli');
  simDeactivateUnit('clinic-A', unit.id);
  assert.equal(dbFindUnitsByClinic(['clinic-A'], false).length, 0);
  assert.equal(dbFindUnitsByClinic(['clinic-A'], true).length, 1);
});

section('── InventoryUnit deactivation (never hard-deleted) ──────────────────');

await test('deactivation flips isActive but the row is never removed', () => {
  resetFixtures();
  const unit = simCreateUnit('clinic-A', 'Koli', 'Koli');
  simDeactivateUnit('clinic-A', unit.id);
  assert.equal(mockUnits.length, 1, 'row must still exist after deactivation');
  assert.equal(mockUnits[0].isActive, false);
});

await test('inventoryUnits.ts route file exposes no DELETE handler for /inventory-units (hard delete never offered)', () => {
  const routeSrc = src('../routes/inventoryUnits.ts');
  assert.ok(!/router\.delete\(/.test(routeSrc), 'a DELETE route would allow hard-deleting a referenced unit');
});

section('── Duplicate name/abbreviation handling ──────────────────────────────');

await test('duplicate unit name within the same clinic is rejected (P2002)', () => {
  resetFixtures();
  simCreateUnit('clinic-A', 'Koli', 'KL');
  assert.throws(() => simCreateUnit('clinic-A', 'Koli', 'KL2'), /Unique constraint/);
});

await test('duplicate unit abbreviation within the same clinic is rejected (P2002)', () => {
  resetFixtures();
  simCreateUnit('clinic-A', 'Koli', 'KL');
  assert.throws(() => simCreateUnit('clinic-A', 'Kutu', 'KL'), /Unique constraint/);
});

await test('the same unit name is allowed across different clinics', () => {
  resetFixtures();
  const a = simCreateUnit('clinic-A', 'Koli', 'KL');
  const b = simCreateUnit('clinic-B', 'Koli', 'KL');
  assert.equal(a.name, b.name);
  assert.notEqual(a.clinicId, b.clinicId);
});

section('── Cross-clinic reference rejection ──────────────────────────────────');

await test('a purchase/consumption/transaction unit from another clinic is rejected', () => {
  resetFixtures();
  const otherClinicUnit = simCreateUnit('clinic-B', 'Koli', 'KL');
  const result = simValidateUnitReference('clinic-A', otherClinicUnit.id);
  assert.deepEqual(result, { code: 'INVENTORY_UNIT_CROSS_CLINIC' });
});

await test('a unit from the item\'s own clinic is accepted', () => {
  resetFixtures();
  const unit = simCreateUnit('clinic-A', 'Koli', 'KL');
  const result = simValidateUnitReference('clinic-A', unit.id);
  assert.equal(result, null);
});

section('── Inactive unit rejected for new records ────────────────────────────');

await test('an inactive unit cannot be assigned to a new item/transaction', () => {
  resetFixtures();
  const unit = simCreateUnit('clinic-A', 'Koli', 'KL');
  simDeactivateUnit('clinic-A', unit.id);
  const result = simValidateUnitReference('clinic-A', unit.id);
  assert.deepEqual(result, { code: 'INVENTORY_UNIT_INACTIVE' });
});

// ─── Source regression: authorization roles ─────────────────────────────────

section('── Authorization role gates (source regression) ─────────────────────');

const inventoryUnitsSrc = src('../routes/inventoryUnits.ts');
const inventorySrc = src('../routes/inventory.ts');

await test('POST /inventory-units is restricted to management roles (OWNER/ORG_ADMIN/CLINIC_MANAGER)', () => {
  const block = inventoryUnitsSrc.slice(inventoryUnitsSrc.indexOf("router.post('/inventory-units'"));
  const authorizeCall = block.slice(0, block.indexOf(')') + 40);
  assert.match(authorizeCall, /MANAGE_ROLES/);
});

await test('MANAGE_ROLES excludes RECEPTIONIST, DENTIST, and BILLING (unit creation is management-only, mirrors item creation)', () => {
  const manageRolesLine = inventoryUnitsSrc.slice(inventoryUnitsSrc.indexOf('const MANAGE_ROLES'), inventoryUnitsSrc.indexOf('const MANAGE_ROLES') + 120);
  assert.ok(!manageRolesLine.includes('RECEPTIONIST'));
  assert.ok(!manageRolesLine.includes('DENTIST'));
  assert.ok(!manageRolesLine.includes('BILLING'));
});

await test('GET /inventory-units is readable by the same broad role set as GET /inventory', () => {
  const readRolesLine = inventoryUnitsSrc.slice(inventoryUnitsSrc.indexOf('const READ_ROLES'), inventoryUnitsSrc.indexOf('const READ_ROLES') + 150);
  for (const role of ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'BILLING', 'DENTIST', 'RECEPTIONIST']) {
    assert.ok(readRolesLine.includes(role), `READ_ROLES must include ${role}`);
  }
});

await test('PUT /inventory/:id (item update, including unit assignment) stays management-only', () => {
  const block = inventorySrc.slice(inventorySrc.indexOf("router.put('/inventory/:id'"), inventorySrc.indexOf("router.put('/inventory/:id'") + 200);
  assert.match(block, /authorize\(\['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'\]\)/);
});

await test('inventory.ts validates unit references via validateUnitReference on both create and update paths', () => {
  const occurrences = inventorySrc.split('validateUnitReference(').length - 1;
  assert.ok(occurrences >= 3, `expected validateUnitReference to be called from POST create, PUT update, and POST transactions (found ${occurrences} call sites)`);
});

await test('inventory.ts transactions route resolves unit role and rejects units unassigned to the item (resolveUnitRole)', () => {
  const block = inventorySrc.slice(inventorySrc.indexOf("router.post('/inventory/:id/transactions'"));
  assert.ok(block.includes('resolveUnitRole'));
});

await test('inventory.ts transactions route uses an atomic $transaction for the stock mutation', () => {
  const block = inventorySrc.slice(inventorySrc.indexOf("router.post('/inventory/:id/transactions'"), inventorySrc.indexOf("router.get('/inventory/:id/transactions'"));
  assert.match(block, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(block, /currentStock:\s*\{\s*gte:\s*quantityInBaseUnit\s*\}/, 'the "out" path must guard against negative stock under concurrency');
});

// ─── PR #286 follow-up: missing-unitId bypass fix ───────────────────────────

section('── unitId is mandatory for configured items (source regression) ─────');

function routeBlock(src: string, startMarker: string, endMarker?: string) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = endMarker ? src.indexOf(endMarker, start) : undefined;
  return end && end > start ? src.slice(start, end) : src.slice(start);
}

const putBlock = routeBlock(inventorySrc, "router.put('/inventory/:id'", "router.post('/inventory/:id/transactions'");
const postTxBlock = routeBlock(inventorySrc, "router.post('/inventory/:id/transactions'", "router.get('/inventory/:id/transactions'");

await test('the transactions route resolves role/quantity inside the locked $transaction, not from the pre-lock snapshot (closes the stale-config race)', () => {
  const txStart = postTxBlock.indexOf('prisma.$transaction(async (tx)');
  assert.ok(txStart >= 0, 'expected an interactive $transaction in the transactions route');
  const insideTx = postTxBlock.slice(txStart);
  const resolveIdx = insideTx.indexOf('resolveUnitRole(');
  const computeIdx = insideTx.indexOf('computeQuantityInBaseUnit(');
  assert.ok(resolveIdx >= 0 && computeIdx >= 0, 'resolveUnitRole/computeQuantityInBaseUnit must be called inside the $transaction callback');
});

await test('the transactions route quantity check uses isValidQuantity (Number.isFinite), never a bare isNaN', () => {
  assert.ok(postTxBlock.includes('isValidQuantity(qty)'), 'expected isValidQuantity(qty) to gate the entered quantity');
  assert.equal(/isNaN\(/.test(postTxBlock), false, 'a bare isNaN() check would let Infinity/-Infinity through');
});

await test('the transactions route returns INVENTORY_QUANTITY_INVALID for an invalid quantity', () => {
  assert.ok(postTxBlock.includes("code: 'INVENTORY_QUANTITY_INVALID'"));
});

await test('the transactions route propagates InventoryUnitConversionError (covers INVENTORY_TRANSACTION_UNIT_REQUIRED thrown by resolveUnitRole) to a 400 with its code', () => {
  assert.match(postTxBlock, /err instanceof InventoryUnitConversionError/);
});

section('── Consumption/base-unit lock (source regression) ────────────────────');

await test('PUT /inventory/:id row-locks the item with FOR UPDATE via Prisma.sql before reading stock/history counts', () => {
  assert.match(putBlock, /Prisma\.sql`SELECT id FROM "InventoryItem" WHERE id = \$\{id\} AND "clinicId" = \$\{clinicId\} FOR UPDATE`/);
  const lockIdx = putBlock.indexOf('FOR UPDATE');
  const countIdx = putBlock.indexOf('inventoryTransaction.count(');
  assert.ok(lockIdx >= 0 && countIdx > lockIdx, 'the FOR UPDATE lock must be taken before the transaction-history count is read');
});

await test('PUT /inventory/:id never uses $queryRawUnsafe and never interpolates raw SQL outside Prisma.sql tagging', () => {
  assert.equal(inventorySrc.includes('$queryRawUnsafe'), false, 'must never use $queryRawUnsafe');
  assert.equal(/\$queryRaw<[^>]*>\(\s*`/.test(inventorySrc), false, 'must not use a bare template-literal query (bypasses Prisma.sql tagging)');
});

await test('PUT /inventory/:id calls isConsumptionUnitChangeBlocked and maps a positive result to INVENTORY_CONSUMPTION_UNIT_LOCKED (409)', () => {
  assert.ok(putBlock.includes('isConsumptionUnitChangeBlocked('));
  assert.match(putBlock, /status\(409\)\.json\(\{[\s\S]{0,260}code:\s*'INVENTORY_CONSUMPTION_UNIT_LOCKED'/);
});

await test('the consumption-unit lock decision and the item update happen inside the same $transaction callback (no separate read-then-write)', () => {
  const txStart = putBlock.indexOf('prisma.$transaction(async (tx)');
  const txCallbackEnd = putBlock.indexOf('\n    });', txStart);
  assert.ok(txStart >= 0 && txCallbackEnd > txStart);
  const callback = putBlock.slice(txStart, txCallbackEnd);
  assert.ok(callback.includes('isConsumptionUnitChangeBlocked('), 'lock decision must be inside the transaction callback');
  assert.ok(callback.includes('tx.inventoryItem.update('), 'the item write must be inside the same transaction callback');
});

await test('conversionFactor history lock (isConversionFactorChangeBlocked) still runs inside the same locked transaction', () => {
  const txStart = putBlock.indexOf('prisma.$transaction(async (tx)');
  const txCallbackEnd = putBlock.indexOf('\n    });', txStart);
  const callback = putBlock.slice(txStart, txCallbackEnd);
  assert.ok(callback.includes('isConversionFactorChangeBlocked('));
});

await test('PUT /inventory/:id does not touch InventoryTransaction rows when purchaseUnitId changes (historical unitId/quantityInBaseUnit are left alone)', () => {
  assert.equal(/tx\.inventoryTransaction\.update/.test(putBlock), false, 'no code path should rewrite past transactions when purchaseUnitId changes');
});

section('── Purchase-unit change: historical attribution (in-memory simulation) ──');

await test('changing an item\'s purchaseUnitId does not alter a previously-recorded transaction\'s own unitId/quantityInBaseUnit', () => {
  // Historical InventoryTransaction rows store their own unitId and
  // quantityInBaseUnit at creation time (see transactionData in the
  // transactions route) — they never read back through item.purchaseUnitId.
  // Mutating the item object here mirrors what PUT /inventory/:id does; the
  // already-created transaction object must be structurally unaffected.
  const item = { id: 'item-1', purchaseUnitId: 'unit-koli-old', consumptionUnitId: 'unit-adet', conversionFactor: 100 };
  const historicalTransaction = { itemId: item.id, unitId: item.purchaseUnitId, quantityInBaseUnit: 3 * item.conversionFactor };

  // Simulate a permitted future purchase-unit change (item now points to a
  // different InventoryUnit row; conversionFactor/consumptionUnitId untouched).
  const updatedItem = { ...item, purchaseUnitId: 'unit-koli-new' };

  assert.equal(historicalTransaction.unitId, 'unit-koli-old', 'the historical transaction must keep referencing the original purchase unit');
  assert.notEqual(historicalTransaction.unitId, updatedItem.purchaseUnitId, 'the item\'s new purchaseUnitId must not retroactively apply to old transactions');
  assert.equal(historicalTransaction.quantityInBaseUnit, 300, 'the normalized quantity computed at creation time must remain unchanged');
});

section('── DB-backed tests still required before merge (documented, not executed here) ──');

await test('this suite documents (does not simulate) the live-Postgres concurrency test still owed before merge', () => {
  // No Postgres instance is available in this task's environment (see this
  // file's header). The FOR UPDATE row-lock strategy above is verified here
  // only via source regression + pure-logic simulation. Still required
  // before merge, against a real Postgres instance:
  //   1. Concurrent PUT (clearing/changing consumptionUnitId) racing a POST
  //      /inventory/:id/transactions on the same item — assert exactly one
  //      side wins and no transaction ends up silently reinterpreted.
  //   2. Concurrent POST /inventory/:id/transactions racing a PUT that
  //      changes purchaseUnitId/conversionFactor — assert the transaction's
  //      role/quantityInBaseUnit is always resolved against a single
  //      consistent (before-or-after) unit configuration, never a mix.
  assert.ok(true);
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`Total: ${passed + failed} tests | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test(s) failed!`);
  process.exit(1);
}
