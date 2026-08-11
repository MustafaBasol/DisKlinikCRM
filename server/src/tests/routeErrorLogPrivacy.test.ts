/**
 * routeErrorLogPrivacy.test.ts — regression tests for F3-IMPL-004 (PII/PHI
 * Runtime Log Hygiene Wave 1).
 *
 * Root cause covered by all 7 sections below: `console.error(label, err?.message
 * ?? err)` (or similar) logs the raw error `.message` from a Prisma write whose
 * input arguments embed PII/PHI. Node/Prisma's `PrismaClientValidationError.message`
 * pretty-prints the full attempted call arguments, so a validation failure on any
 * of these writes would have echoed the sensitive field(s) straight into the log.
 *
 * Each section below is a static source scan (mirrors the pattern in
 * whatsappBookingFlowLogRedaction.test.ts) that:
 *   1. Locates the specific console.error/warn call by its distinguishing label.
 *   2. Asserts the block now reports only stable error metadata (safeErrorFields(...)
 *      or an inline `instanceof Error ? err.name : '...'` fallback) instead of the
 *      raw `.message` / raw error object.
 *   3. Asserts the raw-leaking shape (`.message`, bare `?? err`) is no longer present.
 *
 * A source scan (rather than a full route-level runtime capture) is used
 * throughout per the task's stated time budget; each site is a one-line
 * console.error/warn call in an Express route handler that isn't easily
 * unit-testable in isolation without heavy req/res/Prisma mocking.
 *
 * Run with: cd server && npx tsx src/tests/routeErrorLogPrivacy.test.ts
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

function readSource(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

/** Extracts the source text of a console.error/warn(...) call by its
 * distinguishing literal (e.g. the log label string), from the console.
 * token through a generous window past the closing paren. */
function extractLogCallBlock(source: string, distinguishingLiteral: string): string {
  const literalIndex = source.indexOf(distinguishingLiteral);
  assert.ok(literalIndex >= 0, `expected to find "${distinguishingLiteral}" in source`);
  const callStart = source.lastIndexOf('console.', literalIndex);
  assert.ok(callStart >= 0, `expected a console.* call before "${distinguishingLiteral}"`);
  return source.slice(callStart, callStart + 300);
}

