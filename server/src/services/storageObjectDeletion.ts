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
 *   - `utils/auditLog.writeAuditLogInTx` as the durable evidence ledger,
 *   - `services/operationalEventService.recordOperationalEvent` as SECONDARY
 *     operator alerting only.
 *
 * THE DURABILITY INVARIANT (F4-3-R1)
 * ──────────────────────────────────
 * The first cut of this module used `writeAuditLog` and `recordOperationalEvent`
 * for its evidence. Both are documented fire-and-forget writers that SWALLOW
 * their own persistence errors, so this sequence was still reachable:
 *
 *     DB row deleted -> storage delete fails -> audit write fails (swallowed)
 *     -> operational event write fails (swallowed) -> caller sees `failed`
 *     -> object still exists, row is gone, nothing names the object
 *
 * — i.e. exactly the unreconcilable orphan this module claims to close, with a
 * result value that made it look tracked. One best-effort writer can never be
 * evidence that another best-effort writer succeeded.
 *
 * So once the caller has already deleted the persisted row, ONE of these must
 * hold when this function returns:
 *
 *   A. physical object deletion is terminally successful (`deleted` /
 *      `already_absent`) — nothing leaked, so nothing needs reconciling; or
 *   B. a durable, non-swallowing evidence record carrying the
 *      reconciliation-safe object reference has been COMMITTED.
 *
 * There is no third state. When neither holds, the outcome is reported as
 * `evidence_persistence_failed` — a value no existing caller can mistake for
 * the tracked `failed` — and the condition is escalated loudly.
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
import prisma from '../db.js';
import { deleteFile, fileExists, isSafeStorageKey } from './fileStorage.js';
import { writeAuditLogInTx, type AuditLogInput } from '../utils/auditLog.js';
import { recordOperationalEvent } from './operationalEventService.js';
import { safeErrorFields } from '../utils/safeError.js';

/**
 * `deleted`                  — the storage delete call completed without error.
 * `already_absent`           — the call failed but the object is provably gone;
 *                              treated as terminal success, never retried.
 * `failed`                   — the object may still exist, AND durable evidence
 *                              naming it was committed, so it is reconcilable.
 * `rejected_tenant_mismatch` — fail-closed: the persisted key does not belong
 *                              to the owning clinic. NOTHING is deleted, and
 *                              the refusal is durably evidenced.
 * `rejected_unsafe_key`      — fail-closed: the persisted key is empty or has a
 *                              form this contract refuses to act on. NOTHING is
 *                              deleted, and the refusal is durably evidenced.
 * `evidence_persistence_failed`
 *                            — the object was NOT terminally deleted AND the
 *                              durable evidence write did not commit. The
 *                              object may exist with nothing naming it. This is
 *                              the forbidden third state: it is surfaced under
 *                              its own value precisely so it can never be read
 *                              as one of the evidenced outcomes above. The
 *                              underlying storage-side truth stays available on
 *                              `storageOutcome`.
 */
export type StorageDeletionOutcome =
  | 'deleted'
  | 'already_absent'
  | 'failed'
  | 'rejected_tenant_mismatch'
  | 'rejected_unsafe_key'
  | 'evidence_persistence_failed';

/** Storage-side outcomes, i.e. everything except the evidence-layer verdict. */
export type StorageSideOutcome = Exclude<StorageDeletionOutcome, 'evidence_persistence_failed'>;

/** Whether the authoritative, non-swallowing evidence write committed. */
export type StorageDeletionEvidenceState = 'persisted' | 'persistence_failed';

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
  /**
   * The caller-facing verdict. Equals `storageOutcome`, EXCEPT when the
   * durability invariant was violated, in which case it is
   * `evidence_persistence_failed`.
   */
  outcome: StorageDeletionOutcome;
  /** What actually happened to the bytes — never masked by the evidence layer. */
  storageOutcome: StorageSideOutcome;
  /** Whether the authoritative evidence record committed. */
  evidence: StorageDeletionEvidenceState;
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
 * The F4-3-R1 invariant, as a predicate callers can branch on: the bytes are
 * provably gone (A), or a durable record naming the object was committed (B).
 *
 * A caller that has ALREADY deleted the persisted row must not report an
 * unqualified success when this is false — at that point the object may exist
 * with nothing in the system able to name it.
 */
export function isReconciliationSafe(result: StorageObjectDeletionResult): boolean {
  return isTerminalSuccess(result.storageOutcome) || result.evidence === 'persisted';
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
): Promise<{ outcome: StorageSideOutcome; failureCode?: string }> {
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
 * Commits the authoritative evidence record.
 *
 * Deliberately NOT `writeAuditLog`: that helper documents itself as
 * fire-and-forget and swallows its own failures, which is right for ordinary
 * events but cannot back a durability claim. `writeAuditLogInTx` is the
 * repository's existing non-swallowing audit writer (added for the security-
 * critical bulk-export events); its signature accepts any
 * `Pick<PrismaClient, 'auditLog'>`, so the global client satisfies it directly
 * and no transaction, table, migration or new subsystem is needed here — this
 * module has no other write to be atomic with.
 *
 * The throw is caught HERE rather than propagated so the failure can be
 * observed and reported, which is the opposite of swallowing it: the return
 * value decides whether the durability invariant held.
 */
