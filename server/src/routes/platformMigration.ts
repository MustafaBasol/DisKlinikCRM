/**
 * platformMigration.ts — F3-DATA-MIG-TODAY-001
 *
 * The Platform Admin Clinic Data Migration API. PLATFORM ADMIN ONLY.
 *
 * AUTHORIZATION. Every route below sits behind
 * `router.use(authenticatePlatformAdmin, csrfProtection('platform'))`, the same
 * gate `platformAdmin.ts:154` uses. The router is mounted on `/api/platform`
 * BEFORE the global clinic `authenticate` in index.ts, so a clinic session
 * cookie can never reach it: the platform JWT is signed with a separate secret
 * (`PLATFORM_JWT_SECRET`), carries a `type` claim that must be platform, and
 * resolves against `prisma.platformAdmin`. Cross-verification between the two
 * session systems is impossible by construction, not by convention.
 *
 * THE EXISTING BASIC CLINIC PATIENT IMPORTER IS UNTOUCHED. This is a separate
 * router, separate models, separate storage, separate auth. `patientsImport.ts`
 * and its clinic-facing roles keep working exactly as before.
 *
 * TENANT ADDRESSING IS NEVER INFERRED FROM DATA. Organization and clinic come
 * from the request and are re-verified server-side on every call, including
 * that the clinic actually belongs to the organization — Prisma does not
 * enforce that relationship, and the source workbook's own branch column is
 * deliberately ignored.
 *
 * ERROR SHAPE. Every failure leaves here as `{ error, code, detail? }` with a
 * safe typed code. A raw database exception, a stack trace, a filename the
 * operator typed, or any cell value must never reach the client.
 */

import express, { type NextFunction, type Response } from 'express';
import multer from 'multer';
import type { Prisma } from '@prisma/client';
import prisma from '../db.js';
import {
  authenticatePlatformAdmin,
  type PlatformAdminRequest,
} from '../middleware/platformAuth.js';
import { csrfProtection } from '../middleware/csrf.js';
import {
  DEFAULT_BATCH_SIZE,
  MAX_UPLOAD_BYTES,
  MigrationError,
  SOURCE_SYSTEM_DEFAULT,
  DESTINATION_FIELDS,
  getDestinationField,
  type DryRunSummary,
  type MigrationRunStatus,
} from '../services/migration/contracts.js';
import { assertStatusIn } from '../services/migration/runState.js';
import {
  auditMigrationAction,
  loadRunOrThrow,
  resolveAndVerifyTarget,
  transitionRun,
  transitionRunInTx,
  isUuid,
} from '../services/migration/migrationRunService.js';
import {
  assertSupportedUpload,
  sanitizeDisplayFilename,
} from '../services/migration/parser/fileSignature.js';
import {
  deleteSourceFile,
  readSourceFile,
  storeSourceFile,
} from '../services/migration/sourceFileStore.js';
import {
  parseSourceWorkbook,
  profileColumns,
} from '../services/migration/parser/canonicalParser.js';
import { suggestMappings } from '../services/migration/mapping/mappingEngine.js';
import {
  validateMappings,
  isUndecidedMappingState,
} from '../services/migration/mapping/validateMapping.js';
import { evaluateDataLossGate } from '../services/migration/mapping/dataLossGate.js';
import { normalizeHeader } from '../services/migration/mapping/normalizeHeader.js';
import { buildColumnPreviews } from '../services/migration/mapping/columnPreview.js';
import { FIRST_CUSTOMER_MATRIX_BY_FIELD } from '../services/migration/mapping/firstCustomerMatrix.js';
import { UNNAMED_COLUMN_PREFIX } from '../services/migration/parser/canonicalParser.js';
import { runDryRun, assertExecutable } from '../services/migration/dryRun.js';
import {
  executeMigrationRun,
  markFailedBatchesForRetry,
  resumeMigrationRun,
} from '../services/migration/executor.js';
import { buildReconciliation } from '../services/migration/reconciliation.js';
import {
  buildFailureReport,
  buildSuccessReport,
} from '../services/migration/reports/migrationReports.js';
import {
  findClinicPractitioner,
  listClinicPractitioners,
} from '../utils/relationGuards.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * Uploads are held in memory and then written to a run-scoped, non-public
 * path. `memoryStorage` matches every other upload in this codebase, and at a
 * 32 MiB ceiling (the real first-customer workbook is ~10.8 MiB) that is a
 * bounded cost.
 *
 * NOTE the deliberate absence of a `fileFilter`. Filtering on the declared
 * MIME type or the filename extension would be security theatre — both are
 * attacker-controlled. The format is decided AFTER upload by inspecting the
 * binary signature, and the extension is never trusted, not even to reject.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

function handleUpload(req: PlatformAdminRequest, res: Response, next: NextFunction) {
  upload.single('file')(req as never, res as never, (err: unknown) => {
    if (!err) return next();
    const code = (err as { code?: string })?.code;
    if (code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `The uploaded file is larger than the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit.`,
        code: 'FILE_TOO_LARGE',
      });
    }
    return res.status(400).json({ error: 'The file could not be uploaded.', code: 'FILE_MISSING' });
  });
}

// ---------------------------------------------------------------------------
// THE AUTHORIZATION GATE. Everything below requires a Platform Admin session.
// ---------------------------------------------------------------------------
router.use(authenticatePlatformAdmin as express.RequestHandler, csrfProtection('platform'));

/** Translate any thrown error into a safe typed response. */
function fail(res: Response, error: unknown): Response {
  if (error instanceof MigrationError) {
    return res.status(error.httpStatus).json({
      error: error.message,
      code: error.code,
      ...(error.detail ? { detail: error.detail } : {}),
      ...(error.fieldName ? { fieldName: error.fieldName } : {}),
      retryable: error.retryable,
    });
  }
  // Deliberately opaque: an unexpected exception's message can echo row data
  // back from the driver. The code is logged, the message is not returned.
  logger.error(
    { errorCode: 'INTERNAL_ERROR', route: 'platform-migration' },
    '[migration] unhandled route error',
  );
  return res
    .status(500)
    .json({ error: 'An unexpected server error occurred.', code: 'INTERNAL_ERROR' });
}

function actorId(req: PlatformAdminRequest): string | null {
  return req.platformAdmin?.id ?? null;
}

/**
 * Express 5 types a route param as `string | string[]` (a repeated param
 * arrives as an array). Narrowing here rather than casting at each call site
 * means a malformed `?:id` cannot slip through as an array and reach a query:
 * anything that is not a plain string becomes `''`, which `loadRunOrThrow`
 * rejects as RUN_NOT_FOUND via its UUID check.
 */
function runIdParam(req: PlatformAdminRequest): string {
  const raw = (req.params as Record<string, unknown>).id;
  return typeof raw === 'string' ? raw : '';
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------
router.get('/migrations/targets', async (_req: PlatformAdminRequest, res: Response) => {
  try {
    const organizations = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        clinics: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
      },
      orderBy: { name: 'asc' },
    });
    res.json({ organizations });
  } catch (error) {
    fail(res, error);
  }
});

