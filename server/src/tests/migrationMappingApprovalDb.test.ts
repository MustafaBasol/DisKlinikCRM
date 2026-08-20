/**
 * migrationMappingApprovalDb.test.ts
 * F3-DATA-MIG-TODAY-001-R12-UX-CLOSURE
 *
 * ─── WHY THIS SUITE EXISTS ──────────────────────────────────────────────────
 *
 * Real operator acceptance on release 073b145f exposed one remaining UX defect
 * on the SAME R12 mapping screen migrationImportWorkflowConvergenceDb.test.ts
 * proved: a SENSITIVE_REVIEW_REQUIRED row the system had ALREADY proposed a
 * correct destination for (ONEMLINOT/KONTROLNOTU -> patient.notes,
 * KANGURUBU -> patient.bloodGroup) had no explicit "approve" action. The
 * operator's only way to move it into a resolved state was to pick a DIFFERENT
 * destination, save, then pick the CORRECT one again — a detour that briefly
 * puts a wrong value on record for no reason.
 *
 * A second, adjacent defect: clicking "Yok say" (ignore) on KANGURUBU left its
 * proposed destinationField in place, producing a row that was simultaneously
 * IGNORE and mapped — MAPPING_INVALID.
 *
 * BOTH FIXES ARE CLIENT-SIDE (MigrationMappingStep.tsx). Neither adds a new
 * server route: "approve" reuses PUT /migrations/runs/:id/mappings — the SAME
 * semantic-diff machinery (mappingWriteDiff.ts) migrationImportWorkflowConvergenceDb.test.ts
 * already exercises — sending only `state: 'RESOLVED'` with the row's EXISTING
 * destinationField/transform/composeOrder. This suite proves the server side of
 * that contract: an approve-shaped payload preserves the tuple exactly, stamps
 * the audit fields, survives a reload, and is refused wherever it must be.
 *
 * DB-BACKED, same technique as migrationImportWorkflowConvergenceDb.test.ts:
 * the real Express route stack, invoked directly (no supertest), against a
 * real database. Requires DATABASE_URL to point at a DISPOSABLE Postgres.
 * Registered under `server:test:disposable-db`.
 *
 * EVERY FIXTURE IS SYNTHETIC. Header names (ONEMLINOT, KONTROLNOTU, KANGURUBU,
 * KVKKONAYKODU, HASTA_ID, ADI, SOYADI) come from the accepted first-customer
 * mapping matrix — they are schema, not data — so the proposed mapping shape
 * matches what the real matrix produces. No cell value is real.
 */

import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

import prisma from '../db.js';
import platformMigrationRouter from '../routes/platformMigration.js';
import { deleteSourceFile } from '../services/migration/sourceFileStore.js';

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
// Route-stack invocation (mirrors migrationImportWorkflowConvergenceDb.test.ts)
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

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

const ACTOR_ID = `mig-r12ux-admin-${randomUUID().slice(0, 8)}`;
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
  const boundary = `----migr12ux${randomUUID().replace(/-/g, '')}`;
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

// ---------------------------------------------------------------------------
// Synthetic .xlsx fixture
// ---------------------------------------------------------------------------

/**
 * Reproduces the exact first-customer operator scenario from the acceptance
 * report, in miniature:
 *
 *   HASTA_ID / ADI / SOYADI  the three REQUIRED destinations. The engine's own
 *                            header dictionary resolves these automatically
 *                            (AUTO_CONFIDENT), so they need no operator action
 *                            and the "3 sütun sizden karar bekliyor" figure
 *                            below counts ONLY the three sensitive-review rows.
 *   ONEMLINOT                IMPORT_AFTER_SENSITIVE_REVIEW -> patient.notes,
 *                            compose_notes, composeOrder 1. Populated, so it is
 *                            a MEANINGFUL column and the row genuinely needs a
 *                            decision, not an automatic settlement.
 *   KONTROLNOTU               Same composition, composeOrder 2. Populated.
 *   KANGURUBU                 IMPORT_AFTER_SENSITIVE_REVIEW -> patient.bloodGroup,
 *                            blood_group_tr. Populated.
 *   KVKKONAYKODU              A stored LEGAL_BLOCKED column, POPULATED (so it is
 *                            a real, protected row rather than one the empty-
 *                            column rule would settle on its own) — proves an
 *                            approve-shaped edit elsewhere in the same run
 *                            never touches it, and that a hand-crafted
 *                            approve-shaped attempt directly against it still
 *                            fails closed.
 */
