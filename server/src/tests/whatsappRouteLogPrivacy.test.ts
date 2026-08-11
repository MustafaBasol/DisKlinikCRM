/**
 * whatsappRouteLogPrivacy.test.ts — F3-IMPL-004 (PII/PHI Runtime Log Hygiene
 * Wave 1) regression tests confirming server/src/routes/whatsapp.ts never
 * writes a raw caller-supplied secret / raw error, a treatment/service name,
 * or a staff practitioner name to the process logs.
 *
 * The three fixed call-site families all live in module-private (non-exported)
 * functions and route handlers inside routes/whatsapp.ts:
 *   1. authorizeAndResolveWhatsappPublicApi — '[whatsapp-public-api] connection
 *      resolution error' — previously logged the raw caught `error` (which can
 *      carry the caller-supplied secret / DB credential detail via its message).
 *   2. createAppointmentRequestFromAssistant / createWhatsAppStaffRequest /
 *      POST /appointment-requests — '[appointment-request] created' (3 sites) —
 *      previously logged `serviceName` (treatment name) and `practitionerName`
 *      (staff full name) in the clear next to already-summarized ids.
 *   3. handleIncomingWhatsAppMessage's route-handler dispatch — '[whatsapp-
 *      assistant] route-handler' (7 of 13 sites) — previously logged
 *      `selectedAppointmentTypeName` (patient's selected treatment name) via
 *      `state?.selectedAppointmentTypeName ?? null` instead of a hardcoded
 *      `null` like their 6 already-safe sibling sites.
 *
 * None of the containing functions/handlers are exported or independently
 * callable without a live Express req/res + Prisma-backed transaction (the
 * appointment-request sites run inside `prisma.$transaction`, hit the real
 * schema-validated request bodies, and the route-handler dispatch function is
 * a 1000+ line unexported closure requiring full conversation-state/consent
 * infrastructure). Building that mocking harness is disproportionate to a
 * bounded log-redaction fix, so — mirroring the secondary backstop strategy
 * already used in whatsappBookingFlowLogRedaction.test.ts — this test suite
 * uses a static source scan as the primary (and only currently practical)
 * defense: it locates each fixed call-site block by a distinguishing literal
 * and asserts the raw/unsafe field is gone while the safe replacement remains.
 *
 * Run with: cd server && npx tsx src/tests/whatsappRouteLogPrivacy.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

const routeSource = readFileSync(
  fileURLToPath(new URL('../routes/whatsapp.ts', import.meta.url)),
  'utf8',
);

/** Extracts the source text of a console.* call by its distinguishing literal
 * (e.g. a handler string or field), from the console.* token through a
 * generous fixed window comfortably spanning every field in these log calls. */
function extractLogCallBlock(distinguishingLiteral: string, window = 500): string {
  const literalIndex = routeSource.indexOf(distinguishingLiteral);
  assert.ok(literalIndex >= 0, `expected to find "${distinguishingLiteral}" in whatsapp.ts`);
  const callStart = routeSource.lastIndexOf('console.', literalIndex);
  assert.ok(callStart >= 0, `expected a console.* call before "${distinguishingLiteral}"`);
  return routeSource.slice(callStart, callStart + window);
}

/** Finds the Nth occurrence (0-indexed) of `distinguishingLiteral` and
 * extracts the console.* call block preceding it. Used where the same
 * literal appears at multiple call sites (e.g. handler names shared with
 * non-logging contexts, or repeated across the 3 appointment-request sites
 * which don't share a unique handler string). */
function extractNthLogCallBlock(distinguishingLiteral: string, occurrence: number, window = 500): string {
  let idx = -1;
  for (let i = 0; i <= occurrence; i++) {
    idx = routeSource.indexOf(distinguishingLiteral, idx + 1);
    assert.ok(idx >= 0, `expected occurrence #${occurrence} of "${distinguishingLiteral}" in whatsapp.ts`);
  }
  const callStart = routeSource.lastIndexOf('console.', idx);
  assert.ok(callStart >= 0, `expected a console.* call before occurrence #${occurrence} of "${distinguishingLiteral}"`);
  return routeSource.slice(callStart, callStart + window);
}

