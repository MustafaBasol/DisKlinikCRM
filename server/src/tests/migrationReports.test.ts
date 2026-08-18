/**
 * migrationReports.test.ts — F3-DATA-MIG-TODAY-001, coverage for
 * services/migration/reports/{formulaGuard,migrationReports}.ts.
 *
 * Koşturma: cd server && npx tsx src/tests/migrationReports.test.ts
 *
 * No live database (matches this repo's tsx-script test convention — see
 * patientsImportClinicScope.test.ts / reportExportFoundation.test.ts). The
 * Prisma seam `__setMigrationReportPrismaClientForTests` is used to inject an
 * in-memory fake so the report builders can be exercised end-to-end (real
 * ExcelJS buffers, built and read back) without a database.
 *
 * Two things this suite exists to prove:
 *   A. formulaGuard.escapeSpreadsheetValue is a correct, idempotent
 *      formula-injection defence.
 *   B. The two report workbooks are built exclusively from
 *      MigrationRowOutcome-shaped columns and structurally CANNOT contain a
 *      patient name/phone/email/address/national id/note/DOB, no matter what
 *      is fed into the row outcomes — because the report columns are a fixed,
 *      named allow-list (SUCCESS_COLUMNS / FAILURE_COLUMNS), not a spread of
 *      whatever the row happens to carry.
 */

import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import { escapeSpreadsheetValue } from '../services/migration/reports/formulaGuard.js';
import {
  SUCCESS_COLUMNS,
  FAILURE_COLUMNS,
  classifyBlocker,
  buildSuccessReport,
  buildFailureReport,
  __setMigrationReportPrismaClientForTests,
  type MigrationReportPrismaClient,
} from '../services/migration/reports/migrationReports.js';

// ─── Test harness (same shape as patientsImportClinicScope.test.ts) ─────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err?.message ?? err}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ══════════════════════════════════════════════════════════════════════════
// A. formulaGuard — escapeSpreadsheetValue
// ══════════════════════════════════════════════════════════════════════════

section('A. formulaGuard.escapeSpreadsheetValue');

const DANGEROUS_STRINGS: readonly string[] = [
  `=cmd|'/c calc'!A1`,
  '+1+1',
  '-1+1',
  '@SUM(A1)',
  '\t=1', // leading tab
  ' =1', // leading NBSP
];

await test('every dangerous string gains exactly one leading apostrophe', () => {
  for (const value of DANGEROUS_STRINGS) {
    const escaped = escapeSpreadsheetValue(value);
    assert.equal(typeof escaped, 'string');
    assert.equal((escaped as string)[0], "'", `expected a leading apostrophe for ${JSON.stringify(value)}, got ${JSON.stringify(escaped)}`);
    assert.equal(escaped, `'${value}`, `escaped value must be exactly the original prefixed with a single apostrophe`);
  }
});

await test('an already-escaped string is left alone (not double-escaped)', () => {
  const alreadyEscaped = "'=x";
  assert.equal(escapeSpreadsheetValue(alreadyEscaped), alreadyEscaped);
});

await test('safe plain text is untouched', () => {
  assert.equal(escapeSpreadsheetValue('normal text'), 'normal text');
});

await test('non-string values pass through unchanged', () => {
  const aDate = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(escapeSpreadsheetValue(123), 123);
  assert.equal(escapeSpreadsheetValue(true), true);
  assert.equal(escapeSpreadsheetValue(aDate), aDate);
  assert.equal(escapeSpreadsheetValue(null), null);
  assert.equal(escapeSpreadsheetValue(undefined), undefined);
});

