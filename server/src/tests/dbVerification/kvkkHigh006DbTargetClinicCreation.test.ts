/**
 * kvkkHigh006DbTargetClinicCreation.test.ts — KVKK-HIGH-006 disposable-Postgres
 * DB-backed verification, scenarios 12-15 (target-clinic creation):
 *  12. Payment-plan create validates explicit target clinic
 *  13. Inventory create validates explicit target clinic
 *  14. Insurance provision create validates explicit target clinic
 *  15. Service/message-template/post-treatment create validates explicit target clinic
 *
 * Shared shape per domain: a multi-clinic CLINIC_MANAGER (allowedClinicIds =
 * [default, sibling], canAccessAllClinics=false) creates a record with an
 * explicit target clinicId in the request body/query:
 *   - target = sibling clinic (authorized)   → 2xx, DB row created under sibling clinic
 *   - target = unauthorized same-org clinic  → 403, NO row created anywhere
 *   - target = cross-organization clinic     → 403, NO row created anywhere
 *
 * Every "no row created" assertion is checked directly against Postgres
 * (count before/after), not inferred from the HTTP status alone.
 *
 * Run: cd server && npx tsx src/tests/dbVerification/kvkkHigh006DbTargetClinicCreation.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
import paymentPlansRouter from '../../routes/paymentPlans.js';
import inventoryRouter from '../../routes/inventory.js';
import insuranceProvisionsRouter from '../../routes/insuranceProvisions.js';
import servicesRouter from '../../routes/services.js';
import messagesRouter from '../../routes/messages.js';
import postTreatmentRouter from '../../routes/postTreatment.js';
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

const { section, test, summary } = createSuite('DB-Target-Clinic-Creation');

async function main() {
  const fx = await createClinicFixtureSet('target-create');

  const managerRecord = await createStaffUser({
    organizationId: fx.orgId,
    clinicId: fx.defaultClinicId,
    role: 'CLINIC_MANAGER',
    allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId],
  });
  const manager = {
    id: managerRecord.id,
    clinicId: fx.defaultClinicId,
    role: 'CLINIC_MANAGER',
    normalizedRole: 'CLINIC_MANAGER',
    organizationId: fx.orgId,
    allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId],
    canAccessAllClinics: false,
  };

  // ── Scenario 12: payment-plan create ──
  section('12. Payment-plan create validates explicit target clinic');
  {
    const siblingPatient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.siblingClinicId });
    const createHandler = getHandlerOnly(paymentPlansRouter as any, 'post', '/payment-plans');
    const basePayload = { patientId: siblingPatient.id, totalAmount: 300, installmentCount: 3, firstDueDate: new Date().toISOString() };

    const okReq = authRequest(manager, { body: { ...basePayload, clinicId: fx.siblingClinicId } });
    const okRes = mockResponse();
    await createHandler(okReq, okRes as any, () => {});
    await test('authorized explicit sibling target → 201, created under the sibling clinic', async () => {
      assert.equal(okRes.statusCode, 201, JSON.stringify(okRes.body));
      const row = await prisma.paymentPlan.findUnique({ where: { id: okRes.body.id } });
      assert.equal(row!.clinicId, fx.siblingClinicId);
    });

    const beforeCount = await prisma.paymentPlan.count({ where: { patientId: siblingPatient.id } });
    const unauthReq = authRequest(manager, { body: { ...basePayload, clinicId: fx.unauthorizedClinicId } });
    const unauthRes = mockResponse();
    await createHandler(unauthReq, unauthRes as any, () => {});
    await test('unauthorized same-org explicit target → 403, no row created', async () => {
      assert.equal(unauthRes.statusCode, 403);
      const afterCount = await prisma.paymentPlan.count({ where: { patientId: siblingPatient.id } });
      assert.equal(afterCount, beforeCount);
    });

    const crossReq = authRequest(manager, { body: { ...basePayload, clinicId: fx.crossOrgClinicId } });
    const crossRes = mockResponse();
    await createHandler(crossReq, crossRes as any, () => {});
    await test('cross-organization explicit target → 403, no row created', async () => {
      assert.equal(crossRes.statusCode, 403);
      const afterCount = await prisma.paymentPlan.count({ where: { patientId: siblingPatient.id } });
      assert.equal(afterCount, beforeCount);
    });
  }

  // ── Scenario 13: inventory create ──
  section('13. Inventory create validates explicit target clinic');
  {
    const createHandler = getHandlerOnly(inventoryRouter as any, 'post', '/inventory');
    const beforeTotal = await prisma.inventoryItem.count({ where: { organizationId: fx.orgId } });

    const okReq = authRequest(manager, { body: { name: 'Sibling Gauze', category: 'consumable', unit: 'box', clinicId: fx.siblingClinicId } });
    const okRes = mockResponse();
    await createHandler(okReq, okRes as any, () => {});
    await test('authorized explicit sibling target → 201, created under the sibling clinic', async () => {
      assert.equal(okRes.statusCode, 201, JSON.stringify(okRes.body));
      const row = await prisma.inventoryItem.findUnique({ where: { id: okRes.body.id } });
      assert.equal(row!.clinicId, fx.siblingClinicId);
    });

    const unauthReq = authRequest(manager, { body: { name: 'Should Not Exist', category: 'consumable', unit: 'box', clinicId: fx.unauthorizedClinicId } });
    const unauthRes = mockResponse();
    await createHandler(unauthReq, unauthRes as any, () => {});
    await test('unauthorized same-org explicit target → 403, no row created', async () => {
      assert.equal(unauthRes.statusCode, 403);
      const leaked = await prisma.inventoryItem.findFirst({ where: { name: 'Should Not Exist' } });
      assert.equal(leaked, null);
    });

    const crossReq = authRequest(manager, { body: { name: 'Should Not Exist Either', category: 'consumable', unit: 'box', clinicId: fx.crossOrgClinicId } });
    const crossRes = mockResponse();
    await createHandler(crossReq, crossRes as any, () => {});
    await test('cross-organization explicit target → 403, no row created', async () => {
      assert.equal(crossRes.statusCode, 403);
      const leaked = await prisma.inventoryItem.findFirst({ where: { name: 'Should Not Exist Either' } });
      assert.equal(leaked, null);
      const afterTotal = await prisma.inventoryItem.count({ where: { organizationId: fx.orgId } });
      assert.equal(afterTotal, beforeTotal + 1, 'only the one authorized item from this block should exist');
    });
  }

  // ── Scenario 14: insurance provision create ──
  section('14. Insurance provision create validates explicit target clinic');
  {
    const siblingPatient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.siblingClinicId });
    const createHandler = getHandlerOnly(insuranceProvisionsRouter as any, 'post', '/insurance-provisions');
    const basePayload = { patientId: siblingPatient.id, insuranceProviderName: 'Test Insurer', insuranceType: 'private', requestedAmount: 50 };

    const okReq = authRequest(manager, { body: { ...basePayload, clinicId: fx.siblingClinicId } });
    const okRes = mockResponse();
    await createHandler(okReq, okRes as any, () => {});
    await test('authorized explicit sibling target → creates provision under the sibling clinic', async () => {
      assert.equal(okRes.statusCode, 200, JSON.stringify(okRes.body));
      const row = await prisma.insuranceProvision.findUnique({ where: { id: okRes.body.id } });
      assert.equal(row!.clinicId, fx.siblingClinicId);
    });

    const beforeCount = await prisma.insuranceProvision.count({ where: { patientId: siblingPatient.id } });
    const unauthReq = authRequest(manager, { body: { ...basePayload, clinicId: fx.unauthorizedClinicId } });
    const unauthRes = mockResponse();
    await createHandler(unauthReq, unauthRes as any, () => {});
    await test('unauthorized same-org explicit target → 403, no row created', async () => {
      assert.equal(unauthRes.statusCode, 403);
      const afterCount = await prisma.insuranceProvision.count({ where: { patientId: siblingPatient.id } });
      assert.equal(afterCount, beforeCount);
    });

    const crossReq = authRequest(manager, { body: { ...basePayload, clinicId: fx.crossOrgClinicId } });
    const crossRes = mockResponse();
    await createHandler(crossReq, crossRes as any, () => {});
    await test('cross-organization explicit target → 403, no row created', async () => {
      assert.equal(crossRes.statusCode, 403);
      const afterCount = await prisma.insuranceProvision.count({ where: { patientId: siblingPatient.id } });
      assert.equal(afterCount, beforeCount);
    });
  }

  // ── Scenario 15: service / message-template / post-treatment-template create ──
  section('15. Service/message-template/post-treatment create validates explicit target clinic');
  {
    // 15a. Service (appointment-types)
    const createServiceHandler = getHandlerOnly(servicesRouter as any, 'post', '/appointment-types');
    const okSvcReq = authRequest(manager, { body: { name: 'Sibling Whitening', durationMinutes: 45, clinicId: fx.siblingClinicId } });
    const okSvcRes = mockResponse();
    await createServiceHandler(okSvcReq, okSvcRes as any, () => {});
    await test('15a. service create: authorized sibling target → 200, created under sibling clinic', async () => {
      assert.equal(okSvcRes.statusCode, 200, JSON.stringify(okSvcRes.body));
      const row = await prisma.appointmentType.findUnique({ where: { id: okSvcRes.body.id } });
      assert.equal(row!.clinicId, fx.siblingClinicId);
    });

    const crossSvcReq = authRequest(manager, { body: { name: 'Should Not Exist Service', durationMinutes: 20, clinicId: fx.crossOrgClinicId } });
    const crossSvcRes = mockResponse();
    await createServiceHandler(crossSvcReq, crossSvcRes as any, () => {});
    await test('15a. service create: cross-org target → 403, no row created', async () => {
      assert.equal(crossSvcRes.statusCode, 403);
      const leaked = await prisma.appointmentType.findFirst({ where: { name: 'Should Not Exist Service' } });
      assert.equal(leaked, null);
    });

    // 15b. Message template
    const createTemplateHandler = getHandlerOnly(messagesRouter as any, 'post', '/message-templates');
    const okTplReq = authRequest(manager, {
      query: { clinicId: fx.siblingClinicId },
      body: { name: 'Sibling Template', channel: 'email', body: 'Hello {{patient_name}}', language: 'en' },
    });
    const okTplRes = mockResponse();
    await createTemplateHandler(okTplReq, okTplRes as any, () => {});
    await test('15b. message-template create: authorized sibling target → 200, created under sibling clinic', async () => {
      assert.equal(okTplRes.statusCode, 200, JSON.stringify(okTplRes.body));
      const row = await prisma.messageTemplate.findUnique({ where: { id: okTplRes.body.id } });
      assert.equal(row!.clinicId, fx.siblingClinicId);
    });

    const unauthTplReq = authRequest(manager, {
      query: { clinicId: fx.unauthorizedClinicId },
      body: { name: 'Should Not Exist Template', channel: 'email', body: 'x', language: 'en' },
    });
    const unauthTplRes = mockResponse();
    await createTemplateHandler(unauthTplReq, unauthTplRes as any, () => {});
    await test('15b. message-template create: unauthorized same-org target → 403, no row created', async () => {
      assert.equal(unauthTplRes.statusCode, 403);
      const leaked = await prisma.messageTemplate.findFirst({ where: { name: 'Should Not Exist Template' } });
      assert.equal(leaked, null);
    });

    // 15c. Post-treatment template
    const createPostTreatmentHandler = getHandlerOnly(postTreatmentRouter as any, 'post', '/post-treatment-templates');
    const okPtReq = authRequest(manager, {
      body: { title: 'Sibling Follow-Up', targetType: 'service', messageBody: 'Thanks for visiting', channel: 'whatsapp', clinicId: fx.siblingClinicId },
    });
    const okPtRes = mockResponse();
    await createPostTreatmentHandler(okPtReq, okPtRes as any, () => {});
    await test('15c. post-treatment-template create: authorized sibling target → 201, created under sibling clinic', async () => {
      assert.equal(okPtRes.statusCode, 201, JSON.stringify(okPtRes.body));
      const row = await prisma.postTreatmentMessageTemplate.findUnique({ where: { id: okPtRes.body.id } });
      assert.equal(row!.clinicId, fx.siblingClinicId);
    });

    const crossPtReq = authRequest(manager, {
      body: { title: 'Should Not Exist PT', targetType: 'service', messageBody: 'x', channel: 'whatsapp', clinicId: fx.crossOrgClinicId },
    });
    const crossPtRes = mockResponse();
    await createPostTreatmentHandler(crossPtReq, crossPtRes as any, () => {});
    await test('15c. post-treatment-template create: cross-org target → 403, no row created', async () => {
      assert.equal(crossPtRes.statusCode, 403);
      const leaked = await prisma.postTreatmentMessageTemplate.findFirst({ where: { title: 'Should Not Exist PT' } });
      assert.equal(leaked, null);
    });
  }

  await cleanupAllFixtures();
  const ok = summary();
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error in kvkkHigh006DbTargetClinicCreation.test.ts:', err);
  process.exit(1);
});
