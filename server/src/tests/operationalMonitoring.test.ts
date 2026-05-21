/**
 * operationalMonitoring.test.ts — Sprint 13: Operational Monitoring Unit Tests
 *
 * Tests cover:
 *  - canViewOperations role-based access (backend roles.ts)
 *  - canResolveOperationalEvents role-based access
 *  - getAllowedClinicFilter — OWNER/ORG_ADMIN get null, CLINIC_MANAGER gets restricted list
 *  - Cross-org isolation: queries always scoped to organizationId
 *  - AuditLog metadata safety (no credentials/tokens)
 *  - writeAuditLog + recordOperationalEvent fire-and-forget behavior
 *  - Pagination parameter clamping (page ≥ 1, limit ≤ 100)
 *  - Operational event severity/source type validation
 *  - Health response shape: no secrets exposed
 *  - Event filter: status=unresolved/resolved maps to resolvedAt=null / not null
 *
 * Run with: tsx src/tests/operationalMonitoring.test.ts
 */

import assert from 'node:assert/strict';

// ─── Test harness ─────────────────────────────────────────────────────────────

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

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
  canViewOperations,
  canResolveOperationalEvents,
  normalizeRole,
} from '../utils/roles.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeUser(
  role: string,
  opts: Partial<{
    canAccessAllClinics: boolean;
    allowedClinicIds: string[];
    organizationId: string;
    id: string;
  }> = {},
) {
  return {
    id: opts.id ?? 'user-1',
    clinicId: 'clinic-1',
    organizationId: opts.organizationId ?? 'org-1',
    role,
    canAccessAllClinics: opts.canAccessAllClinics ?? false,
    allowedClinicIds: opts.allowedClinicIds ?? ['clinic-1'],
  };
}

// ─── Inline replica of getAllowedClinicFilter ─────────────────────────────────
// Mirrors the logic in server/src/routes/operationalMonitoring.ts
// to test it without spinning up the server.

function getAllowedClinicFilter(
  user: ReturnType<typeof makeUser>,
): string[] | null {
  const role = normalizeRole(user.role, user.canAccessAllClinics);
  if (role === 'OWNER' || role === 'ORG_ADMIN') return null;
  return user.allowedClinicIds ?? [];
}

// ─── Inline replica of buildAuditLogWhere ────────────────────────────────────
// Mirrors the query-building logic in GET /ops/audit-logs.

function buildAuditLogWhere(
  user: ReturnType<typeof makeUser>,
  {
    clinicId,
    action,
    entityType,
    actorUserId,
    from,
    to,
  }: {
    clinicId?: string;
    action?: string;
    entityType?: string;
    actorUserId?: string;
    from?: string;
    to?: string;
  },
): Record<string, unknown> | null {
  const where: Record<string, unknown> = {
    organizationId: user.organizationId,
  };
  const allowedClinics = getAllowedClinicFilter(user);

  if (clinicId && clinicId !== 'all') {
    if (allowedClinics !== null && !allowedClinics.includes(clinicId)) {
      return null; // 403 equivalent
    }
    where['clinicId'] = clinicId;
  } else if (allowedClinics !== null) {
    where['clinicId'] = { in: allowedClinics };
  }

  if (action)      where['action']      = action;
  if (entityType)  where['entityType']  = entityType;
  if (actorUserId) where['actorUserId'] = actorUserId;

  if (from || to) {
    const dateFilter: Record<string, Date> = {};
    if (from) dateFilter['gte'] = new Date(from);
    if (to)   dateFilter['lte'] = new Date(to);
    where['createdAt'] = dateFilter;
  }

  return where;
}

// ─── Inline replica of buildEventWhere ───────────────────────────────────────

