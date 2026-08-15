/**
 * minioReadiness.test.ts — F4-CI-L4-STORAGE-GATE-001-R1 regression coverage.
 *
 * Docker-free. Proves the Layer 4 MinIO readiness path is deterministic and
 * bounded: a hung, dropped, or never-settling probe becomes an ordinary "not
 * ready yet" result or a clear timeout failure, and can never park the
 * orchestrator until the event loop drains.
 *
 * The failure this pins down (PR #423, run 31893589449, job 95040001240):
 *   [test-runtime] stage: storage:minio-readiness      16:43:51.7099
 *   [test-runtime] FAIL-CLOSED: ... event loop drained 16:43:51.7513
 * 42ms. On Node 20 — the version Layer 4 pins — undici drops a `fetch()`
 * whose TCP connection is accepted and then closed by the peer before any
 * response byte is written (a freshly-published Docker port whose container is
 * still starting). The promise never settles, no ref'd handle survives, and
 * the readiness loop parks forever. Node 24 rejects that case, which is why it
 * never reproduced locally.
 *
 * Three layers of proof:
 *   1. unit    — bounded-probe and selection-loop semantics
 *   2. socket  — the REAL defaultMinioReadinessProbe against real TCP peers
 *                behaving the way a starting MinIO container does
 *   3. mutation— a child process running the pre-R1 unbounded shape must still
 *                drain to exit 91, while the shipped shape terminates cleanly
 *
 * Run: npx tsx scripts/test-runtime/__tests__/minioReadiness.test.ts
 */
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  defaultMinioReadinessProbe,
  runBoundedProbe,
  selectReadyMinioEndpoint,
  waitForMinioReady,
  DEFAULT_PROBE_ATTEMPT_TIMEOUT_MS,
  MinioReadinessConfigurationError,
  MinioReadinessTimeoutError,
  type MinioEndpointCandidate,
  type MinioProbeResult,
  type MinioReadinessProbe,
} from '../lib/minio.js';
import { combineOutcome, EXIT_ABNORMAL_TERMINATION } from '../lib/outcome.js';

let passed = 0;
let failed = 0;

