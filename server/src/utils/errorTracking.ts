/**
 * errorTracking.ts — F3-OBS-001 (R1/R2) + F3-C2-ERR-001 (R3): optional,
 * low-lock-in external error-tracking boundary, with mandatory NoraMedi-side
 * sanitization.
 *
 * R3 (F3-C2-ERR-001) is the *activation* revision: `@sentry/node` is now a
 * pinned production dependency of `server/package.json`, so the boundary can
 * actually deliver in production once an operator sets `SENTRY_DSN`. The
 * privacy contract below is unchanged in intent and strictly tightened in
 * implementation — R3 adds a deny-by-default SDK configuration and a
 * deny-by-default outbound-event rebuild, and it makes the boundary
 * non-throwing end to end (see "Availability contract").
 *
 * Three states, exactly as before:
 *
 *   - `SENTRY_DSN` unset (the default, and every environment today):
 *     `captureFatalError` is a pure no-op. Zero behavior change, and — because
 *     the SDK is reached through a *dynamic* `import()` gated on the DSN —
 *     `@sentry/node` is never even loaded into the process. Installing the
 *     dependency therefore costs disk, not runtime surface.
 *   - `SENTRY_DSN` set but `@sentry/node` unloadable (a partially restored
 *     deploy, `npm ci` not yet re-run after this change): the dynamic
 *     `import()` rejects, is caught, logged once (not per-call, to avoid a
 *     log storm during an incident), and the call still safely no-ops.
 *   - `SENTRY_DSN` set AND `@sentry/node` loadable: a *sanitized, synthetic*
 *     event is sent — see "Privacy contract" below.
 *
 * This intentionally does NOT implement OTel tracing/metrics — see
 * F3-OBS-001's evidence doc for why that is deferred to a follow-up
 * (P1/F7) rather than built here. `@sentry/node` v10 does carry
 * `@opentelemetry/*` packages transitively, but this module explicitly
 * disables OpenTelemetry *runtime setup* — see "SDK configuration" below.
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
 *     (`utils/logger.ts`'s `safeRoute`, which returns either a matched
 *     Express route template or the constant `'/:unmatched'`, never a raw
 *     path with embedded ids); `requestId` is an opaque correlation id
 *     (pino-http's default per-process counter), not PII.
 *   - `environment` (`NODE_ENV`) / `release` (`RELEASE_SHA`) — deployment
 *     metadata, not request-derived.
 *
 * R3 no longer *trusts* those three caller-supplied values either: each is
 * re-validated here against a bounded pattern (`boundedRole` /
 * `boundedRequestId` / `boundedRoute`) and dropped — or, for `route`,
 * replaced with `UNSAFE_ROUTE_PLACEHOLDER` — if it does not match. That is
 * defense in depth against a *future* caller wiring in a raw path, a
 * header-derived request id, or free-text role. No request body, header,
 * cookie, query value, authorization material, patient/message content,
 * token, credential, or presigned URL is in scope of this function's inputs
 * to begin with (the caller passes only `err` + `ErrorTrackingContext`), and
 * the bounded validators mean none of those shapes could survive even if a
 * caller tried.
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
 * control.
 *
 * --- SDK configuration: deny by default (F3-C2-ERR-001) -------------------
 *
 * `sendDefaultPii: false` is NOT sufficient on its own, and R3 does not rely
 * on it. `@sentry/node` v10's *default integration set* is what actually
 * decides how much of the process leaves it, and by default it includes
 * several integrations that would each independently breach the contract
 * above (verified against the installed v10.70.0 build, not docs alone —
 * `@sentry/node-core/build/cjs/sdk/index.js`'s `getDefaultIntegrations()`):
 *
 *   - `requestDataIntegration`      — attaches request headers/cookies/query/url
 *   - `consoleIntegration`          — turns every `console.*` call into a breadcrumb
 *   - `httpIntegration` /
 *     `nativeNodeFetchIntegration`  — outgoing-request breadcrumbs, i.e. URLs
 *   - `onUncaughtExceptionIntegration` /
 *     `onUnhandledRejectionIntegration`
 *                                   — auto-captures raw errors (message + stack),
 *                                     bypassing this module entirely; this
 *                                     repository already owns that path in
 *                                     `utils/fatalErrorHandlers.ts`
 *   - `contextLinesIntegration`     — reads source files and attaches source context
 *   - `localVariablesIntegration`   — attaches local variable *values* from frames
 *   - `nodeContextIntegration`      — os/device/culture/runtime metadata
 *   - `modulesIntegration`          — the full installed-package inventory
 *   - `childProcessIntegration`, `processSessionIntegration`,
 *     `linkedErrorsIntegration` (walks `error.cause`), `systemErrorIntegration`,
 *     `conversationIdIntegration`, `inboundFiltersIntegration`,
 *     `functionToStringIntegration`
 *
 * `buildSentryInitOptions()` therefore switches the SDK to deny-by-default
 * (`defaultIntegrations: false` + `integrations: []` — verified to resolve to
 * an empty integration list by `@sentry/core`'s `getIntegrationsToSetup`,
 * which evaluates `options.defaultIntegrations || []`) and additionally pins
 * every option that the SDK would otherwise read from *its own* environment
 * variables. That last point matters: `@sentry/node-core`'s `getClientOptions`
 * falls back to `process.env.SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_DEBUG`,
 * `SENTRY_SPOTLIGHT` and friends, so leaving an option unset is not the same
 * as disabling it — an operator (or a compromised env) could switch tracing
 * on out-of-band. Every such option is passed explicitly.
 *
 * Two further v10 specifics, both verified in the installed build:
 *
 *   - `serverName` defaults to `os.hostname()`
 *     (`@sentry/node-core/build/cjs/sdk/client.js`), i.e. the production host
 *     name would egress on every event. `includeServerName: false` is the
 *     documented opt-out and is set here.
 *   - `Sentry.init` registers an OpenTelemetry tracer provider unless
 *     `skipOpenTelemetrySetup: true`, and installs `import-in-the-middle` ESM
 *     loader hooks unless `registerEsmLoaderHooks: false`
 *     (`@sentry/node/build/cjs/sdk/index.js`, `@sentry/node-core`'s `_init`).
 *     Both are disabled: this boundary needs a transport, not instrumentation.
 *     (`@sentry/node-core` still installs an OTel *async-context strategy*
 *     unconditionally; that is in-process bookkeeping with no exporter,
 *     no instrumentation and no egress — recorded honestly in the F3-OBS-001
 *     evidence doc rather than claimed away.)
 *
 * Finally, `beforeSend` (`sanitizeOutboundEvent`) is the last, SDK-independent
 * net: it discards the event the SDK assembled and rebuilds a new one from an
 * explicit allow-list, and drops the event entirely unless its message is
 * exactly `EXTERNAL_TRACKING_MESSAGE`. So even a future `Sentry.captureException`
 * call somewhere else in this process — or an integration that slipped past
 * the two lines above — cannot egress: it would not carry the fixed message.
 *
 * --- Availability contract (F3-C2-ERR-001) --------------------------------
 *
 * `server/src/index.ts` calls this as `void captureFatalError(...)`, and
 * `utils/fatalErrorHandlers.ts` registers a process-level `unhandledRejection`
 * handler that logs and then `process.exit(1)`. A rejected promise from this
 * function would therefore not merely fail to report an error — it would kill
 * the API process. Before R3 the only throwing path (the dynamic import) was
 * already caught; now that a real SDK actually runs `init()`/`captureMessage()`
 * here, every step is wrapped so this function can never reject and never
 * blocks or delays the HTTP error response.
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
 * docstring's "Privacy contract". Also doubles as the allow-list key in
 * `sanitizeOutboundEvent`: an event that does not carry exactly this message
 * is not one this module produced, and is dropped.
 */
