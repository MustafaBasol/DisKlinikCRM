/**
 * imagingStoragePlacementCallSites.test.ts — F4-IMAGING-001-R6.
 *
 * Structural (source-scan) guard for the one property that end-to-end tests
 * cannot easily prove exhaustively: that NO production path which operates on
 * an EXISTING imaging object still chooses its backend from the global
 * `IMAGING_STORAGE_BACKEND` flag.
 *
 * Why this file exists at all. `openImagingFileStream`/`imagingFileExists`
 * keep a documented `placement`-omitted overload, which retains the pre-R6
 * flag-driven behavior for callers that genuinely have no row context. That
 * overload is the compatibility seam that keeps the storage-level unit tests
 * meaningful — and it is also exactly the footgun a future change could fall
 * into by forgetting to thread the row's placement through. A behavioral test
 * can prove that the paths it exercises are correct; only a scan can prove
 * that no OTHER path was left behind. Fixing only the happy-path download and
 * leaving delete/exists/backup on global routing is the specific failure this
 * guards against.
 *
 * Same technique and spirit as imaging.test.ts's route-source assertions and
 * fileBackupImagingOpsPortMigration.test.ts's boundary assertions — no DB, no
 * network, no storage backend required. CI Layer 2.
 *
 * Run: cd server && npx tsx src/tests/imagingStoragePlacementCallSites.test.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

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

const SERVER_SRC = path.resolve(import.meta.dirname, '..');
/**
 * Extracts one Prisma `model X { ... }` block.
 *
 * Line-ending tolerant on purpose: this repository is developed on Windows and
 * Git materializes schema.prisma with CRLF there while CI checks it out with
 * LF. An `indexOf` anchor containing a bare "\n}\n" silently returns -1 under
 * CRLF, and `slice(start, -1)` then hands back almost the entire file — which
 * makes "this model contains X" assertions pass vacuously and "this model's
 * index set is exactly Y" assertions fail with every index in the schema.
 * Both were observed here.
 */
function extractPrismaModelBlock(schemaSrc: string, modelName: string): string {
  const start = schemaSrc.indexOf(`model ${modelName} `);
  assert.ok(start > -1, `model ${modelName} must exist in schema.prisma`);
  const rest = schemaSrc.slice(start);
  const end = rest.search(/\r?\n\}\r?\n/);
  assert.ok(end > -1, `model ${modelName} must have a closing brace`);
  return rest.slice(0, end);
}

const read = (rel: string) => fs.readFileSync(path.join(SERVER_SRC, rel), 'utf8');

