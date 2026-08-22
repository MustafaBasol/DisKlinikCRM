/**
 * messagingHttp.ts — F5-3 bounded outbound HTTP for messaging providers.
 *
 * THE MEASURED GAP
 * ----------------
 * At the F5-3 baseline, **none** of the repository's 16 outbound `fetch` call
 * sites carries a timeout — including every WhatsApp and Instagram send. Node's
 * `fetch` has no default timeout, so a provider that accepts a connection and
 * then never answers blocks the caller **forever**.
 *
 * That is not a theoretical tidiness point, because of where those calls sit:
 *
 *   - inside `jobs/reminders.ts`, which runs under a `withJobLock` lease. A
 *     hung send holds the lease until it expires, and every OTHER clinic's
 *     reminders for that tick are behind it.
 *   - inside webhook processing, where a hung outbound reply keeps a request
 *     handler and its database connection alive indefinitely.
 *
 * A provider outage therefore does not degrade one clinic's messaging; it
 * stalls the tick.
 *
 * WHY NOT `AbortSignal.timeout()`
 * -------------------------------
 * It looks like exactly the right tool and it is a trap here. The timer behind
 * `AbortSignal.timeout()` is **unref'd**: it does not hold the event loop open.
 * In a short-lived process — a cron worker tick, a script, a test — the loop can
 * therefore drain while a `fetch` is still outstanding, leaving a promise that
 * will never settle AND no handle keeping the process alive to settle it. The
 * failure mode is a job that silently ends mid-send rather than a clean timeout.
 *
 * So the timeout is bound at the caller with an ordinary, **ref'd**
 * `setTimeout` driving an `AbortController`, and the timer is always cleared in
 * a `finally`.
 *
 * WHAT THIS MODULE DOES NOT DO
 * ----------------------------
 * It does not retry, does not classify (see `messagingFailureClassification.ts`)
 * and does not know what a message is. It bounds one HTTP call and reports
 * whether the bound was hit.
 */

/** Default ceiling for a provider send. Deliberately shorter than any job lease. */
export const DEFAULT_MESSAGING_HTTP_TIMEOUT_MS = 15_000;

export function getMessagingHttpTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.MESSAGING_HTTP_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MESSAGING_HTTP_TIMEOUT_MS;
}

/**
 * Thrown when the caller-side bound fires. Distinct from a network error so
 * classification can tell "the provider never answered" apart from "the
 * provider refused the connection" — they are the same category today, but
 * conflating them at the source would make that permanent.
 */
export class MessagingHttpTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Messaging provider request exceeded ${timeoutMs}ms and was aborted.`);
    this.name = 'MessagingHttpTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * `fetch` with a hard, caller-side, ref'd timeout.
 *
 * Composes with a caller-supplied `signal` rather than replacing it: a caller
 * that already has its own cancellation (a shutdown signal) keeps it, and
 * whichever fires first wins.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  options: { timeoutMs?: number } = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? getMessagingHttpTimeoutMs();
  const controller = new AbortController();

  // Ordinary setTimeout — NOT AbortSignal.timeout. See the module docstring.
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const callerSignal = init.signal;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    // Distinguish "we aborted it because time ran out" from "the caller
    // cancelled" and from a genuine network error. `AbortError` alone cannot
    // tell them apart, which is why the decision is made here, where the
    // reason is known, rather than guessed later from the error name.
    if (isAbortError(err) && !callerSignal?.aborted) {
      throw new MessagingHttpTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

function isAbortError(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'AbortError';
}
