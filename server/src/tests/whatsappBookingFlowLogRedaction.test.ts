/**
 * whatsappBookingFlowLogRedaction.test.ts — KVKK regression tests confirming
 * server/src/services/whatsappBookingFlow.ts never writes a raw patient phone
 * number or raw inbound message text to the process logs.
 *
 * Covers the six confirmed production-reachable console.log call sites:
 *   1. handleAwaitingServiceStep  — '[whatsapp-assistant] route-handler' (awaiting_service-selection)
 *   2. handleAwaitingTimeStep     — '[whatsapp-assistant] route-handler' (awaiting_time-selection)
 *   3. handleAwaitingTimeStep     — '[whatsapp-assistant] time-request' (exact_time)
 *   4. handleAwaitingTimeStep     — '[whatsapp-assistant] time-request' (time_range)
 *   5. handleAwaitingTimeStep     — '[whatsapp-assistant] time-request' (after_time)
 *   6. handleAwaitingTimeStep     — '[whatsapp-assistant] time-request' (preference)
 *
 * Primary defense is runtime logger-spy tests: every console.* call made while
 * exercising each handler is captured and the ENTIRE serialized payload (not just
 * specific keys) is checked for the raw phone/text substrings. That catches any
 * regression vector, not just the ones seen historically — alternate key names
 * (rawPhone, debugPhone), shorthand ({ phone }, { text }), and template
 * interpolation all still land the raw value somewhere in a console.* argument,
 * which this check will flag regardless of the key it's filed under.
 *
 * A secondary static source scan backstops the runtime tests in case a future
 * change routes these fields through something other than console.* directly.
 *
 * Run with: cd server && npx tsx src/tests/whatsappBookingFlowLogRedaction.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.ENCRYPTION_KEY = 'c'.repeat(64);

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
  handleAwaitingServiceStep,
  handleAwaitingTimeStep,
  type BookingServiceOption,
} from '../services/whatsappBookingFlow.js';
import type { SavedAvailableSlot } from '../services/whatsappAvailability.js';

// ─── Fixtures (mirrors whatsappAwaitingServiceStep.test.ts / whatsappStepAwareNlu.test.ts) ──

const SERVICES: BookingServiceOption[] = [
  { id: 'svc-1', name: 'Diş Beyazlatma', durationMinutes: 30 },
  { id: 'svc-2', name: 'Kanal Tedavisi', durationMinutes: 60 },
];

const extractNumericSelection = (text: string): number | null => {
  const m = text.trim().match(/^(\d{1,2})(?:[.)])?$/);
  return m ? Number(m[1]) : null;
};

const findServiceMatches = (text: string, services: BookingServiceOption[]) => {
  const normalized = text.trim().toLocaleLowerCase('tr-TR');
  if (!normalized || /^\d+$/.test(normalized)) return [];
  return services.filter(s => s.name.toLocaleLowerCase('tr-TR').includes(normalized));
};

const formatServiceList = (services: BookingServiceOption[]) =>
  ['Hangi hizmet için randevu planlamak istersiniz?', ...services.map((s, i) => `${i + 1}. ${s.name}`)].join('\n');

const noPractitionerFragmentMatch = () => ({ extractedTime: null, hasPractitionerFragment: false, matches: [] });

const makePractitionerSlots = (times: string[]): SavedAvailableSlot[] =>
  times.map((t, i) => ({
    practitionerId: `pr-${i}`,
    practitionerName: 'Dr. Test',
    startTime: `2026-07-04T${t}:00.000Z`,
    endTime: `2026-07-04T${t}:30.000Z`,
    localStartTime: t,
    localEndTime: t,
  }));

// A realistic raw phone as it would arrive from the webhook (no separators).
const RAW_PHONE = '905551234567';
const REDACTED_PHONE_SUFFIX = '1234567'.slice(-4); // '4567'

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

// ─── Source scan (secondary backstop) ─────────────────────────────────────────

const bookingFlowSource = readFileSync(
  fileURLToPath(new URL('../services/whatsappBookingFlow.ts', import.meta.url)),
  'utf8',
);

/** Extracts the source text of a console.log(...) call by its distinguishing
 * literal (e.g. a handler/type string), from the console.log( token through
 * the matching closing paren of the object literal. Deliberately generous
 * (400 chars) so it comfortably spans every field in these small log calls. */
