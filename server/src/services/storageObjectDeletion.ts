/**
 * storageObjectDeletion.ts — F4-3: the single evidence-producing contract for
 * physically deleting a tenant-owned storage object.
 *
 * WHY THIS EXISTS (the gap it closes)
 * ───────────────────────────────────
 * Before F4-3 the repository had two very different standards for physical
 * object deletion:
 *
 *  - Operational export artifacts (`ClinicBulkExportArchive`, non-clinical
 *    ZIPs) were deleted through `attemptArtifactDeletion` in
 *    `privacy/clinicBulkExportPackage.ts`: idempotent ("already gone" counts
 *    as success), retried on a later sweep, and escalated to an incident when
 *    a single job kept failing.
 *  - The actual patient health-data files (`PatientAttachment`,
 *    `LabOrderAttachment`) were deleted with a bare
 *    `await deleteFile(row.filePath).catch(() => {})` AFTER their DB row had
 *    already been removed. A storage failure was therefore:
 *      * silent (lab orders swallowed it entirely; attachments only reached
 *        `console.error`),
 *      * unrecoverable — the deleted row was the ONLY place the storage key
 *        was persisted, so nothing in the system could ever name the leaked
 *        object again,
 *      * and reported to the caller as an unqualified success.
 *
 * That is exactly the state F4-3 forbids: "DB says deleted, physical object
 * still exists, and there is no durable retry/evidence." It is also a KVKK
 * problem in its own right — an erasure that cannot be evidenced cannot be
 * demonstrated, and an erasure that silently half-failed is worse than one
 * that reports failure.
 *
 * WHAT THIS MODULE DOES
 * ─────────────────────
 * It does NOT introduce a new queue, outbox, worker or audit system. It reuses
 * the accepted contracts already in the repository:
 *   - `fileStorage.deleteFile` / `fileExists` for the storage operation and the
 *     "already gone?" recheck (same semantics as `deleteStorageObjectIdempotent`),
 *   - `utils/auditLog.writeAuditLog` as the durable evidence ledger,
 *   - `services/operationalEventService.recordOperationalEvent` as the
 *     operator-visible failure signal that survives the DB row's deletion and
 *     makes the leaked object reconcilable.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * ────────────────────────────────
 *  - No automatic retry. A durable deletion-intent record would require a new
 *    table; F4-3 is not authorized to create a migration, so the retry input
 *    is the persisted evidence below and the retry itself is an operator
 *    action. This is recorded as an explicit schema gap, not papered over.
 *  - No provider object-lock / retention enforcement. That belongs to the
 *    future object-storage provider lane; nothing here may be read as evidence
 *    that provider-side immutability is active.
 *  - No retention-period or lifecycle policy. This module never decides
 *    WHETHER something may be deleted — the caller's own legal-hold/eligibility
 *    gate does. It only makes an already-authorized deletion safe, idempotent
 *    and evidenced.
 *  - It does not delete from backups. Removing a primary object says nothing
 *    about copies inside pgBackRest/pg_dump artifacts or file-backup runs; see
 *    docs/compliance/53-kvkk-attachment-imaging-lifecycle.md.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { deleteFile, fileExists, isSafeStorageKey } from './fileStorage.js';
import { writeAuditLog } from '../utils/auditLog.js';
import { recordOperationalEvent } from './operationalEventService.js';
import { safeErrorFields } from '../utils/safeError.js';

/**
 * `deleted`                  — the storage delete call completed without error.
 * `already_absent`           — the call failed but the object is provably gone;
 *                              treated as terminal success, never retried.
 * `failed`                   — the object may still exist. Durable evidence is
 *                              written so it can be reconciled later.
 * `rejected_tenant_mismatch` — fail-closed: the persisted key does not belong
 *                              to the owning clinic. NOTHING is deleted.
 * `rejected_unsafe_key`      — fail-closed: the persisted key is empty or has a
 *                              form this contract refuses to act on. NOTHING is
 *                              deleted.
 */
export type StorageDeletionOutcome =
  | 'deleted'
  | 'already_absent'
  | 'failed'
  | 'rejected_tenant_mismatch'
  | 'rejected_unsafe_key';

/**
 * `tenant_scoped`   — the F4-1A key contract: `<clinicId>/<opaqueId><ext>`.
 *                     Provably owned by the clinic and provably PHI-free, so
 *                     the raw key may be recorded in evidence.
 * `legacy_absolute` — a pre-key-contract absolute filesystem path still held by
 *                     an old row. Ownership cannot be proven from the key, and
 *                     such a path MAY embed the original file name, so the raw
 *                     value is never recorded — only a digest.
 */
