/**
 * imagingCharacterizationAuthShape.test.ts — F2-PREP-007-A Imaging Stage 0
 * characterization coverage: bridge-vs-clinic-session auth boundary, legal-hold
 * redaction, delete-route inventory, legal-hold audit metadata shape, and
 * response-shape snapshots.
 *
 * Scope (per docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md
 * §14 / evidence/F2-PREP-006-D_imaging_contract_test_design.json
 * characterizationTests[]) — this file implements exactly:
 *   CT-06 — a valid clinic-session JWT presented as the bridge Bearer token is
 *           rejected (401); the two auth mechanisms never cross-accept.
 *   CT-16 — legalHoldReason stays redacted for CLINIC_MANAGER/DENTIST/RECEPTIONIST
 *           across GetImagingStudy, ListPatientImaging, ListUnlinkedImagingStudies,
 *           and CreateImagingStudy responses (OWNER/ORG_ADMIN keep seeing it).
 *   CT-19 — no DELETE route exists for ImagingStudy or ImagingImage anywhere in
 *           the router (static route-table inventory, no live server needed).
 *   CT-21 — legal-hold audit metadata carries actorRole + hold-state booleans,
 *           never the legalHoldReason free-text, regardless of actor role.
 *   CT-28 — deterministic snapshots of the current GetImagingStudy,
 *           ListPatientImaging, and CreateImagingStudy response shapes.
 *
 * This is characterization, not a spec: it documents current, running
 * production behavior (including any known gaps tracked elsewhere in the
 * contract) so a future refactor cannot silently change it. Nothing here
 * changes application code.
 *
 * Harness: this repo has no supertest/live-listening-server pattern (see
 * treatmentCasesProposalPdfRoute.test.ts, communicationPreferencesRoute.test.ts)
 * — the real, unmodified route handlers are extracted directly from the real
 * imaging.ts / imagingBridgePublic.ts routers' internal stacks and invoked
 * against a constructed request/response, exactly as those two suites do.
 * prisma's model delegates (plain writable properties on the shared singleton,
 * same technique as externalCalendarWebhookRouteE2E.test.ts) are swapped for
 * small in-memory fakes for the duration of this process — no live Postgres
 * required. The one real I/O this file performs is CreateImagingStudy's actual
 * local-disk file save (fileStorage.ts's default, non-S3 mode) for a tiny
 * synthetic buffer under a clearly-synthetic clinic id; it is deleted again in
 * a finally block so this suite leaves no residue.
 *
 * Synthetic data only. No real token, filename, or legalHoldReason content is
 * ever logged by this file — assertions on redacted/audited content compare
 * values in-memory and only report booleans/pass-fail, never the raw text.
 *
 * Cleanup contract: the local-disk directory CreateImagingStudy writes to is
 * removed by a real `finally` wrapped around the whole suite body — it does
 * not depend on reaching the "Cleanup" section as the last test case. If an
 * unexpected exception is thrown anywhere above that section (e.g. a route
 * lookup failing before any individual `test()` call wraps it), the `finally`
 * still runs and still deletes the directory; the "Cleanup" section afterward
 * only reports/verifies that removal, it does not perform it.
 *
 * Run with: npx tsx src/tests/imagingCharacterizationAuthShape.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import prisma from '../db.js';
import imagingRouter from '../routes/imaging.js';
import imagingBridgePublicRouter from '../routes/imagingBridgePublic.js';
import { generateToken, type AuthRequest } from '../middleware/auth.js';
import { generateBridgeToken } from '../services/imaging/bridgeTokens.js';
import type { Response } from 'express';

// ─── Test harness (mirrors imaging.test.ts / communicationPreferencesRoute.test.ts) ──

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

function src(relPath: string) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

// ─── Route-handler extraction (same convention as communicationPreferencesRoute.test.ts /
// treatmentCasesProposalPdfRoute.test.ts — pull the REAL handler out of the REAL router's
// stack; deliberately skip authorize()/upload middleware to unit-test handler logic in
// isolation, exactly as those suites document doing) ────────────────────────────────────

type RouterLike = { stack: Array<any> };

function getRouteHandler(
  router: RouterLike,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  routerPath: string,
): (req: any, res: Response) => Promise<void> | void {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === routerPath && layer.route.methods?.[method]) {
      const stack = layer.route.stack;
      return stack[stack.length - 1].handle;
    }
  }
  throw new Error(`No route handler found for ${method.toUpperCase()} ${routerPath}`);
}

function mockResponse(): Response & { statusCode: number; body: any; headers: Record<string, string> } {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; return this; },
  };
  return res;
}

function authRequest(
  overrides: Partial<NonNullable<AuthRequest['user']>>,
  params: Record<string, string> = {},
  query: Record<string, string> = {},
  extra: Record<string, unknown> = {},
): AuthRequest {
  return {
    params,
    query,
    headers: {},
    body: {},
    ...extra,
    user: {
      id: 'user-fixture-1',
      clinicId: CLINIC_ID,
      role: 'OWNER',
      normalizedRole: 'OWNER',
      organizationId: ORG_ID,
      allowedClinicIds: [CLINIC_ID],
      canAccessAllClinics: true,
      ...overrides,
    },
  } as unknown as AuthRequest;
}

// ─── Synthetic fixture identifiers (deterministic literals — no crypto.randomUUID()/
// Date.now() feeds any assertion, so nothing here needs post-hoc normalization before
// being compared to a fixed expected snapshot; see CT-28 section for the snapshot itself) ──

const ORG_ID = 'org-f2prep007a-0000';
const CLINIC_ID = 'clinic-f2prep007a-0000';
const PATIENT_ID = 'patient-f2prep007a-0000';
const STUDY_ID = 'study-f2prep007a-0000';
const IMAGE_ID = 'image-f2prep007a-0000';
const FIXED_TIMESTAMP = '2026-01-01T00:00:00.000Z';
const SYNTHETIC_LEGAL_HOLD_REASON = 'SYNTHETIC_TEST_ONLY_LEGAL_HOLD_JUSTIFICATION_TEXT';

const REDACTED_ROLES = ['CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST'] as const;
const UNREDACTED_ROLES = ['OWNER', 'ORG_ADMIN'] as const;

/** A study object shaped exactly like imaging.ts's `studyInclude` result (see
 * server/src/routes/imaging.ts:163-180) — all scalars plus the seven selected
 * relations. Used as the canned return value for every mocked prisma read below,
 * regardless of the `where`/`include` passed in (this is a unit-mock/snapshot-level
 * characterization per F2-PREP-006-D CT-16/CT-28, not a live-DB integration test —
 * CT-02/CT-07 etc. own the disposable-Postgres-backed coverage). */
function studyFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: STUDY_ID,
    clinicId: CLINIC_ID,
    patientId: PATIENT_ID,
    appointmentId: null,
    treatmentCaseId: null,
    deviceId: null,
    imagingRequestId: null,
    modality: 'OTHER',
    studyDate: FIXED_TIMESTAMP,
    description: null,
    source: 'manual_upload',
    status: 'active',
    createdById: 'user-fixture-1',
    bridgeAgentId: null,
    ingestKey: null,
    legalHold: true,
    legalHoldReason: SYNTHETIC_LEGAL_HOLD_REASON,
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    images: [
      {
        id: IMAGE_ID,
        originalName: 'synthetic.jpg',
        fileSize: 68,
        mimeType: 'image/jpeg',
        sopInstanceUid: null,
        createdAt: FIXED_TIMESTAMP,
      },
    ],
    device: null,
    patient: { id: PATIENT_ID, firstName: 'Synthetic', lastName: 'Patient' },
    appointment: null,
    treatmentCase: null,
    imagingRequest: null,
    createdBy: { id: 'user-fixture-1', firstName: 'Synthetic', lastName: 'Staff' },
    ...overrides,
  };
}

// ─── In-memory prisma fakes (plain writable properties on the shared singleton —
// same technique as externalCalendarWebhookRouteE2E.test.ts; no live Postgres) ──────────

