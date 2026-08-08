/**
 * imagingIngestCoreConvergence.test.ts — F2-OVL-01
 *
 * Convergence proof for services/imaging/imagingIngestCore.ts, the shared
 * manual/bridge ImagingStudy ingest core introduced to remove the
 * byte-for-byte-duplicated file-signature/storage-write/transaction-with-CAS
 * mechanics that previously lived independently in routes/imaging.ts and
 * routes/imagingBridgePublic.ts (docs/program/architecture/
 * F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md §8).
 *
 * This suite is additive to, not a replacement for,
 * imagingCharacterizationIngestStorage.test.ts (CT-07/08/10/11/12/13/14/27),
 * which already re-runs unchanged and end-to-end proves route-level ingest
 * behavior is unmodified by this refactor. This file instead targets
 * properties specific to the shared core itself that no route-level test
 * exercises directly:
 *
 *   1. Tenant-scoped CAS — the core never derives clinicId itself and its
 *      request-transition predicate is scoped by the caller-supplied
 *      clinicId; a cross-clinic imagingRequestId fails closed (CAS conflict)
 *      and the whole transaction — including the ImagingStudy row itself —
 *      rolls back, not just the request update.
 *   2. `source` persists exactly as given ('manual_upload' vs 'bridge'),
 *      independently of any route.
 *   3. createdById / bridgeAgentId / ingestKey persist path-specific
 *      (manual: createdById set, bridgeAgentId/ingestKey null; bridge: the
 *      reverse) when driven through the SAME core function.
 *   4. Structural: the core imports no Express types and no
 *      audit/ActivityLog dependency (F2-OVL-01 architecture decision: audit
 *      stays outside the shared core).
 *   5. Route-level gap-fill: a bridge-side CAS conflict (two concurrent
 *      bridge ingests racing to close the same open ImagingRequest) was
 *      previously only characterized for the manual route (CT-13). Since
 *      both routes now share the exact same CAS code path inside the core,
 *      this proves the bridge route gets identical 409 + storage-compensation
 *      behavior, not just the manual route.
 *
 * Requires DATABASE_URL to point at a disposable Postgres (migrated) before
 * running. Run: cd server && npx tsx src/tests/imagingIngestCoreConvergence.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must point at a disposable Postgres before running this suite.');
}

const TEMP_STORAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'imaging-ingest-core-convergence-'));
process.chdir(TEMP_STORAGE_ROOT);
const UPLOADS_ROOT = path.join(TEMP_STORAGE_ROOT, 'uploads');

function chdirOutOfTempRoot(): void {
  try {
    process.chdir(os.tmpdir());
  } catch {
    // best-effort only
  }
}

// ─── Dynamically imported AFTER chdir (see imagingCharacterizationIngestStorage.test.ts for why). ───

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
const { ingestImagingStudyCore, ImagingIngestRequestCasConflictError } =
  await import('../services/imaging/imagingIngestCore.js');
const imagingBridgePublicRouter = (await import('../routes/imagingBridgePublic.js')).default;
const { generateBridgeToken } = await import('../services/imaging/bridgeTokens.js');

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
  console.log(`imagingIngestCoreConvergence: ${passed} passed, ${failed} failed`);
  if (failures.length) console.log(`Failed: ${failures.join(', ')}`);
  return failed === 0;
}

const myOrgIds = new Set<string>();
const myClinicIds = new Set<string>();

function trackOrgAndClinics(orgId: string, clinicIds: string[]) {
  myOrgIds.add(orgId);
  clinicIds.forEach((id) => myClinicIds.add(id));
}

async function localCleanup(): Promise<void> {
  const clinicIds = Array.from(myClinicIds);
  const orgIds = Array.from(myOrgIds);
  if (clinicIds.length > 0 || orgIds.length > 0) {
    await prisma.imagingImage.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.imagingStudy.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.imagingRequest.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.imagingBridgeAgent.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.auditLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.activityLog.deleteMany({ where: { clinicId: { in: clinicIds } } });
    await prisma.patient.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.clinic.deleteMany({ where: { id: { in: clinicIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  }
  myClinicIds.clear();
  myOrgIds.clear();
  chdirOutOfTempRoot();
  fs.rmSync(TEMP_STORAGE_ROOT, { recursive: true, force: true });
}

async function newFixture(labelPrefix: string) {
  const fixtures = await createClinicFixtureSet(labelPrefix);
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
  return { fixtures, owner, clinicId: fixtures.defaultClinicId, siblingClinicId: fixtures.siblingClinicId };
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
  const payload = Buffer.from(`imaging-ingest-core-convergence-${tag}-${crypto.randomUUID()}`);
  return Buffer.concat([magic, payload]);
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function listClinicUploadFiles(clinicId: string): string[] {
  const dir = path.join(UPLOADS_ROOT, clinicId);
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function fakeMulterFile(originalname: string, mimetype: string, buffer: Buffer): any {
  return {
    fieldname: 'file', originalname, encoding: '7bit', mimetype, size: buffer.length, buffer,
    stream: undefined, destination: '', filename: '', path: '',
  };
}

function baseCoreInput(clinicId: string, buf: Buffer, originalName: string) {
  return {
    clinicId,
    patientId: null,
    appointmentId: null,
    treatmentCaseId: null,
    deviceId: null,
    modality: 'IO',
    studyDate: null,
    description: null,
    imagingRequestId: null,
    fileBuffer: buf,
    originalName,
    declaredMimeType: 'image/png',
    fileSize: buf.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 1 — Tenant-scoped CAS: a cross-clinic imagingRequestId fails closed and
//     the whole transaction (including the ImagingStudy row) rolls back.
// ═══════════════════════════════════════════════════════════════════════

async function testTenantScopedCas() {
  section('1 — Tenant-scoped CAS (core-level, no route)');
  const { fixtures, owner, clinicId, siblingClinicId } = await newFixture('cas');
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId: siblingClinicId });
  const foreignRequest = await prisma.imagingRequest.create({
    data: {
      clinicId: siblingClinicId,
      patientId: patient.id,
      requestedModality: 'IO',
      status: 'requested',
      requestedByUserId: owner.id,
    },
  });

  await test('a caller-supplied clinicId that does not own the given imagingRequestId is rejected as a CAS conflict, not silently applied to the wrong tenant', async () => {
    const buf = pngBuffer('cas-cross-clinic');
    await assert.rejects(
      () =>
        ingestImagingStudyCore({
          ...baseCoreInput(clinicId, buf, 'cas-cross-clinic.png'),
          source: 'manual_upload',
          createdById: owner.id,
          bridgeAgentId: null,
          ingestKey: null,
          imagingRequestId: foreignRequest.id, // belongs to siblingClinicId, not clinicId
        }),
      (err: any) => err instanceof ImagingIngestRequestCasConflictError,
    );

    // The whole transaction must roll back — not just leave the request
    // untouched. No ImagingStudy may exist for either clinic.
    const studyCountOwnClinic = await prisma.imagingStudy.count({ where: { clinicId } });
    const studyCountForeignClinic = await prisma.imagingStudy.count({ where: { clinicId: siblingClinicId } });
    assert.equal(studyCountOwnClinic, 0, 'no ImagingStudy may be committed under the caller\'s clinicId');
    assert.equal(studyCountForeignClinic, 0, 'no ImagingStudy may be committed under the foreign clinicId either — the whole transaction rolled back');

    const unchangedRequest = await prisma.imagingRequest.findUniqueOrThrow({ where: { id: foreignRequest.id } });
    assert.equal(unchangedRequest.status, 'requested', 'the foreign request must remain untouched');

    // Best-effort compensation must also have run: the file written before
    // the transaction was attempted must be deleted, not orphaned.
    assert.equal(listClinicUploadFiles(clinicId).length, 0, 'the written file must be compensated away on CAS failure');
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 2/3 — source / createdById / bridgeAgentId / ingestKey persist
//       path-specific through the SAME shared function.
// ═══════════════════════════════════════════════════════════════════════

async function testPathSpecificFields() {
  section('2/3 — source + createdById/bridgeAgentId/ingestKey persist path-specific through the same core function');
  const { owner, clinicId } = await newFixture('fields');
  const { agent } = await newBridgeAgent(clinicId, owner.id);

  await test('source="manual_upload" input persists createdById, and leaves bridgeAgentId/ingestKey null', async () => {
    const buf = pngBuffer('manual-fields');
    const result = await ingestImagingStudyCore({
      ...baseCoreInput(clinicId, buf, 'manual-fields.png'),
      source: 'manual_upload',
      createdById: owner.id,
      bridgeAgentId: null,
      ingestKey: null,
    });
    const study = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: result.studyId } });
    assert.equal(study.source, 'manual_upload');
    assert.equal(study.createdById, owner.id);
    assert.equal(study.bridgeAgentId, null);
    assert.equal(study.ingestKey, null);
  });

  await test('source="bridge" input persists bridgeAgentId + ingestKey, and leaves createdById null', async () => {
    const buf = pngBuffer('bridge-fields');
    const ingestKey = sha256Hex(buf);
    const result = await ingestImagingStudyCore({
      ...baseCoreInput(clinicId, buf, 'bridge-fields.png'),
      source: 'bridge',
      createdById: null,
      bridgeAgentId: agent.id,
      ingestKey,
    });
    const study = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: result.studyId } });
    assert.equal(study.source, 'bridge');
    assert.equal(study.createdById, null);
    assert.equal(study.bridgeAgentId, agent.id);
    assert.equal(study.ingestKey, ingestKey);
  });

  await test('ImagingImage fields are equivalent regardless of which path (manual/bridge) drove the same core function', async () => {
    const buf = pngBuffer('image-equiv');
    const manualResult = await ingestImagingStudyCore({
      ...baseCoreInput(clinicId, buf, 'equiv.png'),
      source: 'manual_upload',
      createdById: owner.id,
      bridgeAgentId: null,
      ingestKey: null,
    });
    const bridgeResult = await ingestImagingStudyCore({
      ...baseCoreInput(clinicId, buf, 'equiv.png'),
      source: 'bridge',
      createdById: null,
      bridgeAgentId: agent.id,
      ingestKey: sha256Hex(Buffer.concat([buf, Buffer.from('bridge-variant')])),
    });
    const [manualImage, bridgeImage] = await Promise.all([
      prisma.imagingImage.findFirstOrThrow({ where: { studyId: manualResult.studyId } }),
      prisma.imagingImage.findFirstOrThrow({ where: { studyId: bridgeResult.studyId } }),
    ]);
    assert.equal(manualImage.fileSize, bridgeImage.fileSize);
    assert.equal(manualImage.mimeType, bridgeImage.mimeType);
    assert.equal(manualImage.originalName, bridgeImage.originalName);
    assert.ok(manualImage.filePath.startsWith(`${clinicId}/`));
    assert.ok(bridgeImage.filePath.startsWith(`${clinicId}/`));
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 4 — Structural: no Express / audit / ActivityLog dependency in the core.
// ═══════════════════════════════════════════════════════════════════════

async function testStructuralIsolation() {
  section('4 — Structural: shared core has no Express / audit / ActivityLog dependency');
  const corePath = fileURLToPath(new URL('../services/imaging/imagingIngestCore.ts', import.meta.url));
  const coreSrc = fs.readFileSync(corePath, 'utf8');
  // Only actual `import ... from '...'` statement lines count — the header
  // comment intentionally documents these same excluded dependencies by
  // name (as things the core must NOT import), which would otherwise
  // false-positive a whole-file substring scan.
  const importLines = (coreSrc.match(/^import[^\n]*$/gm) ?? []).join('\n');

  await test('the core never imports express (Request/Response must never reach it)', () => {
    assert.equal(/from ['"]express['"]/.test(importLines), false);
  });
  await test('the core never imports writeAuditLog/auditLog (F2-OVL-01: audit stays outside the shared core)', () => {
    assert.equal(importLines.includes('auditLog'), false);
    assert.equal(importLines.includes('writeAuditLog'), false);
  });
  await test('the core never imports logActivity/ActivityLog', () => {
    assert.equal(importLines.includes('logActivity'), false);
    assert.equal(importLines.includes('utils/activity'), false);
  });
}

// ═══════════════════════════════════════════════════════════════════════
// 5 — Route-level gap-fill: bridge-side CAS conflict (previously only
//     characterized for the manual route as CT-13).
// ═══════════════════════════════════════════════════════════════════════

const BRIDGE_UPLOAD_CHAIN_RAW = getFullChain(imagingBridgePublicRouter as any, 'post', '/imaging/bridge/studies');
const BRIDGE_UPLOAD_HANDLER = [BRIDGE_UPLOAD_CHAIN_RAW[BRIDGE_UPLOAD_CHAIN_RAW.length - 1]];

async function callBridgeUpload(token: string, body: Record<string, unknown>, file: any, ip = '10.0.9.1') {
  const req = { headers: { authorization: `Bearer ${token}` }, ip, body, file } as any;
  const res = mockResponse();
  await runChain(BRIDGE_UPLOAD_HANDLER as any, req, res);
  return res;
}

async function testBridgeCasConflict() {
  section('5 — Bridge-side ImagingRequest CAS conflict (gap-fill: CT-13 only covered the manual route pre-convergence)');
  const { fixtures, owner, clinicId } = await newFixture('bridge-cas');
  const { token } = await newBridgeAgent(clinicId, owner.id);
  const patient = await createTestPatient({ organizationId: fixtures.orgId, clinicId });
  const request = await prisma.imagingRequest.create({
    data: { clinicId, patientId: patient.id, requestedModality: 'IO', status: 'requested', requestedByUserId: owner.id },
  });

  await test('two concurrent bridge ingests racing to close the same open ImagingRequest: one wins (201), one loses (409) via the shared core\'s CAS, and the loser\'s file is compensated', async () => {
    const bufA = pngBuffer('bridge-cas-a');
    const bufB = pngBuffer('bridge-cas-b');
    const [resA, resB] = await Promise.all([
      callBridgeUpload(token, { ingestKey: sha256Hex(bufA), modality: 'IO', imagingRequestId: request.id }, fakeMulterFile('bridge-cas-a.png', 'image/png', bufA), '10.0.9.1'),
      callBridgeUpload(token, { ingestKey: sha256Hex(bufB), modality: 'IO', imagingRequestId: request.id }, fakeMulterFile('bridge-cas-b.png', 'image/png', bufB), '10.0.9.2'),
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort();
    assert.deepEqual(statuses, [201, 409], `expected exactly one winner (201) and one loser (409); got ${JSON.stringify(statuses)}`);
    const winner = resA.statusCode === 201 ? resA : resB;
    const loser = resA.statusCode === 409 ? resA : resB;
    assert.equal(loser.body.error, 'Imaging request is not open for new studies');

    const studyCount = await prisma.imagingStudy.count({ where: { clinicId } });
    assert.equal(studyCount, 1, 'only the winner\'s ImagingStudy may survive — the loser\'s transaction (including its unique ingestKey row) must fully roll back');
    assert.equal((await prisma.imagingStudy.findFirstOrThrow({ where: { clinicId } })).id, winner.body.studyId);

    const finalRequest = await prisma.imagingRequest.findUniqueOrThrow({ where: { id: request.id } });
    assert.equal(finalRequest.status, 'received');

    // Exactly one physical file remains — the loser's storageKey (written
    // before its own transaction failed) must have been compensated inside
    // the shared core, exactly like the manual route's CT-13 case.
    assert.equal(listClinicUploadFiles(clinicId).length, 1, 'the bridge loser\'s already-written file must have been removed by the core\'s compensation delete');
  });
}

// ─── Run ────────────────────────────────────────────────────────────────

async function main() {
  await testTenantScopedCas();
  await testPathSpecificFields();
  await testStructuralIsolation();
  await testBridgeCasConflict();

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