function section(name: string) {
  console.log(`\n${name}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    failed++;
  }
}

async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    failed++;
  }
}

/** Counts only the resource class this code creates and must clean up. */
function activeTimerCount(): number {
  return process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
}

const NEVER_SETTLES: MinioReadinessProbe = () => new Promise<never>(() => {});

const CANDIDATE_CONTAINER: MinioEndpointCandidate = { endpoint: 'http://172.18.0.3:9000', mode: 'container-network' };
const CANDIDATE_LOOPBACK: MinioEndpointCandidate = { endpoint: 'http://127.0.0.1:32769', mode: 'loopback-fallback' };

// ─── 1. Bounded probe semantics ─────────────────────────────────────────────
section('runBoundedProbe — every attempt is bounded by the caller, not the callee');

await testAsync('a never-settling probe resolves as a deterministic timeout instead of hanging', async () => {
  const started = Date.now();
  const result = await runBoundedProbe(NEVER_SETTLES, CANDIDATE_CONTAINER.endpoint, 60);
  const elapsed = Date.now() - started;
  assertEqual(result.status, 'timeout', 'a dropped/never-settling attempt must be classified as a timeout');
  assertEqual(result.ready, false, 'a timed-out attempt is never ready');
  assert(elapsed < 5_000, `must settle at its own deadline, not hang (took ${elapsed}ms)`);
  assert(result.detail.includes('60ms'), `the detail must name the bound it hit, got "${result.detail}"`);
});

await testAsync('a settling probe is passed through untouched', async () => {
  const probe: MinioReadinessProbe = async () => ({ ready: true, status: 'ready', detail: 'HTTP 200' });
  const result = await runBoundedProbe(probe, CANDIDATE_CONTAINER.endpoint, 1_000);
  assertEqual(result.ready, true, 'a ready answer survives the wrapper');
  assertEqual(result.detail, 'HTTP 200', 'the diagnostic survives the wrapper');
});

await testAsync('a probe that THROWS becomes a not-ready result — runBoundedProbe never rejects', async () => {
  const probe: MinioReadinessProbe = async () => {
    throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  };
  const result = await runBoundedProbe(probe, CANDIDATE_CONTAINER.endpoint, 1_000);
  assertEqual(result.ready, false, 'a thrown probe is not ready');
  assertEqual(result.status, 'not-ready', 'a network-level throw is retryable, not fatal');
  assert(result.detail.includes('ECONNREFUSED'), `the undici cause code must be surfaced, got "${result.detail}"`);
});

await testAsync('a late rejection after the deadline cannot escape as an unhandled rejection', async () => {
  // The orchestrator turns any unhandledRejection into exit 92, so a probe
  // that rejects AFTER losing the race must stay swallowed.
  let sawUnhandled = false;
  const onUnhandled = () => {
    sawUnhandled = true;
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    const probe: MinioReadinessProbe = () =>
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('late boom')), 40));
    const result = await runBoundedProbe(probe, CANDIDATE_CONTAINER.endpoint, 10);
    assertEqual(result.status, 'timeout', 'setup: the deadline must win this race');
    await new Promise((r) => setTimeout(r, 120)); // outlive the late rejection
    assert(!sawUnhandled, 'a late probe rejection must never surface as an unhandled rejection');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

await testAsync('the attempt signal is aborted when the deadline wins', async () => {
  let observed: AbortSignal | undefined;
  const probe: MinioReadinessProbe = (_endpoint, options) => {
    observed = options?.signal;
    return new Promise<never>(() => {});
  };
  const result = await runBoundedProbe(probe, CANDIDATE_CONTAINER.endpoint, 30);
  assertEqual(result.status, 'timeout', 'setup: the deadline must win');
  assert(observed !== undefined, 'the probe must receive an AbortSignal');
  assertEqual(observed?.aborted, true, 'the in-flight request must be told to stop');
});

await testAsync('no timer survives a bounded probe, on either exit path', async () => {
  const baseline = activeTimerCount();
  await runBoundedProbe(async () => ({ ready: true, detail: 'HTTP 200' }), CANDIDATE_CONTAINER.endpoint, 5_000);
  assert(activeTimerCount() <= baseline, 'the deadline timer must be cleared when the probe answers first');
  await runBoundedProbe(NEVER_SETTLES, CANDIDATE_CONTAINER.endpoint, 20);
  assert(activeTimerCount() <= baseline, 'the deadline timer must be cleared when the deadline fires');
});

// ─── 2. Selection-loop semantics ────────────────────────────────────────────
section('selectReadyMinioEndpoint — bounded overall, retrying, fail-closed');

await testAsync('a never-settling probe fails with a clear timeout instead of draining', async () => {
  const started = Date.now();
  let thrown: unknown;
  try {
    await selectReadyMinioEndpoint({
      candidates: [CANDIDATE_CONTAINER, CANDIDATE_LOOPBACK],
      probe: NEVER_SETTLES,
      timeoutMs: 300,
      pollIntervalMs: 10,
      attemptTimeoutMs: 40,
    });
  } catch (err) {
    thrown = err;
  }
  const elapsed = Date.now() - started;
  assert(thrown instanceof MinioReadinessTimeoutError, `expected MinioReadinessTimeoutError, got ${String(thrown)}`);
  assert(
    (thrown as Error).message.includes('container-network') && (thrown as Error).message.includes('loopback-fallback'),
    'the failure must name every candidate it tried',
  );
  assert(elapsed < 3_000, `the overall budget must stay bounded (took ${elapsed}ms)`);
});

await testAsync('one hung candidate cannot starve a healthy one', async () => {
  const probe: MinioReadinessProbe = async (endpoint, options) => {
    if (endpoint.startsWith('http://172.18.0.3')) return new Promise<never>(() => {});
    void options;
    return { ready: true, detail: 'HTTP 200' };
  };
  const selected = await selectReadyMinioEndpoint({
    candidates: [CANDIDATE_CONTAINER, CANDIDATE_LOOPBACK],
    probe,
    timeoutMs: 2_000,
    pollIntervalMs: 5,
    attemptTimeoutMs: 30,
  });
  assertEqual(selected.mode, 'loopback-fallback', 'the reachable candidate must still be selected');
});

await testAsync('the retry loop keeps going for transient not-ready answers, then succeeds', async () => {
  let attempts = 0;
  const probe: MinioReadinessProbe = async () => {
    attempts++;
    // Exactly the MinIO startup sequence: refused, then 503, then serving.
    if (attempts === 1) return { ready: false, detail: 'fetch failed (ECONNREFUSED)' };
    if (attempts === 2) return { ready: false, status: 'not-ready', detail: 'HTTP 503' };
    return { ready: true, detail: 'HTTP 200' };
  };
  const selected = await selectReadyMinioEndpoint({
    candidates: [CANDIDATE_CONTAINER],
    probe,
    timeoutMs: 2_000,
    pollIntervalMs: 1,
  });
  assertEqual(selected.mode, 'container-network', 'a transiently-unready destination must still be selected');
  assertEqual(attempts, 3, 'the loop must retry rather than give up on the first not-ready answer');
});

await testAsync('a timed-out attempt is retryable, not terminal', async () => {
  let attempts = 0;
  const probe: MinioReadinessProbe = (_endpoint, _options) => {
    attempts++;
    if (attempts === 1) return new Promise<never>(() => {});
    return Promise.resolve<MinioProbeResult>({ ready: true, detail: 'HTTP 200' });
  };
  const selected = await selectReadyMinioEndpoint({
    candidates: [CANDIDATE_CONTAINER],
    probe,
    timeoutMs: 2_000,
    pollIntervalMs: 1,
    attemptTimeoutMs: 25,
  });
  assertEqual(selected.mode, 'container-network', 'a single hung attempt must cost one retry, not the run');
  assertEqual(attempts, 2, 'the loop must probe again after a timed-out attempt');
});

await testAsync('a ready destination succeeds immediately, off-host-shaped candidate first', async () => {
  let attempts = 0;
  const probe: MinioReadinessProbe = async () => {
    attempts++;
    return { ready: true, detail: 'HTTP 200' };
  };
  const selected = await selectReadyMinioEndpoint({
    candidates: [CANDIDATE_CONTAINER, CANDIDATE_LOOPBACK],
    probe,
    timeoutMs: 5_000,
    pollIntervalMs: 10,
  });
  assertEqual(selected.mode, 'container-network', 'the off-host-shaped topology wins when genuinely reachable');
  assertEqual(attempts, 1, 'a ready destination must cost exactly one probe');
});

await testAsync('a FATAL probe result fails clearly and immediately, without burning the budget', async () => {
  let attempts = 0;
  const probe: MinioReadinessProbe = async () => {
    attempts++;
    return { ready: false, status: 'fatal', detail: 'unsupported endpoint protocol "ftp:"' };
  };
  const started = Date.now();
  let thrown: unknown;
  try {
    await selectReadyMinioEndpoint({
      candidates: [CANDIDATE_CONTAINER],
      probe,
      timeoutMs: 10_000,
      pollIntervalMs: 10,
    });
  } catch (err) {
    thrown = err;
  }
  assert(
    thrown instanceof MinioReadinessConfigurationError,
    `a fatal probe result must be distinguishable from a timeout, got ${String(thrown)}`,
  );
  assert(
    (thrown as Error).message.includes('unsupported endpoint protocol'),
    'the fatal reason must reach the operator verbatim',
  );
  assertEqual(attempts, 1, 'a fatal result must not be retried');
  assert(Date.now() - started < 5_000, 'a fatal result must not wait out the readiness budget');
});

await testAsync('selection leaves no timer behind, on the success or the failure path', async () => {
  const baseline = activeTimerCount();
  await selectReadyMinioEndpoint({
    candidates: [CANDIDATE_CONTAINER],
    probe: async () => ({ ready: true, detail: 'HTTP 200' }),
    timeoutMs: 1_000,
    pollIntervalMs: 5,
  });
  assert(activeTimerCount() <= baseline, `success path leaked a timer (${activeTimerCount()} > ${baseline})`);
  try {
    await selectReadyMinioEndpoint({
      candidates: [CANDIDATE_CONTAINER],
      probe: NEVER_SETTLES,
      timeoutMs: 120,
      pollIntervalMs: 5,
      attemptTimeoutMs: 20,
    });
  } catch {
    /* expected */
  }
  assert(activeTimerCount() <= baseline, `failure path leaked a timer (${activeTimerCount()} > ${baseline})`);
});

test('the default per-attempt ceiling is well below the default overall budget', () => {
  assert(
    DEFAULT_PROBE_ATTEMPT_TIMEOUT_MS < 60_000,
    'a stalled attempt must cost a retry, not the whole default readiness budget',
  );
});

// ─── 3. Real sockets, real probe ────────────────────────────────────────────
section('defaultMinioReadinessProbe — real TCP peers behaving like a starting MinIO container');

type SocketBehaviour = (socket: net.Socket) => void;

async function withServer(behaviour: SocketBehaviour, fn: (endpoint: string) => Promise<void>): Promise<void> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {
      /* peers we deliberately reset will error; never crash the test */
    });
    socket.on('close', () => sockets.delete(socket));
    behaviour(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address !== null && typeof address === 'object', 'the test server must report a port');
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function httpResponse(status: number, body: string): SocketBehaviour {
  return (socket) => {
    socket.write(
      `HTTP/1.1 ${status} X\r\nContent-Type: application/xml\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
    );
    socket.end();
  };
}

