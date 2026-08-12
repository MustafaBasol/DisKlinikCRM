/**
 * errorTracking.ts — F3-OBS-001 (R1): optional, low-lock-in external
 * error-tracking boundary, with mandatory NoraMedi-side sanitization.
 *
 * No external error-tracking provider is configured anywhere in this
 * repository today (no Sentry/GlitchTip SDK in package.json, no DSN
 * handling). This module is the smallest boundary that lets a future
 * deploy point at a Sentry-compatible ingest endpoint (Sentry itself or a
 * self-hosted GlitchTip, both speak the same client protocol) WITHOUT
 * adding `@sentry/node` as a hard dependency now — F3-OBS-001 is scoped to
 * a repository-side foundation, not a vendor decision:
 *
 *   - `SENTRY_DSN` unset (the default, and every environment today):
 *     `captureFatalError` is a pure no-op. Zero behavior change, zero new
 *     runtime dependency exercised.
 *   - `SENTRY_DSN` set but `@sentry/node` not installed: the dynamic
 *     `import()` rejects, is caught, logged once (not per-call, to avoid a
 *     log storm during an incident), and the call still safely no-ops —
 *     this can never itself crash the process or block the request/error
 *     path it's called from.
 *   - `SENTRY_DSN` set AND `@sentry/node` installed (a follow-up
 *     `npm install @sentry/node`, external to this task): a *sanitized,
 *     synthetic* event is sent — see "Privacy contract" below.
 *
 * This intentionally does NOT implement OTel tracing/metrics — see
 * F3-OBS-001's evidence doc for why that is deferred to a follow-up
 * (P1/F7) rather than built here.
 *
 * --- Privacy contract (F3-OBS-001-R1) -------------------------------------
 *
 * The caller (`server/src/index.ts`'s global Express error handler) passes
 * whatever it caught — an application `throw`, a Prisma error, a third-party
 * client error. That raw object routinely carries request-derived content
 * in `err.message` (e.g. `` `Patient ${id} not found` ``), in `err.stack`,
 * or in provider-specific fields, exactly like `utils/logger.ts`'s
 * `safeErrorLog` already documents for the structured-log path. `Sentry.init`'s
 * `sendDefaultPii: false` only stops the SDK from *auto-attaching* request/
 * user context (IP, cookies, headers) that this module never gives it in
 * the first place — it does NOT inspect or scrub the arguments an
 * application explicitly hands to `captureException`/`captureMessage`. A
 * naive `captureException(err, ...)` would therefore forward the raw
 * message/stack/nested-cause chain verbatim to an external, third-party
 * service — the exact exfiltration path F3-IMPL-004/F3-IMPL-006 closed for
 * the log stream. This module must not reopen it via a second, external
 * egress path. Concretely: never assume the SDK's defaults sanitize
 * anything handed to it — this module does the sanitization itself, before
 * the SDK ever sees the value.
 *
 * `captureFatalError` therefore never forwards `err` (or anything derived
 * from it — `err.message`, `err.stack`, `err.cause`, `err.name`, custom
 * properties) to the provider. `err.name` is a plain writable string
 * (`Error.prototype.name`, reassignable to arbitrary text by any caller —
 * `err.name = 'patient=... token=...'` is valid JS), so unlike
 * `safeErrorLog`'s `type` field it is NOT an intrinsically safe telemetry
 * value and must not pass through verbatim (F3-OBS-001-R2). Instead this
 * module reduces every error to one of two fixed literals and discards
 * everything else, then sends a synthetic, fixed-shape event built from:
 *
 *   - `errType`      — `'Error'` if `err` is an `Error` instance, else
 *                       `'UnknownError'`. Never `err.name` itself.
 *   - a fixed, hardcoded message (`EXTERNAL_TRACKING_MESSAGE` below) — NOT
 *     `err.message`, in every environment, unlike `safeErrorLog`'s
 *     non-production behavior (which does log the real message/stack, but
 *     only to this repository's own log stream, never to a third party).
 *   - `requestId` / `role` / `route` from the caller-supplied
 *     `ErrorTrackingContext` — `route` is already a safe template
 *     (`utils/logger.ts`'s `safeRoute`), never a raw path with embedded
 *     IDs; `requestId` is an opaque correlation id, not PII.
 *   - `environment` (`NODE_ENV`) / `release` (`RELEASE_SHA`) — deployment
 *     metadata, not request-derived.
 *
 * No request body, message/patient content, token, credential, or
 * presigned URL is ever in scope of this function's inputs to begin with
 * (the caller passes only `err` + `ErrorTrackingContext`), so there is no
 * separate code path that could leak them here.
 *
 * API choice: `captureMessage`, not `captureException`. A prior version of
 * this module called `Sentry.captureException(err, ...)`, which hands the
 * SDK an actual `Error` object and relies on trusting how the SDK's own
 * exception-frame/stack extraction treats it — exactly the "assume SDK
 * defaults are sufficient" mistake this revision must not repeat. Sending a
 * plain string message plus an explicit, fully-enumerated `context` object
 * (`tags`/`extra` below) means there is no `Error`/stack object in the call
 * at all for any SDK-internal extraction to act on — the sanitization
 * boundary is total, not dependent on SDK behavior this repository doesn't
 * control. `@sentry/node`'s `captureMessage` is part of the same minimal
 * client surface as `captureException`/`init` already used here — no new
 * package, no larger API surface.
 */

