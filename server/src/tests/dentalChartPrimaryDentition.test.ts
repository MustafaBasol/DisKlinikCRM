/**
 * dentalChartPrimaryDentition.test.ts — DENTAL-CHART-UX-001
 *
 * Koşturma: cd server && npx tsx src/tests/dentalChartPrimaryDentition.test.ts
 *
 * The dental-chart routes gate every write on a hard-coded VALID_FDI
 * allowlist. Before this task that allowlist held only the permanent arch
 * (11-48), so a paediatric tooth was rejected with 400 no matter what the UI
 * sent — the allowlist was the ONLY thing standing between the product and
 * primary-teeth support, because ToothRecord.toothFdi is a plain `Int` column
 * with no range constraint (prisma/schema.prisma + the add_tooth_records
 * migration), which is also why this change needs no migration.
 *
 * This test parses the allowlist literals out of the shipped route source and
 * asserts their set properties directly, rather than re-declaring the numbers
 * here and testing a copy. Two properties are load-bearing:
 *
 *   1. ADDITIVE — every permanent FDI that was accepted before is still
 *      accepted, and still means the same tooth. Production already holds
 *      ToothRecord rows keyed on those integers.
 *   2. DISJOINT — no integer is valid in both dentitions, so the existing
 *      (patientId, toothFdi) unique key can hold a mixed-dentition child's
 *      permanent and primary records side by side without collision, and a
 *      stored number never needs a companion column to disambiguate it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'dentalChart.ts'), 'utf8');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

/**
 * Pulls a `const NAME = [ ... ];` numeric array literal out of the route
 * source. Throws (rather than returning an empty array) when the declaration
 * is absent or is not a plain numeric literal, so a refactor that replaces the
 * literal with something computed fails loudly instead of passing vacuously
 * against an empty set.
 */
function extractNumberArray(name: string): number[] {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(routeSrc);
  assert.ok(match, `could not find a "const ${name} = [ ... ]" declaration in routes/dentalChart.ts`);
  const body = match![1]!;
  const tokens = body
    .split(',')
    .map((token) => token.replace(/\/\/[^\n]*/g, '').trim())
    .filter((token) => token.length > 0);
  assert.ok(tokens.length > 0, `${name} is empty`);
  for (const token of tokens) {
    assert.match(token, /^\d+$/, `${name} contains a non-numeric entry: ${token}`);
  }
  return tokens.map(Number);
}

const PERMANENT_FDI = extractNumberArray('PERMANENT_FDI');
const PRIMARY_FDI = extractNumberArray('PRIMARY_FDI');
const VALID_FDI = new Set([...PERMANENT_FDI, ...PRIMARY_FDI]);

/** The permanent arch exactly as the route accepted it before this change. */
const LEGACY_VALID_FDI = [
  11, 12, 13, 14, 15, 16, 17, 18,
  21, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 34, 35, 36, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48,
];

