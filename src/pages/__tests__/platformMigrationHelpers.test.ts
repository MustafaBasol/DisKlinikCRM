/**
 * platformMigrationHelpers.test.ts — pure logic for the Platform Admin
 * Migration Center wizard: run-status → step routing, mapping-screen filter
 * chips, the reconciliation arithmetic invariant, byte-size formatting and
 * the status → badge-class mapping.
 *
 * Run with: tsx src/pages/__tests__/platformMigrationHelpers.test.ts
 * No external test framework — mirrors src/pages/__tests__/bookingWidgetHelpers.test.ts.
 */

import assert from 'node:assert/strict';

import {
  stepForStatus,
  MIGRATION_STEPS,
  mappingMatchesFilter,
  mappingMatchesQuery,
  mappingRowVisible,
  isHeaderlessMapping,
  parseUnnamedColumnIndex,
  excelColumnLetter,
  excelColumnCoordinate,
  isReconciliationBalanced,
  formatByteSize,
  formatPercent,
  statusBadgeClass,
  isRunInFlight,
  isTerminalRunStatus,
  MAPPING_FILTER_IDS,
} from '../platformMigrationHelpers';
import { MIGRATION_RUN_STATUSES, type MigrationRunStatus, type MappingDto } from '../../services/platformMigrationApi';

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

function makeMapping(overrides: Partial<MappingDto> = {}): MappingDto {
  return {
    sourceField: 'HASTA_ID',
    // Authoritative original workbook header (null == the header cell was
    // blank). Present on every fixture so the default is the R7 wire shape;
    // the legacy "property absent entirely" shape is built explicitly, by
    // deleting it, where that path is under test.
    sourceHeader: 'HASTA_ID',
    sourceLabel: 'HASTA_ID',
    sourceIndex: 0,
    sourceNormalized: 'HASTAID',
    destinationField: null,
    destinationLabel: null,
    transform: null,
    composeOrder: null,
    confidence: 0,
    reason: 'NO_DESTINATION',
    state: 'MANUAL_REQUIRED',
    ...overrides,
  };
}

/**
 * A mapping exactly as a backend older than F3-DATA-MIG-TODAY-001-FINAL-R7
 * sent it: the `sourceHeader` property is ABSENT, not null. That distinction
 * is what `isHeaderlessMapping` keys on, so it has to be built by deletion.
 */
function makeLegacyMapping(overrides: Partial<MappingDto> = {}): MappingDto {
  const mapping = makeMapping(overrides);
  delete (mapping as Partial<MappingDto>).sourceHeader;
  return mapping;
}

