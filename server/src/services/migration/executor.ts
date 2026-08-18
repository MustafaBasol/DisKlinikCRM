/**
 * executor.ts — F3-DATA-MIG-TODAY-001
 *
 * Batch execution of a migration run.
 *
 * THE FIVE PROPERTIES THIS FILE EXISTS TO GUARANTEE
 *
 *  1. NO GIANT TRANSACTION. 14,890 rows are executed in bounded batches, each
 *     in its own transaction. A failure in batch N leaves batches 1..N-1
 *     committed. Wrapping the whole import in one transaction would mean a
 *     single bad row at row 14,000 discards fourteen thousand successful
 *     inserts, hold locks for minutes, and risk the transaction being killed
 *     by an idle timeout with nothing to show for it.
 *
 *  2. IDEMPOTENCY THROUGH PROVENANCE, NOT THROUGH GUESSING. Whether a row has
 *     already been imported is decided by MigrationRecord's tenant-scoped
 *     unique key (organizationId, sourceSystem, sourceEntity, sourceId) — the
 *     vendor's own primary key. Never by phone, e-mail or name: those are
 *     empirically disproven for this dataset (28.6 % shared phones, 25.7 %
 *     colliding names) and using them would merge unrelated family members.
 *     The insert races against a concurrent run through the unique index, and
 *     a P2002 is treated as "somebody else created it" — a MATCH, not a
 *     failure.
 *
 *  3. RESUMABLE. All progress is durable: batch rows carry their own status
 *     and counters, and row outcomes are written per row. A restarted process
 *     resumes at the first non-succeeded batch and re-does nothing that
 *     committed.
 *
 *  4. CANCELLABLE BETWEEN BATCHES, NEVER MID-TRANSACTION. A cancel request is
 *     observed at a batch boundary. A batch already inside its transaction
 *     always finishes or rolls back as a unit — tearing a transaction in half
 *     to honour a click would be worse than waiting for one batch.
 *
 *  5. NO HISTORICAL SIDE EFFECTS. The whole execution runs inside
 *     `runWithMigrationSuppression`, so any outbound-effect guard anywhere in
 *     the call tree suppresses and counts instead of sending. Today's patient
 *     writes have no such effects; the context is what makes that still true
 *     when the clinical datasets arrive.
 *
 * PRIVACY: nothing in this file logs a source value. Row outcomes carry codes,
 * ids and counts. The identity value is passed to the encryptor and is never
 * placed on an outcome, a log line or an audit payload.
 */

import type { Prisma } from '@prisma/client';
import prisma from '../../db.js';
import { logger } from '../../utils/logger.js';
import {
  MigrationError,
  isRetryableCode,
  type MigrationErrorCode,
  type RowStatus,
} from './contracts.js';
import {
  encryptIdentityValue,
  PATIENT_IDENTITY_CRYPTO_VERSION,
} from '../../utils/patientIdentityCrypto.js';
import { classifyIdentities, type IdentityDecision } from './identity/identityClassifier.js';
import { buildRow, compileMapping, type BuiltRow, type CompiledMapping } from './rowBuilder.js';
import type { ResolvedMapping } from './rowBuilder.js';
import type { CanonicalWorkbook } from './contracts.js';
import {
  acquireExecutionLock,
  heartbeatExecutionLock,
  isCancelRequested,
  releaseExecutionLock,
  safeLogContext,
  type AcquiredLock,
} from './migrationRunService.js';
import {
  getSuppressionCounts,
  runWithMigrationSuppression,
} from './executionContext.js';

export interface ExecuteInput {
  runId: string;
  organizationId: string;
  clinicId: string;
  sourceSystem: string;
  batchSize: number;
  workbook: CanonicalWorkbook;
  mappings: ResolvedMapping[];
  /** Approved source practitioner value -> User.id. */
  practitionerMap: ReadonlyMap<string, string | null>;
  actorPlatformAdminId: string | null;
}

export interface ExecuteResult {
  status: 'COMPLETED' | 'PARTIAL_FAILURE' | 'CANCELLED' | 'FAILED';
  processedRows: number;
  createdRows: number;
  matchedRows: number;
  failedRows: number;
  skippedRows: number;
  warningRows: number;
  suppressedEffects: Record<string, number>;
}

interface RowOutcomeDraft {
  runId: string;
  sourceRowNumber: number;
  batchNumber: number;
  sourceId: string | null;
  status: RowStatus;
  resultCode: string | null;
  errorMessage: string | null;
  fieldName: string | null;
  retryable: boolean;
  destinationPatientId: string | null;
  identityClassification: string | null;
  identityWritten: boolean;
  warnings: Prisma.InputJsonValue;
}

