// pairingPoller.ts — framework-independent interval scheduler for the bridge
// pairing wizard. Deliberately has zero React dependency so its lifecycle
// (start/stop/overlap-guard/visibility-pause) can be unit tested with a fake
// clock instead of a DOM/React test harness.
//
// Root cause this exists to prevent: an earlier version drove the poll
// interval from a `useEffect` that depended on the 1s countdown state, so the
// interval was destroyed and recreated every second and could starve before
// ever firing. `start()` here is idempotent — calling it again while already
// running (e.g. from a re-render) is a no-op, so the poll cadence can never
// be reset by unrelated renders.

export interface PairingPoller {
  /** Idempotent: safe to call on every render, only the first call has an effect. */
  start(): void;
  stop(): void;
  /** Call from a visibilitychange handler; polls immediately if running and visible. */
  resumeIfVisible(): void;
  isRunning(): boolean;
}

export interface PairingPollerOptions {
  poll: () => void | Promise<void>;
  intervalMs?: number;
  isHidden?: () => boolean;
  setIntervalFn?: (handler: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}

const defaultIsHidden = () => typeof document !== 'undefined' && document.hidden === true;

export function createPairingPoller(options: PairingPollerOptions): PairingPoller {
  const intervalMs = options.intervalMs ?? 4000;
  const isHidden = options.isHidden ?? defaultIsHidden;
  const setIntervalFn = options.setIntervalFn ?? ((h, ms) => setInterval(h, ms));
  const clearIntervalFn = options.clearIntervalFn ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));

  let timerHandle: unknown = null;
  let inFlight = false;
  let running = false;

  const runOnce = () => {
    if (inFlight || isHidden()) return;
    inFlight = true;
    Promise.resolve(options.poll())
      .catch(() => {})
      .finally(() => { inFlight = false; });
  };

  const start = () => {
    if (running) return;
    running = true;
    runOnce();
    timerHandle = setIntervalFn(runOnce, intervalMs);
  };

  const stop = () => {
    running = false;
    if (timerHandle !== null) {
      clearIntervalFn(timerHandle);
      timerHandle = null;
    }
  };

  const resumeIfVisible = () => {
    if (running && !isHidden()) runOnce();
  };

  return { start, stop, resumeIfVisible, isRunning: () => running };
}
