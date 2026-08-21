/**
 * platformAdminOwnerBootstrap.test.ts — G1-TECH-PREFLIGHT-001
 *
 * Çalıştırma: cd server && npx tsx src/tests/platformAdminOwnerBootstrap.test.ts
 *
 * Covers POST /api/platform/clinics/:id/owner — the first-OWNER bootstrap for a
 * brand-new tenant. Before this route existed, a clinic created by
 * POST /api/platform/clinics had zero users and POST /api/users could not
 * create the first one (it requires an already-authenticated OWNER/ORG_ADMIN/
 * CLINIC_MANAGER of that same organization), so the only path was a manual,
 * unaudited DB mutation.
 *
 * These tests run against a real PostgreSQL through the real Prisma client and
 * drive the real route handler, matching platformAdmin.test.ts's approach. The
 * router-level authenticatePlatformAdmin/csrfProtection middlewares live on the
 * router's `use` stack rather than the route's own stack, so invoking the route
 * chain directly exercises the handler with an explicitly supplied
 * req.platformAdmin — auth itself is covered by platformAdmin.test.ts and
 * platformAdminSessionRevocation.test.ts and is not re-tested here.
 *
 * Scenarios:
 *   Happy path:
 *    - creates a User that normalizeRole() resolves to OWNER
 *    - creates the matching UserClinic row
 *    - sets Organization.ownerId when the org had none
 *    - creates exactly one unused PasswordResetToken, stored hashed
 *    - writes exactly one platform_clinic.owner_bootstrapped audit row
 *    - the audit row keys on the user id and never contains the email (PII)
 *    - the response never exposes a password or password hash
 *    - each bootstrap gets a distinct bcrypt hash of a discarded secret
 *   Bootstrap-only guarantee:
 *    - 409 CLINIC_NOT_EMPTY when the clinic already has any user
 *    - the refusal creates no user and no audit row
 *   Tenant-scope derivation:
 *    - organizationId comes from the clinic row, not the request body
 *   Validation and conflicts:
 *    - 404 for an unknown clinic
 *    - 400 for a missing/invalid email and for a missing name
 *    - 409 EMAIL_ALREADY_EXISTS for a case-insensitively taken address
 *    - 402 when the clinic's plan allows fewer than one user
 *   Atomicity:
 *    - a forced audit-insert failure rolls back user, UserClinic, reset token
 *      and Organization.ownerId together
 *   Owner authentication and tenant scope:
 *    - the issued token sets the password through the real reset-password route
 *    - the token cannot be replayed
 *    - the owner can then log in through the real login route
 *    - the session sees its own organization's clinics and no other org's
 *    - a wrong password 401s; a deactivated owner 403s
 *   Reversibility:
 *    - PATCH /users/:id/status deactivates the bootstrapped owner and audits it
 */

import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';

process.env.PLATFORM_BEARER_FALLBACK_ENABLED = 'true';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'f'.repeat(64);
// sendMail() short-circuits to { sent: false } unless MAIL_ENABLED === 'true',
// so the suite never opens an SMTP connection and the emailSent branch is
// deterministic. Pinned explicitly rather than relying on it being unset.
process.env.MAIL_ENABLED = 'false';

import prisma from '../db.js';
import platformAdminRouter from '../routes/platformAdmin.js';
import authRouter from '../routes/auth.js';
import { normalizeRole } from '../utils/roles.js';

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: unknown) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

interface RouterLike { stack: any[] }

function getRouteMiddlewareChain(router: RouterLike, method: 'get' | 'post' | 'patch', path: string) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods?.[method]) {
      return layer.route.stack.map((s: any) => s.handle);
    }
  }
  throw new Error(`No route handler found for ${method.toUpperCase()} ${path}`);
}