await testAsync('a peer that accepts then RESETS is a retryable not-ready, never a hang', async () => {
  // THE reproduction: this is what a just-published Docker port does while the
  // container process is still coming up, and it is the exact state that made
  // Node 20's fetch drop the promise on PR #423.
  await withServer(
    (socket) => {
      if (typeof socket.resetAndDestroy === 'function') socket.resetAndDestroy();
      else socket.destroy();
    },
    async (endpoint) => {
      const started = Date.now();
      const result = await runBoundedProbe(defaultMinioReadinessProbe, endpoint, 1_500);
      const elapsed = Date.now() - started;
      assertEqual(result.ready, false, 'a reset connection is not ready');
      assert(
        result.status === 'not-ready' || result.status === 'timeout',
        `a reset connection must be retryable, got "${result.status}"`,
      );
      assert(elapsed < 4_000, `must settle deterministically (took ${elapsed}ms)`);
    },
  );
});

await testAsync('a peer that accepts then closes cleanly is a retryable not-ready, never a hang', async () => {
  await withServer(
    (socket) => socket.end(),
    async (endpoint) => {
      const started = Date.now();
      const result = await runBoundedProbe(defaultMinioReadinessProbe, endpoint, 1_500);
      const elapsed = Date.now() - started;
      assertEqual(result.ready, false, 'a half-closed connection is not ready');
      assert(
        result.status === 'not-ready' || result.status === 'timeout',
        `a closed connection must be retryable, got "${result.status}"`,
      );
      assert(elapsed < 4_000, `must settle deterministically (took ${elapsed}ms)`);
    },
  );
});

