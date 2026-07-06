import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { checkForgotPasswordAttempt, recordForgotPasswordAttempt, validatePassword } from '../utils/helpers.js';
import { buildPasswordResetEmail, buildTestEmail } from '../services/emailTemplates.js';
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

await test('generates a 64-char hex raw token', () => {
  const raw = crypto.randomBytes(32).toString('hex');
  assert.equal(raw.length, 64);
  assert.match(raw, /^[0-9a-f]+$/);
});

await test('SHA-256 hash of token is deterministic', () => {
  const raw = crypto.randomBytes(32).toString('hex');
  const h1 = crypto.createHash('sha256').update(raw).digest('hex');
  const h2 = crypto.createHash('sha256').update(raw).digest('hex');
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
});

await test('different raw tokens produce different hashes', () => {
  const t1 = crypto.randomBytes(32).toString('hex');
  const t2 = crypto.randomBytes(32).toString('hex');
  const h1 = crypto.createHash('sha256').update(t1).digest('hex');
  const h2 = crypto.createHash('sha256').update(t2).digest('hex');
  assert.notEqual(h1, h2);
});

// ── Rate limiter ──────────────────────────────────────────────────────────────

await test('allows first 3 forgot-password attempts per key', async () => {
  const key = `test-key-${Date.now()}-${Math.random()}`;
  assert.equal(await checkForgotPasswordAttempt(key), true);
  await recordForgotPasswordAttempt(key);
  assert.equal(await checkForgotPasswordAttempt(key), true);
  await recordForgotPasswordAttempt(key);
  assert.equal(await checkForgotPasswordAttempt(key), true);
  await recordForgotPasswordAttempt(key);
  assert.equal(await checkForgotPasswordAttempt(key), false, 'should block after 3 attempts');
});

// ── Password validation ───────────────────────────────────────────────────────

await test('validatePassword rejects weak passwords', () => {
  const { valid } = validatePassword('abc');
  assert.equal(valid, false);
});

await test('validatePassword accepts strong passwords', () => {
  const { valid, errors } = validatePassword('Str0ng!Pass#1');
  assert.equal(valid, true, `Expected valid but got errors: ${errors.join(', ')}`);
});

// ── Email templates ───────────────────────────────────────────────────────────

await test('buildPasswordResetEmail produces html/text/subject', () => {
  const { subject, html, text } = buildPasswordResetEmail({
    firstName: 'Ayşe',
    resetUrl: 'https://app.noramedi.com/reset-password?token=abc123',
    expiryMinutes: 60,
  });
  assert.ok(subject.length > 0, 'subject should not be empty');
  assert.ok(html.includes('https://app.noramedi.com/reset-password?token=abc123'), 'html should include reset URL');
  assert.ok(text.includes('https://app.noramedi.com/reset-password?token=abc123'), 'text should include reset URL');
  assert.ok(html.includes('Ayşe'), 'html should include first name');
  assert.ok(!html.includes('undefined'), 'html should not contain "undefined"');
});

await test('buildTestEmail produces html/text/subject', () => {
  const { subject, html, text } = buildTestEmail({ to: 'admin@example.com' });
  assert.ok(subject.length > 0);
  assert.ok(html.length > 0);
  assert.ok(text.includes('admin@example.com'));
});

// ── emailService disabled mode ────────────────────────────────────────────────

await test('sendMail returns sent=false when MAIL_ENABLED is not set', async () => {
  const prev = process.env.MAIL_ENABLED;
  delete process.env.MAIL_ENABLED;
  const result = await sendMail({
    to: 'test@example.com',
    subject: 'Test',
    html: '<p>test</p>',
    text: 'test',
  });
  assert.equal(result.sent, false);
  assert.ok(result.reason?.includes('MAIL_ENABLED'));
  if (prev !== undefined) process.env.MAIL_ENABLED = prev;
});

await test('sendMail returns sent=false when MAIL_ENABLED=false', async () => {
  process.env.MAIL_ENABLED = 'false';
  const result = await sendMail({
    to: 'test@example.com',
    subject: 'Test',
    html: '<p>test</p>',
    text: 'test',
  });
  assert.equal(result.sent, false);
  delete process.env.MAIL_ENABLED;
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nPassword Reset Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