/** Strip line and block comments so a doc comment can never satisfy a code assertion. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

async function main() {
  section('1. Every production caller that operates on an EXISTING imaging object passes that object\'s recorded placement');

  await test('routes/imaging.ts streams bytes using the row\'s own placement, not the global flag', () => {
    const src = stripComments(read('routes/imaging.ts'));
    assert.ok(
      /openImagingFileStream\(\s*image\.filePath,\s*resolveImagingStoragePlacement\(image\.storageBackend\),?\s*\)/.test(src),
      'streamStudyImage must call openImagingFileStream(image.filePath, resolveImagingStoragePlacement(image.storageBackend))',
    );
    // No bare, placement-less imaging read may remain in the route.
    const bareCalls = src.match(/openImagingFileStream\(\s*image\.filePath\s*\)/g) ?? [];
    assert.deepEqual(bareCalls, [], 'no placement-less imaging read may remain in routes/imaging.ts');
  });

  await test('services/imaging/public.ts checks existence using the row\'s own placement', () => {
    const src = stripComments(read('services/imaging/public.ts'));
    assert.ok(
      /storageExistenceChecker\(\s*image\.filePath,\s*resolveImagingStoragePlacement\(image\.storageBackend\),?\s*\)/.test(src),
      'checkImageStorageExists must pass the resolved per-object placement to the existence checker',
    );
    assert.ok(
      /storageBackend:\s*true/.test(src),
      'findOwnedImage must select storageBackend, otherwise the placement above is always undefined',
    );
  });

  await test('services/fileBackupService.ts opens imaging sources using each row\'s placement', () => {
    const src = stripComments(read('services/fileBackupService.ts'));
    assert.ok(
      /openSource:\s*\(row\)\s*=>\s*openImagingFileStream\(row\.filePath,\s*resolveImagingStoragePlacement\(row\.storageBackend\)\)/.test(src),
      'the ImagingImage SOURCE_MODELS entry must open bytes with the row\'s own placement',
    );
    assert.ok(
      /storageBackend:\s*row\.storageBackend/.test(src),
      'the imaging row generator must forward the placement column supplied by imaging/ops.ts',
    );
    // Blast radius: the interpreter fails closed, and enumeration runs OUTSIDE
    // the sweep's per-row try/catch. Resolving during enumeration would turn
    // one unclassifiable row into an aborted sweep.
    const generatorStart = src.indexOf('async function* iterateImagingRowsForBackup');
    assert.ok(generatorStart > -1, 'the imaging row generator must exist');
    const generatorBody = src.slice(generatorStart, src.indexOf('\n}', generatorStart));
    assert.equal(
      generatorBody.includes('resolveImagingStoragePlacement'),
      false,
      'placement must be interpreted at the point of use in SOURCE_MODELS, not during row enumeration (enumeration runs outside the per-row try/catch)',
    );
    // The two attachment classes must remain on the generic, non-imaging
    // reader — they are not part of imaging storage routing at all.
    assert.ok(
      /name:\s*'PatientAttachment'[\s\S]{0,300}?openSource:\s*\(row\)\s*=>\s*openFileStream\(row\.filePath\)/.test(src),
      'PatientAttachment must keep using the generic openFileStream',
    );
    assert.ok(
      /name:\s*'LabOrderAttachment'[\s\S]{0,300}?openSource:\s*\(row\)\s*=>\s*openFileStream\(row\.filePath\)/.test(src),
      'LabOrderAttachment must keep using the generic openFileStream',
    );
  });

  await test('services/imaging/ops.ts resolves and exposes placement for the backup sweep', () => {
    const src = stripComments(read('services/imaging/ops.ts'));
    assert.ok(/storageBackend:\s*true/.test(src), 'listImagesForBackup must select the placement column');
    assert.ok(
      /storageBackend:\s*row\.storageBackend/.test(src),
      'the DTO must carry the raw persisted column verbatim',
    );
    // Interpretation deliberately does NOT happen here — see the DTO comment
    // in ops.ts and the blast-radius assertion above.
    assert.equal(
      src.includes('resolveImagingStoragePlacement'),
      false,
      'ops.ts must not interpret the placement during enumeration — that runs outside the backup sweep\'s per-row catch',
    );
    assert.equal(
      /clinicId\s*[?:]/.test(src.slice(src.indexOf('export async function listImagesForBackup'), src.indexOf('export async function listImagesForBackup') + 260)),
      false,
      'listImagesForBackup must remain globally scoped — adding a clinicId parameter would silently narrow backup coverage',
    );
  });

  await test('services/imaging/imagingIngestCore.ts compensates the delete against the backend that actually accepted the bytes', () => {
    const src = stripComments(read('services/imaging/imagingIngestCore.ts'));
    assert.ok(
      /deleteImagingFile\(storageKey,\s*storagePlacement\)/.test(src),
      'the rollback compensation must target the paired write\'s actual backend, never a fresh flag read',
    );
    const bareDeletes = src.match(/deleteImagingFile\(\s*storageKey\s*\)/g) ?? [];
    assert.deepEqual(bareDeletes, [], 'no placement-less imaging delete may remain in the ingest core');
  });

  section('2. No production module re-implements backend selection outside fileStorage.ts');

  await test('no route/service other than fileStorage.ts branches on isImagingRemoteStorageEnabled() to pick a backend for an existing object', () => {
    const offenders: string[] = [];
    const roots = ['routes', 'services', 'jobs', 'middleware', 'utils'];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.ts')) continue;
        const rel = path.relative(SERVER_SRC, full).split(path.sep).join('/');
        // fileStorage.ts owns the routing; imagingRemoteStorage.ts owns the
        // flag itself; index.ts's boot validation is config, not routing.
        if (rel === 'services/fileStorage.ts' || rel === 'services/imagingRemoteStorage.ts') continue;
        const src = stripComments(fs.readFileSync(full, 'utf8'));
        if (/isImagingRemoteStorageEnabled\s*\(/.test(src) || /getImagingStorageBackend\s*\(/.test(src)) {
          offenders.push(rel);
        }
      }
    };
    for (const root of roots) walk(path.join(SERVER_SRC, root));
    assert.deepEqual(
      offenders,
      [],
      `only fileStorage.ts may consult the global imaging backend flag for routing; found: ${offenders.join(', ')}`,
    );
  });

  await test('no module outside the imaging domain imports the VPS2 provider module directly', () => {
    const offenders: string[] = [];
    const roots = ['routes', 'services', 'jobs', 'middleware', 'utils'];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.ts')) continue;
        const rel = path.relative(SERVER_SRC, full).split(path.sep).join('/');
        const src = fs.readFileSync(full, 'utf8');
        if (!/from '[^']*imagingRemoteStorage\.js'/.test(src)) continue;
        // Allowed importers, each for a stated reason:
        //   fileStorage.ts     — owns imaging storage routing, and re-exports
        //                        resolveImagingStoragePlacement so that modules
        //                        outside the imaging domain never need this one
        //   services/imaging/* — the imaging domain itself
        //
        // routes/imaging.ts and fileBackupService.ts are deliberately NOT on
        // this list: they take the resolver from fileStorage.ts, which is their
        // accepted storage-abstraction dependency, rather than reaching into
        // provider internals.
        const allowed =
          rel === 'services/fileStorage.ts' ||
          rel.startsWith('services/imaging/');
        if (!allowed) offenders.push(rel);
      }
    };
    for (const root of roots) walk(path.join(SERVER_SRC, root));
    assert.deepEqual(offenders, [], `unexpected importer(s) of imagingRemoteStorage.js: ${offenders.join(', ')}`);
  });

  await test('the route and the backup sweep take the resolver from fileStorage.ts, and never touch provider primitives or the global flag', () => {
    for (const rel of ['routes/imaging.ts', 'services/fileBackupService.ts']) {
      const src = stripComments(read(rel));
      assert.ok(
        /import \{[^}]*resolveImagingStoragePlacement[^}]*\} from '[^']*fileStorage\.js'/.test(src),
        `${rel} must import resolveImagingStoragePlacement from the storage abstraction, not from the provider module`,
      );
      for (const forbidden of ['putImagingObject', 'getImagingObjectStream', 'imagingObjectExists', 'deleteImagingObject', 'uploadImagingObjectStream', 'isImagingRemoteStorageEnabled', 'getImagingStorageBackend']) {
        assert.equal(src.includes(forbidden), false, `${rel} must not reference ${forbidden} — provider access belongs to fileStorage.ts`);
      }
    }
  });

  await test('R6 REVIEW FIX: an explicit vps2 placement can never reach a legacy primitive — the three wrappers gate on the same helper and fall through to nothing', () => {
    // Behavioral proof lives in imagingPlacementFailClosed.test.ts. This is the
    // structural half: a future edit that re-introduces the a5885819 shape
    // `if (placement === 'vps2' && isSafeStorageKey(ref))` would restore a
    // silent legacy fall-through for an explicitly-VPS2 object, and no test
    // that only exercises safe keys would notice.
    const src = stripComments(read('services/fileStorage.ts'));

    // The defective conjunction must not come back anywhere in this module.
    assert.equal(
      /placement\s*===\s*'vps2'\s*&&\s*isSafeStorageKey/.test(src),
      false,
      'the explicit-vps2 branch must not be conditioned on isSafeStorageKey — an unusable ref must fail closed, not fall through to legacy',
    );

    // Each explicit-vps2 branch asserts the ref FIRST, then calls only the
    // VPS2 primitive. Matching the whole branch body keeps this honest: a
    // legacy call inserted between the two lines would break the match.
    // Line-ending tolerant for the same Windows/CI reason as
    // extractPrismaModelBlock above.
    const normalized = src.replace(/\r\n/g, '\n');
    const expectedBranches = [
      "if (placement === 'vps2') {\n    assertVps2PlacementRefUsable(ref);\n    return getImagingObjectStream(ref);\n  }",
      "if (placement === 'vps2') {\n    assertVps2PlacementRefUsable(ref);\n    return imagingObjectExists(ref);\n  }",
      "if (placement === 'vps2') assertVps2PlacementRefUsable(key);",
    ];
    for (const branch of expectedBranches) {
      assert.ok(
        normalized.includes(branch),
        `fileStorage.ts must contain the fail-closed branch: ${JSON.stringify(branch)}`,
      );
    }

    // And the gate itself must refuse rather than degrade: no legacy primitive
    // may appear inside the helper.
    const helperStart = normalized.indexOf('function assertVps2PlacementRefUsable');
    assert.ok(helperStart > -1, 'the fail-closed gate helper must exist');
    const helperBody = normalized.slice(helperStart, normalized.indexOf('\n}', helperStart) + 2);
    for (const legacyPrimitive of ['openFileStream', 'fileExists', 'deleteFile', 'resolveLocalPath']) {
      assert.equal(
        helperBody.includes(legacyPrimitive),
        false,
        `assertVps2PlacementRefUsable must not call ${legacyPrimitive} — it refuses, it does not substitute legacy storage`,
      );
    }
    assert.ok(
      helperBody.includes('throw new ImagingPlacementRefMismatchError()'),
      'the gate must throw the sanitized placement error',
    );
  });

  section('3. Placement is server-derived and never reaches a client');

  await test('no imaging API response selector exposes storageBackend (KVKK doc 53 §10 — storage location is not serialized to callers)', () => {
    const src = read('routes/imaging.ts');
    const selectStart = src.indexOf('const studyImageSelect');
    assert.ok(selectStart > -1, 'studyImageSelect present');
    const selectBlock = src.slice(selectStart, src.indexOf('};', selectStart));
    assert.equal(selectBlock.includes('storageBackend'), false, 'studyImageSelect must not expose storageBackend');
    assert.equal(selectBlock.includes('filePath'), false, 'studyImageSelect must still not expose filePath');

    // And the DTO the privacy/lifecycle port hands to other domains.
    const publicSrc = read('services/imaging/public.ts');
    const dtoStart = publicSrc.indexOf('export interface ImagingLifecycleImageDto');
    assert.ok(dtoStart > -1, 'ImagingLifecycleImageDto present');
    const dtoBlock = publicSrc.slice(dtoStart, publicSrc.indexOf('}', dtoStart));
    assert.equal(dtoBlock.includes('storageBackend'), false, 'the cross-domain lifecycle DTO must not carry storage placement');
  });

  await test('no imaging route accepts a caller-supplied backend/placement/key — placement is written once at ingest from the completed write', () => {
    const src = stripComments(read('routes/imaging.ts'));
    for (const pattern of [/req\.body[^\n]*storageBackend/, /req\.query[^\n]*storageBackend/, /req\.params[^\n]*storageBackend/, /req\.body[^\n]*filePath/, /req\.query[^\n]*filePath/]) {
      assert.equal(pattern.test(src), false, `routes/imaging.ts must never read placement or storage keys from request input (${pattern})`);
    }
    const bridgeSrc = stripComments(read('routes/imagingBridgePublic.ts'));
    for (const pattern of [/req\.body[^\n]*storageBackend/, /req\.body[^\n]*filePath/]) {
      assert.equal(pattern.test(bridgeSrc), false, `routes/imagingBridgePublic.ts must never read placement or storage keys from request input (${pattern})`);
    }
  });

  section('4. The migration is additive, rollback-safe and backfill-free');

  const MIGRATION_DIR = 'prisma/migrations/20260820130000_add_imaging_image_storage_backend';

  await test('the migration sorts strictly after the newest migration on the R6 merge base, and its timestamp is unique in the chain', () => {
    const migrationsDir = path.resolve(SERVER_SRC, '..', 'prisma', 'migrations');
    const dirs = fs.readdirSync(migrationsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const own = '20260820130000_add_imaging_image_storage_backend';
    assert.ok(dirs.includes(own), 'the R6 migration directory must exist');

    // Deliberately NOT "is the last directory": other lanes land migrations
    // concurrently, and asserting last-ness would make this fail for a reason
    // that has nothing to do with R6. What actually matters is that R6's
    // migration sorts after everything that existed on its merge base, so it
    // can never be inserted BEFORE an already-applied migration.
    const newestOnBase = '20260819130000_add_patient_blood_group';
    assert.ok(dirs.includes(newestOnBase), 'the merge base migration must still be present');
    assert.ok(own > newestOnBase, `${own} must sort after ${newestOnBase}`);

    // Two directories claiming the same instant is a chain-hygiene problem
    // even when the migrations are disjoint — R6 moved off 20260820120000 for
    // exactly this reason after a concurrent lane took it.
    const stamps = dirs.map((d) => d.slice(0, 14)).filter((t) => /^\d{14}$/.test(t));
    const ownStamp = own.slice(0, 14);
    assert.equal(
      stamps.filter((t) => t === ownStamp).length,
      1,
      `no other migration may share R6's timestamp ${ownStamp}`,
    );
  });

  await test('exactly one ADD COLUMN, and no destructive or backfilling statement anywhere', () => {
    const sql = fs.readFileSync(path.resolve(SERVER_SRC, '..', MIGRATION_DIR, 'migration.sql'), 'utf8');
    const statements = sql
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('--'));
    assert.deepEqual(
      statements,
      ['ALTER TABLE "ImagingImage" ADD COLUMN "storageBackend" TEXT;'],
      'one additive statement, nothing else',
    );
    // Comment lines are stripped FIRST on purpose: this migration's header
    // discusses DROP COLUMN and backfills in prose, and matching that prose
    // would be a false positive on exactly the check that must not be weakened.
    const body = statements.join('\n').toUpperCase();
    for (const forbidden of ['DROP ', 'DELETE ', 'TRUNCATE', 'UPDATE ', 'INSERT', 'SET ', 'NOT NULL', 'DEFAULT ', 'CREATE TYPE', 'CREATE INDEX']) {
      assert.equal(body.includes(forbidden), false, `the migration must contain no ${forbidden.trim()}`);
    }
  });

  await test('the migration adds no index — ImagingImage keeps exactly [clinicId, studyId] (Prisma runs migrations inside a transaction, so CONCURRENTLY is unavailable and a table-scanning CREATE INDEX would hold a lock)', () => {
    const schemaSrc = fs.readFileSync(path.resolve(SERVER_SRC, '..', 'prisma', 'schema.prisma'), 'utf8');
    const block = extractPrismaModelBlock(schemaSrc, 'ImagingImage');
    const indexes = block.match(/@@index\([^)]*\)/g) ?? [];
    assert.deepEqual(indexes, ['@@index([clinicId, studyId])'], 'the ImagingImage index set is unchanged by R6');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