await testAsync('a peer that stalls mid-headers is bounded by the attempt timeout, not undici\'s 300s', async () => {
  await withServer(
    (socket) => socket.write('HTTP/1.1 503 Service Unavailable\r\nContent-Len'),
    async (endpoint) => {
      const started = Date.now();
      const result = await runBoundedProbe(defaultMinioReadinessProbe, endpoint, 200);
      const elapsed = Date.now() - started;
      assertEqual(result.ready, false, 'a stalled peer is not ready');
      assert(elapsed < 4_000, `the attempt timeout must win, not undici's headers timeout (took ${elapsed}ms)`);
    },
  );
});

await testAsync('nothing listening is a retryable not-ready with a useful diagnostic', async () => {
  const result = await runBoundedProbe(defaultMinioReadinessProbe, 'http://127.0.0.1:1', 2_000);
  assertEqual(result.ready, false, 'a refused connection is not ready');
  assertEqual(result.status, 'not-ready', 'connection refused is retryable — MinIO may simply not be up yet');
});

await testAsync('a real HTTP 503 is a retryable not-ready that reports its status', async () => {
  await withServer(httpResponse(503, '<Error><Code>ServerNotInitialized</Code></Error>'), async (endpoint) => {
    const result = await runBoundedProbe(defaultMinioReadinessProbe, endpoint, 3_000);
    assertEqual(result.ready, false, '503 is not ready');
    assertEqual(result.status, 'not-ready', '503 during startup is retryable');
    assertEqual(result.detail, 'HTTP 503', 'the status must be reported verbatim');
  });
});

