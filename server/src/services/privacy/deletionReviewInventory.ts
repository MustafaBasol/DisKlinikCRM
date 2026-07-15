/**
 * deletionReviewInventory.ts — Dry-run deletion-review inventory
 * (docs/compliance/53-kvkk-attachment-imaging-lifecycle.md).
 *
 * Builds a read-only preview of what a "deletion review" for a patient would
 * cover. This module NEVER writes to the database — it only counts/sums.
 * Live deletion (only for non-legal-hold PatientAttachment rows) is a
 * separate, narrowly-scoped endpoint — see
 * POST /patients/:id/privacy/deletion-review/execute in routes/patientPrivacy.ts.
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
     * All non-legal-hold attachments. There is no category field on
     * PatientAttachment yet distinguishing "administrative" from anything
     * more sensitive, so this is conservatively treated as the full
     * deletable set for the narrow execute endpoint — documented limitation,
     * not a bug.
     */
    deletableAdministrative: number;
    estimatedBytes: number;
  };
  imaging: {
    total: number;
    legalHold: number;
    /** Everything not under legal hold — still retained by default; imaging has no live-delete path in this PR. */
    retainedClinical: number;
    estimatedBytes: number;
  };
  blockers: string[];
  dryRun: true;
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

  const blockers: string[] = [];
  if (attachmentLegalHold > 0) {
    blockers.push(`${attachmentLegalHold} attachment(s) under legal hold — excluded from any deletion.`);
  }
  if (imagingImageRows.length > 0) {
    blockers.push(
      'Clinical/DICOM imaging retention policy not yet legally approved — no imaging deletion permitted (conservative retain by default).',
    );
  }
  if (imagingLegalHold > 0) {
    blockers.push(`${imagingLegalHold} imaging image(s) additionally under legal hold via their study.`);
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
      deletableAdministrative: attachmentRows.length - attachmentLegalHold,
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
