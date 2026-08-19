/**
 * public.ts — Imaging internal lifecycle facade (F2-IMPL-001-A-R2, R3).
 *
 * Additive, unused-at-merge-time facade implementing the F2-PREP-009-amended
 * `ImagingLifecyclePort` four-method slice (see
 * docs/program/architecture/F2-PREP-009_IMAGING_LIFECYCLE_PORT_TENANT_CONTEXT_CONTRACT_AMENDMENT.md,
 * amending F2-PREP-006-E §9 / F2-PREP-008 §9.4).
 *
 * Zero callers of the four-method slice at the F2-IMPL-001-A merge point
 * (docs/program/evidence/F2-IMPL-001-A_*). The three Privacy/KVKK direct-
 * Prisma callers that motivated this facade — patientAnonymization.ts,
 * orphanFileInspection.ts, deletionReviewInventory.ts — were migrated onto
 * it in later, separate Stage 3 caller-migration tasks (F2-STAGE3-IMPL-001,
 * F2-GAPA-001, F2-GAPB-001 respectively; see each file's own imports of this
 * module). The additive `getBridgeStudyIdsForPatient` query below
 * (F2-STAGE3-GAPC-001) adds a fourth caller, migrating
 * patientActivityHistoryExport.ts's former direct `prisma.imagingStudy.findMany`
 * dependency off of the Imaging domain.
 *
 * Excluded by design (explicitly not authorized for this slice): any command
 * touching `LinkImagingStudy` (CT-23 surface) or
 * `UpdateImagingRequest`/`CancelImagingRequest` (CT-32/CR-03 surface) — both
 * remain unresolved, pre-contract-exposure blockers.
 *
 * TENANT AUTHORIZATION (F2-PREP-009 Option A, corrected 2026-08-03): every
 * method now takes an explicit, caller-supplied `clinicId` as its first
 * argument. Per F2-PREP-009 §3, that `clinicId` MUST already be an
 * authorization-validated clinic scope — resolved by the caller via
 * `resolveEffectiveClinicId`/`validateAndGetClinicIdScope`/
 * `getAccessibleClinicIds` (server/src/utils/clinicScope.ts) or an equivalent
 * already-access-scoped record lookup (e.g. patientPrivacy.ts's
 * `resolvePatient()`) — never a raw, unvalidated `req.user.clinicId`/JWT
 * default passed straight through. This facade does not re-run that
 * authorization itself (it is a data boundary, not the authorization
 * boundary); it treats the supplied `clinicId` as trusted and applies it in
 * every DB predicate, on every method, with no exception. Every read AND
 * every write predicate is `{ id: imageId, clinicId, study: { clinicId } }`
 * — a cross-tenant `imageId`, a missing `imageId`, and an
 * image/study-clinicId denormalization mismatch all fail closed identically
 * (ImagingNotFoundError) at the database level; none is distinguishable from
 * outside this module (no existence side-channel). Mutations
 * (markStorageMissing/redactForAnonymization) re-apply that exact same full
 * predicate on their own `updateMany` call — never a read-then-trust-the-
 * earlier-read pattern, never an unscoped `{ id: imageId }` write.
 *
 * LEGAL-HOLD ATOMICITY (F2-IMPL-001-A-R3, 2026-08-03): `redactForAnonymization`
 * additionally requires `study.legalHold: false` inside its own mutation
 * predicate — `{ id: imageId, clinicId, study: { clinicId, legalHold: false } }`
 * — not only as an earlier in-memory check. This closes a TOCTOU window where
 * legal hold could be acquired after the read but before the write, which
 * previously still let the write through. A 0-row mutation result is
 * classified using a second application of the ordinary tenant-scoped
 * `findOwnedImage` lookup (never an unscoped-by-id lookup): not found under
 * this tenant → `ImagingNotFoundError`; already redacted (a benign
 * concurrent-writer race) → treated as a completed idempotent no-op; any
 * other case → `ImagingLegalHoldViolationError`, since `study.legalHold` is
 * the only predicate component capable of changing between the read and the
 * write. A cross-tenant `imageId` is rejected before this logic is ever
 * reached (the initial `findOwnedImage` call already returns `null`), so it
 * can never surface `ImagingLegalHoldViolationError` — only
 * `ImagingNotFoundError`, identical to every other not-found case.
 *
 * Audit ownership: this facade performs no audit/activity-log writes. Audit
 * ownership remains with the calling service, matching current behavior
 * (patientAnonymization.ts and orphanFileInspection.ts already write their
 * own summary audit/activity entries around their direct-Prisma calls) — a
 * future migrated caller continues to own that write, so wiring this facade
 * in later never produces a duplicate audit entry.
 *
 * Transaction ownership: none of the four methods claims atomicity across
 * more than one write (each is a single-row read or single-row metadata
 * update) and none claims atomicity across the storage/DB gap — that gap
 * (BLK-01) is pre-existing, unresolved, and out of scope for this internal,
 * in-process design.
 */