/** The destination catalog, so the UI never hard-codes it. */
router.get('/migrations/destinations', (_req: PlatformAdminRequest, res: Response) => {
  res.json({ destinations: DESTINATION_FIELDS });
});

// ---------------------------------------------------------------------------
// Run creation and listing
// ---------------------------------------------------------------------------
router.post('/migrations/runs', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const { organizationId, clinicId } = req.body ?? {};
    const target = await resolveAndVerifyTarget(organizationId, clinicId);

    const run = await prisma.migrationRun.create({
      data: {
        organizationId: target.organizationId,
        clinicId: target.clinicId,
        sourceSystem: SOURCE_SYSTEM_DEFAULT,
        entityType: 'patient',
        status: 'CREATED',
        batchSize: DEFAULT_BATCH_SIZE,
        createdByPlatformAdminId: actorId(req),
      },
    });

    await auditMigrationAction({
      runId: run.id,
      organizationId: run.organizationId,
      clinicId: run.clinicId,
      actorPlatformAdminId: actorId(req),
      action: 'clinic_data_migration.run_created',
      safeMetadata: { sourceSystem: run.sourceSystem, entityType: run.entityType },
    });

    res.status(201).json({ run });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/migrations/runs', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const where = {
      ...(typeof req.query.organizationId === 'string' && req.query.organizationId
        ? { organizationId: req.query.organizationId }
        : {}),
      ...(typeof req.query.status === 'string' && req.query.status
        ? { status: req.query.status }
        : {}),
    };

    const [data, total] = await Promise.all([
      prisma.migrationRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          organization: { select: { id: true, name: true } },
          clinic: { select: { id: true, name: true } },
          createdByPlatformAdmin: { select: { id: true, email: true, name: true } },
          _count: { select: { batches: true } },
        },
      }),
      prisma.migrationRun.count({ where }),
    ]);

    res.json({ data, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/migrations/runs/:id', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const run = await loadRunOrThrow(runIdParam(req));
    const [organization, clinic] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: run.organizationId },
        select: { id: true, name: true },
      }),
      prisma.clinic.findUnique({ where: { id: run.clinicId }, select: { id: true, name: true } }),
    ]);
    res.json({
      run: { ...run, organization, clinic },
      dryRun: run.dryRunSummary ?? null,
      reconciliation: run.reconciliation ?? null,
    });
  } catch (error) {
    fail(res, error);
  }
});

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------
router.post(
  '/migrations/runs/:id/upload',
  handleUpload,
  async (req: PlatformAdminRequest, res: Response) => {
    try {
      const run = await loadRunOrThrow(runIdParam(req));
      assertStatusIn(
        run.status as MigrationRunStatus,
        ['CREATED', 'UPLOADED', 'ANALYZED', 'MAPPING_REQUIRED', 'MAPPING_READY', 'DRY_RUN_COMPLETE', 'BLOCKED', 'READY'],
        'Uploading a source file',
      );

      const file = (req as unknown as { file?: { buffer: Buffer; originalname: string } }).file;
      if (!file?.buffer?.length) {
        throw new MigrationError('FILE_MISSING', { message: 'No file was uploaded.' });
      }

      // THE SIGNATURE DECIDES THE FORMAT. The extension and the declared MIME
      // type are ignored: an .xls renamed to .xlsx is still parsed as .xls.
      const format = assertSupportedUpload(file.buffer, file.originalname);
      const stored = await storeSourceFile(run.id, file.buffer);

      // A previous upload's file is removed rather than orphaned.
      if (run.sourceFileStoredPath && run.sourceFileStoredPath !== stored.storedPath) {
        await deleteSourceFile(run.sourceFileStoredPath).catch(() => undefined);
      }

      // Re-uploading resets every downstream decision: a mapping validated
      // against different headers must never be silently reused.
      await prisma.$transaction([
        prisma.migrationFieldMapping.deleteMany({ where: { runId: run.id } }),
        prisma.migrationRowOutcome.deleteMany({ where: { runId: run.id } }),
        prisma.migrationRunBatch.deleteMany({ where: { runId: run.id } }),
      ]);

      const updated = await transitionRun(run.id, run.status as MigrationRunStatus, 'UPLOADED', {
        actorPlatformAdminId: actorId(req),
        action: 'clinic_data_migration.file_uploaded',
        data: {
          sourceFileNameSafe: sanitizeDisplayFilename(file.originalname),
          sourceFileFormat: format,
          sourceFileSizeBytes: stored.sizeBytes,
          sourceFileSha256: stored.sha256,
          sourceFileStoredPath: stored.storedPath,
          sourceFileDeletedAt: null,
          uploadedAt: new Date(),
          sheetName: null,
          sheetIndex: null,
          totalSourceRows: null,
          headerColumnCount: null,
          analysisWarnings: undefined,
          dryRunSummary: undefined,
          reconciliation: undefined,
          totalBatches: 0,
          currentBatch: 0,
          processedRows: 0,
          createdRows: 0,
          matchedRows: 0,
          skippedRows: 0,
          failedRows: 0,
          warningRows: 0,
          blockedRows: 0,
        },
        // Safe metadata only: format, size and checksum. NOT the filename the
        // operator typed, which is attacker-influenced free text.
        safeMetadata: { format, sizeBytes: stored.sizeBytes, sha256: stored.sha256 },
      });

      res.json({ run: updated });
    } catch (error) {
      fail(res, error);
    }
  },
);

