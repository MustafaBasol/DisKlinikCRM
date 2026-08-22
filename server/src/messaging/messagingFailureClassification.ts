/**
 * messagingFailureClassification.ts — F5-3 one vocabulary for messaging failures.
 *
 * THE MEASURED GAP
 * ----------------
 * At the F5-3 baseline, every messaging provider collapses every failure into
 * one opaque string:
 *
 *     `Meta Graph API sendMessage failed with ${response.status}: ${errorText}`
 *
 * Two things are wrong with that, and they are different problems.
 *
 * **Operationally**, a 401 (credentials revoked — retrying cannot help and may
 * lock the account), a 429 (slow down, and there is a `Retry-After` header
 * saying by how much), a 503 (the provider is down) and a 400 (this specific
 * message is invalid) are indistinguishable. Nothing downstream can make a
 * different decision about them, so nothing does.
 *
 * **For KVKK**, `errorText` is the provider's raw response body. It is
 * concatenated into an error string that is returned up the stack and, on the
 * inbound side, persisted verbatim into `MessagingInboundEvent.errorMessage`
 * (`error.message.slice(0, 1000)`). A provider body can echo the recipient's
 * phone number or the message content, so an operational column can end up
 * holding communication content nobody decided to retain.
 *
 * This module fixes both at the source: classification produces a **stable
 * code** and nothing else. The provider body is read to make the decision and
 * then discarded — it is never returned, never stored, never logged.
 *
 * DELIBERATELY THE SAME SHAPE AS THE OUTBOX'S POLICY
 * --------------------------------------------------
 * F5-2's `outbox/outboxErrors.ts` defines the same categories for the same
 * reasons. The two are NOT shared here, because F5-3 is based on `origin/main`
 * and is not stacked on F5-2 (see the F5-3 evidence document, "Stacking"), and
 * duplicating a small pure function is a smaller cost than a hidden branch
 * dependency that would leave this PR with no CI at all. **Unifying them once
 * both merge is a recorded follow-up**, and the vocabularies are deliberately
 * identical so that unification is a deletion rather than a reconciliation.
 */

/** Why a messaging operation failed. Mirrors `OutboxErrorCategory` on purpose. */
export type MessagingFailureCategory =
  /** A blip: connection reset, DNS hiccup, momentary unavailability. */
  | 'TRANSIENT'
  /** Our own bound fired: the provider accepted the connection and never answered. */
  | 'TIMEOUT'
  /** 429. The provider asked us to slow down, possibly with a Retry-After. */
  | 'RATE_LIMIT'
  /** 5xx. The provider is down. */
  | 'PROVIDER_OUTAGE'
  /** 401/403. Credentials are missing, revoked or rejected. Retrying cannot fix it. */
  | 'AUTH_CONFIGURATION'
  /** The tenant has not configured this channel (no connection, incomplete credentials). */
  | 'TENANT_CONFIGURATION'
  /** 4xx other than 401/403/429. The provider rejected this request itself. */
  | 'PERMANENT_VALIDATION'
  /** The stored payload cannot be interpreted at all. */
  | 'POISON'
  /** Genuinely unclassified. Retryable, on the shortest budget. */
  | 'UNKNOWN';

export const MESSAGING_FAILURE_CATEGORIES: readonly MessagingFailureCategory[] = Object.freeze([
  'TRANSIENT',
  'TIMEOUT',
  'RATE_LIMIT',
  'PROVIDER_OUTAGE',
  'AUTH_CONFIGURATION',
  'TENANT_CONFIGURATION',
  'PERMANENT_VALIDATION',
  'POISON',
  'UNKNOWN',
] as const);

/**
 * The stable code persisted on `MessagingInboundEvent.lastErrorCode` and
 * surfaced in the DLQ view and the metrics. Never free text.
 */
export type MessagingFailureCode =
  | MessagingFailureCategory
  /** The event has no `connectionId`, so it cannot be routed to a tenant. */
  | 'MISSING_CONNECTION'
  /** The connection was deleted or deactivated after the event arrived. */
  | 'CONNECTION_INACTIVE'
  /** The stored `rawPayload` does not parse into a message this channel can re-deliver. */
  | 'UNPARSEABLE_PAYLOAD'
  /** `attempts` reached the ceiling. */
  | 'MAX_ATTEMPTS_EXCEEDED'
  /** The event fell outside the retry window before it could succeed. */
  | 'RETRY_WINDOW_EXPIRED'
  /**
   * This channel/provider has no automatic re-delivery handler, so nothing will
   * ever retry the event on its own. Terminal AND visible, rather than a `failed`
   * row that merely looks retryable forever.
   */
  | 'NO_RETRY_HANDLER'
  /** A processor left the row in `processing` and never came back. */
  | 'STUCK_IN_PROCESSING';