/**
 * Acquire the lock, then execute. The lock acquisition is the ONLY
 * concurrency gate — a second caller cannot get past it, so a double-clicked
 * Execute button or two API processes cannot both run this.
 */
export async function executeMigrationRun(input: ExecuteInput): Promise<ExecuteResult> {
  const lock = await acquireExecutionLock(input.runId, ['READY', 'PARTIAL_FAILURE']);
  return runExecution(input, lock);
}

/**
 * Resume a run whose executor died (process restart, deploy, crash).
 *
 * Distinct from `executeMigrationRun` because it may reclaim a STALE lock, and
 * reclaiming is only ever safe as an explicit operator decision: an automatic
 * reclaim of a lock still held by a live executor would put two executors on
 * one run.
 */
export async function resumeMigrationRun(input: ExecuteInput): Promise<ExecuteResult> {
  const lock = await acquireExecutionLock(input.runId, ['RUNNING', 'PARTIAL_FAILURE'], {
    allowStaleReclaim: true,
  });
  return runExecution(input, lock);
}

async function runExecution(input: ExecuteInput, lock: AcquiredLock): Promise<ExecuteResult> {
  const { runId, organizationId, clinicId } = input;
  const logCtx = { id: runId, organizationId, clinicId };

  return runWithMigrationSuppression({ migrationRunId: runId, organizationId, clinicId }, async () => {
    try {
      return await executeBatches(input, lock);
    } catch (error) {
      const code: MigrationErrorCode =
        error instanceof MigrationError ? error.code : 'INTERNAL_ERROR';
      // Safe fields only — never the exception message, which can echo row data
      // back from the driver.
      logger.error(
        safeLogContext(logCtx, { status: 'FAILED', errorCode: code }),
        '[migration] run failed',
      );
      await releaseExecutionLock(lock, 'FAILED', {
        completedAt: new Date(),
        lastErrorCode: code,
        lastErrorMessage:
          error instanceof MigrationError
            ? error.message
            : 'The migration stopped because of an unexpected server error. No further rows were attempted.',
      });
      return {
        status: 'FAILED',
        processedRows: 0,
        createdRows: 0,
        matchedRows: 0,
        failedRows: 0,
        skippedRows: 0,
        warningRows: 0,
        suppressedEffects: getSuppressionCounts(),
      };
    }
  });
}

async function executeBatches(input: ExecuteInput, lock: AcquiredLock): Promise<ExecuteResult> {
  const { runId, organizationId, clinicId, sourceSystem, workbook, mappings } = input;
  const logCtx = { id: runId, organizationId, clinicId };

  const compiled = compileMapping(mappings);
  const batchSize = clampBatchSize(input.batchSize);

  // Build every row once. Deterministic ordering by source row number is what
  // makes a batch's row range meaningful across a resume.
  const built = workbook.rows.map((row) => buildRow(row, compiled, workbook.headers));

  // Identity classification is a whole-file decision (source duplicates can
  // only be seen across the whole file), so it happens once, before batching.
  const identityByRow = await classifyForExecution(compiled, built, organizationId);

  const totalBatches = Math.max(1, Math.ceil(built.length / batchSize));
  await ensureBatchRows(runId, built, batchSize, totalBatches);

  const totals = {
    processedRows: 0,
    createdRows: 0,
    matchedRows: 0,
    failedRows: 0,
    skippedRows: 0,
    warningRows: 0,
  };
  let anyBatchFailed = false;
  let cancelled = false;

  // Only batches not already SUCCEEDED are attempted — this is the resume and
  // the retry path, and it is why a rerun does no work twice.
  const pending = await prisma.migrationRunBatch.findMany({
    where: { runId, status: { in: ['PENDING', 'RUNNING', 'FAILED'] } },
    orderBy: { batchNumber: 'asc' },
    select: { batchNumber: true, rowStart: true, rowEnd: true, retryCount: true, status: true },
  });

  for (const batch of pending) {
    // Cancellation is observed HERE — at a batch boundary, never inside one.
    if (await isCancelRequested(runId)) {
      cancelled = true;
      break;
    }

    // If we lost the lock (a stale reclaim by another process), stop at once
    // rather than continue writing alongside a second executor.
    if (!(await heartbeatExecutionLock(lock))) {
      throw new MigrationError('EXECUTION_ALREADY_RUNNING', {
        message: 'Another process took over this migration run. This executor stopped.',
      });
    }

    const rows = built.filter(
      (row) => row.rowNumber >= batch.rowStart && row.rowNumber <= batch.rowEnd,
    );

    const result = await executeOneBatch({
      runId,
      organizationId,
      clinicId,
      sourceSystem,
      batchNumber: batch.batchNumber,
      rows,
      identityByRow,
      practitionerMap: input.practitionerMap,
      isRetry: batch.status === 'FAILED',
      previousRetryCount: batch.retryCount,
    });

    totals.processedRows += result.processedRows;
    totals.createdRows += result.createdRows;
    totals.matchedRows += result.matchedRows;
    totals.failedRows += result.failedRows;
    totals.skippedRows += result.skippedRows;
    totals.warningRows += result.warningRows;
    if (result.failed) anyBatchFailed = true;

    await prisma.migrationRun.update({
      where: { id: runId },
      data: {
        currentBatch: batch.batchNumber,
        processedRows: { increment: result.processedRows },
        createdRows: { increment: result.createdRows },
        matchedRows: { increment: result.matchedRows },
        failedRows: { increment: result.failedRows },
        skippedRows: { increment: result.skippedRows },
        warningRows: { increment: result.warningRows },
      },
    });

    logger.info(
      safeLogContext(logCtx, {
        batchNumber: batch.batchNumber,
        status: result.failed ? 'FAILED' : 'SUCCEEDED',
        processedRows: result.processedRows,
        createdRows: result.createdRows,
        matchedRows: result.matchedRows,
        failedRows: result.failedRows,
        durationMs: result.durationMs,
      }),
      '[migration] batch complete',
    );
  }

  const finalStatus: ExecuteResult['status'] = cancelled
    ? 'CANCELLED'
    : anyBatchFailed
      ? 'PARTIAL_FAILURE'
      : 'COMPLETED';

  await releaseExecutionLock(lock, finalStatus, {
    completedAt: cancelled || finalStatus === 'COMPLETED' ? new Date() : null,
    cancelledAt: cancelled ? new Date() : null,
    totalBatches,
  });

  return { ...totals, status: finalStatus, suppressedEffects: getSuppressionCounts() };
}

