/**
 * platformAdminLoginTotpGate.test.ts — F3-SEC-EXIT-001-R4 (Lane A)
 *
 * Route/DB integration assurance for the Platform Admin login-time MFA gate:
 * `POST /api/platform/auth/login` (`server/src/routes/platformAdmin.ts:62-128`).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * F3-EXIT-C2 §16.3 / §17.9 recorded `MFA_NEGATIVE_TEST_COVERAGE = FAIL`: no
 * test in this repository has ever called `POST /auth/login` with a request
 * body, so the login route's own OTP branch had zero coverage. The adjacent
 * suites cover genuinely different surfaces and must not be conflated with it:
 *
 *   - `totp.test.ts`                        — the TOTP crypto primitive only.
 *   - `platformAdmin.test.ts`               — the MFA *enrollment* endpoints
 *                                             (`/auth/mfa/setup|verify|disable`).
 *   - `platformAdminSessionRevocation.test.ts` — `authenticatePlatformAdmin`,
 *                                             i.e. *subsequent* requests.
 *   - `platformAdminPasswordRecovery.test.ts`  — mints tokens directly and
 *                                             documents in-file that it
 *                                             simulates, not calls, login.
 *
 * A future change could reintroduce a login bypass (an early `return`, a
 * reordered conditional) and every one of those suites would keep passing.
 * This file closes exactly that gap and nothing wider.
 *
 * SCOPE DISCIPLINE
 * ----------------
 * This suite changes no runtime behaviour. Where the route's current
 * behaviour is a deliberate design decision (optional enrollment) or a
 * pre-existing asymmetry, it is pinned as a *characterization* test and
 * labelled as such — it is NOT "corrected" here. Two such asymmetries are
 * documented inline below (raw-vs-normalized email lookup; the missing-OTP
 * path not consuming rate-limit budget). Neither is fixed by this task.
 *
 * Uses isolated fixture PlatformAdmin rows (unique @platform.test emails)
 * against a real disposable Postgres database, cleaned up at the end.
 *
 * Run: cd server && npx tsx src/tests/platformAdminLoginTotpGate.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import 'dotenv/config';

// `utils/encryption.ts` reads ENCRYPTION_KEY at first use and throws unless it
// is exactly 64 hex chars; same convention as platformAdmin.test.ts:52.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'f'.repeat(64);

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import platformAdminRouter from '../routes/platformAdmin.js';
import { generateTotpSecret, generateTotp } from '../utils/totp.js';
import { encryptSecretTagged } from '../utils/encryption.js';
import { hashAccountIdentifier } from '../services/security/securitySignalService.js';
import { PLATFORM_SESSION_COOKIE, PLATFORM_CSRF_COOKIE } from '../utils/sessionCookies.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ok ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  FAIL ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ── router-invocation harness (mirrors platformAdmin.test.ts:573-600) ───────
//
// `/auth/login` is declared at platformAdmin.ts:62, BEFORE the
// `router.use(authenticatePlatformAdmin, csrfProtection('platform'))` at :154.
// Express applies `router.use` only to layers registered after it, so the
// login route's stack contains exactly one handler and this extraction
// exercises the complete, real production behaviour with no bypass caveat.
type RouterLike = { stack: Array<any> };

function getRouteMiddlewareChain(
  router: RouterLike,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
) {
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
    await fn(req, res, () => {
      calledNext = true;
    });
    if (!calledNext) return;
  }
}

/**
 * Unlike every existing mock `res` in this repository, this one implements
 * `cookie()`. The login success path calls `issueSessionCookies()`
 * (sessionCookies.ts:178-188), which calls `res.cookie()` twice; without it
 * the handler would throw into its own `catch` and a "success" assertion
 * would silently be asserting a 500. It also gives us the assertion this
 * suite actually needs: that failed MFA issues NO cookie at all.
 */
function mockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    cookies: [] as Array<{ name: string; value: string; options: any }>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    cookie(name: string, value: string, options: any) {
      this.cookies.push({ name, value, options });
      return this;
    },
  };
  return res;
}

// The two login rate limiters are module-level singletons backed by a
// per-process in-memory Map when REDIS_URL is unset (helpers.ts:168-181,
// counterStore.ts). State therefore persists for this whole file. Giving every
// request its own IP keeps the 20/IP/15min limiter from coupling unrelated
// tests; the tests that deliberately exercise a limiter pin their own IP.
// 203.0.113.0/24 is TEST-NET-3 (RFC 5737), reserved for documentation.
let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  if (ipCounter > 250) throw new Error('test IP pool exhausted — add another TEST-NET block');
  return `203.0.113.${ipCounter}`;
}

