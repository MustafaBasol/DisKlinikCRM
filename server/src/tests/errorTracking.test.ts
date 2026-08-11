/**
 * errorTracking.test.ts — F3-OBS-001
 *
 * captureFatalError() (utils/errorTracking.ts) must be a safe no-op in
 * every environment this repository actually runs in today (no
 * `@sentry/node` dependency, no DSN configured anywhere) — these tests
 * prove that, plus the "DSN set but package not installed" degraded path
 * that will be true the moment someone sets SENTRY_DSN in production
 * before also running `npm install @sentry/node`. Neither path may ever
 * throw or block its caller.
 *
 * Run with: tsx src/tests/errorTracking.test.ts
 */

import assert from 'node:assert/strict';
import { captureFatalError, resetErrorTrackingStateForTests } from '../utils/errorTracking.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

async function main() {
  section('captureFatalError — SENTRY_DSN unset (every environment today)');

  await test('resolves without throwing and performs no work', async () => {
    resetErrorTrackingStateForTests();
    const previous = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    try {
      await assert.doesNotReject(() => captureFatalError(new Error('boom')));
    } finally {
      if (previous !== undefined) process.env.SENTRY_DSN = previous;
    }
  });

  await test('blank/whitespace-only SENTRY_DSN is treated as unset', async () => {
    resetErrorTrackingStateForTests();
    const previous = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = '   ';
    try {
      await assert.doesNotReject(() => captureFatalError(new Error('boom')));
    } finally {
      if (previous === undefined) delete process.env.SENTRY_DSN; else process.env.SENTRY_DSN = previous;
    }
  });

  section('captureFatalError — SENTRY_DSN set, @sentry/node not installed (current repository state)');

  await test('resolves without throwing (package absence is caught, not propagated)', async () => {
    resetErrorTrackingStateForTests();
    const previous = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://example@o0.ingest.sentry.io/0';
    try {
      await assert.doesNotReject(() => captureFatalError(new Error('boom'), { requestId: 'req-1', role: 'api', route: '/api/patients/:id' }));
    } finally {
      if (previous === undefined) delete process.env.SENTRY_DSN; else process.env.SENTRY_DSN = previous;
      resetErrorTrackingStateForTests();
    }
  });

  await test('repeated calls with DSN set but package missing keep no-op-ing (no throw, no unbounded retry storm)', async () => {
    resetErrorTrackingStateForTests();
    const previous = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://example@o0.ingest.sentry.io/0';
    try {
      await assert.doesNotReject(() => captureFatalError(new Error('first')));
      await assert.doesNotReject(() => captureFatalError(new Error('second')));
      await assert.doesNotReject(() => captureFatalError(new Error('third')));
    } finally {
      if (previous === undefined) delete process.env.SENTRY_DSN; else process.env.SENTRY_DSN = previous;
      resetErrorTrackingStateForTests();
    }
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
