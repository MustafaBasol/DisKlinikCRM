/**
 * appointmentRequestConversionAtomicity.test.ts — DATA-INTEGRITY-001-F1
 *
 * Real disposable-PostgreSQL, real-route-handler verification that
 * POST /api/appointment-requests/:id/convert is atomic and concurrency-safe
 * after wrapping its writes in prisma.$transaction + a request-level advisory
 * lock (acquireAppointmentRequestConversionLock, acquired first) + the
 * existing per-slot advisory lock (acquireAppointmentSlotLock, acquired
 * second) — see docs/program/evidence/
 * DATA-INTEGRITY-001-F1_APPOINTMENT_REQUEST_CONVERSION_ATOMICITY_IMPLEMENTATION.md.
 *
 * Scenario 7b in particular is the authoritative proof for the request-level
 * lock: it drives two concurrent conversions of the SAME request with
 * DIFFERENT slot overrides (different practitioner + time), which a
 * slot-lock-only implementation would let both proceed independently.
 *
 * Uses the same real-DB / real-Express-handler convention as
 * kvkkHigh006Db*.test.ts (dbVerificationHarness.ts) — no mocked Prisma, no
 * in-memory simulation, for every scenario below including the concurrency
 * ones (driven via real concurrent calls into the real route handler against
 * the same live Postgres connection pool).
 *
 * Run: npx tsx src/tests/dbVerification/appointmentRequestConversionAtomicity.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres before import.
 */

import assert from 'node:assert/strict';
import appointmentRequestsRouter from '../../routes/appointmentRequests.js';
import {
  createSuite,
  getFullChain,
  runChain,
  mockResponse,
  authRequest,
  createClinicFixtureSet,
  createStaffUser,
  createTestPatient,
  cleanupAllFixtures,
  prisma,
  type ClinicFixtureSet,
} from './dbVerificationHarness.js';

const { section, test, summary } = createSuite('appointmentRequestConversionAtomicity');

const CONVERT_CHAIN = getFullChain(appointmentRequestsRouter as any, 'post', '/appointment-requests/:id/convert');

// All 7 weekdays wide open (00:00-23:59) so any test-chosen UTC time slot
// passes the working-hours/off-day check without needing to compute the
// exact weekday for a hardcoded date. Clinic fixtures use the schema default
// timezone ('UTC'), so getZonedDateParts(date, 'UTC') reads the UTC fields
// directly — no DST/offset ambiguity.
async function createFullyAvailablePractitioner(fixtures: ClinicFixtureSet, clinicId: string) {
  const practitioner = await createStaffUser({
    organizationId: fixtures.orgId,
    clinicId,
    role: 'DENTIST',
  });
  await prisma.doctorAvailability.createMany({
    data: Array.from({ length: 7 }, (_, weekday) => ({
      clinicId,
      practitionerId: practitioner.id,
      weekday,
      startTime: '00:00',
      endTime: '23:59',
      isActive: true,
    })),
  });
  return practitioner;
}

async function createService(clinicId: string) {
  return prisma.appointmentType.create({
    data: { clinicId, name: 'Checkup', durationMinutes: 30, isActive: true },
  });
}

