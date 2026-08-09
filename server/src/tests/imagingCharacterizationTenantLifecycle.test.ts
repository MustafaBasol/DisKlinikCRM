/**
 * imagingCharacterizationTenantLifecycle.test.ts — F2-PREP-007-B Imaging
 * Stage 0 characterization: tenant isolation, RBAC, archive/unarchive
 * lifecycle immutability, ImagingRequest-relink consistency, bridge
 * heartbeat rate-limit mutation safety, and the three accepted Privacy/KVKK
 * direct-Prisma callers (docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md
 * §6/§9, characterization-test gate CT-02/CT-03/CT-05/CT-17/CT-23/CT-26/CT-30).
 *
 * TEST-ONLY. No application/runtime code is changed by this file. Every
 * assertion below characterizes CURRENT behavior as implemented in
 * server/src/routes/imaging.ts, server/src/routes/imagingBridgePublic.ts,
 * and server/src/services/privacy/{deletionReviewInventory,orphanFileInspection,
 * patientAnonymization}.ts at this task's baseline commit — it does not
 * introduce the ImagingLifecyclePort facade and does not alter any of the
 * direct-Prisma call sites it observes.
 *
 * Exercises the REAL Express route handlers (extracted from the actual
 * router stacks, same technique as
 * server/src/tests/dbVerification/kvkkHigh006DbClinicScopeAccess.test.ts)
 * and the REAL exported Privacy service functions, against a REAL disposable
 * PostgreSQL instance via the real Prisma client (server/src/db.ts). No
 * mocking of clinicScope/authorize/rate-limiter logic.
 *
 * CT-23 note (F2-CT-23, fixed): the characterization-test catalogue's own
 * assertion text for CT-23 ("a study originating from an ImagingRequest
 * cannot be relinked inconsistently with that request's own patient") did
 * NOT hold against the behavior at this suite's original authoring baseline
 * — see docs/program/evidence/F2-PREP-007-B_IMAGING_CHARACTERIZATION_TENANT_LIFECYCLE_EVIDENCE.md
 * for that original VERIFIED_DEFECT finding (reproduced twice against the
 * then-current permissive behavior). Task F2-CT-23 closed that gap:
 * `PATCH /imaging/studies/:id/link` (server/src/routes/imaging.ts) now
 * rejects (409) relinking a request-originated study to a patient other
 * than that request's own patientId, via a guarded conditional update that
 * re-checks the invariant at commit time. The two reproductions below are
 * updated in place to assert the corrected (fail-closed) behavior — see
 * server/src/tests/dbVerification/imagingStudyRequestPatientConsistency.test.ts
 * for the full F2-CT-23 regression suite (all contract cases, cross-clinic/
 * cross-org, nonexistent request, concurrency).
 *
 * Run (requires DATABASE_URL pointing at a disposable Postgres with
 * migrations applied):
 *   cd server && npx tsx src/tests/imagingCharacterizationTenantLifecycle.test.ts
 *
 * Deterministic cleanup: every clinic/org/patient/user/imaging/privacy row
 * and every physical test file this run creates is deleted in a `finally`
 * block, in FK-safe order, regardless of pass/fail. All fixture names carry
 * a per-run `randomUUID()` suffix (via dbVerificationHarness's
 * createClinicFixtureSet/createStaffUser/createTestPatient) so parallel runs
 * of this file (or of the sibling F2-PREP-007-A/C suites) cannot collide.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import imagingRouter from '../routes/imaging.js';
import imagingBridgePublicRouter from '../routes/imagingBridgePublic.js';
import { generateBridgeToken } from '../services/imaging/bridgeTokens.js';
import { generatePairingCode, hashPairingCode } from '../services/imaging/bridgePairing.js';
import { saveFile, buildStorageKey } from '../services/fileStorage.js';
import { buildDeletionReviewInventory } from '../services/privacy/deletionReviewInventory.js';
import { inspectOrphans, markConfirmedMissing } from '../services/privacy/orphanFileInspection.js';
import { anonymizePatientData } from '../services/privacy/patientAnonymization.js';
import {
  createSuite,
  createClinicFixtureSet,
  createStaffUser,
  createTestPatient,
  cleanupAllFixtures,
  authRequest,
  mockResponse,
  getFullChain,
  getHandlerOnly,
  runChain,
  prisma,
  type MockResponse,
} from './dbVerification/dbVerificationHarness.js';

const { section, test, summary } = createSuite('Imaging-Characterization-Tenant-Lifecycle');

// ─── Cleanup tracking (deterministic, FK-safe, finally-block only) ─────────

const allFixtureClinicIds: string[] = [];
const createdUploadDirs: string[] = [];

function trackClinics(...ids: string[]) {
  allFixtureClinicIds.push(...ids);
}

/**
 * Deletes every Imaging/BRG/Privacy-request row scoped to this run's fixture
 * clinics, in FK-safe order, BEFORE handing off to the shared harness's
 * cleanupAllFixtures() (which deletes Patient/User/Clinic/Organization).
 * ImagingBridgePairingDevice is not listed explicitly — its FK to
 * ImagingBridgePairing is `onDelete: Cascade` in the schema, so it is
 * removed automatically when its parent pairing row is deleted.
 */