const auditLogCalls: Array<Record<string, unknown>> = [];

(prisma as any).auditLog = {
  async create({ data }: any) {
    auditLogCalls.push(data);
    return { id: `audit-${auditLogCalls.length}`, ...data };
  },
};

(prisma as any).clinic = {
  async findFirst({ where }: any) {
    return where?.id === CLINIC_ID ? { id: CLINIC_ID } : null;
  },
  async findMany() {
    return [{ id: CLINIC_ID }];
  },
  async findUnique({ where }: any) {
    return where?.id === CLINIC_ID ? { id: CLINIC_ID, name: 'Synthetic Clinic', organizationId: ORG_ID } : null;
  },
};

(prisma as any).patient = {
  async findFirst({ where }: any) {
    return where?.id === PATIENT_ID ? { id: PATIENT_ID } : null;
  },
};

let createdStudyStore: Record<string, unknown> | null = null;

(prisma as any).imagingStudy = {
  async findFirst({ where }: any) {
    if (where?.id && where.id !== STUDY_ID) return null;
    return studyFixture();
  },
  async findMany() {
    return [studyFixture()];
  },
  async findUnique({ where }: any) {
    // The post-create re-fetch (`const full = await prisma.imagingStudy.findUnique(...)`
    // in CreateImagingStudy, imaging.ts:658) is given the SAME legal-hold fixture shape
    // as every other surface here — deliberately, not realistically (a truly brand-new
    // study has no legal hold yet) — so this exercises the exact same
    // redactStudyLegalHoldReason(full!, canSeeLegalHoldReason(req)) call CT-16 targets,
    // proving CreateImagingStudy's redaction is wired identically to the other three
    // surfaces rather than trivially passing because a fresh row has nothing to redact.
    if (createdStudyStore && where?.id === (createdStudyStore as any).id) {
      return studyFixture({ id: (createdStudyStore as any).id });
    }
    return where?.id === STUDY_ID ? studyFixture() : null;
  },
  async create({ data }: any) {
    createdStudyStore = { id: 'study-created-f2prep007a-0000', ...data };
    return createdStudyStore;
  },
  async update({ data }: any) {
    return { id: STUDY_ID, legalHold: data.legalHold, legalHoldReason: data.legalHoldReason };
  },
};

(prisma as any).imagingImage = {
  async create({ data }: any) {
    return { id: 'image-created-f2prep007a-0000', ...data };
  },
};

(prisma as any).imagingRequest = {
  async findFirst() {
    return null;
  },
};

(prisma as any).$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma);

// ─── Fixed clinic-session JWT (real generateToken(), real JWT_SECRET path — this is a
// genuine, correctly-signed clinic session token, not a forged/malformed one; CT-06's
// whole point is that even a VALID clinic-session credential must not open the bridge
// door) and a genuine bridge credential for contrast ───────────────────────────────────

const clinicSessionJwt = generateToken({
  id: 'user-fixture-1',
  clinicId: CLINIC_ID,
  organizationId: ORG_ID,
  allowedClinicIds: [CLINIC_ID],
  canAccessAllClinics: true,
  role: 'OWNER',
});

const seededBridgeCredential = generateBridgeToken();
const seededBridgeAgent = {
  id: 'bridge-agent-f2prep007a-0000',
  clinicId: CLINIC_ID,
  status: 'online',
  updateChannel: 'stable',
  tokenHash: seededBridgeCredential.tokenHash,
  clinic: { organizationId: ORG_ID },
};

(prisma as any).imagingBridgeAgent = {
  async findUnique({ where }: any) {
    return where?.tokenHash === seededBridgeAgent.tokenHash ? seededBridgeAgent : null;
  },
};

(prisma as any).imagingBridgeBinding = {
  async findMany() {
    return [];
  },
};

