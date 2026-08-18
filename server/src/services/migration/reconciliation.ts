/**
 * reconciliation.ts — F3-DATA-MIG-TODAY-001
 *
 * Deterministic post-execution reconciliation.
 *
 * The point is not a progress bar. It is to answer, from the DATABASE rather
 * than from the executor's own memory, three questions an operator must be
 * able to answer before telling a customer the migration is done:
 *
 *   1. Does the arithmetic close?
 *        eligible = created + reused + skipped + failed + manualReview + blocked
 *      A run whose numbers do not add up has lost rows somewhere, and "roughly
 *      15,000 patients imported" is not an acceptable answer about a clinic's
 *      entire patient book.
 *
 *   2. Does every provenance record point at a row that actually exists, in
 *      the right tenant? A provenance row whose destination has vanished means
 *      the next run will not recognise that source record and WILL duplicate it.
 *
 *   3. Did anything land outside the target (organizationId, clinicId)? This
 *      is the tenant-isolation proof, measured rather than assumed.
 *
 * Everything here is recomputed by querying, deliberately NOT by trusting the
 * run's incrementing counters. Those counters are a fast projection for the
 * progress UI; if they ever disagree with the database, the database wins and
 * the report says so.
 */

import prisma from '../../db.js';
import { isReconciliationBalanced, type ReconciliationReport } from './contracts.js';

export interface ReconcileInput {
  runId: string;
  organizationId: string;
  clinicId: string;
  sourceSystem: string;
  /** Destination active-patient count sampled BEFORE execution started. */
  destinationCountBefore: number;
  /** Rows the dry run judged eligible to attempt. */
  eligibleTotal: number;
  sourceTotal: number;
}

/** Row statuses that count as "the migration produced a destination row". */
const CREATED_STATUSES = ['CREATED'];
const REUSED_STATUSES = ['MATCHED'];
const SKIPPED_STATUSES = ['SKIPPED'];
const FAILED_STATUSES = ['FAILED', 'INVALID'];
const MANUAL_STATUSES = ['MANUAL_REVIEW', 'AMBIGUOUS', 'DUPLICATE_SOURCE'];
const BLOCKED_STATUSES = ['BLOCKED', 'MAPPING_REQUIRED'];

