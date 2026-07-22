/**
 * kvkkHigh006Batch3ClinicScope.test.ts — KVKK-HIGH-006 Batch 3 clinic-scope regression tests
 *
 * Covers the remediation applied to server/src/routes/services.ts,
 * server/src/routes/postTreatment.ts, and server/src/routes/messages.ts
 * (POST /message-templates, POST /message-templates/seed,
 * POST /message-templates/:id/meta/submit, POST /message-templates/:id/meta/sync,
 * GET /message-templates/:id/meta/status — the read/send routes at
 * messages.ts:451/473 are KVKK-HIGH-006 Batch 1 scope, untouched here).
 *
 * Bug (pre-fix): all three files used the single, static req.user.clinicId
 * (the JWT's "default clinic", not an authorization decision — see
 * clinicScope.ts) as the sole clinic filter, instead of the centralized
 * validateAndGetClinicIdScope/validateAndGetScope contract. OWNER/ORG_ADMIN
 * and any multi-branch-assigned user was silently restricted to their single
 * resolved default clinic on these routes, and record-derived mutations
 * (service materials, post-treatment templates/queue entries, message
 * templates) looked records up by that same single clinic instead of the
 * caller's full accessible scope.
 *
 * This file re-implements the exact scope-decision logic now used by the
 * three route files (mirroring server/src/utils/clinicScope.ts, not
 * importing it, so it runs without a live Postgres instance — same approach
 * as the pre-existing treatmentCaseClinicScope.test.ts), and simulates each
 * distinct scope-decision shape actually used in Batch 3's remediation:
 *
 *  - services.ts             -> validateAndGetClinicIdScope (no organizationId column)
 *  - postTreatment.ts        -> validateAndGetScope (both models carry organizationId)
 *  - messages.ts MessageTemplate -> validateAndGetClinicIdScope (no organizationId column —
 *    corrected from KVKK-HIGH-006-S2 Batch 3's stated "validateAndGetScope", which the
 *    schema does not support; see the implementation evidence doc for detail)
 *
 * Run with: tsx src/tests/kvkkHigh006Batch3ClinicScope.test.ts
 */

import assert from 'node:assert/strict';

// ─── Test harness ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─── User / clinic mock model ───────────────────────────────────────────────

type User = {
  id: string;
  clinicId: string; // defaultClinicId — sadece UI varsayılanı, YETKİLENDİRME değil
  organizationId: string;
  allowedClinicIds: string[];
  canAccessAllClinics: boolean;
};

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    clinicId: 'clinic-A',
    organizationId: 'org-1',
    allowedClinicIds: ['clinic-A'],
    canAccessAllClinics: false,
    ...overrides,
  };
}

let mockOrgClinics: Record<string, { id: string }[]> = {
  'org-1': [{ id: 'clinic-A' }, { id: 'clinic-B' }],
  'org-2': [{ id: 'clinic-X' }],
};

async function dbFindClinicInOrg(clinicId: string, organizationId: string) {
  return (mockOrgClinics[organizationId] ?? []).find((c) => c.id === clinicId) ?? null;
}

// ─── clinicScope.ts logic mirror (server/src/utils/clinicScope.ts) ──────────

type ClinicIdScopeWhere = { clinicId: string } | { clinicId: { in: string[] } };
type ClinicScopeWhere =
  | { organizationId: string }
  | { organizationId: string; clinicId: string }
  | { organizationId: string; clinicId: { in: string[] } };

async function buildClinicIdScope(user: User, selectedClinicId: string | undefined): Promise<ClinicIdScopeWhere | null> {
  if (selectedClinicId && selectedClinicId !== 'all') {
    const clinic = await dbFindClinicInOrg(selectedClinicId, user.organizationId);
    if (!clinic) return null;
    if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(selectedClinicId)) return null;
    return { clinicId: selectedClinicId };
  }
  if (user.canAccessAllClinics) {
    return { clinicId: { in: (mockOrgClinics[user.organizationId] ?? []).map((c) => c.id) } };
  }
  if (user.allowedClinicIds.length === 0) return null;
  return { clinicId: { in: user.allowedClinicIds } };
}

async function validateAndGetClinicIdScope(user: User, selectedClinicId: string | undefined): Promise<ClinicIdScopeWhere | 403> {
  const scope = await buildClinicIdScope(user, selectedClinicId);
  return scope === null ? 403 : scope;
}

