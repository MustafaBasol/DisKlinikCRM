/**
 * communicationPreferencesLogPrivacy.test.ts — F3-IMPL-006 (PII/PHI Runtime
 * Log Hygiene Wave 2) regression tests confirming
 * server/src/routes/communicationPreferences.ts never writes a raw caught
 * error's `.message` to the process logs at its 8 fixed call sites.
 *
 * Risk recap per site (all previously `console.error(label, err?.message ?? err)`):
 *   1. matrix error                       — near-patient consent-preference read
 *   2. history error                      — channel/purpose/status/source query
 *      params built directly from raw (unvalidated) query-string values
 *   3. export error                       — bulk historical consent-event export
 *      for one patient (same unvalidated query-arg risk as history)
 *   4. mutation error                     — setCommunicationPreference({..., notes})
 *      free-text consent notes as a direct call argument
 *   5. bulk mutation error                — bulkSetCommunicationPreferences({..., notes})
 *      same free-text notes risk
 *   6. legacy correction error            — correctSmsOptOut({..., correctionReason, notes, sourceReference})
 *      free-text correction fields as direct call arguments
 *   7. legacy correction history error    — underlying table has notes/correctionReason
 *      columns even though the list response redacts them
 *   8. legacy correction detail error     — detail read explicitly includes
 *      correctionReason/notes/sourceReference
 *
 * The 2 aggregate/audit-summary sites (clinic-level counts only, never
 * individual patient data) are correctly left untouched and are asserted
 * here to remain so.
 *
 * The route handlers are not exported/independently callable without a live
 * Express req/res + Prisma-backed service call, so this suite uses a static
 * source scan as the primary defense, mirroring routeErrorLogPrivacy.test.ts.
 *
 * Run with: cd server && npx tsx src/tests/communicationPreferencesLogPrivacy.test.ts
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
  fileURLToPath(new URL('../routes/communicationPreferences.ts', import.meta.url)),
  'utf8',
);

function extractLogCallBlock(distinguishingLiteral: string, window = 260): string {
  const literalIndex = routeSource.indexOf(distinguishingLiteral);
  assert.ok(literalIndex >= 0, `expected to find "${distinguishingLiteral}" in communicationPreferences.ts`);
  const callStart = routeSource.lastIndexOf('console.', literalIndex);
  assert.ok(callStart >= 0, `expected a console.* call before "${distinguishingLiteral}"`);
  return routeSource.slice(callStart, callStart + window);
}

async function main() {
  section('Fix — communicationPreferences.ts: 8 sites no longer log raw err.message');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(routeSource),
      'expected safeErrorFields import',
    );
  });

  const fixedLabels = [
    '[communicationPreferences] matrix error:',
    '[communicationPreferences] history error:',
    '[communicationPreferences] export error:',
    '[communicationPreferences] mutation error:',
    '[communicationPreferences] bulk mutation error:',
    '[communicationPreferences] legacy correction error:',
    '[communicationPreferences] legacy correction history error:',
    '[communicationPreferences] legacy correction detail error:',
  ];

  for (const label of fixedLabels) {
    await test(`${label} log uses safeErrorFields(err), not raw err.message`, () => {
      const block = extractLogCallBlock(label);
      assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
      assert.ok(!/err\?\.message/.test(block), 'found raw err?.message reference');
      assert.ok(!/\?\?\s*err\)/.test(block), 'found raw bare-error fallback (?? err)');
    });
  }

  section('Untouched siblings — 2 clinic-level aggregate/audit-summary sites still use raw err?.message ?? err');

  for (const label of ['[communicationPreferences] aggregate error:', '[communicationPreferences] audit-summary error:']) {
    await test(`${label} log is unchanged (still err?.message ?? err — clinic-level counts only, never individual patient data)`, () => {
      const block = extractLogCallBlock(label);
      assert.ok(/err\?\.message\s*\?\?\s*err/.test(block), `${label}: expected the untouched sibling pattern to remain`);
    });
  }

  section('F3-IMPL-006: safeErrorFields strips a free-text consent note / legacy-correction fixture');

  const { safeErrorFields } = await import('../utils/safeError.js');

  await test('strips a raw consent-mutation note fixture embedded in a Prisma validation error', () => {
    const noteFixture = 'Hasta telefonla WhatsApp iletişimine onay verdiğini belirtti (görüşme 2026-01-04)';
    const err = Object.assign(
      new Error(`Argument \`notes\` invalid. Attempted data: { notes: "${noteFixture}" }`),
      { name: 'PrismaClientValidationError', code: 'P2009' },
    );
    const fields = safeErrorFields(err);
    const serialized = JSON.stringify(fields);
    assert.deepEqual(fields, { errorName: 'PrismaClientValidationError', errorCode: 'P2009' });
    assert.ok(!serialized.includes(noteFixture), 'raw consent note fixture leaked through safeErrorFields output');
  });

  await test('strips a raw legacy sms-opt-out correctionReason/sourceReference fixture', () => {
    const correctionReasonFixture = 'Staff mis-entered opt-out for patient during 2024 SMS migration';
    const err = Object.assign(
      new Error(`Argument \`correctionReason\` invalid. Attempted data: { correctionReason: "${correctionReasonFixture}" }`),
      { name: 'PrismaClientValidationError', code: 'P2009' },
    );
    const fields = safeErrorFields(err);
    const serialized = JSON.stringify(fields);
    assert.deepEqual(fields, { errorName: 'PrismaClientValidationError', errorCode: 'P2009' });
    assert.ok(!serialized.includes(correctionReasonFixture), 'raw correctionReason fixture leaked through safeErrorFields output');
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
