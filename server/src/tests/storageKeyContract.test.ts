/**
 * storageKeyContract.test.ts — F4-1A authoritative storage-key contract.
 *
 * Covers:
 *  1.  buildObjectStorageKey emits the accepted per-class shapes, unchanged
 *      from the pre-F4-1A literals (this is a contract change, NOT a key
 *      migration — storage-key migration remains frozen, see
 *      docs/program/KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md §3 item 8)
 *  2.  Tenant segment is always present and is the first meaningful segment
 *  3.  Fail-closed validation of every server-derived segment (empty,
 *      separator, traversal, control character, drive-qualified)
 *  4.  No PII / original filename leaks into a key — only a normalized,
 *      whitelisted extension survives
 *  5.  Different tenants never produce colliding or cross-readable keys
 *  6.  Legacy persisted references keep resolving unchanged (no reconstruction)
 *  7.  buildStorageKey / buildExportStorageKey remain exact-shape compatible
 *      with their existing callers and locked assertions
 *
 * Run with: tsx src/tests/storageKeyContract.test.ts
 * No external test framework — uses node:assert/strict. Pure unit test: no DB,
 * no filesystem, no storage backend required.
 */

import assert from 'node:assert/strict';

import {
  buildObjectStorageKey,
  buildStorageKey,
  buildExportStorageKey,
  fileNameFromKey,
  isSafeStorageKey,
} from '../services/fileStorage.js';

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

/** Every server-derived segment value that must be rejected, whatever its role. */
const UNSAFE_SEGMENTS: Array<[string, string]> = [
  ['', 'empty string'],
  ['..', 'bare traversal'],
  ['.', 'bare dot'],
  ['../etc', 'relative traversal'],
  ['a/b', 'forward-slash separator'],
  ['a\\b', 'backslash separator'],
  ['/absolute', 'leading slash'],
  ['C:', 'drive prefix'],
  ['C:\\Windows', 'drive-absolute path'],
  ['clinic..1', 'embedded traversal'],
  ['clinic\u0000id', 'NUL byte'],
  ['clinic\u0001id', 'control character'],
];

const CONTENT_KINDS = ['patient-attachment', 'lab-attachment', 'imaging-image'] as const;

