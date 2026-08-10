/**
 * fileBackupImagingOpsPortMigration.test.ts — F2-STAGE3-GAPD-001 regression
 * suite for the Imaging Ops Backup Read Port migration.
 *
 * DB-independent, source-level proof (same technique as
 * dbVerification/privacyImagingLifecyclePortMigration.test.ts's own
 * "uses the port, not direct Prisma" checks) that:
 *
 *   A. fileBackupService.ts no longer references the Imaging Prisma model
 *      at all (no generic `(prisma as any)['imagingImage']` bracket-access,
 *      no `prisma.imagingImage` dotted-access) — the direct cross-domain
 *      dependency this task eliminates.
 *   B. fileBackupService.ts instead imports and calls
 *      imaging/ops.ts's listImagesForBackup for its Imaging enumeration arm.
 *   C. imaging/ops.ts's listImagesForBackup takes no clinicId parameter —
 *      this is a GLOBAL/platform contract, not a tenant-facing one, and this
 *      structural check guards against it accidentally growing one.
 *   D. imaging/ops.ts's DTO (ImagingBackupRow) exposes exactly the narrow
 *      allow-listed fields — id, clinicId, storageKeyOrFilePath, fileSize —
 *      and its Prisma `select` reads only the matching four columns, so no
 *      patientId/study metadata/modality/originalName/other PHI can cross
 *      the boundary even by future accident.
 *   E. fileBackupRestoreCli.ts / restoreFileToPath's restore path is
 *      untouched by this migration — it still only ever refers to
 *      'ImagingImage' as a literal sourceModel string against
 *      FileBackupEntry, never importing imaging/ops.ts.
 *
 * Run: cd server && npx tsx src/tests/fileBackupImagingOpsPortMigration.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

const fileBackupServiceSrc = fs.readFileSync(
  new URL('../services/fileBackupService.ts', import.meta.url),
  'utf8',
);
const opsSrc = fs.readFileSync(new URL('../services/imaging/ops.ts', import.meta.url), 'utf8');
const restoreCliSrc = fs.readFileSync(
  new URL('../scripts/fileBackupRestoreCli.ts', import.meta.url),
  'utf8',
);

section('A/B: fileBackupService.ts no longer directly queries the Imaging Prisma model');

await test('fileBackupService.ts contains no direct access to the Imaging Prisma client property (camelCase "imagingImage" — as opposed to the PascalCase "ImagingImage" SourceModelName literal, which legitimately remains as a domain-model discriminant)', () => {
  assert.ok(!/imagingImage/.test(fileBackupServiceSrc), 'the camelCase string "imagingImage" (Prisma client property name) must not appear anywhere in fileBackupService.ts');
});

await test('fileBackupService.ts imports listImagesForBackup from the Imaging ops port', () => {
  assert.match(fileBackupServiceSrc, /import\s*\{\s*listImagesForBackup\s*\}\s*from\s*['"]\.\/imaging\/ops\.js['"]/);
});

await test('fileBackupService.ts calls listImagesForBackup (not a generic Prisma access) for its Imaging enumeration arm', () => {
  assert.match(fileBackupServiceSrc, /listImagesForBackup\(\s*\{\s*cursor,\s*limit:\s*batchSize\s*\}\s*\)/);
});

await test('the ImagingImage entry in SOURCE_MODELS is wired to the ops-port iterator, not a prismaKey', () => {
  assert.match(fileBackupServiceSrc, /name:\s*'ImagingImage'[^}]*rows:\s*iterateImagingRowsForBackup/);
});

section('C: the ops-port contract is structurally global — no clinicId parameter');

await test('listImagesForBackup takes only { cursor?, limit } — no clinicId anywhere in its parameter type', () => {
  const fnMatch = opsSrc.match(/export async function listImagesForBackup\(params:\s*\{([\s\S]*?)\}\)/);
  assert.ok(fnMatch, 'listImagesForBackup must exist with an object parameter');
  const paramsBody = fnMatch![1]!;
  assert.ok(!/clinicId/i.test(paramsBody), 'listImagesForBackup\'s parameter type must never include clinicId — this is a global/platform contract, not tenant-facing');
  assert.match(paramsBody, /cursor\?:\s*string/);
  assert.match(paramsBody, /limit:\s*number/);
});

await test('the ops.ts module header documents the global-scope-is-intentional rationale, so the contract cannot be silently reinterpreted as tenant-facing', () => {
  assert.match(opsSrc, /NOT a tenant-facing API/);
  assert.match(opsSrc, /no clinicId/i);
});

section('D: narrow DTO — only the accepted four fields cross the boundary');

await test('ImagingBackupRow exposes exactly id, clinicId, storageKeyOrFilePath, fileSize', () => {
  const dtoMatch = opsSrc.match(/export interface ImagingBackupRow \{([\s\S]*?)\}/);
  assert.ok(dtoMatch, 'ImagingBackupRow interface must exist');
  const fields = Array.from(dtoMatch![1]!.matchAll(/^\s*([a-zA-Z]+):/gm)).map((m) => m[1]);
  assert.deepEqual([...fields].sort(), ['clinicId', 'fileSize', 'id', 'storageKeyOrFilePath'].sort());
});

await test('the underlying Prisma select reads only id/clinicId/filePath/fileSize — no patientId, studyId, originalName, mimeType, or other column', () => {
  const selectMatch = opsSrc.match(/select:\s*\{([\s\S]*?)\}\s*,?\s*\}\);/);
  assert.ok(selectMatch, 'a select clause must exist on the imagingImage.findMany call');
  const selectedFields = Array.from(selectMatch![1]!.matchAll(/(\w+):\s*true/g)).map((m) => m[1]);
  assert.deepEqual([...selectedFields].sort(), ['clinicId', 'fileSize', 'filePath', 'id'].sort());
});

await test('listImagesForBackup\'s own implementation (excluding doc comments) never selects patientId, originalName, mimeType, modality, or study metadata', () => {
  const fnBody = opsSrc.slice(opsSrc.indexOf('export async function listImagesForBackup'));
  assert.ok(!/patientId/.test(fnBody));
  assert.ok(!/originalName/.test(fnBody));
  assert.ok(!/mimeType/.test(fnBody));
  assert.ok(!/modality/i.test(fnBody));
  assert.ok(!/study:/.test(fnBody));
});

section('E: restore path is unaffected by this enumeration-side migration');

await test('fileBackupRestoreCli.ts does not import the Imaging ops port — restore never used the enumeration path this migration changed', () => {
  assert.ok(!/imaging\/ops\.js/.test(restoreCliSrc), 'the restore CLI must not import imaging/ops.ts');
});

await test('fileBackupRestoreCli.ts still treats ImagingImage as a plain sourceModel string against the FileBackupEntry ledger, unchanged by the migration', () => {
  assert.match(restoreCliSrc, /'PatientAttachment', 'LabOrderAttachment', 'ImagingImage'/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
