/**
 * imaging.test.ts — Tests for the Imaging / Device Integration Foundation (Phase 1).
 *
 * Covers:
 *  1. DICOM Part-10 / image signature validation (synthetic buffers — never
 *     real patient images)
 *  2. ImagingRequest status-transition rules (terminal states, study attach)
 *  3. Zod schema validation (modality enum, non-UUID IDs accepted)
 *  4. Source regression checks — BILLING/ASSISTANT excluded from every
 *     imaging route, clinic-scope helpers used, no public/static file URLs,
 *     originals immutable (no binary update endpoint), no PII in audit metadata
 *  5. Clinic isolation (mock-based, mirrors labOrders.test.ts)
 *  6. Bridge agent contract (PR 2) — token shown once / hash-only storage,
 *     revoked & invalid tokens blocked from heartbeat, rate limiter wired,
 *     heartbeat is bridge-token authenticated (not user-authenticated)
 *
 * Run with: tsx src/tests/imaging.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { detectMimeFromBuffer, isAllowedFileSignature } from '../utils/fileSignature.js';
import {
  ALLOWED_REQUEST_TRANSITIONS,
  validateRequestTransition,
  canAttachStudyToRequest,
  type ImagingRequestStatus,
} from '../services/imaging/imagingRequestTransitions.js';
import {
  IMAGING_MODALITIES,
  IMAGING_REQUEST_STATUSES,
  imagingDeviceSchema,
  imagingRequestSchema,
  imagingRequestUpdateSchema,
  imagingStudyUploadSchema,
  imagingStudyLinkSchema,
  imagingBridgeSchema,
  imagingBridgeHeartbeatSchema,
} from '../schemas/index.js';
import { generateBridgeToken, hashBridgeToken } from '../services/imaging/bridgeTokens.js';

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
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

function src(relPath: string) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

// ─── Synthetic file buffers (no real patient data) ───────────────────────────

/** DICOM Part-10: 128-byte preamble + 'DICM' at offset 128. */
function syntheticDicomPart10(): Buffer {
  const buf = Buffer.alloc(200, 0);
  buf.write('DICM', 128, 'ascii');
  return buf;
}

/** Raw/non-Part-10 DICOM lookalike: no preamble marker. */
function syntheticRawDicom(): Buffer {
  return Buffer.alloc(200, 0x08);
}

function syntheticJpeg(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
}

function syntheticPng(): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
}

const IMAGING_EXTENSIONS_BY_MIME: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'application/dicom': ['.dcm', '.dicom'],
};

