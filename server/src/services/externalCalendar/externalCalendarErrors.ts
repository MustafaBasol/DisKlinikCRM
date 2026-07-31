/**
 * externalCalendarErrors.ts — typed error hierarchy for the external calendar
 * integration framework.
 *
 * Follows the codebase convention (see clinicBulkExportPackage.ts): no shared
 * generic AppError base class exists in this repo, so each domain defines its
 * own plain-Error subclasses and route handlers branch on `instanceof`.
 */

/** Base class for all external-calendar-domain errors. Never thrown directly. */
export class ExternalCalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** No ExternalCalendarIntegration row exists yet for this clinic. */
export class ExternalCalendarNotConfiguredError extends ExternalCalendarError {
  constructor(clinicId: string) {
    super(`No external calendar integration configured for clinic ${clinicId}`);
  }
}

/** Integration exists but is administratively disabled. */
export class ExternalCalendarDisabledError extends ExternalCalendarError {
  constructor(clinicId: string) {
    super(`External calendar integration is disabled for clinic ${clinicId}`);
  }
}

/**
 * A practitioner or service has no active mapping to the provider's doctor /
 * treatment type. This must block synchronization — never silently skip or
 * guess by name.
 */
export class ExternalCalendarMappingMissingError extends ExternalCalendarError {
  readonly mappingType: 'practitioner' | 'service';
  readonly localId: string;

  constructor(mappingType: 'practitioner' | 'service', localId: string) {
    super(
      `No active ${mappingType} mapping found for ${localId}. An administrator must configure this mapping before synchronization can proceed.`,
    );
    this.mappingType = mappingType;
    this.localId = localId;
  }
}

/** The provider rejected our credentials (expired/revoked/invalid). */
export class ExternalCalendarAuthError extends ExternalCalendarError {
  constructor(provider: string, detail?: string) {
    super(`${provider} authentication failed${detail ? `: ${detail}` : ''}`);
  }
}

/** The provider is rate-limiting us. */
export class ExternalCalendarRateLimitedError extends ExternalCalendarError {
  readonly retryAfterMs: number | null;

  constructor(provider: string, retryAfterMs: number | null = null) {
    super(`${provider} rate limit exceeded`);
    this.retryAfterMs = retryAfterMs;
  }
}

/** The provider returned a transient/server-side error — safe to retry. */
export class ExternalCalendarTransientError extends ExternalCalendarError {
  readonly status: number | null;

  constructor(provider: string, status: number | null, detail?: string) {
    super(`${provider} request failed transiently${status ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}`);
    this.status = status;
  }
}

/** The provider rejected the request as invalid — not safe to retry as-is. */
export class ExternalCalendarValidationError extends ExternalCalendarError {
  readonly status: number | null;
  readonly code: string | null;

  constructor(provider: string, status: number | null, detail?: string, code: string | null = null) {
    super(`${provider} rejected the request${status ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}`);
    this.status = status;
    this.code = code;
  }
}

/**
 * The provider reports a genuine conflict with current state — e.g. HTTP 409
 * `SLOT_NOT_AVAILABLE` (the requested time slot is already booked) or
 * `SLOT_IN_PAST` (vendor doc §8, "HTTP Status Codes"). Distinct from
 * ExternalCalendarValidationError because the request itself was well-formed;
 * retrying with the *same* slot will fail again, but the caller may
 * legitimately want to re-query availability and retry with a different one.
 */
export class ExternalCalendarConflictError extends ExternalCalendarError {
  readonly code: string | null;

  constructor(provider: string, code: string | null, detail?: string) {
    super(`${provider} reported a conflict${code ? ` (${code})` : ''}${detail ? `: ${detail}` : ''}`);
    this.code = code;
  }
}

/** The inbound webhook signature did not match. */
export class ExternalCalendarWebhookSignatureError extends ExternalCalendarError {
  constructor(provider: string) {
    super(`${provider} webhook signature verification failed`);
  }
}
