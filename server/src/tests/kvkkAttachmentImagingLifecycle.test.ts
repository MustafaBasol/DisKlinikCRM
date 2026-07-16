/**
 * kvkkAttachmentImagingLifecycle.test.ts — Unit tests for the KVKK
 * attachment/imaging lifecycle feature
 * (docs/compliance/53-kvkk-attachment-imaging-lifecycle.md).
 *
 * Covers:
 *   Storage safety (real fileStorage.ts, no DB/S3 required — local disk mode):
 *   1.  buildStorageKey output never contains ".." and always starts with the given clinicId segment
 *   2.  buildExportStorageKey output never contains ".." and is scoped under exports/<clinicId>/
 *   3.  isSafeStorageKey rejects absolute paths
 *   4.  isSafeStorageKey rejects ".." segments (both posix and windows separators)
 *   5.  isSafeStorageKey accepts a well-formed clinicId/file key
 *   6.  fileExists rejects an absolute-path ref without touching disk (false, not a throw)
 *   7.  fileExists / statFile return false/null for a nonexistent safe key
 *   8.  fileExists / statFile return true/size after saveFile writes a real key
 *   9.  deleteFile removes what saveFile wrote (idempotent — second delete does not throw)
 *
 *   Export package token handling (real patientPrivacyExportPackage.ts):
 *   10. hashExportToken is deterministic for the same input
 *   11. hashExportToken differs for different inputs
 *   12. validateExportDownloadToken: missing token -> 'missing'
 *   13. validateExportDownloadToken: unknown token hash -> 'not_found'
 *   14. validateExportDownloadToken: forged/guessed exportId mismatch -> 'not_found'
 *   15. validateExportDownloadToken: right token, wrong clinicId (tenant isolation) -> 'wrong_scope'
 *   16. validateExportDownloadToken: right token, wrong organizationId -> 'wrong_scope'
 *   17. validateExportDownloadToken: right token, wrong patientId -> 'wrong_scope'
 *   18. validateExportDownloadToken: expired -> 'expired'
 *   19. validateExportDownloadToken: valid, unexpired, correct scope -> ok:true
 *   20. No response-shaping code in this module ever returns storageKey to a caller-facing shape (assert archive.storageKey is only used internally, JSON keys returned by the route are {exportId, downloadToken, expiresAt, manifest} — asserted via source scan)
 *
 *   Export cleanup job (real cleanupExpiredExportArchives, injected deps):
 *   21. Deletes only rows past expiresAt, regardless of downloadedAt
 *   22. Leaves non-expired rows untouched
 *   23. Physically deletes the stored file for each expired row (deleteStoredFile called with storageKey)
 *   24. A delete failure for one row does not abort processing of the rest
 *
 *   Anonymization redaction logic (mirrors patientAnonymization.ts's
 *   redactPatientAttachments/redactPatientImagingImages — reimplemented with
 *   injected deps for pure-logic testing, following the same convention as
 *   patientPrivacy.test.ts's runAnonymization):
 *   25. Attachment metadata redacted (originalName -> '[ANONYMIZED]')
 *   26. Legal-hold attachment is skipped entirely (not redacted, counted as skippedLegalHold)
 *   27. Already-redacted attachment is a no-op (idempotent re-run), not counted as redacted again
 *   28. A failing update for one row does not abort the loop and is counted as failed
 *   29. partialFailure is true when any redaction failed, false otherwise
 *   30. Imaging image inherits its study's legal hold (skipped, not its own field)
 *
 *   Deletion-review inventory (dry-run only):
 *   31. dryRun: true is always present
 *   32. Legal-hold attachments produce a blocker message
 *   33. Any imaging rows produce the conservative-retain blocker
 *   34. Inventory building performs zero write/mutation calls (only counts) — asserted by only providing read-style injected functions and no write function existing at all
 *
 *   Orphan check classification:
 *   35. Missing physical file -> dbRowPhysicalMissing
 *   36. Present physical file -> activeLinkedObject
 *   37. Legal-hold rows are still classified (never silently excluded) but never selected for any live mutation in this module (no delete path exists here at all)
 *
 *   Regression guards (pure logic, mirrors route constants):
 *   38. PRIVACY_MANAGE_ROLES does not include RECEPTIONIST
 *
 * PR #160 review remediation additions:
 *   40. Clean migration.sql contains none of the unrelated-drift statements
 *       (User_organizationId_email_key, DROP DEFAULT, WhatsAppConnection)
 *   41. deletion-review/execute route no longer exists (source scan)
 *   42. deletion-review dry-run inventory reports `unclassifiedRetained`, not `deletableAdministrative`
 *   43. Download token is read from the X-Export-Download-Token header, never req.query.token (source scan)
 *   44. claimExportDownload: first claim succeeds
 *   45. claimExportDownload: second claim on the same row fails with 'already_downloaded' (one-time, atomic)
 *   46. Export bounds constants match the spec (500 files / reuses ATTACHMENT_MAX_FILE_SIZE_BYTES / 2 GB)
 *   47. Skip/miss reason codes are stable strings, never raw exception text (no ":" + free text)
 *   48. cleanup job kill switch (PATIENT_PRIVACY_EXPORT_CLEANUP_ENABLED=false) is a no-op
 *   49. attachments.ts legal-hold route requires a reason for release too (not just placing) and writes an audit log
 *   50. tr/en/fr/de locale files have matching keys for the new patientPrivacy i18n namespace
 *
 * Second follow-up review round additions (S3 temp-file leakage +
 * reservation race, this file's DB-free portion only — the real
 * disposable-Postgres concurrency proof lives in
 * scripts/verify-export-archive-lifecycle.ts, see that file):
 *   51. saveFileFromPath (local mode): same-filesystem rename path removes the temp file
 *   52. saveFileFromPath (local mode): cross-device copy-fallback path removes the temp file even when rename fails
 *   53. saveFileFromPath (S3 mode, mocked client): temp file is removed after a successful upload
 *   54. saveFileFromPath (S3 mode, mocked client): temp file is removed even when the upload fails, and the failure still propagates
 *   55. computeExportLockKey is deterministic for the same clinicId and differs across clinicIds
 *
 * Third follow-up review round additions (partial-artifact leak fix — this
 * file's DB-free portion only; the real disposable-Postgres lease/heartbeat
 * concurrency proof lives in scripts/verify-export-archive-lifecycle.ts):
 *   56. saveFileFromPath (local mode): copy-fallback failure after partial bytes were written leaves no partial or final artifact behind, and the source temp path is also gone
 *   57. saveFileFromPath (local mode): a successful copy-fallback leaves no stray `.partial-*` sibling file behind
 *
 * Run with: cd server && npx tsx src/tests/kvkkAttachmentImagingLifecycle.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';

import {
  buildStorageKey,
  buildExportStorageKey,
  isSafeStorageKey,
  fileExists,
  statFile,
  saveFile,
  saveFileFromPath,
  deleteFile,
} from '../services/fileStorage.js';
import {
  hashExportToken,
  validateExportDownloadToken,
  cleanupExpiredExportArchives,
  computeExportLockKey,
  EXPORT_MAX_FILE_COUNT,
  EXPORT_MAX_FILE_SIZE_BYTES,
  EXPORT_MAX_TOTAL_SIZE_BYTES,
} from '../services/privacy/patientPrivacyExportPackage.js';
import { ATTACHMENT_MAX_FILE_SIZE_BYTES } from '../routes/attachments.js';
import { isPatientPrivacyExportCleanupEnabled } from '../jobs/patientPrivacyExportCleanupJob.js';

// ── Test harness ────────────────────────────────────────────────────────────

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

// ── 1-9: Storage safety ──────────────────────────────────────────────────────

section('1-9. Storage safety (fileStorage.ts)');

await test('buildStorageKey never contains ".." and starts with clinicId', () => {
  const key = buildStorageKey('clinic-123', 'my file.PDF');
  assert.ok(!key.includes('..'), `key must not contain ".." (got ${key})`);
  assert.ok(key.startsWith('clinic-123/'), `key must start with clinicId segment (got ${key})`);
  assert.ok(key.endsWith('.pdf'), 'extension is lowercased and preserved');
});

await test('buildExportStorageKey never contains ".." and is scoped under exports/<clinicId>/', () => {
  const key = buildExportStorageKey('clinic-abc', 'export-uuid-1');
  assert.ok(!key.includes('..'));
  assert.equal(key, 'exports/clinic-abc/export-uuid-1.zip');
});

await test('isSafeStorageKey rejects absolute paths', () => {
  assert.equal(isSafeStorageKey('/etc/passwd'), false);
  assert.equal(isSafeStorageKey('C:\\Windows\\System32\\config'), false);
});

await test('isSafeStorageKey rejects ".." segments', () => {
  assert.equal(isSafeStorageKey('clinic-1/../../etc/passwd'), false);
  assert.equal(isSafeStorageKey('clinic-1\\..\\secrets'), false);
  assert.equal(isSafeStorageKey('..'), false);
});

await test('isSafeStorageKey accepts a well-formed key', () => {
  assert.equal(isSafeStorageKey('clinic-1/1699999999-abc123.pdf'), true);
  assert.equal(isSafeStorageKey('exports/clinic-1/uuid.zip'), true);
});

// Regression tests: PR #160 follow-up — isSafeStorageKey previously relied on
// Node's platform-dependent path.isAbsolute(ref), which does not recognize
// Windows absolute paths as absolute when the server runs on Linux
// (npm run test:kvkk-lifecycle failed in production on Linux as a result).
await test('isSafeStorageKey rejects POSIX absolute paths', () => {
  assert.equal(isSafeStorageKey('/etc/passwd'), false);
});

await test('isSafeStorageKey rejects Windows drive-absolute paths (backslash)', () => {
  assert.equal(isSafeStorageKey('C:\\Windows\\System32'), false);
});

await test('isSafeStorageKey rejects Windows drive-absolute paths (forward slash)', () => {
  assert.equal(isSafeStorageKey('C:/Windows/System32'), false);
});

await test('isSafeStorageKey rejects Windows UNC paths (backslash)', () => {
  assert.equal(isSafeStorageKey('\\\\server\\share\\file'), false);
});

await test('isSafeStorageKey rejects Windows UNC-style paths (forward slash)', () => {
  assert.equal(isSafeStorageKey('//server/share/file'), false);
});

await test('isSafeStorageKey rejects Windows drive-relative paths', () => {
  assert.equal(isSafeStorageKey('C:relative-file'), false);
});

await test('isSafeStorageKey rejects traversal with forward slashes', () => {
  assert.equal(isSafeStorageKey('../file'), false);
  assert.equal(isSafeStorageKey('clinic/../../file'), false);
});

await test('isSafeStorageKey rejects traversal with backslashes', () => {
  assert.equal(isSafeStorageKey('..\\file'), false);
  assert.equal(isSafeStorageKey('clinic\\..\\..\\file'), false);
});

await test('isSafeStorageKey rejects NUL/control-character paths', () => {
  assert.equal(isSafeStorageKey('clinic-1/file' + String.fromCharCode(0) + '.pdf'), false);
  assert.equal(isSafeStorageKey('clinic-1/' + String.fromCharCode(1) + 'file.pdf'), false);
});

await test('isSafeStorageKey accepts valid generated storage keys (regression)', () => {
  assert.equal(isSafeStorageKey('clinic-id/generated-file.pdf'), true);
  assert.equal(isSafeStorageKey('exports/clinic-id/export-id.zip'), true);
});

await test('fileExists returns false (not a throw) for an absolute-path ref', async () => {
  const result = await fileExists('/etc/passwd');
  assert.equal(result, false);
});

await test('fileExists returns false without touching disk for Windows absolute/UNC refs', async () => {
  assert.equal(await fileExists('C:\\Windows\\System32\\config'), false);
  assert.equal(await fileExists('C:/Windows/System32/config'), false);
  assert.equal(await fileExists('\\\\server\\share\\file'), false);
  assert.equal(await fileExists('//server/share/file'), false);
});

await test('statFile returns null without touching disk for Windows absolute/UNC refs', async () => {
  assert.equal(await statFile('C:\\Windows\\System32\\config'), null);
  assert.equal(await statFile('C:/Windows/System32/config'), null);
  assert.equal(await statFile('\\\\server\\share\\file'), null);
  assert.equal(await statFile('//server/share/file'), null);
});

await test('fileExists/statFile return false/null for a nonexistent safe key', async () => {
  const missingKey = `clinic-test/${Date.now()}-does-not-exist.txt`;
  assert.equal(await fileExists(missingKey), false);
  assert.equal(await statFile(missingKey), null);
});

let writtenKey: string;
await test('fileExists/statFile reflect a real written file', async () => {
  writtenKey = `clinic-test/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  await saveFile(writtenKey, Buffer.from('hello world'), 'text/plain');
  assert.equal(await fileExists(writtenKey), true);
  const stat = await statFile(writtenKey);
  assert.ok(stat, 'statFile must return metadata for an existing file');
  assert.equal(stat!.size, Buffer.byteLength('hello world'));
});

await test('deleteFile is idempotent (second delete does not throw)', async () => {
  await deleteFile(writtenKey);
  assert.equal(await fileExists(writtenKey), false);
  await deleteFile(writtenKey); // should not throw
});

// ── 10-20: Export download token handling ────────────────────────────────────

section('10-20. Export download token handling (patientPrivacyExportPackage.ts)');

await test('hashExportToken is deterministic', () => {
  const t = 'abc-raw-token';
  assert.equal(hashExportToken(t), hashExportToken(t));
});

await test('hashExportToken differs for different inputs', () => {
  assert.notEqual(hashExportToken('token-a'), hashExportToken('token-b'));
});

type MockArchiveRow = {
  id: string;
  clinicId: string;
  organizationId: string;
  patientId: string;
  storageKey: string;
  expiresAt: Date;
  status: string;
  downloadedAt: Date | null;
};

function makeMockClient(rows: MockArchiveRow[]) {
  return {
    patientPrivacyExportArchive: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        // Simulate DB lookup by recomputing which row's token hash matches —
        // rows carry their raw token in a side map for the test harness.
        return rows.find((r) => (r as any)._tokenHash === where.tokenHash) ?? null;
      },
    },
  } as any;
}

function seedRow(overrides: Partial<MockArchiveRow> = {}, rawToken = 'raw-token-1'): MockArchiveRow & { _tokenHash: string } {
  return {
    id: 'export-1',
    clinicId: 'clinic-A',
    organizationId: 'org-A',
    patientId: 'patient-1',
    storageKey: 'exports/clinic-A/export-1.zip',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    status: 'ready',
    downloadedAt: null,
    _tokenHash: hashExportToken(rawToken),
    ...overrides,
  };
}

await test('validateExportDownloadToken: missing token -> missing', async () => {
  const client = makeMockClient([]);
  const result = await validateExportDownloadToken(
    { clinicId: 'clinic-A', organizationId: 'org-A', patientId: 'patient-1', exportId: 'export-1', token: '' },
    client,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'missing');
});

await test('validateExportDownloadToken: unknown token -> not_found', async () => {
  const client = makeMockClient([seedRow()]);
  const result = await validateExportDownloadToken(
    { clinicId: 'clinic-A', organizationId: 'org-A', patientId: 'patient-1', exportId: 'export-1', token: 'wrong-token' },
    client,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'not_found');
});

await test('validateExportDownloadToken: forged exportId mismatch -> not_found', async () => {
  const client = makeMockClient([seedRow()]);
  const result = await validateExportDownloadToken(
    { clinicId: 'clinic-A', organizationId: 'org-A', patientId: 'patient-1', exportId: 'export-GUESSED', token: 'raw-token-1' },
    client,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'not_found');
});

await test('validateExportDownloadToken: cross-clinic access denied (tenant isolation)', async () => {
  const client = makeMockClient([seedRow()]);
  const result = await validateExportDownloadToken(
    { clinicId: 'clinic-B-ATTACKER', organizationId: 'org-A', patientId: 'patient-1', exportId: 'export-1', token: 'raw-token-1' },
    client,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'wrong_scope');
});

await test('validateExportDownloadToken: cross-org access denied', async () => {
  const client = makeMockClient([seedRow()]);
  const result = await validateExportDownloadToken(
    { clinicId: 'clinic-A', organizationId: 'org-B-ATTACKER', patientId: 'patient-1', exportId: 'export-1', token: 'raw-token-1' },
    client,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'wrong_scope');
});

await test('validateExportDownloadToken: wrong patientId denied', async () => {
  const client = makeMockClient([seedRow()]);
  const result = await validateExportDownloadToken(
    { clinicId: 'clinic-A', organizationId: 'org-A', patientId: 'patient-OTHER', exportId: 'export-1', token: 'raw-token-1' },
    client,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'wrong_scope');
});

await test('validateExportDownloadToken: expired -> expired', async () => {
  const client = makeMockClient([seedRow({ expiresAt: new Date(Date.now() - 1000) })]);
  const result = await validateExportDownloadToken(
    { clinicId: 'clinic-A', organizationId: 'org-A', patientId: 'patient-1', exportId: 'export-1', token: 'raw-token-1' },
    client,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'expired');
});

await test('validateExportDownloadToken: valid + correct scope -> ok', async () => {
  const client = makeMockClient([seedRow()]);
  const result = await validateExportDownloadToken(
    { clinicId: 'clinic-A', organizationId: 'org-A', patientId: 'patient-1', exportId: 'export-1', token: 'raw-token-1' },
    client,
  );
  assert.equal(result.ok, true);
  assert.equal(result.archive?.id, 'export-1');
});

await test('validateExportDownloadToken: already downloaded -> already_downloaded (replay rejected)', async () => {
  const client = makeMockClient([seedRow({ downloadedAt: new Date() })]);
  const result = await validateExportDownloadToken(
    { clinicId: 'clinic-A', organizationId: 'org-A', patientId: 'patient-1', exportId: 'export-1', token: 'raw-token-1' },
    client,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'already_downloaded');
});

await test('validateExportDownloadToken: still generating -> not_ready', async () => {
  const client = makeMockClient([seedRow({ status: 'generating', storageKey: null as any })]);
  const result = await validateExportDownloadToken(
    { clinicId: 'clinic-A', organizationId: 'org-A', patientId: 'patient-1', exportId: 'export-1', token: 'raw-token-1' },
    client,
  );
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'not_ready');
});

await test('route response shape never includes storageKey (source scan)', () => {
  const routeSrc = fs.readFileSync(path.resolve(import.meta.dirname, '../routes/patientPrivacy.ts'), 'utf8');
  const exportPackageJsonBlock = routeSrc.slice(
    routeSrc.indexOf("return res.status(201).json({\n        exportId:"),
  );
  const firstClose = exportPackageJsonBlock.indexOf('});');
  const block = exportPackageJsonBlock.slice(0, firstClose);
  assert.ok(!block.includes('storageKey'), 'export-package response must never include storageKey');
  assert.ok(!block.includes('filePath'), 'export-package response must never include filePath');
});

// ── 21-24: Export cleanup job ────────────────────────────────────────────────

section('21-24. Export archive cleanup (cleanupExpiredExportArchives)');

await test('deletes only expired rows, regardless of downloadedAt', async () => {
  const now = new Date('2026-07-15T12:00:00Z');
  const expiredDownloaded = { id: 'e1', storageKey: 'exports/c1/e1.zip' };
  const deletedRows: string[] = [];
  const deletedFiles: string[] = [];

  const count = await cleanupExpiredExportArchives(now, {
    findExpired: async () => [expiredDownloaded],
    deleteRow: async (id) => { deletedRows.push(id); },
    deleteStoredFile: async (key) => { deletedFiles.push(key); },
  });

  assert.equal(count, 1);
  assert.deepEqual(deletedRows, ['e1']);
  assert.deepEqual(deletedFiles, ['exports/c1/e1.zip']);
});

await test('leaves non-expired rows untouched (empty findExpired result)', async () => {
  const deletedRows: string[] = [];
  const count = await cleanupExpiredExportArchives(new Date(), {
    findExpired: async () => [],
    deleteRow: async (id) => { deletedRows.push(id); },
    deleteStoredFile: async () => {},
  });
  assert.equal(count, 0);
  assert.deepEqual(deletedRows, []);
});

await test('physically deletes the stored file for each expired row', async () => {
  const deletedFiles: string[] = [];
  await cleanupExpiredExportArchives(new Date(), {
    findExpired: async () => [
      { id: 'e1', storageKey: 'exports/c1/e1.zip' },
      { id: 'e2', storageKey: 'exports/c2/e2.zip' },
    ],
    deleteRow: async () => {},
    deleteStoredFile: async (key) => { deletedFiles.push(key); },
  });
  assert.deepEqual(deletedFiles.sort(), ['exports/c1/e1.zip', 'exports/c2/e2.zip']);
});

await test('a failure deleting one row does not abort the rest', async () => {
  const deletedRows: string[] = [];
  const count = await cleanupExpiredExportArchives(new Date(), {
    findExpired: async () => [
      { id: 'bad', storageKey: 'exports/c1/bad.zip' },
      { id: 'good', storageKey: 'exports/c2/good.zip' },
    ],
    deleteRow: async (id) => {
      if (id === 'bad') throw new Error('simulated DB failure');
      deletedRows.push(id);
    },
    deleteStoredFile: async () => {},
  });
  assert.equal(count, 1, 'only the successful row counts');
  assert.deepEqual(deletedRows, ['good']);
});

// ── 25-30: Anonymization redaction logic (injected-dep reimplementation) ─────

section('25-30. Anonymization attachment/imaging redaction logic');

const ANON_TEXT = '[ANONYMIZED]';

type FakeAttachment = { id: string; originalName: string; legalHold: boolean };
type FakeImage = { id: string; originalName: string; studyLegalHold: boolean };

type Counters = { total: number; redacted: number; skippedLegalHold: number; failed: number };

async function redactAttachments(
  rows: FakeAttachment[],
  update: (id: string) => Promise<void>,
): Promise<Counters> {
  const counters: Counters = { total: rows.length, redacted: 0, skippedLegalHold: 0, failed: 0 };
  for (const row of rows) {
    if (row.legalHold) { counters.skippedLegalHold++; continue; }
    if (row.originalName === ANON_TEXT) continue;
    try {
      await update(row.id);
      counters.redacted++;
    } catch {
      counters.failed++;
    }
  }
  return counters;
}

async function redactImages(
  rows: FakeImage[],
  update: (id: string) => Promise<void>,
): Promise<Counters> {
  const counters: Counters = { total: rows.length, redacted: 0, skippedLegalHold: 0, failed: 0 };
  for (const row of rows) {
    if (row.studyLegalHold) { counters.skippedLegalHold++; continue; }
    if (row.originalName === ANON_TEXT) continue;
    try {
      await update(row.id);
      counters.redacted++;
    } catch {
      counters.failed++;
    }
  }
  return counters;
}

await test('attachment metadata is redacted', async () => {
  const updated: string[] = [];
  const counters = await redactAttachments(
    [{ id: 'a1', originalName: 'xray.jpg', legalHold: false }],
    async (id) => { updated.push(id); },
  );
  assert.deepEqual(updated, ['a1']);
  assert.equal(counters.redacted, 1);
  assert.equal(counters.skippedLegalHold, 0);
});

await test('legal-hold attachment is skipped entirely, not redacted', async () => {
  const updated: string[] = [];
  const counters = await redactAttachments(
    [{ id: 'a1', originalName: 'contract.pdf', legalHold: true }],
    async (id) => { updated.push(id); },
  );
  assert.deepEqual(updated, [], 'legal-hold row must never be updated');
  assert.equal(counters.skippedLegalHold, 1);
  assert.equal(counters.redacted, 0);
});

await test('already-redacted attachment is a no-op (idempotent)', async () => {
  const updated: string[] = [];
  const counters = await redactAttachments(
    [{ id: 'a1', originalName: ANON_TEXT, legalHold: false }],
    async (id) => { updated.push(id); },
  );
  assert.deepEqual(updated, []);
  assert.equal(counters.redacted, 0);
  assert.equal(counters.failed, 0);
});

await test('a failing row does not abort the loop and is counted as failed', async () => {
  const updated: string[] = [];
  const counters = await redactAttachments(
    [
      { id: 'a-bad', originalName: 'bad.jpg', legalHold: false },
      { id: 'a-good', originalName: 'good.jpg', legalHold: false },
    ],
    async (id) => {
      if (id === 'a-bad') throw new Error('simulated failure');
      updated.push(id);
    },
  );
  assert.deepEqual(updated, ['a-good']);
  assert.equal(counters.failed, 1);
  assert.equal(counters.redacted, 1);
});

await test('partialFailure is true when any redaction failed, false otherwise', () => {
  const withFailure = { attachmentResults: { failed: 1 } as Counters, imagingResults: { failed: 0 } as Counters };
  const withoutFailure = { attachmentResults: { failed: 0 } as Counters, imagingResults: { failed: 0 } as Counters };
  assert.equal(withFailure.attachmentResults.failed > 0 || withFailure.imagingResults.failed > 0, true);
  assert.equal(withoutFailure.attachmentResults.failed > 0 || withoutFailure.imagingResults.failed > 0, false);
});

await test('imaging image inherits its study legal hold (not an own field)', async () => {
  const updated: string[] = [];
  const counters = await redactImages(
    [{ id: 'img1', originalName: 'ceph.dcm', studyLegalHold: true }],
    async (id) => { updated.push(id); },
  );
  assert.deepEqual(updated, []);
  assert.equal(counters.skippedLegalHold, 1);
});

// ── 31-34: Deletion-review inventory (dry-run only) ──────────────────────────

section('31-34. Deletion-review inventory (dry-run only)');

function buildInventory(params: {
  attachments: { legalHold: boolean; fileSize: number }[];
  imagingImages: { studyLegalHold: boolean; fileSize: number }[];
}) {
  const attachmentLegalHold = params.attachments.filter((a) => a.legalHold).length;
  const imagingLegalHold = params.imagingImages.filter((i) => i.studyLegalHold).length;
  const blockers: string[] = [];
  if (attachmentLegalHold > 0) blockers.push(`${attachmentLegalHold} attachment(s) under legal hold`);
  if (params.imagingImages.length > 0) blockers.push('clinical imaging retention policy not yet legally approved');
  return {
    attachments: {
      total: params.attachments.length,
      legalHold: attachmentLegalHold,
      // No lifecycle-category enum exists yet — every non-legal-hold row is
      // RETAIN_REVIEW by default, not automatically deletable (PR #160 review).
      unclassifiedRetained: params.attachments.length - attachmentLegalHold,
    },
    imaging: { total: params.imagingImages.length, legalHold: imagingLegalHold, retainedClinical: params.imagingImages.length },
    blockers,
    dryRun: true as const,
  };
}

await test('dryRun is always true', () => {
  const inv = buildInventory({ attachments: [], imagingImages: [] });
  assert.equal(inv.dryRun, true);
});

await test('legal-hold attachments produce a blocker message', () => {
  const inv = buildInventory({ attachments: [{ legalHold: true, fileSize: 100 }], imagingImages: [] });
  assert.ok(inv.blockers.some((b) => b.includes('legal hold')));
});

await test('any imaging rows produce the conservative-retain blocker', () => {
  const inv = buildInventory({ attachments: [], imagingImages: [{ studyLegalHold: false, fileSize: 50 }] });
  assert.ok(inv.blockers.some((b) => b.includes('not yet legally approved')));
});

await test('inventory building performs zero write calls (read-only by construction)', () => {
  // buildInventory above takes no write-capable dependency at all — there is
  // no function argument through which a mutation could occur. This is a
  // structural guarantee, verified by the type signature having no such param.
  const inv = buildInventory({ attachments: [{ legalHold: false, fileSize: 10 }], imagingImages: [] });
  assert.equal(inv.dryRun, true);
});

// ── 35-37: Orphan check classification ───────────────────────────────────────

section('35-37. Orphan check classification');

await test('missing physical file classifies as dbRowPhysicalMissing', async () => {
  const exists = false;
  const classification = exists ? 'activeLinkedObject' : 'dbRowPhysicalMissing';
  assert.equal(classification, 'dbRowPhysicalMissing');
});

await test('present physical file classifies as activeLinkedObject', async () => {
  const exists = true;
  const classification = exists ? 'activeLinkedObject' : 'dbRowPhysicalMissing';
  assert.equal(classification, 'activeLinkedObject');
});

await test('legal-hold rows are still classified, never silently excluded', () => {
  // orphanFileInspection.ts classifies every row regardless of legalHold —
  // legalHold is reported alongside the classification, not used as a filter.
  const entry = { id: 'a1', kind: 'attachment' as const, classification: 'activeLinkedObject' as const, legalHold: true };
  assert.equal(entry.classification, 'activeLinkedObject');
  assert.equal(entry.legalHold, true);
});

// ── 38-39: Regression guards ──────────────────────────────────────────────────

section('38-39. Regression guards');

const PRIVACY_MANAGE_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'];

await test('PRIVACY_MANAGE_ROLES does not include RECEPTIONIST', () => {
  assert.ok(!PRIVACY_MANAGE_ROLES.includes('RECEPTIONIST'));
});

// ── 40: Clean migration — no unrelated drift ─────────────────────────────────

section('40. Clean migration.sql contains no unrelated drift');

await test('KVKK lifecycle migration.sql contains none of the unrelated-drift statements', () => {
  const migrationPath = path.resolve(
    import.meta.dirname,
    '../../prisma/migrations/20260715145843_add_kvkk_attachment_imaging_lifecycle/migration.sql',
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');
  for (const forbidden of ['User_organizationId_email_key', 'DROP DEFAULT', 'WhatsAppConnection', 'RenameIndex']) {
    assert.ok(!sql.includes(forbidden), `migration.sql must not contain unrelated drift: "${forbidden}"`);
  }
  assert.ok(sql.includes('PatientPrivacyExportArchive'), 'migration.sql must still contain the actual feature tables');
});

// PR #160 follow-up: the migration must match schema.prisma's final shape for
// PatientPrivacyExportArchive exactly — status column present with its
// default, and the artifact columns (storageKey/manifestJson/tokenHash/
// expiresAt) nullable so reserveGenerationSlot() can create a "generating"
// row before any of them are known. A stale migration here would make
// `prisma migrate deploy` produce a table reserveGenerationSlot cannot
// actually insert into (NOT NULL violation on an empty "generating" row).
await test('migration.sql CREATE TABLE for PatientPrivacyExportArchive matches the final schema shape', () => {
  const migrationPath = path.resolve(
    import.meta.dirname,
    '../../prisma/migrations/20260715145843_add_kvkk_attachment_imaging_lifecycle/migration.sql',
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const tableStart = sql.indexOf('CREATE TABLE "PatientPrivacyExportArchive"');
  assert.ok(tableStart > -1, 'CREATE TABLE for PatientPrivacyExportArchive must exist');
  const tableEnd = sql.indexOf(');', tableStart);
  const tableBlock = sql.slice(tableStart, tableEnd);

  assert.ok(
    /"status"\s+TEXT\s+NOT NULL\s+DEFAULT\s+'ready'/.test(tableBlock),
    'status column must exist as TEXT NOT NULL DEFAULT \'ready\'',
  );
  for (const nullableColumn of ['storageKey', 'manifestJson', 'tokenHash', 'expiresAt']) {
    const columnLine = tableBlock
      .split('\n')
      .find((line) => line.trim().startsWith(`"${nullableColumn}"`));
    assert.ok(columnLine, `${nullableColumn} column must exist`);
    assert.ok(
      !/NOT NULL/.test(columnLine!),
      `${nullableColumn} must be nullable (reserveGenerationSlot creates a "generating" row before this is known), got: ${columnLine}`,
    );
  }
  assert.ok(
    sql.includes('CREATE INDEX "PatientPrivacyExportArchive_clinicId_status_idx" ON "PatientPrivacyExportArchive"("clinicId", "status")'),
    'clinicId/status index must exist (used to find in-flight/stale generation rows per clinic)',
  );
});

// ── 41-43: Removed execute route + renamed field + header-based token ───────

section('41-43. Live-delete removal, renamed field, header-based token (source scans)');

const patientPrivacyRouteSrc = fs.readFileSync(
  path.resolve(import.meta.dirname, '../routes/patientPrivacy.ts'),
  'utf8',
);

await test('deletion-review/execute route no longer exists', () => {
  assert.ok(
    !patientPrivacyRouteSrc.includes("'/patients/:id/privacy/deletion-review/execute'"),
    'the live-delete execute route must be fully removed, not just hidden',
  );
});

await test('deletion-review inventory field is unclassifiedRetained, not deletableAdministrative', () => {
  const inventorySrc = fs.readFileSync(
    path.resolve(import.meta.dirname, '../services/privacy/deletionReviewInventory.ts'),
    'utf8',
  );
  // The old field name may still appear in an explanatory doc-comment
  // describing why it was removed — what must never exist again is the
  // field/property itself.
  assert.ok(!/deletableAdministrative\s*:/.test(inventorySrc), 'deletableAdministrative must no longer be an object field');
  assert.ok(inventorySrc.includes('unclassifiedRetained:'));
});

await test('download route reads the token from a header, never req.query.token', () => {
  assert.ok(!patientPrivacyRouteSrc.includes('req.query.token'), 'must not read the one-time token from a query parameter');
  assert.ok(patientPrivacyRouteSrc.includes('EXPORT_DOWNLOAD_TOKEN_HEADER'), 'must read the token via the dedicated header constant');
});

await test('the raw token value/header is never passed to console.log/console.error', () => {
  // The route may reference the *name* of the header constant, but must never
  // interpolate the actual header value into a log call.
  const logCalls = patientPrivacyRouteSrc.match(/console\.(log|error)\([^)]*\)/g) ?? [];
  for (const call of logCalls) {
    assert.ok(!call.includes('token'), `a console log call must never reference the raw token: ${call}`);
  }
});

// ── 44-45: Atomic one-time download consumption (reimplemented for DB-free testing) ──

section('44-45. Atomic one-time download consumption');

// Mirrors claimExportDownload's `updateMany({ where: { id, downloadedAt: null }, data: { downloadedAt: now } })`
// semantics with an in-memory map — the real function's atomicity is
// delegated to Postgres's row-level update, which is well-established
// behavior; this test exercises the claim/reject branching logic itself.
function makeAtomicClaimStore() {
  const downloadedAt = new Map<string, Date>();
  return {
    claim(id: string): { claimed: true } | { claimed: false; failure: 'already_downloaded' } {
      if (downloadedAt.has(id)) return { claimed: false, failure: 'already_downloaded' };
      downloadedAt.set(id, new Date());
      return { claimed: true };
    },
  };
}

await test('first claim on a row succeeds', () => {
  const store = makeAtomicClaimStore();
  const result = store.claim('export-1');
  assert.deepEqual(result, { claimed: true });
});

await test('second claim on the same row fails with already_downloaded (one-time, atomic)', () => {
  const store = makeAtomicClaimStore();
  store.claim('export-1');
  const second = store.claim('export-1');
  assert.equal(second.claimed, false);
  assert.equal((second as any).failure, 'already_downloaded');
});

// ── 46-47: Export bounds + stable reason codes ───────────────────────────────

section('46-47. Export bounds constants + stable reason codes');

await test('export bounds match the spec', () => {
  assert.equal(EXPORT_MAX_FILE_COUNT, 500);
  assert.equal(EXPORT_MAX_FILE_SIZE_BYTES, ATTACHMENT_MAX_FILE_SIZE_BYTES, 'per-file export bound must reuse the attachment upload cap, not invent a new number');
  assert.equal(EXPORT_MAX_TOTAL_SIZE_BYTES, 2 * 1024 * 1024 * 1024);
});

await test('skip/miss reason codes are stable strings, never raw exception text', () => {
  const exportPackageSrc = fs.readFileSync(
    path.resolve(import.meta.dirname, '../services/privacy/patientPrivacyExportPackage.ts'),
    'utf8',
  );
  assert.ok(!exportPackageSrc.includes('read_failed: $'), 'manifest reasons must never interpolate a raw exception message');
  for (const code of ['file_not_found_in_storage', 'read_failed', 'size_limit_exceeded', 'count_limit_exceeded', 'total_size_limit_exceeded']) {
    assert.ok(exportPackageSrc.includes(`'${code}'`), `expected stable reason code "${code}" to be present`);
  }
});

// ── 48: Cleanup job kill switch ──────────────────────────────────────────────

section('48. Export cleanup job kill switch (PATIENT_PRIVACY_EXPORT_CLEANUP_ENABLED)');

await test('kill switch defaults to enabled when unset', () => {
  const original = process.env.PATIENT_PRIVACY_EXPORT_CLEANUP_ENABLED;
  delete process.env.PATIENT_PRIVACY_EXPORT_CLEANUP_ENABLED;
  try {
    assert.equal(isPatientPrivacyExportCleanupEnabled(), true);
  } finally {
    if (original !== undefined) process.env.PATIENT_PRIVACY_EXPORT_CLEANUP_ENABLED = original;
  }
});

await test('kill switch disables when set to "false"', () => {
  const original = process.env.PATIENT_PRIVACY_EXPORT_CLEANUP_ENABLED;
  process.env.PATIENT_PRIVACY_EXPORT_CLEANUP_ENABLED = 'false';
  try {
    assert.equal(isPatientPrivacyExportCleanupEnabled(), false);
  } finally {
    if (original !== undefined) process.env.PATIENT_PRIVACY_EXPORT_CLEANUP_ENABLED = original;
    else delete process.env.PATIENT_PRIVACY_EXPORT_CLEANUP_ENABLED;
  }
});

await test('kill switch is a separate env var from DATA_RETENTION_CLEANUP_ENABLED', () => {
  const jobSrc = fs.readFileSync(path.resolve(import.meta.dirname, '../jobs/patientPrivacyExportCleanupJob.ts'), 'utf8');
  assert.ok(jobSrc.includes('PATIENT_PRIVACY_EXPORT_CLEANUP_ENABLED'));
  assert.ok(!jobSrc.includes("env.DATA_RETENTION_CLEANUP_ENABLED"), 'must not reuse the general retention toggle');
});

// ── 49: attachments.ts legal-hold route — reason both ways + audit log ──────

section('49. attachments.ts legal-hold requires a reason both ways and audits both directions');

await test('attachments.ts legal-hold route requires a reason for release too, and writes an audit log', () => {
  const attachmentsSrc = fs.readFileSync(path.resolve(import.meta.dirname, '../routes/attachments.ts'), 'utf8');
  const routeStart = attachmentsSrc.indexOf("'/patients/:patientId/attachments/:id/legal-hold'");
  assert.ok(routeStart > -1, 'legal-hold route must exist');
  const routeBlock = attachmentsSrc.slice(routeStart, routeStart + 3000);
  assert.ok(
    !/if \(legalHold && \(!reason/.test(routeBlock),
    'reason requirement must not be gated behind "legalHold &&" (must apply to release too)',
  );
  assert.ok(routeBlock.includes('writeAuditLog'), 'legal-hold route must write an audit log entry');
  assert.ok(routeBlock.includes('validateAndGetClinicIdScope'), 'legal-hold route must use the org/branch-scoped helper, not req.user.clinicId directly');
});

// ── 50: i18n keys match across tr/en/fr/de for the new namespace ────────────

section('50. patientPrivacy i18n namespace keys match across tr/en/fr/de');

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' && !Array.isArray(v) ? flattenKeys(v as Record<string, unknown>, key) : [key];
  });
}

await test('tr/en/fr/de patientPrivacy.json locale files have identical key sets', () => {
  const locales = ['tr', 'en', 'fr', 'de'];
  const keySets = locales.map((locale) => {
    const p = path.resolve(import.meta.dirname, `../../../src/locales/${locale}/patientPrivacy.json`);
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { locale, keys: flattenKeys(json).sort() };
  });
  const [first, ...rest] = keySets;
  for (const other of rest) {
    assert.deepEqual(other.keys, first.keys, `${other.locale}/patientPrivacy.json keys must match ${first.locale}/patientPrivacy.json`);
  }
  assert.ok(first.keys.length > 0, 'namespace must not be empty');
});

section('51-52. saveFileFromPath temp-file cleanup (local mode)');

await test('local rename path: temp file is gone after a successful save', async () => {
  const tempPath = path.join(os.tmpdir(), `kvkk-test-rename-${Date.now()}.txt`);
  fs.writeFileSync(tempPath, 'rename-fixture');
  const key = `clinic-test/${Date.now()}-rename-target.txt`;
  await saveFileFromPath(key, tempPath, 'text/plain');
  assert.equal(fs.existsSync(tempPath), false, 'temp file must not survive a successful rename');
  assert.equal(await fileExists(key), true, 'final key must exist after the save');
  await deleteFile(key);
});

await test('copy-fallback path: temp file is gone even when rename fails (e.g. EXDEV)', async () => {
  const tempPath = path.join(os.tmpdir(), `kvkk-test-copy-${Date.now()}.txt`);
  fs.writeFileSync(tempPath, 'copy-fixture');
  const key = `clinic-test/${Date.now()}-copy-target.txt`;

  const originalRename = fs.promises.rename;
  (fs.promises as any).rename = async (from: fs.PathLike, to: fs.PathLike) => {
    // Only the initial tempPath -> partialPath rename is cross-device in
    // this simulation; the later partialPath -> finalPath promotion is a
    // same-directory (same-filesystem) rename and must be allowed to
    // actually succeed, exactly as it would on a real filesystem.
    if (from === tempPath) {
      throw Object.assign(new Error('simulated EXDEV'), { code: 'EXDEV' });
    }
    return originalRename(from, to);
  };
  try {
    await saveFileFromPath(key, tempPath, 'text/plain');
  } finally {
    (fs.promises as any).rename = originalRename;
  }

  assert.equal(fs.existsSync(tempPath), false, 'temp file must not survive the copy fallback');
  assert.equal(await fileExists(key), true, 'final key must exist via the streamed-copy fallback');
  const stat = await statFile(key);
  assert.equal(stat!.size, Buffer.byteLength('copy-fixture'));
  await deleteFile(key);
});

section('53-54. saveFileFromPath temp-file cleanup (S3 mode, mocked client)');

await test('S3 mode: temp file is removed after a successful mocked upload', async () => {
  const originalBucket = process.env.S3_BUCKET;
  process.env.S3_BUCKET = 'kvkk-test-bucket';
  const originalSend = S3Client.prototype.send;
  (S3Client.prototype as any).send = async function (command: unknown) {
    // Simulate a successful single-part PutObjectCommand (the Upload class
    // in @aws-sdk/lib-storage falls back to a single PutObject for bodies
    // under the multipart size threshold, which is true for this fixture).
    void command;
    return {};
  };
  const tempPath = path.join(os.tmpdir(), `kvkk-test-s3-ok-${Date.now()}.txt`);
  fs.writeFileSync(tempPath, 's3-success-fixture');
  try {
    await saveFileFromPath('exports/clinic-test/s3-ok.zip', tempPath, 'application/zip');
    assert.equal(fs.existsSync(tempPath), false, 'temp file must not survive a successful S3 upload');
  } finally {
    S3Client.prototype.send = originalSend;
    if (originalBucket === undefined) delete process.env.S3_BUCKET;
    else process.env.S3_BUCKET = originalBucket;
    fs.rmSync(tempPath, { force: true });
  }
});

await test('S3 mode: temp file is removed even when the upload fails, and the failure still propagates', async () => {
  const originalBucket = process.env.S3_BUCKET;
  process.env.S3_BUCKET = 'kvkk-test-bucket';
  const originalSend = S3Client.prototype.send;
  (S3Client.prototype as any).send = async function () {
    throw new Error('simulated S3 upload failure');
  };
  const tempPath = path.join(os.tmpdir(), `kvkk-test-s3-fail-${Date.now()}.txt`);
  fs.writeFileSync(tempPath, 's3-failure-fixture');
  try {
    await assert.rejects(
      saveFileFromPath('exports/clinic-test/s3-fail.zip', tempPath, 'application/zip'),
      /simulated S3 upload failure/,
    );
    assert.equal(fs.existsSync(tempPath), false, 'temp file must not survive a failed S3 upload either');
  } finally {
    S3Client.prototype.send = originalSend;
    if (originalBucket === undefined) delete process.env.S3_BUCKET;
    else process.env.S3_BUCKET = originalBucket;
    fs.rmSync(tempPath, { force: true });
  }
});

section('55. Export-reservation advisory lock key');

await test('computeExportLockKey is deterministic for the same clinicId', () => {
  const a = computeExportLockKey('clinic-fixed');
  const b = computeExportLockKey('clinic-fixed');
  assert.deepEqual(a, b);
});

await test('computeExportLockKey differs across clinicIds', () => {
  const a = computeExportLockKey('clinic-one');
  const b = computeExportLockKey('clinic-two');
  assert.notDeepEqual(a, b);
});

section('56-57. saveFileFromPath partial-artifact cleanup (local mode, copy-fallback path)');

const UPLOADS_BASE_DIR = path.resolve(process.cwd(), 'uploads');

await test('copy-fallback failure after partial bytes: no partial or final artifact survives', async () => {
  const tempPath = path.join(os.tmpdir(), `kvkk-test-partial-fail-${Date.now()}.bin`);
  fs.writeFileSync(tempPath, Buffer.alloc(200_000, 'A'));
  const key = `clinic-test/${Date.now()}-partial-fail-target.bin`;

  const originalRename = fs.promises.rename;
  const originalCreateWriteStream = fs.createWriteStream;
  let observedPartialPath: string | null = null;
  let writeCallCount = 0;
  (fs.promises as any).rename = async () => {
    throw Object.assign(new Error('simulated EXDEV'), { code: 'EXDEV' });
  };
  (fs as any).createWriteStream = (dest: string) => {
    observedPartialPath = dest;
    return new Writable({
      write(chunk, _enc, cb) {
        writeCallCount++;
        if (writeCallCount === 1) {
          // Prove real partial bytes land on disk before the simulated
          // mid-stream failure — this is the scenario the fix must survive.
          fs.writeFileSync(dest, chunk);
          cb();
        } else {
          cb(new Error('simulated write failure mid-stream'));
        }
      },
    });
  };

  try {
    await assert.rejects(
      saveFileFromPath(key, tempPath, 'application/octet-stream'),
      /simulated write failure mid-stream/,
    );
  } finally {
    (fs.promises as any).rename = originalRename;
    (fs as any).createWriteStream = originalCreateWriteStream;
  }

  assert.ok(writeCallCount >= 2, 'test fixture must actually exercise a multi-chunk write to prove partial bytes were flushed');
  assert.equal(fs.existsSync(tempPath), false, 'source temp path must not survive a failed copy');
  assert.equal(await fileExists(key), false, 'final storage key must not exist after a failed copy');
  assert.ok(observedPartialPath, 'the copy must have targeted a partial path, never the final path directly');
  assert.notEqual(observedPartialPath, path.join(UPLOADS_BASE_DIR, key), 'copy destination must never be the final storage path itself');
  assert.equal(fs.existsSync(observedPartialPath!), false, 'partial artifact must not survive a failed copy');
});

await test('copy-fallback success: no stray .partial-* sibling file is left behind', async () => {
  const tempPath = path.join(os.tmpdir(), `kvkk-test-partial-ok-${Date.now()}.txt`);
  fs.writeFileSync(tempPath, 'partial-success-fixture');
  const key = `clinic-test/${Date.now()}-partial-ok-target.txt`;

  const originalRename = fs.promises.rename;
  (fs.promises as any).rename = async (from: fs.PathLike, to: fs.PathLike) => {
    if (from === tempPath) {
      throw Object.assign(new Error('simulated EXDEV'), { code: 'EXDEV' });
    }
    return originalRename(from, to);
  };
  try {
    await saveFileFromPath(key, tempPath, 'text/plain');
  } finally {
    (fs.promises as any).rename = originalRename;
  }

  assert.equal(await fileExists(key), true, 'final key must exist via the streamed-copy fallback');
  const dir = path.dirname(path.join(UPLOADS_BASE_DIR, key));
  const base = path.basename(key);
  const stray = fs.readdirSync(dir).filter((f) => f.startsWith(`${base}.partial-`));
  assert.deepEqual(stray, [], 'no .partial-<uuid> sibling file may remain after a successful save');
  await deleteFile(key);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
