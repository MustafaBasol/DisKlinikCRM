/**
 * detectImagingStudyRequestPatientMismatch.test.ts — F2-CT-23-R1 regression
 * suite for the bounded-pagination historical audit detector
 * (server/scripts/detect-imaging-study-request-patient-mismatch.ts).
 *
 * Exercises `scanForMismatches` directly (the exported, DB-client-injectable
 * core) against a REAL disposable PostgreSQL instance via the real Prisma
 * client, the same convention as imagingStudyRequestPatientConsistency.test.ts.
 * Every scenario below scopes the scan to its own fixture clinicId(s) via the
 * test-only `clinicIds` option, so results are exact and independent of
 * whatever other suites may have left in the shared disposable DB.
 *
 * Run: npx tsx src/tests/dbVerification/detectImagingStudyRequestPatientMismatch.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres with migrations
 * applied before import (server/src/db.ts opens a live pg pool at import time).
 */

import assert from 'node:assert/strict';
import { scanForMismatches, DEFAULT_BATCH_SIZE, type ScannableImagingStudyClient } from '../../../scripts/detect-imaging-study-request-patient-mismatch.js';
import {
  createSuite,
  createClinicFixtureSet,
  createStaffUser,
  createTestPatient,
  cleanupAllFixtures,
  prisma,
} from './dbVerificationHarness.js';

const { section, test, summary } = createSuite('DetectImagingStudyRequestPatientMismatch-F2-CT-23-R1');

const allFixtureClinicIds: string[] = [];
function trackClinics(...ids: string[]) {
  allFixtureClinicIds.push(...ids);
}

async function cleanupImagingFixtures(): Promise<void> {
  if (allFixtureClinicIds.length === 0) return;
  const clinicId = { in: allFixtureClinicIds };
  await prisma.imagingStudy.deleteMany({ where: { clinicId } });
  await prisma.imagingRequest.deleteMany({ where: { clinicId } });
}

/** Creates `count` consistent (study.patientId === request.patientId, same clinic) request+study pairs. */
async function createConsistentPairs(params: { clinicId: string; orgId: string; staffId: string; count: number; label: string }) {
  const ids: string[] = [];
  for (let i = 0; i < params.count; i++) {
    const patient = await createTestPatient({ organizationId: params.orgId, clinicId: params.clinicId, firstName: `${params.label}-${i}` });
    const request = await prisma.imagingRequest.create({
      data: { clinicId: params.clinicId, patientId: patient.id, requestedModality: 'PX', status: 'requested', requestedByUserId: params.staffId },
    });
    const study = await prisma.imagingStudy.create({
      data: { clinicId: params.clinicId, patientId: patient.id, imagingRequestId: request.id, modality: 'PX', status: 'active' },
    });
    ids.push(study.id);
  }
  return ids;
}