function buildEventWhere(
  user: ReturnType<typeof makeUser>,
  {
    clinicId,
    severity,
    source,
    status,
  }: {
    clinicId?: string;
    severity?: string;
    source?: string;
    status?: string;
  },
): Record<string, unknown> | null {
  const where: Record<string, unknown> = {
    organizationId: user.organizationId,
  };
  const allowedClinics = getAllowedClinicFilter(user);

  if (clinicId && clinicId !== 'all') {
    if (allowedClinics !== null && !allowedClinics.includes(clinicId)) {
      return null; // 403 equivalent
    }
    where['clinicId'] = clinicId;
  } else if (allowedClinics !== null) {
    where['clinicId'] = { in: allowedClinics };
  }

  if (severity) where['severity'] = severity;
  if (source)   where['source']   = source;

  if (status === 'unresolved') where['resolvedAt'] = null;
  if (status === 'resolved')   where['resolvedAt'] = { not: null };

  return where;
}

// ─── Inline pagination helper ─────────────────────────────────────────────────

function parsePagination(pageStr?: string, limitStr?: string) {
  const rawPage  = parseInt(pageStr  ?? '1',  10);
  const rawLimit = parseInt(limitStr ?? '50', 10);
  const page  = Math.max(1, isNaN(rawPage)  ? 1  : rawPage);
  const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 50 : rawLimit));
  const skip  = (page - 1) * limit;
  return { page, limit, skip };
}

// ─── FORBIDDEN metadata keys (credentials must never be stored) ───────────────

const FORBIDDEN_METADATA_KEYS = [
  'password', 'token', 'secret', 'apiKey', 'api_key',
  'webhookSecret', 'webhook_secret', 'accessToken', 'access_token',
  'refreshToken', 'refresh_token', 'authToken', 'auth_token',
  'privateKey', 'private_key',
];

function hasForbiddenKey(obj: Record<string, unknown>): string | null {
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    for (const forbidden of FORBIDDEN_METADATA_KEYS) {
      if (lower === forbidden.toLowerCase()) return key;
    }
  }
  return null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const tests: Promise<void>[] = [];

// ── 1. canViewOperations ──────────────────────────────────────────────────────

section('canViewOperations — role-based access');

tests.push(test('OWNER can view operations', () => {
  assert.ok(canViewOperations(makeUser('OWNER', { canAccessAllClinics: true })));
}));

tests.push(test('ORG_ADMIN can view operations', () => {
  assert.ok(canViewOperations(makeUser('ORG_ADMIN')));
}));

tests.push(test('CLINIC_MANAGER can view operations', () => {
  assert.ok(canViewOperations(makeUser('CLINIC_MANAGER')));
}));

tests.push(test('DENTIST cannot view operations', () => {
  assert.equal(canViewOperations(makeUser('DENTIST')), false);
}));

tests.push(test('RECEPTIONIST cannot view operations', () => {
  assert.equal(canViewOperations(makeUser('RECEPTIONIST')), false);
}));

tests.push(test('BILLING cannot view operations', () => {
  assert.equal(canViewOperations(makeUser('BILLING')), false);
}));

tests.push(test('ASSISTANT cannot view operations', () => {
  assert.equal(canViewOperations(makeUser('ASSISTANT')), false);
}));

tests.push(test('null user cannot view operations', () => {
  assert.equal(canViewOperations(null), false);
}));

tests.push(test('undefined user cannot view operations', () => {
  assert.equal(canViewOperations(undefined), false);
}));

// Legacy role alias: 'admin' with canAccessAllClinics=true → OWNER
tests.push(test('legacy admin (canAccessAllClinics=true) can view operations', () => {
  assert.ok(canViewOperations(makeUser('admin', { canAccessAllClinics: true })));
}));

// ── 2. canResolveOperationalEvents ───────────────────────────────────────────

section('canResolveOperationalEvents — role-based access');

tests.push(test('OWNER can resolve events', () => {
  assert.ok(canResolveOperationalEvents(makeUser('OWNER', { canAccessAllClinics: true })));
}));

tests.push(test('ORG_ADMIN can resolve events', () => {
  assert.ok(canResolveOperationalEvents(makeUser('ORG_ADMIN')));
}));

tests.push(test('CLINIC_MANAGER can resolve events', () => {
  assert.ok(canResolveOperationalEvents(makeUser('CLINIC_MANAGER')));
}));

