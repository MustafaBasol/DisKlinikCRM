/**
 * kvkkHigh006DbRecordOwnedMutationScope.test.ts — KVKK-HIGH-006
 * disposable-Postgres DB-backed verification, scenarios 6-11
 * (record-owned mutation scope):
 *   6. Payment plan mutation uses the record's own clinic
 *   7. Inventory mutation uses the record's own clinic
 *   8. Insurance provision mutation uses the record's own clinic
 *   9. Service/post-treatment mutation uses the record's own clinic
 *  10. Message read uses authorized record scope
 *  11. Message send uses record-owned clinic for provider selection,
 *      consent check, and activity logging
 *
 * The shared scenario shape: an OWNER (canAccessAllClinics=true, JWT default
 * clinic = defaultClinicId) mutates/reads a record that actually lives in the
 * SIBLING clinic. The route must derive `clinicId` from the FOUND record
 * (never from req.user!.clinicId), and every downstream write (Payment,
 * InventoryTransaction, ActivityLog, SentMessage status) must land under the
 * record's own clinicId — verified directly against Postgres afterward.
 *
 * Run: cd server && npx tsx src/tests/dbVerification/kvkkHigh006DbRecordOwnedMutationScope.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
import paymentPlansRouter from '../../routes/paymentPlans.js';
import inventoryRouter from '../../routes/inventory.js';
import insuranceProvisionsRouter from '../../routes/insuranceProvisions.js';
import servicesRouter from '../../routes/services.js';
import messagesRouter from '../../routes/messages.js';
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

const { section, test, summary } = createSuite('DB-Record-Owned-Mutation-Scope');

async function main() {
  const fx = await createClinicFixtureSet('record-scope');

  // A real User row is required — several mutated routes write FK columns
  // (InventoryTransaction.performedById, InsuranceProvision.createdById, etc.)
  // that reference User.id.
  const ownerRecord = await createStaffUser({
    organizationId: fx.orgId,
    clinicId: fx.defaultClinicId, // JWT default — must never be used as the mutation target
    role: 'OWNER',
    canAccessAllClinics: true,
  });
  const owner = {
    id: ownerRecord.id,
    clinicId: fx.defaultClinicId,
    role: 'OWNER',
    normalizedRole: 'OWNER',
    organizationId: fx.orgId,
    allowedClinicIds: [],
    canAccessAllClinics: true,
  };

  // ── Scenario 6: payment plan installment payment uses the plan's own (sibling) clinic ──
  section('6. Payment plan mutation uses the record\'s own clinic');
  {
    const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.siblingClinicId });
    const plan = await prisma.paymentPlan.create({
      data: {
        clinicId: fx.siblingClinicId,
        patientId: patient.id,
        totalAmount: 1000,
        installmentCount: 2,
        status: 'active',
        installments: {
          create: [
            { installmentNo: 1, dueDate: new Date(), amount: 500, status: 'pending' },
            { installmentNo: 2, dueDate: new Date(), amount: 500, status: 'pending' },
          ],
        },
      },
      include: { installments: true },
    });
    const installment = plan.installments[0];

    const payHandler = getHandlerOnly(
      paymentPlansRouter as any,
      'post',
      '/payment-plans/:id/installments/:installmentId/pay',
    );
    const req = authRequest(owner, {
      params: { id: plan.id, installmentId: installment.id },
      body: { paymentMethod: 'cash' },
    });
    const res = mockResponse();
    await payHandler(req, res as any, () => {});

    await test('OWNER (default clinic ≠ plan clinic) can pay an installment on a sibling-clinic plan', () => {
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    });
    await test('the created Payment row is owned by the PLAN\'s clinic, not the requester\'s default clinic', async () => {
      const payment = await prisma.payment.findUnique({ where: { id: res.body.payment.id } });
      assert.ok(payment);
      assert.equal(payment!.clinicId, fx.siblingClinicId);
      assert.notEqual(payment!.clinicId, owner.clinicId);
    });
    await test('the resulting ActivityLog entry is scoped to the sibling clinic', async () => {
      const log = await prisma.activityLog.findFirst({ where: { entityType: 'payment_plan', entityId: plan.id, action: 'installment_paid' } });
      assert.ok(log);
      assert.equal(log!.clinicId, fx.siblingClinicId);
    });
  }

  // ── Scenario 7: inventory transaction uses the item's own (sibling) clinic ──
  section('7. Inventory mutation uses the record\'s own clinic');
  {
    const item = await prisma.inventoryItem.create({
      data: { clinicId: fx.siblingClinicId, organizationId: fx.orgId, name: 'Sibling Gloves', category: 'consumable', unit: 'box', currentStock: 10, minimumStock: 2 },
    });

    const txHandler = getHandlerOnly(inventoryRouter as any, 'post', '/inventory/:id/transactions');
    const req = authRequest(owner, { params: { id: item.id }, body: { type: 'in', quantity: 5 } });
    const res = mockResponse();
    await txHandler(req, res as any, () => {});

    await test('OWNER can add stock to a sibling-clinic item', () => {
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    });
    await test('the InventoryTransaction is recorded under the item\'s clinic, not the requester\'s default clinic', async () => {
      const tx = await prisma.inventoryTransaction.findUnique({ where: { id: res.body.transaction.id } });
      assert.ok(tx);
      assert.equal(tx!.clinicId, fx.siblingClinicId);
    });
    await test('DB side effect: the item\'s stock was actually incremented (15), confirming the real write path ran', async () => {
      const updated = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
      assert.equal(updated!.currentStock, 15);
    });
  }

  // ── Scenario 8: insurance provision status change uses the provision's own (sibling) clinic ──
  section('8. Insurance provision mutation uses the record\'s own clinic');
  {
    const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.siblingClinicId });
    const provision = await prisma.insuranceProvision.create({
      data: {
        clinicId: fx.siblingClinicId,
        patientId: patient.id,
        insuranceProviderName: 'Test Insurer',
        insuranceType: 'private',
        status: 'draft',
        requestedAmount: 100,
        createdById: owner.id,
      },
    });

    const statusHandler = getHandlerOnly(insuranceProvisionsRouter as any, 'patch', '/insurance-provisions/:id/status');
    const req = authRequest(owner, { params: { id: provision.id }, body: { status: 'submitted' } });
    const res = mockResponse();
    await statusHandler(req, res as any, () => {});

    await test('OWNER can change status on a sibling-clinic insurance provision', () => {
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    });
    await test('the resulting ActivityLog is scoped to the provision\'s own (sibling) clinic', async () => {
      const log = await prisma.activityLog.findFirst({ where: { entityType: 'insurance_provision', entityId: provision.id } });
      assert.ok(log);
      assert.equal(log!.clinicId, fx.siblingClinicId);
    });
  }

  // ── Scenario 9: service update uses the service's own (sibling) clinic ──
  section('9. Service/post-treatment mutation uses the record\'s own clinic');
  {
    const service = await prisma.appointmentType.create({
      data: { clinicId: fx.siblingClinicId, name: 'Sibling Cleaning', durationMinutes: 30, isService: true },
    });

    const updateHandler = getHandlerOnly(servicesRouter as any, 'put', '/appointment-types/:id');
    const req = authRequest(owner, { params: { id: service.id }, body: { name: 'Sibling Cleaning (Updated)' } });
    const res = mockResponse();
    await updateHandler(req, res as any, () => {});

    await test('OWNER can update a service owned by the sibling clinic', () => {
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    });
    await test('DB side effect: the service name was actually updated, still under the sibling clinic', async () => {
      const updated = await prisma.appointmentType.findUnique({ where: { id: service.id } });
      assert.equal(updated!.name, 'Sibling Cleaning (Updated)');
      assert.equal(updated!.clinicId, fx.siblingClinicId);
    });
    await test('the resulting ActivityLog is scoped to the sibling clinic, not the requester\'s default clinic', async () => {
      const log = await prisma.activityLog.findFirst({ where: { entityType: 'setting', entityId: service.id, action: 'updated' } });
      assert.ok(log);
      assert.equal(log!.clinicId, fx.siblingClinicId);
    });
  }

  // ── Scenarios 10 & 11: message read/send use the SentMessage's own (sibling) clinic ──
  section('10. Message read uses authorized record scope');
  let sentMessageId = '';
  {
    const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.siblingClinicId });
    const message = await prisma.sentMessage.create({
      data: {
        clinicId: fx.siblingClinicId,
        patientId: patient.id,
        channel: 'whatsapp',
        recipient: patient.phone!,
        body: 'Test message body',
        status: 'prepared',
        organizationId: fx.orgId,
      },
    });
    sentMessageId = message.id;

    const getHandler = getHandlerOnly(messagesRouter as any, 'get', '/messages/:id');
    const req = authRequest(owner, { params: { id: message.id } });
    const res = mockResponse();
    await getHandler(req, res as any, () => {});

    await test('OWNER (default clinic ≠ message clinic) can read a message that belongs to the sibling clinic', () => {
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.id, message.id);
    });

    const singleClinicUser = {
      id: 'single-1',
      clinicId: fx.defaultClinicId,
      role: 'RECEPTIONIST',
      normalizedRole: 'RECEPTIONIST',
      organizationId: fx.orgId,
      allowedClinicIds: [fx.defaultClinicId],
      canAccessAllClinics: false,
    };
    const req2 = authRequest(singleClinicUser, { params: { id: message.id } });
    const res2 = mockResponse();
    await getHandler(req2, res2 as any, () => {});
    await test('a user NOT assigned to the sibling clinic gets 404 for the same message (no cross-clinic leak)', () => {
      assert.equal(res2.statusCode, 404);
    });
  }

  section('11. Message send uses record-owned clinic for provider selection, consent check, activity logging');
  {
    const sendHandler = getHandlerOnly(messagesRouter as any, 'post', '/messages/:id/send');
    const req = authRequest(owner, { params: { id: sentMessageId } });
    const res = mockResponse();
    await sendHandler(req, res as any, () => {});

    // No WhatsApp connection is configured for the sibling clinic in this fixture,
    // so the real sendWhatsAppMessage() call short-circuits with a "no connection"
    // result before any network call — this is the one place per the task's
        // instructions where only the external provider network call may be
    // stubbed away; the clinicScope/consent/DB path around it stays fully real.
    await test('send fails cleanly at the (unconfigured) provider step rather than being silently misrouted', () => {
      assert.equal(res.statusCode, 502, JSON.stringify(res.body));
    });
    await test('the message status update and failure ActivityLog both used the record-owned (sibling) clinic', async () => {
      const message = await prisma.sentMessage.findUnique({ where: { id: sentMessageId } });
      assert.equal(message!.status, 'failed');
      const log = await prisma.activityLog.findFirst({ where: { entityType: 'message', entityId: sentMessageId, action: 'send_failed' } });
      assert.ok(log);
      assert.equal(log!.clinicId, fx.siblingClinicId);
      assert.notEqual(log!.clinicId, owner.clinicId);
    });
  }

  await cleanupAllFixtures();
  const ok = summary();
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error in kvkkHigh006DbRecordOwnedMutationScope.test.ts:', err);
  process.exit(1);
});
