/**
 * instagramAiConversationProcessorLogPrivacy.test.ts — KVKK regression tests
 * confirming server/src/services/instagram/instagramAiConversationProcessor.ts
 * never writes a raw Instagram sender ID, treatment/service name, or
 * practitioner full name to the process logs.
 *
 * Covers the three confirmed production log call sites (F3-IMPL-004):
 *   1. logInstagramReplyFailure    — '[instagram-assistant] reply send failed'
 *      (CONFIRMED_PII: raw externalSenderId was spread in from `metadata`)
 *   2. createInstagramStaffRequest — '[appointment-request] created'
 *      (deterministic booking path; PHI_MEDICAL: serviceName + practitionerName)
 *   3. slot-based/AI booking path  — '[appointment-request] created'
 *      (PHI_MEDICAL: serviceName + practitionerName)
 *
 * All three call sites live inside module-private functions
 * (logInstagramReplyFailure, createInstagramStaffRequest) that perform real
 * `prisma`/`recordOperationalEvent`/`logActivity` calls against the shared,
 * non-injected `prisma` client imported at the top of the file — the same
 * DB-touching-path constraint documented in instagramAssistantParity.test.ts
 * ("The live DB-touching paths inside processInstagramIncomingMessage ... are
 * not exercised end-to-end here"). Since these helpers aren't exported and
 * aren't dependency-injected, a runtime console-capture harness (as used in
 * whatsappBookingFlowLogRedaction.test.ts, where the equivalent handlers
 * *are* exported with injectable deps) isn't reachable without a broader
 * refactor, which is out of scope for this bounded PII/PHI fix.
 *
 * Primary defense here is therefore a static source scan: each console.*
 * call's source block is located precisely (by its distinguishing literal)
 * and asserted to never contain the raw-leaking field, while still
 * containing the redacted/id-only replacement. This mirrors the "Static
 * source scan (secondary backstop)" section of
 * whatsappBookingFlowLogRedaction.test.ts, promoted here to primary defense
 * for the reasons above.
 *
 * Run with: cd server && npx tsx src/tests/instagramAiConversationProcessorLogPrivacy.test.ts
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

// ─── Fixtures (realistic-shaped, never expected to appear in the source) ──────

// A realistic Instagram-scoped sender id (IGSID), as it arrives from the webhook.
const RAW_SENDER_ID = '17841400123456789';

// Realistic treatment/service name and practitioner full name, matching the
// shape used elsewhere in this codebase's Instagram/WhatsApp assistant tests.
const RAW_SERVICE_NAME = 'Diş Beyazlatma';
const RAW_PRACTITIONER_NAME = 'Dr. Ayşe Yılmaz';

// ─── Source scan ────────────────────────────────────────────────────────────

const processorSource = readFileSync(
  fileURLToPath(new URL('../services/instagram/instagramAiConversationProcessor.ts', import.meta.url)),
  'utf8',
);

/** Extracts the source text of the Nth (0-indexed) console.*(...) call
 * matching `distinguishingLiteral`, from the console.* token through well
 * past the matching closing paren of the object literal. Deliberately
 * generous (450 chars) so it comfortably spans every field in these log
 * calls without bleeding meaningfully past the next statement's substance. */
function extractLogCallBlock(distinguishingLiteral: string, occurrence = 0): string {
  let searchFrom = 0;
  let literalIndex = -1;
  for (let i = 0; i <= occurrence; i++) {
    literalIndex = processorSource.indexOf(distinguishingLiteral, searchFrom);
    assert.ok(
      literalIndex >= 0,
      `expected to find occurrence ${i} of "${distinguishingLiteral}" in instagramAiConversationProcessor.ts`,
    );
    searchFrom = literalIndex + distinguishingLiteral.length;
  }
  const callStart = processorSource.lastIndexOf('console.', literalIndex);
  assert.ok(callStart >= 0, `expected a console.* call before "${distinguishingLiteral}"`);
  return processorSource.slice(callStart, callStart + 450);
}