async function runChain(
  chain: Array<(req: any, res: any, next: () => void) => void | Promise<void>>,
  req: any,
  res: any,
): Promise<void> {
  for (const fn of chain) {
    let calledNext = false;
    await fn(req, res, () => { calledNext = true; });
    if (!calledNext) return;
  }
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    cookies: {} as Record<string, string>,
    headers: {} as Record<string, unknown>,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    // The clinic login route issues session cookies; the platform-admin routes
    // do not. Stubbed here so one res shape serves both.
    cookie(name: string, value: string) { this.cookies[name] = value; return this; },
    clearCookie(name: string) { delete this.cookies[name]; return this; },
    setHeader(name: string, value: unknown) { this.headers[name] = value; return this; },
    getHeader(name: string) { return this.headers[name]; },
    append(name: string, value: unknown) { this.headers[name] = value; return this; },
  };
  return res;
}

const suffix = randomUUID().slice(0, 8);
const ADMIN_ID = `g1boot-admin-${suffix}`;

function adminReq(
  body: Record<string, unknown> = {},
  params: Record<string, string> = {},
  actorId: string = ADMIN_ID,
) {
  return { body, params, platformAdmin: { id: actorId, email: `${actorId}@platform.test` } } as any;
}

async function bootstrapOwner(body: Record<string, unknown>, clinicId: string, actorId = ADMIN_ID) {
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/clinics/:id/owner');
  const res = mockRes();
  await runChain(chain, adminReq(body, { id: clinicId }, actorId), res);
  return res;
}

async function ownerAuditRows(userId: string) {
  return prisma.platformAdminAuditEvent.findMany({
    where: { resourceType: 'user', resourceKey: userId, action: 'platform_clinic.owner_bootstrapped' },
    orderBy: { createdAt: 'asc' },
  });
}

/** A fresh org+clinic with zero users, the exact state POST /clinics leaves behind. */
async function createEmptyClinic(tag: string, maxUsers = 10) {
  const s = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({
    data: { name: `G1 Boot Org ${tag}`, slug: `g1boot-org-${tag}-${s}`, status: 'active' },
  });
  const clinic = await prisma.clinic.create({
    data: {
      name: `G1 Boot Clinic ${tag}`,
      slug: `g1boot-clinic-${tag}-${s}`,
      organizationId: org.id,
      status: 'active',
      maxUsers,
    },
  });
  return { org, clinic };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

// PlatformAdminAuditEvent.actorPlatformAdminId is a real FK to PlatformAdmin(id),
// so a real actor row must exist for the success paths — and must NOT exist for
// the forced-rollback path, which is exactly how that test forces the failure.
const adminFixture = await prisma.platformAdmin.create({
  data: {
    id: ADMIN_ID,
    email: `${ADMIN_ID}@platform.test`,
    passwordHash: 'not-a-real-hash-test-fixture-only',
    name: 'G1 Bootstrap',
    isActive: true,
  },
});

const createdUserIds: string[] = [];
const createdClinicIds: string[] = [];
const createdOrgIds: string[] = [];

function trackTenant(org: { id: string }, clinic: { id: string }) {
  createdOrgIds.push(org.id);
  createdClinicIds.push(clinic.id);
}

console.log('\nPOST /api/platform/clinics/:id/owner — first-OWNER bootstrap');

// ── Happy path ───────────────────────────────────────────────────────────────

section('Happy path');

const happy = await createEmptyClinic('happy');
trackTenant(happy.org, happy.clinic);
const happyEmail = `g1boot-owner-${suffix}@example.test`;
const happyRes = await bootstrapOwner(
  { firstName: 'Ada', lastName: 'Yılmaz', email: happyEmail, phone: '+905550000001' },
  happy.clinic.id,
);
if (happyRes.body?.id) createdUserIds.push(happyRes.body.id);

await test('returns 201 and reports the normalized role as OWNER', async () => {
  assert.equal(happyRes.statusCode, 201, `expected 201, got ${happyRes.statusCode}: ${JSON.stringify(happyRes.body)}`);
  assert.equal(happyRes.body.normalizedRole, 'OWNER');
  assert.equal(happyRes.body.clinicId, happy.clinic.id);
  assert.equal(happyRes.body.organizationId, happy.org.id);
});

await test('the created User normalizes to OWNER and is scoped to the clinic', async () => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: happyRes.body.id } });
  assert.equal(normalizeRole(user.role, user.canAccessAllClinics), 'OWNER');
  assert.equal(user.clinicId, happy.clinic.id);
  assert.equal(user.organizationId, happy.org.id);
  assert.equal(user.isActive, true);
  assert.equal(user.email, happyEmail.toLowerCase());
});