export type StorageKeyForm = 'tenant_scoped' | 'legacy_absolute' | 'unrecognized';

/** Where the deletion came from — recorded so evidence is self-describing. */
export type StorageDeletionSource = 'record_delete' | 'upload_rollback';

export interface StorageObjectDeletionRequest {
  organizationId: string;
  /**
   * The owning clinic, taken from the tenant-scoped persisted record — never
   * from `req.user.clinicId`, a query parameter or a request body.
   */
  clinicId: string;
  /** Stable entity type code, e.g. `patient_attachment`. */
  entityType: string;
  /** Id of the record the object belonged to. */
  entityId: string;
  /**
   * The object key as persisted on the record (`filePath`). Callers must never
   * pass a key taken from the request — object identity comes from the
   * tenant-scoped row, which is also what authorized the deletion.
   */
  storageKey: string;
  source: StorageDeletionSource;
  actorUserId?: string | null;
  actorRole?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** When the deletion was requested; defaults to now. */
  requestedAt?: Date;
}

export interface StorageObjectDeletionResult {
  outcome: StorageDeletionOutcome;
  keyForm: StorageKeyForm;
  requestedAt: Date;
  executedAt: Date;
  /** Stable machine-readable reason, present only on a non-success outcome. */
  failureCode?: string;
}

/** A deletion outcome that needs no further reconciliation. */
export function isTerminalSuccess(outcome: StorageDeletionOutcome): boolean {
  return outcome === 'deleted' || outcome === 'already_absent';
}

/**
 * Classifies a persisted key against the clinic that owns the record.
 *
 * The tenant check is the point: `deleteFile()` will remove whatever key it is
 * handed, so a corrupted or mis-derived `filePath` on clinic A's row could
 * otherwise destroy clinic B's object. Under the F4-1A key contract every
 * primary-content key begins with the owning clinic's id, so a safe-form key
 * that does not is refused rather than executed.
 *
 * Legacy absolute paths predate that contract and carry no ownership evidence
 * in the key itself. They are allowed through — the row that named them was
 * still tenant-scoped, and refusing would block erasure for exactly the oldest
 * records, which is its own KVKK harm — but they are labelled so evidence
 * never overstates what was verified.
 */
export function classifyStorageKey(storageKey: unknown, clinicId: string): StorageKeyForm {
  if (typeof storageKey !== 'string' || storageKey.length === 0) return 'unrecognized';
  if (isSafeStorageKey(storageKey)) {
    return storageKey.startsWith(`${clinicId}/`) ? 'tenant_scoped' : 'unrecognized';
  }
  // Rejected by isSafeStorageKey. The only rejected form this contract still
  // acts on is a genuine legacy absolute path (posix or win32) with no
  // traversal segment — anything else (traversal, UNC, control characters) is
  // refused outright.
  if (storageKey.includes('..')) return 'unrecognized';
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(storageKey)) return 'unrecognized';
  // A UNC path names storage on ANOTHER host. No legacy row can legitimately
  // hold one, and acting on it would reach outside this server entirely, so it
  // is refused before the absolute-path branch below can accept it.
  if (/^[\\/]{2}/.test(storageKey)) return 'unrecognized';
  if (path.posix.isAbsolute(storageKey) || path.win32.isAbsolute(storageKey)) return 'legacy_absolute';
  return 'unrecognized';
}

/**
 * Object reference recorded in evidence.
 *
 * A `tenant_scoped` key is server-generated and opaque (`<clinicId>/<epochMs>-
 * <rand><ext>`) — the F4-1A contract keeps the uploaded file name out of it
 * entirely — so recording it verbatim is both safe and necessary for
 * reconciliation. A `legacy_absolute` path may embed the original file name,
 * which for a dental clinic routinely contains a patient's name, so only a
 * digest is recorded. F4-3 must not create a new PHI sink in order to prove a
 * deletion.
 */
function describeObject(storageKey: string, keyForm: StorageKeyForm): Record<string, unknown> {
  if (keyForm === 'tenant_scoped') return { storageKey, keyForm };
  return {
    keyForm,
    storageKeyDigest: createHash('sha256').update(storageKey).digest('hex'),
  };
}

/**
 * Performs the storage delete with the idempotency semantics already accepted
 * for export artifacts: a raised error is not automatically a failure — if the
 * object is provably gone, "already deleted" is a terminal success rather than
 * something to retry forever.
 *
 * The recheck is only authoritative for a `tenant_scoped` key: `fileExists()`
 * runs its argument through `isSafeStorageKey()` and returns `false` for a
 * legacy absolute path, so using it there would convert "the delete failed"
 * into a fabricated "already gone". That case fails closed to `failed`.
 */
