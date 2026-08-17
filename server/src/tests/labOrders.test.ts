/**
 * labOrders.test.ts — Tests for the Dental Laboratory Tracking module.
 *
 * Covers:
 *  1. Status transition rules (valid steps, remake loop-back, terminal states)
 *  2. isOverdue() — scoped to pre-received_from_lab statuses only
 *  3. buildDashboardSummary() bucket aggregation
 *  4. Source regression checks — BILLING excluded from write routes, read
 *     routes use clinic-scope helpers, schema.prisma status is a plain String
 *  5. Clinic isolation (mock-based, mirrors treatmentCaseClinicScope.test.ts)
 *
 * Run with: tsx src/tests/labOrders.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Response } from 'express';

import prisma from '../db.js';
import labOrdersRouter from '../routes/labOrders.js';
import type { AuthRequest } from '../middleware/auth.js';
import {
  ALLOWED_TRANSITIONS,
  PRE_RECEIPT_STATUSES,
  validateStatusTransition,
  isRevisionLoopBack,
  isOverdue,
  type LabWorkOrderStatus,
} from '../services/labOrders/labOrderStatusTransitions.js';
import { buildDashboardSummary } from '../services/labOrders/labOrderSummary.js';
import { LAB_WORK_ORDER_STATUSES, labWorkOrderUpdateSchema } from '../schemas/index.js';

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

const ALL_STATUSES = LAB_WORK_ORDER_STATUSES as readonly LabWorkOrderStatus[];

// ── F4-1A2 behavioural upload harness ────────────────────────────────────────
// The real Express route chain is pulled out of the router's own stack and
// invoked directly against an in-memory Prisma double — the repository's
// established convention for route-level tests without a live server (see
// labOrderAttachmentLegalHold.test.ts / paymentsListFieldScope.test.ts). This
// replaces F4-1A's static `indexOf('buildStorageKey(order.clinicId')` pin with
// a test that observes the key the route ACTUALLY persists.
const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const FIXTURE_RUN = `f4-1a2-fixture-${randomUUID()}`;
/** The clinic that owns the lab order — the only correct key source. */
const CLINIC_ORDER = `${FIXTURE_RUN}-order-clinic`;
/** The requesting user's default clinic — deliberately DIFFERENT. */
const CLINIC_REQUEST_DEFAULT = `${FIXTURE_RUN}-request-clinic`;
const ORDER_ID = `${FIXTURE_RUN}-order`;

type Handler = (req: AuthRequest, res: Response, next: () => void) => void | Promise<void>;

function uploadChainWithoutMulter(): Handler[] {
  const routePath = '/lab-orders/:id/attachments';
  for (const layer of (labOrdersRouter as any).stack) {
    if (layer.route && layer.route.path === routePath && layer.route.methods?.post) {
      const full: Handler[] = layer.route.stack.map((s: any) => s.handle);
      // handleUpload wraps multer and parses a real multipart stream; this
      // suite injects req.file directly (memoryStorage semantics) instead.
      const runnable = full.filter((fn) => fn.name !== 'handleUpload');
      assert.equal(
        full.length - runnable.length,
        1,
        'expected exactly one multer wrapper (handleUpload) in the upload chain — its identity changed',
      );
      return runnable;
    }
  }
  throw new Error(`No route handler found for POST ${routePath}`);
}

