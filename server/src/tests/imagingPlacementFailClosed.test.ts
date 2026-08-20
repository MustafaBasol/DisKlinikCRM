/**
 * imagingPlacementFailClosed.test.ts — F4-IMAGING-001-R6, ARCHITECTURE REVIEW
 * FIX (PR #464).
 *
 * WHAT THIS PINS
 * --------------
 * R6's whole point is that an imaging object's PHYSICAL PLACEMENT is a
 * historical fact recorded on its own row (`ImagingImage.storageBackend`,
 * interpreted by `resolveImagingStoragePlacement`), never re-derived from the
 * global `IMAGING_STORAGE_BACKEND` flag. The invariant that gives that fact
 * its value is:
 *
 *     for one and the same object, read / exists / delete must agree about
 *     WHICH BACKEND is authoritative — or all of them must refuse.
 *
 * The reviewed head a5885819 broke that invariant in one specific corner. The
 * read and exists wrappers were written as
 *
 *     if (placement === 'vps2' && isSafeStorageKey(ref)) { ...VPS2... }
 *     return openFileStream(ref);          // <- legacy, for EVERY other case
 *
 * so an object whose row explicitly says `'vps2'` but whose `filePath` cannot
 * be an object-storage key (an absolute legacy path, a UNC/drive path, a
 * traversal segment, a control character) silently fell through to LEGACY
 * storage — while `deleteImagingFile(ref, 'vps2')` still routed the delete to
 * VPS2. Read said legacy, exists said legacy, delete said VPS2. For regulated
 * imaging data that is strictly worse than an outage. The read hands back whatever
 * unrelated bytes happen to sit at that local path, as if they were the VPS2
 * object. The existence probe answers from legacy too: because `fileExists()`
 * has always refused a non-key ref outright, it returns a definitive `false`
 * — a LEGACY-DERIVED "this object is confirmed gone" for a row that says the
 * bytes are on VPS2, which is exactly what makes the orphan sweep stamp
 * `storageVerifiedMissingAt` on a healthy VPS2 row. Neither answer is a claim
 * this process is entitled to make.
 *
 * The fix makes all three paths FAIL CLOSED on that combination
 * (`ImagingPlacementRefMismatchError`), touching no legacy fallback at all.
 *
 * EXPECTED ERROR SEMANTICS (documented here because the tests below assert
 * exactly this, nothing looser):
 *   - name    : 'ImagingPlacementRefMismatchError'
 *   - code    : 'IMAGING_PLACEMENT_REF_MISMATCH'  (what safeErrorFields() and
 *               the file-backup ledger persist)
 *   - message : the fixed literal
 *               'Imaging object placement and storage reference are inconsistent.'
 *   - carries NO ref/key, NO bucket, NO endpoint, NO credential, NO patient
 *     data — neither in the message nor in anything logged at the throw site.
 *   - it is a THROW, never a `null` return and never a `false` return: "I
 *     cannot tell where these bytes are" must not be indistinguishable from
 *     "this object is genuinely gone".
 *
 * PURE UNIT. No database, no MinIO, no network: every fail-closed assertion
 * here short-circuits before any S3 client is constructed, and the legacy side
 * uses a disposable os.tmpdir() file. Absolute paths are used deliberately —
 * they are exactly the shape of a real pre-key-era `ImagingImage.filePath`.
 *
 * Run: cd server && npx tsx src/tests/imagingPlacementFailClosed.test.ts
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

import {
  isSafeStorageKey,
  openImagingFileStream,
  imagingFileExists,
  deleteImagingFile,
  ImagingPlacementRefMismatchError,
} from '../services/fileStorage.js';
import {
  resolveImagingStoragePlacement,
  __resetImagingS3ClientForTest,
} from '../services/imagingRemoteStorage.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  \u2713 ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  \u2717 ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * Every env var that could move a legacy read off local disk or construct an
 * imaging S3 client. Cleared for the whole suite so "legacy" unambiguously
 * means "local disk" and so a fail-closed assertion cannot be satisfied by an
 * unrelated configuration error.
 */
