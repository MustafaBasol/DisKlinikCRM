/**
 * treatmentCaseSearchScope.test.ts — real-route regression coverage for
 * GET /treatment-cases?search= (UX-001-PROD-SMOKE-R2, finding 2).
 *
 * Production symptom: a DENTIST searching Ctrl+K for "mustafa" received an
 * unrelated result — "Burak Çelik - İmplant Tedavi Planı". Root cause: the
 * route destructured `status, patientId, practitionerId, clinicId` from
 * req.query but never read `search` (or `limit`) at all, so
 * treatmentCaseService.getAll({ search: q, limit: 5 }) silently returned the
 * caller's entire unfiltered/most-recent case list (DENTIST-scoped, but not
 * query-scoped) instead of matches.
 *
 * This suite extracts the REAL registered route from the REAL
 * treatmentCasesRouter (server/src/routes/treatmentCases.ts) — same
 * technique as treatmentCasesProposalPdfRoute.test.ts's
 * getRouteMiddlewareChain()/runChain() — and runs its FULL middleware chain
 * (authorize() included) against a constructed AuthRequest/mock Response.
 * Only prisma.clinic.* and prisma.treatmentCase.findMany are mocked, at the
 * true I/O boundary; the route's own where-clause construction is exercised
 * unmodified.
 *
 * Run with: npx tsx src/tests/treatmentCaseSearchScope.test.ts
 */

import assert from 'node:assert/strict';
import prisma from '../db.js';
import treatmentCasesRouter from '../routes/treatmentCases.js';
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
    if (!calledNext) return;
  }
}

const ROUTE_PATH = '/treatment-cases';
const listChain = getRouteMiddlewareChain(treatmentCasesRouter as unknown as RouterLike, 'get', ROUTE_PATH);