let slotCounter = 0;
/** Each call returns a fresh, never-reused UTC slot so unrelated tests can never collide on the advisory lock or overlap checks. */
function nextSlot() {
  slotCounter += 1;
  const start = new Date(Date.UTC(2026, 7, 3, 8, 0) + slotCounter * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return { startTime: start, endTime: end };
}

async function createRequest(params: {
  clinicId: string;
  appointmentTypeId: string;
  practitionerId: string;
  patientId?: string | null;
  startTime: Date;
  endTime: Date;
  patientName?: string;
}) {
  return prisma.appointmentRequest.create({
    data: {
      clinicId: params.clinicId,
      patientId: params.patientId ?? null,
      patientName: params.patientName ?? 'Test Patient',
      phone: '+905551234567',
      email: 'test-patient@example.invalid',
      appointmentTypeId: params.appointmentTypeId,
      practitionerId: params.practitionerId,
      preferredStartTime: params.startTime,
      preferredEndTime: params.endTime,
      requestType: 'appointment',
      source: 'whatsapp',
      status: 'pending',
    },
  });
}

// A real User row (not just an in-memory AuthRequest.user) — logActivity
// writes ActivityLog.userId with an FK to User, so an ownerUser() with no
// backing row would make every successful conversion's activity-log write
// fail (harmlessly swallowed by logActivity's own try/catch, but it would
// silently defeat the ActivityLog-consistency assertions in this suite).
async function ownerUser(fixtures: ClinicFixtureSet, clinicId: string = fixtures.defaultClinicId) {
  const owner = await createStaffUser({
    organizationId: fixtures.orgId,
    clinicId,
    role: 'OWNER',
    canAccessAllClinics: true,
  });
  return authRequest({
    id: owner.id,
    organizationId: fixtures.orgId,
    clinicId,
    role: 'OWNER',
    canAccessAllClinics: true,
  });
}

async function callConvert(requestId: string, user: ReturnType<typeof authRequest>, body: Record<string, unknown> = {}) {
  const req = { ...user, params: { id: requestId }, body } as any;
  const res = mockResponse();
  await runChain(CONVERT_CHAIN, req, res);
  return res;
}

async function countPatients(orgId: string) {
  return prisma.patient.count({ where: { organizationId: orgId } });
}

async function countAppointments(clinicId: string) {
  return prisma.appointment.count({ where: { clinicId } });
}

async function activityLogCount(entityId: string, action: string) {
  return prisma.activityLog.count({ where: { entityType: 'appointment_request', entityId, action } });
}

// ─── 1. Existing patient + successful conversion ────────────────────────────

async function scenarioExistingPatientSuccess() {
  section('1. Existing patient + successful conversion');
  const fixtures = await createClinicFixtureSet('conv-existing');
  const practitioner = await createFullyAvailablePractitioner(fixtures, fixtures.defaultClinicId);
  const service = await createService(fixtures.defaultClinicId);
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const { startTime, endTime } = nextSlot();
  const request = await createRequest({
    clinicId: fixtures.defaultClinicId,
    appointmentTypeId: service.id,
    practitionerId: practitioner.id,
    patientId: patient.id,
    startTime,
    endTime,
  });

  const patientsBefore = await countPatients(fixtures.orgId);

  await test('201 + appointment/request correctly linked; no new Patient created', async () => {
    const res = await callConvert(request.id, await ownerUser(fixtures));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.appointment.patientId, patient.id);
    assert.equal(res.body.appointment.clinicId, fixtures.defaultClinicId);
    assert.equal(res.body.request.status, 'converted');
    assert.equal(res.body.request.convertedAppointmentId, res.body.appointment.id);

    const patientsAfter = await countPatients(fixtures.orgId);
    assert.equal(patientsAfter, patientsBefore, 'no new Patient row should be created when converting with an existing patientId');

    const dbAppointment = await prisma.appointment.findUnique({ where: { id: res.body.appointment.id } });
    assert.ok(dbAppointment, 'appointment must actually be persisted');
    assert.equal(dbAppointment!.patientId, patient.id);

    const dbRequest = await prisma.appointmentRequest.findUnique({ where: { id: request.id } });
    assert.equal(dbRequest!.status, 'converted');
    assert.equal(dbRequest!.convertedAppointmentId, res.body.appointment.id);
  });

  await test('exactly one ActivityLog "converted" row after success', async () => {
    const count = await activityLogCount(request.id, 'converted');
    assert.equal(count, 1);
  });
}

// ─── 2. New patient + successful conversion ─────────────────────────────────

async function scenarioNewPatientSuccess() {
  section('2. New patient + successful conversion');
  const fixtures = await createClinicFixtureSet('conv-new-patient');
  const practitioner = await createFullyAvailablePractitioner(fixtures, fixtures.defaultClinicId);
  const service = await createService(fixtures.defaultClinicId);
  const { startTime, endTime } = nextSlot();
  const request = await createRequest({
    clinicId: fixtures.defaultClinicId,
    appointmentTypeId: service.id,
    practitionerId: practitioner.id,
    patientId: null,
    startTime,
    endTime,
    patientName: 'Yeni Hasta Soyadi',
  });

  const patientsBefore = await countPatients(fixtures.orgId);

  await test('201 + exactly one new Patient created, correctly attributed', async () => {
    const res = await callConvert(request.id, await ownerUser(fixtures));
    assert.equal(res.statusCode, 201);

    const patientsAfter = await countPatients(fixtures.orgId);
    assert.equal(patientsAfter, patientsBefore + 1, 'exactly one new Patient row must be created');

    const newPatient = await prisma.patient.findUnique({ where: { id: res.body.appointment.patientId } });
    assert.ok(newPatient);
    assert.equal(newPatient!.clinicId, fixtures.defaultClinicId);
    assert.equal(newPatient!.organizationId, fixtures.orgId);
    assert.equal(newPatient!.firstName, 'Yeni');

    assert.equal(res.body.request.patientId, newPatient!.id);
  });
}

