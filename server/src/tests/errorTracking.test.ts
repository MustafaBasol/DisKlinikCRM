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
 * only a fixed generic message plus a bounded errType ('Error'/'UnknownError')
 * and requestId/role/route may be sent. See utils/errorTracking.ts's module
 * docstring, "Privacy contract".
 *
 * R2 adds the poisoned-`Error.name` case: `Error.prototype.name` is a plain
 * writable string, so `err.name = '<sensitive text>'` is valid JS and must
 * not pass through to the outbound payload either — see
 * `safeExternalErrorType()` in utils/errorTracking.ts.
 *
 * R3 (F3-C2-ERR-001) covers the *activation* half, now that `@sentry/node` is
 * a real dependency and the boundary can actually deliver:
 *
 *   - the exact `Sentry.init` restrictions that make the SDK deny-by-default
 *     (`defaultIntegrations: false`, `skipOpenTelemetrySetup`,
 *     `registerEsmLoaderHooks: false`, `includeServerName: false`, …) — these
 *     are asserted as a *contract*, because each one was verified against the
 *     installed v10.70.0 build to be individually load-bearing;
 *   - `captureException` is never called, only `captureMessage`;
 *   - the SDK is initialized exactly once across many failures;
 *   - `sanitizeOutboundEvent`'s deny-by-default rebuild drops anything that is
 *     not this module's own synthetic event, and re-bounds every field;
 *   - request-shaped material (bodies, headers, cookies, query strings, bearer
 *     tokens, raw paths with ids) cannot enter the outbound object even if a
 *     future caller passes it in `ErrorTrackingContext`;
 *   - a failing/throwing SDK can neither reject into the caller (which, via
 *     `void captureFatalError(...)` + utils/fatalErrorHandlers.ts's
 *     `unhandledRejection` handler, would `process.exit(1)` the API) nor
 *     block the HTTP error response.
 *
 * Run with: tsx src/tests/errorTracking.test.ts
 */

