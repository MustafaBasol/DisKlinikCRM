/**
 * public.ts — Imaging internal lifecycle facade (F2-IMPL-001-A-R2).
 *
 * Additive, unused-at-merge-time facade implementing the F2-PREP-009-amended
 * `ImagingLifecyclePort` four-method slice (see
 * docs/program/architecture/F2-PREP-009_IMAGING_LIFECYCLE_PORT_TENANT_CONTEXT_CONTRACT_AMENDMENT.md,
 * amending F2-PREP-006-E §9 / F2-PREP-008 §9.4).
 *
 * Zero callers at merge time (docs/program/evidence/F2-IMPL-001-A_*): the
 * three existing Privacy/KVKK direct-Prisma callers
 * (deletionReviewInventory.ts, orphanFileInspection.ts,
 * patientAnonymization.ts) keep their current direct access unchanged.
 * Migrating them onto this facade is Stage 3 caller-migration work, not
 * performed here.
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
import { fileExists } from '../fileStorage.js';

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
 * Redacts originalName to the shared anonymization placeholder. Preserves
 * the ImagingImage/ImagingStudy structural records (never deletes a row).
 * Refuses (ImagingLegalHoldViolationError) if the owning study is under
 * legal hold — never a silent bypass. Idempotent: an already-redacted row
 * is a safe no-op, matching patientAnonymization.ts's own
 * redactPatientImagingImages behavior.
 *
 * `clinicId` must already be authorization-validated by the caller (F2-PREP-009
 * §3) — this facade applies it as a trusted predicate on both the read and
 * the write, it does not re-run authorization.
 */
export async function redactForAnonymization(
  clinicId: string,
  imageId: string,
  reason: RedactionReason,
): Promise<void> {
  if (!isRedactionReason(reason)) throw new ImagingInvalidRedactionReasonError();

  const image = await findOwnedImage(clinicId, imageId);
  if (!image) throw new ImagingNotFoundError();
  if (image.study.legalHold) throw new ImagingLegalHoldViolationError();
  if (image.originalName === REDACTED_PLACEHOLDER) return;

  const result = await prisma.imagingImage.updateMany({
    where: { id: imageId, clinicId, study: { clinicId } },
    data: { originalName: REDACTED_PLACEHOLDER },
  });
  if (result.count === 0) throw new ImagingNotFoundError();
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
let storageExistenceChecker: (ref: string) => Promise<boolean> = fileExists;

/**
 * Test-only hook. NOT part of the accepted ImagingLifecyclePort four-method
 * slice — never call this from production code. Exists solely so a unit
 * test can deterministically force a storage-provider failure without a
 * live S3-compatible endpoint, without altering `checkImageStorageExists`'s
 * accepted signature. Pass `null` to restore the real fileStorage.ts
 * implementation.
 */
export function __setImagingStorageExistenceCheckerForTest(
  override: ((ref: string) => Promise<boolean>) | null,
): void {
  storageExistenceChecker = override ?? fileExists;
}

/**
 * Verifies ownership (scoped by the caller-supplied `clinicId`) before
 * touching storage, then delegates entirely to the existing fileStorage.ts
 * abstraction (no S3/local branching here). A provider failure (fileExists
 * throwing on an unexpected, non-404-shaped error) is converted to the
 * facade's own sanitized error — never a raw provider exception, never the
 * storage key, crossing this boundary.
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