async function main() {
  section('Static source scan — 1/3: reply send failed (raw Instagram sender ID)');

  await test('reply-send-failed log block logs senderSuffix(...), not raw externalSenderId', () => {
    const block = extractLogCallBlock('reply send failed');
    assert.ok(
      /externalSenderId:\s*senderSuffix\(args\.externalSenderId\)/.test(block),
      'expected externalSenderId: senderSuffix(args.externalSenderId) override in the logged object',
    );
    // The object spreads `...metadata` (which itself carries the raw id under
    // the same key) — but in JS object literals, a key repeated after a spread
    // wins, so the *last* `externalSenderId:` assignment in the block must be
    // the redacted one. Assert there is no `externalSenderId:` assignment
    // AFTER the senderSuffix(...) call that could re-introduce a raw value.
    const redactedIndex = block.indexOf('externalSenderId: senderSuffix(args.externalSenderId)');
    const trailing = block.slice(redactedIndex + 'externalSenderId: senderSuffix(args.externalSenderId)'.length);
    assert.ok(
      !/externalSenderId:/.test(trailing.slice(0, trailing.indexOf('});') + 3)),
      'found a later externalSenderId: assignment that could override the redacted value back to raw',
    );
  });

  await test('reply-send-failed log block does not contain fixture sender id literal', () => {
    const block = extractLogCallBlock('reply send failed');
    assert.ok(!block.includes(RAW_SENDER_ID), 'fixture sender id unexpectedly present in log block source');
  });

  section('Static source scan — 2/3: appointment-request created (deterministic booking path)');

  await test('deterministic appointment-request-created log block omits serviceName/practitionerName, keeps ids', () => {
    const block = extractLogCallBlock('[appointment-request] created', 0);
    assert.ok(!/\bserviceName\s*:/.test(block), 'found raw serviceName field in deterministic booking log');
    assert.ok(!/\bpractitionerName\s*:/.test(block), 'found raw practitionerName field in deterministic booking log');
    assert.ok(/\bserviceId\s*:\s*summarizeIdentifier\(/.test(block), 'expected serviceId (summarized) to remain');
    assert.ok(/\bpractitionerId\s*:\s*summarizeIdentifier\(/.test(block), 'expected practitionerId (summarized) to remain');
    assert.ok(!block.includes(RAW_SERVICE_NAME), 'fixture service name unexpectedly present in log block source');
    assert.ok(!block.includes(RAW_PRACTITIONER_NAME), 'fixture practitioner name unexpectedly present in log block source');
  });

  section('Static source scan — 3/3: appointment-request created (slot-based/AI booking path)');

  await test('slot-based appointment-request-created log block omits serviceName/practitionerName, keeps ids', () => {
    const block = extractLogCallBlock('[appointment-request] created', 1);
    assert.ok(!/\bserviceName\s*:/.test(block), 'found raw serviceName field in slot-based booking log');
    assert.ok(!/\bpractitionerName\s*:/.test(block), 'found raw practitionerName field in slot-based booking log');
    assert.ok(/\bserviceId\s*:\s*summarizeIdentifier\(/.test(block), 'expected serviceId (summarized) to remain');
    assert.ok(/\bpractitionerId\s*:\s*summarizeIdentifier\(/.test(block), 'expected practitionerId (summarized) to remain');
    assert.ok(!block.includes(RAW_SERVICE_NAME), 'fixture service name unexpectedly present in log block source');
    assert.ok(!block.includes(RAW_PRACTITIONER_NAME), 'fixture practitioner name unexpectedly present in log block source');
  });

  await test('sanity: the two appointment-request-created call sites are distinct occurrences', () => {
    const first = processorSource.indexOf('[appointment-request] created');
    const second = processorSource.indexOf('[appointment-request] created', first + 1);
    assert.ok(first >= 0 && second > first, 'expected exactly two distinct call sites');
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