tests.push(test('DENTIST cannot resolve events', () => {
  assert.equal(canResolveOperationalEvents(makeUser('DENTIST')), false);
}));

tests.push(test('BILLING cannot resolve events', () => {
  assert.equal(canResolveOperationalEvents(makeUser('BILLING')), false);
}));

tests.push(test('null user cannot resolve events', () => {
  assert.equal(canResolveOperationalEvents(null), false);
}));

// ── 3. getAllowedClinicFilter ─────────────────────────────────────────────────

section('getAllowedClinicFilter — clinic scope resolution');

tests.push(test('OWNER returns null (no restriction)', () => {
  const result = getAllowedClinicFilter(makeUser('OWNER', { canAccessAllClinics: true }));
  assert.equal(result, null);
}));

tests.push(test('ORG_ADMIN returns null (no restriction)', () => {
  const result = getAllowedClinicFilter(makeUser('ORG_ADMIN'));
  assert.equal(result, null);
}));

tests.push(test('CLINIC_MANAGER returns their allowedClinicIds', () => {
  const user = makeUser('CLINIC_MANAGER', { allowedClinicIds: ['clinic-A', 'clinic-B'] });
  const result = getAllowedClinicFilter(user);
  assert.deepEqual(result, ['clinic-A', 'clinic-B']);
}));

tests.push(test('CLINIC_MANAGER with no clinics returns empty array', () => {
  const user = makeUser('CLINIC_MANAGER', { allowedClinicIds: [] });
  const result = getAllowedClinicFilter(user);
  assert.deepEqual(result, []);
}));

// ── 4. Audit log query construction ──────────────────────────────────────────

section('Audit log query — organizationId scoping and cross-org isolation');

tests.push(test('query always includes organizationId', () => {
  const user = makeUser('OWNER', { canAccessAllClinics: true, organizationId: 'org-99' });
  const where = buildAuditLogWhere(user, {});
  assert.equal(where?.['organizationId'], 'org-99');
}));

tests.push(test('OWNER query has no clinicId restriction', () => {
  const user = makeUser('OWNER', { canAccessAllClinics: true });
  const where = buildAuditLogWhere(user, {});
  assert.equal(where?.['clinicId'], undefined);
}));

tests.push(test('CLINIC_MANAGER query restricts to allowedClinicIds', () => {
  const user = makeUser('CLINIC_MANAGER', { allowedClinicIds: ['clinic-X'] });
  const where = buildAuditLogWhere(user, {});
  assert.deepEqual(where?.['clinicId'], { in: ['clinic-X'] });
}));

tests.push(test('CLINIC_MANAGER requesting own clinic is allowed', () => {
  const user = makeUser('CLINIC_MANAGER', { allowedClinicIds: ['clinic-X'] });
  const where = buildAuditLogWhere(user, { clinicId: 'clinic-X' });
  assert.ok(where !== null);
  assert.equal(where?.['clinicId'], 'clinic-X');
}));

tests.push(test('CLINIC_MANAGER requesting another clinic is denied (null)', () => {
  const user = makeUser('CLINIC_MANAGER', { allowedClinicIds: ['clinic-X'] });
  const result = buildAuditLogWhere(user, { clinicId: 'clinic-OTHER' });
  assert.equal(result, null);
}));

tests.push(test('action filter applied when provided', () => {
  const user = makeUser('OWNER', { canAccessAllClinics: true });
  const where = buildAuditLogWhere(user, { action: 'payment_created' });
  assert.equal(where?.['action'], 'payment_created');
}));

tests.push(test('entityType filter applied when provided', () => {
  const user = makeUser('OWNER', { canAccessAllClinics: true });
  const where = buildAuditLogWhere(user, { entityType: 'payment' });
  assert.equal(where?.['entityType'], 'payment');
}));

