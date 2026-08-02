/**
 * imagingCharacterizationIngestStorage.test.ts — F2-PREP-007-C
 *
 * Characterization coverage for Imaging upload/ingest storage, idempotency,
 * and compensation, per the accepted catalogue
 * (docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md,
 * characterizationTestGate; test bodies drafted in
 * docs/program/evidence/F2-PREP-006-D_imaging_contract_test_design.json).
 *
 * Covers, against a REAL disposable PostgreSQL and a REAL local-disk
 * fileStorage.ts root (no mocking of Prisma or storage):
 *   CT-07 — manual upload (CreateImagingStudy) persists correct
 *           ImagingImage metadata and readable bytes.
 *   CT-08 — bridge ingest (IngestImagingStudy) atomically creates
 *           study/image and advances a linked ImagingRequest to received.
 *   CT-10 — sequential duplicate bridge ingest returns duplicate:true and
 *           creates no second image (the findFirst pre-check fast path).
 *   CT-11 — concurrent identical bridge ingest leaves exactly one
 *           study/image and deletes the loser's file (the P2002 race path).
 *   CT-12 — duplicate manual uploads are intentionally NOT idempotent and
 *           create two independent studies (NULL ingestKey never collides).
 *   CT-13 — manual-upload DB-transaction failure (the only reachable
 *           post-save throw: a linked ImagingRequest closing underneath a
 *           concurrent second upload) removes the previously written file.
 *   CT-14 — bridge P2002 race loser removes its own written file before
 *           returning the winner's studyId.
 *   CT-27 — oversized / invalid-type / malformed-multipart-middleware
 *           failures on the bridge upload route create no partial
 *           ImagingStudy/ImagingImage rows.
 *
 * This suite is characterization-only: it observes and pins CURRENT
 * behavior. It does not converge manual/bridge ingest, does not fix storage
 * compensation, and makes no production-code change.
 *
 * Storage isolation: BASE_UPLOAD_DIR in services/fileStorage.ts is a
 * module-level `path.resolve(process.cwd(), 'uploads')` constant computed
 * the first time that module is evaluated. This file changes `cwd` to a
 * fresh, unique OS-temp directory BEFORE any (dynamic) import reaches
 * fileStorage.ts, so every file this suite writes lands under that
 * per-run temp root, never under the real repo `uploads/` directory. ES
 * module dynamic `import()` specifiers resolve against the importing
 * module's own URL, not `process.cwd()`, so this chdir is safe for the
 * relative imports below.
 *
 * Requires DATABASE_URL to point at a disposable Postgres (migrated) before
 * running. Run: cd server && npx tsx src/tests/imagingCharacterizationIngestStorage.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must point at a disposable Postgres before running this suite.');
}

// Keep the oversize (CT-27) sub-test's payload small and fast — this MUST be
// set before routes/imaging* (and transitively imagingUploadValidation.ts,
// which reads it into a module-level constant) are ever imported.
process.env.IMAGING_MAX_FILE_MB = process.env.IMAGING_MAX_FILE_MB ?? '1';

const TEMP_STORAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'imaging-char-ingest-storage-'));
process.chdir(TEMP_STORAGE_ROOT);
const UPLOADS_ROOT = path.join(TEMP_STORAGE_ROOT, 'uploads');

// On Windows, a directory cannot be removed while it is the process's
// current working directory (EPERM) — chdir out to the OS temp root itself
// (never removed by this suite) before the final rmSync in localCleanup.
function chdirOutOfTempRoot(): void {
  try {
    process.chdir(os.tmpdir());
  } catch {
    // best-effort only — if this fails, rmSync below will surface it
  }
}

// ─── Dynamically imported AFTER chdir, so fileStorage.ts's BASE_UPLOAD_DIR
// resolves against TEMP_STORAGE_ROOT, not the worktree's real cwd. ─────────

const {
  prisma,
  createClinicFixtureSet,
  createStaffUser,
  createTestPatient,
  getFullChain,
  runChain,
  mockResponse,
  authRequest,
} = await import('./dbVerification/dbVerificationHarness.js');
const imagingRouter = (await import('../routes/imaging.js')).default;
const imagingBridgePublicRouter = (await import('../routes/imagingBridgePublic.js')).default;
const { openFileStream } = await import('../services/fileStorage.js');
const { generateBridgeToken } = await import('../services/imaging/bridgeTokens.js');

// ─── Minimal local pass/fail harness (same shape as the rest of the
// dbVerification-style suite; kept local rather than importing createSuite
// so CT-id-prefixed test names stay the single source of the per-CT count
// reported in the delivery evidence doc). ──────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function section(name: string) {
  console.log(`\n${name}`);
}

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: unknown) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    failed++;
    failures.push(name);
  }
}

function summary(): boolean {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`imagingCharacterizationIngestStorage: ${passed} passed, ${failed} failed`);
  if (failures.length) console.log(`Failed: ${failures.join(', ')}`);
  return failed === 0;
}

// ─── Fixture/file tracking for deterministic, complete teardown ───────────

const myOrgIds = new Set<string>();
const myClinicIds = new Set<string>();

function trackOrgAndClinics(orgId: string, clinicIds: string[]) {
  myOrgIds.add(orgId);
  clinicIds.forEach((id) => myClinicIds.add(id));
}

async function localCleanup(): Promise<void> {
  const clinicIds = Array.from(myClinicIds);
  const orgIds = Array.from(myOrgIds);
  if (clinicIds.length === 0 && orgIds.length === 0) {
    chdirOutOfTempRoot();
    fs.rmSync(TEMP_STORAGE_ROOT, { recursive: true, force: true });
    return;
  }

  // FK-safe order: ImagingImage -> ImagingStudy -> ImagingRequest ->
  // ImagingBridgeAgent -> AuditLog/ActivityLog -> Patient -> User -> Clinic
  // -> Organization.
  await prisma.imagingImage.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.imagingStudy.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.imagingRequest.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.imagingBridgeAgent.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.auditLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.activityLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
  await prisma.patient.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: orgIds } } });
  // Filter by the precisely-tracked clinic ids themselves (not just
  // organizationId) so every clinic this suite created — including
  // crossOrgClinicId, which belongs to otherOrgId — is definitely removed.
  await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });

  myClinicIds.clear();
  myOrgIds.clear();

  // Belt-and-suspenders: remove the entire per-run temp storage root
  // (covers every file this suite ever wrote, including any compensation
  // deletes that already ran and any that legitimately did not).
  chdirOutOfTempRoot();
  fs.rmSync(TEMP_STORAGE_ROOT, { recursive: true, force: true });
}

// ─── Fixture helpers (imaging-specific; layered on the shared harness) ────

async function newFixture(labelPrefix: string) {
  const fixtures = await createClinicFixtureSet(labelPrefix);
  // createClinicFixtureSet creates TWO organizations (orgId + otherOrgId —
  // crossOrgClinicId belongs to otherOrgId, not orgId); both must be tracked
  // or otherOrgId's clinic/organization rows leak past cleanup.
  trackOrgAndClinics(fixtures.orgId, [
    fixtures.defaultClinicId,
    fixtures.siblingClinicId,
    fixtures.unauthorizedClinicId,
    fixtures.crossOrgClinicId,
  ]);
  myOrgIds.add(fixtures.otherOrgId);
  const owner = await createStaffUser({
    organizationId: fixtures.orgId,
    clinicId: fixtures.defaultClinicId,
    role: 'OWNER',
    canAccessAllClinics: true,
  });
  const ownerReq = authRequest({
    id: owner.id,
    organizationId: fixtures.orgId,
    clinicId: fixtures.defaultClinicId,
    role: 'OWNER',
    canAccessAllClinics: true,
  });
  return { fixtures, owner, ownerReq, clinicId: fixtures.defaultClinicId };
}

async function newBridgeAgent(clinicId: string, createdById: string) {
  const { token, tokenHash } = generateBridgeToken();
  const agent = await prisma.imagingBridgeAgent.create({
    data: { clinicId, name: `Bridge ${crypto.randomUUID().slice(0, 8)}`, tokenHash, status: 'online', createdById },
  });
  return { agent, token };
}

function pngBuffer(tag: string): Buffer {
  const magic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const payload = Buffer.from(`imaging-characterization-${tag}-${crypto.randomUUID()}`);
  return Buffer.concat([magic, payload]);
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function fakeMulterFile(originalname: string, mimetype: string, buffer: Buffer): any {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    buffer,
    stream: undefined,
    destination: '',
    filename: '',
    path: '',
  };
}

function listClinicUploadFiles(clinicId: string): string[] {
  const dir = path.join(UPLOADS_ROOT, clinicId);
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

// ─── Chain extraction (manual-upload route: drop the multer middleware,
// keep the real authorize() + real handler; bridge route: drop the multer
// wrapper, keep the real handler) — same technique as
// dbVerificationHarness's getFullChain/getHandlerOnly, used here because
// neither route's multer middleware can parse a fake in-memory req (no real
// multipart stream); req.file is supplied directly instead, in the exact
// shape multer would have produced. This exercises every line of real
// route/handler logic this suite characterizes; only multer's own
// stream-parsing is bypassed here (CT-27 below exercises multer itself,
// over real HTTP, on the bridge route). ────────────────────────────────────

const MANUAL_UPLOAD_CHAIN_RAW = getFullChain(imagingRouter as any, 'post', '/imaging/studies');
const MANUAL_UPLOAD_CHAIN = [MANUAL_UPLOAD_CHAIN_RAW[0], MANUAL_UPLOAD_CHAIN_RAW[MANUAL_UPLOAD_CHAIN_RAW.length - 1]];

const BRIDGE_UPLOAD_CHAIN_RAW = getFullChain(imagingBridgePublicRouter as any, 'post', '/imaging/bridge/studies');
const BRIDGE_UPLOAD_HANDLER = [BRIDGE_UPLOAD_CHAIN_RAW[BRIDGE_UPLOAD_CHAIN_RAW.length - 1]];

async function callManualUpload(ownerReq: ReturnType<typeof authRequest>, body: Record<string, unknown>, file: any) {
  const req = { ...(ownerReq as any), body, file, params: {}, query: {} } as any;
  const res = mockResponse();
  await runChain(MANUAL_UPLOAD_CHAIN as any, req, res);
  return res;
}

async function callBridgeUpload(token: string, body: Record<string, unknown>, file: any, ip = '10.0.0.1') {
  const req = { headers: { authorization: `Bearer ${token}` }, ip, body, file } as any;
  const res = mockResponse();
  await runChain(BRIDGE_UPLOAD_HANDLER as any, req, res);
  return res;
}

// ═══════════════════════════════════════════════════════════════════════
// CT-07 — manual upload persists correct ImagingImage metadata and
// readable bytes.
// ═══════════════════════════════════════════════════════════════════════

async function ct07() {
  section('CT-07 — CreateImagingStudy (manual) persists correct metadata and readable bytes');
  const { ownerReq, clinicId } = await newFixture('ct07');
  const buf = pngBuffer('ct07');

  await test('CT-07: manual upload returns 201 with the persisted study, and the ImagingImage DB row matches the uploaded bytes exactly', async () => {
    const res = await callManualUpload(ownerReq, { modality: 'IO' }, fakeMulterFile('ct07-scan.png', 'image/png', buf));

    assert.equal(res.statusCode, 201, `expected 201, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.images.length, 1);
    assert.equal(res.body.images[0].fileSize, buf.length);
    assert.equal(res.body.images[0].mimeType, 'image/png');
    assert.equal(res.body.images[0].originalName, 'ct07-scan.png');

    const dbImage = await prisma.imagingImage.findFirstOrThrow({ where: { studyId: res.body.id } });
    assert.equal(dbImage.clinicId, clinicId);
    assert.equal(dbImage.fileSize, buf.length);
    assert.equal(dbImage.mimeType, 'image/png');
    assert.equal(dbImage.originalName, 'ct07-scan.png');
    assert.ok(dbImage.filePath.startsWith(`${clinicId}/`), 'storage key must be clinicId-prefixed');

    const stream = await openFileStream(dbImage.filePath);
    assert.ok(stream, 'the physical file must be readable back via openFileStream');
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(chunk as Buffer);
    const readBack = Buffer.concat(chunks);
    assert.ok(readBack.equals(buf), 'bytes read back from storage must exactly match the uploaded bytes');
  });
}

// ═══════════════════════════════════════════════════════════════════════
// CT-08 — bridge ingest atomically creates study/image and advances the
// linked ImagingRequest to received.
// ═══════════════════════════════════════════════════════════════════════

async function ct08() {
  section('CT-08 — IngestImagingStudy (bridge) atomically creates study/image and advances the linked ImagingRequest');
  const { fixtures, owner, clinicId } = await newFixture('ct08');
  const { agent, token } = await newBridgeAgent(clinicId, owner.id);
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId });
  const request = await prisma.imagingRequest.create({
    data: {
      clinicId,
      patientId: patient.id,
      requestedModality: 'PX',
      status: 'requested',
      requestedByUserId: owner.id,
    },
  });
  const buf = pngBuffer('ct08');
  const ingestKey = sha256Hex(buf);

  await test('CT-08: bridge ingest with imagingRequestId commits study+image and flips the request to received in one call', async () => {
    const before = await prisma.imagingRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(before.status, 'requested');

    const res = await callBridgeUpload(
      token,
      { ingestKey, modality: 'PX', imagingRequestId: request.id },
      fakeMulterFile('ct08-scan.png', 'image/png', buf),
    );

    assert.equal(res.statusCode, 201, `expected 201, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.duplicate, false);
    assert.ok(res.body.studyId);

    const study = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: res.body.studyId } });
    assert.equal(study.clinicId, clinicId);
    assert.equal(study.patientId, patient.id, 'study must inherit the linked request\'s patient');
    assert.equal(study.imagingRequestId, request.id);
    assert.equal(study.bridgeAgentId, agent.id);
    assert.equal(study.ingestKey, ingestKey);

    const image = await prisma.imagingImage.findFirstOrThrow({ where: { studyId: study.id } });
    assert.equal(image.fileSize, buf.length);
    assert.equal(image.mimeType, 'image/png');

    const after = await prisma.imagingRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(after.status, 'received', 'the linked ImagingRequest must be advanced to received in the same commit');
  });
}

// ═══════════════════════════════════════════════════════════════════════
// CT-10 — sequential duplicate bridge ingest returns duplicate:true and
// creates no second image.
// ═══════════════════════════════════════════════════════════════════════

async function ct10() {
  section('CT-10 — sequential duplicate bridge ingest (same clinicId+ingestKey) returns duplicate:true, no second image');
  const { owner, clinicId } = await newFixture('ct10');
  const { token } = await newBridgeAgent(clinicId, owner.id);
  const buf = pngBuffer('ct10');
  const ingestKey = sha256Hex(buf);

  await test('CT-10: first bridge ingest creates the study; the second, sequential, same-ingestKey call short-circuits via the pre-check', async () => {
    const first = await callBridgeUpload(token, { ingestKey, modality: 'IO' }, fakeMulterFile('ct10-a.png', 'image/png', buf));
    assert.equal(first.statusCode, 201);
    const studyId = first.body.studyId;

    const filesAfterFirst = listClinicUploadFiles(clinicId);
    assert.equal(filesAfterFirst.length, 1, 'exactly one file must exist after the first (winning) upload');

    const second = await callBridgeUpload(token, { ingestKey, modality: 'IO' }, fakeMulterFile('ct10-b.png', 'image/png', buf));
    assert.equal(second.statusCode, 200, 'the duplicate short-circuit returns 200, not 201');
    assert.equal(second.body.ok, true);
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.studyId, studyId, 'the duplicate response must point at the original study');

    const studyCount = await prisma.imagingStudy.count({ where: { clinicId, ingestKey } });
    assert.equal(studyCount, 1, 'exactly one ImagingStudy must exist for this (clinicId, ingestKey) pair');
    const imageCount = await prisma.imagingImage.count({ where: { studyId } });
    assert.equal(imageCount, 1, 'no second ImagingImage row may be created by the duplicate call');

    // The pre-check short-circuit (routes/imagingBridgePublic.ts:257-267) runs
    // BEFORE any storage write, so the second call must never have touched
    // disk at all — the clinic's upload directory still holds only the
    // first file.
    const filesAfterSecond = listClinicUploadFiles(clinicId);
    assert.equal(filesAfterSecond.length, 1, 'the sequential-duplicate call must not write a second file to storage');
  });
}

// ═══════════════════════════════════════════════════════════════════════
// CT-11 — concurrent identical bridge ingest leaves exactly one
// study/image and deletes the loser's file.
// ═══════════════════════════════════════════════════════════════════════

async function ct11Rep(repLabel: string) {
  const { owner, clinicId } = await newFixture(`ct11-${repLabel}`);
  const { token } = await newBridgeAgent(clinicId, owner.id);
  const buf = pngBuffer(`ct11-${repLabel}`);
  const ingestKey = sha256Hex(buf);

  await test(`CT-11 (${repLabel}): two concurrent identical-ingestKey bridge uploads leave exactly one study/image; the loser's file is gone`, async () => {
    // Real barrier: both calls hit real Postgres/disk concurrently via
    // Promise.all (no fixed sleep). Neither request has committed before
    // the other starts, so both pass the pre-check and race the DB's
    // `@@unique([clinicId, ingestKey])` constraint at INSERT time — the same
    // technique already accepted in this suite family for a real-DB race
    // with no ordering requirement (see dbVerification/
    // inventoryUnitConversionConcurrency.test.ts, "Race 3").
    const [resA, resB] = await Promise.all([
      callBridgeUpload(token, { ingestKey, modality: 'CT' }, fakeMulterFile('ct11-a.png', 'image/png', buf), '10.0.1.1'),
      callBridgeUpload(token, { ingestKey, modality: 'CT' }, fakeMulterFile('ct11-b.png', 'image/png', buf), '10.0.1.2'),
    ]);

    for (const res of [resA, resB]) {
      assert.ok([200, 201].includes(res.statusCode), `each racer must resolve 200/201, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.ok, true);
    }
    const duplicateFlags = [resA.body.duplicate, resB.body.duplicate].sort();
    assert.deepEqual(duplicateFlags, [false, true], 'exactly one racer must win (duplicate:false) and one must lose (duplicate:true)');
    assert.equal(resA.body.studyId, resB.body.studyId, 'the loser must return the winner\'s studyId, never a different id');

    const studyCount = await prisma.imagingStudy.count({ where: { clinicId, ingestKey } });
    assert.equal(studyCount, 1, 'exactly one ImagingStudy row must survive the race');
    const imageCount = await prisma.imagingImage.count({ where: { studyId: resA.body.studyId } });
    assert.equal(imageCount, 1, 'exactly one ImagingImage row must survive the race');

    const files = listClinicUploadFiles(clinicId);
    assert.equal(files.length, 1, 'the race loser\'s uploaded file must be deleted — no orphan may remain on disk');
  });
}

async function ct11() {
  section('CT-11 — concurrent identical bridge ingest (P2002 race): exactly one study/image, loser\'s file deleted');
  // Repeated 3x (fresh clinic/agent/ingestKey each time) per the task's
  // instruction to repeat concurrency-sensitive tests multiple times.
  await ct11Rep('rep1');
  await ct11Rep('rep2');
  await ct11Rep('rep3');
}

// ═══════════════════════════════════════════════════════════════════════
// CT-12 — duplicate manual uploads remain intentionally non-idempotent
// and create two studies.
// ═══════════════════════════════════════════════════════════════════════

async function ct12() {
  section('CT-12 — duplicate manual uploads are NOT idempotent: byte-identical files create two independent studies');
  const { ownerReq, clinicId } = await newFixture('ct12');
  const buf = pngBuffer('ct12');

  await test('CT-12: uploading the exact same bytes twice via the manual route creates two distinct ImagingStudy/ImagingImage rows', async () => {
    const first = await callManualUpload(ownerReq, { modality: 'SCANNER' }, fakeMulterFile('ct12.png', 'image/png', buf));
    const second = await callManualUpload(ownerReq, { modality: 'SCANNER' }, fakeMulterFile('ct12.png', 'image/png', buf));

    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    assert.notEqual(first.body.id, second.body.id, 'the manual route has no ingestKey field; NULL never collides under the unique index, so two independent studies must result');

    const studyCount = await prisma.imagingStudy.count({ where: { clinicId } });
    assert.equal(studyCount, 2);
    const imageCount = await prisma.imagingImage.count({ where: { clinicId } });
    assert.equal(imageCount, 2);

    const files = listClinicUploadFiles(clinicId);
    assert.equal(files.length, 2, 'both byte-identical uploads must persist as two separate physical files');
  });
}

// ═══════════════════════════════════════════════════════════════════════
// CT-13 — manual-upload DB transaction failure removes the previously
// written file.
// ═══════════════════════════════════════════════════════════════════════

async function ct13() {
  section('CT-13 — CreateImagingStudy: a post-save $transaction failure removes the just-written file (storage compensation)');
  const { fixtures, ownerReq, owner, clinicId } = await newFixture('ct13');
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId });
  const request = await prisma.imagingRequest.create({
    data: { clinicId, patientId: patient.id, requestedModality: 'IO', status: 'requested', requestedByUserId: owner.id },
  });

  await test('CT-13: two concurrent manual uploads racing to close the same open ImagingRequest — the loser\'s $transaction throws (409) after its file was already saved, and the catch-block compensation deletes it', async () => {
    // Both calls pass the top-of-handler open-request check (neither has
    // committed yet), both save their file to disk, then both enter
    // prisma.$transaction and attempt `updateMany(... status IN
    // [requested, scheduled])` against the SAME ImagingRequest row. Postgres
    // serializes the two UPDATE statements on that row; the second to
    // execute sees status already 'received' (updated.count === 0), so its
    // $transaction throws with statusCode 409 — the only currently-reachable
    // post-save throw in this handler (routes/imaging.ts:650-652), which
    // then hits the catch-block's `if (storageKey) deleteFile(storageKey)`
    // compensation (routes/imaging.ts:684). No fixed sleep: real concurrent
    // Postgres connections provide the barrier (same technique as CT-11).
    const [resA, resB] = await Promise.all([
      callManualUpload(ownerReq, { modality: 'IO', imagingRequestId: request.id }, fakeMulterFile('ct13-a.png', 'image/png', pngBuffer('ct13-a'))),
      callManualUpload(ownerReq, { modality: 'IO', imagingRequestId: request.id }, fakeMulterFile('ct13-b.png', 'image/png', pngBuffer('ct13-b'))),
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort();
    assert.deepEqual(statuses, [201, 409], `expected exactly one winner (201) and one loser (409); got ${JSON.stringify(statuses)}`);
    const winner = resA.statusCode === 201 ? resA : resB;
    const loser = resA.statusCode === 409 ? resA : resB;
    assert.equal(loser.body.error, 'Imaging request is not open for new studies');

    const studyCount = await prisma.imagingStudy.count({ where: { clinicId } });
    assert.equal(studyCount, 1, 'only the winner\'s ImagingStudy row may survive — the loser\'s transaction must have fully rolled back');
    assert.equal((await prisma.imagingStudy.findFirstOrThrow({ where: { clinicId } })).id, winner.body.id);

    const finalRequest = await prisma.imagingRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(finalRequest.status, 'received');

    const files = listClinicUploadFiles(clinicId);
    assert.equal(files.length, 1, 'the loser\'s already-written file must have been removed by the catch-block compensation delete; only the winner\'s file remains');
  });
}

// ═══════════════════════════════════════════════════════════════════════
// CT-14 — bridge P2002 race loser removes its own written file.
// ═══════════════════════════════════════════════════════════════════════

async function ct14() {
  section('CT-14 — IngestImagingStudy: P2002 race loser deletes its own file before returning the winner\'s studyId');
  const { owner, clinicId } = await newFixture('ct14');
  const { token } = await newBridgeAgent(clinicId, owner.id);
  const buf = pngBuffer('ct14');
  const ingestKey = sha256Hex(buf);

  await test('CT-14: on a P2002 race loss, the loser\'s own storage file is deleted, and it returns the winner\'s studyId (not an error)', async () => {
    const [resA, resB] = await Promise.all([
      callBridgeUpload(token, { ingestKey, modality: 'CEPH' }, fakeMulterFile('ct14-a.png', 'image/png', buf), '10.0.2.1'),
      callBridgeUpload(token, { ingestKey, modality: 'CEPH' }, fakeMulterFile('ct14-b.png', 'image/png', buf), '10.0.2.2'),
    ]);

    const winner = resA.body.duplicate === false ? resA : resB;
    const loser = resA.body.duplicate === true ? resA : resB;
    assert.equal(winner.statusCode, 201);
    assert.equal(loser.statusCode, 200, 'the P2002-race loser is folded into the same 200/duplicate:true response shape as the sequential pre-check duplicate — it never surfaces as a 409/500 to the caller');
    assert.equal(loser.body.studyId, winner.body.studyId);

    const image = await prisma.imagingImage.findFirstOrThrow({ where: { studyId: winner.body.studyId } });
    const remainingFiles = listClinicUploadFiles(clinicId);
    assert.equal(remainingFiles.length, 1, 'only the winner\'s file may remain on disk');
    assert.equal(remainingFiles[0], path.posix.basename(image.filePath), 'the one remaining file must be the winner\'s own persisted filePath, not the loser\'s');
  });
}

// ═══════════════════════════════════════════════════════════════════════
// CT-27 — oversized, invalid-type, and middleware-failure paths create no
// partial study/image rows (real HTTP, real multer, on the bridge route).
// ═══════════════════════════════════════════════════════════════════════

function buildMultipartBody(
  boundary: string,
  fields: Record<string, string>,
  filePart?: { filename: string; contentType: string; data: Buffer },
): Buffer {
  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  if (filePart) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filePart.filename}"\r\nContent-Type: ${filePart.contentType}\r\n\r\n`,
      ),
    );
    chunks.push(filePart.data);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

async function withRealServer(fn: (port: number) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/public', imagingBridgePublicRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected server to bind a TCP port');
  try {
    await fn(address.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function issueRawRequest(
  port: number,
  opts: { path: string; headers: Record<string, string>; body: Buffer },
): Promise<{ statusCode: number; bodyText: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: opts.path, headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, bodyText: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.write(opts.body);
    req.end();
  });
}

async function ct27() {
  section('CT-27 — oversized / invalid-type / malformed-multipart bridge-upload failures leave no partial rows');
  const { owner, clinicId } = await newFixture('ct27');
  const { token } = await newBridgeAgent(clinicId, owner.id);

  await withRealServer(async (port) => {
    await test('CT-27a: an oversized file yields 413 and creates no ImagingStudy/ImagingImage row', async () => {
      const boundary = `----ct27a${crypto.randomUUID()}`;
      const oversized = Buffer.alloc(2 * 1024 * 1024, 0x41); // 2 MiB > IMAGING_MAX_FILE_MB=1
      const body = buildMultipartBody(
        boundary,
        { ingestKey: sha256Hex(oversized), modality: 'IO' },
        { filename: 'oversize.png', contentType: 'image/png', data: oversized },
      );
      const res = await issueRawRequest(port, {
        path: '/api/public/imaging/bridge/studies',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'content-length': String(body.length),
        },
        body,
      });
      assert.equal(res.statusCode, 413, `expected 413, got ${res.statusCode}: ${res.bodyText}`);
    });

    await test('CT-27b: a disallowed file type yields 400 and creates no ImagingStudy/ImagingImage row', async () => {
      const boundary = `----ct27b${crypto.randomUUID()}`;
      const data = Buffer.from('not an allowed imaging file type');
      const body = buildMultipartBody(
        boundary,
        { ingestKey: sha256Hex(data), modality: 'IO' },
        { filename: 'notes.txt', contentType: 'text/plain', data },
      );
      const res = await issueRawRequest(port, {
        path: '/api/public/imaging/bridge/studies',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'content-length': String(body.length),
        },
        body,
      });
      assert.equal(res.statusCode, 400, `expected 400, got ${res.statusCode}: ${res.bodyText}`);
    });

    await test('CT-27c: a malformed multipart body (Content-Type with no boundary) throws inside the upload middleware and yields 500', async () => {
      const data = Buffer.from('irrelevant body, boundary is missing from Content-Type');
      const res = await issueRawRequest(port, {
        path: '/api/public/imaging/bridge/studies',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'multipart/form-data', // no boundary= — busboy throws during construction
          'content-length': String(data.length),
        },
        body: data,
      });
      assert.equal(res.statusCode, 500, `expected 500, got ${res.statusCode}: ${res.bodyText}`);
    });

    await test('CT-27: none of the three failure paths left a partial ImagingStudy/ImagingImage row for this clinic', async () => {
      const studyCount = await prisma.imagingStudy.count({ where: { clinicId } });
      const imageCount = await prisma.imagingImage.count({ where: { clinicId } });
      assert.equal(studyCount, 0);
      assert.equal(imageCount, 0);
      assert.equal(listClinicUploadFiles(clinicId).length, 0, 'no file may have been left on disk either');
    });
  });
}

// ─── Run ────────────────────────────────────────────────────────────────

async function main() {
  await ct07();
  await ct08();
  await ct10();
  await ct11();
  await ct12();
  await ct13();
  await ct14();
  await ct27();

  const ok = summary();
  await localCleanup();
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  await localCleanup().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
