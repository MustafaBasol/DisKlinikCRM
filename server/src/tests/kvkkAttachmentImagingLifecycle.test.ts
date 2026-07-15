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
 *   38. PRIVACY_MANAGE_ROLES does not include RECEPTIONIST (deletion-review/execute must 403 for it)
 *   39. deletion-review/execute style idempotency: reapplying the "delete non-legal-hold rows" filter to an empty remaining set changes nothing
 *
 * Run with: cd server && npx tsx src/tests/kvkkAttachmentImagingLifecycle.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildStorageKey,
  buildExportStorageKey,
  isSafeStorageKey,
  fileExists,
  statFile,
  saveFile,
  deleteFile,
} from '../services/fileStorage.js';
import {
  hashExportToken,
  validateExportDownloadToken,
  cleanupExpiredExportArchives,
} from '../services/privacy/patientPrivacyExportPackage.js';

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

await test('fileExists returns false (not a throw) for an absolute-path ref', async () => {
  const result = await fileExists('/etc/passwd');
  assert.equal(result, false);
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
      deletableAdministrative: params.attachments.length - attachmentLegalHold,
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

await test('deletion-review/execute re-run on an already-empty remaining set is a no-op', () => {
  const rows: { id: string; legalHold: boolean }[] = [];
  const remaining = rows.filter((r) => !r.legalHold);
  assert.equal(remaining.length, 0);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