function mockResponse(): Response & { statusCode: number; body: any } {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

function authRequest(user: NonNullable<AuthRequest['user']>, query: Record<string, string>): AuthRequest {
  return { params: {}, query, headers: {}, user } as unknown as AuthRequest;
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

type MockCase = {
  id: string;
  clinicId: string;
  practitionerId: string | null;
  patientId: string;
  title: string;
  stage: string;
  createdAt: Date;
  patient: { id: string; firstName: string; lastName: string; phone: string; email: string };
};

let clinics: { id: string; organizationId: string }[] = [];
let cases: MockCase[] = [];

(prisma as any).clinic = {
  findMany: async ({ where }: any) =>
    clinics.filter((c) => c.organizationId === where.organizationId).map((c) => ({ id: c.id })),
  findFirst: async ({ where }: any) =>
    clinics.find((c) => c.id === where.id && c.organizationId === where.organizationId) ?? null,
};

// Minimal Prisma `contains`/`mode: 'insensitive'` + top-level-AND/OR evaluator —
// mirrors real Prisma semantics for exactly the shape this route emits, so a
// regression in the route's where-clause construction (search dropped, OR
// misapplied, DENTIST scoping bypassed) shows up as a wrong result set here.
function matchesStringFilter(value: string, filter: any): boolean {
  if (typeof filter === 'string') return value === filter;
  if (filter?.contains !== undefined) {
    const haystack = filter.mode === 'insensitive' ? value.toLowerCase() : value;
    const needle = filter.mode === 'insensitive' ? String(filter.contains).toLowerCase() : filter.contains;
    return haystack.includes(needle);
  }
  return false;
}

function matchesClinicIdFilter(clinicId: string, filter: any): boolean {
  if (typeof filter === 'string') return clinicId === filter;
  if (filter?.in) return filter.in.includes(clinicId);
  return true;
}

function matchesOrClause(tc: MockCase, orClause: any[]): boolean {
  return orClause.some((cond) => {
    if (cond.title) return matchesStringFilter(tc.title, cond.title);
    if (cond.patient?.firstName) return matchesStringFilter(tc.patient.firstName, cond.patient.firstName);
    if (cond.patient?.lastName) return matchesStringFilter(tc.patient.lastName, cond.patient.lastName);
    return false;
  });
}

(prisma as any).treatmentCase = {
  findMany: async ({ where, take }: any) => {
    let results = cases.filter((tc) => {
      if (where.clinicId !== undefined && !matchesClinicIdFilter(tc.clinicId, where.clinicId)) return false;
      if (where.practitionerId !== undefined && tc.practitionerId !== where.practitionerId) return false;
      if (where.patientId !== undefined && tc.patientId !== where.patientId) return false;
      if (where.OR !== undefined && !matchesOrClause(tc, where.OR)) return false;
      return true;
    });
    results = [...results].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (typeof take === 'number') results = results.slice(0, take);
    return results.map((tc) => ({ ...tc, appointments: [], payments: [] }));
  },
};

function resetDb() {
  clinics = [{ id: 'clinic-A', organizationId: 'org-1' }];
  cases = [
    {
      id: 'tc-mustafa',
      clinicId: 'clinic-A',
      practitionerId: 'dentist-1',
      patientId: 'patient-mustafa',
      title: 'Kanal Tedavisi',
      stage: 'in_progress',
      createdAt: new Date('2026-08-10T00:00:00Z'),
      patient: { id: 'patient-mustafa', firstName: 'Mustafa', lastName: 'Basol', phone: '555', email: 'a@a.com' },
    },
    {
      id: 'tc-burak',
      clinicId: 'clinic-A',
      practitionerId: 'dentist-1',
      patientId: 'patient-burak',
      // Reproduces the exact production symptom: a more recently created,
      // completely unrelated case assigned to the same practitioner.
      title: 'İmplant Tedavi Planı',
      stage: 'new',
      createdAt: new Date('2026-08-15T00:00:00Z'),
      patient: { id: 'patient-burak', firstName: 'Burak', lastName: 'Çelik', phone: '555', email: 'b@b.com' },
    },
    {
      id: 'tc-other-dentist',
      clinicId: 'clinic-A',
      practitionerId: 'dentist-2',
      patientId: 'patient-mustafa-2',
      title: 'Mustafa Yildiz consult',
      stage: 'new',
      createdAt: new Date('2026-08-16T00:00:00Z'),
      patient: { id: 'patient-mustafa-2', firstName: 'Mustafa', lastName: 'Yildiz', phone: '555', email: 'c@c.com' },
    },
  ];
}

section('=== Route registration ===');

await test('the real GET /treatment-cases route is registered and its chain includes authorize()', () => {
  assert.ok(listChain.length >= 2, 'expected at least [authorize(), handler] in the route stack');
});

section('=== GET /treatment-cases?search= — real router + real handler (finding 2 regression) ===');

await test('DENTIST searching "mustafa" only gets cases with a legitimate match (title/patient name) — never the unrelated Burak Çelik case', async () => {
  resetDb();
  const user = makeUser({ id: 'dentist-1', role: 'doctor', normalizedRole: 'DENTIST', allowedClinicIds: ['clinic-A'] });
  const req = authRequest(user, { search: 'mustafa', limit: '5' });
  const res = mockResponse();
  await runChain(listChain, req, res);

  assert.equal(res.statusCode, 200);
  const titles = (res.body as any[]).map((c) => c.title);
  assert.ok(titles.includes('Kanal Tedavisi'), 'expected the legitimately-matching case to be present');
  assert.ok(!titles.includes('İmplant Tedavi Planı'), 'the unrelated Burak Çelik case must not appear (production regression)');
  for (const c of res.body as any[]) {
    const s = 'mustafa';
    const matches =
      c.title.toLowerCase().includes(s) ||
      c.patient.firstName.toLowerCase().includes(s) ||
      c.patient.lastName.toLowerCase().includes(s);
    assert.ok(matches, `every returned case must have a legitimate match, got: ${JSON.stringify(c)}`);
  }
});

await test('DENTIST practitioner scoping still applies together with search (does not leak another dentist\'s matching case)', async () => {
  resetDb();
  const user = makeUser({ id: 'dentist-1', role: 'doctor', normalizedRole: 'DENTIST', allowedClinicIds: ['clinic-A'] });
  const req = authRequest(user, { search: 'mustafa' });
  const res = mockResponse();
  await runChain(listChain, req, res);

  const ids = (res.body as any[]).map((c) => c.id);
  assert.ok(!ids.includes('tc-other-dentist'), 'a matching case owned by a DIFFERENT dentist must not appear');
});

await test('OWNER (unscoped by practitioner) searching "mustafa" gets both legitimately-matching cases across dentists', async () => {
  resetDb();
  const user = makeUser({ id: 'owner-1', role: 'owner', normalizedRole: 'OWNER', canAccessAllClinics: false, allowedClinicIds: ['clinic-A'] });
  const req = authRequest(user, { search: 'mustafa' });
  const res = mockResponse();
  await runChain(listChain, req, res);

  const ids = (res.body as any[]).map((c) => c.id);
  assert.ok(ids.includes('tc-mustafa') && ids.includes('tc-other-dentist'));
  assert.ok(!ids.includes('tc-burak'));
});

await test('search matches by treatment title even when the patient name differs', async () => {
  resetDb();
  const user = makeUser({ id: 'owner-1', canAccessAllClinics: false, allowedClinicIds: ['clinic-A'] });
  // "planı" (not "implant") deliberately avoids the Turkish dotted-capital-İ
  // case-folding edge case (İ.toLowerCase() !== i in JS's default locale) —
  // this test is about title matching, not Unicode case-folding behavior.
  const req = authRequest(user, { search: 'planı' });
  const res = mockResponse();
  await runChain(listChain, req, res);

  const ids = (res.body as any[]).map((c) => c.id);
  assert.deepEqual(ids, ['tc-burak']);
});

await test('no search param preserves prior (unfiltered, within scope) behavior — regression guard', async () => {
  resetDb();
  const user = makeUser({ id: 'owner-1', canAccessAllClinics: false, allowedClinicIds: ['clinic-A'] });
  const req = authRequest(user, {});
  const res = mockResponse();
  await runChain(listChain, req, res);

  assert.equal((res.body as any[]).length, 3);
});

await test('limit truncates results (bounded search)', async () => {
  resetDb();
  const user = makeUser({ id: 'owner-1', canAccessAllClinics: false, allowedClinicIds: ['clinic-A'] });
  const req = authRequest(user, { limit: '2' });
  const res = mockResponse();
  await runChain(listChain, req, res);

  assert.equal((res.body as any[]).length, 2);
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`Toplam: ${passed + failed} test | Geçen: ${passed} | Başarısız: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız!`);
  process.exit(1);
} else {
  console.log('\nTüm gerçek route testleri geçti!');
}
