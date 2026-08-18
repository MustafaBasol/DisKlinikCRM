/**
 * migrationReports.ts — F3-DATA-MIG-TODAY-001, the two downloadable XLSX
 * reports a Platform Admin gets after a clinic data migration run:
 *
 *   migration-<runId>-success.xlsx   what landed, and where it landed
 *   migration-<runId>-failure.xlsx   what did not, why, and who has to fix it
 *
 * These are the artefacts the operator actually reconciles against the legacy
 * system, so they have to be complete on the operational axis and empty on the
 * clinical one.
 *
 * ─── PRIVACY CONTRACT (this is the point of the module) ────────────────────
 *
 * NEITHER report may contain a national identity number (raw OR masked), a
 * patient name, a phone number, an e-mail address, an address, a clinical note,
 * or any other free-text source value.
 *
 * That is enforced STRUCTURALLY, not by review:
 *
 *  1. Both reports are built exclusively from `MigrationRowOutcome` columns.
 *     That table is designed to carry no PII/PHI (see its schema comment:
 *     "NO RAW PII/PHI IN THIS TABLE"), which means the report cannot leak what
 *     the source of the report never held.
 *  2. This module NEVER joins to `Patient`, `PatientIdentityDocument` or any
 *     other clinical model, and NEVER re-reads the source workbook. There is no
 *     code path here that could reach a cell value.
 *  3. Every Prisma read below passes an explicit `select`. A column added to
 *     `MigrationRowOutcome` or `MigrationRun` later does NOT silently appear in
 *     a report — it has to be named here first. (This is the same failure mode
 *     the identity schema comment calls out for the patients route: a
 *     whole-record spread auto-leaks new columns. An explicit select does not.)
 *  4. `destinationPatientId` is an opaque internal UUID. It is a pointer, not
 *     an attribute: it identifies a row in our database and reveals nothing
 *     about the human unless the reader already has authorized access to that
 *     row — in which case they did not need the report to learn it.
 *
 * WHY `sourceId` (the vendor HASTA_ID) IS INCLUDED, deliberately
 * --------------------------------------------------------------
 * It is the ONLY operational reconciliation key the clinic has. A failure
 * report that says "row 8,412 failed" is close to useless: the operator cannot
 * open "row 8,412" in their legacy application, they open a patient by the
 * vendor record id. Without it the clinic's only route to identifying the
 * affected records would be to re-derive them from the workbook by row
 * position — a manual, error-prone process that touches far MORE personal data
 * than printing the id does.
 *
 * The id itself is provenance, not clinical data: it is the vendor's own
 * primary key, it carries no name, contact detail or health information, and
 * per the `MigrationRecord` schema contract it is "SOURCE PROVENANCE, never a
 * patient business identifier, and never surfaced as the patient's medical
 * identity". It is also already known to whoever receives this report — they
 * exported the workbook it came from. Including it therefore adds reconciliation
 * capability without adding disclosure. This is an accepted, documented
 * decision, not an oversight.
 *
 * ─── FORMULA-INJECTION CONTRACT ───────────────────────────────────────────
 *
 * Every string cell in both workbooks is neutralised by `formulaGuard.ts`
 * before it reaches ExcelJS. That is routed through exactly ONE function,
 * `writeRow()` below — the workbooks are never handed a row array that this
 * module assembled and passed to ExcelJS directly. Adding a column means adding
 * an element to an array that flows through `writeRow()`, so a new column is
 * escaped by construction; there is no way to add one that bypasses the guard
 * short of deleting `writeRow()` itself.
 *
 * ─── MEMORY / PERFORMANCE CONTRACT ────────────────────────────────────────
 *
 * The first-customer workbook is ~14,890 rows and future ones will be larger.
 * Row outcomes are read in keyset-paged chunks ordered by `sourceRowNumber` and
 * streamed straight into an ExcelJS `WorkbookWriter`, whose rows are committed
 * (and released) as they are written. At no point does the process hold the
 * full result set AND the full workbook: peak retention is one chunk plus the
 * compressed output. `useSharedStrings` is off for the same reason — the shared
 * string table would retain every distinct string for the life of the write.
 */

import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import prisma from '../../../db.js';
import { MigrationError, getDestinationField } from '../contracts.js';
import { escapeRow } from './formulaGuard.js';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * Row outcomes fetched per database round trip. Small enough that one chunk is
 * a trivial allocation at any plausible run size, large enough that a 14,890
 * row report is 8 queries rather than 8,000.
 */
