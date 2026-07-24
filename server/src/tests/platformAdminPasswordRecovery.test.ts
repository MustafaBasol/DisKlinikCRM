/**
 * platformAdminPasswordRecovery.test.ts — R-061 PlatformAdmin password
 * recovery CLI tests.
 *
 * Run: cd server && npx tsx src/tests/platformAdminPasswordRecovery.test.ts
 *
 * Uses isolated fixture PlatformAdmin rows (unique @platform.test emails)
 * against the real dev Postgres instance, cleaned up at the end of the run.
 */

import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import prisma from '../db.js';
import {
  recoverPlatformAdminPassword,
  parseCliArgs,
  assertInteractiveTty,
  printResult,
  RecoveryRefusalError,
} from '../scripts/platform-admin-recover-password.js';

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

const VALID_PASSWORD = 'Str0ng!Passw0rd987';
const OTHER_VALID_PASSWORD = 'AnotherStr0ng!Pw22';
const WEAK_PASSWORD = 'weak';

function fixedPasswordPair(password: string, confirmPassword = password) {
  return async () => ({ password, confirmPassword });
}

async function createFixtureAdmin(overrides: {
  email?: string;
  isActive?: boolean;
  totpEnabledAt?: Date | null;
} = {}) {
  const email = overrides.email ?? `r061-recovery-${crypto.randomUUID()}@platform.test`;
  return prisma.platformAdmin.create({
    data: {
      email,
      passwordHash: 'not-a-real-hash-test-fixture-only',
      name: 'R-061 Recovery Test Fixture',
      isActive: overrides.isActive ?? true,
      totpEnabledAt: overrides.totpEnabledAt ?? null,
    },
  });
}

const createdAdminIds: string[] = [];
async function trackedFixtureAdmin(overrides: Parameters<typeof createFixtureAdmin>[0] = {}) {
  const admin = await createFixtureAdmin(overrides);
  createdAdminIds.push(admin.id);
  return admin;
}

async function cleanupAuditEventsFor(adminId: string) {
  await prisma.platformAdminAuditEvent.deleteMany({
    where: { resourceType: 'PlatformAdmin', resourceKey: adminId },
  });
}

// ── argv parsing / forbidden flags ───────────────────────────────────────────

section('parseCliArgs — argument parsing and forbidden-flag rejection');

await test('parses --email, --confirm-email, --dry-run, --confirm', () => {
  const parsed = parseCliArgs(['--email', 'a@b.com', '--confirm-email', 'a@b.com', '--dry-run', '--confirm']);
  assert.equal(parsed.email, 'a@b.com');
  assert.equal(parsed.confirmEmail, 'a@b.com');
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.confirm, true);
});

await test('defaults dryRun/confirm to false when flags are absent', () => {
  const parsed = parseCliArgs(['--email', 'a@b.com', '--confirm-email', 'a@b.com']);
  assert.equal(parsed.dryRun, false);
  assert.equal(parsed.confirm, false);
});

for (const flag of ['--password', '--new-password', '--pass', '--pwd', '--confirm-password']) {
  await test(`rejects password supplied via argv (${flag})`, () => {
    assert.throws(
      () => parseCliArgs(['--email', 'a@b.com', flag, 'secret-value']),
      (err: unknown) => err instanceof RecoveryRefusalError && err.code === 'PASSWORD_VIA_ARGV_REJECTED',
    );
  });
}

// ── non-interactive execution refusal ────────────────────────────────────────

section('assertInteractiveTty — non-interactive execution refusal');

await test('throws when stdin is not a TTY', () => {
  const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  try {
    assert.throws(
      () => assertInteractiveTty(),
      (err: unknown) => err instanceof RecoveryRefusalError && err.code === 'NON_INTERACTIVE_EXECUTION_REJECTED',
    );
  } finally {
    if (original) Object.defineProperty(process.stdin, 'isTTY', original);
  }
});

