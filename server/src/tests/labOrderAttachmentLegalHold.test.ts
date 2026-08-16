/**
 * labOrderAttachmentLegalHold.test.ts — F4-3 / R-079 regression suite.
 *
 * R-079: LabOrderAttachment had no `legalHold` column, so
 * `DELETE /api/lab-orders/:id/attachments/:attId` — one of the three physical
 * attachment-delete paths — carried no legal-hold gate at all. This suite
 * proves the gate now exists and that it is STRUCTURAL, not advisory.
 *
 * BEHAVIOURAL, not a source scan. The real Express route chain (authorize() +
 * handler) is pulled out of the router's own stack and invoked directly — the
 * repository's established convention for route-level tests without a live
 * server (see paymentsListFieldScope.test.ts / communicationPreferencesRoute
 * .test.ts) — against an in-memory Prisma double that faithfully evaluates the
 * WHERE predicates, plus REAL disposable files on disk under a unique
 * fixture-only prefix so "the physical object still exists" is an actual
 * filesystem fact rather than a stubbed assertion.
 *
 * The in-memory double is what makes the TOCTOU proofs possible: it exposes a
 * hook that mutates `legalHold` in the window BETWEEN the route's metadata
 * pre-read and its atomic `deleteMany`, which is exactly the interleaving a
 * concurrent legal-hold PATCH produces and exactly the window a
 * read-then-delete implementation would lose. The same race against real
 * concurrent Postgres transactions is covered by
 * scripts/verify-attachment-legal-hold-lifecycle.ts section 6.
 *
 * Expected output noise: `Failed to log activity: { ... P1001 }` lines. Only
 * the SUCCESSFUL delete path reaches logActivity(), which holds its own pg Pool
 * rather than the stubbed db.ts singleton and therefore cannot reach a database
 * here. It swallows that error by design, and its appearance is itself a signal
 * that the blocked paths never got that far.
 *
 * Run with: cd server && npx tsx src/tests/labOrderAttachmentLegalHold.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import prisma from '../db.js';
import labOrdersRouter, {
  roleCanSeeLegalHoldReason,
  redactLabAttachmentLegalHoldReason,
} from '../routes/labOrders.js';
import type { AuthRequest } from '../middleware/auth.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ── Disposable fixture storage ─────────────────────────────────────────────
// fileStorage.ts resolves non-absolute keys under `${process.cwd()}/uploads`.
// Every fixture clinic id carries a unique per-run prefix, so nothing here can
// collide with — let alone delete — a real clinic's objects. Removed at exit.
const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');
const FIXTURE_RUN = `r079-fixture-${randomUUID()}`;
const CLINIC_A = `${FIXTURE_RUN}-a`;
const CLINIC_B = `${FIXTURE_RUN}-b`;
const ORG_ID = `${FIXTURE_RUN}-org`;

function writeFixtureObject(clinicId: string): string {
  const key = `${clinicId}/${randomUUID()}.pdf`;
  const abs = path.join(UPLOAD_ROOT, key);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'fixture-bytes');
  return key;
}

function fixtureExists(key: string): boolean {
  return fs.existsSync(path.join(UPLOAD_ROOT, key));
}

// ── In-memory Prisma double ────────────────────────────────────────────────

interface OrderRow { id: string; clinicId: string; patientId: string; deletedAt: Date | null }
interface AttachmentRow {
  id: string;
  clinicId: string;
  labWorkOrderId: string;
  fileName: string;
  originalName: string;
  fileSize: number;
  mimeType: string;
  filePath: string;
  uploadedById: string;
  createdAt: Date;
  legalHold: boolean;
  legalHoldReason: string | null;
}

const orders = new Map<string, OrderRow>();
const attachments = new Map<string, AttachmentRow>();
let audits: any[] = [];

/**
 * Fires immediately after the DELETE route's metadata pre-read returns, i.e.
 * inside the window between that read and the atomic deleteMany. This is the
 * concurrent-PATCH interleaving; a read-then-delete implementation would still
 * delete, an atomic predicate cannot.
 */
let afterAttachmentRead: (() => void) | null = null;

/** True whenever the storage-deletion contract wrote its evidence. */
function storageEvidenceRows() {
  return audits.filter((a) => String(a.action ?? '').startsWith('storage_object_delete'));
}