await test('login preconditions are satisfied: emailVerifiedAt is set and defaultClinicId points at the clinic', async () => {
  // routes/auth.ts rejects a login when emailVerifiedAt is null, so a
  // bootstrapped owner without it would be created but permanently locked out.
  const user = await prisma.user.findUniqueOrThrow({ where: { id: happyRes.body.id } });
  assert.notEqual(user.emailVerifiedAt, null);
  assert.equal(user.defaultClinicId, happy.clinic.id);
});

await test('a matching UserClinic row is created for the clinic', async () => {
  const link = await prisma.userClinic.findFirst({
    where: { userId: happyRes.body.id, clinicId: happy.clinic.id },
  });
  assert.ok(link, 'UserClinic row must exist');
  assert.equal(link!.isActive, true);
});

await test('Organization.ownerId is set to the bootstrapped owner when the org had none', async () => {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: happy.org.id } });
  assert.equal(org.ownerId, happyRes.body.id);
});

await test('exactly one unused PasswordResetToken is created, stored hashed and expiring within the hour', async () => {
  const tokens = await prisma.passwordResetToken.findMany({ where: { userId: happyRes.body.id } });
  assert.equal(tokens.length, 1);
  const token = tokens[0]!;
  assert.equal(token.usedAt, null);
  assert.match(token.tokenHash, /^[0-9a-f]{64}$/, 'the raw token must never be stored — only its sha256 hex digest');
  const ttlMinutes = (token.expiresAt.getTime() - Date.now()) / 60000;
  assert.ok(ttlMinutes > 0 && ttlMinutes <= 60, `expected a TTL within 60 minutes, got ${ttlMinutes}`);
});

await test('the returned setPasswordUrl carries the raw token whose digest is the stored hash', async () => {
  // MAIL_ENABLED=false, so the link is returned as the documented fallback.
  assert.equal(happyRes.body.emailSent, false);
  assert.ok(typeof happyRes.body.setPasswordUrl === 'string', 'link must be returned when the email could not be sent');
  const rawToken = new URL(happyRes.body.setPasswordUrl).searchParams.get('token');
  assert.ok(rawToken, 'the link must carry a token parameter');
  const digest = crypto.createHash('sha256').update(rawToken!).digest('hex');
  const token = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: happyRes.body.id } });
  assert.equal(digest, token.tokenHash);
});

await test('exactly one platform_clinic.owner_bootstrapped audit row is written, keyed on the user id', async () => {
  const rows = await ownerAuditRows(happyRes.body.id);
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.actorPlatformAdminId, ADMIN_ID);
  assert.equal(row.resourceType, 'user');
  assert.equal(row.resourceKey, happyRes.body.id);
  assert.equal(row.previousValue, null);
  assert.equal(row.outcome, 'success');
  const newValue = JSON.parse(row.newValue!);
  assert.equal(newValue.clinicId, happy.clinic.id);
  assert.equal(newValue.organizationId, happy.org.id);
  assert.equal(newValue.canAccessAllClinics, true);
});

await test('the audit row contains no email address anywhere (PII minimization)', async () => {
  const rows = await ownerAuditRows(happyRes.body.id);
  const serialized = JSON.stringify(rows[0]);
  assert.ok(!serialized.includes(happyEmail), 'the owner email must never reach the audit row');
  assert.ok(!/@/.test(String(rows[0]!.newValue ?? '')), 'newValue must not carry an address-shaped value');
});

