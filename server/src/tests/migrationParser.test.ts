/**
 * migrationParser.test.ts — F3-DATA-MIG-TODAY-001 verification suite for the
 * migration parser subsystem: fileSignature.ts, biff8Reader.ts, xlsxReader.ts,
 * canonicalParser.ts and sourceFileStore.ts.
 *
 * Koşturma: cd server && npx tsx src/tests/migrationParser.test.ts
 *
 * Harness shape copied from patientsImportClinicScope.test.ts — standalone tsx
 * script, node:assert/strict, hand-rolled test()/section() counters, no
 * vitest/jest on the server side.
 *
 * ONLY SYNTHETIC DATA. No real patient workbook is read here — that proof is a
 * separate read-only script kept outside the repo (see the migration task
 * report). Every `.xls` buffer used below comes from `buildBiff8Fixture` /
 * `buildCorruptOle2` / `buildNonOle2` in tests/helpers/biff8Fixture.ts, and
 * every `.xlsx` buffer is built in-memory with exceljs.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ExcelJS from 'exceljs';

import { MigrationError, MAX_UPLOAD_BYTES, type SourceColumnProfile } from '../services/migration/contracts.js';
import {
  assertSupportedUpload,
  detectFileSignature,
  inspectUpload,
  sanitizeDisplayFilename,
} from '../services/migration/parser/fileSignature.js';
import { Biff8Error, readBiff8 } from '../services/migration/parser/biff8Reader.js';
import {
  parseSourceWorkbook,
  profileColumns,
  PARSER_WARNINGS,
  UNNAMED_COLUMN_PREFIX,
} from '../services/migration/parser/canonicalParser.js';
import { suggestMappings } from '../services/migration/mapping/mappingEngine.js';
import { buildColumnPreviews } from '../services/migration/mapping/columnPreview.js';
import {
  deleteSourceFile,
  getMigrationSourceRoot,
  readSourceFile,
  storeSourceFile,
} from '../services/migration/sourceFileStore.js';
import {
  buildBiff8Fixture,
  buildCorruptOle2,
  buildNonOle2,
  type FixtureCell,
  type FixtureSheet,
} from './helpers/biff8Fixture.js';

// ─── Test harness (same shape as sibling suites) ────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
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

async function assertMigrationError(
  fn: () => unknown | Promise<unknown>,
  expectedCode: string,
): Promise<MigrationError> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof MigrationError, `expected a MigrationError, got ${String(err)}`);
    assert.equal((err as MigrationError).code, expectedCode);
    return err as MigrationError;
  }
  throw new Error(`expected a MigrationError(${expectedCode}) to be thrown, but nothing was thrown`);
}

// ─── Small binary fixtures used only for signature classification ──────────

const OLE2_STUB = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i] as number;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

/** A minimal, structurally valid STORE-method ZIP with one arbitrary entry. */
function buildMinimalZip(entryName: string, content: Buffer): Buffer {
  const nameBuf = Buffer.from(entryName, 'utf8');
  const crc = crc32(content);

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(content.length, 18);
  localHeader.writeUInt32LE(content.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);
  const localSection = Buffer.concat([localHeader, nameBuf, content]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(content.length, 20);
  centralHeader.writeUInt32LE(content.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);
  const centralSection = Buffer.concat([centralHeader, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSection.length, 12);
  eocd.writeUInt32LE(localSection.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localSection, centralSection, eocd]);
}

async function buildGenuineXlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['HeaderA', 'HeaderB']);
  ws.addRow(['v1', 'v2']);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ══════════════════════════════════════════════════════════════════════════
// A. Signature detection
// ══════════════════════════════════════════════════════════════════════════

section('A. Signature detection (detectFileSignature / assertSupportedUpload / sanitizeDisplayFilename)');

await test('genuine .xlsx (built with exceljs) is classified xlsx', async () => {
  const buf = await buildGenuineXlsxBuffer();
  const result = detectFileSignature(buf);
  assert.equal(result.kind, 'xlsx');
  assert.equal(assertSupportedUpload(buf, 'workbook.xlsx'), 'xlsx');
});

await test('OLE2 magic-byte stub is classified xls', () => {
  const result = detectFileSignature(OLE2_STUB);
  assert.equal(result.kind, 'xls');
});

await test('real .xls built by buildBiff8Fixture is classified xls', () => {
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [[{ v: 'H' }], [{ v: 'x' }]] }]);
  const result = detectFileSignature(buf);
  assert.equal(result.kind, 'xls');
  assert.equal(assertSupportedUpload(buf, 'legacy.xls'), 'xls');
});

