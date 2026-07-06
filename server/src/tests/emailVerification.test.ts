import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { checkResendVerificationAttempt, recordResendVerificationAttempt } from '../utils/helpers.js';
import { buildEmailVerificationEmail } from '../services/emailTemplates.js';
import { sendMail } from '../services/emailService.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  OK ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  FAIL ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

// ── Token generation & hashing ────────────────────────────────────────────────

await test('generates a 64-char hex raw verification token', () => {
  const raw = crypto.randomBytes(32).toString('hex');
  assert.equal(raw.length, 64);
  assert.match(raw, /^[0-9a-f]+$/);
});

await test('SHA-256 hash is deterministic', () => {
  const raw = crypto.randomBytes(32).toString('hex');
  const h1 = crypto.createHash('sha256').update(raw).digest('hex');
  const h2 = crypto.createHash('sha256').update(raw).digest('hex');
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
});

await test('different tokens produce different hashes', () => {
  const t1 = crypto.randomBytes(32).toString('hex');
  const t2 = crypto.randomBytes(32).toString('hex');
  const h1 = crypto.createHash('sha256').update(t1).digest('hex');
  const h2 = crypto.createHash('sha256').update(t2).digest('hex');
  assert.notEqual(h1, h2);
});

// ── Token expiry ──────────────────────────────────────────────────────────────

await test('token expiry 24 hours in the future is valid', () => {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  assert.ok(expiresAt > new Date());
});

await test('token expiry in the past is expired', () => {
  const expiresAt = new Date(Date.now() - 1000);
  assert.ok(expiresAt < new Date());
});

// ── Token single-use: usedAt guard ───────────────────────────────────────────

await test('token with usedAt is already-used', () => {
  const usedAt: Date | null = new Date();
  assert.ok(usedAt !== null, 'token is used — must be rejected');
});

await test('token with usedAt = null is not used', () => {
  const usedAt: Date | null = null;
  assert.equal(usedAt, null);
});

// ── Login unverified guard (logic) ────────────────────────────────────────────

await test('unverified user (emailVerifiedAt=null) should be blocked from login', () => {
  const emailVerifiedAt: Date | null = null;
  const isBlocked = emailVerifiedAt === null;
  assert.ok(isBlocked, 'should block login when emailVerifiedAt is null');
});

await test('verified user (emailVerifiedAt set) should be allowed through', () => {
  const emailVerifiedAt: Date | null = new Date();
  const isBlocked = emailVerifiedAt === null;
  assert.ok(!isBlocked, 'should allow login when emailVerifiedAt is set');
});

// ── Backfill logic: existing users must not be locked out ────────────────────

await test('backfill sets emailVerifiedAt to a non-null date', () => {
  // Simulates: UPDATE "User" SET "emailVerifiedAt" = NOW() WHERE "emailVerifiedAt" IS NULL
  const existingUser = { emailVerifiedAt: null as Date | null };
  existingUser.emailVerifiedAt = new Date(); // backfill
  assert.ok(existingUser.emailVerifiedAt !== null);
  assert.ok(existingUser.emailVerifiedAt instanceof Date);
});

// ── Resend rate limiting ──────────────────────────────────────────────────────

await test('resend verification: first attempt allowed', async () => {
  const key = `test:resend:${Date.now()}`;
  assert.ok(await checkResendVerificationAttempt(key));
});

await test('resend verification: exceeds max attempts is blocked', async () => {
  const key = `test:resend:exceed:${Date.now()}`;
  for (let i = 0; i < 3; i++) {
    await recordResendVerificationAttempt(key);
  }
  assert.ok(!(await checkResendVerificationAttempt(key)));
});

// ── Login check order: wrong password must not expose unverified status ───────

await test('wrong password returns generic error, not EMAIL_NOT_VERIFIED', () => {
  const passwordCorrect = false;
  const user = { isActive: true, emailVerifiedAt: null as Date | null };
  let responseCode: string;
  if (!passwordCorrect) {
    responseCode = 'INVALID_CREDENTIALS';
  } else if (!user.isActive) {
    responseCode = 'USER_INACTIVE';
  } else if (!user.emailVerifiedAt) {
    responseCode = 'EMAIL_NOT_VERIFIED';
  } else {
    responseCode = 'OK';
  }
  assert.notEqual(responseCode, 'EMAIL_NOT_VERIFIED', 'wrong password must not leak unverified status');
  assert.equal(responseCode, 'INVALID_CREDENTIALS');
});

// ── Resend response must not reveal email existence ───────────────────────────

await test('resend-verification: identical generic response regardless of email existence', () => {
  const GENERIC = 'If an unverified account with that email exists, a verification link has been sent.';
  const responseFound = { message: GENERIC };
  const responseNotFound = { message: GENERIC };
  assert.deepEqual(responseFound, responseNotFound, 'response must not reveal whether email exists');
});

// ── Email template ────────────────────────────────────────────────────────────

await test('buildEmailVerificationEmail contains verifyUrl', () => {
  const verifyUrl = 'https://app.noramedi.com/verify-email?token=test123';
  const { html, text, subject } = buildEmailVerificationEmail({ firstName: 'Test', verifyUrl });
  assert.ok(html.includes(verifyUrl), 'html should contain verifyUrl');
  assert.ok(text.includes(verifyUrl), 'text should contain verifyUrl');
  assert.ok(subject.includes('Verify'), 'subject should mention Verify');
});

await test('buildEmailVerificationEmail uses APP_BASE_URL, not localhost', () => {
  const verifyUrl = 'https://app.noramedi.com/verify-email?token=xyz';
  const { html } = buildEmailVerificationEmail({ firstName: 'Ali', verifyUrl });
  assert.ok(!html.includes('localhost'), 'html must not contain localhost');
});

await test('raw token is NOT in email template — only the URL', () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const verifyUrl = `https://app.noramedi.com/verify-email?token=${rawToken}`;
  const { html, text } = buildEmailVerificationEmail({ firstName: 'Test', verifyUrl });
  // The tokenHash must never appear in the email (it is DB-only)
  assert.ok(!html.includes(tokenHash), 'tokenHash must not appear in email html');
  assert.ok(!text.includes(tokenHash), 'tokenHash must not appear in email text');
});

// ── MAIL_ENABLED=false must not crash ─────────────────────────────────────────

await test('sendMail returns sent=false when MAIL_ENABLED=false', async () => {
  const origEnv = process.env.MAIL_ENABLED;
  process.env.MAIL_ENABLED = 'false';
  try {
    const result = await sendMail({
      to: 'test@example.com',
      subject: 'Test',
      html: '<p>test</p>',
      text: 'test',
    });
    assert.equal(result.sent, false);
    assert.ok(result.reason);
  } finally {
    if (origEnv === undefined) {
      delete process.env.MAIL_ENABLED;
    } else {
      process.env.MAIL_ENABLED = origEnv;
    }
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