const HEADERS = ['HASTA_ID', 'ADI', 'SOYADI', 'ONEMLINOT', 'KONTROLNOTU', 'KANGURUBU', 'KVKKONAYKODU'] as const;
const ROW_COUNT = 4;

async function buildXlsxFixture(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sayfa1');
  sheet.addRow([...HEADERS]);
  for (let i = 1; i <= ROW_COUNT; i++) {
    const n = 8200 + i;
    sheet.addRow([
      `R12UX-${n}`,
      `Sentetik${n}`,
      `Kayit${n}`,
      `Onemli not sentetik ${n}`,
      `Kontrol notu sentetik ${n}`,
      'Bilinmiyor',
      `KVKK-KOD-${n}`,
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
      name: `mig-r12ux-${label}-${suffix}`,
      displayName: `Migration R12 UX Closure ${label}`,
      maxUsers: 100,
      maxPatients: 100000,
      monthlyPrice: 0,
      features: {},
    },
  });
  const organization = await prisma.organization.create({
    data: {
      name: `MigR12UxOrg-${label}-${suffix}`,
      slug: `migr12ux-${label}-${suffix}`,
      planId: plan.id,
    },
  });
  const clinic = await prisma.clinic.create({
    data: {
      name: `MigR12UxClinic-${label}-${suffix}`,
      slug: `migr12uxc-${label}-${suffix}`,
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
  const up = await runChain(uploadChain, uploadReq(runId, file, 'r12ux-synthetic.xlsx'), mockRes());
  assert.equal(up.statusCode, 200, `upload failed: ${JSON.stringify(up.body)}`);
  const an = await runChain(analyzeChain, adminReq({ id: runId }), mockRes());
  assert.equal(an.statusCode, 200, `analyze failed: ${JSON.stringify(an.body)}`);
  return runId;
}

async function mappingRow(runId: string, sourceField: string) {
  return prisma.migrationFieldMapping.findFirstOrThrow({ where: { runId, sourceField } });
}

/**
 * The client's "Eşlemeyi Onayla" payload shape (MigrationMappingStep.tsx
 * handleApproveMapping): ONLY `state` differs from what is stored. This
 * builder reads the STORED row so the test proves the same thing the
 * component does — it never invents a destination/transform/composeOrder.
 */
async function approvePayload(runId: string, sourceField: string) {
  const row = await mappingRow(runId, sourceField);
  return [
    {
      sourceField: row.sourceField,
      destinationField: row.destinationField,
      transform: row.transform,
      composeOrder: row.composeOrder,
      state: 'RESOLVED',
    },
  ];
}

/** The client's "Yok say" payload shape (MigrationMappingStep.tsx handleMarkIgnore, post-fix). */
function ignorePayload(sourceField: string) {
  return [{ sourceField, destinationField: null, transform: null, composeOrder: null, state: 'IGNORE' }];
}

const putMappings = (runId: string, mappings: unknown[]) =>
  runChain(mappingsPutChain, adminReq({ id: runId }, { mappings }), mockRes());

const getMappings = (runId: string) => runChain(mappingsGetChain, adminReq({ id: runId }), mockRes());

async function main() {
  await prisma.platformAdmin.upsert({
    where: { id: ACTOR_ID },
    update: {},
    create: {
      id: ACTOR_ID,
      email: ACTOR_EMAIL,
      passwordHash: 'not-a-real-hash-test-fixture-only',
      name: 'Test Fixture Platform Admin (R12 UX Closure)',
    },
  });

  const tenant = await makeTenant('target');
  const fixture = await buildXlsxFixture();

  // =========================================================================
  section('0. FIXTURE SANITY — the three rows really are SENSITIVE_REVIEW_REQUIRED');
  // =========================================================================

  const runId = await analyzedRun(tenant, fixture);

  await test('ONEMLINOT / KONTROLNOTU / KANGURUBU arrive SENSITIVE_REVIEW_REQUIRED with a proposed destination', async () => {
    for (const field of ['ONEMLINOT', 'KONTROLNOTU', 'KANGURUBU']) {
      const row = await mappingRow(runId, field);
      assert.equal(row.state, 'SENSITIVE_REVIEW_REQUIRED', field);
      assert.ok(row.destinationField, `${field} must already carry a proposed destination`);
      assert.equal(row.decidedByPlatformAdminId, null, `${field} must not already be operator-decided`);
    }
  });

  await test('ONEMLINOT / KONTROLNOTU compose into patient.notes with the documented order', async () => {
    const onemlinot = await mappingRow(runId, 'ONEMLINOT');
    const kontrolnotu = await mappingRow(runId, 'KONTROLNOTU');
    assert.equal(onemlinot.destinationField, 'patient.notes');
    assert.equal(onemlinot.transform, 'compose_notes');
    assert.equal(onemlinot.composeOrder, 1);
    assert.equal(kontrolnotu.destinationField, 'patient.notes');
    assert.equal(kontrolnotu.transform, 'compose_notes');
    assert.equal(kontrolnotu.composeOrder, 2);
  });

  await test('KANGURUBU proposes patient.bloodGroup', async () => {
    const row = await mappingRow(runId, 'KANGURUBU');
    assert.equal(row.destinationField, 'patient.bloodGroup');
    assert.equal(row.transform, 'blood_group_tr');
    assert.equal(row.composeOrder, null);
  });

  await test('KVKKONAYKODU arrives LEGAL_BLOCKED and populated', async () => {
    const row = await mappingRow(runId, 'KVKKONAYKODU');
    assert.equal(row.state, 'LEGAL_BLOCKED');
    const profile = row.sourceProfile as { filledCount?: number } | null;
    assert.equal(profile?.filledCount, ROW_COUNT, 'precondition: KVKKONAYKODU is populated in the fixture');
  });

  await test('HASTA_ID / ADI / SOYADI resolved on their own, before any operator click', async () => {
    for (const [field, dest] of [
      ['HASTA_ID', 'provenance.sourceId'],
      ['ADI', 'patient.firstName'],
      ['SOYADI', 'patient.lastName'],
    ] as const) {
      const row = await mappingRow(runId, field);
      assert.equal(row.destinationField, dest, field);
      assert.ok(row.state === 'AUTO_CONFIDENT' || row.state === 'RESOLVED', `${field} must be a writing state`);
    }
  });

  // =========================================================================
  section('1/2/3. "EŞLEMEYİ ONAYLA" — approve preserves destination/transform/composeOrder exactly');
  // =========================================================================

  await test('ONEMLINOT: approve returns 2xx', async () => {
    const res = await putMappings(runId, await approvePayload(runId, 'ONEMLINOT'));
    assert.equal(res.statusCode, 200, `approve failed: ${JSON.stringify(res.body)}`);
  });

  await test('ONEMLINOT: destination/transform/composeOrder are UNCHANGED, state moved to a resolved decision', async () => {
    const row = await mappingRow(runId, 'ONEMLINOT');
    assert.equal(row.destinationField, 'patient.notes');
    assert.equal(row.transform, 'compose_notes');
    assert.equal(row.composeOrder, 1, 'composeOrder 1 must survive the approval untouched');
    assert.equal(row.state, 'RESOLVED');
  });

  await test('ONEMLINOT: decidedByPlatformAdminId / decidedAt recorded via the existing audit model', async () => {
    const row = await mappingRow(runId, 'ONEMLINOT');
    assert.equal(row.isAutoSuggested, false);
    assert.equal(row.decidedByPlatformAdminId, ACTOR_ID);
    assert.notEqual(row.decidedAt, null);
  });

  await test('KONTROLNOTU: approve preserves composeOrder 2', async () => {
    const res = await putMappings(runId, await approvePayload(runId, 'KONTROLNOTU'));
    assert.equal(res.statusCode, 200, `approve failed: ${JSON.stringify(res.body)}`);
    const row = await mappingRow(runId, 'KONTROLNOTU');
    assert.equal(row.destinationField, 'patient.notes');
    assert.equal(row.transform, 'compose_notes');
    assert.equal(row.composeOrder, 2, 'composeOrder 2 must survive the approval untouched');
    assert.equal(row.state, 'RESOLVED');
    assert.equal(row.decidedByPlatformAdminId, ACTOR_ID);
    assert.notEqual(row.decidedAt, null);
  });

  await test('validation re-ran: sensitiveReviewCount dropped by two, no issue remains for either column', async () => {
    const res = await getMappings(runId);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.validation.sensitiveReviewCount, 1, 'only KANGURUBU is still undecided');
    const issues = (res.body.validation.issues as Array<{ sourceField?: string }>).map((i) => i.sourceField);
    assert.ok(!issues.includes('ONEMLINOT'));
    assert.ok(!issues.includes('KONTROLNOTU'));
  });

  await test('ROUND TRIP: the approval survives a reload through the real GET', async () => {
    const res = await getMappings(runId);
    const mappings = res.body.mappings as Array<Record<string, unknown>>;
    const onemlinot = mappings.find((m) => m.sourceField === 'ONEMLINOT')!;
    const kontrolnotu = mappings.find((m) => m.sourceField === 'KONTROLNOTU')!;
    assert.equal(onemlinot.state, 'RESOLVED');
    assert.equal(onemlinot.destinationField, 'patient.notes');
    assert.equal(onemlinot.composeOrder, 1);
    assert.equal(kontrolnotu.state, 'RESOLVED');
    assert.equal(kontrolnotu.destinationField, 'patient.notes');
    assert.equal(kontrolnotu.composeOrder, 2);
  });

  await test('the untouched LEGAL_BLOCKED row was neither written nor stamped by either approval', async () => {
    const gated = await mappingRow(runId, 'KVKKONAYKODU');
    assert.equal(gated.state, 'LEGAL_BLOCKED');
    assert.equal(gated.isAutoSuggested, true);
    assert.equal(gated.decidedByPlatformAdminId, null);
    assert.equal(gated.decidedAt, null);
  });

  // =========================================================================
  section('4. LEGAL_BLOCKED — an approve-shaped request still fails closed');
  // =========================================================================

  await test('a hand-crafted approve-shaped PUT against the stored LEGAL_BLOCKED row is refused', async () => {
    // Exactly the shape handleApproveMapping sends: the STORED tuple, with
    // only `state` moved to RESOLVED. KVKKONAYKODU is stored with a null
    // destination (LEGAL_BLOCKED never carries one), so this also proves the
    // refusal fires on the STATE change alone, not on a destination the
    // request never claimed.
    const before = await mappingRow(runId, 'KVKKONAYKODU');
    const res = await putMappings(runId, [
      {
        sourceField: 'KVKKONAYKODU',
        destinationField: before.destinationField,
        transform: before.transform,
        composeOrder: before.composeOrder,
        state: 'RESOLVED',
      },
    ]);
    assert.notEqual(res.statusCode, 200, 'lifting a legal gate via an approve-shaped payload must never succeed');
    assert.equal(res.body?.code, 'MAPPING_INVALID');
    assert.match(String(res.body?.error ?? ''), /KVKKONAYKODU/);

    const after = await mappingRow(runId, 'KVKKONAYKODU');
    assert.equal(after.state, 'LEGAL_BLOCKED');
    assert.equal(after.decidedByPlatformAdminId, null);
  });

  // =========================================================================
  section('5. NO-DESTINATION REVIEW ROW — an approve-shaped request never resolves it');
  // =========================================================================

  await test('a SENSITIVE_REVIEW_REQUIRED row with no destination stays invalid even if "approved"', async () => {
    // Simulates the defensive edge case canApproveMapping (client) guards
    // against: a review row that, for whatever reason, carries no destination.
    // KANGURUBU is repurposed here (before it is used for the "Yok say" test
    // below) by clearing its proposed destination directly in the database —
    // exactly what a corrupted/edge-case row would look like server-side.
    await prisma.migrationFieldMapping.updateMany({
      where: { runId, sourceField: 'KANGURUBU' },
      data: { destinationField: null, transform: null, composeOrder: null },
    });

    const res = await putMappings(runId, [
      { sourceField: 'KANGURUBU', destinationField: null, transform: null, composeOrder: null, state: 'RESOLVED' },
    ]);
    // The write itself is not refused (RESOLVED with no destination is not a
    // legal-gate edit) — but it can never PASS validation, which is the fail-
    // closed guarantee: no hand-crafted "approve" can manufacture a row the
    // server calls valid without a real destination.
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.validation.valid, false);
    const issue = (res.body.validation.issues as Array<{ sourceField?: string; code?: string }>).find(
      (i) => i.sourceField === 'KANGURUBU',
    );
    assert.ok(issue, 'a destination-less "resolved" row must be reported as invalid');
    assert.equal(issue!.code, 'MAPPING_REQUIRED');

    // Restore KANGURUBU to its analyzed proposal for the sections below.
    await prisma.migrationFieldMapping.updateMany({
      where: { runId, sourceField: 'KANGURUBU' },
      data: {
        destinationField: 'patient.bloodGroup',
        transform: 'blood_group_tr',
        composeOrder: null,
        state: 'SENSITIVE_REVIEW_REQUIRED',
        isAutoSuggested: true,
        decidedByPlatformAdminId: null,
        decidedAt: null,
      },
    });
  });

  // =========================================================================
  section('6. "YOK SAY" — destination/transform/composeOrder cleared atomically');
  // =========================================================================

  await test('KANGURUBU: ignore returns 2xx and clears destination/transform/composeOrder in the SAME write', async () => {
    const res = await putMappings(runId, ignorePayload('KANGURUBU'));
    assert.equal(res.statusCode, 200, `ignore failed: ${JSON.stringify(res.body)}`);
    const row = await mappingRow(runId, 'KANGURUBU');
    assert.equal(row.state, 'IGNORE');
    assert.equal(row.destinationField, null, 'destinationField must be cleared, not left carrying patient.bloodGroup');
    assert.equal(row.transform, null);
    assert.equal(row.composeOrder, null);
    assert.equal(row.decidedByPlatformAdminId, ACTOR_ID);
    assert.notEqual(row.decidedAt, null);
  });

  await test('no MAPPING_INVALID issue remains for KANGURUBU — the pre-fix defect is gone', async () => {
    const res = await getMappings(runId);
    const issues = (res.body.validation.issues as Array<{ sourceField?: string; code?: string }>).filter(
      (i) => i.sourceField === 'KANGURUBU',
    );
    assert.deepEqual(issues, [], `KANGURUBU must carry no validation issue at all, got ${JSON.stringify(issues)}`);
  });

  // =========================================================================
  section('7/8. COUNT AND VALIDATION — three "Kontrol et" rows become zero, mapping becomes valid');
  // =========================================================================

  await test('sensitiveReviewCount and unresolvedCount are both 0 after approve-approve-ignore', async () => {
    const res = await getMappings(runId);
    assert.equal(res.body.validation.sensitiveReviewCount, 0);
    assert.equal(res.body.validation.unresolvedCount, 0);
  });

  await test('the whole mapping is valid, with no manual per-column dropdown detour', async () => {
    const res = await getMappings(runId);
    assert.equal(res.body.validation.valid, true, `still invalid: ${JSON.stringify(res.body.validation.issues)}`);
  });

  await test('the run advanced to MAPPING_READY — "Referans Eşlemeye Geç" is reachable', async () => {
    const run = await prisma.migrationRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.status, 'MAPPING_READY');
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
