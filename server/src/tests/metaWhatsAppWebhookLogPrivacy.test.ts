/**
 * metaWhatsAppWebhookLogPrivacy.test.ts — F3-IMPL-006 (PII/PHI Runtime Log
 * Hygiene Wave 2) regression tests confirming
 * server/src/routes/metaWhatsAppWebhook.ts never writes a raw caught error
 * object to the process logs at its 2 fixed call sites.
 *
 * Both sites are top-level catches for the global/connection-specific POST
 * webhook handlers, which — on the success path just above the catch — call
 * `routeIncomingMetaMessage(..., phone, text, ...)`, carrying a real patient
 * phone number and the raw inbound WhatsApp message text. Previously
 * `console.error(label, err)` logged the raw caught error unconditionally.
 *
 * The file's other 5 console.* call sites (duplicate-inbound/idempotency-
 * skipped/connection-resolution-failed/verification-failed/no-DB-connection)
 * were already correctly using only ids, counts, and `summarizeProviderId()`-
 * truncated identifiers — they are untouched and asserted here to remain so.
 *
 * Run with: cd server && npx tsx src/tests/metaWhatsAppWebhookLogPrivacy.test.ts
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
  fileURLToPath(new URL('../routes/metaWhatsAppWebhook.ts', import.meta.url)),
  'utf8',
);

function extractLogCallBlock(distinguishingLiteral: string, window = 260): string {
  const literalIndex = routeSource.indexOf(distinguishingLiteral);
  assert.ok(literalIndex >= 0, `expected to find "${distinguishingLiteral}" in metaWhatsAppWebhook.ts`);
  const callStart = routeSource.lastIndexOf('console.', literalIndex);
  assert.ok(callStart >= 0, `expected a console.* call before "${distinguishingLiteral}"`);
  return routeSource.slice(callStart, callStart + window);
}

async function main() {
  section('Fix — metaWhatsAppWebhook.ts: global/connection-specific handler errors no longer log the raw error');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(routeSource),
      'expected safeErrorFields import',
    );
  });

  for (const label of ['[meta-webhook] global handler error:', '[meta-webhook] connectionId handler error:']) {
    await test(`${label} log uses safeErrorFields(err), not raw err`, () => {
      const block = extractLogCallBlock(label);
      assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
      assert.ok(!/error:',\s*err\)/.test(block), 'found raw unqualified `err` argument');
    });
  }

  section('Untouched siblings — 5 already-safe sites (ids/counts/summarized identifiers only)');

  await test('duplicate inbound message skipped log still only logs connectionId/messageId', () => {
    const block = extractLogCallBlock('duplicate inbound message skipped');
    assert.ok(/connectionId/.test(block) && /messageId/.test(block), 'expected connectionId/messageId fields to remain');
    assert.ok(!/safeErrorFields/.test(block), 'unexpectedly touched a non-error metadata log');
  });

  await test('connection resolution failed log still summarizes phoneNumberId (no raw error introduced)', () => {
    const block = extractLogCallBlock('connection resolution failed');
    assert.ok(/summarizeProviderId\(phoneNumberId\)/.test(block), 'expected summarizeProviderId(phoneNumberId) to remain');
  });

  await test('[meta-webhook] verification error: log is unchanged (raw err, POTENTIAL_PII_SAFE_AFTER_REVIEW — ids-only query args)', () => {
    const block = extractLogCallBlock('[meta-webhook] verification error:');
    assert.ok(/verification error:',\s*err\)/.test(block), 'expected the untouched sibling to still log raw err');
  });

  section('F3-IMPL-006: safeErrorFields strips patient phone + WhatsApp message text from a routing-failure fixture');

  const { safeErrorFields } = await import('../utils/safeError.js');

  await test('strips a raw phone + inbound message text embedded in a routing-failure error', () => {
    const phoneFixture = '905551234567';
    const messageTextFixture = 'Randevumu iptal etmek istiyorum, lütfen yardımcı olur musunuz?';
    const err = Object.assign(
      new Error(`Failed to route incoming message from ${phoneFixture}: "${messageTextFixture}"`),
      { name: 'RoutingError', code: 'ROUTE_FAILED' },
    );
    const fields = safeErrorFields(err);
    const serialized = JSON.stringify(fields);
    assert.deepEqual(fields, { errorName: 'RoutingError', errorCode: 'ROUTE_FAILED' });
    assert.ok(!serialized.includes(phoneFixture), 'raw phone number leaked through safeErrorFields output');
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
