/**
 * treatmentCasesProposalPdfRoute.test.ts — real-route coverage for
 * GET /treatment-cases/:id/proposal-pdf (independent review blocking finding 4).
 *
 * treatmentProposalPdf.test.ts's route-logic section is a hand-copied simulation
 * (simulateProposalPdfRoute()) — it re-implements the allowed-role list, the
 * accessible-clinic resolution, DENTIST ownership, and response-header logic, so it
 * cannot catch a regression in the real route (e.g. authorize() removed, clinic
 * filtering dropped, the route unregistered/renamed).
 *
 * This suite instead extracts the REAL registered route from the REAL
 * treatmentCasesRouter (server/src/routes/treatmentCases.ts) — same technique as
 * communicationPreferencesRoute.test.ts's getRouteMiddlewareChain()/runChain() and
 * organizationMessagingConnectionScope.test.ts's in-memory prisma delegate swap — and
 * runs its FULL middleware chain (authorize() included, not skipped) against a
 * constructed AuthRequest/mock Response. Only two things are mocked, both at the
 * true I/O boundary:
 *   - prisma.treatmentCase.findFirst / prisma.clinic.findMany (in-memory fakes —
 *     prisma's model delegates are plain writable properties on the shared
 *     singleton, confirmed by the existing test above)
 *   - req.user (authentication itself; this repo has no live JWT/session harness,
 *     same documented constraint as every other route-level test here)
 * Nothing about authorize()'s role list, getAccessibleClinicIds()'s clinic
 * resolution, the DENTIST-ownership check, the MAX_PROPOSAL_PROCEDURES guard, the
 * response headers, or the route path is re-implemented — this is the production
 * code, invoked through Express's real route/middleware stack.
 *
 * This repo has no supertest/live-listening-server pattern anywhere (see
 * publicBookingSlotRequired.test.ts, communicationPreferencesRoute.test.ts); this
 * suite follows the same established in-process router-extraction convention rather
 * than introducing a new HTTP-server test dependency.
 *
 * Run with: npx tsx src/tests/treatmentCasesProposalPdfRoute.test.ts
 *
 * Required real-route cases covered:
 *   1. Authorized OWNER (canAccessAllClinics=true, exercises getAccessibleClinicIds'
 *      prisma.clinic.findMany branch) → 200
 *   1b. Authorized CLINIC_MANAGER (canAccessAllClinics=false, allowedClinicIds branch) → 200
 *   2. %PDF body
 *   3. All required response headers
 *   4. Inaccessible cross-clinic case → safe 404 (never leaks existence)
 *   5. Unauthorized role (BILLING) → rejected by the real authorize() middleware
 *   6. DENTIST own case → 200
 *   7. DENTIST non-owned case → 403 Forbidden
 *   8. Missing/unknown case id → 404
 *   9. Unexpected failure inside the try block (malformed upstream data reaching the
 *      real generation path) → safe generic 500
 *  10. The 500 response body contains no patient PII or internal path
 *  Plus: route-registration / authorize()-presence smoke checks (see below) — if the
 *  route path changes, is left unregistered, or authorize() is removed, extracting
 *  the chain itself fails and every test in this file fails with it.
 */

import assert from 'node:assert/strict';
import prisma from '../db.js';
import treatmentCasesRouter from '../routes/treatmentCases.js';
import { MAX_PROPOSAL_PROCEDURES } from '../services/treatmentProposalPdf.js';
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

// ─── Extract the REAL full middleware chain (authorize() + handler) ────────────
// Unlike getRouteHandler() patterns elsewhere in this repo that deliberately skip
// authorize() to unit-test handler logic in isolation, this runs the WHOLE chain —
// the point of this suite is to prove authorize() itself is still wired up.

type RouterLike = { stack: Array<any> };

function getRouteMiddlewareChain(
  router: RouterLike,
  method: 'get' | 'post' | 'put' | 'delete',
  path: string,
): Array<(req: AuthRequest, res: Response, next: () => void) => void | Promise<void>> {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods?.[method]) {
      return layer.route.stack.map((s: any) => s.handle);
    }
  }
  throw new Error(`No route handler found for ${method.toUpperCase()} ${path}`);
}

