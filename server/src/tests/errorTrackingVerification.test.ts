/**
 * errorTrackingVerification.test.ts — F3-C2-ERR-004.
 *
 * Covers `server/src/scripts/verifyErrorTrackingDelivery.ts`, the Stage 5
 * synthetic production verification mechanism.
 *
 * The central test here is not "does the script run". It is: **take the exact
 * contaminated error and the exact unsafe context that script sends, push
 * them through the real, unmocked `errorTracking.ts` sanitizers, and assert
 * that not one byte of any canary token survives into the outbound event.**
 *
 * That matters because the script's whole value is as an affirmative
 * redaction proof performed against live production. If the payload it sends
 * and the payload this test clears ever diverged, the production check would
 * be certifying something no test had examined. Both sides therefore import
 * the same exported constants — there is one source of truth for what gets
 * sent, and it lives in the script.
 *
 * This suite deliberately never sets `SENTRY_DSN` to a deliverable value and
 * never calls the script's `main()` in a state where it would transmit. The
 * transmitting path is exercised only through the boundary's own injected
 * fake loader, exactly as `errorTracking.test.ts` does.
 *
 * Run with: tsx src/tests/errorTrackingVerification.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildOutboundCaptureContext,
  EXTERNAL_TRACKING_MESSAGE,
  sanitizeOutboundEvent,
  UNSAFE_ROUTE_PLACEHOLDER,
} from '../utils/errorTracking.js';
import {
  allCanaryTokens,
  buildContaminatedVerificationError,
  CONFIRM_FLAG,
  describeConfiguration,
  flushErrorTracking,
  main,
  VERIFICATION_CANARY,
  VERIFICATION_SAFE_REQUEST_ID_PREFIX,
  VERIFICATION_UNSAFE_REQUEST_ID,
  VERIFICATION_UNSAFE_ROLE,
  VERIFICATION_UNSAFE_ROUTE,
} from '../scripts/verifyErrorTrackingDelivery.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

/** Captures stdout so `main()` can be asserted on without polluting output. */
async function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    chunks.push(String(s));
    return true;
  };
  try {
    const code = await fn();
    return { code, out: chunks.join('') };
  } finally {
    (process.stdout as unknown as { write: typeof original }).write = original;
  }
}

/** Deep scan: every string anywhere in the structure, including keys. */
function collectStrings(value: unknown, acc: string[] = []): string[] {
  if (typeof value === 'string') acc.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, acc);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.push(k);
      collectStrings(v, acc);
    }
  }
  return acc;
}