async function main() {
  // ── Fix 1 — server/src/routes/users.ts ────────────────────────────────
  section('Fix 1 — users.ts onboarding email failure (recipient address in SMTP bounce text)');

  const usersSource = readSource('../routes/users.ts');

  await test('[users.create] onboarding email failure log no longer includes raw err.message', () => {
    const block = extractLogCallBlock(usersSource, '[users.create] onboarding email failed');
    assert.ok(
      /err instanceof Error \? err\.name : 'MailError'/.test(block),
      'expected inline instanceof-Error name fallback',
    );
    assert.ok(!/\$\{err\?\.message\}/.test(block), 'found raw ${err?.message} template interpolation');
    assert.ok(!/err\.message/.test(block), 'found raw err.message reference');
  });

  // ── Fix 2 — server/src/routes/usersImport.ts ──────────────────────────
  section('Fix 2 — usersImport.ts invitation email failure (recipient address in SMTP bounce text)');

  const usersImportSource = readSource('../routes/usersImport.ts');

  await test('[users/import-confirm] invitation email failure log no longer includes raw mailErr.message', () => {
    const block = extractLogCallBlock(usersImportSource, '[users/import-confirm] invitation email failed');
    assert.ok(
      /mailErr instanceof Error \? mailErr\.name : 'MailError'/.test(block),
      'expected inline instanceof-Error name fallback',
    );
    assert.ok(!/\$\{mailErr\?\.message\}/.test(block), 'found raw ${mailErr?.message} template interpolation');
    assert.ok(!/mailErr\.message/.test(block), 'found raw mailErr.message reference');
  });

  // ── Fix 3 — server/src/routes/patientMedicalHistory.ts ────────────────
  section('Fix 3 — patientMedicalHistory.ts create error (allergies/medications/pregnancy PHI)');

  const patientMedicalHistorySource = readSource('../routes/patientMedicalHistory.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(patientMedicalHistorySource),
      'expected safeErrorFields import',
    );
  });

  await test('[patientMedicalHistory] create error log uses safeErrorFields, not raw err.message', () => {
    const block = extractLogCallBlock(patientMedicalHistorySource, '[patientMedicalHistory] create error');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
    assert.ok(!/\?\?\s*err\)/.test(block), 'found raw bare-error fallback (?? err)');
  });

  // ── Fix 4 — server/src/routes/dentalChart.ts ───────────────────────────
  section('Fix 4 — dentalChart.ts save error (tooth free-text clinical note)');

  const dentalChartSource = readSource('../routes/dentalChart.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(dentalChartSource),
      'expected safeErrorFields import',
    );
  });

  await test('[dental-chart] save error log uses safeErrorFields, not raw err.message', () => {
    const block = extractLogCallBlock(dentalChartSource, '[dental-chart] save error');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
    assert.ok(!/\?\?\s*err\)/.test(block), 'found raw bare-error fallback (?? err)');
  });

  // ── Fix 5 — server/src/routes/imaging.ts ───────────────────────────────
  section('Fix 5 — imaging.ts upload error (originalName/description PHI, filenames must never log)');

  const imagingSource = readSource('../routes/imaging.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(imagingSource),
      'expected safeErrorFields import',
    );
  });

  await test('[imaging] upload error log uses safeErrorFields, not raw err.message', () => {
    const block = extractLogCallBlock(imagingSource, '[imaging] upload error');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
    assert.ok(!/\?\?\s*err\)/.test(block), 'found raw bare-error fallback (?? err)');
  });

  // ── Fix 6 — server/src/routes/imagingBridgePublic.ts ───────────────────
  section('Fix 6 — imagingBridgePublic.ts upload error (originalName PHI, header bans PHI/PII in logs)');

  const imagingBridgePublicSource = readSource('../routes/imagingBridgePublic.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(imagingBridgePublicSource),
      'expected safeErrorFields import',
    );
  });

  await test('[imaging-bridge] upload error log uses safeErrorFields, not raw err.message', () => {
    const block = extractLogCallBlock(imagingBridgePublicSource, '[imaging-bridge] upload error');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
    assert.ok(!/\?\?\s*err\)/.test(block), 'found raw bare-error fallback (?? err)');
  });

  // ── Fix 7 — server/src/routes/treatmentCases.ts ────────────────────────
  section('Fix 7 — treatmentCases.ts material create error (inventory transaction free-text notes)');

  const treatmentCasesSource = readSource('../routes/treatmentCases.ts');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(treatmentCasesSource),
      'expected safeErrorFields import',
    );
  });

  await test('Treatment material create error log uses safeErrorFields, not raw err.message', () => {
    const block = extractLogCallBlock(treatmentCasesSource, 'Treatment material create error');
    assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
    assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
  });

  // ── safeErrorFields behavior sanity check ──────────────────────────────
  section('safeErrorFields — shared helper behavior');

  const { safeErrorFields } = await import('../utils/safeError.js');

  await test('extracts stable name/code and drops raw message content', () => {
    const phiFixture = 'Argument `notes` must not be null. Attempted data: { notes: "Hasta Ayşe Yılmaz - alerji notu" }';
    const err = Object.assign(new Error(phiFixture), { name: 'PrismaClientValidationError', code: 'P2009' });
    const fields = safeErrorFields(err);
    const serialized = JSON.stringify(fields);
    assert.equal(fields.errorName, 'PrismaClientValidationError');
    assert.equal(fields.errorCode, 'P2009');
    assert.ok(!serialized.includes('Ayşe Yılmaz'), 'PHI fixture leaked through safeErrorFields output');
    assert.ok(!serialized.includes(phiFixture), 'raw message leaked through safeErrorFields output');
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
