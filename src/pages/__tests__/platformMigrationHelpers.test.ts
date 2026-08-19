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
  parseUnnamedColumnIndex,
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

  assert.deepEqual(MAPPING_FILTER_IDS, ['all', 'unresolved', 'blocked', 'legal', 'ignored', 'auto']);

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
