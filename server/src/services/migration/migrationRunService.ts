/**
 * migrationRunService.ts — F3-DATA-MIG-TODAY-001
 *
 * Run lifecycle, tenant addressing, concurrency control and audit.
 *
 * Three things in here are security-load-bearing rather than plumbing:
 *
 *  1. TENANT ADDRESSING IS NEVER INFERRED FROM DATA. The destination
 *     organization and clinic come from the Platform Admin's explicit request
 *     and are re-verified on the server on every call. The workbook carries a
 *     branch id column (SUBE_ID) — it is deliberately ignored. A source file
 *     must never be able to nominate the tenant it lands in, and Prisma does
 *     NOT enforce Clinic.organizationId === Patient.organizationId (two
 *     independent FKs, no composite key), so a structurally valid but
 *     tenant-incoherent patient IS creatable if nobody checks. We check.
 *
 *  2. THE EXECUTION LOCK IS A CONDITIONAL UPDATE, not a boolean read followed
 *     by a write. `UPDATE ... WHERE id = ? AND status = ? AND lock IS NULL`
 *     is atomic in Postgres, so two concurrent execute requests — a
 *     double-clicked button, two browser tabs, or two API processes behind the
 *     load balancer — cannot both acquire it. A read-then-write would have a
 *     window between them and would eventually double-import a clinic.
 *
 *  3. AUDIT IS FAIL-CLOSED WHERE IT MATTERS. State-changing actions write
 *     their audit row inside the same transaction as the change
 *     (writePlatformAdminAuditEventInTx), so an audit failure rolls the change
 *     back rather than leaving an unaudited mutation.
 *
 * PRIVACY: every audit payload here carries ids, counts, statuses and codes.
 * Never a filename the operator typed, never a cell value.
 */

import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '../../db.js';
import { writePlatformAdminAuditEventInTx } from '../platformAdminAudit.js';
import {
  MigrationError,
  EXECUTION_LOCK_STALE_MS,
  type MigrationRunStatus,
  type SafeMigrationLogContext,
} from './contracts.js';
import { assertTransition } from './runState.js';

/** Audit resource type for every event this feature writes. */
export const MIGRATION_AUDIT_RESOURCE = 'clinic_data_migration';

export interface MigrationTarget {
  organizationId: string;
  clinicId: string;
  organizationName: string;
  clinicName: string;
}

/**
 * Resolve and VERIFY the destination tenant.
 *
 * Both ids are validated independently and then the containment relationship
 * between them is re-checked. Returning a distinct error for each case is safe
 * here — the caller is an authenticated Platform Admin whose whole job is
 * addressing tenants, so there is no enumeration boundary to protect (unlike
 * the clinic-facing routes, which deliberately return one indistinct
 * "Access denied to requested clinic").
 */
export async function resolveAndVerifyTarget(
  organizationId: string,
  clinicId: string,
): Promise<MigrationTarget> {
  if (!organizationId || typeof organizationId !== 'string') {
    throw new MigrationError('ORGANIZATION_NOT_FOUND', {
      message: 'An organization must be selected before a migration run can be created.',
    });
  }
  if (!clinicId || typeof clinicId !== 'string') {
    throw new MigrationError('CLINIC_NOT_FOUND', {
      message: 'A clinic must be selected before a migration run can be created.',
    });
  }

  const [organization, clinic] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    }),
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { id: true, name: true, organizationId: true },
    }),
  ]);

  if (!organization) {
    throw new MigrationError('ORGANIZATION_NOT_FOUND', {
      message: 'The selected organization does not exist.',
    });
  }
  if (!clinic) {
    throw new MigrationError('CLINIC_NOT_FOUND', {
      message: 'The selected clinic does not exist.',
    });
  }

  // The containment check Prisma cannot make for us.
  if (clinic.organizationId !== organization.id) {
    throw new MigrationError('ORG_CLINIC_MISMATCH', {
      message: 'The selected clinic does not belong to the selected organization.',
      detail: 'clinic.organizationId !== organizationId',
    });
  }

  return {
    organizationId: organization.id,
    clinicId: clinic.id,
    organizationName: organization.name,
    clinicName: clinic.name,
  };
}

/**
 * Load a run, or throw RUN_NOT_FOUND.
 *
 * `RUN_NOT_FOUND` rather than a 403 is deliberate for the cross-tenant case
 * too: a Platform Admin is global, so there is no tenant boundary between
 * admins to leak across. What this DOES protect is the report/download
 * endpoints, which must never serve a run id that does not exist rather than
 * erroring in a way that reveals whether it does.
 */