const ROW_PAGE_SIZE = 2000;

/** Statuses that mean the row produced a destination record. */
const SUCCESS_STATUSES = ['CREATED', 'MATCHED'] as const;

/**
 * The runId is a UUID WE generated (`MigrationRun.id`, `@default(uuid())`), so
 * it can never carry the operator's filename, a path separator, a quote or a
 * CR/LF. Asserting the shape before it is interpolated into a filename is what
 * makes the eventual `Content-Disposition` header uninjectable by construction
 * rather than by the caller remembering to sanitize.
 */
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/** Tenant addressing for a report build. Ids only — never a name, never a file. */
export interface ReportBuildContext {
  runId: string;
  organizationId: string;
  clinicId: string;
}

export interface MigrationReportResult {
  buffer: Buffer;
  filename: string;
  /** Data rows written to the primary sheet (header row excluded). */
  rowCount: number;
}

// ---------------------------------------------------------------------------
// Prisma access seam
// ---------------------------------------------------------------------------

/**
 * The exact shape of the run metadata a report is allowed to see. Every field
 * here is an id, a code, a count, a hash or a timestamp. Note what is absent:
 * `sourceFileNameSafe` (the operator's filename), `sourceFileStoredPath`, and
 * every clinical relation.
 */
interface ReportRunRecord {
  id: string;
  organizationId: string;
  clinicId: string;
  sourceSystem: string;
  profileVersion: string;
  entityType: string;
  status: string;
  sourceFileFormat: string | null;
  sourceFileSizeBytes: number | null;
  sourceFileSha256: string | null;
  sheetName: string | null;
  sheetIndex: number | null;
  totalSourceRows: number | null;
  headerColumnCount: number | null;
  batchSize: number;
  totalBatches: number;
  processedRows: number;
  createdRows: number;
  matchedRows: number;
  skippedRows: number;
  failedRows: number;
  warningRows: number;
  blockedRows: number;
  reconciliation: unknown;
  startedAt: Date | null;
  completedAt: Date | null;
}

/** The exact shape of a row outcome a report is allowed to see. */
interface ReportRowOutcomeRecord {
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

/**
 * The minimum surface of the Prisma client this module needs. Declaring it
 * structurally keeps the module testable without a database AND documents, in
 * the type system, that reports touch exactly two models.
 */
export interface MigrationReportPrismaClient {
  migrationRun: {
    findUnique(args: { where: { id: string }; select: Record<string, boolean> }): Promise<unknown>;
  };
  migrationRowOutcome: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
      orderBy: { sourceRowNumber: 'asc' };
      take: number;
    }): Promise<unknown[]>;
  };
}

let reportPrisma: MigrationReportPrismaClient = prisma as unknown as MigrationReportPrismaClient;

/**
 * Test seam. Production never calls this; the default is the real client.
 * Passing `null` restores the real client.
 */
export function __setMigrationReportPrismaClientForTests(
  client: MigrationReportPrismaClient | null,
): void {
  reportPrisma = client ?? (prisma as unknown as MigrationReportPrismaClient);
}

// ---------------------------------------------------------------------------
// THE single write funnel
// ---------------------------------------------------------------------------

/**
 * THE ONLY WAY A CELL IS EVER WRITTEN IN THIS MODULE.
 *
 * Nothing below calls `sheet.addRow()` directly — headers, data rows and the
 * Summary key/value rows all come through here, so every string that reaches
 * ExcelJS has passed `escapeRow()` (and therefore `escapeSpreadsheetValue()`).
 * That is what makes it structurally impossible to add a column that skips the
 * formula-injection guard: a new column is a new element in an array that is
 * already flowing through this function.
 *
 * `.commit()` releases the row immediately so the writer never accumulates the
 * whole sheet in memory.
 */
function writeRow(sheet: ExcelJS.Worksheet, values: unknown[]): void {
  sheet.addRow(escapeRow(values) as ExcelJS.CellValue[]).commit();
}

// ---------------------------------------------------------------------------
// Column definitions (single source of truth for both header and data order)
// ---------------------------------------------------------------------------

export const SUCCESS_COLUMNS: readonly string[] = [
  'migrationRunId',
  'sourceRowNumber',
  'sourceId',
  'destinationPatientId',
  'resultCode',
  'outcome',
  'identityClassification',
  'identityWritten',
  'warnings',
];

