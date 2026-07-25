/**
 * organizationMessagingConnectionScope.test.ts — Route-level regression tests
 * for the KVKK H-2 fix (same-organization, cross-branch WhatsApp/Instagram
 * connection authorization gap).
 *
 * Bug (docs/program/evidence/KVKK_H2_CROSS_BRANCH_MESSAGING_AUTHORIZATION_VALIDATION_20260725.md):
 * a restricted CLINIC_MANAGER (canAccessAllClinics=false, allowedClinicIds
 * limited to their own clinic) could read, test, and reassign WhatsApp/
 * Instagram connections belonging to a sibling clinic in the SAME
 * organization, because organizationWhatsApp.ts / organizationInstagram.ts
 * never checked req.user.allowedClinicIds — only req.user.organizationId.
 * The highest-impact confirmed path was PUT /clinics/:clinicId/whatsapp|instagram,
 * which let a restricted manager silently redirect another clinic's
 * messaging connection.
 *
 * Fix: every CLINIC_MANAGER-reachable route in both files now also checks
 * clinic/connection scope via the new isLinkedToAccessibleClinic() helper
 * (server/src/utils/clinicScope.ts) before any read, provider call, or
 * mutation. Cross-organization protection (organizationId filtering) is
 * unchanged. OWNER/ORG_ADMIN and canAccessAllClinics=true managers keep
 * full organization-wide behavior.
 *
 * Harness: this repo has no supertest/live-Express-server pattern and no
 * live Postgres is available in this task's environment (same documented
 * constraint as patientsImportClinicScope.test.ts and
 * communicationPreferencesRoute.test.ts). Rather than hand-copying the
 * route logic, this suite extracts the REAL route handler functions
 * directly from the actual `organizationWhatsAppRouter`/`organizationInstagramRouter`
 * stacks (same technique as communicationPreferencesRoute.test.ts's
 * getRouteHandler()) and invokes them with a constructed AuthRequest/mock
 * Response, backed by an in-memory Prisma mock (the shared `prisma` default
 * export's model delegates are plain writable object properties — verified
 * empirically — so they can be swapped for in-memory fakes without a
 * mocking library). This exercises the exact production authorization
 * logic added by this fix, not a reimplementation of it.
 *
 * authorize()/authenticate() (pure role checks, unchanged by this fix and
 * already covered by existing role-boolean tests per the evidence doc) are
 * intentionally skipped, matching getRouteHandler()'s documented scope.
 * RECEPTIONIST/DENTIST/BILLING exclusion is verified via a source-regression
 * check of the authorize() allow-lists instead (they were never reachable
 * and are not touched by this fix).
 *
 * Run with: npx tsx src/tests/organizationMessagingConnectionScope.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prisma from '../db.js';
import whatsAppRouter from '../routes/organizationWhatsApp.js';
import instagramRouter from '../routes/organizationInstagram.js';
import type { AuthRequest } from '../middleware/auth.js';
import type { Response } from 'express';

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

// ─── Extract the real handler (last function in the route's stack) ─────────
// Mirrors communicationPreferencesRoute.test.ts's getRouteHandler(): runs the
// actual production handler body (DB calls, scope checks, sanitization),
// deliberately skipping authorize()/authenticate() to unit-test the fixed
// authorization logic in isolation with a fully-controlled req.user.

type RouterLike = { stack: Array<any> };

function getHandler(
  router: RouterLike,
  method: 'get' | 'put' | 'post' | 'delete',
  path: string,
): (req: AuthRequest, res: Response) => Promise<void> {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods?.[method]) {
      const stack = layer.route.stack;
      return stack[stack.length - 1].handle;
    }
  }
  throw new Error(`No route handler found for ${method.toUpperCase()} ${path}`);
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
  user: NonNullable<AuthRequest['user']>,
  params: Record<string, string>,
  body: Record<string, unknown> = {},
): AuthRequest {
  return { params, query: {}, body, headers: {}, user } as unknown as AuthRequest;
}

function makeUser(overrides: Partial<NonNullable<AuthRequest['user']>>): NonNullable<AuthRequest['user']> {
  return {
    id: 'user-1',
    clinicId: 'clinic-A',
    role: 'CLINIC_MANAGER',
    organizationId: 'org-1',
    allowedClinicIds: ['clinic-A'],
    canAccessAllClinics: false,
    ...overrides,
  } as NonNullable<AuthRequest['user']>;
}

// ─── In-memory Prisma mock ───────────────────────────────────────────────────
// prisma's model delegates (prisma.whatsAppConnection, prisma.clinic, ...) are
// plain writable properties on the shared singleton (confirmed empirically —
// PrismaClient does not freeze them), so they can be swapped for in-memory
// fakes here without a mocking library. All 13 fixed routes, plus the
// services they call (testWhatsAppConnection/getWhatsAppQrCode internally
// call prisma.whatsAppConnection.findFirst/update), read this same mock.

// PUT /clinics/:clinicId/whatsapp validates whatsappConnectionId with z.string().uuid(),
// so WhatsApp connection fixture ids must be real UUIDs (Instagram's equivalent route
// has no such format constraint, so ig-* ids stay human-readable).
const WA_A = '11111111-1111-4111-8111-111111111111';
const WA_B = '22222222-2222-4222-8222-222222222222';
const WA_UNLINKED = '33333333-3333-4333-8333-333333333333';
const WA_ORG2 = '44444444-4444-4444-8444-444444444444';

type Clinic = { id: string; organizationId: string; name: string };
type WaConn = Record<string, any>;
type IgConn = Record<string, any>;
type WaLink = { clinicId: string; whatsappConnectionId: string; organizationId: string; isDefault: boolean };
type IgLink = { clinicId: string; instagramConnectionId: string; organizationId: string; isDefault: boolean };

let clinics: Clinic[] = [];
let waConns: WaConn[] = [];
let waLinks: WaLink[] = [];
let igConns: IgConn[] = [];
let igLinks: IgLink[] = [];
let waUpdateCalls = 0;
let igUpdateCalls = 0;

function attachWaClinics(conn: WaConn | undefined | null): WaConn | null {
  if (!conn) return null;
  const linked = waLinks.filter((l) => l.whatsappConnectionId === conn.id);
  return {
    ...conn,
    clinics: linked.map((l) => ({
      clinicId: l.clinicId,
      whatsappConnectionId: l.whatsappConnectionId,
      organizationId: l.organizationId,
      isDefault: l.isDefault,
      clinic: (() => { const c = clinics.find((x) => x.id === l.clinicId); return c ? { id: c.id, name: c.name } : undefined; })(),
    })),
  };
}

function attachIgClinics(conn: IgConn | undefined | null): IgConn | null {
  if (!conn) return null;
  const linked = igLinks.filter((l) => l.instagramConnectionId === conn.id);
  return {
    ...conn,
    clinics: linked.map((l) => ({
      clinicId: l.clinicId,
      instagramConnectionId: l.instagramConnectionId,
      organizationId: l.organizationId,
      isDefault: l.isDefault,
      clinic: (() => { const c = clinics.find((x) => x.id === l.clinicId); return c ? { id: c.id, name: c.name } : undefined; })(),
    })),
  };
}

function resetFixtures() {
  const clinicA: Clinic = { id: 'clinic-A', organizationId: 'org-1', name: 'Clinic A' };
  const clinicB: Clinic = { id: 'clinic-B', organizationId: 'org-1', name: 'Clinic B' };
  const clinicC: Clinic = { id: 'clinic-C', organizationId: 'org-2', name: 'Clinic C (org-2)' };
  clinics = [clinicA, clinicB, clinicC];

  // Evolution API connections with NO credentials configured — both
  // testConnection() and getQrCode() short-circuit to a graceful
  // {success:false}/{available:false} with ZERO network calls
  // (resolveCredentials() returns null before any fetch()), so allowed-path
  // scenarios are fast/deterministic/network-free while still exercising
  // the real provider call.
  waConns = [
    { id: WA_A, organizationId: 'org-1', isActive: true, provider: 'evolution_api', name: 'WA A', status: 'disconnected', lastConnectedAt: null, lastError: null, createdAt: new Date('2026-01-01') },
    { id: WA_B, organizationId: 'org-1', isActive: true, provider: 'evolution_api', name: 'WA B', status: 'disconnected', lastConnectedAt: null, lastError: null, createdAt: new Date('2026-01-02') },
    { id: WA_UNLINKED, organizationId: 'org-1', isActive: true, provider: 'evolution_api', name: 'WA Unlinked', status: 'disconnected', lastConnectedAt: null, lastError: null, createdAt: new Date('2026-01-03') },
    { id: WA_ORG2, organizationId: 'org-2', isActive: true, provider: 'evolution_api', name: 'WA Org2', status: 'disconnected', lastConnectedAt: null, lastError: null, createdAt: new Date('2026-01-04') },
  ];
  waLinks = [
    { clinicId: 'clinic-A', whatsappConnectionId: WA_A, organizationId: 'org-1', isDefault: true },
    { clinicId: 'clinic-B', whatsappConnectionId: WA_B, organizationId: 'org-1', isDefault: true },
    { clinicId: 'clinic-C', whatsappConnectionId: WA_ORG2, organizationId: 'org-2', isDefault: true },
  ];

  igConns = [
    { id: 'ig-a', organizationId: 'org-1', isActive: true, status: 'disconnected', instagramUsername: null, instagramLoginUserId: null, createdAt: new Date('2026-01-01') },
    { id: 'ig-b', organizationId: 'org-1', isActive: true, status: 'disconnected', instagramUsername: null, instagramLoginUserId: null, createdAt: new Date('2026-01-02') },
    { id: 'ig-unlinked', organizationId: 'org-1', isActive: true, status: 'disconnected', instagramUsername: null, instagramLoginUserId: null, createdAt: new Date('2026-01-03') },
    { id: 'ig-org2', organizationId: 'org-2', isActive: true, status: 'disconnected', instagramUsername: null, instagramLoginUserId: null, createdAt: new Date('2026-01-04') },
  ];
  igLinks = [
    { clinicId: 'clinic-A', instagramConnectionId: 'ig-a', organizationId: 'org-1', isDefault: true },
    { clinicId: 'clinic-B', instagramConnectionId: 'ig-b', organizationId: 'org-1', isDefault: true },
    { clinicId: 'clinic-C', instagramConnectionId: 'ig-org2', organizationId: 'org-2', isDefault: true },
  ];

  waUpdateCalls = 0;
  igUpdateCalls = 0;
}

function installPrismaMock() {
  (prisma as any).clinic = {
    findFirst: async ({ where }: any) =>
      clinics.find((c) => c.id === where.id && c.organizationId === where.organizationId) ?? null,
    findMany: async ({ where }: any) =>
      clinics.filter((c) => (!where?.id?.in || where.id.in.includes(c.id)) && (!where?.organizationId || c.organizationId === where.organizationId)),
  };

  (prisma as any).whatsAppConnection = {
    findMany: async ({ where }: any) => {
      let results = waConns.filter((c) => c.organizationId === where.organizationId);
      const allowedIn = where?.clinics?.some?.clinicId?.in;
      if (allowedIn) {
        results = results.filter((c) => waLinks.some((l) => l.whatsappConnectionId === c.id && allowedIn.includes(l.clinicId)));
      }
      return results.map((c) => attachWaClinics(c));
    },
    findFirst: async ({ where }: any) => {
      const rec = waConns.find((c) => c.id === where.id);
      if (!rec) return null;
      if (where.organizationId !== undefined && rec.organizationId !== where.organizationId) return null;
      if (where.isActive !== undefined && rec.isActive !== where.isActive) return null;
      return attachWaClinics(rec);
    },
    update: async ({ where, data }: any) => {
      waUpdateCalls++;
      const idx = waConns.findIndex((c) => c.id === where.id);
      if (idx === -1) throw new Error('wa connection not found');
      waConns[idx] = { ...waConns[idx], ...data };
      return attachWaClinics(waConns[idx]);
    },
  };

  (prisma as any).clinicWhatsAppConnection = {
    findMany: async ({ where }: any) =>
      waLinks
        .filter((l) => l.clinicId === where.clinicId && l.organizationId === where.organizationId)
        .map((l) => ({ ...l, whatsappConnection: attachWaClinics(waConns.find((c) => c.id === l.whatsappConnectionId)) })),
    upsert: async ({ where, create, update }: any) => {
      const key = where.clinicId_whatsappConnectionId;
      const idx = waLinks.findIndex((l) => l.clinicId === key.clinicId && l.whatsappConnectionId === key.whatsappConnectionId);
      if (idx >= 0) { waLinks[idx] = { ...waLinks[idx], ...update }; return waLinks[idx]; }
      const row: WaLink = { clinicId: create.clinicId, whatsappConnectionId: create.whatsappConnectionId, organizationId: create.organizationId, isDefault: create.isDefault ?? true };
      waLinks.push(row);
      return row;
    },
  };

  (prisma as any).clinicLegalProfile = { findMany: async () => [] };
  (prisma as any).appointmentType = { groupBy: async () => [] };
  (prisma as any).messageTemplate = { findMany: async () => [] };

  // Fire-and-forget side effects (writeAuditLog/logActivity/recordOperationalEvent)
  // are not under test here — no-op them so a denied/allowed request under test
  // doesn't spam ECONNREFUSED noise from trying to reach a real database.
  (prisma as any).auditLog = { create: async () => ({}) };
  (prisma as any).operationalEvent = { create: async () => ({}) };
  (prisma as any).activityLog = { create: async () => ({}) };

  (prisma as any).instagramConnection = {
    findMany: async ({ where }: any) => {
      let results = igConns.filter((c) => c.organizationId === where.organizationId);
      const allowedIn = where?.clinics?.some?.clinicId?.in;
      if (allowedIn) {
        results = results.filter((c) => igLinks.some((l) => l.instagramConnectionId === c.id && allowedIn.includes(l.clinicId)));
      }
      return results.map((c) => attachIgClinics(c));
    },
    findFirst: async ({ where }: any) => {
      const rec = igConns.find((c) => c.id === where.id);
      if (!rec) return null;
      if (where.organizationId !== undefined && rec.organizationId !== where.organizationId) return null;
      return attachIgClinics(rec);
    },
    update: async ({ where, data }: any) => {
      igUpdateCalls++;
      const idx = igConns.findIndex((c) => c.id === where.id);
      if (idx === -1) throw new Error('ig connection not found');
      igConns[idx] = { ...igConns[idx], ...data };
      return attachIgClinics(igConns[idx]);
    },
  };

  (prisma as any).clinicInstagramConnection = {
    findMany: async ({ where }: any) => {
      let results = igLinks;
      if (where.clinicId !== undefined) results = results.filter((l) => l.clinicId === where.clinicId);
      if (where.organizationId !== undefined) results = results.filter((l) => l.organizationId === where.organizationId);
      return results.map((l) => ({ ...l, instagramConnection: attachIgClinics(igConns.find((c) => c.id === l.instagramConnectionId)) }));
    },
    upsert: async ({ where, create, update }: any) => {
      const key = where.clinicId_instagramConnectionId;
      const idx = igLinks.findIndex((l) => l.clinicId === key.clinicId && l.instagramConnectionId === key.instagramConnectionId);
      if (idx >= 0) { igLinks[idx] = { ...igLinks[idx], ...update }; return igLinks[idx]; }
      const row: IgLink = { clinicId: create.clinicId, instagramConnectionId: create.instagramConnectionId, organizationId: create.organizationId, isDefault: create.isDefault ?? false };
      igLinks.push(row);
      return row;
    },
    deleteMany: async ({ where }: any) => {
      const before = igLinks.length;
      igLinks = igLinks.filter((l) => !(l.clinicId === where.clinicId && l.instagramConnectionId === where.instagramConnectionId));
      return { count: before - igLinks.length };
    },
  };
}

// ─── Fixtures / users ─────────────────────────────────────────────────────
installPrismaMock();

const restrictedManager = makeUser({ id: 'mgr-1', role: 'CLINIC_MANAGER', organizationId: 'org-1', canAccessAllClinics: false, allowedClinicIds: ['clinic-A'], clinicId: 'clinic-A' });
const owner = makeUser({ id: 'owner-1', role: 'OWNER', organizationId: 'org-1', canAccessAllClinics: true, allowedClinicIds: [], clinicId: 'clinic-A' });
const orgAdmin = makeUser({ id: 'admin-1', role: 'ORG_ADMIN', organizationId: 'org-1', canAccessAllClinics: true, allowedClinicIds: [], clinicId: 'clinic-A' });
const org2Owner = makeUser({ id: 'owner-2', role: 'OWNER', organizationId: 'org-2', canAccessAllClinics: true, allowedClinicIds: [], clinicId: 'clinic-C' });

// ─── Route handlers under test ─────────────────────────────────────────────
const waList = getHandler(whatsAppRouter, 'get', '/organization/whatsapp-connections');
const waDetail = getHandler(whatsAppRouter, 'get', '/organization/whatsapp-connections/:id');
const waTest = getHandler(whatsAppRouter, 'post', '/organization/whatsapp-connections/:id/test');
const waReadiness = getHandler(whatsAppRouter, 'get', '/organization/whatsapp-connections/:id/readiness');
const waQr = getHandler(whatsAppRouter, 'get', '/organization/whatsapp-connections/:id/qr');
const waClinicGet = getHandler(whatsAppRouter, 'get', '/clinics/:clinicId/whatsapp');
const waClinicPut = getHandler(whatsAppRouter, 'put', '/clinics/:clinicId/whatsapp');

const igList = getHandler(instagramRouter, 'get', '/organization/instagram-connections');
const igDetail = getHandler(instagramRouter, 'get', '/organization/instagram-connections/:id');
const igTest = getHandler(instagramRouter, 'post', '/organization/instagram-connections/:id/test');
const igClinicGet = getHandler(instagramRouter, 'get', '/clinics/:clinicId/instagram');
const igClinicPut = getHandler(instagramRouter, 'put', '/clinics/:clinicId/instagram');
const igClinicDelete = getHandler(instagramRouter, 'delete', '/clinics/:clinicId/instagram/:connectionId');

// ══════════════════════════════════════════════════════════════════════════
async function main() {

section('1. Restricted manager — list scoping');

await test('WhatsApp list includes WA-A, excludes WA-B, no clinic-B leakage', async () => {
  resetFixtures();
  const res = mockResponse();
  await waList(authRequest(restrictedManager, {}), res);
  assert.equal(res.statusCode, 200);
  const ids = res.body.map((c: any) => c.id);
  assert.ok(ids.includes(WA_A));
  assert.ok(!ids.includes(WA_B));
  const waA = res.body.find((c: any) => c.id === WA_A);
  assert.ok(waA.clinics.every((c: any) => c.clinicId !== 'clinic-B'), 'clinic-B must not appear in linked clinics');
});

await test('Instagram list includes IG-A, excludes IG-B, no clinic-B leakage', async () => {
  resetFixtures();
  const res = mockResponse();
  await igList(authRequest(restrictedManager, {}), res);
  assert.equal(res.statusCode, 200);
  const ids = res.body.connections.map((c: any) => c.id);
  assert.ok(ids.includes('ig-a'));
  assert.ok(!ids.includes('ig-b'));
});

await test('OWNER list retains full organization-wide visibility (WA-A and WA-B both present)', async () => {
  resetFixtures();
  const res = mockResponse();
  await waList(authRequest(owner, {}), res);
  assert.equal(res.statusCode, 200);
  const ids = res.body.map((c: any) => c.id);
  assert.ok(ids.includes(WA_A) && ids.includes(WA_B) && ids.includes(WA_UNLINKED));
});

section('2. Restricted manager — detail scoping');

await test('WA-A detail succeeds for restricted manager', async () => {
  resetFixtures();
  const res = mockResponse();
  await waDetail(authRequest(restrictedManager, { id: WA_A }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.id, WA_A);
});

await test('WA-B detail denied for restricted manager (403)', async () => {
  resetFixtures();
  const res = mockResponse();
  await waDetail(authRequest(restrictedManager, { id: WA_B }), res);
  assert.equal(res.statusCode, 403);
});

await test('IG-A detail succeeds, IG-B detail denied for restricted manager', async () => {
  resetFixtures();
  const resA = mockResponse();
  await igDetail(authRequest(restrictedManager, { id: 'ig-a' }), resA);
  assert.equal(resA.statusCode, 200);

  const resB = mockResponse();
  await igDetail(authRequest(restrictedManager, { id: 'ig-b' }), resB);
  assert.equal(resB.statusCode, 403);
});

await test('OWNER retains detail access to WA-B', async () => {
  resetFixtures();
  const res = mockResponse();
  await waDetail(authRequest(owner, { id: WA_B }), res);
  assert.equal(res.statusCode, 200);
});

section('3. Restricted manager — test route: denied before provider call / mutation');

await test('WA-B test denied (403), zero WhatsApp connection mutations', async () => {
  resetFixtures();
  const res = mockResponse();
  await waTest(authRequest(restrictedManager, { id: WA_B }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(waUpdateCalls, 0, 'testWhatsAppConnection (and its status/lastConnectedAt/lastError persist) must never run');
});

await test('WA-A test allowed for restricted manager — authorization passes through to the provider layer (mutation occurs)', async () => {
  resetFixtures();
  const res = mockResponse();
  await waTest(authRequest(restrictedManager, { id: WA_A }), res);
  assert.notEqual(res.statusCode, 403);
  assert.notEqual(res.statusCode, 404);
  assert.equal(waUpdateCalls, 1, 'allowed request must reach testWhatsAppConnection, which always persists an outcome');
});

await test('IG-B test denied (403), zero Instagram connection mutations', async () => {
  resetFixtures();
  const res = mockResponse();
  await igTest(authRequest(restrictedManager, { id: 'ig-b' }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(igUpdateCalls, 0, 'testConnection() and the subsequent status update must never run');
});

await test('IG-A test allowed for restricted manager — reaches provider layer (mutation occurs)', async () => {
  resetFixtures();
  const res = mockResponse();
  await igTest(authRequest(restrictedManager, { id: 'ig-a' }), res);
  assert.notEqual(res.statusCode, 403);
  assert.equal(igUpdateCalls, 1);
});

await test('OWNER retains test access to WA-B (reaches provider layer)', async () => {
  resetFixtures();
  const res = mockResponse();
  await waTest(authRequest(owner, { id: WA_B }), res);
  assert.notEqual(res.statusCode, 403);
  assert.equal(waUpdateCalls, 1);
});

section('4. Restricted manager — readiness / QR');

await test('WA-B readiness denied (403)', async () => {
  resetFixtures();
  const res = mockResponse();
  await waReadiness(authRequest(restrictedManager, { id: WA_B }), res);
  assert.equal(res.statusCode, 403);
});

await test('WA-A readiness succeeds and does not include clinic-B data', async () => {
  resetFixtures();
  // Link wa-a to BOTH clinic-A (accessible) and clinic-B (inaccessible) to prove
  // per-clinic filtering within a single connection's readiness response.
  waLinks.push({ clinicId: 'clinic-B', whatsappConnectionId: WA_A, organizationId: 'org-1', isDefault: false });
  const res = mockResponse();
  await waReadiness(authRequest(restrictedManager, { id: WA_A }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.clinics.every((c: any) => c.id !== 'clinic-B'), 'clinic-B readiness data must not leak even when co-linked to an accessible connection');
});

await test('WA-B QR denied (403), provider QR path never reached (zero mutation side effects)', async () => {
  resetFixtures();
  const res = mockResponse();
  await waQr(authRequest(restrictedManager, { id: WA_B }), res);
  assert.equal(res.statusCode, 403);
});

await test('WA-A QR succeeds for restricted manager (reaches provider layer)', async () => {
  resetFixtures();
  const res = mockResponse();
  await waQr(authRequest(restrictedManager, { id: WA_A }), res);
  assert.notEqual(res.statusCode, 403);
  assert.notEqual(res.statusCode, 404);
});

await test('OWNER retains readiness/QR access to WA-B', async () => {
  resetFixtures();
  const r1 = mockResponse();
  await waReadiness(authRequest(owner, { id: WA_B }), r1);
  assert.equal(r1.statusCode, 200);
  const r2 = mockResponse();
  await waQr(authRequest(owner, { id: WA_B }), r2);
  assert.notEqual(r2.statusCode, 403);
});

section('5. Restricted manager — clinic assignment GET');

await test('Clinic-A WhatsApp/Instagram GET succeeds for restricted manager', async () => {
  resetFixtures();
  const r1 = mockResponse();
  await waClinicGet(authRequest(restrictedManager, { clinicId: 'clinic-A' }), r1);
  assert.equal(r1.statusCode, 200);
  const r2 = mockResponse();
  await igClinicGet(authRequest(restrictedManager, { clinicId: 'clinic-A' }), r2);
  assert.equal(r2.statusCode, 200);
});

await test('Clinic-B WhatsApp/Instagram GET denied (403) for restricted manager', async () => {
  resetFixtures();
  const r1 = mockResponse();
  await waClinicGet(authRequest(restrictedManager, { clinicId: 'clinic-B' }), r1);
  assert.equal(r1.statusCode, 403);
  const r2 = mockResponse();
  await igClinicGet(authRequest(restrictedManager, { clinicId: 'clinic-B' }), r2);
  assert.equal(r2.statusCode, 403);
});

section('6. Restricted manager — reassignment PUT (highest-impact confirmed path)');

await test('Clinic-B WhatsApp PUT denied (403), assignment rows unchanged', async () => {
  resetFixtures();
  const before = waLinks.length;
  const res = mockResponse();
  await waClinicPut(authRequest(restrictedManager, { clinicId: 'clinic-B' }, { whatsappConnectionId: WA_B }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(waLinks.length, before, 'no assignment row should be created/modified');
});

await test('Clinic-B Instagram PUT denied (403), assignment rows unchanged', async () => {
  resetFixtures();
  const before = igLinks.length;
  const res = mockResponse();
  await igClinicPut(authRequest(restrictedManager, { clinicId: 'clinic-B' }, { instagramConnectionId: 'ig-b' }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(igLinks.length, before);
});

await test('Clinic-A cannot be assigned an unlinked, inaccessible-to-caller connection (least-privilege semantics)', async () => {
  resetFixtures();
  const before = waLinks.length;
  const res = mockResponse();
  await waClinicPut(authRequest(restrictedManager, { clinicId: 'clinic-A' }, { whatsappConnectionId: WA_UNLINKED }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(waLinks.length, before, 'wa-unlinked must not become linked via a restricted manager');
});

await test('Clinic-A CAN be assigned a connection already linked to an accessible clinic', async () => {
  resetFixtures();
  const res = mockResponse();
  await waClinicPut(authRequest(restrictedManager, { clinicId: 'clinic-A' }, { whatsappConnectionId: WA_A }), res);
  assert.equal(res.statusCode, 200);
});

await test('OWNER retains full organization-wide assignment capability (can assign wa-unlinked to clinic-A)', async () => {
  resetFixtures();
  const res = mockResponse();
  await waClinicPut(authRequest(owner, { clinicId: 'clinic-A' }, { whatsappConnectionId: WA_UNLINKED }), res);
  assert.equal(res.statusCode, 200);
});

await test('OWNER can still redirect clinic-B to a different connection (regression: pre-existing legitimate capability)', async () => {
  resetFixtures();
  const res = mockResponse();
  await waClinicPut(authRequest(owner, { clinicId: 'clinic-B' }, { whatsappConnectionId: WA_A }), res);
  assert.equal(res.statusCode, 200);
});

section('7. Restricted manager — Instagram DELETE (clinic unassignment)');

await test('Clinic-B Instagram unassignment denied (403), assignment remains unchanged', async () => {
  resetFixtures();
  const before = igLinks.length;
  const res = mockResponse();
  await igClinicDelete(authRequest(restrictedManager, { clinicId: 'clinic-B', connectionId: 'ig-b' }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(igLinks.length, before);
  assert.ok(igLinks.some((l) => l.clinicId === 'clinic-B' && l.instagramConnectionId === 'ig-b'), 'the clinic-B assignment must survive the denied request');
});

await test('OWNER retains Instagram unassignment capability on clinic-B', async () => {
  resetFixtures();
  const res = mockResponse();
  await igClinicDelete(authRequest(owner, { clinicId: 'clinic-B', connectionId: 'ig-b' }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(!igLinks.some((l) => l.clinicId === 'clinic-B' && l.instagramConnectionId === 'ig-b'));
});

section('8. Organization-wide roles — ORG_ADMIN parity with OWNER');

await test('ORG_ADMIN retains list/detail/PUT access across clinic-A and clinic-B', async () => {
  resetFixtures();
  const r1 = mockResponse();
  await waList(authRequest(orgAdmin, {}), r1);
  const ids = r1.body.map((c: any) => c.id);
  assert.ok(ids.includes(WA_A) && ids.includes(WA_B));

  const r2 = mockResponse();
  await waDetail(authRequest(orgAdmin, { id: WA_B }), r2);
  assert.equal(r2.statusCode, 200);

  const r3 = mockResponse();
  await waClinicPut(authRequest(orgAdmin, { clinicId: 'clinic-B' }, { whatsappConnectionId: WA_A }), r3);
  assert.equal(r3.statusCode, 200);
});

section('9. Cross-organization — unchanged denial behavior');

await test('org-2 OWNER cannot read an org-1 connection (404, not 403 — existing behavior unchanged)', async () => {
  resetFixtures();
  const res = mockResponse();
  await waDetail(authRequest(org2Owner, { id: WA_A }), res);
  assert.equal(res.statusCode, 404, 'cross-org must still surface as "not found", exactly as before this fix');
});

await test('org-1 restricted manager cannot read/assign an org-2 clinic or connection', async () => {
  resetFixtures();
  const r1 = mockResponse();
  await waClinicGet(authRequest(restrictedManager, { clinicId: 'clinic-C' }), r1);
  assert.equal(r1.statusCode, 404);

  const r2 = mockResponse();
  await waDetail(authRequest(restrictedManager, { id: WA_ORG2 }), r2);
  assert.equal(r2.statusCode, 404);
});

section('10. Source regression — role matrix and guard placement unchanged/added correctly');

function src(relPath: string) {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}
const waSrc = src('../routes/organizationWhatsApp.ts');
const igSrc = src('../routes/organizationInstagram.ts');

await test('RECEPTIONIST/DENTIST/BILLING remain excluded from every authorize() allow-list in both files (unchanged, no broadening)', () => {
  for (const fileSrc of [waSrc, igSrc]) {
    const authorizeCalls = fileSrc.match(/authorize\(\[[^\]]*\]\)/g) ?? [];
    assert.ok(authorizeCalls.length > 0, 'expected at least one authorize() call');
    for (const call of authorizeCalls) {
      assert.ok(!call.includes('RECEPTIONIST'), `RECEPTIONIST must not appear in ${call}`);
      assert.ok(!call.includes('DENTIST'), `DENTIST must not appear in ${call}`);
      assert.ok(!call.includes('BILLING'), `BILLING must not appear in ${call}`);
    }
  }
});

await test('WhatsApp DELETE /clinics/:clinicId/whatsapp/:connectionId remains OWNER/ORG_ADMIN-only (out of H-2 remediation scope, confirmed unchanged)', () => {
  const start = waSrc.indexOf("'/clinics/:clinicId/whatsapp/:connectionId'");
  assert.ok(start >= 0);
  const block = waSrc.slice(start, start + 300);
  assert.ok(block.includes("authorize(['OWNER', 'ORG_ADMIN'])"), 'this route must stay OWNER/ORG_ADMIN-only, not be broadened to CLINIC_MANAGER');
});

await test('isLinkedToAccessibleClinic is imported (not reimplemented) in both route files', () => {
  assert.ok(waSrc.includes("import { isLinkedToAccessibleClinic } from '../utils/clinicScope.js';"));
  assert.ok(igSrc.includes("import { isLinkedToAccessibleClinic } from '../utils/clinicScope.js';"));
  assert.equal((waSrc.match(/function isLinkedToAccessibleClinic/g) ?? []).length, 0, 'must not redefine the shared helper');
  assert.equal((igSrc.match(/function isLinkedToAccessibleClinic/g) ?? []).length, 0);
});

// ─── Sonuç ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Toplam: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll tests passed.');
}

}

main();