await test('does not throw when stdin.isTTY is true and setRawMode exists', () => {
  const originalTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const originalRawMode = (process.stdin as any).setRawMode;
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  (process.stdin as any).setRawMode = () => {};
  try {
    assert.doesNotThrow(() => assertInteractiveTty());
  } finally {
    if (originalTty) Object.defineProperty(process.stdin, 'isTTY', originalTty);
    (process.stdin as any).setRawMode = originalRawMode;
  }
});

// ── core recovery logic ──────────────────────────────────────────────────────

section('recoverPlatformAdminPassword — refusal paths');

await test('refuses when required email arguments are missing', async () => {
  await assert.rejects(
    () => recoverPlatformAdminPassword({ email: '', confirmEmail: '', dryRun: true, confirm: false }),
    (err: unknown) => err instanceof RecoveryRefusalError && err.code === 'EMAIL_REQUIRED',
  );
});

await test('refuses when --email and --confirm-email do not match', async () => {
  await assert.rejects(
    () =>
      recoverPlatformAdminPassword({
        email: 'admin@platform.test',
        confirmEmail: 'someone-else@platform.test',
        dryRun: true,
        confirm: false,
      }),
    (err: unknown) => err instanceof RecoveryRefusalError && err.code === 'EMAIL_CONFIRMATION_MISMATCH',
  );
});

await test('refuses a non-dry-run recovery without explicit --confirm', async () => {
  const admin = await trackedFixtureAdmin();
  await assert.rejects(
    () =>
      recoverPlatformAdminPassword({
        email: admin.email,
        confirmEmail: admin.email,
        dryRun: false,
        confirm: false,
      }),
    (err: unknown) => err instanceof RecoveryRefusalError && err.code === 'CONFIRMATION_REQUIRED',
  );
});

await test('refuses when no account matches the normalized email', async () => {
  const email = `r061-recovery-absent-${crypto.randomUUID()}@platform.test`;
  await assert.rejects(
    () => recoverPlatformAdminPassword({ email, confirmEmail: email, dryRun: true, confirm: false }),
    (err: unknown) => err instanceof RecoveryRefusalError && err.code === 'ACCOUNT_NOT_FOUND',
  );
});

await test('refuses when the account is inactive', async () => {
  const admin = await trackedFixtureAdmin({ isActive: false });
  await assert.rejects(
    () => recoverPlatformAdminPassword({ email: admin.email, confirmEmail: admin.email, dryRun: true, confirm: false }),
    (err: unknown) => err instanceof RecoveryRefusalError && err.code === 'ACCOUNT_INACTIVE',
  );
});

await test('refuses on normalized-email ambiguity (two rows differing only by case)', async () => {
  const base = `r061-recovery-dup-${crypto.randomUUID()}`;
  const lower = await trackedFixtureAdmin({ email: `${base}@platform.test` });
  const upper = await trackedFixtureAdmin({ email: `${base.toUpperCase()}@PLATFORM.TEST` });
  await assert.rejects(
    () =>
      recoverPlatformAdminPassword({
        email: lower.email.toLowerCase(),
        confirmEmail: lower.email.toLowerCase(),
        dryRun: true,
        confirm: false,
      }),
    (err: unknown) => err instanceof RecoveryRefusalError && err.code === 'AMBIGUOUS_MATCH',
  );
  void upper;
});

await test('refuses when the two password prompts do not match', async () => {
  const admin = await trackedFixtureAdmin();
  await assert.rejects(
    () =>
      recoverPlatformAdminPassword(
        { email: admin.email, confirmEmail: admin.email, dryRun: false, confirm: true },
        { getNewPasswordPair: fixedPasswordPair(VALID_PASSWORD, OTHER_VALID_PASSWORD) },
      ),
    (err: unknown) => err instanceof RecoveryRefusalError && err.code === 'PASSWORD_CONFIRMATION_MISMATCH',
  );
  const row = await prisma.platformAdmin.findUnique({ where: { id: admin.id } });
  assert.equal(row?.passwordHash, 'not-a-real-hash-test-fixture-only', 'a mismatched confirmation must never write a new hash');
});

