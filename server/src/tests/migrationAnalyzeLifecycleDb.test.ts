/**
 * migrationAnalyzeLifecycleDb.test.ts — F3-DATA-MIG-TODAY-001-PROD-001
 *
 * The production blocker this suite exists for:
 *
 *   POST /migrations/runs            -> 201
 *   POST /migrations/runs/:id/upload -> 200   (status UPLOADED)
 *   POST /migrations/runs/:id/analyze-> 409   "A migration run in status
 *                                              UPLOADED cannot move to
 *                                              MAPPING_READY."
 *
 * and — worse than the 409 — the mapping rows had ALREADY been committed when
 * the transition threw, so the run sat in UPLOADED carrying a full set of
 * field mappings, `analyzedAt` NULL and no error code recorded.
 *
 * The accepted lifecycle (runState.ts) is
 *   UPLOADED -> ANALYZED -> MAPPING_READY | MAPPING_REQUIRED
 * and UPLOADED -> MAPPING_* is deliberately NOT an edge. Analyze was skipping
 * the ANALYZED hop. Nothing about the state machine is relaxed here: the
 * route now takes both edges, in one transaction, each one asserted and
 * audited.
 *
 * Why no existing suite caught it: migrationExecutionDb.test.ts seeds runs
 * directly at status READY with mappings written by the fixture, and
 * migrationPlatformAuthScope.test.ts is a static source scan. NOTHING drove
 * the create -> upload -> analyze route sequence, so the only broken edge in
 * the whole state machine was also the only one never exercised.
 *
 * DB-BACKED. Requires DATABASE_URL to point at a DISPOSABLE Postgres — it
 * creates and deletes real rows. Registered under `server:test:disposable-db`.
 *
 * R2 extends this suite to the same defect class on PUT /mappings and
 * POST /mappings/accept-auto: those routes committed their mapping-row edits in
 * one transaction and moved the run in another, so a rejected transition — a
 * concurrent status change, a dry run started in another tab — left the edited
 * rows persisted underneath a run that never moved. Both routes are now one
 * transaction, and the transition itself is a CONDITIONAL update
 * (`WHERE id = ? AND status = ?`) so a status that changed mid-transaction
 * rolls the whole logical action back instead of being silently overwritten.
 *
 * Route handlers are invoked by extracting the router's middleware chain, the
 * same technique as platformBackupAudit.test.ts — no supertest dependency.
 *
 * Every fixture is SYNTHETIC. No real patient data and no value from the
 * first-customer workbook appears anywhere in this file; the HEADER names are
 * from the accepted mapping matrix (they are schema, not data) so that the
 * proposed mapping shape matches what production produced.
 */

import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import jwt from 'jsonwebtoken';

import prisma from '../db.js';
import platformMigrationRouter from '../routes/platformMigration.js';
import { authenticatePlatformAdmin, generatePlatformToken } from '../middleware/platformAuth.js';
import { PLATFORM_SESSION_COOKIE, createSessionId } from '../utils/sessionCookies.js';
import { deleteSourceFile } from '../services/migration/sourceFileStore.js';
import { canTransition } from '../services/migration/runState.js';
import type { MigrationRunStatus } from '../services/migration/contracts.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${(err as Error)?.stack ?? err}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// Route-stack invocation (mirrors platformBackupAudit.test.ts)
// ---------------------------------------------------------------------------

type Handler = (req: any, res: any, next: (err?: unknown) => void) => unknown;

function routeChain(method: 'post' | 'put' | 'get', path: string): Handler[] {
  for (const layer of (platformMigrationRouter as any).stack) {
    if (layer.route?.path === path && layer.route.methods?.[method]) {
      return layer.route.stack.map((s: any) => s.handle as Handler);
    }
  }
  throw new Error(`No route handler found for ${method.toUpperCase()} ${path}`);
}

interface MockRes {
  statusCode: number;
  body: any;
  status(code: number): MockRes;
  json(payload: unknown): MockRes;
}

function mockRes(): MockRes {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

async function runChain(chain: Handler[], req: any, res: MockRes): Promise<MockRes> {
  for (const handler of chain) {
    let advanced = false;
    let handlerError: unknown;
    await new Promise<void>((resolve, reject) => {
      const next = (err?: unknown) => {
        advanced = true;
        if (err) handlerError = err;
        resolve();
      };
      let result: unknown;
      try {
        result = handler(req, res, next);
      } catch (err) {
        reject(err);
        return;
      }
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then(() => resolve(), reject);
      } else if (!advanced) {
        // Synchronous middleware that neither threw nor called next yet (e.g.
        // multer) resolves through its own callback; give it the event loop.
        setImmediate(() => resolve());
      }
    });
    if (handlerError) throw handlerError;
    if (!advanced) return res;
  }
  return res;
}

/** The router's own `use` layers — the Platform Admin gate and CSRF. */
function gateChain(): Handler[] {
  return (platformMigrationRouter as any).stack
    .filter((layer: any) => !layer.route)
    .map((layer: any) => layer.handle as Handler);
}

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

const ACTOR_ID = `mig-analyze-admin-${randomUUID().slice(0, 8)}`;
const ACTOR_EMAIL = `${ACTOR_ID}@platform.test`;
const ACTOR_SESSION_ID = createSessionId();

function adminReq(params: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  return {
    params,
    body,
    query: {},
    headers: {},
    get: () => undefined,
    platformAdmin: { id: ACTOR_ID, email: ACTOR_EMAIL, sessionId: ACTOR_SESSION_ID },
    authSource: 'cookie',
  } as any;
}