await testAsync('a real HTTP 200 on /minio/health/ready is READY', async () => {
  let requestedPath = '';
  await withServer(
    (socket) => {
      socket.once('data', (chunk) => {
        requestedPath = String(chunk).split('\r\n')[0] ?? '';
        socket.write('HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        socket.end();
      });
    },
    async (endpoint) => {
      const result = await runBoundedProbe(defaultMinioReadinessProbe, endpoint, 3_000);
      assertEqual(result.ready, true, 'a serving MinIO must be reported ready');
      assertEqual(result.status, 'ready', 'a serving MinIO must be classified ready');
      assert(requestedPath.includes('/minio/health/ready'), `the health path must be used, saw "${requestedPath}"`);
    },
  );
});

await testAsync('end-to-end: a destination that becomes ready mid-poll is selected', async () => {
  let hits = 0;
  await withServer(
    (socket) => {
      hits++;
      if (hits < 3) {
        // Not up yet: accept and drop, exactly as during container startup.
        socket.destroy();
        return;
      }
      socket.once('data', () => {
        socket.write('HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        socket.end();
      });
    },
    async (endpoint) => {
      const selected = await selectReadyMinioEndpoint({
        candidates: [{ endpoint, mode: 'loopback-fallback' }],
        timeoutMs: 10_000,
        pollIntervalMs: 10,
        attemptTimeoutMs: 1_000,
      });
      assertEqual(selected.endpoint, endpoint, 'the destination must be selected once it starts serving');
      assert(hits >= 3, `the loop must have retried through the startup window (hits=${hits})`);
    },
  );
});

await testAsync('waitForMinioReady still fails closed against a dead host port', async () => {
  let threw = false;
  try {
    await waitForMinioReady(1, 120, 10);
  } catch {
    threw = true;
  }
  assert(threw, 'the back-compatible single-endpoint wait must still throw when nothing answers');
});

section('defaultMinioReadinessProbe — fatal configuration errors are separated from not-ready');

await testAsync('an unparseable endpoint is FATAL, not a retryable not-ready', async () => {
  const result = await defaultMinioReadinessProbe('not-a-url');
  assertEqual(result.status, 'fatal', 'a malformed endpoint can never become ready by retrying');
  assertEqual(result.ready, false, 'a malformed endpoint is not ready');
});

await testAsync('a protocol this probe cannot speak is FATAL', async () => {
  const result = await defaultMinioReadinessProbe('ftp://127.0.0.1:9000');
  assertEqual(result.status, 'fatal', 'an unsupported protocol can never become ready by retrying');
  assert(result.detail.includes('ftp:'), `the offending protocol must be named, got "${result.detail}"`);
});

// ─── 4. Mutation / negative proof (child processes) ─────────────────────────
section('Mutation proof — the pre-R1 unbounded shape still drains; the shipped shape does not');

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const harness = join(here, 'fixtures', 'readinessDrainHarness.ts');

function runHarness(mode: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [tsxCli, harness, mode], {
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('the mutation harness and its runner are present', () => {
  assert(existsSync(tsxCli), `tsx CLI not found at ${tsxCli}`);
  assert(existsSync(harness), `mutation harness not found at ${harness}`);
});

test('MUTATION: the pre-R1 unbounded await drains the event loop and is forced to exit 91', () => {
  const { status, stdout, stderr } = runHarness('legacy-unbounded');
  assert(
    stderr.includes('HARNESS_DRAINED_AT:storage:minio-readiness'),
    `the unbounded shape must still drain at the readiness stage — stderr was:\n${stderr}`,
  );
  assert(
    stderr.includes('HARNESS_FORCED_EXIT_AT:storage:minio-readiness'),
    'the fail-closed trap must convert the drain into a forced failure',
  );
  assert(
    !stdout.includes('HARNESS_LEGACY_REACHED_UNREACHABLE_LINE'),
    'control must never return from the unbounded await — that is the defect',
  );
  assertEqual(status, EXIT_ABNORMAL_TERMINATION, 'a drained run must exit 91, never 0');
});

test('the shipped bounded shape terminates normally with a deterministic readiness failure', () => {
  const { status, stdout, stderr } = runHarness('bounded');
  assert(
    stdout.includes('HARNESS_BOUNDED_FAILED_DETERMINISTICALLY MinioReadinessTimeoutError'),
    `the bounded shape must fail clearly rather than hang — stdout was:\n${stdout}`,
  );
  assert(!stdout.includes('HARNESS_BOUNDED_UNEXPECTED_SUCCESS'), 'a never-ready destination must never be selected');
  assert(!stderr.includes('HARNESS_DRAINED_AT'), `the bounded shape must not drain — stderr was:\n${stderr}`);
  assertEqual(status, 0, 'the harness completes its run, so no abnormal-termination code is forced');
});

section('Fail-closed exit behaviour is unchanged');

test('the abnormal-termination code is still the distinct, greppable 91', () => {
  assertEqual(EXIT_ABNORMAL_TERMINATION, 91, 'the Layer 4 gate and its documentation key off this exact code');
});

test('a readiness failure is still a non-zero setup failure carrying its reason', () => {
  const outcome = combineOutcome(
    { ranTests: false, testExitCode: null, setupFailureReason: 'MinIO readiness timeout after 60000ms' },
    { success: true, errors: [] },
    { required: true, satisfied: false, executedCount: 0, failures: ['no receipt'] },
  );
  assert(outcome.exitCode !== 0, 'a run that never reached the tests can never report success');
  assert(
    outcome.reasons.some((r) => r.includes('MinIO readiness timeout')),
    'the readiness reason must reach the summary an operator reads',
  );
});

console.log(`\n${'-'.repeat(60)}`);
console.log(`minioReadiness: ${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