function clampBatchSize(requested: number): number {
  if (!Number.isFinite(requested)) return 500;
  return Math.min(2000, Math.max(50, Math.floor(requested)));
}

/**
 * Create the batch rows once, idempotently. `skipDuplicates` means a resume
 * re-entering this function does not disturb existing batch state.
 */
async function ensureBatchRows(
  runId: string,
  built: BuiltRow[],
  batchSize: number,
  totalBatches: number,
): Promise<void> {
  const existing = await prisma.migrationRunBatch.count({ where: { runId } });
  if (existing > 0) return;

  const data: Prisma.MigrationRunBatchCreateManyInput[] = [];
  for (let index = 0; index < totalBatches; index++) {
    const slice = built.slice(index * batchSize, (index + 1) * batchSize);
    if (slice.length === 0) continue;
    data.push({
      runId,
      batchNumber: index + 1,
      rowStart: slice[0]!.rowNumber,
      rowEnd: slice[slice.length - 1]!.rowNumber,
      status: 'PENDING',
    });
  }

  await prisma.$transaction([
    prisma.migrationRunBatch.createMany({ data, skipDuplicates: true }),
    prisma.migrationRun.update({ where: { id: runId }, data: { totalBatches } }),
  ]);
}

async function classifyForExecution(
  compiled: CompiledMapping,
  built: BuiltRow[],
  organizationId: string,
): Promise<Map<number, IdentityDecision>> {
  if (!compiled.hasIdentity) return new Map();

  const existingDocs = await prisma.patientIdentityDocument.findMany({
    where: { organizationId, docType: 'TCKN' },
    select: { lookupHash: true, patientId: true },
  });

  const decisions = classifyIdentities(
    built.map((row) => ({ rowNumber: row.rowNumber, rawValue: row.identityRawValue })),
    {
      organizationId,
      docType: 'TCKN',
      existingLookupHashes: new Map(existingDocs.map((d) => [d.lookupHash, d.patientId])),
    },
  );

  return new Map(decisions.map((d) => [d.rowNumber, d]));
}

interface BatchInput {
  runId: string;
  organizationId: string;
  clinicId: string;
  sourceSystem: string;
  batchNumber: number;
  rows: BuiltRow[];
  identityByRow: Map<number, IdentityDecision>;
  practitionerMap: ReadonlyMap<string, string | null>;
  isRetry: boolean;
  previousRetryCount: number;
}

interface BatchResult {
  failed: boolean;
  processedRows: number;
  createdRows: number;
  matchedRows: number;
  failedRows: number;
  skippedRows: number;
  warningRows: number;
  durationMs: number;
}

