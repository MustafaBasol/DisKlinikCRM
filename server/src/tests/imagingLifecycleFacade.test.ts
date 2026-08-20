/**
 * imagingLifecycleFacade.test.ts — F2-IMPL-001-A-R2 facade tests
 * (server/src/services/imaging/public.ts), against the F2-PREP-009-amended
 * explicit-tenant `ImagingLifecyclePort` contract.
 *
 * This is a NEW, additive-facade test suite — distinct from and never
 * replacing/weakening test:imaging-characterization (F2-PREP-007-A..D),
 * which characterizes CURRENT route/service behavior, not this new file.
 *
 * Exercises the REAL exported facade functions against a REAL disposable
 * PostgreSQL instance via the real Prisma client (server/src/db.ts), using
 * the same shared harness as imagingCharacterizationTenantLifecycle.test.ts.
 * Fixtures are created directly via Prisma (no HTTP route involved) since
 * the facade itself has zero callers and no request context.
 *
 * Run (requires DATABASE_URL pointing at a disposable Postgres with
 * migrations applied):
 *   cd server && npx tsx src/tests/imagingLifecycleFacade.test.ts
 *
 * Deterministic cleanup: every clinic/org/patient/imaging row and every
 * physical test file this run creates is deleted in a `finally` block,
 * regardless of pass/fail.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import * as publicFacade from '../services/imaging/public.js';
import {
  markStorageMissing,
  redactForAnonymization,
  getImagesForLifecycleReview,
  checkImageStorageExists,
  getBridgeStudyIdsForPatient,
  isRedactionReason,
  ImagingNotFoundError,
  ImagingLegalHoldViolationError,
  ImagingStorageUnavailableError,
  ImagingInvalidRedactionReasonError,
  __setImagingStorageExistenceCheckerForTest,
  __setRedactionPreMutationBarrierForTest,
  type ImagingLifecycleImageDto,
  type RedactionReason,
} from '../services/imaging/public.js';
import { saveFile, buildStorageKey, deleteFile } from '../services/fileStorage.js';
import {
  createSuite,
  createClinicFixtureSet,
  createTestPatient,
  cleanupAllFixtures,
  prisma,
} from './dbVerification/dbVerificationHarness.js';

const { section, test, summary } = createSuite('Imaging-Lifecycle-Facade');

// ─── Cleanup tracking ───────────────────────────────────────────────────────

const allFixtureClinicIds: string[] = [];
const createdStorageKeys: string[] = [];

async function cleanupImagingFixtures(): Promise<void> {
  if (allFixtureClinicIds.length === 0) return;
  const clinicId = { in: allFixtureClinicIds };
  await prisma.imagingImage.deleteMany({ where: { clinicId } });
  await prisma.imagingStudy.deleteMany({ where: { clinicId } });
}

async function cleanupStorage(): Promise<void> {
  for (const key of createdStorageKeys) {
    await deleteFile(key).catch(() => {});
  }
}

// ─── Fixture helpers ────────────────────────────────────────────────────────

async function createStudy(params: {
  clinicId: string;
  patientId: string | null;
  legalHold?: boolean;
  source?: string;
}) {
  return prisma.imagingStudy.create({
    data: {
      clinicId: params.clinicId,
      patientId: params.patientId,
      modality: 'IO',
      legalHold: params.legalHold ?? false,
      ...(params.source ? { source: params.source } : {}),
    },
  });
}

async function createImage(params: {
  clinicId: string;
  studyId: string;
  originalName?: string;
  filePath?: string;
}) {
  const filePath = params.filePath ?? buildStorageKey(params.clinicId, `${randomUUID()}.jpg`);
  return prisma.imagingImage.create({
    data: {
      clinicId: params.clinicId,
      studyId: params.studyId,
      fileName: path.posix.basename(filePath),
      originalName: params.originalName ?? 'original-scan.jpg',
      fileSize: 1024,
      mimeType: 'image/jpeg',
      filePath,
    },
  });
}

async function main() {
  try {
    // ── 1. Compile/export contract ──────────────────────────────────────
    section('1. Compile/export contract');

    await test('exports exactly the four accepted ImagingLifecyclePort functions as functions', () => {
      assert.equal(typeof markStorageMissing, 'function');
      assert.equal(typeof redactForAnonymization, 'function');
      assert.equal(typeof getImagesForLifecycleReview, 'function');
      assert.equal(typeof checkImageStorageExists, 'function');
    });

    await test('the four accepted methods declare exactly the F2-PREP-009-amended explicit-tenant arity, with zero signature drift', () => {
      assert.equal(markStorageMissing.length, 2, 'markStorageMissing must be exactly (clinicId, imageId)');
      assert.equal(redactForAnonymization.length, 3, 'redactForAnonymization must be exactly (clinicId, imageId, reason)');
      assert.equal(getImagesForLifecycleReview.length, 2, 'getImagesForLifecycleReview must be exactly (clinicId, patientId)');
      assert.equal(
        checkImageStorageExists.length,
        2,
        'checkImageStorageExists must be exactly (clinicId, imageId) — no optional trailing test parameter, no imageId-only overload',
      );
    });

    await test('exports the additive getBridgeStudyIdsForPatient query (F2-STAGE3-GAPC-001) as a 2-arg (clinicId, patientId) function', () => {
      assert.equal(typeof getBridgeStudyIdsForPatient, 'function');
      assert.equal(getBridgeStudyIdsForPatient.length, 2, 'getBridgeStudyIdsForPatient must be exactly (clinicId, patientId)');
    });

    await test('exports a closed RedactionReason validator and the typed-error classes', () => {
      assert.equal(typeof isRedactionReason, 'function');
      assert.ok(isRedactionReason('anonymization'));
      assert.ok(isRedactionReason('deletion_review'));
      assert.ok(!isRedactionReason('not_a_real_reason'));
      assert.ok(!isRedactionReason(undefined));
      for (const ErrorClass of [
        ImagingNotFoundError,
        ImagingLegalHoldViolationError,
        ImagingStorageUnavailableError,
        ImagingInvalidRedactionReasonError,
      ]) {
        const instance = new ErrorClass();
        assert.ok(instance instanceof Error);
        assert.ok(typeof instance.code === 'string' && instance.code.length > 0);
      }
    });

    await test('no facade export other than the accepted 4-method slice plus its own types/errors leaks a raw Prisma model helper', () => {
      const exportNames = Object.keys(publicFacade);
      for (const name of exportNames) {
        assert.ok(
          !/prisma/i.test(name),
          `unexpected Prisma-shaped export: ${name}`,
        );
      }
    });

    // ── 2-3. Fixtures ────────────────────────────────────────────────────
    // Two clinics, same org (default/sibling) plus one cross-org clinic —
    // "Clinic A" below is fixtures.defaultClinicId, "Clinic B" is
    // fixtures.crossOrgClinicId, per F2-PREP-009 §11's required test shape.
    const fixtures = await createClinicFixtureSet('imaging-lifecycle-facade');
    allFixtureClinicIds.push(fixtures.defaultClinicId, fixtures.siblingClinicId, fixtures.crossOrgClinicId);
    const patientA = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
    const patientB = await createTestPatient({ organizationId: fixtures.otherOrgId, clinicId: fixtures.crossOrgClinicId });

    const studyA = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
    const imageA = await createImage({ clinicId: fixtures.defaultClinicId, studyId: studyA.id });

    const studyB = await createStudy({ clinicId: fixtures.crossOrgClinicId, patientId: patientB.id });
    const imageB = await createImage({ clinicId: fixtures.crossOrgClinicId, studyId: studyB.id });

    // ── 4. DTO shape ─────────────────────────────────────────────────────
    section('4. DTO shape');

    await test('getImagesForLifecycleReview returns exactly the purpose-built DTO fields, never a raw Prisma model', async () => {
      const results = await getImagesForLifecycleReview(fixtures.defaultClinicId, patientA.id);
      assert.equal(results.length, 1);
      const dto: ImagingLifecycleImageDto = results[0]!;
      assert.deepEqual(
        Object.keys(dto).sort(),
        ['clinicId', 'fileSize', 'id', 'legalHold', 'patientId', 'storageKey', 'studyId'].sort(),
      );
      assert.equal(dto.id, imageA.id);
      assert.equal(dto.studyId, studyA.id);
      assert.equal(dto.clinicId, fixtures.defaultClinicId);
      assert.equal(dto.patientId, patientA.id);
      assert.equal(dto.legalHold, false);
      assert.equal(dto.storageKey, imageA.filePath);
      assert.equal(dto.fileSize, imageA.fileSize);
      assert.equal(typeof dto.fileSize, 'number');
      // fields that must never appear on the DTO
      assert.ok(!('fileName' in dto));
      assert.ok(!('mimeType' in dto));
      assert.ok(!('legalHoldReason' in dto));
      assert.ok(!('originalName' in dto));
    });

    await test('getImagesForLifecycleReview: fileSize mirrors the Prisma schema Int (non-nullable) — never null/undefined, matching ImagingImage.fileSize exactly (F2-STAGE3-DEFERRED-GAPB-001)', async () => {
      const results = await getImagesForLifecycleReview(fixtures.defaultClinicId, patientA.id);
      const dto = results.find((r) => r.id === imageA.id)!;
      assert.notEqual(dto.fileSize, null);
      assert.notEqual(dto.fileSize, undefined);
      const row = await prisma.imagingImage.findUniqueOrThrow({ where: { id: imageA.id }, select: { fileSize: true } });
      assert.equal(dto.fileSize, row.fileSize, 'DTO fileSize must exactly mirror the underlying ImagingImage.fileSize column, no unit conversion');
    });

    await test('deterministic ordering: createdAt asc, id asc tiebreaker', async () => {
      const studyOrder = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const img1 = await createImage({ clinicId: fixtures.defaultClinicId, studyId: studyOrder.id });
      const img2 = await createImage({ clinicId: fixtures.defaultClinicId, studyId: studyOrder.id });
      const results = await getImagesForLifecycleReview(fixtures.defaultClinicId, patientA.id);
      const ids = results.map((r) => r.id);
      const idx1 = ids.indexOf(img1.id);
      const idx2 = ids.indexOf(img2.id);
      assert.ok(idx1 < idx2, 'img1 (created first) must sort before img2');
    });

    // ── 5. Tenant-scoped lifecycle review + cross-tenant denial ──────────
    section('5. Tenant-scoped lifecycle review / cross-tenant denial');

    await test('never returns another clinic\'s images for the same call', async () => {
      const resultsA = await getImagesForLifecycleReview(fixtures.defaultClinicId, patientA.id);
      assert.ok(resultsA.every((r) => r.clinicId === fixtures.defaultClinicId));
      assert.ok(!resultsA.some((r) => r.id === imageB.id));
    });

    await test('querying with the wrong clinicId for a real patientId returns empty, not the other clinic\'s data', async () => {
      const crossResults = await getImagesForLifecycleReview(fixtures.crossOrgClinicId, patientA.id);
      assert.equal(crossResults.length, 0);
    });

    await test('Clinic A clinicId + Clinic B patientId returns an empty array (F2-PREP-009 §11.1.B)', async () => {
      const crossResults = await getImagesForLifecycleReview(fixtures.defaultClinicId, patientB.id);
      assert.deepEqual(crossResults, []);
    });

    await test('unknown clinicId/patientId combination returns an empty array, never an error', async () => {
      const results = await getImagesForLifecycleReview(randomUUID(), randomUUID());
      assert.deepEqual(results, []);
    });

    // ── 6. Ownership enforcement, not-found/cross-tenant/mismatch (no leakage) ─
    section('6. Ownership enforcement, not-found/cross-tenant/mismatch without leakage');

    await test('markStorageMissing throws ImagingNotFoundError for a genuinely nonexistent imageId', async () => {
      await assert.rejects(() => markStorageMissing(fixtures.defaultClinicId, randomUUID()), ImagingNotFoundError);
    });

    await test('checkImageStorageExists throws ImagingNotFoundError for a genuinely nonexistent imageId', async () => {
      await assert.rejects(() => checkImageStorageExists(fixtures.defaultClinicId, randomUUID()), ImagingNotFoundError);
    });

    await test('cross-tenant: Clinic A clinicId + Clinic B imageId is rejected for all three imageId-only methods (F2-PREP-009 §11.1.A)', async () => {
      await assert.rejects(() => markStorageMissing(fixtures.defaultClinicId, imageB.id), ImagingNotFoundError);
      await assert.rejects(() => redactForAnonymization(fixtures.defaultClinicId, imageB.id, 'anonymization'), ImagingNotFoundError);
      await assert.rejects(() => checkImageStorageExists(fixtures.defaultClinicId, imageB.id), ImagingNotFoundError);

      // Same-org sibling clinicId (authorized clinic, but not this image's
      // owner) must be rejected identically — cross-tenant enforcement is
      // per-clinic, not merely per-organization.
      await assert.rejects(() => markStorageMissing(fixtures.siblingClinicId, imageA.id), ImagingNotFoundError);
    });

    await test('missing imageId and cross-tenant imageId are externally indistinguishable (identical error shape/message)', async () => {
      let missingMessage: string | undefined;
      let crossTenantMessage: string | undefined;
      try {
        await markStorageMissing(fixtures.defaultClinicId, randomUUID());
        assert.fail('expected ImagingNotFoundError');
      } catch (err) {
        assert.ok(err instanceof ImagingNotFoundError);
        missingMessage = err.message;
      }
      try {
        await markStorageMissing(fixtures.defaultClinicId, imageB.id);
        assert.fail('expected ImagingNotFoundError');
      } catch (err) {
        assert.ok(err instanceof ImagingNotFoundError);
        crossTenantMessage = err.message;
      }
      assert.equal(missingMessage, crossTenantMessage, 'missing and cross-tenant must be indistinguishable');
    });

    await test('a denormalized clinicId/study.clinicId mismatch still fails closed even when the caller\'s clinicId matches one side (F2-PREP-009 §11.3)', async () => {
      const corruptStudy = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const corruptImage = await createImage({ clinicId: fixtures.defaultClinicId, studyId: corruptStudy.id });
      // Simulate a cross-tenant/data-integrity corruption: the image's own
      // clinicId no longer agrees with its study's clinicId. No production
      // code path can produce this (both are set together at creation) —
      // this proves the facade's predicate actually requires BOTH sides to
      // equal the caller's clinicId, not either one alone.
      await prisma.imagingImage.update({
        where: { id: corruptImage.id },
        data: { clinicId: fixtures.siblingClinicId },
      });

      // Caller's clinicId matches the STUDY side (defaultClinicId) but not
      // the now-corrupted IMAGE side (siblingClinicId) — must still fail.
      await assert.rejects(() => markStorageMissing(fixtures.defaultClinicId, corruptImage.id), ImagingNotFoundError);
      // Caller's clinicId matches the IMAGE side (siblingClinicId) but not
      // the STUDY side (defaultClinicId) — must also still fail.
      await assert.rejects(() => markStorageMissing(fixtures.siblingClinicId, corruptImage.id), ImagingNotFoundError);
    });

    // ── 7. markStorageMissing behavior ────────────────────────────────────
    section('7. markStorageMissing behavior');

    await test('stamps storageVerifiedMissingAt, never deletes the row, never touches legalHold', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id, legalHold: true });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      await markStorageMissing(fixtures.defaultClinicId, image.id);

      const row = await prisma.imagingImage.findUnique({ where: { id: image.id }, include: { study: true } });
      assert.ok(row, 'row must still exist');
      assert.ok(row!.storageVerifiedMissingAt instanceof Date);
      assert.equal(row!.study.legalHold, true, 'legal hold must be untouched');
      assert.equal(row!.originalName, image.originalName, 'originalName must be untouched');
    });

    await test('is idempotent — a second call succeeds and re-stamps the timestamp', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      await markStorageMissing(fixtures.defaultClinicId, image.id);
      const first = await prisma.imagingImage.findUnique({ where: { id: image.id }, select: { storageVerifiedMissingAt: true } });
      await new Promise((r) => setTimeout(r, 5));
      await markStorageMissing(fixtures.defaultClinicId, image.id);
      const second = await prisma.imagingImage.findUnique({ where: { id: image.id }, select: { storageVerifiedMissingAt: true } });

      assert.ok(first?.storageVerifiedMissingAt);
      assert.ok(second?.storageVerifiedMissingAt);
      assert.ok(second!.storageVerifiedMissingAt!.getTime() >= first!.storageVerifiedMissingAt!.getTime());
    });

    await test('a rejected cross-tenant mutation attempt leaves the target Clinic B row completely untouched (full tenant scope re-applied on write)', async () => {
      const before = await prisma.imagingImage.findUnique({ where: { id: imageB.id } });
      await assert.rejects(() => markStorageMissing(fixtures.defaultClinicId, imageB.id), ImagingNotFoundError);
      const after = await prisma.imagingImage.findUnique({ where: { id: imageB.id } });
      assert.deepEqual(after, before, 'Clinic B row must be byte-for-byte unchanged after a rejected cross-tenant write attempt');
    });

    // ── 8. redactForAnonymization behavior ────────────────────────────────
    section('8. redactForAnonymization behavior');

    const validReason: RedactionReason = 'anonymization';

    await test('rejects an invalid RedactionReason value at runtime without touching the row', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      await assert.rejects(
        () => redactForAnonymization(fixtures.defaultClinicId, image.id, 'not_a_real_reason' as unknown as RedactionReason),
        ImagingInvalidRedactionReasonError,
      );
      const row = await prisma.imagingImage.findUnique({ where: { id: image.id } });
      assert.equal(row!.originalName, image.originalName, 'row must be untouched after a rejected reason');
    });

    await test('redacts originalName to the shared anonymization placeholder, preserves the row', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      await redactForAnonymization(fixtures.defaultClinicId, image.id, validReason);

      const row = await prisma.imagingImage.findUnique({ where: { id: image.id } });
      assert.ok(row, 'row must still exist');
      assert.equal(row!.originalName, '[ANONYMIZED]');
    });

    await test('is idempotent — redacting an already-redacted row is a safe no-op', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      await redactForAnonymization(fixtures.defaultClinicId, image.id, validReason);
      await redactForAnonymization(fixtures.defaultClinicId, image.id, validReason); // must not throw

      const row = await prisma.imagingImage.findUnique({ where: { id: image.id } });
      assert.equal(row!.originalName, '[ANONYMIZED]');
    });

    // ── 8c. Mutation outcome result (F2-STAGE3-IMPL-001-R1) ───────────────
    section('8c. Mutation outcome result (F2-STAGE3-IMPL-001-R1)');

    await test('returns { changed: true } for a first, real redaction and { changed: false } for an idempotent repeat', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      const first = await redactForAnonymization(fixtures.defaultClinicId, image.id, validReason);
      assert.deepEqual(first, { changed: true }, 'first real redaction must report changed: true');

      const second = await redactForAnonymization(fixtures.defaultClinicId, image.id, validReason);
      assert.deepEqual(second, { changed: false }, 'idempotent repeat must report changed: false, not true');
    });

    await test('a concurrent benign already-redacted outcome (write raced by another writer) reports changed: false, not true', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      __setRedactionPreMutationBarrierForTest(async () => {
        // Simulate a concurrent writer completing the exact same redaction
        // in the window between this call's read and its own write.
        await prisma.imagingImage.update({ where: { id: image.id }, data: { originalName: '[ANONYMIZED]' } });
      });
      try {
        const outcome = await redactForAnonymization(fixtures.defaultClinicId, image.id, validReason);
        assert.deepEqual(outcome, { changed: false }, 'a benign concurrent-writer already-redacted outcome must report changed: false');
      } finally {
        __setRedactionPreMutationBarrierForTest(null);
      }

      const row = await prisma.imagingImage.findUnique({ where: { id: image.id } });
      assert.equal(row!.originalName, '[ANONYMIZED]');
    });

    await test('legal hold: refuses to redact and does not silently bypass', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id, legalHold: true });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      await assert.rejects(() => redactForAnonymization(fixtures.defaultClinicId, image.id, validReason), ImagingLegalHoldViolationError);

      const row = await prisma.imagingImage.findUnique({ where: { id: image.id } });
      assert.equal(row!.originalName, image.originalName, 'legal-hold row must remain untouched');
    });

    await test('throws ImagingNotFoundError for a nonexistent imageId, never a Prisma error', async () => {
      await assert.rejects(() => redactForAnonymization(fixtures.defaultClinicId, randomUUID(), validReason), ImagingNotFoundError);
    });

    await test('cross-tenant redaction attempt (Clinic A clinicId + Clinic B imageId) is rejected and leaves the Clinic B row untouched', async () => {
      const before = await prisma.imagingImage.findUnique({ where: { id: imageB.id } });
      await assert.rejects(() => redactForAnonymization(fixtures.defaultClinicId, imageB.id, validReason), ImagingNotFoundError);
      const after = await prisma.imagingImage.findUnique({ where: { id: imageB.id } });
      assert.deepEqual(after, before, 'Clinic B row must be unchanged after a rejected cross-tenant redaction attempt');
    });

    // ── 8b. Atomic legal-hold enforcement (F2-IMPL-001-A-R3) ──────────────
    section('8b. Atomic legal-hold enforcement at mutation time (F2-IMPL-001-A-R3)');

    await test('the redaction mutation predicate itself requires study.legalHold: false (not only an earlier in-memory check)', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      const originalUpdateMany = prisma.imagingImage.updateMany.bind(prisma.imagingImage);
      let capturedArgs: Parameters<typeof prisma.imagingImage.updateMany>[0] | null = null;
      (prisma.imagingImage as unknown as { updateMany: typeof prisma.imagingImage.updateMany }).updateMany = (
        args: Parameters<typeof prisma.imagingImage.updateMany>[0],
      ) => {
        capturedArgs = args;
        return originalUpdateMany(args);
      };
      try {
        await redactForAnonymization(fixtures.defaultClinicId, image.id, validReason);
      } finally {
        (prisma.imagingImage as unknown as { updateMany: typeof prisma.imagingImage.updateMany }).updateMany =
          originalUpdateMany;
      }

      assert.ok(capturedArgs, 'updateMany must have been invoked');
      const where = (capturedArgs as unknown as { where: Record<string, unknown> }).where;
      assert.equal(where.id, image.id);
      assert.equal(where.clinicId, fixtures.defaultClinicId);
      const studyWhere = where.study as Record<string, unknown>;
      assert.equal(studyWhere.clinicId, fixtures.defaultClinicId);
      assert.equal(studyWhere.legalHold, false, 'the mutation WHERE clause must require study.legalHold === false');
    });

    await test('a cross-tenant image under legal hold still yields ImagingNotFoundError, never ImagingLegalHoldViolationError (no cross-tenant hold side-channel)', async () => {
      const heldStudyB = await createStudy({ clinicId: fixtures.crossOrgClinicId, patientId: patientB.id, legalHold: true });
      const heldImageB = await createImage({ clinicId: fixtures.crossOrgClinicId, studyId: heldStudyB.id });

      await assert.rejects(
        () => redactForAnonymization(fixtures.defaultClinicId, heldImageB.id, validReason),
        ImagingNotFoundError,
      );
    });

    await test('a denormalized clinicId/study.clinicId mismatch on redaction still fails closed as ImagingNotFoundError, even under legal hold', async () => {
      const corruptStudy = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id, legalHold: true });
      const corruptImage = await createImage({ clinicId: fixtures.defaultClinicId, studyId: corruptStudy.id });
      await prisma.imagingImage.update({ where: { id: corruptImage.id }, data: { clinicId: fixtures.siblingClinicId } });

      await assert.rejects(
        () => redactForAnonymization(fixtures.defaultClinicId, corruptImage.id, validReason),
        ImagingNotFoundError,
      );
      await assert.rejects(
        () => redactForAnonymization(fixtures.siblingClinicId, corruptImage.id, validReason),
        ImagingNotFoundError,
      );
    });

    await test('deterministic concurrency regression: a legal hold acquired after the read but before the write still blocks redaction atomically (no TOCTOU, no sleep-based sync)', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id, legalHold: false });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      let signalBarrierReached: (() => void) | null = null;
      const barrierReached = new Promise<void>((resolve) => {
        signalBarrierReached = resolve;
      });
      let releaseBarrier: (() => void) | null = null;
      const barrierGate = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });

      __setRedactionPreMutationBarrierForTest(async () => {
        signalBarrierReached!();
        await barrierGate;
      });

      try {
        const redactionPromise = redactForAnonymization(fixtures.defaultClinicId, image.id, validReason);

        // Deterministically wait until the in-flight call has passed its
        // read + in-memory legal-hold check and is paused immediately
        // before its conditional mutation — no fixed-duration sleep.
        await barrierReached;

        // Acquire legal hold concurrently, in the window the barrier holds
        // the mutation open.
        await prisma.imagingStudy.update({ where: { id: study.id }, data: { legalHold: true } });
        releaseBarrier!();

        await assert.rejects(() => redactionPromise, ImagingLegalHoldViolationError);

        const row = await prisma.imagingImage.findUnique({ where: { id: image.id } });
        assert.equal(row!.originalName, image.originalName, 'originalName must remain unchanged once the race is closed');

        const crossRow = await prisma.imagingImage.findUnique({ where: { id: imageB.id } });
        assert.ok(crossRow, 'an unrelated cross-tenant row must remain untouched by this same-tenant race scenario');
      } finally {
        __setRedactionPreMutationBarrierForTest(null);
        await prisma.imagingStudy.update({ where: { id: study.id }, data: { legalHold: false } });
      }
    });

    // ── 9-11. checkImageStorageExists ─────────────────────────────────────
    section('9-11. checkImageStorageExists (true / false / provider failure / cross-tenant)');

    await test('returns true when the physical file exists (real local disk via fileStorage.ts)', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const key = buildStorageKey(fixtures.defaultClinicId, 'exists.jpg');
      await saveFile(key, Buffer.from('fake-bytes'), 'image/jpeg');
      createdStorageKeys.push(key);
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id, filePath: key });

      const exists = await checkImageStorageExists(fixtures.defaultClinicId, image.id);
      assert.equal(exists, true);
    });

    await test('returns false when the physical file is missing, without throwing', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const key = buildStorageKey(fixtures.defaultClinicId, 'missing.jpg');
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id, filePath: key });

      const exists = await checkImageStorageExists(fixtures.defaultClinicId, image.id);
      assert.equal(exists, false);
    });

    await test('sanitizes a storage-provider failure into ImagingStorageUnavailableError, never the raw error/key', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      const failingFileExists = async (_ref: string): Promise<boolean> => {
        throw new Error('simulated provider outage with a raw internal detail that must never leak');
      };

      __setImagingStorageExistenceCheckerForTest(failingFileExists);
      try {
        await checkImageStorageExists(fixtures.defaultClinicId, image.id);
        assert.fail('expected ImagingStorageUnavailableError');
      } catch (err) {
        assert.ok(err instanceof ImagingStorageUnavailableError);
        assert.ok(!/simulated provider outage/.test((err as Error).message));
        assert.ok(!(err as Error).message.includes(image.filePath));
      } finally {
        __setImagingStorageExistenceCheckerForTest(null);
      }
    });

    // F4-IMAGING-001 Finding D. The sanitization above is correct and must
    // stay, but it used to be implemented with a bare `catch {}` that never
    // bound the provider error at all — so a VPS2 imaging outage was destroyed
    // at this boundary and reached no log, no error tracker, and no operator.
    // The provider error is now preserved as `cause`: reachable for diagnosis,
    // still absent from everything the facade actually exposes.
    await test('F4-IMAGING-001 Finding D: the provider failure is preserved as `cause` (outage signal survives), while message/name/code stay sanitized', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      const providerError = new Error('simulated VPS2 outage with a raw internal detail that must never leak');
      providerError.name = 'TimeoutError';
      const failingFileExists = async (_ref: string): Promise<boolean> => {
        throw providerError;
      };

      __setImagingStorageExistenceCheckerForTest(failingFileExists);
      try {
        await checkImageStorageExists(fixtures.defaultClinicId, image.id);
        assert.fail('expected ImagingStorageUnavailableError');
      } catch (err) {
        assert.ok(err instanceof ImagingStorageUnavailableError, 'still the sanitized facade error type');
        assert.equal(
          (err as Error).cause,
          providerError,
          'the underlying provider error must be preserved as `cause` — a bare catch here is what made an imaging outage invisible',
        );
        assert.equal((err as any).code, 'IMAGING_STORAGE_UNAVAILABLE', 'exposed code unchanged');
        assert.equal((err as Error).name, 'ImagingStorageUnavailableError', 'exposed name unchanged (not the provider TimeoutError)');
        assert.ok(!/simulated VPS2 outage/.test((err as Error).message), 'raw provider detail still never in the message');
        assert.ok(!(err as Error).message.includes(image.filePath), 'storage key still never in the message');
      } finally {
        __setImagingStorageExistenceCheckerForTest(null);
      }
    });

    await test('verifies ownership before touching storage — throws not-found before ever calling the storage check (missing AND cross-tenant)', async () => {
      let storageCheckCalled = false;
      const spyFileExists = async (_ref: string): Promise<boolean> => {
        storageCheckCalled = true;
        return true;
      };
      __setImagingStorageExistenceCheckerForTest(spyFileExists);
      try {
        await assert.rejects(() => checkImageStorageExists(fixtures.defaultClinicId, randomUUID()), ImagingNotFoundError);
        assert.equal(storageCheckCalled, false, 'storage must never be touched for a missing imageId');

        await assert.rejects(() => checkImageStorageExists(fixtures.defaultClinicId, imageB.id), ImagingNotFoundError);
        assert.equal(storageCheckCalled, false, 'storage must never be touched for a cross-tenant imageId');
      } finally {
        __setImagingStorageExistenceCheckerForTest(null);
      }
    });

    // ── 11b. getBridgeStudyIdsForPatient (F2-STAGE3-GAPC-001) ─────────────
    section('11b. getBridgeStudyIdsForPatient');

    const bridgeStudy = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id, source: 'bridge' });
    const manualStudy = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id, source: 'manual_upload' });
    const patientC = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });

    await test('correct patient+clinic returns only bridge study ids', async () => {
      const ids = await getBridgeStudyIdsForPatient(fixtures.defaultClinicId, patientA.id);
      assert.deepEqual(ids, [bridgeStudy.id]);
    });

    await test('manual/non-bridge studies are excluded', async () => {
      const ids = await getBridgeStudyIdsForPatient(fixtures.defaultClinicId, patientA.id);
      assert.ok(!ids.includes(manualStudy.id), 'manual_upload-sourced study must never be returned');
    });

    await test('wrong clinic returns nothing, even for a patient with a real bridge study elsewhere', async () => {
      const ids = await getBridgeStudyIdsForPatient(fixtures.siblingClinicId, patientA.id);
      assert.deepEqual(ids, []);
    });

    await test('wrong patient (same clinic, no bridge studies of their own) returns nothing', async () => {
      const ids = await getBridgeStudyIdsForPatient(fixtures.defaultClinicId, patientC.id);
      assert.deepEqual(ids, []);
    });

    await test('cross-org study cannot leak: crossOrgClinicId + patientA.id returns nothing', async () => {
      const ids = await getBridgeStudyIdsForPatient(fixtures.crossOrgClinicId, patientA.id);
      assert.deepEqual(ids, []);
    });

    await test('cross-clinic study cannot leak: defaultClinicId + patientB.id (a real patient in a different org/clinic) returns nothing', async () => {
      const ids = await getBridgeStudyIdsForPatient(fixtures.defaultClinicId, patientB.id);
      assert.deepEqual(ids, []);
    });

    await test('sanity control: patientB queried under their own real crossOrgClinicId sees zero results (no bridge study fixture created for them)', async () => {
      const ids = await getBridgeStudyIdsForPatient(fixtures.crossOrgClinicId, patientB.id);
      assert.deepEqual(ids, []);
    });

    await test('returned shape is ids only — an array of plain strings, never objects/DTOs', async () => {
      const ids = await getBridgeStudyIdsForPatient(fixtures.defaultClinicId, patientA.id);
      assert.ok(Array.isArray(ids));
      for (const id of ids) {
        assert.equal(typeof id, 'string');
      }
      assert.deepEqual(JSON.parse(JSON.stringify(ids)), ids, 'must serialize as a bare string array, no nested fields');
    });

    await test('unknown clinicId/patientId combination returns an empty array, never an error', async () => {
      const ids = await getBridgeStudyIdsForPatient(randomUUID(), randomUUID());
      assert.deepEqual(ids, []);
    });

    // ── 12. No raw Prisma model exposure (source-scan) ────────────────────
    section('12. No raw Prisma model / audit-duplication source scan');

    await test('facade source never returns req/res or imports audit/activity-log writers (audit ownership stays with the caller)', () => {
      const source = fs.readFileSync(path.resolve(process.cwd(), 'src/services/imaging/public.ts'), 'utf8');
      assert.ok(!/writeAuditLog/.test(source), 'facade must not write its own audit log (avoids duplicate entries once wired to a caller)');
      assert.ok(!/logActivity/.test(source), 'facade must not write its own activity log');
      assert.ok(!/console\.(log|error|warn)/.test(source), 'facade must never log (no channel for PII/PHI/raw errors to leak through)');
      assert.ok(!/from ['"]express['"]/.test(source), 'facade must have no HTTP/route dependency');
    });

    // ── 13. Facade caller allowlist proof ──────────────────────────────────
    // Was "unused-facade proof" (zero production callers) at F2-IMPL-001-A
    // merge time; that state didn't survive — patientAnonymization.ts,
    // orphanFileInspection.ts, and deletionReviewInventory.ts were each
    // migrated onto this facade by later, separate Stage 3 tasks
    // (F2-STAGE3-IMPL-001, F2-GAPA-001, F2-GAPB-001). The prior version of
    // this test's own detection regex required an absolute-style
    // `services/imaging/public` path fragment, which none of those callers'
    // real relative `../imaging/public.js` imports ever matched — so it kept
    // vacuously passing without ever detecting the three real callers
    // already present when this task (F2-STAGE3-GAPC-001) began. Fixed here
    // alongside adding the fourth caller (patientActivityHistoryExport.ts,
    // migrating off its former direct `prisma.imagingStudy.findMany`
    // dependency): this test now guards that ONLY the below allowlisted
    // callers import the facade, so an unrelated file cannot silently
    // acquire a new cross-domain dependency without a corresponding,
    // deliberate allowlist update.
    section('13. Facade caller allowlist proof');

    await test('only the allowlisted callers import services/imaging/public.ts', () => {
      const searchRoots = ['src/routes', 'src/middleware', 'src/jobs', 'src/services'];
      const allowedCallers = [
        path.resolve(process.cwd(), 'src/services/privacy/patientAnonymization.ts'),
        path.resolve(process.cwd(), 'src/services/privacy/orphanFileInspection.ts'),
        path.resolve(process.cwd(), 'src/services/privacy/deletionReviewInventory.ts'),
        path.resolve(process.cwd(), 'src/services/privacy/patientActivityHistoryExport.ts'),
      ];
      const offenders: string[] = [];
      const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
            continue;
          }
          if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
          if (full === path.resolve(process.cwd(), 'src/services/imaging/public.ts')) continue;
          if (allowedCallers.includes(full)) continue;
          const content = fs.readFileSync(full, 'utf8');
          if (/\/imaging\/public(\.js)?['"]/.test(content)) {
            offenders.push(full);
          }
        }
      };
      for (const root of searchRoots) {
        walk(path.resolve(process.cwd(), root));
      }
      assert.deepEqual(offenders, [], `no unallowlisted production file may import the facade, found: ${offenders.join(', ')}`);
    });

    await test('every allowlisted caller genuinely imports the facade (allowlist is not vacuous)', () => {
      const callerRelPaths = [
        'src/services/privacy/patientAnonymization.ts',
        'src/services/privacy/orphanFileInspection.ts',
        'src/services/privacy/deletionReviewInventory.ts',
        'src/services/privacy/patientActivityHistoryExport.ts',
      ];
      for (const rel of callerRelPaths) {
        const content = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
        assert.ok(
          /\/imaging\/public(\.js)?['"]/.test(content),
          `${rel} must actually import services/imaging/public.ts`,
        );
      }
    });
  } finally {
    await cleanupImagingFixtures();
    await cleanupAllFixtures();
    await cleanupStorage();
  }
}

await main();
const ok = summary();
process.exit(ok ? 0 : 1);
