/**
 * verifyErrorTrackingDelivery.ts — F3-C2-ERR-004: the Stage 5 synthetic
 * production verification mechanism for external error tracking.
 *
 * `F3-C2-ERR-002` §9 Stage 5 requires exactly one synthetic event to be
 * delivered to the provider, and constrains how:
 *
 *   > Mechanism: throwaway host-side script invoking `captureFatalError`
 *   > directly, or a controlled existing 5xx path. **Do NOT add a public
 *   > error endpoint** and do not add any route.
 *
 * This file is that script, committed rather than improvised. The alternative
 * the runbook literally describes — an operator hand-writing a throwaway
 * script on the production host, at the exact moment a freshly-configured
 * `SENTRY_DSN` first becomes live — is the least reviewed code in the whole
 * activation, running at the point of highest risk. Committing it means it is
 * type-checked, unit-tested (`server/src/tests/errorTrackingVerification.test.ts`)
 * and reviewed like anything else, and that the activation runbook has one
 * exact command instead of a paste buffer.
 *
 * It adds **no route, no endpoint and no runtime surface**. Nothing imports
 * it; it only runs when an operator invokes it explicitly.
 *
 * --- What it proves ------------------------------------------------------
 *
 * A naive verification sends a clean error and observes that a clean event
 * arrived. That proves delivery and nothing else: an event with no PHI in it
 * is not evidence that PHI *would have been* removed. This script instead
 * sends a **deliberately contaminated** error — every prohibited field class
 * from `F3-C2-ERR-002` §5.2 packed into `err.message`, `err.name`, `err.cause`
 * and a custom own-property, plus an unsafe raw `route`, a free-text `role`
 * and a non-conforming `requestId`.
 *
 * The operator then searches the provider UI for the canary tokens this
 * script prints. Every one of them MUST be absent. That is an affirmative
 * redaction proof, not an absence-of-evidence argument, and it is exactly the
 * §9 Stage 5 acceptance list restated as something a human can check in a
 * browser.
 *
 * The canary values are synthetic and fixed (see `VERIFICATION_CANARY`). No
 * real patient, clinic, credential or DICOM value is used or read — that is a
 * hard requirement, since the whole point is that these values get sent to
 * the boundary.
 *
 * --- Why it must flush ---------------------------------------------------
 *
 * `captureFatalError` is fire-and-forget by contract: it hands the event to
 * the SDK transport and returns without awaiting delivery, because on its
 * real call path (`server/src/index.ts`'s 5xx handler) blocking the HTTP
 * response on an external provider would be a availability defect. In the
 * long-lived API process the transport drains on its own.
 *
 * A short-lived script has no such luxury: without an explicit flush the
 * process can exit before the request is on the wire, and the verification
 * would report success while delivering nothing — or, worse, report failure
 * for a boundary that is actually fine. This script therefore awaits
 * `Sentry.flush()` on the same SDK singleton `captureFatalError` initialized
 * (a dynamic `import('@sentry/node')` in the same process resolves to the
 * same module instance and therefore the same client) before reporting.
 *
 * --- Secret handling -----------------------------------------------------
 *
 * `SENTRY_DSN` is credential-equivalent. This script reads it only through
 * `captureFatalError`'s own `process.env` lookup and **never prints it,
 * never logs it, never derives a fragment of it**. All configuration output
 * is boolean or a fixed literal, matching the runbook's "Boolean-only
 * output. Never `cat` the `.env`. Never `set -x`." rule.
 */

import { captureFatalError, EXTERNAL_TRACKING_MESSAGE } from '../utils/errorTracking.js';

/** Explicit opt-in. Without this exact argument the script sends nothing. */
export const CONFIRM_FLAG = '--send-one-synthetic-event';

/** Bounded flush budget. Long enough for a TLS round trip, short enough to fail fast. */
export const FLUSH_TIMEOUT_MS = 15_000;

/**
 * Synthetic, fixed contamination payload. Every value is fabricated and
 * matches no real record. Each covers one prohibited class from
 * `F3-C2-ERR-002` §5.2, and each is distinctive enough to be searched for in
 * the provider UI without false positives.
 *
 * Exported so `errorTrackingVerification.test.ts` asserts against exactly the
 * values this script sends — one source of truth, so the test cannot drift
 * into proving a different payload clean than the one production emits.
 */
