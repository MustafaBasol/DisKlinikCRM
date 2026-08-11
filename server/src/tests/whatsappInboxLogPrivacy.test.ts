/**
 * whatsappInboxLogPrivacy.test.ts — F3-IMPL-006 (PII/PHI Runtime Log Hygiene
 * Wave 2) regression tests confirming server/src/routes/whatsappInbox.ts
 * never writes a raw caught error object to the process logs at any of its
 * 8 fixed RAW_ERROR_REQUIRES_SAFE_ERROR_FIELDS call sites.
 *
 * Each site previously logged the raw caught `error` from a Prisma
 * write/provider call whose arguments carried a real patient phone number,
 * patient name, and/or raw WhatsApp message text:
 *   1. list-unassigned error       — phone-variant Prisma lookup (real phone digits)
 *   2. resolve backfill failed     — backfillConversationMessagePatient({phone})
 *   3. link-patient backfill failed — backfillConversationMessagePatient({phone})
 *   4. get-messages error          — WhatsAppConversationMessage findMany({phone})
 *   5. reply persistence failed    — persistWhatsAppConversationMessage({phone, text})
 *   6. reply error                 — sendWhatsAppMessage(clinicId, {phone, text}) (provider call)
 *   7. create-appointment-request error — appointmentRequest.create({patientName, phone, notes})
 *   8. create-appointment error    — appointment.create({notes: '...Telefon: ${entry.phone}'})
 *
 * The containing route handlers are not exported/independently callable
 * without a live Express req/res + Prisma-backed transaction, so — mirroring
 * whatsappRouteLogPrivacy.test.ts and routeErrorLogPrivacy.test.ts — this
 * suite uses a static source scan as the primary defense: it locates each
 * fixed call-site block by its distinguishing literal and asserts the raw
 * `error` argument is gone and `safeErrorFields(error)` is present, plus a
 * runtime check proving a phone/patient-name/message-text fixture embedded
 * in a provider-shaped error never survives into safeErrorFields' output.
 *
 * Run with: cd server && npx tsx src/tests/whatsappInboxLogPrivacy.test.ts
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
  fileURLToPath(new URL('../routes/whatsappInbox.ts', import.meta.url)),
  'utf8',
);

/** Extracts the source text of a console.*(...) call by its distinguishing
 * literal, from the console.* token through a generous fixed window. */
function extractLogCallBlock(distinguishingLiteral: string, window = 300): string {
  const literalIndex = routeSource.indexOf(distinguishingLiteral);
  assert.ok(literalIndex >= 0, `expected to find "${distinguishingLiteral}" in whatsappInbox.ts`);
  const callStart = routeSource.lastIndexOf('console.', literalIndex);
  assert.ok(callStart >= 0, `expected a console.* call before "${distinguishingLiteral}"`);
  return routeSource.slice(callStart, callStart + window);
}

async function main() {
  section('Fix — whatsappInbox.ts: no raw error object at any of the 8 fixed call sites');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(routeSource),
      'expected safeErrorFields import',
    );
  });

  const fixedLabels = [
    '[whatsapp-inbox] list-unassigned error',
    '[whatsapp-inbox] resolve backfill failed',
    '[whatsapp-inbox] link-patient backfill failed',
    '[whatsapp-inbox] get-messages error',
    '[whatsapp-inbox] reply persistence failed',
    '[whatsapp-inbox] reply error',
    '[whatsapp-inbox] create-appointment-request error',
    '[whatsapp-inbox] create-appointment error',
  ];

  for (const label of fixedLabels) {
    await test(`${label} log uses safeErrorFields(error), not the raw caught error`, () => {
      const block = extractLogCallBlock(label);
      assert.ok(/safeErrorFields\(error\)/.test(block), 'expected safeErrorFields(error) call');
      assert.ok(!new RegExp(`${label.replace(/[[\]]/g, '\\$&')}',\\s*error\\)`).test(block), 'found raw unqualified `error` argument');
    });
  }

  await test('sanity: all 8 fixed labels are distinct call sites in the file', () => {
    const seen = new Set<number>();
    for (const label of fixedLabels) {
      const idx = routeSource.indexOf(label);
      assert.ok(idx >= 0, `expected to find "${label}"`);
      assert.ok(!seen.has(idx), `duplicate index detected for "${label}"`);
      seen.add(idx);
    }
  });

  section('F3-IMPL-006: safeErrorFields strips patient phone/name/message-text fixtures');

  const { safeErrorFields } = await import('../utils/safeError.js');

  await test('strips a raw patient phone number embedded in a Prisma-shaped error', () => {
    const phoneFixture = '905551234567';
    const err = Object.assign(
      new Error(`Argument \`phone\` invalid. Attempted data: { phone: "${phoneFixture}" }`),
      { name: 'PrismaClientValidationError', code: 'P2009' },
    );
    const fields = safeErrorFields(err);
    assert.deepEqual(fields, { errorName: 'PrismaClientValidationError', errorCode: 'P2009' });
    assert.ok(!JSON.stringify(fields).includes(phoneFixture), 'raw phone number leaked through safeErrorFields output');
  });

  await test('strips a raw patient name + WhatsApp message text embedded in a provider-shaped error', () => {
    const patientNameFixture = 'Mehmet Demir';
    const messageTextFixture = 'Merhaba, randevumu değiştirmek istiyorum';
    const err = Object.assign(
      new Error(`WhatsApp send failed for recipient "${patientNameFixture}" with body: "${messageTextFixture}"`),
      { name: 'ProviderSendError', code: 'SEND_FAILED' },
    );
    const fields = safeErrorFields(err);
    const serialized = JSON.stringify(fields);
    assert.deepEqual(fields, { errorName: 'ProviderSendError', errorCode: 'SEND_FAILED' });
    assert.ok(!serialized.includes(patientNameFixture), 'raw patient name leaked through safeErrorFields output');
    assert.ok(!serialized.includes(messageTextFixture), 'raw message text leaked through safeErrorFields output');
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