function matches(row: Record<string, any>, where: Record<string, any>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (cond !== null && typeof cond === 'object' && 'in' in cond) {
      if (!(cond.in as unknown[]).includes(row[key])) return false;
    } else if (row[key] !== cond) {
      return false;
    }
  }
  return true;
}

function installPrismaDouble() {
  (prisma as any).labWorkOrder = {
    findFirst: async ({ where }: any) => {
      for (const row of orders.values()) if (matches(row, where)) return { ...row };
      return null;
    },
  };
  (prisma as any).labOrderAttachment = {
    findFirst: async ({ where }: any) => {
      let found: AttachmentRow | null = null;
      for (const row of attachments.values()) if (matches(row, where)) { found = { ...row } as AttachmentRow; break; }
      const hook = afterAttachmentRead;
      if (hook) { afterAttachmentRead = null; hook(); }
      return found;
    },
    findMany: async ({ where }: any) => {
      const out: AttachmentRow[] = [];
      for (const row of attachments.values()) if (matches(row, where)) out.push({ ...row });
      return out;
    },
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (const [id, row] of [...attachments.entries()]) {
        if (matches(row, where)) { attachments.delete(id); count++; }
      }
      return { count };
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const [id, row] of attachments.entries()) {
        if (matches(row, where)) { attachments.set(id, { ...row, ...data }); count++; }
      }
      return { count };
    },
  };
  (prisma as any).auditLog = {
    create: async ({ data }: any) => { audits.push(data); return data; },
  };
  (prisma as any).operationalEvent = {
    create: async ({ data }: any) => data,
  };
}

// ── Route-chain driver ─────────────────────────────────────────────────────

type Handler = (req: AuthRequest, res: Response, next: () => void) => void | Promise<void>;