export const VERIFICATION_CANARY = {
  patientName: 'NORAMEDI-CANARY-PATIENTNAME-AYSEYILMAZ',
  tckn: 'NORAMEDI-CANARY-TCKN-12345678901',
  phone: 'NORAMEDI-CANARY-PHONE-905321234567',
  email: 'NORAMEDI-CANARY-EMAIL-hasta-at-example-com',
  address: 'NORAMEDI-CANARY-ADDRESS-KADIKOY-ISTANBUL',
  diagnosis: 'NORAMEDI-CANARY-DIAGNOSIS-PERIAPIKAL-LEZYON',
  appointmentNote: 'NORAMEDI-CANARY-APPTNOTE-KANAL-TEDAVISI',
  messageBody: 'NORAMEDI-CANARY-MESSAGEBODY-WHATSAPP-TEXT',
  authorization: 'NORAMEDI-CANARY-AUTHORIZATION-BEARERTOKEN',
  cookie: 'NORAMEDI-CANARY-COOKIE-SESSIONVALUE',
  databaseUrl: 'NORAMEDI-CANARY-DATABASEURL-CONNSTRING',
  storageCredential: 'NORAMEDI-CANARY-STORAGECRED-ACCESSKEY',
  metaSecret: 'NORAMEDI-CANARY-METASECRET-APPSECRET',
  dicomPatientName: 'NORAMEDI-CANARY-DICOM-PATIENTNAME',
  dicomPatientId: 'NORAMEDI-CANARY-DICOM-PATIENTID-00998877',
  accession: 'NORAMEDI-CANARY-DICOM-ACCESSION-AC4477',
  uploadedFilename: 'NORAMEDI-CANARY-FILENAME-AYSE-PANORAMIK.dcm',
  errorName: 'NORAMEDI-CANARY-ERRNAME',
  clinicId: 'NORAMEDI-CANARY-CLINICID-ACME-DENTAL',
} as const;

/** A raw URL with an embedded identifier and a query string — never a safe route template. */
export const VERIFICATION_UNSAFE_ROUTE =
  `/api/patients/NORAMEDI-CANARY-ROUTEID-4411/notes?q=${VERIFICATION_CANARY.patientName}`;

/** Free text, deliberately outside the bounded `role` vocabulary. */
export const VERIFICATION_UNSAFE_ROLE = 'NORAMEDI CANARY ROLE WITH SPACES';

/** Deliberately outside the bounded correlation-id shape (spaces, `/`, `@`, `=`). */
export const VERIFICATION_UNSAFE_REQUEST_ID =
  'NORAMEDI CANARY REQ/ID@WITH=UNSAFE CHARS';

/** A conforming correlation id, so the operator has something to search *for*. */
export const VERIFICATION_SAFE_REQUEST_ID_PREFIX = 'f3-c2-err-004-verify';

/**
 * Builds the deliberately contaminated error this script sends. Exported so
 * the test drives the real sanitizers with this exact object.
 */
export function buildContaminatedVerificationError(): Error {
  const c = VERIFICATION_CANARY;
  const err = new Error(
    `Patient ${c.patientName} (TCKN ${c.tckn}, phone ${c.phone}, email ${c.email}, ` +
      `address ${c.address}) diagnosis="${c.diagnosis}" note="${c.appointmentNote}" ` +
      `message="${c.messageBody}" Authorization: ${c.authorization} Cookie: ${c.cookie} ` +
      `DATABASE_URL=${c.databaseUrl} storage=${c.storageCredential} meta=${c.metaSecret} ` +
      `DICOM PatientName=${c.dicomPatientName} PatientID=${c.dicomPatientId} ` +
      `Accession=${c.accession} file=${c.uploadedFilename} clinicId=${c.clinicId}`,
  );
  // `Error.prototype.name` is writable free text — the exact reason
  // errorTracking.ts refuses to forward it. Prove that here.
  err.name = c.errorName;
  // `linkedErrorsIntegration` would walk this chain; it must be off.
  (err as Error & { cause?: unknown }).cause = new Error(
    `nested cause carrying ${c.tckn} and ${c.authorization}`,
  );
  // A custom own-property, the shape a provider client might serialize.
  (err as unknown as Record<string, unknown>).patientRecord = {
    name: c.patientName,
    tckn: c.tckn,
    dicomPatientId: c.dicomPatientId,
  };
  return err;
}

/** Every canary string that must NOT appear in the delivered event. */
export function allCanaryTokens(): string[] {
  return [
    ...Object.values(VERIFICATION_CANARY),
    VERIFICATION_UNSAFE_ROUTE,
    VERIFICATION_UNSAFE_ROLE,
    VERIFICATION_UNSAFE_REQUEST_ID,
  ];
}

/**
 * Boolean-only configuration report. Deliberately returns no value derived
 * from `SENTRY_DSN` beyond whether it is non-empty.
 */
export function describeConfiguration(env: NodeJS.ProcessEnv): Record<string, string> {
  return {
    SENTRY_DSN_CONFIGURED: env.SENTRY_DSN?.trim() ? 'YES' : 'NO',
    RELEASE_SHA_CONFIGURED: env.RELEASE_SHA?.trim() ? 'YES' : 'NO',
    RELEASE_SHA_VALUE: env.RELEASE_SHA?.trim() || 'UNSET',
    NODE_ENV: env.NODE_ENV || 'UNSET',
    PROCESS_ROLE: env.NORAMEDI_PROCESS_ROLE || 'UNSET',
  };
}

// A non-literal specifier for the same two reasons errorTracking.ts documents:
// the script still runs (and reports honestly) on a host where the optional
// package is absent, and the SDK's very large type surface stays out of
// `tsc --noEmit` for the whole server tree.
const OPTIONAL_SENTRY_MODULE_SPECIFIER = '@sentry/node';

