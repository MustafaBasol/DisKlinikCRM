/**
 * kvkkHigh006DbInsuranceListBehavior.test.ts — KVKK-HIGH-006 disposable-Postgres
 * DB-backed verification, scenarios 16-18 (insurance list behavior, GET
 * /api/insurance-provisions → buildClinicIdScope in server/src/utils/clinicScope.ts):
 *  16. canAccessAllClinics caller with omitted selector receives all authorized
 *      organization clinics
 *  17. Single-clinic caller with omitted selector retains default-clinic behavior
 *  18. Explicit unauthorized selector is denied
 *
 * Run: cd server && npx tsx src/tests/dbVerification/kvkkHigh006DbInsuranceListBehavior.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
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

const { section, test, summary } = createSuite('DB-Insurance-List-Behavior');

async function main() {
  const fx = await createClinicFixtureSet('insurance-list');

  const defaultPatient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId });
  const siblingPatient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.siblingClinicId });
  const unauthorizedPatient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.unauthorizedClinicId });

  const ownerUser = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER', canAccessAllClinics: true });

  async function makeProvision(clinicId: string, patientId: string, createdById: string) {
    return prisma.insuranceProvision.create({
      data: { clinicId, patientId, insuranceProviderName: 'Test Insurer', insuranceType: 'private', requestedAmount: 10, createdById },
    });
  }

  const provDefault = await makeProvision(fx.defaultClinicId, defaultPatient.id, ownerUser.id);
  const provSibling = await makeProvision(fx.siblingClinicId, siblingPatient.id, ownerUser.id);
  const provUnauthorized = await makeProvision(fx.unauthorizedClinicId, unauthorizedPatient.id, ownerUser.id);

  const listHandler = getHandlerOnly(insuranceProvisionsRouter as any, 'get', '/insurance-provisions');

  section('16. canAccessAllClinics caller, omitted selector → all authorized organization clinics');
  await test('OWNER (canAccessAllClinics=true), no clinicId query param → sees default + sibling + unauthorized (all in-org clinics), not the cross-org one', async () => {
    const owner = {
      id: ownerUser.id, clinicId: fx.defaultClinicId, role: 'OWNER', normalizedRole: 'OWNER',
      organizationId: fx.orgId, allowedClinicIds: [], canAccessAllClinics: true,
    };
    const req = authRequest(owner, { query: {} });
    const res = mockResponse();
    await listHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 200);
    const ids = (res.body as any[]).map((p) => p.id).sort();
    assert.deepEqual(ids, [provDefault.id, provSibling.id, provUnauthorized.id].sort(), 'org-wide list must include every in-org clinic, including ones not individually assigned, and exclude the other organization entirely');
  });

  section('17. Single-clinic caller, omitted selector → default-clinic-only behavior unchanged');
  await test('RECEPTIONIST assigned only to defaultClinic, no clinicId query param → sees only defaultClinic\'s provisions', async () => {
    const receptionistRecord = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'RECEPTIONIST', allowedClinicIds: [fx.defaultClinicId] });
    const receptionist = {
      id: receptionistRecord.id, clinicId: fx.defaultClinicId, role: 'RECEPTIONIST', normalizedRole: 'RECEPTIONIST',
      organizationId: fx.orgId, allowedClinicIds: [fx.defaultClinicId], canAccessAllClinics: false,
    };
    const req = authRequest(receptionist, { query: {} });
    const res = mockResponse();
    await listHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 200);
    const ids = (res.body as any[]).map((p) => p.id);
    assert.deepEqual(ids, [provDefault.id]);
  });

  section('18. Explicit unauthorized selector is denied');
  await test('multi-clinic RECEPTIONIST (default+sibling only) explicitly requesting the unauthorized clinic → 403, not an emptied list', async () => {
    const multiRecord = await createStaffUser({
      organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'RECEPTIONIST',
      allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId],
    });
    const multiUser = {
      id: multiRecord.id, clinicId: fx.defaultClinicId, role: 'RECEPTIONIST', normalizedRole: 'RECEPTIONIST',
      organizationId: fx.orgId, allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId], canAccessAllClinics: false,
    };
    const req = authRequest(multiUser, { query: { clinicId: fx.unauthorizedClinicId } });
    const res = mockResponse();
    await listHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 403);
  });
  await test('same multi-clinic user explicitly requesting the cross-org clinic → also 403', async () => {
    const multiRecord = await createStaffUser({
      organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'RECEPTIONIST',
      allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId],
    });
    const multiUser = {
      id: multiRecord.id, clinicId: fx.defaultClinicId, role: 'RECEPTIONIST', normalizedRole: 'RECEPTIONIST',
      organizationId: fx.orgId, allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId], canAccessAllClinics: false,
    };
    const req = authRequest(multiUser, { query: { clinicId: fx.crossOrgClinicId } });
    const res = mockResponse();
    await listHandler(req, res as any, () => {});
    assert.equal(res.statusCode, 403);
  });

  await cleanupAllFixtures();
  const ok = summary();
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error in kvkkHigh006DbInsuranceListBehavior.test.ts:', err);
  process.exit(1);
});