await test('ZIP that is not OOXML classifies zip_not_xlsx and assertSupportedUpload throws FILE_UNSUPPORTED', async () => {
  const buf = buildMinimalZip('hello.txt', Buffer.from('hello world', 'utf8'));
  const result = detectFileSignature(buf);
  assert.equal(result.kind, 'zip_not_xlsx');
  await assertMigrationError(() => assertSupportedUpload(buf, 'notaworkbook.zip'), 'FILE_UNSUPPORTED');
});

await test('MZ executable stub classifies unsupported -> FILE_UNSUPPORTED', async () => {
  const buf = Buffer.alloc(16);
  buf[0] = 0x4d;
  buf[1] = 0x5a;
  assert.equal(detectFileSignature(buf).kind, 'unsupported');
  await assertMigrationError(() => assertSupportedUpload(buf, 'malware.xls'), 'FILE_UNSUPPORTED');
});

await test('HTML page classifies unsupported -> FILE_UNSUPPORTED', async () => {
  const buf = Buffer.from('<!DOCTYPE html><html><body>not a workbook</body></html>', 'utf8');
  assert.equal(detectFileSignature(buf).kind, 'unsupported');
  await assertMigrationError(() => assertSupportedUpload(buf, 'page.xls'), 'FILE_UNSUPPORTED');
});

await test('%PDF stub classifies unsupported -> FILE_UNSUPPORTED', async () => {
  const buf = Buffer.from('%PDF-1.4\n%âãÏÓ\n', 'utf8');
  assert.equal(detectFileSignature(buf).kind, 'unsupported');
  await assertMigrationError(() => assertSupportedUpload(buf, 'document.xls'), 'FILE_UNSUPPORTED');
});

await test('empty buffer -> assertSupportedUpload throws FILE_MISSING', async () => {
  await assertMigrationError(() => assertSupportedUpload(Buffer.alloc(0), 'empty.xls'), 'FILE_MISSING');
});

await test('4-byte buffer -> assertSupportedUpload throws FILE_CORRUPTED', async () => {
  const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  assert.equal(detectFileSignature(buf).kind, 'corrupted');
  await assertMigrationError(() => assertSupportedUpload(buf, 'truncated.xls'), 'FILE_CORRUPTED');
});

await test('extension spoofing: an OLE2 buffer named .xlsx is accepted AS xls — the signature wins', async () => {
  const format = assertSupportedUpload(OLE2_STUB, 'patients.xlsx');
  assert.equal(format, 'xls');
  const inspection = inspectUpload(OLE2_STUB, 'patients.xlsx');
  assert.equal(inspection.format, 'xls');
  assert.equal(inspection.extensionMismatch, true);
  assert.match(inspection.detail, /^SIGNATURE_XLS_EXTENSION_XLSX/);
});

await test('buffer over MAX_UPLOAD_BYTES -> assertSupportedUpload throws FILE_TOO_LARGE', async () => {
  const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
  OLE2_STUB.copy(oversized, 0);
  await assertMigrationError(() => assertSupportedUpload(oversized, 'huge.xls'), 'FILE_TOO_LARGE');
});

await test('sanitizeDisplayFilename strips path traversal (../../etc/passwd)', () => {
  const safe = sanitizeDisplayFilename('../../etc/passwd');
  assert.ok(!safe.includes('/'), `must not contain '/': ${safe}`);
  assert.ok(!safe.includes('\\'), `must not contain '\\': ${safe}`);
  assert.ok(!safe.includes('..'), `must not contain a traversal token: ${safe}`);
});

await test('sanitizeDisplayFilename strips a Windows absolute path (C:\\Windows\\x.xls)', () => {
  const safe = sanitizeDisplayFilename('C:\\Windows\\x.xls');
  assert.ok(!safe.includes('/'), `must not contain '/': ${safe}`);
  assert.ok(!safe.includes('\\'), `must not contain '\\': ${safe}`);
  assert.ok(!safe.includes(':'), `must not contain a drive separator: ${safe}`);
  assert.equal(safe, 'x.xls');
});

await test('sanitizeDisplayFilename strips embedded NUL bytes (a\\u0000b.xls)', () => {
  const safe = sanitizeDisplayFilename('a\u0000b.xls');
  assert.ok(!safe.includes('\u0000'), 'must not contain a NUL byte');
  assert.equal(safe, 'ab.xls');
});

