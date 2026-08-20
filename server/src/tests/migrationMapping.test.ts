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
  EXECUTABLE_MAPPING_STATES,
  MAPPING_STATES,
} from '../services/migration/contracts.js';
import {
  FIRST_CUSTOMER_MATRIX,
  FIRST_CUSTOMER_SOURCE_SYSTEM,
  matrixDecisionCounts,
  type MatrixDisposition,
} from '../services/migration/mapping/firstCustomerMatrix.js';
import {
  FIRST_CUSTOMER_MEASURED_FILL,
  measuredFillCounts,
  measuredFillFor,
} from '../services/migration/mapping/firstCustomerMeasuredFill.js';
import {
  suggestMappings,
  hasTypeConflict,
  DESTINATION_ALIASES,
} from '../services/migration/mapping/mappingEngine.js';
import { classifyColumnSensitivity } from '../services/migration/mapping/columnPreview.js';
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
  //   KANGURUBU                -> (see the R7 note below)
  // Those are OUTSIDE the task brief's anticipated 3-column delta — see the
  // FINDING note at the top of this file. Asserted here as the actual,
  // self-consistent, on-disk state; NOT silently reconciled to the brief's
  // stricter expectation.
  //
  // F3-DATA-MIG-TODAY-001-FINAL-R7 then moved FOUR columns off
  // BLOCKED_LEGAL_DECISION (6 -> 2), because they were blocked ONLY for being
  // KVKK Art. 6 special-category — a disposition this program has now rejected
  // for an incumbent clinic's own operational data:
  //   ONEMLINOT, KONTROLNOTU, UZUNNOT -> IMPORT_AFTER_SENSITIVE_REVIEW
  //   KANGURUBU                       -> IMPORT_AFTER_SENSITIVE_REVIEW (R8:
  //     was SENSITIVE_REVIEW_NO_DESTINATION until Patient.bloodGroup existed;
  //     the MAPPING STATE is unchanged, only the structural blocker is gone)
  // KVKKONAYKODU and KVKKSMS REMAIN BLOCKED_LEGAL_DECISION and that is
  // correct: they were never blocked for sensitivity, they are blocked because
  // writing them would fabricate consent that no patient ever gave.
  //
  // F3-DATA-MIG-TODAY-001-R9 then moved FOUR columns whose MEASURED fill made a
  // system-recommended silent drop indefensible (see firstCustomerMeasuredFill.ts):
  //   EVTELEFONU  (45 rows)     BLOCKED_NO_DESTINATION   -> MANUAL_REVIEW
  //   ISTELEFONU  (164 rows)    BLOCKED_NO_DESTINATION   -> MANUAL_REVIEW
  //   ILCE        (~13 rows)    BLOCKED_NO_DESTINATION   -> MANUAL_REVIEW
  //   KVKKILKKODU (4,750 rows)  HISTORICAL_METADATA_ONLY -> MANUAL_REVIEW
  // so MANUAL_REVIEW 2 -> 6, BLOCKED_NO_DESTINATION 35 -> 32 and
  // HISTORICAL_METADATA_ONLY 4 -> 3. No destination was invented for any of
  // them: an honest open question outranks a plausible wrong answer.
  /*
   * F3-DATA-MIG-TODAY-001-R10 then measured all 91 columns with the repository's
   * own analyze code and moved everything the measurement made indefensible.
   *
   * THREE COLUMNS GAINED A REAL TYPED DESTINATION, because R10 built the fields
   * that were missing (IMPORT_AFTER_SCHEMA_FIELD 4 -> 7):
   *   ILCE        (13 rows)     MANUAL_REVIEW -> patient.district
   *   EVTELEFONU  (50 rows)     MANUAL_REVIEW -> patient.contactPoint.home
   *   ISTELEFONU  (166 rows)    MANUAL_REVIEW -> patient.contactPoint.work
   *
   * TWENTY-ONE COLUMNS GAINED CONTROLLED PRESERVATION. Each carries measured
   * data and has no canonical destination, so the only prior options were
   * "invent a Patient field" or "drop it". They are proposed for
   * legacy.preservedSourceValue in AUTO_REVIEW — nothing is written without an
   * operator accepting it, and nothing is lost if they do.
   *
   * The remaining MANUAL_REVIEW column is ADRES_KODU, whose UAVT-vs-postal-code
   * semantics are still unresolved — and which is measured at 0 filled rows, so
   * it blocks nothing. BLOCKED_NO_DESTINATION 32 -> 22: every one of the 10
   * blocked columns that actually carried data now has a destination, and the
   * 22 that remain are all measured at 0 rows for this customer while staying
   * honestly recorded as having no destination for a future one.
   */
  const expected: Record<MatrixDisposition, number> = {
    IMPORT_DIRECT: 4,
    IMPORT_AFTER_NORMALIZATION: 6,
    IMPORT_AFTER_REFERENCE_MAPPING: 1,
    IMPORT_AFTER_SCHEMA_FIELD: 7,
    IMPORT_AFTER_SENSITIVE_REVIEW: 4,
    // R8: no members today. The disposition is retained deliberately - see
    // firstCustomerMatrix.ts. A count of 0 is asserted, not tolerated, so
    // that quietly re-populating it is also a reviewable change.
    SENSITIVE_REVIEW_NO_DESTINATION: 0,
    HISTORICAL_METADATA_ONLY: 1,
    MANUAL_REVIEW: 1,
    PRESERVE_LEGACY_SOURCE: 21,
    IGNORE_VENDOR_INTERNAL: 11,
    IGNORE_SUMMARY_NOT_TRANSACTION: 11,
    BLOCKED_LEGAL_DECISION: 2,
    BLOCKED_NO_DESTINATION: 22,
  };
  assert.deepEqual(counts, expected);

  // The consent gate is UNCHANGED by R10 and must stay that way: the two
  // LEGAL_BLOCKED columns are KVKKONAYKODU and KVKKSMS, both measured at 0
  // filled rows, and neither may ever acquire a destination — including the
  // new preservation destination. Preservation is for columns with no home,
  // never a side door onto lawful basis.
  for (const e of FIRST_CUSTOMER_MATRIX) {
    if (e.disposition !== 'BLOCKED_LEGAL_DECISION') continue;
    assert.equal(
      e.destinationField,
      null,
      `${e.sourceField} is LEGAL_BLOCKED and must carry no destination at all`,
    );
  }
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
  // consent is never invented by this migration (contracts.ts). This is the
  // load-bearing half of the guarantee and it is UNCHANGED by R10.
  const consentLikeDest = DESTINATION_FIELDS.find((d) => /consent|optout|opt_out/i.test(d.key));
  assert.equal(consentLikeDest, undefined, 'no consent-shaped destination should exist in the catalog');

  /*
   * R10 SHARPENS THIS TEST rather than relaxing it.
   *
   * R9 asserted these columns carry NO destination at all, which was a proxy
   * for the real rule while the only alternative to "no destination" was a
   * patient field. R10 added a third possibility — controlled preservation —
   * and MESAJOK (14,153 rows) and HATIRLAT (14,890 rows) now use it, because
   * dropping 29,043 rows of vendor evidence on a system recommendation is
   * exactly the silent data loss this whole task exists to end.
   *
   * So the proxy is replaced by the rule it stood for. A consent-adjacent
   * column may reach ONLY the legacy_preservation group, may never reach a
   * patient field, and may never be applied without a human.
   */
  for (const field of consentAdjacent) {
    const entry = FIRST_CUSTOMER_MATRIX.find((e) => e.sourceField === field);
    assert.ok(entry, `expected matrix entry for "${field}"`);

    if (entry!.destinationField === null) continue;

    assert.equal(
      entry!.destinationField,
      'legacy.preservedSourceValue',
      `"${field}" may only ever reach controlled preservation, never any other destination`,
    );

    const dest = DESTINATION_FIELDS.find((d) => d.key === entry!.destinationField)!;
    assert.equal(
      dest.group,
      'legacy_preservation',
      `"${field}" must land in legacy_preservation — NOT historical_evidence, which is the ` +
        'consent exception and must stay empty and unreachable',
    );
    assert.ok(
      !entry!.destinationField!.startsWith('patient.'),
      `"${field}" must never write a patient field of any kind`,
    );
    // Never auto-applied: preservation resolves to AUTO_REVIEW, so a Platform
    // Admin accepts it. A consent-adjacent column must never be AUTO_CONFIDENT.
    assert.equal(
      entry!.mappingState,
      'AUTO_REVIEW',
      `"${field}" must require an operator decision before anything is written`,
    );
  }

  // And the two columns that ARE the consent gate stay absolutely closed:
  // no destination, no preservation, no exception.
  for (const field of ['KVKKONAYKODU', 'KVKKSMS'] as const) {
    const entry = FIRST_CUSTOMER_MATRIX.find((e) => e.sourceField === field)!;
    assert.equal(entry.mappingState, 'LEGAL_BLOCKED');
    assert.equal(
      entry.destinationField,
      null,
      `"${field}" is the consent gate itself and may never carry a destination, preservation included`,
    );
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

/*
 * R12 REVERSES ONE HALF OF R5, DELIBERATELY.
 *
 * R5 allowed only a HEADERLESS zero-fill column to settle itself, and required
 * a NAMED zero-fill column to stay MANUAL_REQUIRED. On the first customer's
 * workbook that rule left ADRES_KODU (named, measured 0 populated values)
 * BLOCKING the entire mapping step, and rendered 22 more measured-empty columns
 * as red obstacles. An operator cannot answer a question about a column that
 * provably holds nothing, so the question was pure noise — and the noise was
 * what made the four real decisions impossible to find.
 *
 * The distinction R5 drew has no data-loss basis once the fill is MEASURED at
 * zero: there is no value to mask, whatever the header says. What DOES have a
 * data-loss basis is the other half of R5, and it is unchanged and re-asserted
 * immediately below: a column with ANY data, and a column whose fill was never
 * measured, both still require a human.
 */
await test('R12: a NAMED column MEASURED at zero fill settles itself as an empty no-op', () => {
  const headers = [makeHeader('SOME_TOTALLY_UNRECOGNIZED_EMPTY_COLUMN', 12)];
  const [s] = suggestMappings(headers, [emptyProfile(12, 'SOME_TOTALLY_UNRECOGNIZED_EMPTY_COLUMN')], {
    sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM,
  });
  assert.equal(s.mappingState, 'IGNORE', 'a measured-empty column must not require an operator decision');
  assert.equal(s.reason, 'EMPTY_SOURCE_COLUMN', 'and it must SAY why, not look like a silent drop');
  assert.equal(s.destinationField, null);
});

await test('R12: a NAMED column with ANY data still requires a human (the half of R5 that matters)', () => {
  const headers = [makeHeader('SOME_TOTALLY_UNRECOGNIZED_COLUMN', 13)];
  const [s] = suggestMappings(headers, [nonEmptyProfile(13, 'SOME_TOTALLY_UNRECOGNIZED_COLUMN', 1)], {
    sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM,
  });
  assert.equal(s.mappingState, 'MANUAL_REQUIRED', 'one real value is enough to owe a decision');
  assert.equal(s.reason, 'UNKNOWN_HEADER');
  assert.notEqual(s.reason, 'EMPTY_SOURCE_COLUMN');
});

await test('R12: an UNMEASURED column is never settled as empty (unknowable is not zero)', () => {
  const headers = [makeHeader('SOME_TOTALLY_UNRECOGNIZED_COLUMN', 14)];
  const [s] = suggestMappings(headers, [], { sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM });
  assert.equal(s.mappingState, 'MANUAL_REQUIRED');
  assert.equal(s.reason, 'UNKNOWN_HEADER');
});

await test('R12: a LEGAL_BLOCKED column stays legally gated even when measured empty', () => {
  // KVKKONAYKODU and KVKKSMS are both 0 % filled in the real workbook. Folding
  // them into the empty pile would be arithmetically harmless and would delete
  // the recorded REASON they are not imported — and the next workbook from the
  // same vendor will have them populated.
  for (const field of ['KVKKONAYKODU', 'KVKKSMS']) {
    const headers = [makeHeader(field, 60)];
    const [s] = suggestMappings(headers, [emptyProfile(60, field)], {
      sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM,
    });
    assert.equal(s.mappingState, 'LEGAL_BLOCKED', `${field} must keep its legal gate`);
    assert.equal(s.destinationField, null, `${field} must never carry a destination`);
  }
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
  /*
   * R10: ADRES_KODU is still the MANUAL_REVIEW example (its UAVT-vs-postal-code
   * semantics remain genuinely unresolved, and it is measured at 0 filled rows
   * so nothing is lost by leaving the question open). EK_ACIKLAMA moved to
   * controlled preservation — measured at 1 filled row, still semantically
   * unresolved, but now kept as evidence instead of held hostage to a question
   * nobody can answer from one cell.
   *
   * The invariant this test guards is unchanged and is asserted for BOTH:
   * neither column may ever acquire an INVENTED SEMANTIC, i.e. a patient field.
   */
  const fields = ['ADRES_KODU', 'EK_ACIKLAMA'];
  const headers = fields.map((f, i) => makeHeader(f, i));
  const suggestions = suggestMappings(headers, [], { sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM });

  for (const field of fields) {
    const s = suggestions.find((x) => x.sourceField === field)!;
    assert.ok(s, `expected a suggestion for "${field}"`);
    assert.ok(
      s.destinationField === null || s.destinationField === 'legacy.preservedSourceValue',
      `"${field}" must not carry an invented destination — only null or controlled preservation`,
    );
    assert.ok(
      !(s.destinationField ?? '').startsWith('patient.'),
      `"${field}" has unresolved semantics and must never be written to a patient field`,
    );
    // Either way it is undecided until a human acts: MANUAL_REQUIRED proposes
    // nothing, AUTO_REVIEW proposes preservation but applies nothing.
    assert.ok(
      s.mappingState === 'MANUAL_REQUIRED' || s.mappingState === 'AUTO_REVIEW',
      `"${field}" must remain an operator decision, not an automatic import`,
    );
  }

  assert.equal(
    suggestions.find((x) => x.sourceField === 'ADRES_KODU')!.mappingState,
    'MANUAL_REQUIRED',
    'ADRES_KODU stays the open-question example: 0 rows, semantics unresolved',
  );

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


// ==========================================================================
// R7. F3-DATA-MIG-TODAY-001-FINAL-R7 - sensitive-data migration policy
//
// The rejected model:  SPECIAL_CATEGORY -> LEGAL_BLOCKED -> never importable.
// The accepted model:  SPECIAL_CATEGORY -> appropriate destination ->
//                      controlled, REVIEWED migration -> tenant scope + audit.
//
// Everything below is synthetic. No real workbook value appears in this file.
// ==========================================================================

section('R7. sensitive-data migration policy (F3-DATA-MIG-TODAY-001-FINAL-R7)');

/** The four columns that were LEGAL_BLOCKED for sensitivity alone. */
const R7_RECLASSIFIED = ['KANGURUBU', 'ONEMLINOT', 'UZUNNOT', 'KONTROLNOTU'] as const;
/** The two that remain LEGAL_BLOCKED, for consent fabrication - not sensitivity. */
const R7_STILL_LEGAL_BLOCKED = ['KVKKONAYKODU', 'KVKKSMS'] as const;

await test('R7 #1: no column is LEGAL_BLOCKED merely for being special-category health data', () => {
  for (const field of R7_RECLASSIFIED) {
    const e = FIRST_CUSTOMER_MATRIX.find((x) => x.sourceField === field);
    assert.ok(e, `${field} missing from the matrix`);
    assert.notEqual(
      e.mappingState,
      'LEGAL_BLOCKED',
      `${field} is health/special-category clinic-operational data and must not be permanently blocked for that reason alone`,
    );
    assert.equal(e.mappingState, 'SENSITIVE_REVIEW_REQUIRED');
  }
});

await test('R7 #2: sensitivity classification is PRESERVED, not discarded, by the reclassification', () => {
  // The point of the policy change is that sensitivity stops meaning "delete
  // it" and starts meaning "control it". If the reclassification also erased
  // the sensitivity signal it would be a downgrade, not a fix.
  for (const field of R7_RECLASSIFIED) {
    const e = FIRST_CUSTOMER_MATRIX.find((x) => x.sourceField === field)!;
    assert.equal(e.reason, 'SPECIAL_CATEGORY_REVIEW', `${field} must still declare WHY it needs review`);
    assert.ok(e.note && e.note.length > 0, `${field} must carry its recorded reasoning`);
  }
  // And the preview classifier must still fail closed on the new state - the
  // masking is exactly as strong as it was under LEGAL_BLOCKED.
  const masked = classifyColumnSensitivity('KANGURUBU', undefined, 5, 'SENSITIVE_REVIEW_REQUIRED');
  assert.equal(masked, 'sensitiveReview');
  // KANGURUBU is the standing example of why state must short-circuit the
  // heuristics: no destination, unrecognized header, short values.
  const heuristicOnly = classifyColumnSensitivity('KANGURUBU', undefined, 5, undefined);
  assert.equal(heuristicOnly, 'low', 'baseline: the heuristics alone would NOT have masked this');
});

await test('R7 #3: a special-category column with a valid destination CAN be mapped through the controlled path', () => {
  const e = FIRST_CUSTOMER_MATRIX.find((x) => x.sourceField === 'ONEMLINOT')!;
  assert.equal(e.destinationField, 'patient.notes', 'the destination must actually be proposed');
  const dest = getDestinationField('patient.notes');
  assert.ok(dest, 'patient.notes must exist in the destination catalog');
  assert.ok(dest.allowedTransforms.includes(e.transform!), 'the proposed transform must be allowed');

  // The controlled path: the operator RESOLVES it. That must validate cleanly.
  const headers = [makeHeader('HASTA_ID', 0), makeHeader('ADI', 1), makeHeader('SOYADI', 2), makeHeader('ONEMLINOT', 3)];
  const resolved = [
    record({ sourceField: 'HASTA_ID', sourceIndex: 0, state: 'AUTO_CONFIDENT', destinationField: 'provenance.sourceId', transform: 'provenance_source_id' }),
    record({ sourceField: 'ADI', sourceIndex: 1, state: 'AUTO_CONFIDENT', destinationField: 'patient.firstName', transform: 'trim_collapse' }),
    record({ sourceField: 'SOYADI', sourceIndex: 2, state: 'AUTO_CONFIDENT', destinationField: 'patient.lastName', transform: 'trim_collapse' }),
    record({ sourceField: 'ONEMLINOT', sourceIndex: 3, state: 'RESOLVED', destinationField: 'patient.notes', transform: 'compose_notes', composeOrder: 1 }),
  ];
  const okResult = validateMappings(resolved, headers);
  assert.deepEqual(okResult.issues, [], 'an operator-approved sensitive mapping must be accepted');
  assert.equal(okResult.valid, true);
});

await test('R7 #4: an UNAPPROVED sensitive column BLOCKS the run - it is never imported silently', () => {
  const headers = [makeHeader('HASTA_ID', 0), makeHeader('ADI', 1), makeHeader('SOYADI', 2), makeHeader('ONEMLINOT', 3)];
  const pending = [
    record({ sourceField: 'HASTA_ID', sourceIndex: 0, state: 'AUTO_CONFIDENT', destinationField: 'provenance.sourceId', transform: 'provenance_source_id' }),
    record({ sourceField: 'ADI', sourceIndex: 1, state: 'AUTO_CONFIDENT', destinationField: 'patient.firstName', transform: 'trim_collapse' }),
    record({ sourceField: 'SOYADI', sourceIndex: 2, state: 'AUTO_CONFIDENT', destinationField: 'patient.lastName', transform: 'trim_collapse' }),
    record({ sourceField: 'ONEMLINOT', sourceIndex: 3, state: 'SENSITIVE_REVIEW_REQUIRED', destinationField: 'patient.notes', transform: 'compose_notes', composeOrder: 1 }),
  ];
  const result = validateMappings(pending, headers);
  assert.equal(result.valid, false, 'a merely-proposed sensitive destination must not let the run execute');
  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.sensitiveReviewCount, 1, 'and it must be reported as a SENSITIVE review, not generic unresolved');
  assert.equal(result.issues.length, 1, 'exactly one issue - undecided rows are never also destination-checked');
  assert.equal(result.issues[0]!.code, 'MAPPING_REQUIRED');
  assert.equal(result.issues[0]!.sourceField, 'ONEMLINOT');
});

await test('R7 #5: SENSITIVE_REVIEW_REQUIRED is NOT executable, so no auto-accept path can sweep it in', () => {
  assert.ok(
    !EXECUTABLE_MAPPING_STATES.includes('SENSITIVE_REVIEW_REQUIRED'),
    'a run must never execute from a merely-proposed special-category mapping',
  );
  // Confidence must sit below any auto-accept threshold too, so an
  // "accept all safe suggestions" action cannot pick it up.
  for (const field of ['ONEMLINOT', 'UZUNNOT', 'KONTROLNOTU'] as const) {
    const e = FIRST_CUSTOMER_MATRIX.find((x) => x.sourceField === field)!;
    assert.ok(e.confidence < 100, `${field} must never report full confidence in an unapproved destination`);
  }
});

await test('R7 #6: the two consent columns REMAIN legally blocked - that block was never about sensitivity', () => {
  for (const field of R7_STILL_LEGAL_BLOCKED) {
    const e = FIRST_CUSTOMER_MATRIX.find((x) => x.sourceField === field)!;
    assert.equal(e.mappingState, 'LEGAL_BLOCKED', `${field} would fabricate consent nobody gave`);
    assert.equal(e.destinationField, null);
  }
  // And the catalog still refuses to define anywhere for them to go.
  const consentLike = DESTINATION_FIELDS.find((d) => /consent|optout|opt_out/i.test(d.key));
  assert.equal(consentLike, undefined);
});

await test('R7 #7: a truly unresolved semantic target requires review rather than a silent drop', () => {
  // R8 UPDATE: KANGURUBU is no longer an example of "no destination exists" -
  // Patient.bloodGroup was created for it and the assertion moved to the R8
  // section below. What this test still guards is the SILENT-DROP rule, and
  // ADRES_KODU / EK_ACIKLAMA remain its live examples: a column whose target
  // is genuinely unknown stays an unanswered question rather than becoming a
  // guess or an omission.
  /*
   * R10 UPDATE. The rule being guarded is "never a GUESS, and never a silent
   * OMISSION". R9 could only satisfy it one way — leave the column unmapped —
   * because the only destinations that existed asserted a semantic. R10 adds a
   * destination that asserts NO semantic, so the rule now has two valid
   * answers, and this test checks the rule rather than one of its answers.
   *
   * ADRES_KODU: still unmapped. 0 filled rows, so the open question costs
   * nothing and inventing a postal-code mapping would encode absence as fact.
   * EK_ACIKLAMA: 1 filled row, preserved. Not a guess (preservation claims
   * nothing about what the value means) and not an omission (the value
   * survives, tagged with the vendor column it came from).
   */
  for (const field of ['ADRES_KODU', 'EK_ACIKLAMA'] as const) {
    const m = FIRST_CUSTOMER_MATRIX.find((x) => x.sourceField === field)!;

    // NEVER A GUESS: an unresolved column may not be written to any patient field.
    assert.ok(
      m.destinationField === null || m.destinationField === 'legacy.preservedSourceValue',
      `${field} must never be guessed into a semantic destination`,
    );
    // NEVER SILENTLY APPLIED: both states require a human before anything is written.
    assert.ok(
      m.mappingState === 'MANUAL_REQUIRED' || m.mappingState === 'AUTO_REVIEW',
      `${field} must stay an operator decision`,
    );
    // NEVER A SILENT OMISSION: a column measured to carry data may not end in a
    // state that discards it without an operator confirming that discard.
    const fill = measuredFillFor(field);
    if (fill && (fill.filledCount ?? 0) > 0) {
      assert.notEqual(
        m.mappingState,
        'IGNORE',
        `${field} carries ${fill.filledCount} measured rows and must not be system-dropped`,
      );
    }
  }

  assert.equal(
    FIRST_CUSTOMER_MATRIX.find((x) => x.sourceField === 'ADRES_KODU')!.destinationField,
    null,
    'ADRES_KODU: 0 measured rows, semantics unresolved — the honest answer is still no mapping',
  );
});

await test('R7 #8: patient.notes composition is stable across reruns (idempotency)', () => {
  const cells = (...texts: string[]): CanonicalCell[] =>
    texts.map((t) => makeCell({ type: t === '' ? 'empty' : 'string', text: t }));

  // Synthetic placeholders only - never anything resembling clinical content.
  const first = applyTransform('compose_notes', { cells: cells('AAA', '', 'BBB'), rowNumber: 7 });
  const second = applyTransform('compose_notes', { cells: cells('AAA', '', 'BBB'), rowNumber: 7 });
  assert.equal(first.value, second.value, 'same cells in, same string out - forever');
  assert.equal(first.value, 'AAA\nBBB', 'empty parts omitted; order preserved; newline-joined');
  assert.deepEqual(first.warnings, [], 'the transform must never emit a value in a warning');
  assert.equal(applyTransform('compose_notes', { cells: cells('', ''), rowNumber: 1 }).value, null);
});

// ==========================================================================
// R7-GATE. FIRST-CUSTOMER DATA-LOSS GATE
//
// Every source column that carries MEANINGFUL data must end in exactly one
// accounted disposition. No unexplained remainder is tolerated.
// ==========================================================================

section('R7-GATE. source-column accounting invariant (data-loss gate)');

/**
 * Bucket a mapping state into exactly one accounting class.
 *
 * R9 CORRECTION. This function used to fold IGNORE / BLOCKED / LEGAL_BLOCKED
 * into a single `explicitlyExcluded` class, described as "an AFFIRMATIVE
 * recorded decision not to write". That claim was FALSE and the program owner
 * rejected it: those states arrive from firstCustomerMatrix.ts, a mapping
 * profile computed before any workbook is uploaded. They are SYSTEM
 * RECOMMENDATIONS. Counting a recommendation as an operator's decision is what
 * let 68 nominally-meaningful columns be reported as accounted-for while
 * nobody had decided anything about them.
 *
 * `systemRecommendedExclusion` therefore replaces `explicitlyExcluded` here,
 * and it is NOT a terminal disposition. Whether a specific column's exclusion
 * was actually confirmed by a Platform Admin depends on per-RUN evidence
 * (`isAutoSuggested` / `decidedByPlatformAdminId` / `decidedAt`) that a static
 * matrix cannot carry — so it is decided by dataLossGate.ts and proved in
 * migrationDataLossGate.test.ts. What THIS function still guards is narrower
 * and still worth guarding: that no mapping state is unclassified.
 *
 * `null` means the state is not accounted for at all - the failure this
 * function exists to catch.
 */
function accountingClassOf(
  state: string,
): 'resolved' | 'manualReview' | 'sensitiveReview' | 'systemRecommendedExclusion' | null {
  switch (state) {
    case 'AUTO_CONFIDENT':
    case 'RESOLVED':
      return 'resolved';
    case 'MANUAL_REQUIRED':
    case 'AUTO_REVIEW':
      return 'manualReview';
    case 'SENSITIVE_REVIEW_REQUIRED':
      return 'sensitiveReview';
    case 'IGNORE':
    case 'BLOCKED':
    case 'LEGAL_BLOCKED':
      return 'systemRecommendedExclusion';
    default:
      return null;
  }
}

await test('GATE #1: every MAPPING_STATE is accounted for by exactly one class', () => {
  // A state added later without a class would let a whole column slip through
  // the accounting below unnoticed, so the enum itself is the gate's input.
  for (const state of MAPPING_STATES) {
    assert.notEqual(
      accountingClassOf(state),
      null,
      `mapping state "${state}" has no accounting class - a column in it would be silently unaccounted`,
    );
  }
});

await test('GATE #2: every matrix column has a measured-fill record, and the classes partition it', () => {
  /*
   * R9 REPLACED THE BODY OF THIS TEST, and the reason matters more than the
   * assertions.
   *
   * What used to be here: `const filledCount = ZERO_DATA.has(f) ? 0 : 1`, with
   * ZERO_DATA a hand-written set of four names. Every other column was declared
   * data-bearing by fiat. That single line manufactured the headline figure the
   * program owner rejected — "meaningful 87 = ... + explicitlyExcluded 68" —
   * out of nothing. It was not a measurement, it was an assumption shaped like
   * one, and it was wrong in BOTH directions: 58 of the 91 columns have never
   * been profiled at all (so calling them meaningful was a guess), and 10 are
   * measured empty rather than four (so the zero-data set was wrong too).
   *
   * A gate that decides whether a clinic's data may be dropped may not be
   * proved against invented fill counts. The real ones live in
   * firstCustomerMeasuredFill.ts. R9 transcribed them by hand from the
   * decision package's §5 FILL column, which left 58 columns UNMEASURED and
   * carried several wrong figures; R10 replaced that table wholesale with the
   * output of the repository's OWN analyze code (parseSourceWorkbook +
   * profileColumns) run over the accepted workbook, so all 91 are measured and
   * nothing is transcribed. The balancing equation over them is proved in
   * migrationDataLossGate.test.ts against the actual gate rather than against a
   * copy of its logic.
   *
   * What survives here is the structural half: the matrix and the measured-fill
   * evidence describe the SAME 91 columns, and every state maps to a class.
   */
  const missingFill: string[] = [];
  const unaccounted: string[] = [];
  const tally = {
    resolved: 0,
    manualReview: 0,
    sensitiveReview: 0,
    systemRecommendedExclusion: 0,
  };

  for (const e of FIRST_CUSTOMER_MATRIX) {
    if (!measuredFillFor(e.sourceField)) {
      missingFill.push(e.sourceField);
      continue;
    }
    const cls = accountingClassOf(e.mappingState);
    if (cls === null) {
      unaccounted.push(`${e.sourceField} (${e.mappingState})`);
      continue;
    }
    tally[cls]++;
  }

  assert.deepEqual(
    missingFill,
    [],
    'every matrix column needs a measured-fill record, or the gate cannot say whether dropping it loses data',
  );
  assert.deepEqual(unaccounted, [], 'no source column may end in an unaccounted state');
  assert.equal(
    tally.resolved + tally.manualReview + tally.sensitiveReview + tally.systemRecommendedExclusion,
    FIRST_CUSTOMER_MATRIX.length,
    'the classes must partition the matrix with NO unexplained remainder',
  );
  assert.equal(
    FIRST_CUSTOMER_MEASURED_FILL.length,
    FIRST_CUSTOMER_MATRIX.length,
    'the fill evidence and the matrix must describe the same column set',
  );

  const fill = measuredFillCounts();
  console.log(
    `    matrix ${FIRST_CUSTOMER_MATRIX.length} = resolved ${tally.resolved} + manualReview ${tally.manualReview}` +
      ` + sensitiveReview ${tally.sensitiveReview} + systemRecommendedExclusion ${tally.systemRecommendedExclusion}`,
  );
  console.log(
    `    MEASURED FILL: meaningful ${fill.MEANINGFUL} · zero-data ${fill.ZERO_DATA} · UNMEASURED ${fill.UNMEASURED}`,
  );
});

await test('GATE #3: no meaningful column is BLOCKED *solely* because it is special-category', () => {
  // The precise defect this task exists to remove. A column may still be
  // LEGAL_BLOCKED - but not for sensitivity alone.
  for (const e of FIRST_CUSTOMER_MATRIX) {
    if (e.mappingState !== 'LEGAL_BLOCKED') continue;
    assert.ok(
      (R7_STILL_LEGAL_BLOCKED as readonly string[]).includes(e.sourceField),
      `"${e.sourceField}" is LEGAL_BLOCKED but is not one of the two consent-fabrication columns. ` +
        'If it is blocked for sensitivity alone, that is the rejected policy; move it to ' +
        'SENSITIVE_REVIEW_REQUIRED and record why.',
    );
  }
});

await test('GATE #4: a data-bearing headerless column is NEVER auto-ignored', () => {
  // The R6 meaningful-preview invariant must survive R7. One real value
  // anywhere in the sheet is enough to make the column a decision, not a drop.
  const header = { original: 'COLUMN_43', normalized: 'COLUMN_43', index: 43, headerWasBlank: true };
  const [sparse] = suggestMappings([header], [nonEmptyProfile(43, 'COLUMN_43', 1)], {
    sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM,
  });
  assert.notEqual(sparse.mappingState, 'IGNORE', 'one meaningful value must not be swept into IGNORE');
  assert.equal(sparse.mappingState, 'MANUAL_REQUIRED');
  assert.equal(accountingClassOf(sparse.mappingState), 'manualReview');

  // ...and the genuinely empty one still IS auto-ignorable.
  const [empty] = suggestMappings([header], [emptyProfile(43, 'COLUMN_43')], {
    sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM,
  });
  assert.equal(empty.mappingState, 'IGNORE');
  assert.equal(empty.reason, 'EMPTY_SOURCE_COLUMN');
});

// ==========================================================================
// R7-HDR. Original source header preservation
// ==========================================================================

section('R7-HDR. original source header is preserved as a distinct concept');

await test('HDR #1: a named column reports its ORIGINAL header, byte-exact', () => {
  const header = { original: 'EK_ACIKLAMA', normalized: 'EK_ACIKLAMA', index: 42 };
  const [s] = suggestMappings([header], [nonEmptyProfile(42, 'EK_ACIKLAMA', 120)], {
    sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM,
  });
  assert.equal(s.sourceHeader, 'EK_ACIKLAMA');
  assert.equal(s.sourceField, 'EK_ACIKLAMA', 'the stored key stays byte-exact');
});

await test('HDR #2: a headerless column reports sourceHeader === null, NOT the synthesized name', () => {
  const header = { original: 'COLUMN_43', normalized: 'COLUMN_43', index: 43, headerWasBlank: true };
  const [s] = suggestMappings([header], [nonEmptyProfile(43, 'COLUMN_43', 1)], {
    sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM,
  });
  assert.equal(s.sourceHeader, null, 'a synthesized name must never masquerade as a real workbook header');
  assert.equal(s.sourceField, 'COLUMN_43', 'but the synthesized name is still the stored key');
});

await test('HDR #3: a REAL vendor header that happens to read "COLUMN_<n>" is NOT reported as headerless', () => {
  // The exact collision CanonicalHeader.headerWasBlank exists to prevent, and
  // the reason the flag - not a string match - is the authoritative signal.
  const header = { original: 'COLUMN_43', normalized: 'COLUMN_43', index: 43 }; // headerWasBlank absent
  const [s] = suggestMappings([header], [nonEmptyProfile(43, 'COLUMN_43', 9)], {
    sourceSystem: FIRST_CUSTOMER_SOURCE_SYSTEM,
  });
  assert.equal(s.sourceHeader, 'COLUMN_43', 'a real header must survive even when it looks synthesized');
});


// ==========================================================================
// R8. STRUCTURED BLOOD-GROUP DESTINATION (F3-DATA-MIG-TODAY-001-R8)
//
// R7 left KANGURUBU in SENSITIVE_REVIEW_REQUIRED with no destination, because
// the product had no blood-group field at all. The program owner decided it
// should have a real STRUCTURED one. These tests assert that the structural
// blocker is gone and that the SENSITIVE gate is untouched by its removal -
// the two are independent, and conflating them is exactly the mistake R7
// corrected in the other direction.
// ==========================================================================

section('R8. structured blood-group destination');

const R8_BLOOD_GROUP_VALUES = [
  'A_POSITIVE',
  'A_NEGATIVE',
  'B_POSITIVE',
  'B_NEGATIVE',
  'AB_POSITIVE',
  'AB_NEGATIVE',
  'O_POSITIVE',
  'O_NEGATIVE',
] as const;

await test('R8 #1: patient.bloodGroup exists in the destination catalog as a STRUCTURED enum', () => {
  const d = DESTINATION_FIELDS.find((x) => x.key === 'patient.bloodGroup');
  assert.ok(d, 'patient.bloodGroup must be in the destination catalog');
  assert.equal(d.type, 'enum', 'a coded clinical attribute is not free text');
  assert.equal(d.required, false, 'absence of a blood group must never fail a row');
  assert.deepEqual([...(d.enumValues ?? [])], [...R8_BLOOD_GROUP_VALUES]);
  assert.equal(
    d.enumValues?.some((v) => /UNKNOWN|UNSPECIFIED|NONE/i.test(v)),
    false,
    'NULL means "not recorded"; a placeholder member would be a different clinical claim',
  );
  assert.deepEqual(d.allowedTransforms, ['blood_group_tr']);
  assert.equal(
    d.allowsComposition,
    false,
    'a blood group is one value from one column - composing two sources would invent a third',
  );
});

await test('R8 #2: KANGURUBU now proposes the structured destination and NOT patient.notes', () => {
  const e = FIRST_CUSTOMER_MATRIX.find((x) => x.sourceField === 'KANGURUBU')!;
  assert.equal(e.destinationField, 'patient.bloodGroup');
  assert.equal(e.transform, 'blood_group_tr');
  assert.notEqual(
    e.destinationField,
    'patient.notes',
    'a coded attribute buried in free text is a different datum and cannot be read back',
  );
});

await test('R8 #3: the SENSITIVE gate is UNCHANGED by the arrival of a destination', () => {
  const e = FIRST_CUSTOMER_MATRIX.find((x) => x.sourceField === 'KANGURUBU')!;
  assert.equal(e.mappingState, 'SENSITIVE_REVIEW_REQUIRED', 'still undecided, still needs a human');
  assert.equal(e.reason, 'SPECIAL_CATEGORY_REVIEW');
  assert.ok(e.confidence < 100, 'never full confidence in an unapproved special-category destination');
  assert.equal(
    EXECUTABLE_MAPPING_STATES.includes('SENSITIVE_REVIEW_REQUIRED' as never),
    false,
    'giving the column a destination must not make it executable',
  );
});

await test('R8 #4: an unapproved blood-group column still BLOCKS the run', () => {
  const records: MappingRecordLike[] = [
    { sourceField: 'AD', sourceIndex: 0, destinationField: 'patient.firstName', transform: 'trim', composeOrder: null, state: 'AUTO_CONFIDENT' },
    { sourceField: 'SOYAD', sourceIndex: 1, destinationField: 'patient.lastName', transform: 'trim', composeOrder: null, state: 'AUTO_CONFIDENT' },
    { sourceField: 'KANGURUBU', sourceIndex: 2, destinationField: 'patient.bloodGroup', transform: 'blood_group_tr', composeOrder: null, state: 'SENSITIVE_REVIEW_REQUIRED' },
  ];
  const headers = records.map((r, i) => makeHeader(r.sourceField, i));
  const result = validateMappings(records, headers);
  assert.equal(result.valid, false, 'a merely-proposed special-category mapping may never execute');
  assert.equal(result.sensitiveReviewCount, 1);
});

await test('R8 #5: patient.bloodGroup is absent from the generic header dictionary', () => {
  // The customer PROFILE proposes it, in an undecided state. The generic
  // header dictionary must not, because a dictionary hit on an arbitrary
  // workbook can land in a confident state - which would import
  // special-category health data with nobody reviewing it. Same reason
  // patient.notes is absent from it.
  for (const header of ['KANGURUBU', 'KAN GRUBU', 'BLOOD GROUP', 'BLOODGROUP', 'BLOOD_TYPE']) {
    const [s] = suggestMappings([makeHeader(header, 0)], [nonEmptyProfile(0, header, 12)], {
      sourceSystem: 'some-other-vendor-v3',
    });
    assert.notEqual(
      s.destinationField,
      'patient.bloodGroup',
      `${header} must not auto-map to a special-category destination outside a reviewed profile`,
    );
  }
});

// ── normalization ─────────────────────────────────────────────────────────
// Every fixture here is SYNTHETIC. None is taken from, or checked against, the
// customer workbook; the accepted spellings come from Turkish and English
// clinical convention.

await test('R8 #6: the eight canonical values are produced from their conventional spellings', () => {
  const cases: Array<[string, string]> = [
    ['A+', 'A_POSITIVE'],
    ['A-', 'A_NEGATIVE'],
    ['B+', 'B_POSITIVE'],
    ['B-', 'B_NEGATIVE'],
    ['AB+', 'AB_POSITIVE'],
    ['AB-', 'AB_NEGATIVE'],
    ['O+', 'O_POSITIVE'],
    ['O-', 'O_NEGATIVE'],
    // Turkish clinical usage writes the O group with the digit zero. Canonical
    // STORAGE is always the letter O.
    ['0+', 'O_POSITIVE'],
    ['0-', 'O_NEGATIVE'],
    ['0 Rh+', 'O_POSITIVE'],
    ['0 RH -', 'O_NEGATIVE'],
    // Rh spelled out, spacing, case, Turkish dotted capital I, punctuation.
    ['a rh+', 'A_POSITIVE'],
    ['A Rh Pozitif', 'A_POSITIVE'],
    ['A RH POZ\u0130T\u0130F', 'A_POSITIVE'],
    ['b rh negatif', 'B_NEGATIVE'],
    ['AB RH NEGATIF', 'AB_NEGATIVE'],
    ['A RH (+)', 'A_POSITIVE'],
    ['  AB  RH  -  ', 'AB_NEGATIVE'],
    ['B POSITIVE', 'B_POSITIVE'],
    ['O NEGATIVE', 'O_NEGATIVE'],
  ];
  for (const [input, expected] of cases) {
    const out = applyTransform('blood_group_tr', { cells: [makeCell({ type: 'string', text: input })], rowNumber: 3 });
    assert.equal(out.value, expected, `"${input}" must normalize to ${expected}`);
    assert.deepEqual(out.warnings, [], `${expected} is a clean recognition and must warn about nothing`);
    assert.equal(out.error, undefined);
  }
  const produced = new Set(
    cases.map(([input]) => applyTransform('blood_group_tr', { cells: [makeCell({ type: 'string', text: input })], rowNumber: 1 }).value),
  );
  assert.equal(produced.size, 8, 'the accepted spellings collapse onto exactly the eight canonical values');
});

await test('R8 #7: Rh is NEVER inferred from an ABO-only value', () => {
  for (const input of ['A', 'B', 'AB', 'O', '0', 'a', 'A RH', '0 rh', ' AB ']) {
    const out = applyTransform('blood_group_tr', { cells: [makeCell({ type: 'string', text: input })], rowNumber: 5 });
    assert.equal(out.value, null, 'half a blood group is not a blood group');
    assert.deepEqual(
      out.warnings,
      ['BLOOD_GROUP_RH_MISSING'],
      'the omission must be COUNTABLE, not silent and not guessed',
    );
  }
});

await test('R8 #8: unrecognized and unrelated values never silently map', () => {
  for (const input of ['43', 'AQ', '0/1', 'AB-123', 'yok', 'N/A', '-', '+', 'C+', 'A++', 'RH+', 'A B +', 'ABO']) {
    const out = applyTransform('blood_group_tr', { cells: [makeCell({ type: 'string', text: input })], rowNumber: 6 });
    assert.equal(out.value, null, `"${input}" must not be read as a blood group`);
    assert.ok(out.warnings.length === 1, 'exactly one warning, so the operator can count these');
    assert.ok(
      out.warnings[0] === 'BLOOD_GROUP_VALUE_UNRECOGNIZED' || out.warnings[0] === 'BLOOD_GROUP_RH_MISSING',
      'and it is a CODE, never the value',
    );
    assert.equal(out.error, undefined, 'an unreadable blood group must not fail the whole patient row');
  }
});

await test('R8 #9: a blank cell is NULL with no warning, and no value ever appears in a warning', () => {
  for (const input of ['', '   ']) {
    const out = applyTransform('blood_group_tr', { cells: [makeCell({ type: 'empty', text: input })], rowNumber: 1 });
    assert.equal(out.value, null, 'blank means "not recorded", which is exactly NULL');
    assert.deepEqual(out.warnings, [], 'one warning per empty row would drown the real ones');
  }
  // The privacy contract for the whole transforms module, asserted here for
  // the one transform that handles special-category values.
  const noisy = applyTransform('blood_group_tr', { cells: [makeCell({ type: 'string', text: 'ZZZ-SECRET-9' })], rowNumber: 1 });
  for (const w of noisy.warnings) {
    assert.equal(w.includes('ZZZ'), false, 'a warning is a CODE and must never carry the cell value');
  }
});

await test('R8 #10: normalization is a pure function - identical input, identical output, forever', () => {
  for (const input of ['A Rh Pozitif', '0-', 'garbage']) {
    const a = applyTransform('blood_group_tr', { cells: [makeCell({ type: 'string', text: input })], rowNumber: 1 });
    const b = applyTransform('blood_group_tr', { cells: [makeCell({ type: 'string', text: input })], rowNumber: 9999 });
    assert.equal(a.value, b.value, 'rerun idempotency depends on this');
    assert.deepEqual(a.warnings, b.warnings);
  }
});

await test('R8 #11: the R7 patient.notes composition is untouched by this change', () => {
  const notes = DESTINATION_FIELDS.find((d) => d.key === 'patient.notes')!;
  assert.equal(notes.allowsComposition, true);
  assert.deepEqual(notes.allowedTransforms, ['compose_notes', 'trim_collapse', 'trim']);
  assert.equal(
    notes.allowedTransforms.includes('blood_group_tr' as never),
    false,
    'a blood group must not be routable into the free-text destination',
  );
  for (const field of ['ONEMLINOT', 'KONTROLNOTU', 'UZUNNOT'] as const) {
    const e = FIRST_CUSTOMER_MATRIX.find((x) => x.sourceField === field)!;
    assert.equal(e.destinationField, 'patient.notes');
    assert.equal(e.mappingState, 'SENSITIVE_REVIEW_REQUIRED');
  }
});

await test('R8 #12: the preview for a blood-group column stays server-masked', () => {
  // The column is short, its header matches no keyword, and its values look
  // harmless to a length heuristic - which is exactly why the decided policy
  // state has to short-circuit the heuristics.
  assert.equal(
    classifyColumnSensitivity('KANGURUBU', 'enum', 6, 'SENSITIVE_REVIEW_REQUIRED'),
    'sensitiveReview',
  );
});


await test('R8 #13: no vendor-neutral alias points at a special-category destination', () => {
  // The alias table fires for EVERY customer. An entry here onto an Art. 6
  // destination would be the same accept-auto hazard as the auto-derived key
  // heuristic, just written by hand instead of generated.
  const special = new Set(DESTINATION_FIELDS.filter((d) => d.specialCategory).map((d) => d.key));
  assert.ok(special.has('patient.notes') && special.has('patient.bloodGroup'), 'both Art. 6 destinations must be flagged');
  for (const [alias, key] of DESTINATION_ALIASES) {
    assert.equal(special.has(key), false, `alias "${alias}" must not target special-category ${key}`);
  }
});

await test('R8 #14: patient.notes is heuristically unreachable too - the same hole, closed for R7', () => {
  // R7 added patient.notes to the catalog, which AUTOMATICALLY created an
  // exact-key heuristic for a column named 'NOTES'. That heuristic lands in
  // AUTO_REVIEW, and accept-auto promotes every AUTO_REVIEW row with a
  // destination to RESOLVED - a writing state. So one "accept all safe
  // suggestions" click could have imported an arbitrary customer's clinical
  // free text with nobody reviewing that column.
  for (const header of ['NOTES', 'NOTE', 'PATIENT.NOTES']) {
    const [s] = suggestMappings([makeHeader(header, 0)], [nonEmptyProfile(0, header, 250)], {
      sourceSystem: 'some-other-vendor-v3',
    });
    assert.notEqual(s.destinationField, 'patient.notes', `${header} must not auto-map to clinical free text`);
  }
  // ...and the reviewed profile still reaches it, in an undecided state.
  const e = FIRST_CUSTOMER_MATRIX.find((x) => x.sourceField === 'ONEMLINOT')!;
  assert.equal(e.destinationField, 'patient.notes');
  assert.equal(e.mappingState, 'SENSITIVE_REVIEW_REQUIRED');
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
