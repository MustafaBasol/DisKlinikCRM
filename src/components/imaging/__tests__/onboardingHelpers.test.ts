/**
 * onboardingHelpers.test.ts — pure logic for the Windows bridge web
 * onboarding wizard (PR 5/7): device eligibility, pairing status derivation,
 * countdown/polling.
 *
 * Run with: tsx src/components/imaging/__tests__/onboardingHelpers.test.ts
 * No external test framework — mirrors dicomHelpers.test.ts / server test style.
 */

import assert from 'node:assert/strict';

import {
  MAX_PAIRING_DEVICES,
  canStartOnboarding,
  computeCountdown,
  derivePairingDisplayStatus,
  filterEligibleDevices,
  formatCountdown,
  isPairingSuccessStatus,
  isValidDeviceSelection,
  shouldPollPairing,
  toPairingUiStatus,
} from '../onboardingHelpers';

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

async function main() {
  section('filterEligibleDevices()');

  await test('keeps only active + bridge-connection-type devices', () => {
    const devices = [
      { id: '1', isActive: true, connectionType: 'bridge' },
      { id: '2', isActive: false, connectionType: 'bridge' },
      { id: '3', isActive: true, connectionType: 'manual' },
      { id: '4', isActive: true, connectionType: 'bridge' },
    ];
    assert.deepEqual(filterEligibleDevices(devices).map(d => d.id), ['1', '4']);
  });

  await test('returns an empty array when no device qualifies', () => {
    assert.deepEqual(filterEligibleDevices([{ id: '1', isActive: false, connectionType: 'manual' }]), []);
  });

  section('isValidDeviceSelection()');

  await test('rejects an empty selection', () => {
    assert.equal(isValidDeviceSelection([]), false);
  });

  await test('accepts a single device', () => {
    assert.equal(isValidDeviceSelection(['device-1']), true);
  });

  await test(`accepts exactly ${MAX_PAIRING_DEVICES} devices`, () => {
    assert.equal(isValidDeviceSelection(Array.from({ length: MAX_PAIRING_DEVICES }, (_, i) => `d${i}`)), true);
  });

  await test(`rejects more than ${MAX_PAIRING_DEVICES} devices (matches backend cap)`, () => {
    assert.equal(isValidDeviceSelection(Array.from({ length: MAX_PAIRING_DEVICES + 1 }, (_, i) => `d${i}`)), false);
  });

  section('derivePairingDisplayStatus()');

  const now = Date.parse('2026-07-09T12:00:00.000Z');

  await test('pending + future expiresAt stays pending', () => {
    const status = derivePairingDisplayStatus({ status: 'pending', expiresAt: '2026-07-09T12:05:00.000Z' }, now);
    assert.equal(status, 'pending');
  });

  await test('pending + past expiresAt is shown as expired locally', () => {
    const status = derivePairingDisplayStatus({ status: 'pending', expiresAt: '2026-07-09T11:59:00.000Z' }, now);
    assert.equal(status, 'expired');
  });

  await test('terminal statuses (redeemed/used/cancelled/locked) pass through unchanged', () => {
    for (const s of ['redeemed', 'used', 'cancelled', 'locked'] as const) {
      assert.equal(derivePairingDisplayStatus({ status: s, expiresAt: '2026-07-09T13:00:00.000Z' }, now), s);
      // Even with a past expiresAt, a terminal status is never overwritten by "expired".
      assert.equal(derivePairingDisplayStatus({ status: s, expiresAt: '2026-07-09T00:00:00.000Z' }, now), s);
    }
  });

  section('isPairingSuccessStatus()');

  await test("backend 'redeemed' is a success status", () => {
    assert.equal(isPairingSuccessStatus('redeemed'), true);
  });

  await test("legacy/test 'used' is also treated as success", () => {
    assert.equal(isPairingSuccessStatus('used'), true);
  });

  await test('pending/expired/cancelled/locked are not success statuses', () => {
    for (const s of ['pending', 'expired', 'cancelled', 'locked']) {
      assert.equal(isPairingSuccessStatus(s), false);
    }
  });

  section('toPairingUiStatus()');

  await test("maps backend 'redeemed' to UI 'success'", () => {
    assert.equal(toPairingUiStatus({ status: 'redeemed', expiresAt: '2026-07-09T13:00:00.000Z' }, now), 'success');
  });

  await test("maps legacy 'used' to UI 'success'", () => {
    assert.equal(toPairingUiStatus({ status: 'used', expiresAt: '2026-07-09T13:00:00.000Z' }, now), 'success');
  });

  await test('pending/expired/cancelled/locked map to themselves', () => {
    assert.equal(toPairingUiStatus({ status: 'pending', expiresAt: '2026-07-09T12:05:00.000Z' }, now), 'pending');
    assert.equal(toPairingUiStatus({ status: 'pending', expiresAt: '2026-07-09T11:00:00.000Z' }, now), 'expired');
    assert.equal(toPairingUiStatus({ status: 'cancelled', expiresAt: '2026-07-09T13:00:00.000Z' }, now), 'cancelled');
    assert.equal(toPairingUiStatus({ status: 'locked', expiresAt: '2026-07-09T13:00:00.000Z' }, now), 'locked');
  });

  section('shouldPollPairing()');

  await test('polls only while pending and not yet expired', () => {
    assert.equal(shouldPollPairing({ status: 'pending', expiresAt: '2026-07-09T12:05:00.000Z' }, now), true);
    assert.equal(shouldPollPairing({ status: 'pending', expiresAt: '2026-07-09T11:00:00.000Z' }, now), false);
    assert.equal(shouldPollPairing({ status: 'redeemed', expiresAt: '2026-07-09T12:05:00.000Z' }, now), false);
    assert.equal(shouldPollPairing({ status: 'used', expiresAt: '2026-07-09T12:05:00.000Z' }, now), false);
    assert.equal(shouldPollPairing({ status: 'cancelled', expiresAt: '2026-07-09T12:05:00.000Z' }, now), false);
  });

  section('canStartOnboarding()');

  await test('rejects undefined/null/empty and the "all clinics" sentinel', () => {
    assert.equal(canStartOnboarding(undefined), false);
    assert.equal(canStartOnboarding(null), false);
    assert.equal(canStartOnboarding(''), false);
    assert.equal(canStartOnboarding('all'), false);
  });

  await test('accepts an explicit clinic id', () => {
    assert.equal(canStartOnboarding('clinic-123'), true);
  });

  section('computeCountdown() / formatCountdown()');

  await test('computes remaining minutes/seconds, rounding up to avoid a premature 0:00 flash', () => {
    const countdown = computeCountdown('2026-07-09T12:09:30.400Z', now);
    assert.equal(countdown.totalSeconds, 571);
    assert.equal(countdown.minutes, 9);
    assert.equal(countdown.seconds, 31);
    assert.equal(countdown.expired, false);
  });

  await test('never returns a negative countdown once expired', () => {
    const countdown = computeCountdown('2026-07-09T11:00:00.000Z', now);
    assert.equal(countdown.totalSeconds, 0);
    assert.equal(countdown.expired, true);
  });

  await test('formatCountdown pads seconds to two digits', () => {
    assert.equal(formatCountdown({ totalSeconds: 65, minutes: 1, seconds: 5, expired: false }), '1:05');
    assert.equal(formatCountdown({ totalSeconds: 600, minutes: 10, seconds: 0, expired: false }), '10:00');
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
