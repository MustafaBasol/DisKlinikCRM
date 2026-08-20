/**
 * rejectedRowReport.ts — F3-DATA-MIG-TODAY-001-R12.
 *
 * "İçe Aktarılamayan Kayıtları İndir" — the artifact that closes the
 * correction loop:
 *
 *   Dry-run  ->  download the rows that cannot be imported  ->  fix them in
 *   Excel   ->  upload the corrected file  ->  analyze  ->  dry-run  ->  import
 *
 * Available after Dry-run AND after Execute. Before R12 an operator who hit one
 * bad birth date learned only that "1 row is invalid" and had no way to find
 * which of 14,890 rows it was, so the only route forward was to guess or to
 * abandon 14,889 good rows.
 *
 * ─── WHY THIS IS NOT migrationReports.ts ──────────────────────────────────
 *
 * That module has an absolute contract: neither of its two reports may contain
 * ANY source value, and it enforces that structurally by building only from
 * `MigrationRowOutcome` and never re-reading the workbook. That contract is
 * correct for a reconciliation report, which is read for counts, and it is
 * exactly WRONG for this one: a workbook the operator is supposed to CORRECT
 * and RE-UPLOAD is useless without the values that need correcting.
 *
 * So this is a different artifact with a different, deliberately stated
 * contract, in its own file, rather than a flag on the other one that would
 * turn a structural guarantee into a conditional.
 *
 * ─── THE CONTRACT OF THIS ARTIFACT ────────────────────────────────────────
 *
 *  1. IT CONTAINS SOURCE VALUES, ON PURPOSE. Correcting a row means seeing it.
 *  2. IT CONTAINS ONLY REJECTED ROWS. A row that will import is never in this
 *     file. The clinic's other 14,889 patients are not exported to explain one
 *     bad date.
 *  3. IT CONTAINS ONLY MAPPED COLUMNS. A column the operator ignored or that is
 *     legally gated is not written out — including it would export
 *     special-category content that this run has already decided not to carry.
 *     The legally-gated columns are excluded by the same rule that keeps them
 *     out of the import, not by a second list that could fall out of step.
 *  4. IT IS NEVER LOGGED. Values exist inside this function and inside the
 *     response body. No value reaches a log line, an audit record, an error
 *     message, or the dry-run summary. The audit event this download writes
 *     records the run, the format and the ROW COUNT.
 *  5. IT IS NEVER PUBLIC. The route is behind the Platform Admin gate and is
 *     scoped to the run, and therefore to the run's organization and clinic.
 *     There is no signed URL and no anonymous fetch path.
 *
 * ─── SHEET LAYOUT (XLSX) ──────────────────────────────────────────────────
 *
 * Sheet 1 "Düzeltilecek Kayıtlar" — the ORIGINAL vendor headers, byte-exact,
 *   and the original cell text of the rejected rows. Nothing added, nothing
 *   renamed. That is what makes it RE-UPLOADABLE VERBATIM: analyze sees the
 *   headers it saw the first time and proposes the same mapping, so the
 *   corrected file needs no re-mapping. A diagnostic column appended here would
 *   analyze as an extra unknown, populated column and would demand an operator
 *   decision on every re-import, which is precisely the busywork this task
 *   removes.
 *
 * Sheet 2 "Hata Listesi" — one line per finding: source row number, source
 *   record id, the column and field, the NoraMedi error code, the Turkish
 *   explanation, the correction guidance, and the offending value.
 *
 * CSV emits sheet 2 only. A CSV has one table, and the diagnostic list is the
 * half that answers "why"; the half that answers "fix this" needs the vendor
 * headers intact, which is an XLSX job.
 *
 * ─── FORMULA INJECTION ────────────────────────────────────────────────────
 * Every string cell in both sheets goes through `escapeRow` from formulaGuard,
 * routed through the single `writeRow` helper, exactly as migrationReports.ts
 * does. This file writes SOURCE-CONTROLLED text — the most likely place in the
 * product for a `=cmd|...` payload to be sitting — so the guard matters more
 * here than anywhere else, and there is no path to ExcelJS that bypasses it.
 */