await test('the response body exposes no password or password hash', async () => {
  const serialized = JSON.stringify(happyRes.body);
  assert.ok(!/passwordHash/i.test(serialized));
  assert.ok(!/"password"/i.test(serialized));
});

await test('the stored password hash is bcrypt and differs per bootstrap (a discarded random secret)', async () => {
  const second = await createEmptyClinic('hash');
  trackTenant(second.org, second.clinic);
  const res = await bootstrapOwner(
    { firstName: 'Bora', lastName: 'Demir', email: `g1boot-hash-${suffix}@example.test` },
    second.clinic.id,
  );
  assert.equal(res.statusCode, 201);
  createdUserIds.push(res.body.id);

  const a = await prisma.user.findUniqueOrThrow({ where: { id: happyRes.body.id }, select: { passwordHash: true } });
  const b = await prisma.user.findUniqueOrThrow({ where: { id: res.body.id }, select: { passwordHash: true } });
  assert.match(a.passwordHash, /^\$2[aby]\$/, 'must be a bcrypt hash');
  assert.match(b.passwordHash, /^\$2[aby]\$/);
  assert.notEqual(a.passwordHash, b.passwordHash, 'each bootstrap must hash its own random secret');
});

// ── Bootstrap-only guarantee ─────────────────────────────────────────────────

section('Bootstrap-only guarantee');

await test('a clinic that already has a user is refused with 409 CLINIC_NOT_EMPTY', async () => {
  const res = await bootstrapOwner(
    { firstName: 'Cem', lastName: 'Kaya', email: `g1boot-second-${suffix}@example.test` },
    happy.clinic.id, // already has the owner created above
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CLINIC_NOT_EMPTY');
});

await test('the refusal creates no user and no audit row', async () => {
  const users = await prisma.user.count({ where: { clinicId: happy.clinic.id } });
  assert.equal(users, 1, 'only the original bootstrapped owner may exist');
  const rows = await prisma.platformAdminAuditEvent.count({
    where: { action: 'platform_clinic.owner_bootstrapped', newValue: { contains: happy.clinic.id } },
  });
  assert.equal(rows, 1);
});

await test('a clinic seeded with a non-owner user is also refused — the guard counts users, not owners', async () => {
  const seeded = await createEmptyClinic('seeded');
  trackTenant(seeded.org, seeded.clinic);
  const receptionist = await prisma.user.create({
    data: {
      firstName: 'Deniz', lastName: 'Ak', email: `g1boot-recep-${suffix}@example.test`,
      passwordHash: 'not-a-real-hash-test-fixture-only', role: 'RECEPTIONIST',
      clinicId: seeded.clinic.id, organizationId: seeded.org.id, isActive: true,
    },
  });
  createdUserIds.push(receptionist.id);

  const res = await bootstrapOwner(
    { firstName: 'Elif', lastName: 'Su', email: `g1boot-blocked-${suffix}@example.test` },
    seeded.clinic.id,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CLINIC_NOT_EMPTY');
  assert.equal(await prisma.user.count({ where: { clinicId: seeded.clinic.id } }), 1);
});

// ── Tenant-scope derivation ──────────────────────────────────────────────────

section('Tenant-scope derivation');

await test('organizationId is taken from the clinic row and a body-supplied one is ignored', async () => {
  const target = await createEmptyClinic('scope');
  const foreign = await createEmptyClinic('foreign');
  trackTenant(target.org, target.clinic);
  trackTenant(foreign.org, foreign.clinic);

  const res = await bootstrapOwner(
    {
      firstName: 'Foreign', lastName: 'Attempt', email: `g1boot-scope-${suffix}@example.test`,
      organizationId: foreign.org.id, clinicId: foreign.clinic.id, role: 'OWNER', canAccessAllClinics: true,
    },
    target.clinic.id,
  );
  assert.equal(res.statusCode, 201);
  createdUserIds.push(res.body.id);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: res.body.id } });
  assert.equal(user.organizationId, target.org.id, 'organizationId must come from the clinic, not the body');
  assert.equal(user.clinicId, target.clinic.id);
  assert.equal(await prisma.user.count({ where: { clinicId: foreign.clinic.id } }), 0);
  assert.equal(await prisma.organization.findUniqueOrThrow({ where: { id: foreign.org.id } }).then(o => o.ownerId), null);
});