export async function buildReconciliation(input: ReconcileInput): Promise<ReconciliationReport> {
  const { runId, organizationId, clinicId, sourceSystem } = input;

  // ---- counts straight from the row ledger --------------------------------
  const grouped = await prisma.migrationRowOutcome.groupBy({
    by: ['status'],
    where: { runId },
    _count: { _all: true },
  });
  const countByStatus = new Map(grouped.map((g) => [g.status, g._count._all]));
  const sum = (statuses: readonly string[]): number =>
    statuses.reduce((total, status) => total + (countByStatus.get(status) ?? 0), 0);

  const created = sum(CREATED_STATUSES);
  const reused = sum(REUSED_STATUSES);
  const skipped = sum(SKIPPED_STATUSES);
  const failed = sum(FAILED_STATUSES);
  const manualReview = sum(MANUAL_STATUSES);
  const blocked = sum(BLOCKED_STATUSES);
  const attemptedTotal = [...countByStatus.values()].reduce((a, b) => a + b, 0);

  // ---- batch totals -------------------------------------------------------
  const batchGrouped = await prisma.migrationRunBatch.groupBy({
    by: ['status'],
    where: { runId },
    _count: { _all: true },
  });
  const batchByStatus = new Map(batchGrouped.map((g) => [g.status, g._count._all]));
  const batchTotals = {
    total: [...batchByStatus.values()].reduce((a, b) => a + b, 0),
    succeeded: batchByStatus.get('SUCCEEDED') ?? 0,
    failed: batchByStatus.get('FAILED') ?? 0,
    pending: (batchByStatus.get('PENDING') ?? 0) + (batchByStatus.get('RUNNING') ?? 0),
    cancelled: batchByStatus.get('CANCELLED') ?? 0,
  };

  // ---- provenance and identity totals -------------------------------------
  const [provenanceRows, identityRows, destinationCountAfter] = await Promise.all([
    prisma.migrationRecord.count({
      where: { createdByRunId: runId, sourceEntity: 'patient' },
    }),
    prisma.patientIdentityDocument.count({
      where: {
        organizationId,
        patient: {
          // Only identity rows this run produced: those attached to patients
          // whose provenance record was created by this run.
          id: {
            in: (
              await prisma.migrationRecord.findMany({
                where: { createdByRunId: runId, sourceEntity: 'patient' },
                select: { destinationId: true },
              })
            ).map((r) => r.destinationId),
          },
        },
      },
    }),
    prisma.patient.count({
      where: { organizationId, deletedAt: null, patientStatus: { not: 'archived' } },
    }),
  ]);

  // ---- provenance resolution ----------------------------------------------
  // Every provenance destination must resolve to a live patient inside the
  // target clinic. Checked by counting the intersection rather than by
  // iterating, so it stays one query at 14,890 rows.
  const records = await prisma.migrationRecord.findMany({
    where: { createdByRunId: runId, sourceEntity: 'patient' },
    select: { destinationId: true },
  });
  const destinationIds = records.map((r) => r.destinationId);

  const resolvedInTargetClinic =
    destinationIds.length === 0
      ? 0
      : await prisma.patient.count({
          where: { id: { in: destinationIds }, organizationId, clinicId },
        });

  const provenanceResolves = resolvedInTargetClinic === destinationIds.length;

  // ---- tenant scope -------------------------------------------------------
  // Zero rows this run created may sit outside the target tenant. Counting the
  // complement is the honest test: it catches a row that landed in a sibling
  // clinic as well as one that lost its organization.
  const outsideScope =
    destinationIds.length === 0
      ? 0
      : await prisma.patient.count({
          where: {
            id: { in: destinationIds },
            NOT: { AND: [{ organizationId }, { clinicId }] },
          },
        });
  const tenantScopeClean = outsideScope === 0;

  // ---- the invariant ------------------------------------------------------
  const balanced = isReconciliationBalanced({
    eligibleTotal: input.eligibleTotal,
    created,
    reused,
    skipped,
    failed,
    manualReview,
    blocked,
  });

  const imbalanceDetail = balanced
    ? undefined
    : `eligible=${input.eligibleTotal} but created=${created} + reused=${reused} + skipped=${skipped} + failed=${failed} + manualReview=${manualReview} + blocked=${blocked} = ${
        created + reused + skipped + failed + manualReview + blocked
      }`;

  return {
    generatedAt: new Date().toISOString(),
    sourceTotal: input.sourceTotal,
    eligibleTotal: input.eligibleTotal,
    attemptedTotal,
    created,
    reused,
    manualReview,
    skipped,
    failed,
    blocked,
    destinationCountBefore: input.destinationCountBefore,
    destinationCountAfter,
    destinationCountDelta: destinationCountAfter - input.destinationCountBefore,
    provenanceRows,
    identityRows,
    batchTotals,
    provenanceResolves,
    tenantScopeClean,
    balanced,
    imbalanceDetail,
  };
}

/**
 * Provenance-scoped rollback plan.
 *
 * Returns WHAT WOULD BE DELETED without deleting anything. Rollback after
 * domain writes is never a blind delete:
 *   - only rows this run CREATED are candidates ('matched' rows pre-existed
 *     the migration and are never touched);
 *   - a candidate with dependent rows created since is downgraded to
 *     `archived` rather than deleted, because deleting it would take real
 *     clinical or financial history with it;
 *   - the scope is a single runId inside a single tenant, so unrelated tenant
 *     data is unreachable by construction.
 */
export async function planRollback(runId: string): Promise<{
  deletable: string[];
  archiveOnly: { patientId: string; reason: string }[];
  matchedNeverDeleted: number;
}> {
  const created = await prisma.migrationRecord.findMany({
    where: { createdByRunId: runId, sourceEntity: 'patient', outcome: 'created' },
    select: { destinationId: true },
  });
  const matchedNeverDeleted = await prisma.migrationRecord.count({
    where: { createdByRunId: runId, sourceEntity: 'patient', outcome: 'matched' },
  });

  const ids = created.map((r) => r.destinationId);
  if (ids.length === 0) return { deletable: [], archiveOnly: [], matchedNeverDeleted };

  const withDependents = await prisma.patient.findMany({
    where: {
      id: { in: ids },
      OR: [
        { appointments: { some: {} } },
        { payments: { some: {} } },
        { treatmentCases: { some: {} } },
        { sentMessages: { some: {} } },
        { communicationConsentEvents: { some: {} } },
        { toothRecords: { some: {} } },
        { attachments: { some: {} } },
      ],
    },
    select: { id: true },
  });

  const dependentIds = new Set(withDependents.map((p) => p.id));

  return {
    deletable: ids.filter((id) => !dependentIds.has(id)),
    archiveOnly: [...dependentIds].map((patientId) => ({
      patientId,
      reason:
        'Dependent clinical or financial rows were created after the migration; deleting the patient would take them with it. Archive instead.',
    })),
    matchedNeverDeleted,
  };
}