await test('sanitizeDisplayFilename falls back to a fixed literal for an empty name', () => {
  assert.equal(sanitizeDisplayFilename(''), 'source');
});

await test('sanitizeDisplayFilename caps a 300-char name', () => {
  const longName = `${'a'.repeat(300)}.xls`;
  const safe = sanitizeDisplayFilename(longName);
  assert.ok(safe.length <= 120, `expected <=120 chars, got ${safe.length}`);
});

// ══════════════════════════════════════════════════════════════════════════
// B. BIFF8 round-trip (buildBiff8Fixture -> readBiff8 / parseSourceWorkbook)
// ══════════════════════════════════════════════════════════════════════════

section('B. BIFF8 round-trip');

await test('Turkish characters round-trip byte-identically through the SST', () => {
  const turkish = 'çğıöşüİĞÜŞÖÇ';
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [[{ v: turkish }]] }]);
  const wb = readBiff8(buf);
  const cell = wb.sheets[0]!.rows[0]![0]!;
  assert.equal(cell.kind, 'string');
  assert.equal((cell as { value: string }).value, turkish);
});

await test('a compressed string long enough to force a CONTINUE split round-trips (forceContinueSplit)', () => {
  // Only Latin-1-range Turkish letters, so the string starts COMPRESSED (not
  // UTF-16) and forceContinueSplit's flip-on-split logic is exercised.
  const longTurkish = 'çöüÇÖÜ'.repeat(50); // 300 chars, > 64-byte record budget
  const buf = buildBiff8Fixture(
    [{ name: 'Sheet1', rows: [[{ v: longTurkish }]] }],
    { forceContinueSplit: true },
  );
  const wb = readBiff8(buf);
  const cell = wb.sheets[0]!.rows[0]![0]!;
  assert.equal(cell.kind, 'string');
  assert.equal((cell as { value: string }).value, longTurkish);
  assert.equal((cell as { value: string }).value.length, 300);
});

await test('numbers, booleans and blanks round-trip through BIFF8', () => {
  const rows: FixtureCell[][] = [[{ v: 123456 }, { v: true }, { v: false }, { v: null }]];
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows }]);
  const wb = readBiff8(buf);
  const [numberCell, trueCell, falseCell, blankCell] = wb.sheets[0]!.rows[0]!;
  assert.equal(numberCell!.kind, 'number');
  assert.equal((numberCell as { value: number }).value, 123456);
  assert.equal(trueCell!.kind, 'boolean');
  assert.equal((trueCell as { value: boolean }).value, true);
  assert.equal(falseCell!.kind, 'boolean');
  assert.equal((falseCell as { value: boolean }).value, false);
  assert.equal(blankCell!.kind, 'empty');
});

await test('a date-formatted cell decodes to kind "date" with the right calendar date (1900 epoch, serial 61 = 1900-03-01)', () => {
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [[{ v: 61, date: true }]] }], { epoch: 1900 });
  const wb = readBiff8(buf);
  assert.equal(wb.dateEpoch, 1900);
  const cell = wb.sheets[0]!.rows[0]![0]!;
  assert.equal(cell.kind, 'date');
  const dateCell = cell as { kind: 'date'; value: Date; serial: number };
  assert.equal(dateCell.serial, 61);
  assert.equal(dateCell.value.toISOString().slice(0, 10), '1900-03-01');
});

await test('the same serial decodes to a different date under the 1904 epoch than under 1900', () => {
  const buf1900 = buildBiff8Fixture([{ name: 'Sheet1', rows: [[{ v: 61, date: true }]] }], { epoch: 1900 });
  const buf1904 = buildBiff8Fixture([{ name: 'Sheet1', rows: [[{ v: 61, date: true }]] }], { epoch: 1904 });
  const wb1900 = readBiff8(buf1900);
  const wb1904 = readBiff8(buf1904);
  assert.equal(wb1900.dateEpoch, 1900);
  assert.equal(wb1904.dateEpoch, 1904);
  const cell1900 = wb1900.sheets[0]!.rows[0]![0]! as { kind: 'date'; value: Date };
  const cell1904 = wb1904.sheets[0]!.rows[0]![0]! as { kind: 'date'; value: Date };
  const iso1900 = cell1900.value.toISOString().slice(0, 10);
  const iso1904 = cell1904.value.toISOString().slice(0, 10);
  assert.notEqual(iso1900, iso1904, 'the same serial must decode to different dates under different epochs');
  // Independent sanity check of the 1904 anchor: 1904-01-01 + 61 days.
  const expected1904 = new Date(Date.UTC(1904, 0, 1) + 61 * 86_400_000).toISOString().slice(0, 10);
  assert.equal(iso1904, expected1904);
});