async function cleanupImagingFixtures(): Promise<void> {
  if (allFixtureClinicIds.length === 0) return;
  const clinicId = { in: allFixtureClinicIds };

  await prisma.imagingImage.deleteMany({ where: { clinicId } });
  await prisma.imagingStudy.deleteMany({ where: { clinicId } });
  await prisma.imagingBridgeBinding.deleteMany({ where: { clinicId } });
  await prisma.imagingBridgeAgent.deleteMany({ where: { clinicId } });
  await prisma.imagingBridgePairing.deleteMany({ where: { clinicId } });
  await prisma.imagingRequest.deleteMany({ where: { clinicId } });
  await prisma.imagingDevice.deleteMany({ where: { clinicId } });
  await prisma.patientPrivacyRequest.deleteMany({ where: { clinicId } });
}

async function cleanupUploadDirs(): Promise<void> {
  for (const dir of createdUploadDirs) {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── Local helpers ──────────────────────────────────────────────────────

const BASE_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

function localFilePath(storageKey: string): string {
  return path.join(BASE_UPLOAD_DIR, storageKey);
}

/** Writes a synthetic image file directly to storage (bypasses the upload route — none of CT-02/03/05/17/23/26/30 need to exercise multipart upload). */
async function writeTestImageFile(clinicId: string, content: Buffer): Promise<string> {
  const key = buildStorageKey(clinicId, `${randomUUID()}.bin`);
  await saveFile(key, content, 'application/octet-stream');
  createdUploadDirs.push(path.dirname(localFilePath(key)));
  return key;
}

/** Minimal Request-like stub for the public (non-session) bridge router — heartbeat/pair take no `user`, only headers/body/ip. */
function publicRequest(opts: { headers?: Record<string, string>; body?: any; ip?: string }): any {
  return {
    headers: opts.headers ?? {},
    body: opts.body ?? {},
    ip: opts.ip ?? '203.0.113.5',
    method: 'POST',
    path: '/test',
  };
}

/**
 * Finds real Prisma client operations on a given model — `prisma.<model>.<method>(` or
 * `tx.<model>.<method>(` — and returns each call's full argument text (via
 * balanced-parenthesis scanning, not a fixed-shape regex, so differences in
 * formatting/line-wrapping never produce a false negative). Deliberately
 * does NOT match bare occurrences of the model name in comments, imports,
 * type annotations, or unrelated identifiers — only an actual client method
 * invocation counts as an "operation" here (CT-03 static-scope check).
 */
function findPrismaModelOperations(text: string, modelName: string): Array<{ method: string; argsText: string }> {
  const callPattern = new RegExp(`\\b(?:prisma|tx)\\.${modelName}\\.(\\w+)\\(`, 'g');
  const results: Array<{ method: string; argsText: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(text))) {
    const openParenIndex = match.index + match[0].length - 1;
    let depth = 0;
    let i = openParenIndex;
    for (; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    results.push({ method: match[1]!, argsText: text.slice(openParenIndex + 1, i) });
  }
  return results;
}

async function main() {
  // ═══════════════════════════════════════════════════════════════════════
  // CT-02 — ListPatientImaging rejects cross-clinic patient/study access
  // ═══════════════════════════════════════════════════════════════════════
  section('CT-02: ListPatientImaging cross-clinic rejection');
  {
    const fx = await createClinicFixtureSet('ct02');
    trackClinics(fx.defaultClinicId, fx.siblingClinicId, fx.unauthorizedClinicId, fx.crossOrgClinicId);

    const staffDefault = await createStaffUser({
      organizationId: fx.orgId,
      clinicId: fx.defaultClinicId,
      role: 'OWNER',
      allowedClinicIds: [fx.defaultClinicId, fx.siblingClinicId],
    });
    const patientDefault = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId });
    const patientSibling = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.siblingClinicId });
    const patientCrossOrg = await createTestPatient({ organizationId: fx.otherOrgId, clinicId: fx.crossOrgClinicId });

    const ownStudy = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patientDefault.id, modality: 'PX', status: 'active' },
    });
    const siblingStudy = await prisma.imagingStudy.create({
      data: { clinicId: fx.siblingClinicId, patientId: patientSibling.id, modality: 'PX', status: 'active' },
    });
    const crossOrgStudy = await prisma.imagingStudy.create({
      data: { clinicId: fx.crossOrgClinicId, patientId: patientCrossOrg.id, modality: 'PX', status: 'active' },
    });

    const chain = getFullChain(imagingRouter as any, 'get', '/patients/:patientId/imaging');

    await test('own-clinic patient with a study returns 200 and includes that study (positive control)', async () => {
      const req = authRequest(staffDefault, { params: { patientId: patientDefault.id } });
      const res = mockResponse();
      await runChain(chain, req, res);
      assert.equal(res.statusCode, 200);
      const ids = (res.body as any[]).map((s) => s.id);
      assert.ok(ids.includes(ownStudy.id));
    });

    await test('cross-org patientId (valid id, different organization entirely) resolves to 404, never the record', async () => {
      const req = authRequest(staffDefault, { params: { patientId: patientCrossOrg.id } });
      const res = mockResponse();
      await runChain(chain, req, res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.body?.error, 'Patient not found');
    });

    await test('cross-org study data was never touched by the rejected lookup', async () => {
      const row = await prisma.imagingStudy.findUnique({ where: { id: crossOrgStudy.id } });
      assert.ok(row);
      assert.equal(row!.clinicId, fx.crossOrgClinicId);
      assert.equal(row!.patientId, patientCrossOrg.id);
    });

    await test('sibling-clinic patient (same org, explicitly authorized via allowedClinicIds) IS reachable — proves the 404 above is real tenant isolation, not a blanket failure', async () => {
      const req = authRequest(staffDefault, { params: { patientId: patientSibling.id }, query: { clinicId: fx.siblingClinicId } });
      const res = mockResponse();
      await runChain(chain, req, res);
      assert.equal(res.statusCode, 200);
      const ids = (res.body as any[]).map((s) => s.id);
      assert.ok(ids.includes(siblingStudy.id));
    });

    await test('same-org but unassigned clinic (unauthorizedClinicId) requested via ?clinicId= is denied 403 before any patient lookup', async () => {
      const req = authRequest(staffDefault, { params: { patientId: patientDefault.id }, query: { clinicId: fx.unauthorizedClinicId } });
      const res = mockResponse();
      await runChain(chain, req, res);
      assert.equal(res.statusCode, 403);
    });

    await test('DEFENSE IN DEPTH: a data-inconsistent ImagingStudy row (clinicId=B, but its patientId belongs to clinic A) never leaks into a clinic-A-scoped list, because the underlying query scopes ImagingStudy.clinicId directly, not only via the patient join', async () => {
      // Prisma's schema does not enforce ImagingStudy.clinicId === patient's
      // own clinicId at the DB level (patientId is a plain FK to Patient,
      // with no cross-column check constraint) — this simulates that
      // pathological/future-bug state directly to prove the route's own
      // `imagingStudy.findMany({ where: { patientId, ...scope } })` clause
      // is itself clinic-scoped, independent of patient-level correctness.
      const rogueStudy = await prisma.imagingStudy.create({
        data: { clinicId: fx.crossOrgClinicId, patientId: patientDefault.id, modality: 'PX', status: 'active' },
      });
      try {
        const req = authRequest(staffDefault, { params: { patientId: patientDefault.id } });
        const res = mockResponse();
        await runChain(chain, req, res);
        assert.equal(res.statusCode, 200);
        const ids = (res.body as any[]).map((s) => s.id);
        assert.ok(!ids.includes(rogueStudy.id), 'a study whose own clinicId does not match the requester scope must never leak, even with a matching patientId');
        assert.ok(ids.includes(ownStudy.id));
      } finally {
        await prisma.imagingStudy.delete({ where: { id: rogueStudy.id } });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CT-03 — ImagingBridgePairingDevice access remains tenant-scoped through
  // its parent pairing (the table has no own clinicId column)
  // ═══════════════════════════════════════════════════════════════════════
  section('CT-03: ImagingBridgePairingDevice tenant scoping via parent pairing');
  {
    // Static scope check first (bounded to the Imaging/Privacy files this
    // task already read — not a whole-repo scan): every REAL Prisma client
    // operation on imagingBridgePairingDevice must be scoped by a resolved
    // pairingId. Detection is limited to actual `prisma.` / `tx.` client
    // calls (via findPrismaModelOperations below) — a raw substring count
    // would also match comments, imports, or type references and make an
    // unrelated, behavior-preserving edit (e.g. a new comment mentioning the
    // model name) fail this test for no real reason.
    await test('STATIC: every real Prisma operation on imagingBridgePairingDevice is scoped by pairingId, and at least one such operation exists (not a vacuous pass)', async () => {
      const candidateFiles = [
        '../routes/imaging.ts',
        '../routes/imagingBridgePublic.ts',
        '../services/privacy/deletionReviewInventory.ts',
        '../services/privacy/orphanFileInspection.ts',
        '../services/privacy/patientAnonymization.ts',
      ];
      const operations: Array<{ file: string; method: string; argsText: string }> = [];
      for (const rel of candidateFiles) {
        const abs = new URL(rel, import.meta.url);
        const text = fs.readFileSync(abs, 'utf8');
        for (const op of findPrismaModelOperations(text, 'imagingBridgePairingDevice')) {
          operations.push({ file: rel, ...op });
        }
      }
      assert.ok(
        operations.length >= 1,
        'expected at least one real prisma/tx.imagingBridgePairingDevice.<method>(...) call across the scanned Imaging/Privacy files — zero would make the scoping assertion below pass vacuously',
      );
      for (const op of operations) {
        assert.match(
          op.argsText,
          /\bpairingId\s*:/,
          `${op.file}: imagingBridgePairingDevice.${op.method}(...) must be scoped by a pairingId filter/value; got args starting "${op.argsText.trim().slice(0, 120)}"`,
        );
      }
    });

    const fx = await createClinicFixtureSet('ct03');
    trackClinics(fx.defaultClinicId, fx.crossOrgClinicId);

    const staffA = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
    const staffB = await createStaffUser({ organizationId: fx.otherOrgId, clinicId: fx.crossOrgClinicId, role: 'OWNER' });

    const deviceA = await prisma.imagingDevice.create({ data: { clinicId: fx.defaultClinicId, name: 'Device A', modality: 'PX', createdById: staffA.id } });
    const deviceB = await prisma.imagingDevice.create({ data: { clinicId: fx.crossOrgClinicId, name: 'Device B', modality: 'CT', createdById: staffB.id } });

    const codeA = generatePairingCode();
    const codeB = generatePairingCode();
    const pairingA = await prisma.imagingBridgePairing.create({
      data: {
        clinicId: fx.defaultClinicId, createdById: staffA.id, codeHash: hashPairingCode(codeA),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), bridgeName: 'Bridge A',
        devices: { create: [{ deviceId: deviceA.id, modality: deviceA.modality }] },
      },
    });
    const pairingB = await prisma.imagingBridgePairing.create({
      data: {
        clinicId: fx.crossOrgClinicId, createdById: staffB.id, codeHash: hashPairingCode(codeB),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), bridgeName: 'Bridge B',
        devices: { create: [{ deviceId: deviceB.id, modality: deviceB.modality }] },
      },
    });

    const pairHandler = getHandlerOnly(imagingBridgePublicRouter as any, 'post', '/imaging/bridge/pair');

    let agentAId = '';
    await test('redeeming clinic A\'s pairing code binds ONLY clinic A\'s device, never clinic B\'s', async () => {
      const req = publicRequest({ body: { code: codeA, installationId: `install-a-${randomUUID()}`, agentVersion: '1.0.0' } });
      const res = mockResponse();
      await pairHandler(req, res as any, () => {});
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
      assert.equal(res.body.bindings.length, 1);
      assert.equal(res.body.bindings[0].deviceId, deviceA.id);
      agentAId = res.body.bridgeAgentId;
    });

    await test('the created agent/binding rows are scoped to clinic A only, at the DB level', async () => {
      const agent = await prisma.imagingBridgeAgent.findUnique({ where: { id: agentAId } });
      assert.ok(agent);
      assert.equal(agent!.clinicId, fx.defaultClinicId);
      const bindings = await prisma.imagingBridgeBinding.findMany({ where: { bridgeAgentId: agentAId } });
      assert.equal(bindings.length, 1);
      assert.equal(bindings[0]!.deviceId, deviceA.id);
      assert.notEqual(bindings[0]!.deviceId, deviceB.id);
    });

    let agentBId = '';
    await test('redeeming clinic B\'s pairing code binds ONLY clinic B\'s device — proves isolation both directions, not just one', async () => {
      const req = publicRequest({ body: { code: codeB, installationId: `install-b-${randomUUID()}`, agentVersion: '1.0.0' } });
      const res = mockResponse();
      await pairHandler(req, res as any, () => {});
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
      assert.equal(res.body.bindings.length, 1);
      assert.equal(res.body.bindings[0].deviceId, deviceB.id);
      agentBId = res.body.bridgeAgentId;
    });

    await test('clinic A and clinic B agents/bindings remain fully disjoint after both redemptions', async () => {
      const agentA = await prisma.imagingBridgeAgent.findUnique({ where: { id: agentAId } });
      const agentB = await prisma.imagingBridgeAgent.findUnique({ where: { id: agentBId } });
      assert.equal(agentA!.clinicId, fx.defaultClinicId);
      assert.equal(agentB!.clinicId, fx.crossOrgClinicId);
      const bindingsA = await prisma.imagingBridgeBinding.findMany({ where: { bridgeAgentId: agentAId } });
      const bindingsB = await prisma.imagingBridgeBinding.findMany({ where: { bridgeAgentId: agentBId } });
      assert.deepEqual(bindingsA.map((b) => b.deviceId), [deviceA.id]);
      assert.deepEqual(bindingsB.map((b) => b.deviceId), [deviceB.id]);
    });

    // Re-fetch the pairing rows fresh — imagingBridgePairing.id is stable but
    // re-selecting confirms the redemption actually persisted status/usedAt,
    // not just an in-memory response shape.
    await test('both pairing sessions transitioned to redeemed, independently', async () => {
      const pA = await prisma.imagingBridgePairing.findUnique({ where: { id: pairingA.id } });
      const pB = await prisma.imagingBridgePairing.findUnique({ where: { id: pairingB.id } });
      assert.equal(pA!.status, 'redeemed');
      assert.equal(pB!.status, 'redeemed');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CT-05 — SetImagingLegalHold permits only OWNER/ORG_ADMIN
  // ═══════════════════════════════════════════════════════════════════════
  section('CT-05: SetImagingLegalHold RBAC gate');
  {
    const fx = await createClinicFixtureSet('ct05');
    trackClinics(fx.defaultClinicId);

    const study = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, modality: 'PX', status: 'active' },
    });

    const chain = getFullChain(imagingRouter as any, 'patch', '/imaging/studies/:id/legal-hold');

    const rejectedRoles = ['CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST'] as const;
    for (const role of rejectedRoles) {
      const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role });
      await test(`${role} is rejected 403 and does not mutate legalHold`, async () => {
        const req = authRequest(staff, { params: { id: study.id }, body: { legalHold: true, reason: 'attempted by unauthorized role' } });
        const res = mockResponse();
        await runChain(chain, req, res);
        assert.equal(res.statusCode, 403);
        const row = await prisma.imagingStudy.findUnique({ where: { id: study.id } });
        assert.equal(row!.legalHold, false, `${role} must not be able to mutate legalHold`);
        assert.equal(row!.legalHoldReason, null);
      });
    }

    const owner = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
    await test('OWNER succeeds and sets legalHold=true with the reason persisted', async () => {
      const req = authRequest(owner, { params: { id: study.id }, body: { legalHold: true, reason: 'OWNER placing a legal hold' } });
      const res = mockResponse();
      await runChain(chain, req, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.legalHold, true);
      const row = await prisma.imagingStudy.findUnique({ where: { id: study.id } });
      assert.equal(row!.legalHold, true);
      assert.equal(row!.legalHoldReason, 'OWNER placing a legal hold');
    });

    const orgAdmin = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'ORG_ADMIN' });
    await test('ORG_ADMIN succeeds and can release the same hold', async () => {
      const req = authRequest(orgAdmin, { params: { id: study.id }, body: { legalHold: false, reason: 'ORG_ADMIN releasing the hold' } });
      const res = mockResponse();
      await runChain(chain, req, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.legalHold, false);
      const row = await prisma.imagingStudy.findUnique({ where: { id: study.id } });
      assert.equal(row!.legalHold, false);
      assert.equal(row!.legalHoldReason, 'ORG_ADMIN releasing the hold');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CT-17 — archive/unarchive changes only ImagingStudy.status; no
  // ImagingImage row or physical file is changed
  // ═══════════════════════════════════════════════════════════════════════
  section('CT-17: archive/unarchive touches only ImagingStudy.status');
  {
    const fx = await createClinicFixtureSet('ct17');
    trackClinics(fx.defaultClinicId);

    const owner = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
    const study = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, modality: 'PX', status: 'active' },
    });
    const content = Buffer.from(`ct17-image-${randomUUID()}`);
    const storageKey = await writeTestImageFile(fx.defaultClinicId, content);
    const image = await prisma.imagingImage.create({
      data: {
        clinicId: fx.defaultClinicId, studyId: study.id, fileName: 'ct17.bin', originalName: 'ct17-original.bin',
        fileSize: content.length, mimeType: 'application/octet-stream', filePath: storageKey,
      },
    });
    const localPath = localFilePath(storageKey);
    const beforeStat = await fs.promises.stat(localPath);
    const beforeImageRow = await prisma.imagingImage.findUniqueOrThrow({ where: { id: image.id } });

    const archiveChain = getFullChain(imagingRouter as any, 'patch', '/imaging/studies/:id/archive');
    const unarchiveChain = getFullChain(imagingRouter as any, 'patch', '/imaging/studies/:id/unarchive');

    let studyUpdatedAtAfterArchive: Date;
    await test('archive changes ImagingStudy.status to archived; ImagingImage row and physical file bytes/mtime are byte-for-byte unchanged', async () => {
      const req = authRequest(owner, { params: { id: study.id } });
      const res = mockResponse();
      await runChain(archiveChain, req, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.status, 'archived');

      const studyRow = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: study.id } });
      assert.equal(studyRow.status, 'archived');
      studyUpdatedAtAfterArchive = studyRow.updatedAt;

      const imageRow = await prisma.imagingImage.findUniqueOrThrow({ where: { id: image.id } });
      assert.deepEqual(imageRow, beforeImageRow, 'ImagingImage row must be identical in every field after archiving its parent study');

      const afterStat = await fs.promises.stat(localPath);
      assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs, 'physical file mtime must not change');
      assert.equal(afterStat.size, beforeStat.size, 'physical file size must not change');
      const bytes = await fs.promises.readFile(localPath);
      assert.ok(bytes.equals(content), 'physical file content must be byte-for-byte identical');
    });

    await test('IDEMPOTENCY: archiving an already-archived study is a same-status short-circuit — no second DB write (updatedAt unchanged)', async () => {
      const req = authRequest(owner, { params: { id: study.id } });
      const res = mockResponse();
      await runChain(archiveChain, req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.status, 'archived');
      const studyRow = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: study.id } });
      assert.equal(studyRow.updatedAt.getTime(), studyUpdatedAtAfterArchive!.getTime(), 'a same-status archive call must not re-issue an UPDATE (setStudyStatus short-circuit)');
    });

    await test('unarchive restores status to active; ImagingImage row and physical file remain untouched', async () => {
      const req = authRequest(owner, { params: { id: study.id } });
      const res = mockResponse();
      await runChain(unarchiveChain, req, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.status, 'active');

      const studyRow = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: study.id } });
      assert.equal(studyRow.status, 'active');

      const imageRow = await prisma.imagingImage.findUniqueOrThrow({ where: { id: image.id } });
      assert.deepEqual(imageRow, beforeImageRow, 'ImagingImage row must still be identical after unarchiving');

      const afterStat = await fs.promises.stat(localPath);
      assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
      const bytes = await fs.promises.readFile(localPath);
      assert.ok(bytes.equals(content));
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CT-23 — study-from-ImagingRequest relink consistency (FIXED — F2-CT-23)
  // ═══════════════════════════════════════════════════════════════════════
  section('CT-23: relink consistency against the originating ImagingRequest (fixed, reconfirmed twice)');
  {
    const linkChain = getFullChain(imagingRouter as any, 'patch', '/imaging/studies/:id/link');

    async function runRelinkScenario(label: string) {
      const fx = await createClinicFixtureSet(`ct23-${label}`);
      trackClinics(fx.defaultClinicId);
      const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });
      const patientOriginal = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'Original' });
      const patientOther = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'Different' });

      const request = await prisma.imagingRequest.create({
        data: {
          clinicId: fx.defaultClinicId, patientId: patientOriginal.id, requestedModality: 'PX',
          status: 'requested', requestedByUserId: staff.id,
        },
      });
      // Mirrors exactly what CreateImagingStudy/IngestImagingStudy produce
      // when a study is created from an open ImagingRequest: patientId is
      // inherited from the request, imagingRequestId points back to it.
      const study = await prisma.imagingStudy.create({
        data: {
          clinicId: fx.defaultClinicId, patientId: patientOriginal.id, imagingRequestId: request.id,
          modality: 'PX', status: 'active',
        },
      });

      const req = authRequest(staff, { params: { id: study.id }, body: { patientId: patientOther.id } });
      const res = mockResponse();
      await runChain(linkChain, req, res);
      return { fx, staff, patientOriginal, patientOther, request, study, res };
    }

    await test('RECONFIRMATION 1/2: relinking a request-originated study to a DIFFERENT patient than the request\'s own patient is now REJECTED (409), state left untouched', async () => {
      const { patientOriginal, study, request, res } = await runRelinkScenario('a');
      assert.equal(res.statusCode, 409, `expected the fixed (fail-closed) behavior to reject the relink; got ${res.statusCode}: ${JSON.stringify(res.body)}`);
      const studyRow = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: study.id }, include: { imagingRequest: true } });
      assert.equal(studyRow.patientId, patientOriginal.id, 'rejected relink must leave study.patientId unchanged');
      assert.equal(studyRow.imagingRequestId, request.id, 'rejected relink must leave imagingRequestId unchanged');
      assert.equal(
        studyRow.patientId,
        studyRow.imagingRequest!.patientId,
        'study.patientId and its still-referenced ImagingRequest.patientId remain consistent after the rejected write',
      );
    });

    await test('RECONFIRMATION 2/2: identical result on an independent fixture set — the fail-closed behavior is deterministic, not a one-off/flake', async () => {
      const { patientOriginal, study, res } = await runRelinkScenario('b');
      assert.equal(res.statusCode, 409, `expected the fixed (fail-closed) behavior to reject the relink; got ${res.statusCode}: ${JSON.stringify(res.body)}`);
      const studyRow = await prisma.imagingStudy.findUniqueOrThrow({ where: { id: study.id }, include: { imagingRequest: true } });
      assert.equal(studyRow.patientId, patientOriginal.id);
      assert.equal(studyRow.patientId, studyRow.imagingRequest!.patientId);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CT-26 — rejected/rate-limited heartbeat does not mutate bridge
  // lastSeenAt or status
  // ═══════════════════════════════════════════════════════════════════════
  section('CT-26: rate-limited heartbeat does not mutate ImagingBridgeAgent');
  {
    const fx = await createClinicFixtureSet('ct26');
    trackClinics(fx.defaultClinicId);
    const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });

    const { token, tokenHash } = generateBridgeToken();
    const agent = await prisma.imagingBridgeAgent.create({
      data: { clinicId: fx.defaultClinicId, name: 'CT-26 Agent', tokenHash, status: 'pending', createdById: staff.id },
    });

    const heartbeatHandler = getHandlerOnly(imagingBridgePublicRouter as any, 'post', '/imaging/bridge/heartbeat');
    const authHeader = { authorization: `Bearer ${token}` };

    // heartbeatTokenLimiter is 6 requests / 60s per tokenHash
    // (server/src/routes/imagingBridgePublic.ts:52) — this run's token is
    // freshly random, so its in-memory counter starts at zero regardless of
    // any other concurrently-running suite.
    await test('first 6 heartbeats within the per-token limit all succeed and mark the agent online', async () => {
      for (let i = 0; i < 6; i++) {
        const req = publicRequest({ headers: authHeader, body: { agentVersion: '1.0.0' } });
        const res: MockResponse = mockResponse();
        await heartbeatHandler(req, res as any, () => {});
        assert.equal(res.statusCode, 200, `heartbeat #${i + 1} expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
      }
      const row = await prisma.imagingBridgeAgent.findUniqueOrThrow({ where: { id: agent.id } });
      assert.equal(row.status, 'online');
      assert.ok(row.lastSeenAt, 'lastSeenAt must be set after a successful heartbeat');
    });

    await test('the 7th heartbeat within the same window is 429 and does NOT mutate lastSeenAt/status', async () => {
      const before = await prisma.imagingBridgeAgent.findUniqueOrThrow({ where: { id: agent.id } });

      const req = publicRequest({ headers: authHeader, body: { agentVersion: '1.0.0' } });
      const res: MockResponse = mockResponse();
      await heartbeatHandler(req, res as any, () => {});
      assert.equal(res.statusCode, 429, JSON.stringify(res.body));

      const after = await prisma.imagingBridgeAgent.findUniqueOrThrow({ where: { id: agent.id } });
      assert.equal(after.lastSeenAt?.getTime(), before.lastSeenAt?.getTime(), 'lastSeenAt must be unchanged by a rate-limited heartbeat');
      assert.equal(after.status, before.status, 'status must be unchanged by a rate-limited heartbeat');
      assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), 'no row mutation of any kind on a rejected heartbeat');
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CT-30 — characterize current deletionReviewInventory / orphanFileInspection
  // / patientAnonymization Imaging access, as a baseline for a future
  // ImagingLifecyclePort migration to prove identical results against.
  // ═══════════════════════════════════════════════════════════════════════
  section('CT-30: current Privacy/KVKK direct-Imaging-access callers (baseline for ImagingLifecyclePort)');
  {
    const fx = await createClinicFixtureSet('ct30');
    trackClinics(fx.defaultClinicId);
    const staff = await createStaffUser({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, role: 'OWNER' });

    // ── 30a: buildDeletionReviewInventory (DAV-01) ─────────────────────────
    const patientDeletion = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'DeletionReview' });
    const studyPlain = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patientDeletion.id, modality: 'PX', status: 'active', legalHold: false },
    });
    const studyHeld = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patientDeletion.id, modality: 'CT', status: 'active', legalHold: true, legalHoldReason: 'pending litigation' },
    });
    await prisma.imagingImage.create({
      data: { clinicId: fx.defaultClinicId, studyId: studyPlain.id, fileName: 'a.bin', originalName: 'a.bin', fileSize: 100, mimeType: 'application/octet-stream', filePath: `${fx.defaultClinicId}/a.bin` },
    });
    await prisma.imagingImage.create({
      data: { clinicId: fx.defaultClinicId, studyId: studyHeld.id, fileName: 'b.bin', originalName: 'b.bin', fileSize: 200, mimeType: 'application/octet-stream', filePath: `${fx.defaultClinicId}/b.bin` },
    });

    await test('buildDeletionReviewInventory: reads ImagingImage via {clinicId, study:{patientId}}, reports total/legalHold counts and IMAGING_* blockers exactly as implemented today', async () => {
      const inventory = await buildDeletionReviewInventory({ clinicId: fx.defaultClinicId, patientId: patientDeletion.id, organizationId: fx.orgId });
      assert.equal(inventory.imaging.total, 2);
      assert.equal(inventory.imaging.legalHold, 1);
      assert.equal(inventory.imaging.retainedClinical, 2);
      assert.equal(inventory.imaging.estimatedBytes, 300);
      const blockerCodes = inventory.blockers.map((b) => b.code);
      assert.ok(blockerCodes.includes('IMAGING_RETENTION_NOT_APPROVED'), 'any imaging presence at all currently blocks a dry-run deletion');
      assert.ok(blockerCodes.includes('IMAGING_LEGAL_HOLD'), 'legal-hold imaging is reported as its own distinct blocker');
    });

    // ── 30b: orphanFileInspection (DAV-02 / SB-01 / SMB-01) ────────────────
    const patientOrphan = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'OrphanInspection' });
    const studyForOrphan = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patientOrphan.id, modality: 'PX', status: 'active' },
    });
    const presentContent = Buffer.from(`ct30-present-${randomUUID()}`);
    const presentKey = await writeTestImageFile(fx.defaultClinicId, presentContent);
    const presentImage = await prisma.imagingImage.create({
      data: { clinicId: fx.defaultClinicId, studyId: studyForOrphan.id, fileName: 'present.bin', originalName: 'present.bin', fileSize: presentContent.length, mimeType: 'application/octet-stream', filePath: presentKey },
    });
    const missingKey = `${fx.defaultClinicId}/${randomUUID()}-does-not-exist.bin`;
    const missingImage = await prisma.imagingImage.create({
      data: { clinicId: fx.defaultClinicId, studyId: studyForOrphan.id, fileName: 'missing.bin', originalName: 'missing.bin', fileSize: 42, mimeType: 'application/octet-stream', filePath: missingKey },
    });

    await test('inspectOrphans: classifies ImagingImage rows via {clinicId, study:{patientId}} + a live fileExists() check, exactly as implemented today', async () => {
      const result = await inspectOrphans({ clinicId: fx.defaultClinicId, patientId: patientOrphan.id });
      assert.equal(result.checked, 2);
      assert.equal(result.dbRowPhysicalMissing, 1);
      assert.equal(result.activeLinkedObject, 1);
      const missingEntry = result.entries.find((e) => e.id === missingImage.id);
      const presentEntry = result.entries.find((e) => e.id === presentImage.id);
      assert.equal(missingEntry?.classification, 'dbRowPhysicalMissing');
      assert.equal(presentEntry?.classification, 'activeLinkedObject');
      assert.equal(missingEntry?.kind, 'imaging_image');
    });

    await test('markConfirmedMissing: stamps storageVerifiedMissingAt only on the confirmed-missing ImagingImage row, never the present one', async () => {
      const result = await markConfirmedMissing(fx.defaultClinicId, [{ id: missingImage.id, kind: 'imaging_image' }]);
      assert.equal(result.marked, 1);
      const missingRow = await prisma.imagingImage.findUniqueOrThrow({ where: { id: missingImage.id } });
      const presentRow = await prisma.imagingImage.findUniqueOrThrow({ where: { id: presentImage.id } });
      assert.ok(missingRow.storageVerifiedMissingAt, 'confirmed-missing row must be stamped');
      assert.equal(presentRow.storageVerifiedMissingAt, null, 'present row must never be touched by marking a different row missing');
    });

    // ── 30c: patientAnonymization (SMB-02, redactPatientImagingImages) ─────
    const patientAnon = await createTestPatient({ organizationId: fx.orgId, clinicId: fx.defaultClinicId, firstName: 'AnonTarget' });
    const studyAnonPlain = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patientAnon.id, modality: 'PX', status: 'active', legalHold: false },
    });
    const studyAnonHeld = await prisma.imagingStudy.create({
      data: { clinicId: fx.defaultClinicId, patientId: patientAnon.id, modality: 'CT', status: 'active', legalHold: true, legalHoldReason: 'hold' },
    });
    const imagePlain = await prisma.imagingImage.create({
      data: { clinicId: fx.defaultClinicId, studyId: studyAnonPlain.id, fileName: 'p.bin', originalName: 'patient-face-photo.jpg', fileSize: 10, mimeType: 'application/octet-stream', filePath: `${fx.defaultClinicId}/p.bin` },
    });
    const imageHeld = await prisma.imagingImage.create({
      data: { clinicId: fx.defaultClinicId, studyId: studyAnonHeld.id, fileName: 'h.bin', originalName: 'held-photo.jpg', fileSize: 10, mimeType: 'application/octet-stream', filePath: `${fx.defaultClinicId}/h.bin` },
    });

    await test('anonymizePatientData: redacts ImagingImage.originalName for non-legal-hold rows via {clinicId, study:{patientId}}, skips legal-hold rows entirely, exactly as implemented today', async () => {
      const result = await anonymizePatientData({
        clinicId: fx.defaultClinicId, patientId: patientAnon.id, actorUserId: staff.id,
        actorRole: staff.role, organizationId: fx.orgId, reason: 'CT-30 characterization run',
      });
      assert.equal(result.imagingResults.total, 2);
      assert.equal(result.imagingResults.redacted, 1);
      assert.equal(result.imagingResults.skippedLegalHold, 1);
      assert.equal(result.imagingResults.failed, 0);
      assert.equal(result.partialFailure, false);

      const plainRow = await prisma.imagingImage.findUniqueOrThrow({ where: { id: imagePlain.id } });
      const heldRow = await prisma.imagingImage.findUniqueOrThrow({ where: { id: imageHeld.id } });
      assert.equal(plainRow.originalName, '[ANONYMIZED]');
      assert.equal(heldRow.originalName, 'held-photo.jpg', 'legal-hold image metadata must be left completely untouched by anonymization');
    });

    await test('anonymizePatientData is idempotent on ImagingImage redaction: re-running on an already-anonymized patient does not error and reports the already-redacted row as skipped-by-content, not re-failed', async () => {
      const second = await anonymizePatientData({
        clinicId: fx.defaultClinicId, patientId: patientAnon.id, actorUserId: staff.id,
        actorRole: staff.role, organizationId: fx.orgId, reason: 'second run',
      });
      assert.equal(second.alreadyAnonymized, true);
      assert.equal(second.imagingResults.failed, 0);
      const plainRow = await prisma.imagingImage.findUniqueOrThrow({ where: { id: imagePlain.id } });
      assert.equal(plainRow.originalName, '[ANONYMIZED]', 'still anonymized, not double-mutated or reverted');
    });
  }

  const ok = summary();
  return ok;
}

main()
  .then(async (ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((err) => {
    console.error('[imaging-characterization-tenant-lifecycle] Fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanupImagingFixtures();
    } catch (err) {
      console.error('[imaging-characterization-tenant-lifecycle] cleanupImagingFixtures failed:', err);
      process.exitCode = 1;
    }
    try {
      await cleanupAllFixtures();
    } catch (err) {
      console.error('[imaging-characterization-tenant-lifecycle] cleanupAllFixtures failed:', err);
      process.exitCode = 1;
    }
    await cleanupUploadDirs();
    await prisma.$disconnect().catch(() => {});
  });