async function buildClinicScopeWhere(user: User, selectedClinicId: string | undefined): Promise<ClinicScopeWhere | null> {
  const orgId = user.organizationId;
  if (!selectedClinicId || selectedClinicId === 'all') {
    if (user.canAccessAllClinics) return { organizationId: orgId };
    if (user.allowedClinicIds.length === 0) return null;
    return { organizationId: orgId, clinicId: { in: user.allowedClinicIds } };
  }
  const clinic = await dbFindClinicInOrg(selectedClinicId, orgId);
  if (!clinic) return null;
  if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(selectedClinicId)) return null;
  return { organizationId: orgId, clinicId: selectedClinicId };
}

async function validateAndGetScope(user: User, selectedClinicId: string | undefined): Promise<ClinicScopeWhere | 403> {
  const scope = await buildClinicScopeWhere(user, selectedClinicId);
  return scope === null ? 403 : scope;
}

async function resolveEffectiveClinicId(user: User, requestedClinicId?: string): Promise<string | null> {
  const clinicId = requestedClinicId ?? user.clinicId;
  const clinic = await dbFindClinicInOrg(clinicId, user.organizationId);
  if (!clinic) return null;
  if (!user.canAccessAllClinics && !user.allowedClinicIds.includes(clinicId)) return null;
  return clinicId;
}

function matchesClinicIdScope(scope: ClinicIdScopeWhere, clinicId: string): boolean {
  return typeof scope.clinicId === 'string' ? scope.clinicId === clinicId : scope.clinicId.in.includes(clinicId);
}

function matchesClinicScope(scope: ClinicScopeWhere, organizationId: string, clinicId: string): boolean {
  if (organizationId !== scope.organizationId) return false;
  if (!('clinicId' in scope)) return true;
  return typeof scope.clinicId === 'string' ? scope.clinicId === clinicId : scope.clinicId.in.includes(clinicId);
}

// ─── services.ts route simulation (AppointmentType — clinicId only) ─────────

type Service = { id: string; clinicId: string; name: string };
let mockServices: Service[] = [];

// GET /services — was: where: { clinicId: req.user.clinicId }
async function simulateListServices(user: User, selectedClinicId?: string) {
  const scope = await validateAndGetClinicIdScope(user, selectedClinicId);
  if (scope === 403) return { status: 403 as const };
  return { status: 200 as const, data: mockServices.filter((s) => matchesClinicIdScope(scope, s.clinicId)) };
}

// POST /services — was: data: { clinicId: req.user.clinicId, ... }
async function simulateCreateService(user: User, name: string, requestedClinicId?: string) {
  const clinicId = await resolveEffectiveClinicId(user, requestedClinicId);
  if (!clinicId) return { status: 403 as const };
  const service: Service = { id: `svc-${mockServices.length + 1}`, clinicId, name };
  mockServices.push(service);
  return { status: 201 as const, data: service };
}

// PUT /services/:id (materials CRUD shares this record-derived shape) —
// was: findFirst({ where: { id, clinicId: req.user.clinicId } })
async function simulateUpdateService(user: User, id: string) {
  const scope = await validateAndGetClinicIdScope(user, undefined);
  if (scope === 403) return { status: 403 as const };
  const existing = mockServices.find((s) => s.id === id && matchesClinicIdScope(scope, s.clinicId));
  if (!existing) return { status: 404 as const };
  return { status: 200 as const, data: existing };
}

// ─── postTreatment.ts route simulation (organizationId + clinicId) ──────────

type PtTemplate = { id: string; organizationId: string; clinicId: string; title: string };
let mockPtTemplates: PtTemplate[] = [];

// GET /post-treatment-templates — was: where: { clinicId: req.user.clinicId }
async function simulateListPtTemplates(user: User, selectedClinicId?: string) {
  const scope = await validateAndGetScope(user, selectedClinicId);
  if (scope === 403) return { status: 403 as const };
  return {
    status: 200 as const,
    data: mockPtTemplates.filter((t) => matchesClinicScope(scope, t.organizationId, t.clinicId)),
  };
}

// POST /post-treatment-templates — was: organizationId: req.user.organizationId, clinicId: req.user.clinicId
async function simulateCreatePtTemplate(user: User, title: string, requestedClinicId?: string) {
  const clinicId = await resolveEffectiveClinicId(user, requestedClinicId);
  if (!clinicId) return { status: 403 as const };
  const template: PtTemplate = { id: `pt-${mockPtTemplates.length + 1}`, organizationId: user.organizationId, clinicId, title };
  mockPtTemplates.push(template);
  return { status: 201 as const, data: template };
}

