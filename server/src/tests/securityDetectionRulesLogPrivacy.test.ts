/**
 * securityDetectionRulesLogPrivacy.test.ts — F3-IMPL-006 (Wave 2) regression
 * test confirming
 * server/src/services/security/securityDetectionRules.ts's shared `safely()`
 * wrapper never writes a raw caught error message to the process logs.
 *
 * `safely()` wraps every evaluate*Signal export (auth/cross-tenant/export
 * signals) and used to log `err.message` directly via
 * `console.error('[security-detection] rule evaluation failed:', err.message)`.
 * Every DB call inside recordSecuritySignal/countSignalsInWindow already
 * catches its own errors (see securitySignalServiceLogPrivacy.test.ts), so
 * the one call in this file NOT wrapped by an inner try/catch —
 * `prisma.securitySignalEvent.findMany` inside evaluateCrossTenantDenialSignal's
 * multi-resource-probing check — is what actually reaches `safely()`'s own
 * catch in production. The fix replaces the raw `err.message` with
 * safeErrorFields(err) (server/src/utils/safeError.ts), which returns only
 * {errorName, errorCode}.
 *
 * Run with: cd server && npx tsx src/tests/securityDetectionRulesLogPrivacy.test.ts
 */

import assert from 'node:assert/strict';
import prisma from '../db.js';

process.env.SECURITY_SIGNAL_IP_HASH_SECRET = 'x'.repeat(40);
process.env.SECURITY_ALERT_CROSS_TENANT_THRESHOLD = '3';

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

// A raw route/resource-shaped detail that must never survive a failed
// distinct-resource lookup into the process logs.
const RAW_ROUTE_DETAIL = '/api/clinics/8e6f1e3a-secret-internal-path/patients/905551234567';

async function main() {
  section('safely() (shared error wrapper) — raw error redaction (F3-IMPL-006)');

  await test('a securitySignalEvent.findMany failure inside evaluateCrossTenantDenialSignal is logged only as errorName/errorCode, never raw', async () => {
    const { evaluateCrossTenantDenialSignal, flushPendingSecurityDetectionWork } = await import(
      '../services/security/securityDetectionRules.js'
    );

    (prisma as any).securitySignalEvent = {
      create: async () => ({ id: 'evt-1' }),
      count: async () => 3, // >= SECURITY_ALERT_CROSS_TENANT_THRESHOLD, forces the findMany probe below
      findMany: async () => {
        throw Object.assign(new Error(`Query failed near route "${RAW_ROUTE_DETAIL}"`), { code: 'P2010' });
      },
    };

    const { calls, restore } = captureConsole();
    try {
      evaluateCrossTenantDenialSignal({
        actorUserId: 'user-1',
        actorOrganizationId: 'org-1',
        attemptedResourceType: 'clinic',
        attemptedResourceId: 'clinic-2',
        method: 'GET',
        routeTemplate: RAW_ROUTE_DETAIL,
      });
      await flushPendingSecurityDetectionWork();
    } finally {
      restore();
    }

    const serialized = serialize(calls);
    assert.ok(!serialized.includes(RAW_ROUTE_DETAIL), `raw route detail leaked into logs: ${serialized}`);
    assert.ok(serialized.includes('"errorName":"Error"'), 'expected errorName to be logged');
    assert.ok(serialized.includes('"errorCode":"P2010"'), 'expected errorCode to be logged');
    assert.ok(serialized.includes('rule evaluation failed'), 'expected the operation tag to still be logged');
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