import ExcelJS from 'exceljs';
import prisma from '../../../db.js';
import { MigrationError, type CanonicalWorkbook } from '../contracts.js';
import { parseSourceWorkbook } from '../parser/canonicalParser.js';
import { readSourceFile } from '../sourceFileStore.js';
import { buildRow, compileMapping, type ResolvedMapping } from '../rowBuilder.js';
import { classifyRowRejection, type RowRejection } from '../rowRejection.js';
import { escapeRow } from './formulaGuard.js';

/** Same shape assertion migrationReports.ts uses, for the same reason. */
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type RejectedReportFormat = 'xlsx' | 'csv';

export interface RejectedRowReportResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
  /** Source rows written to the correction sheet. */
  rejectedRowCount: number;
  /** Findings written to the error sheet. One row can produce several. */
  findingCount: number;
  /** True when the run had already executed and outcome rows were merged in. */
  includesExecutionOutcomes: boolean;
}

export const REJECTED_ERROR_COLUMNS: readonly string[] = [
  'Kaynak Satır No',
  'Kaynak Kayıt No (HASTA_ID)',
  'Kaynak Sütun',
  'NoraMedi Alanı',
  'Hata Kodu',
  'Açıklama',
  'Nasıl Düzeltilir',
  'Mevcut Değer',
  'Aktarım Referansı (Run ID)',
];

/** The two sheet names. Exported so the acceptance test asserts the real strings. */
export const REJECTED_DATA_SHEET = 'Düzeltilecek Kayıtlar';
export const REJECTED_ERROR_SHEET = 'Hata Listesi';

/**
 * States whose columns are carried into the correction sheet.
 *
 * The SAME set the executor writes from. A column the operator excluded, or
 * that a legal gate withholds, is not in the import and must not be in the
 * export — writing it here would hand back special-category content this run
 * has already decided not to carry, in a file that then gets e-mailed around.
 */
const EXPORTED_COLUMN_STATES = new Set(['AUTO_CONFIDENT', 'RESOLVED']);

function writeRow(sheet: ExcelJS.Worksheet, values: unknown[]): void {
  sheet.addRow(escapeRow(values));
}

/**
 * The vendor source column(s) feeding a NoraMedi destination field.
 *
 * Used to tell the operator WHICH Excel column to edit. A destination with no
 * mapped column (it can happen for a field the row builder names but that this
 * run does not map) yields an empty string rather than a guess.
 */
function sourceColumnsFor(
  destinationField: string | null,
  mappings: readonly ResolvedMapping[],
): string {
  if (!destinationField) return '';
  return mappings
    .filter((m) => m.destinationField === destinationField)
    .map((m) => m.sourceField)
    .join(', ');
}

/**
 * The offending value for a finding, read from the ORIGINAL cells of the
 * columns feeding the failed field.
 *
 * This is the one deliberate PII read in the module. It returns the source TEXT
 * exactly as exported — not a transformed value — because the operator is going
 * to search for that text in their own file.
 */
function originalValueFor(
  workbook: CanonicalWorkbook,
  rowIndex: number,
  destinationField: string | null,
  mappings: readonly ResolvedMapping[],
): string {
  if (!destinationField) return '';
  const row = workbook.rows[rowIndex];
  if (!row) return '';
  return mappings
    .filter((m) => m.destinationField === destinationField)
    .map((m) => row.cells[m.sourceIndex]?.text ?? '')
    .filter((text) => text !== '')
    .join(' | ');
}

interface RunRecord {
  id: string;
  organizationId: string;
  clinicId: string;
  sourceSystem: string;
  status: string;
  sourceFileStoredPath: string | null;
  sourceFileFormat: string | null;
  sheetIndex: number | null;
}

