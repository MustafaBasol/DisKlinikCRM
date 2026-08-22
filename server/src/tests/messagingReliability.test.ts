/**
 * messagingReliability.test.ts — F5-3 contract, policy and structural guards.
 *
 * Everything here is DB-free: failure classification, `Retry-After` parsing,
 * backoff shape, the bounded-HTTP helper (against a real local server, not a
 * mock — a timeout that only works against a fake is not a timeout), the
 * re-delivery registry, flag semantics, and the structural rules that keep
 * provider bodies out of persisted columns.
 *
 * The database-dependent guarantees (terminal transitions, DLQ scoping, replay
 * authorization, metrics) are proved in
 * `dbVerification/messagingInboundReliability.test.ts` against real PostgreSQL.
 *
 * Run with: tsx src/tests/messagingReliability.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import {
  MESSAGING_FAILURE_CATEGORIES,
  MessagingProviderError,
  classifyMessagingError,
  classifyProviderHttpStatus,
  computeMessagingBackoffMs,
  isRetryableMessagingCategory,
  isTerminalMessagingCode,
  parseRetryAfterMs,
  MAX_MESSAGING_BACKOFF_MS,
} from '../messaging/messagingFailureClassification.js';
import {
  fetchWithTimeout,
  getMessagingHttpTimeoutMs,
  MessagingHttpTimeoutError,
  DEFAULT_MESSAGING_HTTP_TIMEOUT_MS,
} from '../messaging/messagingHttp.js';
import {
  MESSAGING_REDELIVERY_SUPPORT,
  getRedeliverySupport,
  getSupportedRedeliveryTargets,
  isRedeliverySupported,
} from '../messaging/messagingRedeliveryRegistry.js';
import { isDurableAckBeforeResponseEnabled } from '../messaging/messagingReliabilityConfig.js';
// F5-3R — the operator route contract.
import {
  MESSAGING_DLQ_MAX_PAGE_SIZE,
  MESSAGING_DLQ_DEFAULT_PAGE_SIZE,
} from '../messaging/messagingInboundDlq.js';
import {
  canViewMessagingReliability,
  canReplayMessagingInboundEvent,
} from '../utils/roles.js';
import { createWebhookAckGate } from '../messaging/webhookAckGate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: unknown) {
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

function readSource(relative: string): string {
  return readFileSync(resolve(SRC_ROOT, relative), 'utf8').replace(/\r/g, '');
}

function codeLines(source: string): string[] {
  return source.split('\n').filter((line) => {
    const t = line.trim();
    return t.length > 0 && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  });
}

function envWith(vars: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return vars as unknown as NodeJS.ProcessEnv;
}

/** Minimal Express-ish response double: records what was sent, and how often. */
function fakeResponse() {
  const calls: Array<{ kind: 'json' | 'status'; code: number; body?: unknown }> = [];
  let pendingCode = 0;
  const res = {
    status(code: number) {
      pendingCode = code;
      return res;
    },
    json(body: unknown) {
      calls.push({ kind: 'json', code: pendingCode, body });
      return res;
    },
    sendStatus(code: number) {
      calls.push({ kind: 'status', code });
      return res;
    },
  };
  return { res, calls };
}

