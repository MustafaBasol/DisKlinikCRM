/**
 * deletionReviewInventory.ts — Dry-run deletion-review inventory
 * (docs/compliance/53-kvkk-attachment-imaging-lifecycle.md).
 *
 * Builds a read-only preview of what a "deletion review" for a patient would
 * cover. This module NEVER writes to the database — it only counts/sums, and
 * there is NO live-delete endpoint in this PR (see below).
 *
 * IMPORTANT — no lifecycle-category classification exists yet: PatientAttachment
 * has no field distinguishing "administrative" from any more sensitive
 * category. A prior revision of this module labelled every non-legal-hold
 * attachment `deletableAdministrative`, implying it was safe to bulk-delete —
 * that was an unsafe blanket classification (flagged in PR #160 review) and
 * has been removed. Every non-legal-hold PatientAttachment is now reported
 * under `unclassifiedRetained`, meaning: not eligible for any automated
 * deletion in this release, pending manual/legal review.
 *
 * Live deletion was previously exposed at
 * POST /patients/:id/privacy/deletion-review/execute; that endpoint has been
 * REMOVED entirely (not hardened) because it deleted physical
 * PatientAttachment rows/files with no binding to a specific
 * PatientPrivacyRequest workflow, no dry-run-snapshot requirement, and no
 * atomic DB+storage consistency guarantee. A future PR must introduce (a) a
 * lifecycle-category enum for PatientAttachment distinguishing genuinely
 * administrative documents from clinical ones, and (b) a workflow-bound
 * execute endpoint that only deletes items explicitly approved via a
 * PatientPrivacyRequest — see docs/compliance/53-kvkk-attachment-imaging-lifecycle.md
 * for the tracked follow-up.
 *
 * Imaging/clinical data is conservative-retain by design in this PR: there is
 * no category field to distinguish "administrative" vs "clinical/DICOM"
 * imaging, and the audit task explicitly forbids a one-click irreversible
 * hard-delete of diagnostic data pending legal sign-off (see ImagingStudy's
 * schema comment: "tanısal veri hiç hard-delete edilmez").
 */

import prisma from '../../db.js';

export interface DeletionReviewInventory {
  patientId: string;
  clinicId: string;
  structuredRecords: {
    appointments: number;
    appointmentRequests: number;
    contactRequests: number;
    treatmentCases: number;
    payments: number;
    paymentPlans: number;
    toothRecords: number;
  };
  attachments: {
    total: number;
    legalHold: number;
    /**
     * All non-legal-hold attachments. No PatientAttachment category enum
     * exists yet, so none of these are automatically deletable in this
     * release — they are RETAIN_REVIEW by default (manual/legal review
     * required). This field does NOT imply "safe to delete."
     */
    unclassifiedRetained: number;
    estimatedBytes: number;
  };
  imaging: {
    total: number;
    legalHold: number;
    /** Everything not under legal hold — still retained by default; imaging has no live-delete path in this PR. */
    retainedClinical: number;
    estimatedBytes: number;
  };
  /**
   * Stable machine-readable codes (+ counts where relevant) instead of
   * pre-rendered English prose — the frontend maps each code through the
   * patientPrivacy i18n namespace (deletionReview.blockers.<code>) so no
   * user-facing backend string ever needs translating (docs/compliance/53
   * P1 follow-up: deletion-review blocker text was previously hardcoded
   * English inside a Turkish UI).
   */
  blockers: DeletionReviewBlocker[];
  dryRun: true;
}

export type DeletionReviewBlockerCode =
  | 'DRY_RUN_ONLY'
  | 'ATTACHMENTS_LEGAL_HOLD'
  | 'IMAGING_RETENTION_NOT_APPROVED'
  | 'IMAGING_LEGAL_HOLD';

export interface DeletionReviewBlocker {
  code: DeletionReviewBlockerCode;
  count?: number;
}

export async function buildDeletionReviewInventory(params: {
  clinicId: string;
  patientId: string;
  organizationId: string;
}): Promise<DeletionReviewInventory> {
  const { clinicId, patientId, organizationId } = params;

  const [
    appointments,
    appointmentRequests,
    contactRequests,
    treatmentCases,
    payments,
    paymentPlans,
    toothRecords,
    attachmentRows,
    imagingImageRows,
  ] = await Promise.all([
    prisma.appointment.count({ where: { patientId, clinicId, deletedAt: null } }),
    prisma.appointmentRequest.count({ where: { patientId, clinicId } }),
    prisma.contactRequest.count({ where: { patientId, clinicId } }),
    prisma.treatmentCase.count({ where: { patientId, clinicId, deletedAt: null } }),
    prisma.payment.count({ where: { patientId, clinicId } }),
    prisma.paymentPlan.count({ where: { patientId, clinicId } }),
    prisma.toothRecord.count({ where: { patientId, clinicId } }),
    prisma.patientAttachment.findMany({
      where: { clinicId, patientId },
      select: { legalHold: true, fileSize: true },
    }),
    prisma.imagingImage.findMany({
      where: { clinicId, study: { patientId } },
      select: { fileSize: true, study: { select: { legalHold: true } } },
    }),
  ]);

  const attachmentLegalHold = attachmentRows.filter((a) => a.legalHold).length;
  const attachmentBytes = attachmentRows.reduce((sum, a) => sum + (a.fileSize ?? 0), 0);

  const imagingLegalHold = imagingImageRows.filter((i) => i.study?.legalHold).length;
  const imagingBytes = imagingImageRows.reduce((sum, i) => sum + (i.fileSize ?? 0), 0);

  const blockers: DeletionReviewBlocker[] = [{ code: 'DRY_RUN_ONLY' }];
  if (attachmentLegalHold > 0) {
    blockers.push({ code: 'ATTACHMENTS_LEGAL_HOLD', count: attachmentLegalHold });
  }
  if (imagingImageRows.length > 0) {
    blockers.push({ code: 'IMAGING_RETENTION_NOT_APPROVED' });
  }
  if (imagingLegalHold > 0) {
    blockers.push({ code: 'IMAGING_LEGAL_HOLD', count: imagingLegalHold });
  }

  // organizationId is accepted for API-shape consistency / future cross-checks
  // (e.g. verifying the patient truly belongs to this org before counting) —
  // the counts above are already clinicId-scoped which is sufficient today
  // since clinicId itself is only resolved after an org-scoped patient lookup
  // in the calling route.
  void organizationId;

  return {
    patientId,
    clinicId,
    structuredRecords: {
      appointments,
      appointmentRequests,
      contactRequests,
      treatmentCases,
      payments,
      paymentPlans,
      toothRecords,
    },
    attachments: {
      total: attachmentRows.length,
      legalHold: attachmentLegalHold,
      unclassifiedRetained: attachmentRows.length - attachmentLegalHold,
      estimatedBytes: attachmentBytes,
    },
    imaging: {
      total: imagingImageRows.length,
      legalHold: imagingLegalHold,
      retainedClinical: imagingImageRows.length,
      estimatedBytes: imagingBytes,
    },
    blockers,
    dryRun: true,
  };
}
