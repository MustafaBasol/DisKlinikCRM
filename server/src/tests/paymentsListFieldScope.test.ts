/**
 * paymentsListFieldScope.test.ts — KVKK H-4 HTTP-response-level field-scope
 * test for GET /api/payments.
 *
 * Follows this repo's established convention (see
 * communicationPreferencesRoute.test.ts): no supertest/live-Express-server —
 * the actual route middleware chain (authorize() + handler) is extracted
 * from the router's internal stack and invoked directly with a constructed
 * AuthRequest/mock Response, against the real disposable Postgres database.
 * This exercises the exact same Prisma query and res.json() serialization
 * the HTTP layer would run.
 *
 * Context: GET /payments previously loaded `treatmentCase` via a bare
 * Prisma `include`, which serialized every scalar column of TreatmentCase —
 * including the free-text `description` and `lostReason` fields — to every
 * role authorized on the route, including BILLING. Fix: replace the
 * `include` with an explicit `select` mirroring the existing
 * `/treatment-cases/financial-select` and receipt-endpoint field set.
 *
 * Run with: tsx src/tests/paymentsListFieldScope.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../db.js';
import paymentsRouter from '../routes/payments.js';
import type { AuthRequest } from '../middleware/auth.js';
import type { Response } from 'express';

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

// ── Extract the full route middleware chain (authorize() + handler) ─────────

type RouterLike = { stack: Array<any> };

function getRouteMiddlewareChain(router: RouterLike, method: 'get' | 'post' | 'put' | 'patch', path: string): Array<(req: AuthRequest, res: Response, next: () => void) => void | Promise<void>> {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods?.[method]) {
      return layer.route.stack.map((s: any) => s.handle);
    }
  }
  throw new Error(`No route handler found for ${method.toUpperCase()} ${path}`);
}

async function runChain(chain: Array<(req: AuthRequest, res: Response, next: () => void) => void | Promise<void>>, req: AuthRequest, res: Response): Promise<void> {
  for (const fn of chain) {
    let calledNext = false;
    await fn(req, res, () => { calledNext = true; });
    if (!calledNext) return;
  }
}

function mockResponse(): Response & { statusCode: number; body: any } {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

function authRequest(overrides: Partial<NonNullable<AuthRequest['user']>>, query: Record<string, string> = {}): AuthRequest {
  return {
    params: {},
    query,
    headers: {},
    user: {
      id: randomUUID(),
      clinicId: '',
      role: 'BILLING',
      normalizedRole: 'BILLING',
      organizationId: '',
      allowedClinicIds: [],
      canAccessAllClinics: false,
      ...overrides,
    },
  } as unknown as AuthRequest;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SENTINEL_DESCRIPTION = 'SENTINEL_DESCRIPTION_MUST_NOT_LEAK_TO_BILLING_LIST';
const SENTINEL_LOST_REASON = 'SENTINEL_LOST_REASON_MUST_NOT_LEAK_TO_BILLING_LIST';

type Fixture = {
  organizationId: string;
  clinicAId: string;
  clinicBId: string;
  otherOrgId: string;
  otherClinicId: string;
  patientAId: string;
  patientBId: string;
  otherPatientId: string;
  practitionerId: string;
  treatmentCaseId: string;
  paymentAId: string;
  paymentBId: string;
  paymentXId: string;
};

const createdOrgIds: string[] = [];

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);

  const org = await prisma.organization.create({ data: { name: `H4 Payments Org ${suffix}`, slug: `h4-payments-${suffix}` } });
  const clinicA = await prisma.clinic.create({ data: { name: 'Clinic A', slug: `h4-clinic-a-${suffix}`, organizationId: org.id } });
  const clinicB = await prisma.clinic.create({ data: { name: 'Clinic B', slug: `h4-clinic-b-${suffix}`, organizationId: org.id } });

  const otherOrg = await prisma.organization.create({ data: { name: `H4 Other Org ${suffix}`, slug: `h4-other-org-${suffix}` } });
  const otherClinic = await prisma.clinic.create({ data: { name: 'Other Org Clinic', slug: `h4-other-clinic-${suffix}`, organizationId: otherOrg.id } });

  const patientA = await prisma.patient.create({
    data: { firstName: 'Alice', lastName: 'ClinicA', clinicId: clinicA.id, organizationId: org.id, phone: '+905550000001', email: `alice-${suffix}@test.invalid` },
  });
  const patientB = await prisma.patient.create({
    data: { firstName: 'Bob', lastName: 'ClinicB', clinicId: clinicB.id, organizationId: org.id, phone: '+905550000002' },
  });
  const otherPatient = await prisma.patient.create({
    data: { firstName: 'Xena', lastName: 'OtherOrg', clinicId: otherClinic.id, organizationId: otherOrg.id, phone: '+905550000003' },
  });

  const practitioner = await prisma.user.create({
    data: {
      firstName: 'Derya', lastName: 'Practitioner', email: `practitioner-${suffix}@test.invalid`,
      passwordHash: 'x', role: 'DENTIST', clinicId: clinicA.id, organizationId: org.id,
    },
  });

  const treatmentCase = await prisma.treatmentCase.create({
    data: {
      clinicId: clinicA.id,
      patientId: patientA.id,
      practitionerId: practitioner.id,
      title: 'Root Canal Plan',
      description: SENTINEL_DESCRIPTION,
      stage: 'lost',
      estimatedAmount: 3000,
      acceptedAmount: 2500,
      currency: 'TRY',
      expectedStartDate: new Date('2026-08-01'),
      closedAt: new Date('2026-07-20'),
      lostReason: SENTINEL_LOST_REASON,
      createdById: practitioner.id,
    },
  });

  const paymentA = await prisma.payment.create({
    data: {
      clinicId: clinicA.id, patientId: patientA.id, treatmentCaseId: treatmentCase.id,
      amount: 1000, currency: 'TRY', paymentMethod: 'cash', paymentStatus: 'paid',
      createdById: practitioner.id,
    },
  });
  const paymentB = await prisma.payment.create({
    data: {
      clinicId: clinicB.id, patientId: patientB.id,
      amount: 500, currency: 'TRY', paymentMethod: 'cash', paymentStatus: 'paid',
      createdById: practitioner.id,
    },
  });
  const paymentX = await prisma.payment.create({
    data: {
      clinicId: otherClinic.id, patientId: otherPatient.id,
      amount: 750, currency: 'TRY', paymentMethod: 'card', paymentStatus: 'paid',
    },
  });

  createdOrgIds.push(org.id, otherOrg.id);

  return {
    organizationId: org.id,
    clinicAId: clinicA.id,
    clinicBId: clinicB.id,
    otherOrgId: otherOrg.id,
    otherClinicId: otherClinic.id,
    patientAId: patientA.id,
    patientBId: patientB.id,
    otherPatientId: otherPatient.id,
    practitionerId: practitioner.id,
    treatmentCaseId: treatmentCase.id,
    paymentAId: paymentA.id,
    paymentBId: paymentB.id,
    paymentXId: paymentX.id,
  };
}

async function cleanup() {
  if (createdOrgIds.length === 0) return;
  await prisma.payment.deleteMany({ where: { clinic: { organizationId: { in: createdOrgIds } } } });
  await prisma.treatmentCase.deleteMany({ where: { clinic: { organizationId: { in: createdOrgIds } } } });
  await prisma.patient.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.clinic.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
}

const REQUIRED_TC_FIELDS = ['id', 'title', 'stage', 'estimatedAmount', 'acceptedAmount', 'currency', 'practitioner'];
const EXCLUDED_TC_FIELDS = [
  'description', 'lostReason', 'clinicId', 'patientId', 'practitionerId', 'appointmentTypeId',
  'expectedStartDate', 'closedAt', 'createdById', 'createdAt', 'updatedAt', 'deletedAt',
];
const REQUIRED_PATIENT_FIELDS = ['id', 'firstName', 'lastName', 'email', 'phone'];
const EXCLUDED_PATIENT_FIELDS = ['clinicId', 'primaryClinicId', 'patientStatus', 'source', 'createdAt', 'updatedAt'];

async function main() {
  section('1. BILLING — GET /payments field scope');

  await test('BILLING sees clinicA payment with narrow treatmentCase select — description/lostReason absent', async () => {
    const fx = await createFixture();
    const chain = getRouteMiddlewareChain(paymentsRouter, 'get', '/payments');
    const req = authRequest({ role: 'BILLING', normalizedRole: 'BILLING', organizationId: fx.organizationId, allowedClinicIds: [fx.clinicAId], canAccessAllClinics: false });
    const res = mockResponse();
    await runChain(chain, req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));

    const paymentA = res.body.find((p: any) => p.id === fx.paymentAId);
    assert.ok(paymentA, 'clinicA payment must be present in the response');

    // Required financial fields present
    assert.equal(paymentA.amount, 1000);
    assert.equal(paymentA.currency, 'TRY');
    assert.equal(paymentA.paymentStatus, 'paid');

    const tc = paymentA.treatmentCase;
    assert.ok(tc, 'treatmentCase must be present');
    for (const field of REQUIRED_TC_FIELDS) {
      assert.ok(Object.prototype.hasOwnProperty.call(tc, field), `treatmentCase.${field} must be present`);
    }
    assert.equal(tc.title, 'Root Canal Plan');
    assert.equal(tc.stage, 'lost');
    assert.equal(tc.estimatedAmount, 3000);
    assert.equal(tc.acceptedAmount, 2500);
    assert.equal(tc.currency, 'TRY');
    assert.equal(tc.practitioner.firstName, 'Derya');
    assert.equal(tc.practitioner.lastName, 'Practitioner');

    for (const field of EXCLUDED_TC_FIELDS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(tc, field), false,
        `treatmentCase.${field} must be absent from the response`,
      );
    }
    assert.notEqual(JSON.stringify(tc), JSON.stringify({ ...tc, description: SENTINEL_DESCRIPTION }));
    assert.ok(!JSON.stringify(paymentA).includes(SENTINEL_DESCRIPTION), 'sentinel description must not appear anywhere in the serialized payment');
    assert.ok(!JSON.stringify(paymentA).includes(SENTINEL_LOST_REASON), 'sentinel lostReason must not appear anywhere in the serialized payment');

    const patient = paymentA.patient;
    assert.ok(patient, 'patient relation must be present');
    for (const field of REQUIRED_PATIENT_FIELDS) {
      assert.ok(Object.prototype.hasOwnProperty.call(patient, field), `patient.${field} must be present`);
    }
    for (const field of EXCLUDED_PATIENT_FIELDS) {
      assert.equal(Object.prototype.hasOwnProperty.call(patient, field), false, `patient.${field} must remain absent (unchanged narrow contact select)`);
    }
  });

  section('2. Clinic and organization scoping unaffected by the field-scope fix');

  await test('BILLING scoped to clinicA does not receive clinicB (same-org, inaccessible-clinic) payment', async () => {
    const fx = await createFixture();
    const chain = getRouteMiddlewareChain(paymentsRouter, 'get', '/payments');
    const req = authRequest({ role: 'BILLING', normalizedRole: 'BILLING', organizationId: fx.organizationId, allowedClinicIds: [fx.clinicAId], canAccessAllClinics: false });
    const res = mockResponse();
    await runChain(chain, req, res);

    assert.equal(res.statusCode, 200);
    assert.ok(!res.body.some((p: any) => p.id === fx.paymentBId), 'clinicB payment must not be returned to a user only assigned to clinicA');
    assert.ok(!res.body.some((p: any) => p.id === fx.paymentXId), 'cross-organization payment must not be returned');
  });

  await test('BILLING explicitly requesting an inaccessible clinicId is denied (403), not just filtered', async () => {
    const fx = await createFixture();
    const chain = getRouteMiddlewareChain(paymentsRouter, 'get', '/payments');
    const req = authRequest(
      { role: 'BILLING', normalizedRole: 'BILLING', organizationId: fx.organizationId, allowedClinicIds: [fx.clinicAId], canAccessAllClinics: false },
      { clinicId: fx.clinicBId },
    );
    const res = mockResponse();
    await runChain(chain, req, res);

    assert.equal(res.statusCode, 403);
    assert.ok(res.body?.error, 'must be the scope-rejection error body, not a payments array');
    assert.equal(Array.isArray(res.body), false, 'must not fall through to a payments array on denial');
  });

  await test('BILLING requesting a different organization\'s clinicId is denied (403)', async () => {
    const fx = await createFixture();
    const chain = getRouteMiddlewareChain(paymentsRouter, 'get', '/payments');
    const req = authRequest(
      { role: 'BILLING', normalizedRole: 'BILLING', organizationId: fx.organizationId, allowedClinicIds: [fx.clinicAId], canAccessAllClinics: false },
      { clinicId: fx.otherClinicId },
    );
    const res = mockResponse();
    await runChain(chain, req, res);

    assert.equal(res.statusCode, 403);
  });

  section('3. Positive regression — a non-BILLING authorized role sees the same narrow shape');

  await test('OWNER (canAccessAllClinics) sees both org clinics\' payments, still without description/lostReason', async () => {
    const fx = await createFixture();
    const chain = getRouteMiddlewareChain(paymentsRouter, 'get', '/payments');
    const req = authRequest({ role: 'OWNER', normalizedRole: 'OWNER', organizationId: fx.organizationId, allowedClinicIds: [], canAccessAllClinics: true });
    const res = mockResponse();
    await runChain(chain, req, res);

    assert.equal(res.statusCode, 200);
    const paymentA = res.body.find((p: any) => p.id === fx.paymentAId);
    const paymentB = res.body.find((p: any) => p.id === fx.paymentBId);
    assert.ok(paymentA, 'OWNER must see clinicA payment');
    assert.ok(paymentB, 'OWNER (all-clinics) must see clinicB payment too');
    assert.ok(!res.body.some((p: any) => p.id === fx.paymentXId), 'OWNER of one org must never see another organization\'s payment');

    for (const field of EXCLUDED_TC_FIELDS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(paymentA.treatmentCase, field), false,
        `treatmentCase.${field} must be absent for OWNER too — no role-conditioned broadening`,
      );
    }
    assert.equal(paymentA.treatmentCase.title, 'Root Canal Plan');
    assert.equal(paymentA.treatmentCase.practitioner.firstName, 'Derya');
  });

  await cleanup();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
