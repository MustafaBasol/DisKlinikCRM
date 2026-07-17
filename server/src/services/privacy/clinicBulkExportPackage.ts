/**
 * clinicBulkExportPackage.ts — KVKK-HIGH-004 secure clinic bulk/structured-
 * data export lifecycle (docs/compliance/54-kvkk-secure-clinic-bulk-export.md).
 *
 * Mirrors services/privacy/patientPrivacyExportPackage.ts's lifecycle
 * (advisory-lock-guarded reservation, lease/heartbeat, streaming ZIP,
 * one-time hashed download token) at clinic scope instead of per-patient
 * scope, with three deliberate hardenings beyond that template:
 *
 *  1. Exactly one queued/generating export per clinic is enforced twice:
 *     the advisory-lock reservation transaction below, AND a hand-written
 *     partial unique index in the DB (see prisma/migrations/
 *     20260716120000_add_clinic_bulk_export/migration.sql) as the final,
 *     database-level invariant.
 *  2. Expiry is a real stored terminal status ("expired"), never derived ad
 *     hoc from expiresAt in some places and stored in others.
 *     expireArchiveIfPastTtl() is the SINGLE function every route and the
 *     cleanup cron calls — the security decision never depends on whether
 *     the 15-minute cleanup cron has run yet.
 *  3. Storage-object deletion is a separate, retryable step from the
 *     ready->expired status flip (a Postgres transaction cannot span an
 *     S3/local filesystem delete) — see artifactDeletedAt/cleanupFailureCode
 *     on the model and attemptArtifactDeletion() below.
 *
 * Generation is asynchronous (queued -> a worker claims it into generating,
 * see jobs/clinicBulkExportWorker.ts) — never inline in the HTTP request —
 * and streams a ZIP of manifest.json + clinic.json + one *.ndjson file per
 * entity straight to a temp file via cursor-paginated batches, never
 * accumulating a whole table or the whole archive in memory.
 */