async function main() {
  // ═══════════════════════════════════════════════════════════════════════
  // 1. Empty dataset
  // ═══════════════════════════════════════════════════════════════════════
  section('1: empty dataset — no ImagingStudy rows with a non-null imagingRequestId in scope');
  {
    const fx = await createClinicFixtureSet('detect-empty');
    trackClinics(fx.defaultClinicId);

    await test('scanned=0, pages=0, mismatches=[] with no rows at all in scope', async () => {
      const result = await scanForMismatches(prisma as unknown as ScannableImagingStudyClient, {
        clinicIds: [fx.defaultClinicId],
        batchSize: 10,
      });
      assert.equal(result.scanned, 0);
      assert.equal(result.pages, 0);
      assert.deepEqual(result.mismatches, []);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Multiple pages, all consistent — exact scanned/page count, no findings
  // ═══════════════════════════════════════════════════════════════════════
  section('2: multiple pages of consistent rows — exact scanned count, zero mismatches, deterministic page count');
  {
    const fx = await createClinicFixtureSet('detect-pages');
    trackClinics(fx.defaultClinicId);
    const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
    await createConsistentPairs({ clinicId: fx.defaultClinicId, orgId: fx.orgId, staffId: staff.id, count: 25, label: 'Page' });

    await test('25 consistent rows at batchSize=10 scan in exactly 3 pages with zero mismatches', async () => {
      const result = await scanForMismatches(prisma as unknown as ScannableImagingStudyClient, {
        clinicIds: [fx.defaultClinicId],
        batchSize: 10,
      });
      assert.equal(result.scanned, 25);
      assert.equal(result.pages, 3);
      assert.deepEqual(result.mismatches, []);
    });

    await test('the same dataset at the default batch size still scans everything in one page', async () => {
      const result = await scanForMismatches(prisma as unknown as ScannableImagingStudyClient, {
        clinicIds: [fx.defaultClinicId],
      });
      assert.equal(result.scanned, 25);
      assert.ok(DEFAULT_BATCH_SIZE >= 25, 'default batch size assumption for this assertion');
      assert.equal(result.pages, 1);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Mismatch exactly at a page boundary — no duplicate/omitted rows
  // ═══════════════════════════════════════════════════════════════════════
  section('3: mismatches positioned exactly across a page boundary are found exactly once each');
  {
    const fx = await createClinicFixtureSet('detect-boundary');
    trackClinics(fx.defaultClinicId);
    const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
    const otherPatient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'BoundaryOther' });

    const ids = await createConsistentPairs({ clinicId: fx.defaultClinicId, orgId: fx.orgId, staffId: staff.id, count: 25, label: 'Boundary' });

    const batchSize = 10;
    // Pagination orders by `id` ascending (Postgres/JS default string
    // ordering coincide for lowercase-hex-with-hyphen UUIDs) — sort locally
    // to find exactly which studyIds land on the page1/page2 boundary
    // (indices batchSize-1 and batchSize) and corrupt precisely those two,
    // simulating pre-fix historical corruption via a direct write (never
    // reachable through the app's own guarded route anymore).
    const sortedIds = [...ids].sort();
    const lastOfPage1 = sortedIds[batchSize - 1];
    const firstOfPage2 = sortedIds[batchSize];

    await prisma.imagingStudy.update({ where: { id: lastOfPage1 }, data: { patientId: otherPatient.id } });
    await prisma.imagingStudy.update({ where: { id: firstOfPage2 }, data: { patientId: otherPatient.id } });

    await test('both boundary-straddling mismatches are reported exactly once, all others untouched', async () => {
      const result = await scanForMismatches(prisma as unknown as ScannableImagingStudyClient, {
        clinicIds: [fx.defaultClinicId],
        batchSize,
      });
      assert.equal(result.scanned, 25, 'every row still scanned exactly once total');
      assert.equal(result.pages, 3);
      assert.equal(result.mismatches.length, 2, 'exactly the two corrupted rows, no duplicates or omissions');
      const mismatchedIds = result.mismatches.map((m) => m.studyId).sort();
      assert.deepEqual(mismatchedIds, [lastOfPage1, firstOfPage2].sort());
      for (const m of result.mismatches) {
        assert.equal(m.reasons.patientMismatch, true);
        assert.equal(m.reasons.clinicMismatch, false);
        assert.equal(m.reasons.missingRequest, false);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Cross-clinic anomaly is detected via clinicMismatch, distinctly from
  //    patientMismatch — and the scan never mutates anything (read-only).
  // ═══════════════════════════════════════════════════════════════════════
  section('4: cross-clinic anomaly reported distinctly; scan performs zero writes');
  {
    const fx = await createClinicFixtureSet('detect-clinic');
    trackClinics(fx.defaultClinicId, fx.siblingClinicId);
    const staff = await createStaffUser({
      organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER',
      allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId],
    });
    const patientDefault = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'ClinicMismatchDefault' });
    // Deliberately anomalous by construction (as in
    // imagingStudyRequestPatientConsistency.test.ts scenarios 6/7): a request
    // in the sibling clinic referencing the DEFAULT clinic's patient — not
    // reachable through any current app write path — isolates clinicMismatch
    // from patientMismatch by keeping patientId identical on both sides.
    const siblingRequest = await prisma.imagingRequest.create({
      data: { clinicId: fx.siblingClinicId, patientId: patientDefault.id, requestedModality: 'PX', status: 'requested', requestedByUserId: staff.id },
    });
    const anomalousStudy = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patientDefault.id, imagingRequestId: siblingRequest.id, modality: 'PX', status: 'active' },
    });

    const beforeRows = await prisma.imagingStudy.findMany({
      where: { clinicId: { in: [fx.defaultClinicId, fx.siblingClinicId] } },
      select: { id: true, patientId: true, clinicId: true, imagingRequestId: true, updatedAt: true },
      orderBy: { id: 'asc' },
    });

    await test('clinicMismatch=true, patientMismatch=false for a same-patient cross-clinic anomaly', async () => {
      const result = await scanForMismatches(prisma as unknown as ScannableImagingStudyClient, {
        clinicIds: [fx.defaultClinicId, fx.siblingClinicId],
        batchSize: 5,
      });
      assert.equal(result.mismatches.length, 1);
      assert.equal(result.mismatches[0].studyId, anomalousStudy.id);
      assert.equal(result.mismatches[0].reasons.clinicMismatch, true);
      assert.equal(result.mismatches[0].reasons.patientMismatch, false);
    });

    await test('the scan performed zero writes — every row byte-for-byte unchanged after scanning', async () => {
      const afterRows = await prisma.imagingStudy.findMany({
        where: { clinicId: { in: [fx.defaultClinicId, fx.siblingClinicId] } },
        select: { id: true, patientId: true, clinicId: true, imagingRequestId: true, updatedAt: true },
        orderBy: { id: 'asc' },
      });
      assert.deepEqual(
        afterRows.map((r) => ({ ...r, updatedAt: r.updatedAt.getTime() })),
        beforeRows.map((r) => ({ ...r, updatedAt: r.updatedAt.getTime() })),
      );
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. DB/query errors propagate (so the CLI's main() sets a non-zero exit)
  // ═══════════════════════════════════════════════════════════════════════
  section('5: a query failure propagates as a rejected promise, never swallowed');
  {
    const failingClient: ScannableImagingStudyClient = {
      imagingStudy: {
        findMany: async () => {
          throw new Error('simulated DB/query failure');
        },
      },
    };

    await test('scanForMismatches rejects instead of returning a partial/empty result', async () => {
      await assert.rejects(
        () => scanForMismatches(failingClient, { batchSize: 10 }),
        /simulated DB\/query failure/,
      );
    });
  }
}

main()
  .catch((err) => {
    console.error('[detect-imaging-study-request-patient-mismatch.test] Fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanupImagingFixtures();
    } catch (err) {
      console.error('[detect-imaging-study-request-patient-mismatch.test] cleanupImagingFixtures failed:', err);
    }
    try {
      await cleanupAllFixtures();
    } catch (err) {
      console.error('[detect-imaging-study-request-patient-mismatch.test] cleanupAllFixtures failed:', err);
    }
    const ok = summary();
    if (!ok) process.exitCode = 1;
    await prisma.$disconnect().catch(() => {});
  });