export const FAILURE_COLUMNS: readonly string[] = [
  'sourceRowNumber',
  'sourceId',
  'status',
  'errorCode',
  'errorMessage',
  'fieldName',
  'retryable',
  'blockerClassification',
  'mappingContext',
  'warnings',
];

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

/** `warnings` is a Json column of CODES. Rendered as a stable, sorted-free join. */
function formatWarnings(warnings: unknown): string {
  if (!Array.isArray(warnings)) return '';
  return warnings
    .filter((w): w is string => typeof w === 'string' && w.length > 0)
    .join('; ');
}

/**
 * Operator-facing outcome wording. `MATCHED` is reported as `reused` because
 * that is what actually happened: provenance resolved the source record to an
 * existing patient and no second patient was created.
 */
function outcomeLabel(status: string): string {
  return status === 'CREATED' ? 'created' : 'reused';
}

export type BlockerClassification =
  | 'LEGAL'
  | 'MAPPING'
  | 'IDENTITY'
  | 'DATA'
  | 'PLAN'
  | 'SYSTEM'
  | 'UNCLASSIFIED';

/**
 * Who has to act on this failure. The operator's first question about a failure
 * report is never "what is the code", it is "is this mine to fix, or does it go
 * to legal / engineering / the vendor". This column answers that directly.
 *
 * Note `IDENTITY_CRYPTO_NOT_CONFIGURED`: it matches the `IDENTITY_*` rule and
 * is therefore classified IDENTITY, even though its root cause is server
 * configuration. That is intentional and left as-is — the classification
 * describes the SUBJECT of the failure (the identity write), and the precise
 * cause remains available in `errorCode` for whoever triages it.
 */
export function classifyBlocker(resultCode: string | null): BlockerClassification {
  if (!resultCode) return 'UNCLASSIFIED';
  if (resultCode === 'LEGAL_BLOCKED') return 'LEGAL';
  if (resultCode.startsWith('MAPPING_') || resultCode === 'REFERENCE_UNRESOLVED') return 'MAPPING';
  if (resultCode.startsWith('IDENTITY_')) return 'IDENTITY';
  if (resultCode.startsWith('ROW_') || resultCode.startsWith('DUPLICATE_')) return 'DATA';
  if (resultCode === 'PLAN_LIMIT_EXCEEDED') return 'PLAN';
  if (
    resultCode === 'DATABASE_ERROR' ||
    resultCode === 'BATCH_FAILED' ||
    resultCode === 'INTERNAL_ERROR'
  ) {
    return 'SYSTEM';
  }
  return 'UNCLASSIFIED';
}

/**
 * The canonical DESTINATION field the failure concerns, resolved against the
 * destination catalog in contracts.ts.
 *
 * Distinct from the raw `fieldName` column on purpose: `fieldName` is whatever
 * the executor recorded, while `mappingContext` is empty unless that value is a
 * real, currently-defined destination key. So a non-empty `mappingContext` is a
 * promise the operator can act on — it names a row in the mapping UI they can
 * open and change. It also cannot carry a source header (which could be
 * vendor free text): only a key present in the catalog is ever emitted.
 */
function mappingContextFor(fieldName: string | null): string {
  if (!fieldName) return '';
  return getDestinationField(fieldName) ? fieldName : '';
}

/** Timestamps render as ISO-8601 UTC — locale-independent and diff-stable. */
function isoOrEmpty(value: Date | null): string {
  return value ? value.toISOString() : '';
}

/** Reads the reconciliation `balanced` flag out of the run's Json column. */
function reconciliationBalanced(reconciliation: unknown): string {
  if (reconciliation && typeof reconciliation === 'object' && 'balanced' in reconciliation) {
    const balanced = (reconciliation as { balanced?: unknown }).balanced;
    if (typeof balanced === 'boolean') return String(balanced);
  }
  return '';
}

// ---------------------------------------------------------------------------
// Data access — every query scoped by runId
// ---------------------------------------------------------------------------

const RUN_SELECT: Record<string, boolean> = {
  id: true,
  organizationId: true,
  clinicId: true,
  sourceSystem: true,
  profileVersion: true,
  entityType: true,
  status: true,
  sourceFileFormat: true,
  sourceFileSizeBytes: true,
  sourceFileSha256: true,
  sheetName: true,
  sheetIndex: true,
  totalSourceRows: true,
  headerColumnCount: true,
  batchSize: true,
  totalBatches: true,
  processedRows: true,
  createdRows: true,
  matchedRows: true,
  skippedRows: true,
  failedRows: true,
  warningRows: true,
  blockedRows: true,
  reconciliation: true,
  startedAt: true,
  completedAt: true,
};