await test('a hidden sheet is reported hidden and is NOT selected by default', async () => {
  const sheets: FixtureSheet[] = [
    { name: 'HiddenSheet', hidden: true, rows: [[{ v: 'H' }], [{ v: 'x' }]] },
    { name: 'VisibleSheet', rows: [[{ v: 'HeaderA' }], [{ v: 'DataA' }]] },
  ];
  const buf = buildBiff8Fixture(sheets);

  const raw = readBiff8(buf);
  assert.equal(raw.sheets[0]!.hidden, true);
  assert.equal(raw.sheets[0]!.visibility, 'hidden');
  assert.equal(raw.sheets[1]!.hidden, false);

  const canonical = await parseSourceWorkbook(buf, 'xls');
  assert.equal(canonical.metadata.selectedSheetIndex, 1, 'the visible sheet must be selected, not the hidden one');
  assert.ok(canonical.metadata.warnings.includes(PARSER_WARNINGS.HIDDEN_SHEETS_PRESENT));
  assert.equal(canonical.headers[0]!.original, 'HeaderA');
});

await test('buildCorruptOle2() surfaces as MigrationError FILE_CORRUPTED, not an unhandled throw', async () => {
  const buf = buildCorruptOle2();
  // The raw reader throws a typed Biff8Error, never an unhandled exception.
  assert.throws(() => readBiff8(buf), Biff8Error);
  // canonicalParser translates it into the migration taxonomy.
  await assertMigrationError(() => parseSourceWorkbook(buf, 'xls'), 'FILE_CORRUPTED');
});

await test('buildNonOle2() surfaces as MigrationError FILE_UNSUPPORTED', async () => {
  const buf = buildNonOle2();
  assert.throws(() => readBiff8(buf), Biff8Error);
  await assertMigrationError(() => parseSourceWorkbook(buf, 'xls'), 'FILE_UNSUPPORTED');
});

// ══════════════════════════════════════════════════════════════════════════
// C. canonicalParser semantics
// ══════════════════════════════════════════════════════════════════════════

section('C. canonicalParser semantics');

await test('a structurally-empty leading column (no header, no data anywhere) is dropped and EMPTY_LEADING_COLUMN_DROPPED is recorded', async () => {
  const NAMED_COLUMNS = 91;
  const headerRow: FixtureCell[] = [{ v: null }, ...Array.from({ length: NAMED_COLUMNS }, (_, i) => ({ v: `COL_${i + 1}` }))];
  const dataRow1: FixtureCell[] = [{ v: null }, ...Array.from({ length: NAMED_COLUMNS }, (_, i) => ({ v: `r1_c${i + 1}` }))];
  const dataRow2: FixtureCell[] = [{ v: null }, ...Array.from({ length: NAMED_COLUMNS }, (_, i) => ({ v: `r2_c${i + 1}` }))];

  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow, dataRow1, dataRow2] }]);
  const wb = await parseSourceWorkbook(buf, 'xls');

  assert.equal(wb.headers.length, NAMED_COLUMNS, 'the phantom column-0 must not appear as a header');
  assert.ok(wb.metadata.warnings.includes(PARSER_WARNINGS.EMPTY_LEADING_COLUMN_DROPPED));
  assert.ok(!wb.metadata.warnings.includes(PARSER_WARNINGS.EMPTY_COLUMN_DROPPED), 'only the leading-column warning applies here');

  const firstHeader = wb.headers[0]!;
  assert.equal(firstHeader.original, 'COL_1');
  assert.equal(firstHeader.index, 1, 'header.index must be the PHYSICAL column index (1), not the logical position (0)');

  // row.cells[header.index] must read the right physical cell despite the drop.
  assert.equal(wb.rows[0]!.cells[firstHeader.index]!.text, 'r1_c1');
  assert.equal(wb.rows[1]!.cells[firstHeader.index]!.text, 'r2_c1');
});