/** Categories the retry machinery will retry. Everything else is terminal. */
const RETRYABLE: ReadonlySet<MessagingFailureCategory> = Object.freeze(
  new Set<MessagingFailureCategory>([
    'TRANSIENT',
    'TIMEOUT',
    'RATE_LIMIT',
    'PROVIDER_OUTAGE',
    'UNKNOWN',
  ]),
) as ReadonlySet<MessagingFailureCategory>;

export function isRetryableMessagingCategory(category: MessagingFailureCategory): boolean {
  return RETRYABLE.has(category);
}

/** Codes that are terminal regardless of the attempt count. */
const TERMINAL_CODES: ReadonlySet<MessagingFailureCode> = Object.freeze(
  new Set<MessagingFailureCode>([
    'MISSING_CONNECTION',
    'CONNECTION_INACTIVE',
    'UNPARSEABLE_PAYLOAD',
    'MAX_ATTEMPTS_EXCEEDED',
    'RETRY_WINDOW_EXPIRED',
    'NO_RETRY_HANDLER',
    'AUTH_CONFIGURATION',
    'TENANT_CONFIGURATION',
    'PERMANENT_VALIDATION',
    'POISON',
  ]),
) as ReadonlySet<MessagingFailureCode>;

export function isTerminalMessagingCode(code: MessagingFailureCode): boolean {
  return TERMINAL_CODES.has(code);
}

export interface MessagingFailure {
  readonly category: MessagingFailureCategory;
  readonly code: MessagingFailureCode;
  /** Provider-requested delay in ms, parsed from `Retry-After`. Never invented. */
  readonly retryAfterMs?: number;
}

/**
 * The error a messaging provider throws (or a caller constructs) to state both
 * what went wrong and how it must be treated.
 *
 * `message` is a FIXED string chosen by us. The provider's own text is never
 * put here — that is the whole point.
 */
export class MessagingProviderError extends Error {
  readonly category: MessagingFailureCategory;
  readonly code: MessagingFailureCode;
  readonly retryAfterMs?: number;
  /** HTTP status, when there was one. A number is safe to keep and to log. */
  readonly httpStatus?: number;

  constructor(
    failure: MessagingFailure,
    options?: { httpStatus?: number; message?: string },
  ) {
    super(options?.message ?? `Messaging provider failure (${failure.code}).`);
    this.name = 'MessagingProviderError';
    this.category = failure.category;
    this.code = failure.code;
    this.retryAfterMs = failure.retryAfterMs;
    this.httpStatus = options?.httpStatus;
  }
}

/**
 * Classify an HTTP response from a messaging provider.
 *
 * Takes the STATUS and the HEADERS. It deliberately does not take the body:
 * a function that never receives the body cannot leak it, and status plus
 * `Retry-After` is everything the retry decision actually needs.
 */
export function classifyProviderHttpStatus(
  status: number,
  headers?: { get(name: string): string | null },
): MessagingFailure {
  if (status === 429) {
    return {
      category: 'RATE_LIMIT',
      code: 'RATE_LIMIT',
      ...(parseRetryAfterMs(headers?.get('retry-after')) !== undefined
        ? { retryAfterMs: parseRetryAfterMs(headers?.get('retry-after')) }
        : {}),
    };
  }
  if (status === 401 || status === 403) {
    return { category: 'AUTH_CONFIGURATION', code: 'AUTH_CONFIGURATION' };
  }
  if (status === 408) return { category: 'TIMEOUT', code: 'TIMEOUT' };
  if (status >= 500) return { category: 'PROVIDER_OUTAGE', code: 'PROVIDER_OUTAGE' };
  if (status >= 400) return { category: 'PERMANENT_VALIDATION', code: 'PERMANENT_VALIDATION' };
  return { category: 'UNKNOWN', code: 'UNKNOWN' };
}

