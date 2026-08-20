/**
 * migrationImportWorkflowConvergenceDb.test.ts
 * F3-DATA-MIG-TODAY-001-R12-FINAL-IMPORT-WORKFLOW-CONVERGENCE
 *
 * ─── WHY THIS SUITE EXISTS AT ALL ─────────────────────────────────────────
 *
 * R10 and R11 shipped green. The operator workflow in production was broken
 * anyway, and the reason is the whole point of this file: every existing suite
 * asserted the mapping rules against a payload a TEST author wrote, and the
 * defect lived in the payload the BROWSER wrote. The shipped mapping screen
 * saved by serialising EVERY mapping row; R11's legal gate read a column's mere
 * presence in that array as an attempt to edit it; the first customer's two
 * stored LEGAL_BLOCKED consent columns were therefore in every save, and every
 * save — including one that changed only SUBEDOSYANO — returned HTTP 400.
 *
 * So the tests here are written at the seam the browser actually hits: the real
 * Express route stack, driven end to end (create -> upload -> analyze -> map ->
 * reference -> dry-run -> download), against a real database. Where a test
 * models the client, it models what the client SENDS, not what it means.
 *
 * DB-BACKED. Requires DATABASE_URL to point at a DISPOSABLE Postgres — it
 * creates and deletes real rows. Registered under `server:test:disposable-db`.
 *
 * Route handlers are invoked by extracting the router's middleware chain, the
 * same technique as migrationAnalyzeLifecycleDb.test.ts — no supertest.
 *
 * EVERY FIXTURE IS SYNTHETIC. No real patient data and no value from the
 * first-customer workbook appears anywhere in this file. The HEADER names come
 * from the accepted mapping matrix (they are schema, not data) so the proposed
 * mapping shape matches what production produced.
 */

import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

import prisma from '../db.js';
import platformMigrationRouter from '../routes/platformMigration.js';
import { deleteSourceFile } from '../services/migration/sourceFileStore.js';
import {
  REJECTED_DATA_SHEET,
  REJECTED_ERROR_SHEET,
  REJECTED_ERROR_COLUMNS,
} from '../services/migration/reports/rejectedRowReport.js';
import { buildMappingWritePlan } from '../services/migration/mapping/mappingWriteDiff.js';
import { DESTINATION_FIELDS } from '../services/migration/contracts.js';

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
// Route-stack invocation
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
  headers: Record<string, string>;
  sent: Buffer | null;
  status(code: number): MockRes;
  json(payload: unknown): MockRes;
  setHeader(name: string, value: string): void;
  send(payload: unknown): MockRes;
  headersSent: boolean;
}

