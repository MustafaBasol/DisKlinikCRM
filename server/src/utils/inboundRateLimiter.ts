/**
 * inboundRateLimiter.ts — Rate limiter for inbound AI message processing.
 *
 * Keyed by:  channel + connectionId + sender (phone or fromExternalId)
 * Limit:     8 messages per 60 seconds
 *
 * Sayaçlar paylaşımlı store'da tutulur (REDIS_URL varsa Redis, yoksa süreç-içi
 * bellek — bkz. utils/counterStore.ts). Redis ile birden fazla replika aynı
 * limitleri paylaşır (docs/45 Faz 3 #9).
 */

import { createCounterStore } from './counterStore.js';

const WINDOW_MS = 60_000; // 60 seconds
const MAX_MESSAGES = 8;

const store = createCounterStore('inbound-ai');

/**
 * Build a composite rate-limit key.
 * Never uses sender alone — always scoped to channel + connection.
 */
function buildKey(channel: string, connectionId: string, sender: string): string {
  return `${channel}:${connectionId}:${sender}`;
}

/**
 * Check whether the given sender is within the allowed rate.
 * Increments the counter for each call.
 *
 * @returns true if the message should be processed, false if rate-limited.
 */
export async function checkInboundRateLimit(
  channel: string,
  connectionId: string,
  sender: string,
): Promise<boolean> {
  const key = buildKey(channel, connectionId, sender);
  const count = await store.increment(key, WINDOW_MS);

  if (count > MAX_MESSAGES) {
    console.warn('[rate-limiter] inbound AI message rate-limited', {
      channel,
      connectionId,
      sender,
      count,
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
 * Reset the store — for unit tests only (in-memory backend).
 */
export function _resetRateLimitStore(): void {
  store.clear();
}