// ── Validation and conflicts ─────────────────────────────────────────────────

section('Validation and conflicts');

await test('an unknown clinic id returns 404', async () => {
  const res = await bootstrapOwner(
    { firstName: 'Ghost', lastName: 'Clinic', email: `g1boot-404-${suffix}@example.test` },
    randomUUID(),
  );
  assert.equal(res.statusCode, 404);
});

await test('a missing email returns 400 and creates nothing', async () => {
  const c = await createEmptyClinic('nomail');
  trackTenant(c.org, c.clinic);
  const res = await bootstrapOwner({ firstName: 'No', lastName: 'Mail' }, c.clinic.id);
  assert.equal(res.statusCode, 400);
  assert.equal(await prisma.user.count({ where: { clinicId: c.clinic.id } }), 0);
});

await test('a malformed email returns 400', async () => {
  const c = await createEmptyClinic('badmail');
  trackTenant(c.org, c.clinic);
  const res = await bootstrapOwner(
    { firstName: 'Bad', lastName: 'Mail', email: 'not-an-email' },
    c.clinic.id,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(await prisma.user.count({ where: { clinicId: c.clinic.id } }), 0);
});

await test('a blank first name returns 400', async () => {
  const c = await createEmptyClinic('noname');
  trackTenant(c.org, c.clinic);
  const res = await bootstrapOwner(
    { firstName: '   ', lastName: 'Nameless', email: `g1boot-noname-${suffix}@example.test` },
    c.clinic.id,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(await prisma.user.count({ where: { clinicId: c.clinic.id } }), 0);
});

await test('an email already used by another tenant returns 409 EMAIL_ALREADY_EXISTS, case-insensitively', async () => {
  const c = await createEmptyClinic('dupmail');
  trackTenant(c.org, c.clinic);
  const res = await bootstrapOwner(
    { firstName: 'Dup', lastName: 'Mail', email: happyEmail.toUpperCase() },
    c.clinic.id,
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'EMAIL_ALREADY_EXISTS');
  assert.equal(await prisma.user.count({ where: { clinicId: c.clinic.id } }), 0);
});

await test('a clinic whose plan allows fewer than one user returns 402', async () => {
  const c = await createEmptyClinic('nolimit', 0);
  trackTenant(c.org, c.clinic);
  const res = await bootstrapOwner(
    { firstName: 'Over', lastName: 'Limit', email: `g1boot-limit-${suffix}@example.test` },
    c.clinic.id,
  );
  assert.equal(res.statusCode, 402);
  assert.equal(res.body.code, 'USER_LIMIT_REACHED');
  assert.equal(await prisma.user.count({ where: { clinicId: c.clinic.id } }), 0);
});

// ── Atomicity ────────────────────────────────────────────────────────────────

section('Atomicity');

await test('a forced audit-insert failure rolls back the user, UserClinic, reset token and ownerId together', async () => {
  const c = await createEmptyClinic('ghost');
  trackTenant(c.org, c.clinic);
  const ghostActorId = `g1boot-ghost-actor-${suffix}`; // no PlatformAdmin row → FK violation
  const email = `g1boot-ghost-${suffix}@example.test`;

  const res = await bootstrapOwner(
    { firstName: 'Should', lastName: 'Rollback', email },
    c.clinic.id,
    ghostActorId,
  );
  assert.equal(res.statusCode, 500, 'the FK-violating audit insert must fail the whole request');

  assert.equal(await prisma.user.count({ where: { clinicId: c.clinic.id } }), 0, 'no user may survive');
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  assert.equal(await prisma.userClinic.count({ where: { clinicId: c.clinic.id } }), 0, 'no UserClinic may survive');
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: c.org.id } });
  assert.equal(org.ownerId, null, 'Organization.ownerId must remain unset');
  assert.equal(
    await prisma.platformAdminAuditEvent.count({ where: { actorPlatformAdminId: ghostActorId } }),
    0,
  );
});

