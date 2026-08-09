/**
 * privacyImagingLifecyclePortMigration.test.ts — F2-STAGE3-IMPL-001 /
 * F2-STAGE3-DEFERRED-GAPA-001 regression suite for the Privacy/KVKK
 * ImagingLifecyclePort caller migration (server/src/services/privacy/
 * {patientAnonymization, orphanFileInspection}.ts).
 *
 * Proves, against a REAL disposable PostgreSQL instance via the real Prisma
 * client (server/src/db.ts) and the REAL exported service functions:
 *
 *   A. patientAnonymization uses ImagingLifecyclePort (not direct Prisma)
 *   B. normal (non-legal-hold) image redaction succeeds
 *   C. legal-held image preserves the pre-migration skip/count behavior
 *   D. redaction counters are compatible with pre-migration semantics
 *   E. audit/activity logging remains caller-owned and unchanged
 *   F. orphanFileInspection.inspectOrphans uses ImagingLifecyclePort
 *   G. missing storage is classified exactly as before
 *   H. storage-unavailable behavior remains exactly as before (propagates)
 *   I. existing BATCH_SIZE truncation behavior is equivalent
 *   J. cross-tenant/cross-clinic imaging cannot be acted on or inspected
 *   K. a clinicId that does not own the target does not leak existence
 *   L. markConfirmedMissing (F2-STAGE3-DEFERRED-GAPA-001) is now
 *      tenant-scoped through ImagingLifecyclePort.markStorageMissing —
 *      same-clinic marking succeeds, cross-clinic and nonexistent imaging
 *      ids fail identically without mutation or existence leakage, the
 *      write is idempotent, the attachment branch is unchanged, and no
 *      storage key/filename is ever logged
 *   M. deletionReviewInventory.ts uses ImagingLifecyclePort, not direct Prisma
 *      (F2-STAGE3-DEFERRED-GAPB-001 — supersedes the prior "remains
 *      untouched, out of scope" characterization from F2-STAGE3-IMPL-001)
 *   N-R. deletionReviewInventory.ts imaging counts/estimatedBytes/blockers are
 *      byte-for-byte compatible with the pre-migration direct-Prisma
 *      implementation, including zero-imaging and cross-clinic isolation
 *      cases, with no storage-key/path/filename leakage into the response
 *
 * Also covers a legal-hold TOCTOU race (a hold acquired between the
 * lifecycle-review read and the port's redact call), which the pre-migration
 * direct-Prisma code could not detect but the migrated adapter now maps back
 * onto the existing skippedLegalHold counter instead of surfacing a new
 * failure (see patientAnonymization.ts's redactPatientImagingImages doc
 * comment).
 *
 * Run: cd server && npx tsx src/tests/dbVerification/privacyImagingLifecyclePortMigration.test.ts
 * (requires DATABASE_URL pointing at a disposable Postgres with migrations applied)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { anonymizePatientData } from '../../services/privacy/patientAnonymization.js';
import { inspectOrphans, markConfirmedMissing } from '../../services/privacy/orphanFileInspection.js';
import { buildDeletionReviewInventory } from '../../services/privacy/deletionReviewInventory.js';
import {
  checkImageStorageExists,
  ImagingNotFoundError,
  __setRedactionPreMutationBarrierForTest,
  __setImagingStorageExistenceCheckerForTest,
} from '../../services/imaging/public.js';
import { saveFile, buildStorageKey } from '../../services/fileStorage.js';
import {
  createSuite,
  createClinicFixtureSet,
  createStaffUser,
  createTestPatient,
  cleanupAllFixtures,
  prisma,
} from './dbVerificationHarness.js';

const { section, test, summary } = createSuite('Privacy-Imaging-Lifecycle-Port-Migration (F2-STAGE3-IMPL-001)');

// ─── Cleanup tracking (deterministic, FK-safe, finally-block only) ─────────

const allFixtureClinicIds: string[] = [];
const createdUploadDirs: string[] = [];

function trackClinics(...ids: string[]) {
  allFixtureClinicIds.push(...ids);
}

async function cleanupImagingFixtures(): Promise<void> {
  if (allFixtureClinicIds.length === 0) return;
  const clinicId = { in: allFixtureClinicIds };

  await prisma.auditLog.deleteMany({ where: { clinicId } });
  await prisma.imagingImage.deleteMany({ where: { clinicId } });
  await prisma.imagingStudy.deleteMany({ where: { clinicId } });
  await prisma.patientPrivacyRequest.deleteMany({ where: { clinicId } });
}

async function cleanupUploadDirs(): Promise<void> {
  for (const dir of createdUploadDirs) {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

const BASE_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
function localFilePath(storageKey: string): string {
  return path.join(BASE_UPLOAD_DIR, storageKey);
}

async function writeTestImageFile(clinicId: string, content: Buffer): Promise<string> {
  const key = buildStorageKey(clinicId, `${randomUUID()}.bin`);
  await saveFile(key, content, 'application/octet-stream');
  createdUploadDirs.push(path.dirname(localFilePath(key)));
  return key;
}

async function main() {
  // ═══════════════════════════════════════════════════════════════════════
  // A-E — patientAnonymization.ts imaging redaction via ImagingLifecyclePort
  // ═══════════════════════════════════════════════════════════════════════
  section('A-E: patientAnonymization imaging redaction via ImagingLifecyclePort');
  {
    const fx = await createClinicFixtureSet('f2s3anon');
    trackClinics(fx.defaultClinicId, fx.crossOrgClinicId);
    const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });

    const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'PortAnonTarget' });
    const studyPlain = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patient.id, modality: 'PX', status: 'active', legalHold: false },
    });
    const studyHeld = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patient.id, modality: 'CT', status: 'active', legalHold: true, legalHoldReason: 'pending litigation' },
    });
    const imagePlain = await prisma.imagingImage.create({
      data: { clinicId: fx.defaultClinicId, studyId: studyPlain.id, fileName: 'p.bin', originalName: 'patient-plain.jpg', fileSize: 10, mimeType: 'application/octet-stream', filePath: `${fx.defaultClinicId}/plain-${randomUUID()}.bin` },
    });
    const imageHeld = await prisma.imagingImage.create({
      data: { clinicId: fx.defaultClinicId, studyId: studyHeld.id, fileName: 'h.bin', originalName: 'patient-held.jpg', fileSize: 10, mimeType: 'application/octet-stream', filePath: `${fx.defaultClinicId}/held-${randomUUID()}.bin` },
    });

    let barrierCalls = 0;
    let result: Awaited<ReturnType<typeof anonymizePatientData>>;

    await test('A: anonymizePatientData exercises ImagingLifecyclePort.redactForAnonymization (proven via the port pre-mutation-barrier test hook — not direct Prisma)', async () => {
      __setRedactionPreMutationBarrierForTest(async () => { barrierCalls++; });
      try {
        result = await anonymizePatientData({
          clinicId: fx.defaultClinicId, patientId: patient.id, actorUserId: staff.id,
          actorRole: staff.role, organizationId: fx.orgId, reason: 'F2-STAGE3-IMPL-001 port-usage proof',
        });
      } finally {
        __setRedactionPreMutationBarrierForTest(null);
      }
      // The barrier only fires from inside redactForAnonymization's mutation
      // path (server/src/services/imaging/public.ts) — it cannot fire from a
      // direct prisma.imagingImage.update call, so a nonzero count is only
      // possible if the port itself was invoked.
      assert.equal(barrierCalls, 1, 'redactForAnonymization pre-mutation barrier must fire exactly once (for the single non-legal-hold image)');
    });

    await test('B: normal (non-legal-hold) image redaction succeeds', async () => {
      const row = await prisma.imagingImage.findUniqueOrThrow({ where: { id: imagePlain.id } });
      assert.equal(row.originalName, '[ANONYMIZED]');
    });

    await test('C: legal-held image preserves the pre-migration skip/count behavior (never mutated, counted as skippedLegalHold)', async () => {
      const row = await prisma.imagingImage.findUniqueOrThrow({ where: { id: imageHeld.id } });
      assert.equal(row.originalName, 'patient-held.jpg', 'legal-hold image metadata must be left completely untouched');
      assert.equal(result.imagingResults.skippedLegalHold, 1);
    });

    await test('D: redaction counters are exactly compatible with pre-migration semantics on a first run', async () => {
      assert.equal(result.imagingResults.total, 2);
      assert.equal(result.imagingResults.redacted, 1);
      assert.equal(result.imagingResults.skippedLegalHold, 1);
      assert.equal(result.imagingResults.failed, 0);
      assert.equal(result.partialFailure, false);
    });

    await test('E: audit log ownership remains with the caller (patientAnonymization), not the port — written exactly once, no image storage key/path leaked', async () => {
      const auditRows = await prisma.auditLog.findMany({
        where: { clinicId: fx.defaultClinicId, entityId: patient.id, action: 'patient_anonymized' },
      });
      assert.equal(auditRows.length, 1, 'exactly one audit log row for this anonymization run');
      const meta = auditRows[0]!.metadata as any;
      assert.equal(meta.imagingResults.total, 2);
      assert.equal(meta.imagingResults.redacted, 1);
      assert.equal(meta.imagingResults.skippedLegalHold, 1);
      const metaJson = JSON.stringify(meta);
      assert.ok(!metaJson.includes(imagePlain.filePath), 'audit metadata must never contain an imaging storage key/path');
      assert.ok(!metaJson.includes(imageHeld.filePath), 'audit metadata must never contain an imaging storage key/path');
      assert.ok(!metaJson.includes('patient-plain.jpg'), 'audit metadata must never contain the original (pre-redaction) filename');

      const activityRows = await prisma.activityLog.findMany({
        where: { clinicId: fx.defaultClinicId, patientId: patient.id, action: 'anonymized' },
      });
      assert.equal(activityRows.length, 1, 'exactly one activity log row for this anonymization run');
    });

    await test('idempotent re-run: already-anonymized patient re-runs imaging redaction as a true safe no-op (failed stays 0, held row still untouched, plain row still redacted, redacted count stays 0 — F2-STAGE3-IMPL-001-R1)', async () => {
      const second = await anonymizePatientData({
        clinicId: fx.defaultClinicId, patientId: patient.id, actorUserId: staff.id,
        actorRole: staff.role, organizationId: fx.orgId, reason: 'second run',
      });
      assert.equal(second.alreadyAnonymized, true);
      assert.equal(second.imagingResults.failed, 0);
      assert.equal(second.imagingResults.skippedLegalHold, 1, 'held image is still skipped by the DTO legalHold flag, never re-touched');
      // F2-STAGE3-IMPL-001-R1: redactForAnonymization now returns a
      // { changed: boolean } mutation outcome, and the caller increments
      // `redacted` only when changed === true. An idempotent no-op
      // redaction (the row was already redacted) reports changed: false, so
      // it is correctly excluded from `redacted` on a re-run — restoring
      // exact pre-migration counter semantics. This is no longer a
      // documented divergence; it is the exact pre-migration behavior.
      assert.equal(second.imagingResults.redacted, 0, 'an idempotent no-op redaction must not be counted toward redacted');

      const plainRow = await prisma.imagingImage.findUniqueOrThrow({ where: { id: imagePlain.id } });
      assert.equal(plainRow.originalName, '[ANONYMIZED]', 'still anonymized, not double-mutated or reverted');
      const heldRow = await prisma.imagingImage.findUniqueOrThrow({ where: { id: imageHeld.id } });
      assert.equal(heldRow.originalName, 'patient-held.jpg', 'legal-hold row must remain untouched on re-run too');
    });

    await test('new image added after anonymization: a re-run redacts only the new image, leaves the already-redacted image unchanged, and counts exactly one new redaction (compat test C)', async () => {
      const studyLate = await prisma.imagingStudy.create({
        data: { clinicId: fx.defaultClinicId, patientId: patient.id, modality: 'PX', status: 'active', legalHold: false },
      });
      const imageLate = await prisma.imagingImage.create({
        data: { clinicId: fx.defaultClinicId, studyId: studyLate.id, fileName: 'l.bin', originalName: 'patient-late.jpg', fileSize: 10, mimeType: 'application/octet-stream', filePath: `${fx.defaultClinicId}/late-${randomUUID()}.bin` },
      });

      const third = await anonymizePatientData({
        clinicId: fx.defaultClinicId, patientId: patient.id, actorUserId: staff.id,
        actorRole: staff.role, organizationId: fx.orgId, reason: 'third run, new image added',
      });

      assert.equal(third.imagingResults.total, 3, 'plain + held + newly-added late image');
      assert.equal(third.imagingResults.redacted, 1, 'only the new image is a real redaction; the already-redacted plain image is not recounted');
      assert.equal(third.imagingResults.skippedLegalHold, 1);
      assert.equal(third.imagingResults.failed, 0);

      const plainRow = await prisma.imagingImage.findUniqueOrThrow({ where: { id: imagePlain.id } });
      assert.equal(plainRow.originalName, '[ANONYMIZED]', 'old already-redacted image stays as-is, not double-mutated');
      const lateRow = await prisma.imagingImage.findUniqueOrThrow({ where: { id: imageLate.id } });
      assert.equal(lateRow.originalName, '[ANONYMIZED]', 'newly-added image must be redacted by this run');
    });

    // ── Legal-hold TOCTOU race: hold acquired AFTER the lifecycle-review
    // read but BEFORE the port's mutation write. Pre-migration direct-Prisma
    // code had no defense against this window at all (it would have
    // silently redacted the row). The migrated adapter must map the port's
    // resulting ImagingLegalHoldViolationError back onto skippedLegalHold,
    // not a new failure.
    await test('legal-hold race (TOCTOU): a hold acquired between the lifecycle-review read and the port write is mapped to skippedLegalHold, never `failed`, and the image is left unmutated', async () => {
      const racePatient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'RaceTarget' });
      const raceStudy = await prisma.imagingStudy.create({
        data: { clinicId: fx.defaultClinicId, patientId: racePatient.id, modality: 'PX', status: 'active', legalHold: false },
      });
      const raceImage = await prisma.imagingImage.create({
        data: { clinicId: fx.defaultClinicId, studyId: raceStudy.id, fileName: 'r.bin', originalName: 'race-photo.jpg', fileSize: 10, mimeType: 'application/octet-stream', filePath: `${fx.defaultClinicId}/race-${randomUUID()}.bin` },
      });

      __setRedactionPreMutationBarrierForTest(async () => {
        await prisma.imagingStudy.update({ where: { id: raceStudy.id }, data: { legalHold: true, legalHoldReason: 'race-simulated hold' } });
      });
      let raceResult: Awaited<ReturnType<typeof anonymizePatientData>>;
      try {
        raceResult = await anonymizePatientData({
          clinicId: fx.defaultClinicId, patientId: racePatient.id, actorUserId: staff.id,
          actorRole: staff.role, organizationId: fx.orgId, reason: 'race scenario',
        });
      } finally {
        __setRedactionPreMutationBarrierForTest(null);
      }

      assert.equal(raceResult.imagingResults.total, 1);
      assert.equal(raceResult.imagingResults.skippedLegalHold, 1, 'race-acquired hold must be counted as skipped, not failed');
      assert.equal(raceResult.imagingResults.failed, 0);
      assert.equal(raceResult.partialFailure, false);

      const row = await prisma.imagingImage.findUniqueOrThrow({ where: { id: raceImage.id } });
      assert.equal(row.originalName, 'race-photo.jpg', 'the race-held image must never be redacted');
    });

    // ── J/K: cross-tenant/cross-clinic safety ──────────────────────────────
    await test('J: patientAnonymization cannot act on a cross-clinic patient — clinicId mismatch is rejected before any imaging access is attempted', async () => {
      await assert.rejects(
        () => anonymizePatientData({
          clinicId: fx.crossOrgClinicId, patientId: patient.id, actorUserId: staff.id,
          actorRole: staff.role, organizationId: fx.orgId, reason: 'must not reach imaging',
        }),
        (err: any) => err.status === 404,
      );
      // Untouched: still whatever it was left as by the idempotent-rerun test above.
      const row = await prisma.imagingImage.findUniqueOrThrow({ where: { id: imagePlain.id } });
      assert.equal(row.originalName, '[ANONYMIZED]');
    });

    await test('K: checkImageStorageExists under a clinicId that does not own the image throws ImagingNotFoundError — never a boolean existence leak', async () => {
      await assert.rejects(
        () => checkImageStorageExists(fx.crossOrgClinicId, imagePlain.id),
        (err: unknown) => err instanceof ImagingNotFoundError,
      );
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // F-M — orphanFileInspection.ts inspectOrphans via ImagingLifecyclePort
  // ═══════════════════════════════════════════════════════════════════════
  section('F-M: orphanFileInspection.inspectOrphans via ImagingLifecyclePort');
  {
    const fx = await createClinicFixtureSet('f2s3orph');
    trackClinics(fx.defaultClinicId, fx.crossOrgClinicId);
    const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });

    const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'PortOrphanTarget' });
    const study = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patient.id, modality: 'PX', status: 'active' },
    });
    const presentContent = Buffer.from(`f2s3-present-${randomUUID()}`);
    const presentKey = await writeTestImageFile(fx.defaultClinicId, presentContent);
    const presentImage = await prisma.imagingImage.create({
      data: { clinicId: fx.defaultClinicId, studyId: study.id, fileName: 'present.bin', originalName: 'present.bin', fileSize: presentContent.length, mimeType: 'application/octet-stream', filePath: presentKey },
    });
    const missingKey = `${fx.defaultClinicId}/${randomUUID()}-does-not-exist.bin`;
    const missingImage = await prisma.imagingImage.create({
      data: { clinicId: fx.defaultClinicId, studyId: study.id, fileName: 'missing.bin', originalName: 'missing.bin', fileSize: 42, mimeType: 'application/octet-stream', filePath: missingKey },
    });

    let hookedResult: Awaited<ReturnType<typeof inspectOrphans>>;

    await test('F: inspectOrphans exercises ImagingLifecyclePort.checkImageStorageExists (proven via the port storage-existence-checker test hook — not direct fileExists on the raw row)', async () => {
      const checkedImageIds: string[] = [];
      __setImagingStorageExistenceCheckerForTest(async (ref: string) => {
        checkedImageIds.push(ref);
        return ref === presentKey;
      });
      try {
        hookedResult = await inspectOrphans({ clinicId: fx.defaultClinicId, patientId: patient.id });
      } finally {
        __setImagingStorageExistenceCheckerForTest(null);
      }
      assert.deepEqual(new Set(checkedImageIds), new Set([presentKey, missingKey]), 'port storage-existence checker must be invoked once per imaging image, keyed by its storage key');
    });

    await test('G: missing storage is classified exactly as before (dbRowPhysicalMissing vs activeLinkedObject, per-entry kind/classification)', () => {
      assert.equal(hookedResult.checked, 2);
      assert.equal(hookedResult.dbRowPhysicalMissing, 1);
      assert.equal(hookedResult.activeLinkedObject, 1);
      const missingEntry = hookedResult.entries.find((e) => e.id === missingImage.id);
      const presentEntry = hookedResult.entries.find((e) => e.id === presentImage.id);
      assert.equal(missingEntry?.classification, 'dbRowPhysicalMissing');
      assert.equal(presentEntry?.classification, 'activeLinkedObject');
      assert.equal(missingEntry?.kind, 'imaging_image');
      assert.equal(presentEntry?.kind, 'imaging_image');
      assert.equal(missingEntry?.legalHold, false);
    });

    await test('G (live storage, no override): a real present file classifies activeLinkedObject and a real missing key classifies dbRowPhysicalMissing', async () => {
      const result = await inspectOrphans({ clinicId: fx.defaultClinicId, patientId: patient.id });
      assert.equal(result.checked, 2);
      assert.equal(result.dbRowPhysicalMissing, 1);
      assert.equal(result.activeLinkedObject, 1);
    });

    await test('H: storage-unavailable behavior propagates out of inspectOrphans exactly as before (no silent swallow, no false classification)', async () => {
      __setImagingStorageExistenceCheckerForTest(async () => {
        throw new Error('simulated storage provider outage');
      });
      try {
        await assert.rejects(() => inspectOrphans({ clinicId: fx.defaultClinicId, patientId: patient.id }));
      } finally {
        __setImagingStorageExistenceCheckerForTest(null);
      }
    });

    await test('I: BATCH_SIZE (500) caller-side truncation is preserved even though ImagingLifecyclePort.getImagesForLifecycleReview has no take/limit of its own', async () => {
      const bulkStudy = await prisma.imagingStudy.create({
        data: { clinicId: fx.defaultClinicId, patientId: patient.id, modality: 'CT', status: 'active' },
      });
      const bulkCount = 505;
      await prisma.imagingImage.createMany({
        data: Array.from({ length: bulkCount }, (_, i) => ({
          clinicId: fx.defaultClinicId,
          studyId: bulkStudy.id,
          fileName: `bulk-${i}.bin`,
          originalName: `bulk-${i}.bin`,
          fileSize: 1,
          mimeType: 'application/octet-stream',
          filePath: `${fx.defaultClinicId}/bulk-${i}-${randomUUID()}.bin`,
        })),
      });

      __setImagingStorageExistenceCheckerForTest(async () => false);
      let result: Awaited<ReturnType<typeof inspectOrphans>>;
      try {
        result = await inspectOrphans({ clinicId: fx.defaultClinicId, patientId: patient.id });
      } finally {
        __setImagingStorageExistenceCheckerForTest(null);
      }
      // 2 pre-existing images (present/missing) + 505 bulk = 507 total available,
      // must be capped at the historical BATCH_SIZE of 500, never silently widened.
      assert.equal(result.checked, 500, 'inspectOrphans must never inspect more than the historical BATCH_SIZE, even though the port itself is unbounded');
    });

    await test('J/K: cross-clinic clinicId scoping — a clinicId that does not own this patient/images returns an empty, error-free result (no cross-tenant existence leak)', async () => {
      const result = await inspectOrphans({ clinicId: fx.crossOrgClinicId, patientId: patient.id });
      assert.equal(result.checked, 0);
      assert.equal(result.dbRowPhysicalMissing, 0);
      assert.equal(result.activeLinkedObject, 0);
      assert.deepEqual(result.entries, []);
    });

    await test('L1: markConfirmedMissing now requires an explicit clinicId and delegates its imaging branch to ImagingLifecyclePort.markStorageMissing — no direct prisma.imagingImage write remains on this path (F2-STAGE3-DEFERRED-GAPA-001)', async () => {
      const srcPath = new URL('../../services/privacy/orphanFileInspection.ts', import.meta.url);
      const src = fs.readFileSync(srcPath, 'utf8');
      const fnMatch = src.match(/export async function markConfirmedMissing\(([\s\S]*?)\): Promise<\{ marked: number \}> \{([\s\S]*?)\n\}/);
      assert.ok(fnMatch, 'markConfirmedMissing must still exist with its original return shape');
      const [, params, body] = fnMatch!;
      assert.ok(/clinicId:\s*string/.test(params!), 'markConfirmedMissing must now take an explicit clinicId: string parameter');
      assert.ok(!/prisma\.imagingImage\.(update|updateMany)\(/.test(body!), 'markConfirmedMissing must no longer call prisma.imagingImage directly — no id-only imaging write remains');
      assert.ok(/markStorageMissing\(/.test(body!), 'markConfirmedMissing must delegate its imaging branch to ImagingLifecyclePort.markStorageMissing');
      assert.ok(/prisma\.patientAttachment\.update\(/.test(body!), 'the attachment branch must remain an unchanged direct Prisma write (out of scope)');
    });

    await test('L2: same-clinic mark succeeds — stamps storageVerifiedMissingAt only on the confirmed-missing ImagingImage row, never the present one', async () => {
      const result = await markConfirmedMissing(fx.defaultClinicId, [{ id: missingImage.id, kind: 'imaging_image' }]);
      assert.equal(result.marked, 1);
      const missingRow = await prisma.imagingImage.findUniqueOrThrow({ where: { id: missingImage.id } });
      const presentRow = await prisma.imagingImage.findUniqueOrThrow({ where: { id: presentImage.id } });
      assert.ok(missingRow.storageVerifiedMissingAt, 'confirmed-missing row must be stamped');
      assert.equal(presentRow.storageVerifiedMissingAt, null, 'present row must never be touched by marking a different row missing');
    });

    await test('L2b: repeated mark of the same row remains idempotent — no error, still counted as marked, row still stamped', async () => {
      const before = (await prisma.imagingImage.findUniqueOrThrow({ where: { id: missingImage.id } })).storageVerifiedMissingAt;
      const result = await markConfirmedMissing(fx.defaultClinicId, [{ id: missingImage.id, kind: 'imaging_image' }]);
      assert.equal(result.marked, 1, 'a repeat mark of an already-stamped row must not error and must still count as marked');
      const after = (await prisma.imagingImage.findUniqueOrThrow({ where: { id: missingImage.id } })).storageVerifiedMissingAt;
      assert.ok(before && after, 'row must remain stamped across repeated calls');
    });

    let crossTenantConsoleErrorCalls: unknown[][] = [];
    const originalConsoleErrorForL = console.error;

    await test('L3: a cross-clinic imaging id cannot be mutated — clinic A scope against clinic B\'s image id marks nothing and leaves the row untouched', async () => {
      const otherPatient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.crossOrgClinicId, firstName: 'CrossTenantTarget' });
      const otherStudy = await prisma.imagingStudy.create({
        data: { clinicId: fx.crossOrgClinicId, patientId: otherPatient.id, modality: 'PX', status: 'active' },
      });
      const otherMissingKey = `${fx.crossOrgClinicId}/${randomUUID()}-does-not-exist.bin`;
      const otherImage = await prisma.imagingImage.create({
        data: { clinicId: fx.crossOrgClinicId, studyId: otherStudy.id, fileName: 'other-missing.bin', originalName: 'other-missing.bin', fileSize: 42, mimeType: 'application/octet-stream', filePath: otherMissingKey },
      });

      crossTenantConsoleErrorCalls = [];
      console.error = (...args: unknown[]) => { crossTenantConsoleErrorCalls.push(args); };
      let result: Awaited<ReturnType<typeof markConfirmedMissing>>;
      try {
        // clinic A's (fx.defaultClinicId) scope, but the target image belongs to clinic B (fx.crossOrgClinicId).
        result = await markConfirmedMissing(fx.defaultClinicId, [{ id: otherImage.id, kind: 'imaging_image' }]);
      } finally {
        console.error = originalConsoleErrorForL;
      }
      assert.equal(result.marked, 0, 'a cross-tenant imaging id must never be counted as marked');
      const otherRow = await prisma.imagingImage.findUniqueOrThrow({ where: { id: otherImage.id } });
      assert.equal(otherRow.storageVerifiedMissingAt, null, 'the cross-tenant row must never be mutated by another clinic\'s scope');
    });

    await test('L4: a nonexistent imaging id fails identically to a cross-tenant id — no distinguishable state (non-enumeration preserved)', async () => {
      const nonexistentId = randomUUID();
      const result = await markConfirmedMissing(fx.defaultClinicId, [{ id: nonexistentId, kind: 'imaging_image' }]);
      assert.equal(result.marked, 0, 'a nonexistent imaging id must fail exactly like a cross-tenant one — both simply not counted, never a distinguishable error/count');
    });

    await test('L5: no raw storageKey/original filename is ever logged for a failed (cross-tenant) mark attempt', () => {
      assert.ok(crossTenantConsoleErrorCalls.length >= 1, 'the cross-tenant failure in L3 must have been logged');
      const logged = JSON.stringify(crossTenantConsoleErrorCalls);
      assert.ok(!logged.includes('other-missing.bin'), 'logged error must never contain the imaging row\'s storage key/filename');
      assert.ok(!logged.includes(fx.crossOrgClinicId + '/'), 'logged error must never contain the imaging row\'s storage key prefix');
    });

    await test('L6: the attachment branch is unchanged — an id-only PatientAttachment mark still succeeds exactly as before, unaffected by the clinicId parameter', async () => {
      const attachmentPatient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'AttachmentTarget' });
      const attachmentKey = `${fx.defaultClinicId}/${randomUUID()}-missing-attachment.bin`;
      const attachment = await prisma.patientAttachment.create({
        data: {
          clinicId: fx.defaultClinicId,
          patientId: attachmentPatient.id,
          fileName: 'missing-attachment.bin',
          originalName: 'missing-attachment.bin',
          fileSize: 10,
          mimeType: 'application/octet-stream',
          filePath: attachmentKey,
          uploadedById: staff.id,
        },
      });

      const result = await markConfirmedMissing(fx.defaultClinicId, [{ id: attachment.id, kind: 'attachment' }]);
      assert.equal(result.marked, 1);
      const row = await prisma.patientAttachment.findUniqueOrThrow({ where: { id: attachment.id } });
      assert.ok(row.storageVerifiedMissingAt, 'attachment row must be stamped exactly as before the migration');

      await prisma.patientAttachment.deleteMany({ where: { id: attachment.id } });
      await prisma.patient.deleteMany({ where: { id: attachmentPatient.id } });
    });

    await test('M: deletionReviewInventory.ts is migrated onto ImagingLifecyclePort — no direct prisma.imagingImage access remains (F2-STAGE3-DEFERRED-GAPB-001)', () => {
      const srcPath = new URL('../../services/privacy/deletionReviewInventory.ts', import.meta.url);
      const src = fs.readFileSync(srcPath, 'utf8');
      assert.ok(!/prisma\.imagingImage/.test(src), 'deletionReviewInventory.ts must no longer touch prisma.imagingImage directly');
      assert.ok(/getImagesForLifecycleReview\(/.test(src), 'deletionReviewInventory.ts must call ImagingLifecyclePort.getImagesForLifecycleReview');
      assert.ok(/from ['"]\.\.\/imaging\/public\.js['"]/.test(src), 'deletionReviewInventory.ts must import from the ImagingLifecyclePort facade');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // N-R — deletionReviewInventory.ts imaging counts/bytes via ImagingLifecyclePort
  // (F2-STAGE3-DEFERRED-GAPB-001)
  // ═══════════════════════════════════════════════════════════════════════
  section('N-R: deletionReviewInventory.ts imaging via ImagingLifecyclePort (F2-STAGE3-DEFERRED-GAPB-001)');
  {
    const fx = await createClinicFixtureSet('f2gapbdri');
    trackClinics(fx.defaultClinicId, fx.crossOrgClinicId);

    const patient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'GapbDeletionReview' });
    const studyPlain = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patient.id, modality: 'PX', status: 'active', legalHold: false },
    });
    const studyHeld = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patient.id, modality: 'CT', status: 'active', legalHold: true, legalHoldReason: 'gapb hold' },
    });
    const imagePlain = await prisma.imagingImage.create({
      data: { clinicId: fx.defaultClinicId, studyId: studyPlain.id, fileName: 'gp.bin', originalName: 'gapb-plain.jpg', fileSize: 123, mimeType: 'application/octet-stream', filePath: `${fx.defaultClinicId}/gapb-plain-${randomUUID()}.bin` },
    });
    const imageHeld = await prisma.imagingImage.create({
      data: { clinicId: fx.defaultClinicId, studyId: studyHeld.id, fileName: 'gh.bin', originalName: 'gapb-held.jpg', fileSize: 456, mimeType: 'application/octet-stream', filePath: `${fx.defaultClinicId}/gapb-held-${randomUUID()}.bin` },
    });

    await test('N: imaging total/legalHold/retainedClinical/estimatedBytes are exactly compatible with pre-migration arithmetic (port-backed)', async () => {
      const inventory = await buildDeletionReviewInventory({ clinicId: fx.defaultClinicId, patientId: patient.id, organizationId: fx.orgId });
      assert.equal(inventory.imaging.total, 2);
      assert.equal(inventory.imaging.legalHold, 1);
      assert.equal(inventory.imaging.retainedClinical, 2);
      assert.equal(inventory.imaging.estimatedBytes, 123 + 456);
      const blockerCodes = inventory.blockers.map((b) => b.code);
      assert.ok(blockerCodes.includes('IMAGING_RETENTION_NOT_APPROVED'), 'any imaging presence still blocks a dry-run deletion');
      assert.ok(blockerCodes.includes('IMAGING_LEGAL_HOLD'), 'legal-hold imaging is still reported as its own distinct blocker');
      const legalHoldBlocker = inventory.blockers.find((b) => b.code === 'IMAGING_LEGAL_HOLD');
      assert.equal(legalHoldBlocker?.count, 1);
    });

    await test('O: zero-imaging patient produces zero imaging count/bytes and no IMAGING_* blockers (unchanged zero-imaging behavior)', async () => {
      const emptyPatient = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'GapbNoImaging' });
      const inventory = await buildDeletionReviewInventory({ clinicId: fx.defaultClinicId, patientId: emptyPatient.id, organizationId: fx.orgId });
      assert.equal(inventory.imaging.total, 0);
      assert.equal(inventory.imaging.legalHold, 0);
      assert.equal(inventory.imaging.retainedClinical, 0);
      assert.equal(inventory.imaging.estimatedBytes, 0);
      const blockerCodes = inventory.blockers.map((b) => b.code);
      assert.ok(!blockerCodes.includes('IMAGING_RETENTION_NOT_APPROVED'));
      assert.ok(!blockerCodes.includes('IMAGING_LEGAL_HOLD'));
    });

    await test('P: same patientId under a clinicId that does not own it returns zero imaging count/bytes (tenant isolation, no cross-clinic aggregation)', async () => {
      const inventory = await buildDeletionReviewInventory({ clinicId: fx.crossOrgClinicId, patientId: patient.id, organizationId: fx.otherOrgId });
      assert.equal(inventory.imaging.total, 0);
      assert.equal(inventory.imaging.legalHold, 0);
      assert.equal(inventory.imaging.retainedClinical, 0);
      assert.equal(inventory.imaging.estimatedBytes, 0);
      const blockerCodes = inventory.blockers.map((b) => b.code);
      assert.ok(!blockerCodes.includes('IMAGING_RETENTION_NOT_APPROVED'), 'a non-owning clinicId must never see the owning clinic\'s imaging blockers');
    });

    await test('Q: a same-patientId, same-clinicId call is unaffected by an unrelated cross-org clinic\'s imaging (no cross-clinic bleed into counts)', async () => {
      const otherPatient = await createTestPatient({ organizationId: fx.otherOrgId, clinicId: fx.crossOrgClinicId, firstName: 'GapbCrossClinicNoise' });
      const otherStudy = await prisma.imagingStudy.create({
        data: { clinicId: fx.crossOrgClinicId, patientId: otherPatient.id, modality: 'PX', status: 'active', legalHold: false },
      });
      await prisma.imagingImage.create({
        data: { clinicId: fx.crossOrgClinicId, studyId: otherStudy.id, fileName: 'noise.bin', originalName: 'noise.jpg', fileSize: 999999, mimeType: 'application/octet-stream', filePath: `${fx.crossOrgClinicId}/noise-${randomUUID()}.bin` },
      });

      const inventory = await buildDeletionReviewInventory({ clinicId: fx.defaultClinicId, patientId: patient.id, organizationId: fx.orgId });
      assert.equal(inventory.imaging.total, 2, 'must still see only its own 2 images, unaffected by the unrelated cross-clinic image');
      assert.equal(inventory.imaging.estimatedBytes, 123 + 456, 'estimatedBytes must never include another clinic\'s imaging bytes');
    });

    await test('R: no new storage/path/filename leakage — response JSON never contains a storageKey/filePath or original filename', async () => {
      const inventory = await buildDeletionReviewInventory({ clinicId: fx.defaultClinicId, patientId: patient.id, organizationId: fx.orgId });
      const json = JSON.stringify(inventory);
      assert.ok(!json.includes(imagePlain.filePath), 'response must never include a raw storage key/path');
      assert.ok(!json.includes(imageHeld.filePath), 'response must never include a raw storage key/path');
      assert.ok(!json.includes('gapb-plain.jpg'), 'response must never include the original filename');
      assert.ok(!json.includes('gapb-held.jpg'), 'response must never include the original filename');
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
    console.error('[privacy-imaging-lifecycle-port-migration] Fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanupImagingFixtures();
    } catch (err) {
      console.error('[privacy-imaging-lifecycle-port-migration] cleanupImagingFixtures failed:', err);
      process.exitCode = 1;
    }
    try {
      await cleanupAllFixtures();
    } catch (err) {
      console.error('[privacy-imaging-lifecycle-port-migration] cleanupAllFixtures failed:', err);
      process.exitCode = 1;
    }
    await cleanupUploadDirs();
    await prisma.$disconnect().catch(() => {});
  });