import assert from 'node:assert/strict';
import {
  buildOutboundCaptureContext,
  buildSentryInitOptions,
  captureFatalError,
  EXTERNAL_TRACKING_MESSAGE,
  resetErrorTrackingStateForTests,
  sanitizeOutboundEvent,
  setSentryModuleLoaderForTests,
  UNSAFE_ROUTE_PLACEHOLDER,
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

/**
 * Captures every captureMessage() call so tests can assert on the exact
 * outbound payload. The fake deliberately also exposes a `captureException`
 * spy — the real `MinimalSentryModule` interface does not declare one, and
 * this module must never reach for it even though the installed SDK exports
 * it (see utils/errorTracking.ts, "API choice").
 */
function makeCapturingFakeSentry() {
  const initCalls: Record<string, unknown>[] = [];
  const captureMessageCalls: { message: string; context?: Record<string, unknown> }[] = [];
  const captureExceptionCalls: unknown[] = [];
  return {
    module: {
      init(options: Record<string, unknown>) {
        initCalls.push(options);
      },
      captureMessage(message: string, context?: Record<string, unknown>) {
        captureMessageCalls.push({ message, context });
      },
      captureException(err: unknown) {
        captureExceptionCalls.push(err);
      },
    },
    initCalls,
    captureMessageCalls,
    captureExceptionCalls,
  };
}

/** A fake whose every entry point throws — the "SDK is broken" case. */
function makeThrowingFakeSentry(failOn: 'init' | 'captureMessage') {
  let initCalls = 0;
  let captureMessageCalls = 0;
  return {
    module: {
      init() {
        initCalls++;
        if (failOn === 'init') throw new Error('sentry init exploded');
      },
      captureMessage() {
        captureMessageCalls++;
        if (failOn === 'captureMessage') throw new Error('sentry captureMessage exploded');
      },
    },
    get initCalls() {
      return initCalls;
    },
    get captureMessageCalls() {
      return captureMessageCalls;
    },
  };
}

/** Runs `fn` with SENTRY_DSN set to a syntactically valid test DSN, then restores. */
async function withDsn(fn: () => Promise<void>) {
  const previous = process.env.SENTRY_DSN;
  process.env.SENTRY_DSN = 'https://example@o0.ingest.sentry.io/0';
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = previous;
    resetErrorTrackingStateForTests();
  }
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

  section('captureFatalError — SENTRY_DSN set, @sentry/node unloadable (degraded deploy)');

  // NOTE (F3-C2-ERR-001): before R3 these two cases let the *real* dynamic
  // `import('@sentry/node')` run and relied on it rejecting, because the
  // package was deliberately not a dependency. It is one now, so letting the
  // real import run here would construct a real Sentry client and attempt a
  // real outbound HTTPS request to the test DSN's host from the test suite.
  // The degraded path is therefore simulated through the same test seam every
  // other case uses. No test in this file may ever reach the network.
  await test('resolves without throwing (package absence is caught, not propagated)', async () => {
    resetErrorTrackingStateForTests();
    setSentryModuleLoaderForTests(async () => null);
    await withDsn(async () => {
      await assert.doesNotReject(() =>
        captureFatalError(new Error('boom'), { requestId: 'req-1', role: 'api', route: '/api/patients/:id' }),
      );
    });
  });

  await test('repeated calls with DSN set but package missing keep no-op-ing (no throw, no unbounded retry storm)', async () => {
    resetErrorTrackingStateForTests();
    let loaderCalls = 0;
    setSentryModuleLoaderForTests(async () => {
      loaderCalls++;
      return null;
    });
    await withDsn(async () => {
      await assert.doesNotReject(() => captureFatalError(new Error('first')));
      await assert.doesNotReject(() => captureFatalError(new Error('second')));
      await assert.doesNotReject(() => captureFatalError(new Error('third')));
      assert.equal(loaderCalls, 3);
    });
  });

  await test('no test in this file ever lets the real @sentry/node transport run', async () => {
    // Guard-rail for future edits: with a DSN set and NO loader override, the
    // real SDK would initialize and try to reach the DSN host. Assert that the
    // module-level override seam is what every DSN-bearing case relies on.
    resetErrorTrackingStateForTests();
    const fake = makeCapturingFakeSentry();
    setSentryModuleLoaderForTests(async () => fake.module);
    await withDsn(async () => {
      await captureFatalError(new Error('boom'));
      assert.equal(fake.initCalls.length, 1);
      assert.equal(fake.captureMessageCalls.length, 1);
    });
    // withDsn()'s finally clause runs resetErrorTrackingStateForTests(), which
    // clears the loader override *and* restores whatever SENTRY_DSN the host
    // environment had — so no later case inherits an injected loader, and none
    // inherits a DSN this file invented.
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

  await test('poisoned Error.name (attacker/app-set free text) never reaches the outbound payload or errType', async () => {
    resetErrorTrackingStateForTests();
    const fake = makeCapturingFakeSentry();
    setSentryModuleLoaderForTests(async () => fake.module);
    const previous = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = 'https://example@o0.ingest.sentry.io/0';
    try {
      const err = new Error('safe');
      err.name =
        'patient=Mustafa Secret email=patient@example.test phone=+905551112233 token=VERY_SECRET_TOKEN';
      await captureFatalError(err, { requestId: 'req-45', role: 'api', route: '/api/patients/:id' });

      assert.equal(fake.captureMessageCalls.length, 1);
      const [call] = fake.captureMessageCalls;

      assert.equal(call.message, 'internal error captured');
      assertNoSecretsAnywhereIn(call.message);
      assertNoSecretsAnywhereIn(call.context);

      // errType must be the bounded classification, never the poisoned err.name.
      assert.equal((call.context?.tags as Record<string, unknown>).errType, 'Error');

      assert.equal(fake.initCalls.length, 1);
      assertNoSecretsAnywhereIn(fake.initCalls[0]);
    } finally {
      if (previous === undefined) delete process.env.SENTRY_DSN; else process.env.SENTRY_DSN = previous;
      resetErrorTrackingStateForTests();
    }
  });

  section('F3-C2-ERR-001 — Sentry.init deny-by-default configuration contract');

  await test('every load-bearing suppression option is pinned explicitly', async () => {
    const options = buildSentryInitOptions('https://example@o0.ingest.sentry.io/0');

    // Deny by default: no integration is constructed at all. Verified against
    // the installed @sentry/node 10.70.0 build — `defaultIntegrations: false`
    // short-circuits `getDefaultIntegrations()`, and @sentry/core's
    // `getIntegrationsToSetup` evaluates `options.defaultIntegrations || []`.
    assert.equal(options.defaultIntegrations, false);
    assert.deepEqual(options.integrations, []);

    // No OpenTelemetry runtime setup, no import-in-the-middle ESM loader hook.
    // `registerEsmLoaderHooks` is NOT optional on Node >= 21 ESM: node-core's
    // `_init` registers the hook unless this is exactly `false`.
    assert.equal(options.skipOpenTelemetrySetup, true);
    assert.equal(options.registerEsmLoaderHooks, false);

    // No tracing/performance/profiling. Pinned rather than left undefined,
    // because the SDK otherwise reads SENTRY_TRACES_SAMPLE_RATE from the env.
    assert.equal(options.tracesSampleRate, 0);
    assert.equal(options.profileSessionSampleRate, 0);

    // No PII, no host identity, no stacks, no breadcrumbs, no logs.
    // `includeServerName` is the only thing that suppresses `server_name`,
    // which defaults to os.hostname() in the *client*, not in an integration —
    // so `defaultIntegrations: false` does not cover it.
    assert.equal(options.sendDefaultPii, false);
    assert.equal(options.includeServerName, false);
    assert.equal(options.attachStacktrace, false);
    assert.equal(options.maxBreadcrumbs, 0);
    assert.equal(options.enableLogs, false);

    // No secondary egress channels.
    assert.equal(options.sendClientReports, false);
    assert.equal(options.spotlight, false);
    assert.equal(options.debug, false);

    // Final, SDK-independent outbound net.
    assert.equal(typeof options.beforeSend, 'function');
    assert.equal(typeof options.beforeSendTransaction, 'function');
    assert.equal(typeof options.beforeBreadcrumb, 'function');
    assert.equal((options.beforeBreadcrumb as () => unknown)(), null);
    assert.equal((options.beforeSendTransaction as () => unknown)(), null);
  });

  await test('the DSN is passed through but never hardcoded, and no secret is embedded in the options', async () => {
    const options = buildSentryInitOptions('https://example@o0.ingest.sentry.io/0');
    assert.equal(options.dsn, 'https://example@o0.ingest.sentry.io/0');
    // Nothing in this repository may carry a real DSN; the only source is env.
    const serialized = JSON.stringify(options);
    assert.ok(!serialized.includes('ingest.sentry.io/1'));
    assertNoSecretsAnywhereIn({ ...options, dsn: undefined });
  });

  section('F3-C2-ERR-001 — sanitizeOutboundEvent: deny-by-default outbound rebuild');

  await test('drops anything that is not this module\'s own synthetic event', async () => {
    assert.equal(sanitizeOutboundEvent(null), null);
    assert.equal(sanitizeOutboundEvent(undefined), null);
    assert.equal(sanitizeOutboundEvent('a string'), null);
    assert.equal(sanitizeOutboundEvent(42), null);
    // A raw captureException event (what a *future* caller elsewhere in the
    // process would produce) has no `message` field at all — dropped.
    assert.equal(
      sanitizeOutboundEvent({
        exception: { values: [{ type: 'Error', value: 'patient=Mustafa Secret' }] },
      }),
      null,
    );
    // A captureMessage with any other message — dropped.
    assert.equal(sanitizeOutboundEvent({ message: 'some other message' }), null);
  });

  await test('strips every SDK-attached field outside the allow-list', async () => {
    const rebuilt = sanitizeOutboundEvent({
      message: EXTERNAL_TRACKING_MESSAGE,
      event_id: 'abc123',
      timestamp: 1786696033.557,
      environment: 'production',
      release: 'deadbeef',
      platform: 'node',
      tags: { errType: 'Error', role: 'api', requestId: '4711' },
      extra: { route: '/api/patients/:id' },
      // Everything below must be discarded.
      server_name: 'noramedi-prod-01',
      modules: { '@prisma/client': '7.9.1', pg: '8.22.0' },
      breadcrumbs: [{ message: 'patient=Mustafa Secret' }],
      request: {
        url: 'https://api.noramedi.test/api/patients/42?token=VERY_SECRET_TOKEN',
        headers: { cookie: 'session=VERY_SECRET_TOKEN', authorization: 'Bearer VERY_SECRET_TOKEN' },
        data: { patientEmail: 'patient@example.test' },
      },
      user: { email: 'patient@example.test', ip_address: '203.0.113.7' },
      contexts: {
        os: { name: 'Linux' },
        device: { cpu_description: 'Intel' },
        culture: { timezone: 'Europe/Istanbul' },
        runtime: { name: 'node', version: 'v24.18.0' },
        trace: { trace_id: 'ffff', span_id: 'eeee' },
      },
      exception: { values: [{ value: 'patient=Mustafa Secret' }] },
      threads: { values: [{ stacktrace: { frames: [{ vars: { token: 'VERY_SECRET_TOKEN' } }] } }] },
      logentry: { message: 'patient=Mustafa Secret' },
    });

    assert.ok(rebuilt !== null);
    assert.deepEqual(Object.keys(rebuilt).sort(), [
      'environment',
      'event_id',
      'extra',
      'level',
      'message',
      'platform',
      'release',
      'tags',
      'timestamp',
    ]);
    assert.equal(rebuilt.message, EXTERNAL_TRACKING_MESSAGE);
    assert.equal(rebuilt.level, 'error');
    assertNoSecretsAnywhereIn(rebuilt);
    const serialized = JSON.stringify(rebuilt);
    assert.ok(!serialized.includes('noramedi-prod-01'), 'server_name must not survive');
    assert.ok(!serialized.includes('@prisma/client'), 'module inventory must not survive');
    assert.ok(!serialized.includes('203.0.113.7'), 'user ip must not survive');
    assert.ok(!serialized.includes('Europe/Istanbul'), 'culture context must not survive');
  });

  await test('re-bounds tags and route even when they arrive poisoned', async () => {
    const rebuilt = sanitizeOutboundEvent({
      message: EXTERNAL_TRACKING_MESSAGE,
      tags: {
        errType: 'patient=Mustafa Secret',
        role: 'patient@example.test',
        requestId: 'token=VERY_SECRET_TOKEN',
        // an entirely unexpected tag key
        patientEmail: 'patient@example.test',
      },
      extra: {
        route: '/api/patients/42?email=patient@example.test',
        note: 'patient=Mustafa Secret',
      },
    });

    assert.ok(rebuilt !== null);
    assertNoSecretsAnywhereIn(rebuilt);
    // errType/role/requestId all failed their bounds, so no tags survive at all.
    assert.equal(rebuilt.tags, undefined);
    // The route failed ROUTE_PATTERN (query string + '@' + '='), so it is
    // replaced by the fixed placeholder rather than dropped or forwarded.
    assert.deepEqual(rebuilt.extra, { route: UNSAFE_ROUTE_PLACEHOLDER });
  });

  section('F3-C2-ERR-001 — outbound capture context bounding');

  await test('a raw request path with an embedded id/query never survives as `route`', async () => {
    const context = buildOutboundCaptureContext(new Error('x'), {
      route: '/api/patients/42?email=patient@example.test&token=VERY_SECRET_TOKEN',
      role: 'api',
      requestId: 4711,
    });
    assertNoSecretsAnywhereIn(context);
    assert.deepEqual(context.extra, { route: UNSAFE_ROUTE_PLACEHOLDER });
    assert.deepEqual(context.tags, { errType: 'Error', role: 'api', requestId: '4711' });
  });

  await test('header/cookie/authorization-shaped values cannot enter tags', async () => {
    const context = buildOutboundCaptureContext(new Error('x'), {
      role: 'Bearer VERY_SECRET_TOKEN',
      requestId: 'session=VERY_SECRET_TOKEN; path=/',
      route: '/api/patients/:id',
    });
    assertNoSecretsAnywhereIn(context);
    // Both failed their bounds and were dropped entirely — only errType remains.
    assert.deepEqual(context.tags, { errType: 'Error' });
    assert.deepEqual(context.extra, { route: '/api/patients/:id' });
  });

  await test('a legitimate Express 5 route template survives verbatim', async () => {
    for (const route of ['/api/patients/:id', '/:unmatched', '/api/clinics/:clinicId/patients', '/api/files/*splat']) {
      const context = buildOutboundCaptureContext(new Error('x'), { route, role: 'api' });
      assert.deepEqual(context.extra, { route }, `expected ${route} to survive unchanged`);
    }
  });

  section('F3-C2-ERR-001 — SDK available: init-once, captureMessage-only');

  await test('initializes exactly once across many failures, and only ever calls captureMessage', async () => {
    resetErrorTrackingStateForTests();
    const fake = makeCapturingFakeSentry();
    setSentryModuleLoaderForTests(async () => fake.module);
    await withDsn(async () => {
      for (let i = 0; i < 25; i++) {
        await captureFatalError(new Error(`boom ${i}`), {
          requestId: i,
          role: 'api',
          route: '/api/patients/:id',
        });
      }
      assert.equal(fake.initCalls.length, 1, 'Sentry.init must run exactly once per process');
      assert.equal(fake.captureMessageCalls.length, 25);
      assert.equal(fake.captureExceptionCalls.length, 0, 'captureException must never be called');
      for (const call of fake.captureMessageCalls) {
        assert.equal(call.message, EXTERNAL_TRACKING_MESSAGE);
      }
    });
  });

  await test('err.stack is never reachable in the outbound payload', async () => {
    resetErrorTrackingStateForTests();
    const fake = makeCapturingFakeSentry();
    setSentryModuleLoaderForTests(async () => fake.module);
    await withDsn(async () => {
      const err = makeSentinelError();
      // Poison the stack too — a stack frame path can itself carry a tenant name.
      err.stack = 'Error: patient=Mustafa Secret\n    at /srv/patient@example.test/app.js:1:1';
      await captureFatalError(err, { requestId: 'req-90', role: 'api', route: '/api/patients/:id' });

      assert.equal(fake.captureMessageCalls.length, 1);
      const serialized = JSON.stringify(fake.captureMessageCalls[0]);
      assertNoSecretsAnywhereIn(fake.captureMessageCalls[0]);
      assert.ok(!serialized.includes('at /srv'), 'no stack frame may appear in the payload');
      assert.ok(!serialized.includes('stack'), 'no stack field may appear in the payload');
    });
  });

  await test('arbitrary custom error properties never reach the outbound payload', async () => {
    resetErrorTrackingStateForTests();
    const fake = makeCapturingFakeSentry();
    setSentryModuleLoaderForTests(async () => fake.module);
    await withDsn(async () => {
      const err = Object.assign(new Error('safe'), {
        patientEmail: 'patient@example.test',
        authorization: 'Bearer VERY_SECRET_TOKEN',
        requestBody: { note: 'patient=Mustafa Secret' },
        query: { token: 'VERY_SECRET_TOKEN' },
        code: 'P2002',
        meta: { target: ['email'] },
      });
      await captureFatalError(err, { requestId: 'req-91', role: 'api', route: '/api/patients/:id' });

      assert.equal(fake.captureMessageCalls.length, 1);
      const call = fake.captureMessageCalls[0];
      assertNoSecretsAnywhereIn(call);
      const serialized = JSON.stringify(call);
      assert.ok(!serialized.includes('P2002'), 'provider-specific error codes are not forwarded');
      assert.ok(!serialized.includes('requestBody'));
      assert.ok(!serialized.includes('authorization'));
    });
  });

  section('F3-C2-ERR-001 — availability: a broken SDK can never reject or block the caller');

  await test('a throwing Sentry.init is swallowed, latched, and never retried per-request', async () => {
    resetErrorTrackingStateForTests();
    const fake = makeThrowingFakeSentry('init');
    setSentryModuleLoaderForTests(async () => fake.module);
    await withDsn(async () => {
      for (let i = 0; i < 5; i++) {
        await assert.doesNotReject(() => captureFatalError(new Error('boom')));
      }
      assert.equal(fake.initCalls, 1, 'a permanently broken init must not be retried on every 5xx');
      assert.equal(fake.captureMessageCalls, 0);
    });
  });

  await test('a throwing Sentry.captureMessage is swallowed and never rejects into the caller', async () => {
    resetErrorTrackingStateForTests();
    const fake = makeThrowingFakeSentry('captureMessage');
    setSentryModuleLoaderForTests(async () => fake.module);
    await withDsn(async () => {
      for (let i = 0; i < 5; i++) {
        await assert.doesNotReject(() => captureFatalError(new Error('boom')));
      }
      assert.equal(fake.captureMessageCalls, 5);
    });
  });

  await test('a rejecting module loader is swallowed and never rejects into the caller', async () => {
    resetErrorTrackingStateForTests();
    setSentryModuleLoaderForTests(async () => {
      throw new Error('module resolution exploded');
    });
    await withDsn(async () => {
      await assert.doesNotReject(() => captureFatalError(new Error('boom')));
    });
  });

  await test('error-tracking work is never awaited by the caller (fire-and-forget stays non-blocking)', async () => {
    resetErrorTrackingStateForTests();
    let resolveLoader: (() => void) | undefined;
    const loaderGate = new Promise<void>((resolve) => {
      resolveLoader = resolve;
    });
    const fake = makeCapturingFakeSentry();
    setSentryModuleLoaderForTests(async () => {
      await loaderGate;
      return fake.module;
    });
    await withDsn(async () => {
      // This mirrors index.ts's `void captureFatalError(...)`: the HTTP error
      // response is written on the next line, with the tracking promise still
      // pending on a slow/hung provider load.
      let settled = false;
      const pending = captureFatalError(new Error('boom'), { role: 'api', route: '/api/patients/:id' })
        .then(() => {
          settled = true;
        });
      // The synchronous continuation of the error handler is unaffected.
      assert.equal(settled, false);
      assert.equal(fake.captureMessageCalls.length, 0);
      resolveLoader?.();
      await pending;
      assert.equal(settled, true);
      assert.equal(fake.captureMessageCalls.length, 1);
    });
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