// ─── 3. Slot conflict after new-patient path leaves no Patient ──────────────

async function scenarioSlotConflictLeavesNoPatient() {
  section('3. Slot conflict (new-patient path) leaves no Patient — the confirmed defect this fix closes');
  const fixtures = await createClinicFixtureSet('conv-conflict-no-orphan');
  const practitioner = await createFullyAvailablePractitioner(fixtures, fixtures.defaultClinicId);
  const service = await createService(fixtures.defaultClinicId);
  const { startTime, endTime } = nextSlot();

  // Pre-existing real Appointment occupying the exact slot the request wants.
  const blockingPatient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  await prisma.appointment.create({
    data: {
      clinicId: fixtures.defaultClinicId,
      patientId: blockingPatient.id,
      practitionerId: practitioner.id,
      appointmentTypeId: service.id,
      startTime,
      endTime,
      status: 'scheduled',
    },
  });

  const request = await createRequest({
    clinicId: fixtures.defaultClinicId,
    appointmentTypeId: service.id,
    practitionerId: practitioner.id,
    patientId: null, // new-patient path — this is the exact shape that orphaned a Patient on unmodified main
    startTime,
    endTime,
  });

  const patientsBefore = await countPatients(fixtures.orgId);

  await test('409 APPOINTMENT_OVERLAP, zero new Patient rows, request unchanged', async () => {
    const res = await callConvert(request.id, await ownerUser(fixtures));
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'APPOINTMENT_OVERLAP');

    const patientsAfter = await countPatients(fixtures.orgId);
    assert.equal(patientsAfter, patientsBefore, 'no orphan Patient row — this is the defect DATA-INTEGRITY-001 confirmed on unmodified main');

    const dbRequest = await prisma.appointmentRequest.findUnique({ where: { id: request.id } });
    assert.equal(dbRequest!.status, 'pending');
    assert.equal(dbRequest!.patientId, null);
  });

  await test('no ActivityLog row for a failed conversion attempt', async () => {
    const count = await activityLogCount(request.id, 'converted');
    assert.equal(count, 0);
  });
}

// ─── 4 & 5. Real-Postgres transaction rollback mechanics ────────────────────
//
// These two exercise the exact write sequence the fix uses
// (tx.patient.create → tx.appointment.create → tx.appointmentRequest.update)
// directly against the real disposable Postgres, forcing the failing
// operation via a genuine constraint violation (not a mock/stub) so the
// rollback is proven by real Postgres behavior. The live-route concurrency
// scenarios below (6-8) additionally prove the deployed route's own
// transaction boundary under real concurrent HTTP-shaped calls.

async function scenarioAppointmentCreateFailureRollsBackPatient() {
  section('4. appointment.create failure rolls back new Patient (real Postgres, FK violation)');
  const fixtures = await createClinicFixtureSet('conv-tx-rollback-appt');
  const clinicId = fixtures.defaultClinicId;
  const practitioner = await createFullyAvailablePractitioner(fixtures, clinicId);
  const service = await createService(clinicId);

  const patientsBefore = await countPatients(fixtures.orgId);

  await test('tx.appointment.create with a nonexistent appointmentTypeId rolls back the patient created earlier in the same transaction', async () => {
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const patient = await tx.patient.create({
          data: {
            clinicId,
            organizationId: fixtures.orgId,
            firstName: 'Rollback',
            lastName: 'Target',
            phone: '+905550000000',
            communicationConsent: true,
          },
        });
        // Real FK violation: this appointmentTypeId does not exist.
        await tx.appointment.create({
          data: {
            clinicId,
            patientId: patient.id,
            practitionerId: practitioner.id,
            appointmentTypeId: '00000000-0000-0000-0000-000000000000',
            startTime: new Date(),
            endTime: new Date(Date.now() + 30 * 60 * 1000),
            status: 'scheduled',
          },
        });
      }),
    );

    const patientsAfter = await countPatients(fixtures.orgId);
    assert.equal(patientsAfter, patientsBefore, 'the Patient created earlier in the same transaction must not survive the rollback');
  });

  // Sanity: `service` is unused directly (kept for parity with the other
  // scenarios' fixture shape / to document that a valid service exists in
  // this clinic and was deliberately not the one referenced above).
  void service;
}

