/**
 * metaWhatsAppAiProcessorLogPrivacy.test.ts — F3-IMPL-006 (Wave 2) regression
 * tests confirming server/src/services/whatsapp/metaWhatsAppAiProcessor.ts
 * never writes a raw caught error object (or its `.message`) to the process
 * logs. Mirrors the sibling instagramAiConversationProcessorLogPrivacy.test.ts
 * (F3-IMPL-004/006) — same architecture (module-private helpers performing
 * real `prisma`/`logActivity` calls against the shared, non-injected `prisma`
 * client), same static-source-scan primary-defense rationale.
 *
 * Covers five confirmed RAW_ERROR/MESSAGE_CONTENT sites:
 *   1. ensureMetaWaContactPatient      — '[meta-wa-assistant] conversation message backfill failed'
 *      (RAW_ERROR: raw error from a WhatsAppConversationMessage patientId-backfill write keyed on phone)
 *   2. logMetaWaReplyFailure           — '[meta-wa-assistant] reply failure activity log failed'
 *      (RAW_ERROR: raw err.message from a failed logActivity write)
 *   3. buildReplyText (booking flow)   — '[meta-wa-assistant] inbox patientId link failed'
 *      (RAW_ERROR: raw error from a whatsAppInboxEntry.update write)
 *   4. processMetaWhatsAppIncomingMessage — '[meta-wa-assistant] failed to persist incoming conversation message'
 *      (MESSAGE_CONTENT: raw error.message from persistWhatsAppConversationMessage,
 *      whose write includes the raw inbound WhatsApp message text)
 *   5. processMetaWhatsAppIncomingMessage — '[meta-wa-assistant] failed to persist outgoing conversation message'
 *      (MESSAGE_CONTENT: same risk as #4, for the AI-generated outgoing reply text)
 * All five are fixed by replacing the raw error argument with
 * safeErrorFields(err) (server/src/utils/safeError.ts), which returns only
 * {errorName, errorCode} — never the original message/object.
 *
 * Run with: cd server && npx tsx src/tests/metaWhatsAppAiProcessorLogPrivacy.test.ts
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

const RAW_PHONE = '905551234567';
const RAW_MESSAGE_TEXT_FIXTURE = 'Merhaba, yarın saat 14:00 için randevu almak istiyorum, telefonum 905551234567';

// ─── Source scan ────────────────────────────────────────────────────────────

const processorSource = readFileSync(
  fileURLToPath(new URL('../services/whatsapp/metaWhatsAppAiProcessor.ts', import.meta.url)),
  'utf8',
);

/** Extracts the source text of the Nth (0-indexed) console.*(...) call
 * matching `distinguishingLiteral`, from the console.* token through well
 * past the matching closing paren. Deliberately generous (450 chars). */
function extractLogCallBlock(distinguishingLiteral: string, occurrence = 0): string {
  let searchFrom = 0;
  let literalIndex = -1;
  for (let i = 0; i <= occurrence; i++) {
    literalIndex = processorSource.indexOf(distinguishingLiteral, searchFrom);
    assert.ok(
      literalIndex >= 0,
      `expected to find occurrence ${i} of "${distinguishingLiteral}" in metaWhatsAppAiProcessor.ts`,
    );
    searchFrom = literalIndex + distinguishingLiteral.length;
  }
  const callStart = processorSource.lastIndexOf('console.', literalIndex);
  assert.ok(callStart >= 0, `expected a console.* call before "${distinguishingLiteral}"`);
  return processorSource.slice(callStart, callStart + 450);
}