// ---------------------------------------------------------------------------
// Analyze — parse, discover headers, propose mappings
// ---------------------------------------------------------------------------
router.post('/migrations/runs/:id/analyze', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const run = await loadRunOrThrow(runIdParam(req));
    assertStatusIn(
      run.status as MigrationRunStatus,
      ['UPLOADED', 'ANALYZED', 'MAPPING_REQUIRED', 'MAPPING_READY'],
      'Analyzing the workbook',
    );
    if (!run.sourceFileStoredPath || !run.sourceFileFormat) {
      throw new MigrationError('FILE_MISSING', {
        message: 'Upload a source file before analyzing.',
      });
    }

    const sheetIndex =
      typeof req.body?.sheetIndex === 'number' ? Number(req.body.sheetIndex) : undefined;

    const buffer = await readSourceFile(run.sourceFileStoredPath);
    const workbook = await parseSourceWorkbook(
      buffer,
      run.sourceFileFormat as 'xls' | 'xlsx',
      sheetIndex !== undefined ? { sheetIndex } : {},
    );
    const profiles = profileColumns(workbook);
    const suggestions = suggestMappings(workbook.headers, profiles, {
      sourceSystem: run.sourceSystem,
    });

    const profileByIndex = new Map(profiles.map((p) => [p.index, p]));

    // Sanitized sample-value previews for the mapping screen (Objective C).
    // Sensitivity is derived from the PROPOSED destination type where the
    // engine already suggests one, so a column headed toward
    // `patient.identity.tckn` / `.phone` / `.email` is masked even before the
    // operator confirms the mapping. See columnPreview.ts for the full policy.
    const destinationTypeByIndex = new Map(
      suggestions
        .filter((s) => s.destinationField)
        .map((s) => [s.sourceIndex, getDestinationField(s.destinationField as string)?.type]),
    );
    const maxLengthByIndex = new Map(profiles.map((p) => [p.index, p.maxLength]));
    // Fail-closed: a column the mapping engine has already decided is
    // LEGAL_BLOCKED (KVKK Art. 6 special-category, e.g. KANGURUBU) must be
    // masked regardless of destination type or header-keyword heuristics —
    // those alone missed KANGURUBU (no destination, unrecognized header, and
    // short values like "A Rh+" that read as low-risk). See columnPreview.ts.
    const mappingStateByIndex = new Map(suggestions.map((s) => [s.sourceIndex, s.mappingState]));
    const columnPreviews = buildColumnPreviews(
      workbook.headers,
      workbook.rows,
      destinationTypeByIndex,
      maxLengthByIndex,
      mappingStateByIndex,
    );

    // ONE definition of "still needs a human", shared with validateMappings.
    // Hard-coding the list here is how a run ends up advertising MAPPING_READY
    // while the validator reports the same mapping as invalid.
    const unresolved = suggestions.filter((s) => isUndecidedMappingState(s.mappingState)).length;

    const fromStatus = run.status as MigrationRunStatus;
    const mappingStatus: MigrationRunStatus = unresolved > 0 ? 'MAPPING_REQUIRED' : 'MAPPING_READY';

    const analysisData = {
      sheetName: workbook.metadata.sheets[workbook.metadata.selectedSheetIndex]?.name ?? null,
      sheetIndex: workbook.metadata.selectedSheetIndex,
      totalSourceRows: workbook.rows.length,
      headerColumnCount: workbook.headers.length,
      analysisWarnings: workbook.metadata.warnings as never,
      analyzedAt: new Date(),
    };
    const analysisMetadata = {
      totalSourceRows: workbook.rows.length,
      headerColumnCount: workbook.headers.length,
      unresolvedMappings: unresolved,
      parseMs: workbook.metadata.parseMs,
    };

    /*
     * ONE transaction for the whole analyze action: replace the proposed
     * mappings AND move the run, or do neither.
     *
     * The accepted lifecycle is UPLOADED -> ANALYZED -> MAPPING_READY |
     * MAPPING_REQUIRED (see runState.ts). ANALYZED is a real state, not a
     * label: it is the point at which the workbook has been read and the
     * columns proposed but no mapping decision has been reviewed. Analyze
     * therefore takes BOTH edges rather than the non-existent
     * UPLOADED -> MAPPING_* shortcut, which is what previously threw
     * MIGRATION_STATE_INVALID *after* the mappings had already been committed
     * and left the run stranded in UPLOADED with a full mapping set.
     *
     * Re-analyzing a run that is already past ANALYZED (the operator picks a
     * different sheet, or re-runs the suggestion engine) starts from that
     * status instead; the state machine already carries those edges.
     */
    const updated = await prisma.$transaction(async (tx) => {
      await tx.migrationFieldMapping.deleteMany({ where: { runId: run.id } });
      await tx.migrationFieldMapping.createMany({
        data: suggestions.map((s) => ({
          runId: run.id,
          sourceField: s.sourceField,
          sourceIndex: s.sourceIndex,
          sourceNormalized: s.sourceNormalized || normalizeHeader(s.sourceField),
          // The parser's authoritative headerless flag, persisted so the
          // mapping API can answer "does this column have an original
          // header?" long after the workbook has been put away.
          sourceHeaderWasBlank: s.sourceHeader === null,
          destinationField: s.destinationField,
          transform: s.transform,
          composeOrder: s.composeOrder,
          state: s.mappingState,
          confidence: s.confidence,
          reason: s.reason,
          sourceProfile: (profileByIndex.get(s.sourceIndex) ?? null) as never,
          isAutoSuggested: true,
        })),
      });

      if (fromStatus === 'UPLOADED') {
        await transitionRunInTx(tx, run.id, 'UPLOADED', 'ANALYZED', {
          actorPlatformAdminId: actorId(req),
          action: 'clinic_data_migration.analyzed',
          data: analysisData,
          safeMetadata: analysisMetadata,
        });
        return transitionRunInTx(tx, run.id, 'ANALYZED', mappingStatus, {
          actorPlatformAdminId: actorId(req),
          action: 'clinic_data_migration.mapping_proposed',
          safeMetadata: { unresolvedMappings: unresolved, proposed: suggestions.length },
        });
      }

      return transitionRunInTx(tx, run.id, fromStatus, mappingStatus, {
        actorPlatformAdminId: actorId(req),
        action: 'clinic_data_migration.analyzed',
        data: analysisData,
        safeMetadata: analysisMetadata,
      });
    });

    res.json({
      run: updated,
      analysis: {
        sheetName: updated.sheetName,
        sheetIndex: updated.sheetIndex,
        sheets: workbook.metadata.sheets,
        totalSourceRows: workbook.rows.length,
        headerColumnCount: workbook.headers.length,
        format: workbook.metadata.format,
        warnings: workbook.metadata.warnings,
        headers: workbook.headers,
        profiles,
        columnPreviews,
      },
    });
  } catch (error) {
    fail(res, error);
  }
});

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------
/**
 * Read the mapping decision set for a run.
 *
 * Takes the client to read THROUGH so a caller inside a transaction reads its
 * own uncommitted writes: a mapping edit must validate against the rows it
 * just wrote, in the same transaction that will move the run, or the status it
 * derives describes a state the database never held.
 */
async function loadMappingState(db: Prisma.TransactionClient, runId: string) {
  const [mappings, run] = await Promise.all([
    db.migrationFieldMapping.findMany({
      where: { runId },
      orderBy: { sourceIndex: 'asc' },
    }),
    db.migrationRun.findUnique({ where: { id: runId }, select: { headerColumnCount: true } }),
  ]);
  const headers = mappings.map((m) => ({
    original: m.sourceField,
    normalized: m.sourceNormalized,
    index: m.sourceIndex,
    // Carried back so validation and the wire DTO see the same authoritative
    // fact the parser produced. `null` (a row written before the column
    // existed) deliberately becomes `undefined`, i.e. "unknown", NOT `false`:
    // claiming a column definitely had a header when the evidence was never
    // recorded is precisely the kind of confident guess this flag replaced.
    headerWasBlank: m.sourceHeaderWasBlank ?? undefined,
  }));
  return { mappings, headers, headerColumnCount: run?.headerColumnCount ?? headers.length };
}