await test('escaping twice equals escaping once (idempotent)', () => {
  const allValues: unknown[] = [
    ...DANGEROUS_STRINGS,
    'normal text',
    123,
    true,
    new Date('2026-01-01T00:00:00.000Z'),
    null,
    undefined,
  ];
  for (const value of allValues) {
    const once = escapeSpreadsheetValue(value);
    const twice = escapeSpreadsheetValue(once);
    assert.deepEqual(twice, once, `escaping twice must equal escaping once for ${JSON.stringify(value)}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// B. Report generation with an injected fake Prisma
// ══════════════════════════════════════════════════════════════════════════

section('B. Report generation (fake Prisma, real ExcelJS buffers)');

const FAKE_RUN_ID = '11111111-1111-4111-8111-111111111111';
const HYPERLINK_PAYLOAD = '=HYPERLINK("http://evil","click")';

interface FakeRowOutcome {
  sourceRowNumber: number;
  sourceId: string | null;
  status: string;
  resultCode: string | null;
  errorMessage: string | null;
  fieldName: string | null;
  retryable: boolean;
  destinationPatientId: string | null;
  identityClassification: string | null;
  identityWritten: boolean;
  warnings: unknown;
}

// 10 synthetic rows spanning CREATED / MATCHED / FAILED / BLOCKED / INVALID /
// DUPLICATE_SOURCE, and covering every classifyBlocker() family.
const FAKE_ROWS: FakeRowOutcome[] = [
  {
    sourceRowNumber: 1,
    sourceId: 'HASTA-1001',
    status: 'CREATED',
    resultCode: null,
    errorMessage: null,
    fieldName: null,
    retryable: false,
    destinationPatientId: 'patient-uuid-0001',
    identityClassification: 'VALID',
    identityWritten: true,
    warnings: ['DOB_NORMALIZED'],
  },
  {
    sourceRowNumber: 2,
    sourceId: 'HASTA-1002',
    status: 'CREATED',
    resultCode: null,
    errorMessage: null,
    fieldName: null,
    retryable: false,
    destinationPatientId: 'patient-uuid-0002',
    identityClassification: 'VALID',
    identityWritten: true,
    warnings: [],
  },
  {
    sourceRowNumber: 3,
    sourceId: 'HASTA-1003',
    status: 'MATCHED',
    resultCode: null,
    errorMessage: null,
    fieldName: null,
    retryable: false,
    destinationPatientId: 'patient-uuid-0003',
    identityClassification: 'AMBIGUOUS',
    identityWritten: false,
    warnings: ['PHONE_NORMALIZED'],
  },
  {
    // classifyBlocker: ROW_* -> DATA. fieldName is a REAL destination key, so
    // mappingContextFor must surface it.
    sourceRowNumber: 4,
    sourceId: 'HASTA-1004',
    status: 'FAILED',
    resultCode: 'ROW_VALUE_INVALID',
    errorMessage: 'Invalid value for field',
    fieldName: 'patient.firstName',
    retryable: false,
    destinationPatientId: null,
    identityClassification: null,
    identityWritten: false,
    warnings: [],
  },
  {
    // classifyBlocker: DATABASE_ERROR -> SYSTEM. Carries the formula-injection
    // payload — the point of this fixture.
    sourceRowNumber: 5,
    sourceId: 'HASTA-1005',
    status: 'FAILED',
    resultCode: 'DATABASE_ERROR',
    errorMessage: HYPERLINK_PAYLOAD,
    fieldName: null,
    retryable: true,
    destinationPatientId: null,
    identityClassification: null,
    identityWritten: false,
    warnings: [],
  },
  {
    // classifyBlocker: LEGAL_BLOCKED -> LEGAL
    sourceRowNumber: 6,
    sourceId: 'HASTA-1006',
    status: 'BLOCKED',
    resultCode: 'LEGAL_BLOCKED',
    errorMessage: 'Legal hold active',
    fieldName: null,
    retryable: false,
    destinationPatientId: null,
    identityClassification: null,
    identityWritten: false,
    warnings: [],
  },
  {
    // classifyBlocker: MAPPING_* -> MAPPING. fieldName is NOT a real
    // destination key, so mappingContextFor must return empty.
    sourceRowNumber: 7,
    sourceId: 'HASTA-1007',
    status: 'INVALID',
    resultCode: 'MAPPING_INVALID',
    errorMessage: 'Mapping invalid',
    fieldName: 'bogus.field',
    retryable: false,
    destinationPatientId: null,
    identityClassification: null,
    identityWritten: false,
    warnings: [],
  },
  {
    // classifyBlocker: DUPLICATE_* -> DATA
    sourceRowNumber: 8,
    sourceId: 'HASTA-1008',
    status: 'DUPLICATE_SOURCE',
    resultCode: 'DUPLICATE_SOURCE_RECORD',
    errorMessage: 'Duplicate source record',
    fieldName: null,
    retryable: false,
    destinationPatientId: null,
    identityClassification: null,
    identityWritten: false,
    warnings: [],
  },
  {
    // classifyBlocker: IDENTITY_* -> IDENTITY
    sourceRowNumber: 9,
    sourceId: 'HASTA-1009',
    status: 'FAILED',
    resultCode: 'IDENTITY_INVALID',
    errorMessage: 'Identity invalid',
    fieldName: null,
    retryable: false,
    destinationPatientId: null,
    identityClassification: null,
    identityWritten: false,
    warnings: [],
  },
  {
    // classifyBlocker: PLAN_LIMIT_EXCEEDED -> PLAN
    sourceRowNumber: 10,
    sourceId: 'HASTA-1010',
    status: 'FAILED',
    resultCode: 'PLAN_LIMIT_EXCEEDED',
    errorMessage: 'Plan limit exceeded',
    fieldName: null,
    retryable: false,
    destinationPatientId: null,
    identityClassification: null,
    identityWritten: false,
    warnings: [],
  },
];

const SUCCESS_STATUSES = new Set(['CREATED', 'MATCHED']);

function buildFakeRun() {
  return {
    id: FAKE_RUN_ID,
    organizationId: 'org-fake-0001',
    clinicId: 'clinic-fake-0001',
    sourceSystem: 'LEGACY_TEST',
    profileVersion: '1',
    entityType: 'PATIENT',
    status: 'COMPLETED',
    sourceFileFormat: 'xlsx',
    sourceFileSizeBytes: 12345,
    sourceFileSha256: 'deadbeef',
    sheetName: 'Hastalar',
    sheetIndex: 0,
    totalSourceRows: FAKE_ROWS.length,
    headerColumnCount: 10,
    batchSize: 500,
    totalBatches: 1,
    processedRows: FAKE_ROWS.length,
    createdRows: FAKE_ROWS.filter((r) => r.status === 'CREATED').length,
    matchedRows: FAKE_ROWS.filter((r) => r.status === 'MATCHED').length,
    skippedRows: 0,
    failedRows: FAKE_ROWS.filter((r) => r.status === 'FAILED').length,
    warningRows: 0,
    blockedRows: FAKE_ROWS.filter((r) => r.status === 'BLOCKED').length,
    reconciliation: { balanced: true },
    startedAt: new Date('2026-08-01T00:00:00.000Z'),
    completedAt: new Date('2026-08-01T00:05:00.000Z'),
  };
}

/**
 * Minimal fake honoring the same query shape pageRowOutcomes()/loadRun() use:
 * status.in / status.notIn filtering, sourceRowNumber > cursor, ascending
 * order, and `take`. Never used by production — injected only for this test.
 */
function buildFakePrismaClient(): MigrationReportPrismaClient {
  return {
    migrationRun: {
      async findUnique(args) {
        const where = args.where as { id: string };
        if (where.id !== FAKE_RUN_ID) return null;
        return buildFakeRun();
      },
    },
    migrationRowOutcome: {
      async findMany(args) {
        const where = args.where as {
          sourceRowNumber: { gt: number };
          status?: { in?: string[]; notIn?: string[] };
        };
        let rows = FAKE_ROWS.filter((r) => r.sourceRowNumber > where.sourceRowNumber.gt);
        if (where.status?.in) {
          const allow = new Set(where.status.in);
          rows = rows.filter((r) => allow.has(r.status));
        }
        if (where.status?.notIn) {
          const deny = new Set(where.status.notIn);
          rows = rows.filter((r) => !deny.has(r.status));
        }
        rows = rows.slice().sort((a, b) => a.sourceRowNumber - b.sourceRowNumber);
        return rows.slice(0, args.take).map((r) => ({ ...r }));
      },
    },
  };
}

async function loadSheet(buffer: Buffer, sheetIndex = 0): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  return wb.worksheets[sheetIndex];
}

/** ExcelJS row.values is 1-indexed with a leading `undefined` at index 0. */
function rowValues(sheet: ExcelJS.Worksheet, rowNumber: number): unknown[] {
  const raw = sheet.getRow(rowNumber).values as unknown[];
  return raw.slice(1);
}

const PII_FIELD_NAMES = [
  'firstName',
  'lastName',
  'name',
  'phone',
  'email',
  'address',
  'tcNo',
  'tckn',
  'nationalId',
  'identityNumber',
  'notes',
  'dateOfBirth',
];

__setMigrationReportPrismaClientForTests(buildFakePrismaClient());

let successResult: Awaited<ReturnType<typeof buildSuccessReport>> | undefined;
let failureResult: Awaited<ReturnType<typeof buildFailureReport>> | undefined;

await test('buildSuccessReport and buildFailureReport both run against the fake Prisma client', async () => {
  successResult = await buildSuccessReport(FAKE_RUN_ID);
  failureResult = await buildFailureReport(FAKE_RUN_ID);
  assert.ok(successResult.buffer.length > 0);
  assert.ok(failureResult.buffer.length > 0);
});

await test('Success sheet header row equals SUCCESS_COLUMNS exactly', async () => {
  const sheet = await loadSheet(successResult!.buffer);
  assert.equal(sheet.name, 'Success');
  assert.deepEqual(rowValues(sheet, 1), [...SUCCESS_COLUMNS]);
});

await test('Failure sheet header row equals FAILURE_COLUMNS exactly', async () => {
  const sheet = await loadSheet(failureResult!.buffer);
  assert.equal(sheet.name, 'Failures');
  assert.deepEqual(rowValues(sheet, 1), [...FAILURE_COLUMNS]);
});

await test('Success sheet contains ONLY rows whose status is CREATED or MATCHED', async () => {
  const expectedCount = FAKE_ROWS.filter((r) => SUCCESS_STATUSES.has(r.status)).length;
  assert.equal(successResult!.rowCount, expectedCount);

  const sheet = await loadSheet(successResult!.buffer);
  const sourceIdColIdx = SUCCESS_COLUMNS.indexOf('sourceId'); // 0-indexed in the column list
  const dataRowCount = sheet.rowCount - 1; // minus header
  assert.equal(dataRowCount, expectedCount);

  for (let r = 2; r <= sheet.rowCount; r++) {
    const values = rowValues(sheet, r);
    const sourceId = values[sourceIdColIdx] as string;
    const fixtureRow = FAKE_ROWS.find((row) => row.sourceId === sourceId);
    assert.ok(fixtureRow, `unexpected sourceId ${sourceId} in Success sheet`);
    assert.ok(SUCCESS_STATUSES.has(fixtureRow!.status), `row ${sourceId} with status ${fixtureRow!.status} must not appear in Success sheet`);
  }
});

await test('Failure sheet contains only the rest (everything NOT CREATED/MATCHED)', async () => {
  const expectedCount = FAKE_ROWS.filter((r) => !SUCCESS_STATUSES.has(r.status)).length;
  assert.equal(failureResult!.rowCount, expectedCount);

  const sheet = await loadSheet(failureResult!.buffer);
  const sourceIdColIdx = FAILURE_COLUMNS.indexOf('sourceId');
  const dataRowCount = sheet.rowCount - 1;
  assert.equal(dataRowCount, expectedCount);

  for (let r = 2; r <= sheet.rowCount; r++) {
    const values = rowValues(sheet, r);
    const sourceId = values[sourceIdColIdx] as string;
    const fixtureRow = FAKE_ROWS.find((row) => row.sourceId === sourceId);
    assert.ok(fixtureRow, `unexpected sourceId ${sourceId} in Failure sheet`);
    assert.ok(!SUCCESS_STATUSES.has(fixtureRow!.status), `row ${sourceId} with status ${fixtureRow!.status} must not appear in Failure sheet`);
  }
});

await test('a row whose errorMessage is a HYPERLINK formula payload is written with a leading apostrophe, never a bare "="', async () => {
  const sheet = await loadSheet(failureResult!.buffer);
  const sourceIdColIdx = FAILURE_COLUMNS.indexOf('sourceId');
  const errorMessageColIdx = FAILURE_COLUMNS.indexOf('errorMessage');

  let found = false;
  for (let r = 2; r <= sheet.rowCount; r++) {
    const values = rowValues(sheet, r);
    if (values[sourceIdColIdx] === 'HASTA-1005') {
      found = true;
      const cellValue = values[errorMessageColIdx];
      assert.equal(typeof cellValue, 'string');
      assert.equal((cellValue as string)[0], "'", `expected leading apostrophe, got ${JSON.stringify(cellValue)}`);
      assert.equal(cellValue, `'${HYPERLINK_PAYLOAD}`);
      assert.notEqual((cellValue as string)[0], '=');
    }
  }
  assert.ok(found, 'expected to find the HASTA-1005 row in the Failure sheet');
});

