/**
 * whatsappConversationAgentLogPrivacy.test.ts — F3-IMPL-004 regression test.
 *
 * runGoogleConversationAgent (services/whatsappConversationAgent.ts) builds its
 * Google AI Studio / Gemini endpoint with the raw API key in the request URL
 * query string (`?key=${config.apiKey}`). The generic catch in
 * resolveWhatsAppConversationAgentDecision used to log the raw caught `error`
 * directly via `console.error('[whatsapp-agent] ai-error', error)`. A network-
 * level fetch failure (DNS, timeout, connection refused, ...) commonly embeds
 * the full request URL — including the API key — in its message, so that raw
 * log call was a confirmed secret leak on every such failure.
 *
 * This is distinct from (and a defense-in-depth complement to) the existing
 * HTTP-status-error path already covered by aiPrivacyBoundary.test.ts, which
 * verifies a non-2xx provider response body is redacted before being thrown/
 * logged. This test targets the OTHER path into the same catch block: a raw
 * Error thrown by fetch itself (never reaches the `!response.ok` branch),
 * whose message is not redacted by that earlier code path at all.
 *
 * Run with: cd server && npx tsx src/tests/whatsappConversationAgentLogPrivacy.test.ts
 */

import assert from 'node:assert/strict';

process.env.WHATSAPP_AI_AGENT_ENABLED = 'true';

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

import { resolveWhatsAppConversationAgentDecision } from '../services/whatsappConversationAgent.js';

const baseClinicFacts = {
  clinicName: 'Test Klinik',
  timezone: 'Europe/Istanbul',
  hasAddress: false,
  hasPhone: false,
  hasEmail: false,
  hasWebsite: false,
  doctorCountKnown: false,
  workingHoursKnown: false,
};

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

function serializeConsoleCalls(calls: unknown[][]): string {
  return JSON.stringify(calls, (_key, value) => (typeof value === 'function' ? '[fn]' : value));
}

async function main() {
  section('resolveWhatsAppConversationAgentDecision — ai-error log privacy');

  await test('a raw network-level fetch error (echoing the request URL + API key) is never logged raw; only a safe, redacted message and the operation tag appear', async () => {
    const REAL_API_KEY = 'AIzaSyD1234567890abcdefGHIJKLMNOPQRSTUv';
    const prevKey = process.env.GOOGLE_AI_STUDIO_API_KEY;
    process.env.GOOGLE_AI_STUDIO_API_KEY = REAL_API_KEY;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      // Mirrors a real Node/undici network failure, whose message commonly
      // echoes the full request URL (including the ?key=<apiKey> query param).
      throw new Error(`fetch failed: request to ${String(input)} failed, reason: connect ETIMEDOUT`);
    }) as typeof fetch;

    const { calls, restore } = captureConsole();
    let source: string;
    try {
      ({ source } = await resolveWhatsAppConversationAgentDecision({
        latestMessage: 'merhaba',
        customerName: null,
        currentIntent: null,
        currentStep: null,
        selectedAppointmentTypeName: null,
        selectedDate: null,
        services: [],
        recentMessages: [],
        clinicFacts: baseClinicFacts,
      }));
    } finally {
      restore();
      globalThis.fetch = originalFetch;
      if (prevKey === undefined) delete process.env.GOOGLE_AI_STUDIO_API_KEY;
      else process.env.GOOGLE_AI_STUDIO_API_KEY = prevKey;
    }

    assert.ok(source === 'ai_error' || source === 'rule_fallback', `expected an error-path source, got: ${source}`);
    const serialized = serializeConsoleCalls(calls);
    assert.equal(serialized.includes(REAL_API_KEY), false, `raw API key leaked into logs: ${serialized}`);
    assert.ok(serialized.includes('ai-error'), 'expected the operation tag to still be logged');
  });

  await test('a benign, non-URL error message still passes through the same safe logging path unchanged (no false-positive redaction)', async () => {
    const prevKey = process.env.GOOGLE_AI_STUDIO_API_KEY;
    process.env.GOOGLE_AI_STUDIO_API_KEY = 'test-fake-key-not-a-real-credential';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('socket hang up');
    }) as typeof fetch;

    const { calls, restore } = captureConsole();
    try {
      await resolveWhatsAppConversationAgentDecision({
        latestMessage: 'merhaba',
        customerName: null,
        currentIntent: null,
        currentStep: null,
        selectedAppointmentTypeName: null,
        selectedDate: null,
        services: [],
        recentMessages: [],
        clinicFacts: baseClinicFacts,
      });
    } finally {
      restore();
      globalThis.fetch = originalFetch;
      if (prevKey === undefined) delete process.env.GOOGLE_AI_STUDIO_API_KEY;
      else process.env.GOOGLE_AI_STUDIO_API_KEY = prevKey;
    }

    const serialized = serializeConsoleCalls(calls);
    assert.ok(serialized.includes('socket hang up'), 'expected the benign error message to still be logged for debuggability');
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