await test('a column with an empty header but SOME data is NOT dropped: it becomes COLUMN_<index> with UNNAMED_COLUMN_PRESENT', async () => {
  const headerRow: FixtureCell[] = [{ v: 'ID' }, { v: null }, { v: 'NAME' }];
  const dataRow1: FixtureCell[] = [{ v: 'X1' }, { v: 'Y1' }, { v: 'Alice' }];
  const dataRow2: FixtureCell[] = [{ v: 'X2' }, { v: 'Y2' }, { v: 'Bob' }];

  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow, dataRow1, dataRow2] }]);
  const wb = await parseSourceWorkbook(buf, 'xls');

  assert.equal(wb.headers.length, 3, 'no data may silently vanish');
  const unnamed = wb.headers[1]!;
  assert.equal(unnamed.original, `${UNNAMED_COLUMN_PREFIX}1`);
  assert.equal(unnamed.index, 1);
  assert.ok(wb.metadata.warnings.includes(PARSER_WARNINGS.UNNAMED_COLUMN_PRESENT));
  assert.ok(!wb.metadata.warnings.includes(PARSER_WARNINGS.EMPTY_LEADING_COLUMN_DROPPED));
  assert.equal(wb.rows[0]!.cells[unnamed.index]!.text, 'Y1');
});

await test('F3-DATA-MIG-TODAY-001-UI-005-R5 #12: a headerless column of stale Excel ERROR cells end-to-end (parse -> profile -> suggest) is auto-ignored, not MANUAL_REQUIRED', async () => {
  // Reproduces the exact shape hypothesized for the reported "Sütun 43"
  // production defect: a stale-formula export column with a blank header and
  // every DATA row an Excel error cell (#N/A/#REF!, never real content). At
  // the raw sheet level the column is NOT empty (an error cell is not the
  // 'empty' kind), so it survives the parser's fully-empty-column drop and is
  // kept as COLUMN_<index> — but biff8Reader.ts/canonicalParser.ts project
  // every error cell to text: '', so profileColumns() (the SAME measurement
  // the mapping screen's fill-rate bar shows the operator) correctly reports
  // filledCount 0. That combination must resolve to a safe, non-blocking
  // IGNORE, never a dead-end MANUAL_REQUIRED with no explanation.
  const NA = 0x2a; // #N/A
  const headerRow: FixtureCell[] = [{ v: 'ID' }, { v: null }, { v: 'NAME' }];
  const dataRow1: FixtureCell[] = [{ v: 'X1' }, { v: null, errorCode: NA }, { v: 'Alice' }];
  const dataRow2: FixtureCell[] = [{ v: 'X2' }, { v: null, errorCode: NA }, { v: 'Bob' }];

  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow, dataRow1, dataRow2] }]);
  const wb = await parseSourceWorkbook(buf, 'xls');

  const unnamed = wb.headers.find((h) => h.original === `${UNNAMED_COLUMN_PREFIX}1`)!;
  assert.ok(unnamed, 'the column must survive parsing (it is not fully empty at the raw-cell level)');
  assert.equal(unnamed.headerWasBlank, true, 'canonicalParser must flag this header as synthesized');

  const profiles = profileColumns(wb);
  const profile = profiles.find((p) => p.index === unnamed.index)!;
  assert.equal(profile.filledCount, 0, 'whitespace-only cells must not count as filled');

  const [suggestion] = suggestMappings([unnamed], [profile], { sourceSystem: 'legacy-dental-tr-v1' });
  assert.equal(suggestion.mappingState, 'IGNORE');
  assert.equal(suggestion.reason, 'EMPTY_SOURCE_COLUMN');
  assert.equal(suggestion.sourceIndex, unnamed.index, 'physical column position preserved for auditability');
});

