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
 *
 * F2-STAGE3-IMPL-001: the inspectOrphans ImagingImage lifecycle-review/
 * existence-check path below is migrated to ImagingLifecyclePort
 * (server/src/services/imaging/public.ts) instead of direct Prisma access.
 *
 * F2-STAGE3-DEFERRED-GAPA-001: markConfirmedMissing's ImagingImage write is
 * now also migrated to ImagingLifecyclePort.markStorageMissing(clinicId,
 * imageId) — see its own doc comment. It requires an explicit, caller-
 * supplied, already-authorization-validated clinicId (same contract as
 * inspectOrphans above).
 */

import prisma from '../../db.js';
import { fileExists } from '../fileStorage.js';
import { getImagesForLifecycleReview, checkImageStorageExists, markStorageMissing } from '../imaging/public.js';

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

  // ImagingImage lifecycle-review/existence-check path migrated to
  // ImagingLifecyclePort (F2-STAGE3-IMPL-001) — no direct Prisma access to
  // ImagingImage/ImagingStudy remains on this path. markConfirmedMissing
  // below is also migrated (F2-STAGE3-DEFERRED-GAPA-001, see its own doc
  // comment) via a separate ImagingLifecyclePort call.
  const imagingImagesAll = await getImagesForLifecycleReview(clinicId, patientId);
  // getImagesForLifecycleReview has no take/limit of its own — apply the
  // same BATCH_SIZE cap here as the pre-migration direct query (`take:
  // BATCH_SIZE`) so this inspection never silently widens beyond its
  // historical bound.
  const imagingImages = imagingImagesAll.slice(0, BATCH_SIZE);

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
    const exists = await checkImageStorageExists(clinicId, image.id);
    entries.push({
      id: image.id,
      kind: 'imaging_image',
      classification: exists ? 'activeLinkedObject' : 'dbRowPhysicalMissing',
      legalHold: image.legalHold,
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
 *
 * F2-STAGE3-DEFERRED-GAPA-001: the imaging branch is now tenant-scoped
 * through ImagingLifecyclePort.markStorageMissing(clinicId, imageId) — no
 * direct `prisma.imagingImage` mutation remains on this path. `clinicId`
 * must already be an authorization-validated clinic scope resolved by the
 * caller (same contract as inspectOrphans above / F2-PREP-009 §3) — never a
 * raw, unvalidated req.user.clinicId/body/query/JWT value passed straight
 * through, and never derived from the entry's own id. A missing or
 * cross-tenant imaging id fails closed identically (ImagingNotFoundError,
 * caught below and simply not counted in `marked`) — indistinguishable from
 * outside this function, matching the port's own non-enumeration guarantee.
 *
 * The attachment branch is unchanged (out of scope for this task) — it
 * remains an id-only Prisma write, preserving its existing behavior exactly.
 */
export async function markConfirmedMissing(
  clinicId: string,
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
        await markStorageMissing(clinicId, entry.id);
      }
      marked++;
    } catch (err) {
      console.error('[orphan-file-inspection] failed to mark missing', entry, err);
    }
  }
  return { marked };
}