// ─── Snapshot normalization helper (per task constraint: normalize UUIDs/timestamps/
// paths before comparing). Fixtures above already use deterministic literal ids/
// timestamps rather than crypto.randomUUID()/new Date(), so no runtime value here is
// ever nondeterministic — this walker exists as a defensive second layer that would
// catch a regression introducing a real UUID/Date/absolute-path into a response. ──────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function normalizeForSnapshot(value: unknown): unknown {
  if (value instanceof Date) return '<TIMESTAMP>';
  if (typeof value === 'string') {
    if (UUID_RE.test(value)) return '<UUID>';
    if (ISO_TIMESTAMP_RE.test(value)) return '<TIMESTAMP>';
    if (path.isAbsolute(value)) return '<PATH>';
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeForSnapshot);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeForSnapshot(v);
    return out;
  }
  return value;
}

// Populated by invokeCreateStudy() (CT-16/CT-28 sections) as it actually writes real
// files to local disk. Declared here, above the try/finally in main(), so the finally
// block can always see whatever was created before either a normal completion or an
// unexpected exception — cleanup must not depend on the variable being in scope only
// inside the section that happens to run last.
const createdUploadClinicDirs = new Set<string>();

/** Deletes every synthetic clinic upload directory CreateImagingStudy actually wrote
 * to during this run and returns what it found/removed, for the reporting step below.
 * Called unconditionally from main()'s `finally` — this is the real cleanup mechanism;
 * nothing about it depends on any particular test case executing or succeeding. */
async function cleanupUploadDirs(): Promise<Array<{ dir: string; existedBeforeCleanup: boolean }>> {
  const results: Array<{ dir: string; existedBeforeCleanup: boolean }> = [];
  for (const clinicId of createdUploadClinicDirs) {
    const dir = path.resolve(process.cwd(), 'uploads', clinicId);
    const existedBeforeCleanup = fs.existsSync(dir);
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
    results.push({ dir, existedBeforeCleanup });
  }
  return results;
}

