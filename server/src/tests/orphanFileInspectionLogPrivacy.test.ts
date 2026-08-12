/**
 * orphanFileInspectionLogPrivacy.test.ts — F3-IMPL-006 (Wave 2) regression
 * test confirming server/src/services/privacy/orphanFileInspection.ts never
 * writes a raw caught error object to the process logs.
 *
 * markConfirmedMissing() used to log the raw `err` directly via
 * `console.error('[orphan-file-inspection] failed to mark missing', entry, err)`
 * next to a Prisma `patientAttachment.update` / imaging lifecycle-port write
 * failure. The fix replaces the raw `err` with safeErrorFields(err)
 * (server/src/utils/safeError.ts), which returns only {errorName, errorCode}
 * — the `entry` argument (`{id, kind}`, ids only) is untouched and still
 * logged, since it carries no PII.
 *
 * Run with: cd server && npx tsx src/tests/orphanFileInspectionLogPrivacy.test.ts
 */

import assert from 'node:assert/strict';
import prisma from '../db.js';

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

// A storage-path-shaped detail that must never survive a failed
// storageVerifiedMissingAt write into the process logs.
const RAW_STORAGE_PATH_FIXTURE = '/var/lib/noramedi/uploads/clinic-1/attachment-905551234567.pdf';

async function main() {
  section('markConfirmedMissing — raw error redaction (F3-IMPL-006)');

  await test('a patientAttachment.update failure (message embedding a raw storage path) is logged only as errorName/errorCode, never raw', async () => {
    const { markConfirmedMissing } = await import('../services/privacy/orphanFileInspection.js');

    (prisma as any).patientAttachment = {
      update: async () => {
        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${RAW_STORAGE_PATH_FIXTURE}'`), { code: 'ENOENT' });
      },
    };

    const { calls, restore } = captureConsole();
    let result: { marked: number };
    try {
      result = await markConfirmedMissing('clinic-1', [{ id: 'attachment-1', kind: 'attachment' }]);
    } finally {
      restore();
    }

    assert.equal(result.marked, 0, 'a failed update must not be counted as marked');
    const serialized = serialize(calls);
    assert.ok(!serialized.includes(RAW_STORAGE_PATH_FIXTURE), `raw storage path leaked into logs: ${serialized}`);
    assert.ok(serialized.includes('"errorName":"Error"'), 'expected errorName to be logged');
    assert.ok(serialized.includes('"errorCode":"ENOENT"'), 'expected errorCode to be logged');
    assert.ok(serialized.includes('failed to mark missing'), 'expected the operation tag to still be logged');
    assert.ok(serialized.includes('attachment-1'), 'expected the (non-PII) entry id to remain in logs');
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
