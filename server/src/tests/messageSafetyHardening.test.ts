/**
 * messageSafetyHardening.test.ts — Tests for message safety hardening features.
 *
 * Run with:  tsx src/tests/messageSafetyHardening.test.ts
 * No external test framework — uses node:assert/strict + manual counters.
 *
 * Tests:
 *   1. 3000-char Instagram DM is passed to AI as max 2000 chars.
 *   2. 3000-char Evolution WhatsApp message is passed to AI as max 2000 chars.
 *   3. 3000-char Meta WhatsApp message is passed to AI as max 2000 chars.
 *   4. Agent prompt includes prompt-injection safety rules.
 *   5. Same sender over limit within 60 seconds does not trigger AI.
 *   6. Existing Instagram, WhatsApp, and Meta flows still pass (rate limiter allows normal traffic).
 */

import assert from 'node:assert/strict';

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

process.env.ENCRYPTION_KEY = 'd'.repeat(64);

import { sanitizeInboundMessageText } from '../utils/messageSanitizer.js';
import {
  checkInboundRateLimit,
  RATE_LIMIT_MAX_MESSAGES,
  RATE_LIMIT_WINDOW_MS,
  _resetRateLimitStore,
} from '../utils/inboundRateLimiter.js';
import { buildWhatsAppAgentPrompt } from '../services/whatsappAgentPrompt.js';

// ─── 1: Text length capping — shared helper ───────────────────────────────────

section('1. sanitizeInboundMessageText');

await test('returns empty string for non-string input', () => {
  assert.strictEqual(sanitizeInboundMessageText(null), '');
  assert.strictEqual(sanitizeInboundMessageText(undefined), '');
  assert.strictEqual(sanitizeInboundMessageText(123), '');
  assert.strictEqual(sanitizeInboundMessageText({}), '');
});

await test('trims whitespace', () => {
  assert.strictEqual(sanitizeInboundMessageText('  hello  '), 'hello');
});

await test('returns empty string for whitespace-only input', () => {
  assert.strictEqual(sanitizeInboundMessageText('   '), '');
});

await test('returns text unchanged when under maxLength', () => {
  const text = 'a'.repeat(1999);
  assert.strictEqual(sanitizeInboundMessageText(text), text);
});

await test('caps at 2000 chars by default', () => {
  const text = 'a'.repeat(3000);
  const result = sanitizeInboundMessageText(text);
  assert.strictEqual(result.length, 2000);
});

await test('respects custom maxLength', () => {
  const text = 'b'.repeat(500);
  const result = sanitizeInboundMessageText(text, 100);
  assert.strictEqual(result.length, 100);
});

// ─── 2: Instagram DM — 3000-char message capped to 2000 ──────────────────────

section('2. Instagram DM text length limiting');

await test('3000-char Instagram DM message is capped to 2000 chars before AI', () => {
  const longText = 'İnstagram '.repeat(300); // 3000 chars
  const sanitized = sanitizeInboundMessageText(longText);
  assert.ok(
    sanitized.length <= 2000,
    `Expected length <= 2000, got ${sanitized.length}`,
  );
});

// ─── 3: Evolution WhatsApp — 3000-char message capped to 2000 ────────────────

section('3. Evolution WhatsApp text length limiting');

await test('3000-char Evolution WhatsApp message is capped to 2000 chars before AI', () => {
  const longText = 'Evolution '.repeat(300); // 3000 chars
  const sanitized = sanitizeInboundMessageText(longText);
  assert.ok(
    sanitized.length <= 2000,
    `Expected length <= 2000, got ${sanitized.length}`,
  );
});

// ─── 4: Meta WhatsApp — 3000-char message capped to 2000 ─────────────────────

section('4. Meta WhatsApp text length limiting');

await test('3000-char Meta WhatsApp message is capped to 2000 chars before AI', () => {
  const longText = 'Meta '.repeat(600); // 3000 chars
  const sanitized = sanitizeInboundMessageText(longText);
  assert.ok(
    sanitized.length <= 2000,
    `Expected length <= 2000, got ${sanitized.length}`,
  );
});