const ROW_OUTCOME_SELECT: Record<string, boolean> = {
  sourceRowNumber: true,
  sourceId: true,
  status: true,
  resultCode: true,
  errorMessage: true,
  fieldName: true,
  retryable: true,
  destinationPatientId: true,
  identityClassification: true,
  identityWritten: true,
  warnings: true,
};

async function loadRun(runId: string): Promise<ReportRunRecord> {
  if (!UUID_PATTERN.test(runId)) {
    // A non-UUID can never be a MigrationRun.id, so this is a not-found, not a
    // validation error — and it stops a malformed value before it is ever used
    // to build a filename.
    throw new MigrationError('RUN_NOT_FOUND', {
      message: 'Migration run not found.',
      detail: 'The requested migration run identifier is not a valid run id.',
    });
  }

  const run = (await reportPrisma.migrationRun.findUnique({
    where: { id: runId },
    select: RUN_SELECT,
  })) as ReportRunRecord | null;

  if (!run) {
    throw new MigrationError('RUN_NOT_FOUND', {
      message: 'Migration run not found.',
      detail: 'No migration run exists for the requested run id.',
    });
  }

  return run;
}

/**
 * Keyset pagination over `MigrationRowOutcome`, ordered by `sourceRowNumber`.
 *
 * Keyset rather than offset because `(runId, sourceRowNumber)` is UNIQUE, which
 * makes the cursor total and stable: no row can be skipped or repeated even if
 * the run is still writing outcomes while the report is generated, and the cost
 * of page N does not grow with N.
 *
 * Yields one page at a time so the caller can write it out and drop it.
 */
async function* pageRowOutcomes(
  runId: string,
  statusFilter: Record<string, unknown>,
): AsyncGenerator<ReportRowOutcomeRecord[]> {
  let afterRowNumber = -1;

  for (;;) {
    const page = (await reportPrisma.migrationRowOutcome.findMany({
      where: {
        // EVERY query is scoped by runId. A report can never observe another
        // run's rows, and therefore never another tenant's.
        runId,
        ...statusFilter,
        sourceRowNumber: { gt: afterRowNumber },
      },
      select: ROW_OUTCOME_SELECT,
      orderBy: { sourceRowNumber: 'asc' },
      take: ROW_PAGE_SIZE,
    })) as ReportRowOutcomeRecord[];

    if (page.length === 0) return;

    yield page;

    afterRowNumber = page[page.length - 1].sourceRowNumber;
    if (page.length < ROW_PAGE_SIZE) return;
  }
}

// ---------------------------------------------------------------------------
// Workbook assembly
// ---------------------------------------------------------------------------

/**
 * The Summary sheet: what the run WAS, in aggregate.
 *
 * Everything here is run metadata, a count or a digest. Deliberately absent:
 * `sourceFileNameSafe` — the operator typed that, so it is uncontrolled text
 * that may name a person ("Ahmet Yilmaz hastalar.xls") and it has no
 * reconciliation value; the SHA-256 identifies the file precisely and cannot.
 */
function writeSummarySheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  run: ReportRunRecord,
): void {
  const sheet = workbook.addWorksheet('Summary');

  writeRow(sheet, ['field', 'value']);

  const entries: Array<[string, unknown]> = [
    ['migrationRunId', run.id],
    ['organizationId', run.organizationId],
    ['clinicId', run.clinicId],
    ['status', run.status],
    ['entityType', run.entityType],
    ['sourceSystem', run.sourceSystem],
    ['profileVersion', run.profileVersion],
    ['sourceFileFormat', run.sourceFileFormat ?? ''],
    ['sourceFileSizeBytes', run.sourceFileSizeBytes ?? ''],
    ['sourceFileSha256', run.sourceFileSha256 ?? ''],
    ['sheetName', run.sheetName ?? ''],
    ['sheetIndex', run.sheetIndex ?? ''],
    ['totalSourceRows', run.totalSourceRows ?? ''],
    ['headerColumnCount', run.headerColumnCount ?? ''],
    ['batchSize', run.batchSize],
    ['totalBatches', run.totalBatches],
    ['processedRows', run.processedRows],
    ['createdRows', run.createdRows],
    ['matchedRows', run.matchedRows],
    ['skippedRows', run.skippedRows],
    ['failedRows', run.failedRows],
    ['warningRows', run.warningRows],
    ['blockedRows', run.blockedRows],
    ['startedAt', isoOrEmpty(run.startedAt)],
    ['completedAt', isoOrEmpty(run.completedAt)],
    ['reconciliationBalanced', reconciliationBalanced(run.reconciliation)],
  ];

  for (const [field, value] of entries) {
    writeRow(sheet, [field, value]);
  }

  sheet.commit();
}

