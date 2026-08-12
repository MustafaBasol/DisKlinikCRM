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
 * F3-IMPL-004 adds coverage for a second gap in the SAME six log objects
 * (plus a seventh call site) — treatment/appointment PHI fields logged in the
 * clear right next to the already-redacted phone/text:
 *   7.  handleAwaitingServiceStep     — route-handler (awaiting_service-selection): matchedServiceName removed
 *   8.  handleAwaitingTimeStep        — route-handler (awaiting_time-selection): matchedPractitioner removed
 *   9.  handleAwaitingTimeStep        — time-request (exact_time): requestedTime removed
 *   10. handleAwaitingTimeStep        — time-request (time_range): requestedStartTime/requestedEndTime removed
 *   11. handleAwaitingTimeStep        — time-request (after_time): requestedTime removed
 *   12. handleAwaitingTimeStep        — time-request (preference): requestedTime removed
 *   13. handleAwaitingConfirmationStep — '[whatsapp-assistant] appointment-request-create': practitionerName removed
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
  handleAwaitingDateStep,
  handleAwaitingConfirmationStep,
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

/** Extracts the source text of the Nth (0-indexed) console.*(...) call by its
 * distinguishing literal (e.g. a handler/type string), from the console.*(
 * token through the matching closing paren of the object literal. Deliberately
 * generous (400 chars) so it comfortably spans every field in these small log
 * calls. */
