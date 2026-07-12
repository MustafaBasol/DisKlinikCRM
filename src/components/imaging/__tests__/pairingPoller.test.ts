/**
 * pairingPoller.test.ts — deterministic regression coverage for the bridge
 * pairing poll scheduler (PR 5/7 review fix).
 *
 * This targets the actual reported bug: the wizard's polling interval used
 * to be recreated every second by the countdown effect and could starve
 * before firing. That bug lives in interval *lifecycle* behavior, which the
 * pure `shouldPollPairing` helper test does not exercise (it only checks a
 * boolean predicate, never touches a timer). Here we drive createPairingPoller
 * with a fully virtual, manually-advanced clock — no real waiting, no DOM —
 * so the test is fast and deterministic.
 *
 * Run with: tsx src/components/imaging/__tests__/pairingPoller.test.ts
 */

import assert from 'node:assert/strict';
import { createPairingPoller } from '../pairingPoller';

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

/** Manual virtual-interval harness: no real timers, ticks fire only when we say so. */
function createFakeIntervalClock() {
  let nextId = 0;
  const timers = new Map<number, () => void>();
  return {
    setIntervalFn: (handler: () => void) => {
      const id = ++nextId;
      timers.set(id, handler);
      return id;
    },
    clearIntervalFn: (handle: unknown) => { timers.delete(handle as number); },
    /** Simulates one interval tick firing for every still-registered timer. */
    fireAll: () => { for (const cb of timers.values()) cb(); },
    activeCount: () => timers.size,
  };
}

// Flush microtasks so poll()'s Promise.resolve().then/.finally chain settles
// before assertions run.
const flush = () => Promise.resolve().then(() => Promise.resolve());

async function main() {
  section('createPairingPoller() — start() lifecycle');

  await test('start() polls immediately, before any interval tick fires', async () => {
    const clock = createFakeIntervalClock();
    let pollCount = 0;
    const poller = createPairingPoller({
      poll: () => { pollCount++; },
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });
    poller.start();
    await flush();
    assert.equal(pollCount, 1, 'expected exactly one immediate poll on start()');
  });

  await test(
    'repeated start() calls (simulating countdown re-renders every second) do not reset or duplicate the interval',
    async () => {
      const clock = createFakeIntervalClock();
      let pollCount = 0;
      const poller = createPairingPoller({
        poll: () => { pollCount++; },
        setIntervalFn: clock.setIntervalFn,
        clearIntervalFn: clock.clearIntervalFn,
      });

      poller.start();
      await flush();
      assert.equal(clock.activeCount(), 1, 'exactly one interval should be registered');
      assert.equal(pollCount, 1);

      // Simulate the buggy pattern: something (e.g. a 1s countdown tick)
      // calls start() again several times, as would happen if the polling
      // effect were still keyed off the countdown state.
      for (let i = 0; i < 5; i++) poller.start();
      await flush();

      assert.equal(clock.activeCount(), 1, 'start() must be idempotent — no duplicate intervals');
      assert.equal(pollCount, 1, 'redundant start() calls must not trigger extra polls');
    },
  );

  await test(
    'polling still fires on the ~4s cadence after repeated countdown-driven start() calls',
    async () => {
      const clock = createFakeIntervalClock();
      let pollCount = 0;
      const poller = createPairingPoller({
        poll: () => { pollCount++; },
        setIntervalFn: clock.setIntervalFn,
        clearIntervalFn: clock.clearIntervalFn,
      });

      poller.start();
      await flush();
      assert.equal(pollCount, 1);

      // Countdown ticks for 3 "seconds" — must NOT reset the interval or
      // prevent the next scheduled poll from ever running (the original bug).
      poller.start();
      poller.start();
      poller.start();

      clock.fireAll(); // simulated 4s boundary
      await flush();
      assert.equal(pollCount, 2, 'the scheduled poll must fire despite interleaved start() calls');

      clock.fireAll(); // next 4s boundary
      await flush();
      assert.equal(pollCount, 3);
    },
  );

  section('createPairingPoller() — overlap guard');

  await test('does not start a new poll while the previous one is still in flight', async () => {
    const clock = createFakeIntervalClock();
    let pollCount = 0;
    let resolvePending: (() => void) | null = null;
    const poller = createPairingPoller({
      poll: () => {
        pollCount++;
        return new Promise<void>(resolve => { resolvePending = resolve; });
      },
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });

    poller.start();
    await flush();
    assert.equal(pollCount, 1);

    clock.fireAll(); // fires while the first poll's promise is still pending
    await flush();
    assert.equal(pollCount, 1, 'overlapping tick must be skipped while a poll is in flight');

    resolvePending!();
    await flush();

    clock.fireAll();
    await flush();
    assert.equal(pollCount, 2, 'once the in-flight poll resolves, polling resumes');
  });

  section('createPairingPoller() — visibility handling');

  await test('skips polling while the tab is hidden', async () => {
    const clock = createFakeIntervalClock();
    let pollCount = 0;
    let hidden = true;
    const poller = createPairingPoller({
      poll: () => { pollCount++; },
      isHidden: () => hidden,
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });

    poller.start();
    await flush();
    assert.equal(pollCount, 0, 'no immediate poll while hidden');

    clock.fireAll();
    await flush();
    assert.equal(pollCount, 0, 'no tick poll while hidden');

    hidden = false;
    poller.resumeIfVisible();
    await flush();
    assert.equal(pollCount, 1, 'resumeIfVisible() polls immediately once visible again');
  });

  await test('resumeIfVisible() is a no-op when not running', async () => {
    const clock = createFakeIntervalClock();
    let pollCount = 0;
    const poller = createPairingPoller({
      poll: () => { pollCount++; },
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });
    poller.resumeIfVisible();
    await flush();
    assert.equal(pollCount, 0);
  });

  section('createPairingPoller() — stop()');

  await test('stop() clears the interval and prevents further polling', async () => {
    const clock = createFakeIntervalClock();
    let pollCount = 0;
    const poller = createPairingPoller({
      poll: () => { pollCount++; },
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });

    poller.start();
    await flush();
    assert.equal(clock.activeCount(), 1);

    poller.stop();
    assert.equal(clock.activeCount(), 0, 'interval must be cleared');
    assert.equal(poller.isRunning(), false);

    clock.fireAll(); // no-op: no timers left
    await flush();
    assert.equal(pollCount, 1, 'no poll after stop()');
  });

  await test('start() after stop() begins a fresh cycle (e.g. StrictMode remount)', async () => {
    const clock = createFakeIntervalClock();
    let pollCount = 0;
    const poller = createPairingPoller({
      poll: () => { pollCount++; },
      setIntervalFn: clock.setIntervalFn,
      clearIntervalFn: clock.clearIntervalFn,
    });

    poller.start();
    await flush();
    poller.stop();

    poller.start();
    await flush();
    assert.equal(clock.activeCount(), 1, 'exactly one interval after restart');
    assert.equal(pollCount, 2, 'restart triggers a fresh immediate poll');
  });

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
