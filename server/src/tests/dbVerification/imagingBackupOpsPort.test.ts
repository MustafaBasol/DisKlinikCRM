/**
 * imagingBackupOpsPort.test.ts — REVIEW-ONLY disposable-Postgres pass for
 * F2-STAGE3-GAPD-001 (Imaging Ops Backup Read Port).
 *
 * Exercises server/src/services/imaging/ops.ts's `listImagesForBackup`
 * directly (not through fileBackupService.ts) against a real disposable
 * Postgres, proving the contract itself: global cross-tenant enumeration,
 * the narrow DTO shape, exhaustive/duplicate-free pagination, stable
 * ordering, and the empty-dataset/batch-boundary edge cases. Behavioral
 * parity of the backup RUN (destination keys, fileSize accounting, missing-
 * source handling, restore) is covered separately by
 * fileBackupDbIntegration.test.ts.
 *
 * Requires DATABASE_URL pointing at a disposable Postgres 16 with
 * migrations applied.
 *
 * Run: cd server && npx tsx src/tests/dbVerification/imagingBackupOpsPort.test.ts
 */

import { randomUUID } from 'node:crypto';
import { prisma, createClinicFixtureSet, createTestPatient, cleanupAllFixtures } from './dbVerificationHarness.js';
import { listImagesForBackup } from '../../services/imaging/ops.js';