function mockRes(): MockRes {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    sent: null,
    headersSent: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    send(payload: unknown) {
      this.sent = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
      this.headersSent = true;
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

const ACTOR_ID = `mig-r12-admin-${randomUUID().slice(0, 8)}`;
const ACTOR_EMAIL = `${ACTOR_ID}@platform.test`;

function adminReq(
  params: Record<string, string> = {},
  body: Record<string, unknown> = {},
  query: Record<string, unknown> = {},
) {
  return {
    params,
    body,
    query,
    headers: {},
    get: () => undefined,
    platformAdmin: { id: ACTOR_ID, email: ACTOR_EMAIL, sessionId: randomUUID() },
    authSource: 'cookie',
  } as any;
}

function uploadReq(runId: string, file: Buffer, filename: string) {
  const boundary = `----migr12${randomUUID().replace(/-/g, '')}`;
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
  req.platformAdmin = { id: ACTOR_ID, email: ACTOR_EMAIL, sessionId: randomUUID() };
  req.authSource = 'cookie';
  return req;
}

const createRunChain = routeChain('post', '/migrations/runs');
const uploadChain = routeChain('post', '/migrations/runs/:id/upload');
const analyzeChain = routeChain('post', '/migrations/runs/:id/analyze');
const mappingsGetChain = routeChain('get', '/migrations/runs/:id/mappings');
const mappingsPutChain = routeChain('put', '/migrations/runs/:id/mappings');
const acceptAutoChain = routeChain('post', '/migrations/runs/:id/mappings/accept-auto');
const confirmExclusionsChain = routeChain(
  'post',
  '/migrations/runs/:id/mappings/confirm-exclusions',
);
const referencesGetChain = routeChain('get', '/migrations/runs/:id/references');
const dryRunChain = routeChain('post', '/migrations/runs/:id/dry-run');
const rejectedChain = routeChain('get', '/migrations/runs/:id/reports/rejected');
const executeChain = routeChain('post', '/migrations/runs/:id/execute');

// ---------------------------------------------------------------------------
// Synthetic .xlsx fixture
// ---------------------------------------------------------------------------

/**
 * The fixture is built to reproduce, in miniature, exactly the shape that broke
 * production:
 *
 *   HASTA_ID / ADI / SOYADI  the three REQUIRED destinations. Without them the
 *                            mapping can never validate and every downstream
 *                            assertion would be about the wrong failure.
 *   SUBEDOSYANO              the ordinary column the operator was trying to
 *                            change when the 400 fired. PRESERVE_LEGACY_SOURCE
 *                            in the matrix, so it arrives as AUTO_REVIEW.
 *   KVKKONAYKODU             a stored LEGAL_BLOCKED column, POPULATED. Populated
 *                            on purpose: an empty one would be settled by the
 *                            data-loss gate as ZERO_DATA and could not prove
 *                            that the guard fires on a real edit.
 *   ADRES_KODU               MANUAL_REVIEW in the matrix and MEASURED EMPTY
 *                            here — the column that used to block the whole
 *                            mapping step over nothing.
 *   AILEGURUBU               IGNORE in the matrix and POPULATED: a
 *                            SYSTEM-RECOMMENDED exclusion that the R9 data-loss
 *                            gate refuses to accept until a named human
 *                            confirms it. This is what the bulk action is for.
 *   DOGUMTARIHI              carries ONE future date, so the dry run must split
 *                            the file into importable and rejected rows.
 */
const HEADERS = [
  'HASTA_ID',
  'ADI',
  'SOYADI',
  'DOGUMTARIHI',
  'SUBEDOSYANO',
  'KVKKONAYKODU',
  'ADRES_KODU',
  'AILEGURUBU',
] as const;

const ROW_COUNT = 6;
/** 1-based data row that carries the future birth date. */
const BAD_DOB_ROW = 3;

function isoDate(offsetDays: number): Date {
  const base = new Date();
  base.setUTCHours(12, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base;
}

async function buildXlsxFixture(gatedValuePrefix: string | null = null): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sayfa1');
  sheet.addRow([...HEADERS]);
  for (let i = 1; i <= ROW_COUNT; i++) {
    const n = 7100 + i;
    const gatedValue = gatedValuePrefix === null ? '' : `${gatedValuePrefix}-${n}`;
    sheet.addRow([
      `R12-${n}`,
      `Sentetik${n}`,
      `Kayit${n}`,
      // One row in the future; the rest ~30 years ago. Both are real Date
      // cells, so the parser sees dates rather than strings, exactly as the
      // vendor export does.
      i === BAD_DOB_ROW ? isoDate(365) : isoDate(-11000 - i),
      `SUBE-${n}`,
      // KVKKONAYKODU. Empty, exactly as in the real first-customer workbook.
      // The write guard reads the STORED STATE, not the fill, so an empty
      // legally gated column exercises it in full — and the empty-column
      // settling rule deliberately leaves LEGAL_BLOCKED alone, which is itself
      // asserted below. A POPULATED gated column is a different question (it
      // blocks Execute at the data-loss gate) and gets its own run in §5b.
      gatedValue,
      // ADRES_KODU: deliberately empty in every row.
      '',
      `GRUP-${n % 3}`,
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
      name: `mig-r12-${label}-${suffix}`,
      displayName: `Migration R12 ${label}`,
      maxUsers: 100,
      maxPatients: 100000,
      monthlyPrice: 0,
      features: {},
    },
  });
  const organization = await prisma.organization.create({
    data: {
      name: `MigR12Org-${label}-${suffix}`,
      slug: `migr12-${label}-${suffix}`,
      planId: plan.id,
    },
  });
  const clinic = await prisma.clinic.create({
    data: {
      name: `MigR12Clinic-${label}-${suffix}`,
      slug: `migr12c-${label}-${suffix}`,
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
// Flow helpers
// ---------------------------------------------------------------------------

async function createRun(tenant: { organizationId: string; clinicId: string }) {
  const res = await runChain(createRunChain, adminReq({}, tenant), mockRes());
  assert.equal(res.statusCode, 201, `create run failed: ${JSON.stringify(res.body)}`);
  const runId = res.body.run.id as string;
  createdRunIds.push(runId);
  return runId;
}

async function analyzedRun(tenant: { organizationId: string; clinicId: string }, file: Buffer) {
  const runId = await createRun(tenant);
  const up = await runChain(uploadChain, uploadReq(runId, file, 'r12-synthetic.xlsx'), mockRes());
  assert.equal(up.statusCode, 200, `upload failed: ${JSON.stringify(up.body)}`);
  const an = await runChain(analyzeChain, adminReq({ id: runId }), mockRes());
  assert.equal(an.statusCode, 200, `analyze failed: ${JSON.stringify(an.body)}`);
  return runId;
}

const mappingRows = (runId: string) =>
  prisma.migrationFieldMapping.findMany({ where: { runId }, orderBy: { sourceIndex: 'asc' } });

async function mappingRow(runId: string, sourceField: string) {
  return prisma.migrationFieldMapping.findFirstOrThrow({ where: { runId, sourceField } });
}

/**
 * What the SHIPPED (5de3cee) mapping screen sent on every single edit: the
 * entire mapping collection, with one row changed.
 *
 * This helper is the reproduction. It is deliberately written the way the
 * broken client wrote it — including the untouched LEGAL_BLOCKED row — because
 * that array IS the production defect, and a test that sent only the edited row
 * would pass against the broken server too.
 */
async function fullCollectionPayload(
  runId: string,
  edit: { sourceField: string; destinationField?: string | null; transform?: string | null; state?: string },
) {
  const rows = await mappingRows(runId);
  return rows.map((m) =>
    m.sourceField === edit.sourceField
      ? {
          sourceField: m.sourceField,
          destinationField: edit.destinationField ?? m.destinationField,
          transform: edit.transform ?? m.transform,
          composeOrder: m.composeOrder,
          state: edit.state ?? m.state,
        }
      : {
          sourceField: m.sourceField,
          destinationField: m.destinationField,
          transform: m.transform,
          composeOrder: m.composeOrder,
          state: m.state,
        },
  );
}

const putMappings = (runId: string, mappings: unknown[]) =>
  runChain(mappingsPutChain, adminReq({ id: runId }, { mappings }), mockRes());

const PRESERVATION_KEY = 'legacy.preservedSourceValue';

async function main() {
  await prisma.platformAdmin.upsert({
    where: { id: ACTOR_ID },
    update: {},
    create: {
      id: ACTOR_ID,
      email: ACTOR_EMAIL,
      passwordHash: 'not-a-real-hash-test-fixture-only',
      name: 'Test Fixture Platform Admin (R12 Convergence)',
    },
  });

  const target = await makeTenant('target');
  const sibling = await makeTenant('sibling');
  const fixture = await buildXlsxFixture();

  // =========================================================================
  section('1. THE PRODUCTION DEFECT — full-collection save vs the legal gate');
  // =========================================================================

  const runId = await analyzedRun(target, fixture);

  await test('the fixture reproduces the production shape: a stored LEGAL_BLOCKED column exists', async () => {
    const gated = await mappingRow(runId, 'KVKKONAYKODU');
    assert.equal(gated.state, 'LEGAL_BLOCKED', 'KVKKONAYKODU must arrive legally gated');
    // It is EMPTY here, matching the real first-customer workbook. That is not
    // a weaker fixture: the write guard reads the STORED STATE, never the fill,
    // and the empty-column settling rule deliberately exempts LEGAL_BLOCKED —
    // both of which this section goes on to prove. What an empty gated column
    // cannot show is the data-loss gate blocking Execute on a MEANINGFUL one;
    // §5b runs a second workbook for exactly that.
    const profile = gated.sourceProfile as { filledCount?: number } | null;
    assert.equal(profile?.filledCount, 0);
  });

  await test('REPRODUCTION: the shipped client payload — full collection, one ordinary edit — now returns 200', async () => {
    const payload = await fullCollectionPayload(runId, {
      sourceField: 'SUBEDOSYANO',
      destinationField: PRESERVATION_KEY,
      transform: 'preserve_source_value',
      state: 'RESOLVED',
    });
    // The payload contains the untouched LEGAL_BLOCKED row. Under R11 this was
    // the 400 that made the mapping step unusable.
    assert.ok(
      payload.some((m) => m.sourceField === 'KVKKONAYKODU'),
      'the reproduction must actually include the gated column, or it proves nothing',
    );
    const res = await putMappings(runId, payload);
    assert.equal(
      res.statusCode,
      200,
      `saving an ordinary column alongside unchanged gated rows must succeed, got ${res.statusCode}: ${JSON.stringify(res.body)}`,
    );
  });

  await test('and the ordinary edit actually landed', async () => {
    const row = await mappingRow(runId, 'SUBEDOSYANO');
    assert.equal(row.destinationField, PRESERVATION_KEY);
    assert.equal(row.state, 'RESOLVED');
    assert.equal(row.isAutoSuggested, false);
    assert.equal(row.decidedByPlatformAdminId, ACTOR_ID);
    assert.notEqual(row.decidedAt, null);
  });

  await test('the untouched gated row was neither written nor stamped', async () => {
    const gated = await mappingRow(runId, 'KVKKONAYKODU');
    assert.equal(gated.state, 'LEGAL_BLOCKED');
    assert.equal(gated.destinationField, null);
    assert.equal(
      gated.isAutoSuggested,
      true,
      'a no-op must not record an operator decision over a program-owner legal gate',
    );
    assert.equal(gated.decidedByPlatformAdminId, null);
    assert.equal(gated.decidedAt, null);
  });

  await test('FAIL CLOSED: a payload that genuinely moves the gated row is refused, whole request', async () => {
    const before = await mappingRows(runId);
    const payload = await fullCollectionPayload(runId, {
      sourceField: 'KVKKONAYKODU',
      destinationField: PRESERVATION_KEY,
      transform: 'preserve_source_value',
      state: 'RESOLVED',
    });
    // Change an ordinary row in the SAME request, so the test also proves the
    // refusal is total rather than per-row.
    const alsoEditing = payload.map((m) =>
      m.sourceField === 'AILEGURUBU' ? { ...m, state: 'IGNORE' } : m,
    );
    const res = await putMappings(runId, alsoEditing);
    assert.notEqual(res.statusCode, 200, 'lifting a legal gate must never succeed');
    assert.equal(res.body?.code, 'MAPPING_INVALID');
    assert.match(String(res.body?.error ?? ''), /KVKKONAYKODU/);

    const after = await mappingRows(runId);
    assert.deepEqual(
      after.map((m) => [m.sourceField, m.state, m.destinationField]),
      before.map((m) => [m.sourceField, m.state, m.destinationField]),
      'a refused request must write NOTHING, including the unrelated row it also carried',
    );
  });

  await test('FAIL CLOSED: even moving the gated row to IGNORE is refused', async () => {
    const res = await putMappings(runId, [
      { sourceField: 'KVKKONAYKODU', destinationField: null, transform: null, composeOrder: null, state: 'IGNORE' },
    ]);
    assert.notEqual(res.statusCode, 200);
    assert.match(String(res.body?.error ?? ''), /legal decision/i);
    const gated = await mappingRow(runId, 'KVKKONAYKODU');
    assert.equal(gated.state, 'LEGAL_BLOCKED');
  });

  await test('a payload naming ONLY the gated row, unchanged, is a no-op and succeeds', async () => {
    const gated = await mappingRow(runId, 'KVKKONAYKODU');
    const res = await putMappings(runId, [
      {
        sourceField: gated.sourceField,
        destinationField: gated.destinationField,
        transform: gated.transform,
        composeOrder: gated.composeOrder,
        state: gated.state,
      },
    ]);
    assert.equal(res.statusCode, 200, `an unchanged gated row must not fail: ${JSON.stringify(res.body)}`);
  });

  await test('a repeated identical save is idempotent — no second write, no churn in the decision stamp', async () => {
    const before = await mappingRow(runId, 'SUBEDOSYANO');
    const res = await putMappings(runId, [
      {
        sourceField: before.sourceField,
        destinationField: before.destinationField,
        transform: before.transform,
        composeOrder: before.composeOrder,
        state: before.state,
      },
    ]);
    assert.equal(res.statusCode, 200);
    const after = await mappingRow(runId, 'SUBEDOSYANO');
    assert.equal(
      after.decidedAt?.getTime(),
      before.decidedAt?.getTime(),
      're-saving an already-decided, unchanged row must not restamp it',
    );
  });

  await test('PATCH semantics: a field the payload omits INHERITS the stored value', async () => {
    const before = await mappingRow(runId, 'SUBEDOSYANO');
    assert.equal(before.destinationField, PRESERVATION_KEY, 'precondition');
    // The old route coerced an absent `state` to MANUAL_REQUIRED and an absent
    // `destinationField` to null — with delta saves that is a live data-loss
    // path, because the client now sends one row and anything it forgot would
    // blank the stored value.
    const res = await putMappings(runId, [{ sourceField: 'SUBEDOSYANO', transform: 'preserve_source_value' }]);
    assert.equal(res.statusCode, 200);
    const after = await mappingRow(runId, 'SUBEDOSYANO');
    assert.equal(after.destinationField, PRESERVATION_KEY, 'an omitted destination must not be cleared');
    assert.equal(after.state, 'RESOLVED', 'an omitted state must not reset to MANUAL_REQUIRED');
  });

  await test('an unknown state or destination is refused BEFORE anything is written', async () => {
    const before = await mappingRow(runId, 'SUBEDOSYANO');
    for (const bad of [
      { sourceField: 'SUBEDOSYANO', state: 'TOTALLY_MADE_UP' },
      { sourceField: 'SUBEDOSYANO', destinationField: 'patient.doesNotExist' },
    ]) {
      const res = await putMappings(runId, [bad]);
      assert.notEqual(res.statusCode, 200, `${JSON.stringify(bad)} must be refused`);
    }
    const after = await mappingRow(runId, 'SUBEDOSYANO');
    assert.equal(after.state, before.state);
    assert.equal(after.destinationField, before.destinationField);
  });

  // =========================================================================
  section('2. EMPTY COLUMNS MUST NOT CREATE WORK');
  // =========================================================================

  await test('a MEASURED-EMPTY column that used to block the step is settled automatically', async () => {
    const row = await mappingRow(runId, 'ADRES_KODU');
    const profile = row.sourceProfile as { filledCount?: number } | null;
    assert.equal(profile?.filledCount, 0, 'precondition: ADRES_KODU is empty in the fixture');
    assert.equal(
      row.state,
      'IGNORE',
      'a column with provably nothing in it must not sit in an undecided state',
    );
    assert.equal(row.reason, 'EMPTY_SOURCE_COLUMN', 'and it must SAY why, not look like a silent drop');
    assert.equal(row.destinationField, null);
  });

  await test('an empty column costs the operator nothing at the data-loss gate either', async () => {
    // The gate scores a MEASURED zero as ZERO_DATA: nothing to lose, so no
    // confirmation is owed. Asserted through the route's own validation output
    // rather than by calling the gate directly.
    const res = await runChain(mappingsGetChain, adminReq({ id: runId }), mockRes());
    assert.equal(res.statusCode, 200);
    const issues = (res.body.validation.issues as Array<{ sourceField?: string }>).filter(
      (i) => i.sourceField === 'ADRES_KODU',
    );
    assert.deepEqual(issues, [], 'an empty column must raise no validation issue at all');
  });

  await test('the LEGAL gate is NOT relaxed for empty columns — a populated one stays gated', async () => {
    const gated = await mappingRow(runId, 'KVKKONAYKODU');
    assert.equal(gated.state, 'LEGAL_BLOCKED');
    assert.equal(
      gated.reason,
      'LEGAL_GATE',
      'the recorded REASON a consent column is withheld must survive; it is what the next workbook will be read against',
    );
  });

  // =========================================================================
  section('3. BULK ACTIONS — few clicks, still real decisions');
  // =========================================================================

  await test('accept-auto promotes the safe preservation suggestions and nothing else', async () => {
    const before = await mappingRows(runId);
    const autoReview = before.filter((m) => m.state === 'AUTO_REVIEW' && m.destinationField);
    const res = await runChain(acceptAutoChain, adminReq({ id: runId }), mockRes());
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.accepted, autoReview.length);

    const gated = await mappingRow(runId, 'KVKKONAYKODU');
    assert.equal(gated.state, 'LEGAL_BLOCKED', 'a bulk action must never lift a legal gate');
  });

  await test('confirm-exclusions records a NAMED human decision on each column it touches', async () => {
    const res = await runChain(
      confirmExclusionsChain,
      adminReq({ id: runId }, { sourceFields: ['AILEGURUBU'] }),
      mockRes(),
    );
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.confirmed, 1);

    const row = await mappingRow(runId, 'AILEGURUBU');
    assert.equal(row.state, 'IGNORE');
    assert.equal(row.isAutoSuggested, false);
    assert.equal(row.decidedByPlatformAdminId, ACTOR_ID);
    assert.notEqual(row.decidedAt, null);
  });

  await test('the confirmation is auditable and names the columns', async () => {
    const event = await prisma.platformAdminAuditEvent.findFirst({
      where: { resourceKey: runId, action: 'clinic_data_migration.exclusions_confirmed' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(event, 'confirming exclusions must write an audit event');
    const meta = event!.safeMetadata as { sourceFields?: string[]; confirmed?: number } | null;
    assert.deepEqual(meta?.sourceFields, ['AILEGURUBU']);
    assert.equal(meta?.confirmed, 1);
  });

  await test('confirm-exclusions REFUSES a legally gated column, fail closed', async () => {
    const res = await runChain(
      confirmExclusionsChain,
      adminReq({ id: runId }, { sourceFields: ['KVKKONAYKODU'] }),
      mockRes(),
    );
    assert.notEqual(res.statusCode, 200);
    assert.match(String(res.body?.error ?? ''), /legal decision/i);
    const gated = await mappingRow(runId, 'KVKKONAYKODU');
    assert.equal(gated.state, 'LEGAL_BLOCKED');
    assert.equal(gated.isAutoSuggested, true);
  });

  await test('confirm-exclusions REFUSES a column that is not a recommended exclusion', async () => {
    // SUBEDOSYANO is RESOLVED with a destination. Sweeping it into an exclusion
    // would be a real semantic choice, and a bulk action must not make one.
    const res = await runChain(
      confirmExclusionsChain,
      adminReq({ id: runId }, { sourceFields: ['SUBEDOSYANO'] }),
      mockRes(),
    );
    assert.notEqual(res.statusCode, 200);
    const row = await mappingRow(runId, 'SUBEDOSYANO');
    assert.equal(row.state, 'RESOLVED');
    assert.equal(row.destinationField, PRESERVATION_KEY);
  });

  await test('confirm-exclusions requires an explicit list — there is no "confirm everything" mode', async () => {
    for (const body of [{}, { sourceFields: [] }, { sourceFields: ['   '] }]) {
      const res = await runChain(confirmExclusionsChain, adminReq({ id: runId }, body), mockRes());
      assert.notEqual(res.statusCode, 200, `${JSON.stringify(body)} must be refused`);
    }
  });

  // =========================================================================
  section('4. THE MAPPING VALIDATES, SURVIVES A RELOAD, AND THE GATE OPENS');
  // =========================================================================

  await test('after the two bulk actions the mapping is VALID with no manual per-column clicking', async () => {
    const res = await runChain(mappingsGetChain, adminReq({ id: runId }), mockRes());
    assert.equal(res.statusCode, 200);
    assert.equal(
      res.body.validation.valid,
      true,
      `still invalid: ${JSON.stringify(res.body.validation.issues)}`,
    );
  });

  await test('the run advanced to MAPPING_READY', async () => {
    const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.status, 'MAPPING_READY');
  });

  await test('ROUND TRIP: the preservation decision survives a reload through the real GET', async () => {
    const res = await runChain(mappingsGetChain, adminReq({ id: runId }), mockRes());
    const row = (res.body.mappings as Array<Record<string, unknown>>).find(
      (m) => m.sourceField === 'SUBEDOSYANO',
    );
    assert.equal(row?.destinationField, PRESERVATION_KEY);
    assert.equal(row?.state, 'RESOLVED');
  });

  await test('NO FABRICATED CONSENT: nothing in this run wrote a consent record of any kind', async () => {
    const [consentLogs, preferences] = await Promise.all([
      prisma.channelConsentLog.count({ where: { organizationId: target.organizationId } }),
      prisma.patientCommunicationPreference.count({
        where: { patient: { organizationId: target.organizationId } },
      }),
    ]);
    assert.equal(consentLogs, 0, 'a legacy consent CODE must never become a consent EVENT');
    assert.equal(preferences, 0);
    // And the gated column still carries no destination it could have written to.
    const gated = await mappingRow(runId, 'KVKKONAYKODU');
    assert.equal(gated.destinationField, null);
  });

  // =========================================================================
  section('5. DRY-RUN SPLITS THE FILE — valid rows stay importable');
  // =========================================================================

  let dryRunSummary: any = null;

  await test('the dry run separates the one bad row from the rest', async () => {
    const res = await runChain(dryRunChain, adminReq({ id: runId }), mockRes());
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    dryRunSummary = res.body.dryRun;
    assert.equal(dryRunSummary.totalSourceRows, ROW_COUNT);
    assert.equal(dryRunSummary.invalidRows, 1, 'exactly the future-birth-date row');
    assert.equal(
      dryRunSummary.validRows,
      ROW_COUNT - 1,
      'ONE bad row must not hold back the other five',
    );
  });

  await test('the bad row is reported as a future birth date, not silently repaired', async () => {
    const dobBlockers = (dryRunSummary.blockers as Array<{ fieldName?: string; message: string }>)
      .filter((b) => b.fieldName === 'patient.dateOfBirth' && /future/i.test(b.message));
    assert.equal(dobBlockers.length, 1);
  });

  await test('ONE bad row does NOT stop the run — it stays executable with the other five', async () => {
    assert.equal(
      dryRunSummary.executable,
      true,
      `a partially-invalid file must remain executable: ${JSON.stringify(dryRunSummary.blockers)}`,
    );
  });

  await test('the data-loss gate is satisfied — every populated column is accounted for', async () => {
    const gate = dryRunSummary.dataLossGate;
    assert.ok(gate, 'the gate report must be present');
    assert.equal(gate.satisfied, true, JSON.stringify(gate));
    assert.equal(gate.systemRecommendedButUnconfirmedExclusions, 0);
    assert.equal(gate.unmeasuredFillColumns, 0);
    assert.equal(gate.unaccountedMeaningful, 0);
  });

  // =========================================================================
  section('5b. A POPULATED LEGAL GATE STILL STOPS EXECUTE — by design');
  // =========================================================================

  await test('a legally gated column that HOLDS DATA blocks Execute and escalates to a program owner', async () => {
    /*
     * The first customer's two consent columns are empty, so this never fires
     * for them — but the next workbook from the same vendor will have them
     * populated, and this is the behaviour that must survive R12's simplification.
     *
     * Nothing R12 added may route around it: the empty-column rule exempts
     * LEGAL_BLOCKED, the bulk exclusion action refuses it, and the mapping PUT
     * refuses to move it. The only way through is the program-owner decision
     * recorded in the matrix. So the run stops here, deliberately, with a named
     * column and a stated reason rather than a silent drop.
     */
    const populatedGateRunId = await analyzedRun(target, await buildXlsxFixture('KOD'));
    const gated = await mappingRow(populatedGateRunId, 'KVKKONAYKODU');
    const profile = gated.sourceProfile as { filledCount?: number } | null;
    assert.ok((profile?.filledCount ?? 0) > 0, 'precondition: this variant populates the gated column');

    // Bring the rest of the mapping to a valid state exactly as the operator would.
    await runChain(acceptAutoChain, adminReq({ id: populatedGateRunId }), mockRes());
    const recommended = (await mappingRows(populatedGateRunId)).filter(
      (m) => m.state === 'IGNORE' && ((m.sourceProfile as { filledCount?: number } | null)?.filledCount ?? 0) > 0,
    );
    if (recommended.length > 0) {
      await runChain(
        confirmExclusionsChain,
        adminReq({ id: populatedGateRunId }, { sourceFields: recommended.map((m) => m.sourceField) }),
        mockRes(),
      );
    }

    const res = await runChain(dryRunChain, adminReq({ id: populatedGateRunId }), mockRes());
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const summary = res.body.dryRun;
    assert.equal(summary.dataLossGate.legalBlockedMeaningful, 1);
    assert.deepEqual(summary.dataLossGate.legalBlockedMeaningfulFields, ['KVKKONAYKODU']);
    assert.equal(summary.executable, false, 'a meaningful legal gate must stop Execute');
    // The VALID ROWS are still counted — the run is stopped by a column-level
    // legal decision, not by pretending the patient rows are bad.
    assert.equal(summary.validRows, ROW_COUNT - 1);
  });

  // =========================================================================
  section('6. REJECTED-ROW EXPORT');
  // =========================================================================

  let rejectedXlsx: Buffer | null = null;

  await test('GET .../reports/rejected returns an XLSX and reports the row count', async () => {
    const res = await runChain(rejectedChain, adminReq({ id: runId }, {}, {}), mockRes());
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(res.sent && res.sent.length > 0, 'a file must actually be sent');
    rejectedXlsx = res.sent;
    assert.match(res.headers['content-type'] ?? '', /spreadsheetml/);
    assert.match(res.headers['content-disposition'] ?? '', /attachment; filename="migration-.*-rejected\.xlsx"/);
    assert.equal(res.headers['x-noramedi-rejected-rows'], '1');
  });

  await test('the workbook has the two expected sheets, with the correction sheet FIRST', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(rejectedXlsx! as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    assert.deepEqual(names, [REJECTED_DATA_SHEET, REJECTED_ERROR_SHEET]);
  });

  await test('sheet 1 carries the ORIGINAL vendor headers so the file is re-uploadable verbatim', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(rejectedXlsx! as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet(REJECTED_DATA_SHEET)!;
    const headerRow = sheet.getRow(1).values as unknown[];
    const headers = headerRow.slice(1).map((v) => String(v ?? ''));
    // Only MAPPED columns are exported — excluded and legally gated ones are
    // not in the import and must not be in the export.
    assert.ok(headers.includes('HASTA_ID'), 'the provenance key must be present or re-import cannot match');
    assert.ok(headers.includes('DOGUMTARIHI'), 'the column being corrected must be present');
    assert.ok(
      !headers.includes('KVKKONAYKODU'),
      'a legally gated column must never be written into a downloadable file',
    );
    assert.ok(!headers.includes('AILEGURUBU'), 'an excluded column is not part of the import');
    // Exactly one data row: the rejected one.
    assert.equal(sheet.rowCount, 2, 'header + the single rejected row');
  });

  await test('sheet 2 explains the rejection with a code, a Turkish message and a fix', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(rejectedXlsx! as unknown as ArrayBuffer);
    const sheet = wb.getWorksheet(REJECTED_ERROR_SHEET)!;
    const headers = (sheet.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ''));
    assert.deepEqual(headers, [...REJECTED_ERROR_COLUMNS]);

    const row = (sheet.getRow(2).values as unknown[]).slice(1).map((v) => String(v ?? ''));
    const [sourceRowNumber, sourceId, sourceColumn, fieldName, code, messageTr, guidanceTr, , runRef] = row;
    assert.equal(Number(sourceRowNumber), BAD_DOB_ROW);
    assert.match(sourceId!, /^R12-/, 'the vendor record id is the operator’s only reconciliation key');
    assert.equal(sourceColumn, 'DOGUMTARIHI');
    assert.equal(fieldName, 'patient.dateOfBirth');
    assert.equal(code, 'INVALID_FUTURE_BIRTH_DATE');
    assert.ok(messageTr!.length > 0 && /doğum/i.test(messageTr!), 'the explanation must be Turkish');
    assert.ok(guidanceTr!.length > 0, 'the operator must be told what to do');
    assert.equal(runRef, runId, 'the run reference makes a support request answerable');
  });

  await test('the CSV format is offered and carries the same findings', async () => {
    const res = await runChain(rejectedChain, adminReq({ id: runId }, {}, { format: 'csv' }), mockRes());
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] ?? '', /text\/csv/);
    const text = res.sent!.toString('utf8');
    assert.ok(text.startsWith('﻿'), 'a BOM, or Excel on Turkish Windows renders the messages as mojibake');
    assert.match(text, /INVALID_FUTURE_BIRTH_DATE/);
    assert.match(text, /DOGUMTARIHI/);
  });

  await test('the export writes an audit record with COUNTS and no content', async () => {
    const event = await prisma.platformAdminAuditEvent.findFirst({
      where: { resourceKey: runId, action: 'clinic_data_migration.rejected_rows_downloaded' },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(event, 'downloading patient data must be auditable');
    const meta = JSON.stringify(event!.safeMetadata ?? {});
    assert.match(meta, /"rejectedRowCount":1/);
    assert.ok(!/R12-/.test(meta), 'no source record id may reach the audit trail');
    assert.ok(!/Sentetik/.test(meta), 'no source VALUE may reach the audit trail');
  });

  await test('the DRY-RUN SUMMARY persisted on the run carries no source value either', async () => {
    const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: runId } });
    const summary = JSON.stringify(run.dryRunSummary ?? {});
    assert.ok(!/R12-/.test(summary), 'no vendor record id in the persisted summary');
    assert.ok(!/Sentetik|Kayit7/.test(summary), 'no name in the persisted summary');
    assert.ok(!/SUBE-/.test(summary), 'no preserved legacy value in the persisted summary');
    assert.ok(!/SUBE-/.test(summary), 'no legacy branch file number in the persisted summary');
  });

  // =========================================================================
  section('7. TENANT SCOPE AND AUTHORIZATION');
  // =========================================================================

  await test('the rejected export is behind the Platform Admin gate, like every other route', async () => {
    const chain = gateChain();
    assert.ok(chain.length > 0, 'the router must carry a gate');
    const req: any = { params: {}, query: {}, headers: {}, get: () => undefined, method: 'GET' };
    const res = mockRes();
    let reached = false;
    await runChain([...chain, ((_q: any, _s: any, next: any) => { reached = true; next(); }) as Handler], req, res);
    assert.equal(reached, false, 'an unauthenticated request must not reach the handler');
  });

  await test('a sibling tenant run cannot see this run’s rejected rows', async () => {
    const siblingRunId = await analyzedRun(sibling, fixture);
    const res = await runChain(rejectedChain, adminReq({ id: siblingRunId }), mockRes());
    // The sibling run has not been dry-run, so the export refuses on STATE —
    // and, crucially, it never reaches the target tenant's rows to do so.
    assert.notEqual(res.statusCode, 200);
    const targetRows = await prisma.migrationFieldMapping.count({ where: { runId } });
    const siblingRows = await prisma.migrationFieldMapping.count({ where: { runId: siblingRunId } });
    assert.ok(targetRows > 0 && siblingRows > 0);
    const cross = await prisma.migrationFieldMapping.count({
      where: { runId: siblingRunId, run: { organizationId: target.organizationId } },
    });
    assert.equal(cross, 0, 'no mapping row may belong to two tenants');
  });

  await test('a mapping edit on one tenant’s run never touches the other’s', async () => {
    const siblingRunId = createdRunIds[createdRunIds.length - 1]!;
    const before = await mappingRows(siblingRunId);
    await putMappings(runId, [
      { sourceField: 'SUBEDOSYANO', destinationField: PRESERVATION_KEY, transform: 'preserve_source_value', composeOrder: null, state: 'RESOLVED' },
    ]);
    const after = await mappingRows(siblingRunId);
    assert.deepEqual(
      after.map((m) => [m.sourceField, m.state, m.decidedByPlatformAdminId]),
      before.map((m) => [m.sourceField, m.state, m.decidedByPlatformAdminId]),
    );
  });

  // =========================================================================
  section('8. THE WRITE-PLAN CONTRACT, DIRECTLY');
  // =========================================================================

  await test('the diff is computed from STORED rows — a client-asserted state cannot fake a no-op', async () => {
    const stored = [
      {
        sourceField: 'X',
        destinationField: null,
        transform: null,
        composeOrder: null,
        state: 'LEGAL_BLOCKED',
        isAutoSuggested: true,
        decidedByPlatformAdminId: null,
        decidedAt: null,
      },
    ];
    // The client claims the row is already RESOLVED and is "just re-sending" it.
    const plan = buildMappingWritePlan(
      [{ sourceField: 'X', destinationField: 'patient.notes', transform: null, composeOrder: null, state: 'RESOLVED' }],
      stored,
    );
    assert.deepEqual(plan.legallyGatedEdits, ['X']);
    assert.equal(plan.writes.length, 0);
  });

  await test('a duplicated sourceField in one payload collapses to ONE write, last entry winning', () => {
    const stored = [
      {
        sourceField: 'Y',
        destinationField: null,
        transform: null,
        composeOrder: null,
        state: 'MANUAL_REQUIRED',
        isAutoSuggested: true,
        decidedByPlatformAdminId: null,
        decidedAt: null,
      },
    ];
    const plan = buildMappingWritePlan(
      [
        { sourceField: 'Y', state: 'IGNORE' },
        { sourceField: 'Y', state: 'BLOCKED' },
      ],
      stored,
    );
    assert.equal(plan.writes.length, 1, 'two UPDATEs whose order decides the result is not a contract');
    assert.equal(plan.writes[0]!.next.state, 'BLOCKED');
  });

  await test('an unconfirmed exclusion is a WRITE even when the tuple is identical (the R9 confirmation path)', () => {
    const stored = [
      {
        sourceField: 'Z',
        destinationField: null,
        transform: null,
        composeOrder: null,
        state: 'IGNORE',
        isAutoSuggested: true,
        decidedByPlatformAdminId: null,
        decidedAt: null,
      },
    ];
    const plan = buildMappingWritePlan([{ sourceField: 'Z', state: 'IGNORE' }], stored);
    assert.equal(plan.writes.length, 1, 'submitting a system-recommended IGNORE IS the operator decision');
    assert.equal(plan.noOpCount, 0);
  });

  await test('an ALREADY-confirmed identical row is a true no-op', () => {
    const stored = [
      {
        sourceField: 'Z',
        destinationField: null,
        transform: null,
        composeOrder: null,
        state: 'IGNORE',
        isAutoSuggested: false,
        decidedByPlatformAdminId: 'someone',
        decidedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];
    const plan = buildMappingWritePlan([{ sourceField: 'Z', state: 'IGNORE' }], stored);
    assert.equal(plan.writes.length, 0);
    assert.equal(plan.noOpCount, 1);
  });

  // =========================================================================
  section('8b. ROW-LEVEL vs RUN-LEVEL — what is allowed to stop a run');
  // =========================================================================

  await test('the one bad row IS a blocker, and is NOT a run-level blocker', async () => {
    const runLevel = (dryRunSummary.runLevelBlockers ?? []) as Array<{ code: string }>;
    const all = dryRunSummary.blockers as Array<{ code: string }>;
    assert.ok(
      all.some((b) => b.code === 'ROW_VALUE_INVALID'),
      'the operator must still SEE the bad row',
    );
    assert.ok(
      !runLevel.some((b) => b.code === 'ROW_VALUE_INVALID'),
      'but one unusable value must not hold back every other patient',
    );
    assert.deepEqual(runLevel, [], 'nothing else should be stopping this run');
  });

  await test('the server states the rejected-row count, so the screen and the file agree', () => {
    assert.equal(dryRunSummary.rejectedRows, 1);
  });

  // =========================================================================
  section('10. EXECUTE, AND THE CORRECTION / RE-IMPORT LOOP');
  // =========================================================================

  /*
   * SYNTHETIC TENANT ONLY. Six invented rows in a throwaway organization this
   * suite created and deletes at the end. No customer workbook and no customer
   * tenant is touched anywhere in this file.
   */
  async function executeAndSettle(id: string) {
    const res = await runChain(executeChain, adminReq({ id }, { confirm: true }), mockRes());
    assert.equal(res.statusCode, 202, 'execute refused: ' + JSON.stringify(res.body));
    // The route answers 202 and runs in the background, so wait for the run to
    // leave RUNNING rather than assuming it finished with the response.
    for (let i = 0; i < 300; i++) {
      const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id } });
      if (run.status !== 'RUNNING' && run.status !== 'READY') return run;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('the run never left RUNNING');
  }

  const patientCount = () =>
    prisma.patient.count({ where: { organizationId: target.organizationId, deletedAt: null } });

  /** Bring a freshly analyzed run to a valid mapping the way an operator does. */
  async function settleMapping(id: string) {
    await runChain(acceptAutoChain, adminReq({ id }), mockRes());
    const recommended = (await mappingRows(id)).filter(
      (m) =>
        m.state === 'IGNORE' &&
        ((m.sourceProfile as { filledCount?: number } | null)?.filledCount ?? 0) > 0,
    );
    if (recommended.length > 0) {
      await runChain(
        confirmExclusionsChain,
        adminReq({ id }, { sourceFields: recommended.map((m) => m.sourceField) }),
        mockRes(),
      );
    }
  }

  await test('Execute imports the five valid rows and records the sixth as an outcome', async () => {
    const before = await patientCount();
    assert.equal(before, 0, 'precondition: the synthetic tenant is empty');
    const run = await executeAndSettle(runId);
    assert.ok(
      ['COMPLETED', 'PARTIAL_FAILURE'].includes(run.status),
      'unexpected status ' + run.status,
    );
    assert.equal(await patientCount(), ROW_COUNT - 1, 'the five importable rows must land');

    const invalid = await prisma.migrationRowOutcome.findMany({
      where: { runId, status: 'INVALID' },
      select: { sourceRowNumber: true, resultCode: true, fieldName: true },
    });
    assert.equal(invalid.length, 1);
    assert.equal(invalid[0]!.sourceRowNumber, BAD_DOB_ROW);
    assert.equal(invalid[0]!.fieldName, 'patient.dateOfBirth');
  });

  await test('IDEMPOTENCY: re-importing the SAME workbook creates no duplicate patients', async () => {
    const before = await patientCount();
    const rerunId = await analyzedRun(target, fixture);
    await settleMapping(rerunId);

    const dry = await runChain(dryRunChain, adminReq({ id: rerunId }), mockRes());
    assert.equal(dry.statusCode, 200, JSON.stringify(dry.body));
    assert.equal(
      dry.body.dryRun.expectedReuseCount,
      ROW_COUNT - 1,
      'every previously imported row must be recognised by its vendor id, not re-created',
    );
    assert.equal(dry.body.dryRun.expectedCreateCount, 0);

    await executeAndSettle(rerunId);
    assert.equal(await patientCount(), before, 'a rerun must create nothing');
    const matched = await prisma.migrationRowOutcome.count({
      where: { runId: rerunId, status: 'MATCHED' },
    });
    assert.equal(matched, ROW_COUNT - 1);
  });

  await test('PARTIAL RE-IMPORT: the corrected rejected workbook imports the missing patient, and only it', async () => {
    /*
     * The whole point of the correction loop, end to end and through the real
     * routes:
     *
     *   download the rejected rows -> fix the value in Excel -> upload THAT FILE
     *   -> analyze -> map -> dry-run -> execute
     *
     * The downloaded sheet carries the ORIGINAL vendor headers and nothing else,
     * which is what makes it re-uploadable verbatim: analyze proposes the same
     * mapping it proposed for the full workbook.
     *
     * And a REJECTED-ONLY file is safe because HASTA_ID rides along: identity is
     * provenance, never row position, so the five patients already imported are
     * matched rather than duplicated and the corrected one is created once.
     */
    const before = await patientCount();

    const res = await runChain(rejectedChain, adminReq({ id: runId }), mockRes());
    assert.equal(res.statusCode, 200);
    const downloaded = new ExcelJS.Workbook();
    await downloaded.xlsx.load(res.sent! as unknown as ArrayBuffer);
    const sheet = downloaded.getWorksheet(REJECTED_DATA_SHEET)!;
    const headers = (sheet.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ''));
    assert.equal(sheet.rowCount, 2, 'precondition: exactly one rejected row to correct');

    // The edit an operator makes in Excel: replace the future birth date.
    const dobColumn = headers.indexOf('DOGUMTARIHI');
    assert.ok(dobColumn >= 0, 'the column being corrected must be in the file');
    const dataRow = (sheet.getRow(2).values as unknown[]).slice(1);
    dataRow[dobColumn] = isoDate(-12000);

    const corrected = new ExcelJS.Workbook();
    const correctedSheet = corrected.addWorksheet('Sayfa1');
    correctedSheet.addRow(headers);
    correctedSheet.addRow(dataRow);
    const correctedBuffer = Buffer.from(await corrected.xlsx.writeBuffer());

    const fixRunId = await analyzedRun(target, correctedBuffer);
    await settleMapping(fixRunId);

    const dry = await runChain(dryRunChain, adminReq({ id: fixRunId }), mockRes());
    assert.equal(dry.statusCode, 200, JSON.stringify(dry.body));
    assert.equal(dry.body.dryRun.totalSourceRows, 1, 'a rejected-only file is a legitimate input');
    assert.equal(dry.body.dryRun.invalidRows, 0, 'the correction fixed it');
    assert.equal(dry.body.dryRun.expectedCreateCount, 1);
    assert.equal(dry.body.dryRun.executable, true);

    await executeAndSettle(fixRunId);
    assert.equal(await patientCount(), before + 1, 'exactly the corrected patient, and nothing else');

    const rejectedAfter = await runChain(rejectedChain, adminReq({ id: fixRunId }), mockRes());
    assert.equal(
      rejectedAfter.headers['x-noramedi-rejected-rows'],
      '0',
      'nothing left to correct',
    );
  });

  // =========================================================================
  section('9. FRONTEND / BACKEND DESTINATION PARITY');
  // =========================================================================

  await test('the preservation destination the client hard-codes exists in the server catalog', () => {
    // src/pages/platformMigrationHelpers.ts mirrors this key by literal (it
    // stays free of server imports). A rename that missed it would silently
    // reclassify every preserved column as "matched" on screen.
    const dest = DESTINATION_FIELDS.find((d) => d.key === PRESERVATION_KEY);
    assert.ok(dest, 'legacy.preservedSourceValue must exist');
    assert.equal(dest!.allowsIndependentMultiUse, true, 'N columns must produce N distinguishable rows');
    assert.equal(dest!.allowsComposition, false);
  });

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
