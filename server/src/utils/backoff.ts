/**
 * backoff.ts — the exponential full-jitter retry delay, in one place.
 *
 * WHY THIS IS SHARED AND THE CLASSIFICATIONS AROUND IT ARE NOT
 * ------------------------------------------------------------
 * F5-2 (`outbox/outboxErrors.ts`) and F5-3
 * (`messaging/messagingFailureClassification.ts`) each grew a retry policy, and
 * the two were written against different baselines. Once both landed it was
 * worth asking what, precisely, was duplicated. The answer was narrower than it
 * looked: the *arithmetic* was identical line for line, and everything around
 * it was not.
 *
 * What was identical, and therefore lives here:
 *
 *   - exponential growth capped before the multiply, so a large attempt count
 *     cannot overflow to Infinity;
 *   - FULL jitter — a uniform draw over [0, computed] rather than a fixed
 *     multiplier — because the failures a backoff exists for are correlated. A
 *     provider outage fails every item in the batch at the same instant, and a
 *     deterministic delay brings the whole batch back at the same instant and
 *     re-creates the burst that failed;
 *   - a provider-requested delay honoured as a FLOOR, never a ceiling: a
 *     provider may ask for more time than our policy would give, never less;
 *   - a hard ceiling applied last, so neither the growth nor the floor can
 *     park an item indefinitely.
 *
 * What is NOT here, and deliberately so: the failure categories, which
 * categories are retryable, the per-category base delay, the ceiling itself,
 * and the persisted error codes. Those read as similar and are not. Messaging
 * has a `TIMEOUT` category the outbox has no way to raise — the dispatcher runs
 * in-process, so there is no socket to time out. Messaging's base delays are
 * four to five times the outbox's in every retryable category, because an
 * inbound provider redelivery is a far slower loop than an in-process dispatch.
 * The ceilings differ (30 minutes vs 1 hour). The two persisted code unions
 * share exactly one member out of seven each. Hoisting any of that would hand
 * each domain vocabulary it can never emit, which is the cross-domain coupling
 * both lanes exist to avoid.
 *
 * This module imports nothing. It has no knowledge of the outbox, of messaging,
 * of Prisma or of a tenant, which is the property that makes it safe for both
 * to depend on and keeps the dependency acyclic.
 */

/**
 * Exponential backoff with full jitter, floored by a provider-requested delay
 * and capped at `maxMs`.
 *
 * @param baseMs       Delay for attempt 1 before jitter. The caller supplies it
 *                     from its own per-category table.
 * @param attempt      1-based attempt number. Values below 1, fractional values
 *                     and NaN-adjacent input are clamped to 1 rather than
 *                     producing a negative or fractional exponent.
 * @param maxMs        Hard ceiling, applied both to the grown value and to the
 *                     final result.
 * @param retryAfterMs Optional provider-requested delay, honoured as a floor.
 * @param random       Seam for tests to pin the jitter draw. Production never
 *                     passes it and gets `Math.random`.
 */
export function computeFullJitterBackoffMs(params: {
  baseMs: number;
  attempt: number;
  maxMs: number;
  retryAfterMs?: number;
  random?: () => number;
}): number {
  const { baseMs, attempt, maxMs } = params;
  const safeAttempt = Math.max(1, Math.floor(attempt));
  // Cap the exponent BEFORE multiplying: a large attempt count would otherwise
  // overflow into Infinity, and Infinity * 0 (a zero-base terminal category) is
  // NaN, which would silently become a negative-looking delay downstream.
  const growth = 2 ** Math.min(safeAttempt - 1, 16);
  const uncapped = Math.min(baseMs * growth, maxMs);
  const rnd = params.random ?? Math.random;
  const jittered = Math.floor(uncapped * rnd());
  const floor = Math.max(0, Math.floor(params.retryAfterMs ?? 0));
  return Math.min(Math.max(jittered, floor), maxMs);
}