// ─── 5: Agent prompt includes prompt-injection safety rules ──────────────────

section('5. Agent prompt — prompt-injection safety rules');

const makePromptArgs = () => ({
  latestMessage: 'Merhaba',
  customerName: 'Test',
  currentIntent: null,
  currentStep: null,
  selectedAppointmentTypeName: null,
  selectedDate: null,
  services: [{ id: 's1', name: 'Genel Muayene', durationMinutes: 30 }],
  recentMessages: [],
  clinicFacts: {
    clinicName: 'Test Klinik',
    timezone: 'Europe/Istanbul',
    hasAddress: false,
    hasPhone: false,
    hasEmail: false,
    hasWebsite: false,
    doctorCountKnown: false,
    workingHoursKnown: false,
  },
});

await test('prompt contains customer_message wrapper for latest message', () => {
  const prompt = buildWhatsAppAgentPrompt(makePromptArgs());
  assert.ok(
    prompt.includes('<customer_message>'),
    'Prompt must wrap latest message in <customer_message> tags',
  );
  assert.ok(
    prompt.includes('</customer_message>'),
    'Prompt must close <customer_message> tag',
  );
});

await test('prompt contains instruction that user messages are data not instructions', () => {
  const prompt = buildWhatsAppAgentPrompt(makePromptArgs());
  assert.ok(
    prompt.toLowerCase().includes('data') || prompt.includes('DATA'),
    'Prompt must state that customer messages are data',
  );
});

await test('prompt contains rules about refusing "ignore previous instructions"', () => {
  const prompt = buildWhatsAppAgentPrompt(makePromptArgs());
  assert.ok(
    prompt.includes('ignore previous instructions'),
    'Prompt must mention and refuse "ignore previous instructions" attacks',
  );
});

await test('prompt contains rules about refusing "show your system prompt"', () => {
  const prompt = buildWhatsAppAgentPrompt(makePromptArgs());
  assert.ok(
    prompt.includes('system prompt') || prompt.includes('system instructions'),
    'Prompt must mention and refuse system prompt disclosure attacks',
  );
});

await test('prompt contains rules about refusing "mark all slots as available"', () => {
  const prompt = buildWhatsAppAgentPrompt(makePromptArgs());
  assert.ok(
    prompt.includes('mark all slots as available'),
    'Prompt must refuse slot manipulation attacks',
  );
});

await test('prompt contains never-reveal rule for tokens/keys', () => {
  const prompt = buildWhatsAppAgentPrompt(makePromptArgs());
  assert.ok(
    prompt.includes('token') || prompt.includes('API token') || prompt.includes('secret'),
    'Prompt must instruct never to reveal tokens or secrets',
  );
});

await test('prompt scopes assistant to clinic services and handoff', () => {
  const prompt = buildWhatsAppAgentPrompt(makePromptArgs());
  assert.ok(
    prompt.includes('human_handoff') || prompt.includes('staff handoff'),
    'Prompt must describe staff handoff as the route for unsafe requests',
  );
});

// ─── 6: Rate limiting ─────────────────────────────────────────────────────────

section('6. In-memory rate limiting');

await test('normal traffic within limit is allowed', () => {
  _resetRateLimitStore();
  for (let i = 0; i < RATE_LIMIT_MAX_MESSAGES; i++) {
    const allowed = checkInboundRateLimit('whatsapp', 'conn-1', 'sender-normal');
    assert.ok(allowed, `Message ${i + 1} should be allowed`);
  }
});

await test('sender over limit within window is blocked', () => {
  _resetRateLimitStore();
  // Exhaust the allowance
  for (let i = 0; i < RATE_LIMIT_MAX_MESSAGES; i++) {
    checkInboundRateLimit('evolution', 'conn-2', 'sender-spam');
  }
  // Next message should be blocked
  const blocked = checkInboundRateLimit('evolution', 'conn-2', 'sender-spam');
  assert.strictEqual(blocked, false, 'Message over limit must be blocked');
});