const loginChain = getRouteMiddlewareChain(platformAdminRouter as any, 'post', '/auth/login');

async function login(body: Record<string, unknown>, ip: string = nextIp()) {
  const req: any = { body, ip, headers: {} };
  const res = mockRes();
  await runChain(loginChain, req, res);
  return res;
}

// ── fixtures ───────────────────────────────────────────────────────────────

const FIXTURE_PASSWORD = 'Str0ngTestPassword!MFA-Gate-R4';
// Hashed once and reused: bcryptjs is pure JS, and this suite creates enough
// fixtures that per-fixture hashing would dominate its runtime.
const FIXTURE_PASSWORD_HASH = await bcrypt.hash(FIXTURE_PASSWORD, 10);

const createdAdminIds: string[] = [];
const usedEmails: string[] = [];

async function fixtureAdmin(
  opts: {
    /** Arms the login MFA gate: sets both totpEnabledAt and an encrypted secret. */
    enrolled?: boolean;
    isActive?: boolean;
    /** Structurally inconsistent state: totpEnabledAt set, secret column NULL. */
    enabledWithoutSecret?: boolean;
  } = {},
) {
  const enrolled = opts.enrolled ?? false;
  const enabledWithoutSecret = opts.enabledWithoutSecret ?? false;
  const secret = enrolled ? generateTotpSecret() : null;
  const email = `f3-r4-login-mfa-${crypto.randomUUID()}@platform.test`;

  const admin = await prisma.platformAdmin.create({
    data: {
      email,
      passwordHash: FIXTURE_PASSWORD_HASH,
      name: 'F3-SEC-EXIT-001-R4 Login MFA Gate Fixture',
      isActive: opts.isActive ?? true,
      totpSecretEncrypted: secret ? encryptSecretTagged(secret) : null,
      totpEnabledAt: enrolled || enabledWithoutSecret ? new Date() : null,
    },
  });

  createdAdminIds.push(admin.id);
  usedEmails.push(email);
  return { admin, secret, email };
}

/**
 * A well-formed 6-digit code guaranteed not to be accepted: verifyTotp checks
 * a ±1 step window, so all three currently-valid codes are excluded by
 * construction rather than by assuming '000000' happens to be wrong.
 */
function wrongCodeFor(secret: string): string {
  const now = Date.now();
  const valid = new Set([
    generateTotp(secret, now - 30_000),
    generateTotp(secret, now),
    generateTotp(secret, now + 30_000),
  ]);
  for (let i = 0; i < 1000; i++) {
    const candidate = String(i).padStart(6, '0');
    if (!valid.has(candidate)) return candidate;
  }
  throw new Error('unable to derive an invalid TOTP code');
}

function assertNoSessionIssued(res: any) {
  assert.equal(res.cookies.length, 0, 'no cookie may be set on a failed login');
  assert.equal(
    res.body?.csrfToken,
    undefined,
    'no CSRF token may be returned on a failed login',
  );
  assert.equal(res.body?.admin, undefined, 'no admin payload may be returned on a failed login');
}

// ── 1. enrolled admin — the gate must fail closed ──────────────────────────

section('1. Enrolled admin: login fails closed without a valid OTP');

await test('enrolled + correct password + missing totpCode => 401 MFA_REQUIRED, no session', async () => {
  const { email } = await fixtureAdmin({ enrolled: true });
  const res = await login({ email, password: FIXTURE_PASSWORD });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'MFA_REQUIRED');
  assert.equal(res.body.error, 'MFA code required');
  assertNoSessionIssued(res);
});

await test('enrolled + totpCode: null => 401 MFA_REQUIRED (nullish coalescing to empty)', async () => {
  const { email } = await fixtureAdmin({ enrolled: true });
  const res = await login({ email, password: FIXTURE_PASSWORD, totpCode: null });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'MFA_REQUIRED');
  assertNoSessionIssued(res);
});

await test('enrolled + whitespace-only totpCode => 401 MFA_REQUIRED (trimmed to empty)', async () => {
  const { email } = await fixtureAdmin({ enrolled: true });
  const res = await login({ email, password: FIXTURE_PASSWORD, totpCode: '    ' });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'MFA_REQUIRED');
  assertNoSessionIssued(res);
});

