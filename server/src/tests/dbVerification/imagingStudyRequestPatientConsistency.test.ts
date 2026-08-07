/**
 * imagingStudyRequestPatientConsistency.test.ts — F2-CT-23 regression suite.
 *
 * Regression coverage for the fix to `PATCH /api/imaging/studies/:id/link`
 * (server/src/routes/imaging.ts) closing the gap first characterized (as
 * VERIFIED_DEFECT) by server/src/tests/imagingCharacterizationTenantLifecycle.test.ts
 * CT-23: a study created from an open ImagingRequest could be relinked to a
 * DIFFERENT patient than the request's own patientId, leaving
 * `ImagingStudy.imagingRequestId` dangling at the original patient's request
 * while `ImagingStudy.patientId` pointed at someone else.
 *
 * Invariant under test: if `ImagingStudy.imagingRequestId` is non-null, the
 * referenced `ImagingRequest.patientId` must equal `ImagingStudy.patientId`
 * after every commit — never only checked, never transiently violated. The
 * fix enforces this with a guarded `updateMany` whose WHERE predicate
 * (`imagingRequestId: null OR imagingRequest: { clinicId, patientId }`) is
 * re-evaluated by Postgres at the same statement as the write, not a
 * read-then-trust sequence.
 *
 * Exercises the REAL Express route handlers (extracted via getFullChain,
 * same convention as imagingCharacterizationTenantLifecycle.test.ts) against
 * a REAL disposable PostgreSQL instance via the real Prisma client. Scenarios
 * 6-8 construct data anomalies (cross-clinic/cross-org/nonexistent
 * imagingRequestId on a study) directly via Prisma — these are NOT reachable
 * through any current write path in the app (ImagingStudy creation always
 * validates the request's clinic before attaching it, and no route ever
 * changes ImagingStudy.clinicId or ImagingRequest.patientId after creation)
 * — they exist here purely to prove the fix fails closed in depth, not only
 * against the one gap the app's own write paths can actually produce.
 *
 * Run: npx tsx src/tests/dbVerification/imagingStudyRequestPatientConsistency.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres with migrations
 * applied before import (server/src/db.ts opens a live pg pool at import time).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import imagingRouter from '../../routes/imaging.js';
import {
  createSuite,
  createClinicFixtureSet,
  createStaffUser,
  createTestPatient,
  cleanupAllFixtures,
  authRequest,
  mockResponse,
  getFullChain,
  runChain,
  prisma,
} from './dbVerificationHarness.js';

const { section, test, summary } = createSuite('ImagingStudyRequestPatientConsistency-F2-CT-23');

// ─── Cleanup tracking (deterministic, FK-safe, finally-block only) ─────────

const allFixtureClinicIds: string[] = [];
function trackClinics(...ids: string[]) {
  allFixtureClinicIds.push(...ids);
}

async function cleanupImagingFixtures(): Promise<void> {
  if (allFixtureClinicIds.length === 0) return;
  const clinicId = { in: allFixtureClinicIds };
  await prisma.imagingImage.deleteMany({ where: { clinicId } });
  await prisma.imagingStudy.deleteMany({ where: { clinicId } });
  await prisma.imagingRequest.deleteMany({ where: { clinicId } });
}

const LINK_CHAIN = getFullChain(imagingRouter as any, 'patch', '/imaging/studies/:id/link');
const UNLINK_CHAIN = getFullChain(imagingRouter as any, 'patch', '/imaging/studies/:id/unlink');

async function link(staff: any, studyId: string, body: Record<string, unknown>) {
  const req = authRequest(staff, { params: { id: studyId }, body });
  const res = mockResponse();
  await runChain(LINK_CHAIN, req, res);
  return res;
}

async function unlink(staff: any, studyId: string) {
  const req = authRequest(staff, { params: { id: studyId }, body: {} });
  const res = mockResponse();
  await runChain(UNLINK_CHAIN, req, res);
  return res;
}

async function main() {
  // ═══════════════════════════════════════════════════════════════════════
  // 1. same patient + same request => succeeds
  // ═══════════════════════════════════════════════════════════════════════
  section('1: relinking with the request-originated patient unchanged succeeds');
  {
    const fx = await createClinicFixtureSet('ct23r-1');
    trackClinics(fx.defaultClinicId);
    const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
    const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'Same' });
    const request = await prisma.imagingRequest.create({
      data: { clinicId: fx.defaultClinicId, patientId: patient.id, requestedModality: 'PX', status: 'requested', requestedByUserId: staff.id },
    });
    const study = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patient.id, imagingRequestId: request.id, modality: 'PX', status: 'active' },
    });

    await test('same patientId as the originating request succeeds (200) and imagingRequestId is preserved', async () => {
      const res = await link(staff, study.id, { patientId: patient.id });
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      const row = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: study.id } });
      assert.equal(row.patientId, patient.id);
      assert.equal(row.imagingRequestId, request.id);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. patient changed, old request retained => rejected
  // ═══════════════════════════════════════════════════════════════════════
  section('2: relinking to a different patient while imagingRequestId is retained is rejected');
  {
    const fx = await createClinicFixtureSet('ct23r-2');
    trackClinics(fx.defaultClinicId);
    const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
    const patientOriginal = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'Original' });
    const patientOther = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'Other' });
    const request = await prisma.imagingRequest.create({
      data: { clinicId: fx.defaultClinicId, patientId: patientOriginal.id, requestedModality: 'CT', status: 'requested', requestedByUserId: staff.id },
    });
    const study = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patientOriginal.id, imagingRequestId: request.id, modality: 'CT', status: 'active' },
    });

    await test('different (same-clinic) patientId than the request is rejected (409), no write occurs', async () => {
      const before = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: study.id } });
      const res = await link(staff, study.id, { patientId: patientOther.id });
      assert.equal(res.statusCode, 409, JSON.stringify(res.body));
      const after = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: study.id } });
      assert.equal(after.patientId, before.patientId, 'patientId must be unchanged');
      assert.equal(after.imagingRequestId, before.imagingRequestId, 'imagingRequestId must be unchanged');
      assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), 'no row mutation at all on a rejected relink');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. no imagingRequestId on the study => relink to any valid patient succeeds
  //    (the closest reachable analogue to "patient and request changed
  //    consistently": the current /link contract has no field to change
  //    imagingRequestId, so the only way a relink to a new patient can be
  //    "consistent" is when there is no request attached to be inconsistent
  //    with — the OR{imagingRequestId:null} branch of the guard)
  // ═══════════════════════════════════════════════════════════════════════
  section('3: relinking a study with no imagingRequestId to any valid same-clinic patient succeeds');
  {
    const fx = await createClinicFixtureSet('ct23r-3');
    trackClinics(fx.defaultClinicId);
    const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
    const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'Unlinked' });
    const study = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: null, imagingRequestId: null, modality: 'IO', status: 'active' },
    });

    await test('a study never attached to any ImagingRequest can be linked to any valid patient (200)', async () => {
      const res = await link(staff, study.id, { patientId: patient.id });
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      const row = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: study.id } });
      assert.equal(row.patientId, patient.id);
      assert.equal(row.imagingRequestId, null);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. patient changed + request cleared — current contract check: /link has
  //    no field to clear imagingRequestId itself (that is /unlink's sole
  //    job, and /unlink clears patientId/appointmentId/treatmentCaseId too,
  //    not a selective "keep new patient, drop only the request"). The
  //    supported path for this business need is the two-step
  //    unlink-then-relink sequence — verified below.
  // ═══════════════════════════════════════════════════════════════════════
  section('4: detach-then-relink is the current contract\'s supported path to move a request-originated study to a new patient');
  {
    const fx = await createClinicFixtureSet('ct23r-4');
    trackClinics(fx.defaultClinicId);
    const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
    const patientOriginal = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'PreDetach' });
    const patientNew = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'PostDetach' });
    const request = await prisma.imagingRequest.create({
      data: { clinicId: fx.defaultClinicId, patientId: patientOriginal.id, requestedModality: 'SCANNER', status: 'requested', requestedByUserId: staff.id },
    });
    const study = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patientOriginal.id, imagingRequestId: request.id, modality: 'SCANNER', status: 'active' },
    });

    await test('direct relink to the new patient is rejected while imagingRequestId is still attached', async () => {
      const res = await link(staff, study.id, { patientId: patientNew.id });
      assert.equal(res.statusCode, 409, JSON.stringify(res.body));
    });

    await test('unlink clears patientId/imagingRequestId together (200)', async () => {
      const res = await unlink(staff, study.id);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      const row = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: study.id } });
      assert.equal(row.patientId, null);
      assert.equal(row.imagingRequestId, null);
    });

    await test('a subsequent link to the new patient now succeeds, with imagingRequestId staying null', async () => {
      const res = await link(staff, study.id, { patientId: patientNew.id });
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      const row = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: study.id } });
      assert.equal(row.patientId, patientNew.id);
      assert.equal(row.imagingRequestId, null);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. request for another patient, same clinic => rejected (explicit,
  //    single-purpose scenario distinct from #2's broader assertions)
  // ═══════════════════════════════════════════════════════════════════════
  section('5: same-clinic patient mismatch against the linked request is rejected');
  {
    const fx = await createClinicFixtureSet('ct23r-5');
    trackClinics(fx.defaultClinicId);
    const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
    const requestPatient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'RequestOwner' });
    const otherPatient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'NotRequestOwner' });
    const request = await prisma.imagingRequest.create({
      data: { clinicId: fx.defaultClinicId, patientId: requestPatient.id, requestedModality: 'PX', status: 'scheduled', requestedByUserId: staff.id },
    });
    const study = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: requestPatient.id, imagingRequestId: request.id, modality: 'PX', status: 'active' },
    });

    await test('rejected with 409 and a descriptive error', async () => {
      const res = await link(staff, study.id, { patientId: otherPatient.id });
      assert.equal(res.statusCode, 409);
      assert.match(String(res.body?.error ?? ''), /different patient/i);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 6. imagingRequestId points at a request in a DIFFERENT clinic (same org)
  //    => rejected. Not reachable via any current write path — constructed
  //    directly to prove the guard's clinicId-scoped relation filter (not
  //    just patientId) fails closed in depth.
  // ═══════════════════════════════════════════════════════════════════════
  section('6: cross-clinic imagingRequestId anomaly is rejected (defense in depth)');
  {
    const fx = await createClinicFixtureSet('ct23r-6');
    trackClinics(fx.defaultClinicId, fx.siblingClinicId);
    const staff = await createStaffUser({
      organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER',
      allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId],
    });
    const patientDefault = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'DefaultClinicPatient' });
    const patientSibling = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.siblingClinicId, firstName: 'SiblingClinicPatient' });
    const siblingStaff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.siblingClinicId, role: 'OWNER' });
    const siblingClinicRequest = await prisma.imagingRequest.create({
      data: { clinicId: fx.siblingClinicId, patientId: patientSibling.id, requestedModality: 'PX', status: 'requested', requestedByUserId: siblingStaff.id },
    });
    // Anomalous by construction: no app write path lets a study's clinicId
    // diverge from its imagingRequest's clinicId — this row could only arise
    // from a historical bug or manual data intervention.
    const anomalousStudy = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patientDefault.id, imagingRequestId: siblingClinicRequest.id, modality: 'PX', status: 'active' },
    });

    await test('relink attempt on the cross-clinic-anomalous study is rejected (409), never trusts the mismatched-clinic request', async () => {
      const res = await link(staff, anomalousStudy.id, { patientId: patientDefault.id });
      assert.equal(res.statusCode, 409, JSON.stringify(res.body));
      const row = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: anomalousStudy.id } });
      assert.equal(row.patientId, patientDefault.id, 'unchanged — rejected write');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 7. imagingRequestId points at a request in a DIFFERENT organization
  //    => rejected. Same defense-in-depth rationale as #6, cross-org variant.
  // ═══════════════════════════════════════════════════════════════════════
  section('7: cross-organization imagingRequestId anomaly is rejected (defense in depth)');
  {
    const fx = await createClinicFixtureSet('ct23r-7');
    trackClinics(fx.defaultClinicId, fx.crossOrgClinicId);
    const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
    const patientDefault = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'OrgOnePatient' });
    const patientCrossOrg = await createTestPatient({ organizationId: fx.otherOrgId, clinicId: fx.crossOrgClinicId, firstName: 'OrgTwoPatient' });
    const crossOrgStaff = await createStaffUser({ organizationId: fx.otherOrgId, clinicId: fx.crossOrgClinicId, role: 'OWNER' });
    const crossOrgRequest = await prisma.imagingRequest.create({
      data: { clinicId: fx.crossOrgClinicId, patientId: patientCrossOrg.id, requestedModality: 'CEPH', status: 'requested', requestedByUserId: crossOrgStaff.id },
    });
    const anomalousStudy = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patientDefault.id, imagingRequestId: crossOrgRequest.id, modality: 'CEPH', status: 'active' },
    });

    await test('relink attempt on the cross-org-anomalous study is rejected (409)', async () => {
      const res = await link(staff, anomalousStudy.id, { patientId: patientDefault.id });
      assert.equal(res.statusCode, 409, JSON.stringify(res.body));
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 8. imagingRequestId references a nonexistent ImagingRequest => the DB's
  //    own foreign key (ImagingStudy_imagingRequestId_fkey) makes this state
  //    unconstructible in the first place — verified directly below, since
  //    it is a stronger guarantee than any application-level guard could
  //    provide (no code path, including a future one, can ever create this
  //    row). This also confirms the guard's own 409 path (scenarios 2/5/6/7)
  //    is defense-in-depth on TOP OF referential integrity, not a
  //    substitute for it.
  // ═══════════════════════════════════════════════════════════════════════
  section('8: nonexistent imagingRequestId cannot exist — enforced at the database level, not application code');
  {
    const fx = await createClinicFixtureSet('ct23r-8');
    trackClinics(fx.defaultClinicId);
    const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'GhostRequest' });

    await test('creating a study with a nonexistent imagingRequestId fails at the DB with a foreign-key violation (P2003), before any /link call is even possible', async () => {
      await assert.rejects(
        () => prisma.imagingStudy.create({
          data: { clinicId: fx.defaultClinicId, patientId: patient.id, imagingRequestId: randomUUID(), modality: 'OTHER', status: 'active' },
        }),
        (err: any) => err?.code === 'P2003',
      );
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 9. existing valid study/request relationship remains unchanged by an
  //    unrelated field update (appointmentId) on the same patient
  // ═══════════════════════════════════════════════════════════════════════
  section('9: updating only appointmentId (patient unchanged) leaves the request relationship intact');
  {
    const fx = await createClinicFixtureSet('ct23r-9');
    trackClinics(fx.defaultClinicId);
    const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
    const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'StableRelationship' });
    const request = await prisma.imagingRequest.create({
      data: { clinicId: fx.defaultClinicId, patientId: patient.id, requestedModality: 'IO_CAMERA', status: 'requested', requestedByUserId: staff.id },
    });
    const study = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patient.id, imagingRequestId: request.id, modality: 'IO_CAMERA', status: 'active' },
    });
    const appointmentType = await prisma.appointmentType.create({
      data: { clinicId: fx.defaultClinicId, name: 'CT-23 Regression Appointment Type', durationMinutes: 30 },
    });
    const appointment = await prisma.appointment.create({
      data: {
        clinicId: fx.defaultClinicId, patientId: patient.id, practitionerId: staff.id, appointmentTypeId: appointmentType.id,
        startTime: new Date('2026-09-01T10:00:00Z'), endTime: new Date('2026-09-01T10:30:00Z'), status: 'scheduled',
      },
    });

    await test('same patientId + a newly-supplied appointmentId succeeds and imagingRequestId is untouched', async () => {
      const res = await link(staff, study.id, { patientId: patient.id, appointmentId: appointment.id });
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      const row = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: study.id } });
      assert.equal(row.patientId, patient.id);
      assert.equal(row.imagingRequestId, request.id);
      assert.equal(row.appointmentId, appointment.id);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 10. concurrency: a real /unlink and a real /link race against the same
  //     study. JavaScript's single-threaded execution cannot simulate a real
  //     database race, so this fires two genuinely concurrent Promise.all()
  //     calls into the real route handlers against the real Postgres
  //     instance — same technique as
  //     dbVerification/patientEmergencyContactsPrimaryConcurrency.test.ts.
  //     Whichever order the two statements actually commit in, the guarded
  //     updateMany's WHERE predicate is evaluated by Postgres AT THE WRITE
  //     ITSELF, not against an earlier in-memory read — /link's route code
  //     never reads imagingRequestId before building that predicate, so
  //     there is no read-then-write gap in this route for a race to land
  //     in. This round-robin of real concurrent calls is the empirical
  //     confirmation of that architectural guarantee, not the mechanism the
  //     guarantee depends on: the invariant (imagingRequestId non-null ⇒
  //     patientId matches the request) must hold in EVERY observed final
  //     state — no interleaving is allowed to produce a transient or
  //     committed inconsistency, regardless of which one Postgres happens
  //     to serialize first.
  // ═══════════════════════════════════════════════════════════════════════
  section('10: concurrent /link and /unlink on the same study never commit an inconsistent state');
  {
    const CONCURRENCY_ROUNDS = 25;
    let sawLinkWin = false;
    let sawUnlinkWin = false;

    for (let i = 0; i < CONCURRENCY_ROUNDS; i++) {
      const fx = await createClinicFixtureSet(`ct23r-10-${i}`);
      trackClinics(fx.defaultClinicId);
      const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
      const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'RaceTarget' });
      const request = await prisma.imagingRequest.create({
        data: { clinicId: fx.defaultClinicId, patientId: patient.id, requestedModality: 'PX', status: 'requested', requestedByUserId: staff.id },
      });
      const study = await prisma.imagingStudy.create({
        data: { clinicId: fx.defaultClinicId, patientId: patient.id, imagingRequestId: request.id, modality: 'PX', status: 'active' },
      });

      const [linkRes, unlinkRes] = await Promise.all([
        link(staff, study.id, { patientId: patient.id }),
        unlink(staff, study.id),
      ]);

      const row = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: study.id } });
      if (row.imagingRequestId !== null) {
        // /link "won" the race (its guarded update saw imagingRequestId
        // still set to `request.id` and patientId still matched it) — the
        // invariant requires the request's own patientId to still equal
        // the study's.
        assert.equal(linkRes.statusCode, 200, `round ${i}: link should have succeeded if it left imagingRequestId set`);
        assert.equal(row.imagingRequestId, request.id);
        assert.equal(row.patientId, patient.id, `round ${i}: INVARIANT VIOLATION — imagingRequestId set but patientId diverged`);
        sawLinkWin = true;
      } else {
        // /unlink "won" (or both landed with unlink's null-clearing write
        // last) — imagingRequestId is null, so the invariant is vacuously
        // satisfied regardless of what /link wrote beforehand.
        assert.equal(unlinkRes.statusCode, 200, `round ${i}: unlink should always succeed (unconditional update, no guard)`);
        sawUnlinkWin = true;
      }
    }

    await test(`across ${CONCURRENCY_ROUNDS} genuinely concurrent rounds, every final state satisfies the invariant (both interleavings observed: link-visible=${sawLinkWin}, unlink-visible=${sawUnlinkWin})`, () => {
      // The assertions above run per-round inside the loop (real
      // concurrency requires it — a single Promise.all can't be
      // re-checked after the fact from outside the loop); this final test
      // just confirms the loop completed all rounds without an uncaught
      // invariant violation and records which interleavings the real
      // scheduler actually produced, for evidence purposes.
      assert.ok(sawLinkWin || sawUnlinkWin, 'at least one interleaving must have been observed');
    });
  }

  const ok = summary();
  return ok;
}

main()
  .then(async (ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((err) => {
    console.error('[imaging-study-request-patient-consistency] Fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanupImagingFixtures();
    } catch (err) {
      console.error('[imaging-study-request-patient-consistency] cleanupImagingFixtures failed:', err);
      process.exitCode = 1;
    }
    try {
      await cleanupAllFixtures();
    } catch (err) {
      console.error('[imaging-study-request-patient-consistency] cleanupAllFixtures failed:', err);
      process.exitCode = 1;
    }
    await prisma.$disconnect().catch(() => {});
  });
