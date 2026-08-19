/**
 * migrationMapping.test.ts — F3-DATA-MIG-TODAY-001
 *
 * Verification suite for the migration mapping subsystem:
 *   - firstCustomerMatrix.ts (the accepted 91-column first-customer profile)
 *   - mappingEngine.ts (suggestMappings — deterministic header -> destination)
 *   - transforms.ts (the named, deterministic value transforms)
 *   - validateMapping.ts (the pre-execution gate)
 *
 * Standalone tsx script, node:assert/strict, hand-rolled test()/section()
 * counters — same shape as patientsImportClinicScope.test.ts and
 * migrationPatientSchemaDrift.test.ts. There is no vitest/jest on the server
 * side.
 *
 * Run with: tsx src/tests/migrationMapping.test.ts
 *
 * ---------------------------------------------------------------------------
 * FINDING — decision-count baseline discrepancy (reported, not silently
 * resolved; see the final agent report for full detail)
 * ---------------------------------------------------------------------------
 * The verification brief for this suite anticipated that the sprint which
 * created `patient.identity.tckn` / `patient.gender` / `patient.chartNumber`
 * moved exactly THREE columns (TCNO, CINSIYET, DOSYANO) out of
 * BLOCKED_NO_DESTINATION into IMPORT_AFTER_SCHEMA_FIELD, and therefore
 * expected `IMPORT_AFTER_SCHEMA_FIELD === 4` and `BLOCKED_NO_DESTINATION ===
 * 37` (all other buckets unchanged from doc §5.1: IMPORT_DIRECT 5,
 * IMPORT_AFTER_NORMALIZATION 5, IGNORE_VENDOR_INTERNAL 12,
 * BLOCKED_LEGAL_DECISION 5).
 *
 * The matrix actually on disk (firstCustomerMatrix.ts) additionally
 * reclassifies THREE MORE columns, each with its own documented rationale in
 * the file's header comment and independently verified below against
 * docs/program/PATIENT_FIELD_GAP_AND_IDENTITY_DECISION_PACKAGE.md §5:
 *   - ADRESI   IMPORT_DIRECT -> IMPORT_AFTER_NORMALIZATION (it participates
 *     in the documented MAHALLE+ADRESI composition, so "trim only" is wrong)
 *   - HATIRLAT BLOCKED_NO_DESTINATION -> IGNORE_VENDOR_INTERNAL (the doc's
 *     own blocker text is "recommend NOT building" — a deliberate never-build
 *     is an IGNORE, not a pending gap that a future destination could unblock)
 *   - KANGURUBU BLOCKED_NO_DESTINATION -> BLOCKED_LEGAL_DECISION (the doc's
 *     own blocker text is "G-E11 + Art. 6 legal gate" — the binding blocker
 *     is legal, not a missing destination)
 *
 * These three are OUTSIDE the three-column scope this task's brief described
 * as sprint-authorized. They are internally well-reasoned and self-consistent
 * (firstCustomerMatrix.ts's own module-level assertions pass, and manual
 * cross-check against §5 below confirms every one of the 91 rows), but they
 * are a POLICY decision, not a code defect — reclassifying an already-decided
 * program disposition is not something a verification pass should do
 * unilaterally in either direction.
 *
 * Per this task's explicit instruction ("if the file on disk disagrees with
 * this, report which is wrong rather than silently editing"), the assertions
 * below encode the ACTUAL, CURRENT, self-consistent state of the matrix on
 * disk — manually re-derived and cross-checked line-by-line against §5 in
 * this file, independent of both the file's own header comment and the
 * task brief's assumption — and the discrepancy from the task brief's
 * 3-column expectation is called out explicitly here and in the final report
 * for a human reviewer to resolve.
 */

import assert from 'node:assert/strict';

import {
  DESTINATION_FIELDS,
  getDestinationField,
  type CanonicalCell,
  type CanonicalHeader,
  type SourceColumnProfile,
} from '../services/migration/contracts.js';
import {
  FIRST_CUSTOMER_MATRIX,
  FIRST_CUSTOMER_SOURCE_SYSTEM,
  matrixDecisionCounts,
  type MatrixDisposition,
} from '../services/migration/mapping/firstCustomerMatrix.js';
import { suggestMappings, hasTypeConflict } from '../services/migration/mapping/mappingEngine.js';
import { applyTransform } from '../services/migration/mapping/transforms.js';
import { validateMappings, type MappingRecordLike } from '../services/migration/mapping/validateMapping.js';

// ─── Test harness (same shape as sibling suites) ────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err?.stack ?? err?.message ?? err}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ─── Small fixture builders ─────────────────────────────────────────────────

function makeCell(overrides: Partial<CanonicalCell> = {}): CanonicalCell {
  return { type: 'empty', text: '', ...overrides };
}

function makeHeader(original: string, index: number): CanonicalHeader {
  return { original, normalized: original.trim().toUpperCase(), index };
}

// ══════════════════════════════════════════════════════════════════════════
// A. Matrix integrity
// ══════════════════════════════════════════════════════════════════════════

section('A. firstCustomerMatrix — integrity');

