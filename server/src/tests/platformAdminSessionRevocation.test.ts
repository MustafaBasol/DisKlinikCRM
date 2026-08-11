/**
 * platformAdminSessionRevocation.test.ts — F3-SEC-002 Platform Admin JWT
 * session revocation / credential-change kill switch.
 *
 * Focused, DB-backed coverage of the authenticatePlatformAdmin() revocation
 * contract added by this task (middleware/platformAuth.ts): a Platform
 * Admin JWT is no longer accepted on signature/expiry alone — the admin row
 * must still exist and be active, and the token's `iat` must not predate
 * the admin's persisted `passwordChangedAt` checkpoint.
 *
 * Some required scenarios for this task are covered elsewhere and are not
 * duplicated here:
 *   - "password recovery updates the invalidation timestamp" / "old token
 *     fails after recovery" / "new token works" — exercised end-to-end
 *     through the real recovery CLI in platformAdminPasswordRecovery.test.ts
 *     ("F3-SEC-002 session revocation contract" section).
 *   - "MFA disable does not invalidate sessions" — exercised in
 *     platformAdmin.test.ts's MFA disable success test.
 *
 * Uses isolated fixture PlatformAdmin rows (unique @platform.test emails)
 * against a real disposable Postgres database, cleaned up at the end.
 *
 * Run: cd server && npx tsx src/tests/platformAdminSessionRevocation.test.ts
 * Requires DATABASE_URL to point at a disposable Postgres.
 */

import 'dotenv/config';

// Exercises the middleware via Bearer tokens; production defaults to
// cookie-only, so enable the fallback explicitly for this suite (same
// convention as platformAdmin.test.ts / retentionManualRunAudit.test.ts).
process.env.PLATFORM_BEARER_FALLBACK_ENABLED = 'true';

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import prisma from '../db.js';
import { authenticatePlatformAdmin, generatePlatformToken } from '../middleware/platformAuth.js';

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

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

function bearerReq(token: string) {
  return { headers: { authorization: `Bearer ${token}` } } as any;
}

const createdAdminIds: string[] = [];
async function fixtureAdmin(overrides: {
  isActive?: boolean;
  passwordChangedAt?: Date | null;
} = {}) {
  const admin = await prisma.platformAdmin.create({
    data: {
      email: `f3-sec-002-${crypto.randomUUID()}@platform.test`,
      passwordHash: 'not-a-real-hash-test-fixture-only',
      name: 'F3-SEC-002 Test Fixture Platform Admin',
      isActive: overrides.isActive ?? true,
      passwordChangedAt: overrides.passwordChangedAt ?? null,
    },
  });
  createdAdminIds.push(admin.id);
  return admin;
}

async function sleepPastOneSecondBoundary() {
  // jwt `iat` has 1s resolution; a comparison across the same second is
  // ambiguous, so every before/after ordering test waits past a boundary.
  await new Promise((resolve) => setTimeout(resolve, 1100));
}

// ── 1. valid active admin token works ────────────────────────────────────

section('authenticatePlatformAdmin — valid active admin token');

await test('a token for a real, active admin is accepted; req.platformAdmin is populated from the DB row, not the token payload', async () => {
  const admin = await fixtureAdmin();
  // Deliberately sign with a stale email in the token payload — the
  // middleware must trust the freshly-read DB row, not the JWT claim, so a
  // renamed/updated email can never be spoofed via an old token.
  const token = generatePlatformToken({ id: admin.id, email: 'stale-claim@platform.test' });
  const req = bearerReq(token);
  const res = mockRes();
  let nextCalled = false;

  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.platformAdmin?.id, admin.id);
  assert.equal(req.platformAdmin?.email, admin.email, 'email must come from the DB row');
});

// ── 2. nonexistent admin token rejected ──────────────────────────────────

section('authenticatePlatformAdmin — nonexistent admin');