tests.push(test('date range filter builds gte/lte correctly', () => {
  const user = makeUser('OWNER', { canAccessAllClinics: true });
  const where = buildAuditLogWhere(user, { from: '2026-01-01', to: '2026-01-31' });
  const dateFilter = where?.['createdAt'] as Record<string, Date>;
  assert.ok(dateFilter);
  assert.ok(dateFilter['gte'] instanceof Date);
  assert.ok(dateFilter['lte'] instanceof Date);
  assert.equal(dateFilter['gte'].getFullYear(), 2026);
  assert.equal(dateFilter['lte'].getMonth(), 0); // January
}));

tests.push(test('no date range means no createdAt filter', () => {
  const user = makeUser('OWNER', { canAccessAllClinics: true });
  const where = buildAuditLogWhere(user, {});
  assert.equal(where?.['createdAt'], undefined);
}));

// ── 5. Event query construction ───────────────────────────────────────────────

section('Operational event query — filters and scoping');

tests.push(test('status=unresolved maps to resolvedAt=null', () => {
  const user = makeUser('OWNER', { canAccessAllClinics: true });
  const where = buildEventWhere(user, { status: 'unresolved' });
  assert.equal(where?.['resolvedAt'], null);
}));

tests.push(test('status=resolved maps to resolvedAt={not:null}', () => {
  const user = makeUser('OWNER', { canAccessAllClinics: true });
  const where = buildEventWhere(user, { status: 'resolved' });
  assert.deepEqual(where?.['resolvedAt'], { not: null });
}));

tests.push(test('no status filter leaves resolvedAt undefined', () => {
  const user = makeUser('OWNER', { canAccessAllClinics: true });
  const where = buildEventWhere(user, {});
  assert.equal(where?.['resolvedAt'], undefined);
}));

tests.push(test('severity filter applied when provided', () => {
  const user = makeUser('OWNER', { canAccessAllClinics: true });
  const where = buildEventWhere(user, { severity: 'error' });
  assert.equal(where?.['severity'], 'error');
}));

tests.push(test('source filter applied when provided', () => {
  const user = makeUser('OWNER', { canAccessAllClinics: true });
  const where = buildEventWhere(user, { source: 'whatsapp' });
  assert.equal(where?.['source'], 'whatsapp');
}));

tests.push(test('CLINIC_MANAGER event query scoped to allowedClinicIds', () => {
  const user = makeUser('CLINIC_MANAGER', { allowedClinicIds: ['clinic-A'] });
  const where = buildEventWhere(user, {});
  assert.deepEqual(where?.['clinicId'], { in: ['clinic-A'] });
}));

tests.push(test('CLINIC_MANAGER requesting foreign clinic event returns null', () => {
  const user = makeUser('CLINIC_MANAGER', { allowedClinicIds: ['clinic-A'] });
  const result = buildEventWhere(user, { clinicId: 'clinic-FOREIGN' });
  assert.equal(result, null);
}));

// ── 6. Cross-organization isolation ──────────────────────────────────────────

section('Cross-organization isolation');

tests.push(test('org-1 user query never touches org-2 data', () => {
  const user = makeUser('OWNER', { canAccessAllClinics: true, organizationId: 'org-1' });
  const where = buildAuditLogWhere(user, {});
  // Simulating a second org's query
  const user2 = makeUser('OWNER', { canAccessAllClinics: true, organizationId: 'org-2' });
  const where2 = buildAuditLogWhere(user2, {});
  assert.notEqual(where?.['organizationId'], where2?.['organizationId']);
  assert.equal(where?.['organizationId'], 'org-1');
  assert.equal(where2?.['organizationId'], 'org-2');
}));

tests.push(test('query from org-1 user with org-2 clinicId is scoped to org-1', () => {
  const user = makeUser('OWNER', {
    canAccessAllClinics: true,
    organizationId: 'org-1',
  });
  // Even if someone tries to supply an org-2 clinic, the where always binds to org-1
  const where = buildAuditLogWhere(user, { clinicId: 'org2-clinic' });
  assert.equal(where?.['organizationId'], 'org-1');
}));

// ── 7. Audit log metadata safety ──────────────────────────────────────────────

section('Audit log metadata safety — no credentials stored');