/**
 * Shape a persisted mapping row into the wire DTO the mapping screen expects.
 *
 * Everything added here is COMPUTED AT RESPONSE TIME from columns the row
 * already has. Nothing new is persisted by this function.
 *
 * `policyNote` (F3-DATA-MIG-TODAY-001-UI-006-R6) tells an operator WHY, not
 * just THAT, a column is withheld. It is read from the first-customer matrix's
 * own `note` — the same deterministic policy record that produced the state in
 * the first place — and is never a fresh legal conclusion invented at this
 * layer. It now covers SENSITIVE_REVIEW_REQUIRED as well as LEGAL_BLOCKED,
 * because a column the operator is being ASKED to decide about needs the
 * recorded reasoning at least as much as one that is simply withheld. A source
 * system the matrix does not cover gets `null` and the UI falls back to the
 * `reason` label.
 *
 * `sourceHeader` / `sourceLabel` FIX A PRODUCTION DEFECT
 * (F3-DATA-MIG-TODAY-001-FINAL-R7). These endpoints returned the raw Prisma
 * rows, and `MigrationFieldMapping` has no `sourceLabel` column — so the
 * client's `MappingDto.sourceLabel` was `undefined` in the browser on every
 * response. Two visible consequences:
 *   1. The mapping row's PRIMARY identity line rendered empty, leaving the
 *      physical coordinate ("Excel sütunu: 43 / AQ") as the only thing an
 *      operator could see. That is the production screenshot this task exists
 *      to fix, and it was a missing wire field, not a styling choice.
 *   2. `mappingMatchesQuery` dereferenced `sourceLabel.toLowerCase()`. Because
 *      `||` short-circuits it survived any query that matched `sourceField`
 *      first, and threw a TypeError inside a render-phase `useMemo` on any
 *      query that did not — i.e. searching for something absent crashed the
 *      screen instead of showing "no results".
 *
 * `sourceHeader` is the ORIGINAL workbook header, or `null` when the header
 * CELL was blank and `sourceField` therefore holds the synthesized
 * `COLUMN_<index>` name. It is taken from the persisted
 * `sourceHeaderWasBlank`, never inferred from the shape of `sourceField` —
 * see CanonicalHeader's contract in contracts.ts. Rows written before that
 * column existed carry NULL, and only those fall back to a legacy inference,
 * which is anchored on `sourceIndex` (`COLUMN_<n>` AT physical column n) and
 * so is strictly narrower than a bare name match.
 */
function isLegacyHeaderlessName(sourceField: string, sourceIndex: number): boolean {
  return sourceField === `${UNNAMED_COLUMN_PREFIX}${sourceIndex}`;
}

const POLICY_NOTE_STATES = new Set(['LEGAL_BLOCKED', 'SENSITIVE_REVIEW_REQUIRED']);

function toMappingDtos<
  T extends {
    sourceField: string;
    sourceIndex: number;
    sourceHeaderWasBlank?: boolean | null;
    state: string;
  },
>(mappings: readonly T[]): (T & {
  policyNote: string | null;
  sourceHeader: string | null;
  sourceLabel: string;
})[] {
  return mappings.map((m) => {
    const headerWasBlank =
      m.sourceHeaderWasBlank ?? isLegacyHeaderlessName(m.sourceField, m.sourceIndex);
    const sourceHeader = headerWasBlank ? null : m.sourceField;
    return {
      ...m,
      policyNote: POLICY_NOTE_STATES.has(m.state)
        ? FIRST_CUSTOMER_MATRIX_BY_FIELD.get(m.sourceField)?.note ?? null
        : null,
      sourceHeader,
      // Never undefined. A headerless column falls back to the synthesized
      // technical name so this field always has SOMETHING; the UI is expected
      // to prefer `sourceHeader` and render its own localized "no header"
      // label, because choosing that wording is a presentation decision and
      // does not belong on the wire.
      sourceLabel: sourceHeader ?? m.sourceField,
    };
  });
}

router.get('/migrations/runs/:id/mappings', async (req: PlatformAdminRequest, res: Response) => {
  try {
    await loadRunOrThrow(runIdParam(req));
    const { mappings, headers } = await loadMappingState(prisma, runIdParam(req));
    res.json({
      mappings: toMappingDtos(mappings),
      destinations: DESTINATION_FIELDS,
      validation: validateMappings(mappings, headers),
    });
  } catch (error) {
    fail(res, error);
  }
});

/** Transaction window for the mapping-edit routes. See PUT /mappings below. */
const TX_OPTIONS = { maxWait: 5_000, timeout: 20_000 } as const;

/** The statuses in which the mapping may still be edited. */
const MAPPING_EDITABLE_STATUSES: readonly MigrationRunStatus[] = [
  'ANALYZED',
  'MAPPING_REQUIRED',
  'MAPPING_READY',
  'DRY_RUN_COMPLETE',
  'BLOCKED',
  'READY',
];