await test('a well-formed, correctly signed token for an id with no PlatformAdmin row is rejected', async () => {
  const token = generatePlatformToken({ id: crypto.randomUUID(), email: 'ghost@platform.test' });
  const req = bearerReq(token);
  const res = mockRes();
  let nextCalled = false;

  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

// ── 3. inactive admin rejected ───────────────────────────────────────────

section('authenticatePlatformAdmin — inactive admin');

await test('a token for a real but inactive admin is rejected', async () => {
  const admin = await fixtureAdmin({ isActive: false });
  const token = generatePlatformToken({ id: admin.id, email: admin.email });
  const req = bearerReq(token);
  const res = mockRes();
  let nextCalled = false;

  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

await test('deactivating a previously-active admin rejects a token that was valid moments earlier', async () => {
  const admin = await fixtureAdmin({ isActive: true });
  const token = generatePlatformToken({ id: admin.id, email: admin.email });

  const beforeRes = mockRes();
  let beforeNext = false;
  await (authenticatePlatformAdmin as any)(bearerReq(token), beforeRes, () => { beforeNext = true; });
  assert.equal(beforeNext, true, 'sanity: the token works while the admin is active');

  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { isActive: false } });

  const afterRes = mockRes();
  let afterNext = false;
  await (authenticatePlatformAdmin as any)(bearerReq(token), afterRes, () => { afterNext = true; });
  assert.equal(afterNext, false, 'the SAME token must stop working the moment isActive flips to false');
  assert.equal(afterRes.statusCode, 401);
});

// ── 4/5. token issued before/after invalidation ──────────────────────────

section('authenticatePlatformAdmin — passwordChangedAt-based revocation');

await test('a token issued before passwordChangedAt is rejected; one issued after is accepted', async () => {
  const admin = await fixtureAdmin();
  const staleToken = generatePlatformToken({ id: admin.id, email: admin.email });

  await sleepPastOneSecondBoundary();
  const invalidationCheckpoint = new Date();
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { passwordChangedAt: invalidationCheckpoint } });
  await sleepPastOneSecondBoundary();
  const freshToken = generatePlatformToken({ id: admin.id, email: admin.email });

  const staleRes = mockRes();
  let staleNext = false;
  await (authenticatePlatformAdmin as any)(bearerReq(staleToken), staleRes, () => { staleNext = true; });
  assert.equal(staleNext, false, 'a token issued before the checkpoint must be rejected');
  assert.equal(staleRes.statusCode, 401);

  const freshRes = mockRes();
  let freshNext = false;
  await (authenticatePlatformAdmin as any)(bearerReq(freshToken), freshRes, () => { freshNext = true; });
  assert.equal(freshNext, true, 'a token issued after the checkpoint must be accepted');
});

