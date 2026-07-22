/**
 * kvkkHigh006DbClinicScopeAccess.test.ts — KVKK-HIGH-006 disposable-Postgres
 * DB-backed verification, scenarios 1-5 (clinic-scope access):
 *   1. Authorized sibling-clinic list access
 *   2. Authorized sibling-clinic detail access
 *   3. Inaccessible sibling-clinic denial
 *   4. Cross-organization denial
 *   5. Single-clinic compatibility
 *
 * Exercises the real GET /api/inventory (list) and GET /api/inventory/:id
 * (detail) routes — server/src/routes/inventory.ts — via the actual Express
 * router + real Prisma client against a real disposable PostgreSQL instance.
 * These two routes are representative of the buildClinicScopeWhere /
 * getAccessibleClinicIds pattern shared by every clinic-scoped list/detail
 * route in this codebase (payment plans, insurance provisions, services,
 * post-treatment templates, messages, etc.).
 *
 * Run: cd server && npx tsx src/tests/dbVerification/kvkkHigh006DbClinicScopeAccess.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
import inventoryRouter from '../../routes/inventory.js';
import {
  createSuite,
  createClinicFixtureSet,
  cleanupAllFixtures,
  authRequest,
  mockResponse,
  getHandlerOnly,
  prisma,
} from './dbVerificationHarness.js';

const { section, test, summary } = createSuite('DB-Clinic-Scope-Access');

async function main() {
  const fx = await createClinicFixtureSet('scope-access');

  // Seed one inventory item per clinic so list/detail results are distinguishable.
  const [defaultItem, siblingItem, unauthorizedItem, crossOrgItem] = await Promise.all([
    prisma.inventoryItem.create({ data: { clinicId: fx.defaultClinicId, organizationId: fx.orgId, name: 'Default-Clinic Item', category: 'consumable', unit: 'pcs' } }),
    prisma.inventoryItem.create({ data: { clinicId: fx.siblingClinicId, organizationId: fx.orgId, name: 'Sibling-Clinic Item', category: 'consumable', unit: 'pcs' } }),
    prisma.inventoryItem.create({ data: { clinicId: fx.unauthorizedClinicId, organizationId: fx.orgId, name: 'Unauthorized-Clinic Item', category: 'consumable', unit: 'pcs' } }),
    prisma.inventoryItem.create({ data: { clinicId: fx.crossOrgClinicId, organizationId: fx.otherOrgId, name: 'Cross-Org Item', category: 'consumable', unit: 'pcs' } }),
  ]);

  const listHandler = getHandlerOnly(inventoryRouter as any, 'get', '/inventory');
  const detailHandler = getHandlerOnly(inventoryRouter as any, 'get', '/inventory/:id');

  // Multi-clinic staff: CLINIC_MANAGER assigned to default + sibling, NOT unauthorizedClinic, NOT cross-org.
  const multiClinicUser = {
    id: 'multi-1',
    clinicId: fx.defaultClinicId,
    role: 'CLINIC_MANAGER',
    normalizedRole: 'CLINIC_MANAGER',
    organizationId: fx.orgId,
    allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId],
    canAccessAllClinics: false,
  };

  section('1. Authorized sibling-clinic list access');
  await test('multi-clinic user can list the sibling clinic\'s inventory via ?clinicId=', async () => {
    const req = authRequest(multiClinicUser, { query: { clinicId: fx.siblingClinicId } });
    const res = mockResponse();
    await listHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 200);
    const ids = (res.body as any[]).map((i) => i.id);
    assert.ok(ids.includes(siblingItem.id), 'sibling item must be present');
    assert.ok(!ids.includes(defaultItem.id), 'default-clinic item must NOT leak into a sibling-scoped list');
    assert.ok(!ids.includes(unauthorizedItem.id));
    assert.ok(!ids.includes(crossOrgItem.id));
  });

  section('2. Authorized sibling-clinic detail access');
  await test('multi-clinic user can fetch a single item that belongs to the sibling clinic', async () => {
    const req = authRequest(multiClinicUser, { params: { id: siblingItem.id } });
    const res = mockResponse();
    await detailHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.id, siblingItem.id);
  });

  section('3. Inaccessible sibling-clinic denial');
  await test('list scoped to an unassigned same-org clinic is denied (403), not silently emptied', async () => {
    const req = authRequest(multiClinicUser, { query: { clinicId: fx.unauthorizedClinicId } });
    const res = mockResponse();
    await listHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 403);
  });
  await test('detail of an item in an unassigned same-org clinic is 404 (existence not distinguishable from a bad id)', async () => {
    const req = authRequest(multiClinicUser, { params: { id: unauthorizedItem.id } });
    const res = mockResponse();
    await detailHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 404);
  });
  await test('DB verification: the unauthorized item itself was never touched (still exists, unmodified, still owned by unauthorizedClinic)', async () => {
    const row = await prisma.inventoryItem.findUnique({ where: { id: unauthorizedItem.id } });
    assert.ok(row);
    assert.equal(row!.clinicId, fx.unauthorizedClinicId);
  });

  section('4. Cross-organization denial');
  await test('list scoped to a different organization\'s clinic id is denied (403)', async () => {
    const req = authRequest(multiClinicUser, { query: { clinicId: fx.crossOrgClinicId } });
    const res = mockResponse();
    await listHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 403);
  });
  await test('detail of a cross-org item is 404 (no existence oracle across organizations)', async () => {
    const req = authRequest(multiClinicUser, { params: { id: crossOrgItem.id } });
    const res = mockResponse();
    await detailHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 404);
  });

  section('5. Single-clinic compatibility');
  const singleClinicUser = {
    id: 'single-1',
    clinicId: fx.defaultClinicId,
    role: 'RECEPTIONIST',
    normalizedRole: 'RECEPTIONIST',
    organizationId: fx.orgId,
    allowedClinicIds: [fx.defaultClinicId],
    canAccessAllClinics: false,
  };
  await test('single-clinic user, no clinicId query param → default-clinic-only list, unchanged behavior', async () => {
    const req = authRequest(singleClinicUser, { query: {} });
    const res = mockResponse();
    await listHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 200);
    const ids = (res.body as any[]).map((i) => i.id);
    assert.deepEqual(ids.sort(), [defaultItem.id].sort());
  });
  await test('single-clinic user can fetch their own clinic\'s item by id', async () => {
    const req = authRequest(singleClinicUser, { params: { id: defaultItem.id } });
    const res = mockResponse();
    await detailHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.id, defaultItem.id);
  });
  await test('single-clinic user is denied the sibling clinic even though it is same-org (never assigned)', async () => {
    const req = authRequest(singleClinicUser, { query: { clinicId: fx.siblingClinicId } });
    const res = mockResponse();
    await listHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 403);
  });

  await cleanupAllFixtures();
  const ok = summary();
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error in kvkkHigh006DbClinicScopeAccess.test.ts:', err);
  process.exit(1);
});