// ── Owner authentication and tenant scope ────────────────────────────────────
//
// The bootstrap is only worth anything if the resulting account can actually
// reach the product. This section drives the real password-reset and login
// handlers end to end with the raw token the bootstrap issued.

section('Owner authentication and tenant scope');

const authTenant = await createEmptyClinic('auth');
const authForeign = await createEmptyClinic('authforeign');
trackTenant(authTenant.org, authTenant.clinic);
trackTenant(authForeign.org, authForeign.clinic);

// A second clinic inside the OWNER's own organization: an OWNER carries
// canAccessAllClinics, so this one is legitimately in scope, while
// authForeign (a different organization) must never be.
const siblingClinic = await prisma.clinic.create({
  data: {
    name: 'G1 Boot Sibling Clinic',
    slug: `g1boot-sibling-${suffix}`,
    organizationId: authTenant.org.id,
    status: 'active',
    maxUsers: 10,
  },
});
createdClinicIds.push(siblingClinic.id);

const authEmail = `g1boot-auth-${suffix}@example.test`;
const authRes = await bootstrapOwner(
  { firstName: 'Login', lastName: 'Owner', email: authEmail },
  authTenant.clinic.id,
);
if (authRes.body?.id) createdUserIds.push(authRes.body.id);
const authRawToken = authRes.body?.setPasswordUrl
  ? new URL(authRes.body.setPasswordUrl).searchParams.get('token')
  : null;

const OWNER_PASSWORD = `G1boot!${suffix}Aa9`;

function authReq(body: Record<string, unknown>) {
  return {
    body,
    params: {},
    query: {},
    headers: { 'user-agent': 'g1-preflight-test' },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    get() { return undefined; },
  } as any;
}

await test('the bootstrap token sets the owner password through the real reset-password handler', async () => {
  assert.ok(authRawToken, 'bootstrap must have issued a token');
  const chain = getRouteMiddlewareChain(authRouter as any, 'post', '/reset-password');
  const res = mockRes();
  await runChain(chain, authReq({ token: authRawToken, newPassword: OWNER_PASSWORD }), res);
  assert.equal(res.statusCode, 200, `reset failed: ${JSON.stringify(res.body)}`);

  const token = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: authRes.body.id } });
  assert.notEqual(token.usedAt, null, 'the token must be consumed');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: authRes.body.id } });
  assert.notEqual(user.passwordChangedAt, null);
});