await test('FIRST_CUSTOMER_MATRIX has exactly 91 entries', () => {
  assert.equal(FIRST_CUSTOMER_MATRIX.length, 91);
});

await test('every sourceField is unique', () => {
  const seen = new Set<string>();
  for (const e of FIRST_CUSTOMER_MATRIX) {
    assert.ok(!seen.has(e.sourceField), `duplicate sourceField "${e.sourceField}"`);
    seen.add(e.sourceField);
  }
  assert.equal(seen.size, 91);
});

await test('matrixDecisionCounts() sums to 91 and matches the sprint-adjusted baseline', () => {
  const counts = matrixDecisionCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(total, 91);

  console.log('    disposition                        count');
  for (const [k, v] of Object.entries(counts)) {
    console.log(`    ${k.padEnd(34)} ${v}`);
  }

  // Manually re-derived by walking every one of the 91 rows in
  // firstCustomerMatrix.ts against §5 of the accepted doc (see the file
  // header comment above for the full reconciliation). Six columns differ
  // from doc §5.1's pre-sprint counts:
  //   TCNO, CINSIYET, DOSYANO  -> IMPORT_AFTER_SCHEMA_FIELD (sprint-created
  //     destinations; explicitly in scope per this task's brief)
  //   ADRESI                   -> IMPORT_AFTER_NORMALIZATION (was IMPORT_DIRECT)
  //   HATIRLAT                 -> IGNORE_VENDOR_INTERNAL (was BLOCKED_NO_DESTINATION)
  //   KANGURUBU                -> BLOCKED_LEGAL_DECISION (was BLOCKED_NO_DESTINATION)
  // The last three are OUTSIDE the task brief's anticipated 3-column delta —
  // see the FINDING note at the top of this file. Asserted here as the
  // actual, self-consistent, on-disk state; NOT silently reconciled to the
  // brief's stricter expectation.
  const expected: Record<MatrixDisposition, number> = {
    IMPORT_DIRECT: 4,
    IMPORT_AFTER_NORMALIZATION: 6,
    IMPORT_AFTER_REFERENCE_MAPPING: 1,
    IMPORT_AFTER_SCHEMA_FIELD: 4,
    HISTORICAL_METADATA_ONLY: 4,
    MANUAL_REVIEW: 2,
    IGNORE_VENDOR_INTERNAL: 13,
    IGNORE_SUMMARY_NOT_TRANSACTION: 16,
    BLOCKED_LEGAL_DECISION: 6,
    BLOCKED_NO_DESTINATION: 35,
  };
  assert.deepEqual(counts, expected);
});

await test('every non-null destinationField names a real DESTINATION_FIELDS key', () => {
  for (const e of FIRST_CUSTOMER_MATRIX) {
    if (e.destinationField === null) continue;
    assert.ok(
      getDestinationField(e.destinationField),
      `"${e.sourceField}" names unknown destination "${e.destinationField}"`,
    );
  }
});

await test('every entry\'s transform is in that destination\'s allowedTransforms', () => {
  for (const e of FIRST_CUSTOMER_MATRIX) {
    if (e.destinationField === null) continue;
    const dest = getDestinationField(e.destinationField)!;
    assert.ok(e.transform !== null, `"${e.sourceField}" has a destination but no transform`);
    assert.ok(
      dest.allowedTransforms.includes(e.transform),
      `"${e.sourceField}" transform "${e.transform}" not allowed by "${e.destinationField}"`,
    );
  }
});

await test('no BLOCKED_LEGAL_DECISION entry carries a destination', () => {
  for (const e of FIRST_CUSTOMER_MATRIX) {
    if (e.disposition === 'BLOCKED_LEGAL_DECISION') {
      assert.equal(e.destinationField, null, `"${e.sourceField}" is LEGAL_BLOCKED but has a destination`);
      assert.equal(e.mappingState, 'LEGAL_BLOCKED');
    }
  }
});