export async function loadRunOrThrow(runId: string) {
  if (!isUuid(runId)) {
    throw new MigrationError('RUN_NOT_FOUND', { message: 'Migration run not found.' });
  }
  const run = await prisma.migrationRun.findUnique({ where: { id: runId } });
  if (!run) {
    throw new MigrationError('RUN_NOT_FOUND', { message: 'Migration run not found.' });
  }
  return run;
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

export interface TransitionOptions {
  actorPlatformAdminId: string | null;
  action: string;
  /**
   * Scalar column writes to apply along with the status change.
   *
   * Deliberately the `UpdateMany` input type, not `UpdateInput`: the status
   * change is a conditional UPDATE (see below), which cannot carry nested
   * relation writes. Typing it this way makes that a compile error rather than
   * a runtime surprise for a future caller.
   */
  data?: Prisma.MigrationRunUncheckedUpdateManyInput;
  safeMetadata?: Record<string, unknown>;
  outcome?: string;
}

/**
 * One state-machine step, executed inside a transaction the CALLER owns.
 *
 * Exported because some operator actions are a single logical step that the
 * state machine expresses as more than one edge — analyze is
 * UPLOADED -> ANALYZED -> MAPPING_*, and a mapping edit after a dry run is
 * DRY_RUN_COMPLETE -> MAPPING_REQUIRED -> MAPPING_READY. Those callers must be
 * able to take every edge, PLUS the row writes that belong with them, in ONE
 * transaction, so a failure half-way cannot leave the run advertising a stage
 * it never reached — or leave edited rows behind a status that never moved.
 *
 * This is NOT a way around the state machine: every hop still goes through
 * assertTransition and still writes its own audit row, so a multi-hop action
 * is auditable as the sequence it actually performed.
 */
export async function transitionRunInTx(
  tx: Prisma.TransactionClient,
  runId: string,
  from: MigrationRunStatus,
  to: MigrationRunStatus,
  options: TransitionOptions,
) {
  assertTransition(from, to);

  /*
   * THE STATUS CHANGE IS A CONDITIONAL UPDATE, not a read followed by a write.
   *
   * `UPDATE ... WHERE id = ? AND status = ?` is one atomic statement in
   * Postgres, exactly like the execution lock above. A read-then-update-by-id
   * would have a window: the caller's transaction runs at READ COMMITTED, so a
   * concurrent transition that COMMITS after our read but before our write is
   * invisible to the read and then silently overwritten by the write — a lost
   * update that moves the run out of a status somebody else had already left.
   * With the status in the WHERE clause the write simply matches no row, we
   * throw, and the caller's whole transaction — mapping edits included — rolls
   * back.
   */
  const changed = await tx.migrationRun.updateMany({
    where: { id: runId, status: from },
    data: { ...(options.data ?? {}), status: to },
  });

  if (changed.count !== 1) {
    // Diagnose only AFTER the atomic attempt failed, never as a pre-check.
    // A zero-row UPDATE does not abort the transaction, so this read is safe.
    const current = await tx.migrationRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    if (!current) {
      throw new MigrationError('RUN_NOT_FOUND', { message: 'Migration run not found.' });
    }
    throw new MigrationError('MIGRATION_STATE_INVALID', {
      message: `The run changed status while this request was in flight (expected ${from}, found ${current.status}). Reload and try again.`,
    });
  }

  const updated = await tx.migrationRun.findUniqueOrThrow({ where: { id: runId } });

  await writePlatformAdminAuditEventInTx(tx, {
    actorPlatformAdminId: options.actorPlatformAdminId,
    action: options.action,
    resourceType: MIGRATION_AUDIT_RESOURCE,
    resourceKey: runId,
    previousValue: from,
    newValue: to,
    outcome: options.outcome ?? 'success',
    safeMetadata: {
      organizationId: updated.organizationId,
      clinicId: updated.clinicId,
      ...(options.safeMetadata ?? {}),
    },
  });

  return updated;
}

/**
 * Move a run to a new status, enforcing the state machine and writing the
 * audit row in the SAME transaction as the status change.
 */
export async function transitionRun(
  runId: string,
  from: MigrationRunStatus,
  to: MigrationRunStatus,
  options: TransitionOptions,
) {
  return prisma.$transaction((tx) => transitionRunInTx(tx, runId, from, to, options));
}

/**
 * Audit an action that does not itself change the run status (a mapping save,
 * a report download). Still transactional, still fail-closed.
 */
export async function auditMigrationAction(options: {
  runId: string;
  organizationId: string;
  clinicId: string;
  actorPlatformAdminId: string | null;
  action: string;
  outcome?: string;
  safeMetadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.$transaction((tx) =>
    writePlatformAdminAuditEventInTx(tx, {
      actorPlatformAdminId: options.actorPlatformAdminId,
      action: options.action,
      resourceType: MIGRATION_AUDIT_RESOURCE,
      resourceKey: options.runId,
      outcome: options.outcome ?? 'success',
      safeMetadata: {
        organizationId: options.organizationId,
        clinicId: options.clinicId,
        ...(options.safeMetadata ?? {}),
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Execution lock
// ---------------------------------------------------------------------------

export interface AcquiredLock {
  runId: string;
  token: string;
}

/**
 * Atomically claim the right to execute a run.
 *
 * The whole guarantee lives in the WHERE clause. Postgres evaluates the
 * predicate and applies the update as one atomic statement, so of two
 * concurrent callers exactly one gets `count === 1` and the other gets 0.
 *
 * A lock whose heartbeat is older than EXECUTION_LOCK_STALE_MS is reclaimable,
 * which is what makes resume possible after a process restart — but reclaiming
 * is only ever reached through an EXPLICIT operator resume action, never
 * automatically, because an automatic reclaim of a lock held by a still-alive
 * executor would run two executors over one run.
 */
export async function acquireExecutionLock(
  runId: string,
  fromStatuses: readonly MigrationRunStatus[],
  options: { allowStaleReclaim?: boolean } = {},
): Promise<AcquiredLock> {
  const token = randomUUID();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - EXECUTION_LOCK_STALE_MS);

  const lockPredicate: Prisma.MigrationRunWhereInput = options.allowStaleReclaim
    ? {
        OR: [
          { executionLockToken: null },
          { executionHeartbeatAt: null },
          { executionHeartbeatAt: { lt: staleBefore } },
        ],
      }
    : { executionLockToken: null };

  const result = await prisma.migrationRun.updateMany({
    where: {
      id: runId,
      status: { in: [...fromStatuses] },
      ...lockPredicate,
    },
    data: {
      status: 'RUNNING',
      executionLockToken: token,
      executionLockedAt: now,
      executionHeartbeatAt: now,
      startedAt: now,
      cancelRequestedAt: null,
      cancelRequestedById: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });

  if (result.count !== 1) {
    // Distinguish "already running" from "wrong status" for a useful message,
    // but only AFTER the atomic attempt failed — never as a pre-check.
    const run = await prisma.migrationRun.findUnique({
      where: { id: runId },
      select: { status: true, executionLockToken: true, executionHeartbeatAt: true },
    });
    if (!run) {
      throw new MigrationError('RUN_NOT_FOUND', { message: 'Migration run not found.' });
    }
    if (run.executionLockToken) {
      throw new MigrationError('EXECUTION_ALREADY_RUNNING', {
        message:
          'This migration run is already being executed. Wait for it to finish, or use Resume if the executing process has stopped.',
        detail: `heartbeatAt=${run.executionHeartbeatAt?.toISOString() ?? 'null'}`,
      });
    }
    throw new MigrationError('MIGRATION_STATE_INVALID', {
      message: `Execution is not available while the run is in status ${run.status}.`,
      detail: `required=${fromStatuses.join(',')}`,
    });
  }

  return { runId, token };
}

/**
 * Refresh the heartbeat, and report whether we still hold the lock.
 *
 * Returning false means somebody else took it (only possible via a stale
 * reclaim), and the executor must stop immediately rather than keep writing.
 */
export async function heartbeatExecutionLock(lock: AcquiredLock): Promise<boolean> {
  const result = await prisma.migrationRun.updateMany({
    where: { id: lock.runId, executionLockToken: lock.token },
    data: { executionHeartbeatAt: new Date() },
  });
  return result.count === 1;
}

/** Release the lock, but only if we still hold it. */
export async function releaseExecutionLock(
  lock: AcquiredLock,
  finalStatus: MigrationRunStatus,
  data: Prisma.MigrationRunUncheckedUpdateManyInput = {},
): Promise<boolean> {
  const result = await prisma.migrationRun.updateMany({
    where: { id: lock.runId, executionLockToken: lock.token },
    data: {
      ...data,
      status: finalStatus,
      executionLockToken: null,
      executionLockedAt: null,
      executionHeartbeatAt: null,
    },
  });
  return result.count === 1;
}

/** Has a cancel been requested since we last looked? Checked between batches. */
export async function isCancelRequested(runId: string): Promise<boolean> {
  const run = await prisma.migrationRun.findUnique({
    where: { id: runId },
    select: { cancelRequestedAt: true },
  });
  return Boolean(run?.cancelRequestedAt);
}

// ---------------------------------------------------------------------------
// Safe logging
// ---------------------------------------------------------------------------

/**
 * Build the ONLY object shape migration code may hand to a logger.
 *
 * Structurally incapable of carrying a name, phone, e-mail, address, note or
 * identity value: every field is an id, a count, a status or a code. Passing
 * anything else is a type error rather than a review finding.
 */
export function safeLogContext(
  run: { id: string; organizationId: string; clinicId: string },
  extra: Omit<SafeMigrationLogContext, 'migrationRunId' | 'organizationId' | 'clinicId'> = {},
): SafeMigrationLogContext {
  return {
    migrationRunId: run.id,
    organizationId: run.organizationId,
    clinicId: run.clinicId,
    ...extra,
  };
}