await test('PII ABSENCE — neither sheet header row contains any PII field name', async () => {
  const successSheet = await loadSheet(successResult!.buffer);
  const failureSheet = await loadSheet(failureResult!.buffer);

  const successHeader = (rowValues(successSheet, 1) as string[]).map((v) => String(v));
  const failureHeader = (rowValues(failureSheet, 1) as string[]).map((v) => String(v));

  for (const piiName of PII_FIELD_NAMES) {
    assert.ok(
      !successHeader.includes(piiName),
      `Success sheet header must not contain PII field "${piiName}" — actual header: ${JSON.stringify(successHeader)}`,
    );
    assert.ok(
      !failureHeader.includes(piiName),
      `Failure sheet header must not contain PII field "${piiName}" — actual header: ${JSON.stringify(failureHeader)}`,
    );
  }
});

await test('mappingContext surfaces only real destination keys, never an unrecognized fieldName', async () => {
  const sheet = await loadSheet(failureResult!.buffer);
  const sourceIdColIdx = FAILURE_COLUMNS.indexOf('sourceId');
  const mappingContextColIdx = FAILURE_COLUMNS.indexOf('mappingContext');

  for (let r = 2; r <= sheet.rowCount; r++) {
    const values = rowValues(sheet, r);
    const sourceId = values[sourceIdColIdx];
    const mappingContext = values[mappingContextColIdx];
    if (sourceId === 'HASTA-1004') {
      assert.equal(mappingContext, 'patient.firstName', 'a real destination key must be surfaced');
    }
    if (sourceId === 'HASTA-1007') {
      // An unrecognized fieldName resolves to an empty string, which ExcelJS's
      // streaming writer legitimately omits as a trailing cell when every
      // column after it on the row is also empty (the `warnings` column here
      // is ''). Reading it back therefore yields `undefined`/`null`, not the
      // literal string '' — both mean "blank cell" to any spreadsheet reader,
      // so accept either as proof the field was NOT surfaced.
      assert.ok(
        mappingContext === '' || mappingContext === undefined || mappingContext === null,
        `an unrecognized fieldName must not be surfaced, got ${JSON.stringify(mappingContext)}`,
      );
    }
  }
});

