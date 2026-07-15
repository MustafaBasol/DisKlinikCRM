/**
 * orphanFileInspection.ts — Bounded, patient-scoped orphan-file dry-run
 * inspection (docs/compliance/53-kvkk-attachment-imaging-lifecycle.md).
 *
 * Scope of this PR (intentionally narrow):
 *  - Checks PatientAttachment and ImagingImage rows for a SINGLE patient
 *    (bounded, not a clinic-wide sweep — see inspectPatientOrphans below).
 *  - Classifies each row as dbRowPhysicalMissing (DB row exists, physical
 *    file missing) or activeLinkedObject (file present, not legal-hold —
 *    never touched).
 *  - Never deletes anything. The only "live" side effect available is
 *    stamping storageVerifiedMissingAt on rows already confirmed missing —
 *    there is nothing to physically delete for those (the file is already
 *    gone), so this is purely an operator-visible marker.
 *
 * Explicitly NOT implemented in this PR (documented follow-up):
 *  - Reverse-orphan detection (a physical file exists with no DB row). This
 *    would require an unbounded, unrestricted S3 ListObjectsV2 / filesystem
 *    walk, which the architecture explicitly forbids for safety reasons. A
 *    future implementation must use a bounded, clinic-prefixed
 *    ListObjectsV2 call with pagination (prefix = `${clinicId}/`), never an
 *    unrestricted bucket/filesystem scan.
 *  - Clinic-wide bulk sweeps (kept patient-scoped for this PR to stay simple
 *    and bounded).
 *
 * Expired PatientPrivacyExportArchive rows are a separate, already-bounded
 * "temporary expired object" category handled entirely by
 * patientPrivacyExportCleanupJob.ts — not part of this inspection.
 */

import prisma from '../../db.js';
import { fileExists } from '../fileStorage.js';

export interface OrphanCheckEntry {
  id: string;
  kind: 'attachment' | 'imaging_image';
  classification: 'dbRowPhysicalMissing' | 'activeLinkedObject';
  legalHold: boolean;
}

export interface OrphanCheckResult {
  patientId: string;
  clinicId: string;
  checked: number;
  dbRowPhysicalMissing: number;
  activeLinkedObject: number;
  entries: OrphanCheckEntry[];
  dryRun: true;
}

const BATCH_SIZE = 500;

export async function inspectOrphans(params: {
  clinicId: string;
  patientId: string;
}): Promise<OrphanCheckResult> {
  const { clinicId, patientId } = params;

  const attachments = await prisma.patientAttachment.findMany({
    where: { clinicId, patientId },
    select: { id: true, filePath: true, legalHold: true },
    take: BATCH_SIZE,
  });

  const imagingImages = await prisma.imagingImage.findMany({
    where: { clinicId, study: { patientId } },
    select: { id: true, filePath: true, study: { select: { legalHold: true } } },
    take: BATCH_SIZE,
  });

  const entries: OrphanCheckEntry[] = [];

  for (const attachment of attachments) {
    const exists = await fileExists(attachment.filePath);
    entries.push({
      id: attachment.id,
      kind: 'attachment',
      classification: exists ? 'activeLinkedObject' : 'dbRowPhysicalMissing',
      legalHold: attachment.legalHold,
    });
  }

  for (const image of imagingImages) {
    const exists = await fileExists(image.filePath);
    entries.push({
      id: image.id,
      kind: 'imaging_image',
      classification: exists ? 'activeLinkedObject' : 'dbRowPhysicalMissing',
      legalHold: Boolean(image.study?.legalHold),
    });
  }

  const dbRowPhysicalMissing = entries.filter((e) => e.classification === 'dbRowPhysicalMissing').length;

  return {
    patientId,
    clinicId,
    checked: entries.length,
    dbRowPhysicalMissing,
    activeLinkedObject: entries.length - dbRowPhysicalMissing,
    entries,
    dryRun: true,
  };
}

/**
 * Stamps storageVerifiedMissingAt on rows confirmed missing by a prior
 * inspectOrphans() call. Never legal-hold-gated (there is nothing to delete —
 * this only marks a DB row as "physically confirmed missing" for operator
 * visibility) and never deletes rows or files.
 */
export async function markConfirmedMissing(
  entries: Pick<OrphanCheckEntry, 'id' | 'kind'>[],
): Promise<{ marked: number }> {
  const now = new Date();
  let marked = 0;
  for (const entry of entries) {
    try {
      if (entry.kind === 'attachment') {
        await prisma.patientAttachment.update({
          where: { id: entry.id },
          data: { storageVerifiedMissingAt: now },
        });
      } else {
        await prisma.imagingImage.update({
          where: { id: entry.id },
          data: { storageVerifiedMissingAt: now },
        });
      }
      marked++;
    } catch (err) {
      console.error('[orphan-file-inspection] failed to mark missing', entry, err);
    }
  }
  return { marked };
}