// PUT/DELETE /post-treatment-templates/:id — was: findFirst({ where: { id, clinicId: req.user.clinicId } })
async function simulateUpdatePtTemplate(user: User, id: string) {
  const scope = await validateAndGetScope(user, undefined);
  if (scope === 403) return { status: 403 as const };
  const existing = mockPtTemplates.find((t) => t.id === id && matchesClinicScope(scope, t.organizationId, t.clinicId));
  if (!existing) return { status: 404 as const };
  return { status: 200 as const, data: existing };
}

// ─── messages.ts MessageTemplate route simulation (clinicId only) ───────────

type MsgTemplate = { id: string; clinicId: string; name: string };
let mockMsgTemplates: MsgTemplate[] = [];

// POST /message-templates, /message-templates/seed — was: clinicId: req.user.clinicId
async function simulateCreateMessageTemplate(user: User, name: string, requestedClinicId?: string) {
  const clinicId = await resolveEffectiveClinicId(user, requestedClinicId);
  if (!clinicId) return { status: 403 as const };
  const template: MsgTemplate = { id: `mt-${mockMsgTemplates.length + 1}`, clinicId, name };
  mockMsgTemplates.push(template);
  return { status: 201 as const, data: template };
}

// POST /message-templates/:id/meta/submit|sync, GET .../meta/status —
// was: findFirst({ where: { id, clinicId: req.user.clinicId } })
async function simulateMetaTemplateLookup(user: User, id: string) {
  const scope = await validateAndGetClinicIdScope(user, undefined);
  if (scope === 403) return { status: 403 as const };
  const existing = mockMsgTemplates.find((t) => t.id === id && matchesClinicIdScope(scope, t.clinicId));
  if (!existing) return { status: 404 as const };
  return { status: 200 as const, data: existing };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function resetFixtures() {
  mockOrgClinics = {
    'org-1': [{ id: 'clinic-A' }, { id: 'clinic-B' }],
    'org-2': [{ id: 'clinic-X' }],
  };
  mockServices = [
    { id: 'svc-A1', clinicId: 'clinic-A', name: 'Cleaning' },
    { id: 'svc-B1', clinicId: 'clinic-B', name: 'Whitening' },
    { id: 'svc-X1', clinicId: 'clinic-X', name: 'Other-org service' },
  ];
  mockPtTemplates = [
    { id: 'pt-A1', organizationId: 'org-1', clinicId: 'clinic-A', title: 'Post-op A' },
    { id: 'pt-B1', organizationId: 'org-1', clinicId: 'clinic-B', title: 'Post-op B' },
    { id: 'pt-X1', organizationId: 'org-2', clinicId: 'clinic-X', title: 'Other-org template' },
  ];
  mockMsgTemplates = [
    { id: 'mt-A1', clinicId: 'clinic-A', name: 'Reminder A' },
    { id: 'mt-B1', clinicId: 'clinic-B', name: 'Reminder B' },
    { id: 'mt-X1', clinicId: 'clinic-X', name: 'Other-org template' },
  ];
}

// ─── services.ts ─────────────────────────────────────────────────────────────

section('services.ts — GET /services (list), validateAndGetClinicIdScope');

await test('Single-clinic user sees only their own clinic (unchanged today)', async () => {
  resetFixtures();
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  const res = await simulateListServices(user);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data!.map((s) => s.id), ['svc-A1']);
});

await test('Multi-clinic user with explicit allowed sibling clinic now sees Clinic B (fixed today)', async () => {
  resetFixtures();
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simulateListServices(user, 'clinic-B');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data!.map((s) => s.id), ['svc-B1']);
});

await test('Multi-clinic user requesting a disallowed clinic is denied (403), not silently narrowed', async () => {
  resetFixtures();
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  const res = await simulateListServices(user, 'clinic-B');
  assert.equal(res.status, 403);
});