await test('enrolled + invalid OTP => 401 MFA_INVALID, no session', async () => {
  const { email, secret } = await fixtureAdmin({ enrolled: true });
  const res = await login({ email, password: FIXTURE_PASSWORD, totpCode: wrongCodeFor(secret!) });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'MFA_INVALID');
  assert.equal(res.body.error, 'Invalid MFA code');
  assertNoSessionIssued(res);
});

await test('enrolled + valid OTP => 200 and a real session is issued', async () => {
  const { admin, email, secret } = await fixtureAdmin({ enrolled: true });
  const res = await login({ email, password: FIXTURE_PASSWORD, totpCode: generateTotp(secret!) });

  assert.equal(res.statusCode, 200, 'valid OTP must authenticate');
  assert.ok(res.body.csrfToken, 'a CSRF token must be returned');
  assert.equal(res.body.admin.id, admin.id);
  assert.equal(res.body.admin.email, email);

  const names = res.cookies.map((c: any) => c.name);
  assert.ok(names.includes(PLATFORM_SESSION_COOKIE), 'platform session cookie must be set');
  assert.ok(names.includes(PLATFORM_CSRF_COOKIE), 'platform CSRF cookie must be set');

  const sessionCookie = res.cookies.find((c: any) => c.name === PLATFORM_SESSION_COOKIE);
  assert.equal(sessionCookie.options.httpOnly, true, 'session cookie must be httpOnly');
});

await test('success response leaks no credential or MFA secret material', async () => {
  const { email, secret } = await fixtureAdmin({ enrolled: true });
  const res = await login({ email, password: FIXTURE_PASSWORD, totpCode: generateTotp(secret!) });

  assert.equal(res.statusCode, 200);
  const serialized = JSON.stringify(res.body);
  assert.equal(res.body.admin.passwordHash, undefined, 'passwordHash must not be returned');
  assert.equal(res.body.admin.totpSecretEncrypted, undefined, 'TOTP secret must not be returned');
  assert.equal(res.body.admin.totpEnabledAt, undefined, 'enrollment state must not be returned');
  assert.ok(!serialized.includes(secret!), 'the plaintext TOTP secret must never appear in a response');
  assert.ok(
    !serialized.includes(FIXTURE_PASSWORD),
    'the plaintext password must never appear in a response',
  );
  assert.deepEqual(
    Object.keys(res.body.admin).sort(),
    ['createdAt', 'email', 'id', 'name'],
    'admin payload shape must stay exactly {id,name,email,createdAt}',
  );
});

// ── 2. malformed OTP input ─────────────────────────────────────────────────

section('2. Malformed OTP input is rejected, never accepted');

for (const [label, totpCode] of [
  ['non-numeric', 'abcdef'],
  ['too short', '12345'],
  ['too long', '1234567'],
  ['mixed alphanumeric', '12a456'],
  ['object coerced to [object Object]', { toString: () => '[object Object]' }],
  ['numeric zero', 0],
] as Array<[string, unknown]>) {
  await test(`enrolled + malformed OTP (${label}) => 401 MFA_INVALID, no session`, async () => {
    const { email } = await fixtureAdmin({ enrolled: true });
    const res = await login({ email, password: FIXTURE_PASSWORD, totpCode });

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'MFA_INVALID');
    assertNoSessionIssued(res);
  });
}

await test('CHARACTERIZATION: a numeric valid OTP is accepted via String() coercion', async () => {
  const { email, secret } = await fixtureAdmin({ enrolled: true });
  const res = await login({
    email,
    password: FIXTURE_PASSWORD,
    totpCode: Number(generateTotp(secret!)),
  });

  // Pins existing behaviour: the route does String(req.body.totpCode ?? '').
  // A JSON client sending a number still authenticates. Note a leading-zero
  // code would be destroyed by Number() on the client side, which is the
  // client's problem, not this route's — recorded, not changed.
  assert.equal(res.statusCode, 200);
});

await test('CHARACTERIZATION: internal whitespace is stripped by verifyTotp', async () => {
  const { email, secret } = await fixtureAdmin({ enrolled: true });
  const code = generateTotp(secret!);
  const res = await login({
    email,
    password: FIXTURE_PASSWORD,
    totpCode: `${code.slice(0, 3)} ${code.slice(3)}`,
  });

  // verifyTotp does code.replace(/\s/g, '') before its /^\d{6}$/ check
  // (totp.ts:84-85), so authenticator-app spacing is tolerated by design.
  assert.equal(res.statusCode, 200);
});

// ── 3. structurally inconsistent enrollment state ──────────────────────────

section('3. Inconsistent MFA state fails closed rather than open');