async function executeDelete(
  storageKey: string,
  keyForm: StorageKeyForm,
): Promise<{ outcome: StorageDeletionOutcome; failureCode?: string }> {
  try {
    await deleteFile(storageKey);
    return { outcome: 'deleted' };
  } catch (err) {
    if (keyForm === 'tenant_scoped') {
      try {
        if (!(await fileExists(storageKey))) return { outcome: 'already_absent' };
      } catch {
        // The existence check itself failed — fall through to `failed` so this
        // stays reconcilable, rather than being silently called a success.
        return { outcome: 'failed', failureCode: 'STORAGE_DELETE_UNVERIFIABLE' };
      }
      return { outcome: 'failed', failureCode: 'STORAGE_DELETE_FAILED' };
    }
    // Legacy absolute path: absence cannot be verified through the safe-key
    // gate, so the outcome is never upgraded to `already_absent`.
    console.error('[storage-object-deletion] legacy-path delete failed', safeErrorFields(err));
    return { outcome: 'failed', failureCode: 'STORAGE_DELETE_UNVERIFIABLE' };
  }
}

/**
 * Deletes a tenant-owned storage object and writes durable evidence for the
 * attempt, whatever its outcome.
 *
 * Evidence is written on EVERY path (including the fail-closed rejections and
 * the plain success), so the audit trail answers "was this object's byte
 * removal actually carried out?" without inference. On a non-terminal outcome
 * an `error`-severity operational event is recorded as well: it is the only
 * artefact that still names the object after the owning row is gone, and it is
 * therefore the reconciliation input for a leaked object.
 *
 * Never throws — a caller's flow must not break because evidence could not be
 * written — but the outcome is always returned so the caller can report it
 * instead of claiming an unqualified success.
 */
export async function deleteStoredObjectWithEvidence(
  request: StorageObjectDeletionRequest,
): Promise<StorageObjectDeletionResult> {
  const requestedAt = request.requestedAt ?? new Date();
  const keyForm = classifyStorageKey(request.storageKey, request.clinicId);

  let outcome: StorageDeletionOutcome;
  let failureCode: string | undefined;

  if (keyForm === 'unrecognized') {
    // Fail closed. An unverifiable object identity is never resolved by
    // deleting something — the deletion is refused and the refusal evidenced.
    const safeKey = typeof request.storageKey === 'string' ? request.storageKey : '';
    const looksTenantScoped = safeKey.length > 0 && isSafeStorageKey(safeKey);
    outcome = looksTenantScoped ? 'rejected_tenant_mismatch' : 'rejected_unsafe_key';
    failureCode = looksTenantScoped ? 'STORAGE_KEY_TENANT_MISMATCH' : 'STORAGE_KEY_UNSAFE';
  } else {
    const executed = await executeDelete(request.storageKey, keyForm);
    outcome = executed.outcome;
    failureCode = executed.failureCode;
  }

  const executedAt = new Date();
  const objectRef = describeObject(
    typeof request.storageKey === 'string' ? request.storageKey : '',
    keyForm,
  );

  const evidence: Record<string, unknown> = {
    ...objectRef,
    outcome,
    source: request.source,
    requestedAt: requestedAt.toISOString(),
    executedAt: executedAt.toISOString(),
    ...(failureCode ? { failureCode } : {}),
  };

  await writeAuditLog({
    organizationId: request.organizationId,
    clinicId: request.clinicId,
    actorUserId: request.actorUserId ?? null,
    actorRole: request.actorRole ?? null,
    action: isTerminalSuccess(outcome) ? 'storage_object_deleted' : 'storage_object_delete_failed',
    entityType: request.entityType,
    entityId: request.entityId,
    // Fixed text. Never the file name, the patient name or any row content —
    // entityType + entityId are sufficient references (docs/compliance/53 P1).
    description: `Physical storage object deletion: ${outcome}`,
    metadata: evidence,
    ipAddress: request.ipAddress ?? null,
    userAgent: request.userAgent ?? null,
  });

  if (!isTerminalSuccess(outcome)) {
    await recordOperationalEvent({
      organizationId: request.organizationId,
      clinicId: request.clinicId,
      severity: 'error',
      source: 'system',
      message: 'Storage object deletion did not complete — the object may still exist',
      metadata: { entityType: request.entityType, entityId: request.entityId, ...evidence },
    });
  }

  return { outcome, keyForm, requestedAt, executedAt, ...(failureCode ? { failureCode } : {}) };
}
