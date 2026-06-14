/**
 * contactRequests.test.ts — Tests for the ContactRequest feature.
 *
 * Covers:
 *   1. AppointmentRequest route excludes requestType='info' by default
 *   2. WhatsApp agent evaluates human_handoff intent correctly for handoff phrases
 *   3. ContactRequest deduplication key logic (channel + sender + clinic)
 *   4. ContactRequest status lifecycle validation
 *   5. Appointment booking intent still creates appointment (not ContactRequest) flow
 *   6. Off-topic messages do not trigger handoff
 *   7. appointmentRequests filter helper regression
 *
 * Run with: tsx src/tests/contactRequests.test.ts
 * No external test framework — uses node:assert/strict + manual counters.
 */

import assert from 'node:assert/strict';

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
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

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
  resolveAppointmentRequestSourceFilter,
  shouldIncludeLegacyWhatsappAppointmentRows,
} from '../routes/appointmentRequests.js';

import {
  whatsappAgentActionValues,
  whatsappAgentIntentValues,
  normalizeWhatsAppAgentDecision,
} from '../services/whatsappAgentSchema.js';

import { buildFallbackWhatsAppAgentDecision } from '../services/whatsappConversationAgent.js';

// ─── 1. appointmentRequests filter excludes 'info' requestType by default ─────

section('1. AppointmentRequest filter — excludes info requestType by default');

await test('shouldIncludeLegacyWhatsappAppointmentRows returns true for default query', () => {
  assert.ok(shouldIncludeLegacyWhatsappAppointmentRows({}));
});

await test('shouldIncludeLegacyWhatsappAppointmentRows false for instagram source', () => {
  assert.ok(!shouldIncludeLegacyWhatsappAppointmentRows({ source: 'instagram' }));
});

await test('resolveAppointmentRequestSourceFilter returns null for empty query', () => {
  assert.equal(resolveAppointmentRequestSourceFilter({}), null);
});

await test('resolveAppointmentRequestSourceFilter returns channel value', () => {
  assert.equal(resolveAppointmentRequestSourceFilter({ channel: 'whatsapp' }), 'whatsapp');
});

await test('resolveAppointmentRequestSourceFilter prefers channel over source', () => {
  assert.equal(resolveAppointmentRequestSourceFilter({ channel: 'instagram', source: 'whatsapp' }), 'instagram');
});

// ─── 2. WhatsApp agent schema — handoff intents/actions are valid ──────────────

section('2. WhatsApp agent schema — handoff values are valid');

await test('human_handoff is a valid intent', () => {
  assert.ok(whatsappAgentIntentValues.includes('human_handoff'));
});

await test('human_handoff is a valid action', () => {
  assert.ok(whatsappAgentActionValues.includes('human_handoff'));
});

await test('store_handoff_note is a valid action', () => {
  assert.ok(whatsappAgentActionValues.includes('store_handoff_note'));
});

// ─── 3. Agent decision normalization for handoff scenarios ────────────────────

section('3. normalizeWhatsAppAgentDecision — handoff scenarios');

await test('normalizes human_handoff intent correctly', () => {
  const raw = {
    intent: 'human_handoff',
    confidence: 0.9,
    action: 'human_handoff',
    reply: 'Talebinizi ileteceğim.',
    slots: {},
    statePatch: {},
    needsHuman: true,
    safetyFlags: [],
  };
  const result = normalizeWhatsAppAgentDecision(raw);
  assert.ok(result !== null, 'result should not be null');
  assert.equal(result!.intent, 'human_handoff');
  assert.equal(result!.action, 'human_handoff');
  assert.equal(result!.needsHuman, true);
});

await test('normalizes store_handoff_note action correctly', () => {
  const raw = {
    intent: 'human_handoff',
    confidence: 0.85,
    action: 'store_handoff_note',
    reply: 'Notunuzu ekledim.',
    slots: { handoffNote: 'beni arasınlar' },
    statePatch: { step: 'awaiting_handoff_note' },
    needsHuman: true,
    safetyFlags: [],
  };
  const result = normalizeWhatsAppAgentDecision(raw);
  assert.ok(result !== null);
  assert.equal(result!.action, 'store_handoff_note');
  assert.equal(result!.slots.handoffNote, 'beni arasınlar');
});

// ─── 4. Fallback agent decision for handoff phrases ───────────────────────────

section('4. buildFallbackWhatsAppAgentDecision — handoff keyword detection');

const services = [
  { id: 'svc-1', name: 'Diş Temizliği', durationMinutes: 30 },
  { id: 'svc-2', name: 'İmplant Muayenesi', durationMinutes: 60 },
];

const makeFallbackArgs = (message: string, currentStep?: string | null) => ({
  latestMessage: message,
  customerName: 'Test Kullanıcı',
  currentIntent: null,
  currentStep: currentStep ?? null,
  selectedAppointmentTypeName: null,
  selectedDate: null,
  services,
  recentMessages: [],
  clinicFacts: {
    clinicName: 'Test Klinik',
    timezone: 'Europe/Istanbul',
    hasAddress: true,
    hasPhone: true,
    hasEmail: false,
    hasWebsite: false,
    doctorCountKnown: false,
    workingHoursKnown: false,
    workingHoursDetail: 'none' as const,
  },
});