/**
 * A request carrying a real cookie, for the AUTHORIZATION assertions. It is a
 * Readable so the same shape works for the multipart upload route.
 */
function cookieReq(cookie: string | null, params: Record<string, string> = {}) {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return {
    params,
    body: {},
    query: {},
    headers,
    method: 'POST',
    originalUrl: '/api/platform/migrations/runs/x/analyze',
    path: '/migrations/runs/x/analyze',
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as any;
}

/**
 * A multipart/form-data request multer can actually parse: the upload route's
 * chain starts with multer, and driving it for real is the whole point of
 * reproducing the production sequence rather than injecting `req.file`.
 */
function uploadReq(runId: string, file: Buffer, filename: string) {
  const boundary = `----migtest${randomUUID().replace(/-/g, '')}`;
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const payload = Buffer.concat([head, file, tail]);

  const req: any = Readable.from([payload]);
  req.params = { id: runId };
  req.query = {};
  req.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(payload.length),
  };
  req.get = (name: string) => req.headers[name.toLowerCase()];
  req.platformAdmin = { id: ACTOR_ID, email: ACTOR_EMAIL, sessionId: ACTOR_SESSION_ID };
  req.authSource = 'cookie';
  return req;
}

const createRunChain = routeChain('post', '/migrations/runs');
const uploadChain = routeChain('post', '/migrations/runs/:id/upload');
const analyzeChain = routeChain('post', '/migrations/runs/:id/analyze');
const mappingsGetChain = routeChain('get', '/migrations/runs/:id/mappings');
const mappingsPutChain = routeChain('put', '/migrations/runs/:id/mappings');
const acceptAutoChain = routeChain('post', '/migrations/runs/:id/mappings/accept-auto');

// ---------------------------------------------------------------------------
// Concurrency seam
// ---------------------------------------------------------------------------

/**
 * Run `action` while ANOTHER connection commits a status change into the
 * middle of the route's own transaction — the stale/concurrent request the
 * atomicity fix exists for.
 *
 * `prisma.$transaction` is patched for the duration so the flip lands at a
 * chosen, DETERMINISTIC point rather than being raced for:
 *
 *  - 'transaction-open': just before the route's transaction begins, i.e.
 *    after its courtesy status pre-check has already passed. Proves the route
 *    does not trust that pre-check.
 *  - 'after-mapping-write': after the route has applied its first mapping-row
 *    update INSIDE its transaction. Proves the edited rows roll back when the
 *    transition is then rejected.
 *
 * The flip itself goes through the base client, so it is a genuinely separate
 * transaction on a separate connection, exactly like a second browser tab.
 */
async function withConcurrentStatusFlip<T>(
  runId: string,
  newStatus: MigrationRunStatus,
  when: 'transaction-open' | 'after-mapping-write',
  action: () => Promise<T>,
): Promise<T> {
  const original = prisma.$transaction.bind(prisma) as any;
  let fired = false;
  const flip = async () => {
    if (fired) return;
    fired = true;
    await prisma.migrationRun.update({ where: { id: runId }, data: { status: newStatus } });
  };

  (prisma as any).$transaction = (arg: any, options: any) => {
    if (typeof arg !== 'function') {
      // The batch form. A route that writes its rows through a batch and moves
      // the run afterwards has already committed those rows by the time this
      // resolves — firing the flip here is what makes the divergence visible.
      return original(arg, options).then(async (result: unknown) => {
        if (when === 'after-mapping-write') await flip();
        return result;
      });
    }
    if (when === 'transaction-open') {
      return flip().then(() => original(arg, options));
    }
    return original(async (tx: any) => {
      const proxied = new Proxy(tx, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (prop !== 'migrationFieldMapping' || typeof value !== 'object' || value === null) {
            return value;
          }
          return new Proxy(value, {
            get(model, modelProp, modelReceiver) {
              const method = Reflect.get(model, modelProp, modelReceiver);
              if (modelProp !== 'updateMany' || typeof method !== 'function') return method;
              return async (...args: unknown[]) => {
                const result = await (method as any).apply(model, args);
                await flip();
                return result;
              };
            },
          });
        },
      });
      return arg(proxied);
    }, options);
  };

  try {
    const result = await action();
    assert.equal(fired, true, 'the concurrency seam never fired — the test proves nothing');
    return result;
  } finally {
    (prisma as any).$transaction = original;
  }
}

/** Mapping rows exactly as persisted, for a byte/field-equivalence comparison. */
const mappingRows = (runId: string) =>
  prisma.migrationFieldMapping.findMany({ where: { runId }, orderBy: { sourceIndex: 'asc' } });