/**
 * Classify a thrown error.
 *
 * Deliberately does NOT sniff message text. Message-based classification goes
 * wrong the moment a provider rewords itself, and it is also how PII ends up
 * influencing control flow. Anything unrecognised is `UNKNOWN` — retryable on
 * the shortest budget, which is the fail-safe direction.
 */
export function classifyMessagingError(err: unknown): MessagingFailure {
  if (err instanceof MessagingProviderError) {
    return {
      category: err.category,
      code: err.code,
      ...(err.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}),
    };
  }
  if ((err as { name?: unknown } | null)?.name === 'MessagingHttpTimeoutError') {
    return { category: 'TIMEOUT', code: 'TIMEOUT' };
  }
  // Node's undici surfaces connection-level failures as TypeError with a cause
  // carrying an errno-style code. The CODE is safe (ECONNREFUSED, ENOTFOUND);
  // the message is not, so only the code is inspected.
  const causeCode = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (typeof causeCode === 'string' && NETWORK_ERROR_CODES.has(causeCode)) {
    return { category: 'TRANSIENT', code: 'TRANSIENT' };
  }
  return { category: 'UNKNOWN', code: 'UNKNOWN' };
}

const NETWORK_ERROR_CODES: ReadonlySet<string> = Object.freeze(
  new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EPIPE',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_SOCKET',
  ]),
) as ReadonlySet<string>;

/**
 * Parse `Retry-After`, which is either delta-seconds or an HTTP date.
 *
 * Returns undefined for anything it cannot read, and clamps to a sane ceiling:
 * a provider is allowed to ask for more time than our policy would give, but a
 * malformed or hostile header must not be able to park an event for a week.
 */
const MAX_RETRY_AFTER_MS = 60 * 60 * 1000; // 1 hour

export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  now: Date = new Date(),
): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (trimmed.length === 0) return undefined;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }

  // A numeric-looking value that is NOT a non-negative integer is malformed —
  // and must be rejected BEFORE Date.parse, which reads "-5" as a year and
  // would silently turn a malformed header into "retry immediately".
  if (/^[+-]?\d*\.?\d+$/.test(trimmed)) return undefined;

  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return undefined;
  const deltaMs = asDate - now.getTime();
  if (deltaMs <= 0) return 0;
  return Math.min(deltaMs, MAX_RETRY_AFTER_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Backoff
// ─────────────────────────────────────────────────────────────────────────────

/** Base delay per category, in milliseconds. */
const BASE_BACKOFF_MS: Readonly<Record<MessagingFailureCategory, number>> = Object.freeze({
  TRANSIENT: 60_000,
  TIMEOUT: 60_000,
  RATE_LIMIT: 300_000,
  PROVIDER_OUTAGE: 180_000,
  UNKNOWN: 120_000,
  // Not retried. Present so the record is total and a future reclassification
  // cannot silently fall through to zero.
  AUTH_CONFIGURATION: 0,
  TENANT_CONFIGURATION: 0,
  PERMANENT_VALIDATION: 0,
  POISON: 0,
});

/** Never wait longer than this between attempts. */
export const MAX_MESSAGING_BACKOFF_MS = 60 * 60 * 1000; // 1 hour

/**
 * Exponential backoff with full jitter, floored by a provider `Retry-After` and
 * capped.
 *
 * FULL jitter (a uniform draw over [0, computed]) rather than a fixed
 * multiplier: the failures this backs off from are correlated — a provider
 * outage fails every event in the batch at once — so a deterministic delay
 * would bring the whole batch back simultaneously and re-create the burst.
 *
 * The pre-F5-3 behaviour was a FIXED five-minute floor with no growth and no
 * jitter, which is exactly the shape that produces a synchronised retry every
 * five minutes for as long as a provider is down.
 */
export function computeMessagingBackoffMs(
  category: MessagingFailureCategory,
  attempts: number,
  options?: { retryAfterMs?: number; random?: () => number },
): number {
  const base = BASE_BACKOFF_MS[category];
  const safeAttempt = Math.max(1, Math.floor(attempts));
  const growth = 2 ** Math.min(safeAttempt - 1, 16);
  const uncapped = Math.min(base * growth, MAX_MESSAGING_BACKOFF_MS);
  const rnd = options?.random ?? Math.random;
  const jittered = Math.floor(uncapped * rnd());
  const floor = Math.max(0, Math.floor(options?.retryAfterMs ?? 0));
  return Math.min(Math.max(jittered, floor), MAX_MESSAGING_BACKOFF_MS);
}
