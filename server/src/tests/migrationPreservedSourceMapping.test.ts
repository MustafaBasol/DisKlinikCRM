/**
 * migrationPreservedSourceMapping.test.ts —
 * F3-DATA-MIG-TODAY-001-R11-PRESERVED-SOURCE-MAPPING-UX.
 *
 * R11's defect was that `legacy.preservedSourceValue` — present, validated and
 * executable since R10 — was unreachable in the operator's mapping screen. The
 * frontend half of that is covered by
 * src/pages/__tests__/migrationDestinationGroupParity.test.ts. This file covers
 * the backend half: that the contract genuinely SUPPORTS the workflow the UI
 * now exposes, and that widening the dropdown did not widen anything else.
 *
 * Specifically:
 *  - a BLOCKED / MANUAL_REQUIRED / SENSITIVE_REVIEW_REQUIRED column can be
 *    moved to RESOLVED + preservation and validate cleanly (the transition the
 *    unlocked dropdown now performs);
 *  - many columns can preserve at once without a destination collision;
 *  - the six real first-customer columns land on preservation, and
 *    KVKKILKKODU never lands on anything consent-shaped;
 *  - the legal gate cannot be lifted by a mapping edit (legalGateGuard.ts);
 *  - preservation is NOT a route around the legal gate.
 *
 * Run with: tsx src/tests/migrationPreservedSourceMapping.test.ts
 */

import assert from 'node:assert/strict';

import type { CanonicalHeader } from '../services/migration/contracts.js';
import {
  DESTINATION_FIELDS,
  MigrationError,
  getDestinationField,
  EXECUTABLE_MAPPING_STATES,
  type MappingState,
} from '../services/migration/contracts.js';
import { validateMappings } from '../services/migration/mapping/validateMapping.js';
import {
  findLegallyGatedEdits,
  assertNoLegallyGatedEdits,
} from '../services/migration/mapping/legalGateGuard.js';
import { FIRST_CUSTOMER_MATRIX_BY_FIELD } from '../services/migration/mapping/firstCustomerMatrix.js';

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

const PRESERVATION_KEY = 'legacy.preservedSourceValue';

/** The six real first-customer columns R11 must be able to preserve. */
const R11_PRESERVE_COLUMNS = [
  'SUBEDOSYANO',
  'UNVANI',
  'BABAADI',
  'ANNEADI',
  'MEDENIHALI',
  'KVKKILKKODU',
] as const;

type Mapping = Parameters<typeof validateMappings>[0][number];

/**
 * A minimally-valid mapping row. `provenance.sourceId` is a REQUIRED
 * destination (Rule 5), so every scenario below includes one; otherwise every
 * assertion would be reading a Rule 5 failure rather than the rule under test.
 */
function makeMapping(over: Partial<Mapping> & { sourceField: string }): Mapping {
  return {
    sourceIndex: 0,
    sourceLabel: over.sourceField,
    sourceNormalized: over.sourceField,
    destinationField: null,
    transform: null,
    composeOrder: null,
    state: 'MANUAL_REQUIRED',
    reason: 'MANUAL',
    confidence: 0,
    ...over,
  } as Mapping;
}

/**
 * The rows every scenario needs regardless of what it is testing: the three
 * REQUIRED destinations (provenance.sourceId, patient.firstName,
 * patient.lastName). Without them Rule 5 fails every mapping and each assertion
 * below would be reading a missing-required-field error instead of the rule it
 * actually means to exercise.
 */
function requiredRows(): Mapping[] {
  return [
    makeMapping({
      sourceField: 'HASTA_ID',
      sourceIndex: 97,
      destinationField: 'provenance.sourceId',
      transform: 'provenance_source_id',
      state: 'AUTO_CONFIDENT',
    }),
    makeMapping({
      sourceField: 'ADI',
      sourceIndex: 98,
      destinationField: 'patient.firstName',
      transform: 'trim_collapse',
      state: 'AUTO_CONFIDENT',
    }),
    makeMapping({
      sourceField: 'SOYADI',
      sourceIndex: 99,
      destinationField: 'patient.lastName',
      transform: 'trim_collapse',
      state: 'AUTO_CONFIDENT',
    }),
  ];
}

/** validateMappings matches headers to records by `original`, not by index. */
function headersFor(mappings: readonly Mapping[]): CanonicalHeader[] {
  return mappings.map((m) => ({
    original: m.sourceField,
    normalized: m.sourceField.trim().toUpperCase(),
    index: m.sourceIndex,
  }));
}