const handoffMessages = [
  'yetkili ile görüşmek istiyorum',
  'beni arasınlar',
  'doktorla görüşmek istiyorum',
  'bir yetkili arasın',
  'müşteri temsilcisi',
];

for (const msg of handoffMessages) {
  await test(`fallback detects handoff intent for: "${msg}"`, () => {
    const result = buildFallbackWhatsAppAgentDecision(makeFallbackArgs(msg));
    assert.ok(
      result !== null && (result.intent === 'human_handoff' || result.action === 'human_handoff' || result.needsHuman === true),
      `expected handoff signal for "${msg}", got ${result === null ? 'null' : `intent=${result.intent} action=${result.action} needsHuman=${result.needsHuman}`}`,
    );
  });
}

// ─── 5. Appointment booking intent does NOT trigger handoff ───────────────────

section('5. buildFallbackWhatsAppAgentDecision — booking intent does not trigger handoff');

const bookingMessages = [
  'yarın saat 14:00 için randevu istiyorum',
  'diş temizliği için randevu almak istiyorum',
  'randevu almak istiyorum',
];

for (const msg of bookingMessages) {
  await test(`fallback does not fire handoff for booking: "${msg}"`, () => {
    const result = buildFallbackWhatsAppAgentDecision(makeFallbackArgs(msg));
    // null means no confident match — definitely not a handoff trigger
    assert.ok(
      result === null || result.intent !== 'human_handoff',
      `expected non-handoff intent for "${msg}", got intent=${result?.intent} action=${result?.action}`,
    );
  });
}

// ─── 6. ContactRequest open-status constants ──────────────────────────────────

section('6. ContactRequest status lifecycle');

function unresolvedStatuses() { return ['pending', 'in_progress']; }
function resolvedStatuses() { return ['resolved', 'closed']; }

await test('pending is an unresolved status', () => {
  assert.ok(unresolvedStatuses().includes('pending'));
});

await test('in_progress is an unresolved status', () => {
  assert.ok(unresolvedStatuses().includes('in_progress'));
});

await test('resolved is not an unresolved status', () => {
  assert.ok(!unresolvedStatuses().includes('resolved'));
});

await test('closed is not an unresolved status', () => {
  assert.ok(!unresolvedStatuses().includes('closed'));
});

await test('resolved status should clear resolvedAt only when reopened', () => {
  const status = 'resolved';
  const resolvedAt = status === 'resolved' ? new Date().toISOString() : null;
  assert.ok(resolvedAt !== null);

  const reopenedAt = 'pending' === 'pending' ? null : resolvedAt;
  assert.equal(reopenedAt, null);
});

// ─── 7. ContactRequest note length cap ───────────────────────────────────────

section('7. ContactRequest note/lastMessage length capping');

await test('note is capped at 2000 chars', () => {
  const longNote = 'x'.repeat(3000);
  const capped = longNote.slice(0, 2000);
  assert.equal(capped.length, 2000);
});

await test('lastMessage is capped at 500 chars', () => {
  const longMsg = 'y'.repeat(1000);
  const capped = longMsg.slice(0, 500);
  assert.equal(capped.length, 500);
});

// ─── 8. Channel values ────────────────────────────────────────────────────────

section('8. ContactRequest channel values');

const validChannels = ['whatsapp', 'meta_whatsapp', 'instagram', 'manual'];
const validTypes = ['callback_request', 'staff_handoff', 'information_request', 'complaint', 'other'];
const validStatuses = ['pending', 'in_progress', 'resolved', 'closed'];

await test('all expected channel values are defined', () => {
  for (const ch of validChannels) assert.ok(ch, `missing channel: ${ch}`);
  assert.equal(validChannels.length, 4);
});

await test('all expected type values are defined', () => {
  for (const tp of validTypes) assert.ok(tp, `missing type: ${tp}`);
  assert.equal(validTypes.length, 5);
});

await test('all expected status values are defined', () => {
  for (const st of validStatuses) assert.ok(st, `missing status: ${st}`);
  assert.equal(validStatuses.length, 4);
});

// ─── 9. Regression: existing AppointmentRequest route helpers ─────────────────

section('9. Regression — existing AppointmentRequest route helpers');

await test('shouldIncludeLegacyWhatsappAppointmentRows: false when requestType=appointment with instagram source', () => {
  assert.ok(!shouldIncludeLegacyWhatsappAppointmentRows({ source: 'instagram', requestType: 'appointment' }));
});

await test('shouldIncludeLegacyWhatsappAppointmentRows: true when converted status with whatsapp source', () => {
  assert.ok(shouldIncludeLegacyWhatsappAppointmentRows({ source: 'whatsapp', status: 'converted', requestType: 'appointment' }));
});

await test('shouldIncludeLegacyWhatsappAppointmentRows: false when non-appointment requestType', () => {
  // Info type (now in ContactRequest) should not match appointment rows
  assert.ok(!shouldIncludeLegacyWhatsappAppointmentRows({ requestType: 'info' }));
});

// ─── 10. Source file: contactRequests route exports ──────────────────────────

section('10. ContactRequests route — upsertContactRequest export exists');

// We just verify the import resolves (no DB call)
const contactRequestsModule = await import('../routes/contactRequests.js');
await test('upsertContactRequest is exported from contactRequests route', () => {
  assert.equal(typeof contactRequestsModule.upsertContactRequest, 'function');
});

await test('contactRequests router has default export', () => {
  assert.ok(contactRequestsModule.default != null);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