async function scenarioRequestUpdateFailureRollsBackPatientAndAppointment() {
  section('5. appointmentRequest.update failure rolls back both Patient and Appointment (real Postgres, not-found)');
  const fixtures = await createClinicFixtureSet('conv-tx-rollback-request');
  const clinicId = fixtures.defaultClinicId;
  const practitioner = await createFullyAvailablePractitioner(fixtures, clinicId);
  const service = await createService(clinicId);

  const patientsBefore = await countPatients(fixtures.orgId);
  const appointmentsBefore = await countAppointments(clinicId);

  await test('tx.appointmentRequest.update against a nonexistent id rolls back both the patient and the appointment created earlier in the same transaction', async () => {
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const patient = await tx.patient.create({
          data: {
            clinicId,
            organizationId: fixtures.orgId,
            firstName: 'Rollback',
            lastName: 'Target2',
            phone: '+905550000001',
            communicationConsent: true,
          },
        });
        const appointment = await tx.appointment.create({
          data: {
            clinicId,
            patientId: patient.id,
            practitionerId: practitioner.id,
            appointmentTypeId: service.id,
            startTime: new Date(),
            endTime: new Date(Date.now() + 30 * 60 * 1000),
            status: 'scheduled',
          },
        });
        // Real Prisma P2025 "record not found" — no AppointmentRequest with this id exists.
        await tx.appointmentRequest.update({
          where: { id: '00000000-0000-0000-0000-000000000000' },
          data: { status: 'converted', convertedAppointmentId: appointment.id },
        });
      }),
    );

    const patientsAfter = await countPatients(fixtures.orgId);
    const appointmentsAfter = await countAppointments(clinicId);
    assert.equal(patientsAfter, patientsBefore, 'the Patient created earlier in the same transaction must not survive the rollback');
    assert.equal(appointmentsAfter, appointmentsBefore, 'the Appointment created earlier in the same transaction must not survive the rollback');
  });
}

// ─── 6. Duplicate sequential conversion ─────────────────────────────────────

async function scenarioDuplicateSequentialConversion() {
  section('6. Duplicate sequential conversion of the same request');
  const fixtures = await createClinicFixtureSet('conv-dup-sequential');
  const practitioner = await createFullyAvailablePractitioner(fixtures, fixtures.defaultClinicId);
  const service = await createService(fixtures.defaultClinicId);
  const { startTime, endTime } = nextSlot();
  const request = await createRequest({
    clinicId: fixtures.defaultClinicId,
    appointmentTypeId: service.id,
    practitionerId: practitioner.id,
    patientId: null,
    startTime,
    endTime,
  });

  await test('first conversion succeeds, second (sequential) call is rejected with the established response, no second Appointment', async () => {
    const user = await ownerUser(fixtures);
    const first = await callConvert(request.id, user);
    assert.equal(first.statusCode, 201);

    const second = await callConvert(request.id, user);
    assert.equal(second.statusCode, 400);
    assert.equal(second.body.error, 'Appointment request is already converted');

    const appointmentCount = await prisma.appointment.count({
      where: { clinicId: fixtures.defaultClinicId, practitionerId: practitioner.id, startTime, endTime },
    });
    assert.equal(appointmentCount, 1, 'exactly one Appointment must exist for this slot after two sequential convert calls');
  });
}

// ─── 7. Duplicate concurrent conversion ─────────────────────────────────────