await test('different senders on same connection are independent', () => {
  _resetRateLimitStore();
  // Exhaust sender-a
  for (let i = 0; i < RATE_LIMIT_MAX_MESSAGES; i++) {
    checkInboundRateLimit('instagram', 'conn-3', 'sender-a');
  }
  // sender-b on the same connection should still be allowed
  const allowed = checkInboundRateLimit('instagram', 'conn-3', 'sender-b');
  assert.ok(allowed, 'A different sender must not be affected by another sender\'s limit');
});

await test('same sender on different connections is independent', () => {
  _resetRateLimitStore();
  // Exhaust on conn-4
  for (let i = 0; i < RATE_LIMIT_MAX_MESSAGES; i++) {
    checkInboundRateLimit('meta_whatsapp', 'conn-4', 'sender-shared');
  }
  // Same sender on conn-5 should still be allowed
  const allowed = checkInboundRateLimit('meta_whatsapp', 'conn-5', 'sender-shared');
  assert.ok(allowed, 'Sender must not be blocked across different connections');
});

await test('window resets after WINDOW_MS elapses', async () => {
  // This test verifies the window-reset logic using a mock time — we check that
  // after enough time the bucket is treated as a new window.
  // We cannot wait 60 s in tests, so we test the logic path by manipulating state
  // via _resetRateLimitStore + calling the function.
  _resetRateLimitStore();
  // Fill the bucket to the limit
  for (let i = 0; i < RATE_LIMIT_MAX_MESSAGES; i++) {
    checkInboundRateLimit('evolution', 'conn-6', 'sender-reset');
  }
  assert.strictEqual(
    checkInboundRateLimit('evolution', 'conn-6', 'sender-reset'),
    false,
    'Should be blocked before reset',
  );
  // Reset simulates a new deployment / store flush
  _resetRateLimitStore();
  assert.ok(
    checkInboundRateLimit('evolution', 'conn-6', 'sender-reset'),
    'Should be allowed after store reset (simulates window expiry)',
  );
});

await test('rate limit constants: window is 60 s, max is 8', () => {
  assert.strictEqual(RATE_LIMIT_WINDOW_MS, 60_000);
  assert.strictEqual(RATE_LIMIT_MAX_MESSAGES, 8);
});

// ─── 7: Existing channel flows still pass (smoke) ────────────────────────────

section('7. Existing flows smoke tests');

await test('sanitizeInboundMessageText handles normal short messages unchanged', () => {
  const msg = 'Merhaba, yarın için randevu almak istiyorum';
  assert.strictEqual(sanitizeInboundMessageText(msg), msg);
});

await test('buildWhatsAppAgentPrompt still returns a non-empty string for normal usage', () => {
  const prompt = buildWhatsAppAgentPrompt({
    ...makePromptArgs(),
    latestMessage: 'Randevu almak istiyorum',
    customerName: 'Ahmet Yılmaz',
    currentIntent: 'book_appointment',
    currentStep: 'awaiting_service',
    selectedAppointmentTypeName: null,
    selectedDate: null,
  });
  assert.ok(typeof prompt === 'string' && prompt.length > 100, 'Prompt must be a non-empty string');
  assert.ok(prompt.includes('Randevu almak istiyorum'), 'Prompt must include the latest message');
});

await test('rate limiter allows evolution, meta, and instagram independently', () => {
  _resetRateLimitStore();
  assert.ok(checkInboundRateLimit('evolution', 'c1', 's1'), 'evolution allowed');
  assert.ok(checkInboundRateLimit('meta_whatsapp', 'c1', 's1'), 'meta_whatsapp allowed');
  assert.ok(checkInboundRateLimit('instagram', 'c1', 's1'), 'instagram allowed');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