async function main() {
  section('Fix 1/3 — authorizeAndResolveWhatsappPublicApi: no raw error/secret in connection-resolution log');

  await test('connection resolution error log uses error.name, never the raw error object', () => {
    const block = extractLogCallBlock('connection resolution error');
    assert.ok(
      /error instanceof Error \? error\.name : 'UnknownError'/.test(block),
      'expected error instanceof Error ? error.name : \'UnknownError\' in the log call',
    );
    // The only remaining "error" tokens should be the qualified error.name /
    // error instanceof Error checks — never a bare `, error)` argument.
    assert.ok(
      !/connection resolution error',\s*error\)/.test(block),
      'found raw unqualified `error` passed directly to console.error',
    );
  });

  section('Fix 2/3 — [appointment-request] created (3 sites): no serviceName/practitionerName in the clear');

  const appointmentRequestSites = [
    { label: 'createAppointmentRequestFromAssistant', occurrence: 0 },
    { label: 'createWhatsAppStaffRequest', occurrence: 1 },
    { label: 'POST /appointment-requests', occurrence: 2 },
  ];

  for (const { label, occurrence } of appointmentRequestSites) {
    await test(`${label}: appointment-request-created log omits serviceName/practitionerName, keeps summarized ids`, () => {
      const block = extractNthLogCallBlock("'[appointment-request] created'", occurrence, 700);
      assert.ok(!/serviceName:/.test(block), `${label}: found raw "serviceName:" field`);
      assert.ok(!/practitionerName:/.test(block), `${label}: found raw "practitionerName:" field`);
      assert.ok(/serviceId:\s*summarizeIdentifier/.test(block), `${label}: expected summarized serviceId to remain`);
      assert.ok(/practitionerId:\s*summarizeIdentifier/.test(block), `${label}: expected summarized practitionerId to remain`);
    });
  }

  await test('cancel-request sibling log (already-safe, must remain untouched) still hardcodes null', () => {
    const block = extractNthLogCallBlock("'[appointment-request] created'", 3, 400);
    assert.ok(/serviceName:\s*null/.test(block), 'expected the pre-existing hardcoded serviceName: null to remain untouched');
    assert.ok(/practitionerName:\s*null/.test(block), 'expected the pre-existing hardcoded practitionerName: null to remain untouched');
  });

  section('Fix 3/3 — [whatsapp-assistant] route-handler (7 sites): no patient-selected treatment name in the clear');

  const routeHandlerUnsafeHandlers = [
    'awaiting_service-deterministic',
    'awaiting_time-deterministic',
    'awaiting_confirmation-deterministic',
    'awaiting_service',
    'awaiting_date',
    'awaiting_time',
    'awaiting_confirmation',
  ];

  for (const handler of routeHandlerUnsafeHandlers) {
    await test(`route-handler '${handler}' log hardcodes selectedAppointmentTypeName to null`, () => {
      const block = extractLogCallBlock(`handler: '${handler}',`, 260);
      assert.ok(
        /selectedAppointmentTypeName:\s*null/.test(block),
        `${handler}: expected selectedAppointmentTypeName: null (hardcoded)`,
      );
      assert.ok(
        !/selectedAppointmentTypeName:\s*state\?\.selectedAppointmentTypeName/.test(block),
        `${handler}: found raw state?.selectedAppointmentTypeName still being logged`,
      );
      // selectedAppointmentTypeId is expected to remain live (it's already an id, not PHI content).
      assert.ok(/selectedAppointmentTypeId:/.test(block), `${handler}: expected selectedAppointmentTypeId field to remain`);
    });
  }

  const routeHandlerAlreadySafeHandlers = [
    'main_menu-deterministic',
    'awaiting_name',
    'main_menu',
    'awaiting_cancel_selection',
  ];

  for (const handler of routeHandlerAlreadySafeHandlers) {
    await test(`route-handler '${handler}' sibling log (already-safe) remains hardcoded to null`, () => {
      const block = extractLogCallBlock(`handler: '${handler}',`, 260);
      assert.ok(
        /selectedAppointmentTypeName:\s*null/.test(block),
        `${handler}: expected selectedAppointmentTypeName: null to remain`,
      );
    });
  }

  await test('non-logging state persistence usages of selectedAppointmentTypeName are untouched', () => {
    // Confirms the fix did not overreach into non-console.* contexts, e.g.
    // conversation-state persistence payloads that legitimately carry the
    // real treatment name for storage (not logging).
    const stateAssignments = routeSource.match(/selectedAppointmentTypeName:\s*state\?\.selectedAppointmentTypeName(?!\s*\?\?)/g) ?? [];
    assert.ok(
      stateAssignments.length > 0,
      'expected at least one non-logging state?.selectedAppointmentTypeName assignment to remain in the file (persistence path)',
    );
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