await test('totpEnabledAt set but secret column NULL => 401 MFA_INVALID, never a session', async () => {
  const { email } = await fixtureAdmin({ enabledWithoutSecret: true });
  const res = await login({ email, password: FIXTURE_PASSWORD, totpCode: '123456' });

  // decryptSecretTagged(null) returns null, so `!totpSecret` short-circuits
  // before verifyTotp. The gate must not degrade to password-only here.
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'MFA_INVALID');
  assertNoSessionIssued(res);
});

await test('totpEnabledAt set but secret column NULL + no OTP => still 401 MFA_REQUIRED', async () => {
  const { email } = await fixtureAdmin({ enabledWithoutSecret: true });
  const res = await login({ email, password: FIXTURE_PASSWORD });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'MFA_REQUIRED');
  assertNoSessionIssued(res);
});

// ── 4. non-enrolled and inactive admins ────────────────────────────────────

section('4. Non-enrolled and inactive admins behave as designed');

await test('non-enrolled active admin => 200 on password alone (accepted design)', async () => {
  const { email } = await fixtureAdmin({ enrolled: false });
  const res = await login({ email, password: FIXTURE_PASSWORD });

  // Enrollment is optional by design (schema.prisma: totpEnabledAt nullable,
  // no constraint). F3-EXIT-C2 §4 already recorded this as accepted, not a
  // new gap. Pinned so that a future change to it is a deliberate decision.
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.csrfToken);
  assert.ok(res.cookies.map((c: any) => c.name).includes(PLATFORM_SESSION_COOKIE));
});

await test('non-enrolled admin supplying a spurious OTP => 200, MFA branch skipped', async () => {
  const { email } = await fixtureAdmin({ enrolled: false });
  const res = await login({ email, password: FIXTURE_PASSWORD, totpCode: '000000' });

  assert.equal(res.statusCode, 200);
});

await test('inactive ENROLLED admin => 401 Invalid credentials, never MFA_REQUIRED', async () => {
  const { email } = await fixtureAdmin({ enrolled: true, isActive: false });
  const res = await login({ email, password: FIXTURE_PASSWORD });

  // isActive is checked at :78, before the MFA branch at :95 — so a
  // deactivated admin can never reach the MFA gate, and the response must not
  // reveal that the account exists or that it had MFA enrolled.
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Invalid credentials');
  assert.equal(res.body.code, undefined, 'must not expose an MFA code discriminator');
  assertNoSessionIssued(res);
});

await test('inactive non-enrolled admin => 401 Invalid credentials', async () => {
  const { email } = await fixtureAdmin({ enrolled: false, isActive: false });
  const res = await login({ email, password: FIXTURE_PASSWORD });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Invalid credentials');
  assertNoSessionIssued(res);
});

// ── 5. non-enumerating failure semantics ───────────────────────────────────

section('5. Failure responses do not enumerate accounts or MFA state');

await test('enrolled admin + WRONG password => Invalid credentials, not MFA_REQUIRED', async () => {
  const { email } = await fixtureAdmin({ enrolled: true });
  const res = await login({ email, password: 'definitely-not-the-password' });

  // This is the property the route's own comment at :93-94 claims: the MFA
  // branch sits after bcrypt, so an attacker with a wrong password cannot
  // learn whether the account has MFA enrolled.
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Invalid credentials');
  assert.equal(res.body.code, undefined, 'MFA enrollment state must not leak on a wrong password');
  assertNoSessionIssued(res);
});

await test('nonexistent / inactive / wrong-password responses are byte-identical', async () => {
  // Registered for cleanup even though no row is ever created: a failed login
  // against an unknown address still emits an auth-failure security signal
  // keyed on that address's hash, which would otherwise outlive this suite.
  const absentEmail = `f3-r4-absent-${crypto.randomUUID()}@platform.test`;
  usedEmails.push(absentEmail);
  const nonexistent = await login({ email: absentEmail, password: FIXTURE_PASSWORD });

  const { email: inactiveEmail } = await fixtureAdmin({ enrolled: true, isActive: false });
  const inactive = await login({ email: inactiveEmail, password: FIXTURE_PASSWORD });

  const { email: activeEmail } = await fixtureAdmin({ enrolled: true });
  const wrongPassword = await login({ email: activeEmail, password: 'definitely-not-the-password' });

  for (const res of [nonexistent, inactive, wrongPassword]) {
    assert.equal(res.statusCode, 401);
    assertNoSessionIssued(res);
  }
  assert.deepEqual(nonexistent.body, inactive.body);
  assert.deepEqual(inactive.body, wrongPassword.body);
  assert.deepEqual(nonexistent.body, { error: 'Invalid credentials' });
});

