/**
 * inventoryUnitConversionConcurrency.test.ts — US-05.2 purchase/consumption
 * unit conversion (PR #286, ClickUp 86eydm5gh): real disposable-Postgres
 * verification that the REAL Express route handlers in
 * server/src/routes/inventory.ts genuinely serialize concurrent writers on
 * the same InventoryItem row, and that rollback/validation guarantees hold
 * under a real database rather than only single-threaded-JS mocked-Prisma
 * determinism.
 *
 * Covered here (not provable against mocked Prisma):
 *  1. PUT /inventory/:id (consumption-unit change) vs. POST
 *     /inventory/:id/transactions genuinely serialize on the same
 *     `SELECT ... FOR UPDATE` row lock, in both possible arrival orderings.
 *  2. Same for PUT's purchaseUnitId/conversionFactor change vs. a
 *     purchase-unit transaction POST.
 *  3. Two concurrent 'out' transactions against real concurrent Postgres
 *     connections can never both succeed past available stock (the
 *     `updateMany` + `currentStock >= quantityInBaseUnit` guard).
 *  4. A stock mutation is genuinely rolled back (not just "the code says it
 *     should be") when the transaction-create step fails later in the same
 *     interactive transaction with a real FK violation.
 *  5. The configured-item unit requirement holds against a real DB with no
 *     partial writes left behind.
 *
 * Route logic itself is NOT modified/redesigned by this file — every
 * scenario below exercises the existing, already-fixed
 * server/src/routes/inventory.ts and
 * server/src/services/inventoryUnitConversion.ts unchanged.
 *
 * Run: npx tsx src/tests/dbVerification/inventoryUnitConversionConcurrency.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres before import.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import inventoryRouter from '../../routes/inventory.js';
import {
  createSuite,
  getFullChain,
  runChain,
  mockResponse,
  authRequest,
  createClinicFixtureSet,
  createStaffUser,
  prisma,
  type ClinicFixtureSet,
} from './dbVerificationHarness.js';

const { section, test, summary } = createSuite('inventoryUnitConversionConcurrency');

const PUT_CHAIN = getFullChain(inventoryRouter as any, 'put', '/inventory/:id');
const POST_TX_CHAIN = getFullChain(inventoryRouter as any, 'post', '/inventory/:id/transactions');

// ─── Local teardown tracking ─────────────────────────────────────────────
// Deliberately NOT using the shared harness's cleanupAllFixtures(): this
// suite creates InventoryUnit rows (ON DELETE RESTRICT -> Clinic), which the
// shared cleanup does not know to delete, so its later clinic.deleteMany()
// would fail with a live FK violation. We track our own org/clinic ids and
// tear them down in FK-safe order, including InventoryUnit and ActivityLog
// (every PUT/POST call below goes through the real route and calls
// logActivity(), which writes a real ActivityLog row referencing this
// clinic/user).

const myOrgIds = new Set<string>();
const myClinicIds = new Set<string>();

function trackFixtures(fixtures: ClinicFixtureSet) {
  myOrgIds.add(fixtures.orgId);
  myOrgIds.add(fixtures.otherOrgId);
  myClinicIds.add(fixtures.defaultClinicId);
  myClinicIds.add(fixtures.siblingClinicId);
  myClinicIds.add(fixtures.unauthorizedClinicId);
  myClinicIds.add(fixtures.crossOrgClinicId);
}

async function localCleanup(): Promise<void> {
  const clinicIds = Array.from(myClinicIds);
  const orgIds = Array.from(myOrgIds);
  if (clinicIds.length === 0 && orgIds.length === 0) return;

  await prisma.activityLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.inventoryTransaction.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.treatmentCase.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.inventoryItem.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.inventoryUnit.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.patient.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.clinic.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });

  myClinicIds.clear();
  myOrgIds.clear();
}

// ─── Fixture helpers ──────────────────────────────────────────────────────

async function newFixtures(labelPrefix: string) {
  const fixtures = await createClinicFixtureSet(labelPrefix);
  trackFixtures(fixtures);
  return fixtures;
}

async function ownerUser(fixtures: ClinicFixtureSet, clinicId: string = fixtures.defaultClinicId) {
  const owner = await createStaffUser({ organizationId: fixtures.orgId, clinicId, role: 'OWNER', canAccessAllClinics: true });
  return authRequest({ id: owner.id, organizationId: fixtures.orgId, clinicId, role: 'OWNER', canAccessAllClinics: true });
}

async function createUnits(clinicId: string) {
  const suffix = randomUUID().slice(0, 8);
  const purchaseUnit = await prisma.inventoryUnit.create({
    data: { clinicId, name: `Koli-${suffix}`, abbreviation: `KL-${suffix}`, isActive: true },
  });
  const consumptionUnit = await prisma.inventoryUnit.create({
    data: { clinicId, name: `Adet-${suffix}`, abbreviation: `AD-${suffix}`, isActive: true },
  });
  return { purchaseUnit, consumptionUnit };
}

async function createConfiguredItem(params: {
  clinicId: string;
  organizationId: string;
  purchaseUnitId: string;
  consumptionUnitId: string;
  conversionFactor: number;
  currentStock?: number;
  minimumStock?: number;
}) {
  return prisma.inventoryItem.create({
    data: {
      clinicId: params.clinicId,
      organizationId: params.organizationId,
      name: `Test Item ${randomUUID().slice(0, 8)}`,
      category: 'consumable',
      unit: 'piece',
      currentStock: params.currentStock ?? 0,
      minimumStock: params.minimumStock ?? 0,
      purchaseUnitId: params.purchaseUnitId,
      consumptionUnitId: params.consumptionUnitId,
      conversionFactor: params.conversionFactor,
    },
  });
}

async function callPut(itemId: string, user: ReturnType<typeof authRequest>, body: Record<string, unknown>) {
  const req = { ...(user as any), params: { id: itemId }, body } as any;
  const res = mockResponse();
  await runChain(PUT_CHAIN, req, res);
  return res;
}

async function callPostTx(itemId: string, user: ReturnType<typeof authRequest>, body: Record<string, unknown>) {
  const req = { ...(user as any), params: { id: itemId }, body } as any;
  const res = mockResponse();
  await runChain(POST_TX_CHAIN, req, res);
  return res;
}

// ─── Manual row-lock hold / release, and lock-waiter polling ────────────
// Same technique the task specifies: acquire the identical `FOR UPDATE`
// lock the routes take, in a held-open interactive transaction, so we can
// deterministically control which of two concurrently-started real route
// calls gets to proceed first — Postgres's lock manager grants row-lock
// waiters in arrival (FIFO) order.

async function acquireManualHold(itemId: string, clinicId: string) {
  let releaseFn!: () => void;
  const released = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  let acquiredResolve!: () => void;
  const acquired = new Promise<void>((resolve) => {
    acquiredResolve = resolve;
  });
  const done = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id = ${itemId} AND "clinicId" = ${clinicId} FOR UPDATE`;
      acquiredResolve();
      await released;
    },
    { timeout: 30000, maxWait: 30000 },
  );
  await acquired;
  return { release: () => releaseFn(), done };
}

async function waitForWaiters(expected: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
    if (Number(rows[0].count) >= expected) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Timed out waiting for ${expected} lock waiter(s)`);
}

// ─── Race 1: consumption-unit change (PUT) vs. transaction create (POST) ──

async function scenarioRace1Ordering1PutFirst() {
  section('Race 1, ordering 1 — PUT (consumption-unit change) wins the lock first, POST re-resolves against the committed change');
  const fixtures = await newFixtures('inv-race1-o1');
  const clinicId = fixtures.defaultClinicId;
  const { purchaseUnit, consumptionUnit } = await createUnits(clinicId);
  const item = await createConfiguredItem({
    clinicId,
    organizationId: fixtures.orgId,
    purchaseUnitId: purchaseUnit.id,
    consumptionUnitId: consumptionUnit.id,
    conversionFactor: 100,
    currentStock: 0,
    minimumStock: 0,
  });
  const user = await ownerUser(fixtures);

  // A second, alternate consumption unit PUT can legally swap to (stock,
  // minStock, and history are all still zero at this point).
  const altConsumptionUnit = await prisma.inventoryUnit.create({
    data: { clinicId, name: `Adet-Alt-${randomUUID().slice(0, 8)}`, abbreviation: `ADX-${randomUUID().slice(0, 6)}`, isActive: true },
  });

  await test('PUT commits the consumption-unit change first; POST using the now-stale old unitId is rejected, never silently succeeds', async () => {
    const hold = await acquireManualHold(item.id, clinicId);

    const putPromise = callPut(item.id, user, { consumptionUnitId: altConsumptionUnit.id });
    await waitForWaiters(1);

    // POST is built against the OLD consumptionUnitId — by the time it
    // actually runs (after PUT commits), that unitId no longer matches the
    // item's live configuration.
    const postPromise = callPostTx(item.id, user, { type: 'in', quantity: 5, unitId: consumptionUnit.id });
    await waitForWaiters(2);

    hold.release();
    await hold.done;

    const [putRes, postRes] = await Promise.all([putPromise, postPromise]);

    assert.equal(putRes.statusCode, 200, 'PUT must succeed — stock/minStock/history were all still zero when it acquired the lock');
    assert.equal(putRes.body.consumptionUnitId, altConsumptionUnit.id);

    assert.equal(postRes.statusCode, 400, 'POST must never silently succeed against a unitId that no longer matches the item once PUT has committed');
    assert.equal(postRes.body.code, 'INVENTORY_UNIT_NOT_ASSIGNED', 'the old consumptionUnitId is no longer assigned to this item after the race');

    const txCount = await prisma.inventoryTransaction.count({ where: { itemId: item.id } });
    assert.equal(txCount, 0, 'the rejected POST must not have written any transaction row (base-unit quantity for a stale role must never be persisted)');
  });
}

async function scenarioRace1Ordering2PostFirst() {
  section('Race 1, ordering 2 — POST (transaction create) wins the lock first, PUT is then blocked by real transaction history');
  const fixtures = await newFixtures('inv-race1-o2');
  const clinicId = fixtures.defaultClinicId;
  const { purchaseUnit, consumptionUnit } = await createUnits(clinicId);
  const item = await createConfiguredItem({
    clinicId,
    organizationId: fixtures.orgId,
    purchaseUnitId: purchaseUnit.id,
    consumptionUnitId: consumptionUnit.id,
    conversionFactor: 100,
    currentStock: 0,
    minimumStock: 0,
  });
  const user = await ownerUser(fixtures);
  const altConsumptionUnit = await prisma.inventoryUnit.create({
    data: { clinicId, name: `Adet-Alt2-${randomUUID().slice(0, 8)}`, abbreviation: `ADY-${randomUUID().slice(0, 6)}`, isActive: true },
  });

  await test('POST commits a transaction first (hasTransactions becomes true); PUT then gets 409 INVENTORY_CONSUMPTION_UNIT_LOCKED', async () => {
    const hold = await acquireManualHold(item.id, clinicId);

    const postPromise = callPostTx(item.id, user, { type: 'in', quantity: 5, unitId: consumptionUnit.id });
    await waitForWaiters(1);

    const putPromise = callPut(item.id, user, { consumptionUnitId: altConsumptionUnit.id });
    await waitForWaiters(2);

    hold.release();
    await hold.done;

    const [postRes, putRes] = await Promise.all([postPromise, putPromise]);

    assert.equal(postRes.statusCode, 201, 'POST must succeed — it acquired the lock first against a still-zero-history item');

    assert.equal(putRes.statusCode, 409, 'PUT must be rejected once it re-reads a committed transaction created underneath it');
    assert.equal(putRes.body.code, 'INVENTORY_CONSUMPTION_UNIT_LOCKED');

    const dbItem = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(dbItem.consumptionUnitId, consumptionUnit.id, 'the item must still be pointing at its original consumption unit — the blocked PUT must not have partially applied');

    const txCount = await prisma.inventoryTransaction.count({ where: { itemId: item.id } });
    assert.equal(txCount, 1, 'exactly the one committed POST transaction must exist');
  });
}

// ─── Race 2: purchase-unit/conversionFactor change (PUT) vs. purchase-unit transaction (POST) ──

async function scenarioRace2Ordering1PutFirst() {
  section('Race 2, ordering 1 — PUT (conversionFactor change) wins the lock first, POST resolves quantityInBaseUnit against the newly-committed factor');
  const fixtures = await newFixtures('inv-race2-o1');
  const clinicId = fixtures.defaultClinicId;
  const { purchaseUnit, consumptionUnit } = await createUnits(clinicId);
  const item = await createConfiguredItem({
    clinicId,
    organizationId: fixtures.orgId,
    purchaseUnitId: purchaseUnit.id,
    consumptionUnitId: consumptionUnit.id,
    conversionFactor: 100,
    currentStock: 0,
    minimumStock: 0,
  });
  const user = await ownerUser(fixtures);

  await test('PUT changes conversionFactor 100 -> 50 first (no prior normalized purchase transactions, so it is not blocked); POST then computes quantityInBaseUnit from the committed factor of 50, not the stale 100', async () => {
    const hold = await acquireManualHold(item.id, clinicId);

    const putPromise = callPut(item.id, user, { conversionFactor: 50 });
    await waitForWaiters(1);

    const postPromise = callPostTx(item.id, user, { type: 'in', quantity: 3, unitId: purchaseUnit.id });
    await waitForWaiters(2);

    hold.release();
    await hold.done;

    const [putRes, postRes] = await Promise.all([putPromise, postPromise]);

    assert.equal(putRes.statusCode, 200, 'PUT must succeed — no normalized purchase-unit transactions existed yet when it acquired the lock');
    assert.equal(putRes.body.conversionFactor, 50);

    assert.equal(postRes.statusCode, 201, 'POST must succeed — purchaseUnitId is unchanged, only the factor moved');
    assert.equal(postRes.body.transaction.quantityInBaseUnit, 3 * 50, 'quantityInBaseUnit must reflect the factor actually committed by the time POST executed inside the lock, not the pre-race value of 100');

    const dbTx = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: postRes.body.transaction.id } });
    assert.equal(dbTx.quantityInBaseUnit, 3 * 50, 'the persisted row itself must never carry a stale-factor-derived quantity');
  });
}

async function scenarioRace2Ordering1bPutRelinksPurchaseUnit() {
  section('Race 2, ordering 1b — PUT relinks purchaseUnitId to a different unit first; POST using the now-obsolete purchaseUnitId is rejected');
  const fixtures = await newFixtures('inv-race2-o1b');
  const clinicId = fixtures.defaultClinicId;
  const { purchaseUnit, consumptionUnit } = await createUnits(clinicId);
  const item = await createConfiguredItem({
    clinicId,
    organizationId: fixtures.orgId,
    purchaseUnitId: purchaseUnit.id,
    consumptionUnitId: consumptionUnit.id,
    conversionFactor: 100,
    currentStock: 0,
    minimumStock: 0,
  });
  const user = await ownerUser(fixtures);
  const altPurchaseUnit = await prisma.inventoryUnit.create({
    data: { clinicId, name: `Koli-Alt-${randomUUID().slice(0, 8)}`, abbreviation: `KLX-${randomUUID().slice(0, 6)}`, isActive: true },
  });

  await test('PUT relinks purchaseUnitId to a different InventoryUnit first; POST built against the obsolete purchaseUnitId gets INVENTORY_UNIT_NOT_ASSIGNED, no transaction written', async () => {
    const hold = await acquireManualHold(item.id, clinicId);

    const putPromise = callPut(item.id, user, { purchaseUnitId: altPurchaseUnit.id });
    await waitForWaiters(1);

    const postPromise = callPostTx(item.id, user, { type: 'in', quantity: 2, unitId: purchaseUnit.id });
    await waitForWaiters(2);

    hold.release();
    await hold.done;

    const [putRes, postRes] = await Promise.all([putPromise, postPromise]);

    assert.equal(putRes.statusCode, 200);
    assert.equal(putRes.body.purchaseUnitId, altPurchaseUnit.id);

    assert.equal(postRes.statusCode, 400);
    assert.equal(postRes.body.code, 'INVENTORY_UNIT_NOT_ASSIGNED', 'the old purchaseUnitId is obsolete once PUT relinked the item');

    const txCount = await prisma.inventoryTransaction.count({ where: { itemId: item.id } });
    assert.equal(txCount, 0);
  });
}

async function scenarioRace2Ordering2PostFirst() {
  section('Race 2, ordering 2 — POST (purchase-unit transaction) wins the lock first, PUT is then blocked from changing conversionFactor');
  const fixtures = await newFixtures('inv-race2-o2');
  const clinicId = fixtures.defaultClinicId;
  const { purchaseUnit, consumptionUnit } = await createUnits(clinicId);
  const item = await createConfiguredItem({
    clinicId,
    organizationId: fixtures.orgId,
    purchaseUnitId: purchaseUnit.id,
    consumptionUnitId: consumptionUnit.id,
    conversionFactor: 100,
    currentStock: 0,
    minimumStock: 0,
  });
  const user = await ownerUser(fixtures);

  await test('POST commits a purchase-unit transaction first (hasNormalizedPurchaseTransactions becomes true); PUT changing conversionFactor is then rejected with 409 INVENTORY_CONVERSION_FACTOR_LOCKED', async () => {
    const hold = await acquireManualHold(item.id, clinicId);

    const postPromise = callPostTx(item.id, user, { type: 'in', quantity: 4, unitId: purchaseUnit.id });
    await waitForWaiters(1);

    const putPromise = callPut(item.id, user, { conversionFactor: 25 });
    await waitForWaiters(2);

    hold.release();
    await hold.done;

    const [postRes, putRes] = await Promise.all([postPromise, putPromise]);

    assert.equal(postRes.statusCode, 201, 'POST must succeed — it acquired the lock first, factor was still 100');
    assert.equal(postRes.body.transaction.quantityInBaseUnit, 4 * 100, 'quantityInBaseUnit must reflect the factor (100) actually live when the POST transaction body executed');

    assert.equal(putRes.statusCode, 409, 'PUT must be rejected once it re-reads a real, committed normalized purchase transaction created underneath it');
    assert.equal(putRes.body.code, 'INVENTORY_CONVERSION_FACTOR_LOCKED');

    const dbItem = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(dbItem.conversionFactor, 100, 'the blocked PUT must not have partially applied — factor must remain the pre-race value');

    const dbTx = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: postRes.body.transaction.id } });
    assert.equal(dbTx.quantityInBaseUnit, 4 * 100, 'no transaction record may ever carry a quantityInBaseUnit computed from a stale factor');
  });
}

// ─── Race 3: concurrent stock-out transactions ────────────────────────────

async function scenarioRace3ConcurrentStockOut() {
  section('Race 3 — two concurrent real-DB "out" transactions that together exceed stock: exactly one wins, stock never goes negative');
  const fixtures = await newFixtures('inv-race3');
  const clinicId = fixtures.defaultClinicId;
  const user = await ownerUser(fixtures);
  // Legacy item, no configured units — simpler, unitId omitted.
  const item = await prisma.inventoryItem.create({
    data: {
      clinicId,
      organizationId: fixtures.orgId,
      name: `Legacy Item ${randomUUID().slice(0, 8)}`,
      category: 'consumable',
      unit: 'piece',
      currentStock: 10,
      minimumStock: 0,
    },
  });

  await test('exactly one of two concurrent 7+7 "out" requests against a stock of 10 succeeds; the other fails with INVENTORY_INSUFFICIENT_STOCK', async () => {
    const [resA, resB] = await Promise.all([
      callPostTx(item.id, user, { type: 'out', quantity: 7 }),
      callPostTx(item.id, user, { type: 'out', quantity: 7 }),
    ]);

    const successes = [resA, resB].filter((r) => r.statusCode === 201);
    const failures = [resA, resB].filter((r) => r.statusCode !== 201);

    assert.equal(successes.length, 1, 'exactly one of the two concurrent out-transactions must succeed');
    assert.equal(failures.length, 1);
    assert.equal(failures[0].statusCode, 400);
    assert.equal(failures[0].body.code, 'INVENTORY_INSUFFICIENT_STOCK');

    const dbItem = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(dbItem.currentStock, 10 - 7, 'final stock must be exactly stock minus the winning quantity, never negative');
    assert.ok(dbItem.currentStock >= 0);

    const txCount = await prisma.inventoryTransaction.count({ where: { itemId: item.id } });
    assert.equal(txCount, 1, 'the failed request must not have created any InventoryTransaction row');

    const winningTx = await prisma.inventoryTransaction.findFirstOrThrow({ where: { itemId: item.id } });
    assert.equal(winningTx.quantity, 7);
    assert.equal(winningTx.type, 'out');
  });
}

// ─── Rollback: forced FK violation after the stock mutation already ran ──

async function scenarioRollbackOnForcedFkViolation() {
  section('Rollback — a real FK violation inside the interactive transaction, after the stock mutation already ran, rolls back the entire transaction');
  const fixtures = await newFixtures('inv-rollback');
  const clinicId = fixtures.defaultClinicId;
  const user = await ownerUser(fixtures);
  const item = await prisma.inventoryItem.create({
    data: {
      clinicId,
      organizationId: fixtures.orgId,
      name: `Rollback Item ${randomUUID().slice(0, 8)}`,
      category: 'consumable',
      unit: 'piece',
      currentStock: 10,
      minimumStock: 0,
    },
  });
  const patient = await prisma.patient.create({
    data: { organizationId: fixtures.orgId, clinicId, firstName: 'Rollback', lastName: 'Patient', phone: '+905550001111' },
  });
  const treatmentCase = await prisma.treatmentCase.create({
    data: { clinicId, patientId: patient.id, title: 'Rollback Case' },
  });

  await test('POST out-transaction with a treatmentCaseId deleted mid-flight: stock mutation rolls back, no partial InventoryTransaction row', async () => {
    const stockBefore = (await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).currentStock;
    assert.equal(stockBefore, 10);

    const hold = await acquireManualHold(item.id, clinicId);

    // The route's pre-transaction treatmentCase lookup (before its own
    // $transaction/lock attempt) runs first and finds a still-existing row.
    const postPromise = callPostTx(item.id, user, { type: 'out', quantity: 3, treatmentCaseId: treatmentCase.id });
    await waitForWaiters(1);

    // Safe to delete now — nothing references this treatmentCaseId yet,
    // since the POST's own InventoryTransaction row hasn't been created.
    await prisma.treatmentCase.delete({ where: { id: treatmentCase.id } });

    hold.release();
    await hold.done;

    const postRes = await postPromise;

    // Deliberately-forced infra-level failure — the outer catch has no
    // specific handler for a raw Prisma FK-violation error, so it falls
    // through to the generic 500 branch. That's expected and fine here;
    // the important assertions are DB-level (full rollback), not the
    // exact HTTP status of this deliberately-manufactured failure.
    assert.equal(postRes.statusCode, 500, 'the route has no specific handler for a raw FK violation, so it falls through to the generic 500 branch');

    const dbItem = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(dbItem.currentStock, stockBefore, 'the stock mutation that ran earlier in the same interactive transaction must be rolled back along with the failed insert');

    const txCount = await prisma.inventoryTransaction.count({ where: { itemId: item.id } });
    assert.equal(txCount, 0, 'no partial InventoryTransaction row may survive a rolled-back interactive transaction');
  });
}

// ─── Configured-item missing-unit requirement (real Postgres) ────────────

async function scenarioConfiguredItemMissingUnit() {
  section('Configured-item unit requirement — POST with no unitId against a fully-configured item is rejected, no partial writes');
  const fixtures = await newFixtures('inv-missing-unit');
  const clinicId = fixtures.defaultClinicId;
  const { purchaseUnit, consumptionUnit } = await createUnits(clinicId);
  const user = await ownerUser(fixtures);
  const item = await createConfiguredItem({
    clinicId,
    organizationId: fixtures.orgId,
    purchaseUnitId: purchaseUnit.id,
    consumptionUnitId: consumptionUnit.id,
    conversionFactor: 100,
    currentStock: 5,
    minimumStock: 0,
  });

  await test('POST "in" with quantity but no unitId at all against a configured item -> 400 INVENTORY_TRANSACTION_UNIT_REQUIRED, no writes', async () => {
    const res = await callPostTx(item.id, user, { type: 'in', quantity: 2 });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'INVENTORY_TRANSACTION_UNIT_REQUIRED');

    const txCount = await prisma.inventoryTransaction.count({ where: { itemId: item.id } });
    assert.equal(txCount, 0);

    const dbItem = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
    assert.equal(dbItem.currentStock, 5, 'stock must be completely unchanged by a rejected request');
  });
}

// ─── Run ──────────────────────────────────────────────────────────────────

async function main() {
  await scenarioRace1Ordering1PutFirst();
  await scenarioRace1Ordering2PostFirst();
  await scenarioRace2Ordering1PutFirst();
  await scenarioRace2Ordering1bPutRelinksPurchaseUnit();
  await scenarioRace2Ordering2PostFirst();
  await scenarioRace3ConcurrentStockOut();
  await scenarioRollbackOnForcedFkViolation();
  await scenarioConfiguredItemMissingUnit();

  const ok = summary();
  await localCleanup();
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  await localCleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