await test('refuses when the new password fails the shared password policy', async () => {
  const admin = await trackedFixtureAdmin();
  await assert.rejects(
    () =>
      recoverPlatformAdminPassword(
        { email: admin.email, confirmEmail: admin.email, dryRun: false, confirm: true },
        { getNewPasswordPair: fixedPasswordPair(WEAK_PASSWORD) },
      ),
    (err: unknown) => err instanceof RecoveryRefusalError && err.code === 'PASSWORD_POLICY_FAILED',
  );
  const row = await prisma.platformAdmin.findUnique({ where: { id: admin.id } });
  assert.equal(row?.passwordHash, 'not-a-real-hash-test-fixture-only', 'a policy-failing password must never be written');
});

section('recoverPlatformAdminPassword — dry-run');

await test('dry-run performs no writes: no hash change, no audit row, safe fields returned', async () => {
  const admin = await trackedFixtureAdmin({ totpEnabledAt: new Date() });
  const before = await prisma.platformAdmin.findUnique({ where: { id: admin.id } });

  const result = await recoverPlatformAdminPassword({
    email: admin.email,
    confirmEmail: admin.email,
    dryRun: true,
    confirm: false,
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.accountMatched, true);
  assert.equal(result.accountActive, true);
  assert.equal(result.mfaEnabled, true);
  assert.equal(result.mfaPreserved, true);
  assert.equal(result.passwordChanged, false);
  assert.equal(result.auditWritten, false);
  assert.equal(result.sessionsInvalidated, 0);

  const after = await prisma.platformAdmin.findUnique({ where: { id: admin.id } });
  assert.equal(after?.passwordHash, before?.passwordHash, 'dry-run must never change passwordHash');
  assert.deepEqual(after?.totpEnabledAt, before?.totpEnabledAt, 'dry-run must never touch MFA fields');
  assert.equal(after?.updatedAt.getTime(), before?.updatedAt.getTime(), 'dry-run must never touch updatedAt');

  const auditCount = await prisma.platformAdminAuditEvent.count({
    where: { resourceType: 'PlatformAdmin', resourceKey: admin.id },
  });
  assert.equal(auditCount, 0, 'dry-run must never write an audit event');
});

section('recoverPlatformAdminPassword — successful recovery');

await test('successful recovery: updates only passwordHash/updatedAt, preserves MFA, writes exactly one audit event', async () => {
  const admin = await trackedFixtureAdmin({ totpEnabledAt: new Date('2025-01-01T00:00:00Z') });
  const before = await prisma.platformAdmin.findUnique({ where: { id: admin.id } });

  const result = await recoverPlatformAdminPassword(
    { email: admin.email, confirmEmail: admin.email, dryRun: false, confirm: true },
    { getNewPasswordPair: fixedPasswordPair(VALID_PASSWORD) },
  );

  assert.equal(result.passwordChanged, true);
  assert.equal(result.auditWritten, true);
  assert.equal(result.mfaPreserved, true);
  assert.equal(result.mfaEnabled, true);
  assert.equal(result.sessionsInvalidated, 0);

  const after = await prisma.platformAdmin.findUnique({ where: { id: admin.id } });
  assert.ok(after, 'admin row must still exist');
  assert.notEqual(after!.passwordHash, before!.passwordHash, 'passwordHash must change');
  assert.ok(await bcrypt.compare(VALID_PASSWORD, after!.passwordHash), 'new hash must verify against the entered password');
  assert.equal(after!.email, before!.email, 'email must not change');
  assert.equal(after!.name, before!.name, 'name must not change');
  assert.equal(after!.isActive, before!.isActive, 'isActive must not change');
  assert.deepEqual(after!.totpEnabledAt, before!.totpEnabledAt, 'totpEnabledAt must not change');
  assert.equal(after!.totpSecretEncrypted, before!.totpSecretEncrypted, 'totpSecretEncrypted must not change');
  assert.ok(after!.updatedAt.getTime() >= before!.updatedAt.getTime(), 'updatedAt must be bumped by the Prisma update');

  const rows = await prisma.platformAdminAuditEvent.findMany({
    where: { resourceType: 'PlatformAdmin', resourceKey: admin.id },
  });
  assert.equal(rows.length, 1, 'exactly one audit row must be written for one successful recovery');
  const row = rows[0]!;
  assert.equal(row.action, 'platform_admin.password_recovered');
  assert.equal(row.resourceType, 'PlatformAdmin');
  assert.equal(row.resourceKey, admin.id);
  assert.equal(row.actorPlatformAdminId, null, 'recovery cannot be attributed to an authenticated admin — must be null, not faked');
  assert.equal(row.previousValue, null);
  assert.equal(row.newValue, null);
  assert.equal(row.outcome, 'success');
  assert.deepEqual(row.safeMetadata, { method: 'operator_cli', sessionsInvalidated: 0, mfaPreserved: true });

  const serializedRow = JSON.stringify(row);
  assert.ok(!serializedRow.includes(VALID_PASSWORD), 'audit row must never contain the plaintext password');
  assert.ok(!serializedRow.includes(after!.passwordHash), 'audit row must never contain the password hash');
});

section('recoverPlatformAdminPassword — transaction atomicity');

await test('rolls back the password update when the audit insert fails', async () => {
  const admin = await trackedFixtureAdmin();
  const before = await prisma.platformAdmin.findUnique({ where: { id: admin.id } });

  await assert.rejects(
    () =>
      recoverPlatformAdminPassword(
        { email: admin.email, confirmEmail: admin.email, dryRun: false, confirm: true },
        {
          getNewPasswordPair: fixedPasswordPair(VALID_PASSWORD),
          writeAuditEvent: async () => {
            throw new Error('forced audit insert failure (test)');
          },
        },
      ),
    /forced audit insert failure/,
  );

  const after = await prisma.platformAdmin.findUnique({ where: { id: admin.id } });
  assert.equal(after?.passwordHash, before?.passwordHash, 'passwordHash must be rolled back when the audit insert fails');

  const auditCount = await prisma.platformAdminAuditEvent.count({
    where: { resourceType: 'PlatformAdmin', resourceKey: admin.id },
  });
  assert.equal(auditCount, 0, 'no audit row should exist after a rolled-back transaction');
});

section('Secret hygiene — no password/hash ever printed');

await test('printResult (dry-run and success paths) never emits the password or the resulting hash', async () => {
  const admin = await trackedFixtureAdmin();
  const logSpy: string[] = [];
  const errSpy: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = ((...args: unknown[]) => { logSpy.push(args.map(String).join(' ')); }) as any;
  console.error = ((...args: unknown[]) => { errSpy.push(args.map(String).join(' ')); }) as any;

  let after: { passwordHash: string } | null = null;
  try {
    const dryResult = await recoverPlatformAdminPassword({
      email: admin.email,
      confirmEmail: admin.email,
      dryRun: true,
      confirm: false,
    });
    printResult(dryResult);

    const realResult = await recoverPlatformAdminPassword(
      { email: admin.email, confirmEmail: admin.email, dryRun: false, confirm: true },
      { getNewPasswordPair: fixedPasswordPair(VALID_PASSWORD) },
    );
    printResult(realResult);
    after = await prisma.platformAdmin.findUnique({ where: { id: admin.id }, select: { passwordHash: true } });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  const combined = [...logSpy, ...errSpy].join('\n');
  assert.ok(!combined.includes(VALID_PASSWORD), 'stdout/stderr must never contain the plaintext password');
  assert.ok(after && !combined.includes(after.passwordHash), 'stdout/stderr must never contain the bcrypt hash');
  assert.ok(!combined.includes(admin.id), 'stdout/stderr must never contain the complete PlatformAdmin ID');
});

// ── cleanup ───────────────────────────────────────────────────────────────────

for (const id of createdAdminIds) {
  await cleanupAuditEventsFor(id);
}
await prisma.platformAdmin.deleteMany({ where: { id: { in: createdAdminIds } } });

// ── Sonuç ─────────────────────────────────────────────────────────────────────

console.log(`\n─────────────────────────────────`);
console.log(`Toplam: ${passed + failed}  ok ${passed}  FAIL ${failed}`);
if (failed > 0) {
  process.exit(1);
}