import prisma from '../../db.js';
import { imagingFileExists } from '../fileStorage.js';

// ─── Typed errors (small closed set, never a raw Prisma/provider error) ────

export class ImagingNotFoundError extends Error {
  readonly code = 'IMAGING_NOT_FOUND' as const;
  constructor() {
    super('Imaging resource not found.');
    this.name = 'ImagingNotFoundError';
  }
}

export class ImagingLegalHoldViolationError extends Error {
  readonly code = 'IMAGING_LEGAL_HOLD_VIOLATION' as const;
  constructor() {
    super('Imaging resource is under legal hold.');
    this.name = 'ImagingLegalHoldViolationError';
  }
}

export class ImagingStorageUnavailableError extends Error {
  readonly code = 'IMAGING_STORAGE_UNAVAILABLE' as const;
  constructor() {
    super('Imaging storage provider is unavailable.');
    this.name = 'ImagingStorageUnavailableError';
  }
}

export class ImagingInvalidRedactionReasonError extends Error {
  readonly code = 'IMAGING_INVALID_REDACTION_REASON' as const;
  constructor() {
    super('Redaction reason is not a recognized value.');
    this.name = 'ImagingInvalidRedactionReasonError';
  }
}

export type ImagingLifecycleError =
  | ImagingNotFoundError
  | ImagingLegalHoldViolationError
  | ImagingStorageUnavailableError
  | ImagingInvalidRedactionReasonError;

// ─── DTO (purpose-built, never a raw Prisma model) ──────────────────────────

export interface ImagingLifecycleImageDto {
  id: string;
  studyId: string;
  clinicId: string;
  patientId: string | null;
  legalHold: boolean;
  storageKey: string;
  /**
   * Mirrors `ImagingImage.fileSize` (Prisma schema: `Int`, not nullable) —
   * never converted/rounded, never fabricated when absent, because absence
   * cannot occur at the DB level (F2-STAGE3-DEFERRED-GAPB-001). Added solely
   * so deletionReviewInventory.ts can compute estimatedBytes without its own
   * direct Prisma read; not a general-purpose Imaging field.
   */
  fileSize: number;
}

// ─── RedactionReason (small closed set; reuses PatientPrivacyRequest's own
// existing requestType vocabulary — 'anonymization', 'deletion_review' —
// rather than inventing new terms) ───────────────────────────────────────

export const REDACTION_REASONS = ['anonymization', 'deletion_review'] as const;
export type RedactionReason = (typeof REDACTION_REASONS)[number];

export function isRedactionReason(value: unknown): value is RedactionReason {
  return typeof value === 'string' && (REDACTION_REASONS as readonly string[]).includes(value);
}

// Matches patientAnonymization.ts's own ANON_TEXT constant exactly, so a row
// redacted by either path is recognized as already-redacted by the other.
const REDACTED_PLACEHOLDER = '[ANONYMIZED]';

