/**
 * platformSecurityIncidentsLogPrivacy.test.ts — F3-IMPL-006 (PII/PHI Runtime
 * Log Hygiene Wave 2) regression tests confirming
 * server/src/routes/platformSecurityIncidents.ts never writes a raw caught
 * error's `.message` to the process logs at its 8 fixed lifecycle-mutation
 * call sites (acknowledge/investigate/contain/resolve/close/false-positive/
 * reopen/add-note).
 *
 * Each of these 8 routes accepts a free-text staff `note`, `containmentSummary`,
 * or `resolutionSummary` field (up to 2000 chars) that is passed directly as
 * an argument to the corresponding securityIncidentService.ts write call
 * (acknowledgeIncident/startInvestigation/containIncident/resolveIncident/
 * closeIncident/markFalsePositive/reopenIncident/addIncidentNote). Previously,
 * `console.error(label, err instanceof Error ? err.message : String(err))`
 * logged the raw `.message` from that write — a Prisma validation failure
 * could echo the free-text field straight into the log.
 *
 * The remaining 5 read-only sites (summary/list/get/activity/assign) take
 * only ids/enums as arguments and are correctly left untouched (still using
 * `err instanceof Error ? err.message : String(err)`) — this suite asserts
 * that too, so a future edit can't silently regress the "only fix sites that
 * carry free text" scope decision.
 *
 * The route handlers are not exported/independently callable without a live
 * Express req/res + authenticatePlatformAdmin + Prisma-backed service call,
 * so — mirroring whatsappRouteLogPrivacy.test.ts / routeErrorLogPrivacy.test.ts
 * — this suite uses a static source scan as the primary defense.
 *
 * Run with: cd server && npx tsx src/tests/platformSecurityIncidentsLogPrivacy.test.ts
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
  fileURLToPath(new URL('../routes/platformSecurityIncidents.ts', import.meta.url)),
  'utf8',
);

function extractLogCallBlock(distinguishingLiteral: string, window = 260): string {
  const literalIndex = routeSource.indexOf(distinguishingLiteral);
  assert.ok(literalIndex >= 0, `expected to find "${distinguishingLiteral}" in platformSecurityIncidents.ts`);
  const callStart = routeSource.lastIndexOf('console.', literalIndex);
  assert.ok(callStart >= 0, `expected a console.* call before "${distinguishingLiteral}"`);
  return routeSource.slice(callStart, callStart + window);
}

async function main() {
  section('Fix — platformSecurityIncidents.ts: 8 free-text-carrying lifecycle mutations no longer log raw err.message');

  await test('imports safeErrorFields', () => {
    assert.ok(
      /import\s*\{\s*safeErrorFields\s*\}\s*from\s*['"]\.\.\/utils\/safeError\.js['"]/.test(routeSource),
      'expected safeErrorFields import',
    );
  });

  const fixedLabels = [
    '[platform-security-incidents] acknowledge failed',
    '[platform-security-incidents] investigate failed',
    '[platform-security-incidents] contain failed',
    '[platform-security-incidents] resolve failed',
    '[platform-security-incidents] close failed',
    '[platform-security-incidents] false-positive failed',
    '[platform-security-incidents] reopen failed',
    '[platform-security-incidents] add note failed',
  ];

  for (const label of fixedLabels) {
    await test(`${label} log uses safeErrorFields(err), not raw err.message`, () => {
      const block = extractLogCallBlock(label);
      assert.ok(/safeErrorFields\(err\)/.test(block), 'expected safeErrorFields(err) call');
      assert.ok(!/err instanceof Error \? err\.message/.test(block), 'found the old raw err.message fallback');
      assert.ok(!/String\(err\)/.test(block), 'found the old raw String(err) fallback');
    });
  }

  section('Untouched siblings — 5 ids/enums-only read routes still use the pre-existing err.message pattern');

  const untouchedLabels = [
    '[platform-security-incidents] summary failed',
    '[platform-security-incidents] list failed',
    '[platform-security-incidents] get failed',
    '[platform-security-incidents] activity failed',
    '[platform-security-incidents] assign failed',
  ];

  for (const label of untouchedLabels) {
    await test(`${label} log is unchanged (still err instanceof Error ? err.message : String(err))`, () => {
      const block = extractLogCallBlock(label);
      assert.ok(
        /err instanceof Error \? err\.message : String\(err\)/.test(block),
        `${label}: expected the untouched sibling pattern to remain exactly as before`,
      );
    });
  }

  section('F3-IMPL-006: safeErrorFields strips a free-text staff note fixture from a Prisma-shaped error');

  const { safeErrorFields } = await import('../utils/safeError.js');

  await test('strips a raw incident-note/summary fixture embedded in a Prisma validation error', () => {
    const noteFixture = 'Confirmed: patient email export accidentally sent to wrong recipient (ayse.yilmaz@example.com)';
    const err = Object.assign(
      new Error(`Argument \`note\` invalid. Attempted data: { note: "${noteFixture}" }`),
      { name: 'PrismaClientValidationError', code: 'P2009' },
    );
    const fields = safeErrorFields(err);
    const serialized = JSON.stringify(fields);
    assert.deepEqual(fields, { errorName: 'PrismaClientValidationError', errorCode: 'P2009' });
    assert.ok(!serialized.includes(noteFixture), 'raw incident note fixture leaked through safeErrorFields output');
    assert.ok(!serialized.includes('ayse.yilmaz@example.com'), 'raw email embedded in the note fixture leaked through');
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
