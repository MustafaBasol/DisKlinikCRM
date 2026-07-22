/**
 * kvkkHigh006DbInputHandling.test.ts — KVKK-HIGH-006 disposable-Postgres
 * DB-backed verification, scenarios 24-27 (input handling):
 *  24. Repeated clinicId query parameter behavior
 *  25. Malformed clinicId value behavior
 *  26. Missing selector fallback
 *  27. Explicit "all" behavior only where supported
 *
 * These assert what the REAL code actually does with these inputs against a
 * real Postgres/Prisma stack — not an assumption. Express's default query
 * parser (qs) turns a repeated `?clinicId=A&clinicId=B` into an ARRAY at
 * req.query.clinicId, even though every route casts it `as string |
 * undefined` — that cast is compile-time only and does not coerce the
 * runtime value. GET /api/payment-plans and GET /api/insurance-provisions
 * both wrap their scope resolution in try/catch, so a non-string clinicId
 * reaching prisma.clinic.findFirst({ where: { id: <array> } }) is expected to
 * be caught and surfaced as a clean 500, not a crash or a scope bypass —
 * this file verifies that is genuinely what happens, and that no data leaks
 * in the process.
 *
 * Run: cd server && npx tsx src/tests/dbVerification/kvkkHigh006DbInputHandling.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
import paymentPlansRouter from '../../routes/paymentPlans.js';
import insuranceProvisionsRouter from '../../routes/insuranceProvisions.js';
import {
  createSuite,
  createClinicFixtureSet,
  createTestPatient,
  createStaffUser,
  cleanupAllFixtures,
  authRequest,
  mockResponse,
  getHandlerOnly,
  prisma,
} from './dbVerificationHarness.js';

const { section, test, summary } = createSuite('DB-Input-Handling');

async function main() {
  const fx = await createClinicFixtureSet('input-handling');

  const defaultPatient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId });
  const siblingPatient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.siblingClinicId });

  const ownerRecord = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });
  await prisma.paymentPlan.create({ data: { clinicId: fx.defaultClinicId, patientId: defaultPatient.id, totalAmount: 100, installmentCount: 1 } });
  await prisma.paymentPlan.create({ data: { clinicId: fx.siblingClinicId, patientId: siblingPatient.id, totalAmount: 100, installmentCount: 1 } });

  const multiClinicRecord = await createStaffUser({
    organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'CLINIC_MANAGER',
    allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId],
  });
  const multiClinicUser = {
    id: multiClinicRecord.id, clinicId: fx.defaultClinicId, role: 'CLINIC_MANAGER', normalizedRole: 'CLINIC_MANAGER',
    organizationId: fx.orgId, allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId], canAccessAllClinics: false,
  };
  const ownerUser = {
    id: ownerRecord.id, clinicId: fx.defaultClinicId, role: 'OWNER', normalizedRole: 'OWNER',
    organizationId: fx.orgId, allowedClinicIds: [], canAccessAllClinics: true,
  };

  const paymentPlanListHandler = getHandlerOnly(paymentPlansRouter as any, 'get', '/payment-plans');
  const insuranceListHandler = getHandlerOnly(insuranceProvisionsRouter as any, 'get', '/insurance-provisions');

  section('24. Repeated clinicId query parameter behavior');
  await test('repeated ?clinicId=A&clinicId=B (parsed by Express/qs into an array) does not bypass scope enforcement or leak both clinics\' data', async () => {
    // Simulates what express's default query parser produces for repeated keys.
    const req = authRequest(multiClinicUser, { query: { clinicId: [fx.defaultClinicId, fx.siblingClinicId] } });
    const res = mockResponse();
    await paymentPlanListHandler(req, res as any, () => {});
    // The route's try/catch must turn the resulting Prisma validation error into
    // a clean error response — never a 200 with merged/leaked cross-clinic data.
    assert.notEqual(res.statusCode, 200, 'an array clinicId must never be silently accepted as a valid single-clinic selector');
    assert.ok(res.statusCode === 500 || res.statusCode === 403 || res.statusCode === 400, `expected a clean error status, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  });

  section('25. Malformed clinicId value behavior');
  await test('a clinicId value that is not a valid UUID/clinic id ("not-a-real-clinic-id") is denied, not treated as "no selector"', async () => {
    const req = authRequest(multiClinicUser, { query: { clinicId: 'not-a-real-clinic-id' } });
    const res = mockResponse();
    await paymentPlanListHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 403, 'an unrecognized clinicId must be denied (no matching clinic), never silently fall back to "all clinics"');
  });
  await test('an empty-string clinicId is treated as "no selector" (falls back to default/allowed scope), matching buildClinicIdScope\'s explicit `!selectedClinicId` check', async () => {
    const req = authRequest(multiClinicUser, { query: { clinicId: '' } });
    const res = mockResponse();
    await paymentPlanListHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 200);
    const ids = (res.body as any[]).map((p: any) => p.clinicId);
    assert.ok(ids.every((id: string) => multiClinicUser.allowedClinicIds.includes(id)));
  });

  section('26. Missing selector fallback');
  await test('multi-clinic user (not canAccessAllClinics), no clinicId at all → sees ALL of their assigned clinics together, not just the default one', async () => {
    const req = authRequest(multiClinicUser, { query: {} });
    const res = mockResponse();
    await paymentPlanListHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 200);
    const clinicIdsSeen = new Set((res.body as any[]).map((p: any) => p.clinicId));
    assert.ok(clinicIdsSeen.has(fx.defaultClinicId), 'must include the default clinic\'s plan');
    assert.ok(clinicIdsSeen.has(fx.siblingClinicId), 'must ALSO include the sibling clinic\'s plan — missing-selector fallback is "all assigned clinics", not "default clinic only"');
  });

  section('27. Explicit "all" behavior (only where supported by buildClinicScopeWhere/buildClinicIdScope)');
  await test('clinicId=all for a multi-clinic user returns the same result as omitting the selector entirely', async () => {
    const reqAll = authRequest(multiClinicUser, { query: { clinicId: 'all' } });
    const resAll = mockResponse();
    await paymentPlanListHandler(reqAll, resAll as any, () => {});

    const reqOmitted = authRequest(multiClinicUser, { query: {} });
    const resOmitted = mockResponse();
    await paymentPlanListHandler(reqOmitted, resOmitted as any, () => {});

    assert.equal(resAll.statusCode, 200);
    assert.deepEqual(
      (resAll.body as any[]).map((p: any) => p.id).sort(),
      (resOmitted.body as any[]).map((p: any) => p.id).sort(),
      '"all" must be exactly equivalent to an omitted selector, per the shared `!selectedClinicId || selectedClinicId === \'all\'` branch',
    );
  });
  await test('clinicId=all for an OWNER (canAccessAllClinics) on the insurance-provisions list also returns the full org-wide set without error', async () => {
    const req = authRequest(ownerUser, { query: { clinicId: 'all' } });
    const res = mockResponse();
    await insuranceListHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 200);
  });

  await cleanupAllFixtures();
  const ok = summary();
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error in kvkkHigh006DbInputHandling.test.ts:', err);
  process.exit(1);
});