// ─── Internal ownership lookup ──────────────────────────────────────────────

type OwnedImage = {
  id: string;
  studyId: string;
  clinicId: string;
  originalName: string;
  filePath: string;
  study: {
    id: string;
    clinicId: string;
    patientId: string | null;
    legalHold: boolean;
  };
};

/**
 * Fetches the image ONLY if it belongs to the caller-supplied `clinicId` on
 * BOTH `ImagingImage.clinicId` and `ImagingStudy.clinicId` — the caller's
 * `clinicId` is trusted (already authorization-validated by the caller, per
 * F2-PREP-009 §3) and applied as a top-level, non-optional predicate, not a
 * post-fetch comparison. A missing image, a cross-tenant image, and an
 * image/study clinicId denormalization mismatch all resolve to `null` here —
 * every one of those cases is treated identically by every caller below
 * (ImagingNotFoundError), so none is ever distinguishable from outside this
 * module.
 */
async function findOwnedImage(clinicId: string, imageId: string): Promise<OwnedImage | null> {
  const image = await prisma.imagingImage.findFirst({
    where: { id: imageId, clinicId, study: { clinicId } },
    select: {
      id: true,
      studyId: true,
      clinicId: true,
      originalName: true,
      filePath: true,
      study: { select: { id: true, clinicId: true, patientId: true, legalHold: true } },
    },
  });
  if (!image || !image.study) {
    return null;
  }
  return image as OwnedImage;
}

// ─── Commands ────────────────────────────────────────────────────────────

/**
 * Stamps storageVerifiedMissingAt on the image row. Never deletes the row,
 * never deletes a physical file, never touches legal hold. Idempotent — a
 * repeat call simply re-stamps the timestamp, matching
 * orphanFileInspection.ts's markConfirmedMissing semantics.
 *
 * `clinicId` must already be authorization-validated by the caller (F2-PREP-009
 * §3) — this facade applies it as a trusted predicate on both the read and
 * the write, it does not re-run authorization.
 */
export async function markStorageMissing(clinicId: string, imageId: string): Promise<void> {
  const image = await findOwnedImage(clinicId, imageId);
  if (!image) throw new ImagingNotFoundError();

  const result = await prisma.imagingImage.updateMany({
    where: { id: imageId, clinicId, study: { clinicId } },
    data: { storageVerifiedMissingAt: new Date() },
  });
  if (result.count === 0) throw new ImagingNotFoundError();
}

/**
 * Test-only synchronization seam (F2-IMPL-001-A-R3). NOT part of the
 * accepted ImagingLifecyclePort four-method slice — never call this from
 * production code. Lets a test deterministically pause
 * `redactForAnonymization` at the exact point between its ownership/legal-
 * hold read and its conditional mutation, closing a specific TOCTOU race
 * window without a timing-based sleep. The barrier is a bare `() => Promise
 * <void>` — it receives no arguments and returns no value, so it cannot
 * observe or influence `clinicId`/`imageId`/the predicate being built; it can
 * only delay when the already-in-flight call resumes. Pass `null` to restore
 * the real no-op default. See Option B evidence on
 * `__setImagingStorageExistenceCheckerForTest` below — the same reasoning
 * applies here (process-local, sequential-only test suite, finally-restored,
 * zero production importer, cannot alter tenant predicates).
 */
let preMutationBarrier: (() => Promise<void>) | null = null;

export function __setRedactionPreMutationBarrierForTest(
  barrier: (() => Promise<void>) | null,
): void {
  preMutationBarrier = barrier;
}

