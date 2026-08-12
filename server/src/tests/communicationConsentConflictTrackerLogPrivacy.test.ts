/**
 * communicationConsentConflictTrackerLogPrivacy.test.ts — F3-IMPL-006 (Wave 2)
 * regression test confirming
 * server/src/services/communicationConsent/communicationConsentConflictTracker.ts
 * never writes a raw caught error object to the process logs.
 *
 * recordCommunicationConsentConflict() used to log the raw `err` directly via
 * `console.error('[communicationConsentConflictTracker] Failed to record
 * conflict:', err)`. This module's own inputs are deliberately
 * non-patient-identifying (organizationId/clinicId/channel/purpose/reasonCode
 * only — see the file's header comment), but the raw exception object itself
 * is unfiltered and could still surface DB/connection detail. The fix
 * replaces the raw `err` with safeErrorFields(err)
 * (server/src/utils/safeError.ts), which returns only {errorName, errorCode}.
 *
 * Run with: cd server && npx tsx src/tests/communicationConsentConflictTrackerLogPrivacy.test.ts
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

// A DB-connection-shaped detail that must never survive a failed upsert into
// the process logs, simulating what an unfiltered Postgres/Prisma error can embed.
const RAW_DB_DETAIL = 'connection to postgres://svc_user:sup3rSecret@10.0.4.12:5432/noramedi_crm refused';

async function main() {
  section('recordCommunicationConsentConflict — raw error redaction (F3-IMPL-006)');

  await test('an upsert failure (message embedding a DB connection detail) is logged only as errorName/errorCode, never raw', async () => {
    const { recordCommunicationConsentConflict } = await import(
      '../services/communicationConsent/communicationConsentConflictTracker.js'
    );

    const originalUpsert = (prisma as any).communicationConsentConflictBucket?.upsert;
    (prisma as any).communicationConsentConflictBucket = {
      upsert: async () => {
        throw Object.assign(new Error(RAW_DB_DETAIL), { code: 'P1001' });
      },
    };

    const { calls, restore } = captureConsole();
    try {
      await recordCommunicationConsentConflict({
        organizationId: 'org-1',
        clinicId: 'clinic-1',
        channel: 'whatsapp',
        purpose: 'appointment_reminder',
        reasonCode: 'legacy_opt_out',
      });
    } finally {
      restore();
      if (originalUpsert) (prisma as any).communicationConsentConflictBucket.upsert = originalUpsert;
    }

    const serialized = serialize(calls);
    assert.ok(!serialized.includes(RAW_DB_DETAIL), `raw DB detail leaked into logs: ${serialized}`);
    assert.ok(!serialized.toLowerCase().includes('sup3rsecret'), 'credential leaked into logs');
    assert.ok(serialized.includes('"errorName":"Error"'), 'expected errorName to be logged');
    assert.ok(serialized.includes('"errorCode":"P1001"'), 'expected errorCode to be logged');
    assert.ok(serialized.includes('Failed to record conflict'), 'expected the operation tag to still be logged');
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
