/**
 * operationalEventServiceLogPrivacy.test.ts — F3-IMPL-006 (Wave 2) regression
 * test confirming server/src/services/operationalEventService.ts never writes
 * a raw caught error object to the process logs.
 *
 * recordOperationalEvent() used to log the raw `err` directly via
 * `console.error('[OperationalEvent] Failed to record event:', err)`. Since
 * this function's own `message`/`metadata` inputs are caller-supplied free
 * text (not type-enforced to be PII-free — see the file's own "Safe metadata
 * only" doc comment, which is a convention, not an enforced contract), a
 * Prisma validation error on the write could echo one of those values back
 * in its `.message`. The fix replaces the raw `err` with
 * safeErrorFields(err) (server/src/utils/safeError.ts), which returns only
 * {errorName, errorCode}.
 *
 * Run with: cd server && npx tsx src/tests/operationalEventServiceLogPrivacy.test.ts
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

// ─── Console spy ──────────────────────────────────────────────────────────────

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

// A message a caller might legitimately pass — realistic-shaped free text
// that must never survive a failed write into the process logs.
const RAW_SENSITIVE_MESSAGE = 'WhatsApp send failed for patient Ayşe Yılmaz, phone 905551234567';

async function main() {
  section('recordOperationalEvent — raw error redaction (F3-IMPL-006)');

  await test('a Prisma write failure (message embedding the caller-supplied free text) is logged only as errorName/errorCode, never raw', async () => {
    const { recordOperationalEvent } = await import('../services/operationalEventService.js');

    const originalCreate = (prisma as any).operationalEvent?.create;
    (prisma as any).operationalEvent = {
      create: async () => {
        throw Object.assign(
          new Error(`Invalid value for argument "message": "${RAW_SENSITIVE_MESSAGE}" is not a valid enum member`),
          { code: 'P2009' },
        );
      },
    };

    const { calls, restore } = captureConsole();
    try {
      await recordOperationalEvent({
        organizationId: 'org-1',
        clinicId: 'clinic-1',
        severity: 'error',
        source: 'whatsapp',
        message: RAW_SENSITIVE_MESSAGE,
        metadata: null,
      });
    } finally {
      restore();
      if (originalCreate) (prisma as any).operationalEvent.create = originalCreate;
    }

    const serialized = serialize(calls);
    assert.ok(!serialized.includes(RAW_SENSITIVE_MESSAGE), `raw message leaked into logs: ${serialized}`);
    assert.ok(serialized.includes('"errorName":"Error"'), 'expected errorName to be logged');
    assert.ok(serialized.includes('"errorCode":"P2009"'), 'expected errorCode to be logged');
    assert.ok(serialized.includes('Failed to record event'), 'expected the operation tag to still be logged');
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