async function main() {
  section('── stepForStatus: all 14 run statuses ──────────────────────────');

  const expected: Record<MigrationRunStatus, number> = {
    CREATED: MIGRATION_STEPS.UPLOAD,
    UPLOADED: MIGRATION_STEPS.ANALYZE,
    ANALYZED: MIGRATION_STEPS.MAPPING,
    MAPPING_REQUIRED: MIGRATION_STEPS.MAPPING,
    MAPPING_READY: MIGRATION_STEPS.REFERENCE,
    DRY_RUN_RUNNING: MIGRATION_STEPS.DRY_RUN,
    DRY_RUN_COMPLETE: MIGRATION_STEPS.DRY_RUN,
    BLOCKED: MIGRATION_STEPS.DRY_RUN,
    READY: MIGRATION_STEPS.CONFIRM,
    RUNNING: MIGRATION_STEPS.PROGRESS,
    PARTIAL_FAILURE: MIGRATION_STEPS.PROGRESS,
    COMPLETED: MIGRATION_STEPS.RESULTS,
    FAILED: MIGRATION_STEPS.RESULTS,
    CANCELLED: MIGRATION_STEPS.RESULTS,
  };

  assert.equal(MIGRATION_RUN_STATUSES.length, 14, 'sanity: contract still declares exactly 14 statuses');

  for (const status of MIGRATION_RUN_STATUSES) {
    await test(`${status} → step ${expected[status]}`, () => {
      assert.equal(stepForStatus(status), expected[status]);
    });
  }

  await test('every status maps to a step in [1,9]', () => {
    for (const status of MIGRATION_RUN_STATUSES) {
      const step = stepForStatus(status);
      assert.ok(step >= 1 && step <= 9, `${status} → ${step} out of range`);
    }
  });

  section('── mapping filter chips ─────────────────────────────────────────');

  assert.deepEqual(MAPPING_FILTER_IDS, [
    'all',
    'unresolved',
    'unmappedWithData',
    'blocked',
    'legal',
    'headerless',
    'ignored',
    'auto',
  ]);

  const rowManualRequired = makeMapping({ state: 'MANUAL_REQUIRED' });
  const rowAutoReview = makeMapping({ state: 'AUTO_REVIEW' });
  const rowBlocked = makeMapping({ state: 'BLOCKED' });
  const rowLegalBlocked = makeMapping({ state: 'LEGAL_BLOCKED' });
  const rowIgnore = makeMapping({ state: 'IGNORE' });
  const rowAutoConfident = makeMapping({ state: 'AUTO_CONFIDENT' });
  const rowResolved = makeMapping({ state: 'RESOLVED' });
  const allRows = [rowManualRequired, rowAutoReview, rowBlocked, rowLegalBlocked, rowIgnore, rowAutoConfident, rowResolved];

  await test('"all" matches every state', () => {
    for (const row of allRows) assert.equal(mappingMatchesFilter(row, 'all'), true, row.state);
  });

  await test('"unresolved" matches MANUAL_REQUIRED and AUTO_REVIEW only', () => {
    assert.equal(mappingMatchesFilter(rowManualRequired, 'unresolved'), true);
    assert.equal(mappingMatchesFilter(rowAutoReview, 'unresolved'), true);
    for (const row of [rowBlocked, rowLegalBlocked, rowIgnore, rowAutoConfident, rowResolved]) {
      assert.equal(mappingMatchesFilter(row, 'unresolved'), false, row.state);
    }
  });

  await test('"blocked" matches BLOCKED only (never LEGAL_BLOCKED)', () => {
    assert.equal(mappingMatchesFilter(rowBlocked, 'blocked'), true);
    assert.equal(mappingMatchesFilter(rowLegalBlocked, 'blocked'), false, 'LEGAL_BLOCKED must not appear under the technical Blocked filter');
  });

  await test('"legal" matches LEGAL_BLOCKED only (never plain BLOCKED)', () => {
    assert.equal(mappingMatchesFilter(rowLegalBlocked, 'legal'), true);
    assert.equal(mappingMatchesFilter(rowBlocked, 'legal'), false);
  });

  await test('"ignored" matches IGNORE only', () => {
    assert.equal(mappingMatchesFilter(rowIgnore, 'ignored'), true);
    for (const row of [rowManualRequired, rowAutoReview, rowBlocked, rowLegalBlocked, rowAutoConfident, rowResolved]) {
      assert.equal(mappingMatchesFilter(row, 'ignored'), false, row.state);
    }
  });

  await test('"auto" matches AUTO_CONFIDENT only (not AUTO_REVIEW)', () => {
    assert.equal(mappingMatchesFilter(rowAutoConfident, 'auto'), true);
    assert.equal(mappingMatchesFilter(rowAutoReview, 'auto'), false);
  });

  await test('"headerless" matches a blank-header column regardless of state, and nothing else', () => {
    const headerlessManual = makeMapping({ sourceField: 'COLUMN_42', sourceHeader: null, sourceIndex: 42, state: 'MANUAL_REQUIRED' });
    const headerlessAutoConfident = makeMapping({ sourceField: 'COLUMN_0', sourceHeader: null, sourceIndex: 0, state: 'AUTO_CONFIDENT' });
    assert.equal(mappingMatchesFilter(headerlessManual, 'headerless'), true);
    assert.equal(mappingMatchesFilter(headerlessAutoConfident, 'headerless'), true);
    for (const row of allRows) {
      assert.equal(mappingMatchesFilter(row, 'headerless'), false, `${row.sourceField} is not headerless`);
    }
  });

  await test('mappingMatchesQuery: case-insensitive substring over source identifiers', () => {
    const row = makeMapping({ sourceField: 'CEPTELEFONU', sourceLabel: 'Cep Telefonu', sourceNormalized: 'CEPTELEFONU' });
    assert.equal(mappingMatchesQuery(row, 'cep'), true);
    assert.equal(mappingMatchesQuery(row, 'CEPTELEFONU'), true);
    assert.equal(mappingMatchesQuery(row, 'zzz'), false);
    assert.equal(mappingMatchesQuery(row, ''), true, 'empty query matches everything');
    assert.equal(mappingMatchesQuery(row, '   '), true, 'whitespace-only query matches everything');
  });

  await test('mappingRowVisible combines the chip filter AND the text query', () => {
    const row = makeMapping({ state: 'BLOCKED', sourceField: 'ADRES_KODU', sourceLabel: 'Adres Kodu', sourceNormalized: 'ADRESKODU' });
    assert.equal(mappingRowVisible(row, 'blocked', 'adres'), true);
    assert.equal(mappingRowVisible(row, 'blocked', 'zzz'), false, 'wrong query excludes despite matching filter');
    assert.equal(mappingRowVisible(row, 'legal', 'adres'), false, 'wrong filter excludes despite matching query');
  });

  section('── PART 13 A/B: isHeaderlessMapping (authoritative sourceHeader) ─');

  await test('A. a real header at a high physical index is NOT headerless', () => {
    const named = makeMapping({ sourceField: 'EK_ACIKLAMA', sourceHeader: 'EK_ACIKLAMA', sourceLabel: 'EK_ACIKLAMA', sourceIndex: 42 });
    assert.equal(isHeaderlessMapping(named), false);
    assert.equal(mappingMatchesFilter(named, 'headerless'), false);
  });

  await test('B. sourceHeader === null means headerless, whatever the sourceField looks like', () => {
    const blank = makeMapping({ sourceField: 'COLUMN_42', sourceHeader: null, sourceIndex: 42 });
    assert.equal(isHeaderlessMapping(blank), true);
    assert.equal(mappingMatchesFilter(blank, 'headerless'), true);
  });

  await test('B. a REAL vendor header that literally reads "COLUMN_43" is NOT headerless (the collision the flag exists to prevent)', () => {
    const collision = makeMapping({
      sourceField: 'COLUMN_43',
      sourceHeader: 'COLUMN_43', // the workbook really does say this
      sourceLabel: 'COLUMN_43',
      sourceIndex: 43,
    });
    assert.equal(isHeaderlessMapping(collision), false, 'an authoritative non-null header always wins over the name shape');
    assert.equal(mappingMatchesFilter(collision, 'headerless'), false);
  });

  await test('legacy payload (no sourceHeader property at all) falls back to the INDEX-ANCHORED name shape', () => {
    const legacyBlank = makeLegacyMapping({ sourceField: 'COLUMN_7', sourceIndex: 7 });
    assert.equal(isHeaderlessMapping(legacyBlank), true, 'COLUMN_7 sitting at index 7 is how the parser synthesizes a blank header');

    const legacyMisplaced = makeLegacyMapping({ sourceField: 'COLUMN_7', sourceIndex: 3 });
    assert.equal(
      isHeaderlessMapping(legacyMisplaced),
      false,
      'COLUMN_7 at index 3 cannot have been synthesized — it is a real header that merely looks like one',
    );

    const legacyNamed = makeLegacyMapping({ sourceField: 'HASTA_ID', sourceIndex: 0 });
    assert.equal(isHeaderlessMapping(legacyNamed), false);
  });

  section('── PART 13 D: search by header, Excel letter and column number ───');

  const rowAQ = makeMapping({
    sourceField: 'EK_ACIKLAMA',
    sourceHeader: 'EK_ACIKLAMA',
    sourceLabel: 'EK_ACIKLAMA',
    sourceNormalized: 'EKACIKLAMA',
    sourceIndex: 42,
  });

  await test('D. the original header matches, case-insensitively', () => {
    assert.equal(mappingMatchesQuery(rowAQ, 'EK_ACIKLAMA'), true);
    assert.equal(mappingMatchesQuery(rowAQ, 'ek_aciklama'), true);
    assert.equal(mappingMatchesQuery(rowAQ, 'aciklama'), true, 'substring still matches inside the header');
  });

  await test('D. the Excel column LETTER matches index 42 in either case', () => {
    assert.equal(mappingMatchesQuery(rowAQ, 'AQ'), true);
    assert.equal(mappingMatchesQuery(rowAQ, 'aq'), true);
    assert.equal(mappingMatchesQuery(rowAQ, ' AQ '), true, 'query is trimmed');
  });

  await test('D. the 1-based physical column NUMBER matches index 42', () => {
    assert.equal(mappingMatchesQuery(rowAQ, '43'), true);
    assert.equal(mappingMatchesQuery(rowAQ, '42'), false, 'the 0-based index is not what an operator reads in Excel');
  });

  await test('D. negative guard: a partial column NUMBER must not match', () => {
    assert.equal(mappingMatchesQuery(rowAQ, '4'), false, '"4" must not match column 43 — numbers are whole tokens');
    const row14 = makeMapping({ sourceField: 'REF_KODU', sourceHeader: 'REF_KODU', sourceLabel: 'REF_KODU', sourceNormalized: 'REFKODU', sourceIndex: 13 });
    assert.equal(mappingMatchesQuery(row14, '14'), true);
    assert.equal(mappingMatchesQuery(row14, '1'), false);
    assert.equal(mappingMatchesQuery(row14, '4'), false);
  });

  await test('D. negative guard: a partial column LETTER must not match', () => {
    // NOTE: this fixture deliberately carries no letter "a" anywhere in its
    // text, because substring matching over the HEADER is intended — the rule
    // under test is only that the coordinate half is a whole token, so that
    // "A" does not drag in every column from A to AZ.
    const rowNoLetterA = makeMapping({
      sourceField: 'REF_KODU',
      sourceHeader: 'REF_KODU',
      sourceLabel: 'REF_KODU',
      sourceNormalized: 'REFKODU',
      sourceIndex: 42,
    });
    assert.equal(mappingMatchesQuery(rowNoLetterA, 'A'), false, '"A" must not match column AQ');
    assert.equal(mappingMatchesQuery(rowNoLetterA, 'Q'), false);
    assert.equal(mappingMatchesQuery(rowNoLetterA, 'AQ'), true);

    const rowA = makeMapping({ sourceField: 'REF_KODU', sourceHeader: 'REF_KODU', sourceLabel: 'REF_KODU', sourceNormalized: 'REFKODU', sourceIndex: 0 });
    assert.equal(mappingMatchesQuery(rowA, 'A'), true, 'column A itself still matches "A"');
  });

  await test('D. mappingMatchesQuery NEVER throws when the identity fields are missing (the production crash)', () => {
    // Exactly the shape a pre-R7 backend produced: no sourceHeader property,
    // and `sourceLabel` undefined because the persisted row has no such
    // column. The old implementation called `.toLowerCase()` on it and blew
    // up inside a render-phase useMemo — but only for a query that did NOT
    // substring-match sourceField first, i.e. the "no results" case.
    const legacy = makeLegacyMapping({ sourceField: 'CEPTELEFONU', sourceNormalized: 'CEPTELEFONU', sourceIndex: 5 });
    delete (legacy as Partial<MappingDto>).sourceLabel;

    assert.doesNotThrow(() => mappingMatchesQuery(legacy, 'zzz'));
    assert.equal(mappingMatchesQuery(legacy, 'zzz'), false);
    assert.equal(mappingMatchesQuery(legacy, 'cep'), true, 'sourceField still matches');
    assert.equal(mappingMatchesQuery(legacy, '6'), true, 'physical column number still matches');
    assert.equal(mappingMatchesQuery(legacy, ''), true);
    assert.doesNotThrow(() => mappingRowVisible(legacy, 'all', 'zzz'));
  });

  section('── unmappedWithData filter (needs a decision AND has values) ──────');

  const profileWithData = { filledCount: 1 };
  const profileEmpty = { filledCount: 0 };

  await test('MANUAL_REQUIRED with at least one filled cell is included', () => {
    const row = makeMapping({ state: 'MANUAL_REQUIRED' });
    assert.equal(mappingMatchesFilter(row, 'unmappedWithData', profileWithData), true);
  });

  await test('SENSITIVE_REVIEW_REQUIRED with data is included (it still needs a human)', () => {
    const row = makeMapping({ state: 'SENSITIVE_REVIEW_REQUIRED', reason: 'SPECIAL_CATEGORY_REVIEW' });
    assert.equal(mappingMatchesFilter(row, 'unmappedWithData', { filledCount: 7 }), true);
  });

  await test('AUTO_REVIEW with data is included', () => {
    const row = makeMapping({ state: 'AUTO_REVIEW' });
    assert.equal(mappingMatchesFilter(row, 'unmappedWithData', profileWithData), true);
  });

  await test('a column needing a decision but holding ZERO values is EXCLUDED', () => {
    for (const state of ['MANUAL_REQUIRED', 'AUTO_REVIEW', 'SENSITIVE_REVIEW_REQUIRED'] as const) {
      const row = makeMapping({ state });
      assert.equal(mappingMatchesFilter(row, 'unmappedWithData', profileEmpty), false, state);
    }
  });

  await test('a resolved / auto-confident column is EXCLUDED even when it has data', () => {
    for (const state of ['RESOLVED', 'AUTO_CONFIDENT', 'IGNORE', 'BLOCKED', 'LEGAL_BLOCKED'] as const) {
      const row = makeMapping({ state });
      assert.equal(mappingMatchesFilter(row, 'unmappedWithData', profileWithData), false, state);
    }
  });

  await test('an UNKNOWN fill (no profile loaded) is EXCLUDED — never claimed to have data', () => {
    const row = makeMapping({ state: 'MANUAL_REQUIRED' });
    assert.equal(mappingMatchesFilter(row, 'unmappedWithData', undefined), false);
    assert.equal(mappingMatchesFilter(row, 'unmappedWithData'), false, 'the profile parameter is optional');
  });

  await test('mappingRowVisible threads the optional profile through to the chip', () => {
    const row = makeMapping({ state: 'MANUAL_REQUIRED', sourceField: 'EK_ACIKLAMA', sourceHeader: 'EK_ACIKLAMA', sourceLabel: 'EK_ACIKLAMA', sourceNormalized: 'EKACIKLAMA', sourceIndex: 42 });
    assert.equal(mappingRowVisible(row, 'unmappedWithData', '', profileWithData), true);
    assert.equal(mappingRowVisible(row, 'unmappedWithData', '', profileEmpty), false);
    assert.equal(mappingRowVisible(row, 'unmappedWithData', ''), false, 'no profile → not claimed to have data');
    assert.equal(mappingRowVisible(row, 'unmappedWithData', 'zzz', profileWithData), false, 'the text query still applies');
    assert.equal(mappingRowVisible(row, 'unmappedWithData', 'AQ', profileWithData), true, 'coordinate search still applies');
  });

  section('── parseUnnamedColumnIndex (F3-DATA-MIG-TODAY-001-UI-002) ────────');

  await test('a COLUMN_<n> synthesized field name yields its numeric index', () => {
    assert.equal(parseUnnamedColumnIndex('COLUMN_0'), 0);
    assert.equal(parseUnnamedColumnIndex('COLUMN_17'), 17);
  });

  await test('a real header (including one that merely contains "COLUMN") is not misread as synthesized', () => {
    assert.equal(parseUnnamedColumnIndex('HASTA_ID'), null);
    assert.equal(parseUnnamedColumnIndex('COLUMN_NAME'), null, 'must anchor to digits only, not any COLUMN_ prefix');
    assert.equal(parseUnnamedColumnIndex('MY_COLUMN_3'), null, 'must anchor to the START of the string');
  });

  section('── excelColumnLetter (F3-DATA-MIG-TODAY-001-UI-006-R6) ───────────');

  await test('0-based index converts to the correct Excel-style column letter', () => {
    const cases: [number, string][] = [
      [0, 'A'],
      [25, 'Z'],
      [26, 'AA'],
      [27, 'AB'],
      [42, 'AQ'],
      [51, 'AZ'],
      [52, 'BA'],
      [701, 'ZZ'],
      [702, 'AAA'],
    ];
    for (const [index, expectedLetter] of cases) {
      assert.equal(excelColumnLetter(index), expectedLetter, `index ${index}`);
    }
  });

  await test('excelColumnCoordinate pairs the letter with the 1-based physical number', () => {
    assert.deepEqual(excelColumnCoordinate(0), { letter: 'A', number: 1 });
    assert.deepEqual(excelColumnCoordinate(25), { letter: 'Z', number: 26 });
    assert.deepEqual(excelColumnCoordinate(26), { letter: 'AA', number: 27 });
    assert.deepEqual(excelColumnCoordinate(42), { letter: 'AQ', number: 43 }, 'the screenshot column: AQ (43)');
  });

  section('── reconciliation balance invariant ─────────────────────────────');

  await test('balanced case: eligible === created+reused+skipped+failed+manualReview+blocked', () => {
    const balanced = isReconciliationBalanced({
      eligibleTotal: 100,
      created: 60,
      reused: 20,
      skipped: 10,
      failed: 5,
      manualReview: 3,
      blocked: 2,
    });
    assert.equal(balanced, true);
  });

  await test('off-by-one case is reported as imbalanced', () => {
    const balanced = isReconciliationBalanced({
      eligibleTotal: 100,
      created: 60,
      reused: 20,
      skipped: 10,
      failed: 5,
      manualReview: 3,
      blocked: 1, // one short of 100
    });
    assert.equal(balanced, false);
  });

  await test('all-zero case (empty run) is trivially balanced', () => {
    assert.equal(
      isReconciliationBalanced({ eligibleTotal: 0, created: 0, reused: 0, skipped: 0, failed: 0, manualReview: 0, blocked: 0 }),
      true,
    );
  });

  section('── formatByteSize ────────────────────────────────────────────────');

  await test('null/undefined/negative/NaN → em dash, never throws', () => {
    assert.equal(formatByteSize(null), '—');
    assert.equal(formatByteSize(undefined), '—');
    assert.equal(formatByteSize(-5), '—');
    assert.equal(formatByteSize(Number.NaN), '—');
  });

  await test('sub-1024 bytes render as plain bytes', () => {
    assert.equal(formatByteSize(0), '0 B');
    assert.equal(formatByteSize(512), '512 B');
  });

  await test('kilobytes, megabytes and gigabytes step through binary units', () => {
    assert.equal(formatByteSize(2048), '2.0 KB');
    assert.equal(formatByteSize(1536), '1.5 KB');
    assert.equal(formatByteSize(11 * 1024 * 1024), '11 MB');
    assert.equal(formatByteSize(1024 * 1024 * 1024), '1.0 GB');
  });

  await test('real first-customer workbook size (~10.8 MiB) formats sensibly', () => {
    const result = formatByteSize(Math.round(10.8 * 1024 * 1024));
    assert.ok(result.endsWith('MB'), result);
  });

  section('── formatPercent ─────────────────────────────────────────────────');

  await test('formats a 0..1 ratio as a rounded percentage', () => {
    assert.equal(formatPercent(0), '0%');
    assert.equal(formatPercent(1), '100%');
    assert.equal(formatPercent(0.457), '46%');
  });

  await test('null/undefined/NaN → em dash', () => {
    assert.equal(formatPercent(null), '—');
    assert.equal(formatPercent(undefined), '—');
    assert.equal(formatPercent(Number.NaN), '—');
  });

  section('── statusBadgeClass: all 14 statuses ────────────────────────────');

  const expectedBadge: Record<MigrationRunStatus, string> = {
    CREATED: 'badge-gray',
    UPLOADED: 'badge-gray',
    ANALYZED: 'badge-gray',
    MAPPING_REQUIRED: 'badge-gray',
    MAPPING_READY: 'badge-blue',
    DRY_RUN_RUNNING: 'badge-blue',
    DRY_RUN_COMPLETE: 'badge-yellow',
    BLOCKED: 'badge-red',
    READY: 'badge-yellow',
    RUNNING: 'badge-blue',
    PARTIAL_FAILURE: 'badge-yellow',
    COMPLETED: 'badge-green',
    FAILED: 'badge-red',
    CANCELLED: 'badge-gray',
  };

  for (const status of MIGRATION_RUN_STATUSES) {
    await test(`${status} → ${expectedBadge[status]}`, () => {
      assert.equal(statusBadgeClass(status), expectedBadge[status]);
    });
  }

  section('── in-flight / terminal helpers ─────────────────────────────────');

  await test('isRunInFlight is true for RUNNING and DRY_RUN_RUNNING only', () => {
    for (const status of MIGRATION_RUN_STATUSES) {
      const expectedInFlight = status === 'RUNNING' || status === 'DRY_RUN_RUNNING';
      assert.equal(isRunInFlight(status), expectedInFlight, status);
    }
  });

  await test('isTerminalRunStatus is true for COMPLETED, FAILED, CANCELLED only', () => {
    for (const status of MIGRATION_RUN_STATUSES) {
      const expectedTerminal = status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
      assert.equal(isTerminalRunStatus(status), expectedTerminal, status);
    }
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