async function main() {
  // ── DICOM / image signature validation ─────────────────────────────────
  section('File signature validation (DICOM Part-10, conservative)');

  await test('DICOM Part-10 buffer (DICM at offset 128) detected as application/dicom', () => {
    assert.equal(detectMimeFromBuffer(syntheticDicomPart10()), 'application/dicom');
  });

  await test('non-Part-10 (raw) DICOM is rejected — documented future work', () => {
    assert.equal(detectMimeFromBuffer(syntheticRawDicom()), null);
  });

  await test('buffer shorter than 132 bytes is never detected as DICOM', () => {
    const short = Buffer.alloc(100, 0);
    assert.notEqual(detectMimeFromBuffer(short), 'application/dicom');
  });

  await test('.dcm + application/dicom + valid Part-10 content passes', () => {
    assert.equal(
      isAllowedFileSignature(syntheticDicomPart10(), 'application/dicom', 'pano.dcm', IMAGING_EXTENSIONS_BY_MIME),
      true,
    );
  });

  await test('.dcm extension with JPEG content is rejected (extension spoof)', () => {
    assert.equal(
      isAllowedFileSignature(syntheticJpeg(), 'application/dicom', 'evil.dcm', IMAGING_EXTENSIONS_BY_MIME),
      false,
    );
  });

  await test('.jpg declared as DICOM is rejected (wrong extension for mime)', () => {
    assert.equal(
      isAllowedFileSignature(syntheticDicomPart10(), 'application/dicom', 'xray.jpg', IMAGING_EXTENSIONS_BY_MIME),
      false,
    );
  });

  await test('plain JPEG and PNG still validate under the imaging mime map', () => {
    assert.equal(isAllowedFileSignature(syntheticJpeg(), 'image/jpeg', 'io.jpg', IMAGING_EXTENSIONS_BY_MIME), true);
    assert.equal(isAllowedFileSignature(syntheticPng(), 'image/png', 'io.png', IMAGING_EXTENSIONS_BY_MIME), true);
  });

  await test('JPEG detection unaffected by DICOM check (magic still wins)', () => {
    assert.equal(detectMimeFromBuffer(syntheticJpeg()), 'image/jpeg');
  });

  // ── ImagingRequest status transitions ───────────────────────────────────
  section('Imaging request status transitions');

  await test('requested -> scheduled -> received are valid', () => {
    assert.equal(validateRequestTransition('requested', 'scheduled').ok, true);
    assert.equal(validateRequestTransition('scheduled', 'received').ok, true);
    assert.equal(validateRequestTransition('requested', 'received').ok, true);
  });

  await test('cancel/fail reachable from any non-terminal status', () => {
    assert.equal(validateRequestTransition('requested', 'cancelled').ok, true);
    assert.equal(validateRequestTransition('requested', 'failed').ok, true);
    assert.equal(validateRequestTransition('scheduled', 'cancelled').ok, true);
    assert.equal(validateRequestTransition('scheduled', 'failed').ok, true);
  });

  await test('received/cancelled/failed are terminal', () => {
    for (const from of ['received', 'cancelled', 'failed'] as ImagingRequestStatus[]) {
      for (const to of IMAGING_REQUEST_STATUSES) {
        if (to === from) continue;
        const result = validateRequestTransition(from, to);
        assert.equal(result.ok, false, `${from} -> ${to} should be rejected`);
        if (!result.ok) assert.equal(result.code, 'already_terminal');
      }
    }
  });

  await test('every status appears in the transition map', () => {
    for (const status of IMAGING_REQUEST_STATUSES) {
      assert.ok(status in ALLOWED_REQUEST_TRANSITIONS, `missing transition entry for ${status}`);
    }
  });

  await test('studies attach only to open (requested/scheduled) requests', () => {
    assert.equal(canAttachStudyToRequest('requested'), true);
    assert.equal(canAttachStudyToRequest('scheduled'), true);
    assert.equal(canAttachStudyToRequest('received'), false);
    assert.equal(canAttachStudyToRequest('cancelled'), false);
    assert.equal(canAttachStudyToRequest('failed'), false);
  });

  // ── Zod schemas ──────────────────────────────────────────────────────────
  section('Schema validation');

  await test('device schema requires name + valid modality', () => {
    assert.equal(imagingDeviceSchema.safeParse({ name: 'Pano 1', modality: 'PX' }).success, true);
    assert.equal(imagingDeviceSchema.safeParse({ name: '', modality: 'PX' }).success, false);
    assert.equal(imagingDeviceSchema.safeParse({ name: 'X', modality: 'MRI' }).success, false);
  });

  await test('request schema accepts non-UUID relation IDs (demo/prod IDs)', () => {
    const result = imagingRequestSchema.safeParse({
      patientId: 'demo-patient-1',
      appointmentId: 'appt-42',
      requestedModality: 'IO',
    });
    assert.equal(result.success, true);
  });

  await test('request update schema rejects patientId (immutable after create)', () => {
    const result = imagingRequestUpdateSchema.safeParse({ patientId: 'other-patient', status: 'scheduled' });
    assert.equal(result.success, true);
    assert.equal('patientId' in (result.success ? result.data : {}), false);
  });

  await test('upload schema: modality required, links optional', () => {
    assert.equal(imagingStudyUploadSchema.safeParse({ modality: 'CT' }).success, true);
    assert.equal(imagingStudyUploadSchema.safeParse({}).success, false);
    assert.equal(imagingStudyUploadSchema.safeParse({ modality: 'CT', patientId: '' }).success, true);
  });

  await test('link schema requires patientId', () => {
    assert.equal(imagingStudyLinkSchema.safeParse({ patientId: 'p1' }).success, true);
    assert.equal(imagingStudyLinkSchema.safeParse({}).success, false);
  });

  await test('modality list is the DICOM-inspired Phase 1 set', () => {
    assert.deepEqual([...IMAGING_MODALITIES], ['IO', 'PX', 'CT', 'CEPH', 'IO_CAMERA', 'SCANNER', 'OTHER']);
  });

  // ── Source regression checks ─────────────────────────────────────────────
  section('Source regression checks');

  const routeSrc = src('../routes/imaging.ts');
  const schemaSrc = src('../../prisma/schema.prisma');

  await test('BILLING and ASSISTANT never appear in imaging authorize lists', () => {
    assert.equal(routeSrc.includes("'BILLING'"), false, 'BILLING must not have imaging access');
    assert.equal(routeSrc.includes("'ASSISTANT'"), false, 'ASSISTANT must not have imaging access');
  });

  await test('every route handler is behind authorize()', () => {
    const routeDefs = routeSrc.match(/router\.(get|post|put|patch|delete)\(/g) ?? [];
    const authorized = routeSrc.match(/authorize\(\[/g) ?? [];
    assert.ok(routeDefs.length > 0, 'no routes found');
    assert.equal(authorized.length, routeDefs.length, 'every imaging route must call authorize()');
  });

  await test('routes use clinic-scope helpers (validateAndGetClinicIdScope + resolveEffectiveClinicId)', () => {
    assert.ok(routeSrc.includes('validateAndGetClinicIdScope('), 'reads must be clinic-scoped');
    assert.ok(routeSrc.includes('resolveEffectiveClinicId('), 'mutations must resolve effective clinic');
    assert.equal(routeSrc.includes('req.user!.clinicId'), false, 'never trust req.user.clinicId directly for scoping');
  });

  await test('no public/static file serving — streams only', () => {
    assert.equal(routeSrc.includes('express.static'), false);
    assert.equal(routeSrc.includes('sendFile'), false);
    assert.ok(routeSrc.includes('openFileStream('), 'files must be streamed from storage behind auth');
  });

  await test('originals are immutable — no binary replace/delete endpoints', () => {
    assert.equal(/router\.(put|patch|post)\([^)]*images\/:imageId/.test(routeSrc), false, 'image binaries must have no mutation endpoint');
    assert.equal(routeSrc.includes('imagingImage.update'), false);
    assert.equal(routeSrc.includes('imagingImage.delete'), false);
    assert.equal(routeSrc.includes('imagingStudy.delete'), false, 'studies are archived, never hard-deleted');
  });

  await test('audit metadata carries no patient-identifying imaging metadata', () => {
    // originalName/fileName (may embed patient names) must never flow into audit metadata.
    const auditCalls = routeSrc.match(/auditImaging\([^;]*?\);/gs) ?? [];
    assert.ok(auditCalls.length >= 5, 'expected audit calls for upload/view/link/unlink/archive/device changes');
    for (const call of auditCalls) {
      assert.equal(/originalName|fileName|firstName|lastName|studyInstanceUid|sopInstanceUid/.test(call), false,
        'audit metadata must contain only IDs, modality and counters');
    }
  });

  await test('upload/view/link/unlink/archive and device changes are all audited', () => {
    for (const action of [
      'imaging_study_uploaded', 'imaging_study_viewed', 'imaging_study_linked', 'imaging_study_unlinked',
      'imaging_study_archived', 'imaging_device_created', 'imaging_device_updated', 'imaging_device_deleted',
    ]) {
      assert.ok(routeSrc.includes(`'${action}'`), `missing audit action ${action}`);
    }
  });

  await test('schema.prisma: imaging statuses are plain String (no enum lock-in)', () => {
    assert.ok(/model ImagingRequest \{[\s\S]*?status\s+String\s+@default\("requested"\)/.test(schemaSrc));
    assert.ok(/model ImagingStudy \{[\s\S]*?status\s+String\s+@default\("active"\)/.test(schemaSrc));
  });

  await test('schema.prisma: ImagingStudy.patientId is optional (unlinked queue)', () => {
    assert.ok(/model ImagingStudy \{[\s\S]*?patientId\s+String\?/.test(schemaSrc));
  });

  await test('DICOM validation is Part-10 only (documented conservative scope)', () => {
    const sigSrc = src('../utils/fileSignature.ts');
    assert.ok(sigSrc.includes("subarray(128, 132).toString('ascii') === 'DICM'"), 'DICM marker at byte offset 128');
  });

  // ── Clinic isolation (mock-based, mirrors labOrders.test.ts) ─────────────
  section('Clinic isolation');

  type StudyRow = { id: string; clinicId: string; patientId: string | null; status: string };
  const mockStudies: StudyRow[] = [
    { id: 'study-A-1', clinicId: 'clinic-A', patientId: 'patient-A-1', status: 'active' },
    { id: 'study-A-2', clinicId: 'clinic-A', patientId: null, status: 'active' },
    { id: 'study-B-1', clinicId: 'clinic-B', patientId: null, status: 'active' },
  ];

  function simulateUnlinkedQueue(accessibleClinicIds: string[]) {
    return mockStudies.filter(s => accessibleClinicIds.includes(s.clinicId) && s.patientId === null && s.status === 'active');
  }

  function simulateGetStudy(id: string, accessibleClinicIds: string[]) {
    return mockStudies.find(s => s.id === id && accessibleClinicIds.includes(s.clinicId)) ?? null;
  }

  await test('unlinked queue only shows studies from accessible clinics', () => {
    const queue = simulateUnlinkedQueue(['clinic-B']);
    assert.deepEqual(queue.map(s => s.id), ['study-B-1']);
  });

  await test('a study in clinic A is invisible when scoped to clinic B', () => {
    assert.equal(simulateGetStudy('study-A-1', ['clinic-B']), null);
    assert.notEqual(simulateGetStudy('study-A-1', ['clinic-A']), null);
  });

  await test('zero clinic access sees nothing', () => {
    assert.deepEqual(simulateUnlinkedQueue([]), []);
    assert.equal(simulateGetStudy('study-A-2', []), null);
  });

  // ── Bridge agent contract (PR 2) ─────────────────────────────────────────
  section('Bridge agent tokens');

  await test('generated token is strong, prefixed and hash differs from plaintext', () => {
    const { token, tokenHash } = generateBridgeToken();
    assert.ok(token.startsWith('nmb_'), 'token must carry the nmb_ prefix');
    assert.ok(/^nmb_[0-9a-f]{64}$/.test(token), 'token must contain 32 bytes of hex entropy');
    assert.ok(/^[0-9a-f]{64}$/.test(tokenHash), 'tokenHash must be a sha256 hex digest');
    assert.notEqual(token, tokenHash);
    assert.equal(hashBridgeToken(token), tokenHash, 'stored hash must match hash of the plaintext');
  });

  await test('two generated tokens never collide', () => {
    const a = generateBridgeToken();
    const b = generateBridgeToken();
    assert.notEqual(a.token, b.token);
    assert.notEqual(a.tokenHash, b.tokenHash);
  });

  await test('bridge schema requires name; heartbeat body accepts only agentVersion', () => {
    assert.equal(imagingBridgeSchema.safeParse({ name: 'Reception PC' }).success, true);
    assert.equal(imagingBridgeSchema.safeParse({ name: '' }).success, false);
    assert.equal(imagingBridgeHeartbeatSchema.safeParse({}).success, true);
    assert.equal(imagingBridgeHeartbeatSchema.safeParse({ agentVersion: '1.2.3' }).success, true);
    const parsed = imagingBridgeHeartbeatSchema.safeParse({ agentVersion: '1.0.0', patientName: 'X' });
    assert.equal(parsed.success && 'patientName' in parsed.data, false, 'unknown fields must be stripped');
  });

  section('Bridge heartbeat behaviour (mock, mirrors route logic)');

  type BridgeRow = {
    id: string; clinicId: string; tokenHash: string; status: string;
    lastSeenAt: Date | null; agentVersion: string | null;
  };

  function simulateHeartbeat(bridges: BridgeRow[], rawToken: string | undefined, agentVersion?: string) {
    if (!rawToken) return { httpStatus: 401 };
    const tokenHash = hashBridgeToken(rawToken);
    const agent = bridges.find(b => b.tokenHash === tokenHash);
    if (!agent || agent.status === 'revoked') return { httpStatus: 401 };
    agent.status = 'online';
    agent.lastSeenAt = new Date();
    if (agentVersion) agent.agentVersion = agentVersion;
    return { httpStatus: 200 };
  }

  const goodBridge = generateBridgeToken();
  const revokedBridge = generateBridgeToken();
  const mockBridges: BridgeRow[] = [
    { id: 'bridge-1', clinicId: 'clinic-A', tokenHash: goodBridge.tokenHash, status: 'pending', lastSeenAt: null, agentVersion: null },
    { id: 'bridge-2', clinicId: 'clinic-A', tokenHash: revokedBridge.tokenHash, status: 'revoked', lastSeenAt: null, agentVersion: null },
  ];

  await test('valid token heartbeat updates lastSeenAt/status/agentVersion', () => {
    const result = simulateHeartbeat(mockBridges, goodBridge.token, '1.2.3');
    assert.equal(result.httpStatus, 200);
    const agent = mockBridges[0];
    assert.equal(agent.status, 'online');
    assert.ok(agent.lastSeenAt instanceof Date);
    assert.equal(agent.agentVersion, '1.2.3');
  });

  await test('missing or invalid token cannot heartbeat', () => {
    assert.equal(simulateHeartbeat(mockBridges, undefined).httpStatus, 401);
    assert.equal(simulateHeartbeat(mockBridges, 'nmb_' + '0'.repeat(64)).httpStatus, 401);
  });

  await test('revoked bridge cannot heartbeat and stays revoked', () => {
    assert.equal(simulateHeartbeat(mockBridges, revokedBridge.token).httpStatus, 401);
    assert.equal(mockBridges[1].status, 'revoked');
    assert.equal(mockBridges[1].lastSeenAt, null);
  });

  section('Bridge source regression checks');

  const hbSrc = src('../routes/imagingBridgePublic.ts');
  const indexSrc = src('../index.ts');
  const bridgeTokenSrc = src('../services/imaging/bridgeTokens.ts');

  await test('tokenHash is never selected into an API response', () => {
    assert.equal(/tokenHash:\s*true/.test(routeSrc), false, 'bridge selects must exclude tokenHash');
    assert.equal(routeSrc.includes('bridgeAgentSelect'), true, 'bridge responses must go through the shared safe select');
  });

  await test('plaintext token is returned exactly once (creation response only)', () => {
    const tokenResponses = routeSrc.match(/json\(\{ \.\.\.agent, token \}\)/g) ?? [];
    assert.equal(tokenResponses.length, 1, 'plaintext token must appear in exactly one response');
    assert.equal(routeSrc.includes('data: { clinicId, name: validation.data.name, tokenHash'), true,
      'only the hash may be persisted');
    assert.equal(/data:[^}]*[^n]\btoken\b\s*[,}]/.test(routeSrc), false, 'plaintext token must never be persisted');
  });

  await test('plaintext token never flows into audit/activity/console', () => {
    for (const source of [routeSrc, hbSrc]) {
      assert.equal(/auditImaging\([^;]*\btoken\b[^;]*\)/s.test(source), false);
      assert.equal(/writeAuditLog\([^;]*rawToken[^;]*\)/s.test(source), false);
      assert.equal(/console\.(log|warn|error)\([^)]*(rawToken|tokenHash|token)\b/.test(source), false);
    }
    assert.equal(/console\./.test(bridgeTokenSrc), false, 'token service must not log');
  });

  await test('bridge management uses MANAGE roles and audits register/revoke', () => {
    const bridgeRoutes = routeSrc.match(/router\.(get|post)\('\/imaging\/bridges[^']*',\s*authorize\(\[\.\.\.IMAGING_MANAGE_ROLES\]\)/g) ?? [];
    assert.equal(bridgeRoutes.length, 3, 'all three bridge management routes must require IMAGING_MANAGE_ROLES');
    assert.ok(routeSrc.includes("'imaging_bridge_registered'"));
    assert.ok(routeSrc.includes("'imaging_bridge_revoked'"));
  });

  await test('heartbeat is bridge-token authenticated, not user-authenticated', () => {
    assert.equal(hbSrc.includes('middleware/auth'), false, 'heartbeat must not import user auth middleware');
    assert.equal(hbSrc.includes('authorize('), false);
    assert.ok(hbSrc.includes("authorization"), 'heartbeat reads the Bearer token itself');
    assert.ok(hbSrc.includes('hashBridgeToken('), 'lookup must go through the sha256 hash');
  });

  await test('heartbeat is registered under /api/public before the global authenticate', () => {
    const publicMount = indexSrc.indexOf("app.use('/api/public', imagingBridgePublicRoutes)");
    const authMount = indexSrc.indexOf('authenticate as express.RequestHandler');
    assert.ok(publicMount > -1, 'public heartbeat router must be mounted');
    assert.ok(authMount > -1);
    assert.ok(publicMount < authMount, 'heartbeat must be mounted before the auth middleware');
  });

  await test('heartbeat is rate-limited (IP + token) via createRateLimiter', () => {
    const limiters = hbSrc.match(/createRateLimiter\(/g) ?? [];
    assert.ok(limiters.length >= 2, 'expect both an IP limiter and a token limiter');
    assert.ok(hbSrc.includes('.check('), 'limiters must be checked before processing');
  });

  await test('heartbeat rejects revoked tokens and returns a minimal response', () => {
    assert.ok(hbSrc.includes("agent.status === 'revoked'"));
    assert.ok(hbSrc.includes('{ ok: true }'), 'success response must stay minimal');
    assert.equal(/res\.json\([^)]*(patient|firstName|lastName|clinicId)/.test(hbSrc), false,
      'heartbeat must not return clinic/patient data');
  });

  await test('schema.prisma: ImagingBridgeAgent stores hash only, unique, status pending', () => {
    assert.ok(/model ImagingBridgeAgent \{[\s\S]*?tokenHash\s+String\s+@unique/.test(schemaSrc));
    assert.ok(/model ImagingBridgeAgent \{[\s\S]*?status\s+String\s+@default\("pending"\)/.test(schemaSrc));
    assert.equal(/model ImagingBridgeAgent \{[\s\S]*?\btoken\s+String/.test(schemaSrc), false,
      'no plaintext token column may exist');
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