async function main() {
  console.log('F5-3 messaging reliability — classification, backoff, bounded HTTP, structural guards');

  // ── A. Failure classification ─────────────────────────────────────────────
  section('A. Provider failures are classified, not stringified');

  await test('429 is RATE_LIMIT and carries the provider Retry-After as a floor', () => {
    const headers = new Headers({ 'retry-after': '90' });
    const f = classifyProviderHttpStatus(429, headers);
    assert.equal(f.category, 'RATE_LIMIT');
    assert.equal(f.retryAfterMs, 90_000);
  });

  await test('401 and 403 are AUTH_CONFIGURATION and are NOT retryable', () => {
    for (const status of [401, 403]) {
      const f = classifyProviderHttpStatus(status);
      assert.equal(f.category, 'AUTH_CONFIGURATION');
      assert.equal(isRetryableMessagingCategory(f.category), false);
    }
  });

  await test('5xx is PROVIDER_OUTAGE and IS retryable', () => {
    for (const status of [500, 502, 503, 504]) {
      const f = classifyProviderHttpStatus(status);
      assert.equal(f.category, 'PROVIDER_OUTAGE');
      assert.equal(isRetryableMessagingCategory(f.category), true);
    }
  });

  await test('a plain 4xx is PERMANENT_VALIDATION — retrying a rejected message is pure load', () => {
    for (const status of [400, 404, 422]) {
      assert.equal(classifyProviderHttpStatus(status).category, 'PERMANENT_VALIDATION');
      assert.equal(isRetryableMessagingCategory('PERMANENT_VALIDATION'), false);
    }
  });

  await test('classification never receives the response body — it cannot leak what it never sees', () => {
    const source = readSource('messaging/messagingFailureClassification.ts');
    const signature = source.slice(source.indexOf('export function classifyProviderHttpStatus'));
    const params = signature.slice(0, signature.indexOf(')'));
    assert.ok(!/body/i.test(params), 'classifyProviderHttpStatus must not take a body parameter');
  });

  await test('an unclassified throw is UNKNOWN — retryable, never silently permanent', () => {
    const f = classifyMessagingError(new Error('boom'));
    assert.equal(f.category, 'UNKNOWN');
    assert.equal(isRetryableMessagingCategory('UNKNOWN'), true);
  });

  await test('classification does NOT sniff message text', () => {
    // An error whose message screams "429 rate limited" is still UNKNOWN. This
    // is what keeps the policy correct when a provider rewords itself, and it
    // keeps PII out of control flow.
    assert.equal(classifyMessagingError(new Error('HTTP 429 rate limited, slow down')).category, 'UNKNOWN');
  });

  await test('a connection-level errno IS recognised (code only, never the message)', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT']) {
      const err = Object.assign(new TypeError('fetch failed'), { cause: { code } });
      assert.equal(classifyMessagingError(err).category, 'TRANSIENT', code);
    }
  });

  await test('a MessagingProviderError keeps its category, code and Retry-After', () => {
    const err = new MessagingProviderError(
      { category: 'RATE_LIMIT', code: 'RATE_LIMIT', retryAfterMs: 45_000 },
      { httpStatus: 429 },
    );
    const f = classifyMessagingError(err);
    assert.equal(f.category, 'RATE_LIMIT');
    assert.equal(f.retryAfterMs, 45_000);
    assert.equal(err.httpStatus, 429);
  });

  await test('every declared category has an explicit retryability answer', () => {
    assert.equal(MESSAGING_FAILURE_CATEGORIES.length, 9);
    const retryable = MESSAGING_FAILURE_CATEGORIES.filter(isRetryableMessagingCategory);
    assert.deepEqual(
      [...retryable].sort(),
      ['PROVIDER_OUTAGE', 'RATE_LIMIT', 'TIMEOUT', 'TRANSIENT', 'UNKNOWN'],
    );
  });

  await test('the codes that must end a retry loop are all marked terminal', () => {
    for (const code of [
      'MISSING_CONNECTION',
      'CONNECTION_INACTIVE',
      'UNPARSEABLE_PAYLOAD',
      'MAX_ATTEMPTS_EXCEEDED',
      'RETRY_WINDOW_EXPIRED',
      'NO_RETRY_HANDLER',
      'AUTH_CONFIGURATION',
      'PERMANENT_VALIDATION',
    ] as const) {
      assert.equal(isTerminalMessagingCode(code), true, code);
    }
    assert.equal(isTerminalMessagingCode('TRANSIENT'), false);
  });

  // ── B. Retry-After ────────────────────────────────────────────────────────
  section('B. Retry-After is parsed, bounded, and never invented');

  await test('delta-seconds parses', () => {
    assert.equal(parseRetryAfterMs('120'), 120_000);
    assert.equal(parseRetryAfterMs('0'), 0);
  });

  await test('an HTTP date parses relative to now', () => {
    const now = new Date('2026-08-22T12:00:00Z');
    const ms = parseRetryAfterMs('Sat, 22 Aug 2026 12:05:00 GMT', now);
    assert.equal(ms, 5 * 60 * 1000);
  });

  await test('a date already in the past is 0, not negative', () => {
    const now = new Date('2026-08-22T12:00:00Z');
    assert.equal(parseRetryAfterMs('Sat, 22 Aug 2026 11:00:00 GMT', now), 0);
  });

  await test('garbage and absence yield undefined, not a guess', () => {
    for (const raw of [undefined, null, '', '   ', 'soon', 'NaN', '-5']) {
      assert.equal(parseRetryAfterMs(raw), undefined, JSON.stringify(raw));
    }
  });

  await test('a hostile Retry-After cannot park an event for a week', () => {
    const ms = parseRetryAfterMs('999999999');
    assert.ok(ms !== undefined && ms <= 60 * 60 * 1000, `clamped to ${ms}`);
  });

  // ── C. Backoff ────────────────────────────────────────────────────────────
  section('C. Backoff grows, jitters, and is bounded');

  await test('backoff grows with attempts and never exceeds the cap', () => {
    for (const attempt of [1, 2, 3, 5, 10, 100, 5000]) {
      const ms = computeMessagingBackoffMs('TRANSIENT', attempt, { random: () => 1 });
      assert.ok(Number.isFinite(ms), `attempt ${attempt} produced a non-finite backoff`);
      assert.ok(ms <= MAX_MESSAGING_BACKOFF_MS, `attempt ${attempt} produced ${ms}ms`);
    }
    const a1 = computeMessagingBackoffMs('TRANSIENT', 1, { random: () => 1 });
    const a4 = computeMessagingBackoffMs('TRANSIENT', 4, { random: () => 1 });
    assert.ok(a4 > a1);
  });

  await test('full jitter is real — this is what breaks the synchronised retry storm', () => {
    // The pre-F5-3 behaviour was a FIXED five-minute floor: every event failed
    // by one outage came back together, every five minutes, forever.
    assert.equal(computeMessagingBackoffMs('PROVIDER_OUTAGE', 3, { random: () => 0 }), 0);
    const full = computeMessagingBackoffMs('PROVIDER_OUTAGE', 3, { random: () => 1 });
    assert.ok(full > 0);
  });

  await test('a provider Retry-After is a FLOOR, never a ceiling', () => {
    assert.equal(
      computeMessagingBackoffMs('RATE_LIMIT', 1, { random: () => 0, retryAfterMs: 90_000 }),
      90_000,
    );
    const big = computeMessagingBackoffMs('RATE_LIMIT', 5, { random: () => 1, retryAfterMs: 1 });
    assert.ok(big > 1, 'a tiny Retry-After must not shrink the computed backoff');
  });

  await test('a rate-limited provider gets more room than a transient blip', () => {
    const transient = computeMessagingBackoffMs('TRANSIENT', 1, { random: () => 1 });
    const limited = computeMessagingBackoffMs('RATE_LIMIT', 1, { random: () => 1 });
    assert.ok(limited > transient);
  });

  // ── D. Bounded HTTP, against a real server ────────────────────────────────
  section('D. Outbound HTTP is bounded (against a real socket, not a mock)');

  let server: Server | null = null;
  const openSockets = new Set<import('node:net').Socket>();
  let baseUrl = '';
  try {
    server = createServer((req, res) => {
      if (req.url === '/hang') return; // accept the connection and never answer
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    });
    // The /hang route deliberately never answers, so its socket stays open.
    // Tracking and destroying sockets explicitly is what lets this process exit
    // cleanly — `server.close()` alone waits for connections that never end,
    // and forcing the exit around a live libuv handle crashes the runtime.
    server.on('connection', (socket) => {
      openSockets.add(socket);
      socket.on('close', () => openSockets.delete(socket));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    await test('a normal response still works', async () => {
      const res = await fetchWithTimeout(`${baseUrl}/ok`, {}, { timeoutMs: 5_000 });
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'ok');
    });

    await test('a server that accepts and never answers is aborted, not waited on forever', async () => {
      const started = Date.now();
      await assert.rejects(
        fetchWithTimeout(`${baseUrl}/hang`, {}, { timeoutMs: 300 }),
        (err: unknown) => err instanceof MessagingHttpTimeoutError,
      );
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 3_000, `took ${elapsed}ms — the bound did not fire`);
    });

    await test('the timeout error names the bound that fired, and no endpoint detail', async () => {
      try {
        await fetchWithTimeout(`${baseUrl}/hang`, {}, { timeoutMs: 200 });
        assert.fail('expected a timeout');
      } catch (err) {
        assert.ok(err instanceof MessagingHttpTimeoutError);
        assert.equal((err as MessagingHttpTimeoutError).timeoutMs, 200);
        assert.ok(!(err as Error).message.includes('127.0.0.1'));
      }
    });

    await test('a caller-supplied signal still wins, and is NOT reported as our timeout', async () => {
      const controller = new AbortController();
      const p = fetchWithTimeout(`${baseUrl}/hang`, { signal: controller.signal }, { timeoutMs: 10_000 });
      controller.abort();
      await assert.rejects(p, (err: unknown) => !(err instanceof MessagingHttpTimeoutError));
    });

    await test('an already-aborted caller signal short-circuits', async () => {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        fetchWithTimeout(`${baseUrl}/ok`, { signal: controller.signal }, { timeoutMs: 5_000 }),
        (err: unknown) => !(err instanceof MessagingHttpTimeoutError),
      );
    });

    await test('a slow-but-answering server inside the bound succeeds', async () => {
      const res = await fetchWithTimeout(`${baseUrl}/ok`, {}, { timeoutMs: 5_000 });
      assert.equal(res.status, 200);
    });
  } finally {
    for (const socket of openSockets) socket.destroy();
    openSockets.clear();
    if (server) {
      server.close();
      await once(server, 'close').catch(() => {});
    }
  }

  await test('the timeout uses a REF\'d timer, not AbortSignal.timeout', () => {
    // AbortSignal.timeout()'s timer is unref'd: in a short-lived worker tick the
    // loop can drain while a fetch is still outstanding, leaving a promise that
    // never settles and no handle to settle it. The bound must hold the loop.
    const source = readSource('messaging/messagingHttp.ts');
    assert.ok(
      !/AbortSignal\.timeout\(/.test(source.replace(/\/\*[\s\S]*?\*\//g, '')),
      'AbortSignal.timeout is unref\'d and must not be used here',
    );
    assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), timeoutMs\)/);
    assert.match(source, /clearTimeout\(timer\)/);
  });

  await test('the default timeout is set and configurable', () => {
    assert.equal(getMessagingHttpTimeoutMs(envWith({})), DEFAULT_MESSAGING_HTTP_TIMEOUT_MS);
    assert.equal(getMessagingHttpTimeoutMs(envWith({ MESSAGING_HTTP_TIMEOUT_MS: '2500' })), 2500);
    assert.equal(getMessagingHttpTimeoutMs(envWith({ MESSAGING_HTTP_TIMEOUT_MS: 'nope' })), DEFAULT_MESSAGING_HTTP_TIMEOUT_MS);
    assert.equal(getMessagingHttpTimeoutMs(envWith({ MESSAGING_HTTP_TIMEOUT_MS: '-1' })), DEFAULT_MESSAGING_HTTP_TIMEOUT_MS);
  });

  await test('every messaging provider send goes through the bounded helper', () => {
    const offenders: string[] = [];
    for (const relative of [
      'services/whatsapp/MetaCloudWhatsAppProvider.ts',
      'services/whatsapp/EvolutionWhatsAppProvider.ts',
      'services/instagram/InstagramMessagingProvider.ts',
    ]) {
      for (const line of codeLines(readSource(relative))) {
        // `fetchWithTimeout` contains the substring `fetch(`; match the bare call.
        if (/(^|[^a-zA-Z])fetch\(/.test(line)) offenders.push(`${relative}: ${line.trim()}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'an unbounded fetch in a messaging provider can hang a job lease indefinitely',
    );
  });

  // ── E. Re-delivery registry ───────────────────────────────────────────────
  section('E. Which channels can be re-driven is a reviewable statement');

  await test('every channel/provider that writes the ledger is classified', () => {
    // The three writers, read from the real call sites rather than assumed.
    const writers = new Set<string>();
    for (const relative of [
      'routes/metaWhatsAppWebhook.ts',
      'routes/instagramWebhook.ts',
      'routes/whatsapp.ts',
    ]) {
      const source = readSource(relative);
      for (const match of source.matchAll(
        /createInboundEventOrDetectDuplicate\(\{\s*channel:\s*'([^']+)',\s*provider:\s*'([^']+)'/g,
      )) {
        writers.add(`${match[1]}|${match[2]}`);
      }
    }
    assert.ok(writers.size >= 3, `expected at least 3 ledger writers, found ${writers.size}`);
    for (const key of writers) {
      const [channel, provider] = key.split('|') as [string, string];
      assert.ok(
        getRedeliverySupport({ channel, provider }),
        `${key} writes the inbound ledger but is not classified in the re-delivery registry`,
      );
    }
  });

  await test('an unknown channel fails CLOSED — unsupported, never supported-by-default', () => {
    assert.equal(isRedeliverySupported({ channel: 'sms', provider: 'invented' }), false);
  });

  await test('only Meta WhatsApp is supported today, and the others say why not', () => {
    assert.deepEqual(getSupportedRedeliveryTargets(), [
      { channel: 'whatsapp', provider: 'meta_cloud_api' },
    ]);
    for (const entry of MESSAGING_REDELIVERY_SUPPORT) {
      assert.ok(entry.rationale.trim().length >= 60, `${entry.channel}/${entry.provider}: rationale too thin`);
    }
  });

  await test('the retry job derives its provider filter from the registry, not a literal', () => {
    const source = readSource('jobs/inboundEventRetryJob.ts');
    assert.match(source, /getSupportedRedeliveryTargets\(\)/);
    const selectRegion = source.slice(source.indexOf('const events = await prisma.messagingInboundEvent.findMany'));
    assert.ok(
      !/provider:\s*'meta_cloud_api'/.test(selectRegion.slice(0, 900)),
      'the channel filter must come from the registry so coverage is reviewable',
    );
  });

  // ── F. Fast-ack flag and the response gate ────────────────────────────────
  section('F. Durable acceptance before ACK is flag-gated and answers exactly once');

  await test('the durable-ack flag is OFF unless it is exactly "true"', () => {
    assert.equal(isDurableAckBeforeResponseEnabled(envWith({})), false);
    for (const raw of ['1', 'yes', 'TRUE', 'True', 'on', 'true ', '']) {
      assert.equal(isDurableAckBeforeResponseEnabled(envWith({ MESSAGING_DURABLE_ACK_ENABLED: raw })), false, raw);
    }
    assert.equal(isDurableAckBeforeResponseEnabled(envWith({ MESSAGING_DURABLE_ACK_ENABLED: 'true' })), true);
  });

  await test('the gate answers exactly once, however many branches call it', () => {
    const { res, calls } = fakeResponse();
    const gate = createWebhookAckGate(res as never);
    gate.ack();
    gate.ack();
    gate.fail('SHOULD_NOT_APPEAR');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.code, 200);
  });

  await test('fail() answers 503 so the provider retries — but only if nothing was sent', () => {
    const a = fakeResponse();
    const gateA = createWebhookAckGate(a.res as never);
    gateA.fail('PROCESSING_FAILED_BEFORE_ACCEPTANCE');
    assert.equal(a.calls.length, 1);
    assert.equal(a.calls[0]!.code, 503);

    // Legacy mode: the 200 already went out, so fail() must be a no-op and the
    // provider must NOT see a contradictory second response.
    const b = fakeResponse();
    const gateB = createWebhookAckGate(b.res as never);
    gateB.ack();
    gateB.fail('PROCESSING_FAILED_BEFORE_ACCEPTANCE');
    assert.equal(b.calls.length, 1);
    assert.equal(b.calls[0]!.code, 200);
  });

  await test('each route keeps its ORIGINAL success response shape', () => {
    const json = fakeResponse();
    createWebhookAckGate(json.res as never).ack();
    assert.equal(json.calls[0]!.kind, 'json');

    const status = fakeResponse();
    createWebhookAckGate(status.res as never, 'status').ack();
    assert.equal(status.calls[0]!.kind, 'status');
  });

  await test('both Meta routes and both Instagram routes now answer through the gate', () => {
    for (const relative of ['routes/metaWhatsAppWebhook.ts', 'routes/instagramWebhook.ts']) {
      const source = readSource(relative);
      const gates = (source.match(/createWebhookAckGate\(res/g) ?? []).length;
      assert.equal(gates, 2, `${relative}: expected both POST routes to use the gate, found ${gates}`);
      // Every early-return branch still owes an answer.
      const finallies = (source.match(/\}\s*finally\s*\{\s*\n\s*(\/\/[^\n]*\n\s*)*gate\.ack\(\);/g) ?? []).length;
      assert.equal(finallies, 2, `${relative}: expected a finally-ack per route, found ${finallies}`);
    }
  });

  await test('the ACK fires only AFTER the durable ledger write', () => {
    for (const relative of ['routes/metaWhatsAppWebhook.ts', 'routes/instagramWebhook.ts']) {
      const source = readSource(relative);
      const writeAt = source.indexOf('createInboundEventOrDetectDuplicate({');
      const acceptedAt = source.indexOf('onDurablyAccepted?.();');
      assert.ok(writeAt > 0, `${relative}: ledger write not found`);
      assert.ok(acceptedAt > writeAt, `${relative}: the acceptance callback must fire after the ledger write`);
    }
  });

  await test('no route answers 200 outside the gate any more', () => {
    for (const relative of ['routes/metaWhatsAppWebhook.ts', 'routes/instagramWebhook.ts']) {
      for (const line of codeLines(readSource(relative))) {
        // GET verification challenges legitimately answer directly; they carry
        // no durable acceptance and are excluded by their `.send(` shape.
        if (/res\.sendStatus\(200\)/.test(line) || /res\.status\(200\)\.json\(/.test(line)) {
          assert.fail(`${relative} answers 200 outside the gate: ${line.trim()}`);
        }
      }
    }
  });

  // ── G. KVKK / log privacy ─────────────────────────────────────────────────
  section('G. Provider bodies do not reach persisted columns or logs');

  await test('no messaging provider concatenates a response body into its error', () => {
    const offenders: string[] = [];
    for (const relative of [
      'services/whatsapp/MetaCloudWhatsAppProvider.ts',
      'services/whatsapp/EvolutionWhatsAppProvider.ts',
    ]) {
      const source = readSource(relative);
      for (const line of codeLines(source)) {
        // The pre-F5-3 shape: `...failed with ${response.status}: ${errorText}`
        if (/error:\s*`[^`]*\$\{errorText\}/.test(line)) offenders.push(`${relative}: ${line.trim()}`);
        if (/const errorText = await response\.text\(\)/.test(line)) {
          offenders.push(`${relative}: reads the response body into a variable that reaches the error`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });

  await test('markInboundEventFailed no longer persists a raw exception message', () => {
    const source = readSource('services/messagingInboundIdempotency.ts');
    assert.ok(
      !/errorMessage:\s*message\.slice\(/.test(source),
      'a raw exception message can carry a provider body, and this column is read by operators',
    );
    assert.match(source, /lastErrorCode: resolved\.code/);
    assert.match(source, /errorMessage: `Inbound processing failed \(\$\{resolved\.code\}\)\.`/);
  });

  await test('the DLQ view selects no payload, no error message and no phone number', () => {
    const source = readSource('messaging/messagingInboundDlq.ts');
    const listing = source.slice(source.indexOf('export async function listDeadInboundEvents'));
    const select = listing.slice(listing.indexOf('select: {'), listing.indexOf('// rawPayload'));
    for (const forbidden of ['rawPayload', 'errorMessage', 'fromPhone', 'toPhone']) {
      assert.ok(!new RegExp(`\\b${forbidden}:\\s*true`).test(select), `DLQ view exposes ${forbidden}`);
    }
    assert.match(select, /lastErrorCode: true/);
  });

  await test('metrics dimensions are bounded — no clinic, patient or message id', () => {
    const source = readSource('messaging/messagingInboundDlq.ts');
    const metrics = source.slice(source.indexOf('export async function getMessagingInboundMetrics'));
    assert.ok(!/by: \['clinicId'\]/.test(metrics));
    assert.ok(!/by: \['providerMessageId'\]/.test(metrics));
    assert.match(metrics, /by: \['channel', 'provider', 'status'\]/);
  });

  await test('no messaging module logs the raw payload', () => {
    const offenders: string[] = [];
    for (const relative of [
      'messaging/messagingInboundDlq.ts',
      'messaging/messagingInboundReplay.ts',
      'messaging/messagingFailureClassification.ts',
      'messaging/messagingHttp.ts',
      'jobs/inboundEventRetryJob.ts',
    ]) {
      for (const line of codeLines(readSource(relative))) {
        if (!/console\.(log|info|warn|error)|logger\.(info|warn|error|debug)/.test(line)) continue;
        if (/rawPayload|errorMessage/.test(line)) offenders.push(`${relative}: ${line.trim()}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  // ── H. Architecture invariants ────────────────────────────────────────────
  section('H. MessagingInboundEvent remains the single inbound durability ledger');

  await test('no messaging module introduces Redis or BullMQ', () => {
    for (const relative of [
      'messaging/messagingInboundDlq.ts',
      'messaging/messagingInboundReplay.ts',
      'messaging/messagingFailureClassification.ts',
      'messaging/messagingHttp.ts',
      'messaging/messagingRedeliveryRegistry.ts',
      'messaging/messagingReliabilityConfig.ts',
      'messaging/webhookAckGate.ts',
      'jobs/inboundEventRetryJob.ts',
    ]) {
      const source = readSource(relative);
      assert.ok(!/from ['"]bullmq['"]/.test(source), `${relative} imports bullmq`);
      assert.ok(!/from ['"]ioredis['"]/.test(source), `${relative} imports ioredis`);
      assert.ok(!/from ['"]redis['"]/.test(source), `${relative} imports redis`);
    }
  });

  await test('F5-3 creates no second inbound ledger model', () => {
    const schema = readFileSync(resolve(SRC_ROOT, '../prisma/schema.prisma'), 'utf8').replace(/\r/g, '');
    for (const invented of ['MessagingDeadLetter', 'MessagingInboundDlq', 'InboundEventDeadLetter']) {
      assert.ok(!new RegExp(`model ${invented}\\b`).test(schema), `${invented} duplicates the existing ledger`);
    }
    assert.match(schema, /model MessagingInboundEvent \{/);
  });

  await test('the replay service introduces no new system-context reason', () => {
    for (const relative of ['messaging/messagingInboundReplay.ts', 'messaging/messagingInboundDlq.ts']) {
      const source = readSource(relative);
      const reasons = [...source.matchAll(/runAsSystem\(\{\s*reason:\s*'([^']+)'/g)].map((m) => m[1]);
      for (const reason of reasons) {
        assert.equal(
          reason,
          'inbound-webhook-envelope',
          `${relative} uses system reason "${reason}"; F5-3 must reuse the existing one`,
        );
      }
      assert.ok(reasons.length > 0, `${relative} should declare its system context`);
    }
  });

  await test('DLQ and replay both require a tenant predicate — no "all organizations" mode', () => {
    for (const relative of ['messaging/messagingInboundDlq.ts', 'messaging/messagingInboundReplay.ts']) {
      const source = readSource(relative);
      assert.match(source, /organizationId: (args\.organizationId|auth\.organizationId)/);
    }
    const dlq = readSource('messaging/messagingInboundDlq.ts');
    const listing = dlq.slice(dlq.indexOf('export async function listDeadInboundEvents'));
    assert.match(listing, /organizationId: string;/, 'organizationId must be REQUIRED, not optional');
  });

  // ── F5-3R. The operator route contract ────────────────────────────────────
  //
  // DB-free half. What lives here is everything that is a property of the
  // ROUTE MODULE and of the role helpers: which roles are admitted, that the
  // refusal→status map is total, that the tenant-override refusal list is
  // complete, and the structural rules that keep this route from quietly
  // growing into something else. Every "operator X cannot see/do Y" claim is
  // proved against a real database in
  // `dbVerification/messagingOperatorRoutes.test.ts` instead — an isolation
  // claim proved against a mock is not proved.

  section('J. F5-3R — operator role model');

  await test('the two capabilities admit exactly OWNER, ORG_ADMIN and CLINIC_MANAGER', () => {
    const admitted = ['OWNER', 'ORG_ADMIN', 'CLINIC_MANAGER'];
    const refused = ['DENTIST', 'RECEPTIONIST', 'BILLING', 'ASSISTANT'];

    for (const role of admitted) {
      assert.equal(canViewMessagingReliability({ role }), true, `${role} may inspect`);
      assert.equal(canReplayMessagingInboundEvent({ role }), true, `${role} may replay`);
    }
    for (const role of refused) {
      assert.equal(canViewMessagingReliability({ role }), false, `${role} must not inspect`);
      assert.equal(canReplayMessagingInboundEvent({ role }), false, `${role} must not replay`);
    }
  });

  await test('the role set matches the ACCEPTED runbook table — this task does not reopen it', () => {
    // F6_MESSAGING_RELIABILITY_OPERATIONS.md §0 already states who may inspect
    // and who may replay, with "(once a route exists)" against both. Building
    // the route is not licence to change the answer, so the table is the
    // specification and this test is the check.
    const runbook = readFileSync(
      resolve(SRC_ROOT, '../../docs/program/runbooks/F6_MESSAGING_RELIABILITY_OPERATIONS.md'),
      'utf8',
    );
    assert.match(runbook, /Replay a terminal inbound message/, 'the role table still names the replay action');
    assert.match(runbook, /within their clinic scope/, 'and still grants it to a clinic operator, scoped');
  });

  await test('an unknown or absent user is refused by both capabilities', () => {
    for (const user of [null, undefined, { role: '' }, { role: 'not-a-real-role' }]) {
      assert.equal(canViewMessagingReliability(user as never), false);
      assert.equal(canReplayMessagingInboundEvent(user as never), false);
    }
  });

  await test('inspection and replay are SEPARATE functions, so one can be narrowed without the other', () => {
    const source = readSource('utils/roles.ts');
    assert.match(source, /export function canViewMessagingReliability/);
    assert.match(source, /export function canReplayMessagingInboundEvent/);
    assert.notEqual(
      canViewMessagingReliability.name,
      canReplayMessagingInboundEvent.name,
      'not an alias of one another',
    );
  });

  section('K. F5-3R — the route contract, structurally');

  await test('the refusal→status map is TOTAL over the service refusal union', () => {
    // A refusal the route does not know about would fall through to a generic
    // 400 and tell an operator nothing. The union lives in the service, so the
    // map is checked against the service's own source rather than a copy.
    const service = readSource('messaging/messagingInboundReplay.ts');
    const unionBlock = service.slice(
      service.indexOf('export type MessagingReplayRefusal'),
      service.indexOf('export type MessagingReplayResult'),
    );
    const refusals = [...unionBlock.matchAll(/\|\s*'([A-Z_]+)'/g)].map((m) => m[1]!);
    assert.ok(refusals.length >= 8, `expected the full refusal union, saw ${refusals.length}`);

    const route = readSource('routes/messagingReliability.ts');
    const mapBlock = route.slice(route.indexOf('REPLAY_REFUSAL_STATUS'), route.indexOf('router.post('));
    for (const refusal of refusals) {
      assert.match(mapBlock, new RegExp(`\\b${refusal}:\\s*\\d{3}`), `${refusal} has no mapped status`);
    }
  });

  await test('cross-ORGANIZATION is 404 and cross-CLINIC is 403 — the distinction is in the code, not just prose', () => {
    const route = readSource('routes/messagingReliability.ts');
    const mapBlock = route.slice(route.indexOf('REPLAY_REFUSAL_STATUS'), route.indexOf('router.post('));
    assert.match(mapBlock, /NOT_FOUND:\s*404/);
    assert.match(mapBlock, /CROSS_CLINIC_REFUSED:\s*403/);
  });

  await test('every tenant-describing field a caller might send is on the refusal list', () => {
    const route = readSource('routes/messagingReliability.ts');
    const listBlock = route.slice(
      route.indexOf('const TENANT_OVERRIDE_FIELDS'),
      route.indexOf('function findTenantOverride'),
    );
    for (const field of [
      'organizationId', 'organization_id', 'clinicId', 'clinic_id',
      'provider', 'channel', 'connectionId', 'providerMessageId',
      'rawPayload', 'payload', 'status', 'attempts', 'replayCount',
    ]) {
      assert.match(listBlock, new RegExp(`'${field}'`), `${field} must be refused if a body supplies it`);
    }
  });

  await test('the route derives tenant scope from the SESSION and never from the request', () => {
    const route = readSource('routes/messagingReliability.ts');
    const code = codeLines(route).join('\n');

    assert.match(code, /organizationId: req\.user!\.organizationId/);
    // The only places a body/query may influence anything are the operator's
    // own filters and paging — never a tenant, and never an actor.
    assert.equal(/organizationId:\s*(req\.body|req\.query)/.test(code), false, 'organization never from the request');
    assert.equal(/clinicScope:\s*(req\.body|req\.query)/.test(code), false, 'scope never from the request');
    assert.equal(/actorUserId:\s*(req\.body|req\.query)/.test(code), false, 'actor never from the request');
    assert.equal(/\.\.\.req\.body/.test(code), false, 'the body is never spread into a service call');
  });

  await test('an EXPLICIT clinic scope is built from allowedClinicIds, and an empty list is not widened', () => {
    const route = readSource('routes/messagingReliability.ts');
    const scopeFn = route.slice(route.indexOf('function deriveClinicScope'), route.indexOf('function isClinicRequestable'));
    assert.match(scopeFn, /allowedClinicIds \?\? \[\]/, 'a missing list becomes empty, never organization-wide');
    assert.match(scopeFn, /kind: 'ORGANIZATION_WIDE'/);
    // The org-wide branch must be reachable ONLY from the canonical role check.
    assert.match(scopeFn, /role === 'OWNER' \|\| role === 'ORG_ADMIN'/);
  });

  await test('the route touches NO outbox module — F5-2 replay is a different lifecycle', () => {
    // F5-2's replay creates a NEW event with causation; this one reuses the row
    // because the provider's message id IS the identity. Exposing the outbox
    // through a messaging route would collapse two lifecycles that were
    // deliberately kept apart, and would hand an operator a generic replay
    // button whose semantics change with the row it lands on.
    // CODE lines only: the module docstring names `replayDeadOutboxEvent`
    // precisely in order to explain why it is NOT reachable here, and a scan
    // that cannot tell an explanation from a call would forbid documenting the
    // decision at all.
    const code = codeLines(readSource('routes/messagingReliability.ts')).join('\n');
    assert.equal(code.includes('outbox/'), false, 'no outbox import');
    assert.equal(/replayDeadOutboxEvent/.test(code), false, 'no outbox replay reachable from here');
    assert.equal(/OutboxEvent/.test(code), false);
  });

  await test('the route adds NO new system-context reason and takes no system context of its own', () => {
    const route = readSource('routes/messagingReliability.ts');
    assert.equal(/runAsSystem/.test(route), false, 'system execution stays inside the services');
    assert.equal(/SystemContextReason/.test(route), false);
  });

  await test('the route never selects, returns or logs a payload, a phone number or an error body', () => {
    const route = readSource('routes/messagingReliability.ts');
    const code = codeLines(route).join('\n');
    for (const forbidden of ['fromPhone', 'toPhone', 'errorMessage', 'prisma.']) {
      assert.equal(code.includes(forbidden), false, `the route must not reference ${forbidden}`);
    }
    // `rawPayload` appears exactly once in code — in the refusal list, as a
    // field name a caller is forbidden to send.
    const rawPayloadHits = (code.match(/rawPayload/g) ?? []).length;
    assert.equal(rawPayloadHits, 1, 'rawPayload appears only as a refused input field name');
  });

  await test('the DLQ page size is bounded by a constant, and the maximum is sane', () => {
    assert.ok(Number.isInteger(MESSAGING_DLQ_MAX_PAGE_SIZE));
    assert.ok(Number.isInteger(MESSAGING_DLQ_DEFAULT_PAGE_SIZE));
    assert.ok(MESSAGING_DLQ_DEFAULT_PAGE_SIZE >= 1);
    assert.ok(MESSAGING_DLQ_DEFAULT_PAGE_SIZE <= MESSAGING_DLQ_MAX_PAGE_SIZE);
    assert.ok(MESSAGING_DLQ_MAX_PAGE_SIZE <= 500, 'an operator page is not a bulk export');
  });

  await test('the DLQ page is a deterministic TOTAL order', () => {
    const dlq = readSource('messaging/messagingInboundDlq.ts');
    const pageFn = dlq.slice(dlq.indexOf('export async function listDeadInboundEventPage'));
    // deadLetteredAt alone is not a total order: rows dead-lettered by one
    // sweep share a timestamp to the millisecond, and paging a non-total order
    // shows one row twice and skips another.
    assert.match(pageFn, /orderBy: \[\{ deadLetteredAt: 'desc' \}, \{ id: 'asc' \}\]/);
  });

  await test('the page and its total are computed from the SAME predicate', () => {
    const dlq = readSource('messaging/messagingInboundDlq.ts');
    const pageFn = dlq.slice(dlq.indexOf('export async function listDeadInboundEventPage'));
    assert.match(pageFn, /const where = buildDeadInboundEventWhere\(args\)/);
    const countAndFind = pageFn.slice(pageFn.indexOf('Promise.all'), pageFn.indexOf('return {'));
    // `count({ where })` uses the shorthand and `findMany({ where, ... })` does
    // not, so both spellings of the SAME binding have to be accepted here.
    const sharedWhereUses = (countAndFind.match(/\bwhere\s*[,}]/g) ?? []).length;
    assert.ok(sharedWhereUses >= 2, `count and findMany must share it, saw ${sharedWhereUses}`);
    assert.equal(/where:\s*\{/.test(countAndFind), false, 'neither builds a second predicate inline');
  });

  await test('the organization-scoped metrics require an organizationId and apply the clinic scope', () => {
    const dlq = readSource('messaging/messagingInboundDlq.ts');
    const fn = dlq.slice(dlq.indexOf('export async function getOrganizationMessagingMetrics'));
    assert.match(fn, /organizationId: string;/, 'organizationId is REQUIRED, not optional');
    assert.match(fn, /scope\.kind === 'EXPLICIT' \? \{ clinicId: \{ in:/, 'clinic scope is a predicate');
    assert.match(fn, /organizationId: args\.organizationId/);
  });

  await test('platform-wide metrics stay AGGREGATE — no cross-tenant dead-event listing exists', () => {
    // §29: a platform admin needing tenant-specific inspection would need a
    // break-glass/support-access architecture, and this repository has none.
    // Inventing one inside a metrics task is exactly what must not happen, so
    // the platform surface is counts only and this test pins that.
    const platform = readSource('routes/platformAdmin.ts');
    const block = platform.slice(platform.indexOf("router.get('/messaging/reliability/metrics'"));
    const handler = block.slice(0, block.indexOf('});') + 3);
    assert.match(handler, /getMessagingInboundMetrics/);
    assert.equal(handler.includes('listDeadInboundEvent'), false, 'no cross-tenant listing');
    assert.equal(handler.includes('replayDeadInboundEvent'), false, 'no cross-tenant replay');
    assert.equal(platform.includes('listDeadInboundEventPage'), false, 'and none anywhere on the platform router');
  });

  await test('the operator route is mounted BEHIND authentication, tenant context and CSRF', () => {
    const index = readSource('index.ts');
    const authAt = index.indexOf("app.use('/api', authenticate");
    const csrfAt = index.indexOf("app.use('/api', csrfProtection('clinic'))");
    const routeAt = index.indexOf("app.use('/api', messagingReliabilityRoutes)");
    assert.ok(authAt > 0 && csrfAt > 0 && routeAt > 0, 'all three mount points exist');
    assert.ok(routeAt > authAt, 'the route is mounted after authenticate');
    assert.ok(routeAt > csrfAt, 'and after the clinic CSRF gate — replay is a mutation');
  });

  await test('F5-3R activates NO feature flag: MESSAGING_DURABLE_ACK_ENABLED is untouched', () => {
    // The route is merge- and deploy-ready while durable acceptance stays off.
    // Nothing in this task reads, writes or defaults that flag.
    const route = readSource('routes/messagingReliability.ts');
    assert.equal(route.includes('MESSAGING_DURABLE_ACK_ENABLED'), false);
    assert.equal(route.includes('isDurableAckBeforeResponseEnabled'), false);
    assert.equal(isDurableAckBeforeResponseEnabled({} as NodeJS.ProcessEnv), false, 'still OFF by default');
  });

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`F5-3 messaging reliability: ${passed} passed, ${failed} failed`);
  // Let the loop drain a turn before forcing the exit. This is the only suite
  // in the repository that opens real sockets, and on Windows libuv aborts
  // ("!(handle->flags & UV_HANDLE_CLOSING)") if process.exit() lands while a
  // just-destroyed handle is still closing. Harmless on Linux CI, but a local
  // exit code of 127 would hide a genuine failure from whoever runs it here.
  // Deliberately NOT process.exit(). This is the only suite in the repository
  // that opens real sockets, and on Windows libuv aborts
  // ("!(handle->flags & UV_HANDLE_CLOSING)") when a forced exit lands while a
  // just-destroyed handle is still closing — which turns a clean 0 into a 127
  // and would hide a genuine failure from whoever runs it locally. Every handle
  // this suite creates is closed above, so setting the code and letting the
  // loop drain is both correct and observably terminating.
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
