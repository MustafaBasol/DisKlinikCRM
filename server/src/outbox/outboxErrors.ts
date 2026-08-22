/**
 * outboxErrors.ts — F5-2 failure classification and retry policy.
 *
 * WHY A CLOSED CLASSIFICATION AND NOT `catch (e) { retry() }`
 * ----------------------------------------------------------
 * A dispatcher that retries every failure the same way has two failure modes,
 * and both are worse than not retrying at all:
 *
 *   - It burns the whole retry budget on a permanently broken event (a payload
 *     that will never validate, a clinic whose WhatsApp credentials were
 *     revoked), so the row reaches dead-letter having produced nothing but load.
 *   - It hammers a provider that is already returning 429 or 503, turning an
 *     outage into a retry storm that prolongs the outage.
 *
 * F5-1P measured both directions: E12 proved a poison event must reach a
 * terminal state at attempt 1 WITHOUT consuming the retry budget, and
 * E-RETRY-STORM proved a bounded policy produces exactly attempts x events and
 * never spins.
 *
 * So every failure a consumer can raise is classified into ONE of the codes
 * below, and the classification — not the exception type, not a string match on
 * the message — decides whether the event is retried, when, and how many times.
 *
 * WHAT NEVER CROSSES THIS BOUNDARY
 * --------------------------------
 * Nothing here carries a provider response body, an exception message, a token
 * or any patient data. `OutboxErrorCode` is a fixed union of short codes and it
 * is the ONLY failure detail persisted on `OutboxEvent.lastErrorCode` /
 * `deadLetterCode` or emitted in a log line. That is a KVKK requirement
 * (F5-1P section 8), not a stylistic one: a dead-letter row is an operational
 * table an operator reads, and it must be diagnosable without exposing message
 * content.
 */

import { computeFullJitterBackoffMs } from '../utils/backoff.js';

/**
 * Why a dispatch attempt failed. CLOSED SET — a consumer that needs a new
 * category adds it here in a reviewable diff, which is also the moment someone
 * decides whether it is retryable.
 */
export type OutboxErrorCategory =
  /** A blip: connection reset, timeout, deadlock, momentary unavailability. Retry soon. */
  | 'TRANSIENT'
  /** The provider explicitly asked us to slow down (429). Retry, but back off hard. */
  | 'RATE_LIMIT'
  /** The provider is down (5xx, DNS failure, refused connection). Retry, back off hard. */
  | 'PROVIDER_OUTAGE'
  /** Credentials are missing/revoked/rejected. Retrying cannot fix it and may lock the account. */
  | 'AUTH_CONFIGURATION'
  /** The tenant has not configured this channel (no connection, feature off). Not our retry to make. */
  | 'TENANT_CONFIGURATION'
  /** The provider rejected the request itself (bad number, unknown template). Permanent. */
  | 'PERMANENT_VALIDATION'
  /** The event cannot even be interpreted: unregistered type/version, payload violates the contract. */
  | 'POISON'
  /** Genuinely unclassified. Retryable, but on the shortest budget — an unknown is not a licence to spin. */
  | 'UNKNOWN';

export const OUTBOX_ERROR_CATEGORIES: readonly OutboxErrorCategory[] = Object.freeze([
  'TRANSIENT',
  'RATE_LIMIT',
  'PROVIDER_OUTAGE',
  'AUTH_CONFIGURATION',
  'TENANT_CONFIGURATION',
  'PERMANENT_VALIDATION',
  'POISON',
  'UNKNOWN',
] as const);

/**
 * The stable codes persisted on the event row. Deliberately coarser than an
 * exception taxonomy and deliberately not free text.
 */
export type OutboxErrorCode =
  | OutboxErrorCategory
  /** The registry has no contract for this eventType at all. */
  | 'UNREGISTERED_EVENT'
  /** The registry has the type but not this version. */
  | 'UNSUPPORTED_VERSION'
  /** Payload failed the registered field allowlist or shape check. */
  | 'MALFORMED_PAYLOAD'
  /** No consumer is registered for this contract. */
  | 'NO_CONSUMER'
  /** attemptCount reached the contract's maximum. */
  | 'MAX_ATTEMPTS_EXCEEDED'
  /**
   * The idempotency ledger holds an EXPIRED `in_progress` marker: a previous
   * dispatcher committed "about to do it" and never came back. Whether the side
   * effect happened is genuinely unknowable from here.
   */
  | 'AMBIGUOUS_SIDE_EFFECT'
  /** The event's tenant no longer resolves (organization/clinic gone). */
  | 'TENANT_UNRESOLVABLE';