async function persistDeletionEvidence(input: AuditLogInput): Promise<boolean> {
  try {
    await writeAuditLogInTx(prisma, input);
    return true;
  } catch (err) {
    console.error(
      '[storage-object-deletion] evidence persistence FAILED',
      safeErrorFields(err),
    );
    return false;
  }
}

/**
 * Deletes a tenant-owned storage object and writes durable evidence for the
 * attempt, whatever its outcome.
 *
 * Evidence is written on EVERY path (including the fail-closed rejections and
 * the plain success), so the audit trail answers "was this object's byte
 * removal actually carried out?" without inference. The audit record is the
 * AUTHORITATIVE one and is written through the non-swallowing writer; after the
 * owning row is gone it is the only artefact that still names the object, and
 * therefore the reconciliation input for a leaked object. The operational event
 * is SECONDARY alerting only and is never treated as evidence that the audit
 * record committed.
 *
 * Never throws — a caller's flow must not break because evidence could not be
 * written — but a violated durability invariant is reported as
 * `evidence_persistence_failed` and escalated, so silence is not one of the
 * possible results.
 */
export async function deleteStoredObjectWithEvidence(
  request: StorageObjectDeletionRequest,
): Promise<StorageObjectDeletionResult> {
  const requestedAt = request.requestedAt ?? new Date();
  const keyForm = classifyStorageKey(request.storageKey, request.clinicId);

  let storageOutcome: StorageSideOutcome;
  let failureCode: string | undefined;

  if (keyForm === 'unrecognized') {
    // Fail closed. An unverifiable object identity is never resolved by
    // deleting something — the deletion is refused and the refusal evidenced.
    const safeKey = typeof request.storageKey === 'string' ? request.storageKey : '';
    const looksTenantScoped = safeKey.length > 0 && isSafeStorageKey(safeKey);
    storageOutcome = looksTenantScoped ? 'rejected_tenant_mismatch' : 'rejected_unsafe_key';
    failureCode = looksTenantScoped ? 'STORAGE_KEY_TENANT_MISMATCH' : 'STORAGE_KEY_UNSAFE';
  } else {
    const executed = await executeDelete(request.storageKey, keyForm);
    storageOutcome = executed.outcome;
    failureCode = executed.failureCode;
  }

  const executedAt = new Date();
  const objectRef = describeObject(
    typeof request.storageKey === 'string' ? request.storageKey : '',
    keyForm,
  );

  const evidence: Record<string, unknown> = {
    ...objectRef,
    outcome: storageOutcome,
    source: request.source,
    requestedAt: requestedAt.toISOString(),
    executedAt: executedAt.toISOString(),
    ...(failureCode ? { failureCode } : {}),
  };

  const persisted = await persistDeletionEvidence({
    organizationId: request.organizationId,
    clinicId: request.clinicId,
    actorUserId: request.actorUserId ?? null,
    actorRole: request.actorRole ?? null,
    action: isTerminalSuccess(storageOutcome)
      ? 'storage_object_deleted'
      : 'storage_object_delete_failed',
    entityType: request.entityType,
    entityId: request.entityId,
    // Fixed text. Never the file name, the patient name or any row content —
    // entityType + entityId are sufficient references (docs/compliance/53 P1).
    description: `Physical storage object deletion: ${storageOutcome}`,
    metadata: evidence,
    ipAddress: request.ipAddress ?? null,
    userAgent: request.userAgent ?? null,
  });

  // A. bytes provably gone, or B. a durable record naming the object committed.
  const reconciliationSafe = isTerminalSuccess(storageOutcome) || persisted;
  const outcome: StorageDeletionOutcome = reconciliationSafe
    ? storageOutcome
    : 'evidence_persistence_failed';

  if (!isTerminalSuccess(storageOutcome)) {
    // Secondary alerting. Best-effort by contract, so it is attempted AFTER the
    // authoritative write and its result is never read back as proof of it.
    await recordOperationalEvent({
      organizationId: request.organizationId,
      clinicId: request.clinicId,
      severity: reconciliationSafe ? 'error' : 'critical',
      source: 'system',
      message: reconciliationSafe
        ? 'Storage object deletion did not complete — the object may still exist'
        : 'Storage object deletion did not complete AND its durable evidence record could not be written — the object may exist with no reference remaining',
      metadata: {
        entityType: request.entityType,
        entityId: request.entityId,
        ...evidence,
        evidencePersisted: persisted,
      },
    });
  }

  if (!reconciliationSafe) {
    // Last line of defence. Both DB writers are unavailable or failing, so the
    // process log is the only remaining place the object reference can land.
    // It carries the same reconciliation-safe reference as the audit record
    // (raw key only when the F4-1A contract proves it is opaque, digest
    // otherwise), so escalating never becomes a PHI leak.
    console.error(
      '[storage-object-deletion] UNEVIDENCED ORPHAN RISK — storage object may still exist with no durable reference',
      {
        entityType: request.entityType,
        entityId: request.entityId,
        clinicId: request.clinicId,
        ...evidence,
      },
    );
  }

  return {
    outcome,
    storageOutcome,
    evidence: persisted ? 'persisted' : 'persistence_failed',
    keyForm,
    requestedAt,
    executedAt,
    ...(failureCode ? { failureCode } : {}),
  };
}
