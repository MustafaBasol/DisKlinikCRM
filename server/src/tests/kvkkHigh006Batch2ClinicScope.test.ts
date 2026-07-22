/**
 * kvkkHigh006Batch2ClinicScope.test.ts — KVKK-HIGH-006 Batch 2 (financial/inventory/
 * insurance) clinic-scope remediation regression tests.
 *
 * Koşturma: cd server && npx tsx src/tests/kvkkHigh006Batch2ClinicScope.test.ts
 *
 * Bug (KVKK-HIGH-006-S2 Batch 2, docs/program/evidence/
 * KVKK-HIGH-006-S2_REQ_USER_CLINIC_ID_OCCURRENCE_CLASSIFICATION.md §21 Batch 2):
 * server/src/routes/paymentPlans.ts, inventory.ts, insuranceProvisions.ts used the
 * request's single, static `req.user.clinicId` (JWT/session default clinic — a UI
 * default, not an authorization decision) directly as the tenant filter on
 * record-specific routes (detail/pay-installment/cancel, detail/update/transaction
 * create+list, detail/update/status/cancel), and offered no clinic selector at all
 * on the two creation endpoints (paymentPlans/inventory) or the insurance list route.
 * A multi-clinic-authorized user (OWNER/ORG_ADMIN, or staff with allowedClinicIds.length
 * > 1) was silently restricted to acting on only their single resolved default clinic
 * through these endpoints — a false 404 on a record that genuinely exists in a sibling
 * clinic they can access, or a create landing in the wrong clinic with no way to target
 * another.
 *
 * Fix: record-specific routes now resolve the caller's full accessible-clinic set via
 * getAccessibleClinicIds() and look the record up within that set, then use the
 * *found record's own* clinicId for every dependent read/write (Payment creation,
 * InventoryTransaction creation, ActivityLog attribution) — never re-deriving from
 * req.user.clinicId. Creation endpoints now validate an optional explicit target
 * clinicId via resolveEffectiveClinicId() (falls back to the caller's default clinic
 * when omitted — preserves existing single-clinic callers' behavior byte-for-byte).
 * The insurance list route gained a clinicId/'all' selector via
 * validateAndGetClinicIdScope(), matching its sibling routes' existing behavior in
 * paymentPlans.ts/inventory.ts.
 *
 * This suite has two parts:
 *  1. Mock-based clinic-scope simulation (mirrors treatmentCaseClinicScope.test.ts's
 *     established pattern for this exact class of fix) — no live database is
 *     available in this task's environment (no Docker/psql/.env present), so this
 *     is a disposable, synthetic, in-memory fixture only; it inline-replicates the
 *     real getAccessibleClinicIds/buildClinicIdScope/resolveEffectiveClinicId logic
 *     in server/src/utils/clinicScope.ts and the record-derived-lookup shape now
 *     used by the three route files, not a running Express/Prisma integration test.
 *  2. Source regression checks — read the three actual route files and assert, by
 *     exact substring/pattern, that every one of the 15 previously-raw
 *     `req.user.clinicId` occurrences named in the S2 evidence file has been
 *     migrated off `req.user!.clinicId` at that call site.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ─── Test harness (same shape as treatmentCaseClinicScope.test.ts) ──────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
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

// ─── clinicScope.ts mantığının inline kopyası (gerçek modülle aynı) ─────────

type User = {
  id: string;
  clinicId: string; // defaultClinicId — sadece UI varsayılanı, YETKİLENDİRME değil
  organizationId: string;
  allowedClinicIds: string[];
  canAccessAllClinics: boolean;
};

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    clinicId: 'clinic-A',
    organizationId: 'org-1',
    allowedClinicIds: ['clinic-A'],
    canAccessAllClinics: false,
    ...overrides,
  };
}

let mockOrgClinics: { id: string; organizationId: string }[] = [];

async function dbFindOrgClinics(organizationId: string) {
  return mockOrgClinics.filter((c) => c.organizationId === organizationId).map((c) => ({ id: c.id }));
}

async function dbFindClinic(clinicId: string, organizationId: string) {
  return mockOrgClinics.find((c) => c.id === clinicId && c.organizationId === organizationId) ?? null;
}

async function getAccessibleClinicIds(user: User): Promise<string[]> {
  if (user.canAccessAllClinics) {
    const clinics = await dbFindOrgClinics(user.organizationId);
    return clinics.map((c) => c.id);
  }
  return user.allowedClinicIds;
}

async function buildClinicIdScope(user: User, selectedClinicId: string | undefined) {
  if (selectedClinicId && selectedClinicId !== 'all') {
    const clinic = await dbFindClinic(selectedClinicId, user.organizationId);
    if (!clinic) return null; // farklı organizasyon → 403
    if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(selectedClinicId)) return null;
    return { clinicId: selectedClinicId };
  }
  if (user.canAccessAllClinics) {
    const clinics = await dbFindOrgClinics(user.organizationId);
    return { clinicId: { in: clinics.map((c) => c.id) } };
  }
  if (user.allowedClinicIds.length === 0) return null;
  return { clinicId: { in: user.allowedClinicIds } };
}

async function validateAndGetClinicIdScope(user: User, selectedClinicId: string | undefined) {
  const scope = await buildClinicIdScope(user, selectedClinicId);
  if (scope === null) return { denied: true as const, status: 403 };
  return { denied: false as const, scope };
}

async function resolveEffectiveClinicId(user: User, requestedClinicId?: string): Promise<string | null> {
  const clinicId = requestedClinicId ?? user.clinicId;
  const clinic = await dbFindClinic(clinicId, user.organizationId);
  if (!clinic) return null;
  if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(clinicId)) return null;
  return clinicId;
}

function idsFromScope(scope: { clinicId: string } | { clinicId: { in: string[] } }): string[] {
  return typeof scope.clinicId === 'string' ? [scope.clinicId] : scope.clinicId.in;
}

// ─── Domain fixtures (disposable, in-memory only) ───────────────────────────

type PaymentPlan = { id: string; clinicId: string; status: string; totalAmount: number; installments: { id: string; status: string; amount: number }[] };
type InventoryItem = { id: string; clinicId: string; currentStock: number };
type InventoryTransaction = { id: string; itemId: string; clinicId: string; type: string; quantity: number };
type InsuranceProvision = { id: string; clinicId: string; status: string; requestedAmount: number };

let mockPaymentPlans: PaymentPlan[] = [];
let mockInventoryItems: InventoryItem[] = [];
let mockInventoryTransactions: InventoryTransaction[] = [];
let mockInsuranceProvisions: InsuranceProvision[] = [];

async function dbFindPaymentPlan(id: string, clinicIdFilter: string | { in: string[] }) {
  const ids = typeof clinicIdFilter === 'string' ? [clinicIdFilter] : clinicIdFilter.in;
  return mockPaymentPlans.find((p) => p.id === id && ids.includes(p.clinicId)) ?? null;
}

async function dbFindInventoryItem(id: string, clinicIdFilter: string | { in: string[] }) {
  const ids = typeof clinicIdFilter === 'string' ? [clinicIdFilter] : clinicIdFilter.in;
  return mockInventoryItems.find((i) => i.id === id && ids.includes(i.clinicId)) ?? null;
}

async function dbFindInsuranceProvision(id: string, clinicIdFilter: string | { in: string[] }) {
  const ids = typeof clinicIdFilter === 'string' ? [clinicIdFilter] : clinicIdFilter.in;
  return mockInsuranceProvisions.find((p) => p.id === id && ids.includes(p.clinicId)) ?? null;
}

// ─── Route handler simulations (mirror the fixed route code exactly) ───────

// paymentPlans.ts GET /:id (FIXED)
async function simPaymentPlanDetail(user: User, id: string) {
  const accessibleIds = await getAccessibleClinicIds(user);
  if (accessibleIds.length === 0) return { status: 403 };
  const plan = await dbFindPaymentPlan(id, { in: accessibleIds });
  if (!plan) return { status: 404 };
  return { status: 200, data: plan };
}

// paymentPlans.ts POST / (FIXED) — returns the resolved target clinic
async function simPaymentPlanCreate(user: User, requestedClinicId?: string) {
  const clinicId = await resolveEffectiveClinicId(user, requestedClinicId);
  if (!clinicId) return { status: 403 };
  const plan: PaymentPlan = { id: `plan-${mockPaymentPlans.length + 1}`, clinicId, status: 'active', totalAmount: 1200, installments: [] };
  mockPaymentPlans.push(plan);
  return { status: 201, data: plan };
}

// paymentPlans.ts POST /:id/installments/:installmentId/pay (FIXED)
async function simPayInstallment(user: User, planId: string, installmentId: string) {
  const accessibleIds = await getAccessibleClinicIds(user);
  if (accessibleIds.length === 0) return { status: 403 };
  const plan = await dbFindPaymentPlan(planId, { in: accessibleIds });
  if (!plan) return { status: 404 };
  const installment = plan.installments.find((i) => i.id === installmentId);
  if (!installment) return { status: 404 };
  const paymentClinicId = plan.clinicId; // written using the PLAN'S OWN clinic, not req.user.clinicId
  return { status: 200, paymentClinicId };
}

// paymentPlans.ts PATCH /:id/cancel (FIXED)
async function simCancelPaymentPlan(user: User, id: string) {
  const accessibleIds = await getAccessibleClinicIds(user);
  if (accessibleIds.length === 0) return { status: 403 };
  const plan = await dbFindPaymentPlan(id, { in: accessibleIds });
  if (!plan) return { status: 404 };
  const auditClinicId = plan.clinicId;
  return { status: 200, auditClinicId };
}

// inventory.ts GET /:id (FIXED)
async function simInventoryDetail(user: User, id: string) {
  const accessibleIds = await getAccessibleClinicIds(user);
  if (accessibleIds.length === 0) return { status: 403 };
  const item = await dbFindInventoryItem(id, { in: accessibleIds });
  if (!item) return { status: 404 };
  return { status: 200, data: item };
}

// inventory.ts POST / (FIXED)
async function simInventoryCreate(user: User, requestedClinicId?: string) {
  const clinicId = await resolveEffectiveClinicId(user, requestedClinicId);
  if (!clinicId) return { status: 403 };
  const item: InventoryItem = { id: `item-${mockInventoryItems.length + 1}`, clinicId, currentStock: 0 };
  mockInventoryItems.push(item);
  return { status: 201, data: item };
}

// inventory.ts POST /:id/transactions (FIXED) — stock math + transaction stamped with item's own clinicId
async function simInventoryTransactionCreate(user: User, itemId: string, quantity: number) {
  const accessibleIds = await getAccessibleClinicIds(user);
  if (accessibleIds.length === 0) return { status: 403 };
  const item = await dbFindInventoryItem(itemId, { in: accessibleIds });
  if (!item) return { status: 404 };
  const clinicId = item.clinicId;
  const newStock = item.currentStock + quantity;
  const transaction: InventoryTransaction = { id: `txn-${mockInventoryTransactions.length + 1}`, itemId, clinicId, type: 'in', quantity };
  mockInventoryTransactions.push(transaction);
  item.currentStock = newStock;
  return { status: 201, transaction, newStock };
}

// inventory.ts GET /:id/transactions (FIXED) — list scoped to item's own clinicId
async function simInventoryTransactionList(user: User, itemId: string) {
  const accessibleIds = await getAccessibleClinicIds(user);
  if (accessibleIds.length === 0) return { status: 403 };
  const item = await dbFindInventoryItem(itemId, { in: accessibleIds });
  if (!item) return { status: 404 };
  const transactions = mockInventoryTransactions.filter((t) => t.itemId === itemId && t.clinicId === item.clinicId);
  return { status: 200, transactions };
}

// insuranceProvisions.ts GET / (FIXED) — list gained a clinicId/'all' selector
async function simInsuranceList(user: User, selectedClinicId: string | undefined) {
  const result = await validateAndGetClinicIdScope(user, selectedClinicId);
  if (result.denied) return { status: 403 };
  const ids = idsFromScope(result.scope);
  const rows = mockInsuranceProvisions.filter((p) => ids.includes(p.clinicId));
  return { status: 200, rows };
}

// insuranceProvisions.ts GET /:id (FIXED)
async function simInsuranceDetail(user: User, id: string) {
  const accessibleIds = await getAccessibleClinicIds(user);
  if (accessibleIds.length === 0) return { status: 403 };
  const provision = await dbFindInsuranceProvision(id, { in: accessibleIds });
  if (!provision) return { status: 404 };
  return { status: 200, data: provision };
}

// insuranceProvisions.ts POST / (FIXED)
async function simInsuranceCreate(user: User, requestedClinicId?: string) {
  const clinicId = await resolveEffectiveClinicId(user, requestedClinicId);
  if (!clinicId) return { status: 403 };
  const provision: InsuranceProvision = { id: `ins-${mockInsuranceProvisions.length + 1}`, clinicId, status: 'draft', requestedAmount: 500 };
  mockInsuranceProvisions.push(provision);
  return { status: 201, data: provision };
}

// insuranceProvisions.ts PATCH /:id/status and /:id/cancel (FIXED) — audit uses record's own clinicId
async function simInsuranceStatusChange(user: User, id: string, newStatus: string) {
  const accessibleIds = await getAccessibleClinicIds(user);
  if (accessibleIds.length === 0) return { status: 403 };
  const provision = await dbFindInsuranceProvision(id, { in: accessibleIds });
  if (!provision) return { status: 404 };
  const auditClinicId = provision.clinicId;
  provision.status = newStatus;
  return { status: 200, auditClinicId };
}

// ─── Fixture setup ───────────────────────────────────────────────────────────
// Org-1: Clinic A (JWT/default clinic), Clinic B (assigned only via allowedClinicIds)
// Org-2: Clinic X (different organization)

function resetFixtures() {
  mockOrgClinics = [
    { id: 'clinic-A', organizationId: 'org-1' },
    { id: 'clinic-B', organizationId: 'org-1' },
    { id: 'clinic-X', organizationId: 'org-2' },
  ];
  mockPaymentPlans = [
    { id: 'plan-B-1', clinicId: 'clinic-B', status: 'active', totalAmount: 3000, installments: [{ id: 'inst-1', status: 'pending', amount: 1000 }] },
    { id: 'plan-A-1', clinicId: 'clinic-A', status: 'active', totalAmount: 1000, installments: [{ id: 'inst-2', status: 'pending', amount: 1000 }] },
    { id: 'plan-X-1', clinicId: 'clinic-X', status: 'active', totalAmount: 5000, installments: [] },
  ];
  mockInventoryItems = [
    { id: 'item-B-1', clinicId: 'clinic-B', currentStock: 10 },
    { id: 'item-A-1', clinicId: 'clinic-A', currentStock: 5 },
    { id: 'item-X-1', clinicId: 'clinic-X', currentStock: 20 },
  ];
  mockInventoryTransactions = [];
  mockInsuranceProvisions = [
    { id: 'ins-B-1', clinicId: 'clinic-B', status: 'draft', requestedAmount: 800 },
    { id: 'ins-A-1', clinicId: 'clinic-A', status: 'draft', requestedAmount: 400 },
    { id: 'ins-X-1', clinicId: 'clinic-X', status: 'draft', requestedAmount: 900 },
  ];
}

resetFixtures();

// ─── 1. Mock-based clinic-scope behavior ────────────────────────────────────

section('paymentPlans.ts — detail (record-derived scope, FIXED)');

await test('1. Single-clinic compatibility: user assigned only to Clinic A sees their own plan', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simPaymentPlanDetail(user, 'plan-A-1');
  assert.equal(res.status, 200);
});

await test('2. Allowed sibling clinic: JWT default is A, but plan lives in accessible Clinic B — succeeds (was the bug: 404)', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simPaymentPlanDetail(user, 'plan-B-1');
  assert.equal(res.status, 200, 'multi-clinic-authorized user must be able to reach a plan in a sibling clinic they are assigned to');
});

await test('3. Denied unassigned clinic: user assigned only to Clinic A cannot reach Clinic B\'s plan', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simPaymentPlanDetail(user, 'plan-B-1');
  assert.equal(res.status, 404);
});

await test('4. OWNER/ORG_ADMIN all-clinic: canAccessAllClinics sees plans in every org clinic', async () => {
  const owner = makeUser({ canAccessAllClinics: true, allowedClinicIds: [] });
  const resB = await simPaymentPlanDetail(owner, 'plan-B-1');
  const resA = await simPaymentPlanDetail(owner, 'plan-A-1');
  assert.equal(resB.status, 200);
  assert.equal(resA.status, 200);
});

await test('5. Cross-organization denial: org-1 OWNER cannot reach org-2\'s plan even with canAccessAllClinics', async () => {
  const owner = makeUser({ canAccessAllClinics: true, allowedClinicIds: [], organizationId: 'org-1' });
  const res = await simPaymentPlanDetail(owner, 'plan-X-1');
  assert.equal(res.status, 404, 'cross-org record must never be reachable, regardless of canAccessAllClinics');
});

await test('8. No clinic access: allowedClinicIds=[] is denied outright (403, not a narrowed empty result)', async () => {
  const user = makeUser({ allowedClinicIds: [] });
  const res = await simPaymentPlanDetail(user, 'plan-A-1');
  assert.equal(res.status, 403);
});

section('paymentPlans.ts — create (optional explicit target clinic, FIXED)');

await test('6. Missing clinic selector (omitted): falls back to the caller\'s own default clinic — backward compatible', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simPaymentPlanCreate(user, undefined);
  assert.equal(res.status, 201);
  assert.equal(res.data!.clinicId, 'clinic-A');
});

await test('9. Created records use the validated target clinic: explicit sibling Clinic B succeeds and is stamped B, not the JWT default A', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simPaymentPlanCreate(user, 'clinic-B');
  assert.equal(res.status, 201);
  assert.equal(res.data!.clinicId, 'clinic-B');
});

await test('3b. Denied unassigned target clinic on create: explicit Clinic B rejected when not assigned to it', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simPaymentPlanCreate(user, 'clinic-B');
  assert.equal(res.status, 403);
});

await test('7. Invalid clinic selector: a well-formed but nonexistent/foreign-org clinic id is rejected, not a 500 or silent success', async () => {
  const owner = makeUser({ canAccessAllClinics: true, allowedClinicIds: [], organizationId: 'org-1' });
  const res = await simPaymentPlanCreate(owner, 'clinic-does-not-exist');
  assert.equal(res.status, 403);
  const resCrossOrg = await simPaymentPlanCreate(owner, 'clinic-X');
  assert.equal(resCrossOrg.status, 403, 'a real clinic id belonging to another organization must still be rejected');
});

section('paymentPlans.ts — installment payment and cancel use the PLAN\'S OWN clinicId (FIXED)');

await test('10. Installment payment write uses the plan\'s own clinicId, not req.user.clinicId', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simPayInstallment(user, 'plan-B-1', 'inst-1');
  assert.equal(res.status, 200);
  assert.equal(res.paymentClinicId, 'clinic-B', 'Payment row must be stamped with the plan\'s real clinic (B), not the caller\'s default clinic (A)');
});

await test('11. Cancellation audit write uses the plan\'s own clinicId', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simCancelPaymentPlan(user, 'plan-B-1');
  assert.equal(res.status, 200);
  assert.equal(res.auditClinicId, 'clinic-B');
});

await test('Record outside scope cannot be mutated: installment-pay/cancel 404 for an inaccessible clinic\'s plan', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const payRes = await simPayInstallment(user, 'plan-B-1', 'inst-1');
  assert.equal(payRes.status, 404);
  const cancelRes = await simCancelPaymentPlan(user, 'plan-B-1');
  assert.equal(cancelRes.status, 404);
});

section('inventory.ts — detail/update (record-derived scope, FIXED)');

await test('Single-clinic compatibility: Clinic A user reads their own item', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simInventoryDetail(user, 'item-A-1');
  assert.equal(res.status, 200);
});

await test('Allowed sibling clinic: multi-clinic user reaches Clinic B\'s item (was 404)', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simInventoryDetail(user, 'item-B-1');
  assert.equal(res.status, 200);
});

await test('Denied unassigned clinic + cross-org denial for inventory detail', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simInventoryDetail(user, 'item-B-1');
  assert.equal(res.status, 404);

  const owner = makeUser({ canAccessAllClinics: true, allowedClinicIds: [], organizationId: 'org-1' });
  const crossOrg = await simInventoryDetail(owner, 'item-X-1');
  assert.equal(crossOrg.status, 404);
});

section('inventory.ts — create (optional explicit target clinic, FIXED)');

await test('Missing selector falls back to caller default; explicit sibling clinic is honored; disallowed clinic is denied', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });

  const implicit = await simInventoryCreate(user, undefined);
  assert.equal(implicit.status, 201);
  assert.equal(implicit.data!.clinicId, 'clinic-A');

  const explicit = await simInventoryCreate(user, 'clinic-B');
  assert.equal(explicit.status, 201);
  assert.equal(explicit.data!.clinicId, 'clinic-B', 'created inventory item must use the validated target clinic');

  const singleClinicUser = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const denied = await simInventoryCreate(singleClinicUser, 'clinic-B');
  assert.equal(denied.status, 403);
});

section('inventory.ts — stock transactions use the ITEM\'S OWN clinicId, and stock totals exclude inaccessible clinics (FIXED)');

await test('Transaction create is stamped with the item\'s own clinicId, not the caller\'s default clinic', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simInventoryTransactionCreate(user, 'item-B-1', 4);
  assert.equal(res.status, 201);
  assert.equal(res.transaction!.clinicId, 'clinic-B');
  assert.equal(res.newStock, 14, 'stock math must be computed from the item\'s own current stock, unaffected by the caller\'s default clinic');
});

await test('Transaction create denied for an inaccessible clinic\'s item (never touches its stock)', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const stockBefore = mockInventoryItems.find((i) => i.id === 'item-B-1')!.currentStock;
  const res = await simInventoryTransactionCreate(user, 'item-B-1', 100);
  assert.equal(res.status, 404);
  const stockAfter = mockInventoryItems.find((i) => i.id === 'item-B-1')!.currentStock;
  assert.equal(stockAfter, stockBefore, 'a denied transaction attempt must never mutate the inaccessible item\'s stock');
});

await test('Transaction list scoped to the item\'s own clinicId excludes another clinic\'s transactions on the same item id namespace', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simInventoryTransactionList(user, 'item-B-1');
  assert.equal(res.status, 200);
  assert.ok(res.transactions!.every((t) => t.clinicId === 'clinic-B'));
});

await test('Financial/stock totals do not include inaccessible clinics: a Clinic-A-only user\'s accessible stock never includes Clinic B or Clinic X items', async () => {
  resetFixtures(); // isolate from prior tests' create-route side effects on the shared mock arrays
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const accessibleIds = await getAccessibleClinicIds(user);
  const visibleItems = mockInventoryItems.filter((i) => accessibleIds.includes(i.clinicId));
  assert.deepEqual(visibleItems.map((i) => i.id).sort(), ['item-A-1']);
});

section('insuranceProvisions.ts — list gains a clinicId/\'all\' selector (FIXED, previously had none)');

await test('Missing selector: single-clinic user sees only their own clinic\'s provisions (backward compatible)', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simInsuranceList(user, undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(res.rows!.map((r) => r.id), ['ins-A-1']);
});

await test('OWNER/ORG_ADMIN all-clinic: \'all\'/no selector returns every org clinic\'s provisions, and financial totals exclude inaccessible clinics', async () => {
  const owner = makeUser({ canAccessAllClinics: true, allowedClinicIds: [], organizationId: 'org-1' });
  const res = await simInsuranceList(owner, 'all');
  assert.equal(res.status, 200);
  const ids = res.rows!.map((r) => r.id).sort();
  assert.deepEqual(ids, ['ins-A-1', 'ins-B-1']);
  assert.ok(!ids.includes('ins-X-1'), 'org-2\'s provision must never appear in an org-1 owner\'s "all" view');
  const total = res.rows!.reduce((sum, r) => sum + r.requestedAmount, 0);
  assert.equal(total, 400 + 800, 'requestedAmount total must reflect only the accessible clinics\' provisions');
});

await test('Explicit sibling clinic selector succeeds for an assigned multi-clinic user; disallowed clinic selector is denied', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const okB = await simInsuranceList(user, 'clinic-B');
  assert.equal(okB.status, 200);
  assert.deepEqual(okB.rows!.map((r) => r.id), ['ins-B-1']);

  const singleClinicUser = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const denied = await simInsuranceList(singleClinicUser, 'clinic-B');
  assert.equal(denied.status, 403);
});

await test('Invalid clinic selector (nonexistent / cross-org) is rejected, not a 500 or empty-but-200', async () => {
  const owner = makeUser({ canAccessAllClinics: true, allowedClinicIds: [], organizationId: 'org-1' });
  const bogus = await simInsuranceList(owner, 'clinic-does-not-exist');
  assert.equal(bogus.status, 403);
  const crossOrg = await simInsuranceList(owner, 'clinic-X');
  assert.equal(crossOrg.status, 403);
});

section('insuranceProvisions.ts — detail/create/status/cancel (record-derived scope + validated create target, FIXED)');

await test('Detail: allowed sibling clinic succeeds, unassigned clinic denied, cross-org denied', async () => {
  const multiUser = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const ok = await simInsuranceDetail(multiUser, 'ins-B-1');
  assert.equal(ok.status, 200);

  const singleUser = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const denied = await simInsuranceDetail(singleUser, 'ins-B-1');
  assert.equal(denied.status, 404);

  const owner = makeUser({ canAccessAllClinics: true, allowedClinicIds: [], organizationId: 'org-1' });
  const crossOrg = await simInsuranceDetail(owner, 'ins-X-1');
  assert.equal(crossOrg.status, 404);
});

await test('Create: validated target clinic is used, omitted selector preserves default-clinic behavior', async () => {
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const implicit = await simInsuranceCreate(user, undefined);
  assert.equal(implicit.data!.clinicId, 'clinic-A');
  const explicit = await simInsuranceCreate(user, 'clinic-B');
  assert.equal(explicit.data!.clinicId, 'clinic-B');
});

await test('Status change and cancel use the PROVISION\'S OWN clinicId for audit attribution, and are denied for an inaccessible clinic\'s record', async () => {
  const multiUser = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const statusRes = await simInsuranceStatusChange(multiUser, 'ins-B-1', 'approved');
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.auditClinicId, 'clinic-B');

  const singleUser = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const denied = await simInsuranceStatusChange(singleUser, 'ins-B-1', 'approved');
  assert.equal(denied.status, 404);
});

// ─── 2. Source regression checks ────────────────────────────────────────────
// Confirms every occurrence named in KVKK-HIGH-006-S2 §21 Batch 2 was actually
// migrated off req.user!.clinicId at that specific call site, not merely that
// the helper is imported somewhere in the file.

section('Source regression checks — no remaining raw req.user!.clinicId at the fixed call sites');

const paymentPlansSrc = src('../routes/paymentPlans.ts');
const inventorySrc = src('../routes/inventory.ts');
const insuranceProvisionsSrc = src('../routes/insuranceProvisions.ts');

await test('paymentPlans.ts imports getAccessibleClinicIds and resolveEffectiveClinicId', () => {
  assert.match(paymentPlansSrc, /import\s*\{[^}]*getAccessibleClinicIds[^}]*\}\s*from\s*'\.\.\/utils\/clinicScope\.js'/);
  assert.match(paymentPlansSrc, /import\s*\{[^}]*resolveEffectiveClinicId[^}]*\}\s*from\s*'\.\.\/utils\/clinicScope\.js'/);
});

await test('paymentPlans.ts GET /:id no longer reads req.user!.clinicId as the sole gate', () => {
  const detailBlock = paymentPlansSrc.slice(paymentPlansSrc.indexOf("router.get('/payment-plans/:id'"), paymentPlansSrc.indexOf("router.post('/payment-plans',"));
  assert.ok(!detailBlock.includes('req.user!.clinicId'), 'detail route must not read req.user!.clinicId directly');
  assert.ok(detailBlock.includes('getAccessibleClinicIds'));
});

await test('paymentPlans.ts create/pay-installment/cancel routes use the helpers, not req.user!.clinicId', () => {
  const createBlock = paymentPlansSrc.slice(paymentPlansSrc.indexOf("router.post('/payment-plans',"), paymentPlansSrc.indexOf("router.post(\n  '/payment-plans/:id/installments"));
  assert.ok(!createBlock.includes('req.user!.clinicId'));
  assert.ok(createBlock.includes('resolveEffectiveClinicId'));

  const payBlock = paymentPlansSrc.slice(paymentPlansSrc.indexOf("/installments/:installmentId/pay'"), paymentPlansSrc.indexOf("router.patch('/payment-plans/:id/cancel'"));
  assert.ok(!payBlock.includes('req.user!.clinicId'));
  assert.ok(payBlock.includes('getAccessibleClinicIds'));

  const cancelBlock = paymentPlansSrc.slice(paymentPlansSrc.indexOf("router.patch('/payment-plans/:id/cancel'"));
  assert.ok(!cancelBlock.includes('req.user!.clinicId'));
  assert.ok(cancelBlock.includes('getAccessibleClinicIds'));
});

await test('inventory.ts imports getAccessibleClinicIds and resolveEffectiveClinicId', () => {
  assert.match(inventorySrc, /import\s*\{[^}]*getAccessibleClinicIds[^}]*\}\s*from\s*'\.\.\/utils\/clinicScope\.js'/);
  assert.match(inventorySrc, /import\s*\{[^}]*resolveEffectiveClinicId[^}]*\}\s*from\s*'\.\.\/utils\/clinicScope\.js'/);
});

await test('inventory.ts detail/create/update/transaction routes no longer read req.user!.clinicId', () => {
  const afterAlerts = inventorySrc.slice(inventorySrc.indexOf("router.get('/inventory/:id',"));
  assert.ok(!afterAlerts.includes('req.user!.clinicId'), 'no record-derived or create route in inventory.ts should read req.user!.clinicId anymore');
  assert.ok(afterAlerts.includes('getAccessibleClinicIds'));
  assert.ok(afterAlerts.includes('resolveEffectiveClinicId'));
});

await test('inventory.ts list/alerts routes are unchanged (still use validateAndGetScope, out of Batch 2 scope)', () => {
  const beforeDetail = inventorySrc.slice(0, inventorySrc.indexOf("router.get('/inventory/:id',"));
  assert.ok(beforeDetail.includes('validateAndGetScope'));
});

await test('insuranceProvisions.ts now imports the clinicScope helpers (previously imported none)', () => {
  assert.match(insuranceProvisionsSrc, /import\s*\{[^}]*validateAndGetClinicIdScope[^}]*getAccessibleClinicIds[^}]*resolveEffectiveClinicId[^}]*\}\s*from\s*'\.\.\/utils\/clinicScope\.js'/);
});

await test('insuranceProvisions.ts has zero remaining req.user!.clinicId occurrences (all 6 fixed)', () => {
  assert.ok(!insuranceProvisionsSrc.includes('req.user!.clinicId'), 'every one of the 6 S2-classified occurrences in this file must be migrated');
});

await test('insuranceProvisions.ts list route now supports a clinicId/\'all\' selector (previously had none)', () => {
  const listBlock = insuranceProvisionsSrc.slice(insuranceProvisionsSrc.indexOf("router.get('/insurance-provisions',"), insuranceProvisionsSrc.indexOf("router.get('/insurance-provisions/:id',"));
  assert.ok(listBlock.includes('validateAndGetClinicIdScope'));
  assert.ok(listBlock.includes("req.query.clinicId"));
});

// ─── Sonuç ───────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Toplam: ${passed + failed} test | Geçen: ${passed} | Başarısız: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız!`);
  process.exit(1);
} else {
  console.log('\nTüm KVKK-HIGH-006 Batch 2 klinik kapsamı testleri geçti!');
}