export const EXTERNAL_TRACKING_MESSAGE = 'internal error captured';

/**
 * Substituted for a `route` that fails `ROUTE_PATTERN`. A dropped field would
 * be indistinguishable from "no route known"; a fixed placeholder tells an
 * operator that a route *was* supplied and was refused, without carrying any
 * of the refused content.
 */
export const UNSAFE_ROUTE_PLACEHOLDER = '/:unsafe-route';

/** `role` is a small fixed vocabulary today ('api', 'worker'); bound it as such. */
const ROLE_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

/**
 * `requestId` is pino-http's per-process counter today. The pattern admits
 * the opaque-correlation-id shapes (counters, uuids, prefixed ids) and
 * excludes everything with the shape of an address, a token payload or free
 * text — no whitespace, no `@`, `=`, `&`, `%`, `/`.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * `route` must look like a route *template*, not a URL. Leading slash, no
 * whitespace, no query/fragment/credential characters (`?`-as-query, `=`,
 * `&`, `%`, `#`, `@`). The admitted punctuation covers Express 5 /
 * path-to-regexp template syntax (`:param`, `*`, `{...}` optional groups).
 */
const ROUTE_PATTERN = /^\/[\w/:.*\-{}()[\]]{0,199}$/;

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

function boundedRole(value: unknown): string | undefined {
  return typeof value === 'string' && ROLE_PATTERN.test(value) ? value : undefined;
}

function boundedRequestId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const candidate = typeof value === 'number' ? String(value) : value;
  return typeof candidate === 'string' && REQUEST_ID_PATTERN.test(candidate) ? candidate : undefined;
}

