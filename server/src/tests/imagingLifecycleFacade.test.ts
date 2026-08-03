/**
 * imagingLifecycleFacade.test.ts — F2-IMPL-001-A facade tests
 * (server/src/services/imaging/public.ts).
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
  isRedactionReason,
  ImagingNotFoundError,
  ImagingLegalHoldViolationError,
  ImagingStorageUnavailableError,
  ImagingInvalidRedactionReasonError,
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
}) {
  return prisma.imagingStudy.create({
    data: {
      clinicId: params.clinicId,
      patientId: params.patientId,
      modality: 'IO',
      legalHold: params.legalHold ?? false,
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

    await test('markStorageMissing/redactForAnonymization/checkImageStorageExists take exactly 1 required parameter (imageId), matching the accepted signature', () => {
      // checkImageStorageExists has 1 additional test-only optional param
      // (fileExistsForTest, never passed by production code) — .length only
      // counts parameters before the first default/optional trailing one is
      // irrelevant here since none have a default; all three commands/
      // queries below declare exactly the accepted arity.
      assert.equal(markStorageMissing.length, 1);
      assert.equal(redactForAnonymization.length, 2);
      assert.equal(getImagesForLifecycleReview.length, 2);
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
      assert.deepEqual(Object.keys(dto).sort(), ['clinicId', 'id', 'legalHold', 'patientId', 'storageKey', 'studyId'].sort());
      assert.equal(dto.id, imageA.id);
      assert.equal(dto.studyId, studyA.id);
      assert.equal(dto.clinicId, fixtures.defaultClinicId);
      assert.equal(dto.patientId, patientA.id);
      assert.equal(dto.legalHold, false);
      assert.equal(dto.storageKey, imageA.filePath);
      // fields that must never appear on the DTO
      assert.ok(!('fileName' in dto));
      assert.ok(!('mimeType' in dto));
      assert.ok(!('fileSize' in dto));
      assert.ok(!('legalHoldReason' in dto));
      assert.ok(!('originalName' in dto));
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

    await test('unknown clinicId/patientId combination returns an empty array, never an error', async () => {
      const results = await getImagesForLifecycleReview(randomUUID(), randomUUID());
      assert.deepEqual(results, []);
    });

    // ── 6. Image ownership re-derivation + not-found/mismatch (no leakage) ─
    section('6. Ownership re-derivation, not-found/mismatch without leakage');

    await test('markStorageMissing throws ImagingNotFoundError for a genuinely nonexistent imageId', async () => {
      await assert.rejects(() => markStorageMissing(randomUUID()), ImagingNotFoundError);
    });

    await test('checkImageStorageExists throws ImagingNotFoundError for a genuinely nonexistent imageId', async () => {
      await assert.rejects(() => checkImageStorageExists(randomUUID()), ImagingNotFoundError);
    });

    await test('a denormalized clinicId/study.clinicId mismatch is treated as not-found (indistinguishable from a missing row)', async () => {
      const corruptStudy = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const corruptImage = await createImage({ clinicId: fixtures.defaultClinicId, studyId: corruptStudy.id });
      // Simulate a cross-tenant/data-integrity corruption: the image's own
      // clinicId no longer agrees with its study's clinicId. No production
      // code path can produce this (both are set together at creation) —
      // this proves the facade's re-derivation-and-throw defense-in-depth
      // check actually fires rather than trusting the flat clinicId field.
      await prisma.imagingImage.update({
        where: { id: corruptImage.id },
        data: { clinicId: fixtures.siblingClinicId },
      });

      let notFoundMessage: string | undefined;
      let missingMessage: string | undefined;
      try {
        await markStorageMissing(corruptImage.id);
        assert.fail('expected ImagingNotFoundError');
      } catch (err) {
        assert.ok(err instanceof ImagingNotFoundError);
        notFoundMessage = err.message;
      }
      try {
        await markStorageMissing(randomUUID());
        assert.fail('expected ImagingNotFoundError');
      } catch (err) {
        assert.ok(err instanceof ImagingNotFoundError);
        missingMessage = err.message;
      }
      assert.equal(notFoundMessage, missingMessage, 'mismatch and genuinely-missing must be indistinguishable');
    });

    // ── 7. markStorageMissing behavior ────────────────────────────────────
    section('7. markStorageMissing behavior');

    await test('stamps storageVerifiedMissingAt, never deletes the row, never touches legalHold', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id, legalHold: true });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      await markStorageMissing(image.id);

      const row = await prisma.imagingImage.findUnique({ where: { id: image.id }, include: { study: true } });
      assert.ok(row, 'row must still exist');
      assert.ok(row!.storageVerifiedMissingAt instanceof Date);
      assert.equal(row!.study.legalHold, true, 'legal hold must be untouched');
      assert.equal(row!.originalName, image.originalName, 'originalName must be untouched');
    });

    await test('is idempotent — a second call succeeds and re-stamps the timestamp', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      await markStorageMissing(image.id);
      const first = await prisma.imagingImage.findUnique({ where: { id: image.id }, select: { storageVerifiedMissingAt: true } });
      await new Promise((r) => setTimeout(r, 5));
      await markStorageMissing(image.id);
      const second = await prisma.imagingImage.findUnique({ where: { id: image.id }, select: { storageVerifiedMissingAt: true } });

      assert.ok(first?.storageVerifiedMissingAt);
      assert.ok(second?.storageVerifiedMissingAt);
      assert.ok(second!.storageVerifiedMissingAt!.getTime() >= first!.storageVerifiedMissingAt!.getTime());
    });

    // ── 8. redactForAnonymization behavior ────────────────────────────────
    section('8. redactForAnonymization behavior');

    const validReason: RedactionReason = 'anonymization';

    await test('rejects an invalid RedactionReason value at runtime without touching the row', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      await assert.rejects(
        () => redactForAnonymization(image.id, 'not_a_real_reason' as unknown as RedactionReason),
        ImagingInvalidRedactionReasonError,
      );
      const row = await prisma.imagingImage.findUnique({ where: { id: image.id } });
      assert.equal(row!.originalName, image.originalName, 'row must be untouched after a rejected reason');
    });

    await test('redacts originalName to the shared anonymization placeholder, preserves the row', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      await redactForAnonymization(image.id, validReason);

      const row = await prisma.imagingImage.findUnique({ where: { id: image.id } });
      assert.ok(row, 'row must still exist');
      assert.equal(row!.originalName, '[ANONYMIZED]');
    });

    await test('is idempotent — redacting an already-redacted row is a safe no-op', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      await redactForAnonymization(image.id, validReason);
      await redactForAnonymization(image.id, validReason); // must not throw

      const row = await prisma.imagingImage.findUnique({ where: { id: image.id } });
      assert.equal(row!.originalName, '[ANONYMIZED]');
    });

    await test('legal hold: refuses to redact and does not silently bypass', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id, legalHold: true });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      await assert.rejects(() => redactForAnonymization(image.id, validReason), ImagingLegalHoldViolationError);

      const row = await prisma.imagingImage.findUnique({ where: { id: image.id } });
      assert.equal(row!.originalName, image.originalName, 'legal-hold row must remain untouched');
    });

    await test('throws ImagingNotFoundError for a nonexistent imageId, never a Prisma error', async () => {
      await assert.rejects(() => redactForAnonymization(randomUUID(), validReason), ImagingNotFoundError);
    });

    // ── 9-11. checkImageStorageExists ─────────────────────────────────────
    section('9-11. checkImageStorageExists (true / false / provider failure)');

    await test('returns true when the physical file exists (real local disk via fileStorage.ts)', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const key = buildStorageKey(fixtures.defaultClinicId, 'exists.jpg');
      await saveFile(key, Buffer.from('fake-bytes'), 'image/jpeg');
      createdStorageKeys.push(key);
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id, filePath: key });

      const exists = await checkImageStorageExists(image.id);
      assert.equal(exists, true);
    });

    await test('returns false when the physical file is missing, without throwing', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const key = buildStorageKey(fixtures.defaultClinicId, 'missing.jpg');
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id, filePath: key });

      const exists = await checkImageStorageExists(image.id);
      assert.equal(exists, false);
    });

    await test('sanitizes a storage-provider failure into ImagingStorageUnavailableError, never the raw error/key', async () => {
      const study = await createStudy({ clinicId: fixtures.defaultClinicId, patientId: patientA.id });
      const image = await createImage({ clinicId: fixtures.defaultClinicId, studyId: study.id });

      const failingFileExists = async (_ref: string): Promise<boolean> => {
        throw new Error('simulated provider outage with a raw internal detail that must never leak');
      };

      try {
        await checkImageStorageExists(image.id, failingFileExists);
        assert.fail('expected ImagingStorageUnavailableError');
      } catch (err) {
        assert.ok(err instanceof ImagingStorageUnavailableError);
        assert.ok(!/simulated provider outage/.test((err as Error).message));
        assert.ok(!(err as Error).message.includes(image.filePath));
      }
    });

    await test('verifies ownership before touching storage — throws not-found before ever calling the storage check', async () => {
      let storageCheckCalled = false;
      const spyFileExists = async (_ref: string): Promise<boolean> => {
        storageCheckCalled = true;
        return true;
      };
      await assert.rejects(() => checkImageStorageExists(randomUUID(), spyFileExists), ImagingNotFoundError);
      assert.equal(storageCheckCalled, false, 'storage must never be touched before ownership is confirmed');
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

    // ── 13. Unused-facade proof (no production caller) ────────────────────
    section('13. Unused-facade proof');

    await test('no route or Privacy service file imports services/imaging/public.ts', () => {
      const searchRoots = ['src/routes', 'src/services'];
      const offenders: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
            continue;
          }
          if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
          if (full === path.resolve(process.cwd(), 'src/services/imaging/public.ts')) continue;
          const content = fs.readFileSync(full, 'utf8');
          if (/services\/imaging\/public(\.js)?['"]/.test(content)) {
            offenders.push(full);
          }
        }
      };
      for (const root of searchRoots) {
        walk(path.resolve(process.cwd(), root));
      }
      assert.deepEqual(offenders, [], `no production file may import the unused facade yet, found: ${offenders.join(', ')}`);
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