import { logger } from './logger.js';

export interface ErrorTrackingContext {
  requestId?: string | number;
  role?: string;
  route?: string;
}

interface MinimalSentryModule {
  init(options: Record<string, unknown>): void;
  captureMessage(message: string, context?: Record<string, unknown>): void;
}

/**
 * Fixed, content-free message sent to the external provider for every
 * captured error, regardless of the real `err.message` — see module
 * docstring's "Privacy contract".
 */
const EXTERNAL_TRACKING_MESSAGE = 'internal error captured';

/**
 * Bounded error classification — NOT `err.name`. `Error.prototype.name` is a
 * plain writable string property (`err.name = anything`), so it is
 * attacker/application-controlled free text, not an intrinsically safe
 * telemetry field, despite looking like a fixed enum in the common case.
 * This returns one of exactly two fixed literals, regardless of what `err`
 * or `err.name` actually contain.
 */
function safeExternalErrorType(err: unknown): 'Error' | 'UnknownError' {
  return err instanceof Error ? 'Error' : 'UnknownError';
}

let initialized = false;
let warnedMissingPackage = false;
let sentryModulePromise: Promise<MinimalSentryModule | null> | null = null;

/**
 * Test-only injection seam (mirrors `utils/readiness.ts`'s injected
 * `checkDatabase`/`checkRedis` pattern): lets tests supply a fake
 * `MinimalSentryModule` to assert on the exact payload this module sends,
 * without requiring `@sentry/node` to be installed. `null` (the default)
 * means "use the real dynamic import".
 */
let sentryModuleLoaderOverrideForTests: (() => Promise<MinimalSentryModule | null>) | null = null;

/** Test-only: injects a fake Sentry module loader. Call `resetErrorTrackingStateForTests()` after. */
export function setSentryModuleLoaderForTests(
  loader: (() => Promise<MinimalSentryModule | null>) | null,
): void {
  sentryModuleLoaderOverrideForTests = loader;
}

// A non-literal specifier so TypeScript treats this as an untyped dynamic
// import (Promise<any>) instead of trying to resolve "@sentry/node" at
// compile time — the package is deliberately NOT a dependency of this
// project (see module docstring); a literal `import('@sentry/node')` would
// fail `tsc` with "Cannot find module" whether or not the DSN is ever set.
const OPTIONAL_SENTRY_MODULE_SPECIFIER = '@sentry/node';

async function loadSentry(): Promise<MinimalSentryModule | null> {
  if (sentryModuleLoaderOverrideForTests) return sentryModuleLoaderOverrideForTests();
  if (sentryModulePromise) return sentryModulePromise;
  sentryModulePromise = import(OPTIONAL_SENTRY_MODULE_SPECIFIER)
    .then((mod) => mod as unknown as MinimalSentryModule)
    .catch(() => {
      if (!warnedMissingPackage) {
        warnedMissingPackage = true;
        logger.warn(
          '[error-tracking] SENTRY_DSN is set but the "@sentry/node" package is not installed — ' +
            'error events will only reach structured logs. Run `npm install @sentry/node` to enable it.',
        );
      }
      return null;
    });
  return sentryModulePromise;
}

/** Test-only: clears memoized module/init state between test cases. */
export function resetErrorTrackingStateForTests(): void {
  initialized = false;
  warnedMissingPackage = false;
  sentryModulePromise = null;
  sentryModuleLoaderOverrideForTests = null;
}

export async function captureFatalError(err: unknown, context: ErrorTrackingContext = {}): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;

  const Sentry = await loadSentry();
  if (!Sentry) return;

  if (!initialized) {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.RELEASE_SHA || undefined,
      sendDefaultPii: false,
      // No request-body/breadcrumb integrations are configured — only the
      // explicit, scrubbed payload below is ever sent, and it is built
      // from `context`/`err.name` only, never from `err` itself.
    });
    initialized = true;
  }

  // See module docstring's "Privacy contract": every field below is either
  // a fixed constant, a caller-supplied correlation id/role/safe-route
  // template, or the bounded `safeExternalErrorType()` classification —
  // never `err.name`, `err.message`, `err.stack`, or any other property of `err`.
  Sentry.captureMessage(EXTERNAL_TRACKING_MESSAGE, {
    level: 'error',
    tags: {
      errType: safeExternalErrorType(err),
      role: context.role,
      requestId: context.requestId !== undefined ? String(context.requestId) : undefined,
    },
    extra: {
      route: context.route,
    },
  });
}