import crypto, { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../../db.js';
import {
  buildExportStorageKey,
  saveFileFromPath,
  deleteFile,
  fileExists,
  ensureExportTempDir,
  buildExportTempFilePath,
  getExportTempDir,
  parseExportTempFileName,
} from '../fileStorage.js';
import { safeErrorFields } from '../../utils/safeError.js';
import { writeAuditLogInTx, writeAuditLog, extractRequestMeta } from '../../utils/auditLog.js';
import { isClinicBulkExportEnabledForOrganization } from './clinicBulkExportConfig.js';
import {
  CLINIC_SELECT,
  USER_SELECT,
  PATIENT_SELECT,
  APPOINTMENT_SELECT,
  TREATMENT_CASE_SELECT,
  PAYMENT_SELECT,
  TASK_SELECT,
  SENT_MESSAGE_SELECT,
  ACTIVITY_LOG_SELECT,
  INSURANCE_PROVISION_SELECT,
  INVENTORY_ITEM_SELECT,
} from './clinicBulkExportFieldAllowlists.js';

// ── Constants ────────────────────────────────────────────────────────────

export const EXPORT_SCHEMA_VERSION = 1;

/** Ready-artifact TTL, configurable, default ~1 hour. */
export function getDownloadTokenTtlMs(): number {
  const raw = Number(process.env.CLINIC_BULK_EXPORT_TOKEN_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60 * 60 * 1000;
}

/**
 * Queued-backlog deadline — deliberately SEPARATE from, and substantially
 * longer than, the generating lease below. A queued row's `leaseExpiresAt`
 * is set once, at creation, to `createdAt + this value`, and is never
 * renewed while it sits in the queue (nothing is "heartbeating" a row no
 * worker has claimed yet). Normal backlog under bounded worker concurrency
 * must not be mistaken for an abandoned job merely because it waited a few
 * cron ticks — that would previously have shared the much shorter
 * generating lease and could spuriously fail a perfectly healthy queue.
 */
export function getQueueTimeoutMs(): number {
  const raw = Number(process.env.CLINIC_BULK_EXPORT_QUEUE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60 * 60 * 1000; // 1 hour default queued deadline
}

/**
 * Generating-lease duration. Claiming a queued row (claimQueuedClinicBulkExportJobs)
 * REPLACES its queue-timeout deadline with `now + this value`, and the
 * heartbeat/per-batch renewal keep sliding it forward while generation is
 * actually in flight. Only a worker that stops renewing (crash, lost lease)
 * lets this expire.
 */
export function getGenerationLeaseMs(): number {
  const raw = Number(process.env.CLINIC_BULK_EXPORT_GENERATION_LEASE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60 * 1000; // 10 minutes without a renewal = abandoned
}

/** Background heartbeat tick interval during generation — see startClinicBulkExportLeaseHeartbeat(). */
export function getHeartbeatIntervalMs(): number {
  const raw = Number(process.env.CLINIC_BULK_EXPORT_HEARTBEAT_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60 * 1000; // 1 minute, well under the generation lease
}

/** Step-up remains reusable (no re-prompt) for this long after verification. */
export { STEP_UP_WINDOW_MS } from '../../utils/passwordStepUp.js';

export function getCreationCooldownMs(): number {
  const raw = Number(process.env.CLINIC_BULK_EXPORT_CREATION_COOLDOWN_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60 * 1000; // 10 minutes per user+clinic
}

export function getDailyCreationCap(): number {
  const raw = Number(process.env.CLINIC_BULK_EXPORT_DAILY_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3; // per clinic per calendar day (UTC)
}

export function getMaxRecords(): number {
  const raw = Number(process.env.CLINIC_BULK_EXPORT_MAX_RECORDS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 500_000;
}

export function getMaxBytes(): number {
  const raw = Number(process.env.CLINIC_BULK_EXPORT_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 2 * 1024 * 1024 * 1024; // 2 GB
}

const BATCH_SIZE = 500;

// ── Errors ───────────────────────────────────────────────────────────────

export class ClinicBulkExportAlreadyRunningError extends Error {
  constructor() {
    super('A clinic bulk export is already queued or generating for this clinic.');
    this.name = 'ClinicBulkExportAlreadyRunningError';
  }
}

export class ClinicBulkExportRateLimitedError extends Error {
  readonly reason: 'cooldown' | 'daily_cap';
  constructor(reason: 'cooldown' | 'daily_cap') {
    super(`Clinic bulk export creation rate limited (${reason}).`);
    this.name = 'ClinicBulkExportRateLimitedError';
    this.reason = reason;
  }
}

export class ClinicBulkExportSizeLimitExceededError extends Error {
  constructor() {
    super('Clinic bulk export exceeded the configured record/byte ceiling.');
    this.name = 'ClinicBulkExportSizeLimitExceededError';
  }
}

export class ClinicBulkExportLeaseLostError extends Error {
  constructor() {
    super('Clinic bulk export worker lease was lost or could not be renewed mid-generation.');
    this.name = 'ClinicBulkExportLeaseLostError';
  }
}

/**
 * Thrown by assertClinicBulkExportGenerationAllowed() whenever the global
 * kill switch or the organization rollout allowlist turns this job off
 * mid-flight (KVKK-HIGH-004 remediation: the flag must be a genuine
 * generation kill switch, not just a creation gate). Deliberately funnels
 * through generateClinicBulkExport's ordinary catch block — the SAME
 * temp-file/artifact cleanup and 'failed' transition every other mid-
 * generation failure gets, just with a distinct, stable failureCode.
 */
export class ClinicBulkExportFeatureDisabledError extends Error {
  constructor() {
    super('Clinic bulk export generation stopped: the feature was disabled for this organization mid-flight.');
    this.name = 'ClinicBulkExportFeatureDisabledError';
  }
}

/**
 * Thrown by validateZipStructuralIntegrity() when the just-finalized temp
 * ZIP's own central directory cannot be located/parsed, or its entry set
 * does not exactly match what generateClinicBulkExport actually wrote —
 * catches a truncated/corrupted write the write-stream's 'close' event alone
 * would not detect (KVKK-HIGH-004 remediation).
 */
export class ClinicBulkExportZipIntegrityError extends Error {
  constructor() {
    super('Clinic bulk export ZIP failed post-finalize structural integrity validation.');
    this.name = 'ClinicBulkExportZipIntegrityError';
  }
}

// ── Advisory lock key derivation ────────────────────────────────────────

/** Exported for unit testing. */
export function computeExportSlotLockKey(clinicId: string): [number, number] {
  const hash = createHash('sha256').update(`clinic-bulk-export-slot:${clinicId}`, 'utf8').digest();
  return [hash.readInt32BE(0), hash.readInt32BE(4)];
}

// ── Reservation (creation) ──────────────────────────────────────────────

export interface ReserveClinicBulkExportArgs {
  clinicId: string;
  organizationId: string;
  requestedByUserId: string;
  purpose: string;
  restrictedNote: string | null;
  stepUpVerifiedAt: Date;
  actorRole: string;
  req: { ip?: string; headers: Record<string, unknown> };
  now?: Date;
  client?: Pick<PrismaClient, '$transaction'>;
}

/**
 * Reserves a new export job atomically: advisory lock -> sweep stale
 * queued/generating rows past their lease -> cooldown/daily-cap check
 * (Postgres-authoritative, from ClinicBulkExportArchive history, inside the
 * SAME transaction) -> active-row check -> create. The archive-row create
 * and its "export_requested" audit event happen in the same transaction
 * (fail-closed: if the audit insert throws, the row is never created and
 * the API never reports success).
 *
 * The DB's partial unique index (ClinicBulkExportArchive_one_active_per_clinic)
 * is the final backstop if this transaction's own active-row check is ever
 * bypassed or racing another writer outside this code path — a P2002 from
 * the create is mapped back to ClinicBulkExportAlreadyRunningError.
 */
export async function reserveClinicBulkExport(args: ReserveClinicBulkExportArgs): Promise<{ jobId: string }> {
  const now = args.now ?? new Date();
  const client = args.client ?? prisma;
  const jobId = crypto.randomUUID();
  const cooldownMs = getCreationCooldownMs();
  const dailyCap = getDailyCreationCap();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  try {
    await client.$transaction(async (tx: Prisma.TransactionClient) => {
      const [key1, key2] = computeExportSlotLockKey(args.clinicId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key1}::int4, ${key2}::int4)`;

      await tx.clinicBulkExportArchive.updateMany({
        where: {
          clinicId: args.clinicId,
          status: { in: ['queued', 'generating'] },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
        },
        data: { status: 'failed', failureCode: 'LEASE_EXPIRED' },
      });

      const recentByUser = await tx.clinicBulkExportArchive.count({
        where: {
          clinicId: args.clinicId,
          requestedByUserId: args.requestedByUserId,
          createdAt: { gte: new Date(now.getTime() - cooldownMs) },
        },
      });
      if (recentByUser > 0) throw new ClinicBulkExportRateLimitedError('cooldown');

      const todayCount = await tx.clinicBulkExportArchive.count({
        where: { clinicId: args.clinicId, createdAt: { gte: dayStart } },
      });
      if (todayCount >= dailyCap) throw new ClinicBulkExportRateLimitedError('daily_cap');

      const active = await tx.clinicBulkExportArchive.findFirst({
        where: { clinicId: args.clinicId, status: { in: ['queued', 'generating'] } },
        select: { id: true },
      });
      if (active) throw new ClinicBulkExportAlreadyRunningError();

      await tx.clinicBulkExportArchive.create({
        data: {
          id: jobId,
          organizationId: args.organizationId,
          clinicId: args.clinicId,
          requestedByUserId: args.requestedByUserId,
          status: 'queued',
          purpose: args.purpose,
          restrictedNote: args.restrictedNote,
          exportSchemaVersion: EXPORT_SCHEMA_VERSION,
          stepUpVerifiedAt: args.stepUpVerifiedAt,
          // Creation itself required the requester's own current password
          // (see routes/clinicBulkExport.ts POST /), so the requester is by
          // construction the step-up verifier for the fresh window this row
          // starts with.
          stepUpVerifiedByUserId: args.requestedByUserId,
          heartbeatAt: now,
          // Queued deadline, NOT the (much shorter) generating lease — see
          // getQueueTimeoutMs(). claimQueuedClinicBulkExportJobs() replaces
          // this with the generating lease the moment a worker claims it.
          leaseExpiresAt: new Date(now.getTime() + getQueueTimeoutMs()),
        },
      });

      await writeAuditLogInTx(tx, {
        organizationId: args.organizationId,
        clinicId: args.clinicId,
        actorUserId: args.requestedByUserId,
        actorRole: args.actorRole,
        action: 'clinic_bulk_export_requested',
        entityType: 'clinic',
        entityId: args.clinicId,
        description: 'Clinic bulk structured-data export requested',
        metadata: { jobId, purpose: args.purpose, schemaVersion: EXPORT_SCHEMA_VERSION },
        ...extractRequestMeta(args.req),
      });
    });
  } catch (err: any) {
    if (err?.code === 'P2002') throw new ClinicBulkExportAlreadyRunningError();
    throw err;
  }

  void recordExportRequestedAlert({ organizationId: args.organizationId, clinicId: args.clinicId, jobId, purpose: args.purpose });

  return { jobId };
}

/** Atomic (upsert-on-unique-dedupeKey) duplicate-suppressed operational alert. */
async function recordExportRequestedAlert(args: {
  organizationId: string;
  clinicId: string;
  jobId: string;
  purpose: string;
}): Promise<void> {
  const dedupeKey = `clinic-bulk-export:${args.jobId}:export_requested`;
  try {
    await prisma.operationalEvent.upsert({
      where: { dedupeKey },
      create: {
        organizationId: args.organizationId,
        clinicId: args.clinicId,
        severity: 'critical',
        source: 'system',
        message: 'Clinic bulk structured-data export requested',
        metadata: { jobId: args.jobId, purpose: args.purpose },
        dedupeKey,
      },
      update: {},
    });
  } catch (err) {
    console.error('[clinic-bulk-export] failed to record operational alert', safeErrorFields(err));
  }
}

// ── Synchronous, request-time expiry (correction 1 & 2) ────────────────

export interface ArchiveExpiryCheckable {
  id: string;
  status: string;
  expiresAt: Date | null;
}

/**
 * Single shared definition of "expired" used by every route (status,
 * download-token issuance, download) AND the cleanup cron — cleanup-cron
 * timing must never be part of the security decision. If `row.status` is
 * 'ready' and `row.expiresAt` has passed, atomically flips it to 'expired'
 * (idempotent: a second concurrent caller either wins the flip or observes
 * it already 'expired', same outcome either way) and returns 'expired'.
 * Otherwise returns the row's current status unchanged.
 */
export async function expireArchiveIfPastTtl(
  row: ArchiveExpiryCheckable,
  now: Date = new Date(),
  client: Pick<PrismaClient, 'clinicBulkExportArchive'> = prisma,
): Promise<string> {
  if (row.status !== 'ready' || !row.expiresAt || row.expiresAt.getTime() > now.getTime()) {
    return row.status;
  }
  const result = await client.clinicBulkExportArchive.updateMany({
    where: { id: row.id, status: 'ready' },
    data: { status: 'expired' },
  });
  if (result.count > 0) {
    // We performed the transition — kick off storage cleanup opportunistically
    // rather than waiting for the next cleanup cron tick. Best-effort/fire-and-forget.
    void attemptArtifactDeletion(row.id).catch(() => {});
  }
  return 'expired';
}

/**
 * Deletes a storage object, treating "already gone" as success rather than
 * a failure to retry forever — a provider-specific missing-object error (or,
 * for local storage, simply nothing at that path) must never keep a row
 * stuck with cleanupFailureCode set indefinitely for an artifact that no
 * longer exists. `deleteFile` itself already swallows local-mode ENOENT, so
 * this second check only matters for remote-storage (S3-compatible) errors;
 * kept provider-agnostic rather than assuming a specific error shape.
 */
async function deleteStorageObjectIdempotent(storageKey: string, deleteForTest?: typeof deleteFile): Promise<boolean> {
  const doDelete = deleteForTest ?? deleteFile;
  try {
    await doDelete(storageKey);
    return true;
  } catch (err) {
    try {
      const stillExists = await fileExists(storageKey);
      if (!stillExists) return true;
    } catch {
      // Existence check itself failed — fall through to the failure path
      // below so this is retried, never silently swallowed.
    }
    console.error('[clinic-bulk-export-cleanup] storage delete failed, will retry', safeErrorFields(err));
    return false;
  }
}

async function finalizeArtifactDeletionOutcome(jobId: string, success: boolean, now: Date): Promise<void> {
  if (success) {
    await prisma.clinicBulkExportArchive
      .updateMany({ where: { id: jobId }, data: { storageKey: null, artifactDeletedAt: now, cleanupFailureCode: null } })
      .catch(() => {});
  } else {
    await prisma.clinicBulkExportArchive
      .updateMany({ where: { id: jobId }, data: { cleanupFailureCode: 'STORAGE_DELETE_FAILED' } })
      .catch(() => {});
  }
}

/**
 * Two-step, non-atomic (cannot share a Postgres transaction with an
 * S3/local delete), retryable artifact deletion for ANY row (of any
 * terminal status) that currently carries a non-null storageKey — gated
 * only on `status !== 'ready'`, so a legitimately downloadable artifact can
 * never be deleted out from under an in-flight download, but every
 * non-downloadable status (`expired`, `failed`, or a `generating` row whose
 * planned key never made it to a real upload) is eligible. Shared by:
 *  - expireArchiveIfPastTtl's opportunistic post-transition cleanup and the
 *    cleanup cron's retry sweep (P0 remediation: now covers BOTH `expired`
 *    and `failed` rows, not just `expired` — see
 *    cleanupExpiredClinicBulkExportArchives);
 *  - generateClinicBulkExport's own failure path, invoked the moment ANY
 *    failure occurs after the planned storageKey has been persisted to the
 *    row (see the guarded pre-upload persist below) — this is what closes
 *    the "artifact uploaded but never durably referenced" orphan window.
 * On success, storageKey is cleared and artifactDeletedAt is set. On
 * failure, storageKey is preserved (never nulled) and cleanupFailureCode is
 * set so the next cleanup run retries using the still-present key —
 * deletion is never silently abandoned.
 *
 * `deleteForTest` is a test-only override for the storage delete call
 * (mirrors `uploadForTest` on generateClinicBulkExport / `writeStartedAuditForTest`
 * on claimQueuedClinicBulkExportJobs), never passed by any production call
 * site — it exists solely so scripts/verify-clinic-bulk-export-lifecycle.ts
 * can deterministically force a single delete failure (real local-mode
 * storage deletion otherwise always succeeds, even for an already-missing
 * file) and prove the retry-on-a-later-run behavior.
 */
export async function attemptArtifactDeletion(
  jobId: string,
  now: Date = new Date(),
  deleteForTest?: typeof deleteFile,
): Promise<boolean> {
  const row = await prisma.clinicBulkExportArchive.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, storageKey: true },
  });
  if (!row || row.status === 'ready' || !row.storageKey) return false;

  const success = await deleteStorageObjectIdempotent(row.storageKey, deleteForTest);
  await finalizeArtifactDeletionOutcome(jobId, success, now);
  return success;
}

// ── Download token issuance (atomic) ────────────────────────────────────

export type IssueDownloadTokenFailure =
  | 'not_found'
  | 'not_ready'
  | 'expired'
  | 'token_already_issued'
  | 'step_up_failed';

export interface IssueDownloadTokenResult {
  ok: boolean;
  failure?: IssueDownloadTokenFailure;
  token?: string;
}

export interface IssueDownloadTokenArgs {
  jobId: string;
  clinicId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  /** True once the caller has already confirmed a fresh-or-windowed step-up. */
  stepUpOk: boolean;
  /**
   * True when `stepUpOk` came from THIS request supplying and verifying a
   * fresh current password (as opposed to reusing a prior step-up window).
   * When true, the guarded update also rebinds stepUpVerifiedAt/
   * stepUpVerifiedByUserId to `actorUserId`/`now` — so a second, different
   * OWNER/ORG_ADMIN who verifies their own password becomes the new window
   * owner, and only THEY (not the original requester) can reuse it
   * passwordless afterward, until it is rebound again.
   */
  freshStepUp: boolean;
  req: { ip?: string; headers: Record<string, unknown> };
  now?: Date;
}

/**
 * Atomically issues a one-time download token. Only the request that flips
 * `downloadTokenHash` from null to a value wins — a concurrent second
 * request observes `count === 0` and gets 'token_already_issued'. Expiry is
 * re-checked synchronously as part of the same guarded update (`expiresAt
 * > now` in the WHERE clause), not via a separate read-then-act step. The
 * row update and its audit event are written in the same transaction
 * (fail-closed). When `freshStepUp` is true, the same guarded update also
 * rebinds the step-up actor (see IssueDownloadTokenArgs.freshStepUp).
 */
export async function issueClinicBulkExportDownloadToken(
  args: IssueDownloadTokenArgs,
): Promise<IssueDownloadTokenResult> {
  if (!args.stepUpOk) return { ok: false, failure: 'step_up_failed' };
  const now = args.now ?? new Date();

  const existing = await prisma.clinicBulkExportArchive.findFirst({
    where: { id: args.jobId, clinicId: args.clinicId, organizationId: args.organizationId },
    select: { id: true, status: true, expiresAt: true, downloadTokenHash: true },
  });
  if (!existing) return { ok: false, failure: 'not_found' };

  const effectiveStatus = await expireArchiveIfPastTtl(existing, now);
  if (effectiveStatus === 'expired') return { ok: false, failure: 'expired' };
  if (effectiveStatus !== 'ready') return { ok: false, failure: 'not_ready' };
  if (existing.downloadTokenHash) return { ok: false, failure: 'token_already_issued' };

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashDownloadToken(rawToken);

  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const updated = await tx.clinicBulkExportArchive.updateMany({
      where: {
        id: args.jobId,
        clinicId: args.clinicId,
        organizationId: args.organizationId,
        status: 'ready',
        downloadTokenHash: null,
        expiresAt: { gt: now },
      },
      data: {
        downloadTokenHash: tokenHash,
        ...(args.freshStepUp
          ? { stepUpVerifiedAt: now, stepUpVerifiedByUserId: args.actorUserId }
          : {}),
      },
    });
    if (updated.count === 0) return null;

    await writeAuditLogInTx(tx, {
      organizationId: args.organizationId,
      clinicId: args.clinicId,
      actorUserId: args.actorUserId,
      actorRole: args.actorRole,
      action: 'clinic_bulk_export_download_token_issued',
      entityType: 'clinic',
      entityId: args.clinicId,
      description: 'Clinic bulk export download token issued',
      metadata: { jobId: args.jobId },
      ...extractRequestMeta(args.req),
    });
    return true;
  });

  if (!result) {
    // Lost the race, or expired/changed status between the read above and
    // this transaction. Re-resolve why for an accurate failure reason.
    const recheck = await prisma.clinicBulkExportArchive.findUnique({
      where: { id: args.jobId },
      select: { id: true, status: true, expiresAt: true, downloadTokenHash: true },
    });
    if (!recheck) return { ok: false, failure: 'not_found' };
    const status = await expireArchiveIfPastTtl(recheck, now);
    if (status === 'expired') return { ok: false, failure: 'expired' };
    if (recheck.downloadTokenHash) return { ok: false, failure: 'token_already_issued' };
    return { ok: false, failure: 'not_ready' };
  }

  return { ok: true, token: rawToken };
}

export function hashDownloadToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

// ── Download validation + atomic claim ──────────────────────────────────

export type ValidateDownloadFailure = 'missing' | 'not_found' | 'wrong_scope' | 'expired' | 'not_ready' | 'already_downloaded';

export interface ValidateDownloadResult {
  ok: boolean;
  failure?: ValidateDownloadFailure;
  archive?: { id: string; storageKey: string };
}

export async function validateClinicBulkExportDownloadToken(params: {
  clinicId: string;
  organizationId: string;
  jobId: string;
  token: string;
  now?: Date;
}): Promise<ValidateDownloadResult> {
  const now = params.now ?? new Date();
  if (!params.token || typeof params.token !== 'string') return { ok: false, failure: 'missing' };

  const row = await prisma.clinicBulkExportArchive.findUnique({
    where: { downloadTokenHash: hashDownloadToken(params.token) },
    select: {
      id: true,
      clinicId: true,
      organizationId: true,
      storageKey: true,
      expiresAt: true,
      status: true,
      downloadedAt: true,
    },
  });

  if (!row || row.id !== params.jobId) return { ok: false, failure: 'not_found' };
  if (row.clinicId !== params.clinicId || row.organizationId !== params.organizationId) {
    return { ok: false, failure: 'wrong_scope' };
  }

  const effectiveStatus = await expireArchiveIfPastTtl(row, now);
  if (effectiveStatus === 'expired') return { ok: false, failure: 'expired' };
  if (effectiveStatus !== 'ready' || !row.storageKey) return { ok: false, failure: 'not_ready' };
  if (row.downloadedAt) return { ok: false, failure: 'already_downloaded' };

  return { ok: true, archive: { id: row.id, storageKey: row.storageKey } };
}

export type ClaimDownloadFailure =
  | 'not_found'
  | 'wrong_scope'
  | 'expired'
  | 'not_ready'
  | 'already_downloaded'
  | 'invalid_token';

export type ClaimDownloadResult = { claimed: true } | { claimed: false; failure: ClaimDownloadFailure };

/**
 * Atomically claims the one-time download and writes the
 * `download_started` audit event in the SAME transaction (fail-closed: if
 * the audit insert throws, the claim rolls back and the caller must treat
 * the already-opened storage stream as unusable — destroy it, never pipe
 * it). Must be called AFTER confirming the file stream can be opened but
 * BEFORE piping to the response.
 *
 * The guarded WHERE clause is intentionally fully redundant with the read
 * `validateClinicBulkExportDownloadToken` already performed: it re-checks
 * id/clinicId/organizationId/status/expiresAt/downloadedAt AND the caller's
 * exact token hash, all in the SAME update as the claim, so nothing that
 * changed between the read and this call (a concurrent expiry, a token
 * replacement, a second claim) can ever be missed by a stale read. If the
 * guarded update affects zero rows, a precise re-read determines the exact
 * reason (never a generic "already downloaded").
 */
export async function claimClinicBulkExportDownload(args: {
  jobId: string;
  clinicId: string;
  organizationId: string;
  tokenHash: string;
  actorUserId: string;
  actorRole: string;
  req: { ip?: string; headers: Record<string, unknown> };
  now?: Date;
}): Promise<ClaimDownloadResult> {
  const now = args.now ?? new Date();
  const claimed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const updated = await tx.clinicBulkExportArchive.updateMany({
      where: {
        id: args.jobId,
        clinicId: args.clinicId,
        organizationId: args.organizationId,
        status: 'ready',
        expiresAt: { gt: now },
        downloadedAt: null,
        downloadTokenHash: args.tokenHash,
      },
      data: { downloadedAt: now },
    });
    if (updated.count === 0) return false;

    await writeAuditLogInTx(tx, {
      organizationId: args.organizationId,
      clinicId: args.clinicId,
      actorUserId: args.actorUserId,
      actorRole: args.actorRole,
      action: 'clinic_bulk_export_download_started',
      entityType: 'clinic',
      entityId: args.clinicId,
      description: 'Clinic bulk export download claimed',
      metadata: { jobId: args.jobId },
      ...extractRequestMeta(args.req),
    });
    return true;
  });

  if (claimed) return { claimed: true };

  const recheck = await prisma.clinicBulkExportArchive.findUnique({
    where: { id: args.jobId },
    select: {
      id: true,
      clinicId: true,
      organizationId: true,
      status: true,
      expiresAt: true,
      downloadedAt: true,
      downloadTokenHash: true,
    },
  });
  if (!recheck) return { claimed: false, failure: 'not_found' };
  if (recheck.clinicId !== args.clinicId || recheck.organizationId !== args.organizationId) {
    return { claimed: false, failure: 'wrong_scope' };
  }
  const status = await expireArchiveIfPastTtl(recheck, now);
  if (status === 'expired') return { claimed: false, failure: 'expired' };
  if (recheck.downloadedAt) return { claimed: false, failure: 'already_downloaded' };
  if (recheck.downloadTokenHash !== args.tokenHash) return { claimed: false, failure: 'invalid_token' };
  return { claimed: false, failure: 'not_ready' };
}

// ── Download completion/abort outcome (exactly-once, response-driven) ──

/** Minimal EventEmitter-like shape both Express `Response` and a storage
 * read stream satisfy — kept narrow so this helper is trivially unit
 * testable with plain fake emitters, no live HTTP server required. */
export interface DownloadOutcomeEmitter {
  once(event: string, listener: (...args: unknown[]) => void): unknown;
}

export type DownloadOutcomeFailureReason = 'interrupted' | 'stream_error';

/**
 * Wires the exactly-once terminal download-outcome audit decision.
 * Deliberately does NOT treat the source stream's `end` event as success —
 * the file may have finished reading from storage while the response is
 * still flushing bytes to a slow/disconnecting client. The only source of
 * truth for "the client actually received the export" is `res`'s own
 * `finish` event:
 *   - res 'finish'                       -> completed
 *   - res 'close' BEFORE 'finish'        -> failed (interrupted)
 *   - stream 'error' (storage read fails) -> failed (stream_error)
 * A single in-closure flag guarantees exactly one of onCompleted/onFailed
 * ever fires, regardless of event ordering (e.g. the source stream ending
 * and the client disconnecting in either order before `finish`).
 */
export function attachDownloadOutcomeListeners(args: {
  res: DownloadOutcomeEmitter;
  stream: DownloadOutcomeEmitter;
  onCompleted: () => void;
  onFailed: (reason: DownloadOutcomeFailureReason) => void;
}): void {
  let finished = false;
  let outcomeDecided = false;

  args.res.once('finish', () => {
    finished = true;
    if (outcomeDecided) return;
    outcomeDecided = true;
    args.onCompleted();
  });
  args.res.once('close', () => {
    if (finished || outcomeDecided) return;
    outcomeDecided = true;
    args.onFailed('interrupted');
  });
  args.stream.once('error', () => {
    if (outcomeDecided) return;
    outcomeDecided = true;
    args.onFailed('stream_error');
  });
}

// ── Worker: claim + generate ────────────────────────────────────────────

/**
 * Claims up to `limit` queued rows for this worker process. Each candidate
 * is claimed via `claimSingleQueuedJobWithAudit` — one Prisma transaction
 * per row containing BOTH the guarded claim update AND its
 * `clinic_bulk_export_generation_started` audit write, so the claim is
 * exactly-once and durable (P1 remediation: previously the claim, the job
 * read, and the audit write were three separate, non-transactional steps —
 * a crash or a failing audit insert between them could leave a row claimed
 * with no audit trail). Multiple replicas can still claim different rows
 * concurrently without any cross-replica lock — correctness comes entirely
 * from the guarded per-row WHERE clause inside each transaction (only one
 * of N concurrent transactions targeting the same row can win the row
 * lock). Also sweeps rows (queued or generating) whose lease has expired to
 * 'failed' first — a crashed/absent worker never permanently blocks a
 * clinic, and a queued row that merely outlived the (separate, longer)
 * queue timeout is the only queued row ever swept this way.
 *
 * `writeStartedAuditForTest` is a test-only override for the transactional
 * audit write, never passed by any production call site (mirrors
 * `uploadForTest` on generateClinicBulkExport) — it exists solely so
 * scripts/verify-clinic-bulk-export-lifecycle.ts can deterministically force
 * an audit-write failure and prove the claim rolls back with the job left
 * 'queued'.
 */
export async function claimQueuedClinicBulkExportJobs(
  limit: number,
  now: Date = new Date(),
  writeStartedAuditForTest?: typeof writeAuditLogInTx,
): Promise<string[]> {
  await prisma.clinicBulkExportArchive.updateMany({
    where: {
      status: { in: ['queued', 'generating'] },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    data: { status: 'failed', failureCode: 'LEASE_EXPIRED' },
  });

  const candidates = await prisma.clinicBulkExportArchive.findMany({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    take: Math.max(limit * 3, limit),
    select: { id: true, organizationId: true, clinicId: true, requestedByUserId: true },
  });

  const claimedIds: string[] = [];
  for (const candidate of candidates) {
    if (claimedIds.length >= limit) break;
    // KVKK-HIGH-004 remediation (P0): the global kill switch / organization
    // rollout allowlist must be a genuine GENERATION gate, not merely a
    // creation-time gate — a job created while enabled, still sitting queued
    // when the flag is later flipped off (or the org is dropped from the
    // allowlist), must never silently get claimed and generated anyway. Such
    // a row is moved atomically to a stable, non-downloadable terminal
    // status instead of being claimed at all.
    if (!isClinicBulkExportEnabledForOrganization(candidate.organizationId)) {
      await failQueuedJobAsFeatureDisabled(candidate);
      continue;
    }
    try {
      const claimed = await claimSingleQueuedJobWithAudit(candidate.id, now, writeStartedAuditForTest);
      if (claimed) claimedIds.push(candidate.id);
    } catch (err) {
      // The transaction (claim + audit) rolled back — the row is left
      // exactly as it was ('queued'). One candidate's failure must never
      // stop this tick from claiming OTHER healthy candidates.
      console.error('[clinic-bulk-export] claim transaction failed, job remains queued', {
        jobId: candidate.id,
        ...safeErrorFields(err),
      });
    }
  }
  return claimedIds;
}

/**
 * Atomically moves ONE still-queued row (never claimed into 'generating') to
 * the stable 'failed'/FEATURE_DISABLED terminal status because the feature
 * is currently off for its organization. Guarded on `status: 'queued'` so a
 * row a concurrent replica claimed in the same instant is left untouched —
 * this can only ever affect a row nobody has started generating yet. Writes
 * the same `clinic_bulk_export_generation_failed` audit action used for
 * every other worker-side generation failure, with no patient data in its
 * metadata (only the stable jobId/failureCode), so FEATURE_DISABLED is
 * indistinguishable in shape from LEASE_LOST/SIZE_LIMIT_EXCEEDED in the
 * audit trail.
 */
async function failQueuedJobAsFeatureDisabled(candidate: {
  id: string;
  organizationId: string;
  clinicId: string;
  requestedByUserId: string | null;
}): Promise<void> {
  try {
    const result = await prisma.clinicBulkExportArchive.updateMany({
      where: { id: candidate.id, status: 'queued' },
      data: { status: 'failed', failureCode: 'FEATURE_DISABLED' },
    });
    if (result.count === 0) return; // lost to a concurrent claim/sweep — nothing to audit
    await writeAuditLog({
      organizationId: candidate.organizationId,
      clinicId: candidate.clinicId,
      actorUserId: candidate.requestedByUserId,
      actorRole: 'system',
      action: 'clinic_bulk_export_generation_failed',
      entityType: 'clinic',
      entityId: candidate.clinicId,
      description: 'Clinic bulk export generation failed',
      metadata: { jobId: candidate.id, failureCode: 'FEATURE_DISABLED' },
    });
  } catch (err) {
    console.error('[clinic-bulk-export] failed to fail queued job as FEATURE_DISABLED', {
      jobId: candidate.id,
      ...safeErrorFields(err),
    });
  }
}

/**
 * The single decision generateClinicBulkExport re-checks at every stage
 * boundary (generation start, immediately before the planned-storageKey
 * persist/upload, and immediately before the ready transition) — see
 * ClinicBulkExportFeatureDisabledError's doc comment. Reuses the SAME
 * isClinicBulkExportEnabledForOrganization the create route and the queued-
 * job claim gate above both use, so all three enforcement points can never
 * drift apart on what "enabled" means.
 */
function assertClinicBulkExportGenerationAllowed(organizationId: string): void {
  if (!isClinicBulkExportEnabledForOrganization(organizationId)) {
    throw new ClinicBulkExportFeatureDisabledError();
  }
}

/**
 * Exactly-once, durable claim of ONE queued row: guarded claim update, a
 * read of the stable job identifiers, and the
 * `clinic_bulk_export_generation_started` audit write all happen inside a
 * SINGLE Prisma transaction. If the guarded update matches zero rows (lost
 * the claim race to another replica), returns `false` immediately with no
 * audit write and no transaction side effects. If the audit insert throws
 * for any reason, the entire transaction — including the claim itself —
 * rolls back, so the row is left exactly as it was ('queued'), available
 * for another replica (or a later tick of this same replica) to claim.
 * Only stable identifiers are recorded in the audit metadata — never
 * restrictedNote, patient data, storageKey, or exception text.
 */
async function claimSingleQueuedJobWithAudit(
  jobId: string,
  now: Date,
  writeStartedAuditForTest?: typeof writeAuditLogInTx,
): Promise<boolean> {
  const writeStartedAudit = writeStartedAuditForTest ?? writeAuditLogInTx;
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const claim = await tx.clinicBulkExportArchive.updateMany({
      where: { id: jobId, status: 'queued' },
      // Claiming REPLACES the queue-timeout deadline with the (shorter)
      // generating lease — a job that just spent 40 minutes healthily
      // waiting behind other clinics' jobs must not inherit that elapsed
      // time against its generation budget.
      data: { status: 'generating', heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + getGenerationLeaseMs()) },
    });
    if (claim.count === 0) return false;

    const job = await tx.clinicBulkExportArchive.findUniqueOrThrow({
      where: { id: jobId },
      select: { organizationId: true, clinicId: true, requestedByUserId: true },
    });

    await writeStartedAudit(tx, {
      organizationId: job.organizationId,
      clinicId: job.clinicId,
      actorUserId: job.requestedByUserId,
      actorRole: 'system',
      action: 'clinic_bulk_export_generation_started',
      entityType: 'clinic',
      entityId: job.clinicId,
      description: 'Clinic bulk export generation started',
      metadata: { jobId, schemaVersion: EXPORT_SCHEMA_VERSION },
    });

    return true;
  });
}

async function renewLease(jobId: string, now: Date = new Date()): Promise<boolean> {
  try {
    const result = await prisma.clinicBulkExportArchive.updateMany({
      where: { id: jobId, status: 'generating' },
      data: { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + getGenerationLeaseMs()) },
    });
    return result.count > 0;
  } catch (err) {
    console.error('[clinic-bulk-export] lease renewal failed', { jobId, ...safeErrorFields(err) });
    return false;
  }
}

/**
 * Non-overlapping per-job lease heartbeat (KVKK-HIGH-004 remediation): the
 * previous design only renewed the lease once per cursor-paginated DB
 * batch, so a large export could exceed the generating lease during
 * archive.finalize(), the write-stream flush, or the storage upload — none
 * of which are batch-shaped. This background timer keeps the SAME
 * `renewLease()` call alive for the entire generation lifecycle, from the
 * moment generation starts until the caller stops it in a `finally` block.
 *
 * `renewCheckpoint()` lets the entity-stream's own per-batch await share the
 * exact same in-flight guard as the background tick — `inFlight` guarantees
 * at most one renewal query for this job is ever outstanding at a time, so
 * the awaited per-batch checkpoint and the timer-driven tick can never
 * overlap, regardless of timing.
 */
interface ClinicBulkExportLeaseHeartbeat {
  renewCheckpoint: () => Promise<boolean>;
  isLeaseLost: () => boolean;
  stop: () => void;
}

function startClinicBulkExportLeaseHeartbeat(jobId: string): ClinicBulkExportLeaseHeartbeat {
  const intervalMs = getHeartbeatIntervalMs();
  let leaseLost = false;
  let stopped = false;
  let inFlight: Promise<boolean> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function renew(): Promise<boolean> {
    if (leaseLost || stopped) return false;
    if (inFlight) return inFlight;
    const promise = renewLease(jobId)
      .then((ok) => {
        if (!ok) leaseLost = true;
        return ok;
      })
      .catch(() => {
        leaseLost = true;
        return false;
      })
      .finally(() => {
        inFlight = null;
      });
    inFlight = promise;
    return promise;
  }

  function scheduleNext(): void {
    if (stopped || leaseLost) return;
    timer = setTimeout(() => {
      void renew().finally(scheduleNext);
    }, intervalMs);
  }
  scheduleNext();

  return {
    renewCheckpoint: renew,
    isLeaseLost: () => leaseLost,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

interface EntityStreamStats {
  recordCount: number;
  sha256: string;
}

interface EntityDefinition {
  fileName: string;
  fetchBatch: (cursor: string | undefined, take: number) => Promise<{ id: string }[]>;
}

interface EntityStreamLimits {
  onRecord: () => void;
  /**
   * Awaited once per cursor-paginated DB batch (never per record) — see the
   * lease-renewal-amplification fix in generateClinicBulkExport. In
   * practice this is `heartbeat.renewCheckpoint()`, which shares its
   * in-flight guard with the background heartbeat tick started for the
   * whole generation lifecycle — so this per-batch checkpoint can never
   * overlap the heartbeat's own renewal, and at most one renewal query for
   * this job is ever in flight. Returns false if the lease could not be
   * renewed (lost/claimed elsewhere), in which case generation must stop
   * immediately.
   */
  renewLease: () => Promise<boolean>;
}

/** Wraps a cursor-paginated entity fetch as a lazily-pulled NDJSON byte stream — never buffers the whole entity. */
function createEntityStream(
  def: EntityDefinition,
  limits: EntityStreamLimits,
): { stream: Readable; getStats: () => EntityStreamStats; getBatchCount: () => number } {
  const hash = createHash('sha256');
  let recordCount = 0;
  let batchCount = 0;

  async function* generate(): AsyncGenerator<Buffer> {
    let cursor: string | undefined;
    while (true) {
      const batch = await def.fetchBatch(cursor, BATCH_SIZE);
      batchCount++;
      const leaseOk = await limits.renewLease();
      if (!leaseOk) throw new ClinicBulkExportLeaseLostError();
      if (batch.length === 0) break;
      for (const row of batch) {
        limits.onRecord();
        const line = Buffer.from(JSON.stringify(row) + '\n', 'utf8');
        hash.update(line);
        recordCount++;
        yield line;
      }
      cursor = batch[batch.length - 1]!.id;
      if (batch.length < BATCH_SIZE) break;
    }
  }

  return {
    stream: Readable.from(generate()),
    getStats: () => ({ recordCount, sha256: hash.digest('hex') }),
    getBatchCount: () => batchCount,
  };
}

/**
 * Merges cursor/skip into a findMany args object without producing a union
 * type at the call site. `base` MUST be assigned to a typed local (e.g.
 * `const base: Prisma.UserFindManyArgs = {...}`) before being passed here —
 * passing a fresh object literal directly runs into TS inferring `A` from
 * the (narrower) constraint type instead of the full args type, which then
 * rejects `where`/`select`/etc. as excess properties.
 */
function withCursor<A extends { cursor?: unknown; skip?: number }>(base: A, cursor: string | undefined): A {
  if (!cursor) return base;
  return { ...base, cursor: { id: cursor }, skip: 1 } as A;
}

function buildEntityDefinitions(clinicId: string): EntityDefinition[] {
  return [
    {
      fileName: 'users.ndjson',
      fetchBatch: (cursor, take) => {
        const base: Prisma.UserFindManyArgs = { where: { clinicId }, select: USER_SELECT, orderBy: { id: 'asc' }, take };
        return prisma.user.findMany(withCursor(base, cursor));
      },
    },
    {
      fileName: 'patients.ndjson',
      fetchBatch: (cursor, take) => {
        const base: Prisma.PatientFindManyArgs = {
          where: { clinicId, deletedAt: null },
          select: PATIENT_SELECT,
          orderBy: { id: 'asc' },
          take,
        };
        return prisma.patient.findMany(withCursor(base, cursor));
      },
    },
    {
      fileName: 'appointments.ndjson',
      fetchBatch: (cursor, take) => {
        const base: Prisma.AppointmentFindManyArgs = {
          where: { clinicId, deletedAt: null },
          select: APPOINTMENT_SELECT,
          orderBy: { id: 'asc' },
          take,
        };
        return prisma.appointment.findMany(withCursor(base, cursor));
      },
    },
    {
      fileName: 'treatment-cases.ndjson',
      fetchBatch: (cursor, take) => {
        const base: Prisma.TreatmentCaseFindManyArgs = {
          where: { clinicId, deletedAt: null },
          select: TREATMENT_CASE_SELECT,
          orderBy: { id: 'asc' },
          take,
        };
        return prisma.treatmentCase.findMany(withCursor(base, cursor));
      },
    },
    {
      fileName: 'payments.ndjson',
      fetchBatch: (cursor, take) => {
        const base: Prisma.PaymentFindManyArgs = { where: { clinicId }, select: PAYMENT_SELECT, orderBy: { id: 'asc' }, take };
        return prisma.payment.findMany(withCursor(base, cursor));
      },
    },
    {
      fileName: 'tasks.ndjson',
      fetchBatch: (cursor, take) => {
        const base: Prisma.TaskFindManyArgs = { where: { clinicId }, select: TASK_SELECT, orderBy: { id: 'asc' }, take };
        return prisma.task.findMany(withCursor(base, cursor));
      },
    },
    {
      fileName: 'sent-messages.ndjson',
      fetchBatch: (cursor, take) => {
        const base: Prisma.SentMessageFindManyArgs = {
          where: { clinicId },
          select: SENT_MESSAGE_SELECT,
          orderBy: { id: 'asc' },
          take,
        };
        return prisma.sentMessage.findMany(withCursor(base, cursor));
      },
    },
    {
      fileName: 'activity-logs.ndjson',
      fetchBatch: (cursor, take) => {
        const base: Prisma.ActivityLogFindManyArgs = {
          where: { clinicId },
          select: ACTIVITY_LOG_SELECT,
          orderBy: { id: 'asc' },
          take,
        };
        return prisma.activityLog.findMany(withCursor(base, cursor));
      },
    },
    {
      fileName: 'insurance-provisions.ndjson',
      fetchBatch: (cursor, take) => {
        const base: Prisma.InsuranceProvisionFindManyArgs = {
          where: { clinicId },
          select: INSURANCE_PROVISION_SELECT,
          orderBy: { id: 'asc' },
          take,
        };
        return prisma.insuranceProvision.findMany(withCursor(base, cursor));
      },
    },
    {
      fileName: 'inventory-items.ndjson',
      fetchBatch: (cursor, take) => {
        const base: Prisma.InventoryItemFindManyArgs = {
          where: { clinicId },
          select: INVENTORY_ITEM_SELECT,
          orderBy: { id: 'asc' },
          take,
        };
        return prisma.inventoryItem.findMany(withCursor(base, cursor));
      },
    },
  ];
}

export interface ClinicBulkExportManifest {
  exportSchemaVersion: 1;
  generatedAt: string;
  organizationId: string;
  clinicId: string;
  requestedByUserId: string | null;
  purpose: string;
  entityCounts: Record<string, number>;
  fileNames: string[];
  /** SHA-256 hex digest for every file in the archive EXCEPT manifest.json
   * itself — manifest.json is written last (it embeds this very map) and
   * hashing it here would be circular self-reference, so it deliberately
   * has no entry. Every other file, including clinic.json, is present. */
  sha256PerFile: Record<string, string>;
  scopeDescription: string;
}

const SCOPE_DESCRIPTION =
  'Clinic structured-data export. Contains structured database records only — ' +
  'it does NOT include physical attachment or imaging files and must not be ' +
  'treated as a complete backup.';

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIR_SIGNATURE = 0x02014b50;
/** Max EOCD comment length (uint16) — bounds how far back from EOF the EOCD record can be. */
const ZIP_MAX_COMMENT_LENGTH = 0xffff;
const ZIP_EOCD_FIXED_SIZE = 22;

/**
 * Post-finalize structural-integrity check on the real completed temp ZIP
 * (KVKK-HIGH-004 remediation, P0): locates the End-Of-Central-Directory
 * record, reads ONLY the central-directory region it points to (never the
 * whole file — a multi-GB export must not be pulled into memory just to
 * validate it), and confirms the resulting filename set is EXACTLY the
 * expected file list (same count, same names). This is a structural
 * sanity check, not full content extraction/decompression — archiver's own
 * finalize() + the write-stream's 'close' event already guarantee the
 * writer side completed without error; this additionally catches a
 * truncated/corrupted file on the READ side (e.g. a bug in this bounds
 * logic itself, or filesystem-level corruption) before the file is ever
 * uploaded or referenced by a persisted storageKey.
 *
 * Exported for unit testing (see server/src/tests/clinicBulkExport.test.ts)
 * — never called directly by any route.
 */
export async function validateZipStructuralIntegrity(
  filePath: string,
  fileSize: number,
  expectedFileNames: string[],
): Promise<void> {
  if (fileSize < ZIP_EOCD_FIXED_SIZE) throw new ClinicBulkExportZipIntegrityError();

  const handle = await fs.promises.open(filePath, 'r');
  try {
    const tailSize = Math.min(fileSize, ZIP_EOCD_FIXED_SIZE + ZIP_MAX_COMMENT_LENGTH);
    const tailStart = fileSize - tailSize;
    const tailBuf = Buffer.alloc(tailSize);
    await handle.read(tailBuf, 0, tailSize, tailStart);

    let eocdOffsetInTail = -1;
    for (let i = tailBuf.length - ZIP_EOCD_FIXED_SIZE; i >= 0; i--) {
      if (tailBuf.readUInt32LE(i) === ZIP_EOCD_SIGNATURE) {
        eocdOffsetInTail = i;
        break;
      }
    }
    if (eocdOffsetInTail === -1) throw new ClinicBulkExportZipIntegrityError();

    const cdEntryCount = tailBuf.readUInt16LE(eocdOffsetInTail + 10);
    const cdSize = tailBuf.readUInt32LE(eocdOffsetInTail + 12);
    const cdOffset = tailBuf.readUInt32LE(eocdOffsetInTail + 16);
    if (cdEntryCount !== expectedFileNames.length) throw new ClinicBulkExportZipIntegrityError();
    if (cdOffset < 0 || cdSize < 0 || cdOffset + cdSize > fileSize) throw new ClinicBulkExportZipIntegrityError();

    const cdBuf = Buffer.alloc(cdSize);
    await handle.read(cdBuf, 0, cdSize, cdOffset);

    const foundNames = new Set<string>();
    let offset = 0;
    for (let i = 0; i < cdEntryCount; i++) {
      if (offset + 46 > cdBuf.length) throw new ClinicBulkExportZipIntegrityError();
      if (cdBuf.readUInt32LE(offset) !== ZIP_CENTRAL_DIR_SIGNATURE) throw new ClinicBulkExportZipIntegrityError();
      const fileNameLength = cdBuf.readUInt16LE(offset + 28);
      const extraFieldLength = cdBuf.readUInt16LE(offset + 30);
      const fileCommentLength = cdBuf.readUInt16LE(offset + 32);
      if (offset + 46 + fileNameLength > cdBuf.length) throw new ClinicBulkExportZipIntegrityError();
      foundNames.add(cdBuf.toString('utf8', offset + 46, offset + 46 + fileNameLength));
      offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
    }

    for (const name of expectedFileNames) {
      if (!foundNames.has(name)) throw new ClinicBulkExportZipIntegrityError();
    }
  } finally {
    await handle.close();
  }
}

/**
 * Generates the ZIP for an already-claimed ('generating') job. Streams
 * manifest.json, clinic.json, and one *.ndjson file per entity via
 * cursor-paginated batches straight into a temp file (archiver piped to a
 * write stream) — never accumulates a whole table or the whole archive in
 * memory. Enforces CLINIC_BULK_EXPORT_MAX_RECORDS/_MAX_BYTES while
 * streaming: on breach, generation stops immediately, all temp/partial
 * artifacts are deleted, and the job fails with the stable
 * 'SIZE_LIMIT_EXCEEDED' code — never a partial/misleading ZIP.
 *
 * `uploadForTest` is a test-only override for the storage upload call,
 * never passed by any production call site (jobs/clinicBulkExportWorker.ts
 * always omits it, so production always uses the real `saveFileFromPath`).
 * It exists solely so scripts/verify-clinic-bulk-export-lifecycle.ts can
 * deterministically wrap the real upload with an artificial delay (and,
 * separately, simulate a concurrent lease steal) to prove the lease
 * heartbeat survives a slow upload — reassigning fileStorage.ts's
 * `saveFileFromPath` export directly is not possible (it is a live,
 * read-only ES-module binding under this package's `"type": "module"`).
 *
 * `beforePlannedKeyPersistForTest` is the same kind of test-only override,
 * fired immediately before the guarded planned-storageKey persist below.
 * It exists because that guarded update is normally impossible to lose in
 * practice: every cursor-paginated entity batch (including a zero-record
 * one) already renews the lease forward via the SAME heartbeat mechanism
 * before this point is ever reached, so an externally-stale `leaseExpiresAt`
 * value gets self-healed long before the planned-key update runs. This hook
 * lets the verify script simulate the one real-world case that still loses
 * the race — a concurrent sweep (a different replica, or the cleanup cron)
 * flips the row's status/lease in the narrow window between the last
 * per-batch renewal and this update — deterministically rather than by
 * timing.
 */
export async function generateClinicBulkExport(
  jobId: string,
  uploadForTest?: typeof saveFileFromPath,
  beforePlannedKeyPersistForTest?: () => Promise<void>,
): Promise<void> {
  const job = await prisma.clinicBulkExportArchive.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      clinicId: true,
      organizationId: true,
      requestedByUserId: true,
      purpose: true,
      status: true,
    },
  });
  if (!job || job.status !== 'generating') return;

  let tempFilePath: string | null = null;
  // Active from the moment generation starts until the final guarded
  // ready/failed transition below — covers DB pagination (via
  // renewCheckpoint, shared with the per-batch awaited renewal), archiver
  // finalization, and the storage upload, none of which are batch-shaped
  // and so were previously un-covered by the old per-batch-only renewal.
  const heartbeat = startClinicBulkExportLeaseHeartbeat(jobId);

  try {
    // KVKK-HIGH-004 remediation (P0): first of three re-checks that the
    // global kill switch / organization allowlist hasn't turned this job off
    // since it was claimed — see assertClinicBulkExportGenerationAllowed and
    // ClinicBulkExportFeatureDisabledError. Nothing has been written to disk
    // yet at this point, so the catch block below has only the ordinary
    // 'generating' -> 'failed' row transition to perform.
    assertClinicBulkExportGenerationAllowed(job.organizationId);

    const maxRecords = getMaxRecords();
    const maxBytes = getMaxBytes();
    let totalRecords = 0;
    let totalBytesWritten = 0;

    await ensureExportTempDir();
    tempFilePath = buildExportTempFilePath(jobId);
    const archive = archiver('zip', { zlib: { level: 9 } });
    // Private temp dir (0700) + exclusive-create (`wx`, never overwrites an
    // existing path) + 0600 file mode — KVKK-HIGH-004 crash-safety
    // remediation: a hard process kill between here and the final
    // ready/failed transition can no longer leave a complete, sensitive
    // clinic ZIP sitting under a shared, loosely-permissioned temp root.
    const writeStream = fs.createWriteStream(tempFilePath, { mode: 0o600, flags: 'wx' });
    const writeFinished = new Promise<void>((resolve, reject) => {
      writeStream.on('close', resolve);
      writeStream.on('error', reject);
      archive.on('error', reject);
    });
    // A size-limit abort or an entity-stream error (e.g. ClinicBulkExportLeaseLostError)
    // can reject writeFinished before it is ever awaited below (control flow
    // leaves via the entity-processing loop's own throw first) — without
    // this, that rejection is unhandled and crashes the process. The actual
    // `await writeFinished` further down still observes the rejection
    // normally; this only prevents the unhandled-rejection crash.
    writeFinished.catch(() => {});
    let byteLimitExceeded = false;
    archive.on('data', (chunk: Buffer) => {
      totalBytesWritten += chunk.length;
      if (totalBytesWritten > maxBytes && !byteLimitExceeded) {
        byteLimitExceeded = true;
        // archiver's TS defs omit abort() even though it exists at runtime (lib/core.js).
        (archive as unknown as { abort: () => void }).abort();
      }
    });
    archive.pipe(writeStream);

    const clinic = await prisma.clinic.findUnique({ where: { id: job.clinicId }, select: CLINIC_SELECT });
    const clinicJsonBuffer = Buffer.from(JSON.stringify(clinic, null, 2), 'utf8');
    const clinicJsonSha256 = createHash('sha256').update(clinicJsonBuffer).digest('hex');
    archive.append(clinicJsonBuffer, { name: 'clinic.json' });

    const onRecord = () => {
      totalRecords++;
      if (totalRecords > maxRecords) throw new ClinicBulkExportSizeLimitExceededError();
    };

    const entities = buildEntityDefinitions(job.clinicId);
    const entityCounts: Record<string, number> = {};
    // clinic.json's checksum is known synchronously (already fully
    // buffered above, unlike the streamed *.ndjson entities) — seeded here
    // rather than after the streaming loop below. manifest.json is
    // deliberately EXCLUDED from this map: it is written last and would
    // otherwise have to hash itself before it exists (a circular
    // self-hash), so manifest.json is the one export file with no
    // corresponding sha256PerFile entry — documented on
    // ClinicBulkExportManifest.sha256PerFile.
    const sha256PerFile: Record<string, string> = { 'clinic.json': clinicJsonSha256 };
    const fileNames: string[] = ['manifest.json', 'clinic.json'];

    for (const entity of entities) {
      const { stream, getStats } = createEntityStream(entity, {
        onRecord,
        renewLease: () => heartbeat.renewCheckpoint(),
      });
      archive.append(stream, { name: entity.fileName });
      await new Promise<void>((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      const stats = getStats();
      entityCounts[entity.fileName] = stats.recordCount;
      sha256PerFile[entity.fileName] = stats.sha256;
      fileNames.push(entity.fileName);
    }

    if (byteLimitExceeded) throw new ClinicBulkExportSizeLimitExceededError();

    const manifest: ClinicBulkExportManifest = {
      exportSchemaVersion: EXPORT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      organizationId: job.organizationId,
      clinicId: job.clinicId,
      requestedByUserId: job.requestedByUserId,
      purpose: job.purpose,
      entityCounts,
      fileNames,
      sha256PerFile,
      scopeDescription: SCOPE_DESCRIPTION,
    };
    archive.append(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), { name: 'manifest.json' });

    // Deliberately NOT awaited directly: archiver's `abort()` (called from
    // the 'data' listener above on a byte-limit breach) can be invoked WHILE
    // finalize() is still flushing the ZIP's central directory/EOCD — in
    // that interleaving, finalize()'s own returned promise can hang forever
    // and never settle, even though the underlying write stream still
    // closes normally. `writeFinished` (below) is the authoritative
    // completion signal regardless: it already resolves on the write
    // stream's 'close' event and rejects on the SAME 'error' event finalize()
    // would have rejected with, so nothing is lost by not awaiting this
    // promise directly — only the hang risk is removed. The `.catch` exists
    // solely to prevent an unhandled-rejection crash if finalize() ever
    // rejects independently of the 'error' event archive/writeFinished
    // already listen for.
    archive.finalize().catch(() => {});
    await writeFinished;

    // KVKK-HIGH-004 remediation (P0): the streaming byteLimitExceeded check
    // above runs BEFORE manifest.json is appended and BEFORE archive.finalize()
    // writes the ZIP's own central directory/EOCD — both add real bytes on
    // top of whatever the entity streams alone produced, so a payload that
    // looked within budget mid-stream can still finish over the ceiling.
    // This second check uses the REAL completed file's on-disk size (ground
    // truth, not the async 'data'-event accumulator) as the authoritative
    // final gate, strictly before anything is persisted or uploaded.
    const finalStat = await fs.promises.stat(tempFilePath);
    if (byteLimitExceeded || finalStat.size > maxBytes) {
      throw new ClinicBulkExportSizeLimitExceededError();
    }
    // Structural sanity check on the real bytes just written — see
    // ClinicBulkExportZipIntegrityError. Runs on the same real file the
    // upload below would otherwise ship, so a truncated/corrupted temp ZIP
    // can never reach storage.
    await validateZipStructuralIntegrity(tempFilePath, finalStat.size, fileNames);

    // Deterministic from clinicId+jobId alone — computing it here (before
    // upload even begins) and persisting it to the row NOW, while still
    // 'generating', is the P0 orphan-artifact fix: every failure from this
    // point on (upload throws, lease lost, the ready update itself throws,
    // the ready update loses the race, or the process crashes outright) can
    // find this row again via its storageKey and clean up — see the catch
    // block below and cleanupExpiredClinicBulkExportArchives. Download stays
    // impossible throughout because every download path gates on
    // status==='ready', never on storageKey alone.
    const storageKey = buildExportStorageKey(job.clinicId, jobId);
    if (beforePlannedKeyPersistForTest) await beforePlannedKeyPersistForTest();
    // Second of three flag/allowlist re-checks — strictly before the planned
    // key is persisted and strictly before any bytes are uploaded.
    assertClinicBulkExportGenerationAllowed(job.organizationId);
    const plannedKeyResult = await prisma.clinicBulkExportArchive.updateMany({
      where: {
        id: jobId,
        status: 'generating',
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { gte: new Date() } }],
      },
      data: { storageKey },
    });
    if (plannedKeyResult.count === 0) {
      // Lost the row's generating claim before an upload was ever attempted
      // — nothing was written to storage under this key, so there is
      // nothing to clean up; just fail without uploading.
      throw new ClinicBulkExportLeaseLostError();
    }

    const doUpload = uploadForTest ?? saveFileFromPath;
    await doUpload(storageKey, tempFilePath, 'application/zip');
    tempFilePath = null;

    if (heartbeat.isLeaseLost()) {
      // The lease was lost sometime during finalize/upload (after the last
      // per-batch checkpoint) — the artifact we just uploaded must never
      // become reachable via a 'ready' row. The row already carries
      // storageKey (persisted above), so the catch block's orphan cleanup
      // below deletes it — no ad hoc delete needed here.
      throw new ClinicBulkExportLeaseLostError();
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + getDownloadTokenTtlMs());

    // Third and final flag/allowlist re-check — strictly before the row can
    // ever become 'ready'. storageKey is already persisted at this point, so
    // throwing here routes through the catch block's orphan-artifact
    // cleanup exactly like a lost lease would, deleting the real artifact
    // that was just uploaded.
    assertClinicBulkExportGenerationAllowed(job.organizationId);

    const result = await prisma.clinicBulkExportArchive.updateMany({
      where: {
        id: jobId,
        status: 'generating',
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { gte: now } }],
      },
      data: { status: 'ready', storageKey, manifestJson: manifest as any, expiresAt },
    });

    if (result.count === 0) {
      // Lost the lease to a sweep between finalize and this update — never
      // resurrect the row. storageKey is already persisted on the row, so
      // the catch block's orphan cleanup discards the just-written artifact.
      throw new ClinicBulkExportLeaseLostError();
    }

    // Background-worker event, not gating an HTTP success response — the
    // regular fire-and-forget-safe writeAuditLog is appropriate here (only
    // creation, download-token issuance, and download claim/start use the
    // transaction-coupled, fail-closed writeAuditLogInTx).
    await writeAuditLog({
      organizationId: job.organizationId,
      clinicId: job.clinicId,
      actorUserId: job.requestedByUserId,
      actorRole: 'system',
      action: 'clinic_bulk_export_generation_completed',
      entityType: 'clinic',
      entityId: job.clinicId,
      description: 'Clinic bulk export generation completed',
      metadata: { jobId, schemaVersion: EXPORT_SCHEMA_VERSION, entityCounts },
    });
  } catch (err) {
    if (tempFilePath) await fs.promises.unlink(tempFilePath).catch(() => {});
    const failureCode =
      err instanceof ClinicBulkExportSizeLimitExceededError
        ? 'SIZE_LIMIT_EXCEEDED'
        : err instanceof ClinicBulkExportZipIntegrityError
          ? 'ZIP_INTEGRITY_FAILED'
          : err instanceof ClinicBulkExportLeaseLostError
            ? 'LEASE_LOST'
            : err instanceof ClinicBulkExportFeatureDisabledError
              ? 'FEATURE_DISABLED'
              : 'GENERATION_ERROR';
    console.error('[clinic-bulk-export] generation failed', { jobId, failureCode, ...safeErrorFields(err) });
    await prisma.clinicBulkExportArchive
      .updateMany({ where: { id: jobId, status: 'generating' }, data: { status: 'failed', failureCode } })
      .catch(() => {});
    // Immediate, awaited (never fire-and-forget) orphan-artifact cleanup:
    // if a storageKey was ever persisted on this row (the guarded pre-upload
    // persist above), any failure from that point on must never leave a
    // full sensitive clinic ZIP reachable in storage with no durable
    // reference a future cleanup pass could find and delete. Reuses
    // attemptArtifactDeletion (gated on status !== 'ready', which this row
    // always satisfies here) so the retry/idempotent-missing-object
    // semantics are identical to the cleanup cron's own sweep.
    await attemptArtifactDeletion(jobId).catch(() => {});
    await writeAuditLog({
      organizationId: job.organizationId,
      clinicId: job.clinicId,
      actorUserId: job.requestedByUserId,
      actorRole: 'system',
      action: 'clinic_bulk_export_generation_failed',
      entityType: 'clinic',
      entityId: job.clinicId,
      description: 'Clinic bulk export generation failed',
      metadata: { jobId, failureCode },
    });
  } finally {
    heartbeat.stop();
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────

/**
 * Called by the cleanup cron (clinicBulkExportCleanupJob.ts). Reuses
 * expireArchiveIfPastTtl() for the ready->expired transition (no duplicated
 * expiry logic), retries any previously-failed storage deletion, and sweeps
 * abandoned queued/generating rows past their lease — a backstop, since the
 * worker's own tick already does this first in normal operation.
 *
 * `deleteForTest` is threaded straight through to attemptArtifactDeletion —
 * see its doc comment. Never passed by any production caller.
 */
export async function cleanupExpiredClinicBulkExportArchives(
  now: Date = new Date(),
  deleteForTest?: typeof deleteFile,
): Promise<{
  expired: number;
  deleted: number;
  sweptAbandoned: number;
}> {
  // KVKK-HIGH-004 remediation (P1): three passes, strictly in this order, so
  // a row that needs BOTH the abandoned-lease sweep AND artifact deletion
  // (a process-crashed 'generating' row already carrying a planned
  // storageKey) is fully cleaned up in this SAME run — previously the
  // abandoned-lease sweep ran last, so such a row was still 'generating'
  // (not yet 'expired'/'failed') when the artifact-deletion query above ran
  // moments earlier in the same tick, silently deferring its cleanup to the
  // NEXT cron tick (15 minutes later) for no reason.
  //
  // 1) Expire ready rows past their TTL.
  const readyPastTtl = await prisma.clinicBulkExportArchive.findMany({
    where: { status: 'ready', expiresAt: { lt: now } },
    select: { id: true, status: true, expiresAt: true },
  });
  let expired = 0;
  for (const row of readyPastTtl) {
    const status = await expireArchiveIfPastTtl(row, now);
    if (status === 'expired') expired++;
  }

  // 2) Sweep abandoned queued/generating rows (lease expired, no worker
  // renewing it) to 'failed' BEFORE the artifact-deletion pass below, so a
  // row this sweep just terminated is already eligible for step 3 in the
  // very same call.
  const sweptAbandoned = await prisma.clinicBulkExportArchive.updateMany({
    where: {
      status: { in: ['queued', 'generating'] },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    data: { status: 'failed', failureCode: 'LEASE_EXPIRED' },
  });

  // 3) Retry artifact deletion for EVERY terminal, non-downloadable row still
  // holding a storageKey — not just 'expired'. A 'failed' row can carry a
  // storageKey too (the P0 orphan-artifact fix persists it on the row
  // BEFORE upload begins, so a failure after that point — including a
  // process crash the in-process catch block never got to run for, or the
  // abandoned-lease sweep in step 2 above — still leaves the row findable
  // here, in the SAME pass). attemptArtifactDeletion itself is gated on
  // status !== 'ready', so this can never touch a downloadable artifact.
  const needingDeletion = await prisma.clinicBulkExportArchive.findMany({
    where: { status: { in: ['expired', 'failed'] }, storageKey: { not: null } },
    select: { id: true },
  });
  let deleted = 0;
  for (const row of needingDeletion) {
    if (await attemptArtifactDeletion(row.id, now, deleteForTest)) deleted++;
  }

  return { expired, deleted, sweptAbandoned: sweptAbandoned.count };
}

// ── Process-local stale temp-file sweep (crash-safety remediation) ────────

/**
 * Process-local (NOT DB-locked, NOT part of cleanupExpiredClinicBulkExportArchives
 * above) sweep of THIS HOST's own OS temp directory for orphaned bulk-export
 * temp ZIPs. The DB-based cleanup only ever knows about `storageKey` (final
 * storage) — it has no way to discover a local scratch file a crashed
 * process left behind before ever reaching the planned-storageKey persist
 * (or one left behind by any bug that skips the ordinary catch-block
 * unlink). Must run on EVERY worker replica independently (each has its own
 * local temp dir, invisible to any other replica or to the singleton
 * DB-locked cleanup job) — see clinicBulkExportWorker.ts, which calls this
 * once at startup (recovers from a crash that happened before this process
 * last exited) and again on every subsequent tick (recovers from a crash of
 * a sibling worker instance on the same host, or of this same process
 * between ticks).
 *
 * Safety: only ever considers files matching the recognized bulk-export temp
 * naming pattern (parseExportTempFileName) inside the dedicated private temp
 * directory — never any other file that might happen to live alongside it.
 * A recognized file is deleted ONLY when BOTH:
 *   - it is older than `maxAgeMs` (default: double the generation lease, so
 *     a legitimately still-writing job's temp file is never touched purely
 *     because the sweep happened to run mid-write); AND
 *   - the job id encoded in its filename is NOT currently a 'generating' row
 *     with an unexpired lease (i.e. it is provably not still being actively
 *     written by any worker holding a live claim).
 * A DB lookup failure for a candidate file is treated as "cannot confirm
 * inactive" and does NOT authorize deletion by itself — the file is simply
 * skipped this tick and reconsidered on the next one.
 */
export async function sweepStaleClinicBulkExportTempFiles(
  now: Date = new Date(),
  maxAgeMs: number = getGenerationLeaseMs() * 2,
): Promise<number> {
  const dir = getExportTempDir();
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return 0; // directory doesn't exist yet (nothing has ever generated on this host) — nothing to sweep
  }

  let deleted = 0;
  for (const name of entries) {
    const parsed = parseExportTempFileName(name);
    if (!parsed) continue; // never touch a file this sweep doesn't recognize as its own

    const filePath = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      continue; // vanished between readdir and stat — nothing to do
    }
    if (!stat.isFile()) continue;
    if (now.getTime() - stat.mtimeMs < maxAgeMs) continue;

    try {
      const row = await prisma.clinicBulkExportArchive.findUnique({
        where: { id: parsed.jobId },
        select: { status: true, leaseExpiresAt: true },
      });
      const activelyGenerating =
        row?.status === 'generating' && row.leaseExpiresAt !== null && row.leaseExpiresAt.getTime() > now.getTime();
      if (activelyGenerating) continue; // never delete the temp file of an actively generating job
    } catch (err) {
      console.error('[clinic-bulk-export] stale-temp sweep: DB lookup failed, skipping file this tick', {
        fileName: name,
        ...safeErrorFields(err),
      });
      continue;
    }

    await fs.promises.unlink(filePath).catch(() => {});
    deleted++;
  }
  return deleted;
}