// ── 6. request validation ──────────────────────────────────────────────────

section('6. Request validation precedes everything else');

await test('missing password => 400 before any DB lookup', async () => {
  const { email } = await fixtureAdmin({ enrolled: true });
  const res = await login({ email });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Email and password required');
  assertNoSessionIssued(res);
});

await test('missing email => 400', async () => {
  const res = await login({ password: FIXTURE_PASSWORD });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Email and password required');
  assertNoSessionIssued(res);
});

// ── 7. rate-limit interaction (characterization only — nothing fixed here) ──

section('7. CHARACTERIZATION: how each failure path interacts with rate limiting');

await test('CHARACTERIZATION: the missing-OTP path does not consume rate-limit budget', async () => {
  const { email } = await fixtureAdmin({ enrolled: true });
  const pinnedIp = '203.0.113.251';

  // The email limiter allows 5 per 15 min (check() is `count < max`), so if
  // this path recorded an attempt the 6th call would be 429. It does not:
  // platformAdmin.ts:97-99 returns MFA_REQUIRED without calling record(),
  // unlike the MFA_INVALID branch at :102-105 which does.
  //
  // Recorded as pre-existing behaviour, NOT fixed by this task. Severity is
  // bounded — reaching this branch already requires the correct password —
  // but it means an attacker holding a valid password can probe the endpoint
  // without consuming the per-email budget. Referred out as a follow-up.
  for (let i = 0; i < 8; i++) {
    const res = await login({ email, password: FIXTURE_PASSWORD }, pinnedIp);
    assert.equal(res.statusCode, 401, `attempt ${i + 1} should still be 401`);
    assert.equal(res.body.code, 'MFA_REQUIRED', `attempt ${i + 1} should still be MFA_REQUIRED`);
  }
});

await test('the invalid-OTP path DOES consume budget and eventually 429s', async () => {
  const { email, secret } = await fixtureAdmin({ enrolled: true });
  const pinnedIp = '203.0.113.252';
  const bad = wrongCodeFor(secret!);

  for (let i = 0; i < 5; i++) {
    const res = await login({ email, password: FIXTURE_PASSWORD, totpCode: bad }, pinnedIp);
    assert.equal(res.body.code, 'MFA_INVALID', `attempt ${i + 1} should be MFA_INVALID`);
  }

  const throttled = await login({ email, password: FIXTURE_PASSWORD, totpCode: bad }, pinnedIp);
  assert.equal(throttled.statusCode, 429, 'the 6th invalid-OTP attempt must be rate limited');
  assertNoSessionIssued(throttled);
});

await test('CHARACTERIZATION: the DB lookup is case-sensitive while throttling is not', async () => {
  const { email } = await fixtureAdmin({ enrolled: false });

  // platformAdmin.ts:77 looks the admin up by the RAW `email`, while both
  // limiters key on `normalizedEmail` (:69). An upper-cased address therefore
  // fails to find an existing admin. Pinned as current behaviour; deliberately
  // NOT changed here — altering login lookup semantics is out of this lane's
  // scope and would be an authentication behaviour change.
  const exact = await login({ email, password: FIXTURE_PASSWORD });
  assert.equal(exact.statusCode, 200);

  const upper = await login({ email: email.toUpperCase(), password: FIXTURE_PASSWORD });
  assert.equal(upper.statusCode, 401);
  assert.equal(upper.body.error, 'Invalid credentials');
});

// ── cleanup ────────────────────────────────────────────────────────────────

// evaluateAuthLoginFailureSignal() is fire-and-forget (`void safely(...)`), so
// let its inserts settle before deleting, otherwise a late write could outlive
// this suite in a shared disposable database.
await new Promise((resolve) => setTimeout(resolve, 500));

await prisma.platformAdmin.deleteMany({ where: { id: { in: createdAdminIds } } });

const dedupeDimensions = usedEmails
  .map((email) => hashAccountIdentifier(email.trim().toLowerCase()))
  .filter((dimension): dimension is string => Boolean(dimension));

if (dedupeDimensions.length > 0) {
  await prisma.securitySignalEvent.deleteMany({
    where: { dedupeDimension: { in: dedupeDimensions } },
  });
}

console.log(`\n─────────────────────────────────`);
console.log(`Toplam: ${passed + failed}  ok ${passed}  FAIL ${failed}`);
if (failed > 0) {
  process.exit(1);
}