await test('F3-DATA-MIG-TODAY-001-UI-006-R6: a headerless column with ONE meaningful value late in the workbook end-to-end (parse -> profile -> preview -> suggest) stays MANUAL_REQUIRED and its real value is previewable', async () => {
  // The production defect this regression test exists for: a headerless
  // column ("Sütun 43" in the operator-facing UI) with fill ≈ 0% and
  // distinct = 1 — the system KNEW one meaningful value existed, but the old
  // fixed-window preview (first 3 physical rows) never showed it, so an
  // operator staring at MANUAL_REQUIRED had nothing to decide from. Here the
  // meaningful value sits at row 31 — well past the old 3-row preview window
  // — and MUST still surface. 30 rows (not 14,890) is enough to prove the
  // invariant without slowing the suite down; row COUNT is not what this test
  // is about, row ORDER relative to the (removed) fixed window is.
  const TOTAL_ROWS = 30;
  const LATE_VALUE = 'geç gelen tek gerçek değer';

  const headerRow: FixtureCell[] = [{ v: 'ID' }, { v: null }, { v: 'NAME' }];
  const dataRows: FixtureCell[][] = [];
  for (let i = 1; i <= TOTAL_ROWS; i += 1) {
    const isLastRow = i === TOTAL_ROWS;
    dataRows.push([{ v: `X${i}` }, { v: isLastRow ? LATE_VALUE : null }, { v: `Person${i}` }]);
  }

  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow, ...dataRows] }]);
  const wb = await parseSourceWorkbook(buf, 'xls');

  // 1. PARSE: the column survives as headerless, not dropped.
  const unnamed = wb.headers.find((h) => h.original === `${UNNAMED_COLUMN_PREFIX}1`)!;
  assert.ok(unnamed, 'the column must survive parsing');
  assert.equal(unnamed.headerWasBlank, true);

  // 2. PROFILE: exactly one filled row — the R5/R6 dividing line between
  //    IGNORE (filledCount === 0) and MANUAL_REQUIRED (filledCount > 0).
  const profiles = profileColumns(wb);
  const profile = profiles.find((p) => p.index === unnamed.index)!;
  assert.equal(profile.filledCount, 1, 'exactly the one late value counts as filled');
  assert.ok(profile.filledCount > 0, 'R5/R6 invariant precondition: this column is NOT the empty-column case');

  // 3. PREVIEW: the late value must be found and surfaced with its real row
  //    number — this is the R6 fix under test.
  const destByIndex = new Map<number, undefined>();
  const maxLenByIndex = new Map(profiles.map((p) => [p.index, p.maxLength]));
  const previews = buildColumnPreviews(wb.headers, wb.rows, destByIndex, maxLenByIndex);
  const preview = previews.find((p) => p.index === unnamed.index)!;
  assert.equal(preview.samples.length, 1, 'the one meaningful value must be found, not silently dropped');
  assert.equal(preview.samples[0]!.value, LATE_VALUE, 'the actual late value must be shown, not "boş"');
  assert.equal(preview.samples[0]!.rowNumber, TOTAL_ROWS, 'the sample must point at the row it actually came from');

  // 4. SUGGEST: R5 invariant unchanged — headerless + data stays
  //    MANUAL_REQUIRED, never auto-ignored and never auto-mapped.
  const [suggestion] = suggestMappings([unnamed], [profile], { sourceSystem: 'legacy-dental-tr-v1' });
  assert.equal(suggestion.mappingState, 'MANUAL_REQUIRED');
  assert.equal(suggestion.destinationField, null, 'no invented mapping');
});

await test('byte-identical duplicate headers throw MigrationError HEADER_DUPLICATE', async () => {
  const headerRow: FixtureCell[] = [{ v: 'SAME' }, { v: 'SAME' }];
  const dataRow: FixtureCell[] = [{ v: 'a' }, { v: 'b' }];
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow, dataRow] }]);
  await assertMigrationError(() => parseSourceWorkbook(buf, 'xls'), 'HEADER_DUPLICATE');
});

await test('zero data rows throws SHEET_EMPTY', async () => {
  const headerRow: FixtureCell[] = [{ v: 'ID' }, { v: 'NAME' }];
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow] }]);
  await assertMigrationError(() => parseSourceWorkbook(buf, 'xls'), 'SHEET_EMPTY');
});

await test('zero usable headers (blank header, no data anywhere) throws HEADER_MISSING', async () => {
  const headerRow: FixtureCell[] = [{ v: null }];
  const dataRow: FixtureCell[] = [{ v: null }];
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow, dataRow] }]);
  await assertMigrationError(() => parseSourceWorkbook(buf, 'xls'), 'HEADER_MISSING');
});

await test('CanonicalCell.text: number projects to plain decimal with no exponent and no thousands separator', async () => {
  const headerRow: FixtureCell[] = [{ v: 'N' }];
  const dataRow: FixtureCell[] = [{ v: 1234567 }];
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow, dataRow] }]);
  const wb = await parseSourceWorkbook(buf, 'xls');
  const cell = wb.rows[0]!.cells[0]!;
  assert.equal(cell.type, 'number');
  assert.equal(cell.text, '1234567');
  assert.ok(!cell.text.includes(','), 'no thousands separator');
  assert.ok(!/[eE]/.test(cell.text), 'no exponent notation');
});

await test('CanonicalCell.text: a very small NUMBER cell expands to plain decimal instead of exponential notation', async () => {
  const headerRow: FixtureCell[] = [{ v: 'N' }];
  const dataRow: FixtureCell[] = [{ v: 0.000000001234 }];
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow, dataRow] }]);
  const wb = await parseSourceWorkbook(buf, 'xls');
  const cell = wb.rows[0]!.cells[0]!;
  assert.equal(cell.type, 'number');
  assert.equal(cell.text, '0.000000001234');
});