function getRouteChain(method: 'get' | 'patch' | 'delete', routePath: string): Handler[] {
  for (const layer of (labOrdersRouter as any).stack) {
    if (layer.route && layer.route.path === routePath && layer.route.methods?.[method]) {
      return layer.route.stack.map((s: any) => s.handle);
    }
  }
  throw new Error(`No route handler found for ${method.toUpperCase()} ${routePath}`);
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

function authRequest(
  user: { id?: string; role: string; clinicIds: string[]; organizationId?: string },
  params: Record<string, string>,
  body: Record<string, unknown> = {},
): AuthRequest {
  return {
    user: {
      id: user.id ?? `${FIXTURE_RUN}-user`,
      role: user.role,
      clinicId: user.clinicIds[0] ?? CLINIC_A,
      organizationId: user.organizationId ?? ORG_ID,
      allowedClinicIds: user.clinicIds,
      canAccessAllClinics: false,
    },
    params,
    body,
    query: {},
    headers: {},
    ip: '203.0.113.10',
  } as unknown as AuthRequest;
}

async function runChain(chain: Handler[], req: AuthRequest, res: Response): Promise<void> {
  for (const fn of chain) {
    let calledNext = false;
    await fn(req, res, () => { calledNext = true; });
    if (!calledNext) return;
  }
}

const DELETE_PATH = '/lab-orders/:id/attachments/:attId';
const HOLD_PATH = '/lab-orders/:id/attachments/:attId/legal-hold';
const LIST_PATH = '/lab-orders/:id/attachments';

/** Fresh order + attachment (with a real object on disk) for one scenario. */
function seed(opts: { clinicId?: string; legalHold?: boolean; reason?: string | null } = {}) {
  const clinicId = opts.clinicId ?? CLINIC_A;
  const orderId = randomUUID();
  const attId = randomUUID();
  const storageKey = writeFixtureObject(clinicId);
  orders.set(orderId, { id: orderId, clinicId, patientId: `${FIXTURE_RUN}-patient`, deletedAt: null });
  attachments.set(attId, {
    id: attId,
    clinicId,
    labWorkOrderId: orderId,
    fileName: path.basename(storageKey),
    originalName: 'Ahmet Yilmaz panoramik.pdf',
    fileSize: 13,
    mimeType: 'application/pdf',
    filePath: storageKey,
    uploadedById: `${FIXTURE_RUN}-user`,
    createdAt: new Date(),
    legalHold: opts.legalHold ?? false,
    legalHoldReason: opts.reason ?? null,
  });
  return { orderId, attId, clinicId, storageKey };
}

function resetCaptures() {
  audits = [];
  afterAttachmentRead = null;
}

async function main() {
  installPrismaDouble();

  const OWNER = { role: 'OWNER', clinicIds: [CLINIC_A] };
  const RECEPTIONIST = { role: 'RECEPTIONIST', clinicIds: [CLINIC_A] };

  // ── 1 ────────────────────────────────────────────────────────────────────
  section('1. legalHold=false — a valid, scoped delete still succeeds end to end (PR #430 path intact)');

  await test('DB row removed, physical object removed, storage-deletion evidence written, 200 success', async () => {
    resetCaptures();
    const { orderId, attId, storageKey } = seed();
    assert.equal(fixtureExists(storageKey), true, 'precondition: the fixture object exists on disk');

    const res = mockResponse();
    await runChain(getRouteChain('delete', DELETE_PATH), authRequest(RECEPTIONIST, { id: orderId, attId }), res);

    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.success, true);
    assert.equal(attachments.has(attId), false, 'the DB row must be gone');
    assert.equal(fixtureExists(storageKey), false, 'the physical object must be gone');
    assert.equal(storageEvidenceRows().length, 1, 'exactly one storage-deletion evidence record must be written');
  });

  // ── 2 / 3 / 4 ────────────────────────────────────────────────────────────
  section('2-4. legalHold=true — the row survives, the object survives, storage deletion is never attempted');

  await test('a held attachment is NOT deleted: 409 ATTACHMENT_LEGAL_HOLD, DB row still present', async () => {
    resetCaptures();
    const { orderId, attId } = seed({ legalHold: true, reason: 'pending litigation' });

    const res = mockResponse();
    await runChain(getRouteChain('delete', DELETE_PATH), authRequest(RECEPTIONIST, { id: orderId, attId }), res);

    assert.equal(res.statusCode, 409, `expected 409, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, 'ATTACHMENT_LEGAL_HOLD');
    assert.equal(attachments.has(attId), true, 'a row under legal hold must never be deleted');
    assert.equal(attachments.get(attId)!.legalHold, true);
  });

  await test('the physical object of a held attachment is still on disk afterwards', async () => {
    resetCaptures();
    const { orderId, attId, storageKey } = seed({ legalHold: true, reason: 'pending litigation' });

    const res = mockResponse();
    await runChain(getRouteChain('delete', DELETE_PATH), authRequest(RECEPTIONIST, { id: orderId, attId }), res);

    assert.equal(res.statusCode, 409);
    assert.equal(fixtureExists(storageKey), true, 'the bytes a legal hold protects must still exist');
  });

  await test('the storage-deletion service is never called on the blocked path — and no evidence claims an attempt', async () => {
    resetCaptures();
    const { orderId, attId } = seed({ legalHold: true, reason: 'pending litigation' });

    const res = mockResponse();
    await runChain(getRouteChain('delete', DELETE_PATH), authRequest(RECEPTIONIST, { id: orderId, attId }), res);

    assert.equal(res.statusCode, 409);
    assert.deepEqual(
      storageEvidenceRows(),
      [],
      'a deletion that never happened must not be recorded as attempted — evidence must describe reality',
    );
    const blocked = audits.filter((a) => a.action === 'lab_order_attachment_delete_blocked_legal_hold');
    assert.equal(blocked.length, 1, 'the refusal itself must be audited exactly once');
  });

  await test('the blocked audit entry carries stable references only — no file name, no reason text', async () => {
    resetCaptures();
    const { orderId, attId, clinicId } = seed({ legalHold: true, reason: 'CONFIDENTIAL: pending litigation' });

    const res = mockResponse();
    await runChain(getRouteChain('delete', DELETE_PATH), authRequest(RECEPTIONIST, { id: orderId, attId }), res);

    const [entry] = audits.filter((a) => a.action === 'lab_order_attachment_delete_blocked_legal_hold');
    assert.ok(entry, 'the refusal must be audited');
    const payload = `${entry.description ?? ''} ${JSON.stringify(entry.metadata ?? {})}`;
    assert.ok(!payload.includes('Ahmet'), 'audit payload must never carry a patient name');
    assert.ok(!payload.includes('.pdf'), 'audit payload must never carry the file name');
    assert.ok(!payload.toLowerCase().includes('confidential'), 'audit payload must never carry the legal-hold reason text');
    assert.equal(entry.entityId, attId, 'entityId must remain the stable reference');
    assert.equal(entry.entityType, 'lab_order_attachment');
    assert.equal(entry.clinicId, clinicId, 'the audit row must be attributed to the ORDER\'s clinic');
    assert.deepEqual(entry.metadata, { labWorkOrderId: orderId });
  });

  await test('legalHoldReason is returned on the 409 only to OWNER/ORG_ADMIN', async () => {
    for (const [user, expectReason] of [[OWNER, true], [RECEPTIONIST, false]] as const) {
      resetCaptures();
      const { orderId, attId } = seed({ legalHold: true, reason: 'CONFIDENTIAL: pending litigation' });
      const res = mockResponse();
      await runChain(getRouteChain('delete', DELETE_PATH), authRequest(user, { id: orderId, attId }), res);
      assert.equal(res.statusCode, 409);
      if (expectReason) {
        assert.equal(res.body.legalHoldReason, 'CONFIDENTIAL: pending litigation');
      } else {
        assert.ok(!('legalHoldReason' in res.body), `role ${user.role} must never see the legal-hold reason`);
      }
    }
  });

  // ── 5 ────────────────────────────────────────────────────────────────────
  section('5. Tenant isolation — a cross-clinic user cannot delete, hold, or even observe the attachment');

  await test('a user scoped to clinic B cannot delete clinic A\'s attachment (404, row and object intact)', async () => {
    resetCaptures();
    const { orderId, attId, storageKey } = seed({ clinicId: CLINIC_A });

    const res = mockResponse();
    await runChain(
      getRouteChain('delete', DELETE_PATH),
      authRequest({ role: 'RECEPTIONIST', clinicIds: [CLINIC_B] }, { id: orderId, attId }),
      res,
    );

    assert.equal(res.statusCode, 404, 'a foreign order must be indistinguishable from a nonexistent one');
    assert.equal(attachments.has(attId), true, 'the foreign row must survive');
    assert.equal(fixtureExists(storageKey), true, 'the foreign object must survive');
    assert.deepEqual(storageEvidenceRows(), [], 'no storage deletion may be attempted for a foreign tenant');
  });

  await test('a user with no clinic access at all is refused before any lookup (403)', async () => {
    resetCaptures();
    const { orderId, attId } = seed();
    const res = mockResponse();
    await runChain(getRouteChain('delete', DELETE_PATH), authRequest({ role: 'OWNER', clinicIds: [] }, { id: orderId, attId }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(attachments.has(attId), true);
  });

  await test('a cross-clinic OWNER cannot place or release a hold on another clinic\'s attachment', async () => {
    resetCaptures();
    const { orderId, attId } = seed({ clinicId: CLINIC_A, legalHold: true, reason: 'pending litigation' });

    const res = mockResponse();
    await runChain(
      getRouteChain('patch', HOLD_PATH),
      authRequest({ role: 'OWNER', clinicIds: [CLINIC_B] }, { id: orderId, attId }, { legalHold: false, reason: 'release attempt' }),
      res,
    );

    assert.equal(res.statusCode, 404);
    assert.equal(attachments.get(attId)!.legalHold, true, 'the hold must be untouched by a foreign tenant');
    assert.equal(audits.length, 0, 'a rejected cross-clinic mutation must not write a hold audit entry');
  });

  // ── 6 ────────────────────────────────────────────────────────────────────
  section('6. A stale pre-read cannot bypass a hold placed before the atomic delete (TOCTOU)');

  await test('a hold committing between the metadata pre-read and the deleteMany still blocks the delete', async () => {
    resetCaptures();
    const { orderId, attId, storageKey } = seed({ legalHold: false });

    // The route reads the row (legalHold=false) for its metadata; the hold
    // commits in that exact window. Only an atomic predicate can catch this.
    afterAttachmentRead = () => {
      const row = attachments.get(attId)!;
      attachments.set(attId, { ...row, legalHold: true, legalHoldReason: 'hold won the race' });
    };

    const res = mockResponse();
    await runChain(getRouteChain('delete', DELETE_PATH), authRequest(RECEPTIONIST, { id: orderId, attId }), res);

    assert.equal(res.statusCode, 409, 'the delete must observe the hold that committed after its pre-read');
    assert.equal(attachments.has(attId), true, 'the row must survive a hold placed inside the TOCTOU window');
    assert.equal(fixtureExists(storageKey), true, 'the object must survive it too');
    assert.deepEqual(storageEvidenceRows(), [], 'no physical deletion may be attempted once the hold is visible');
  });

  await test('the pre-read is metadata-only: it never authorizes, so its result cannot be trusted by the delete', async () => {
    resetCaptures();
    // The inverse interleaving: the pre-read sees a HELD row, and the hold is
    // released in the window. The atomic predicate then matches and the delete
    // proceeds — proving the decision is the deleteMany, not the read.
    const { orderId, attId, storageKey } = seed({ legalHold: true, reason: 'to be released' });
    afterAttachmentRead = () => {
      const row = attachments.get(attId)!;
      attachments.set(attId, { ...row, legalHold: false });
    };

    const res = mockResponse();
    await runChain(getRouteChain('delete', DELETE_PATH), authRequest(RECEPTIONIST, { id: orderId, attId }), res);

    assert.equal(res.statusCode, 200, 'a released hold must not leave a phantom block behind');
    assert.equal(attachments.has(attId), false);
    assert.equal(fixtureExists(storageKey), false);
  });

  await test('an attachment that disappears concurrently is reported as 404, never as a legal hold', async () => {
    resetCaptures();
    const { orderId, attId, storageKey } = seed({ legalHold: false });
    afterAttachmentRead = () => { attachments.delete(attId); };

    const res = mockResponse();
    await runChain(getRouteChain('delete', DELETE_PATH), authRequest(RECEPTIONIST, { id: orderId, attId }), res);

    assert.equal(res.statusCode, 404, 'a vanished row is a 404, not a 409 — the three zero-count causes stay distinguishable');
    assert.deepEqual(
      audits.filter((a) => a.action === 'lab_order_attachment_delete_blocked_legal_hold'),
      [],
      'a vanished row must not be audited as a legal-hold refusal',
    );
    // Nothing deleted the object, because nothing authorized a deletion.
    assert.equal(fixtureExists(storageKey), true);
  });

  // ── 7 ────────────────────────────────────────────────────────────────────
  section('7. Concurrent hold-vs-delete resolves on the DB predicate, in both orderings');

  await test('hold commits first -> delete affects zero rows (409); delete commits first -> hold affects zero rows (404)', async () => {
    // (a) hold first
    resetCaptures();
    const a = seed({ legalHold: false });
    const holdRes = mockResponse();
    await runChain(
      getRouteChain('patch', HOLD_PATH),
      authRequest(OWNER, { id: a.orderId, attId: a.attId }, { legalHold: true, reason: 'litigation hold' }),
      holdRes,
    );
    assert.equal(holdRes.statusCode, 200);
    const delRes = mockResponse();
    await runChain(getRouteChain('delete', DELETE_PATH), authRequest(RECEPTIONIST, { id: a.orderId, attId: a.attId }), delRes);
    assert.equal(delRes.statusCode, 409, 'the delete must lose to a committed hold');
    assert.equal(attachments.has(a.attId), true);
    assert.equal(fixtureExists(a.storageKey), true);

    // (b) delete first
    resetCaptures();
    const b = seed({ legalHold: false });
    const delRes2 = mockResponse();
    await runChain(getRouteChain('delete', DELETE_PATH), authRequest(RECEPTIONIST, { id: b.orderId, attId: b.attId }), delRes2);
    assert.equal(delRes2.statusCode, 200);
    const holdRes2 = mockResponse();
    await runChain(
      getRouteChain('patch', HOLD_PATH),
      authRequest(OWNER, { id: b.orderId, attId: b.attId }, { legalHold: true, reason: 'litigation hold' }),
      holdRes2,
    );
    assert.equal(holdRes2.statusCode, 404, 'a hold on an already-deleted row must not resurrect it');
    assert.equal(attachments.has(b.attId), false, 'the hold must never re-create the deleted row');
  });

  // ── 8 ────────────────────────────────────────────────────────────────────
  section('8. Hold placement / release — authorization, reason requirement, audit');

  await test('OWNER and ORG_ADMIN can place a hold; the row actually carries it afterwards', async () => {
    for (const role of ['OWNER', 'ORG_ADMIN']) {
      resetCaptures();
      const { orderId, attId } = seed();
      const res = mockResponse();
      await runChain(
        getRouteChain('patch', HOLD_PATH),
        authRequest({ role, clinicIds: [CLINIC_A] }, { id: orderId, attId }, { legalHold: true, reason: 'litigation hold' }),
        res,
      );
      assert.equal(res.statusCode, 200, `${role} must be able to place a hold`);
      assert.equal(attachments.get(attId)!.legalHold, true);
      assert.equal(attachments.get(attId)!.legalHoldReason, 'litigation hold');
    }
  });

  await test('every other lab-order role is refused (403) — including the roles that MAY delete attachments', async () => {
    for (const role of ['CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'ASSISTANT', 'BILLING']) {
      resetCaptures();
      const { orderId, attId } = seed();
      const res = mockResponse();
      await runChain(
        getRouteChain('patch', HOLD_PATH),
        authRequest({ role, clinicIds: [CLINIC_A] }, { id: orderId, attId }, { legalHold: true, reason: 'litigation hold' }),
        res,
      );
      assert.equal(res.statusCode, 403, `${role} must not be able to mutate a legal hold`);
      assert.equal(attachments.get(attId)!.legalHold, false, `${role} must not have changed the row`);
      assert.equal(audits.length, 0, `${role} must not have produced an audit entry`);
    }
  });

  await test('a reason (min 3 chars) is required in BOTH directions — placing and releasing', async () => {
    for (const legalHold of [true, false]) {
      for (const reason of [undefined, '', '  ', 'ab']) {
        resetCaptures();
        const { orderId, attId } = seed({ legalHold: !legalHold, reason: 'seed reason' });
        const res = mockResponse();
        await runChain(
          getRouteChain('patch', HOLD_PATH),
          authRequest(OWNER, { id: orderId, attId }, { legalHold, ...(reason === undefined ? {} : { reason }) }),
          res,
        );
        assert.equal(res.statusCode, 400, `legalHold=${legalHold} reason=${JSON.stringify(reason)} must be rejected`);
        assert.equal(attachments.get(attId)!.legalHold, !legalHold, 'a rejected request must not mutate the row');
      }
    }
  });

  await test('a non-boolean legalHold is rejected before anything is touched', async () => {
    resetCaptures();
    const { orderId, attId } = seed();
    const res = mockResponse();
    await runChain(
      getRouteChain('patch', HOLD_PATH),
      authRequest(OWNER, { id: orderId, attId }, { legalHold: 'true', reason: 'litigation hold' }),
      res,
    );
    assert.equal(res.statusCode, 400);
    assert.equal(audits.length, 0);
  });

  await test('both placing AND releasing are audited, with the before/after state and no reason text', async () => {
    resetCaptures();
    const { orderId, attId } = seed();

    await runChain(
      getRouteChain('patch', HOLD_PATH),
      authRequest(OWNER, { id: orderId, attId }, { legalHold: true, reason: 'CONFIDENTIAL: litigation' }),
      mockResponse(),
    );
    await runChain(
      getRouteChain('patch', HOLD_PATH),
      authRequest(OWNER, { id: orderId, attId }, { legalHold: false, reason: 'CONFIDENTIAL: matter closed' }),
      mockResponse(),
    );

    const set = audits.filter((a) => a.action === 'lab_order_attachment_legal_hold_set');
    const released = audits.filter((a) => a.action === 'lab_order_attachment_legal_hold_released');
    assert.equal(set.length, 1, 'placing a hold must be audited');
    assert.equal(released.length, 1, 'releasing a hold must be audited — it re-opens the row to deletion');
    assert.deepEqual(set[0].metadata, { labWorkOrderId: orderId, previousLegalHold: false, newLegalHold: true });
    assert.deepEqual(released[0].metadata, { labWorkOrderId: orderId, previousLegalHold: true, newLegalHold: false });
    for (const entry of [...set, ...released]) {
      const payload = `${entry.description ?? ''} ${JSON.stringify(entry.metadata ?? {})}`;
      assert.ok(!payload.toLowerCase().includes('confidential'), 'audit payload must never carry the free-text reason');
      assert.ok(!payload.includes('.pdf') && !payload.includes('Ahmet'), 'audit payload must never carry file name or patient name');
    }
    assert.equal(attachments.get(attId)!.legalHold, false, 'the release must actually have taken effect');
  });

  await test('a released attachment becomes deletable again — the hold is a gate, not a tombstone', async () => {
    resetCaptures();
    const { orderId, attId, storageKey } = seed({ legalHold: true, reason: 'litigation hold' });

    await runChain(
      getRouteChain('patch', HOLD_PATH),
      authRequest(OWNER, { id: orderId, attId }, { legalHold: false, reason: 'matter closed' }),
      mockResponse(),
    );
    const res = mockResponse();
    await runChain(getRouteChain('delete', DELETE_PATH), authRequest(RECEPTIONIST, { id: orderId, attId }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(attachments.has(attId), false);
    assert.equal(fixtureExists(storageKey), false);
  });

  // ── 9 ────────────────────────────────────────────────────────────────────
  section('9. legalHoldReason never leaks through a read path');

  await test('GET .../attachments redacts legalHoldReason for every role except OWNER/ORG_ADMIN', async () => {
    const cases: Array<[string, boolean]> = [
      ['OWNER', true], ['ORG_ADMIN', true],
      ['CLINIC_MANAGER', false], ['DENTIST', false], ['RECEPTIONIST', false], ['ASSISTANT', false], ['BILLING', false],
    ];
    for (const [role, expectSee] of cases) {
      resetCaptures();
      const { orderId } = seed({ legalHold: true, reason: 'CONFIDENTIAL: pending litigation' });
      const res = mockResponse();
      await runChain(getRouteChain('get', LIST_PATH), authRequest({ role, clinicIds: [CLINIC_A] }, { id: orderId }), res);
      assert.equal(res.statusCode, 200, `${role} must still be able to list attachments`);
      const [row] = res.body;
      assert.ok(row, `${role} must see the attachment itself`);
      assert.equal(row.legalHold, true, 'the legalHold boolean is never redacted — every reader may know a hold exists');
      assert.equal(
        row.legalHoldReason,
        expectSee ? 'CONFIDENTIAL: pending litigation' : null,
        `${role} legalHoldReason visibility must match the accepted PatientAttachment rule`,
      );
    }
  });

  await test('the exported role predicate and redaction helper match the accepted PatientAttachment contract', () => {
    assert.equal(roleCanSeeLegalHoldReason('OWNER'), true);
    assert.equal(roleCanSeeLegalHoldReason('ORG_ADMIN'), true);
    for (const role of ['CLINIC_MANAGER', 'DENTIST', 'RECEPTIONIST', 'ASSISTANT', 'BILLING', 'owner']) {
      if (role === 'owner') {
        assert.equal(roleCanSeeLegalHoldReason(role), false, 'the predicate is case-sensitive, exactly like attachments.ts');
        continue;
      }
      assert.equal(roleCanSeeLegalHoldReason(role), false);
    }
    assert.deepEqual(
      redactLabAttachmentLegalHoldReason({ id: 'x', legalHold: true, legalHoldReason: 'secret' }, false),
      { id: 'x', legalHold: true, legalHoldReason: null },
    );
    assert.deepEqual(
      redactLabAttachmentLegalHoldReason({ id: 'x', legalHold: true, legalHoldReason: 'secret' }, true),
      { id: 'x', legalHold: true, legalHoldReason: 'secret' },
    );
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const dir of [CLINIC_A, CLINIC_B, FIXTURE_RUN]) {
      fs.rmSync(path.join(UPLOAD_ROOT, dir), { recursive: true, force: true });
    }
    // logActivity/db.ts each hold their own pg Pool; nothing in this suite
    // needs a live database, so exit deterministically rather than waiting on
    // a connection that will never be made.
    process.exit(process.exitCode ?? 0);
  });
