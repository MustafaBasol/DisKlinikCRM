/**
 * ops.ts — Imaging PLATFORM/OPS read contract (F2-STAGE3-GAPD-001).
 *
 * NOT a tenant-facing API. NOT part of `public.ts`'s ImagingLifecyclePort
 * (which is explicit, per-caller-clinicId, tenant-scoped). This module is
 * the opposite by design: it is the one Imaging-owned surface that
 * intentionally has NO clinicId parameter, NO JWT/default-clinic
 * dependence, and NO request body/query tenant selector.
 *
 * Why global scope is correct here (F2-STAGE3-EXIT-DECIDE-001, accepted):
 * the platform backup job (server/src/services/fileBackupService.ts) is a
 * cross-tenant operational sweep by design — it walks every clinic's rows
 * so nothing is silently excluded from off-host backup coverage. Adding a
 * clinicId filter to satisfy a tenant-authorization instinct would be
 * WRONG here: it would silently narrow backup coverage to one tenant and
 * defeat the job's whole purpose. The correct fix for the cross-domain
 * access problem this task addresses is a narrow Imaging-owned read
 * contract, not tenant scoping.
 *
 * Only intended caller: fileBackupService.ts's platform backup sweep. Any
 * other caller wanting Imaging data belongs on `public.ts` (tenant-scoped)
 * instead — never add a clinicId parameter to this file's method to turn
 * it into a tenant API; add a new method to `public.ts` for that.
 *
 * DTO is intentionally the narrowest shape the backup sweep actually
 * consumes: id/clinicId (for backup ledger attribution and destination key
 * construction), storageKeyOrFilePath (to open the physical file via
 * fileStorage.ts — works for both local-disk and S3-backed primary
 * storage), and fileSize (byte accounting only, matching
 * FileBackupRun.bytesCopied). No patientId, study metadata, modality,
 * originalName, or other PHI crosses this boundary — the backup sweep has
 * never read any of those fields for ImagingImage (see the pre-migration
 * `select` on the removed generic `(prisma as any)['imagingImage']`
 * access in fileBackupService.ts, which selected the same four columns).
 *
 * Pagination matches this repository's existing cursor convention
 * (`cursor`/`skip: 1`, ascending `id` tiebreaker for stable ordering across
 * pages — same shape as fileBackupService.ts's own pre-migration
 * `iterateSourceRows`, and the same `cursor`/`limit` request shape used by
 * e.g. communicationConsent/legacyConsentCorrection.ts's
 * listLegacyConsentCorrections). `nextCursor` is present only when the
 * returned page was a full page (`rows.length === limit`) — mirrors the
 * pre-migration generator's own termination rule (`rows.length < batchSize`
 * ends enumeration), including its harmless trailing empty-page fetch when
 * the total row count is an exact multiple of the batch size.
 */
import prisma from '../../db.js';

export interface ImagingBackupRow {
  id: string;
  clinicId: string;
  storageKeyOrFilePath: string;
  fileSize: number;
  /**
   * F4-IMAGING-001-R6 — which backend actually holds this object's bytes.
   * The backup sweep must know this to open the right source: before R6 it
   * inherited the reader's global-flag check, so a VPS2-resident object
   * became unreadable — and was recorded as `missing_source`, i.e. as data
   * loss — the moment IMAGING_STORAGE_BACKEND was unset.
   *
   * Deliberately the RAW persisted column value (`null` on pre-R6 rows),
   * mirroring how `storageKeyOrFilePath` carries `filePath` verbatim, and
   * NOT a value pre-interpreted here. Interpretation belongs to
   * `resolveImagingStoragePlacement()` — the single authoritative
   * interpreter — called by the consumer at the point of use. That is a
   * blast-radius decision, not a stylistic one: the interpreter FAILS CLOSED
   * on an unrecognized value, and this enumeration runs OUTSIDE the backup
   * sweep's per-row try/catch. Resolving here would turn one unclassifiable
   * row into an aborted sweep that stops backing up every row after it;
   * resolving at the point of use turns it into that single row's `failed`
   * entry while every other file is still backed up. Consumers must not
   * re-implement the NULL rule — call the interpreter.
   *
   * This is a logical placement label and nothing more. It is never an
   * endpoint, bucket, region or credential — the sweep still opens bytes
   * through Imaging's own reader (`fileStorage.ts`'s `openImagingFileStream`)
   * and never constructs a provider client of its own. Widening this DTO any
   * further would start leaking Imaging internals across the boundary; this
   * is the minimum the sweep needs to choose correctly, and no PHI is added.
   */
  storageBackend: string | null;
}

export interface ListImagesForBackupResult {
  rows: ImagingBackupRow[];
  nextCursor?: string;
}

/**
 * GLOBAL, cross-tenant enumeration of ImagingImage rows for the platform
 * backup sweep. Deliberately takes no clinicId — see this file's header.
 */
export async function listImagesForBackup(params: {
  cursor?: string;
  limit: number;
}): Promise<ListImagesForBackupResult> {
  const rows = await prisma.imagingImage.findMany({
    take: params.limit,
    ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
    orderBy: { id: 'asc' },
    select: { id: true, clinicId: true, filePath: true, fileSize: true, storageBackend: true },
  });

  const mapped: ImagingBackupRow[] = rows.map((row) => ({
    id: row.id,
    clinicId: row.clinicId,
    storageKeyOrFilePath: row.filePath,
    fileSize: row.fileSize,
    storageBackend: row.storageBackend,
  }));

  return {
    rows: mapped,
    ...(rows.length === params.limit ? { nextCursor: rows[rows.length - 1]!.id } : {}),
  };
}