const TOUCHED_ENV_VARS = [
  'IMAGING_STORAGE_BACKEND',
  'IMAGING_S3_BUCKET',
  'IMAGING_S3_ENDPOINT',
  'IMAGING_S3_REGION',
  'IMAGING_S3_ACCESS_KEY_ID',
  'IMAGING_S3_SECRET_ACCESS_KEY',
  'IMAGING_S3_SSE',
  'IMAGING_S3_FORCE_PATH_STYLE',
  'IMAGING_S3_ALLOW_INSECURE_ENDPOINT',
  'S3_BUCKET',
  'S3_ENDPOINT',
  'S3_REGION',
  'NODE_ENV',
];

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const key of TOUCHED_ENV_VARS) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const key of TOUCHED_ENV_VARS) {
    if (snap[key] === undefined) delete process.env[key];
    else process.env[key] = snap[key];
  }
  __resetImagingS3ClientForTest();
}

/**
 * Counts real legacy-storage touches.
 *
 * `fileStorage.ts` does `import fs from 'fs'` and calls `fs.existsSync(...)` /
 * `fs.createReadStream(...)` / `fs.promises.unlink(...)` as PROPERTY LOOKUPS on
 * that shared builtin object, so swapping the properties here is observed by
 * the module under test. This is what turns "the fail-closed call rejected"
 * into the stronger claim the review actually asked for: it never touched
 * legacy storage at all. Section 1's legacy tests double as the positive
 * control that the counters are wired up — a spy that never fires would make
 * a zero count meaningless.
 */
type LegacyProbe = { exists: number; read: number; unlink: number };

async function withLegacySpy<T>(fn: (probe: LegacyProbe) => Promise<T>): Promise<T> {
  const probe: LegacyProbe = { exists: 0, read: 0, unlink: 0 };
  const realExistsSync = fs.existsSync;
  const realCreateReadStream = fs.createReadStream;
  const realUnlink = fs.promises.unlink;
  (fs as any).existsSync = (...args: any[]) => { probe.exists++; return (realExistsSync as any)(...args); };
  (fs as any).createReadStream = (...args: any[]) => { probe.read++; return (realCreateReadStream as any)(...args); };
  (fs.promises as any).unlink = (...args: any[]) => { probe.unlink++; return (realUnlink as any)(...args); };
  try {
    return await fn(probe);
  } finally {
    (fs as any).existsSync = realExistsSync;
    (fs as any).createReadStream = realCreateReadStream;
    (fs.promises as any).unlink = realUnlink;
  }
}