await test('the four consent-adjacent columns map to NO consent destination', () => {
  const consentAdjacent = ['MESAJOK', 'SMSGONDERILDI', 'HATIRLAT', 'SMSBORCTARIH'];
  // The destination catalog itself must not define a consent-shaped field —
  // consent is never invented by this migration (contracts.ts).
  const consentLikeDest = DESTINATION_FIELDS.find((d) => /consent|optout|opt_out/i.test(d.key));
  assert.equal(consentLikeDest, undefined, 'no consent-shaped destination should exist in the catalog');

  for (const field of consentAdjacent) {
    const entry = FIRST_CUSTOMER_MATRIX.find((e) => e.sourceField === field);
    assert.ok(entry, `expected matrix entry for "${field}"`);
    assert.equal(entry!.destinationField, null, `"${field}" must not carry any destination`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// B. suggestMappings
// ══════════════════════════════════════════════════════════════════════════

section('B. mappingEngine — suggestMappings');

const ALL_91_HEADERS: CanonicalHeader[] = FIRST_CUSTOMER_MATRIX.map((e, i) => makeHeader(e.sourceField, i));

await test('all 15 mapped first-customer columns resolve to their expected destination at AUTO_CONFIDENT', () => {
  const suggestions = suggestMappings(ALL_91_HEADERS, [], { sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM });
  const byField = new Map(suggestions.map((s) => [s.sourceField, s]));

  const expectations: Array<[string, string]> = [
    ['HASTA_ID', 'provenance.sourceId'],
    ['ADI', 'patient.firstName'],
    ['SOYADI', 'patient.lastName'],
    ['CEPTELEFONU', 'patient.phone'],
    ['EMAIL', 'patient.email'],
    ['DOGUMTARIHI', 'patient.dateOfBirth'],
    ['ADRESI', 'patient.address'],
    ['MAHALLE', 'patient.address'],
    ['IL', 'patient.city'],
    ['ULKE', 'patient.country'],
    ['SILINDI', 'patient.patientStatus'],
    ['TCNO', 'patient.identity.tckn'],
    ['CINSIYET', 'patient.gender'],
    ['DOSYANO', 'patient.chartNumber'],
    ['HASTADOKTOR', 'patient.primaryPractitionerId'],
  ];

  assert.equal(expectations.length, 15);

  for (const [field, dest] of expectations) {
    const s = byField.get(field);
    assert.ok(s, `expected a suggestion for "${field}"`);
    assert.equal(s!.destinationField, dest, `"${field}" -> expected destination "${dest}", got "${s!.destinationField}"`);
    assert.equal(s!.mappingState, 'AUTO_CONFIDENT', `"${field}" expected AUTO_CONFIDENT, got "${s!.mappingState}"`);
  }
});

await test('an unknown header -> MANUAL_REQUIRED / UNKNOWN_HEADER / confidence 0', () => {
  const headers = [makeHeader('SOME_TOTALLY_UNRECOGNIZED_COLUMN', 0)];
  const [s] = suggestMappings(headers, [], { sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM });
  assert.equal(s.destinationField, null);
  assert.equal(s.mappingState, 'MANUAL_REQUIRED');
  assert.equal(s.reason, 'UNKNOWN_HEADER');
  assert.equal(s.confidence, 0);
});

await test('a normalized-only match downgrades to AUTO_REVIEW, not AUTO_CONFIDENT', () => {
  // ' ADI ' normalizes to 'ADI' (matrix hit) but is not byte-exact.
  const headers = [makeHeader(' ADI ', 0)];
  const [s] = suggestMappings(headers, [], { sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM });
  assert.equal(s.destinationField, 'patient.firstName');
  assert.equal(s.reason, 'NORMALIZED');
  assert.equal(s.mappingState, 'AUTO_REVIEW');
  assert.notEqual(s.mappingState, 'AUTO_CONFIDENT');
});

await test('type-conflict downgrade: ADI with a majority-date profile keeps the destination but drops to AUTO_REVIEW with a reported typeConflict', () => {
  const headers = [makeHeader('ADI', 0)];
  const profile: SourceColumnProfile = {
    index: 0,
    header: 'ADI',
    filledCount: 10,
    totalRows: 10,
    fillRate: 1,
    distinctCount: 10,
    typeCounts: { empty: 0, string: 1, number: 0, date: 9, boolean: 0, error: 0 }, // 90% date
    maxLength: 10,
  };
  const [s] = suggestMappings(headers, [profile], { sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM });
  assert.equal(s.destinationField, 'patient.firstName', 'meaning must be kept, not silently resolved');
  assert.equal(s.mappingState, 'AUTO_REVIEW');
  assert.ok(hasTypeConflict(s), 'expected a reported typeConflict');
  if (hasTypeConflict(s)) {
    assert.equal(s.typeConflict.destinationType, 'string');
    assert.equal(s.typeConflict.observedMajorityType, 'date');
    assert.ok(s.typeConflict.observedShare > 0.5);
  }
});

await test('a savedTemplate entry wins over the matrix', () => {
  const headers = [makeHeader('ADI', 0)];
  const savedTemplate = new Map([
    ['ADI', { destinationField: 'patient.lastName', transform: 'trim' as const, composeOrder: null }],
  ]);
  const [s] = suggestMappings(headers, [], { sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM, savedTemplate });
  assert.equal(s.destinationField, 'patient.lastName', 'saved template must override the matrix default (patient.firstName)');
  assert.equal(s.reason, 'SAVED_TEMPLATE');
  assert.equal(s.mappingState, 'AUTO_CONFIDENT');
});

// ─── F3-DATA-MIG-TODAY-001-UI-005-R5: headerless/empty-column classification ─

function emptyProfile(index: number, header: string): SourceColumnProfile {
  return {
    index,
    header,
    filledCount: 0,
    totalRows: 14890,
    fillRate: 0,
    distinctCount: 0,
    typeCounts: { empty: 14890, string: 0, number: 0, date: 0, boolean: 0, error: 0 },
    maxLength: 0,
  };
}

function nonEmptyProfile(index: number, header: string, filledCount: number): SourceColumnProfile {
  return {
    index,
    header,
    filledCount,
    totalRows: 14890,
    fillRate: Math.round((filledCount / 14890) * 10_000) / 10_000,
    distinctCount: filledCount,
    typeCounts: { empty: 14890 - filledCount, string: filledCount, number: 0, date: 0, boolean: 0, error: 0 },
    maxLength: 12,
  };
}

await test('R5 #1: headerless column with CONFIRMED zero data -> IGNORE / EMPTY_SOURCE_COLUMN, does not block', () => {
  const header = { original: 'COLUMN_43', normalized: 'COLUMN_43', index: 43, headerWasBlank: true };
  const [s] = suggestMappings([header], [emptyProfile(43, 'COLUMN_43')], { sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM });
  assert.equal(s.mappingState, 'IGNORE', 'a genuinely empty headerless column must not require manual mapping');
  assert.equal(s.reason, 'EMPTY_SOURCE_COLUMN');
  assert.equal(s.destinationField, null);
  assert.equal(s.sourceIndex, 43, 'the physical source-column position must survive for auditability');

  const mappingRecord: MappingRecordLike = {
    sourceField: s.sourceField,
    sourceIndex: s.sourceIndex,
    destinationField: s.destinationField,
    transform: s.transform,
    composeOrder: s.composeOrder,
    state: s.mappingState,
  };
  const result = validateMappings([mappingRecord], [header]);
  // (Rule 5's separate "required destination not mapped" issues fire in this
  // minimal single-column fixture regardless — expected and unrelated to
  // this column's own disposition, so scope the assertion to COLUMN_43.)
  assert.deepEqual(
    result.issues.filter((i) => i.sourceField === 'COLUMN_43'),
    [],
    'an auto-ignored empty source column must not itself raise any issue',
  );
  assert.equal(result.unresolvedCount, 0);
  assert.equal(result.ignoredCount, 1);
});

await test('R5 #2: headerless column with SOME data remains MANUAL_REQUIRED (never silently ignored)', () => {
  const header = { original: 'COLUMN_7', normalized: 'COLUMN_7', index: 7, headerWasBlank: true };
  // "approximately 0/14889" in the field report — 3 real values is enough to
  // prove a single filled cell must never be masked as an empty column.
  const [s] = suggestMappings([header], [nonEmptyProfile(7, 'COLUMN_7', 3)], { sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM });
  assert.equal(s.mappingState, 'MANUAL_REQUIRED', 'even one real value must force a human decision');
  assert.equal(s.reason, 'UNKNOWN_HEADER');
  assert.notEqual(s.reason, 'EMPTY_SOURCE_COLUMN');
});

await test('R5: a NAMED column with zero fill is never auto-ignored (headerWasBlank must gate this, not fill alone)', () => {
  // Same zero-fill profile as R5 #1, but this header was NOT synthesized —
  // it is a real (if unmatched) vendor header, so it must stay MANUAL_REQUIRED.
  const headers = [makeHeader('SOME_TOTALLY_UNRECOGNIZED_EMPTY_COLUMN', 12)];
  const [s] = suggestMappings(headers, [emptyProfile(12, 'SOME_TOTALLY_UNRECOGNIZED_EMPTY_COLUMN')], {
    sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM,
  });
  assert.equal(s.mappingState, 'MANUAL_REQUIRED');
  assert.equal(s.reason, 'UNKNOWN_HEADER');
});

await test('R5: a headerless column with NO profile supplied stays MANUAL_REQUIRED (unknowable is never treated as empty)', () => {
  const header = { original: 'COLUMN_99', normalized: 'COLUMN_99', index: 99, headerWasBlank: true };
  const [s] = suggestMappings([header], [], { sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM });
  assert.equal(s.mappingState, 'MANUAL_REQUIRED');
  assert.equal(s.reason, 'UNKNOWN_HEADER');
});

// ══════════════════════════════════════════════════════════════════════════
// C. transforms — table-driven, synthetic values only
// ══════════════════════════════════════════════════════════════════════════

section('C. transforms');

await test('gender_tr: dictionary + unrecognized-never-guessed contract', () => {
  const cases: Array<[string, 'male' | 'female' | null, string | undefined]> = [
    ['E', 'male', undefined],
    ['K', 'female', undefined],
    ['ERKEK', 'male', undefined],
    ['KADIN', 'female', undefined],
    ['X', null, 'GENDER_VALUE_UNRECOGNIZED'],
    ['', null, undefined],
  ];
  for (const [raw, expectedValue, expectedWarning] of cases) {
    const out = applyTransform('gender_tr', { cells: [makeCell({ type: 'string', text: raw })], rowNumber: 1 });
    assert.equal(out.value, expectedValue, `gender_tr("${raw}") value`);
    if (expectedWarning) {
      assert.ok(out.warnings.includes(expectedWarning), `gender_tr("${raw}") should warn ${expectedWarning}`);
    }
    // Hard contract: an unrecognized value must NEVER become 'other', 'male' or 'female'-by-guess.
    if (raw === 'X') {
      assert.notEqual(out.value, 'other');
      assert.notEqual(out.value, 'male');
      assert.notEqual(out.value, 'female');
    }
  }
});

await test('phone_tr: leading-zero restoration, +90 canonical form, junk rejection', () => {
  const fromNumber = applyTransform('phone_tr', {
    cells: [makeCell({ type: 'number', text: '5321234567', numberValue: 5321234567 })],
    rowNumber: 1,
  });
  assert.equal(fromNumber.value, '+905321234567');
  assert.ok(fromNumber.warnings.includes('PHONE_LEADING_ZERO_RESTORED'));

  const fromInternational = applyTransform('phone_tr', {
    cells: [makeCell({ type: 'string', text: '+90 532 123 45 67' })],
    rowNumber: 2,
  });
  assert.equal(fromInternational.value, '+905321234567', 'must produce the same canonical output');

  const junk = applyTransform('phone_tr', {
    cells: [makeCell({ type: 'string', text: 'DAHILI' })],
    rowNumber: 3,
  });
  assert.equal(junk.value, null);
  assert.ok(junk.warnings.includes('PHONE_UNPARSEABLE'));
});

await test('date_excel_serial: serial, future rejection, ISO string, junk, UTC-noon anchoring', () => {
  const fromSerial = applyTransform('date_excel_serial', {
    cells: [makeCell({ type: 'number', text: '36526', numberValue: 36526 })],
    rowNumber: 1,
  });
  assert.ok(fromSerial.value instanceof Date);
  const d = fromSerial.value as Date;
  assert.equal(d.getUTCFullYear(), 2000);
  assert.equal(d.getUTCMonth(), 0); // January
  assert.equal(d.getUTCDate(), 1);
  assert.equal(d.getUTCHours(), 12, 'must be UTC-noon anchored');
  assert.equal(d.getUTCMinutes(), 0);
  assert.equal(d.getUTCSeconds(), 0);

  const future = applyTransform('date_excel_serial', {
    cells: [makeCell({ type: 'string', text: '31.12.2050' })],
    rowNumber: 2,
  });
  assert.equal(future.value, null);
  assert.equal(future.error?.code, 'ROW_VALUE_INVALID');

  const fromIso = applyTransform('date_excel_serial', {
    cells: [makeCell({ type: 'string', text: '1990-05-04' })],
    rowNumber: 3,
  });
  assert.ok(fromIso.value instanceof Date);
  const d2 = fromIso.value as Date;
  assert.equal(d2.getUTCFullYear(), 1990);
  assert.equal(d2.getUTCMonth(), 4); // May
  assert.equal(d2.getUTCDate(), 4);
  assert.equal(d2.getUTCHours(), 12, 'must be UTC-noon anchored');

  const junk = applyTransform('date_excel_serial', {
    cells: [makeCell({ type: 'string', text: 'not-a-date' })],
    rowNumber: 4,
  });
  assert.equal(junk.value, null);
  assert.ok(junk.warnings.includes('DATE_UNPARSEABLE'));
});

await test('compose_address: idempotent (same input twice -> byte-identical output); all-empty -> null', () => {
  const cells = [makeCell({ type: 'string', text: 'Merkez Mah.' }), makeCell({ type: 'string', text: 'Atatürk Cad. No:5' })];
  const run1 = applyTransform('compose_address', { cells, rowNumber: 1 });
  const run2 = applyTransform('compose_address', { cells, rowNumber: 1 });
  assert.equal(run1.value, run2.value);
  assert.equal(run1.value, 'Merkez Mah., Atatürk Cad. No:5');

  const empty = applyTransform('compose_address', {
    cells: [makeCell({ type: 'empty', text: '' }), makeCell({ type: 'empty', text: '' })],
    rowNumber: 2,
  });
  assert.equal(empty.value, null);
});

await test('lower_trim: invalid e-mail -> null + EMAIL_INVALID_DROPPED, never a row failure', () => {
  const out = applyTransform('lower_trim', { cells: [makeCell({ type: 'string', text: 'not-an-email' })], rowNumber: 1 });
  assert.equal(out.value, null);
  assert.ok(out.warnings.includes('EMAIL_INVALID_DROPPED'));
  assert.equal(out.error, undefined, 'an invalid e-mail must not fail the row');
});

await test('deleted_to_status: truthy -> archived, falsy -> new', () => {
  const truthy = applyTransform('deleted_to_status', { cells: [makeCell({ type: 'boolean', text: 'true', booleanValue: true })], rowNumber: 1 });
  assert.equal(truthy.value, 'archived');

  const falsy = applyTransform('deleted_to_status', { cells: [makeCell({ type: 'boolean', text: 'false', booleanValue: false })], rowNumber: 2 });
  assert.equal(falsy.value, 'new');
});

await test('chart_number: a number cell becomes an integer string with no ".0" and no exponent', () => {
  const out = applyTransform('chart_number', { cells: [makeCell({ type: 'number', text: '14718', numberValue: 14718.0 })], rowNumber: 1 });
  assert.equal(out.value, '14718');
  assert.ok(!String(out.value).includes('.'));
  assert.ok(!/e/i.test(String(out.value)));
});

await test('provenance_source_id: empty -> ROW_REQUIRED_FIELD_MISSING', () => {
  const out = applyTransform('provenance_source_id', { cells: [makeCell({ type: 'empty', text: '' })], rowNumber: 1 });
  assert.equal(out.error?.code, 'ROW_REQUIRED_FIELD_MISSING');
});

await test('practitioner_reference: byte-exact passthrough (no trim, no case fold, no diacritic strip)', () => {
  const raw = '  Dr. Ahmet Yılmaz  ';
  const out = applyTransform('practitioner_reference', { cells: [makeCell({ type: 'string', text: raw })], rowNumber: 1 });
  assert.equal(out.value, raw, 'must be returned byte-exact');
});

// ══════════════════════════════════════════════════════════════════════════
// D. validateMapping — one case per failure class
// ══════════════════════════════════════════════════════════════════════════

section('D. validateMapping');

function record(overrides: Partial<MappingRecordLike> & Pick<MappingRecordLike, 'sourceField'>): MappingRecordLike {
  return {
    sourceIndex: 0,
    destinationField: null,
    transform: null,
    composeOrder: null,
    state: 'IGNORE',
    ...overrides,
  };
}

await test('missing decision for a header -> MAPPING_REQUIRED', () => {
  const headers = [makeHeader('UNMAPPED_COL', 0)];
  const result = validateMappings([], headers);
  assert.ok(result.issues.some((i) => i.code === 'MAPPING_REQUIRED' && i.sourceField === 'UNMAPPED_COL'));
});

await test('a record for a non-existent header -> MAPPING_INVALID', () => {
  const headers: CanonicalHeader[] = [];
  const records = [record({ sourceField: 'GHOST_COL', state: 'IGNORE' })];
  const result = validateMappings(records, headers);
  assert.ok(result.issues.some((i) => i.code === 'MAPPING_INVALID' && i.sourceField === 'GHOST_COL'));
});

await test('MANUAL_REQUIRED left unresolved -> MAPPING_REQUIRED', () => {
  const headers = [makeHeader('PENDING_COL', 0)];
  const records = [record({ sourceField: 'PENDING_COL', state: 'MANUAL_REQUIRED' })];
  const result = validateMappings(records, headers);
  assert.ok(result.issues.some((i) => i.code === 'MAPPING_REQUIRED' && i.sourceField === 'PENDING_COL'));
  assert.equal(result.unresolvedCount, 1);
});

await test('unknown destination key -> MAPPING_INVALID', () => {
  const headers = [makeHeader('BAD_DEST_COL', 0)];
  const records = [record({ sourceField: 'BAD_DEST_COL', state: 'AUTO_CONFIDENT', destinationField: 'patient.doesNotExist' })];
  const result = validateMappings(records, headers);
  assert.ok(result.issues.some((i) => i.code === 'MAPPING_INVALID' && i.destinationField === 'patient.doesNotExist'));
});

await test('transform not allowed for the destination -> MAPPING_TYPE_INCOMPATIBLE', () => {
  const headers = [makeHeader('BAD_TRANSFORM_COL', 0)];
  const records = [
    record({
      sourceField: 'BAD_TRANSFORM_COL',
      state: 'AUTO_CONFIDENT',
      destinationField: 'patient.firstName',
      transform: 'phone_tr', // firstName only allows trim_collapse/trim
    }),
  ];
  const result = validateMappings(records, headers);
  assert.ok(result.issues.some((i) => i.code === 'MAPPING_TYPE_INCOMPATIBLE'));
});

await test('two sources on one non-composable destination -> MAPPING_DESTINATION_COLLISION', () => {
  const headers = [makeHeader('COL_A', 0), makeHeader('COL_B', 1)];
  const records = [
    record({ sourceField: 'COL_A', state: 'AUTO_CONFIDENT', destinationField: 'patient.email', transform: 'lower_trim' }),
    record({ sourceField: 'COL_B', state: 'AUTO_CONFIDENT', destinationField: 'patient.email', transform: 'lower_trim' }),
  ];
  const result = validateMappings(records, headers);
  assert.ok(result.issues.some((i) => i.code === 'MAPPING_DESTINATION_COLLISION' && i.destinationField === 'patient.email'));
});

await test('composition on a non-composable destination -> MAPPING_COMPOSITION_UNSUPPORTED', () => {
  const headers = [makeHeader('COL_C', 0)];
  const records = [
    record({ sourceField: 'COL_C', state: 'AUTO_CONFIDENT', destinationField: 'patient.email', transform: 'lower_trim', composeOrder: 1 }),
  ];
  const result = validateMappings(records, headers);
  assert.ok(result.issues.some((i) => i.code === 'MAPPING_COMPOSITION_UNSUPPORTED'));
});

await test('missing composeOrder on a composable destination -> MAPPING_COMPOSITION_UNSUPPORTED', () => {
  const headers = [makeHeader('MAHALLE_COL', 0), makeHeader('ADRESI_COL', 1)];
  const records = [
    record({ sourceField: 'MAHALLE_COL', state: 'AUTO_CONFIDENT', destinationField: 'patient.address', transform: 'compose_address', composeOrder: 1 }),
    record({ sourceField: 'ADRESI_COL', state: 'AUTO_CONFIDENT', destinationField: 'patient.address', transform: 'compose_address', composeOrder: null }),
  ];
  const result = validateMappings(records, headers);
  assert.ok(result.issues.some((i) => i.code === 'MAPPING_COMPOSITION_UNSUPPORTED' && i.destinationField === 'patient.address'));
});

await test('duplicate composeOrder on a composable destination -> MAPPING_COMPOSITION_UNSUPPORTED', () => {
  const headers = [makeHeader('MAHALLE_COL2', 0), makeHeader('ADRESI_COL2', 1)];
  const records = [
    record({ sourceField: 'MAHALLE_COL2', state: 'AUTO_CONFIDENT', destinationField: 'patient.address', transform: 'compose_address', composeOrder: 1 }),
    record({ sourceField: 'ADRESI_COL2', state: 'AUTO_CONFIDENT', destinationField: 'patient.address', transform: 'compose_address', composeOrder: 1 }),
  ];
  const result = validateMappings(records, headers);
  assert.ok(result.issues.some((i) => i.code === 'MAPPING_COMPOSITION_UNSUPPORTED' && i.destinationField === 'patient.address'));
});

await test('a LEGAL_BLOCKED row carrying a destination -> LEGAL_BLOCKED', () => {
  const headers = [makeHeader('KANGURUBU', 0)];
  const records = [
    record({ sourceField: 'KANGURUBU', state: 'LEGAL_BLOCKED', destinationField: 'patient.gender' }),
  ];
  const result = validateMappings(records, headers);
  assert.ok(result.issues.some((i) => i.code === 'LEGAL_BLOCKED' && i.sourceField === 'KANGURUBU'));
  assert.equal(result.legalBlockedCount, 1);
});

await test('no source mapped to provenance.sourceId -> MAPPING_REQUIRED', () => {
  const headers = [makeHeader('ADI', 0), makeHeader('SOYADI', 1)];
  const records = [
    record({ sourceField: 'ADI', state: 'AUTO_CONFIDENT', destinationField: 'patient.firstName', transform: 'trim_collapse' }),
    record({ sourceField: 'SOYADI', state: 'AUTO_CONFIDENT', destinationField: 'patient.lastName', transform: 'trim' }),
  ];
  const result = validateMappings(records, headers);
  assert.ok(
    result.issues.some((i) => i.code === 'MAPPING_REQUIRED' && i.destinationField === 'provenance.sourceId'),
    'without provenance.sourceId a rerun cannot be idempotent and would duplicate every patient',
  );
});

await test('a fully valid mapping returns valid: true, zero issues, correct counts', () => {
  const headers = [makeHeader('HASTA_ID', 0), makeHeader('ADI', 1), makeHeader('SOYADI', 2)];
  const records = [
    record({ sourceField: 'HASTA_ID', state: 'AUTO_CONFIDENT', destinationField: 'provenance.sourceId', transform: 'provenance_source_id' }),
    record({ sourceField: 'ADI', state: 'AUTO_CONFIDENT', destinationField: 'patient.firstName', transform: 'trim_collapse' }),
    record({ sourceField: 'SOYADI', state: 'AUTO_CONFIDENT', destinationField: 'patient.lastName', transform: 'trim' }),
  ];
  const result = validateMappings(records, headers);
  assert.deepEqual(result.issues, []);
  assert.equal(result.valid, true);
  assert.equal(result.mappedCount, 3);
  assert.equal(result.unresolvedCount, 0);
  assert.equal(result.blockedCount, 0);
  assert.equal(result.legalBlockedCount, 0);
  assert.equal(result.ignoredCount, 0);
});

// ─── F3-DATA-MIG-TODAY-001-UI-005-R5: state-machine contradiction fix ───────

await test('R5 #7: MANUAL_REQUIRED with no destination produces EXACTLY ONE issue for that column, not a contradiction', () => {
  const headers = [makeHeader('PENDING_COL', 0)];
  const records = [record({ sourceField: 'PENDING_COL', state: 'MANUAL_REQUIRED' })];
  const result = validateMappings(records, headers);
  // (The required-destination rule (Rule 5) separately reports the missing
  // provenance/name mappings for this minimal fixture — expected and
  // unrelated to this defect, so this test scopes its assertion to the
  // issues actually ABOUT "PENDING_COL", not the full issues array.)
  const forField = result.issues.filter((i) => i.sourceField === 'PENDING_COL');
  assert.equal(forField.length, 1, 'an undecided column must report ONE problem about itself, not two contradictory ones');
  assert.equal(forField[0]!.code, 'MAPPING_REQUIRED');
  assert.match(forField[0]!.message, /still awaiting review/);
  assert.ok(
    !forField.some((i) => /marked as decided but has no destination/.test(i.message)),
    'MANUAL_REQUIRED is UNDECIDED, never "decided" — it must not also report the decided-but-no-destination issue',
  );
  assert.equal(result.unresolvedCount, 1);
});

await test('R5 #8: a WRITING state (RESOLVED) with no destination IS rejected as decided-but-no-destination', () => {
  const headers = [makeHeader('HALF_DECIDED_COL', 0)];
  const records = [record({ sourceField: 'HALF_DECIDED_COL', state: 'RESOLVED', destinationField: null })];
  const result = validateMappings(records, headers);
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some((i) => i.code === 'MAPPING_REQUIRED' && /marked as decided but has no destination/.test(i.message)),
    'a genuinely WRITING state without a destination must still be caught',
  );
  assert.equal(result.unresolvedCount, 0, 'RESOLVED is not an UNDECIDED_STATE — it must not inflate unresolvedCount');
});

await test('R5: AUTO_REVIEW carrying a destination produces exactly one issue (no destination-check pollution)', () => {
  const headers = [makeHeader('MAYBE_PHONE', 0)];
  const records = [
    record({ sourceField: 'MAYBE_PHONE', state: 'AUTO_REVIEW', destinationField: 'patient.phone', transform: 'phone_tr' }),
  ];
  const result = validateMappings(records, headers);
  const forField = result.issues.filter((i) => i.sourceField === 'MAYBE_PHONE');
  assert.equal(forField.length, 1, 'an AUTO_REVIEW row awaiting confirmation must report only the review issue');
  assert.equal(forField[0]!.code, 'MAPPING_REQUIRED');
  assert.match(forField[0]!.message, /still awaiting review/);
});

await test('R5 #9/#10: ADRES_KODU and EK_ACIKLAMA reproduce, then no longer reproduce, the production contradiction', () => {
  // Real production evidence: both columns are matrix MANUAL_REVIEW entries
  // with no destination (see firstCustomerMatrix.ts). Drive them through the
  // ACTUAL production pipeline (suggestMappings -> validateMappings), not a
  // hand-built fixture, so this test would have caught the real defect.
  const fields = ['ADRES_KODU', 'EK_ACIKLAMA'];
  const headers = fields.map((f, i) => makeHeader(f, i));
  const suggestions = suggestMappings(headers, [], { sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM });

  for (const field of fields) {
    const s = suggestions.find((x) => x.sourceField === field)!;
    assert.ok(s, `expected a suggestion for "${field}"`);
    assert.equal(s.mappingState, 'MANUAL_REQUIRED', `"${field}" is an accepted MANUAL_REVIEW matrix decision`);
    assert.equal(s.destinationField, null, `"${field}" must not carry an invented destination`);
  }

  const records: MappingRecordLike[] = suggestions.map((s) => ({
    sourceField: s.sourceField,
    sourceIndex: s.sourceIndex,
    destinationField: s.destinationField,
    transform: s.transform,
    composeOrder: s.composeOrder,
    state: s.mappingState,
  }));
  const result = validateMappings(records, headers);

  for (const field of fields) {
    const forField = result.issues.filter((i) => i.sourceField === field);
    assert.equal(
      forField.length,
      1,
      `"${field}" must report exactly one issue — the production defect reported TWO contradictory ones ` +
        `("still awaiting review" AND "marked as decided but has no destination") for the same column`,
    );
    assert.match(forField[0]!.message, /still awaiting review/);
  }
});

await test('R5 #11: continue-gate blocks only genuinely unresolved decisions, not ignored/blocked/legal/mapped ones', () => {
  const headers = [
    makeHeader('HASTA_ID', 0),
    makeHeader('ADI', 1),
    makeHeader('SOYADI', 2),
    makeHeader('COLUMN_3', 3),
    makeHeader('KANGURUBU', 4),
    makeHeader('ILCE', 5),
  ];
  const records = [
    record({ sourceField: 'HASTA_ID', state: 'AUTO_CONFIDENT', destinationField: 'provenance.sourceId', transform: 'provenance_source_id' }),
    record({ sourceField: 'ADI', state: 'AUTO_CONFIDENT', destinationField: 'patient.firstName', transform: 'trim_collapse' }),
    record({ sourceField: 'SOYADI', sourceIndex: 2, state: 'AUTO_CONFIDENT', destinationField: 'patient.lastName', transform: 'trim' }),
    // auto-ignored empty source column (this task's fix)
    record({ sourceField: 'COLUMN_3', sourceIndex: 3, state: 'IGNORE' }),
    // legally blocked, correctly resolved (no destination)
    record({ sourceField: 'KANGURUBU', sourceIndex: 4, state: 'LEGAL_BLOCKED' }),
    // explicitly blocked, no destination
    record({ sourceField: 'ILCE', sourceIndex: 5, state: 'BLOCKED' }),
  ];
  const result = validateMappings(records, headers);
  assert.deepEqual(result.issues, [], 'ignored/legal-blocked/blocked/mapped columns must never block Continue');
  assert.equal(result.valid, true);
  assert.equal(result.unresolvedCount, 0);

  // Now add exactly one genuinely unresolved column — Continue must block.
  const withOneUnresolved = [...records, record({ sourceField: 'EXTRA_COL', sourceIndex: 6, state: 'MANUAL_REQUIRED' })];
  const headersWithExtra = [...headers, makeHeader('EXTRA_COL', 6)];
  const blockedResult = validateMappings(withOneUnresolved, headersWithExtra);
  assert.equal(blockedResult.valid, false);
  assert.equal(blockedResult.unresolvedCount, 1);
});

// ─── Sonuç ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Toplam: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız oldu.`);
  process.exit(1);
} else {
  console.log('\nTüm testler geçti.');
}