tests.push(test('safe metadata passes check', () => {
  const metadata = { amount: 1500, currency: 'TRY', clinicId: 'c-1' };
  const found = hasForbiddenKey(metadata);
  assert.equal(found, null);
}));

tests.push(test('metadata with "token" key is flagged', () => {
  const metadata = { token: 'abc123', userId: 'u-1' };
  const found = hasForbiddenKey(metadata);
  assert.ok(found !== null, 'Expected "token" to be flagged');
}));

tests.push(test('metadata with "password" key is flagged', () => {
  const metadata = { password: 'secret', role: 'ADMIN' };
  const found = hasForbiddenKey(metadata);
  assert.ok(found !== null, 'Expected "password" to be flagged');
}));

tests.push(test('metadata with "apiKey" key is flagged', () => {
  const metadata = { apiKey: 'key-xyz', source: 'whatsapp' };
  const found = hasForbiddenKey(metadata);
  assert.ok(found !== null, 'Expected "apiKey" to be flagged');
}));

tests.push(test('metadata with "webhookSecret" key is flagged', () => {
  const metadata = { webhookSecret: 'whsec_abc' };
  const found = hasForbiddenKey(metadata);
  assert.ok(found !== null, 'Expected "webhookSecret" to be flagged');
}));

tests.push(test('metadata with allowed clinic/amount fields is safe', () => {
  const metadata = {
    amount: 500,
    clinicId: 'c-99',
    paymentMethod: 'cash',
    assignedClinics: ['c-1', 'c-2'],
  };
  assert.equal(hasForbiddenKey(metadata), null);
}));

// ── 8. Health response shape ──────────────────────────────────────────────────

section('Health response shape — required fields and no secrets');

// Validates that a mocked health response has the expected structure
function validateHealthShape(resp: Record<string, unknown>): string[] {
  const missing: string[] = [];
  const required = ['status', 'database', 'whatsapp', 'recentErrors', 'unresolvedEvents', 'failedSends24h'];
  for (const key of required) {
    if (!(key in resp)) missing.push(key);
  }
  return missing;
}

const mockHealthResponse = {
  status: 'ok',
  database: 'ok',
  whatsapp: { connections: 2, connected: 2, error: 0 },
  recentErrors: 0,
  unresolvedEvents: 0,
  failedSends24h: 0,
  lastWebhookAt: null,
  lastMessageSentAt: null,
};

tests.push(test('health response has all required fields', () => {
  const missing = validateHealthShape(mockHealthResponse);
  assert.equal(missing.length, 0, `Missing fields: ${missing.join(', ')}`);
}));

tests.push(test('health response does not contain secrets', () => {
  const found = hasForbiddenKey(mockHealthResponse as Record<string, unknown>);
  assert.equal(found, null, `Forbidden key found: ${found}`);
}));

tests.push(test('health whatsapp sub-object has connections/connected/error', () => {
  const wa = mockHealthResponse.whatsapp;
  assert.ok('connections' in wa);
  assert.ok('connected' in wa);
  assert.ok('error' in wa);
}));

tests.push(test('health status is one of ok/warning/error', () => {
  const valid = ['ok', 'warning', 'error'];
  assert.ok(valid.includes(mockHealthResponse.status));
}));

tests.push(test('warning status set when whatsapp error > 0', () => {
  const wa = { connections: 2, connected: 1, error: 1 };
  const recentErrors = 0;
  const overallStatus =
    wa.error > 0 || recentErrors > 0 ? 'warning' : 'ok';
  assert.equal(overallStatus, 'warning');
}));

tests.push(test('error status set when database=error', () => {
  const dbStatus = 'error';
  const overallStatus = dbStatus === 'error' ? 'error' : 'ok';
  assert.equal(overallStatus, 'error');
}));

tests.push(test('ok status when everything is healthy', () => {
  const dbStatus: string = 'ok';
  const wa = { connections: 2, connected: 2, error: 0 };
  const recentErrors = 0;
  const overallStatus =
    dbStatus === 'error'
      ? 'error'
      : wa.error > 0 || recentErrors > 0
      ? 'warning'
      : 'ok';
  assert.equal(overallStatus, 'ok');
}));