function boundedRoute(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return ROUTE_PATTERN.test(value) ? value : UNSAFE_ROUTE_PLACEHOLDER;
}

/**
 * The exact `captureMessage` context this module is allowed to hand the SDK.
 * Exported so tests can assert the payload shape without a live SDK.
 */
export function buildOutboundCaptureContext(
  err: unknown,
  context: ErrorTrackingContext,
): Record<string, unknown> {
  const tags: Record<string, string> = { errType: safeExternalErrorType(err) };
  const role = boundedRole(context.role);
  if (role !== undefined) tags.role = role;
  const requestId = boundedRequestId(context.requestId);
  if (requestId !== undefined) tags.requestId = requestId;

  const extra: Record<string, string> = {};
  const route = boundedRoute(context.route);
  if (route !== undefined) extra.route = route;

  return { level: 'error', tags, extra };
}

/**
 * `beforeSend`: the SDK-independent, deny-by-default outbound net. Whatever
 * the SDK assembled is discarded; a new event is built from an explicit
 * allow-list of fields, and anything that is not this module's own synthetic
 * event is dropped entirely. See module docstring, "SDK configuration".
 */
export function sanitizeOutboundEvent(event: unknown): Record<string, unknown> | null {
  if (!event || typeof event !== 'object') return null;
  const source = event as Record<string, unknown>;

  // Deny by default: only this module's fixed synthetic message may egress.
  if (source.message !== EXTERNAL_TRACKING_MESSAGE) return null;

  const outbound: Record<string, unknown> = {
    message: EXTERNAL_TRACKING_MESSAGE,
    level: 'error',
    platform: 'node',
  };

  if (typeof source.event_id === 'string') outbound.event_id = source.event_id;
  if (typeof source.timestamp === 'number') outbound.timestamp = source.timestamp;
  if (typeof source.environment === 'string') outbound.environment = source.environment;
  if (typeof source.release === 'string') outbound.release = source.release;

  // Deliberately NOT allow-listed here: `sdk`. `@sentry/core`'s
  // `createEventEnvelope` re-attaches `sdk.{name,version,integrations,packages}`
  // *after* `beforeSend` runs, so it is not a field this function can control
  // either way. Verified on the wire (F3-C2-ERR-001 boundary probe): its
  // content is SDK self-identification only — `npm:@sentry/node@10.70.0` and an
  // empty integration list — never NoraMedi's own module inventory (that is
  // `event.modules`, which `modulesIntegration` would add and which
  // `defaultIntegrations: false` removes; confirmed absent on the wire).

  const sourceTags =
    source.tags && typeof source.tags === 'object' ? (source.tags as Record<string, unknown>) : {};
  const tags: Record<string, string> = {};
  if (sourceTags.errType === 'Error' || sourceTags.errType === 'UnknownError') {
    tags.errType = sourceTags.errType;
  }
  const role = boundedRole(sourceTags.role);
  if (role !== undefined) tags.role = role;
  const requestId = boundedRequestId(sourceTags.requestId);
  if (requestId !== undefined) tags.requestId = requestId;
  if (Object.keys(tags).length > 0) outbound.tags = tags;

  const sourceExtra =
    source.extra && typeof source.extra === 'object' ? (source.extra as Record<string, unknown>) : {};
  const route = boundedRoute(sourceExtra.route);
  if (route !== undefined) outbound.extra = { route };

  return outbound;
}

/**
 * The exact `Sentry.init` options this boundary uses. Exported so tests can
 * assert every restriction without a live SDK — see module docstring,
 * "SDK configuration: deny by default".
 */
export function buildSentryInitOptions(dsn: string): Record<string, unknown> {
  return {
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.RELEASE_SHA || undefined,

    // --- deny by default: no integration is enabled at all ---------------
    defaultIntegrations: false,
    integrations: [],

    // --- no OpenTelemetry runtime setup, no ESM loader hooks -------------
    skipOpenTelemetrySetup: true,
    registerEsmLoaderHooks: false,

    // --- no tracing / performance / profiling ----------------------------
    // Passed explicitly rather than left unset: `@sentry/node-core`'s
    // `getClientOptions` falls back to `process.env.SENTRY_TRACES_SAMPLE_RATE`
    // when `tracesSampleRate` is undefined, so "unset" is not "off".
    // Profiling is additionally structurally impossible here — it needs
    // `@sentry/profiling-node`'s `nodeProfilingIntegration`, which is neither
    // installed nor reachable through an empty integration list — but the
    // sample rate is pinned anyway rather than relied on being defaulted.
    tracesSampleRate: 0,
    profileSessionSampleRate: 0,

    // --- no PII, no host identity, no stacks, no breadcrumbs, no logs ----
    sendDefaultPii: false,
    includeServerName: false,
    attachStacktrace: false,
    maxBreadcrumbs: 0,
    enableLogs: false,

    // --- no secondary egress channels ------------------------------------
    // sendClientReports would emit periodic "events discarded" envelopes;
    // spotlight would forward everything to a local sidecar (and is
    // env-var-activatable); debug would print SDK internals to stdout.
    sendClientReports: false,
    spotlight: false,
    debug: false,

    // --- final, SDK-independent outbound allow-list ----------------------
    beforeBreadcrumb: () => null,
    beforeSendTransaction: () => null,
    beforeSend: (event: unknown) => sanitizeOutboundEvent(event),
  };
}

