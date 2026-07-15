/**
 * bookingWidgetHelpers.test.ts — pure logic for the public BookingWidget's
 * real-slot fetching and SLOT_UNAVAILABLE (409) recovery flow.
 *
 * Run with: tsx src/pages/__tests__/bookingWidgetHelpers.test.ts
 * No external test framework — mirrors the style of
 * src/components/imaging/__tests__/onboardingHelpers.test.ts. There is no
 * React Testing Library / DOM test runner in this repo, so the recovery
 * behavior (preserve form data, return to step 1, clear only the rejected
 * slot, refetch) is verified at the level of these extracted pure functions,
 * which is exactly what BookingWidget.tsx's handleSubmit catch block calls.
 */

import assert from 'node:assert/strict';

import {
  normalizePublicSlots,
  selectableTimesForDoctor,
  removeStaleSlot,
  isSlotUnavailableError,
  type PublicSlot,
} from '../bookingWidgetHelpers';

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

const SLOT_A_9 = { practitionerId: 'doc-a', startTime: '2026-07-20T09:00:00.000Z', endTime: '2026-07-20T09:30:00.000Z', localStartTime: '09:00', localEndTime: '09:30' };
const SLOT_A_10 = { practitionerId: 'doc-a', startTime: '2026-07-20T10:00:00.000Z', endTime: '2026-07-20T10:30:00.000Z', localStartTime: '10:00', localEndTime: '10:30' };
const SLOT_B_9 = { practitionerId: 'doc-b', startTime: '2026-07-20T09:00:00.000Z', endTime: '2026-07-20T09:30:00.000Z', localStartTime: '09:00', localEndTime: '09:30' };

async function main() {
  section('── normalizePublicSlots ──────────────────────────────────────────');

  await test('parses a well-formed { data: { slots: [...] } } axios response', () => {
    const slots = normalizePublicSlots({ data: { slots: [SLOT_A_9, SLOT_A_10] } });
    assert.equal(slots.length, 2);
    assert.equal(slots[0].localStartTime, '09:00');
  });

  await test('parses a bare { slots: [...] } body (no axios wrapper)', () => {
    const slots = normalizePublicSlots({ slots: [SLOT_A_9] });
    assert.equal(slots.length, 1);
  });

  await test('drops malformed entries missing required fields', () => {
    const slots = normalizePublicSlots({ slots: [SLOT_A_9, { practitionerId: 'doc-a' }, null, 'garbage'] });
    assert.equal(slots.length, 1);
  });

  await test('missing/invalid payload → empty array (never throws)', () => {
    assert.deepEqual(normalizePublicSlots(undefined), []);
    assert.deepEqual(normalizePublicSlots(null), []);
    assert.deepEqual(normalizePublicSlots({}), []);
    assert.deepEqual(normalizePublicSlots('not an object'), []);
  });

  section('── selectableTimesForDoctor ──────────────────────────────────────');

  await test('empty doctorId ("any doctor") returns all practitioners\' times, deduplicated', () => {
    const times = selectableTimesForDoctor([SLOT_A_9, SLOT_B_9, SLOT_A_10], '');
    assert.equal(times.length, 2, 'only 2 distinct localStartTime values (09:00, 10:00)');
    assert.deepEqual(times.map((t) => t.localStartTime), ['09:00', '10:00']);
  });

  await test('specific doctorId filters to only that practitioner\'s slots', () => {
    const times = selectableTimesForDoctor([SLOT_A_9, SLOT_B_9, SLOT_A_10], 'doc-b');
    assert.equal(times.length, 1);
    assert.equal(times[0].practitionerId, 'doc-b');
  });

  await test('results are sorted chronologically by localStartTime', () => {
    const times = selectableTimesForDoctor([SLOT_A_10, SLOT_A_9], 'doc-a');
    assert.deepEqual(times.map((t) => t.localStartTime), ['09:00', '10:00']);
  });

  await test('no slots for the filtered doctor → empty list (renders the "no times" empty state)', () => {
    const times = selectableTimesForDoctor([SLOT_A_9], 'doc-nonexistent');
    assert.equal(times.length, 0);
  });

  section('── removeStaleSlot (409 recovery: clear only the rejected slot) ──');

  await test('removes exactly the rejected (practitionerId, localStartTime) pair', () => {
    const remaining = removeStaleSlot([SLOT_A_9, SLOT_A_10, SLOT_B_9], { practitionerId: 'doc-a', localStartTime: '09:00' });
    assert.equal(remaining.length, 2);
    assert.ok(!remaining.some((s) => s.practitionerId === 'doc-a' && s.localStartTime === '09:00'));
  });

  await test('other times for the SAME practitioner are preserved', () => {
    const remaining = removeStaleSlot([SLOT_A_9, SLOT_A_10], { practitionerId: 'doc-a', localStartTime: '09:00' });
    assert.ok(remaining.some((s) => s.practitionerId === 'doc-a' && s.localStartTime === '10:00'), 'doc-a 10:00 must remain');
  });

  await test('the SAME time for a DIFFERENT practitioner is preserved (not accidentally hidden)', () => {
    const remaining = removeStaleSlot([SLOT_A_9, SLOT_B_9], { practitionerId: 'doc-a', localStartTime: '09:00' });
    assert.ok(remaining.some((s) => s.practitionerId === 'doc-b' && s.localStartTime === '09:00'), 'doc-b 09:00 must remain');
  });

  await test('rejecting a slot not present in the list is a no-op', () => {
    const remaining = removeStaleSlot([SLOT_A_9] as PublicSlot[], { practitionerId: 'doc-z', localStartTime: '11:00' });
    assert.equal(remaining.length, 1);
  });

  section('── isSlotUnavailableError (409 SLOT_UNAVAILABLE detection) ──────');

  await test('matches the exact 409 + code=SLOT_UNAVAILABLE shape', () => {
    const err = { response: { status: 409, data: { error: 'x', code: 'SLOT_UNAVAILABLE' } } };
    assert.equal(isSlotUnavailableError(err), true);
  });

  await test('does NOT match a 409 with a different code (e.g. INVALID_NOTICE_EVIDENCE)', () => {
    const err = { response: { status: 409, data: { error: 'x', code: 'INVALID_NOTICE_EVIDENCE' } } };
    assert.equal(isSlotUnavailableError(err), false, 'must not trigger slot recovery for the evidence-expired case');
  });

  await test('does NOT match a non-409 status even with a matching code', () => {
    const err = { response: { status: 400, data: { code: 'SLOT_UNAVAILABLE' } } };
    assert.equal(isSlotUnavailableError(err), false);
  });

  await test('does NOT match network errors / missing response (generic submitFailed path)', () => {
    assert.equal(isSlotUnavailableError(new Error('Network Error')), false);
    assert.equal(isSlotUnavailableError({}), false);
    assert.equal(isSlotUnavailableError(undefined), false);
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