interface FlushableSentryModule {
  flush(timeout?: number): Promise<boolean>;
}

/**
 * Flushes the SDK client `captureFatalError` initialized. Returns a status
 * string rather than throwing: a flush failure is a verification result to
 * report, not a crash.
 */
export async function flushErrorTracking(
  loader: () => Promise<FlushableSentryModule> = () =>
    import(OPTIONAL_SENTRY_MODULE_SPECIFIER) as Promise<FlushableSentryModule>,
): Promise<'FLUSHED' | 'FLUSH_TIMEOUT' | 'SDK_UNAVAILABLE' | 'FLUSH_ERROR'> {
  let sdk: FlushableSentryModule;
  try {
    sdk = await loader();
  } catch {
    return 'SDK_UNAVAILABLE';
  }
  try {
    return (await sdk.flush(FLUSH_TIMEOUT_MS)) ? 'FLUSHED' : 'FLUSH_TIMEOUT';
  } catch {
    return 'FLUSH_ERROR';
  }
}

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const out = (line: string) => process.stdout.write(`${line}\n`);

  out('F3-C2-ERR-004 — synthetic external error-tracking verification');
  out('');
  const config = describeConfiguration(env);
  for (const [k, v] of Object.entries(config)) out(`${k}=${v}`);
  out('');

  if (!argv.includes(CONFIRM_FLAG)) {
    out(`REFUSED=YES REASON=MISSING_CONFIRMATION_FLAG`);
    out(`This script sends exactly one synthetic event to the configured provider.`);
    out(`Re-run with ${CONFIRM_FLAG} to proceed.`);
    return 2;
  }

  if (config.SENTRY_DSN_CONFIGURED !== 'YES') {
    out('REFUSED=YES REASON=SENTRY_DSN_NOT_CONFIGURED');
    out('Nothing to verify: captureFatalError is a no-op without a DSN.');
    return 3;
  }

  const requestId = `${VERIFICATION_SAFE_REQUEST_ID_PREFIX}-${process.pid}`;
  out(`CORRELATION_REQUEST_ID=${requestId}`);
  out('');

  // EXACTLY ONE event. `F3-C2-ERR-002` §9 Stage 5 requires exactly one, and
  // §9 Stage 6 then asserts the provider's event count IS one — a second
  // deliberate event would fail that acceptance check even though it was
  // intentional. So this single event is composed to carry the maximum
  // provable content in one record:
  //   - a CONFORMING requestId and role, so the event is findable in the UI
  //     and so the operator can prove correlation actually works;
  //   - an UNSAFE raw route, so the `/:unsafe-route` substitution is proven
  //     on the wire rather than only in unit tests;
  //   - a fully CONTAMINATED error, so redaction of message/name/cause and
  //     custom own-properties is proven affirmatively.
  // The one path not exercised here is dropping of a malformed role/requestId.
  // That is covered by `errorTrackingVerification.test.ts`, and its inputs
  // originate in NoraMedi's own middleware rather than in attacker- or
  // patient-derived content, so it is the right thing to leave to unit tests.
  await captureFatalError(buildContaminatedVerificationError(), {
    requestId,
    role: 'api',
    route: VERIFICATION_UNSAFE_ROUTE,
  });

  const flushStatus = await flushErrorTracking();
  out(`FLUSH_STATUS=${flushStatus}`);
  out(`EVENTS_SENT=1`);
  out(`EXPECTED_MESSAGE=${EXTERNAL_TRACKING_MESSAGE}`);
  out('');
  out('Now verify IN THE PROVIDER UI. Exactly one event must exist, showing:');
  out(`  - message exactly: ${EXTERNAL_TRACKING_MESSAGE}`);
  out(`  - tags.errType = Error`);
  out(`  - environment = ${config.NODE_ENV}, release = ${config.RELEASE_SHA_VALUE}`);
  out(`  - tags.requestId = ${requestId}`);
  out('  - tags.role = api');
  out('  - extra.route = /:unsafe-route   (the raw URL was REFUSED and replaced)');
  out('  - NO stack trace, NO breadcrumbs, NO request/headers/cookies section,');
  out('    NO user section, NO server_name, NO module inventory');
  out('');
  out('And every token below MUST be ABSENT everywhere in the event');
  out('(message, title, tags, extra, breadcrumbs, request, contexts, stack):');
  for (const token of allCanaryTokens()) out(`  ABSENT_REQUIRED: ${token}`);
  out('');
  out('Any single one present => STOP AND REVERT per F3-C2-ERR-002 §10.1.');
  return flushStatus === 'FLUSHED' ? 0 : 1;
}

// Only run when invoked directly, never on import (so the test can import
// the pure helpers above without sending anything).
const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].includes('verifyErrorTrackingDelivery');
if (invokedDirectly) {
  void main(process.argv.slice(2), process.env).then((code) => {
    process.exitCode = code;
  });
}