async function run() {
  section('The contaminated payload the script sends is fully redacted by the real boundary');

  await test('outbound context carries no canary token (unsafe context)', () => {
    const context = buildOutboundCaptureContext(buildContaminatedVerificationError(), {
      requestId: VERIFICATION_UNSAFE_REQUEST_ID,
      role: VERIFICATION_UNSAFE_ROLE,
      route: VERIFICATION_UNSAFE_ROUTE,
    });
    const haystack = collectStrings(context).join(' ');
    for (const token of allCanaryTokens()) {
      assert.equal(haystack.includes(token), false, `canary leaked into capture context: ${token}`);
    }
  });

  await test('outbound context carries no canary token (safe context)', () => {
    const context = buildOutboundCaptureContext(buildContaminatedVerificationError(), {
      requestId: `${VERIFICATION_SAFE_REQUEST_ID_PREFIX}-1234`,
      role: 'api',
      route: '/api/__verification/:id',
    });
    const haystack = collectStrings(context).join(' ');
    for (const token of allCanaryTokens()) {
      assert.equal(haystack.includes(token), false, `canary leaked into capture context: ${token}`);
    }
  });

  await test('the full outbound EVENT carries no canary token', () => {
    // Model what the SDK hands beforeSend: our context, merged onto an event
    // that the SDK also decorated with the raw error's own material — the
    // pessimistic case where an integration slipped through.
    const err = buildContaminatedVerificationError();
    const context = buildOutboundCaptureContext(err, {
      requestId: VERIFICATION_UNSAFE_REQUEST_ID,
      role: VERIFICATION_UNSAFE_ROLE,
      route: VERIFICATION_UNSAFE_ROUTE,
    });
    const sdkAssembledEvent = {
      message: EXTERNAL_TRACKING_MESSAGE,
      event_id: 'abc123',
      timestamp: 1700000000,
      environment: 'production',
      release: 'deadbeef',
      ...context,
      // Hostile extras the deny-by-default rebuild must discard wholesale.
      server_name: 'noramedi-prod-01',
      exception: { values: [{ type: err.name, value: err.message }] },
      breadcrumbs: [{ message: VERIFICATION_CANARY.messageBody }],
      request: {
        url: VERIFICATION_UNSAFE_ROUTE,
        headers: {
          authorization: VERIFICATION_CANARY.authorization,
          cookie: VERIFICATION_CANARY.cookie,
        },
        data: { tckn: VERIFICATION_CANARY.tckn },
      },
      user: { email: VERIFICATION_CANARY.email, id: VERIFICATION_CANARY.tckn },
      contexts: { device: { name: VERIFICATION_CANARY.patientName } },
      modules: { 'some-pkg': VERIFICATION_CANARY.storageCredential },
    };

    const outbound = sanitizeOutboundEvent(sdkAssembledEvent);
    assert.notEqual(outbound, null);
    const haystack = collectStrings(outbound).join(' ');
    for (const token of allCanaryTokens()) {
      assert.equal(haystack.includes(token), false, `canary leaked onto the wire: ${token}`);
    }
    // And the whole canary namespace, not just the enumerated values.
    assert.equal(/NORAMEDI-CANARY/.test(haystack), false, 'a canary-namespaced value survived');
  });

  await test('the sanitized event keeps exactly the operationally necessary fields', () => {
    const err = buildContaminatedVerificationError();
    const context = buildOutboundCaptureContext(err, {
      requestId: VERIFICATION_UNSAFE_REQUEST_ID,
      role: VERIFICATION_UNSAFE_ROLE,
      route: VERIFICATION_UNSAFE_ROUTE,
    });
    const outbound = sanitizeOutboundEvent({
      message: EXTERNAL_TRACKING_MESSAGE,
      event_id: 'abc123',
      timestamp: 1700000000,
      environment: 'production',
      release: 'deadbeef',
      ...context,
    }) as Record<string, unknown>;

    assert.deepEqual(Object.keys(outbound).sort(), [
      'environment',
      'event_id',
      'extra',
      'level',
      'message',
      'platform',
      'release',
      'tags',
      'timestamp',
    ].sort());
    assert.equal(outbound.message, EXTERNAL_TRACKING_MESSAGE);
    assert.deepEqual(outbound.tags, { errType: 'Error' });
    assert.deepEqual(outbound.extra, { route: UNSAFE_ROUTE_PLACEHOLDER });
  });

  await test('unsafe role and requestId are DROPPED, not placeholdered', () => {
    const context = buildOutboundCaptureContext(buildContaminatedVerificationError(), {
      requestId: VERIFICATION_UNSAFE_REQUEST_ID,
      role: VERIFICATION_UNSAFE_ROLE,
      route: VERIFICATION_UNSAFE_ROUTE,
    }) as { tags: Record<string, unknown>; extra: Record<string, unknown> };
    assert.equal('role' in context.tags, false);
    assert.equal('requestId' in context.tags, false);
    assert.equal(context.extra.route, UNSAFE_ROUTE_PLACEHOLDER);
  });

  await test('the safe context DOES survive, so the event is findable', () => {
    const requestId = `${VERIFICATION_SAFE_REQUEST_ID_PREFIX}-4242`;
    const context = buildOutboundCaptureContext(buildContaminatedVerificationError(), {
      requestId,
      role: 'api',
      route: '/api/__verification/:id',
    }) as { tags: Record<string, unknown>; extra: Record<string, unknown> };
    assert.equal(context.tags.requestId, requestId);
    assert.equal(context.tags.role, 'api');
    assert.equal(context.extra.route, '/api/__verification/:id');
  });

  section('The script refuses to transmit unless explicitly and correctly invoked');

  await test('no confirmation flag -> refuses, exit 2, sends nothing', async () => {
    const { code, out } = await captureStdout(() =>
      main([], { SENTRY_DSN: 'https://k@example.invalid/1' } as NodeJS.ProcessEnv),
    );
    assert.equal(code, 2);
    assert.match(out, /REFUSED=YES REASON=MISSING_CONFIRMATION_FLAG/);
    assert.equal(out.includes('EVENTS_SENT'), false);
  });

  await test('confirmation flag but no DSN -> refuses, exit 3, sends nothing', async () => {
    const { code, out } = await captureStdout(() => main([CONFIRM_FLAG], {} as NodeJS.ProcessEnv));
    assert.equal(code, 3);
    assert.match(out, /REFUSED=YES REASON=SENTRY_DSN_NOT_CONFIGURED/);
    assert.equal(out.includes('EVENTS_SENT'), false);
  });

  await test('a whitespace-only DSN counts as not configured', async () => {
    const { code } = await captureStdout(() =>
      main([CONFIRM_FLAG], { SENTRY_DSN: '   ' } as NodeJS.ProcessEnv),
    );
    assert.equal(code, 3);
  });

  section('The DSN is never printed, logged, or partially disclosed');

  await test('describeConfiguration reports a boolean, never the DSN value', () => {
    const dsn = 'https://SUPERSECRETKEY@glitchtip.example.invalid/7';
    const described = describeConfiguration({ SENTRY_DSN: dsn } as NodeJS.ProcessEnv);
    assert.equal(described.SENTRY_DSN_CONFIGURED, 'YES');
    const haystack = collectStrings(described).join(' ');
    assert.equal(haystack.includes('SUPERSECRETKEY'), false);
    assert.equal(haystack.includes(dsn), false);
    assert.equal(haystack.includes('glitchtip.example.invalid'), false);
  });

  await test('the refusal path never echoes a configured DSN', async () => {
    // NOTE: this is deliberately the ONLY case where a DSN is present, and it
    // is paired with a MISSING confirmation flag. `main()` returns before it
    // reaches `captureFatalError`, so this suite can never transmit — not to a
    // provider, and not to an invalid host either. Never add the confirmation
    // flag to a case that also sets SENTRY_DSN.
    const dsn = 'https://SUPERSECRETKEY@glitchtip.example.invalid/7';
    const { code, out } = await captureStdout(() =>
      main([], { SENTRY_DSN: dsn, NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    );
    assert.equal(code, 2);
    assert.equal(out.includes('SUPERSECRETKEY'), false);
    assert.equal(out.includes(dsn), false);
    assert.equal(out.includes('glitchtip.example.invalid'), false);
    assert.match(out, /SENTRY_DSN_CONFIGURED=YES/);
  });

  await test('the script source contains no statement that prints SENTRY_DSN', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../scripts/verifyErrorTrackingDelivery.ts', import.meta.url)),
      'utf8',
    );
    // Strip block and line comments: the module docstring legitimately
    // discusses SENTRY_DSN in prose, and matching that would be a false hit.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    // Count *reads of the environment variable* — `\b(?!_)` so the boundary
    // excludes the `SENTRY_DSN_CONFIGURED` label, which merely contains the
    // name as a substring and discloses nothing. Matching the bare token
    // instead would make this assertion about naming, not about disclosure.
    const dsnReads = code.match(/\benv\.SENTRY_DSN\b(?!_)/g) ?? [];
    assert.equal(dsnReads.length, 1, `expected exactly one env.SENTRY_DSN read, got ${dsnReads.length}`);
    // The only other mentions may be the boolean label and the refusal reason.
    for (const m of code.match(/SENTRY_DSN\w*/g) ?? []) {
      assert.equal(
        m === 'SENTRY_DSN' || m === 'SENTRY_DSN_CONFIGURED' || m === 'SENTRY_DSN_NOT_CONFIGURED',
        true,
        `unexpected DSN-adjacent identifier in script source: ${m}`,
      );
    }
    assert.match(code, /SENTRY_DSN_CONFIGURED:\s*env\.SENTRY_DSN\?\.trim\(\)\s*\?\s*'YES'\s*:\s*'NO'/);
    // And no output call may take the DSN as an argument.
    assert.equal(/(console\.\w+|out|write)\([^)]*env\.SENTRY_DSN/.test(code), false);
  });

  section('Flush reports honestly instead of throwing');

  await test('a missing SDK reports SDK_UNAVAILABLE, never throws', async () => {
    const status = await flushErrorTracking(() => Promise.reject(new Error('not installed')));
    assert.equal(status, 'SDK_UNAVAILABLE');
  });

  await test('a false flush result reports FLUSH_TIMEOUT', async () => {
    const status = await flushErrorTracking(() => Promise.resolve({ flush: async () => false }));
    assert.equal(status, 'FLUSH_TIMEOUT');
  });

  await test('a throwing flush reports FLUSH_ERROR, never throws', async () => {
    const status = await flushErrorTracking(() =>
      Promise.resolve({
        flush: async () => {
          throw new Error('transport exploded');
        },
      }),
    );
    assert.equal(status, 'FLUSH_ERROR');
  });

  await test('a successful flush reports FLUSHED', async () => {
    const status = await flushErrorTracking(() => Promise.resolve({ flush: async () => true }));
    assert.equal(status, 'FLUSHED');
  });

  section('The canary set actually covers the F3-C2-ERR-002 §5.2 prohibited classes');

  await test('every prohibited class named in the runbook has a canary', () => {
    const keys = Object.keys(VERIFICATION_CANARY);
    for (const required of [
      'patientName',
      'tckn',
      'phone',
      'email',
      'address',
      'diagnosis',
      'appointmentNote',
      'messageBody',
      'authorization',
      'cookie',
      'databaseUrl',
      'storageCredential',
      'metaSecret',
      'dicomPatientName',
      'dicomPatientId',
      'accession',
      'uploadedFilename',
      'clinicId',
    ]) {
      assert.equal(keys.includes(required), true, `missing canary for prohibited class: ${required}`);
    }
  });

  await test('every canary token is distinctive enough to search for', () => {
    const tokens = allCanaryTokens();
    assert.equal(new Set(tokens).size, tokens.length, 'canary tokens must be unique');
    for (const t of tokens) assert.equal(t.length >= 12, true, `canary too short to search: ${t}`);
  });

  await test('the contaminated error really does carry the canaries (test is falsifiable)', () => {
    const err = buildContaminatedVerificationError();
    const raw = [
      err.message,
      err.name,
      String((err as Error & { cause?: unknown }).cause),
      JSON.stringify((err as unknown as Record<string, unknown>).patientRecord),
    ].join(' ');
    // If this ever stopped being true, the redaction tests above would pass
    // vacuously against an already-clean payload.
    assert.equal(raw.includes(VERIFICATION_CANARY.tckn), true);
    assert.equal(raw.includes(VERIFICATION_CANARY.patientName), true);
    assert.equal(raw.includes(VERIFICATION_CANARY.errorName), true);
    assert.equal(raw.includes(VERIFICATION_CANARY.authorization), true);
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