function extractLogCallBlock(distinguishingLiteral: string): string {
  const literalIndex = bookingFlowSource.indexOf(distinguishingLiteral);
  assert.ok(literalIndex >= 0, `expected to find "${distinguishingLiteral}" in whatsappBookingFlow.ts`);
  const callStart = bookingFlowSource.lastIndexOf('console.', literalIndex);
  assert.ok(callStart >= 0, `expected a console.* call before "${distinguishingLiteral}"`);
  return bookingFlowSource.slice(callStart, callStart + 400);
}

/** Guards against every historical regression shape: `phone: phone`, shorthand
 * `{ phone }`, `rawPhone`, `debugPhone`, and `${phone}` template interpolation. */
function assertBlockRedactsPhone(block: string, label: string) {
  assert.ok(/redactPhone\(phone\)/.test(block), `${label}: expected redactPhone(phone) call`);
  assert.ok(!/phone:\s*phone(?![a-zA-Z(])/.test(block), `${label}: found raw "phone: phone" shorthand-equivalent`);
  assert.ok(!/\{\s*phone\s*[,}]/.test(block), `${label}: found "{ phone }" shorthand`);
  assert.ok(!/rawPhone|debugPhone/i.test(block), `${label}: found rawPhone/debugPhone alternate key`);
  assert.ok(!/\$\{phone\}/.test(block), `${label}: found \${phone} template interpolation`);
}

/** Guards against raw text regressions: `text: text`, shorthand `{ text }`,
 * and `${text}` template interpolation. */
function assertBlockSummarizesText(block: string, label: string) {
  assert.ok(/summarizeTextForLog\(text\)/.test(block), `${label}: expected summarizeTextForLog(text) call`);
  assert.ok(!/text:\s*text(?![a-zA-Z(])/.test(block), `${label}: found raw "text: text" shorthand-equivalent`);
  assert.ok(!/\{\s*text\s*[,}]/.test(block), `${label}: found "{ text }" shorthand`);
  assert.ok(!/\$\{text\}/.test(block), `${label}: found \${text} template interpolation`);
}

async function main() {
  section('Runtime logger-spy — location 1/6: handleAwaitingServiceStep route-handler (phone)');

  await test('awaiting_service-selection log redacts phone, never logs it raw', async () => {
    const { calls, restore } = captureConsole();
    try {
      await handleAwaitingServiceStep({
        text: '2',
        phone: RAW_PHONE,
        customerName: 'Test Hasta',
        services: SERVICES,
        state: {},
        stateJson: {},
        extractNumericSelection,
        findServiceMatches,
        formatServiceList,
        upsertState: async () => {},
      });
    } finally {
      restore();
    }
    assertNoRawLeak(calls, [RAW_PHONE]);
    assert.ok(serialize(calls).includes(REDACTED_PHONE_SUFFIX), 'expected redacted phone suffix in logs');
  });

  section('Runtime logger-spy — location 2/6: handleAwaitingTimeStep route-handler (phone)');

  const baseTimeStepDeps = () => ({
    prisma: {} as any,
    clinicId: 'clinic-1',
    phone: RAW_PHONE,
    customerName: 'Test Hasta',
    state: {
      selectedAppointmentTypeId: 'svc-2',
      selectedAppointmentTypeName: 'Kanal Tedavisi',
      selectedPractitionerId: null,
      selectedDate: '2026-07-04',
    },
    minutesToTime: (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
    formatAvailabilityMessage: (date: string, slots: SavedAvailableSlot[]) => `AVAILABILITY:${date}:${slots.map(s => s.localStartTime).join(',')}`,
    logAvailabilitySave: () => {},
    upsertState: async () => {},
    resetState: async () => {},
    createAppointment: async () => ({ appointmentType: null }),
  });

  await test('awaiting_time-selection log (numeric slot reply) redacts phone, never logs it raw', async () => {
    const fixtureSlots = makePractitionerSlots(['09:00', '10:00', '14:00']);
    const { calls, restore } = captureConsole();
    try {
      await handleAwaitingTimeStep({
        ...baseTimeStepDeps(),
        text: '1',
        stateJson: { availableSlots: fixtureSlots, lastShownSlots: fixtureSlots },
        extractNumericSelection: () => 1,
        findSlotMatches: noPractitionerFragmentMatch,
      } as Parameters<typeof handleAwaitingTimeStep>[0]);
    } finally {
      restore();
    }
    assertNoRawLeak(calls, [RAW_PHONE]);
    assert.ok(serialize(calls).includes(REDACTED_PHONE_SUFFIX), 'expected redacted phone suffix in logs');
  });

  section('Runtime logger-spy — location 3/6: time-request exact_time (phone + text)');

  const RAW_TEXT_EXACT = 'saat 14:00 gibi olsun lütfen not: Ayşe Yılmaz için';

  await test('time-request exact_time log redacts phone and summarizes text, never logs either raw', async () => {
    const fixtureSlots = makePractitionerSlots(['09:00', '10:00', '14:00']);
    const { calls, restore } = captureConsole();
    try {
      await handleAwaitingTimeStep({
        ...baseTimeStepDeps(),
        text: RAW_TEXT_EXACT,
        stateJson: { availableSlots: fixtureSlots, lastShownSlots: fixtureSlots },
        extractNumericSelection: () => null,
        findSlotMatches: noPractitionerFragmentMatch,
      } as Parameters<typeof handleAwaitingTimeStep>[0]);
    } finally {
      restore();
    }
    assertNoRawLeak(calls, [RAW_PHONE, RAW_TEXT_EXACT]);
    const serialized = serialize(calls);
    assert.ok(serialized.includes(REDACTED_PHONE_SUFFIX), 'expected redacted phone suffix in logs');
    assert.ok(serialized.includes(`"length":${RAW_TEXT_EXACT.length}`), 'expected non-content text length metadata in logs');
  });

  section('Runtime logger-spy — location 4/6: time-request time_range (phone + text)');

  const RAW_TEXT_RANGE = '14:00 ile 16:00 arasında olur mu, hastam Mehmet Demir bu saatlerde müsait';

  await test('time-request time_range log redacts phone and summarizes text, never logs either raw', async () => {
    const fixtureSlots = makePractitionerSlots(['09:00', '10:00', '14:00', '15:00']);
    const { calls, restore } = captureConsole();
    try {
      await handleAwaitingTimeStep({
        ...baseTimeStepDeps(),
        text: RAW_TEXT_RANGE,
        stateJson: { availableSlots: fixtureSlots, lastShownSlots: fixtureSlots },
        extractNumericSelection: () => null,
        findSlotMatches: noPractitionerFragmentMatch,
      } as Parameters<typeof handleAwaitingTimeStep>[0]);
    } finally {
      restore();
    }
    assertNoRawLeak(calls, [RAW_PHONE, RAW_TEXT_RANGE]);
    const serialized = serialize(calls);
    assert.ok(serialized.includes(REDACTED_PHONE_SUFFIX), 'expected redacted phone suffix in logs');
    assert.ok(serialized.includes(`"length":${RAW_TEXT_RANGE.length}`), 'expected non-content text length metadata in logs');
  });

  section('Runtime logger-spy — location 5/6: time-request after_time (phone + text)');

  const RAW_TEXT_AFTER = '15ten sonra herhangi bir saat, hasta adı Fatma Kaya';

  await test('time-request after_time log redacts phone and summarizes text, never logs either raw', async () => {
    const fixtureSlots = makePractitionerSlots(['09:00', '10:00', '14:00', '16:00']);
    const { calls, restore } = captureConsole();
    try {
      await handleAwaitingTimeStep({
        ...baseTimeStepDeps(),
        text: RAW_TEXT_AFTER,
        stateJson: { availableSlots: fixtureSlots, lastShownSlots: fixtureSlots },
        extractNumericSelection: () => null,
        findSlotMatches: noPractitionerFragmentMatch,
      } as Parameters<typeof handleAwaitingTimeStep>[0]);
    } finally {
      restore();
    }
    assertNoRawLeak(calls, [RAW_PHONE, RAW_TEXT_AFTER]);
    const serialized = serialize(calls);
    assert.ok(serialized.includes(REDACTED_PHONE_SUFFIX), 'expected redacted phone suffix in logs');
    assert.ok(serialized.includes(`"length":${RAW_TEXT_AFTER.length}`), 'expected non-content text length metadata in logs');
  });

  section('Runtime logger-spy — location 6/6: time-request preference (phone + text)');

  const RAW_TEXT_PREFERENCE = 'sabah daha uygun olur, hastanın notu: geçen sefer geç kalmıştı';

  await test('time-request preference log redacts phone and summarizes text, never logs either raw', async () => {
    const fixtureSlots = makePractitionerSlots(['09:00', '10:00', '14:00', '15:00']);
    const { calls, restore } = captureConsole();
    try {
      await handleAwaitingTimeStep({
        ...baseTimeStepDeps(),
        text: RAW_TEXT_PREFERENCE,
        stateJson: { availableSlots: fixtureSlots, lastShownSlots: fixtureSlots },
        extractNumericSelection: () => null,
        findSlotMatches: noPractitionerFragmentMatch,
      } as Parameters<typeof handleAwaitingTimeStep>[0]);
    } finally {
      restore();
    }
    assertNoRawLeak(calls, [RAW_PHONE, RAW_TEXT_PREFERENCE]);
    const serialized = serialize(calls);
    assert.ok(serialized.includes(REDACTED_PHONE_SUFFIX), 'expected redacted phone suffix in logs');
    assert.ok(serialized.includes(`"length":${RAW_TEXT_PREFERENCE.length}`), 'expected non-content text length metadata in logs');
  });

  section('Static source scan — backstop against non-console.* regressions');

  await test('awaiting_service-selection log block redacts phone (source scan)', () => {
    assertBlockRedactsPhone(extractLogCallBlock('awaiting_service-selection'), 'awaiting_service-selection');
  });

  await test('awaiting_time-selection log block redacts phone (source scan)', () => {
    assertBlockRedactsPhone(extractLogCallBlock('awaiting_time-selection'), 'awaiting_time-selection');
  });

  await test("time-request exact_time log block redacts phone and summarizes text (source scan)", () => {
    const block = extractLogCallBlock("type: 'exact_time'");
    assertBlockRedactsPhone(block, 'time-request exact_time');
    assertBlockSummarizesText(block, 'time-request exact_time');
  });

  await test("time-request time_range log block redacts phone and summarizes text (source scan)", () => {
    const block = extractLogCallBlock("type: 'time_range'");
    assertBlockRedactsPhone(block, 'time-request time_range');
    assertBlockSummarizesText(block, 'time-request time_range');
  });

  await test("time-request after_time log block redacts phone and summarizes text (source scan)", () => {
    const block = extractLogCallBlock("type: 'after_time'");
    assertBlockRedactsPhone(block, 'time-request after_time');
    assertBlockSummarizesText(block, 'time-request after_time');
  });

  await test("time-request preference log block redacts phone and summarizes text (source scan)", () => {
    const block = extractLogCallBlock("type: 'preference'");
    assertBlockRedactsPhone(block, 'time-request preference');
    assertBlockSummarizesText(block, 'time-request preference');
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
