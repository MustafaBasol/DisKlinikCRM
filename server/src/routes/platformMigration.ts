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
  type DryRunSummary,
  type MigrationRunStatus,
} from '../services/migration/contracts.js';
import { assertStatusIn } from '../services/migration/runState.js';
import {
  auditMigrationAction,
  loadRunOrThrow,
  resolveAndVerifyTarget,
  transitionRun,
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
import { validateMappings } from '../services/migration/mapping/validateMapping.js';
import { normalizeHeader } from '../services/migration/mapping/normalizeHeader.js';
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

    await prisma.$transaction(async (tx) => {
      await tx.migrationFieldMapping.deleteMany({ where: { runId: run.id } });
      await tx.migrationFieldMapping.createMany({
        data: suggestions.map((s) => ({
          runId: run.id,
          sourceField: s.sourceField,
          sourceIndex: s.sourceIndex,
          sourceNormalized: s.sourceNormalized || normalizeHeader(s.sourceField),
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
    });

    const unresolved = suggestions.filter(
      (s) => s.mappingState === 'MANUAL_REQUIRED' || s.mappingState === 'AUTO_REVIEW',
    ).length;

    const updated = await transitionRun(
      run.id,
      run.status as MigrationRunStatus,
      unresolved > 0 ? 'MAPPING_REQUIRED' : 'MAPPING_READY',
      {
        actorPlatformAdminId: actorId(req),
        action: 'clinic_data_migration.analyzed',
        data: {
          sheetName: workbook.metadata.sheets[workbook.metadata.selectedSheetIndex]?.name ?? null,
          sheetIndex: workbook.metadata.selectedSheetIndex,
          totalSourceRows: workbook.rows.length,
          headerColumnCount: workbook.headers.length,
          analysisWarnings: workbook.metadata.warnings as never,
          analyzedAt: new Date(),
        },
        safeMetadata: {
          totalSourceRows: workbook.rows.length,
          headerColumnCount: workbook.headers.length,
          unresolvedMappings: unresolved,
          parseMs: workbook.metadata.parseMs,
        },
      },
    );

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
      },
    });
  } catch (error) {
    fail(res, error);
  }
});

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------
async function loadMappingState(runId: string) {
  const [mappings, run] = await Promise.all([
    prisma.migrationFieldMapping.findMany({
      where: { runId },
      orderBy: { sourceIndex: 'asc' },
    }),
    prisma.migrationRun.findUnique({ where: { id: runId }, select: { headerColumnCount: true } }),
  ]);
  const headers = mappings.map((m) => ({
    original: m.sourceField,
    normalized: m.sourceNormalized,
    index: m.sourceIndex,
  }));
  return { mappings, headers, headerColumnCount: run?.headerColumnCount ?? headers.length };
}

router.get('/migrations/runs/:id/mappings', async (req: PlatformAdminRequest, res: Response) => {
  try {
    await loadRunOrThrow(runIdParam(req));
    const { mappings, headers } = await loadMappingState(runIdParam(req));
    res.json({
      mappings,
      destinations: DESTINATION_FIELDS,
      validation: validateMappings(mappings, headers),
    });
  } catch (error) {
    fail(res, error);
  }
});