router.put('/migrations/runs/:id/mappings', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const run = await loadRunOrThrow(runIdParam(req));
    /*
     * A COURTESY pre-check, not the authorization for the write. It exists so
     * an operator who clicked Save on a run that has since started executing
     * gets the useful action-shaped message without paying for a transaction.
     * The status that actually authorizes the mutation is re-read INSIDE the
     * transaction below, because this one is already stale by the time the
     * transaction opens.
     */
    assertStatusIn(
      run.status as MigrationRunStatus,
      MAPPING_EDITABLE_STATUSES,
      'Editing the field mapping',
    );

    const incoming = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
    if (incoming.length === 0) {
      throw new MigrationError('MAPPING_INVALID', { message: 'No mapping changes were supplied.' });
    }

    const decidedByPlatformAdminId = actorId(req);
    const decidedAt = new Date();

    /*
     * ONE transaction for the whole logical action: re-verify the status, edit
     * the mapping rows, validate what the edit actually produced, and move the
     * run — or none of it.
     *
     * Splitting these was the defect. The edits used to commit on their own and
     * the transition ran afterwards, so a rejected transition (a concurrent
     * status change, a dry run starting in another tab) left the edited rows
     * persisted underneath a run still advertising DRY_RUN_COMPLETE / READY /
     * MAPPING_READY. The dry run summary and the status then described a
     * mapping that no longer existed.
     *
     * The window is widened past Prisma's 5 s default because the statement
     * count scales with how much of the sheet was saved at once — the real
     * first-customer workbook is ~60 columns, one UPDATE each. A timeout would
     * roll back safely, so this only stops a large-but-legitimate save from
     * hitting one.
     */
    const { updated, mappings, validation } = await prisma.$transaction(async (tx) => {
      // 1. THE AUTHORITATIVE STATUS. Read inside the transaction, not the one
      //    the request was routed on.
      const current = await tx.migrationRun.findUnique({
        where: { id: run.id },
        select: { status: true },
      });
      if (!current) {
        throw new MigrationError('RUN_NOT_FOUND', { message: 'Migration run not found.' });
      }
      const fromStatus = current.status as MigrationRunStatus;
      assertStatusIn(fromStatus, MAPPING_EDITABLE_STATUSES, 'Editing the field mapping');

      // 2. Apply the operator's decisions.
      for (const entry of incoming as Array<Record<string, unknown>>) {
        await tx.migrationFieldMapping.updateMany({
          where: { runId: run.id, sourceField: String(entry.sourceField ?? '') },
          data: {
            destinationField: (entry.destinationField as string | null) ?? null,
            transform: (entry.transform as string | null) ?? null,
            composeOrder:
              entry.composeOrder === null || entry.composeOrder === undefined
                ? null
                : Number(entry.composeOrder),
            state: String(entry.state ?? 'MANUAL_REQUIRED'),
            isAutoSuggested: false,
            decidedByPlatformAdminId,
            decidedAt,
          },
        });
      }

      // 3. Validate the rows AS WRITTEN, through the same transaction.
      const state = await loadMappingState(tx, run.id);
      const result = validateMappings(state.mappings, state.headers);
      const nextStatus: MigrationRunStatus = result.valid ? 'MAPPING_READY' : 'MAPPING_REQUIRED';

      // Counts only. Never the destinations chosen for named source columns —
      // those are safe, but the count is what an auditor needs.
      //
      // F3-DATA-MIG-TODAY-001-R9 adds the two data-loss figures. `ignored` has
      // always been recorded, but it conflates the profile's RECOMMENDATION
      // with the operator's DECISION, so on its own it could never answer the
      // question an auditor actually asks after a migration: how many columns
      // carrying real data did a human deliberately choose to leave behind?
      // The gate answers it from the same rows this transaction just wrote.
      const gate = evaluateDataLossGate(state.mappings);
      const savedMetadata = {
        changed: incoming.length,
        mapped: result.mappedCount,
        unresolved: result.unresolvedCount,
        blocked: result.blockedCount,
        legalBlocked: result.legalBlockedCount,
        ignored: result.ignoredCount,
        operatorConfirmedExclusions: gate.operatorConfirmedExcluded,
        unconfirmedExclusions: gate.systemRecommendedButUnconfirmedExclusions,
        valid: result.valid,
      };

      /*
       * 4. Move the run along edges the state machine actually has.
       *
       * Editing the mapping AFTER a dry run (DRY_RUN_COMPLETE) or after the run
       * was marked ready (READY) invalidates the dry run, which was computed
       * against the mapping that just changed. The only edge back into the
       * mapping stage from those two states is -> MAPPING_REQUIRED, so a valid
       * edit takes that edge FIRST and then MAPPING_REQUIRED -> MAPPING_READY.
       * Both hops are asserted and audited; no shortcut edge was added.
       */
      const needsMappingStageHop =
        nextStatus === 'MAPPING_READY' &&
        (fromStatus === 'DRY_RUN_COMPLETE' || fromStatus === 'READY');

      if (needsMappingStageHop) {
        await transitionRunInTx(tx, run.id, fromStatus, 'MAPPING_REQUIRED', {
          actorPlatformAdminId: decidedByPlatformAdminId,
          action: 'clinic_data_migration.mapping_saved',
          safeMetadata: savedMetadata,
        });
        const revalidated = await transitionRunInTx(
          tx,
          run.id,
          'MAPPING_REQUIRED',
          'MAPPING_READY',
          {
            actorPlatformAdminId: decidedByPlatformAdminId,
            action: 'clinic_data_migration.mapping_revalidated',
            safeMetadata: savedMetadata,
          },
        );
        return { updated: revalidated, mappings: state.mappings, validation: result };
      }

      const moved = await transitionRunInTx(tx, run.id, fromStatus, nextStatus, {
        actorPlatformAdminId: decidedByPlatformAdminId,
        action: 'clinic_data_migration.mapping_saved',
        safeMetadata: savedMetadata,
      });
      return { updated: moved, mappings: state.mappings, validation: result };
    }, TX_OPTIONS);

    res.json({ run: updated, mappings: toMappingDtos(mappings), validation });
  } catch (error) {
    fail(res, error);
  }
});

router.post(
  '/migrations/runs/:id/mappings/accept-auto',
  async (req: PlatformAdminRequest, res: Response) => {
    try {
      const run = await loadRunOrThrow(runIdParam(req));
      const acceptableStatuses: readonly MigrationRunStatus[] = [
        'ANALYZED',
        'MAPPING_REQUIRED',
        'MAPPING_READY',
      ];
      // Courtesy pre-check; the authorizing status is re-read in the
      // transaction, exactly as in PUT /mappings.
      assertStatusIn(
        run.status as MigrationRunStatus,
        acceptableStatuses,
        'Accepting automatic mappings',
      );

      const decidedByPlatformAdminId = actorId(req);
      const decidedAt = new Date();

      // Same atomicity contract as PUT /mappings: the bulk promotion and the
      // status move commit together or not at all.
      const { updated, mappings, validation, accepted } = await prisma.$transaction(async (tx) => {
        const current = await tx.migrationRun.findUnique({
          where: { id: run.id },
          select: { status: true },
        });
        if (!current) {
          throw new MigrationError('RUN_NOT_FOUND', { message: 'Migration run not found.' });
        }
        const fromStatus = current.status as MigrationRunStatus;
        assertStatusIn(fromStatus, acceptableStatuses, 'Accepting automatic mappings');

        // Only AUTO_REVIEW is promoted. AUTO_CONFIDENT is already decided;
        // MANUAL_REQUIRED has no suggestion to accept; BLOCKED and LEGAL_BLOCKED
        // are deliberate refusals and a bulk action must never lift them.
        const promoted = await tx.migrationFieldMapping.updateMany({
          where: { runId: run.id, state: 'AUTO_REVIEW', destinationField: { not: null } },
          data: { state: 'RESOLVED', decidedByPlatformAdminId, decidedAt },
        });

        const state = await loadMappingState(tx, run.id);
        const result = validateMappings(state.mappings, state.headers);
        const moved = await transitionRunInTx(
          tx,
          run.id,
          fromStatus,
          result.valid ? 'MAPPING_READY' : 'MAPPING_REQUIRED',
          {
            actorPlatformAdminId: decidedByPlatformAdminId,
            action: 'clinic_data_migration.mapping_auto_accepted',
            safeMetadata: { accepted: promoted.count, valid: result.valid },
          },
        );
        return {
          updated: moved,
          mappings: state.mappings,
          validation: result,
          accepted: promoted.count,
        };
      });

      res.json({ run: updated, mappings: toMappingDtos(mappings), validation, accepted });
    } catch (error) {
      fail(res, error);
    }
  },
);

router.post(
  '/migrations/runs/:id/mappings/validate',
  async (req: PlatformAdminRequest, res: Response) => {
    try {
      await loadRunOrThrow(runIdParam(req));
      const { mappings, headers } = await loadMappingState(prisma, runIdParam(req));
      res.json({ validation: validateMappings(mappings, headers) });
    } catch (error) {
      fail(res, error);
    }
  },
);

