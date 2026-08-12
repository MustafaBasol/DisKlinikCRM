/**
 * securitySignalServiceLogPrivacy.test.ts — F3-IMPL-006 (Wave 2) regression
 * test confirming server/src/services/security/securitySignalService.ts
 * never writes a raw caught error message to the process logs.
 *
 * Covers the two confirmed RAW_ERROR sites, both of which used to log
 * `err.message` directly (not via safeErrorFields, unlike the rest of this
 * file's HMAC/hashing discipline):
 *   1. recordSecuritySignal   — '[security-signal] Failed to record signal:'
 *   2. countSignalsInWindow   — '[security-signal] Failed to count signals in window:'
 *
 * The fix replaces the raw `err.message` with safeErrorFields(err)
 * (server/src/utils/safeError.ts), which returns only {errorName, errorCode}.
 *
 * Run with: cd server && npx tsx src/tests/securitySignalServiceLogPrivacy.test.ts
 */

import assert from 'node:assert/strict';
import prisma from '../db.js';

process.env.SECURITY_SIGNAL_IP_HASH_SECRET = 'x'.repeat(40);

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

// A raw account-identifier-shaped detail that must never survive a failed
// write/count into the process logs (the whole point of this file's HMAC
// hashing is that a raw identifier never gets this far, so an unfiltered
// Prisma error message is the one path that could still leak it).
const RAW_ACCOUNT_DETAIL = 'clinician.ozel@example-clinic.com';

async function main() {
  section('recordSecuritySignal — raw error redaction (F3-IMPL-006)');

  await test('a securitySignalEvent.create failure (message embedding a raw account identifier) is logged only as errorName/errorCode, never raw', async () => {
    const { recordSecuritySignal } = await import('../services/security/securitySignalService.js');

    (prisma as any).securitySignalEvent = {
      create: async () => {
        throw Object.assign(new Error(`Invalid value for actorUserId, saw "${RAW_ACCOUNT_DETAIL}"`), { code: 'P2000' });
      },
      count: async () => 0,
    };

    const { calls, restore } = captureConsole();
    try {
      await recordSecuritySignal({
        signalType: 'auth_login_failed',
        category: 'auth_brute_force',
        severity: 'low',
        ruleKey: 'auth.brute_force.v1',
        dedupeDimension: 'hash-1',
        organizationId: 'org-1',
        clinicId: 'clinic-1',
        ipAddress: '203.0.113.10',
      });
    } finally {
      restore();
    }

    const serialized = serialize(calls);
    assert.ok(!serialized.includes(RAW_ACCOUNT_DETAIL), `raw account detail leaked into logs: ${serialized}`);
    assert.ok(serialized.includes('"errorName":"Error"'), 'expected errorName to be logged');
    assert.ok(serialized.includes('"errorCode":"P2000"'), 'expected errorCode to be logged');
    assert.ok(serialized.includes('Failed to record signal'), 'expected the operation tag to still be logged');
  });

  section('countSignalsInWindow — raw error redaction (F3-IMPL-006)');

  await test('a securitySignalEvent.count failure (message embedding a raw account identifier) is logged only as errorName/errorCode, never raw, and returns 0', async () => {
    const { countSignalsInWindow } = await import('../services/security/securitySignalService.js');

    (prisma as any).securitySignalEvent = {
      count: async () => {
        throw Object.assign(new Error(`Query failed for dedupeDimension near "${RAW_ACCOUNT_DETAIL}"`), { code: 'P2010' });
      },
    };

    const { calls, restore } = captureConsole();
    let result: number;
    try {
      result = await countSignalsInWindow({ ruleKey: 'auth.brute_force.v1', dedupeDimension: 'hash-1', windowMs: 60_000 });
    } finally {
      restore();
    }

    assert.equal(result, 0, 'countSignalsInWindow must fail closed to 0, never throw');
    const serialized = serialize(calls);
    assert.ok(!serialized.includes(RAW_ACCOUNT_DETAIL), `raw account detail leaked into logs: ${serialized}`);
    assert.ok(serialized.includes('"errorName":"Error"'), 'expected errorName to be logged');
    assert.ok(serialized.includes('"errorCode":"P2010"'), 'expected errorCode to be logged');
    assert.ok(serialized.includes('Failed to count signals in window'), 'expected the operation tag to still be logged');
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
