/**
 * errorTracking.test.ts — F3-OBS-001 (R1)
 *
 * captureFatalError() (utils/errorTracking.ts) must be a safe no-op in
 * every environment this repository actually runs in today (no
 * `@sentry/node` dependency, no DSN configured anywhere) — these tests
 * prove that, plus the "DSN set but package not installed" degraded path
 * that will be true the moment someone sets SENTRY_DSN in production
 * before also running `npm install @sentry/node`. Neither path may ever
 * throw or block its caller.
 *
 * R1 adds the privacy-boundary proof: with a fake Sentry module injected
 * (`setSentryModuleLoaderForTests`), a deliberately sensitive raw error
 * (patient name/email/phone/token, including a nested `cause`) must never
 * appear anywhere in what actually reaches the "external provider" —
 * only a fixed generic message plus `err.name`/requestId/role/route may
 * be sent. See utils/errorTracking.ts's module docstring, "Privacy contract".
 *
 * Run with: tsx src/tests/errorTracking.test.ts
 */

import assert from 'node:assert/strict';
import {
  captureFatalError,
  resetErrorTrackingStateForTests,
  setSentryModuleLoaderForTests,
} from '../utils/errorTracking.js';

/** Substrings that must never appear anywhere in an external-tracking payload. */
const SENTINEL_SECRETS = [
  'Mustafa Secret',
  'patient@example.test',
  '+905551112233',
  'VERY_SECRET_TOKEN',
  'patient=',
  'email=',
  'phone=',
  'token=',
];

function makeSentinelError(): Error {
  return new Error(
    'patient=Mustafa Secret email=patient@example.test phone=+905551112233 token=VERY_SECRET_TOKEN',
  );
}

/** Captures every captureMessage() call so tests can assert on the exact outbound payload. */
function makeCapturingFakeSentry() {
  const initCalls: Record<string, unknown>[] = [];
  const captureMessageCalls: { message: string; context?: Record<string, unknown> }[] = [];
  return {
    module: {
      init(options: Record<string, unknown>) {
        initCalls.push(options);
      },
      captureMessage(message: string, context?: Record<string, unknown>) {
        captureMessageCalls.push({ message, context });
      },
    },
    initCalls,
    captureMessageCalls,
  };
}

function assertNoSecretsAnywhereIn(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const secret of SENTINEL_SECRETS) {
    assert.ok(
      !serialized.includes(secret),
      `expected outbound payload to NOT contain sentinel secret "${secret}", but it did: ${serialized}`,
    );
  }
}

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

  section('captureFatalError — privacy boundary: sanitized payload proof (fake Sentry module injected)');

  await test('sentinel raw error (patient name/email/phone/token) never reaches the outbound payload', async () => {
    resetErrorTrackingStateForTests();
    const fake = makeCapturingFakeSentry();
    setSentryModuleLoaderForTests(async () => fake.module);
    const previous = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://example@o0.ingest.sentry.io/0';
    try {
      await captureFatalError(makeSentinelError(), {
        requestId: 'req-42',
        role: 'api',
        route: '/api/patients/:id',
      });

      assert.equal(fake.captureMessageCalls.length, 1);
      const [call] = fake.captureMessageCalls;

      // Message must be the fixed, content-free string — never err.message.
      assert.equal(call.message, 'internal error captured');

      // Nothing anywhere in the message or context may contain the sentinel secrets.
      assertNoSecretsAnywhereIn(call.message);
      assertNoSecretsAnywhereIn(call.context);

      // The only fields present are the approved, sanitized ones.
      assert.equal(call.context?.tags && (call.context.tags as Record<string, unknown>).errType, 'Error');
      assert.equal(call.context?.tags && (call.context.tags as Record<string, unknown>).requestId, 'req-42');
      assert.equal(call.context?.tags && (call.context.tags as Record<string, unknown>).role, 'api');
      assert.equal(call.context?.extra && (call.context.extra as Record<string, unknown>).route, '/api/patients/:id');

      // Also assert on init() — sendDefaultPii must stay false and no raw err is ever passed to init either.
      assert.equal(fake.initCalls.length, 1);
      assert.equal(fake.initCalls[0].sendDefaultPii, false);
      assertNoSecretsAnywhereIn(fake.initCalls[0]);
    } finally {
      if (previous === undefined) delete process.env.SENTRY_DSN; else process.env.SENTRY_DSN = previous;
      resetErrorTrackingStateForTests();
    }
  });

  await test('sentinel secret hidden in a nested Error.cause also never reaches the outbound payload', async () => {
    resetErrorTrackingStateForTests();
    const fake = makeCapturingFakeSentry();
    setSentryModuleLoaderForTests(async () => fake.module);
    const previous = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://example@o0.ingest.sentry.io/0';
    try {
      const outer = new Error('outer wrapper error', { cause: makeSentinelError() });
      await captureFatalError(outer, { requestId: 'req-43', role: 'worker', route: '/api/jobs/:id' });

      assert.equal(fake.captureMessageCalls.length, 1);
      const [call] = fake.captureMessageCalls;
      assert.equal(call.message, 'internal error captured');
      assertNoSecretsAnywhereIn(call.message);
      assertNoSecretsAnywhereIn(call.context);
      // 'outer wrapper error' itself is also not sent — only the fixed message is.
      assert.ok(!JSON.stringify(call).includes('outer wrapper error'));
    } finally {
      if (previous === undefined) delete process.env.SENTRY_DSN; else process.env.SENTRY_DSN = previous;
      resetErrorTrackingStateForTests();
    }
  });

  await test('non-Error thrown value (e.g. a plain object with sensitive fields) is reduced to a fixed generic type', async () => {
    resetErrorTrackingStateForTests();
    const fake = makeCapturingFakeSentry();
    setSentryModuleLoaderForTests(async () => fake.module);
    const previous = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://example@o0.ingest.sentry.io/0';
    try {
      const rawThrow = {
        message: 'patient=Mustafa Secret token=VERY_SECRET_TOKEN',
        patientEmail: 'patient@example.test',
      };
      await captureFatalError(rawThrow, { requestId: 'req-44', role: 'api', route: '/api/patients' });

      assert.equal(fake.captureMessageCalls.length, 1);
      const [call] = fake.captureMessageCalls;
      assertNoSecretsAnywhereIn(call.message);
      assertNoSecretsAnywhereIn(call.context);
      assert.equal((call.context?.tags as Record<string, unknown>).errType, 'UnknownError');
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
