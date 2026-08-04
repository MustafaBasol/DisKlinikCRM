/**
 * instagramInboxStatusClinicScope.test.ts — F2-SEC-001 HTTP-route-level test
 * for PATCH /api/instagram/inbox/:id/status.
 *
 * Follows this repo's established convention (see paymentsListFieldScope.test.ts,
 * communicationPreferencesRoute.test.ts): no supertest/live-Express-server —
 * the route's own middleware chain is extracted from the router's internal
 * stack and invoked directly against a constructed AuthRequest/mock Response,
 * over the real disposable Postgres database. The real `authenticate`
 * middleware (JWT/cookie verification) is intentionally excluded from the
 * extracted chain — it is pure role/session plumbing unrelated to this fix
 * and has no established supertest-style harness anywhere in this repo (see
 * organizationMessagingConnectionScope.test.ts, which documents the same
 * exclusion for the same reason). `authorize()` IS kept in the chain and
 * exercised for real.
 *
 * Context: the handler previously scoped its `findFirst` lookup and its
 * `update` write only by `organizationId` — never by clinic membership. Any
 * authenticated, role-authorized user anywhere in the organization could
 * mutate (and receive back the full unredacted contents of) an Instagram
 * inbox entry belonging to a clinic they have no membership in. Fix: embed
 * the caller's accessible-clinic scope directly in the `updateMany` write
 * predicate, so a same-org/wrong-clinic entry and a genuinely nonexistent one
 * both collapse to the identical 404 (fail-closed, no existence/ownership
 * leak).
 *
 * Run with: tsx src/tests/instagramInboxStatusClinicScope.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../db.js';
import instagramInboxRouter from '../routes/instagramInbox.js';
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
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ── Extract the route's authorize()+handler chain (authenticate excluded — see header) ──

type RouterLike = { stack: Array<any> };

function getRouteMiddlewareChain(router: RouterLike, method: 'get' | 'post' | 'put' | 'patch', path: string): Array<(req: AuthRequest, res: Response, next: () => void) => void | Promise<void>> {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods?.[method]) {
      // Drop the first middleware (`authenticate`) — real JWT/cookie
      // verification has no supertest-style harness in this repo; only
      // `authorize()` + the handler are exercised (see file header).
      return layer.route.stack.slice(1).map((s: any) => s.handle);
    }
  }
  throw new Error(`No route handler found for ${method.toUpperCase()} ${path}`);
}

async function runChain(chain: Array<(req: AuthRequest, res: Response, next: () => void) => void | Promise<void>>, req: AuthRequest, res: Response): Promise<void> {
  for (const fn of chain) {
    let calledNext = false;
    await fn(req, res, () => { calledNext = true; });
    if (!calledNext) return;
  }
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

function authRequest(overrides: Partial<NonNullable<AuthRequest['user']>>, body: Record<string, unknown> = {}): AuthRequest {
  return {
    params: { id: '' },
    query: {},
    body,
    headers: {},
    user: {
      id: randomUUID(),
      clinicId: '',
      role: 'CLINIC_MANAGER',
      normalizedRole: 'CLINIC_MANAGER',
      organizationId: '',
      allowedClinicIds: [],
      canAccessAllClinics: false,
      ...overrides,
    },
  } as unknown as AuthRequest;
}

function patchChain() {
  return getRouteMiddlewareChain(instagramInboxRouter, 'patch', '/instagram/inbox/:id/status');
}

async function callPatchStatus(entryId: string, status: string, userOverrides: Partial<NonNullable<AuthRequest['user']>>, extraBody: Record<string, unknown> = {}) {
  const chain = patchChain();
  const req = authRequest(userOverrides, { status, ...extraBody });
  (req.params as any).id = entryId;
  const res = mockResponse();
  await runChain(chain, req, res);
  return res;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

type Fixture = {
  orgAId: string;
  clinicA1Id: string;
  clinicA2Id: string;
  orgBId: string;
  clinicB1Id: string;
  entryA1Id: string;
  entryA2Id: string;
  entryB1Id: string;
};

const createdOrgIds: string[] = [];

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);

  const orgA = await prisma.organization.create({ data: { name: `SEC001 Org A ${suffix}`, slug: `sec001-org-a-${suffix}` } });
  const clinicA1 = await prisma.clinic.create({ data: { name: 'Clinic A1', slug: `sec001-clinic-a1-${suffix}`, organizationId: orgA.id } });
  const clinicA2 = await prisma.clinic.create({ data: { name: 'Clinic A2', slug: `sec001-clinic-a2-${suffix}`, organizationId: orgA.id } });

  const orgB = await prisma.organization.create({ data: { name: `SEC001 Org B ${suffix}`, slug: `sec001-org-b-${suffix}` } });
  const clinicB1 = await prisma.clinic.create({ data: { name: 'Clinic B1', slug: `sec001-clinic-b1-${suffix}`, organizationId: orgB.id } });

  const entryA1 = await prisma.instagramInboxEntry.create({
    data: { organizationId: orgA.id, clinicId: clinicA1.id, externalSenderId: `igsid-a1-${suffix}`, senderUsername: 'a1_sender', status: 'open' },
  });
  const entryA2 = await prisma.instagramInboxEntry.create({
    data: { organizationId: orgA.id, clinicId: clinicA2.id, externalSenderId: `igsid-a2-${suffix}`, senderUsername: 'a2_sender', status: 'open' },
  });
  const entryB1 = await prisma.instagramInboxEntry.create({
    data: { organizationId: orgB.id, clinicId: clinicB1.id, externalSenderId: `igsid-b1-${suffix}`, senderUsername: 'b1_sender', status: 'open' },
  });

  createdOrgIds.push(orgA.id, orgB.id);

  return {
    orgAId: orgA.id,
    clinicA1Id: clinicA1.id,
    clinicA2Id: clinicA2.id,
    orgBId: orgB.id,
    clinicB1Id: clinicB1.id,
    entryA1Id: entryA1.id,
    entryA2Id: entryA2.id,
    entryB1Id: entryB1.id,
  };
}

async function cleanup() {
  if (createdOrgIds.length === 0) return;
  await prisma.instagramInboxEntry.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.clinic.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
}

async function statusOf(entryId: string): Promise<string> {
  const row = await prisma.instagramInboxEntry.findUniqueOrThrow({ where: { id: entryId }, select: { status: true } });
  return row.status;
}

async function main() {
  section('1. Authorized same-clinic mutation succeeds');

  await test('U1 (allowedClinicIds=[A1]) can mutate entryA1 (same clinic)', async () => {
    const fx = await createFixture();
    const res = await callPatchStatus(fx.entryA1Id, 'resolved', {
      role: 'CLINIC_MANAGER', normalizedRole: 'CLINIC_MANAGER',
      organizationId: fx.orgAId, allowedClinicIds: [fx.clinicA1Id], canAccessAllClinics: false,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body?.entry?.id, fx.entryA1Id);
    assert.equal(res.body?.entry?.status, 'resolved');
    assert.equal(await statusOf(fx.entryA1Id), 'resolved');
  });

  section('2. Multi-clinic user may mutate records in each accessible clinic');

  await test('U2 (allowedClinicIds=[A1,A2]) can mutate entryA1', async () => {
    const fx = await createFixture();
    const res = await callPatchStatus(fx.entryA1Id, 'ignored', {
      role: 'CLINIC_MANAGER', normalizedRole: 'CLINIC_MANAGER',
      organizationId: fx.orgAId, allowedClinicIds: [fx.clinicA1Id, fx.clinicA2Id], canAccessAllClinics: false,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(await statusOf(fx.entryA1Id), 'ignored');
  });

  await test('U2 (allowedClinicIds=[A1,A2]) can also mutate entryA2', async () => {
    const fx = await createFixture();
    const res = await callPatchStatus(fx.entryA2Id, 'ignored', {
      role: 'CLINIC_MANAGER', normalizedRole: 'CLINIC_MANAGER',
      organizationId: fx.orgAId, allowedClinicIds: [fx.clinicA1Id, fx.clinicA2Id], canAccessAllClinics: false,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(await statusOf(fx.entryA2Id), 'ignored');
  });

  section('3. Same-org, different-clinic denial (the core defect)');

  await test('U1 (allowedClinicIds=[A1]) cannot mutate entryA2 (same org, different clinic)', async () => {
    const fx = await createFixture();
    const res = await callPatchStatus(fx.entryA2Id, 'resolved', {
      role: 'CLINIC_MANAGER', normalizedRole: 'CLINIC_MANAGER',
      organizationId: fx.orgAId, allowedClinicIds: [fx.clinicA1Id], canAccessAllClinics: false,
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body?.error, 'Entry not found');
    assert.equal(await statusOf(fx.entryA2Id), 'open', 'target record must be unchanged after a rejected attempt');
  });

  await test('U1 (RECEPTIONIST, allowedClinicIds=[A1]) cannot mutate entryA2 either', async () => {
    const fx = await createFixture();
    const res = await callPatchStatus(fx.entryA2Id, 'resolved', {
      role: 'RECEPTIONIST', normalizedRole: 'RECEPTIONIST',
      organizationId: fx.orgAId, allowedClinicIds: [fx.clinicA1Id], canAccessAllClinics: false,
    });
    assert.equal(res.statusCode, 404);
    assert.equal(await statusOf(fx.entryA2Id), 'open');
  });

  section('4. Cross-organization denial');

  await test('Org A user cannot mutate entryB1 (Organization B)', async () => {
    const fx = await createFixture();
    const res = await callPatchStatus(fx.entryB1Id, 'resolved', {
      role: 'OWNER', normalizedRole: 'OWNER',
      organizationId: fx.orgAId, allowedClinicIds: [], canAccessAllClinics: true,
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body?.error, 'Entry not found');
    assert.equal(await statusOf(fx.entryB1Id), 'open');
  });

  section('5. Non-enumeration — nonexistent / cross-org / same-org-wrong-clinic are identical');

  await test('nonexistent id, cross-org id, and same-org-wrong-clinic id all return the same 404 shape', async () => {
    const fx = await createFixture();
    const user = { role: 'CLINIC_MANAGER', normalizedRole: 'CLINIC_MANAGER', organizationId: fx.orgAId, allowedClinicIds: [fx.clinicA1Id], canAccessAllClinics: false };

    const resMissing = await callPatchStatus(randomUUID(), 'resolved', user);
    const resCrossOrg = await callPatchStatus(fx.entryB1Id, 'resolved', user);
    const resWrongClinic = await callPatchStatus(fx.entryA2Id, 'resolved', user);

    assert.equal(resMissing.statusCode, 404);
    assert.equal(resCrossOrg.statusCode, 404);
    assert.equal(resWrongClinic.statusCode, 404);
    assert.deepEqual(resMissing.body, resCrossOrg.body);
    assert.deepEqual(resMissing.body, resWrongClinic.body);
  });

  section('6. Client-supplied clinicId does not override actual membership');

  await test('a clinicId field in the request body is ignored — U1 still denied on entryA2', async () => {
    const fx = await createFixture();
    const res = await callPatchStatus(fx.entryA2Id, 'resolved', {
      role: 'CLINIC_MANAGER', normalizedRole: 'CLINIC_MANAGER',
      organizationId: fx.orgAId, allowedClinicIds: [fx.clinicA1Id], canAccessAllClinics: false,
    }, { clinicId: fx.clinicA1Id });
    assert.equal(res.statusCode, 404);
    assert.equal(await statusOf(fx.entryA2Id), 'open');
  });

  section('7. Default/session clinicId cannot substitute for actual target-clinic access');

  await test('user.clinicId (session default) pointing at A2 does not grant access when allowedClinicIds excludes A2', async () => {
    const fx = await createFixture();
    const res = await callPatchStatus(fx.entryA2Id, 'resolved', {
      role: 'CLINIC_MANAGER', normalizedRole: 'CLINIC_MANAGER',
      organizationId: fx.orgAId, clinicId: fx.clinicA2Id, allowedClinicIds: [fx.clinicA1Id], canAccessAllClinics: false,
    });
    assert.equal(res.statusCode, 404);
    assert.equal(await statusOf(fx.entryA2Id), 'open');
  });

  section('8. No unrelated record is modified by a rejected attempt');

  await test('rejecting a mutation on entryA2 leaves entryA1 and entryB1 untouched', async () => {
    const fx = await createFixture();
    await callPatchStatus(fx.entryA2Id, 'resolved', {
      role: 'CLINIC_MANAGER', normalizedRole: 'CLINIC_MANAGER',
      organizationId: fx.orgAId, allowedClinicIds: [fx.clinicA1Id], canAccessAllClinics: false,
    });
    assert.equal(await statusOf(fx.entryA1Id), 'open');
    assert.equal(await statusOf(fx.entryB1Id), 'open');
  });

  section('9. Role preservation — existing allowed/denied roles unchanged');

  await test('OWNER (canAccessAllClinics) can mutate any clinic in its own org', async () => {
    const fx = await createFixture();
    const res = await callPatchStatus(fx.entryA2Id, 'resolved', {
      role: 'OWNER', normalizedRole: 'OWNER', organizationId: fx.orgAId, allowedClinicIds: [], canAccessAllClinics: true,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(await statusOf(fx.entryA2Id), 'resolved');
  });

  await test('legacy raw role "doctor" (allowed by authorize()) can mutate its own clinic\'s entry', async () => {
    const fx = await createFixture();
    const res = await callPatchStatus(fx.entryA1Id, 'converted', {
      role: 'doctor', normalizedRole: 'DENTIST', organizationId: fx.orgAId, allowedClinicIds: [fx.clinicA1Id], canAccessAllClinics: false,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(await statusOf(fx.entryA1Id), 'converted');
  });

  await test('BILLING (not in the authorize() allow-list) remains denied — 403 from authorize(), before any clinic check', async () => {
    const fx = await createFixture();
    const res = await callPatchStatus(fx.entryA1Id, 'resolved', {
      role: 'BILLING', normalizedRole: 'BILLING', organizationId: fx.orgAId, allowedClinicIds: [fx.clinicA1Id], canAccessAllClinics: false,
    });
    assert.equal(res.statusCode, 403);
    assert.equal(await statusOf(fx.entryA1Id), 'open');
  });

  await cleanup();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
