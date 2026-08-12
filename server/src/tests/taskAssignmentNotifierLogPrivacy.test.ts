/**
 * taskAssignmentNotifierLogPrivacy.test.ts — F3-IMPL-006 (Wave 2) regression
 * test confirming server/src/services/taskAssignmentNotifier.ts never writes
 * a raw caught error message to the process logs.
 *
 * sendTaskAssignmentNotification() used to log the raw `error.message` for
 * ANY failure in its preferences-lookup + user-lookup + WhatsApp-send flow
 * via `console.warn(\`[task-assignment] WhatsApp notification skipped:
 * ${error.message}\`)`. A failure inside that flow (Prisma error on the
 * assignee lookup, or a thrown provider error) could embed the assignee's
 * phone/name or a provider payload. The fix replaces the raw
 * `error.message` with safeErrorFields(error) (server/src/utils/safeError.ts),
 * which returns only {errorName, errorCode}.
 *
 * Note: the sibling `console.warn` at line 35 (result.error from
 * sendWhatsAppMessage) is intentionally NOT touched by this fix — it was
 * classified POTENTIAL_PII_SAFE_AFTER_REVIEW (a curated provider-result
 * string, never a raw exception), so this test only covers the broad
 * catch-all at the bottom of the function.
 *
 * Run with: cd server && npx tsx src/tests/taskAssignmentNotifierLogPrivacy.test.ts
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

// A realistic assignee phone that a Prisma error on the user lookup could
// plausibly echo back, matching the fixture shape used elsewhere in this
// codebase's WhatsApp assistant tests.
const RAW_ASSIGNEE_PHONE = '905559876543';

async function main() {
  section('sendTaskAssignmentNotification — raw error redaction (F3-IMPL-006)');

  await test('a failure in the assignee lookup (message embedding the raw phone) is logged only as errorName/errorCode, never raw', async () => {
    const { sendTaskAssignmentNotification } = await import('../services/taskAssignmentNotifier.js');

    (prisma as any).setting = {
      findUnique: async () => ({
        clinicId: 'clinic-1',
        key: 'notification_preferences',
        value: JSON.stringify({ whatsapp: { taskAssignment: { enabled: true } } }),
      }),
    };
    (prisma as any).user = {
      findFirst: async () => {
        throw Object.assign(
          new Error(`Unique constraint failed on phone: ${RAW_ASSIGNEE_PHONE}`),
          { code: 'P2002' },
        );
      },
    };

    const { calls, restore } = captureConsole();
    try {
      await sendTaskAssignmentNotification('clinic-1', { assignedToId: 'user-42' });
    } finally {
      restore();
    }

    const serialized = serialize(calls);
    assert.ok(!serialized.includes(RAW_ASSIGNEE_PHONE), `raw assignee phone leaked into logs: ${serialized}`);
    assert.ok(serialized.includes('"errorName":"Error"'), 'expected errorName to be logged');
    assert.ok(serialized.includes('"errorCode":"P2002"'), 'expected errorCode to be logged');
    assert.ok(serialized.includes('WhatsApp notification skipped'), 'expected the operation tag to still be logged');
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