/**
 * Redacts originalName to the shared anonymization placeholder. Preserves
 * the ImagingImage/ImagingStudy structural records (never deletes a row).
 * Refuses (ImagingLegalHoldViolationError) if the owning study is under
 * legal hold — never a silent bypass, and never merely a point-in-time
 * in-memory check: the `legalHold: false` condition is re-applied inside the
 * mutation's own WHERE predicate (F2-IMPL-001-A-R3), so a hold acquired
 * after the initial read but before the write still blocks the write
 * atomically at the database level. Idempotent: an already-redacted row is a
 * safe no-op, matching patientAnonymization.ts's own
 * redactPatientImagingImages behavior — but legal hold takes precedence over
 * that idempotent short-circuit whenever the row's CURRENT state (as read at
 * the top of this call) shows it held, even if no further field change
 * would otherwise be needed (F2-PREP-009 does not specify this ordering;
 * this task fixes it explicitly — see F2-IMPL-001-A-R3 evidence §11 for the
 * chosen-behavior rationale).
 *
 * `clinicId` must already be authorization-validated by the caller (F2-PREP-009
 * §3) — this facade applies it as a trusted predicate on both the read and
 * the write, it does not re-run authorization.
 *
 * MUTATION OUTCOME (F2-STAGE3-IMPL-001-R1): returns `{ changed: boolean }` —
 * `changed: true` only when THIS call actually flipped the row's
 * originalName from unredacted to redacted; `changed: false` whenever the
 * row was already redacted, whether that redaction happened on an earlier
 * call (the top-of-function idempotent short-circuit) or by a concurrent
 * writer that won the race between this call's read and its write (the
 * zero-row-recheck branch below). This is a mutation-outcome signal only —
 * never lifecycle read-state, never PII/PHI, and existing callers that
 * ignore the return value are unaffected (legal-hold/not-found/tenant
 * semantics and every DB predicate are byte-for-byte unchanged from
 * F2-IMPL-001-A-R3).
 */
export async function redactForAnonymization(
  clinicId: string,
  imageId: string,
  reason: RedactionReason,
): Promise<{ changed: boolean }> {
  if (!isRedactionReason(reason)) throw new ImagingInvalidRedactionReasonError();

  const image = await findOwnedImage(clinicId, imageId);
  if (!image) throw new ImagingNotFoundError();
  if (image.study.legalHold) throw new ImagingLegalHoldViolationError();
  if (image.originalName === REDACTED_PLACEHOLDER) return { changed: false };

  if (preMutationBarrier) await preMutationBarrier();

  // The mutation predicate re-checks legalHold: false at write time — never
  // relies solely on the read above. A concurrently-acquired hold between
  // the read and this statement now causes a 0-row result here instead of a
  // silently successful write. It also re-checks originalName !== the
  // placeholder (F2-STAGE3-IMPL-001-R1) — an atomic compare-and-set, not
  // just the top-of-function idempotent short-circuit above: without this,
  // two genuinely concurrent callers racing the same not-yet-redacted row
  // would BOTH match a WHERE clause that only constrains id/clinicId/
  // legalHold, both get a nonzero `updateMany` count, and both incorrectly
  // report `changed: true`. With it, exactly one writer's UPDATE can match
  // a row still holding the pre-redaction value; Postgres serializes the
  // second writer's UPDATE behind the first's row lock, and by the time it
  // re-evaluates its own WHERE clause the row already reads as redacted, so
  // it correctly falls into the zero-row branch below.
  const result = await prisma.imagingImage.updateMany({
    where: {
      id: imageId,
      clinicId,
      study: { clinicId, legalHold: false },
      originalName: { not: REDACTED_PLACEHOLDER },
    },
    data: { originalName: REDACTED_PLACEHOLDER },
  });
  if (result.count === 0) {
    // Zero-row classification uses ONLY a tenant-scoped follow-up
    // (findOwnedImage re-applies the exact same `{ id, clinicId,
    // study: { clinicId } }` tenant predicate as every other lookup in this
    // module) — never an unscoped-by-id lookup, which would create a
    // cross-tenant existence oracle. A cross-tenant/missing/denormalized-
    // mismatch imageId already returned null and threw ImagingNotFoundError
    // above, before this point was ever reached, so this recheck only runs
    // for an imageId already proven to belong to this clinicId.
    const recheck = await findOwnedImage(clinicId, imageId);
    if (!recheck) throw new ImagingNotFoundError();
    if (recheck.originalName === REDACTED_PLACEHOLDER) return { changed: false }; // completed by a concurrent writer; same end-state
    // Row exists, belongs to this tenant, and is not yet redacted — the
    // only predicate field capable of independently flipping between our
    // read and our write is study.legalHold (id/clinicId/study.clinicId are
    // immutable for a row's lifetime), so a 0-row result here is uniquely
    // explained by a legal hold that was in effect at mutation time.
    throw new ImagingLegalHoldViolationError();
  }
  return { changed: true };
}