async function scenarioDuplicateConcurrentConversion() {
  section('7. Duplicate CONCURRENT conversion of the same request (real race against the live route)');
  const fixtures = await createClinicFixtureSet('conv-dup-concurrent');
  const practitioner = await createFullyAvailablePractitioner(fixtures, fixtures.defaultClinicId);
  const service = await createService(fixtures.defaultClinicId);
  const { startTime, endTime } = nextSlot();
  const request = await createRequest({
    clinicId: fixtures.defaultClinicId,
    appointmentTypeId: service.id,
    practitionerId: practitioner.id,
    patientId: null,
    startTime,
    endTime,
  });

  await test('exactly one of two truly concurrent convert calls succeeds; the other gets the established conflict response; only one Appointment ever exists', async () => {
    const user = await ownerUser(fixtures);
    const [resA, resB] = await Promise.all([
      callConvert(request.id, user),
      callConvert(request.id, user),
    ]);

    // One succeeds (201). The other must be rejected — either because it lost
    // the duplicate-conversion race (400, "already converted") or because it
    // was serialized behind the winner by the advisory lock and then saw the
    // now-real Appointment as an overlap (409, APPOINTMENT_OVERLAP). Both are
    // correct, established, non-silent rejections; what must NEVER happen is
    // a second 201.
    const successCount = [resA, resB].filter(r => r.statusCode === 201).length;
    assert.equal(successCount, 1, 'exactly one concurrent convert call must succeed — no silent duplicate Appointment');

    const loser = resA.statusCode === 201 ? resB : resA;
    assert.ok(
      (loser.statusCode === 400 && loser.body.error === 'Appointment request is already converted') ||
      (loser.statusCode === 409 && loser.body.code === 'APPOINTMENT_OVERLAP'),
      `loser must get an established conflict response, got ${loser.statusCode} ${JSON.stringify(loser.body)}`,
    );

    const appointmentCount = await prisma.appointment.count({
      where: { clinicId: fixtures.defaultClinicId, practitionerId: practitioner.id, startTime, endTime },
    });
    assert.equal(appointmentCount, 1, 'exactly one Appointment must exist for this slot after two concurrent convert calls');

    const dbRequest = await prisma.appointmentRequest.findUnique({ where: { id: request.id } });
    assert.equal(dbRequest!.status, 'converted');
    assert.ok(dbRequest!.convertedAppointmentId, 'the winning request must be linked to a real appointment');
  });
}

// ─── 7b. Duplicate concurrent conversion — DIFFERENT slot overrides ─────────
//
// This is the exact residual gap DATA-INTEGRITY-001-F1 closes: scenario 7
// above proves two concurrent conversions of the SAME request racing for the
// SAME slot serialize correctly. That alone does not prove the request-level
// lock is what's doing the serializing — a slot lock alone would already
// catch same-slot races. This scenario gives each concurrent call a
// DIFFERENT slot override (different practitioner AND different time), so a
// slot-lock-only implementation would compute two different lock keys, let
// both attempts proceed independently, and create two Appointments for one
// AppointmentRequest. With the request-level lock acquired first, the loser
// must be serialized behind the winner purely on the request id and observe
// status: 'converted' before it ever reaches the slot lock or overlap check
// — so it must always lose with exactly 400 "already converted", never 409.

