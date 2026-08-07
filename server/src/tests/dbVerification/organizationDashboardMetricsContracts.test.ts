/**
 * organizationDashboardMetricsContracts.test.ts — F2-ORG-DASH-METRICS-CONTRACT
 *
 * Real disposable-PostgreSQL, real-route-handler verification for the four
 * new public read contracts (Appointment/Patient/TreatmentCase/Payment) that
 * server/src/routes/organizationDashboard.ts now composes instead of
 * querying those foreign-domain Prisma models directly (see
 * docs/architecture/f2/ADR-F2-ORG-DASH-OWNERSHIP.md §9 follow-up 1).
 *
 * Covers: purpose-built DTO shape per contract, clinic-level tenant scoping,
 * date-range filtering (including the all-time fields that are deliberately
 * NOT date-filtered), OWNER/all-clinics + ORG_ADMIN/restricted-scope +
 * multi-clinic route-level composition, unauthorized-clinic exclusion,
 * cross-org non-leakage (including a spoofed allowedClinicIds list), a
 * zero-data organization, and aggregation equivalence between the response's
 * per-clinic rows and its summary totals.
 *
 * Run: cd server && npx tsx src/tests/dbVerification/organizationDashboardMetricsContracts.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import organizationDashboardRouter from '../../routes/organizationDashboard.js';
import { getOrganizationAppointmentMetrics } from '../../services/appointments/organizationAppointmentMetrics.js';
import { getOrganizationPatientMetrics } from '../../services/patientOrganizationMetrics.js';
import { getOrganizationTreatmentCaseMetrics } from '../../services/treatmentCaseOrganizationMetrics.js';
import { getOrganizationPaymentMetrics } from '../../services/paymentOrganizationMetrics.js';
import {
  createSuite,
  getHandlerOnly,
  mockResponse,
  authRequest,
  createClinicFixtureSet,
  createStaffUser,
  cleanupAllFixtures,
  prisma,
} from './dbVerificationHarness.js';

const { section, test, summary } = createSuite('organizationDashboardMetricsContracts');

const DASHBOARD_HANDLER = getHandlerOnly(organizationDashboardRouter as any, 'get', '/organization/dashboard');

async function createPatientWithPrimaryClinic(params: { organizationId: string; clinicId: string; createdAt: Date }) {
  const suffix = randomUUID().slice(0, 8);
  return prisma.patient.create({
    data: {
      organizationId: params.organizationId,
      clinicId: params.clinicId,
      primaryClinicId: params.clinicId,
      firstName: 'Synthetic',
      lastName: `Patient-${suffix}`,
      phone: `+9055${suffix}`,
      createdAt: params.createdAt,
    },
  });
}

async function createAppointmentType(clinicId: string) {
  return prisma.appointmentType.create({ data: { clinicId, name: 'Checkup', durationMinutes: 30, isActive: true } });
}

async function main() {
  const fx = await createClinicFixtureSet('orgdash-metrics');
  const practitioner = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'DENTIST' });
  const [defaultType, siblingType] = await Promise.all([
    createAppointmentType(fx.defaultClinicId),
    createAppointmentType(fx.siblingClinicId),
  ]);

  const rangeFrom = new Date('2026-01-01T00:00:00.000Z');
  const rangeTo = new Date('2026-01-31T23:59:59.999Z');
  const beforeRange = new Date('2025-12-01T00:00:00.000Z');
  const insideRange = new Date('2026-01-15T10:00:00.000Z');
  const range = { from: rangeFrom, to: rangeTo };

  const defaultPatientInRange = await createPatientWithPrimaryClinic({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, createdAt: insideRange });
  await createPatientWithPrimaryClinic({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, createdAt: beforeRange });
  const siblingPatient = await createPatientWithPrimaryClinic({ organizationId: fx.orgId, clinicId: fx.siblingClinicId, createdAt: insideRange });

  // Default clinic appointments: 1 completed, 1 cancelled, 1 no_show — all inside range.
  await prisma.appointment.createMany({
    data: [
      { clinicId: fx.defaultClinicId, patientId: defaultPatientInRange.id, practitionerId: practitioner.id, appointmentTypeId: defaultType.id, startTime: insideRange, endTime: new Date(insideRange.getTime() + 1_800_000), status: 'completed' },
      { clinicId: fx.defaultClinicId, patientId: defaultPatientInRange.id, practitionerId: practitioner.id, appointmentTypeId: defaultType.id, startTime: new Date(insideRange.getTime() + 3_600_000), endTime: new Date(insideRange.getTime() + 5_400_000), status: 'cancelled' },
      { clinicId: fx.defaultClinicId, patientId: defaultPatientInRange.id, practitionerId: practitioner.id, appointmentTypeId: defaultType.id, startTime: new Date(insideRange.getTime() + 7_200_000), endTime: new Date(insideRange.getTime() + 9_000_000), status: 'no_show' },
    ],
  });

  // Default clinic treatment cases: 1 active (all-time), 1 completed with closedAt inside range.
  await prisma.treatmentCase.createMany({
    data: [
      { clinicId: fx.defaultClinicId, patientId: defaultPatientInRange.id, title: 'Active Plan', stage: 'in_progress' },
      { clinicId: fx.defaultClinicId, patientId: defaultPatientInRange.id, title: 'Completed Plan', stage: 'completed', closedAt: insideRange },
    ],
  });

  // Default clinic payments: paid-in-range (1000), pending all-time (500), paid-before-range (2000, must be excluded).
  await prisma.payment.createMany({
    data: [
      { clinicId: fx.defaultClinicId, patientId: defaultPatientInRange.id, amount: 1000, currency: 'TRY', paymentMethod: 'cash', paymentStatus: 'paid', paidAt: insideRange },
      { clinicId: fx.defaultClinicId, patientId: defaultPatientInRange.id, amount: 500, currency: 'TRY', paymentMethod: 'cash', paymentStatus: 'pending' },
      { clinicId: fx.defaultClinicId, patientId: defaultPatientInRange.id, amount: 2000, currency: 'TRY', paymentMethod: 'cash', paymentStatus: 'paid', paidAt: beforeRange },
    ],
  });

  // Sibling clinic: 1 completed appointment + 1 paid payment (300), both inside range.
  await prisma.appointment.create({
    data: { clinicId: fx.siblingClinicId, patientId: siblingPatient.id, practitionerId: practitioner.id, appointmentTypeId: siblingType.id, startTime: insideRange, endTime: new Date(insideRange.getTime() + 1_800_000), status: 'completed' },
  });
  await prisma.payment.create({
    data: { clinicId: fx.siblingClinicId, patientId: siblingPatient.id, amount: 300, currency: 'TRY', paymentMethod: 'cash', paymentStatus: 'paid', paidAt: insideRange },
  });

  // ─── Contract-level: DTO shape, tenant scoping, date-range filtering ─────

  section('Contract-level: purpose-built DTO shape + scoping + date filtering');

  await test('appointment contract: counts scoped to clinic + date range, DTO has exactly the expected keys', async () => {
    const m = await getOrganizationAppointmentMetrics(fx.defaultClinicId, range);
    assert.deepEqual(Object.keys(m).sort(), ['appointments', 'cancelledAppointments', 'completedAppointments', 'noShowRate', 'todayAppointments'].sort());
    assert.equal(m.appointments, 2, 'appointments excludes cancelled (completed + no_show only)');
    assert.equal(m.completedAppointments, 1);
    assert.equal(m.cancelledAppointments, 1);
    assert.equal(m.noShowRate, 0.5, '1 no_show / 2 non-cancelled appointments');
  });

  await test('patient contract: newPatients respects date range, totalPatients is all-time, DTO shape is exact', async () => {
    const m = await getOrganizationPatientMetrics(fx.defaultClinicId, range);
    assert.deepEqual(Object.keys(m).sort(), ['newPatients', 'totalPatients']);
    assert.equal(m.newPatients, 1, 'only the in-range patient counts');
    assert.equal(m.totalPatients, 2, 'both default-clinic patients count all-time');
  });

  await test('treatmentCase contract: activeTreatmentPlans is all-time, completedTreatments respects closedAt range', async () => {
    const m = await getOrganizationTreatmentCaseMetrics(fx.defaultClinicId, range);
    assert.deepEqual(Object.keys(m).sort(), ['activeTreatmentPlans', 'completedTreatments']);
    assert.equal(m.activeTreatmentPlans, 1);
    assert.equal(m.completedTreatments, 1);
  });

  await test('payment contract: revenue respects paidAt range, outstandingBalance is all-time pending', async () => {
    const m = await getOrganizationPaymentMetrics(fx.defaultClinicId, range);
    assert.deepEqual(Object.keys(m).sort(), ['outstandingBalance', 'revenue']);
    assert.equal(m.revenue, 1000, 'the before-range paid payment (2000) must be excluded');
    assert.equal(m.outstandingBalance, 500);
  });

  await test('sibling clinic results are isolated from default clinic (no cross-clinic bleed)', async () => {
    const apptM = await getOrganizationAppointmentMetrics(fx.siblingClinicId, range);
    const payM = await getOrganizationPaymentMetrics(fx.siblingClinicId, range);
    assert.equal(apptM.completedAppointments, 1);
    assert.equal(payM.revenue, 300);
  });

  await test('zero-data clinic: all four contracts return all-zero DTOs', async () => {
    const [apptM, patM, tcM, payM] = await Promise.all([
      getOrganizationAppointmentMetrics(fx.unauthorizedClinicId, range),
      getOrganizationPatientMetrics(fx.unauthorizedClinicId, range),
      getOrganizationTreatmentCaseMetrics(fx.unauthorizedClinicId, range),
      getOrganizationPaymentMetrics(fx.unauthorizedClinicId, range),
    ]);
    assert.deepEqual(apptM, { todayAppointments: 0, appointments: 0, completedAppointments: 0, cancelledAppointments: 0, noShowRate: 0 });
    assert.deepEqual(patM, { newPatients: 0, totalPatients: 0 });
    assert.deepEqual(tcM, { activeTreatmentPlans: 0, completedTreatments: 0 });
    assert.deepEqual(payM, { revenue: 0, outstandingBalance: 0 });
  });

  // ─── Route-level: organizationDashboard composing the contracts under real tenant scoping ───

  section('Route-level: organizationDashboard composes contracts under real tenant scoping');

  const queryForRange = { range: 'custom', from: '2026-01-01', to: '2026-01-31' };

  await test('OWNER with canAccessAllClinics=true sees every active clinic in their own org, excluding cross-org', async () => {
    const ownerUser = { organizationId: fx.orgId, canAccessAllClinics: true, allowedClinicIds: [], role: 'OWNER' };
    const req = authRequest(ownerUser, { query: queryForRange });
    const res = mockResponse();
    await DASHBOARD_HANDLER(req, res as any, () => {});
    assert.equal(res.statusCode, 200);
    const clinicIds = res.body.clinics.map((c: any) => c.clinicId);
    assert.ok(clinicIds.includes(fx.defaultClinicId));
    assert.ok(clinicIds.includes(fx.siblingClinicId));
    assert.ok(clinicIds.includes(fx.unauthorizedClinicId), 'OWNER sees every clinic in their own org, including this fixture\'s "unauthorized" one');
    assert.ok(!clinicIds.includes(fx.crossOrgClinicId), 'cross-org clinic must never appear');
    assert.equal(res.body.summary.monthlyRevenue, 1000 + 300);
    assert.equal(res.body.summary.outstandingBalance, 500);
    assert.equal(res.body.summary.newPatients, 2);
  });

  await test('ORG_ADMIN restricted to a single allowed clinic sees only that clinic\'s metrics', async () => {
    const restrictedUser = { organizationId: fx.orgId, canAccessAllClinics: false, allowedClinicIds: [fx.defaultClinicId], role: 'ORG_ADMIN' };
    const req = authRequest(restrictedUser, { query: queryForRange });
    const res = mockResponse();
    await DASHBOARD_HANDLER(req, res as any, () => {});
    assert.equal(res.statusCode, 200);
    const clinicIds = res.body.clinics.map((c: any) => c.clinicId);
    assert.deepEqual(clinicIds, [fx.defaultClinicId]);
    assert.equal(res.body.summary.monthlyRevenue, 1000);
    assert.ok(!clinicIds.includes(fx.siblingClinicId), 'sibling clinic must not leak into a restricted scope');
  });

  await test('multi-clinic restricted user sees default + sibling but not the unauthorized same-org clinic', async () => {
    const multiUser = { organizationId: fx.orgId, canAccessAllClinics: false, allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId], role: 'ORG_ADMIN' };
    const req = authRequest(multiUser, { query: queryForRange });
    const res = mockResponse();
    await DASHBOARD_HANDLER(req, res as any, () => {});
    const clinicIds = res.body.clinics.map((c: any) => c.clinicId).sort();
    assert.deepEqual(clinicIds, [fx.defaultClinicId, fx.siblingClinicId].sort());
  });

  await test('no cross-org leakage: an allowedClinicIds list spoofed with a foreign-org clinic id never surfaces that clinic\'s data', async () => {
    const spoofedUser = { organizationId: fx.orgId, canAccessAllClinics: false, allowedClinicIds: [fx.defaultClinicId, fx.crossOrgClinicId], role: 'ORG_ADMIN' };
    const req = authRequest(spoofedUser, { query: queryForRange });
    const res = mockResponse();
    await DASHBOARD_HANDLER(req, res as any, () => {});
    const clinicIds = res.body.clinics.map((c: any) => c.clinicId);
    assert.deepEqual(clinicIds, [fx.defaultClinicId], 'the requester\'s own organizationId predicate must filter out the spoofed cross-org id');
  });

  await test('zero-data organization: canAccessAllClinics user in an org with zero clinics gets the exact EMPTY_SUMMARY shape', async () => {
    const emptyOrg = await prisma.organization.create({ data: { name: 'Empty Org', slug: `empty-org-${randomUUID().slice(0, 8)}` } });
    const emptyUser = { organizationId: emptyOrg.id, canAccessAllClinics: true, allowedClinicIds: [], role: 'OWNER' };
    const req = authRequest(emptyUser, { query: queryForRange });
    const res = mockResponse();
    await DASHBOARD_HANDLER(req, res as any, () => {});
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.clinics, []);
    assert.deepEqual(res.body.insights, {});
    assert.equal(res.body.summary.totalClinics, 0);
    assert.equal(res.body.summary.monthlyRevenue, 0);
    await prisma.organization.delete({ where: { id: emptyOrg.id } });
  });

  await test('aggregation equivalence: summary totals equal the sum of the composed per-clinic rows in the same response', async () => {
    const ownerUser = { organizationId: fx.orgId, canAccessAllClinics: true, allowedClinicIds: [], role: 'OWNER' };
    const req = authRequest(ownerUser, { query: queryForRange });
    const res = mockResponse();
    await DASHBOARD_HANDLER(req, res as any, () => {});
    const rows = res.body.clinics as any[];
    assert.equal(res.body.summary.monthlyRevenue, rows.reduce((s, c) => s + c.revenue, 0));
    assert.equal(res.body.summary.collectedPayments, rows.reduce((s, c) => s + c.collectedPayments, 0));
    assert.equal(res.body.summary.outstandingBalance, rows.reduce((s, c) => s + c.outstandingBalance, 0));
    assert.equal(res.body.summary.newPatients, rows.reduce((s, c) => s + c.newPatients, 0));
    assert.equal(res.body.summary.completedTreatmentCases, rows.reduce((s, c) => s + c.completedTreatments, 0));
    assert.equal(res.body.summary.activeTreatmentPlans, rows.reduce((s, c) => s + c.activeTreatmentPlans, 0));
  });

  // ─── Source-level direct-Prisma isolation proof ───

  section('Direct-Prisma isolation proof (source-level, not DB-level)');

  await test('organizationDashboard.ts contains no direct foreign-domain Prisma model access', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(new URL('../../routes/organizationDashboard.ts', import.meta.url), 'utf8');
    for (const model of ['prisma.appointment.', 'prisma.patient.', 'prisma.treatmentCase.', 'prisma.payment.']) {
      assert.ok(!src.includes(model), `organizationDashboard.ts must not reference ${model} directly`);
    }
  });

  const ok = summary();
  await prisma.treatmentCase.deleteMany({
    where: { clinicId: { in: [fx.defaultClinicId, fx.siblingClinicId, fx.unauthorizedClinicId, fx.crossOrgClinicId] } },
  });
  await cleanupAllFixtures();
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
