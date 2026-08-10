/**
 * inboundRateLimiterLogPrivacy.test.ts — F3-IMPL-004 regression test confirming
 * server/src/utils/inboundRateLimiter.ts never writes a raw inbound sender
 * identifier (phone number or external contact id) to the process logs when
 * a sender is rate-limited.
 *
 * Covers the confirmed production-reachable console.warn call site:
 *   checkInboundRateLimit — '[rate-limiter] inbound AI message rate-limited'
 *
 * Runtime logger-spy tests exercise the rate-limited branch (calling
 * checkInboundRateLimit more than RATE_LIMIT_MAX_MESSAGES times for the same
 * channel/connectionId/sender) and assert the raw sender value never appears
 * anywhere in captured console.* output, while the masked suffix form does.
 * Covers both a numeric phone-shaped sender and a non-numeric external id,
 * per the file's own doc comment ("sender (phone or fromExternalId)").
 *
 * Run with: cd server && npx tsx src/tests/inboundRateLimiterLogPrivacy.test.ts
 */

import assert from 'node:assert/strict';

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

import {
  checkInboundRateLimit,
  _resetRateLimitStore,
  RATE_LIMIT_MAX_MESSAGES,
} from '../utils/inboundRateLimiter.js';

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

/** Asserts none of `rawValues` appear anywhere in any captured console.* call,
 * regardless of key name, shorthand, or template interpolation. */
function assertNoRawLeak(calls: unknown[][], rawValues: string[]) {
  const serialized = serialize(calls);
  for (const raw of rawValues) {
    assert.ok(
      !serialized.includes(raw),
      `raw value "${raw}" leaked into a console.* call.\nCaptured calls: ${serialized}`,
    );
  }
}

async function triggerRateLimit(channel: string, connectionId: string, sender: string) {
  let lastResult = true;
  // RATE_LIMIT_MAX_MESSAGES allowed, the next call trips the warn branch.
  for (let i = 0; i < RATE_LIMIT_MAX_MESSAGES + 1; i++) {
    lastResult = await checkInboundRateLimit(channel, connectionId, sender);
  }
  return lastResult;
}

async function main() {
  section('Runtime logger-spy — rate-limited numeric phone sender');

  const RAW_PHONE = '905551234567';
  const REDACTED_PHONE_SUFFIX = RAW_PHONE.slice(-4); // '4567'

  await test('rate-limit warn masks a phone-shaped sender, never logs it raw', async () => {
    _resetRateLimitStore();
    const { calls, restore } = captureConsole();
    let allowed: boolean;
    try {
      allowed = await triggerRateLimit('whatsapp', 'conn-1', RAW_PHONE);
    } finally {
      restore();
    }
    assert.equal(allowed, false, 'expected the final call to be rate-limited');
    assertNoRawLeak(calls, [RAW_PHONE]);
    const serialized = serialize(calls);
    assert.ok(serialized.includes(REDACTED_PHONE_SUFFIX), 'expected masked sender suffix in logs');
    assert.ok(serialized.includes('***'), 'expected masking prefix "***" in logs');
  });

  section('Runtime logger-spy — rate-limited non-numeric external id sender');

  const RAW_EXTERNAL_ID = 'ig-external-contact-abc123';
  const REDACTED_EXTERNAL_SUFFIX = RAW_EXTERNAL_ID.slice(-4); // 'c123'

  await test('rate-limit warn masks a non-numeric external id sender, never logs it raw', async () => {
    _resetRateLimitStore();
    const { calls, restore } = captureConsole();
    let allowed: boolean;
    try {
      allowed = await triggerRateLimit('instagram', 'conn-2', RAW_EXTERNAL_ID);
    } finally {
      restore();
    }
    assert.equal(allowed, false, 'expected the final call to be rate-limited');
    assertNoRawLeak(calls, [RAW_EXTERNAL_ID]);
    const serialized = serialize(calls);
    assert.ok(serialized.includes(REDACTED_EXTERNAL_SUFFIX), 'expected masked sender suffix in logs');
    assert.ok(serialized.includes('***'), 'expected masking prefix "***" in logs');
  });

  section('Runtime logger-spy — safe metadata still present alongside masked sender');

  await test('rate-limit warn still logs channel, connectionId, and count', async () => {
    _resetRateLimitStore();
    const { calls, restore } = captureConsole();
    try {
      await triggerRateLimit('whatsapp', 'conn-3', RAW_PHONE);
    } finally {
      restore();
    }
    const serialized = serialize(calls);
    assert.ok(serialized.includes('whatsapp'), 'expected channel in logs');
    assert.ok(serialized.includes('conn-3'), 'expected connectionId in logs');
    assert.ok(serialized.includes(String(RATE_LIMIT_MAX_MESSAGES + 1)), 'expected count in logs');
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