async function scenarioDuplicateConcurrentConversionDifferentSlots() {
  section('7b. Duplicate CONCURRENT conversion of the SAME request using DIFFERENT slot overrides (the exact residual gap this task closes)');
  const fixtures = await createClinicFixtureSet('conv-dup-concurrent-diff-slots');
  const practitionerA = await createFullyAvailablePractitioner(fixtures, fixtures.defaultClinicId);
  const practitionerB = await createFullyAvailablePractitioner(fixtures, fixtures.defaultClinicId);
  const service = await createService(fixtures.defaultClinicId);
  const { startTime, endTime } = nextSlot();
  const request = await createRequest({
    clinicId: fixtures.defaultClinicId,
    appointmentTypeId: service.id,
    practitionerId: practitionerA.id,
    patientId: null,
    startTime,
    endTime,
  });

  // Neither override matches the request's own preferred slot or each other —
  // different practitioner, different time, so a slot-lock-only guard would
  // treat these as two entirely independent, non-conflicting bookings.
  const slotA = nextSlot();
  const slotB = nextSlot();

  await test('exactly one of two concurrent convert calls for the SAME request — each overriding to a DIFFERENT slot — succeeds; the loser always gets exactly "already converted", never a slot conflict; no second Appointment is ever created', async () => {
    const patientsBefore = await countPatients(fixtures.orgId);
    const user = await ownerUser(fixtures);
    const [resA, resB] = await Promise.all([
      callConvert(request.id, user, {
        practitionerId: practitionerA.id,
        startTime: slotA.startTime.toISOString(),
        endTime: slotA.endTime.toISOString(),
      }),
      callConvert(request.id, user, {
        practitionerId: practitionerB.id,
        startTime: slotB.startTime.toISOString(),
        endTime: slotB.endTime.toISOString(),
      }),
    ]);

    const successCount = [resA, resB].filter(r => r.statusCode === 201).length;
    assert.equal(
      successCount, 1,
      `exactly one concurrent convert call (different slot overrides) must succeed — got A=${resA.statusCode} B=${resB.statusCode}`,
    );

    const loser = resA.statusCode === 201 ? resB : resA;
    // Unlike the same-slot race (scenario 7), the loser here can ONLY have
    // been serialized by the request lock — the two slot lock keys never
    // collide, so a 409 slot-conflict response here would mean the request
    // lock did not actually serialize the two attempts.
    assert.equal(loser.statusCode, 400, `loser must be rejected as already-converted (request lock), not a slot conflict — got ${loser.statusCode} ${JSON.stringify(loser.body)}`);
    assert.equal(loser.body.error, 'Appointment request is already converted');

    const appointmentsAtA = await prisma.appointment.count({
      where: { clinicId: fixtures.defaultClinicId, practitionerId: practitionerA.id, startTime: slotA.startTime, endTime: slotA.endTime },
    });
    const appointmentsAtB = await prisma.appointment.count({
      where: { clinicId: fixtures.defaultClinicId, practitionerId: practitionerB.id, startTime: slotB.startTime, endTime: slotB.endTime },
    });
    assert.equal(appointmentsAtA + appointmentsAtB, 1, 'exactly one Appointment total must exist across the two candidate slots — the request must not convert into both');

    const dbRequest = await prisma.appointmentRequest.findUnique({ where: { id: request.id } });
    assert.equal(dbRequest!.status, 'converted');
    assert.ok(dbRequest!.convertedAppointmentId, 'the request must point at a real appointment');

    const winningAppointment = await prisma.appointment.findUnique({ where: { id: dbRequest!.convertedAppointmentId! } });
    assert.ok(winningAppointment, 'convertedAppointmentId must reference a persisted appointment');
    const wonSlotA = winningAppointment!.practitionerId === practitionerA.id && winningAppointment!.startTime.getTime() === slotA.startTime.getTime();
    const wonSlotB = winningAppointment!.practitionerId === practitionerB.id && winningAppointment!.startTime.getTime() === slotB.startTime.getTime();
    assert.ok(wonSlotA || wonSlotB, 'the request must point only at whichever single slot actually won the race, never a mix of both');

    // Losing transaction (new-patient path) must not have left an orphan Patient.
    const patientsAfter = await countPatients(fixtures.orgId);
    assert.equal(patientsAfter, patientsBefore + 1, 'only the winner\'s new Patient should exist — the loser must leave no orphan Patient');
  });
}

// ─── 7c. Two different requests, different slots — no interference ─────────

async function scenarioTwoDifferentRequestsDifferentSlotsNoInterference() {
  section('7c. Two DIFFERENT requests targeting DIFFERENT slots, converted concurrently — must not block or interfere with each other');
  const fixtures = await createClinicFixtureSet('conv-two-requests-diff-slots');
  const practitioner = await createFullyAvailablePractitioner(fixtures, fixtures.defaultClinicId);
  const service = await createService(fixtures.defaultClinicId);

  const slotA = nextSlot();
  const slotB = nextSlot();
  const requestA = await createRequest({
    clinicId: fixtures.defaultClinicId, appointmentTypeId: service.id, practitionerId: practitioner.id,
    patientId: null, ...slotA, patientName: 'Patient DiffSlotA',
  });
  const requestB = await createRequest({
    clinicId: fixtures.defaultClinicId, appointmentTypeId: service.id, practitionerId: practitioner.id,
    patientId: null, ...slotB, patientName: 'Patient DiffSlotB',
  });

  await test('both concurrent conversions succeed independently — different requests, different slots, no cross-blocking, no interference', async () => {
    const user = await ownerUser(fixtures);
    const [resA, resB] = await Promise.all([
      callConvert(requestA.id, user),
      callConvert(requestB.id, user),
    ]);

    assert.equal(resA.statusCode, 201, `request A must succeed independently, got ${resA.statusCode} ${JSON.stringify(resA.body)}`);
    assert.equal(resB.statusCode, 201, `request B must succeed independently, got ${resB.statusCode} ${JSON.stringify(resB.body)}`);
    assert.notEqual(resA.body.appointment.id, resB.body.appointment.id, 'each request must get its own distinct appointment');

    const dbRequestA = await prisma.appointmentRequest.findUnique({ where: { id: requestA.id } });
    const dbRequestB = await prisma.appointmentRequest.findUnique({ where: { id: requestB.id } });
    assert.equal(dbRequestA!.status, 'converted');
    assert.equal(dbRequestB!.status, 'converted');
    assert.equal(dbRequestA!.convertedAppointmentId, resA.body.appointment.id);
    assert.equal(dbRequestB!.convertedAppointmentId, resB.body.appointment.id);

    const appointmentCount = await prisma.appointment.count({
      where: { clinicId: fixtures.defaultClinicId, practitionerId: practitioner.id, id: { in: [resA.body.appointment.id, resB.body.appointment.id] } },
    });
    assert.equal(appointmentCount, 2, 'both appointments must be persisted, independently of each other');
  });
}