router.put('/migrations/runs/:id/mappings', async (req: PlatformAdminRequest, res: Response) => {
  try {
    const run = await loadRunOrThrow(runIdParam(req));
    assertStatusIn(
      run.status as MigrationRunStatus,
      ['ANALYZED', 'MAPPING_REQUIRED', 'MAPPING_READY', 'DRY_RUN_COMPLETE', 'BLOCKED', 'READY'],
      'Editing the field mapping',
    );

    const incoming = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
    if (incoming.length === 0) {
      throw new MigrationError('MAPPING_INVALID', { message: 'No mapping changes were supplied.' });
    }

    await prisma.$transaction(
      incoming.map((entry: Record<string, unknown>) =>
        prisma.migrationFieldMapping.updateMany({
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
            decidedByPlatformAdminId: actorId(req),
            decidedAt: new Date(),
          },
        }),
      ),
    );

    const { mappings, headers } = await loadMappingState(run.id);
    const validation = validateMappings(mappings, headers);

    const nextStatus: MigrationRunStatus = validation.valid ? 'MAPPING_READY' : 'MAPPING_REQUIRED';
    const updated = await transitionRun(run.id, run.status as MigrationRunStatus, nextStatus, {
      actorPlatformAdminId: actorId(req),
      action: 'clinic_data_migration.mapping_saved',
      // Counts only. Never the destinations chosen for named source columns —
      // those are safe, but the count is what an auditor needs.
      safeMetadata: {
        changed: incoming.length,
        mapped: validation.mappedCount,
        unresolved: validation.unresolvedCount,
        blocked: validation.blockedCount,
        legalBlocked: validation.legalBlockedCount,
        ignored: validation.ignoredCount,
        valid: validation.valid,
      },
    });

    res.json({ run: updated, mappings, validation });
  } catch (error) {
    fail(res, error);
  }
});

router.post(
  '/migrations/runs/:id/mappings/accept-auto',
  async (req: PlatformAdminRequest, res: Response) => {
    try {
      const run = await loadRunOrThrow(runIdParam(req));
      assertStatusIn(
        run.status as MigrationRunStatus,
        ['ANALYZED', 'MAPPING_REQUIRED', 'MAPPING_READY'],
        'Accepting automatic mappings',
      );

      // Only AUTO_REVIEW is promoted. AUTO_CONFIDENT is already decided;
      // MANUAL_REQUIRED has no suggestion to accept; BLOCKED and LEGAL_BLOCKED
      // are deliberate refusals and a bulk action must never lift them.
      const accepted = await prisma.migrationFieldMapping.updateMany({
        where: { runId: run.id, state: 'AUTO_REVIEW', destinationField: { not: null } },
        data: { state: 'RESOLVED', decidedByPlatformAdminId: actorId(req), decidedAt: new Date() },
      });

      const { mappings, headers } = await loadMappingState(run.id);
      const validation = validateMappings(mappings, headers);
      const updated = await transitionRun(
        run.id,
        run.status as MigrationRunStatus,
        validation.valid ? 'MAPPING_READY' : 'MAPPING_REQUIRED',
        {
          actorPlatformAdminId: actorId(req),
          action: 'clinic_data_migration.mapping_auto_accepted',
          safeMetadata: { accepted: accepted.count, valid: validation.valid },
        },
      );

      res.json({ run: updated, mappings, validation, accepted: accepted.count });
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
      const { mappings, headers } = await loadMappingState(runIdParam(req));
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

    const [existing, candidates] = await Promise.all([
      prisma.migrationReferenceMap.findMany({
        where: {
          organizationId: run.organizationId,
          sourceSystem: run.sourceSystem,
          entityType: 'practitioner',
        },
      }),
      prisma.user.findMany({
        where: { organizationId: run.organizationId, isActive: true },
        select: { id: true, firstName: true, lastName: true, role: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
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
        const user = await prisma.user.findFirst({
          where: { id: destinationId, organizationId: run.organizationId },
          select: { id: true },
        });
        if (!user) {
          throw new MigrationError('REFERENCE_UNRESOLVED', {
            message: 'The selected user does not exist in this organization.',
          });
        }
      }

      await prisma.migrationReferenceMap.upsert({
        where: {
          organizationId_sourceSystem_entityType_sourceValue: {
            organizationId: run.organizationId,
            sourceSystem: run.sourceSystem,
            entityType: 'practitioner',
            sourceValue,
          },
        },
        create: {
          organizationId: run.organizationId,
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

    const { mappings, headers } = await loadMappingState(run.id);
    const validation = validateMappings(mappings, headers);

    const referenceRecords = await prisma.migrationReferenceMap.findMany({
      where: {
        organizationId: run.organizationId,
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
async function buildExecuteInput(run: {
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