async function runChain(
  chain: Array<(req: AuthRequest, res: Response, next: () => void) => void | Promise<void>>,
  req: AuthRequest,
  res: Response,
): Promise<void> {
  for (const fn of chain) {
    let calledNext = false;
    await fn(req, res, () => { calledNext = true; });
    if (!calledNext) return; // middleware responded instead of calling next() — chain stops here
  }
}

const ROUTE_PATH = '/treatment-cases/:id/proposal-pdf';
// Extracted once, at module load, so a route-path rename or unregistered route fails
// the whole suite immediately and loudly rather than as a confusing per-test 404.
const proposalPdfChain = getRouteMiddlewareChain(treatmentCasesRouter as unknown as RouterLike, 'get', ROUTE_PATH);

function mockResponse(): Response & { statusCode: number; body: any; headers: Record<string, string> } {
  const res: any = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; return this; },
    send(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

function authRequest(user: NonNullable<AuthRequest['user']> | undefined, params: Record<string, string>): AuthRequest {
  return { params, query: {}, headers: {}, user } as unknown as AuthRequest;
}

function makeUser(overrides: Partial<NonNullable<AuthRequest['user']>>): NonNullable<AuthRequest['user']> {
  return {
    id: 'user-1',
    clinicId: 'clinic-A',
    role: 'owner',
    normalizedRole: 'OWNER',
    organizationId: 'org-1',
    allowedClinicIds: ['clinic-A'],
    canAccessAllClinics: false,
    ...overrides,
  } as NonNullable<AuthRequest['user']>;
}

// ─── In-memory Prisma mock — the only I/O boundary swapped out ─────────────────
// prisma's model delegates are plain writable properties on the shared singleton
// (same technique/verification as organizationMessagingConnectionScope.test.ts).

type MockCase = {
  id: string;
  clinicId: string;
  practitionerId: string | null;
  title: string;
  stage: string;
  currency: string;
  estimatedAmount: number | null;
  acceptedAmount: number | null;
  patient: { firstName: string; lastName: string } | null;
  practitioner: { firstName: string; lastName: string } | null;
  clinic: { name: string; address: string | null; phone: string | null; currency: string; defaultLanguage: string };
  procedures: Array<{ toothFdi: number | null; procedureName: string; status: string; estimatedCost: number | null }>;
};

let clinics: { id: string; organizationId: string }[] = [];
let cases: MockCase[] = [];

(prisma as any).clinic = {
  findMany: async ({ where }: any) =>
    clinics.filter((c) => c.organizationId === where.organizationId).map((c) => ({ id: c.id })),
};

(prisma as any).treatmentCase = {
  findFirst: async ({ where, include }: any) => {
    const accessibleIds: string[] = where.clinicId.in;
    const tc = cases.find((c) => c.id === where.id && accessibleIds.includes(c.clinicId));
    if (!tc) return null;
    // Mirrors the route's real query shape: honor whatever procedures.where the route
    // actually asks for, rather than hardcoding "cancelled excluded" here — if the route
    // regresses and stops requesting the filter, this mock stops applying it too.
    const procWhere = include?.procedures?.where;
    const excludedStatus = procWhere?.status?.not;
    const procedures = excludedStatus ? tc.procedures.filter((p) => p.status !== excludedStatus) : tc.procedures;
    return { ...tc, procedures };
  },
};

const CLINIC_A = {
  name: 'Clinic A', address: '1 Main St', phone: '555-0100', currency: 'USD', defaultLanguage: 'en',
};
const CLINIC_B = {
  name: 'Clinic B', address: null, phone: null, currency: 'USD', defaultLanguage: 'en',
};

function resetDb() {
  clinics = [
    { id: 'clinic-A', organizationId: 'org-1' },
    { id: 'clinic-B', organizationId: 'org-1' },
  ];
  cases = [
    {
      id: 'tc-A-1',
      clinicId: 'clinic-A',
      practitionerId: 'dentist-1',
      title: 'Implant plan',
      stage: 'quote_sent',
      currency: 'USD',
      estimatedAmount: 1000,
      acceptedAmount: null,
      patient: { firstName: 'Jane', lastName: 'Doe' },
      practitioner: { firstName: 'Alice', lastName: 'Dentist' },
      clinic: CLINIC_A,
      procedures: [
        { toothFdi: 11, procedureName: 'Implant', status: 'planned', estimatedCost: 1200 },
        { toothFdi: 12, procedureName: 'Declined extraction', status: 'cancelled', estimatedCost: 9999 },
      ],
    },
    {
      id: 'tc-B-1',
      clinicId: 'clinic-B',
      practitionerId: null,
      title: 'Other clinic case',
      stage: 'new',
      currency: 'USD',
      estimatedAmount: null,
      acceptedAmount: null,
      patient: { firstName: 'John', lastName: 'Smith' },
      practitioner: null,
      clinic: CLINIC_B,
      procedures: [],
    },
    {
      id: 'tc-A-broken',
      clinicId: 'clinic-A',
      practitionerId: null,
      title: 'Malformed case (forces an unexpected failure)',
      stage: 'new',
      currency: 'USD',
      estimatedAmount: null,
      acceptedAmount: null,
      // `patient: null` reaches the real route's `${tc.patient.firstName} ...` access inside
      // the try block, forcing a genuine unexpected TypeError — the safest reproducible way to
      // exercise the real catch/safeErrorFields/500 path without mocking the PDF generator
      // itself (which would defeat the point of testing the real generation path).
      patient: null,
      practitioner: null,
      clinic: CLINIC_A,
      procedures: [],
    },
  ];
}

section('=== Route registration / authorize() presence ===');

await test('the real route is registered at the documented path and its chain includes more than just the handler (authorize() is present)', () => {
  assert.ok(proposalPdfChain.length >= 2, 'expected at least [authorize(), handler] in the route stack');
});

section('=== GET /treatment-cases/:id/proposal-pdf — real router + real authorize() ===');

await test('authorized OWNER (canAccessAllClinics=true, exercises getAccessibleClinicIds() DB branch) → 200, %PDF body, all required headers', async () => {
  resetDb();
  const user = makeUser({ id: 'owner-1', role: 'owner', normalizedRole: 'OWNER', organizationId: 'org-1', canAccessAllClinics: true, allowedClinicIds: [] });
  const req = authRequest(user, { id: 'tc-A-1' });
  const res = mockResponse();
  await runChain(proposalPdfChain, req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.match(res.headers['Content-Disposition'], /^attachment; filename="[a-zA-Z0-9._-]+\.pdf"$/);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  const body = res.body as Buffer;
  assert.ok(Buffer.isBuffer(body) && body.length > 0);
  assert.equal(body.subarray(0, 4).toString('ascii'), '%PDF');
});

await test('authorized CLINIC_MANAGER (canAccessAllClinics=false, allowedClinicIds branch) → 200', async () => {
  resetDb();
  const user = makeUser({ id: 'mgr-1', role: 'clinic_manager', normalizedRole: 'CLINIC_MANAGER', canAccessAllClinics: false, allowedClinicIds: ['clinic-A'] });
  const req = authRequest(user, { id: 'tc-A-1' });
  const res = mockResponse();
  await runChain(proposalPdfChain, req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/pdf');
});

await test('a cross-clinic case (not in the user\'s accessible clinics) → safe 404, never leaks existence', async () => {
  resetDb();
  const user = makeUser({ id: 'owner-1', canAccessAllClinics: false, allowedClinicIds: ['clinic-A'] });
  const req = authRequest(user, { id: 'tc-B-1' }); // real case, but in clinic-B
  const res = mockResponse();
  await runChain(proposalPdfChain, req, res);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'Treatment case not found' });
});

await test('unauthorized role (BILLING) is rejected by the real authorize() middleware, handler never runs', async () => {
  resetDb();
  const user = makeUser({ id: 'billing-1', role: 'billing', normalizedRole: 'BILLING', allowedClinicIds: ['clinic-A'] });
  const req = authRequest(user, { id: 'tc-A-1' });
  const res = mockResponse();
  await runChain(proposalPdfChain, req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.error, 'Forbidden: Insufficient permissions');
});

await test('DENTIST assigned to the case → 200', async () => {
  resetDb();
  const user = makeUser({ id: 'dentist-1', role: 'doctor', normalizedRole: 'DENTIST', allowedClinicIds: ['clinic-A'] });
  const req = authRequest(user, { id: 'tc-A-1' }); // tc-A-1.practitionerId === 'dentist-1'
  const res = mockResponse();
  await runChain(proposalPdfChain, req, res);

  assert.equal(res.statusCode, 200);
});

await test('DENTIST NOT assigned to the case → 403 Forbidden', async () => {
  resetDb();
  const user = makeUser({ id: 'dentist-2', role: 'doctor', normalizedRole: 'DENTIST', allowedClinicIds: ['clinic-A'] });
  const req = authRequest(user, { id: 'tc-A-1' }); // owned by dentist-1, not dentist-2
  const res = mockResponse();
  await runChain(proposalPdfChain, req, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Forbidden' });
});

await test('missing/unknown treatment case id → canonical safe 404', async () => {
  resetDb();
  const user = makeUser({ id: 'owner-1', canAccessAllClinics: false, allowedClinicIds: ['clinic-A'] });
  const req = authRequest(user, { id: 'tc-does-not-exist' });
  const res = mockResponse();
  await runChain(proposalPdfChain, req, res);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'Treatment case not found' });
});