await test('the same token cannot be replayed', async () => {
  const chain = getRouteMiddlewareChain(authRouter as any, 'post', '/reset-password');
  const res = mockRes();
  await runChain(chain, authReq({ token: authRawToken, newPassword: `${OWNER_PASSWORD}zZ` }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'RESET_TOKEN_USED');
});

await test('the bootstrapped owner can log in with the password they set', async () => {
  const chain = getRouteMiddlewareChain(authRouter as any, 'post', '/login');
  const res = mockRes();
  await runChain(chain, authReq({ email: authEmail, password: OWNER_PASSWORD }), res);
  assert.equal(res.statusCode, 200, `login failed: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.user.id, authRes.body.id);
  assert.equal(res.body.user.canAccessAllClinics, true);
  assert.equal(normalizeRole(res.body.user.role, res.body.user.canAccessAllClinics), 'OWNER');
});

await test('the login session is scoped to the owner\'s own organization only', async () => {
  const chain = getRouteMiddlewareChain(authRouter as any, 'post', '/login');
  const res = mockRes();
  await runChain(chain, authReq({ email: authEmail, password: OWNER_PASSWORD }), res);
  assert.equal(res.statusCode, 200);

  const clinicIds: string[] = res.body.user.clinics.map((c: { id: string }) => c.id);
  assert.equal(res.body.user.organizationId, authTenant.org.id);
  assert.ok(clinicIds.includes(authTenant.clinic.id), 'own clinic must be reachable');
  assert.ok(clinicIds.includes(siblingClinic.id), 'a sibling clinic in the same org is in scope for an OWNER');
  assert.ok(
    !clinicIds.includes(authForeign.clinic.id),
    'a clinic belonging to another organization must never appear in the session',
  );
});

await test('a wrong password is rejected with 401', async () => {
  const chain = getRouteMiddlewareChain(authRouter as any, 'post', '/login');
  const res = mockRes();
  await runChain(chain, authReq({ email: authEmail, password: `${OWNER_PASSWORD}-wrong` }), res);
  assert.equal(res.statusCode, 401);
});

await test('deactivating the owner blocks login — the rollback path actually bites', async () => {
  await prisma.user.update({ where: { id: authRes.body.id }, data: { isActive: false } });
  const chain = getRouteMiddlewareChain(authRouter as any, 'post', '/login');
  const res = mockRes();
  await runChain(chain, authReq({ email: authEmail, password: OWNER_PASSWORD }), res);
  assert.equal(res.statusCode, 403);
  await prisma.user.update({ where: { id: authRes.body.id }, data: { isActive: true } });
});

// ── Reversibility ────────────────────────────────────────────────────────────

section('Reversibility');

await test('PATCH /users/:id/status deactivates the bootstrapped owner and writes its own audit row', async () => {
  const chain = getRouteMiddlewareChain(platformAdminRouter as any, 'patch', '/users/:id/status');
  const res = mockRes();
  await runChain(chain, adminReq({ isActive: false }, { id: happyRes.body.id }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.isActive, false);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: happyRes.body.id } });
  assert.equal(user.isActive, false);

  const rows = await prisma.platformAdminAuditEvent.count({
    where: { resourceType: 'user', resourceKey: happyRes.body.id, action: 'platform_user.status_updated' },
  });
  assert.equal(rows, 1);

  // Restore so cleanup below is unaffected by state left here.
  await prisma.user.update({ where: { id: happyRes.body.id }, data: { isActive: true } });
});

// ── Cleanup ──────────────────────────────────────────────────────────────────

await prisma.platformAdminAuditEvent.deleteMany({ where: { actorPlatformAdminId: ADMIN_ID } });
await prisma.passwordResetToken.deleteMany({ where: { userId: { in: createdUserIds } } });
await prisma.userClinic.deleteMany({ where: { userId: { in: createdUserIds } } });
// The real login / reset-password handlers exercised above write ActivityLog
// and SecuritySignalEvent rows that hold FKs onto these users and clinics.
await prisma.activityLog.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
await prisma.activityLog.deleteMany({ where: { userId: { in: createdUserIds } } });
await prisma.securitySignalEvent.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
await prisma.securitySignalEvent.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
await prisma.auditLog.deleteMany({ where: { clinicId: { in: createdClinicIds } } });
await prisma.organization.updateMany({ where: { id: { in: createdOrgIds } }, data: { ownerId: null } });
await prisma.user.updateMany({ where: { id: { in: createdUserIds } }, data: { defaultClinicId: null } });
await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
await prisma.clinic.deleteMany({ where: { id: { in: createdClinicIds } } });
await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
await prisma.platformAdmin.delete({ where: { id: adminFixture.id } });
await prisma.$disconnect();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