function extractLogCallBlock(distinguishingLiteral: string, occurrence = 0): string {
  let searchFrom = 0;
  let literalIndex = -1;
  for (let i = 0; i <= occurrence; i++) {
    literalIndex = bookingFlowSource.indexOf(distinguishingLiteral, searchFrom);
    assert.ok(literalIndex >= 0, `expected to find occurrence ${i} of "${distinguishingLiteral}" in whatsappBookingFlow.ts`);
    searchFrom = literalIndex + distinguishingLiteral.length;
  }
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

/** F3-IMPL-004: guards against a treatment/appointment PHI field (name/time
 * literal) being re-introduced into a log call block as an object key,
 * regardless of what expression it's assigned. */
function assertBlockOmitsField(block: string, fieldName: string, label: string) {
  const fieldKeyPattern = new RegExp(`(^|[{,\\s])${fieldName}\\s*:`);
  assert.ok(!fieldKeyPattern.test(block), `${label}: found "${fieldName}:" field that should have been removed`);
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

  section('Runtime logger-spy — NEW location 7/13 (F3-IMPL-004): awaiting_service-selection route-handler (matchedServiceName removed)');

  const RAW_SELECTED_SERVICE_NAME = 'Kanal Tedavisi';

  await test('awaiting_service-selection log never logs the selected service name', async () => {
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
    assertNoRawLeak(calls, [RAW_SELECTED_SERVICE_NAME]);
    assert.ok(!serialize(calls).includes('"matchedServiceName"'), 'expected matchedServiceName field to be removed from logs');
  });

  section('Runtime logger-spy — NEW location 8/13 (F3-IMPL-004): awaiting_time-selection route-handler (matchedPractitioner removed)');

  const RAW_MATCHED_PRACTITIONER_NAME = 'Dr. Test';

  await test('awaiting_time-selection log never logs the matched practitioner name', async () => {
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
    assertNoRawLeak(calls, [RAW_MATCHED_PRACTITIONER_NAME]);
    assert.ok(!serialize(calls).includes('"matchedPractitioner"'), 'expected matchedPractitioner field to be removed from logs');
  });

  section('Runtime logger-spy — NEW location 9/13 (F3-IMPL-004): time-request exact_time (requestedTime removed)');

  const RAW_TIME_EXACT_NEW = '11:20';
  const NEW_FIXTURE_SLOTS = () => makePractitionerSlots(['08:00', '09:30']);

  await test('time-request exact_time log never logs the requested time literal', async () => {
    const fixtureSlots = NEW_FIXTURE_SLOTS();
    const { calls, restore } = captureConsole();
    try {
      await handleAwaitingTimeStep({
        ...baseTimeStepDeps(),
        text: `saat ${RAW_TIME_EXACT_NEW} gibi olsun lütfen`,
        stateJson: { availableSlots: fixtureSlots, lastShownSlots: fixtureSlots },
        extractNumericSelection: () => null,
        findSlotMatches: noPractitionerFragmentMatch,
      } as Parameters<typeof handleAwaitingTimeStep>[0]);
    } finally {
      restore();
    }
    assertNoRawLeak(calls, [RAW_TIME_EXACT_NEW]);
    assert.ok(!serialize(calls).includes('"requestedTime"'), 'expected requestedTime field to be removed from exact_time logs');
  });

  section('Runtime logger-spy — NEW location 10/13 (F3-IMPL-004): time-request time_range (requestedStartTime/requestedEndTime removed)');

  const RAW_TIME_RANGE_START_NEW = '11:20';
  const RAW_TIME_RANGE_END_NEW = '12:40';

  await test('time-request time_range log never logs the requested start/end time literals', async () => {
    const fixtureSlots = NEW_FIXTURE_SLOTS();
    const { calls, restore } = captureConsole();
    try {
      await handleAwaitingTimeStep({
        ...baseTimeStepDeps(),
        text: `${RAW_TIME_RANGE_START_NEW} ile ${RAW_TIME_RANGE_END_NEW} arasında olur mu`,
        stateJson: { availableSlots: fixtureSlots, lastShownSlots: fixtureSlots },
        extractNumericSelection: () => null,
        findSlotMatches: noPractitionerFragmentMatch,
      } as Parameters<typeof handleAwaitingTimeStep>[0]);
    } finally {
      restore();
    }
    assertNoRawLeak(calls, [RAW_TIME_RANGE_START_NEW, RAW_TIME_RANGE_END_NEW]);
    const serialized = serialize(calls);
    assert.ok(!serialized.includes('"requestedStartTime"'), 'expected requestedStartTime field to be removed from time_range logs');
    assert.ok(!serialized.includes('"requestedEndTime"'), 'expected requestedEndTime field to be removed from time_range logs');
  });

  section('Runtime logger-spy — NEW location 11/13 (F3-IMPL-004): time-request after_time (requestedTime removed)');

  const RAW_TIME_AFTER_NEW = '17:00';

  await test('time-request after_time log never logs the requested time literal', async () => {
    const fixtureSlots = NEW_FIXTURE_SLOTS();
    const { calls, restore } = captureConsole();
    try {
      await handleAwaitingTimeStep({
        ...baseTimeStepDeps(),
        text: '17ten sonra herhangi bir saat',
        stateJson: { availableSlots: fixtureSlots, lastShownSlots: fixtureSlots },
        extractNumericSelection: () => null,
        findSlotMatches: noPractitionerFragmentMatch,
      } as Parameters<typeof handleAwaitingTimeStep>[0]);
    } finally {
      restore();
    }
    assertNoRawLeak(calls, [RAW_TIME_AFTER_NEW]);
    assert.ok(!serialize(calls).includes('"requestedTime"'), 'expected requestedTime field to be removed from after_time logs');
  });

  section('Runtime logger-spy — NEW location 12/13 (F3-IMPL-004): time-request preference (requestedTime removed)');

  await test('time-request preference log never logs the requestedTime field (coarse enum, dropped for consistency)', async () => {
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
    assert.ok(!serialize(calls).includes('"requestedTime"'), 'expected requestedTime field to be removed from preference logs');
  });

  section('Runtime logger-spy — NEW location 13/13 (F3-IMPL-004): handleAwaitingConfirmationStep appointment-request-create (practitionerName removed)');

  const RAW_CONFIRM_PRACTITIONER_NAME = 'Dr. Ayşe Yılmaz';

  await test('appointment-request-create log never logs the practitioner full name, keeps practitionerId', async () => {
    const pendingSlot: SavedAvailableSlot = {
      practitionerId: 'pr-42',
      practitionerName: RAW_CONFIRM_PRACTITIONER_NAME,
      startTime: '2026-07-04T14:00:00.000Z',
      endTime: '2026-07-04T14:30:00.000Z',
      localStartTime: '14:00',
      localEndTime: '14:30',
    };
    const { calls, restore } = captureConsole();
    try {
      await handleAwaitingConfirmationStep({
        clinicId: 'clinic-1',
        phone: RAW_PHONE,
        text: 'evet',
        customerName: 'Test Hasta',
        state: {
          selectedAppointmentTypeId: 'svc-1',
          selectedAppointmentTypeName: 'Diş Beyazlatma',
          selectedPractitionerId: 'pr-42',
          selectedDate: '2026-07-04',
        },
        stateJson: {
          availableSlots: [pendingSlot],
          lastShownSlots: [pendingSlot],
          pendingConfirmationSlot: pendingSlot,
        },
        resetState: async () => {},
        upsertState: async () => {},
        createAppointment: async () => ({ appointmentType: { name: 'Diş Beyazlatma' } }),
      });
    } finally {
      restore();
    }
    assertNoRawLeak(calls, [RAW_CONFIRM_PRACTITIONER_NAME]);
    const serialized = serialize(calls);
    assert.ok(!serialized.includes('"practitionerName"'), 'expected practitionerName field to be removed from appointment-request-create logs');
    assert.ok(serialized.includes('"practitionerId":"pr-42"'), 'expected practitionerId to remain in appointment-request-create logs');
  });

  section('Runtime logger-spy — NEW location 14/16 (F3-IMPL-006): handleAwaitingDateStep availability-error (raw error → safeErrorFields)');

  const RAW_DB_ERROR_DETAIL = `connection refused for phone ${RAW_PHONE}, patient Ayşe Yılmaz`;

  await test('availability-error log (handleAwaitingDateStep) never logs the raw error message, logs errorName/errorCode instead', async () => {
    const throwingBuildAvailableSlots = async (): Promise<never> => {
      const err = new Error(RAW_DB_ERROR_DETAIL) as Error & { code?: string };
      err.code = 'P2025';
      throw err;
    };
    const { calls, restore } = captureConsole();
    try {
      await handleAwaitingDateStep({
        prisma: {} as any,
        clinicId: 'clinic-1',
        text: '2026-07-04',
        customerName: 'Test Hasta',
        state: {
          selectedAppointmentTypeId: 'svc-1',
          selectedAppointmentTypeName: 'Diş Beyazlatma',
          selectedPractitionerId: null,
          selectedDate: null,
        },
        stateJson: {},
        buildAvailableSlots: throwingBuildAvailableSlots as any,
        formatAvailabilityMessage: () => '',
        logAvailabilitySave: () => {},
        minutesToTime: (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
        upsertState: async () => {},
      });
    } finally {
      restore();
    }
    assertNoRawLeak(calls, [RAW_DB_ERROR_DETAIL, RAW_PHONE]);
    const serialized = serialize(calls);
    assert.ok(serialized.includes('"errorName":"Error"'), 'expected errorName to be logged');
    assert.ok(serialized.includes('"errorCode":"P2025"'), 'expected errorCode to be logged');
  });

  section('Runtime logger-spy — NEW location 16/16 (F3-IMPL-006): handleAwaitingConfirmationStep appointment-create-error (raw error → safeErrorFields)');

  const RAW_CREATE_ERROR_DETAIL = `duplicate appointment for phone ${RAW_PHONE}, name Fatma Kaya`;

  await test('appointment-create-error log never logs the raw error message, logs errorName/errorCode instead', async () => {
    const pendingSlot: SavedAvailableSlot = {
      practitionerId: 'pr-42',
      practitionerName: 'Dr. Ayşe Yılmaz',
      startTime: '2026-07-04T14:00:00.000Z',
      endTime: '2026-07-04T14:30:00.000Z',
      localStartTime: '14:00',
      localEndTime: '14:30',
    };
    const { calls, restore } = captureConsole();
    try {
      await handleAwaitingConfirmationStep({
        clinicId: 'clinic-1',
        phone: RAW_PHONE,
        text: 'evet',
        customerName: 'Test Hasta',
        state: {
          selectedAppointmentTypeId: 'svc-1',
          selectedAppointmentTypeName: 'Diş Beyazlatma',
          selectedPractitionerId: 'pr-42',
          selectedDate: '2026-07-04',
        },
        stateJson: {
          availableSlots: [pendingSlot],
          lastShownSlots: [pendingSlot],
          pendingConfirmationSlot: pendingSlot,
        },
        resetState: async () => {},
        upsertState: async () => {},
        createAppointment: async () => { throw new Error(RAW_CREATE_ERROR_DETAIL); },
      });
    } finally {
      restore();
    }
    assertNoRawLeak(calls, [RAW_CREATE_ERROR_DETAIL, RAW_PHONE]);
    const serialized = serialize(calls);
    assert.ok(serialized.includes('"errorName":"Error"'), 'expected errorName to be logged');
    assert.ok(serialized.includes('"errorCode":"UNKNOWN"'), 'expected errorCode to be logged');
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

  section('Static source scan — NEW (F3-IMPL-004): treatment/appointment PHI fields omitted');

  await test('awaiting_service-selection log block omits matchedServiceName (source scan)', () => {
    assertBlockOmitsField(extractLogCallBlock('awaiting_service-selection'), 'matchedServiceName', 'awaiting_service-selection');
  });

  await test('awaiting_time-selection log block omits matchedPractitioner (source scan)', () => {
    assertBlockOmitsField(extractLogCallBlock('awaiting_time-selection'), 'matchedPractitioner', 'awaiting_time-selection');
  });

  await test("time-request exact_time log block omits requestedTime (source scan)", () => {
    assertBlockOmitsField(extractLogCallBlock("type: 'exact_time'"), 'requestedTime', 'time-request exact_time');
  });

  await test("time-request time_range log block omits requestedStartTime/requestedEndTime (source scan)", () => {
    const block = extractLogCallBlock("type: 'time_range'");
    assertBlockOmitsField(block, 'requestedStartTime', 'time-request time_range');
    assertBlockOmitsField(block, 'requestedEndTime', 'time-request time_range');
  });

  await test("time-request after_time log block omits requestedTime (source scan)", () => {
    assertBlockOmitsField(extractLogCallBlock("type: 'after_time'"), 'requestedTime', 'time-request after_time');
  });

  await test("time-request preference log block omits requestedTime (source scan)", () => {
    assertBlockOmitsField(extractLogCallBlock("type: 'preference'"), 'requestedTime', 'time-request preference');
  });

  await test('appointment-request-create log block omits practitionerName, keeps practitionerId (source scan)', () => {
    const block = extractLogCallBlock('appointment-request-create');
    assertBlockOmitsField(block, 'practitionerName', 'appointment-request-create');
    assert.ok(/practitionerId\s*:\s*pendingSlot\.practitionerId/.test(block), 'appointment-request-create: expected practitionerId to remain');
  });

  section('Static source scan — NEW (F3-IMPL-006): raw error objects replaced with safeErrorFields');

  await test('availability-error log block (handleAwaitingDateStep, occurrence 1/2) uses safeErrorFields(error), not raw error', () => {
    const block = extractLogCallBlock('availability-error', 0);
    assert.ok(/safeErrorFields\(error\)/.test(block), 'expected safeErrorFields(error) call');
    assert.ok(!/availability-error',\s*error\)/.test(block), 'found raw "error" argument, expected it replaced by safeErrorFields(error)');
  });

  await test('availability-error log block (handleAwaitingTimeStep different-date branch, occurrence 2/2) uses safeErrorFields(error), not raw error', () => {
    const block = extractLogCallBlock('availability-error', 1);
    assert.ok(/safeErrorFields\(error\)/.test(block), 'expected safeErrorFields(error) call');
    assert.ok(!/availability-error',\s*error\)/.test(block), 'found raw "error" argument, expected it replaced by safeErrorFields(error)');
  });

  await test('appointment-create-error log block (source scan) uses safeErrorFields(error), never raw error.message', () => {
    const block = extractLogCallBlock('appointment-create-error');
    assert.ok(/safeErrorFields\(error\)/.test(block), 'expected safeErrorFields(error) call');
    assert.ok(!/errorMessage\s*:\s*error\.message/.test(block), 'found raw "errorMessage: error.message" field that should have been removed');
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
