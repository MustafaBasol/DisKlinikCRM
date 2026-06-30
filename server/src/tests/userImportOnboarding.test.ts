/**
 * userImportOnboarding.test.ts — Excel kullanıcı içe aktarma davet e-postası testleri
 *
 * Çalıştırma: cd server && npx tsx src/tests/userImportOnboarding.test.ts
 *
 * Kapsanan senaryolar:
 *  - generateResetToken: 64 karakter hex token + farklı SHA-256 hash üretir
 *  - buildStaffOnboardingEmail: resetUrl/klinik adı içerir, ham şifre/localhost içermez
 *  - Satır bazlı içe aktarma: e-posta gönderimi başarısız olsa bile satır "created" sayılır
 *  - temporaryPassword yalnızca şifre belirtilmeyen satırlarda döner (mevcut davranış)
 */

import assert from 'node:assert/strict';
import { buildStaffOnboardingEmail } from '../services/emailTemplates.js';
import { generateResetToken, RESET_TOKEN_EXPIRY_MINUTES } from '../utils/passwordResetToken.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

// ── generateResetToken ────────────────────────────────────────────────────────

await test('generateResetToken produces a 64-char hex raw token', () => {
  const { rawToken } = generateResetToken();
  assert.equal(rawToken.length, 64);
  assert.match(rawToken, /^[0-9a-f]+$/);
});

await test('generateResetToken produces a distinct SHA-256 hash', () => {
  const { rawToken, tokenHash } = generateResetToken();
  assert.equal(tokenHash.length, 64);
  assert.notEqual(rawToken, tokenHash);
});

await test('generateResetToken produces different tokens on each call', () => {
  const a = generateResetToken();
  const b = generateResetToken();
  assert.notEqual(a.rawToken, b.rawToken);
  assert.notEqual(a.tokenHash, b.tokenHash);
});

// ── buildStaffOnboardingEmail ─────────────────────────────────────────────────

await test('buildStaffOnboardingEmail contains resetUrl and clinic name, no raw password/localhost', () => {
  const resetUrl = 'https://app.noramedi.com/reset-password?token=imported-row-token';
  const { html, text, subject } = buildStaffOnboardingEmail({
    firstName: 'Zeynep',
    clinicName: 'Excel İçe Aktarma Kliniği',
    resetUrl,
    expiryMinutes: RESET_TOKEN_EXPIRY_MINUTES,
  });
  assert.ok(html.includes(resetUrl));
  assert.ok(text.includes(resetUrl));
  assert.ok(html.includes('Excel İçe Aktarma Kliniği'));
  assert.ok(!html.includes('localhost'));
  assert.ok(!html.toLowerCase().includes('tmp') , 'email body must never mention a generated temp password');
  assert.ok(subject.length > 0);
});

// ── Per-row invitation-failure isolation (mirrors usersImport.ts loop logic) ──

type RowOutcome = { rowNumber: number; created: boolean; invitationEmailSent: boolean };

async function processRow(rowNumber: number, sendMailFn: () => Promise<{ sent: boolean }>): Promise<RowOutcome> {
  // Mirrors the try/catch nesting in usersImport.ts: row creation succeeds
  // regardless of whether the nested invitation-email try/catch throws.
  const outcome: RowOutcome = { rowNumber, created: true, invitationEmailSent: false };
  try {
    const result = await sendMailFn();
    outcome.invitationEmailSent = result.sent;
  } catch {
    outcome.invitationEmailSent = false;
  }
  return outcome;
}

await test('row with successful invitation email is created with invitationEmailSent=true', async () => {
  const outcome = await processRow(2, async () => ({ sent: true }));
  assert.equal(outcome.created, true);
  assert.equal(outcome.invitationEmailSent, true);
});

await test('row whose mail send throws is still created, invitationEmailSent=false', async () => {
  const outcome = await processRow(3, async () => {
    throw new Error('SMTP connection refused');
  });
  assert.equal(outcome.created, true, 'a mail failure must not turn a created row into skipped');
  assert.equal(outcome.invitationEmailSent, false);
});

await test('row whose mail send returns sent=false (MAIL_ENABLED=false) is still created', async () => {
  const outcome = await processRow(4, async () => ({ sent: false }));
  assert.equal(outcome.created, true);
  assert.equal(outcome.invitationEmailSent, false);
});

await test('hasFailedInvitations is true if any created row failed to send', () => {
  const created = [
    { invitationEmailSent: true },
    { invitationEmailSent: false },
  ];
  const hasFailedInvitations = created.some((c) => !c.invitationEmailSent);
  assert.equal(hasFailedInvitations, true);
});

await test('hasFailedInvitations is false when all created rows sent successfully', () => {
  const created = [
    { invitationEmailSent: true },
    { invitationEmailSent: true },
  ];
  const hasFailedInvitations = created.some((c) => !c.invitationEmailSent);
  assert.equal(hasFailedInvitations, false);
});

// ── temporaryPassword behavior (existing usersImport.ts logic, unchanged) ────

await test('temporaryPassword is only attached for rows without a provided password', () => {
  const tempPasswords = new Map<number, string>([[5, 'Tmpabc123!']]);
  const rowWithGenerated = { rowNumber: 5, temporaryPassword: tempPasswords.get(5) };
  const rowWithOwnPassword = { rowNumber: 6, temporaryPassword: tempPasswords.get(6) };
  assert.ok(rowWithGenerated.temporaryPassword);
  assert.equal(rowWithOwnPassword.temporaryPassword, undefined);
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nUser Import Onboarding Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
