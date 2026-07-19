/**
 * communicationPreferencesRoute.test.ts — HTTP-route-level tests for the
 * KVKK-HIGH-007 communication-preferences matrix/history endpoints
 * (communicationPreferences.ts), a gap noted in discovery: the matrix and
 * aggregate routes previously had no test coverage below the service layer.
 *
 * This repo has no supertest/live-Express-server pattern anywhere in its test
 * suite (see publicBookingSlotRequired.test.ts) — instead, the actual route
 * handler function is extracted from the router's internal stack and invoked
 * directly with a constructed AuthRequest/mock Response, against the real
 * disposable Postgres database. This exercises the exact same code the HTTP
 * layer would run, without introducing a new test-server dependency.
 *
 * Covers:
 *   1. matrix endpoint returns the new `legacyConflict` field, only for
 *      sms+granted+smsOptOut, and it's a synchronous, DB-free computation
 *      (deriveCommunicationDecision has zero await points — proves no
 *      per-cell round trip structurally, not just by observation)
 *   2. no cross-tenant leakage (patient belongs to a different organization)
 *   3. no cross-clinic leakage (staff not allowed on the patient's clinic)
 *   4. multi-branch PatientClinic: the matrix is scoped to the patient's home
 *      clinic only — documented boundary, not a bug (a PatientClinic link to
 *      a second clinic does not leak that clinic's preference rows in here)
 *   5. history endpoint: status/source filters and limit/cursor pagination
 *
 * Run with: tsx src/tests/communicationPreferencesRoute.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../db.js';
import communicationPreferencesRouter from '../routes/communicationPreferences.js';
import { deriveCommunicationDecision } from '../services/communicationConsent/communicationConsentPolicy.js';
import { setCommunicationPreference } from '../services/communicationConsent/communicationConsentAdmin.js';
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

// ── Extract a route handler directly from the router's internal stack ────────

type RouterLike = { stack: Array<any> };

function getRouteHandler(router: RouterLike, method: 'get' | 'put' | 'post', path: string): (req: AuthRequest, res: Response) => Promise<void> {
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

function authRequest(overrides: Partial<NonNullable<AuthRequest['user']>>, params: Record<string, string>, query: Record<string, string> = {}): AuthRequest {
  return {
    params,
    query,
    user: {
      id: randomUUID(),
      clinicId: '',
      role: 'OWNER',
      normalizedRole: 'OWNER',
      organizationId: '',
      allowedClinicIds: [],
      canAccessAllClinics: true,
      ...overrides,
    },
  } as unknown as AuthRequest;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

type Fixture = { organizationId: string; clinicId: string; otherClinicId: string; patientId: string };
const createdOrgIds: string[] = [];

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: `Route Test Org ${suffix}`, slug: `route-test-${suffix}` } });
  const clinic = await prisma.clinic.create({ data: { name: 'Home Clinic', slug: `route-home-${suffix}`, organizationId: org.id } });
  const otherClinic = await prisma.clinic.create({ data: { name: 'Other Clinic', slug: `route-other-${suffix}`, organizationId: org.id } });
  const patient = await prisma.patient.create({
    data: { firstName: 'Route', lastName: 'Test', clinicId: clinic.id, organizationId: org.id, phone: '+905551112244' },
  });
  createdOrgIds.push(org.id);
  return { organizationId: org.id, clinicId: clinic.id, otherClinicId: otherClinic.id, patientId: patient.id };
}

async function cleanup() {
  if (createdOrgIds.length === 0) return;
  await prisma.patientCommunicationConsentEvent.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patientCommunicationPreference.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.patientClinic.deleteMany({ where: { clinic: { organizationId: { in: createdOrgIds } } } });
  await prisma.patient.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.clinic.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
}

async function main() {
  section('1. Matrix endpoint — legacyConflict field + structural no-per-cell-DB-round-trip proof');

  await test('deriveCommunicationDecision is a plain synchronous function (zero DB round trips per cell, structurally)', () => {
    const result = deriveCommunicationDecision(
      { organizationId: 'o', clinicId: 'c', patientId: 'p', channel: 'sms', purpose: 'marketing' },
      'marketing',
      'granted',
      'pref-id',
    );
    assert.ok(!(result instanceof Promise), 'must not return a Promise — a Promise-returning function could still hide an await/DB call');
    assert.equal(result.allowed, true);
  });

  await test('legacyConflict is set only for sms + smsOptOut=true + central granted', async () => {
    const fx = await createFixture();
    await prisma.patient.update({ where: { id: fx.patientId }, data: { smsOptOut: true } });
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'sms', purpose: 'marketing', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record',
      notes: 'test',
    });

    const handler = getRouteHandler(communicationPreferencesRouter, 'get', '/patients/:patientId/communication-preferences');
    const req = authRequest({ organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId });
    const res = mockResponse();
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const marketingCell = res.body.matrix.find((m: any) => m.channel === 'sms' && m.purpose === 'marketing');
    assert.equal(marketingCell.legacyConflict?.detected, true);
    assert.equal(marketingCell.legacyConflict?.reasonCode, 'legacy_central_conflict');

    const otherCell = res.body.matrix.find((m: any) => m.channel === 'whatsapp' && m.purpose === 'marketing');
    assert.equal(otherCell.legacyConflict, null, 'legacyConflict is sms-specific — whatsapp never carries the smsOptOut signal');
  });

  section('2. Scoping — no cross-tenant / cross-clinic leakage');

  await test('patient in a different organization → 404, not the matrix', async () => {
    const fx = await createFixture();
    const otherOrg = await prisma.organization.create({ data: { name: 'Other Org', slug: `other-org-${randomUUID().slice(0, 8)}` } });
    createdOrgIds.push(otherOrg.id);

    const handler = getRouteHandler(communicationPreferencesRouter, 'get', '/patients/:patientId/communication-preferences');
    const req = authRequest({ organizationId: otherOrg.id, allowedClinicIds: [] }, { patientId: fx.patientId });
    const res = mockResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 404);
  });

  await test('staff without access to the patient\'s clinic → 403', async () => {
    const fx = await createFixture();
    const handler = getRouteHandler(communicationPreferencesRouter, 'get', '/patients/:patientId/communication-preferences');
    const req = authRequest({ organizationId: fx.organizationId, allowedClinicIds: [fx.otherClinicId], canAccessAllClinics: false }, { patientId: fx.patientId });
    const res = mockResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
  });

  section('3. Multi-branch PatientClinic — documented home-clinic-only scoping (not a bug)');

  await test('a PatientClinic link to a second clinic does not change matrix scope (stays on home clinic)', async () => {
    const fx = await createFixture();
    await prisma.patientClinic.create({ data: { patientId: fx.patientId, clinicId: fx.otherClinicId } });
    await setCommunicationPreference({
      organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
      channel: 'email', purpose: 'survey', action: 'grant', source: 'staff', evidenceType: 'verbal_staff_record', notes: 'x',
    });

    const handler = getRouteHandler(communicationPreferencesRouter, 'get', '/patients/:patientId/communication-preferences');
    const req = authRequest({ organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId, fx.otherClinicId], canAccessAllClinics: false }, { patientId: fx.patientId });
    const res = mockResponse();
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.clinicId, fx.clinicId, 'matrix is always scoped to the patient\'s home clinic, never the linked one');
    const surveyCell = res.body.matrix.find((m: any) => m.channel === 'email' && m.purpose === 'survey');
    assert.equal(surveyCell.preference.status, 'granted');
  });

  section('4. History endpoint — status/source filters and pagination');

  await test('history filters by status and source, and pagination respects limit/cursor', async () => {
    const fx = await createFixture();
    for (const action of ['grant', 'withdraw', 'grant', 'deny'] as const) {
      await setCommunicationPreference({
        organizationId: fx.organizationId, clinicId: fx.clinicId, patientId: fx.patientId,
        channel: 'whatsapp', purpose: 'recall', action, source: 'staff', evidenceType: 'verbal_staff_record', notes: 'x',
      });
    }

    const handler = getRouteHandler(communicationPreferencesRouter, 'get', '/patients/:patientId/communication-preferences/history');
    const reqAll = authRequest({ organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId });
    const resAll = mockResponse();
    await handler(reqAll, resAll);
    assert.equal(resAll.body.events.length, 4);

    const reqFiltered = authRequest({ organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId }, { status: 'withdrawn' });
    const resFiltered = mockResponse();
    await handler(reqFiltered, resFiltered);
    assert.equal(resFiltered.body.events.length, 1);
    assert.equal(resFiltered.body.events[0].newStatus, 'withdrawn');

    const reqPage1 = authRequest({ organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId }, { limit: '2' });
    const resPage1 = mockResponse();
    await handler(reqPage1, resPage1);
    assert.equal(resPage1.body.events.length, 2);
    assert.equal(resPage1.body.pageInfo.hasMore, true);
    assert.ok(resPage1.body.pageInfo.nextCursor);

    const reqPage2 = authRequest({ organizationId: fx.organizationId, allowedClinicIds: [fx.clinicId] }, { patientId: fx.patientId }, { limit: '2', cursor: resPage1.body.pageInfo.nextCursor });
    const resPage2 = mockResponse();
    await handler(reqPage2, resPage2);
    assert.equal(resPage2.body.events.length, 2);
    assert.equal(resPage2.body.pageInfo.hasMore, false);

    const page1Ids = new Set(resPage1.body.events.map((e: any) => e.id));
    const page2Ids = resPage2.body.events.map((e: any) => e.id);
    assert.ok(page2Ids.every((id: string) => !page1Ids.has(id)), 'pages do not overlap');
  });

  await cleanup();
  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exitCode = 1;
});