await test('CanonicalCell.text: date projects to YYYY-MM-DD', async () => {
  const headerRow: FixtureCell[] = [{ v: 'D' }];
  const dataRow: FixtureCell[] = [{ v: 61, date: true }];
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow, dataRow] }]);
  const wb = await parseSourceWorkbook(buf, 'xls');
  const cell = wb.rows[0]!.cells[0]!;
  assert.equal(cell.type, 'date');
  assert.equal(cell.text, '1900-03-01');
});

await test('CanonicalCell.text: boolean projects to "true"/"false"', async () => {
  const headerRow: FixtureCell[] = [{ v: 'A' }, { v: 'B' }];
  const dataRow: FixtureCell[] = [{ v: true }, { v: false }];
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow, dataRow] }]);
  const wb = await parseSourceWorkbook(buf, 'xls');
  assert.equal(wb.rows[0]!.cells[0]!.text, 'true');
  assert.equal(wb.rows[0]!.cells[1]!.text, 'false');
});

await test('CanonicalCell.text: an empty cell projects to \'\'', async () => {
  const headerRow: FixtureCell[] = [{ v: 'A' }, { v: 'B' }];
  const dataRow: FixtureCell[] = [{ v: 'present' }, { v: null }];
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow, dataRow] }]);
  const wb = await parseSourceWorkbook(buf, 'xls');
  assert.equal(wb.rows[0]!.cells[1]!.type, 'empty');
  assert.equal(wb.rows[0]!.cells[1]!.text, '');
});

await test('profileColumns returns aggregates ONLY — no property carries a sample value', async () => {
  const headerRow: FixtureCell[] = [{ v: 'ID' }, { v: null }, { v: 'NAME' }];
  const dataRow1: FixtureCell[] = [{ v: 1 }, { v: 'Y1' }, { v: 'Alice' }];
  const dataRow2: FixtureCell[] = [{ v: 2 }, { v: 'Y2' }, { v: 'Bob' }];
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow, dataRow1, dataRow2] }]);
  const wb = await parseSourceWorkbook(buf, 'xls');

  const profiles = profileColumns(wb);
  assert.equal(profiles.length, 3);

  const expectedKeys: (keyof SourceColumnProfile)[] = [
    'index',
    'header',
    'filledCount',
    'totalRows',
    'fillRate',
    'distinctCount',
    'typeCounts',
    'maxLength',
  ];

  for (const profile of profiles) {
    assert.deepEqual(Object.keys(profile).sort(), [...expectedKeys].sort());
  }

  const idProfile = profiles.find((p) => p.header === 'ID')!;
  assert.equal(idProfile.filledCount, 2);
  assert.equal(idProfile.totalRows, 2);
  assert.equal(idProfile.fillRate, 1);
  assert.equal(idProfile.distinctCount, 2);
  assert.equal(idProfile.typeCounts.number, 2);
  assert.equal(idProfile.maxLength, 1);
});

// ─── F3-DATA-MIG-TODAY-001-UI-002 Objective D: header fidelity ─────────────
//
// Production observed generic "Sütun 1…Sütun 6" labels on the mapping
// screen for a synthetic smoke-test file. These tests establish, with real
// parsed output (not inference), that the parser and its header contract
// preserve a real header byte-exact for both file formats — so that
// observation traces to the SYNTHETIC FIXTURE's own header text, not to a
// header-loss defect here. See columnPreview.ts / MigrationMappingStep.tsx
// for the separate, genuine gap this task closes: no sample values were
// ever shown alongside the header.

await test('valid .xlsx with explicit headers: original header text round-trips byte-exact', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['HASTA_ID', 'AD', 'SOYAD']);
  ws.addRow([100284, 'Ahmet', 'Yılmaz']);
  const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);

  const parsed = await parseSourceWorkbook(buf, 'xlsx');
  assert.deepEqual(
    parsed.headers.map((h) => h.original),
    ['HASTA_ID', 'AD', 'SOYAD'],
  );
  assert.equal(parsed.rows[0]!.cells[1]!.text, 'Ahmet');
});

