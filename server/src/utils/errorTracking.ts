/**
 * errorTracking.ts — F3-OBS-001: optional, low-lock-in external error-tracking boundary.
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
 *     `npm install @sentry/node`, external to this task): events are sent
 *     with `sendDefaultPii: false`, no request/response body, no message
 *     body — only a fixed-shape context (request id, process role, safe
 *     route template — the same values already produced by
 *     utils/logger.ts's `safeRoute`/`logUnhandledError`, never patient
 *     data) plus environment/release tags.
 *
 * This intentionally does NOT implement OTel tracing/metrics — see
 * F3-OBS-001's evidence doc for why that is deferred to a follow-up
 * (P1/F7) rather than built here.
 */

import { logger } from './logger.js';

export interface ErrorTrackingContext {
  requestId?: string | number;
  role?: string;
  route?: string;
}

interface MinimalSentryModule {
  init(options: Record<string, unknown>): void;
  captureException(err: unknown, context?: Record<string, unknown>): void;
}

let initialized = false;
let warnedMissingPackage = false;
let sentryModulePromise: Promise<MinimalSentryModule | null> | null = null;

// A non-literal specifier so TypeScript treats this as an untyped dynamic
// import (Promise<any>) instead of trying to resolve "@sentry/node" at
// compile time — the package is deliberately NOT a dependency of this
// project (see module docstring); a literal `import('@sentry/node')` would
// fail `tsc` with "Cannot find module" whether or not the DSN is ever set.
const OPTIONAL_SENTRY_MODULE_SPECIFIER = '@sentry/node';

async function loadSentry(): Promise<MinimalSentryModule | null> {
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
      // explicit, scrubbed `context` below is ever attached to an event.
    });
    initialized = true;
  }

  Sentry.captureException(err, {
    tags: { role: context.role, requestId: context.requestId },
    extra: { route: context.route },
  });
}
