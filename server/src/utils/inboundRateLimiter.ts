/**
 * inboundRateLimiter.ts — Simple in-memory rate limiter for inbound AI message processing.
 *
 * Keyed by:  channel + connectionId + sender (phone or fromExternalId)
 * Limit:     8 messages per 60 seconds
 *
 * WARNING: This store is per-process only. For multi-instance / horizontally-scaled
 * deployments, replace the in-memory Map with a Redis-backed counter (e.g. INCR +
 * EXPIRE or a sliding-window Lua script). TODO: Add Redis rate limiting when deploying
 * to multi-instance infrastructure.
 */

const WINDOW_MS = 60_000; // 60 seconds
const MAX_MESSAGES = 8;

type BucketKey = string;

interface Bucket {
  count: number;
  windowStart: number;
}

const store = new Map<BucketKey, Bucket>();

/**
 * Build a composite rate-limit key.
 * Never uses sender alone — always scoped to channel + connection.
 */
function buildKey(channel: string, connectionId: string, sender: string): BucketKey {
  return `${channel}:${connectionId}:${sender}`;
}

/**
 * Check whether the given sender is within the allowed rate.
 * Increments the counter for each call.
 *
 * @returns true if the message should be processed, false if rate-limited.
 */
export function checkInboundRateLimit(
  channel: string,
  connectionId: string,
  sender: string,
): boolean {
  const key = buildKey(channel, connectionId, sender);
  const now = Date.now();

  let bucket = store.get(key);

  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    // New window
    bucket = { count: 1, windowStart: now };
    store.set(key, bucket);
    return true;
  }

  bucket.count += 1;

  if (bucket.count > MAX_MESSAGES) {
    console.warn('[rate-limiter] inbound AI message rate-limited', {
      channel,
      connectionId,
      sender,
      count: bucket.count,
      windowStart: new Date(bucket.windowStart).toISOString(),
    });
    return false;
  }

  return true;
}

/**
 * Expose constants for tests.
 */
export const RATE_LIMIT_WINDOW_MS = WINDOW_MS;
export const RATE_LIMIT_MAX_MESSAGES = MAX_MESSAGES;

/**
 * Reset the store — for unit tests only.
 */
export function _resetRateLimitStore(): void {
  store.clear();
}
