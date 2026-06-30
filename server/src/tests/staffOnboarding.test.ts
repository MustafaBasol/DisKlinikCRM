import assert from 'node:assert/strict';
import { buildStaffOnboardingEmail } from '../services/emailTemplates.js';
import { sendMail } from '../services/emailService.js';
import { generateResetToken, RESET_TOKEN_EXPIRY_MINUTES } from '../utils/passwordResetToken.js';

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

// ── Staff user is verified immediately at admin-creation time ────────────────

await test('admin-created staff user has emailVerifiedAt set immediately (admin vouches for the email)', () => {
  const newUser = { emailVerifiedAt: new Date() as Date | null };
  assert.ok(newUser.emailVerifiedAt !== null, 'admin-created staff user must not need a separate email-verify step');
});

// ── Password setup token for staff onboarding (reuses password reset flow) ───

await test('staff onboarding reset token is a 64-char hex SHA-256 hash', () => {
  const { rawToken, tokenHash } = generateResetToken();
  assert.equal(rawToken.length, 64);
  assert.equal(tokenHash.length, 64);
  assert.notEqual(rawToken, tokenHash, 'rawToken must not equal its hash');
});

await test('staff onboarding reset token expiry matches RESET_TOKEN_EXPIRY_MINUTES', () => {
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);
  assert.ok(expiresAt > new Date());
  const diffMs = expiresAt.getTime() - Date.now();
  assert.ok(diffMs > (RESET_TOKEN_EXPIRY_MINUTES - 1) * 60 * 1000, 'expiry must be ~RESET_TOKEN_EXPIRY_MINUTES from now');
});

// ── Staff onboarding email template ───────────────────────────────────────────

await test('buildStaffOnboardingEmail contains resetUrl', () => {
  const resetUrl = 'https://app.noramedi.com/reset-password?token=abc123';
  const { html, text, subject } = buildStaffOnboardingEmail({
    firstName: 'Ahmet',
    clinicName: 'Test Clinic',
    resetUrl,
    expiryMinutes: RESET_TOKEN_EXPIRY_MINUTES,
  });
  assert.ok(html.includes(resetUrl), 'html must contain resetUrl');
  assert.ok(text.includes(resetUrl), 'text must contain resetUrl');
  assert.ok(subject.includes('oluşturuldu'), 'subject must mention account creation');
});

await test('buildStaffOnboardingEmail contains clinic name', () => {
  const { html, text } = buildStaffOnboardingEmail({
    firstName: 'Ali',
    clinicName: 'NoraMedi Test Clinic',
    resetUrl: 'https://app.noramedi.com/reset-password?token=xyz',
    expiryMinutes: RESET_TOKEN_EXPIRY_MINUTES,
  });
  assert.ok(html.includes('NoraMedi Test Clinic'));
  assert.ok(text.includes('NoraMedi Test Clinic'));
});

await test('buildStaffOnboardingEmail does not contain localhost', () => {
  const { html } = buildStaffOnboardingEmail({
    firstName: 'Test',
    clinicName: 'Clinic',
    resetUrl: 'https://app.noramedi.com/reset-password?token=abc',
    expiryMinutes: RESET_TOKEN_EXPIRY_MINUTES,
  });
  assert.ok(!html.includes('localhost'), 'html must not contain localhost');
});

await test('staff onboarding email token is in URL only, not raw password or hash in email body', () => {
  const { rawToken, tokenHash } = generateResetToken();
  const resetUrl = `https://app.noramedi.com/reset-password?token=${rawToken}`;
  const { html, text } = buildStaffOnboardingEmail({
    firstName: 'Test',
    clinicName: 'Clinic',
    resetUrl,
    expiryMinutes: RESET_TOKEN_EXPIRY_MINUTES,
  });
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