const { section, test, summary } = (() => {
  let passed = 0;
  let failed = 0;
  function sectionFn(name: string) {
    console.log(`\n${name}`);
  }
  async function testFn(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      failed++;
    }
  }
  function summaryFn() {
    console.log(`\n${'-'.repeat(60)}`);
    console.log(`imagingBackupOpsPort: ${passed} passed, ${failed} failed`);
    return failed === 0;
  }
  return { section: sectionFn, test: testFn, summary: summaryFn };
})();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function main() {
  const fixtures = await createClinicFixtureSet('imgbackupops');
  const patientA = await createTestPatient({ organizationId: fixtures.orgId, clinicId: fixtures.defaultClinicId });
  const patientB = await createTestPatient({ organizationId: fixtures.otherOrgId, clinicId: fixtures.crossOrgClinicId });

  const studyA = await prisma.imagingStudy.create({ data: { clinicId: fixtures.defaultClinicId, patientId: patientA.id, modality: 'PX' } });
  const studyB = await prisma.imagingStudy.create({ data: { clinicId: fixtures.crossOrgClinicId, patientId: patientB.id, modality: 'PX' } });

  type Seeded = { id: string; clinicId: string; filePath: string; fileSize: number };
  const seeded: Seeded[] = [];

  async function seedImage(clinicId: string, studyId: string, index: number, fileSize: number): Promise<Seeded> {
    const filePath = `${clinicId}/ops-port-${index}-${randomUUID()}.bin`;
    const row = await prisma.imagingImage.create({
      data: {
        clinicId,
        studyId,
        fileName: `f${index}.bin`,
        originalName: `f${index}.bin`,
        fileSize,
        mimeType: 'application/octet-stream',
        filePath,
      },
    });
    return { id: row.id, clinicId, filePath, fileSize };
  }

  try {
    section('=== Seeding across two clinics/orgs ===');
    // 6 rows in clinic A, 3 in clinic B — deliberately uneven and deliberately
    // spanning two different organizations, so "global enumeration reaches
    // every clinic" cannot be satisfied by coincidence (e.g. both clinics
    // sharing one org's default scope).
    for (let i = 0; i < 6; i++) seeded.push(await seedImage(fixtures.defaultClinicId, studyA.id, i, 1000 + i));
    for (let i = 0; i < 3; i++) seeded.push(await seedImage(fixtures.crossOrgClinicId, studyB.id, i, 2000 + i));
    const seededIds = new Set(seeded.map((s) => s.id));

    section('=== Global cross-tenant enumeration (no clinicId filter) ===');

    await test('a single call with limit >= total returns every seeded row from BOTH clinics — no clinic is omitted because no tenant selector exists', async () => {
      const result = await listImagesForBackup({ limit: 100 });
      const returnedIds = new Set(result.rows.filter((r) => seededIds.has(r.id)).map((r) => r.id));
      assertEqual(returnedIds.size, seeded.length, 'every seeded row across both clinics is present in one global call');
      const clinicsSeen = new Set(result.rows.filter((r) => seededIds.has(r.id)).map((r) => r.clinicId));
      assert(clinicsSeen.has(fixtures.defaultClinicId), 'clinic A rows are present');
      assert(clinicsSeen.has(fixtures.crossOrgClinicId), 'clinic B (different org) rows are present — proves global, cross-tenant scope');
    });

    await test('DTO exposes exactly the narrow allow-listed fields — id, clinicId, storageKeyOrFilePath, fileSize, storageBackend — and nothing else (no patientId/study metadata/modality/originalName)', async () => {
      const result = await listImagesForBackup({ limit: 100 });
      const row = result.rows.find((r) => seededIds.has(r.id));
      assert(row, 'at least one seeded row returned');
      const keys = Object.keys(row!).sort();
      // F4-IMAGING-001-R6 widens this allow-list by exactly ONE field.
      // `storageBackend` is the object's own recorded backend, which the
      // backup sweep needs in order to open the right source — before R6 it
      // inherited the reader's global-flag check and recorded a healthy
      // VPS2 object as `missing_source` whenever the flag was unset. It is a
      // logical placement label, not PHI, not an endpoint, not a credential,
      // and it is carried RAW: interpretation belongs to
      // resolveImagingStoragePlacement() at the point of use, because that
      // interpreter fails closed and this enumeration runs outside the backup
      // sweep's per-row try/catch. The widening is deliberate and the list
      // stays closed: no study metadata, modality, patientId or originalName
      // may ever join it.
      assertEqual(JSON.stringify(keys), JSON.stringify(['clinicId', 'fileSize', 'id', 'storageBackend', 'storageKeyOrFilePath']), 'DTO keys are exactly the accepted narrow set');
    });

    await test('R6: the placement column is carried verbatim — NULL stays NULL (pre-R6), an explicit value survives unchanged, and no provider endpoint/credential is exposed', async () => {
      const result = await listImagesForBackup({ limit: 100 });
      const rows = result.rows.filter((r) => seededIds.has(r.id));
      assert(rows.length > 0, 'at least one seeded row returned');

      // The rows seeded by this suite carry no storageBackend value, i.e. they
      // are exactly the pre-R6 shape. The DTO must not paper over that: NULL
      // must arrive as NULL, so the consumer's own fail-closed interpreter
      // decides what it means.
      assertEqual(
        rows.every((r) => r.storageBackend === null),
        true,
        'rows written without a storageBackend value (the pre-R6 shape) arrive as NULL, not silently defaulted',
      );

      const target = rows[0]!;
      await prisma.imagingImage.update({ where: { id: target.id }, data: { storageBackend: 'vps2' } });
      try {
        const after = await listImagesForBackup({ limit: 100 });
        const updated = after.rows.find((r) => r.id === target.id);
        assert(updated, 'updated row still enumerated');
        assertEqual(updated!.storageBackend, 'vps2', 'an explicit vps2 placement survives the DTO verbatim');
        // Placement is an opaque label. It must never be a URL, a bucket or a key.
        assert(!/[:/]/.test(updated!.storageBackend!), 'storageBackend must not look like a URL/endpoint/key');
      } finally {
        await prisma.imagingImage.update({ where: { id: target.id }, data: { storageBackend: null } });
      }
    });

    section('=== Pagination: exhaustiveness, no duplicates, stable ordering ===');

    await test('paginating with a small limit returns every seeded row exactly once, in ascending id order, matching a single unpaginated call', async () => {
      const expectedIds = seeded.map((s) => s.id).sort();

      const collected: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (;;) {
        const page = await listImagesForBackup({ cursor, limit: 2 });
        for (const row of page.rows) if (seededIds.has(row.id)) collected.push(row.id);
        pages += 1;
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
        assert(pages < 50, 'pagination did not terminate within a sane number of pages');
      }

      assertEqual(collected.length, expectedIds.length, 'exactly one occurrence of every seeded row across all pages — none duplicated, none dropped');
      assertEqual(JSON.stringify([...collected].sort()), JSON.stringify(expectedIds), 'the de-duplicated, sorted set of collected ids matches the seeded set exactly');

      // Ordering: ids collected in original page order must already be
      // ascending (id asc, matching fileBackupService.ts's own pre-migration
      // iterateSourceRows ordering — required for the file-backup entry
      // ledger's skip/cursor semantics to remain stable across runs).
      const sortedByPageOrder = [...collected];
      const sortedAscending = [...collected].sort();
      assertEqual(JSON.stringify(sortedByPageOrder), JSON.stringify(sortedAscending), 'rows are returned in stable ascending-id order across pages');
    });

    section('=== Edge cases ===');

    await test('empty dataset: a cursor positioned after every seeded row returns zero rows and no nextCursor', async () => {
      const maxId = seeded.map((s) => s.id).sort().at(-1)!;
      const result = await listImagesForBackup({ cursor: maxId, limit: 100 });
      const onlyOurRows = result.rows.filter((r) => seededIds.has(r.id));
      assertEqual(onlyOurRows.length, 0, 'no rows after the last seeded id');
      assertEqual(result.nextCursor, undefined, 'no nextCursor when the page is empty');
    });

    await test('batch boundary: a page exactly filled to `limit` still sets nextCursor (even when it happens to be every remaining row); the following trailing page is empty with no further nextCursor', async () => {
      // limit === total seeded rows in the DB (there is no other data at this
      // point besides this suite's own seeded rows), so the returned page is
      // exactly `limit` rows long — this is the exact boundary condition the
      // pre-migration generator's own `rows.length < batchSize` termination
      // rule was written against (it always issues one harmless extra
      // trailing fetch in this case, which this test also proves below).
      const total = seeded.length;
      const fullPage = await listImagesForBackup({ limit: total });
      const oursInFullPage = fullPage.rows.filter((r) => seededIds.has(r.id));
      assertEqual(oursInFullPage.length, total, 'sanity: full page returns exactly `total` seeded rows when limit === total');
      assert(fullPage.nextCursor !== undefined, 'nextCursor is set whenever the returned page is exactly `limit` rows long, even though it was every remaining row');

      const trailingPage = await listImagesForBackup({ cursor: fullPage.nextCursor, limit: total });
      const trailingOurs = trailingPage.rows.filter((r) => seededIds.has(r.id));
      assertEqual(trailingOurs.length, 0, 'the trailing fetch past the last row returns nothing new');
      assertEqual(trailingPage.nextCursor, undefined, 'and reports no further nextCursor, terminating pagination');
    });
  } finally {
    await prisma.imagingImage.deleteMany({ where: { id: { in: seeded.map((s) => s.id) } } }).catch(() => {});
    await prisma.imagingStudy.deleteMany({ where: { id: { in: [studyA.id, studyB.id] } } }).catch(() => {});
    await cleanupAllFixtures();
  }

  return summary();
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((err) => {
    console.error('[imaging-backup-ops-port] Fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
