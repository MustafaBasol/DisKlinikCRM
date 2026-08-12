/**
 * platformAdminSessionRevocation.test.ts — F3-SEC-002-R1 Platform Admin JWT
 * session revocation / credential-change kill switch.
 *
 * Focused, DB-backed coverage of the authenticatePlatformAdmin() revocation
 * contract (middleware/platformAuth.ts): a Platform Admin JWT is no longer
 * accepted on signature/expiry alone — the admin row must still exist and be
 * active, and — once the admin has a recorded `passwordChangedAt` — the
 * token's `credentialVersion` claim must exactly equal
 * `passwordChangedAt.getTime()`.
 *
 * R1 supersedes the original `iat`-vs-`passwordChangedAt` comparison: JWT
 * `iat` has one-second resolution, so `iat < checkpoint` cannot reliably
 * order a token issuance and a password reset that land in the same
 * wall-clock second. The exact `credentialVersion` claim has no such
 * ambiguity, so none of the tests below need to sleep past a second
 * boundary to get a deterministic result — see the "same-second" test in
 * particular (required case #4/#9).
 *
 * Some required scenarios for this task are covered elsewhere and are not
 * duplicated here:
 *   - "password reset changes the DB checkpoint" / "old token fails after
 *     recovery" / "new token works" via the real recovery CLI — exercised
 *     end-to-end in platformAdminPasswordRecovery.test.ts ("F3-SEC-002
 *     session revocation contract" section), which also proves
 *     passwordHash + passwordChangedAt commit atomically.
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

const PLATFORM_SECRET = process.env.PLATFORM_JWT_SECRET || 'platform-admin-secret-change-this';

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

// ── iat defense-in-depth (unchanged by R1; retained for coverage) ────────

section('authenticatePlatformAdmin — malformed/missing iat');

await test('a token with no iat claim is rejected, even for an otherwise-valid active admin with no invalidation checkpoint', async () => {
  const admin = await fixtureAdmin();
  const token = jwt.sign(
    { type: 'platform_admin', sub: admin.id, id: admin.id, email: admin.email, jti: crypto.randomUUID() },
    PLATFORM_SECRET,
    { expiresIn: '8h', noTimestamp: true },
  );

  const req = bearerReq(token);
  const res = mockRes();
  let nextCalled = false;

  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false, 'a token with no iat must never be trusted');
  assert.equal(res.statusCode, 401);
});

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// jwt.sign() itself validates and rejects a non-numeric `iat` at sign time
// ("iat" should be a number of seconds) — there is no library-supported way
// to produce one. Proving the middleware's own defense in depth requires
// hand-crafting the token: build header.payload manually and sign it with
// the same HMAC-SHA256 algorithm jsonwebtoken uses internally, bypassing
// only its input validation, not its signature scheme.
function signHs256(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

await test('a token with a non-numeric iat claim is rejected', async () => {
  const admin = await fixtureAdmin();
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
    PLATFORM_SECRET,
  );

  const req = bearerReq(token);
  const res = mockRes();
  let nextCalled = false;

  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
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

// ── 10. inactive/deleted admin rejected ──────────────────────────────────

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

// ── 1/5/6/7/8. credentialVersion-based revocation ────────────────────────

section('authenticatePlatformAdmin — credentialVersion-based revocation (F3-SEC-002-R1)');

await test('active admin + null passwordChangedAt + legacy token (no credentialVersion requirement) is accepted', async () => {
  const admin = await fixtureAdmin({ passwordChangedAt: null });
  const token = generatePlatformToken({ id: admin.id, email: admin.email });
  const res = mockRes();
  let nextCalled = false;

  await (authenticatePlatformAdmin as any)(bearerReq(token), res, () => { nextCalled = true; });

  assert.equal(nextCalled, true, 'pre-migration / never-reset rows must keep accepting their outstanding token');
});

await test('a password reset (DB checkpoint change) immediately rejects a token issued before it — even created in the same epoch second, no sleep required', async () => {
  const admin = await fixtureAdmin({ passwordChangedAt: null });

  // Issued while passwordChangedAt is still null: credentialVersion = null.
  const staleToken = generatePlatformToken({ id: admin.id, email: admin.email });

  // Reset happens in the SAME tick as issuance above — deliberately no
  // sleep — proving the exact credentialVersion contract has no
  // second-resolution race, unlike the superseded iat-based comparison.
  const checkpoint = new Date();
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { passwordChangedAt: checkpoint } });

  const staleRes = mockRes();
  let staleNext = false;
  await (authenticatePlatformAdmin as any)(bearerReq(staleToken), staleRes, () => { staleNext = true; });
  assert.equal(staleNext, false, 'a token issued before the reset (credentialVersion=null) must be rejected once the DB checkpoint is non-null');
  assert.equal(staleRes.statusCode, 401);

  // New login after the reset: the real login route re-reads the admin row
  // and passes its current passwordChangedAt into generatePlatformToken —
  // simulated here the same way.
  const freshToken = generatePlatformToken({ id: admin.id, email: admin.email, passwordChangedAt: checkpoint });

  const freshRes = mockRes();
  let freshNext = false;
  await (authenticatePlatformAdmin as any)(bearerReq(freshToken), freshRes, () => { freshNext = true; });
  assert.equal(freshNext, true, 'a token carrying the exact current credentialVersion must be accepted immediately after the reset');
});

await test('a token with a missing credentialVersion claim is rejected once the DB checkpoint is non-null', async () => {
  const admin = await fixtureAdmin();
  const checkpoint = new Date();
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { passwordChangedAt: checkpoint } });

  const token = jwt.sign(
    { type: 'platform_admin', sub: admin.id, id: admin.id, email: admin.email, jti: crypto.randomUUID() },
    PLATFORM_SECRET,
    { expiresIn: '8h' },
  );

  const res = mockRes();
  let nextCalled = false;
  await (authenticatePlatformAdmin as any)(bearerReq(token), res, () => { nextCalled = true; });

  assert.equal(nextCalled, false, 'a token with no credentialVersion claim at all must never be trusted once a checkpoint exists');
  assert.equal(res.statusCode, 401);
});

await test('a token with a malformed (non-numeric) credentialVersion claim is rejected', async () => {
  const admin = await fixtureAdmin();
  const checkpoint = new Date();
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { passwordChangedAt: checkpoint } });

  const token = jwt.sign(
    {
      type: 'platform_admin',
      sub: admin.id,
      id: admin.id,
      email: admin.email,
      jti: crypto.randomUUID(),
      credentialVersion: String(checkpoint.getTime()), // stringified — wrong type
    },
    PLATFORM_SECRET,
    { expiresIn: '8h' },
  );

  const res = mockRes();
  let nextCalled = false;
  await (authenticatePlatformAdmin as any)(bearerReq(token), res, () => { nextCalled = true; });

  assert.equal(nextCalled, false, 'a non-numeric credentialVersion must never be accepted, even if its string form "looks right"');
  assert.equal(res.statusCode, 401);
});

await test('a token carrying a stale (old) credentialVersion is rejected after a second reset', async () => {
  const admin = await fixtureAdmin();
  const firstCheckpoint = new Date();
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { passwordChangedAt: firstCheckpoint } });

  const oldToken = generatePlatformToken({ id: admin.id, email: admin.email, passwordChangedAt: firstCheckpoint });

  const validRes = mockRes();
  let validNext = false;
  await (authenticatePlatformAdmin as any)(bearerReq(oldToken), validRes, () => { validNext = true; });
  assert.equal(validNext, true, 'sanity: the token is valid against the first checkpoint');

  // Second reset, deliberately with a checkpoint that may land in the same
  // second as the first — the exact getTime() values still differ (or, in
  // the rare exact-collision case, the test asserts the actually-observed
  // outcome below rather than assuming a collision away).
  const secondCheckpoint = new Date(firstCheckpoint.getTime() + 1);
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { passwordChangedAt: secondCheckpoint } });

  const staleRes = mockRes();
  let staleNext = false;
  await (authenticatePlatformAdmin as any)(bearerReq(oldToken), staleRes, () => { staleNext = true; });
  assert.equal(staleNext, false, 'a token bearing the previous credentialVersion must be rejected after a subsequent reset');
  assert.equal(staleRes.statusCode, 401);

  const newToken = generatePlatformToken({ id: admin.id, email: admin.email, passwordChangedAt: secondCheckpoint });
  const newRes = mockRes();
  let newNext = false;
  await (authenticatePlatformAdmin as any)(bearerReq(newToken), newRes, () => { newNext = true; });
  assert.equal(newNext, true, 'a token carrying the new exact credentialVersion must be accepted');
});

await test('an active admin with a non-null passwordChangedAt and the exact matching credentialVersion is accepted (round-trip)', async () => {
  const admin = await fixtureAdmin();
  const checkpoint = new Date();
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { passwordChangedAt: checkpoint } });

  const token = generatePlatformToken({ id: admin.id, email: admin.email, passwordChangedAt: checkpoint });
  const res = mockRes();
  let nextCalled = false;
  await (authenticatePlatformAdmin as any)(bearerReq(token), res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

// ── 11. cross-admin isolation ────────────────────────────────────────────

section('authenticatePlatformAdmin — cross-admin isolation');

await test("one admin's revoked token does not affect another admin's still-valid token", async () => {
  const revokedAdmin = await fixtureAdmin();
  const untouchedAdmin = await fixtureAdmin();

  const revokedAdminStaleToken = generatePlatformToken({ id: revokedAdmin.id, email: revokedAdmin.email });
  const untouchedAdminToken = generatePlatformToken({ id: untouchedAdmin.id, email: untouchedAdmin.email });

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

await test('a token whose `sub` names admin A cannot be authenticated as admin B, even with a credentialVersion that would satisfy B', async () => {
  const admin = await fixtureAdmin({ passwordChangedAt: null });
  const otherAdmin = await fixtureAdmin();
  const otherCheckpoint = new Date();
  await prisma.platformAdmin.update({ where: { id: otherAdmin.id }, data: { passwordChangedAt: otherCheckpoint } });

  // A token naming `admin`'s id but carrying otherAdmin's exact
  // credentialVersion must still resolve to admin's own DB-backed state
  // (null checkpoint → the claim is immaterial and this succeeds), never to
  // otherAdmin's identity.
  const token = jwt.sign(
    {
      type: 'platform_admin',
      sub: admin.id,
      id: admin.id,
      email: admin.email,
      jti: crypto.randomUUID(),
      credentialVersion: otherCheckpoint.getTime(),
    },
    PLATFORM_SECRET,
    { expiresIn: '8h' },
  );

  const req = bearerReq(token);
  const res = mockRes();
  let nextCalled = false;
  await (authenticatePlatformAdmin as any)(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true, "admin's own (null-checkpoint) state must govern — otherAdmin's credentialVersion must not leak across rows");
  assert.equal(req.platformAdmin?.id, admin.id, 'the resolved identity must be admin, never otherAdmin');
});

// ── 12. no sensitive logging ─────────────────────────────────────────────

section('authenticatePlatformAdmin — no sensitive logging');

await test('no console output from any auth outcome (accept, reject, revoked) ever contains the token, email, or password hash', async () => {
  const admin = await fixtureAdmin();
  const validToken = generatePlatformToken({ id: admin.id, email: admin.email });

  const checkpoint = new Date();
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { passwordChangedAt: checkpoint } });
  const revokedToken = validToken; // now-stale relative to the checkpoint just set (credentialVersion=null)

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
    const freshToken = generatePlatformToken({ id: admin.id, email: admin.email, passwordChangedAt: checkpoint });
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
    assert.ok(!combined.includes(String(checkpoint.getTime())), 'no log line may contain a raw credentialVersion value');
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