/** Categories the dispatcher will retry. Everything else is terminal on first sight. */
const RETRYABLE_CATEGORIES: ReadonlySet<OutboxErrorCategory> = Object.freeze(
  new Set<OutboxErrorCategory>(['TRANSIENT', 'RATE_LIMIT', 'PROVIDER_OUTAGE', 'UNKNOWN']),
) as ReadonlySet<OutboxErrorCategory>;

export function isRetryableCategory(category: OutboxErrorCategory): boolean {
  return RETRYABLE_CATEGORIES.has(category);
}

/**
 * Base backoff per category, in milliseconds. A rate-limited or down provider
 * gets materially more room than a transient blip, because the failure means
 * "there is nothing to retry INTO yet" rather than "try again".
 */
const BASE_BACKOFF_MS: Readonly<Record<OutboxErrorCategory, number>> = Object.freeze({
  TRANSIENT: 15_000,
  RATE_LIMIT: 120_000,
  PROVIDER_OUTAGE: 60_000,
  UNKNOWN: 30_000,
  // Not retried; present so the record is total and a future reclassification
  // cannot silently fall through to 0.
  AUTH_CONFIGURATION: 0,
  TENANT_CONFIGURATION: 0,
  PERMANENT_VALIDATION: 0,
  POISON: 0,
});

/** Never wait longer than this between attempts, however many have failed. */
export const MAX_BACKOFF_MS = 30 * 60 * 1000; // 30 minutes

/**
 * The error a consumer throws to state, in one place, both what went wrong and
 * how the dispatcher should treat it. A consumer that throws anything else is
 * classified `UNKNOWN` — retryable but on the shortest budget — which is the
 * fail-safe direction: an unclassified failure never becomes silently permanent.
 */
export class OutboxConsumerError extends Error {
  readonly category: OutboxErrorCategory;
  readonly code: OutboxErrorCode;
  /**
   * Optional provider-supplied delay (a `Retry-After`), in milliseconds.
   * Honoured as a FLOOR on the computed backoff, never as a ceiling — a
   * provider may ask for more time than our policy would give, never less.
   */
  readonly retryAfterMs?: number;

  constructor(
    category: OutboxErrorCategory,
    message: string,
    options?: { code?: OutboxErrorCode; retryAfterMs?: number; cause?: unknown },
  ) {
    // `cause` is carried for a local stack trace only. NOTHING reads it back
    // out into a log line or a persisted column — `safeErrorFields` sees this
    // error, not the cause, so a provider body attached here can never reach
    // the dead-letter row.
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'OutboxConsumerError';
    this.category = category;
    this.code = options?.code ?? category;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

/**
 * Classify whatever a consumer threw.
 *
 * Deliberately does NOT sniff error messages. Message-based classification is
 * the classic way a retry policy becomes wrong after a provider changes its
 * wording, and it is also how PII ends up influencing control flow. A consumer
 * that wants a specific category says so with `OutboxConsumerError`.
 */
export function classifyConsumerFailure(err: unknown): {
  category: OutboxErrorCategory;
  code: OutboxErrorCode;
  retryAfterMs?: number;
} {
  if (err instanceof OutboxConsumerError) {
    return { category: err.category, code: err.code, retryAfterMs: err.retryAfterMs };
  }
  return { category: 'UNKNOWN', code: 'UNKNOWN' };
}

/**
 * Exponential backoff with full jitter, floored by any provider-requested delay
 * and capped at MAX_BACKOFF_MS.
 *
 * FULL jitter (a uniform draw over [0, computed]) rather than a fixed
 * multiplier: N events that failed together against the same provider must not
 * all come back at the same instant and re-create the burst that failed. The
 * `random` seam exists so tests can pin the value; production never passes it.
 */
export function computeBackoffMs(
  category: OutboxErrorCategory,
  attemptCount: number,
  options?: { retryAfterMs?: number; random?: () => number },
): number {
  return computeFullJitterBackoffMs({
    baseMs: BASE_BACKOFF_MS[category],
    attempt: attemptCount,
    maxMs: MAX_BACKOFF_MS,
    ...(options?.retryAfterMs !== undefined ? { retryAfterMs: options.retryAfterMs } : {}),
    ...(options?.random !== undefined ? { random: options.random } : {}),
  });
}