/** Collects a WorkbookWriter's output into a Buffer without a temp file. */
async function buildWorkbookBuffer(
  build: (workbook: ExcelJS.stream.xlsx.WorkbookWriter) => Promise<void>,
): Promise<Buffer> {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));

  const finished = new Promise<void>((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream,
    // Styles and the shared-string table both retain per-cell state for the
    // whole write. Neither is worth the memory on a 14,890-row report.
    useStyles: false,
    useSharedStrings: false,
  });

  await build(workbook);
  await workbook.commit();
  await finished;

  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// SUCCESS report
// ---------------------------------------------------------------------------

/**
 * One row per `MigrationRowOutcome` whose status is CREATED or MATCHED, plus a
 * Summary sheet of run metadata.
 */
export async function buildSuccessReport(runId: string): Promise<MigrationReportResult> {
  const run = await loadRun(runId);
  const context: ReportBuildContext = {
    runId: run.id,
    organizationId: run.organizationId,
    clinicId: run.clinicId,
  };

  let rowCount = 0;

  const buffer = await buildWorkbookBuffer(async (workbook) => {
    const sheet = workbook.addWorksheet('Success');
    writeRow(sheet, [...SUCCESS_COLUMNS]);

    for await (const page of pageRowOutcomes(context.runId, {
      status: { in: [...SUCCESS_STATUSES] },
    })) {
      for (const row of page) {
        writeRow(sheet, [
          context.runId,
          row.sourceRowNumber,
          row.sourceId ?? '',
          row.destinationPatientId ?? '',
          row.resultCode ?? '',
          outcomeLabel(row.status),
          row.identityClassification ?? '',
          row.identityWritten,
          formatWarnings(row.warnings),
        ]);
        rowCount += 1;
      }
    }

    sheet.commit();
    writeSummarySheet(workbook, run);
  });

  return {
    buffer,
    // run.id, not the caller's string: the filename is built from a value the
    // database returned, which is a generated UUID by schema definition.
    filename: `migration-${run.id}-success.xlsx`,
    rowCount,
  };
}

// ---------------------------------------------------------------------------
// FAILURE report
// ---------------------------------------------------------------------------

/**
 * One row per `MigrationRowOutcome` whose status is anything OTHER than CREATED
 * or MATCHED — failed, blocked, invalid, skipped, ambiguous, duplicate and
 * manual-review rows all appear, because from the operator's point of view they
 * share one property: the record is not in NoraMedi yet.
 */
export async function buildFailureReport(runId: string): Promise<MigrationReportResult> {
  const run = await loadRun(runId);
  const context: ReportBuildContext = {
    runId: run.id,
    organizationId: run.organizationId,
    clinicId: run.clinicId,
  };

  let rowCount = 0;

  const buffer = await buildWorkbookBuffer(async (workbook) => {
    const sheet = workbook.addWorksheet('Failures');
    writeRow(sheet, [...FAILURE_COLUMNS]);

    for await (const page of pageRowOutcomes(context.runId, {
      status: { notIn: [...SUCCESS_STATUSES] },
    })) {
      for (const row of page) {
        writeRow(sheet, [
          row.sourceRowNumber,
          row.sourceId ?? '',
          row.status,
          row.resultCode ?? '',
          // Safe by the MigrationRowOutcome contract: a templated, PII-free
          // string. Escaped anyway — the guard is unconditional.
          row.errorMessage ?? '',
          row.fieldName ?? '',
          row.retryable,
          classifyBlocker(row.resultCode),
          mappingContextFor(row.fieldName),
          formatWarnings(row.warnings),
        ]);
        rowCount += 1;
      }
    }

    sheet.commit();
    writeSummarySheet(workbook, run);
  });

  return {
    buffer,
    filename: `migration-${run.id}-failure.xlsx`,
    rowCount,
  };
}