// ---------------------------------------------------------------------------
// Reference mapping (practitioner)
// ---------------------------------------------------------------------------
async function distinctPractitionerValues(run: {
  id: string;
  sourceFileStoredPath: string | null;
  sourceFileFormat: string | null;
  sheetIndex: number | null;
}): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!run.sourceFileStoredPath || !run.sourceFileFormat) return counts;

  const mapping = await prisma.migrationFieldMapping.findFirst({
    where: { runId: run.id, destinationField: 'patient.primaryPractitionerId' },
    select: { sourceIndex: true, state: true },
  });
  if (!mapping) return counts;

  const buffer = await readSourceFile(run.sourceFileStoredPath);
  const workbook = await parseSourceWorkbook(
    buffer,
    run.sourceFileFormat as 'xls' | 'xlsx',
    run.sheetIndex !== null ? { sheetIndex: run.sheetIndex } : {},
  );

  for (const row of workbook.rows) {
    // BYTE-EXACT as exported. The reference-map key is never normalized, or a
    // rerun silently re-keys and every mapping the operator approved is lost.
    const value = row.cells[mapping.sourceIndex]?.text ?? '';
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

router.get('/migrations/runs/:id/references', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const run = await loadRunOrThrow(runIdParam(req));
    const counts = await distinctPractitionerValues(run);

    if (counts.size === 0) {
      return res.json({ required: false, entityType: 'practitioner', values: [], candidates: [] });
    }

    // Candidates are the TARGET CLINIC's eligible practitioners, not every
    // active organization user. listClinicPractitioners is the repository's
    // existing single source of truth for "is this user an eligible
    // practitioner for this clinic" (branch-scoped UserClinic assignment with a
    // practitioner role, or the legacy primary User.clinicId assignment, both
    // requiring User.isActive) — the same helper the external-calendar mapping
    // UI and its write-path validation already use. Offering receptionists,
    // managers or a sibling branch's dentist here would let an operator
    // attribute a whole clinic's patients to someone who does not practise
    // there.
    const [existing, candidates] = await Promise.all([
      prisma.migrationReferenceMap.findMany({
        where: {
          organizationId: run.organizationId,
          clinicId: run.clinicId,
          sourceSystem: run.sourceSystem,
          entityType: 'practitioner',
        },
      }),
      listClinicPractitioners(run.clinicId),
    ]);

    const byValue = new Map(existing.map((e) => [e.sourceValue, e]));
    const candidateById = new Map(candidates.map((c) => [c.id, c]));

    const values = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([sourceValue, rowCount]) => {
        const record = byValue.get(sourceValue);
        const destination = record?.destinationId ? candidateById.get(record.destinationId) : null;
        return {
          sourceValue,
          rowCount,
          status: record?.status ?? 'UNMAPPED',
          destinationId: record?.destinationId ?? null,
          destinationLabel: destination
            ? `${destination.firstName} ${destination.lastName}`
            : null,
        };
      });

    res.json({
      required: true,
      entityType: 'practitioner',
      values,
      candidates: candidates.map((c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`,
        role: c.role,
      })),
    });
  } catch (error) {
    fail(res, error);
  }
});

router.put('/migrations/runs/:id/references', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const run = await loadRunOrThrow(runIdParam(req));
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];

    for (const entry of entries) {
      const sourceValue = String(entry.sourceValue ?? '');
      if (!sourceValue) continue;
      const status = String(entry.status ?? 'UNMAPPED');
      const destinationId =
        status === 'MAPPED_APPROVED' ? (entry.destinationId as string | null) : null;

      // NO AUTO-CREATION. The destination must already exist and belong to this
      // organization — a migration-created User would be a credentialed,
      // payable account created without an onboarding decision.
      if (status === 'MAPPED_APPROVED') {
        if (!destinationId || !isUuid(destinationId)) {
          throw new MigrationError('REFERENCE_UNRESOLVED', {
            message: 'An approved practitioner mapping must name an existing NoraMedi user.',
          });
        }
        // Organization membership alone is NOT enough. The destination must be
        // an eligible practitioner FOR THE RUN'S TARGET CLINIC under the
        // repository's accepted multi-branch access model — the same check the
        // candidate list is built from, so a direct API call cannot approve a
        // receptionist, a deactivated user, or a sibling branch's dentist even
        // though the UI no longer offers them. Cross-organization users are
        // excluded by construction: the clinic belongs to run.organizationId.
        const practitioner = await findClinicPractitioner(destinationId, run.clinicId);
        if (!practitioner) {
          throw new MigrationError('REFERENCE_UNRESOLVED', {
            message:
              'The selected user is not an eligible practitioner for this migration’s target clinic.',
          });
        }
      }

      await prisma.migrationReferenceMap.upsert({
        where: {
          organizationId_clinicId_sourceSystem_entityType_sourceValue: {
            organizationId: run.organizationId,
            clinicId: run.clinicId,
            sourceSystem: run.sourceSystem,
            entityType: 'practitioner',
            sourceValue,
          },
        },
        create: {
          organizationId: run.organizationId,
          clinicId: run.clinicId,
          sourceSystem: run.sourceSystem,
          entityType: 'practitioner',
          sourceValue,
          destinationId,
          status,
          approvedByPlatformAdminId: actorId(req),
          approvedAt: new Date(),
        },
        update: {
          destinationId,
          status,
          approvedByPlatformAdminId: actorId(req),
          approvedAt: new Date(),
        },
      });
    }

    await auditMigrationAction({
      runId: run.id,
      organizationId: run.organizationId,
      clinicId: run.clinicId,
      actorPlatformAdminId: actorId(req),
      action: 'clinic_data_migration.reference_map_saved',
      safeMetadata: { entityType: 'practitioner', entries: entries.length },
    });

    const counts = await distinctPractitionerValues(run);
    const existing = await prisma.migrationReferenceMap.findMany({
      where: {
        organizationId: run.organizationId,
        clinicId: run.clinicId,
        sourceSystem: run.sourceSystem,
        entityType: 'practitioner',
      },
    });
    const byValue = new Map(existing.map((e) => [e.sourceValue, e]));

    res.json({
      values: [...counts.entries()].map(([sourceValue, rowCount]) => ({
        sourceValue,
        rowCount,
        status: byValue.get(sourceValue)?.status ?? 'UNMAPPED',
        destinationId: byValue.get(sourceValue)?.destinationId ?? null,
      })),
    });
  } catch (error) {
    fail(res, error);
  }
});

// ---------------------------------------------------------------------------
// Dry run — ZERO DOMAIN WRITES
// ---------------------------------------------------------------------------
router.post('/migrations/runs/:id/dry-run', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const run = await loadRunOrThrow(runIdParam(req));
    assertStatusIn(
      run.status as MigrationRunStatus,
      ['MAPPING_READY', 'DRY_RUN_COMPLETE', 'BLOCKED', 'READY'],
      'Running a dry run',
    );
    if (!run.sourceFileStoredPath || !run.sourceFileFormat) {
      throw new MigrationError('FILE_MISSING', { message: 'Upload a source file first.' });
    }

    await transitionRun(run.id, run.status as MigrationRunStatus, 'DRY_RUN_RUNNING', {
      actorPlatformAdminId: actorId(req),
      action: 'clinic_data_migration.dry_run_started',
    });

    const buffer = await readSourceFile(run.sourceFileStoredPath);
    const workbook = await parseSourceWorkbook(
      buffer,
      run.sourceFileFormat as 'xls' | 'xlsx',
      run.sheetIndex !== null ? { sheetIndex: run.sheetIndex } : {},
    );

    const { mappings, headers } = await loadMappingState(prisma, run.id);
    const validation = validateMappings(mappings, headers);

    const referenceRecords = await prisma.migrationReferenceMap.findMany({
      where: {
        organizationId: run.organizationId,
        clinicId: run.clinicId,
        sourceSystem: run.sourceSystem,
        entityType: 'practitioner',
      },
    });
    const resolvedValues = new Set(
      referenceRecords
        .filter((r) => r.status === 'MAPPED_APPROVED' || r.status === 'MAPPED_IGNORED')
        .map((r) => r.sourceValue),
    );
    const practitionerCounts = await distinctPractitionerValues(run);
    const unresolvedReferenceValues = new Set(
      [...practitionerCounts.keys()].filter((value) => !resolvedValues.has(value)),
    );

    const summary: DryRunSummary = await runDryRun({
      runId: run.id,
      organizationId: run.organizationId,
      clinicId: run.clinicId,
      sourceSystem: run.sourceSystem,
      workbook,
      mappings,
      unresolvedReferenceValues,
      legalBlockedFields: mappings
        .filter((m) => m.state === 'LEGAL_BLOCKED')
        .map((m) => m.sourceField),
      unresolvedMappingCount: validation.unresolvedCount,
      /*
       * F3-DATA-MIG-TODAY-001-R9. The PERSISTED rows, not the narrowed
       * `ResolvedMapping` projection: the data-loss gate needs the measured
       * `sourceProfile` and the operator-decision evidence, and neither
       * survives that projection.
       */
      gateRecords: mappings,
    });

    const updated = await transitionRun(
      run.id,
      'DRY_RUN_RUNNING',
      summary.executable ? 'DRY_RUN_COMPLETE' : 'BLOCKED',
      {
        actorPlatformAdminId: actorId(req),
        action: 'clinic_data_migration.dry_run_completed',
        data: { dryRunSummary: summary as never, dryRunAt: new Date() },
        safeMetadata: {
          totalSourceRows: summary.totalSourceRows,
          validRows: summary.validRows,
          blockers: summary.blockers.length,
          expectedCreateCount: summary.expectedCreateCount,
          expectedReuseCount: summary.expectedReuseCount,
          planLimitAllowed: summary.planLimit.allowed,
          // F3-DATA-MIG-TODAY-001-R9. Counts only — the audit record must be
          // able to answer "how many columns carrying data were still
          // unaccounted for at this dry run?" without re-reading the summary
          // Json, and without naming a single source column in the audit log.
          dataLossGateSatisfied: summary.dataLossGate?.satisfied ?? false,
          meaningfulSourceColumns: summary.dataLossGate?.meaningfulSourceColumns ?? 0,
          operatorConfirmedExclusions: summary.dataLossGate?.operatorConfirmedExcluded ?? 0,
          unconfirmedExclusions:
            summary.dataLossGate?.systemRecommendedButUnconfirmedExclusions ?? 0,
          unmeasuredFillColumns: summary.dataLossGate?.unmeasuredFillColumns ?? 0,
          executable: summary.executable,
          durationMs: summary.durationMs,
        },
      },
    );

    res.json({ run: updated, dryRun: summary });
  } catch (error) {
    fail(res, error);
  }
});

// ---------------------------------------------------------------------------
// Execute / progress / cancel / retry / resume
// ---------------------------------------------------------------------------
/** Exported for the DB-backed branch-isolation regression; not a route. */
export async function buildExecuteInput(run: {
  id: string;
  organizationId: string;
  clinicId: string;
  sourceSystem: string;
  batchSize: number;
  sourceFileStoredPath: string | null;
  sourceFileFormat: string | null;
  sheetIndex: number | null;
}, actor: string | null) {
  if (!run.sourceFileStoredPath || !run.sourceFileFormat) {
    throw new MigrationError('FILE_MISSING', { message: 'The source file is no longer available.' });
  }
  const buffer = await readSourceFile(run.sourceFileStoredPath);
  const workbook = await parseSourceWorkbook(
    buffer,
    run.sourceFileFormat as 'xls' | 'xlsx',
    run.sheetIndex !== null ? { sheetIndex: run.sheetIndex } : {},
  );
  const mappings = await prisma.migrationFieldMapping.findMany({
    where: { runId: run.id },
    orderBy: { sourceIndex: 'asc' },
  });
  const references = await prisma.migrationReferenceMap.findMany({
    where: {
      organizationId: run.organizationId,
      // Branch isolation: the reference map is clinic-scoped, so the EXECUTION
      // input must be read at the run's target clinic. Without this, a sibling
      // clinic's approved row for the same source label could be written into
      // the map and attribute imported patients to the wrong clinician.
      clinicId: run.clinicId,
      sourceSystem: run.sourceSystem,
      entityType: 'practitioner',
      status: { in: ['MAPPED_APPROVED', 'MAPPED_IGNORED'] },
    },
  });
  const practitionerMap = new Map<string, string | null>(
    references.map((r) => [r.sourceValue, r.status === 'MAPPED_APPROVED' ? r.destinationId : null]),
  );

  return {
    runId: run.id,
    organizationId: run.organizationId,
    clinicId: run.clinicId,
    sourceSystem: run.sourceSystem,
    batchSize: run.batchSize,
    workbook,
    mappings,
    practitionerMap,
    actorPlatformAdminId: actor,
  };
}

/**
 * Finalize a finished execution: recompute reconciliation from the DATABASE
 * and persist it. Runs after the executor releases its lock.
 */
async function finalizeRun(runId: string, destinationCountBefore: number): Promise<void> {
  const run = await prisma.migrationRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const summary = run.dryRunSummary as unknown as DryRunSummary | null;

  const reconciliation = await buildReconciliation({
    runId,
    organizationId: run.organizationId,
    clinicId: run.clinicId,
    sourceSystem: run.sourceSystem,
    destinationCountBefore,
    eligibleTotal: summary?.validRows ?? run.processedRows,
    sourceTotal: run.totalSourceRows ?? summary?.totalSourceRows ?? 0,
  });

  await prisma.migrationRun.update({
    where: { id: runId },
    data: { reconciliation: reconciliation as never },
  });
}

router.post('/migrations/runs/:id/execute', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const run = await loadRunOrThrow(runIdParam(req));

    if (req.body?.confirm !== true) {
      throw new MigrationError('MIGRATION_STATE_INVALID', {
        message: 'Execution must be explicitly confirmed.',
      });
    }

    assertStatusIn(run.status as MigrationRunStatus, ['DRY_RUN_COMPLETE', 'READY'], 'Execution');
    assertExecutable(run.dryRunSummary as unknown as DryRunSummary | null);

    if (run.status === 'DRY_RUN_COMPLETE') {
      await transitionRun(run.id, 'DRY_RUN_COMPLETE', 'READY', {
        actorPlatformAdminId: actorId(req),
        action: 'clinic_data_migration.execution_confirmed',
      });
    }

    const batchSize = Number(req.body?.batchSize) || run.batchSize;
    await prisma.migrationRun.update({ where: { id: run.id }, data: { batchSize } });

    const destinationCountBefore = await prisma.patient.count({
      where: {
        organizationId: run.organizationId,
        deletedAt: null,
        patientStatus: { not: 'archived' },
      },
    });

    const input = await buildExecuteInput({ ...run, batchSize }, actorId(req));

    // 202 + background execution. A 14,890-row import must never be a blocking
    // HTTP request: the client would time out, a proxy would drop it, and a
    // retry would try to execute a run that is already running.
    res.status(202).json({ run: { ...run, status: 'RUNNING', batchSize } });

    void executeMigrationRun(input)
      .then(() => finalizeRun(run.id, destinationCountBefore))
      .catch(() => undefined);
  } catch (error) {
    if (!res.headersSent) fail(res, error);
  }
});

router.get('/migrations/runs/:id/progress', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const run = await loadRunOrThrow(runIdParam(req));
    const batches = await prisma.migrationRunBatch.findMany({
      where: { runId: run.id },
      orderBy: { batchNumber: 'asc' },
    });
    res.json({
      status: run.status,
      currentBatch: run.currentBatch,
      totalBatches: run.totalBatches,
      totalSourceRows: run.totalSourceRows,
      processedRows: run.processedRows,
      createdRows: run.createdRows,
      matchedRows: run.matchedRows,
      skippedRows: run.skippedRows,
      failedRows: run.failedRows,
      warningRows: run.warningRows,
      blockedRows: run.blockedRows,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      elapsedMs: run.startedAt
        ? (run.completedAt ?? new Date()).getTime() - run.startedAt.getTime()
        : 0,
      lastErrorCode: run.lastErrorCode,
      lastErrorMessage: run.lastErrorMessage,
      cancelRequestedAt: run.cancelRequestedAt,
      batches,
    });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/migrations/runs/:id/cancel', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const run = await loadRunOrThrow(runIdParam(req));
    assertStatusIn(
      run.status as MigrationRunStatus,
      ['RUNNING', 'PARTIAL_FAILURE', 'READY', 'DRY_RUN_COMPLETE', 'BLOCKED'],
      'Cancelling',
    );

    // A cancel REQUEST, not an immediate stop. The executor observes it at the
    // next batch boundary; a batch already inside its transaction always
    // completes or rolls back as a unit. Batches that already committed stay
    // committed and remain reconciled — cancellation is not a rollback.
    const updated = await prisma.migrationRun.update({
      where: { id: run.id },
      data: { cancelRequestedAt: new Date(), cancelRequestedById: actorId(req) },
    });

    await auditMigrationAction({
      runId: run.id,
      organizationId: run.organizationId,
      clinicId: run.clinicId,
      actorPlatformAdminId: actorId(req),
      action: 'clinic_data_migration.cancel_requested',
      safeMetadata: { statusAtRequest: run.status, currentBatch: run.currentBatch },
    });

    res.json({ run: updated });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/migrations/runs/:id/retry-failed', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const run = await loadRunOrThrow(runIdParam(req));
    assertStatusIn(run.status as MigrationRunStatus, ['PARTIAL_FAILURE'], 'Retrying failed batches');

    const retried = await markFailedBatchesForRetry(run.id);
    if (retried === 0) {
      throw new MigrationError('BATCH_FAILED', {
        message: 'There are no failed batches to retry.',
      });
    }

    await auditMigrationAction({
      runId: run.id,
      organizationId: run.organizationId,
      clinicId: run.clinicId,
      actorPlatformAdminId: actorId(req),
      action: 'clinic_data_migration.batch_retry',
      safeMetadata: { retriedBatches: retried },
    });

    const destinationCountBefore = await prisma.patient.count({
      where: {
        organizationId: run.organizationId,
        deletedAt: null,
        patientStatus: { not: 'archived' },
      },
    });
    const input = await buildExecuteInput(run, actorId(req));

    res.status(202).json({ run: { ...run, status: 'RUNNING' }, retriedBatches: retried });

    void resumeMigrationRun(input)
      .then(() => finalizeRun(run.id, destinationCountBefore))
      .catch(() => undefined);
  } catch (error) {
    if (!res.headersSent) fail(res, error);
  }
});

router.post('/migrations/runs/:id/resume', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const run = await loadRunOrThrow(runIdParam(req));
    assertStatusIn(run.status as MigrationRunStatus, ['RUNNING', 'PARTIAL_FAILURE'], 'Resuming');

    await auditMigrationAction({
      runId: run.id,
      organizationId: run.organizationId,
      clinicId: run.clinicId,
      actorPlatformAdminId: actorId(req),
      action: 'clinic_data_migration.resume_requested',
      safeMetadata: { statusAtRequest: run.status, currentBatch: run.currentBatch },
    });

    const destinationCountBefore = await prisma.patient.count({
      where: {
        organizationId: run.organizationId,
        deletedAt: null,
        patientStatus: { not: 'archived' },
      },
    });
    const input = await buildExecuteInput(run, actorId(req));

    res.status(202).json({ run: { ...run, status: 'RUNNING' } });

    void resumeMigrationRun(input)
      .then(() => finalizeRun(run.id, destinationCountBefore))
      .catch(() => undefined);
  } catch (error) {
    if (!res.headersSent) fail(res, error);
  }
});

// ---------------------------------------------------------------------------
// Reports — Platform Admin authorization required, same as everything else
// ---------------------------------------------------------------------------
async function sendReport(
  req: PlatformAdminRequest,
  res: Response,
  kind: 'success' | 'failure',
): Promise<void> {
  const run = await loadRunOrThrow(runIdParam(req));
  const report =
    kind === 'success' ? await buildSuccessReport(run.id) : await buildFailureReport(run.id);

  await auditMigrationAction({
    runId: run.id,
    organizationId: run.organizationId,
    clinicId: run.clinicId,
    actorPlatformAdminId: actorId(req),
    action: `clinic_data_migration.report_downloaded`,
    safeMetadata: { kind, rowCount: report.rowCount },
  });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  // The filename is built from the run UUID we generated, never from the
  // operator's upload name — so Content-Disposition cannot be injected.
  res.setHeader('Content-Disposition', `attachment; filename="${report.filename}"`);
  res.send(report.buffer);
}

router.get(
  '/migrations/runs/:id/reports/success',
  async (req: PlatformAdminRequest, res: Response) => {
    try {
      await sendReport(req, res, 'success');
    } catch (error) {
      if (!res.headersSent) fail(res, error);
    }
  },
);

router.get(
  '/migrations/runs/:id/reports/failure',
  async (req: PlatformAdminRequest, res: Response) => {
    try {
      await sendReport(req, res, 'failure');
    } catch (error) {
      if (!res.headersSent) fail(res, error);
    }
  },
);

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------
router.get('/migrations/runs/:id/audit', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const run = await loadRunOrThrow(runIdParam(req));
    const events = await prisma.platformAdminAuditEvent.findMany({
      where: { resourceType: 'clinic_data_migration', resourceKey: run.id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { actorPlatformAdmin: { select: { id: true, email: true, name: true } } },
    });
    res.json({ events });
  } catch (error) {
    fail(res, error);
  }
});

export default router;