/** Audit rows this logical action would have written had it committed. */
async function mappingAuditCount(runId: string) {
  return prisma.platformAdminAuditEvent.count({
    where: {
      resourceKey: runId,
      action: {
        in: [
          'clinic_data_migration.mapping_saved',
          'clinic_data_migration.mapping_revalidated',
          'clinic_data_migration.mapping_auto_accepted',
        ],
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Synthetic .xlsx fixture
// ---------------------------------------------------------------------------

/**
 * Header names come from the accepted first-customer matrix so the proposed
 * mapping shape is the one production produced: five AUTO_CONFIDENT columns
 * and one LEGAL_BLOCKED column (KANGURUBU — a special-category health value
 * behind a legal gate). The CELL VALUES are invented.
 */
const HEADERS = ['HASTA_ID', 'ADI', 'SOYADI', 'CEPTELEFONU', 'TCNO', 'KANGURUBU'] as const;

/** Checksum-valid synthetic TCKN from a 9-digit stem — never a real one. */
function synthTckn(stem: string): string {
  const d = stem.split('').map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const d10 = (odd * 7 - even + 100) % 10;
  const d11 = (d.reduce((a, b) => a + b, 0) + d10) % 10;
  return stem + String(d10) + String(d11);
}

/** A real Excel-produced .xlsx (ZIP/OOXML), matching the production artifact. */
async function buildXlsxFixture(rowCount = 5): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sayfa1');
  sheet.addRow([...HEADERS]);
  for (let i = 0; i < rowCount; i++) {
    const n = 4200 + i;
    sheet.addRow([
      `SRC-${n}`,
      `Sentetik${n}`,
      `Kayit${n}`,
      `053200${String(n).padStart(5, '0')}`,
      synthTckn(String(100000000 + n).slice(0, 9)),
      i % 2 === 0 ? '0 Rh+' : 'A Rh-',
    ]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// Tenant fixtures
// ---------------------------------------------------------------------------

const createdOrgIds: string[] = [];
const createdRunIds: string[] = [];

async function makeTenant(label: string) {
  const suffix = randomUUID().slice(0, 8);
  const plan = await prisma.plan.create({
    data: {
      name: `mig-analyze-${label}-${suffix}`,
      displayName: `Migration Analyze ${label}`,
      maxUsers: 100,
      maxPatients: 100000,
      monthlyPrice: 0,
      features: {},
    },
  });
  const organization = await prisma.organization.create({
    data: {
      name: `MigAnalyzeOrg-${label}-${suffix}`,
      slug: `miga-${label}-${suffix}`,
      planId: plan.id,
    },
  });
  const clinic = await prisma.clinic.create({
    data: {
      name: `MigAnalyzeClinic-${label}-${suffix}`,
      slug: `migac-${label}-${suffix}`,
      organizationId: organization.id,
      maxPatients: 100000,
    },
  });
  createdOrgIds.push(organization.id);
  return { organizationId: organization.id, clinicId: clinic.id };
}

async function cleanup() {
  for (const runId of createdRunIds) {
    const run = await prisma.migrationRun.findUnique({
      where: { id: runId },
      select: { sourceFileStoredPath: true },
    });
    if (run?.sourceFileStoredPath) {
      await deleteSourceFile(run.sourceFileStoredPath).catch(() => undefined);
    }
  }
  await prisma.platformAdminAuditEvent.deleteMany({ where: { actorPlatformAdminId: ACTOR_ID } });
  for (const organizationId of createdOrgIds) {
    await prisma.migrationRowOutcome.deleteMany({ where: { run: { organizationId } } });
    await prisma.migrationRunBatch.deleteMany({ where: { run: { organizationId } } });
    await prisma.migrationFieldMapping.deleteMany({ where: { run: { organizationId } } });
    await prisma.migrationRecord.deleteMany({ where: { organizationId } });
    await prisma.migrationReferenceMap.deleteMany({ where: { organizationId } });
    await prisma.patientIdentityDocument.deleteMany({ where: { organizationId } });
    await prisma.migrationRun.deleteMany({ where: { organizationId } });
    await prisma.patient.deleteMany({ where: { organizationId } });
    await prisma.userClinic.deleteMany({ where: { user: { organizationId } } });
    await prisma.user.deleteMany({ where: { organizationId } });
    await prisma.clinic.deleteMany({ where: { organizationId } });
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { planId: true },
    });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    if (org?.planId) await prisma.plan.deleteMany({ where: { id: org.planId } });
  }
  createdOrgIds.length = 0;
  createdRunIds.length = 0;
  await prisma.platformAdmin.deleteMany({ where: { id: ACTOR_ID } });
}

// ---------------------------------------------------------------------------
// Domain-write census — analyze must write NOTHING outside the migration tables
// ---------------------------------------------------------------------------

async function domainCensus() {
  const [
    patients,
    appointments,
    appointmentRequests,
    payments,
    paymentPlans,
    treatmentCases,
    treatmentPlanProcedures,
    medicalHistories,
    patientConditions,
    identityDocuments,
    migrationRecords,
    rowOutcomes,
  ] = await Promise.all([
    prisma.patient.count(),
    prisma.appointment.count(),
    prisma.appointmentRequest.count(),
    prisma.payment.count(),
    prisma.paymentPlan.count(),
    prisma.treatmentCase.count(),
    prisma.treatmentPlanProcedure.count(),
    prisma.patientMedicalHistory.count(),
    prisma.patientCondition.count(),
    prisma.patientIdentityDocument.count(),
    prisma.migrationRecord.count(),
    prisma.migrationRowOutcome.count(),
  ]);
  return {
    patients,
    appointments,
    appointmentRequests,
    payments,
    paymentPlans,
    treatmentCases,
    treatmentPlanProcedures,
    medicalHistories,
    patientConditions,
    identityDocuments,
    migrationRecords,
    rowOutcomes,
  };
}

// ---------------------------------------------------------------------------

async function createRun(tenant: { organizationId: string; clinicId: string }) {
  const res = await runChain(createRunChain, adminReq({}, tenant), mockRes());
  assert.equal(res.statusCode, 201, `create run failed: ${JSON.stringify(res.body)}`);
  const runId = res.body.run.id as string;
  createdRunIds.push(runId);
  return runId;
}

async function uploadWorkbook(runId: string, file: Buffer, filename = 'synthetic-patients.xlsx') {
  const res = await runChain(uploadChain, uploadReq(runId, file, filename), mockRes());
  assert.equal(res.statusCode, 200, `upload failed: ${JSON.stringify(res.body)}`);
  return res;
}

const analyze = (runId: string, body: Record<string, unknown> = {}) =>
  runChain(analyzeChain, adminReq({ id: runId }, body), mockRes());

async function main() {
  // PlatformAdminAuditEvent.actorPlatformAdminId carries a real FK.
  await prisma.platformAdmin.upsert({
    where: { id: ACTOR_ID },
    update: {},
    create: {
      id: ACTOR_ID,
      email: ACTOR_EMAIL,
      passwordHash: 'not-a-real-hash-test-fixture-only',
      name: 'Test Fixture Platform Admin (Analyze Lifecycle)',
    },
  });

  const target = await makeTenant('target');
  const sibling = await makeTenant('sibling');
  const fixture = await buildXlsxFixture();

  // -------------------------------------------------------------------------
  section('The exact production sequence: create -> upload -> analyze');
  // -------------------------------------------------------------------------

  const censusBefore = await domainCensus();
  let runId = '';

  await test('POST /migrations/runs creates the run in CREATED', async () => {
    runId = await createRun(target);
    const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.status, 'CREATED');
    assert.equal(run.organizationId, target.organizationId);
    assert.equal(run.clinicId, target.clinicId);
  });

  await test('POST .../upload accepts a real Excel-generated .xlsx and moves to UPLOADED', async () => {
    await uploadWorkbook(runId, fixture);
    const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.status, 'UPLOADED');
    assert.equal(run.sourceFileFormat, 'xlsx');
    assert.notEqual(run.uploadedAt, null);
    assert.equal(run.analyzedAt, null);
  });

  await test('POST .../analyze from UPLOADED succeeds — the 409 regression', async () => {
    const res = await analyze(runId);
    assert.equal(
      res.statusCode,
      200,
      `analyze returned ${res.statusCode}: ${JSON.stringify(res.body)}`,
    );
    assert.notEqual(res.body?.code, 'MIGRATION_STATE_INVALID');
  });

  await test('the run lands in MAPPING_READY with analyzedAt populated and no error recorded', async () => {
    const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.status, 'MAPPING_READY');
    assert.notEqual(run.analyzedAt, null);
    assert.equal(run.lastErrorCode, null);
    assert.equal(run.lastErrorMessage, null);
    assert.equal(run.totalSourceRows, 5);
    assert.equal(run.headerColumnCount, HEADERS.length);
  });

  await test('the proposed mapping matches the production shape: 5 AUTO_CONFIDENT + 1 LEGAL_BLOCKED', async () => {
    const mappings = await prisma.migrationFieldMapping.findMany({ where: { runId } });
    assert.equal(mappings.length, HEADERS.length);
    assert.equal(mappings.filter((m) => m.state === 'AUTO_CONFIDENT').length, 5);
    assert.equal(mappings.filter((m) => m.state === 'LEGAL_BLOCKED').length, 1);
    assert.equal(
      mappings.some((m) => m.destinationField === 'provenance.sourceId'),
      true,
      'provenance.sourceId must be proposed or a rerun cannot be idempotent',
    );
    // The legal gate is preserved: a LEGAL_BLOCKED column carries no destination.
    for (const blocked of mappings.filter((m) => m.state === 'LEGAL_BLOCKED')) {
      assert.equal(blocked.destinationField, null);
    }
  });

  await test('the accepted lifecycle was TRAVERSED, not bypassed: UPLOADED->ANALYZED->MAPPING_READY', async () => {
    const events = await prisma.platformAdminAuditEvent.findMany({
      where: { resourceKey: runId, actorPlatformAdminId: ACTOR_ID },
      orderBy: { createdAt: 'asc' },
    });
    const hops = events
      .filter((e) => e.previousValue && e.newValue)
      .map((e) => `${e.previousValue}->${e.newValue}`);
    assert.equal(hops.includes('CREATED->UPLOADED'), true, JSON.stringify(hops));
    assert.equal(hops.includes('UPLOADED->ANALYZED'), true, JSON.stringify(hops));
    assert.equal(hops.includes('ANALYZED->MAPPING_READY'), true, JSON.stringify(hops));
    assert.equal(
      hops.includes('UPLOADED->MAPPING_READY'),
      false,
      'the illegal shortcut must never appear',
    );
  });

  await test('audit payloads carry ids, counts and codes only — no filename, no cell value', async () => {
    const events = await prisma.platformAdminAuditEvent.findMany({
      where: { resourceKey: runId },
    });
    const serialized = JSON.stringify(events.map((e) => e.safeMetadata ?? {}));
    for (const forbidden of ['synthetic-patients', 'Sentetik', 'Kayit', 'Rh+', '053200']) {
      assert.equal(
        serialized.includes(forbidden),
        false,
        `audit metadata leaked "${forbidden}": ${serialized}`,
      );
    }
  });

  await test('analyze writes ZERO patient/appointment/payment/clinical rows', async () => {
    const censusAfter = await domainCensus();
    assert.deepEqual(censusAfter, censusBefore);
  });

  // -------------------------------------------------------------------------
  section('Retry safety and convergence');
  // -------------------------------------------------------------------------

  await test('re-analyzing a MAPPING_READY run is safe and creates no duplicate mappings', async () => {
    const res = await analyze(runId);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.status, 'MAPPING_READY');
    const mappings = await prisma.migrationFieldMapping.findMany({ where: { runId } });
    assert.equal(mappings.length, HEADERS.length);
    assert.equal(new Set(mappings.map((m) => m.sourceField)).size, HEADERS.length);
  });

  await test(
    'the FAILED PRODUCTION SHAPE recovers: UPLOADED + orphaned mappings -> analyze converges',
    async () => {
      // Reproduce run 6a410f32-…'s persisted shape exactly: mappings committed,
      // status still UPLOADED, analyzedAt NULL.
      const strandedId = await createRun(target);
      await uploadWorkbook(strandedId, fixture);
      await prisma.migrationFieldMapping.createMany({
        data: HEADERS.map((header, index) => ({
          runId: strandedId,
          sourceField: header,
          sourceIndex: index,
          sourceNormalized: header.toLowerCase(),
          destinationField: null,
          state: index === HEADERS.length - 1 ? 'LEGAL_BLOCKED' : 'AUTO_CONFIDENT',
          confidence: 100,
          isAutoSuggested: true,
        })),
      });
      const stranded = await prisma.migrationRun.findUniqueOrThrow({ where: { id: strandedId } });
      assert.equal(stranded.status, 'UPLOADED');
      assert.equal(stranded.analyzedAt, null);
      assert.equal(
        await prisma.migrationFieldMapping.count({ where: { runId: strandedId } }),
        HEADERS.length,
      );

      const res = await analyze(strandedId);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));

      const recovered = await prisma.migrationRun.findUniqueOrThrow({ where: { id: strandedId } });
      assert.equal(recovered.status, 'MAPPING_READY');
      assert.notEqual(recovered.analyzedAt, null);

      const mappings = await prisma.migrationFieldMapping.findMany({
        where: { runId: strandedId },
      });
      assert.equal(mappings.length, HEADERS.length, 'stale rows must be replaced, not duplicated');
      assert.equal(new Set(mappings.map((m) => m.sourceField)).size, HEADERS.length);
      assert.equal(
        mappings.some((m) => m.destinationField === 'provenance.sourceId'),
        true,
        'the recovered mapping must be the freshly proposed one, not the stranded rows',
      );
    },
  );

  await test('analyze is refused in a stable state when no file has been uploaded', async () => {
    const emptyRunId = await createRun(target);
    const res = await analyze(emptyRunId);
    assert.equal(res.statusCode, 409);
    const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: emptyRunId } });
    assert.equal(run.status, 'CREATED', 'a refused analyze must not move the run');
    assert.equal(await prisma.migrationFieldMapping.count({ where: { runId: emptyRunId } }), 0);
  });

  await test(
    'the SIBLING defect: saving a valid mapping after a dry run reaches MAPPING_READY',
    async () => {
      /*
       * PUT /mappings advertises that it accepts DRY_RUN_COMPLETE and READY,
       * and then asked for <that status> -> MAPPING_READY, which the state
       * machine does not have. Same shape as the analyze blocker, one step
       * further down the operator's path: edit a column after looking at the
       * dry run and the save 409s.
       *
       * The DRY_RUN_COMPLETE status is set directly here as FIXTURE SETUP —
       * running a real dry run is migrationExecutionDb.test.ts's job and needs
       * identity-crypto secrets this suite deliberately does not require.
       */
      const editRunId = await createRun(target);
      await uploadWorkbook(editRunId, fixture);
      await analyze(editRunId);
      await prisma.migrationRun.update({
        where: { id: editRunId },
        data: { status: 'DRY_RUN_COMPLETE' },
      });

      const existing = await prisma.migrationFieldMapping.findFirstOrThrow({
        where: { runId: editRunId, destinationField: 'provenance.sourceId' },
      });
      const res = await runChain(
        mappingsPutChain,
        adminReq(
          { id: editRunId },
          {
            mappings: [
              {
                sourceField: existing.sourceField,
                destinationField: existing.destinationField,
                transform: existing.transform,
                composeOrder: existing.composeOrder,
                state: 'RESOLVED',
              },
            ],
          },
        ),
        mockRes(),
      );
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.validation.valid, true);

      const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: editRunId } });
      assert.equal(run.status, 'MAPPING_READY');

      const hops = (
        await prisma.platformAdminAuditEvent.findMany({
          where: { resourceKey: editRunId },
          orderBy: { createdAt: 'asc' },
        })
      )
        .filter((e) => e.previousValue && e.newValue)
        .map((e) => `${e.previousValue}->${e.newValue}`);
      assert.equal(hops.includes('DRY_RUN_COMPLETE->MAPPING_REQUIRED'), true, JSON.stringify(hops));
      assert.equal(hops.includes('MAPPING_REQUIRED->MAPPING_READY'), true, JSON.stringify(hops));
      assert.equal(hops.includes('DRY_RUN_COMPLETE->MAPPING_READY'), false);
    },
  );

  // -------------------------------------------------------------------------
  section('Mapping edit atomicity (R2)');
  // -------------------------------------------------------------------------

  /**
   * A run analyzed through the real routes and then parked at `status` as
   * FIXTURE SETUP — reaching DRY_RUN_COMPLETE/READY for real needs a dry run,
   * which is migrationExecutionDb.test.ts's job and requires identity-crypto
   * secrets this suite deliberately does not.
   */
  async function mappedRunAt(
    tenant: { organizationId: string; clinicId: string },
    status: MigrationRunStatus,
  ) {
    const id = await createRun(tenant);
    await uploadWorkbook(id, fixture);
    await analyze(id);
    if (status !== 'MAPPING_READY') {
      await prisma.migrationRun.update({ where: { id }, data: { status } });
    }
    return id;
  }

  /** A no-op-shaped but real edit of one decided column. */
  async function editProvenanceColumn(
    runId: string,
    overrides: Record<string, unknown> = {},
  ) {
    const existing = await prisma.migrationFieldMapping.findFirstOrThrow({
      where: { runId, destinationField: 'provenance.sourceId' },
    });
    return runChain(
      mappingsPutChain,
      adminReq(
        { id: runId },
        {
          mappings: [
            {
              sourceField: existing.sourceField,
              destinationField: existing.destinationField,
              transform: existing.transform,
              composeOrder: existing.composeOrder,
              state: 'RESOLVED',
              ...overrides,
            },
          ],
        },
      ),
      mockRes(),
    );
  }

  const mappingCensusBefore = await domainCensus();

  await test('READY + valid edit: READY -> MAPPING_REQUIRED -> MAPPING_READY, atomically', async () => {
    const readyRunId = await mappedRunAt(target, 'READY');
    const res = await editProvenanceColumn(readyRunId);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.validation.valid, true);

    const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: readyRunId } });
    assert.equal(run.status, 'MAPPING_READY');

    const hops = (
      await prisma.platformAdminAuditEvent.findMany({
        where: { resourceKey: readyRunId },
        orderBy: { createdAt: 'asc' },
      })
    )
      .filter((e) => e.previousValue && e.newValue)
      .map((e) => `${e.previousValue}->${e.newValue}`);
    assert.equal(hops.includes('READY->MAPPING_REQUIRED'), true, JSON.stringify(hops));
    assert.equal(hops.includes('MAPPING_REQUIRED->MAPPING_READY'), true, JSON.stringify(hops));
    assert.equal(hops.includes('READY->MAPPING_READY'), false, 'no shortcut edge');

    // The edit is persisted — the two hops did not roll it back.
    const edited = await prisma.migrationFieldMapping.findFirstOrThrow({
      where: { runId: readyRunId, destinationField: 'provenance.sourceId' },
    });
    assert.equal(edited.state, 'RESOLVED');
    assert.equal(edited.isAutoSuggested, false);
  });

  await test('an edit that invalidates the mapping lands in MAPPING_REQUIRED', async () => {
    const invalidRunId = await mappedRunAt(target, 'MAPPING_READY');
    const res = await editProvenanceColumn(invalidRunId, {
      destinationField: null,
      state: 'MANUAL_REQUIRED',
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.validation.valid, false);

    const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: invalidRunId } });
    assert.equal(run.status, 'MAPPING_REQUIRED');
    const rows = await mappingRows(invalidRunId);
    assert.equal(
      rows.some((r) => r.destinationField === 'provenance.sourceId'),
      false,
      'the invalidating edit is itself persisted — only the status decision changed',
    );
  });

  await test(
    'STALE REQUEST: status changes as the edit transaction opens -> 409, nothing written',
    async () => {
      const staleRunId = await mappedRunAt(target, 'MAPPING_READY');
      const before = await mappingRows(staleRunId);
      const auditBefore = await mappingAuditCount(staleRunId);

      // The request was routed while the run was still editable; by the time
      // its transaction opens the run is executing.
      const res = await withConcurrentStatusFlip(staleRunId, 'RUNNING', 'transaction-open', () =>
        editProvenanceColumn(staleRunId),
      );

      assert.equal(res.statusCode, 409, JSON.stringify(res.body));
      assert.equal(res.body.code, 'MIGRATION_STATE_INVALID');

      const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: staleRunId } });
      assert.equal(run.status, 'RUNNING', 'the concurrent status must survive untouched');
      assert.deepEqual(await mappingRows(staleRunId), before, 'mapping rows must be unchanged');
      assert.equal(
        await mappingAuditCount(staleRunId),
        auditBefore,
        'a failed logical action may leave no audit row behind',
      );
    },
  );

  await test(
    'CONCURRENT COMMIT MID-TRANSACTION: applied mapping edits ROLL BACK with the rejected hop',
    async () => {
      const racedRunId = await mappedRunAt(target, 'DRY_RUN_COMPLETE');
      const before = await mappingRows(racedRunId);
      const auditBefore = await mappingAuditCount(racedRunId);

      /*
       * The route has already re-read DRY_RUN_COMPLETE inside its transaction
       * and applied the mapping-row update when another connection commits
       * DRY_RUN_RUNNING. The conditional transition then matches no row, the
       * transaction aborts, and the row update that had ALREADY been applied
       * inside it must disappear with it. Before R2 that update lived in its
       * own committed transaction and survived.
       */
      const res = await withConcurrentStatusFlip(
        racedRunId,
        'DRY_RUN_RUNNING',
        'after-mapping-write',
        () => editProvenanceColumn(racedRunId),
      );

      assert.equal(res.statusCode, 409, JSON.stringify(res.body));
      assert.equal(res.body.code, 'MIGRATION_STATE_INVALID');

      const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: racedRunId } });
      assert.equal(run.status, 'DRY_RUN_RUNNING');

      const after = await mappingRows(racedRunId);
      assert.deepEqual(after, before, 'every mapping field must be byte-equivalent to before');
      assert.equal(
        after.some((r) => r.decidedByPlatformAdminId !== null),
        false,
        'the rolled-back edit must leave no decision provenance behind',
      );
      assert.equal(await mappingAuditCount(racedRunId), auditBefore);
    },
  );

  await test(
    'accept-auto is atomic too: a concurrent status change promotes nothing',
    async () => {
      const autoRunId = await mappedRunAt(target, 'MAPPING_READY');
      // Give the run something to promote.
      await prisma.migrationFieldMapping.updateMany({
        where: { runId: autoRunId, destinationField: 'provenance.sourceId' },
        data: { state: 'AUTO_REVIEW' },
      });
      const before = await mappingRows(autoRunId);
      const auditBefore = await mappingAuditCount(autoRunId);

      const res = await withConcurrentStatusFlip(autoRunId, 'RUNNING', 'transaction-open', () =>
        runChain(acceptAutoChain, adminReq({ id: autoRunId }), mockRes()),
      );

      assert.equal(res.statusCode, 409, JSON.stringify(res.body));
      assert.equal(res.body.code, 'MIGRATION_STATE_INVALID');
      const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: autoRunId } });
      assert.equal(run.status, 'RUNNING');
      assert.deepEqual(await mappingRows(autoRunId), before);
      assert.equal(await mappingAuditCount(autoRunId), auditBefore);
    },
  );

  await test('a mapping edit never touches a sibling clinic run', async () => {
    const siblingRunId = await mappedRunAt(sibling, 'MAPPING_READY');
    const siblingBefore = await mappingRows(siblingRunId);
    const siblingRunBefore = await prisma.migrationRun.findUniqueOrThrow({
      where: { id: siblingRunId },
    });

    const editRunId = await mappedRunAt(target, 'MAPPING_READY');
    const res = await editProvenanceColumn(editRunId);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    assert.deepEqual(await mappingRows(siblingRunId), siblingBefore);
    const siblingRunAfter = await prisma.migrationRun.findUniqueOrThrow({
      where: { id: siblingRunId },
    });
    assert.equal(siblingRunAfter.status, siblingRunBefore.status);
    assert.equal(siblingRunAfter.organizationId, sibling.organizationId);
    assert.equal(siblingRunAfter.clinicId, sibling.clinicId);
  });

  await test('no mapping edit wrote a patient/appointment/payment/clinical row', async () => {
    assert.deepEqual(await domainCensus(), mappingCensusBefore);
  });

  // -------------------------------------------------------------------------
  section('The state machine is NOT weakened');
  // -------------------------------------------------------------------------

  await test('UPLOADED -> MAPPING_READY / MAPPING_REQUIRED are still ILLEGAL edges', () => {
    assert.equal(canTransition('UPLOADED', 'MAPPING_READY'), false);
    assert.equal(canTransition('UPLOADED', 'MAPPING_REQUIRED'), false);
    assert.equal(canTransition('UPLOADED', 'ANALYZED'), true);
    assert.equal(canTransition('ANALYZED', 'MAPPING_READY'), true);
    assert.equal(canTransition('ANALYZED', 'MAPPING_REQUIRED'), true);
  });

  await test('terminal statuses remain terminal', () => {
    for (const terminal of ['COMPLETED', 'FAILED', 'CANCELLED'] as MigrationRunStatus[]) {
      for (const to of ['UPLOADED', 'RUNNING', 'MAPPING_READY'] as MigrationRunStatus[]) {
        assert.equal(canTransition(terminal, to), false, `${terminal}->${to}`);
      }
    }
  });

  await test(
    'every status an endpoint accepts can legally reach the status that endpoint sets',
    () => {
      /*
       * The defect class, generalized: a route advertises "I accept status X"
       * and then asks for an edge X -> Y that the state machine does not have.
       * That is a 409 discovered in production, after the route has already
       * written rows. This table is the standing guard — it is derived from
       * the routes by reading them, so it must be updated when a route's
       * accepted-status list or target changes.
       *
       * A path of length 2 is legal here only because the route takes BOTH
       * hops inside one transaction (analyze, and a mapping edit after a dry
       * run); anything longer would be a route inventing its own lifecycle.
       */
      const contracts: Array<{ endpoint: string; from: MigrationRunStatus[]; to: MigrationRunStatus[] }> = [
        {
          endpoint: 'POST /upload',
          from: [
            'CREATED',
            'UPLOADED',
            'ANALYZED',
            'MAPPING_REQUIRED',
            'MAPPING_READY',
            'DRY_RUN_COMPLETE',
            'BLOCKED',
            'READY',
          ],
          to: ['UPLOADED'],
        },
        {
          endpoint: 'POST /analyze',
          from: ['UPLOADED', 'ANALYZED', 'MAPPING_REQUIRED', 'MAPPING_READY'],
          to: ['MAPPING_READY', 'MAPPING_REQUIRED'],
        },
        {
          endpoint: 'PUT /mappings',
          from: [
            'ANALYZED',
            'MAPPING_REQUIRED',
            'MAPPING_READY',
            'DRY_RUN_COMPLETE',
            'BLOCKED',
            'READY',
          ],
          to: ['MAPPING_READY', 'MAPPING_REQUIRED'],
        },
        {
          endpoint: 'POST /mappings/accept-auto',
          from: ['ANALYZED', 'MAPPING_REQUIRED', 'MAPPING_READY'],
          to: ['MAPPING_READY', 'MAPPING_REQUIRED'],
        },
        {
          endpoint: 'POST /dry-run',
          from: ['MAPPING_READY', 'DRY_RUN_COMPLETE', 'BLOCKED', 'READY'],
          to: ['DRY_RUN_RUNNING'],
        },
      ];

      const ALL: MigrationRunStatus[] = [
        'CREATED',
        'UPLOADED',
        'ANALYZED',
        'MAPPING_REQUIRED',
        'MAPPING_READY',
        'DRY_RUN_RUNNING',
        'DRY_RUN_COMPLETE',
        'BLOCKED',
        'READY',
        'RUNNING',
        'PARTIAL_FAILURE',
        'COMPLETED',
        'FAILED',
        'CANCELLED',
      ];

      /** Shortest number of legal edges from -> to, capped at 2. */
      const reachableInAtMostTwoHops = (from: MigrationRunStatus, to: MigrationRunStatus) =>
        canTransition(from, to) ||
        ALL.some((mid) => canTransition(from, mid) && canTransition(mid, to));

      for (const contract of contracts) {
        for (const from of contract.from) {
          for (const to of contract.to) {
            assert.equal(
              reachableInAtMostTwoHops(from, to),
              true,
              `${contract.endpoint} accepts ${from} but ${from} -> ${to} is unreachable`,
            );
          }
        }
      }
    },
  );

  // -------------------------------------------------------------------------
  section('Tenant scope');
  // -------------------------------------------------------------------------

  await test('a sibling clinic run is untouched by the target run analyze', async () => {
    const siblingRunId = await createRun(sibling);
    await uploadWorkbook(siblingRunId, fixture);
    await analyze(siblingRunId);

    const siblingMappingsBefore = await prisma.migrationFieldMapping.findMany({
      where: { runId: siblingRunId },
      orderBy: { sourceIndex: 'asc' },
    });
    assert.equal(siblingMappingsBefore.length, HEADERS.length);

    // Re-analyze the TARGET run; the sibling's rows must not move.
    const targetRunId = await createRun(target);
    await uploadWorkbook(targetRunId, fixture);
    const res = await analyze(targetRunId);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));

    const siblingMappingsAfter = await prisma.migrationFieldMapping.findMany({
      where: { runId: siblingRunId },
      orderBy: { sourceIndex: 'asc' },
    });
    assert.equal(siblingMappingsAfter.length, HEADERS.length);
    assert.deepEqual(
      siblingMappingsAfter.map((m) => m.id),
      siblingMappingsBefore.map((m) => m.id),
      'sibling mapping rows must be neither deleted nor recreated',
    );

    const siblingRun = await prisma.migrationRun.findUniqueOrThrow({ where: { id: siblingRunId } });
    assert.equal(siblingRun.organizationId, sibling.organizationId);
    assert.equal(siblingRun.clinicId, sibling.clinicId);

    const targetRun = await prisma.migrationRun.findUniqueOrThrow({ where: { id: targetRunId } });
    assert.equal(targetRun.organizationId, target.organizationId);
    assert.equal(targetRun.clinicId, target.clinicId);
  });

  await test('the mappings endpoint only ever returns the addressed run rows', async () => {
    const res = await runChain(mappingsGetChain, adminReq({ id: runId }), mockRes());
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.mappings.length, HEADERS.length);
    const rows = await prisma.migrationFieldMapping.findMany({ where: { runId } });
    assert.equal(
      rows.every((r) => r.runId === runId),
      true,
    );
  });

  // -------------------------------------------------------------------------
  section('Platform Admin authorization gate');
  // -------------------------------------------------------------------------

  await test('an unauthenticated request cannot reach the analyze endpoint', async () => {
    const res = await runChain([gateChain()[0]!], cookieReq(null, { id: runId }), mockRes());
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'Unauthorized: Missing token');
  });

  await test('an ordinary clinic user session cannot reach the analyze endpoint', async () => {
    const clinicToken = jwt.sign(
      {
        type: 'clinic',
        sub: randomUUID(),
        id: randomUUID(),
        email: 'clinic-user@example.invalid',
        role: 'ADMIN',
        clinicId: target.clinicId,
        organizationId: target.organizationId,
        jti: createSessionId(),
      },
      process.env.JWT_SECRET || 'your-secret-key-change-this',
      { expiresIn: '1h' },
    );
    const res = await runChain(
      [gateChain()[0]!],
      cookieReq(`${PLATFORM_SESSION_COOKIE}=${clinicToken}`, { id: runId }),
      mockRes(),
    );
    assert.equal(res.statusCode, 401, JSON.stringify(res.body));
    assert.notEqual(res.body?.error, undefined);
  });

  await test('the first middleware on the router IS the Platform Admin gate', () => {
    assert.equal(gateChain()[0], authenticatePlatformAdmin as unknown as Handler);
  });

  await test('a platform session with a revoked/unknown admin id is rejected', async () => {
    const orphanToken = generatePlatformToken({
      id: randomUUID(),
      email: 'ghost@platform.test',
      sessionId: createSessionId(),
      passwordChangedAt: null,
    });
    const res = await runChain(
      [gateChain()[0]!],
      cookieReq(`${PLATFORM_SESSION_COOKIE}=${orphanToken}`, { id: runId }),
      mockRes(),
    );
    assert.equal(res.statusCode, 401);
  });

  // -------------------------------------------------------------------------
  console.log(`\n${passed} passed, ${failed} failed`);
}

main()
  .catch((err) => {
    console.error(err);
    failed++;
  })
  .finally(async () => {
    await cleanup().catch((err) => console.error('cleanup failed', err));
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
  });