async function loadRun(runId: string): Promise<RunRecord> {
  if (!UUID_PATTERN.test(runId)) {
    throw new MigrationError('RUN_NOT_FOUND', { message: 'Migration run not found.' });
  }
  const run = await prisma.migrationRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      organizationId: true,
      clinicId: true,
      sourceSystem: true,
      status: true,
      sourceFileStoredPath: true,
      sourceFileFormat: true,
      sheetIndex: true,
    },
  });
  if (!run) throw new MigrationError('RUN_NOT_FOUND', { message: 'Migration run not found.' });
  return run;
}

/**
 * Statuses from which a rejected-row export is meaningful.
 *
 * Before DRY_RUN_COMPLETE nothing has evaluated the rows, so the file would be
 * either empty or a re-derivation the operator has not been shown yet — either
 * way it would state a conclusion the run has not reached. BLOCKED is included
 * because a blocked run is exactly the case where the operator most needs to
 * see WHICH rows blocked it.
 */
export const REJECTED_REPORT_STATUSES: readonly string[] = [
  'DRY_RUN_COMPLETE',
  'BLOCKED',
  'READY',
  'RUNNING',
  'PARTIAL_FAILURE',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

/**
 * Recompute the rejected rows for a run and render them.
 *
 * RECOMPUTED, NOT STORED, and that is a design decision rather than a shortcut
 * around a schema change. A stored rejection list would be a snapshot: the
 * operator changes a mapping, re-runs the dry run, and the download would still
 * describe the old mapping unless every write path remembered to invalidate it.
 * Deriving it from the CURRENT mapping and the retained source file means the
 * file the operator downloads always describes the run as it stands, and there
 * is no new table to keep in step. The source workbook is already retained for
 * this run (sourceFileStore, 7-day retention) — no new data is kept.
 */
export async function buildRejectedRowReport(
  runId: string,
  format: RejectedReportFormat = 'xlsx',
): Promise<RejectedRowReportResult> {
  const run = await loadRun(runId);

  if (!REJECTED_REPORT_STATUSES.includes(run.status)) {
    throw new MigrationError('MIGRATION_STATE_INVALID', {
      message: `Downloading the rejected-row list is not available while the run is in status ${run.status}. Run the dry run first.`,
    });
  }
  if (!run.sourceFileStoredPath || !run.sourceFileFormat) {
    throw new MigrationError('FILE_MISSING', {
      message:
        'The source workbook for this run is no longer stored, so the rejected rows cannot be rebuilt. Start a new run from the workbook.',
    });
  }

  const mappingRows = await prisma.migrationFieldMapping.findMany({
    where: { runId: run.id },
    orderBy: { sourceIndex: 'asc' },
    select: {
      sourceField: true,
      sourceIndex: true,
      destinationField: true,
      transform: true,
      composeOrder: true,
      state: true,
    },
  });
  const mappings: ResolvedMapping[] = mappingRows.map((m) => ({
    sourceField: m.sourceField,
    sourceIndex: m.sourceIndex,
    destinationField: m.destinationField,
    transform: m.transform,
    composeOrder: m.composeOrder,
    state: m.state,
  }));

  const buffer = await readSourceFile(run.sourceFileStoredPath);
  const workbook = await parseSourceWorkbook(
    buffer,
    run.sourceFileFormat as 'xls' | 'xlsx',
    run.sheetIndex !== null ? { sheetIndex: run.sheetIndex } : {},
  );

  // Practitioner values with no approved mapping — the same question the dry
  // run asks, answered from the same table, so the two agree by construction.
  const referenceRows = await prisma.migrationReferenceMap.findMany({
    where: {
      organizationId: run.organizationId,
      clinicId: run.clinicId,
      sourceSystem: run.sourceSystem,
      entityType: 'practitioner',
    },
    select: { sourceValue: true, status: true },
  });
  const resolvedReferenceValues = new Set(
    referenceRows
      .filter((r) => r.status === 'MAPPED_APPROVED' || r.status === 'MAPPED_IGNORED')
      .map((r) => r.sourceValue),
  );

  const compiled = compileMapping(mappings);
  const built = workbook.rows.map((row) => buildRow(row, compiled, workbook.headers));

  const sourceIdCounts = new Map<string, number>();
  for (const row of built) {
    if (!row.sourceId) continue;
    sourceIdCounts.set(row.sourceId, (sourceIdCounts.get(row.sourceId) ?? 0) + 1);
  }

  const unresolvedReferenceValues = new Set<string>();
  for (const row of built) {
    const value = row.practitionerSourceValue;
    if (value && !resolvedReferenceValues.has(value)) unresolvedReferenceValues.add(value);
  }

  const rejections: Array<{ rejection: RowRejection; rowIndex: number }> = [];
  built.forEach((row, rowIndex) => {
    const rejection = classifyRowRejection(row, { sourceIdCounts, unresolvedReferenceValues });
    if (rejection) rejections.push({ rejection, rowIndex });
  });

  /*
   * After Execute, a row can also have failed at WRITE time — a constraint, a
   * transient database error — with nothing wrong in the workbook that the
   * recomputation above could see. Those live on MigrationRowOutcome, and an
   * export that omitted them would tell an operator whose import partly failed
   * that there is nothing to fix.
   *
   * Merged by source row number, and only for rows the recomputation did not
   * already reject, so a row never appears twice.
   */
  const alreadyRejected = new Set(rejections.map((r) => r.rejection.rowNumber));
  const outcomeFailures = await prisma.migrationRowOutcome.findMany({
    where: { runId: run.id, status: { in: ['FAILED', 'SKIPPED'] } },
    orderBy: { sourceRowNumber: 'asc' },
    select: {
      sourceRowNumber: true,
      sourceId: true,
      status: true,
      resultCode: true,
      errorMessage: true,
      fieldName: true,
    },
  });
  const rowIndexByNumber = new Map(built.map((row, index) => [row.rowNumber, index]));
  let includesExecutionOutcomes = false;
  for (const outcome of outcomeFailures) {
    if (alreadyRejected.has(outcome.sourceRowNumber)) continue;
    const rowIndex = rowIndexByNumber.get(outcome.sourceRowNumber);
    if (rowIndex === undefined) continue;
    includesExecutionOutcomes = true;
    rejections.push({
      rowIndex,
      rejection: {
        rowNumber: outcome.sourceRowNumber,
        sourceId: outcome.sourceId,
        kind: 'INVALID',
        findings: [
          {
            code: 'INVALID_FIELD_VALUE',
            internalCode: 'ROW_VALUE_INVALID',
            fieldName: outcome.fieldName,
            // errorMessage is written by the executor from templated text that
            // names a field, never a value — the same contract migrationReports
            // relies on when it prints this column.
            internalMessage: outcome.errorMessage ?? outcome.resultCode ?? outcome.status,
            messageTr:
              'Bu kayıt aktarım sırasında yazılamadı. Ayrıntı için "Mevcut Değer" ve hata kodu sütunlarına bakın.',
            guidanceTr:
              'İlgili sütundaki değeri düzeltip bu dosyayı yeniden yükleyin. Sorun devam ederse aktarım referansıyla (Run ID) destek ekibine iletin.',
          },
        ],
      },
    });
  }

  rejections.sort((a, b) => a.rejection.rowNumber - b.rejection.rowNumber);

  const exportedColumns = mappings.filter((m) => EXPORTED_COLUMN_STATES.has(m.state));

  const findingCount = rejections.reduce((n, r) => n + r.rejection.findings.length, 0);

  const result =
    format === 'csv'
      ? renderCsv(run.id, workbook, mappings, rejections)
      : await renderXlsx(run.id, workbook, mappings, exportedColumns, rejections);

  return {
    ...result,
    rejectedRowCount: rejections.length,
    findingCount,
    includesExecutionOutcomes,
  };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

type RejectionEntry = { rejection: RowRejection; rowIndex: number };

async function renderXlsx(
  runId: string,
  workbook: CanonicalWorkbook,
  mappings: readonly ResolvedMapping[],
  exportedColumns: readonly ResolvedMapping[],
  rejections: readonly RejectionEntry[],
): Promise<Pick<RejectedRowReportResult, 'buffer' | 'filename' | 'contentType'>> {
  const out = new ExcelJS.Workbook();
  out.creator = 'NoraMedi';

  // --- Sheet 1: the correctable rows, original headers, nothing else -------
  const dataSheet = out.addWorksheet(REJECTED_DATA_SHEET);
  writeRow(dataSheet, exportedColumns.map((m) => m.sourceField));
  dataSheet.getRow(1).font = { bold: true };
  for (const { rowIndex } of rejections) {
    const row = workbook.rows[rowIndex];
    writeRow(
      dataSheet,
      exportedColumns.map((m) => row?.cells[m.sourceIndex]?.text ?? ''),
    );
  }

  // --- Sheet 2: why each row was held -------------------------------------
  const errorSheet = out.addWorksheet(REJECTED_ERROR_SHEET);
  writeRow(errorSheet, [...REJECTED_ERROR_COLUMNS]);
  errorSheet.getRow(1).font = { bold: true };
  for (const { rejection, rowIndex } of rejections) {
    for (const finding of rejection.findings) {
      writeRow(errorSheet, [
        rejection.rowNumber,
        rejection.sourceId ?? '',
        sourceColumnsFor(finding.fieldName, mappings),
        finding.fieldName ?? '',
        finding.code,
        finding.messageTr,
        finding.guidanceTr,
        originalValueFor(workbook, rowIndex, finding.fieldName, mappings),
        runId,
      ]);
    }
  }
  errorSheet.columns.forEach((column, index) => {
    // Widths only — no formulas, no conditional formatting, nothing that reads
    // a cell. Readability, not logic.
    column.width = index === 5 || index === 6 ? 60 : index === 7 ? 32 : 20;
  });

  const arrayBuffer = await out.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(arrayBuffer as ArrayBuffer),
    filename: `migration-${runId}-rejected.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

/**
 * RFC 4180 quoting, with a UTF-8 BOM.
 *
 * The BOM is not decoration: without it Excel on a Turkish Windows install
 * opens a UTF-8 CSV in the system codepage and every ç/ğ/ı/ö/ş/ü in the
 * explanation column becomes mojibake — in the exact file whose purpose is to
 * be read by a Turkish-speaking operator.
 */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function renderCsv(
  runId: string,
  workbook: CanonicalWorkbook,
  mappings: readonly ResolvedMapping[],
  rejections: readonly RejectionEntry[],
): Pick<RejectedRowReportResult, 'buffer' | 'filename' | 'contentType'> {
  const lines: string[] = [REJECTED_ERROR_COLUMNS.map(csvCell).join(',')];
  for (const { rejection, rowIndex } of rejections) {
    for (const finding of rejection.findings) {
      lines.push(
        escapeRow([
          rejection.rowNumber,
          rejection.sourceId ?? '',
          sourceColumnsFor(finding.fieldName, mappings),
          finding.fieldName ?? '',
          finding.code,
          finding.messageTr,
          finding.guidanceTr,
          originalValueFor(workbook, rowIndex, finding.fieldName, mappings),
          runId,
        ])
          .map(csvCell)
          .join(','),
      );
    }
  }
  return {
    buffer: Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8'),
    filename: `migration-${runId}-rejected.csv`,
    contentType: 'text/csv; charset=utf-8',
  };
}