async function main() {
  let cleanupResults: Array<{ dir: string; existedBeforeCleanup: boolean }> = [];

  try {
  // ══ CT-06 — bridge Bearer auth rejects a clinic-session JWT ═══════════════════════
  section('CT-06 — bridge Bearer authentication does not cross-accept a clinic-session JWT');

  const bootstrapHandler = getRouteHandler(imagingBridgePublicRouter as unknown as RouterLike, 'get', '/imaging/bridge/bootstrap');

  await test('a valid, correctly-signed clinic-session JWT presented as the bridge Bearer token is rejected with a generic 401', async () => {
    const req: any = { headers: { authorization: `Bearer ${clinicSessionJwt}` } };
    const res = mockResponse();
    await bootstrapHandler(req, res);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'Unauthorized' });
  });

  await test('an arbitrary opaque bearer string is also rejected 401 (not just JWTs specifically)', async () => {
    const req: any = { headers: { authorization: 'Bearer not-a-real-credential' } };
    const res = mockResponse();
    await bootstrapHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  await test('missing Authorization header is rejected 401', async () => {
    const req: any = { headers: {} };
    const res = mockResponse();
    await bootstrapHandler(req, res);
    assert.equal(res.statusCode, 401);
  });

  await test('positive control: the genuine bridge credential for a real seeded agent IS accepted (proves the fake DB lookup is a real match, not an always-null stub)', async () => {
    const req: any = { headers: { authorization: `Bearer ${seededBridgeCredential.token}` } };
    const res = mockResponse();
    await bootstrapHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.bridgeAgentId, seededBridgeAgent.id);
  });

  await test('the rejected-JWT response and the missing-token response are identical (no reason-for-rejection leak between "wrong credential type" and "no credential")', async () => {
    const reqJwt: any = { headers: { authorization: `Bearer ${clinicSessionJwt}` } };
    const resJwt = mockResponse();
    await bootstrapHandler(reqJwt, resJwt);

    const reqMissing: any = { headers: {} };
    const resMissing = mockResponse();
    await bootstrapHandler(reqMissing, resMissing);

    assert.equal(resJwt.statusCode, resMissing.statusCode);
    assert.deepEqual(resJwt.body, resMissing.body);
  });

  // ══ CT-19 — no DELETE route exists for ImagingStudy or ImagingImage ═══════════════
  section('CT-19 — static route-table inventory: no DELETE route for ImagingStudy/ImagingImage');

  const imagingSrc = src('../routes/imaging.ts');
  const bridgePublicSrc = src('../routes/imagingBridgePublic.ts');

  // Primary check: live route-table introspection against the REAL registered Express
  // router (per CT-19's own infra spec — "route table introspection, no live server
  // needed") rather than text matching, so a delete route registered via any call form
  // (e.g. router.route(path).delete(...)) would still be caught, not just the literal
  // `router.delete('...')` call shape.
  function listRoutesByMethod(router: RouterLike): Array<{ method: string; path: string }> {
    const out: Array<{ method: string; path: string }> = [];
    for (const layer of router.stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods ?? {})) {
        if (layer.route.methods[method]) out.push({ method: method.toUpperCase(), path: layer.route.path });
      }
    }
    return out;
  }

  const imagingRoutes = listRoutesByMethod(imagingRouter as unknown as RouterLike);
  const bridgePublicRoutes = listRoutesByMethod(imagingBridgePublicRouter as unknown as RouterLike);
  const imagingDeleteRoutes = imagingRoutes.filter(r => r.method === 'DELETE');
  const bridgePublicDeleteRoutes = bridgePublicRoutes.filter(r => r.method === 'DELETE');

  await test('imaging.ts registers at least one DELETE route overall (sanity check — proves this introspection actually finds real delete routes, not a vacuous pass)', () => {
    assert.ok(imagingDeleteRoutes.length > 0, 'expected imaging.ts to register at least one DELETE route (devices/bridges/bridge-pairings)');
  });

  await test('none of imaging.ts\'s registered DELETE routes target /imaging/studies (ImagingStudy) or any images sub-path (ImagingImage)', () => {
    for (const r of imagingDeleteRoutes) {
      assert.ok(!r.path.startsWith('/imaging/studies'), `unexpected DELETE route targeting a study path: ${r.path}`);
      assert.ok(!/images/i.test(r.path), `unexpected DELETE route targeting an images path: ${r.path}`);
    }
  });

  await test('imagingBridgePublic.ts registers zero DELETE routes at all', () => {
    assert.deepEqual(bridgePublicDeleteRoutes, []);
  });

  // Secondary, independent check: source-text regex over the raw file (catches the
  // route registration even if this test's own router import/instantiation ever
  // diverged from the on-disk source for any reason).
  function extractDeleteRoutePaths(sourceText: string): string[] {
    const paths: string[] = [];
    const re = /router\.delete\(\s*['"`]([^'"`]+)['"`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sourceText))) paths.push(m[1]!);
    return paths;
  }

  await test('source-text regex over imaging.ts agrees with the live route-table introspection above (same DELETE path set)', () => {
    assert.deepEqual(extractDeleteRoutePaths(imagingSrc).sort(), imagingDeleteRoutes.map(r => r.path).sort());
  });

  await test('source-text regex over imagingBridgePublic.ts also finds zero DELETE routes', () => {
    assert.deepEqual(extractDeleteRoutePaths(bridgePublicSrc), []);
  });

  // ══ CT-21 — legal-hold audit metadata: actorRole + hold state, never the reason text ══
  section('CT-21 — SetImagingLegalHold audit metadata never contains legalHoldReason text');

  const legalHoldHandler = getRouteHandler(imagingRouter as unknown as RouterLike, 'patch', '/imaging/studies/:id/legal-hold');

  async function invokeLegalHold(role: string, legalHold: boolean, reason: string) {
    auditLogCalls.length = 0;
    const req = authRequest({ role, normalizedRole: role }, { id: STUDY_ID }, {}, { body: { legalHold, reason } });
    const res = mockResponse();
    await legalHoldHandler(req, res);
    return { req, res };
  }

  await test('placing a legal hold (OWNER) writes exactly one audit entry with actorRole + legalHold + previousLegalHold, and no legalHoldReason field', async () => {
    const { res } = await invokeLegalHold('OWNER', true, SYNTHETIC_LEGAL_HOLD_REASON);
    assert.equal(res.statusCode, 200);
    assert.equal(auditLogCalls.length, 1);
    const entry = auditLogCalls[0]!;
    assert.equal(entry.actorRole, 'OWNER');
    assert.equal(entry.action, 'imaging_study_legal_hold_updated');
    assert.deepEqual(entry.metadata, { legalHold: true, previousLegalHold: true });
    assert.ok(!('legalHoldReason' in (entry.metadata as object)));
    assert.ok(!('reason' in (entry.metadata as object)));
  });

  await test('releasing a legal hold (ORG_ADMIN) still records actorRole + hold booleans, never the reason text, anywhere in the audit entry', async () => {
    const { res } = await invokeLegalHold('ORG_ADMIN', false, SYNTHETIC_LEGAL_HOLD_REASON);
    assert.equal(res.statusCode, 200);
    const entry = auditLogCalls[0]!;
    assert.equal(entry.actorRole, 'ORG_ADMIN');
    assert.deepEqual(entry.metadata, { legalHold: false, previousLegalHold: true });
  });

  await test('the reason text never appears anywhere in the serialized audit entry, regardless of actor role (OWNER, ORG_ADMIN both checked)', async () => {
    for (const role of ['OWNER', 'ORG_ADMIN']) {
      await invokeLegalHold(role, true, SYNTHETIC_LEGAL_HOLD_REASON);
      const serialized = JSON.stringify(auditLogCalls[0]);
      assert.ok(!serialized.includes(SYNTHETIC_LEGAL_HOLD_REASON), `audit entry for role ${role} leaked the legal-hold reason text`);
    }
  });

  await test('actorRole is a top-level audit field (written via writeAuditLog\'s actorRole input), not nested inside metadata', () => {
    const entry = auditLogCalls[0]!;
    assert.ok('actorRole' in entry);
    assert.ok(!('actorRole' in (entry.metadata as object)));
  });

  // ══ CT-16 — legalHoldReason redaction, uniform across all four response surfaces ═══
  section('CT-16 — legalHoldReason redaction is uniform across GetImagingStudy / ListPatientImaging / ListUnlinkedImagingStudies / CreateImagingStudy');

  const getStudyHandler = getRouteHandler(imagingRouter as unknown as RouterLike, 'get', '/imaging/studies/:id');
  const listPatientImagingHandler = getRouteHandler(imagingRouter as unknown as RouterLike, 'get', '/patients/:patientId/imaging');
  const listUnlinkedHandler = getRouteHandler(imagingRouter as unknown as RouterLike, 'get', '/imaging/unlinked');
  const createStudyHandler = getRouteHandler(imagingRouter as unknown as RouterLike, 'post', '/imaging/studies');

  function syntheticJpeg(): Buffer {
    return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
  }

  async function invokeCreateStudy(role: string) {
    createdStudyStore = null;
    const buffer = syntheticJpeg();
    const req = authRequest(
      { role, normalizedRole: role },
      {},
      {},
      {
        body: { modality: 'OTHER' },
        file: {
          buffer,
          originalname: 'synthetic.jpg',
          mimetype: 'image/jpeg',
          size: buffer.length,
        },
      },
    );
    const res = mockResponse();
    await createStudyHandler(req, res);
    createdUploadClinicDirs.add(CLINIC_ID);
    return res;
  }

  for (const role of REDACTED_ROLES) {
    await test(`GetImagingStudy: ${role} never sees legalHoldReason (legalHold boolean still visible)`, async () => {
      const req = authRequest({ role, normalizedRole: role }, { id: STUDY_ID });
      const res = mockResponse();
      await getStudyHandler(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.legalHoldReason, null);
      assert.equal(res.body.legalHold, true);
    });

    await test(`ListPatientImaging: ${role} never sees legalHoldReason on any returned study`, async () => {
      const req = authRequest({ role, normalizedRole: role }, { patientId: PATIENT_ID });
      const res = mockResponse();
      await listPatientImagingHandler(req, res);
      assert.equal(res.statusCode, 200);
      assert.ok(Array.isArray(res.body) && res.body.length > 0);
      for (const study of res.body) assert.equal(study.legalHoldReason, null);
    });

    await test(`ListUnlinkedImagingStudies: ${role} never sees legalHoldReason on any returned study`, async () => {
      const req = authRequest({ role, normalizedRole: role });
      const res = mockResponse();
      await listUnlinkedHandler(req, res);
      assert.equal(res.statusCode, 200);
      assert.ok(Array.isArray(res.body) && res.body.length > 0);
      for (const study of res.body) assert.equal(study.legalHoldReason, null);
    });

    await test(`CreateImagingStudy: ${role} never sees legalHoldReason in the 201 response`, async () => {
      const res = await invokeCreateStudy(role);
      assert.equal(res.statusCode, 201);
      assert.equal(res.body.legalHoldReason, null);
    });
  }

  for (const role of UNREDACTED_ROLES) {
    await test(`GetImagingStudy: ${role} still sees the legalHoldReason text (current behavior, unchanged by this characterization)`, async () => {
      const req = authRequest({ role, normalizedRole: role }, { id: STUDY_ID });
      const res = mockResponse();
      await getStudyHandler(req, res);
      assert.equal(res.body.legalHoldReason, SYNTHETIC_LEGAL_HOLD_REASON);
    });

    await test(`ListPatientImaging: ${role} still sees the legalHoldReason text`, async () => {
      const req = authRequest({ role, normalizedRole: role }, { patientId: PATIENT_ID });
      const res = mockResponse();
      await listPatientImagingHandler(req, res);
      for (const study of res.body) assert.equal(study.legalHoldReason, SYNTHETIC_LEGAL_HOLD_REASON);
    });
  }

  await test('source-regression guard: CreateImagingStudy\'s 201 response is wired through redactStudyLegalHoldReason(..., canSeeLegalHoldReason(req)) exactly like the other three surfaces (catches a future refactor silently dropping the call)', () => {
    assert.ok(
      /res\.status\(201\)\.json\(redactStudyLegalHoldReason\(full!,\s*canSeeLegalHoldReason\(req\)\)\)/.test(imagingSrc),
      'expected CreateImagingStudy\'s response line to call redactStudyLegalHoldReason(full!, canSeeLegalHoldReason(req))',
    );
  });

  // ══ CT-28 — deterministic response-shape snapshots ════════════════════════════════
  section('CT-28 — response-shape snapshots (GetImagingStudy, ListPatientImaging, CreateImagingStudy)');

  await test('GetImagingStudy (OWNER) response shape matches the recorded snapshot', async () => {
    const req = authRequest({ role: 'OWNER', normalizedRole: 'OWNER' }, { id: STUDY_ID });
    const res = mockResponse();
    await getStudyHandler(req, res);
    const normalized = normalizeForSnapshot(res.body);
    assert.deepEqual(normalized, {
      id: STUDY_ID,
      clinicId: CLINIC_ID,
      patientId: PATIENT_ID,
      appointmentId: null,
      treatmentCaseId: null,
      deviceId: null,
      imagingRequestId: null,
      modality: 'OTHER',
      studyDate: '<TIMESTAMP>',
      description: null,
      source: 'manual_upload',
      status: 'active',
      createdById: 'user-fixture-1',
      bridgeAgentId: null,
      ingestKey: null,
      legalHold: true,
      legalHoldReason: SYNTHETIC_LEGAL_HOLD_REASON,
      createdAt: '<TIMESTAMP>',
      updatedAt: '<TIMESTAMP>',
      images: [
        { id: IMAGE_ID, originalName: 'synthetic.jpg', fileSize: 68, mimeType: 'image/jpeg', sopInstanceUid: null, createdAt: '<TIMESTAMP>' },
      ],
      device: null,
      patient: { id: PATIENT_ID, firstName: 'Synthetic', lastName: 'Patient' },
      appointment: null,
      treatmentCase: null,
      imagingRequest: null,
      createdBy: { id: 'user-fixture-1', firstName: 'Synthetic', lastName: 'Staff' },
    });
  });

  await test('GetImagingStudy (RECEPTIONIST) response shape matches the recorded redacted snapshot (legalHoldReason: null, nothing else changes)', async () => {
    const req = authRequest({ role: 'RECEPTIONIST', normalizedRole: 'RECEPTIONIST' }, { id: STUDY_ID });
    const res = mockResponse();
    await getStudyHandler(req, res);
    const normalized: any = normalizeForSnapshot(res.body);
    assert.equal(normalized.legalHoldReason, null);
    assert.equal(normalized.legalHold, true);
    assert.equal(normalized.id, STUDY_ID);
    assert.equal(Array.isArray(normalized.images), true);
    assert.equal(normalized.images.length, 1);
    assert.equal(normalized.images[0].id, IMAGE_ID);
  });

  await test('ListPatientImaging (OWNER) response shape is a top-level array whose element shape matches GetImagingStudy\'s snapshot', async () => {
    const req = authRequest({ role: 'OWNER', normalizedRole: 'OWNER' }, { patientId: PATIENT_ID });
    const res = mockResponse();
    await listPatientImagingHandler(req, res);
    assert.ok(Array.isArray(res.body));
    const normalized: any = normalizeForSnapshot(res.body[0]);
    assert.equal(normalized.legalHoldReason, SYNTHETIC_LEGAL_HOLD_REASON);
    assert.equal(normalized.id, STUDY_ID);
    assert.deepEqual(Object.keys(normalized).sort(), Object.keys(studyFixture()).sort());
  });

  await test('CreateImagingStudy (OWNER) 201 response shape matches the recorded snapshot (same field set as GetImagingStudy, real created id substituted)', async () => {
    const res = await invokeCreateStudy('OWNER');
    assert.equal(res.statusCode, 201);
    const normalized: any = normalizeForSnapshot(res.body);
    assert.deepEqual(Object.keys(normalized).sort(), Object.keys(studyFixture()).sort());
    assert.equal(normalized.legalHoldReason, SYNTHETIC_LEGAL_HOLD_REASON);
    assert.equal(normalized.legalHold, true);
    assert.equal(normalized.clinicId, CLINIC_ID);
    assert.equal(normalized.modality, 'OTHER');
    assert.equal(normalized.source, 'manual_upload');
  });

  } finally {
    // Real cleanup happens HERE, unconditionally — whether the try block above ran to
    // completion or an unexpected exception escaped partway through (e.g. a route
    // lookup failing before any test() call could wrap it). This does not depend on
    // reaching the "Cleanup" reporting section below, which only runs on the
    // non-throwing path and only verifies/reports what this finally already did.
    cleanupResults = await cleanupUploadDirs();
  }

  // ── Cleanup (reporting only): confirm what the finally block above already removed.
  // The tiny synthetic file(s) CreateImagingStudy actually wrote to local disk
  // (fileStorage.ts default mode) under this run's synthetic clinic id are already
  // gone by this point — this test asserts that fact, it does not perform the removal.
  section('Cleanup');

  await test('synthetic upload directory removed, no residue left on disk (verifying the unconditional finally-block cleanup above, not performing it)', () => {
    for (const { dir } of cleanupResults) {
      assert.equal(fs.existsSync(dir), false);
    }
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