async function main() {
  section('Static source scan — 1/5: conversation message backfill failed (raw error)');

  await test('backfill-failed block uses safeErrorFields(error), not raw error', () => {
    const block = extractLogCallBlock('conversation message backfill failed');
    assert.ok(/safeErrorFields\(error\)/.test(block), 'expected safeErrorFields(error) call');
    assert.ok(!/backfill failed',\s*error\)/.test(block), 'found raw "error" argument, expected it replaced by safeErrorFields(error)');
    assert.ok(!block.includes(RAW_PHONE), 'fixture phone unexpectedly present in log block source');
  });

  section('Static source scan — 2/5: reply failure activity log failed (raw error.message)');

  await test('reply-failure-activity-log-failed block uses safeErrorFields(err), not raw err.message', () => {
    const block = extractLogCallBlock('reply failure activity log failed');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/err\.message/.test(block), 'found raw err.message that should have been removed');
  });

  section('Static source scan — 3/5: inbox patientId link failed (raw error)');

  await test('inbox-patientId-link-failed block uses safeErrorFields(error), not raw error', () => {
    const block = extractLogCallBlock('inbox patientId link failed');
    assert.ok(/safeErrorFields\(error\)/.test(block), 'expected safeErrorFields(error) call');
    assert.ok(!/link failed',\s*error\)/.test(block), 'found raw "error" argument, expected it replaced by safeErrorFields(error)');
  });

  section('Static source scan — 4/5 & 5/5: incoming/outgoing conversation message persist failures (raw message text risk)');

  await test('incoming-message-persist-failed block uses safeErrorFields(error), never raw error.message, and omits the fixture text', () => {
    const block = extractLogCallBlock('failed to persist incoming conversation message');
    assert.ok(/\.\.\.safeErrorFields\(error\)/.test(block), 'expected ...safeErrorFields(error) spread');
    assert.ok(!/error\s*:\s*error instanceof Error/.test(block), 'found raw "error: error instanceof Error ? error.message : ..." field that should have been removed');
    assert.ok(!block.includes(RAW_MESSAGE_TEXT_FIXTURE), 'fixture text unexpectedly present in log block source');
    assert.ok(/clinicId\s*:\s*summarizeId\(clinic\.id\)/.test(block), 'expected clinicId (summarized) to remain');
  });

  await test('outgoing-message-persist-failed block uses safeErrorFields(error), never raw error.message, and omits the fixture text', () => {
    const block = extractLogCallBlock('failed to persist outgoing conversation message');
    assert.ok(/\.\.\.safeErrorFields\(error\)/.test(block), 'expected ...safeErrorFields(error) spread');
    assert.ok(!/error\s*:\s*error instanceof Error/.test(block), 'found raw "error: error instanceof Error ? error.message : ..." field that should have been removed');
    assert.ok(!block.includes(RAW_MESSAGE_TEXT_FIXTURE), 'fixture text unexpectedly present in log block source');
    assert.ok(/clinicId\s*:\s*summarizeId\(clinic\.id\)/.test(block), 'expected clinicId (summarized) to remain');
  });

  await test('sanity: the two conversation-message-persist-failed call sites are distinct occurrences', () => {
    const first = processorSource.indexOf('failed to persist incoming conversation message');
    const second = processorSource.indexOf('failed to persist outgoing conversation message');
    assert.ok(first >= 0 && second > first, 'expected exactly two distinct call sites');
  });

  section('Unit — safeErrorFields end-to-end: a Prisma-shaped error embedding the raw phone/message text never survives into {errorName, errorCode}');

  await test('safeErrorFields(err) strips a raw-phone-bearing Prisma-shaped error down to errorName/errorCode only', async () => {
    const { safeErrorFields } = await import('../utils/safeError.js');
    const err = Object.assign(new Error(`Prisma write failed for phone: "${RAW_PHONE}", text: "${RAW_MESSAGE_TEXT_FIXTURE}"`), { code: 'P2000' });
    const fields = safeErrorFields(err);
    const serialized = JSON.stringify(fields);
    assert.ok(!serialized.includes(RAW_PHONE), 'raw phone leaked through safeErrorFields');
    assert.ok(!serialized.includes(RAW_MESSAGE_TEXT_FIXTURE), 'raw message text leaked through safeErrorFields');
    assert.deepEqual(fields, { errorName: 'Error', errorCode: 'P2000' }, 'expected only {errorName, errorCode} to survive');
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