// ─── 8. Two concurrent requests targeting the same slot ─────────────────────

async function scenarioTwoDifferentRequestsSameSlotConcurrent() {
  section('8. Two DIFFERENT requests, both staff-overridden to the same practitioner/slot, converted concurrently');
  const fixtures = await createClinicFixtureSet('conv-two-requests-same-slot');
  const practitioner = await createFullyAvailablePractitioner(fixtures, fixtures.defaultClinicId);
  const service = await createService(fixtures.defaultClinicId);

  // Each source request has its OWN, non-overlapping preferred slot — so the
  // pre-existing checkAppointmentRequestConflict (which correctly treats two
  // simultaneously-pending requests for the same preferred slot as mutually
  // blocking, by design, independent of this fix) does not pre-empt this
  // scenario. The race being tested here is staff overriding BOTH
  // conversions' target time to the SAME slot at convert time (a realistic
  // shape: two staff members independently offering the same just-opened
  // slot to two different waiting patients).
  const requestA = await createRequest({
    clinicId: fixtures.defaultClinicId,
    appointmentTypeId: service.id,
    practitionerId: practitioner.id,
    patientId: null,
    ...nextSlot(),
    patientName: 'Patient A',
  });
  const requestB = await createRequest({
    clinicId: fixtures.defaultClinicId,
    appointmentTypeId: service.id,
    practitionerId: practitioner.id,
    patientId: null,
    ...nextSlot(),
    patientName: 'Patient B',
  });
  const sharedSlot = nextSlot();

  await test('exactly one of the two distinct requests converts successfully for the shared overridden slot; the other is rejected, no double-booking, no orphan Patient', async () => {
    const patientsBefore = await countPatients(fixtures.orgId);
    const overrideBody = { startTime: sharedSlot.startTime.toISOString(), endTime: sharedSlot.endTime.toISOString() };
    const user = await ownerUser(fixtures);

    const [resA, resB] = await Promise.all([
      callConvert(requestA.id, user, overrideBody),
      callConvert(requestB.id, user, overrideBody),
    ]);

    const successCount = [resA, resB].filter(r => r.statusCode === 201).length;
    assert.equal(successCount, 1, 'exactly one of the two competing requests must win the shared slot');

    const loser = resA.statusCode === 201 ? resB : resA;
    assert.equal(loser.statusCode, 409);
    assert.equal(loser.body.code, 'APPOINTMENT_OVERLAP');

    const appointmentCount = await prisma.appointment.count({
      where: { clinicId: fixtures.defaultClinicId, practitionerId: practitioner.id, startTime: sharedSlot.startTime, endTime: sharedSlot.endTime },
    });
    assert.equal(appointmentCount, 1, 'the practitioner must not end up double-booked for this slot');

    // The losing request's new-patient path must not have left an orphan Patient.
    const patientsAfter = await countPatients(fixtures.orgId);
    assert.equal(patientsAfter, patientsBefore + 1, 'only the winner\'s new Patient should exist — the loser must leave no orphan');

    const loserRequestId = resA.statusCode === 201 ? requestB.id : requestA.id;
    const dbLoserRequest = await prisma.appointmentRequest.findUnique({ where: { id: loserRequestId } });
    assert.equal(dbLoserRequest!.status, 'pending', 'the losing request must remain untouched, still convertible for a different slot');
  });
}

// ─── 9 & 10. Unauthorized clinic / cross-organization behavior unchanged ────