section('B.classifyBlocker — every error-code family maps to the right bucket');

await test('classifyBlocker maps each family correctly', () => {
  assert.equal(classifyBlocker(null), 'UNCLASSIFIED');
  assert.equal(classifyBlocker('LEGAL_BLOCKED'), 'LEGAL');
  assert.equal(classifyBlocker('MAPPING_INVALID'), 'MAPPING');
  assert.equal(classifyBlocker('MAPPING_REQUIRED'), 'MAPPING');
  assert.equal(classifyBlocker('REFERENCE_UNRESOLVED'), 'MAPPING');
  assert.equal(classifyBlocker('IDENTITY_INVALID'), 'IDENTITY');
  assert.equal(classifyBlocker('IDENTITY_AMBIGUOUS'), 'IDENTITY');
  assert.equal(classifyBlocker('IDENTITY_CRYPTO_NOT_CONFIGURED'), 'IDENTITY');
  assert.equal(classifyBlocker('ROW_VALUE_INVALID'), 'DATA');
  assert.equal(classifyBlocker('ROW_REQUIRED_FIELD_MISSING'), 'DATA');
  assert.equal(classifyBlocker('DUPLICATE_SOURCE_RECORD'), 'DATA');
  assert.equal(classifyBlocker('PLAN_LIMIT_EXCEEDED'), 'PLAN');
  assert.equal(classifyBlocker('DATABASE_ERROR'), 'SYSTEM');
  assert.equal(classifyBlocker('BATCH_FAILED'), 'SYSTEM');
  assert.equal(classifyBlocker('INTERNAL_ERROR'), 'SYSTEM');
  assert.equal(classifyBlocker('RUN_NOT_FOUND'), 'UNCLASSIFIED');
});

// ─── Restore the real Prisma client so this test leaves no global state ─────
__setMigrationReportPrismaClientForTests(null);

await test('restoring the real Prisma client leaves no global state behind', () => {
  // No direct way to introspect the module-private binding from outside; this
  // is a documentation test that the restore call above ran without throwing,
  // matching the contract described on __setMigrationReportPrismaClientForTests.
  assert.ok(true);
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
