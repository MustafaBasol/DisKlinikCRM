/**
 * public.ts — Imaging internal lifecycle facade (F2-IMPL-001-A).
 *
 * Additive, unused-at-merge-time skeleton implementing exactly the accepted
 * F2-CC-14 / `ImagingLifecyclePort` four-method slice (see
 * docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md §9 and
 * docs/program/evidence/F2-PREP-008_STAGE1_IMAGING_FACADE_PREP_AND_AUTHORIZATION.md §9).
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
 * ⚠ KNOWN GAP — TENANT AUTHORIZATION IS NOT ENFORCED (status corrected
 * 2026-08-03; see docs/program/evidence/F2-IMPL-001-A_* and the proposed
 * F2-PREP-009 contract amendment). The accepted F2-CC-14 signature carries
 * no clinicId/principal/context parameter for markStorageMissing/
 * redactForAnonymization/checkImageStorageExists. Every one of the three
 * methods re-derives ImagingImage.clinicId against its own
 * ImagingStudy.clinicId before any read/mutation and fails closed
 * (ImagingNotFoundError, indistinguishable from a genuinely-missing row) if
 * those two stored values disagree — but that is a DATA-INTEGRITY
 * CONSISTENCY CHECK, not caller tenant authorization: there is no caller
 * clinicId, principal, or scoped context anywhere in these three signatures
 * to check the resolved clinicId against. A caller holding a valid imageId
 * belonging to another tenant can read/mutate that image today as long as
 * the image/study clinicIds are internally consistent (which they always
 * are for every non-corrupted row). The claim that imageId values are only
 * obtainable via the clinicId-scoped getImagesForLifecycleReview query is a
 * workflow convention, not an enforced boundary — nothing in this module
 * prevents a caller from invoking these three methods with an imageId it
 * obtained any other way. This module is additive and has zero production
 * callers (see unused-facade proof below); no caller may be wired to it
 * until F2-PREP-009 defines and this file implements an enforceable tenant
 * model.
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

// ─── Internal ownership re-derivation ───────────────────────────────────────

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
 * Re-derives ownership via ImagingImage -> ImagingStudy -> clinicId. Returns
 * null (never throws) if the image does not exist, its study relation is
 * missing, or the denormalized ImagingImage.clinicId disagrees with its own
 * study's clinicId — every one of those cases is treated identically by
 * every caller below (ImagingNotFoundError), so no cross-tenant/data-
 * integrity distinction is ever observable from the outside.
 */
async function findOwnedImage(imageId: string): Promise<OwnedImage | null> {
  const image = await prisma.imagingImage.findFirst({
    where: { id: imageId },
    select: {
      id: true,
      studyId: true,
      clinicId: true,
      originalName: true,
      filePath: true,
      study: { select: { id: true, clinicId: true, patientId: true, legalHold: true } },
    },
  });
  if (!image || !image.study || image.study.clinicId !== image.clinicId) {
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
 */
export async function markStorageMissing(imageId: string): Promise<void> {
  const image = await findOwnedImage(imageId);
  if (!image) throw new ImagingNotFoundError();

  const result = await prisma.imagingImage.updateMany({
    where: { id: imageId, clinicId: image.clinicId, study: { clinicId: image.clinicId } },
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
 */
export async function redactForAnonymization(imageId: string, reason: RedactionReason): Promise<void> {
  if (!isRedactionReason(reason)) throw new ImagingInvalidRedactionReasonError();

  const image = await findOwnedImage(imageId);
  if (!image) throw new ImagingNotFoundError();
  if (image.study.legalHold) throw new ImagingLegalHoldViolationError();
  if (image.originalName === REDACTED_PLACEHOLDER) return;

  const result = await prisma.imagingImage.updateMany({
    where: { id: imageId, clinicId: image.clinicId, study: { clinicId: image.clinicId } },
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
 * `checkImageStorageExists` itself. This keeps the accepted F2-CC-14
 * signature (`checkImageStorageExists(imageId: string): Promise<boolean>`)
 * exactly as accepted, with zero drift, even an additive/optional one.
 */
let storageExistenceChecker: (ref: string) => Promise<boolean> = fileExists;

/**
 * Test-only hook. NOT part of the accepted ImagingLifecyclePort four-method
 * slice — never call this from production code. Exists solely so a unit
 * test can deterministically force a storage-provider failure without a
 * live S3-compatible endpoint, without altering `checkImageStorageExists`'s
 * accepted single-parameter signature. Pass `null` to restore the real
 * fileStorage.ts implementation.
 */
export function __setImagingStorageExistenceCheckerForTest(
  override: ((ref: string) => Promise<boolean>) | null,
): void {
  storageExistenceChecker = override ?? fileExists;
}

/**
 * Verifies ownership before touching storage, then delegates entirely to the
 * existing fileStorage.ts abstraction (no S3/local branching here). A
 * provider failure (fileExists throwing on an unexpected, non-404-shaped
 * error) is converted to the facade's own sanitized error — never a raw
 * provider exception, never the storage key, crossing this boundary.
 */
export async function checkImageStorageExists(imageId: string): Promise<boolean> {
  const image = await findOwnedImage(imageId);
  if (!image) throw new ImagingNotFoundError();

  try {
    return await storageExistenceChecker(image.filePath);
  } catch {
    throw new ImagingStorageUnavailableError();
  }
}