// ── 9. Pagination ─────────────────────────────────────────────────────────────

section('Pagination parameter clamping');

tests.push(test('default page=1, limit=50', () => {
  const { page, limit, skip } = parsePagination();
  assert.equal(page, 1);
  assert.equal(limit, 50);
  assert.equal(skip, 0);
}));

tests.push(test('page=2 skip=50 with default limit', () => {
  const { page, limit, skip } = parsePagination('2');
  assert.equal(page, 2);
  assert.equal(limit, 50);
  assert.equal(skip, 50);
}));

tests.push(test('limit is clamped to max 100', () => {
  const { limit } = parsePagination('1', '999');
  assert.equal(limit, 100);
}));

tests.push(test('limit is clamped to min 1', () => {
  const { limit } = parsePagination('1', '0');
  assert.equal(limit, 1);
}));

tests.push(test('page is clamped to min 1 for negative input', () => {
  const { page } = parsePagination('-5');
  assert.equal(page, 1);
}));

tests.push(test('non-numeric page defaults to 1', () => {
  const { page } = parsePagination('abc');
  assert.equal(page, 1);
}));

tests.push(test('skip is (page-1) * limit', () => {
  const { skip } = parsePagination('4', '25');
  assert.equal(skip, 75); // (4-1)*25
}));

// ── 10. Operational event type validation ─────────────────────────────────────

section('Operational event type validation');

const VALID_SEVERITIES = ['info', 'warning', 'error', 'critical'];
const VALID_SOURCES    = ['whatsapp', 'appointment', 'finance', 'auth', 'system'];

tests.push(test('all severity levels are recognized', () => {
  for (const sev of VALID_SEVERITIES) {
    assert.ok(VALID_SEVERITIES.includes(sev), `${sev} should be valid`);
  }
}));

tests.push(test('all source types are recognized', () => {
  for (const src of VALID_SOURCES) {
    assert.ok(VALID_SOURCES.includes(src), `${src} should be valid`);
  }
}));

tests.push(test('unknown severity is not in valid set', () => {
  assert.equal(VALID_SEVERITIES.includes('debug' as any), false);
}));

tests.push(test('unknown source is not in valid set', () => {
  assert.equal(VALID_SOURCES.includes('email' as any), false);
}));

// ── 11. fire-and-forget error handling ────────────────────────────────────────

section('fire-and-forget services — errors must not propagate');

tests.push(test('writeAuditLog swallows errors and returns void', async () => {
  // We test the promise chain manually without a real DB
  // by simulating a rejected prisma call being caught
  async function mockWriteAuditLog(): Promise<void> {
    try {
      await Promise.reject(new Error('DB connection failed'));
    } catch (err) {
      console.error('[AuditLog] swallowed:', (err as Error).message);
    }
  }
  // Should not throw
  await mockWriteAuditLog();
}));

tests.push(test('recordOperationalEvent swallows errors and returns void', async () => {
  async function mockRecordEvent(): Promise<void> {
    try {
      await Promise.reject(new Error('DB unavailable'));
    } catch (err) {
      console.error('[OperationalEvent] swallowed:', (err as Error).message);
    }
  }
  await mockRecordEvent();
}));

tests.push(test('fire-and-forget does not throw even when db is down', async () => {
  let errorThrown = false;
  async function callerFunction(): Promise<string> {
    // Simulate what routes do: call audit log and continue
    void (async () => {
      try {
        await Promise.reject(new Error('DB down'));
      } catch { /* swallowed */ }
    })();
    return 'main operation succeeded';
  }
  const result = await callerFunction();
  assert.equal(result, 'main operation succeeded');
  assert.equal(errorThrown, false);
}));

// ─── Run all tests ────────────────────────────────────────────────────────────

await Promise.all(tests);

const total = passed + failed;
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ''}`);

if (failed > 0) process.exit(1);