await test('valid .xls (BIFF8) with explicit headers: original header text round-trips byte-exact', async () => {
  const headerRow: FixtureCell[] = [{ v: 'HASTA_ID' }, { v: 'DOSYANO' }];
  const dataRow: FixtureCell[] = [{ v: 100284 }, { v: '4821' }];
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow, dataRow] }]);

  const wb = await parseSourceWorkbook(buf, 'xls');
  assert.deepEqual(wb.headers.map((h) => h.original), ['HASTA_ID', 'DOSYANO']);
  assert.equal(wb.rows[0]!.cells[1]!.text, '4821');
});

await test('Turkish / non-ASCII headers round-trip byte-exact in `original`, and normalize predictably', async () => {
  const headerRow: FixtureCell[] = [{ v: 'ÖNEMLİ NOT' }, { v: 'T.C. Kimlik No' }, { v: 'İlçe' }];
  const dataRow: FixtureCell[] = [{ v: 'x' }, { v: '12345678901' }, { v: 'Kadıköy' }];
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow, dataRow] }]);

  const wb = await parseSourceWorkbook(buf, 'xls');
  assert.deepEqual(
    wb.headers.map((h) => h.original),
    ['ÖNEMLİ NOT', 'T.C. Kimlik No', 'İlçe'],
    'the byte-exact original must never be transliterated or upper-cased',
  );
  assert.equal(wb.headers[1]!.normalized, 'T_C_KIMLIK_NO');
});

await test('near-duplicate headers (differ only by case) are both kept byte-exact; only `normalized` is disambiguated', async () => {
  // Header text is trimmed at parse time (projectText), so the differentiator
  // here is CASE, not surrounding whitespace — a whitespace-only difference
  // would already collapse to the same `original` before this rule ever runs.
  const headerRow: FixtureCell[] = [{ v: 'Ad' }, { v: 'AD' }];
  const dataRow: FixtureCell[] = [{ v: 'Ahmet' }, { v: 'Elif' }];
  const buf = buildBiff8Fixture([{ name: 'Sheet1', rows: [headerRow, dataRow] }]);

  const wb = await parseSourceWorkbook(buf, 'xls');
  assert.deepEqual(wb.headers.map((h) => h.original), ['Ad', 'AD'], 'original text for both columns is untouched');
  assert.equal(wb.headers[0]!.normalized, 'AD');
  assert.notEqual(wb.headers[1]!.normalized, wb.headers[0]!.normalized, 'the second occurrence must be disambiguated');
  assert.ok(wb.metadata.warnings.includes(PARSER_WARNINGS.DUPLICATE_HEADER));
});

// ══════════════════════════════════════════════════════════════════════════
// D. sourceFileStore
// ══════════════════════════════════════════════════════════════════════════

section('D. sourceFileStore');

const originalCwd = process.cwd();
const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-store-test-'));

try {
  process.chdir(tempCwd);

  await test('store -> read -> delete round-trip with a temp cwd', async () => {
    const runId = crypto.randomUUID();
    const content = Buffer.from('synthetic workbook bytes', 'utf8');

    const stored = await storeSourceFile(runId, content);
    assert.ok(stored.storedPath.startsWith(getMigrationSourceRoot()));
    assert.equal(stored.sizeBytes, content.length);

    const readBack = await readSourceFile(stored.storedPath);
    assert.ok(readBack.equals(content));

    const deleted = await deleteSourceFile(stored.storedPath);
    assert.equal(deleted, true);

    await assertMigrationError(() => readSourceFile(stored.storedPath), 'FILE_MISSING');
  });

  await test('a non-UUID runId is rejected', async () => {
    await assertMigrationError(
      () => storeSourceFile('not-a-uuid', Buffer.from('x')),
      'INTERNAL_ERROR',
    );
  });

  await test('a storedPath pointing outside the root is rejected by readSourceFile', async () => {
    const outside = path.join(os.tmpdir(), 'outside-migration-root', 'source.bin');
    await assertMigrationError(() => readSourceFile(outside), 'INTERNAL_ERROR');
  });

  await test('a storedPath pointing outside the root is rejected by deleteSourceFile', async () => {
    const outside = path.join(os.tmpdir(), 'outside-migration-root', 'source.bin');
    await assertMigrationError(() => deleteSourceFile(outside), 'INTERNAL_ERROR');
  });
} finally {
  process.chdir(originalCwd);
  fs.rmSync(tempCwd, { recursive: true, force: true });
}

// ─── Sonuç ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Toplam: ${passed + failed}  ✓ ${passed}  ✗ ${failed}`);
if (failed > 0) {
  console.error(`\n${failed} test başarısız oldu.`);
  process.exit(1);
} else {
  console.log('\nTüm testler geçti.');
}
