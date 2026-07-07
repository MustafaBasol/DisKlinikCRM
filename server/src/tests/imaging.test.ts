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
import crypto from 'node:crypto';
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
  imagingBridgeStudyUploadSchema,
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

  // ── Bridge ingest API (PR A) ──────────────────────────────────────────────
  section('Bridge ingest: schema validation');

  await test('ingestKey must be exactly 64 lowercase hex chars', () => {
    const sha = crypto.createHash('sha256').update('x').digest('hex');
    assert.equal(imagingBridgeStudyUploadSchema.safeParse({ ingestKey: sha }).success, true);
    assert.equal(imagingBridgeStudyUploadSchema.safeParse({ ingestKey: sha.toUpperCase() }).success, false, 'uppercase hex rejected');
    assert.equal(imagingBridgeStudyUploadSchema.safeParse({ ingestKey: sha.slice(0, 63) }).success, false, 'short key rejected');
    assert.equal(imagingBridgeStudyUploadSchema.safeParse({ ingestKey: `${sha.slice(0, 63)}g` }).success, false, 'non-hex char rejected');
    assert.equal(imagingBridgeStudyUploadSchema.safeParse({}).success, false, 'ingestKey is required');
  });

  await test('bridge upload schema accepts no patient/free-text fields', () => {
    const sha = crypto.createHash('sha256').update('y').digest('hex');
    const parsed = imagingBridgeStudyUploadSchema.safeParse({
      ingestKey: sha,
      deviceId: 'device-1',
      modality: 'PX',
      patientName: 'Should be stripped',
      description: 'Should be stripped',
    });
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal('patientName' in parsed.data, false, 'unknown/PII-shaped fields must be stripped by Zod');
      assert.equal('description' in parsed.data, false);
    }
  });

  section('Bridge ingest: server-verified idempotency (mock, mirrors route logic)');

  type BridgeStudyRow = {
    id: string;
    clinicId: string;
    bridgeAgentId: string;
    ingestKey: string;
    createdById: string | null;
  };

  function simulateBridgeIngest(
    studies: BridgeStudyRow[],
    args: { clinicId: string; bridgeAgentId: string; buffer: Buffer; claimedIngestKey: string },
  ): { httpStatus: number; studyId?: string; duplicate?: boolean; error?: string } {
    const computedHash = crypto.createHash('sha256').update(args.buffer).digest('hex');
    if (computedHash !== args.claimedIngestKey) {
      return { httpStatus: 400, error: 'ingestKey does not match uploaded file content' };
    }
    // Dedupe is clinic-scoped, NOT bridgeAgentId-scoped.
    const existing = studies.find(s => s.clinicId === args.clinicId && s.ingestKey === computedHash);
    if (existing) {
      return { httpStatus: 200, studyId: existing.id, duplicate: true };
    }
    const created: BridgeStudyRow = {
      id: `study-${studies.length + 1}`,
      clinicId: args.clinicId,
      bridgeAgentId: args.bridgeAgentId,
      ingestKey: computedHash,
      createdById: null,
    };
    studies.push(created);
    return { httpStatus: 201, studyId: created.id, duplicate: false };
  }

  await test('server recomputes sha256 and rejects a mismatched ingestKey', () => {
    const studies: BridgeStudyRow[] = [];
    const buffer = Buffer.from('real file bytes');
    const wrongKey = crypto.createHash('sha256').update('different bytes').digest('hex');
    const result = simulateBridgeIngest(studies, { clinicId: 'clinic-A', bridgeAgentId: 'bridge-1', buffer, claimedIngestKey: wrongKey });
    assert.equal(result.httpStatus, 400);
    assert.equal(studies.length, 0, 'no study must be created on hash mismatch');
  });

  await test('clinic-level duplicate prevention: same file from a different agent in the same clinic dedupes', () => {
    const studies: BridgeStudyRow[] = [];
    const buffer = Buffer.from('shared export file');
    const ingestKey = crypto.createHash('sha256').update(buffer).digest('hex');

    const first = simulateBridgeIngest(studies, { clinicId: 'clinic-A', bridgeAgentId: 'bridge-1', buffer, claimedIngestKey: ingestKey });
    assert.equal(first.httpStatus, 201);
    assert.equal(first.duplicate, false);

    // A DIFFERENT bridge agent in the SAME clinic uploads the identical bytes.
    const second = simulateBridgeIngest(studies, { clinicId: 'clinic-A', bridgeAgentId: 'bridge-2', buffer, claimedIngestKey: ingestKey });
    assert.equal(second.httpStatus, 200);
    assert.equal(second.duplicate, true);
    assert.equal(second.studyId, first.studyId, 'duplicate retry must return the original studyId');
    assert.equal(studies.length, 1, 'only one study row must exist for the clinic');
  });

  await test('the same file in a different clinic is not deduped (dedupe is clinic-scoped)', () => {
    const studies: BridgeStudyRow[] = [];
    const buffer = Buffer.from('cross-clinic same bytes');
    const ingestKey = crypto.createHash('sha256').update(buffer).digest('hex');

    simulateBridgeIngest(studies, { clinicId: 'clinic-A', bridgeAgentId: 'bridge-1', buffer, claimedIngestKey: ingestKey });
    const otherClinic = simulateBridgeIngest(studies, { clinicId: 'clinic-B', bridgeAgentId: 'bridge-2', buffer, claimedIngestKey: ingestKey });
    assert.equal(otherClinic.duplicate, false);
    assert.equal(studies.length, 2);
  });

  await test('bridge-created studies carry no user actor (createdById null)', () => {
    const studies: BridgeStudyRow[] = [];
    const buffer = Buffer.from('no actor');
    const ingestKey = crypto.createHash('sha256').update(buffer).digest('hex');
    simulateBridgeIngest(studies, { clinicId: 'clinic-A', bridgeAgentId: 'bridge-1', buffer, claimedIngestKey: ingestKey });
    assert.equal(studies[0].createdById, null);
  });

  section('Bridge ingest: auth (revoked/invalid tokens)');

  await test('revoked or invalid bridge token cannot reach the upload handler', () => {
    const mockBridges: { tokenHash: string; status: string }[] = [
      { tokenHash: hashBridgeToken('nmb_valid'), status: 'online' },
      { tokenHash: hashBridgeToken('nmb_revoked'), status: 'revoked' },
    ];
    function simulateAuth(rawToken: string | undefined) {
      if (!rawToken) return null;
      const tokenHash = hashBridgeToken(rawToken);
      const agent = mockBridges.find(b => b.tokenHash === tokenHash);
      if (!agent || agent.status === 'revoked') return null;
      return agent;
    }
    assert.equal(simulateAuth(undefined), null);
    assert.equal(simulateAuth('nmb_unknown'), null);
    assert.equal(simulateAuth('nmb_revoked'), null, 'revoked agent must be rejected identically to unknown token');
    assert.notEqual(simulateAuth('nmb_valid'), null);
  });

  section('Bridge ingest: offline job (stale online agents only)');

  type OfflineJobAgentRow = { id: string; status: string; lastSeenAt: Date | null };

  function simulateOfflineJob(agents: OfflineJobAgentRow[], cutoff: Date) {
    for (const agent of agents) {
      if (agent.status === 'online' && agent.lastSeenAt && agent.lastSeenAt < cutoff) {
        agent.status = 'offline';
      }
    }
  }

  await test('offline job flips only stale online agents; revoked/pending untouched', () => {
    const now = Date.now();
    const stale = new Date(now - 10 * 60 * 1000);
    const fresh = new Date(now - 30 * 1000);
    const agents: OfflineJobAgentRow[] = [
      { id: 'a-online-stale', status: 'online', lastSeenAt: stale },
      { id: 'a-online-fresh', status: 'online', lastSeenAt: fresh },
      { id: 'a-revoked-stale', status: 'revoked', lastSeenAt: stale },
      { id: 'a-pending-null', status: 'pending', lastSeenAt: null },
    ];
    simulateOfflineJob(agents, new Date(now - 5 * 60 * 1000));

    assert.equal(agents.find(a => a.id === 'a-online-stale')!.status, 'offline');
    assert.equal(agents.find(a => a.id === 'a-online-fresh')!.status, 'online', 'fresh heartbeat must stay online');
    assert.equal(agents.find(a => a.id === 'a-revoked-stale')!.status, 'revoked', 'revoked must never change');
    assert.equal(agents.find(a => a.id === 'a-pending-null')!.status, 'pending', 'pending must never change');
  });

  section('Bridge ingest: source regression checks');

  const bridgePublicSrc = hbSrc; // alias — same file, read once above
  const jobSrc = src('../jobs/imagingBridgeOfflineJob.ts');

  await test('upload endpoint recomputes sha256 server-side instead of trusting the client hash', () => {
    assert.ok(bridgePublicSrc.includes("crypto.createHash('sha256').update(req.file.buffer).digest('hex')"),
      'server must independently hash the uploaded buffer');
    assert.ok(bridgePublicSrc.includes('computedHash !== v.ingestKey'), 'mismatched hash must be rejected');
  });

  await test('dedupe query is scoped to clinicId + ingestKey, not bridgeAgentId', () => {
    const dedupeQueries = bridgePublicSrc.match(/imagingStudy\.findFirst\(\{\s*where:\s*\{[^}]*\}/gs) ?? [];
    assert.ok(dedupeQueries.length > 0, 'expected at least one dedupe lookup');
    for (const q of dedupeQueries) {
      assert.ok(q.includes('clinicId') && q.includes('ingestKey'), 'dedupe lookup must key on clinicId+ingestKey');
    }
    assert.equal(/findFirst\(\{\s*where:\s*\{\s*bridgeAgentId,\s*ingestKey/.test(bridgePublicSrc), false,
      'dedupe must never be scoped to bridgeAgentId alone');
  });

  await test('schema.prisma: uniqueness is [clinicId, ingestKey], not bridgeAgentId-scoped', () => {
    assert.ok(/model ImagingStudy \{[\s\S]*?@@unique\(\[clinicId,\s*ingestKey\]\)/.test(schemaSrc));
    assert.equal(/@@unique\(\[bridgeAgentId,\s*ingestKey\]\)/.test(schemaSrc), false);
  });

  await test('schema.prisma: ImagingStudy.createdById is nullable (bridge uploads have no user actor)', () => {
    assert.ok(/model ImagingStudy \{[\s\S]*?createdById\s+String\?/.test(schemaSrc));
    assert.ok(/model ImagingStudy \{[\s\S]*?createdBy\s+User\?/.test(schemaSrc));
  });

  await test('failed transaction cleans up the just-saved file', () => {
    // Both the generic catch and the P2002 duplicate-race branch must call deleteFile.
    const deleteCalls = bridgePublicSrc.match(/deleteFile\(storageKey\)/g) ?? [];
    assert.ok(deleteCalls.length >= 2, 'expected cleanup on both the generic failure path and the P2002 race path');
  });

  await test('upload is rate-limited by IP and by token, distinct from heartbeat limiters', () => {
    assert.ok(bridgePublicSrc.includes('uploadIpLimiter'));
    assert.ok(bridgePublicSrc.includes('uploadTokenLimiter'));
    assert.notEqual(bridgePublicSrc.indexOf('uploadIpLimiter'), bridgePublicSrc.indexOf('heartbeatIpLimiter'));
  });

  await test('upload enforces the same MAX_FILE_MB / magic-byte checks as manual upload', () => {
    assert.ok(bridgePublicSrc.includes('MAX_FILE_MB'));
    assert.ok(bridgePublicSrc.includes('isAllowedFileSignature('));
  });

  await test('no filename, token, tokenHash, or PHI enters the bridge audit metadata', () => {
    const auditCalls = bridgePublicSrc.match(/writeAuditLog\(\{[\s\S]*?\}\);/g) ?? [];
    assert.ok(auditCalls.length > 0, 'expected at least one writeAuditLog call');
    for (const call of auditCalls) {
      assert.equal(/originalName|fileName|firstName|lastName|rawToken|tokenHash|patientId/.test(call), false,
        'bridge audit metadata must contain only safe identifiers/counters');
    }
  });

  await test('bridge routes never log plaintext token, tokenHash, or filenames', () => {
    assert.equal(/console\.(log|warn|error)\([^)]*(rawToken|tokenHash|originalname|originalName)\b/.test(bridgePublicSrc), false);
  });

  await test('successful heartbeat or upload marks the agent online and refreshes lastSeenAt', () => {
    const onlineUpdates = bridgePublicSrc.match(/data:\s*\{\s*status:\s*'online',\s*lastSeenAt:\s*new Date\(\)/g) ?? [];
    assert.ok(onlineUpdates.length >= 2, 'expected both heartbeat and upload to refresh lastSeenAt/online');
  });

  await test('offline job only targets status=online and uses the shared job lock', () => {
    assert.ok(jobSrc.includes("status: 'online'"), 'offline job must filter by status=online');
    assert.equal(jobSrc.includes("status: 'revoked'"), false, 'offline job must never touch revoked agents');
    assert.ok(jobSrc.includes('withJobLock('), 'offline job must use the shared distributed lock');
    assert.ok(jobSrc.includes('IMAGING_BRIDGE_OFFLINE_MINUTES'), 'threshold must be configurable');
  });

  await test('offline job is registered in startBackgroundJobs', () => {
    const startSrc = src('../jobs/startBackgroundJobs.ts');
    assert.ok(startSrc.includes('startImagingBridgeOfflineJob'));
  });

  await test('BILLING/ASSISTANT restrictions on the authenticated imaging routes are unchanged', () => {
    assert.equal(routeSrc.includes("'BILLING'"), false);
    assert.equal(routeSrc.includes("'ASSISTANT'"), false);
    // The public bridge router is agent-authenticated, not role-authenticated — it must not use authorize() at all.
    assert.equal(bridgePublicSrc.includes('authorize('), false, 'bridge public routes must never use user-role authorize()');
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