async function scenarioUnauthorizedAndCrossOrgUnchanged() {
  section('9-10. Unauthorized clinic access and cross-organization behavior unchanged');
  const fixtures = await createClinicFixtureSet('conv-scope-unchanged');
  const practitioner = await createFullyAvailablePractitioner(fixtures, fixtures.unauthorizedClinicId);
  const service = await createService(fixtures.unauthorizedClinicId);
  const { startTime, endTime } = nextSlot();
  const request = await createRequest({
    clinicId: fixtures.unauthorizedClinicId,
    appointmentTypeId: service.id,
    practitionerId: practitioner.id,
    patientId: null,
    startTime,
    endTime,
  });

  await test('same-org staff NOT assigned to the request\'s clinic: 404 (not 403 — matches merged clinic-scope contract, no existence leak)', async () => {
    const staff = await createStaffUser({
      organizationId: fixtures.orgId,
      clinicId: fixtures.defaultClinicId,
      role: 'RECEPTIONIST',
      allowedClinicIds: [fixtures.defaultClinicId], // NOT unauthorizedClinicId
    });
    const req = authRequest({
      id: staff.id,
      organizationId: fixtures.orgId,
      clinicId: fixtures.defaultClinicId,
      role: 'RECEPTIONIST',
      allowedClinicIds: [fixtures.defaultClinicId],
      canAccessAllClinics: false,
    });
    const res = await callConvert(request.id, req);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Appointment request not found');
  });

  await test('cross-organization staff: 404, identical to unauthorized-same-org (no cross-org existence leak)', async () => {
    const otherOrgFixtures = await createClinicFixtureSet('conv-scope-other-org');
    const staff = await createStaffUser({
      organizationId: otherOrgFixtures.orgId,
      clinicId: otherOrgFixtures.defaultClinicId,
      role: 'OWNER',
      canAccessAllClinics: true,
    });
    const req = authRequest({
      id: staff.id,
      organizationId: otherOrgFixtures.orgId,
      clinicId: otherOrgFixtures.defaultClinicId,
      role: 'OWNER',
      canAccessAllClinics: true,
    });
    const res = await callConvert(request.id, req);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Appointment request not found');
  });

  await test('request status/patient unchanged after both denied attempts', async () => {
    const dbRequest = await prisma.appointmentRequest.findUnique({ where: { id: request.id } });
    assert.equal(dbRequest!.status, 'pending');
    assert.equal(dbRequest!.patientId, null);
  });
}

// ─── 11. Record-owned clinic attribution unchanged ──────────────────────────

async function scenarioRecordOwnedClinicAttributionUnchanged() {
  section('11. Record-owned clinic attribution unchanged (multi-clinic OWNER, request in a sibling clinic)');
  const fixtures = await createClinicFixtureSet('conv-record-owned-scope');
  // Request lives in the SIBLING clinic, not the acting user's own default clinic.
  const practitioner = await createFullyAvailablePractitioner(fixtures, fixtures.siblingClinicId);
  const service = await createService(fixtures.siblingClinicId);
  const { startTime, endTime } = nextSlot();
  const request = await createRequest({
    clinicId: fixtures.siblingClinicId,
    appointmentTypeId: service.id,
    practitionerId: practitioner.id,
    patientId: null,
    startTime,
    endTime,
  });

  await test('OWNER whose own default/session clinicId differs from the request\'s clinic still converts it, and every created row is attributed to the REQUEST\'s clinic, not the user\'s default clinic', async () => {
    // acting user's own default clinic is deliberately different from the request's clinic
    const user = await ownerUser(fixtures, fixtures.defaultClinicId);
    const res = await callConvert(request.id, user);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.appointment.clinicId, fixtures.siblingClinicId, 'appointment must be attributed to the request\'s own clinic');

    const newPatient = await prisma.patient.findUnique({ where: { id: res.body.appointment.patientId } });
    assert.equal(newPatient!.clinicId, fixtures.siblingClinicId, 'new patient must be attributed to the request\'s own clinic, not the acting user\'s default clinic');
  });
}

// ─── Run ──────────────────────────────────────────────────────────────────

async function main() {
  await scenarioExistingPatientSuccess();
  await scenarioNewPatientSuccess();
  await scenarioSlotConflictLeavesNoPatient();
  await scenarioAppointmentCreateFailureRollsBackPatient();
  await scenarioRequestUpdateFailureRollsBackPatientAndAppointment();
  await scenarioDuplicateSequentialConversion();
  await scenarioDuplicateConcurrentConversion();
  await scenarioDuplicateConcurrentConversionDifferentSlots();
  await scenarioTwoDifferentRequestsDifferentSlotsNoInterference();
  await scenarioTwoDifferentRequestsSameSlotConcurrent();
  await scenarioUnauthorizedAndCrossOrgUnchanged();
  await scenarioRecordOwnedClinicAttributionUnchanged();

  const ok = summary();
  await cleanupAllFixtures();
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  await cleanupAllFixtures().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