/**
 * Execute one batch inside ONE transaction.
 *
 * Row-level data problems do not abort the batch — they produce a FAILED row
 * outcome and the batch continues. Only an infrastructure failure aborts, and
 * then the whole batch rolls back and is retryable as a unit. That split is
 * what keeps "one malformed row" from costing 499 good ones, while still
 * making a database outage leave no half-written batch.
 */
async function executeOneBatch(input: BatchInput): Promise<BatchResult> {
  const startedAt = Date.now();
  const {
    runId,
    organizationId,
    clinicId,
    sourceSystem,
    batchNumber,
    rows,
    identityByRow,
    practitionerMap,
  } = input;

  await prisma.migrationRunBatch.updateMany({
    where: { runId, batchNumber },
    data: {
      status: 'RUNNING',
      startedAt: new Date(),
      retryCount: input.isRetry ? input.previousRetryCount + 1 : input.previousRetryCount,
      errorCode: null,
      errorSummary: null,
    },
  });

  const counters = {
    processedRows: 0,
    createdRows: 0,
    matchedRows: 0,
    failedRows: 0,
    skippedRows: 0,
    warningRows: 0,
  };

  try {
    await prisma.$transaction(
      async (tx) => {
        // Existing provenance for exactly this batch's source ids — one indexed
        // query per batch rather than one per row.
        const sourceIds = rows.map((row) => row.sourceId).filter((id): id is string => Boolean(id));
        const existing = await tx.migrationRecord.findMany({
          where: { organizationId, sourceSystem, sourceEntity: 'patient', sourceId: { in: sourceIds } },
          select: { sourceId: true, destinationId: true },
        });
        const existingBySourceId = new Map(existing.map((r) => [r.sourceId, r.destinationId]));

        const outcomes: RowOutcomeDraft[] = [];

        for (const row of rows) {
          counters.processedRows++;
          const identity = identityByRow.get(row.rowNumber);
          const identityClassification = identity?.classification ?? 'ABSENT';
          const warnings = row.warnings;
          if (warnings.length > 0) counters.warningRows++;

          // -- row could not be built --
          if (row.failures.length > 0 || !row.draft || !row.sourceId) {
            const failure = row.failures[0];
            counters.failedRows++;
            outcomes.push({
              runId,
              sourceRowNumber: row.rowNumber,
              batchNumber,
              sourceId: row.sourceId,
              status: 'INVALID',
              resultCode: failure?.code ?? 'ROW_REQUIRED_FIELD_MISSING',
              errorMessage: failure?.message ?? 'The row could not be built from the mapped columns.',
              fieldName: failure?.fieldName ?? null,
              retryable: false,
              destinationPatientId: null,
              identityClassification,
              identityWritten: false,
              warnings,
            });
            continue;
          }

          // -- IDEMPOTENCY: already imported? --
          const alreadyImported = existingBySourceId.get(row.sourceId);
          if (alreadyImported) {
            counters.matchedRows++;
            await tx.migrationRecord.updateMany({
              where: { organizationId, sourceSystem, sourceEntity: 'patient', sourceId: row.sourceId },
              data: { lastSeenRunId: runId, lastSeenAt: new Date() },
            });
            outcomes.push({
              runId,
              sourceRowNumber: row.rowNumber,
              batchNumber,
              sourceId: row.sourceId,
              status: 'MATCHED',
              resultCode: null,
              errorMessage: null,
              fieldName: null,
              retryable: false,
              destinationPatientId: alreadyImported,
              identityClassification,
              identityWritten: false,
              warnings,
            });
            continue;
          }

          // -- practitioner reference --
          let primaryPractitionerId: string | null = null;
          if (row.practitionerSourceValue) {
            const resolved = practitionerMap.get(row.practitionerSourceValue);
            if (resolved === undefined) {
              counters.failedRows++;
              outcomes.push({
                runId,
                sourceRowNumber: row.rowNumber,
                batchNumber,
                sourceId: row.sourceId,
                status: 'BLOCKED',
                resultCode: 'REFERENCE_UNRESOLVED',
                errorMessage:
                  'The source practitioner for this row is not mapped to an existing NoraMedi user.',
                fieldName: 'patient.primaryPractitionerId',
                retryable: false,
                destinationPatientId: null,
                identityClassification,
                identityWritten: false,
                warnings,
              });
              continue;
            }
            primaryPractitionerId = resolved;
          }

          // -- create the patient --
          const patient = await tx.patient.create({
            data: {
              organizationId,
              clinicId,
              firstName: row.draft.firstName,
              lastName: row.draft.lastName,
              email: row.draft.email,
              phone: row.draft.phone,
              dateOfBirth: row.draft.dateOfBirth,
              address: row.draft.address,
              city: row.draft.city,
              country: row.draft.country,
              patientStatus: row.draft.patientStatus,
              gender: row.draft.gender,
              chartNumber: row.draft.chartNumber,
              primaryPractitionerId,
              // Deliberately NOT set, each for a recorded reason:
              //   notes            — special-category legal gate unresolved
              //   postalCode       — ADRES_KODU semantics unresolved
              //   source           — enum-constrained; free-text referrer would
              //                      pollute a typed marketing enum
              //   createdAt        — means "row created in NoraMedi"
              //   communicationConsent / marketingConsent / smsOptOut
              //                    — consent is never invented
              //   primaryClinicId  — no runtime path sets it; leaving it unset
              //                      keeps the organization dashboard's counts
              //                      behaving exactly as they do today
            },
            select: { id: true },
          });

          // -- provenance, in the SAME transaction as the patient --
          // If this insert fails, the patient insert rolls back with it. A
          // patient without provenance would be invisible to the next run and
          // would be duplicated by it.
          await tx.migrationRecord.create({
            data: {
              organizationId,
              clinicId,
              sourceSystem,
              sourceEntity: 'patient',
              sourceId: row.sourceId,
              destinationId: patient.id,
              outcome: 'created',
              createdByRunId: runId,
              lastSeenRunId: runId,
            },
          });

          // -- encrypted identity, only for a VALID classification --
          let identityWritten = false;
          if (identity && identity.classification === 'VALID' && identity.normalized && identity.lookupHash) {
            const { valueEncrypted, cryptoVersion } = encryptIdentityValue(identity.normalized);
            await tx.patientIdentityDocument.create({
              data: {
                patientId: patient.id,
                clinicId,
                organizationId,
                docType: 'TCKN',
                valueEncrypted,
                lookupHash: identity.lookupHash,
                cryptoVersion: cryptoVersion ?? PATIENT_IDENTITY_CRYPTO_VERSION,
                isVerified: true,
              },
            });
            identityWritten = true;
          }

          counters.createdRows++;
          outcomes.push({
            runId,
            sourceRowNumber: row.rowNumber,
            batchNumber,
            sourceId: row.sourceId,
            status: 'CREATED',
            resultCode: null,
            errorMessage: null,
            fieldName: null,
            retryable: false,
            destinationPatientId: patient.id,
            identityClassification,
            identityWritten,
            warnings,
          });
        }

        // Row outcomes are written in the same transaction, so a rolled-back
        // batch leaves no outcome claiming success.
        if (outcomes.length > 0) {
          await tx.migrationRowOutcome.createMany({ data: outcomes, skipDuplicates: true });
        }

        await tx.migrationRunBatch.updateMany({
          where: { runId, batchNumber },
          data: {
            status: 'SUCCEEDED',
            completedAt: new Date(),
            processedRows: counters.processedRows,
            createdRows: counters.createdRows,
            matchedRows: counters.matchedRows,
            failedRows: counters.failedRows,
            skippedRows: counters.skippedRows,
            warningRows: counters.warningRows,
          },
        });
      },
      { timeout: 120_000, maxWait: 15_000 },
    );

    return { ...counters, failed: false, durationMs: Date.now() - startedAt };
  } catch (error) {
    // Infrastructure failure: the whole batch rolled back. Record it as
    // retryable and let the run continue to the next batch, so one transient
    // database error does not abandon the remaining work.
    const code: MigrationErrorCode =
      error instanceof MigrationError ? error.code : 'DATABASE_ERROR';

    await prisma.migrationRunBatch.updateMany({
      where: { runId, batchNumber },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errorCode: code,
        // Never the raw driver message: it can echo row values back.
        errorSummary:
          'The batch was rolled back because of a database or server error. No rows from this batch were written. It can be retried.',
      },
    });

    return {
      failed: true,
      processedRows: 0,
      createdRows: 0,
      matchedRows: 0,
      failedRows: counters.processedRows,
      skippedRows: 0,
      warningRows: 0,
      durationMs: Date.now() - startedAt,
    };
  }
}

/** Mark failed batches for another attempt. The retry is a normal resume. */
export async function markFailedBatchesForRetry(runId: string): Promise<number> {
  const result = await prisma.migrationRunBatch.updateMany({
    where: { runId, status: 'FAILED' },
    data: { status: 'PENDING', errorCode: null, errorSummary: null },
  });
  return result.count;
}

export { isRetryableCode };