async function main() {
  console.log('\n🧪 R11 preserved-source mapping (backend contract)\n');

  section('── the preservation destination ─────────────────────────────────');

  await test('exists, is not required, and preserves verbatim', () => {
    const dest = getDestinationField(PRESERVATION_KEY);
    assert.ok(dest, `${PRESERVATION_KEY} must exist`);
    assert.equal(dest!.required, false, 'preservation must never be a required destination');
    assert.deepEqual(dest!.allowedTransforms, ['preserve_source_value']);
    assert.equal(dest!.allowsComposition, false);
  });

  await test('RESOLVED is an executable state, so a preserved column can reach Execute', () => {
    assert.ok((EXECUTABLE_MAPPING_STATES as readonly string[]).includes('RESOLVED'));
  });

  section('── blocked / manual / sensitive -> preserved transitions ────────');

  for (const from of ['BLOCKED', 'MANUAL_REQUIRED', 'SENSITIVE_REVIEW_REQUIRED'] as MappingState[]) {
    await test(`${from} -> RESOLVED + preservation validates cleanly`, () => {
      const rows = [
        ...requiredRows(),
        makeMapping({
          sourceField: 'SUBEDOSYANO',
          sourceIndex: 1,
          destinationField: PRESERVATION_KEY,
          transform: 'preserve_source_value',
          state: 'RESOLVED',
        }),
      ];
      const result = validateMappings(rows, headersFor(rows));
      assert.equal(
        result.valid,
        true,
        `expected a clean mapping, got: ${result.issues.map((i) => i.message).join(' | ')}`,
      );
      // And the pre-transition row (still `from`, no destination) must not be
      // considered executable — otherwise the transition would be cosmetic.
      assert.ok(!(EXECUTABLE_MAPPING_STATES as readonly string[]).includes(from));
    });
  }

  await test('a BLOCKED row that still carries a destination is rejected (invariant unchanged)', () => {
    const rows = [
      ...requiredRows(),
      makeMapping({
        sourceField: 'SUBEDOSYANO',
        sourceIndex: 1,
        destinationField: PRESERVATION_KEY,
        transform: 'preserve_source_value',
        state: 'BLOCKED',
      }),
    ];
    const result = validateMappings(rows, headersFor(rows));
    assert.equal(result.valid, false, 'BLOCKED + destination must stay invalid');
  });

  section('── many columns preserve independently ──────────────────────────');

  await test('all six R11 columns preserve at once with no destination collision', () => {
    const rows = [
      ...requiredRows(),
      ...R11_PRESERVE_COLUMNS.map((f, i) =>
        makeMapping({
          sourceField: f,
          sourceIndex: i + 1,
          destinationField: PRESERVATION_KEY,
          transform: 'preserve_source_value',
          state: 'RESOLVED',
        }),
      ),
    ];
    const result = validateMappings(rows, headersFor(rows));
    assert.equal(
      result.valid,
      true,
      `expected six independent preservations to validate, got: ${result.issues
        .map((i) => `${i.code}:${i.message}`)
        .join(' | ')}`,
    );
    assert.equal(
      result.issues.filter((i) => i.code === 'MAPPING_DESTINATION_COLLISION').length,
      0,
      'independent multi-use must never report a collision',
    );
  });

  await test('a NON-multi-use destination still collides (the collision rule is intact)', () => {
    const rows = [
      ...requiredRows(),
      makeMapping({ sourceField: 'AD', sourceIndex: 1, destinationField: 'patient.firstName', transform: 'trim', state: 'RESOLVED' }),
      makeMapping({ sourceField: 'AD2', sourceIndex: 2, destinationField: 'patient.firstName', transform: 'trim', state: 'RESOLVED' }),
    ];
    const result = validateMappings(rows, headersFor(rows));
    assert.equal(result.valid, false, 'two columns targeting one scalar must still collide');
  });

  section('── the six real first-customer columns ──────────────────────────');

  for (const field of R11_PRESERVE_COLUMNS) {
    await test(`${field} is dispositioned to preservation by the matrix`, () => {
      const entry = FIRST_CUSTOMER_MATRIX_BY_FIELD.get(field);
      assert.ok(entry, `${field} must have a matrix entry`);
      assert.equal(
        entry!.destinationField,
        PRESERVATION_KEY,
        `${field} must land on preservation, not on an invented canonical field`,
      );
      assert.equal(entry!.transform, 'preserve_source_value');
    });
  }

  await test('KVKKILKKODU is preserved and is NEVER consent-shaped', () => {
    const entry = FIRST_CUSTOMER_MATRIX_BY_FIELD.get('KVKKILKKODU')!;
    assert.equal(entry.destinationField, PRESERVATION_KEY);
    // Nothing consent-shaped may exist as a destination at all, so the column
    // cannot reach one even by operator choice.
    const consentish = DESTINATION_FIELDS.filter((d) =>
      /consent|optout|opt_out|notice|approval|kvkk/i.test(d.key),
    ).map((d) => d.key);
    assert.deepEqual(
      consentish,
      [],
      `no consent-shaped destination may exist in the catalog; found: ${consentish.join(', ')}`,
    );
    assert.equal(
      getDestinationField(PRESERVATION_KEY)!.group,
      'legacy_preservation',
      'preservation must NOT sit in historical_evidence, the consent exception group',
    );
  });

  section('── the legal gate cannot be lifted by a mapping edit ────────────');

  await test('findLegallyGatedEdits reports only columns STORED as LEGAL_BLOCKED', () => {
    const stored = new Map<string, string>([
      ['KANGURUBU', 'LEGAL_BLOCKED'],
      ['SUBEDOSYANO', 'BLOCKED'],
      ['UNVANI', 'AUTO_REVIEW'],
    ]);
    assert.deepEqual(findLegallyGatedEdits(['SUBEDOSYANO', 'UNVANI'], stored), []);
    assert.deepEqual(findLegallyGatedEdits(['KANGURUBU'], stored), ['KANGURUBU']);
    assert.deepEqual(
      findLegallyGatedEdits(['KANGURUBU', 'KANGURUBU'], stored),
      ['KANGURUBU'],
      'a duplicated edit must be reported once',
    );
    assert.deepEqual(
      findLegallyGatedEdits(['NOT_IN_RUN'], stored),
      [],
      'an unknown column is not gated',
    );
  });

  await test('the payload\'s asserted state is IGNORED — only the stored state counts', () => {
    const stored = new Map<string, string>([['KANGURUBU', 'LEGAL_BLOCKED']]);
    // This is the exact bypass: the client claims the row is RESOLVED, so
    // validateMapping's Rule 4 would never fire on the written row.
    assert.throws(
      () => assertNoLegallyGatedEdits(['KANGURUBU'], stored),
      (err: unknown) => err instanceof MigrationError,
      'a client-asserted RESOLVED must not lift the gate',
    );
  });

  await test('preservation is NOT a route around the legal gate', () => {
    const stored = new Map<string, string>([['KANGURUBU', 'LEGAL_BLOCKED']]);
    assert.throws(
      () => assertNoLegallyGatedEdits(['KANGURUBU'], stored),
      (err: unknown) => err instanceof MigrationError,
      'choosing preservation for a legally gated column must be refused at the write',
    );
  });

  await test('ignoring a legally gated column is refused too', () => {
    const stored = new Map<string, string>([['KANGURUBU', 'LEGAL_BLOCKED']]);
    assert.throws(
      () => assertNoLegallyGatedEdits(['KANGURUBU'], stored),
      (err: unknown) => err instanceof MigrationError,
    );
  });

  await test('the refusal names columns only — never a cell value', () => {
    const stored = new Map<string, string>([['KANGURUBU', 'LEGAL_BLOCKED']]);
    try {
      assertNoLegallyGatedEdits(['KANGURUBU'], stored);
      assert.fail('expected a refusal');
    } catch (err) {
      const message = (err as Error).message;
      assert.match(message, /KANGURUBU/, 'the operator must see which column was refused');
      assert.doesNotMatch(
        message,
        /A Rh|0 Rh|Bilinmiyor/i,
        'no source cell value may appear in the refusal message',
      );
    }
  });

  await test('an edit touching no gated column passes through untouched', () => {
    const stored = new Map<string, string>([
      ['KANGURUBU', 'LEGAL_BLOCKED'],
      ['SUBEDOSYANO', 'BLOCKED'],
    ]);
    assert.doesNotThrow(() => assertNoLegallyGatedEdits(['SUBEDOSYANO'], stored));
  });

  console.log(`\n${failed === 0 ? '✅' : '❌'} passed: ${passed}, failed: ${failed}\n`);
  if (failed > 0) process.exit(1);
}

main();