// ─── Queries ─────────────────────────────────────────────────────────────

/**
 * Scoped by clinicId AND patientId together (never one without the other) —
 * cannot return another clinic's images. Deterministic ordering (createdAt
 * asc, id asc tiebreaker) for stable evidence/output. Returns only the
 * purpose-built DTO, never a raw ImagingImage/ImagingStudy record.
 *
 * Unaffected by the F2-PREP-009 amendment (this method already took an
 * explicit, real caller-supplied `clinicId` before this correction).
 */
export async function getImagesForLifecycleReview(
  clinicId: string,
  patientId: string,
): Promise<ImagingLifecycleImageDto[]> {
  const images = await prisma.imagingImage.findMany({
    where: { clinicId, study: { clinicId, patientId } },
    select: {
      id: true,
      studyId: true,
      clinicId: true,
      filePath: true,
      fileSize: true,
      study: { select: { patientId: true, legalHold: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  return images.map((image) => ({
    id: image.id,
    studyId: image.studyId,
    clinicId: image.clinicId,
    patientId: image.study?.patientId ?? null,
    legalHold: Boolean(image.study?.legalHold),
    storageKey: image.filePath,
    fileSize: image.fileSize,
  }));
}

/**
 * Module-private dependency factory for the storage-existence check.
 * Defaults to the real fileStorage.ts implementation. Overridable ONLY via
 * `__setImagingStorageExistenceCheckerForTest` below, which is a distinct,
 * clearly-non-accepted-contract export — never a parameter on
 * `checkImageStorageExists` itself. This keeps the accepted
 * `checkImageStorageExists(clinicId: string, imageId: string): Promise<boolean>`
 * signature exactly as accepted, with zero drift, even an additive/optional
 * one. This is unchanged from the pre-R2 implementation — F2-PREP-009 §12
 * explicitly leaves the exact test-double technique to this task, requiring
 * only that it not add a parameter to the accepted method: it does not (no
 * production importer — see the unused-facade proof test — cannot alter
 * authorization behavior, since it only swaps the storage-existence check,
 * never the clinicId predicate; and every test call restores the real
 * implementation in a `finally` block).
 */
let storageExistenceChecker: (ref: string) => Promise<boolean> = imagingFileExists;

/**
 * Test-only hook. NOT part of the accepted ImagingLifecyclePort four-method
 * slice — never call this from production code. Exists solely so a unit
 * test can deterministically force a storage-provider failure without a
 * live S3-compatible endpoint, without altering `checkImageStorageExists`'s
 * accepted signature. Pass `null` to restore the real fileStorage.ts
 * implementation.
 *
 * TEST SEAM REVIEW (F2-IMPL-001-A-R3, 2026-08-03) — Option B retained
 * (module-private variable + narrow test-only setter), not replaced with a
 * repository-native mocking method, on this precise evidence (no stronger
 * claim than what is verified):
 *   - Sequential execution: this file (imagingLifecycleFacade.test.ts) is a
 *     single straight-line `async function main()` — every `await test(...)`
 *     call is awaited in source order before the next one starts, in one
 *     Node process, over one shared `prisma` client. No `node:test`
 *     `describe`/parallel runner, no worker threads, no concurrent
 *     invocation of two tests that both touch this variable.
 *   - Process-local state: `storageExistenceChecker` (and the sibling
 *     `preMutationBarrier` above) are plain module-scope `let` bindings in
 *     this process's module cache — never persisted, never shared across a
 *     process boundary.
 *   - Restoration: every call site sets the override inside a `try` and
 *     restores it (`__setImagingStorageExistenceCheckerForTest(null)`) in a
 *     `finally` block — verified by direct inspection of
 *     imagingLifecycleFacade.test.ts §9-11.
 *   - Zero production importers: proved by this suite's own §13
 *     unused-facade-proof test, which scans routes/middleware/jobs/services
 *     for any import of this module at all.
 *   - Cannot alter tenant predicates: this seam only swaps which function
 *     answers "does the file exist" — it has no parameter and no access to
 *     `clinicId`/`imageId`/any Prisma `where` clause, so it structurally
 *     cannot weaken tenant scoping.
 *   - Scope of this claim: sequential-safety within THIS test file/process,
 *     nothing broader. This is not a claim that the seam is safe under
 *     concurrent/parallel test execution in general — if this suite is ever
 *     run with a concurrent test runner, this seam would need to move to a
 *     per-call parameter or async-local-storage-scoped mechanism instead.
 */
export function __setImagingStorageExistenceCheckerForTest(
  override: ((ref: string) => Promise<boolean>) | null,
): void {
  storageExistenceChecker = override ?? imagingFileExists;
}

/**
 * Verifies ownership (scoped by the caller-supplied `clinicId`) before
 * touching storage, then delegates entirely to the existing fileStorage.ts
 * abstraction — this facade itself does no S3/local/VPS2 branching; that
 * lives in fileStorage.ts's `imagingFileExists` (F4-IMAGING-001). A provider
 * failure (the existence check throwing on an unexpected, non-404-shaped
 * error) is converted to the facade's own sanitized error — never a raw
 * provider exception, never the storage key, crossing this boundary.
 *
 * `clinicId` must already be authorization-validated by the caller (F2-PREP-009
 * §3) — this facade applies it as a trusted predicate, it does not re-run
 * authorization.
 */
export async function checkImageStorageExists(clinicId: string, imageId: string): Promise<boolean> {
  const image = await findOwnedImage(clinicId, imageId);
  if (!image) throw new ImagingNotFoundError();

  try {
    return await storageExistenceChecker(image.filePath);
  } catch {
    throw new ImagingStorageUnavailableError();
  }
}

/**
 * getBridgeStudyIdsForPatient — F2-STAGE3-GAPC-001.
 *
 * Additive Imaging-owned query, separate from the F2-PREP-009 four-method
 * `ImagingLifecyclePort` slice above. Exists solely to let
 * patientActivityHistoryExport.ts (F2-IMG-AUDIT-003) resolve which
 * `ImagingStudy` rows were bridge-ingested for a patient without holding its
 * own direct Prisma dependency on the Imaging domain's `ImagingStudy` model.
 *
 * Returns ONLY study ids — never a raw `ImagingStudy` record, never
 * metadata, storage paths, modality, or timestamps. The caller only ever
 * needs the id list to join against `AuditLog.entityId`.
 *
 * Tenant predicate is `{ clinicId, patientId, source: 'bridge' }` together —
 * never id-only, never patient-only. `clinicId` must already be
 * authorization-validated by the caller (F2-PREP-009 §3); this facade
 * applies it as a trusted predicate, it does not re-run authorization. A
 * cross-tenant/wrong-clinic/wrong-patient/manual-upload combination all
 * resolve to an empty array — never an error, never a partial/leaked result.
 */
export async function getBridgeStudyIdsForPatient(
  clinicId: string,
  patientId: string,
): Promise<string[]> {
  const studies = await prisma.imagingStudy.findMany({
    where: { clinicId, patientId, source: 'bridge' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return studies.map((study) => study.id);
}