await test('a null passwordChangedAt (never invalidated) never rejects on that basis — pre-migration rows keep working', async () => {
  const admin = await fixtureAdmin({ passwordChangedAt: null });
  const token = generatePlatformToken({ id: admin.id, email: admin.email });
  const res = mockRes();
  let nextCalled = false;

  await (authenticatePlatformAdmin as any)(bearerReq(token), res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

await test('an iat exactly at the checkpoint second is accepted (boundary is exclusive: iat < checkpoint is rejected, not iat <= checkpoint)', async () => {
  const admin = await fixtureAdmin();
  const checkpoint = new Date();
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { passwordChangedAt: checkpoint } });

  const platformSecret = process.env.PLATFORM_JWT_SECRET || 'platform-admin-secret-change-this';
  const iatSeconds = Math.floor(checkpoint.getTime() / 1000);
  const token = jwt.sign(
    { type: 'platform_admin', sub: admin.id, id: admin.id, email: admin.email, jti: crypto.randomUUID(), iat: iatSeconds },
    platformSecret,
    { expiresIn: '8h' },
  );

  const res = mockRes();
  let nextCalled = false;
  await (authenticatePlatformAdmin as any)(bearerReq(token), res, () => { nextCalled = true; });
  assert.equal(nextCalled, true, 'iat == checkpoint second must not be treated as stale');
});

// ── 9. malformed/missing iat ──────────────────────────────────────────────

section('authenticatePlatformAdmin — malformed/missing iat');

await test('a token with no iat claim is rejected, even for an otherwise-valid active admin with no invalidation checkpoint', async () => {
  const admin = await fixtureAdmin();
  const platformSecret = process.env.PLATFORM_JWT_SECRET || 'platform-admin-secret-change-this';
  const token = jwt.sign(
    { type: 'platform_admin', sub: admin.id, id: admin.id, email: admin.email, jti: crypto.randomUUID() },
    platformSecret,
    { expiresIn: '8h', noTimestamp: true },
  );

  const req = bearerReq(token);
  const res = mockRes();
  let nextCalled = false;

  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false, 'a token with no iat must never be trusted to predate any future revocation');
  assert.equal(res.statusCode, 401);
});

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// jwt.sign() itself validates and rejects a non-numeric `iat` at sign time
// ("iat" should be a number of seconds) — there is no library-supported way
// to produce one. That is reassuring (every token our own code issues is
// safe by construction), but it means proving the middleware's own defense
// in depth requires hand-crafting the token: build header.payload manually
// and sign it with the same HMAC-SHA256 algorithm jsonwebtoken uses
// internally, bypassing only its input validation, not its signature
// scheme. A correctly-signed-but-malformed token is exactly the class of
// input authenticatePlatformAdmin must never trust on iat type alone.
function signHs256(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

await test('a token with a non-numeric iat claim is rejected', async () => {
  const admin = await fixtureAdmin();
  const platformSecret = process.env.PLATFORM_JWT_SECRET || 'platform-admin-secret-change-this';
  const token = signHs256(
    {
      type: 'platform_admin',
      sub: admin.id,
      id: admin.id,
      email: admin.email,
      jti: crypto.randomUUID(),
      iat: 'not-a-number',
      exp: Math.floor(Date.now() / 1000) + 8 * 3600,
    },
    platformSecret,
  );

  const req = bearerReq(token);
  const res = mockRes();
  let nextCalled = false;

  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

// ── 10. cross-admin isolation ────────────────────────────────────────────

section('authenticatePlatformAdmin — cross-admin isolation');

await test("one admin's revoked token does not affect another admin's still-valid token", async () => {
  const revokedAdmin = await fixtureAdmin();
  const untouchedAdmin = await fixtureAdmin();

  const revokedAdminStaleToken = generatePlatformToken({ id: revokedAdmin.id, email: revokedAdmin.email });
  const untouchedAdminToken = generatePlatformToken({ id: untouchedAdmin.id, email: untouchedAdmin.email });

  await sleepPastOneSecondBoundary();
  await prisma.platformAdmin.update({ where: { id: revokedAdmin.id }, data: { passwordChangedAt: new Date() } });

  const revokedRes = mockRes();
  let revokedNext = false;
  await (authenticatePlatformAdmin as any)(bearerReq(revokedAdminStaleToken), revokedRes, () => { revokedNext = true; });
  assert.equal(revokedNext, false, 'the revoked admin\'s stale token must be rejected');

  const untouchedRes = mockRes();
  let untouchedNext = false;
  await (authenticatePlatformAdmin as any)(bearerReq(untouchedAdminToken), untouchedRes, () => { untouchedNext = true; });
  assert.equal(untouchedNext, true, "a different admin's token must be completely unaffected by another admin's revocation");
});

await test('a token whose `sub` names admin A cannot be authenticated as admin B, even with identical iat', async () => {
  const admin = await fixtureAdmin();
  const otherAdmin = await fixtureAdmin();
  const platformSecret = process.env.PLATFORM_JWT_SECRET || 'platform-admin-secret-change-this';
  const iatSeconds = Math.floor(Date.now() / 1000);

  // A token naming otherAdmin's id must resolve to otherAdmin's own
  // DB-backed state, never to `admin`'s — proven by giving otherAdmin an
  // invalidation checkpoint in the future relative to this iat and
  // confirming the token (issued for `admin`, who has none) is unaffected.
  await prisma.platformAdmin.update({
    where: { id: otherAdmin.id },
    data: { passwordChangedAt: new Date((iatSeconds + 3600) * 1000) },
  });

  const token = jwt.sign(
    { type: 'platform_admin', sub: admin.id, id: admin.id, email: admin.email, jti: crypto.randomUUID(), iat: iatSeconds },
    platformSecret,
    { expiresIn: '8h' },
  );

  const req = bearerReq(token);
  const res = mockRes();
  let nextCalled = false;
  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true, "admin's own (unrevoked) state must govern — otherAdmin's future checkpoint must not leak across rows");
  assert.equal(req.platformAdmin?.id, admin.id, 'the resolved identity must be admin, never otherAdmin');
});

// ── 12. no sensitive logging ─────────────────────────────────────────────

section('authenticatePlatformAdmin — no sensitive logging');

await test('no console output from any auth outcome (accept, reject, revoked) ever contains the token, email, or password hash', async () => {
  const admin = await fixtureAdmin();
  const validToken = generatePlatformToken({ id: admin.id, email: admin.email });

  await sleepPastOneSecondBoundary();
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { passwordChangedAt: new Date() } });
  const revokedToken = validToken; // now-stale relative to the checkpoint just set

  const ghostToken = generatePlatformToken({ id: crypto.randomUUID(), email: 'ghost@platform.test' });

  const logSpy: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const capture = (...args: unknown[]) => { logSpy.push(args.map(String).join(' ')); };
  console.log = capture as any;
  console.warn = capture as any;
  console.error = capture as any;

  try {
    const freshToken = generatePlatformToken({ id: admin.id, email: admin.email });
    await (authenticatePlatformAdmin as any)(bearerReq(freshToken), mockRes(), () => {});
    await (authenticatePlatformAdmin as any)(bearerReq(revokedToken), mockRes(), () => {});
    await (authenticatePlatformAdmin as any)(bearerReq(ghostToken), mockRes(), () => {});
    await (authenticatePlatformAdmin as any)(bearerReq('not-a-real-token'), mockRes(), () => {});

    const combined = logSpy.join('\n');
    for (const token of [validToken, revokedToken, ghostToken]) {
      assert.ok(!combined.includes(token), 'no log line may contain a raw JWT');
    }
    assert.ok(!combined.includes(admin.email), 'no log line may contain the admin email');
    assert.ok(!combined.includes(admin.passwordHash), 'no log line may contain a password hash');
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

// ── cleanup ───────────────────────────────────────────────────────────────

await prisma.platformAdmin.deleteMany({ where: { id: { in: createdAdminIds } } });

console.log(`\n─────────────────────────────────`);
console.log(`Toplam: ${passed + failed}  ok ${passed}  FAIL ${failed}`);
if (failed > 0) {
  process.exit(1);
}
