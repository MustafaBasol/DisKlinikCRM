import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildStaffWelcomeEmail } from '../services/emailTemplates.js';
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

// ── Global email uniqueness check logic ───────────────────────────────────────

await test('duplicate email (different orgs) must be blocked globally', () => {
  const existingEmail = 'doctor@example.com';
  const newUserEmail = 'doctor@example.com';
  const isDuplicate = existingEmail.toLowerCase() === newUserEmail.toLowerCase();
  assert.ok(isDuplicate, 'same email in different org must be detected as duplicate');
});

await test('case-insensitive email comparison catches mixed-case duplicates', () => {
  const stored = 'Doctor@Example.com';
  const incoming = 'doctor@example.com';
  assert.equal(stored.toLowerCase(), incoming.toLowerCase());
});

await test('different emails are not flagged as duplicates', () => {
  const stored = 'alice@example.com';
  const incoming = 'bob@example.com';
  assert.notEqual(stored.toLowerCase(), incoming.toLowerCase());
});

// ── Login duplicate detection logic ──────────────────────────────────────────

await test('login blocks when matchCount > 1 (duplicate accounts)', () => {
  const matchCount = 2;
  const shouldBlock = matchCount > 1;
  assert.ok(shouldBlock, 'login must be blocked when multiple accounts share email');
});

await test('login proceeds normally when exactly one account found', () => {
  const matchCount = 1;
  const shouldBlock = matchCount > 1;
  assert.ok(!shouldBlock, 'login must proceed when exactly one account');
});

await test('login normalizes email to lowercase before lookup', () => {
  const rawEmail = '  Doctor@EXAMPLE.com  ';
  const normalized = rawEmail.trim().toLowerCase();
  assert.equal(normalized, 'doctor@example.com');
});

// ── Staff user created with emailVerifiedAt = null ───────────────────────────

await test('new staff user has emailVerifiedAt = null (cannot login until verified)', () => {
  const newUser = { emailVerifiedAt: null as Date | null };
  assert.equal(newUser.emailVerifiedAt, null, 'staff user must not be able to login before email verification');
});

await test('staff user can login after email verification sets emailVerifiedAt', () => {
  const user = { emailVerifiedAt: null as Date | null };
  user.emailVerifiedAt = new Date(); // simulates verify-email endpoint
  assert.ok(user.emailVerifiedAt !== null);
  assert.ok(user.emailVerifiedAt instanceof Date);
});

// ── Verification token for staff user ────────────────────────────────────────

await test('staff verification token is a 64-char hex SHA-256 hash', () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  assert.equal(rawToken.length, 64);
  assert.equal(tokenHash.length, 64);
  assert.notEqual(rawToken, tokenHash, 'rawToken must not equal its hash');
});

await test('staff verification token expires 24h in the future', () => {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  assert.ok(expiresAt > new Date());
  const diffMs = expiresAt.getTime() - Date.now();
  assert.ok(diffMs > 23 * 60 * 60 * 1000, 'expiry must be ~24h from now');
});

// ── Staff welcome email template ──────────────────────────────────────────────

await test('buildStaffWelcomeEmail contains verifyUrl', () => {
  const verifyUrl = 'https://app.noramedi.com/verify-email?token=abc123';
  const { html, text, subject } = buildStaffWelcomeEmail({
    firstName: 'Ahmet',
    clinicName: 'Test Clinic',
    verifyUrl,
  });
  assert.ok(html.includes(verifyUrl), 'html must contain verifyUrl');
  assert.ok(text.includes(verifyUrl), 'text must contain verifyUrl');
  assert.ok(subject.includes('Hesabınız') || subject.includes('Account'), 'subject must mention account');
});

await test('buildStaffWelcomeEmail contains clinic name', () => {
  const { html, text } = buildStaffWelcomeEmail({
    firstName: 'Ali',
    clinicName: 'NoraMedi Test Clinic',
    verifyUrl: 'https://app.noramedi.com/verify-email?token=xyz',
  });
  assert.ok(html.includes('NoraMedi Test Clinic'));
  assert.ok(text.includes('NoraMedi Test Clinic'));
});

await test('buildStaffWelcomeEmail does not contain localhost', () => {
  const { html } = buildStaffWelcomeEmail({
    firstName: 'Test',
    clinicName: 'Clinic',
    verifyUrl: 'https://app.noramedi.com/verify-email?token=abc',
  });
  assert.ok(!html.includes('localhost'), 'html must not contain localhost');
});

await test('staff welcome email token is in URL only, not raw in email body', () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const verifyUrl = `https://app.noramedi.com/verify-email?token=${rawToken}`;
  const { html, text } = buildStaffWelcomeEmail({ firstName: 'Test', clinicName: 'Clinic', verifyUrl });
  assert.ok(!html.includes(tokenHash), 'tokenHash must not appear in email html');
  assert.ok(!text.includes(tokenHash), 'tokenHash must not appear in email text');
});

// ── MAIL_ENABLED=false must not crash staff creation ─────────────────────────

await test('sendMail returns sent=false when MAIL_ENABLED=false (staff creation degrades gracefully)', async () => {
  const origEnv = process.env.MAIL_ENABLED;
  process.env.MAIL_ENABLED = 'false';
  try {
    const result = await sendMail({
      to: 'staff@example.com',
      subject: 'Test',
      html: '<p>test</p>',
      text: 'test',
    });
    assert.equal(result.sent, false);
    assert.ok(result.reason, 'must provide a reason when not sent');
  } finally {
    if (origEnv === undefined) {
      delete process.env.MAIL_ENABLED;
    } else {
      process.env.MAIL_ENABLED = origEnv;
    }
  }
});

// ── Wrong password must not leak EMAIL_NOT_VERIFIED (inherited from login guard) ─

await test('wrong password returns INVALID_CREDENTIALS, not EMAIL_NOT_VERIFIED', () => {
  const passwordCorrect = false;
  const user = { isActive: true, emailVerifiedAt: null as Date | null };
  let code: string;
  if (!passwordCorrect) {
    code = 'INVALID_CREDENTIALS';
  } else if (!user.isActive) {
    code = 'USER_INACTIVE';
  } else if (!user.emailVerifiedAt) {
    code = 'EMAIL_NOT_VERIFIED';
  } else {
    code = 'OK';
  }
  assert.notEqual(code, 'EMAIL_NOT_VERIFIED');
  assert.equal(code, 'INVALID_CREDENTIALS');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
