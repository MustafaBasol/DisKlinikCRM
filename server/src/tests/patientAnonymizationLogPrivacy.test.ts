/**
 * patientAnonymizationLogPrivacy.test.ts — F3-IMPL-006 (Wave 2) regression
 * test confirming server/src/services/privacy/patientAnonymization.ts never
 * writes a raw caught error object to the process logs.
 *
 * Covers two confirmed RAW_ERROR sites, both of which used to log the raw
 * `err` directly next to the affected row's id:
 *   1. redactPatientAttachments      — '[patientAnonymization] attachment redaction failed'
 *   2. redactPatientImagingImages    — '[patientAnonymization] imaging image redaction failed'
 * Both writes touch a Prisma `update`/lifecycle-port call for a specific
 * patient's attachment/imaging row; a validation error on either could echo
 * back argument detail (a local file path, storage key, or similar). The fix
 * replaces the raw `err` with safeErrorFields(err)
 * (server/src/utils/safeError.ts), which returns only {errorName, errorCode}.
 *
 * anonymizePatientData() itself performs ~15 real Prisma calls against the
 * shared, non-injected `prisma` client (patient/contactRequest/
 * appointmentRequest/whatsApp* /instagram* /activityLog/privacyRequest, plus
 * writeAuditLog/logActivity) with no dependency-injection seam, so — like
 * instagramAiConversationProcessorLogPrivacy.test.ts /
 * metaWhatsAppAiProcessorLogPrivacy.test.ts — a runtime DB-less exercise of
 * the real call path is out of scope for this bounded fix. Primary defense
 * is a static source scan of both call sites, backstopped by a direct
 * safeErrorFields unit check.
 *
 * Run with: cd server && npx tsx src/tests/patientAnonymizationLogPrivacy.test.ts
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

const RAW_STORAGE_PATH_FIXTURE = '/var/lib/noramedi/uploads/clinic-1/attachment-905551234567.pdf';

const anonymizationSource = readFileSync(
  fileURLToPath(new URL('../services/privacy/patientAnonymization.ts', import.meta.url)),
  'utf8',
);

function extractLogCallBlock(distinguishingLiteral: string): string {
  const literalIndex = anonymizationSource.indexOf(distinguishingLiteral);
  assert.ok(literalIndex >= 0, `expected to find "${distinguishingLiteral}" in patientAnonymization.ts`);
  const callStart = anonymizationSource.lastIndexOf('console.', literalIndex);
  assert.ok(callStart >= 0, `expected a console.* call before "${distinguishingLiteral}"`);
  return anonymizationSource.slice(callStart, callStart + 250);
}

async function main() {
  section('Static source scan — 1/2: attachment redaction failed (raw error)');

  await test('attachment-redaction-failed block uses safeErrorFields(err), not raw err', () => {
    const block = extractLogCallBlock('attachment redaction failed');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/attachment\.id,\s*err\)/.test(block), 'found raw "err" argument, expected it replaced by safeErrorFields(err)');
  });

  section('Static source scan — 2/2: imaging image redaction failed (raw error)');

  await test('imaging-image-redaction-failed block uses safeErrorFields(err), not raw err', () => {
    const block = extractLogCallBlock('imaging image redaction failed');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/image\.id,\s*err\)/.test(block), 'found raw "err" argument, expected it replaced by safeErrorFields(err)');
  });

  section('Unit — safeErrorFields end-to-end: a storage-path-bearing Prisma-shaped error never survives into {errorName, errorCode}');

  await test('safeErrorFields(err) strips a raw-storage-path-bearing Prisma-shaped error down to errorName/errorCode only', async () => {
    const { safeErrorFields } = await import('../utils/safeError.js');
    const err = Object.assign(new Error(`ENOENT: no such file or directory, open '${RAW_STORAGE_PATH_FIXTURE}'`), { code: 'ENOENT' });
    const fields = safeErrorFields(err);
    const serialized = JSON.stringify(fields);
    assert.ok(!serialized.includes(RAW_STORAGE_PATH_FIXTURE), 'raw storage path leaked through safeErrorFields');
    assert.deepEqual(fields, { errorName: 'Error', errorCode: 'ENOENT' }, 'expected only {errorName, errorCode} to survive');
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