function mockResponse(): Response & { statusCode: number; body: any } {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

async function runChain(chain: Handler[], req: AuthRequest, res: Response): Promise<void> {
  for (const fn of chain) {
    let calledNext = false;
    await fn(req, res, () => { calledNext = true; });
    if (!calledNext) return;
  }
}

function removeFixtureObjects() {
  for (const clinicId of [CLINIC_ORDER, CLINIC_REQUEST_DEFAULT]) {
    fs.rmSync(path.join(UPLOAD_ROOT, clinicId), { recursive: true, force: true });
  }
}

async function main() {
  // ── Status transitions ───────────────────────────────────────────────────
  section('Status transition rules');

  await test('valid step-by-step transitions succeed', () => {
    assert.equal(validateStatusTransition('pending', 'impression_taken').ok, true);
    assert.equal(validateStatusTransition('impression_taken', 'sent_to_lab').ok, true);
    assert.equal(validateStatusTransition('sent_to_lab', 'in_progress').ok, true);
    assert.equal(validateStatusTransition('in_progress', 'received_from_lab').ok, true);
    assert.equal(validateStatusTransition('received_from_lab', 'fitting_or_trial').ok, true);
    assert.equal(validateStatusTransition('fitting_or_trial', 'completed').ok, true);
  });

  await test('skipping stages is rejected (pending -> completed)', () => {
    const result = validateStatusTransition('pending', 'completed');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'invalid_transition');
  });

  await test('revision loop-back succeeds (revision_requested -> sent_to_lab)', () => {
    const result = validateStatusTransition('revision_requested', 'sent_to_lab');
    assert.equal(result.ok, true);
    assert.equal(isRevisionLoopBack('revision_requested', 'sent_to_lab'), true);
  });

  await test('fitting_or_trial can move to revision_requested', () => {
    assert.equal(validateStatusTransition('fitting_or_trial', 'revision_requested').ok, true);
  });

  await test('cancelled is reachable from every non-terminal status', () => {
    for (const status of ALL_STATUSES) {
      if (status === 'completed' || status === 'cancelled') continue;
      const result = validateStatusTransition(status, 'cancelled');
      assert.equal(result.ok, true, `expected ${status} -> cancelled to be allowed`);
    }
  });

  await test('completed and cancelled are terminal — no further transitions', () => {
    for (const status of ALL_STATUSES) {
      const result = validateStatusTransition('completed', status);
      assert.equal(result.ok, false);
    }
    const cancelledToPending = validateStatusTransition('cancelled', 'pending');
    assert.equal(cancelledToPending.ok, false);
    if (!cancelledToPending.ok) assert.equal(cancelledToPending.code, 'already_terminal');
  });

  await test('every status in ALLOWED_TRANSITIONS is a known status', () => {
    for (const [from, tos] of Object.entries(ALLOWED_TRANSITIONS)) {
      assert.ok((ALL_STATUSES as readonly string[]).includes(from));
      for (const to of tos) assert.ok((ALL_STATUSES as readonly string[]).includes(to));
    }
  });

  // ── isOverdue ─────────────────────────────────────────────────────────────
  section('isOverdue()');

  const now = new Date('2026-07-03T12:00:00Z');
  const past = new Date('2026-07-01T00:00:00Z');
  const future = new Date('2026-07-10T00:00:00Z');

  await test('overdue when past due date and still pre-receipt', () => {
    for (const status of PRE_RECEIPT_STATUSES) {
      assert.equal(isOverdue({ status, expectedReturnDate: past }, now), true, `expected ${status} to be overdue`);
    }
  });

  await test('not overdue once received_from_lab or later, even if date has passed', () => {
    const postReceiptStatuses: LabWorkOrderStatus[] = ['received_from_lab', 'fitting_or_trial', 'revision_requested', 'completed', 'cancelled'];
    for (const status of postReceiptStatuses) {
      assert.equal(isOverdue({ status, expectedReturnDate: past }, now), false, `expected ${status} to not be overdue`);
    }
  });

  await test('not overdue when expected date is in the future', () => {
    assert.equal(isOverdue({ status: 'sent_to_lab', expectedReturnDate: future }, now), false);
  });

  await test('not overdue when expectedReturnDate is null', () => {
    assert.equal(isOverdue({ status: 'sent_to_lab', expectedReturnDate: null }, now), false);
  });

  // ── buildDashboardSummary ────────────────────────────────────────────────
  section('buildDashboardSummary()');

  await test('bucket counts are correct across a mixed-status fixture', () => {
    const orders = [
      { status: 'pending', expectedReturnDate: future },
      { status: 'sent_to_lab', expectedReturnDate: past }, // overdue
      { status: 'in_progress', expectedReturnDate: past }, // overdue
      { status: 'received_from_lab', expectedReturnDate: past }, // not overdue (post-receipt)
      { status: 'fitting_or_trial', expectedReturnDate: null },
      { status: 'revision_requested', expectedReturnDate: null },
      { status: 'completed', expectedReturnDate: past },
      { status: 'cancelled', expectedReturnDate: past },
    ];
    const summary = buildDashboardSummary(orders, now);
    assert.equal(summary.pending, 3); // pending + sent_to_lab + in_progress
    assert.equal(summary.received, 1);
    assert.equal(summary.fittingPending, 1);
    assert.equal(summary.revisionRequested, 1);
    assert.equal(summary.completed, 1);
    assert.equal(summary.cancelled, 1);
    assert.equal(summary.overdue, 2);
    assert.equal(summary.total, orders.length);
  });

  // ── Source regression checks ─────────────────────────────────────────────
  section('Source regression checks');

  const labOrdersRouteSrc = src('../routes/labOrders.ts');
  const laboratoriesRouteSrc = src('../routes/laboratories.ts');
  const indexSrc = src('../index.ts');
  const schemaSrc = readFileSync(fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)), 'utf8');

  await test('LAB_ORDER_MANAGE_ROLES (used by all write routes) excludes BILLING', () => {
    const match = labOrdersRouteSrc.match(/LAB_ORDER_MANAGE_ROLES = \[([^\]]*)\]/);
    assert.ok(match, 'LAB_ORDER_MANAGE_ROLES definition not found');
    assert.ok(!match![1].includes("'BILLING'"), `LAB_ORDER_MANAGE_ROLES should not include BILLING: ${match![1]}`);
  });

  await test('lab order write routes (POST/PUT/PATCH/DELETE) use LAB_ORDER_MANAGE_ROLES or a stricter role set, never READ_ROLES', () => {
    const writeRouteDefs = labOrdersRouteSrc.match(/router\.(post|put|patch|delete)\(\s*'\/lab-orders[^']*',\s*authorize\(\[\.\.\.[A-Z_]+\]\)/g) ?? [];
    assert.ok(writeRouteDefs.length >= 6, `expected at least 6 lab-order write routes, found ${writeRouteDefs.length}`);
    for (const def of writeRouteDefs) {
      assert.ok(!def.includes('LAB_ORDER_READ_ROLES'), `write route should not use the read-roles list (which includes BILLING): ${def}`);
    }
  });

  await test('lab order read routes (GET) use LAB_ORDER_READ_ROLES (includes BILLING)', () => {
    const readRouteDefs = labOrdersRouteSrc.match(/router\.get\('\/lab-orders[^']*',\s*authorize\(\[\.\.\.[A-Z_]+\]\)/g) ?? [];
    assert.ok(readRouteDefs.length >= 3, `expected at least 3 lab-order GET routes, found ${readRouteDefs.length}`);
    for (const def of readRouteDefs) {
      assert.ok(def.includes('LAB_ORDER_READ_ROLES'), `read route should use LAB_ORDER_READ_ROLES: ${def}`);
    }
  });

  await test('LAB_MANAGE_ROLES (laboratory directory) excludes BILLING', () => {
    const match = laboratoriesRouteSrc.match(/LAB_MANAGE_ROLES = \[([^\]]*)\]/);
    assert.ok(match, 'LAB_MANAGE_ROLES definition not found');
    assert.ok(!match![1].includes("'BILLING'"), `LAB_MANAGE_ROLES should not include BILLING: ${match![1]}`);
  });

  await test('laboratory write routes (POST/PUT/DELETE) never use LAB_READ_ROLES', () => {
    const writeRouteDefs = laboratoriesRouteSrc.match(/router\.(post|put|delete)\('\/laboratories[^']*',\s*authorize\(\[\.\.\.[A-Z_]+\]\)/g) ?? [];
    assert.ok(writeRouteDefs.length >= 3);
    for (const def of writeRouteDefs) {
      assert.ok(!def.includes('LAB_READ_ROLES'), `write route should not use the read-roles list (which includes BILLING): ${def}`);
    }
  });

  await test('RECEPTIONIST and ASSISTANT are included in the manage-roles list', () => {
    assert.ok(labOrdersRouteSrc.includes("LAB_ORDER_MANAGE_ROLES = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'ASSISTANT']"));
  });

  await test('lab order routes use clinic-scope helpers, not raw req.user.clinicId for scoping', () => {
    assert.ok(labOrdersRouteSrc.includes('validateAndGetClinicIdScope'));
    assert.ok(labOrdersRouteSrc.includes('resolveEffectiveClinicId'));
    assert.ok(labOrdersRouteSrc.includes('getAccessibleClinicIds'));
    assert.ok(!/where:\s*{\s*id,\s*clinicId:\s*req\.user!\.clinicId/.test(labOrdersRouteSrc));
  });

  await test('schema.prisma defines LabWorkOrder.status as a plain String (not a Prisma enum)', () => {
    assert.ok(schemaSrc.includes('model LabWorkOrder'));
    assert.ok(/status\s+String\s+@default\("pending"\)/.test(schemaSrc));
    assert.ok(!/enum\s+LabWorkOrderStatus/.test(schemaSrc));
  });

  await test('index.ts registers both new route files', () => {
    assert.ok(indexSrc.includes("import laboratoriesRoutes from './routes/laboratories.js'"));
    assert.ok(indexSrc.includes("import labOrdersRoutes from './routes/labOrders.js'"));
    assert.ok(indexSrc.includes("app.use('/api', laboratoriesRoutes)"));
    assert.ok(indexSrc.includes("app.use('/api', labOrdersRoutes)"));
  });

  await test('notifications.ts wires the overdue-lab-case type and externalId prefix', () => {
    const notificationsSrc = src('../routes/notifications.ts');
    assert.ok(notificationsSrc.includes("type: 'lab_case_overdue'"));
    assert.ok(notificationsSrc.includes('lab-overdue-'));
    assert.ok(notificationsSrc.includes('labOrdersOverdue'));
  });

  await test('notificationPreferences.ts defines a labOrdersOverdue default toggle', () => {
    const prefsSrc = src('../services/notificationPreferences.ts');
    assert.ok(prefsSrc.includes('labOrdersOverdue: togglePreferenceSchema'));
    assert.ok(prefsSrc.includes("enabledTypes.push('lab_case_overdue')"));
  });

  // ── PUT /lab-orders/:id cannot change patientId ──────────────────────────
  section('Lab order update immutability');

  await test('labWorkOrderUpdateSchema strips patientId from a parsed update payload', () => {
    const parsed = labWorkOrderUpdateSchema.parse({
      patientId: '11111111-1111-1111-1111-111111111111',
      shade: 'A2',
    });
    assert.equal((parsed as Record<string, unknown>).patientId, undefined);
    assert.equal(parsed.shade, 'A2');
  });

  await test('PUT /lab-orders/:id route defensively strips patientId before calling prisma.update', () => {
    const putHandlerMatch = labOrdersRouteSrc.match(/router\.put\('\/lab-orders\/:id'[\s\S]*?(?=router\.(patch|delete)\()/);
    assert.ok(putHandlerMatch, 'PUT /lab-orders/:id handler not found');
    const putHandlerSrc = putHandlerMatch![0];
    assert.ok(
      /const\s*{\s*patientId:\s*_ignoredPatientId\s*,\s*\.\.\.updateData\s*}\s*=\s*validation\.data/.test(putHandlerSrc),
      'PUT handler should destructure patientId out of validation.data before building the update payload',
    );
    assert.ok(/data:\s*updateData/.test(putHandlerSrc), 'prisma.labWorkOrder.update should be called with the stripped updateData, not raw validation.data');
  });

  // ── Attachment upload clinic isolation ───────────────────────────────────
  section('Attachment upload path isolation');

  await test('multer uses in-memory storage; nothing on disk depends on req.user.clinicId', () => {
    assert.ok(labOrdersRouteSrc.includes('multer.memoryStorage()'), 'expected multer.memoryStorage() — file is validated in memory before hitting storage');
    assert.ok(!/req\.user\?\.clinicId/.test(labOrdersRouteSrc), 'upload flow should never branch on req.user.clinicId');
    assert.ok(!labOrdersRouteSrc.includes('multer.diskStorage'), 'disk staging was replaced by memory storage + fileStorage service');
  });

  await test('attachment upload stores the file under the order clinic key, after authorization', () => {
    const uploadRouteMatch = labOrdersRouteSrc.match(/router\.post\(\s*'\/lab-orders\/:id\/attachments'[\s\S]*?(?=router\.get\('\/lab-orders\/:id\/attachments')/);
    assert.ok(uploadRouteMatch, 'POST /lab-orders/:id/attachments handler not found');
    const uploadRouteSrc = uploadRouteMatch![0];

    const orderLookupIndex = uploadRouteSrc.indexOf('prisma.labWorkOrder.findFirst');
    const signatureCheckIndex = uploadRouteSrc.indexOf('isAllowedFileSignature(req.file.buffer');
    // F4-1A2: this landmark used to pin the exact call syntax
    // ('buildStorageKey(order.clinicId'), which is what deferred the caller
    // migration in the first place. It now accepts ANY authoritative
    // storage-key contract call that takes its clinic from order.clinicId, so
    // the ORDERING claim below survives a builder/façade change. The tenant
    // claim itself is no longer asserted from source text at all — it is proven
    // against the real route in the "Attachment upload storage key
    // (behavioural, F4-1A2)" section below.
    const keyMatch = /storageKey = build\w*StorageKey\(\s*\{?[^)]*order\.clinicId/.exec(uploadRouteSrc);
    const keyIndex = keyMatch ? keyMatch.index : -1;
    const saveIndex = uploadRouteSrc.indexOf('await saveFile(storageKey');
    const dbInsertIndex = uploadRouteSrc.indexOf('prisma.labOrderAttachment.create');

    assert.ok(
      !/build\w*StorageKey\(\s*\{?[^)]*req\.user/.test(uploadRouteSrc),
      'the storage key must never be derived from the request user clinic',
    );

    assert.ok(
      orderLookupIndex !== -1 && signatureCheckIndex !== -1 && keyIndex !== -1 && saveIndex !== -1 && dbInsertIndex !== -1,
      'expected order lookup, buffer signature check, storage key build, saveFile and DB insert to all be present',
    );
    assert.ok(orderLookupIndex < signatureCheckIndex, 'signature is checked only after the lab order has been loaded/authorized');
    assert.ok(signatureCheckIndex < keyIndex, 'storage key is built only for a validated file');
    assert.ok(keyIndex < saveIndex, 'file is saved under the key derived from order.clinicId, not req.user.clinicId');
    assert.ok(saveIndex < dbInsertIndex, 'DB row is created only after the file has been persisted');
  });

  await test('failed upload after saveFile deletes the stored file', () => {
    const uploadRouteMatch = labOrdersRouteSrc.match(/router\.post\(\s*'\/lab-orders\/:id\/attachments'[\s\S]*?(?=router\.get\('\/lab-orders\/:id\/attachments')/);
    const uploadRouteSrc = uploadRouteMatch![0];
    // F4-3: the rollback still removes the already-persisted object, but now
    // through services/storageObjectDeletion.deleteStoredObjectWithEvidence
    // instead of a bare deleteFile whose failure was swallowed entirely — a
    // failed rollback leaves an object with no DB row at all, and the evidence
    // write is the only thing that makes it findable afterwards.
    assert.ok(
      /if \(storageKey && rollbackClinicId\) \{[\s\S]*?deleteStoredObjectWithEvidence\(\{/.test(uploadRouteSrc),
      'catch path must delete the already-persisted file when the DB insert fails',
    );
    assert.ok(
      /source: 'upload_rollback'/.test(uploadRouteSrc),
      'the rollback deletion must be evidenced as an upload rollback, distinguishable from a record deletion',
    );
    assert.ok(
      /clinicId: rollbackClinicId/.test(uploadRouteSrc),
      'the rollback must attribute the object to the lab order\'s own clinic, never req.user.clinicId',
    );
  });

  // ── Frontend edit form preserves existing values ─────────────────────────
  section('Frontend edit form field preservation');

  await test('LabOrders.tsx initializes shade/material/notesForLab from the existing order on edit', () => {
    const labOrdersPageSrc = readFileSync(fileURLToPath(new URL('../../../src/pages/LabOrders.tsx', import.meta.url)), 'utf8');
    assert.ok(/useState\(order\?\.shade\s*\?\?\s*''\)/.test(labOrdersPageSrc), 'shade should seed from order?.shade');
    assert.ok(/useState\(order\?\.material\s*\?\?\s*''\)/.test(labOrdersPageSrc), 'material should seed from order?.material');
    assert.ok(/useState\(order\?\.notesForLab\s*\?\?\s*''\)/.test(labOrdersPageSrc), 'notesForLab should seed from order?.notesForLab');
    assert.ok(/shade:\s*string\s*\|\s*null;/.test(labOrdersPageSrc), 'LabOrderRow type should declare shade');
    assert.ok(/material:\s*string\s*\|\s*null;/.test(labOrdersPageSrc), 'LabOrderRow type should declare material');
    assert.ok(/notesForLab:\s*string\s*\|\s*null;/.test(labOrdersPageSrc), 'LabOrderRow type should declare notesForLab');
  });

  // ── Clinic isolation (mock-based, mirrors treatmentCaseClinicScope.test.ts) ─
  section('Clinic isolation');

  type LabOrderRow = { id: string; clinicId: string };
  const mockLabOrders: LabOrderRow[] = [
    { id: 'lab-A-1', clinicId: 'clinic-A' },
    { id: 'lab-B-1', clinicId: 'clinic-B' },
  ];

  function simulateListLabOrders(accessibleClinicIds: string[]) {
    return mockLabOrders.filter(o => accessibleClinicIds.includes(o.clinicId));
  }

  function simulateGetLabOrder(id: string, accessibleClinicIds: string[]) {
    return mockLabOrders.find(o => o.id === id && accessibleClinicIds.includes(o.clinicId)) ?? null;
  }

  await test('a lab order created under clinic A is not visible when scoped to clinic B', () => {
    const list = simulateListLabOrders(['clinic-B']);
    assert.ok(!list.some(o => o.id === 'lab-A-1'));

    const detail = simulateGetLabOrder('lab-A-1', ['clinic-B']);
    assert.equal(detail, null);
  });

  await test('a user with access to both clinics sees both lab orders', () => {
    const list = simulateListLabOrders(['clinic-A', 'clinic-B']);
    assert.deepEqual(list.map(o => o.id).sort(), ['lab-A-1', 'lab-B-1']);
  });

  await test('a user with no clinic access sees nothing', () => {
    const list = simulateListLabOrders([]);
    assert.deepEqual(list, []);
  });

  // ── F4-1A2: behavioural proof of the persisted attachment storage key ─────
  section('Attachment upload storage key (behavioural, F4-1A2)');

  const createdAttachments: any[] = [];
  (prisma as any).labWorkOrder = {
    findFirst: async ({ where }: any) => {
      const accessible: string[] = where?.clinicId?.in ?? [];
      if (where?.id !== ORDER_ID || !accessible.includes(CLINIC_ORDER)) return null;
      return { id: ORDER_ID, clinicId: CLINIC_ORDER, patientId: `${FIXTURE_RUN}-patient`, deletedAt: null };
    },
  };
  (prisma as any).labOrderAttachment = {
    create: async ({ data }: any) => {
      createdAttachments.push(data);
      return { id: randomUUID(), ...data, legalHold: false, legalHoldReason: null, uploadedBy: { firstName: 'T', lastName: 'U' } };
    },
  };

  async function uploadFixtureAttachment() {
    createdAttachments.length = 0;
    const req = {
      user: {
        id: `${FIXTURE_RUN}-user`,
        role: 'RECEPTIONIST',
        // The request-default clinic is NOT the order's clinic. Both are
        // accessible, so authorization succeeds and the ONLY thing deciding the
        // key is which clinic the route chooses to derive it from.
        clinicId: CLINIC_REQUEST_DEFAULT,
        organizationId: `${FIXTURE_RUN}-org`,
        allowedClinicIds: [CLINIC_REQUEST_DEFAULT, CLINIC_ORDER],
        canAccessAllClinics: false,
      },
      params: { id: ORDER_ID },
      body: {},
      query: {},
      headers: {},
      ip: '203.0.113.11',
      file: {
        buffer: Buffer.from('%PDF-1.4 fixture bytes'),
        mimetype: 'application/pdf',
        originalname: 'Ayse Yilmaz rapor.pdf',
        size: 22,
      },
    } as unknown as AuthRequest;

    const res = mockResponse();
    await runChain(uploadChainWithoutMulter(), req, res);
    return { res, data: createdAttachments[0] };
  }

  await test('the persisted key derives from order.clinicId, NEVER the request-default clinic', async () => {
    try {
      const { res, data } = await uploadFixtureAttachment();

      assert.equal(res.statusCode, 201, `expected 201, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
      assert.ok(data, 'the attachment row must have been created');
      assert.equal(data.clinicId, CLINIC_ORDER, 'the row must be owned by the order clinic');
      assert.ok(
        data.filePath.startsWith(`${CLINIC_ORDER}/`),
        `filePath must be scoped to the ORDER clinic (got ${data.filePath})`,
      );
      assert.ok(
        !data.filePath.includes(CLINIC_REQUEST_DEFAULT),
        `filePath must never reference the request-default clinic (got ${data.filePath})`,
      );
    } finally {
      removeFixtureObjects();
    }
  });

  await test('the persisted key keeps the accepted <clinicId>/<opaqueId><ext> shape and leaks no filename PII', async () => {
    try {
      const { data } = await uploadFixtureAttachment();
      assert.match(
        data.filePath,
        new RegExp(`^${CLINIC_ORDER}/\\d+-[a-z0-9]+\\.pdf$`),
        `unexpected key shape (got ${data.filePath})`,
      );
      for (const secret of ['Ayse', 'Yilmaz', 'rapor']) {
        assert.ok(!data.filePath.includes(secret), `key must not embed "${secret}" (got ${data.filePath})`);
      }
      assert.equal(data.fileName, path.posix.basename(data.filePath), 'fileName is the key basename, unchanged');
    } finally {
      removeFixtureObjects();
    }
  });

  await test('the object is actually written under the order clinic prefix on disk', async () => {
    try {
      const { data } = await uploadFixtureAttachment();
      assert.equal(
        fs.existsSync(path.join(UPLOAD_ROOT, data.filePath)),
        true,
        `the stored object must exist at the persisted key (${data.filePath})`,
      );
      assert.equal(
        fs.existsSync(path.join(UPLOAD_ROOT, CLINIC_REQUEST_DEFAULT)),
        false,
        'nothing may be written under the request-default clinic prefix',
      );
    } finally {
      removeFixtureObjects();
    }
  });

  // ── Result ────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