/** Asserts the exact documented fail-closed error, and nothing looser. */
function assertPlacementRefMismatch(err: unknown, ref: string): void {
  assert.ok(
    err instanceof ImagingPlacementRefMismatchError,
    `expected ImagingPlacementRefMismatchError, got ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
  );
  const e = err as ImagingPlacementRefMismatchError;
  assert.equal(e.name, 'ImagingPlacementRefMismatchError');
  assert.equal(e.code, 'IMAGING_PLACEMENT_REF_MISMATCH');
  assert.equal(e.message, 'Imaging object placement and storage reference are inconsistent.');
  // Never leaks the storage reference itself (KVKK log/error hygiene — the
  // same discipline as ExportTempStorageUnsafeError and safeError.ts).
  assert.equal(e.message.includes(ref), false, 'the error message must not carry the storage reference');
}

/** Captures console.error for the duration of `fn` so the throw-site log line can be inspected. */
async function captureConsoleError<T>(fn: () => Promise<T>): Promise<{ result: T | undefined; thrown: unknown; lines: string[] }> {
  const lines: string[] = [];
  const real = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map((a) => String(a)).join(' ')); };
  try {
    const result = await fn();
    return { result, thrown: undefined, lines };
  } catch (thrown) {
    return { result: undefined, thrown, lines };
  } finally {
    console.error = real;
  }
}

async function main() {
  const baseSnapshot = snapshotEnv();
  for (const key of TOUCHED_ENV_VARS) delete process.env[key];
  __resetImagingS3ClientForTest();

  // A real legacy object at a real ABSOLUTE path — the exact shape of a
  // pre-key-era ImagingImage.filePath. The bytes really are on disk, so a
  // fall-through to legacy would visibly SUCCEED rather than merely 404.
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'r6-placement-'));
  const legacyAbsPath = path.join(tmpDir, 'legacy-image.dcm');
  const legacyBytes = crypto.randomBytes(4096);
  await fsp.writeFile(legacyAbsPath, legacyBytes);

  try {
    // ── 1. Legacy placement is UNCHANGED (C and D from the review) ─────────
    section('1. Explicit legacy and pre-R6 NULL keep reading old absolute paths');

    await test('the fixture really is an unsafe object-storage key and a real on-disk file (otherwise the rest of this suite proves nothing)', () => {
      assert.equal(isSafeStorageKey(legacyAbsPath), false, 'an absolute path must not be a valid object-storage key');
      assert.equal(fs.existsSync(legacyAbsPath), true);
      assert.equal(fs.readFileSync(legacyAbsPath).equals(legacyBytes), true);
    });

    await test('C: explicit legacy placement + the same absolute path still reads the real legacy bytes', async () => {
      await withLegacySpy(async (probe) => {
        const stream = await openImagingFileStream(legacyAbsPath, 'legacy');
        assert.ok(stream, 'explicit legacy placement must still open a pre-key-era absolute path');
        const got = await readStreamToBuffer(stream);
        assert.equal(got.equals(legacyBytes), true, 'legacy read must return the exact bytes on disk');
        // Positive control for the spy used by section 2's negative claims.
        assert.ok(probe.read >= 1, 'the legacy spy must observe a real local read here');
      });
    });

    await test('C: explicit legacy placement keeps the PRE-EXISTING fileExists contract for an absolute path — returns false, never throws', async () => {
      await withLegacySpy(async (probe) => {
        // Not a behavior this fix introduces or changes: `fileExists()` has
        // required an object key since the KVKK-lifecycle work (see its own
        // docstring and `isSafeStorageKey`), so a pre-key-era ABSOLUTE path
        // has always answered a plain `false` here without touching disk.
        // What matters for the review is the SHAPE of the answer: legacy
        // placement RETURNS, it does not fail closed — identical to a5885819.
        assert.equal(await imagingFileExists(legacyAbsPath, 'legacy'), false);
        assert.equal(probe.exists, 0, 'the key gate answers before local disk is consulted');

        // Positive control for the exists counter used by section 2's negative
        // claims: a real object key DOES reach fs.existsSync, so a zero count
        // there is meaningful rather than a spy that never fires.
        assert.equal(await imagingFileExists('clinic-1/imaging/definitely-absent.dcm', 'legacy'), false);
        assert.ok(probe.exists >= 1, 'the legacy spy must observe a real local existsSync for a valid key');
      });
    });

    await test('D: a pre-R6 NULL row resolves to legacy and its absolute path stays readable', async () => {
      assert.equal(resolveImagingStoragePlacement(null), 'legacy');
      assert.equal(resolveImagingStoragePlacement(undefined), 'legacy');
      assert.equal(resolveImagingStoragePlacement(''), 'legacy');
      assert.equal(resolveImagingStoragePlacement('   '), 'legacy');
      const stream = await openImagingFileStream(legacyAbsPath, resolveImagingStoragePlacement(null));
      assert.ok(stream, 'a pre-R6 row must still read');
      assert.equal((await readStreamToBuffer(stream)).equals(legacyBytes), true);
      // Same pre-existing fileExists key gate as the test above: a RETURN, not
      // a fail-closed throw. A pre-R6 row is never refused.
      assert.equal(await imagingFileExists(legacyAbsPath, resolveImagingStoragePlacement(null)), false);
    });

    await test('the omitted-placement compatibility seam is untouched: it still reads the absolute path from legacy', async () => {
      const stream = await openImagingFileStream(legacyAbsPath);
      assert.ok(stream, 'the no-placement seam must keep its exact pre-R6 behavior');
      assert.equal((await readStreamToBuffer(stream)).equals(legacyBytes), true);
      assert.equal(await imagingFileExists(legacyAbsPath), false, 'unchanged pre-R6 fileExists key gate — a return, never a throw');
    });

    // ── 2. Explicit VPS2 + unusable ref FAILS CLOSED (A, B) ────────────────
    section('2. Explicit vps2 placement + a ref that cannot be an object key FAILS CLOSED');

    await test('A: openImagingFileStream(absolutePath, "vps2") throws and NEVER returns the legacy bytes', async () => {
      await withLegacySpy(async (probe) => {
        let thrown: unknown;
        let returned: unknown;
        try {
          returned = await openImagingFileStream(legacyAbsPath, 'vps2');
        } catch (err) {
          thrown = err;
        }
        assert.equal(returned, undefined, 'it must not return a stream at all — not the legacy bytes, not null');
        assertPlacementRefMismatch(thrown, legacyAbsPath);
        assert.equal(probe.read, 0, 'it must not call openFileStream / fs.createReadStream');
        assert.equal(probe.exists, 0, 'it must not probe local disk at all');
      });
    });

    await test('B: imagingFileExists(absolutePath, "vps2") throws — never a legacy-derived true OR false', async () => {
      await withLegacySpy(async (probe) => {
        let thrown: unknown;
        let returned: unknown;
        try {
          returned = await imagingFileExists(legacyAbsPath, 'vps2');
        } catch (err) {
          thrown = err;
        }
        // a5885819 returned `false` here — legacy's "confirmed absent" applied
        // to an object the row says lives on VPS2. Both a legacy `true` and a
        // legacy `false` are answers this process cannot justify, so the only
        // correct outcome is a refusal.
        assert.equal(returned, undefined, 'it must not return true, and must not return false either');
        assertPlacementRefMismatch(thrown, legacyAbsPath);
        assert.equal(probe.exists, 0, 'it must not call fileExists / fs.existsSync');
      });
    });

    await test('every unusable ref shape fails closed the same way, on both read and exists', async () => {
      const unusableRefs = [
        legacyAbsPath,
        '/var/lib/diskliniks/uploads/clinic-1/img.dcm',
        'C:\\ProgramData\\diskliniks\\img.dcm',
        '\\\\fileserver\\share\\img.dcm',
        'clinic-1/../../../etc/passwd',
        'clinic-1/img\u0000.dcm',
      ];
      for (const ref of unusableRefs) {
        assert.equal(isSafeStorageKey(ref), false, `${JSON.stringify(ref)} must be an unusable object key`);
        await assert.rejects(
          () => openImagingFileStream(ref, 'vps2'),
          (err: unknown) => { assertPlacementRefMismatch(err, ref); return true; },
          `read must fail closed for ${JSON.stringify(ref)}`,
        );
        await assert.rejects(
          () => imagingFileExists(ref, 'vps2'),
          (err: unknown) => { assertPlacementRefMismatch(err, ref); return true; },
          `exists must fail closed for ${JSON.stringify(ref)}`,
        );
      }
    });

    await test('the guard is not over-broad: explicit vps2 + a VALID object key still routes to the VPS2 provider', async () => {
      // With no IMAGING_S3_* configuration the provider call cannot succeed —
      // but it must fail as a PROVIDER/CONFIG error, never as the placement
      // mismatch. That is what proves a safe key was handed to VPS2 rather
      // than refused by the new gate (or, worse, sent to legacy).
      const safeKey = 'clinic-1/imaging/2026/abc.dcm';
      assert.equal(isSafeStorageKey(safeKey), true);
      await assert.rejects(
        () => openImagingFileStream(safeKey, 'vps2'),
        (err: unknown) => {
          assert.equal(err instanceof ImagingPlacementRefMismatchError, false, 'a valid key must not hit the fail-closed gate');
          assert.ok(err instanceof Error);
          assert.match((err as Error).message, /IMAGING_S3_ENDPOINT/, 'it must have reached the VPS2 provider');
          return true;
        },
      );
    });

    // ── 3. Read / exists / delete cannot disagree (E) ──────────────────────
    section('3. Read, exists and delete agree — all three refuse for the same object');

    await test('E: delete does NOT route an explicitly-vps2 unusable ref to VPS2 while read/exists refuse', async () => {
      await withLegacySpy(async (probe) => {
        await assert.rejects(
          () => deleteImagingFile(legacyAbsPath, 'vps2'),
          (err: unknown) => { assertPlacementRefMismatch(err, legacyAbsPath); return true; },
          'delete must fail closed on the same combination read/exists refuse',
        );
        assert.equal(probe.unlink, 0, 'and it must not delete the legacy file either');
      });
      assert.equal(fs.existsSync(legacyAbsPath), true, 'the legacy object must still be on disk');
      assert.equal(fs.readFileSync(legacyAbsPath).equals(legacyBytes), true, 'and byte-identical');
    });

    await test('E: the full read/exists/delete matrix for one object — never {read: legacy, exists: legacy, delete: vps2}', async () => {
      const outcome = async (fn: () => Promise<unknown>) => {
        try {
          const value = await fn();
          return { kind: 'returned' as const, value };
        } catch (err) {
          return { kind: 'threw' as const, err };
        }
      };
      const read = await outcome(() => openImagingFileStream(legacyAbsPath, 'vps2'));
      const exists = await outcome(() => imagingFileExists(legacyAbsPath, 'vps2'));
      const del = await outcome(() => deleteImagingFile(legacyAbsPath, 'vps2'));

      for (const [label, o] of [['read', read], ['exists', exists], ['delete', del]] as const) {
        assert.equal(o.kind, 'threw', `${label} must refuse, not resolve`);
        assertPlacementRefMismatch((o as { err: unknown }).err, legacyAbsPath);
      }
      // Stated the way the review stated it: the three answers are identical,
      // so no pair of them can name different backends.
      const codes = [read, exists, del].map((o) => ((o as { err: any }).err?.code));
      assert.deepEqual(codes, [
        'IMAGING_PLACEMENT_REF_MISMATCH',
        'IMAGING_PLACEMENT_REF_MISMATCH',
        'IMAGING_PLACEMENT_REF_MISMATCH',
      ]);
    });

    // ── 4. The refusal leaks nothing ──────────────────────────────────────
    section('4. The refusal leaks no storage key, endpoint, credential or patient data');

    await test('neither the thrown error nor anything logged at the throw site carries the ref', async () => {
      const captured = await captureConsoleError(() => openImagingFileStream(legacyAbsPath, 'vps2'));
      assertPlacementRefMismatch(captured.thrown, legacyAbsPath);
      const logged = captured.lines.join('\n');
      assert.ok(logged.includes('IMAGING_PLACEMENT_REF_MISMATCH'), 'the stable code must be the log signal');
      for (const secret of [legacyAbsPath, path.basename(legacyAbsPath), tmpDir]) {
        assert.equal(logged.includes(secret), false, `the log line must not contain ${JSON.stringify(secret)}`);
      }
      for (const forbidden of ['bucket', 'Bucket', 'endpoint', 'Endpoint', 'accessKey', 'secret', 'AccessKeyId']) {
        assert.equal(logged.includes(forbidden), false, `the log line must not contain ${JSON.stringify(forbidden)}`);
      }
    });

    await test('the error type is a fixed-literal, sanitized class — no template interpolation of caller input', () => {
      const a = new ImagingPlacementRefMismatchError();
      const b = new ImagingPlacementRefMismatchError();
      assert.equal(a.message, b.message, 'the message is a constant, so it cannot embed a ref');
      assert.equal(a.code, 'IMAGING_PLACEMENT_REF_MISMATCH');
      assert.equal(a instanceof Error, true);
    });
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
    restoreEnv(baseSnapshot);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