async function main() {
  section('── Backward compatibility: nothing that was accepted before is rejected now ──');

  await test('every previously-valid permanent FDI is still accepted', () => {
    for (const fdi of LEGACY_VALID_FDI) {
      assert.ok(VALID_FDI.has(fdi), `FDI ${fdi} was accepted before and must still be accepted`);
    }
  });

  await test('the permanent allowlist is exactly the old one — no adult tooth was added or dropped', () => {
    assert.deepEqual([...PERMANENT_FDI].sort((a, b) => a - b), [...LEGACY_VALID_FDI].sort((a, b) => a - b));
  });

  section('── Primary dentition is accepted ──');

  await test('the primary allowlist is 20 teeth: five per quadrant across quadrants 5-8', () => {
    assert.equal(PRIMARY_FDI.length, 20);
    for (const quadrant of [5, 6, 7, 8]) {
      const inQuadrant = PRIMARY_FDI.filter((fdi) => Math.floor(fdi / 10) === quadrant);
      assert.deepEqual(
        inQuadrant.map((fdi) => fdi % 10).sort(),
        [1, 2, 3, 4, 5],
        `quadrant ${quadrant} must accept positions 1-5`,
      );
    }
  });

  await test('every primary tooth is accepted', () => {
    for (const fdi of [51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85]) {
      assert.ok(VALID_FDI.has(fdi), `primary FDI ${fdi} must be accepted`);
    }
  });

  section('── The two ranges are disjoint, so a stored toothFdi is never ambiguous ──');

  await test('no integer appears in both allowlists', () => {
    const permanent = new Set(PERMANENT_FDI);
    for (const fdi of PRIMARY_FDI) {
      assert.ok(!permanent.has(fdi), `FDI ${fdi} appears in both dentitions`);
    }
  });

  await test('the combined allowlist holds exactly 52 teeth (32 permanent + 20 primary)', () => {
    assert.equal(VALID_FDI.size, 52);
    assert.equal(PERMANENT_FDI.length + PRIMARY_FDI.length, 52, 'a duplicate entry would shrink the Set');
  });

  section('── Invalid numbers are still rejected (the allowlist did not become permissive) ──');

  await test('there is no primary 6th/7th/8th tooth', () => {
    for (const fdi of [56, 57, 58, 66, 67, 68, 76, 77, 78, 86, 87, 88]) {
      assert.ok(!VALID_FDI.has(fdi), `FDI ${fdi} must be rejected — primary quadrants hold only 5 teeth`);
    }
  });

  await test('position 0, quadrant 0, and out-of-range values stay rejected', () => {
    for (const fdi of [0, 10, 19, 20, 29, 30, 39, 40, 49, 50, 59, 60, 69, 70, 79, 80, 89, 90, 91, 99, 100]) {
      assert.ok(!VALID_FDI.has(fdi), `FDI ${fdi} must be rejected`);
    }
  });

  await test('quadrant 9 (which does not exist in FDI notation) is rejected entirely', () => {
    for (let position = 0; position <= 9; position++) {
      assert.ok(!VALID_FDI.has(90 + position), `FDI ${90 + position} must be rejected`);
    }
  });

  section('── The routes still gate on VALID_FDI (the allowlist is actually enforced) ──');

  await test('VALID_FDI is built as the union of the two arrays', () => {
    assert.match(
      routeSrc,
      /const\s+VALID_FDI\s*=\s*new\s+Set\(\[\s*\.\.\.PERMANENT_FDI\s*,\s*\.\.\.PRIMARY_FDI\s*\]\)/,
      'VALID_FDI must be the union of PERMANENT_FDI and PRIMARY_FDI',
    );
  });

  await test('both mutating routes still reject an unknown FDI with 400 before touching the database', () => {
    const guards = routeSrc.match(/if\s*\(!VALID_FDI\.has\(toothFdi\)\)\s*\{\s*return res\.status\(400\)/g) ?? [];
    assert.equal(guards.length, 2, 'the PUT (upsert) and DELETE routes must each keep their VALID_FDI guard');
  });

  await test('no ToothRecord write happens before the FDI guard in the upsert route', () => {
    const guardIndex = routeSrc.indexOf('if (!VALID_FDI.has(toothFdi))');
    const upsertIndex = routeSrc.indexOf('prisma.toothRecord.upsert');
    assert.ok(guardIndex > -1 && upsertIndex > -1, 'expected both the guard and the upsert to be present');
    assert.ok(guardIndex < upsertIndex, 'the FDI guard must run before the upsert');
  });

  section('── No schema change was required ──');

  await test('the Prisma model still declares toothFdi as a plain Int with no range constraint', () => {
    const schemaSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'prisma', 'schema.prisma'), 'utf8');
    const modelStart = schemaSrc.indexOf('model ToothRecord {');
    assert.ok(modelStart > -1, 'model ToothRecord not found');
    // Bounded to the model block. `\n}` alone would match the file's first
    // closing brace on CRLF checkouts, so the search is anchored on the
    // model's own start offset and a newline-agnostic terminator.
    const modelEnd = schemaSrc.indexOf('\n}', modelStart);
    assert.ok(modelEnd > modelStart, 'could not find the end of model ToothRecord');
    const modelBlock = schemaSrc.slice(modelStart, modelEnd);
    assert.match(modelBlock, /toothFdi\s+Int\s*$/m, 'toothFdi must stay a plain Int');
    assert.match(modelBlock, /@@unique\(\[patientId,\s*toothFdi\]\)/, 'the composite unique key must be unchanged');
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