let initialized = false;
let initializationFailed = false;
let warnedMissingPackage = false;
let warnedDeliveryFailure = false;
let sentryModulePromise: Promise<MinimalSentryModule | null> | null = null;

/**
 * Test-only injection seam (mirrors `utils/readiness.ts`'s injected
 * `checkDatabase`/`checkRedis` pattern): lets tests supply a fake
 * `MinimalSentryModule` to assert on the exact payload this module sends,
 * without depending on the real transport reaching a provider. `null` (the
 * default) means "use the real dynamic import".
 */
let sentryModuleLoaderOverrideForTests: (() => Promise<MinimalSentryModule | null>) | null = null;

/** Test-only: injects a fake Sentry module loader. Call `resetErrorTrackingStateForTests()` after. */
export function setSentryModuleLoaderForTests(
  loader: (() => Promise<MinimalSentryModule | null>) | null,
): void {
  sentryModuleLoaderOverrideForTests = loader;
}

// A non-literal specifier keeps this an untyped dynamic import
// (`Promise<any>`) rather than a compile-time module resolution. Two reasons
// this stays non-literal even though `@sentry/node` IS a dependency as of
// F3-C2-ERR-001: (1) the boundary keeps working — as a no-op — on any box
// where the package is absent or half-installed, which is what makes the
// rollback in the F3-C2-ERR-001 runbook a pure env-var change; (2) it keeps
// the SDK's very large type surface (and its transitive @opentelemetry/*
// types) out of `tsc --noEmit` for the whole server tree.
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
          '[error-tracking] SENTRY_DSN is set but the "@sentry/node" package could not be loaded — ' +
            'error events will only reach structured logs. Re-run `npm ci` in server/ so the pinned ' +
            'dependency is installed.',
        );
      }
      return null;
    });
  return sentryModulePromise;
}

/** Test-only: clears memoized module/init state between test cases. */
export function resetErrorTrackingStateForTests(): void {
  initialized = false;
  initializationFailed = false;
  warnedMissingPackage = false;
  warnedDeliveryFailure = false;
  sentryModulePromise = null;
  sentryModuleLoaderOverrideForTests = null;
}

function warnDeliveryFailureOnce(): void {
  if (warnedDeliveryFailure) return;
  warnedDeliveryFailure = true;
  // No error detail is logged: the thrown value belongs to the SDK, and this
  // module's whole contract is that SDK-adjacent values are not trusted.
  logger.warn(
    '[error-tracking] external error-tracking delivery failed and was suppressed — ' +
      'error events still reach structured logs. This is logged once per process.',
  );
}

export async function captureFatalError(err: unknown, context: ErrorTrackingContext = {}): Promise<void> {
  // See module docstring, "Availability contract": this function must never
  // reject. `void captureFatalError(...)` at the call site plus the
  // process-level unhandledRejection handler in utils/fatalErrorHandlers.ts
  // would otherwise turn a reporting failure into a process exit.
  try {
    const dsn = process.env.SENTRY_DSN?.trim();
    if (!dsn) return;

    const Sentry = await loadSentry();
    if (!Sentry) return;

    if (!initialized) {
      if (initializationFailed) return;
      try {
        Sentry.init(buildSentryInitOptions(dsn));
        initialized = true;
      } catch {
        // Latch, so a permanently broken SDK/DSN is not re-initialized on
        // every subsequent 5xx.
        initializationFailed = true;
        warnDeliveryFailureOnce();
        return;
      }
    }

    // Every field below is either a fixed constant, or a caller-supplied
    // correlation id / role / safe-route template that `buildOutboundCaptureContext`
    // re-validates against a bounded pattern — never `err.name`, `err.message`,
    // `err.stack`, `err.cause`, or any other property of `err`.
    Sentry.captureMessage(EXTERNAL_TRACKING_MESSAGE, buildOutboundCaptureContext(err, context));
  } catch {
    warnDeliveryFailureOnce();
  }
}