await test('OWNER/ORG_ADMIN with no selector sees all org clinics (org-wide behavior)', async () => {
  resetFixtures();
  const user = makeUser({ canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await simulateListServices(user);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data!.map((s) => s.id).sort(), ['svc-A1', 'svc-B1']);
});

await test('Cross-organization clinic id is always denied (403), never a silent empty/narrowed result', async () => {
  resetFixtures();
  const user = makeUser({ canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await simulateListServices(user, 'clinic-X');
  assert.equal(res.status, 403);
});

await test('Omitted clinic selector preserves accessible-scope default (backward compatible)', async () => {
  resetFixtures();
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  const res = await simulateListServices(user, undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data!.map((s) => s.id), ['svc-A1']);
});

await test('Invalid/nonexistent clinic selector returns 403, not a 500 or empty-but-200', async () => {
  resetFixtures();
  const user = makeUser({ canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await simulateListServices(user, 'clinic-does-not-exist');
  assert.equal(res.status, 403);
});

section('services.ts — POST /services (create), resolveEffectiveClinicId');

await test('Create with no explicit clinicId uses the requester\'s own validated default clinic (unchanged)', async () => {
  resetFixtures();
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simulateCreateService(user, 'New service');
  assert.equal(res.status, 201);
  assert.equal(res.data!.clinicId, 'clinic-A');
});

await test('Create with an explicit, allowed sibling clinic uses that clinic (widened, additive)', async () => {
  resetFixtures();
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simulateCreateService(user, 'New service', 'clinic-B');
  assert.equal(res.status, 201);
  assert.equal(res.data!.clinicId, 'clinic-B');
});

await test('Create targeting a disallowed clinic is denied (403); nothing is created', async () => {
  resetFixtures();
  const before = mockServices.length;
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  const res = await simulateCreateService(user, 'New service', 'clinic-B');
  assert.equal(res.status, 403);
  assert.equal(mockServices.length, before);
});

section('services.ts — PUT /services/:id materials CRUD (record-derived mutation)');

await test('Record-owned clinic outside caller\'s accessible set is never found (404), even for a real id', async () => {
  resetFixtures();
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  const res = await simulateUpdateService(user, 'svc-B1');
  assert.equal(res.status, 404);
});

await test('Multi-clinic user can now act on a sibling-clinic-owned record (fixed today)', async () => {
  resetFixtures();
  const user = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simulateUpdateService(user, 'svc-B1');
  assert.equal(res.status, 200);
  assert.equal(res.data!.clinicId, 'clinic-B');
});

await test('Another organization\'s record is never reachable, even for an OWNER with canAccessAllClinics', async () => {
  resetFixtures();
  const user = makeUser({ canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await simulateUpdateService(user, 'svc-X1');
  assert.equal(res.status, 404);
});

// ─── postTreatment.ts ────────────────────────────────────────────────────────

section('postTreatment.ts — GET /post-treatment-templates (list), validateAndGetScope');

await test('Single-clinic user sees only their own clinic\'s templates (unchanged today)', async () => {
  resetFixtures();
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  const res = await simulateListPtTemplates(user);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data!.map((t) => t.id), ['pt-A1']);
});

await test('Multi-clinic user with explicit allowed sibling clinic now sees Clinic B\'s templates', async () => {
  resetFixtures();
  const user = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simulateListPtTemplates(user, 'clinic-B');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data!.map((t) => t.id), ['pt-B1']);
});

await test('Disallowed clinic selector is denied (403)', async () => {
  resetFixtures();
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  const res = await simulateListPtTemplates(user, 'clinic-B');
  assert.equal(res.status, 403);
});

await test('OWNER/ORG_ADMIN \'all\' selection returns every org clinic\'s templates, org-scoped', async () => {
  resetFixtures();
  const user = makeUser({ canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await simulateListPtTemplates(user, 'all');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data!.map((t) => t.id).sort(), ['pt-A1', 'pt-B1']);
  assert.ok(!res.data!.some((t) => t.id === 'pt-X1'), 'must never include another organization\'s template');
});

await test('Cross-organization template is never exposed, even to an org-wide OWNER (no PHI/content leak across orgs)', async () => {
  resetFixtures();
  const user = makeUser({ canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await simulateListPtTemplates(user);
  assert.ok(!res.data!.some((t) => t.id === 'pt-X1'));
});

await test('Omitted clinic selector preserves accessible-scope default (backward compatible)', async () => {
  resetFixtures();
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  const res = await simulateListPtTemplates(user, undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data!.map((t) => t.id), ['pt-A1']);
});

section('postTreatment.ts — POST /post-treatment-templates (create), resolveEffectiveClinicId');

await test('Created template is stamped with the resolved (validated) clinic, and the requester\'s own org', async () => {
  resetFixtures();
  const user = makeUser({ clinicId: 'clinic-A', organizationId: 'org-1', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simulateCreatePtTemplate(user, 'New template', 'clinic-B');
  assert.equal(res.status, 201);
  assert.equal(res.data!.clinicId, 'clinic-B');
  assert.equal(res.data!.organizationId, 'org-1');
});

await test('Create targeting an out-of-org clinic is denied (403); nothing is created', async () => {
  resetFixtures();
  const before = mockPtTemplates.length;
  const user = makeUser({ canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await simulateCreatePtTemplate(user, 'New template', 'clinic-X');
  assert.equal(res.status, 403);
  assert.equal(mockPtTemplates.length, before);
});

section('postTreatment.ts — PUT/DELETE /post-treatment-templates/:id, POST queue approve/cancel (record-derived)');

await test('Record-owned clinic mismatch: a sibling-clinic template is not found by a single-clinic user', async () => {
  resetFixtures();
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  const res = await simulateUpdatePtTemplate(user, 'pt-B1');
  assert.equal(res.status, 404);
});

await test('Multi-clinic user can now update a sibling-clinic-owned template (fixed today)', async () => {
  resetFixtures();
  const user = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simulateUpdatePtTemplate(user, 'pt-B1');
  assert.equal(res.status, 200);
  assert.equal(res.data!.clinicId, 'clinic-B');
});

await test('Cross-organization template is never reachable for record-derived mutation, even org-wide', async () => {
  resetFixtures();
  const user = makeUser({ canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await simulateUpdatePtTemplate(user, 'pt-X1');
  assert.equal(res.status, 404);
});

// ─── messages.ts (MessageTemplate) ──────────────────────────────────────────

section('messages.ts — POST /message-templates, /message-templates/seed (create), resolveEffectiveClinicId');

await test('Created message template uses the requester\'s own validated default clinic when unspecified', async () => {
  resetFixtures();
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A'] });
  const res = await simulateCreateMessageTemplate(user, 'New reminder');
  assert.equal(res.status, 201);
  assert.equal(res.data!.clinicId, 'clinic-A');
});

await test('Created message template honors an explicit, allowed sibling clinic', async () => {
  resetFixtures();
  const user = makeUser({ clinicId: 'clinic-A', allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simulateCreateMessageTemplate(user, 'New reminder', 'clinic-B');
  assert.equal(res.status, 201);
  assert.equal(res.data!.clinicId, 'clinic-B');
});

await test('Create targeting a disallowed clinic is denied (403); nothing is created', async () => {
  resetFixtures();
  const before = mockMsgTemplates.length;
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  const res = await simulateCreateMessageTemplate(user, 'New reminder', 'clinic-B');
  assert.equal(res.status, 403);
  assert.equal(mockMsgTemplates.length, before);
});

section('messages.ts — POST .../meta/submit|sync, GET .../meta/status (record-derived Meta lookup)');

await test('Single-clinic user cannot reach a sibling-clinic template\'s Meta status (unchanged today, pre-fix parity)', async () => {
  resetFixtures();
  const user = makeUser({ allowedClinicIds: ['clinic-A'] });
  const res = await simulateMetaTemplateLookup(user, 'mt-B1');
  assert.equal(res.status, 404);
});

await test('Multi-clinic user can now reach a sibling-clinic template\'s Meta status (fixed today)', async () => {
  resetFixtures();
  const user = makeUser({ allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const res = await simulateMetaTemplateLookup(user, 'mt-B1');
  assert.equal(res.status, 200);
  assert.equal(res.data!.clinicId, 'clinic-B');
});

await test('OWNER/ORG_ADMIN (canAccessAllClinics) can reach any of their own org\'s templates', async () => {
  resetFixtures();
  const user = makeUser({ canAccessAllClinics: true, allowedClinicIds: [] });
  const resA = await simulateMetaTemplateLookup(user, 'mt-A1');
  const resB = await simulateMetaTemplateLookup(user, 'mt-B1');
  assert.equal(resA.status, 200);
  assert.equal(resB.status, 200);
});

await test('A different organization\'s message template is never reachable, even for an org-wide OWNER (no cross-org message content exposure)', async () => {
  resetFixtures();
  const user = makeUser({ canAccessAllClinics: true, allowedClinicIds: [] });
  const res = await simulateMetaTemplateLookup(user, 'mt-X1');
  assert.equal(res.status, 404);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Toplam: ${passed + failed} test | Geçen: ${passed} | Başarısız: ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız!`);
  process.exit(1);
} else {
  console.log('\nTüm KVKK-HIGH-006 Batch 3 klinik kapsamı testleri geçti!');
}
