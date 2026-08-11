/**
 * adminScriptsLogPrivacy.test.ts — F3-IMPL-004 regression tests confirming
 * three production admin/migration CLI scripts never write a raw user email
 * to console output:
 *
 *   1. server/src/scripts/repair-owner-admin.ts            (static source scan —
 *      the script's logic lives entirely in a non-exported top-level `main()`
 *      that connects to the real database on import, so it is not practically
 *      unit-testable at runtime; see whatsappBookingFlowLogRedaction.test.ts's
 *      "Static source scan" pattern for the precedent this follows)
 *   2. server/src/scripts/migrate-to-multibranch.ts         (static source scan,
 *      same reasoning — non-exported top-level `main()`, DB connection on import)
 *   3. server/src/scripts/platform-admin-recover-password.ts (runtime logger-spy —
 *      `printResult` is exported and pure, so it is called directly with a
 *      fixture result object)
 *
 * Run with: cd server && npx tsx src/tests/adminScriptsLogPrivacy.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─── Console spy (for the runtime printResult test) ────────────────────────────

type ConsoleMethod = 'log' | 'info' | 'error' | 'warn' | 'debug';
const CONSOLE_METHODS: ConsoleMethod[] = ['log', 'info', 'error', 'warn', 'debug'];

function captureConsole() {
  const calls: unknown[][] = [];
  const originals = CONSOLE_METHODS.map(method => [method, console[method]] as const);
  for (const method of CONSOLE_METHODS) {
    console[method] = ((...args: unknown[]) => { calls.push(args); }) as typeof console.log;
  }
  return {
    calls,
    restore: () => {
      for (const [method, original] of originals) {
        console[method] = original;
      }
    },
  };
}

function serialize(calls: unknown[][]): string {
  return JSON.stringify(calls, (_key, value) => (typeof value === 'function' ? '[fn]' : value));
}

function assertNoRawLeak(calls: unknown[][], rawValues: string[]) {
  const serialized = serialize(calls);
  for (const raw of rawValues) {
    assert.ok(
      !serialized.includes(raw),
      `raw value "${raw}" leaked into a console.* call.\nCaptured calls: ${serialized}`,
    );
  }
}

async function main() {
  // ── 1/3: repair-owner-admin.ts — static source scan ───────────────────────
  section('Static source scan — repair-owner-admin.ts');

  const repairOwnerAdminSource = readFileSync(
    fileURLToPath(new URL('../scripts/repair-owner-admin.ts', import.meta.url)),
    'utf8',
  );

  await test('does not interpolate ${targetEmail} anywhere in the source', () => {
    assert.ok(
      !/\$\{targetEmail\}/.test(repairOwnerAdminSource),
      'found ${targetEmail} template interpolation — should log user.id instead',
    );
  });

  await test('does not interpolate ${user.email} anywhere in the source', () => {
    assert.ok(
      !/\$\{user\.email\}/.test(repairOwnerAdminSource),
      'found ${user.email} template interpolation — should log user.id instead',
    );
  });

  await test('logs the resolved user id instead of the email', () => {
    assert.ok(
      /\$\{user\.id\}/.test(repairOwnerAdminSource),
      'expected ${user.id} to appear in console output as the safe identifier',
    );
  });

  // ── 2/3: migrate-to-multibranch.ts — static source scan ───────────────────
  section('Static source scan — migrate-to-multibranch.ts');

  const migrateToMultibranchSource = readFileSync(
    fileURLToPath(new URL('../scripts/migrate-to-multibranch.ts', import.meta.url)),
    'utf8',
  );

  await test('does not interpolate ${adminUser.email} anywhere in the source', () => {
    assert.ok(
      !/\$\{adminUser\.email\}/.test(migrateToMultibranchSource),
      'found ${adminUser.email} template interpolation — should log adminUser.id instead',
    );
  });

  await test('logs the resolved admin user id instead of the email', () => {
    assert.ok(
      /\$\{adminUser\.id\}/.test(migrateToMultibranchSource),
      'expected ${adminUser.id} to appear in console output as the safe identifier',
    );
  });

  // ── 3/3: platform-admin-recover-password.ts — runtime logger-spy ──────────
  section('Runtime logger-spy — platform-admin-recover-password.ts printResult (dry-run)');

  const { printResult } = await import('../scripts/platform-admin-recover-password.js');

  const RAW_EMAIL = 'owner.admin@example-clinic.com';
  const MASKED_EMAIL_PREFIX = 'o***@example-clinic.com';

  await test('printResult dry-run masks email, never logs it raw', () => {
    const { calls, restore } = captureConsole();
    try {
      printResult({
        dryRun: true,
        accountMatched: true,
        accountActive: true,
        mfaPreserved: true,
        mfaEnabled: false,
        sessionsInvalidated: 0,
        auditWritten: false,
        passwordChanged: false,
        maskedAdminId: 'abcd1234...',
        email: RAW_EMAIL,
        accountCreatedAt: new Date('2024-01-01T00:00:00.000Z'),
      });
    } finally {
      restore();
    }
    assertNoRawLeak(calls, [RAW_EMAIL]);
    const serialized = serialize(calls);
    assert.ok(serialized.includes(MASKED_EMAIL_PREFIX), 'expected masked email in logs');
  });

  await test('printResult non-dry-run path never logs the email at all', () => {
    const { calls, restore } = captureConsole();
    try {
      printResult({
        dryRun: false,
        accountMatched: true,
        accountActive: true,
        mfaPreserved: true,
        mfaEnabled: false,
        sessionsInvalidated: 0,
        auditWritten: true,
        passwordChanged: true,
        maskedAdminId: 'abcd1234...',
        email: RAW_EMAIL,
        accountCreatedAt: new Date('2024-01-01T00:00:00.000Z'),
      });
    } finally {
      restore();
    }
    assertNoRawLeak(calls, [RAW_EMAIL]);
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