await test('too many procedures (> MAX_PROPOSAL_PROCEDURES) → 400, not a crash', async () => {
  resetDb();
  cases.push({
    id: 'tc-A-toomany',
    clinicId: 'clinic-A',
    practitionerId: null,
    title: 'Huge case',
    stage: 'new',
    currency: 'USD',
    estimatedAmount: null,
    acceptedAmount: null,
    patient: { firstName: 'Big', lastName: 'Case' },
    practitioner: null,
    clinic: CLINIC_A,
    procedures: Array.from({ length: MAX_PROPOSAL_PROCEDURES + 1 }, (_, i) => ({
      toothFdi: null, procedureName: `Procedure ${i}`, status: 'planned', estimatedCost: 10,
    })),
  });
  const user = makeUser({ id: 'owner-1', canAccessAllClinics: false, allowedClinicIds: ['clinic-A'] });
  const req = authRequest(user, { id: 'tc-A-toomany' });
  const res = mockResponse();
  await runChain(proposalPdfChain, req, res);

  assert.equal(res.statusCode, 400);
});

await test('an unexpected failure inside the real generation path → safe generic 500, no patient PII or internal path leaked', async () => {
  resetDb();
  const user = makeUser({ id: 'owner-1', canAccessAllClinics: false, allowedClinicIds: ['clinic-A'] });
  const req = authRequest(user, { id: 'tc-A-broken' }); // patient: null forces a real thrown error
  const res = mockResponse();
  await runChain(proposalPdfChain, req, res);

  assert.equal(res.statusCode, 500);
  const bodyText = JSON.stringify(res.body);
  assert.equal(bodyText, JSON.stringify({ error: 'Failed to generate proposal PDF' }));
  assert.ok(!bodyText.toLowerCase().includes('jane'), 'must not leak a patient name');
  assert.ok(!bodyText.toLowerCase().includes('typeerror'), 'must not leak the raw error type');
  assert.ok(!bodyText.includes('/') && !bodyText.includes('\\'), 'must not leak an internal file path');
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`Toplam: ${passed + failed} test | Geçen: ${passed} | Başarısız: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız!`);
  process.exit(1);
} else {
  console.log('\nTüm gerçek route testleri geçti!');
}