async function main() {
  // ── 1. Accepted per-class key shapes ──────────────────────────────────────
  section('1. Accepted forward key contract (shapes unchanged)');

  await test('content classes emit <clinicId>/<opaqueId><ext>', () => {
    for (const kind of CONTENT_KINDS) {
      const key = buildObjectStorageKey({ kind, clinicId: 'clinic-123', originalName: 'my file.PDF' });
      assert.match(
        key,
        /^clinic-123\/\d+-[a-z0-9]+\.pdf$/,
        `${kind} must emit <clinicId>/<epochMs>-<rand><ext> (got ${key})`,
      );
    }
  });

  await test('all three content classes share one key namespace (no domain segment)', () => {
    // Documented, deliberate: F4-1A did NOT introduce a <domain> prefix, because
    // that would reshape every persisted content key and is frozen work.
    for (const kind of CONTENT_KINDS) {
      const key = buildObjectStorageKey({ kind, clinicId: 'clinic-x', originalName: 'a.pdf' });
      assert.ok(key.startsWith('clinic-x/'), `${kind} key must start with the clinic segment (got ${key})`);
      assert.equal(key.split('/').length, 2, `${kind} key must have exactly two segments (got ${key})`);
    }
  });

  await test('export-archive emits exports/<clinicId>/<exportId>.zip', () => {
    const key = buildObjectStorageKey({ kind: 'export-archive', clinicId: 'clinic-abc', exportId: 'export-uuid-1' });
    assert.equal(key, 'exports/clinic-abc/export-uuid-1.zip');
  });

  await test('every emitted key satisfies isSafeStorageKey', () => {
    const keys = [
      ...CONTENT_KINDS.map((kind) => buildObjectStorageKey({ kind, clinicId: 'clinic-1', originalName: 'x.jpg' })),
      buildObjectStorageKey({ kind: 'export-archive', clinicId: 'clinic-1', exportId: 'e1' }),
    ];
    for (const key of keys) {
      assert.equal(isSafeStorageKey(key), true, `emitted key must pass the lookup gate (got ${key})`);
    }
  });

  // ── 2. Tenant segment ─────────────────────────────────────────────────────
  section('2. Tenant scoping');

  await test('different clinics never produce the same key prefix', () => {
    const a = buildObjectStorageKey({ kind: 'imaging-image', clinicId: 'clinic-a', originalName: 'scan.jpg' });
    const b = buildObjectStorageKey({ kind: 'imaging-image', clinicId: 'clinic-b', originalName: 'scan.jpg' });
    assert.ok(a.startsWith('clinic-a/'));
    assert.ok(b.startsWith('clinic-b/'));
    assert.notEqual(a.split('/')[0], b.split('/')[0], 'tenant segments must differ');
  });

  await test('a clinic key can never address another clinic (no traversal escape)', () => {
    // The only client-influenced fragment is the extension; it cannot reach the
    // tenant segment. Attempting to smuggle a tenant hop via originalName fails.
    const key = buildObjectStorageKey({
      kind: 'patient-attachment',
      clinicId: 'clinic-a',
      originalName: '../../clinic-b/steal.pdf',
    });
    assert.ok(key.startsWith('clinic-a/'), `key must stay under its own tenant (got ${key})`);
    assert.ok(!key.includes('..'), `key must not contain traversal (got ${key})`);
    assert.ok(!key.includes('clinic-b'), `key must not reference another tenant (got ${key})`);
    assert.equal(key.split('/').length, 2, 'originalName must not add path segments');
  });

  await test('export keys stay under exports/<clinicId>/ for their own tenant only', () => {
    const key = buildObjectStorageKey({ kind: 'export-archive', clinicId: 'clinic-a', exportId: 'e-1' });
    assert.ok(key.startsWith('exports/clinic-a/'));
    assert.equal(key.split('/').length, 3);
  });

  // ── 3. Fail-closed segment validation ─────────────────────────────────────
  section('3. Fail-closed validation of server-derived segments');

  for (const [value, label] of UNSAFE_SEGMENTS) {
    await test(`clinicId rejected: ${label}`, () => {
      assert.throws(
        () => buildObjectStorageKey({ kind: 'patient-attachment', clinicId: value, originalName: 'a.pdf' }),
        /Invalid storage key segment: clinicId/,
        `clinicId ${JSON.stringify(value)} must be rejected`,
      );
    });
  }

  for (const [value, label] of UNSAFE_SEGMENTS) {
    await test(`exportId rejected: ${label}`, () => {
      assert.throws(
        () => buildObjectStorageKey({ kind: 'export-archive', clinicId: 'clinic-1', exportId: value }),
        /Invalid storage key segment: exportId/,
        `exportId ${JSON.stringify(value)} must be rejected`,
      );
    });
  }

  await test('regression: empty clinicId no longer yields an absolute-looking key', () => {
    // Before F4-1A this returned "/<epochMs>-<rand>.pdf", which resolveLocalPath()
    // would have treated as an ABSOLUTE path and written outside the upload root.
    assert.throws(() => buildStorageKey('', 'a.pdf'), /Invalid storage key segment: clinicId/);
  });

  // ── 4. No PII in keys ─────────────────────────────────────────────────────
  section('4. PII / original filename must never reach a key');

  await test('patient-identifying filename never appears in the key', () => {
    const originalName = 'Ayse Yilmaz 12345678901 0532 555 4433 ayse@example.com rapor.pdf';
    const key = buildObjectStorageKey({ kind: 'patient-attachment', clinicId: 'clinic-1', originalName });
    for (const secret of ['Ayse', 'ayse', 'Yilmaz', 'yilmaz', '12345678901', '0532', '5554433', 'example.com', 'rapor']) {
      assert.ok(!key.includes(secret), `key must not embed "${secret}" (got ${key})`);
    }
    assert.ok(key.endsWith('.pdf'), 'only the normalized extension survives');
  });

  await test('fileNameFromKey (persisted fileName column) is likewise PII-free', () => {
    const key = buildObjectStorageKey({
      kind: 'imaging-image',
      clinicId: 'clinic-1',
      originalName: 'Mehmet Demir panoramik.JPG',
    });
    const fileName = fileNameFromKey(key);
    assert.ok(!fileName.includes('Mehmet'), `fileName must not embed patient name (got ${fileName})`);
    assert.ok(!fileName.includes('Demir'), `fileName must not embed patient name (got ${fileName})`);
    assert.match(fileName, /^\d+-[a-z0-9]+\.jpg$/, `unexpected fileName shape (got ${fileName})`);
  });

  await test('extension is lowercased and whitelisted; anything else is dropped', () => {
    const cases: Array<[string, string]> = [
      ['report.PDF', '.pdf'],
      ['scan.JpG', '.jpg'],
      ['archive.zip', '.zip'],
      ['noextension', ''],
      ['trailingdot.', ''],
      ['weird.a-b', ''],
      ['weird.exceedinglylongext', ''],
      ['spaced. pdf', ''],
    ];
    for (const [originalName, expectedExt] of cases) {
      const key = buildObjectStorageKey({ kind: 'patient-attachment', clinicId: 'clinic-1', originalName });
      const actualExt = key.slice(key.lastIndexOf('/') + 1).replace(/^\d+-[a-z0-9]+/, '');
      assert.equal(actualExt, expectedExt, `extension for ${JSON.stringify(originalName)} (got key ${key})`);
    }
  });

  // ── 5. Determinism / uniqueness ───────────────────────────────────────────
  section('5. Opaque-id behaviour');

  await test('repeated calls never collide', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(buildObjectStorageKey({ kind: 'patient-attachment', clinicId: 'clinic-1', originalName: 'a.pdf' }));
    }
    assert.equal(seen.size, 500, 'every generated key must be unique');
  });

  await test('export keys ARE deterministic for the same exportId (idempotent replan)', () => {
    const a = buildExportStorageKey('clinic-1', 'export-9');
    const b = buildExportStorageKey('clinic-1', 'export-9');
    assert.equal(a, b, 'export key must be a pure function of (clinicId, exportId)');
  });

  // ── 6. Backward compatibility ─────────────────────────────────────────────
  section('6. Backward compatibility with already-persisted references');

  await test('pre-F4-1A key shapes still pass the lookup gate unchanged', () => {
    // Values in these shapes exist in production DB rows today. Nothing in the
    // codebase reconstructs a key — reads pass the persisted column verbatim —
    // so these must keep resolving through the same path after F4-1A.
    const legacyKeys = [
      'clinic-1/1699999999-abc123.pdf',
      'exports/clinic-1/uuid.zip',
      'clinic-1/1755123456789-k3x9q2.jpg',
      'file-backups/imaging/clinic-1/rec-1.bin',
      'file-backups/manifests/run-1.json',
    ];
    for (const key of legacyKeys) {
      assert.equal(isSafeStorageKey(key), true, `legacy key must remain resolvable (got ${key})`);
    }
  });

  await test('legacy absolute paths are still rejected by the KVKK lookup gate (unchanged)', () => {
    assert.equal(isSafeStorageKey('/var/www/noramedi/server/uploads/old.pdf'), false);
  });

  // ── 7. Façade compatibility ───────────────────────────────────────────────
  section('7. Existing façades delegate without shape drift');

  await test('buildStorageKey output is identical in shape to the content contract', () => {
    const key = buildStorageKey('clinic-123', 'my file.PDF');
    assert.ok(!key.includes('..'), `key must not contain ".." (got ${key})`);
    assert.ok(key.startsWith('clinic-123/'), `key must start with clinicId segment (got ${key})`);
    assert.ok(key.endsWith('.pdf'), 'extension is lowercased and preserved');
    assert.match(key, /^clinic-123\/\d+-[a-z0-9]+\.pdf$/);
  });

  await test('buildExportStorageKey preserves its locked exact string', () => {
    // Mirrors the assertion locked in kvkkAttachmentImagingLifecycle.test.ts.
    assert.equal(buildExportStorageKey('clinic-abc', 'export-uuid-1'), 'exports/clinic-abc/export-uuid-1.zip');
  });

  // ── Result ────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
