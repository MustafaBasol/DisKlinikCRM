/**
 * imagingIngestCore.ts — F2-OVL-01 shared manual/bridge ImagingStudy ingest
 * core (docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md
 * §8, Stage 2).
 *
 * Narrowest authorized shared skeleton between `POST /api/imaging/studies`
 * (routes/imaging.ts) and `POST /api/public/imaging/bridge/studies`
 * (routes/imagingBridgePublic.ts) — the two routes' file-signature
 * validation, storage-key/write, and ImagingStudy+ImagingImage+CAS-transition
 * transaction were byte-for-byte identical (differing only in which already-
 * resolved values they passed in). This module owns exactly that identical
 * mechanics; nothing else.
 *
 * Explicitly OUT of scope for this core (stays in each route — see the
 * OVL-01 task brief / F2-PREP-006-E §8):
 *  - Express Request/Response, session/JWT or bridge-token authorization
 *  - clinic resolution (resolveEffectiveClinicId / agent.clinicId lookup)
 *  - validateClinicalLinks (patient/appointment/treatment-case/device lookup)
 *  - ImagingRequest lookup + canAttachStudyToRequest open-state check (the
 *    route resolves and validates imagingRequestId BEFORE calling this core;
 *    this core only re-applies the same CAS predicate inside the write
 *    transaction — it never looks the request up on its own)
 *  - bridge ingestKey pre-check dedup and P2002 concurrent-duplicate recovery
 *  - rate limiting / upload-slot concurrency limiting / agent heartbeat
 *  - audit logging (writeAuditLog/auditImaging) and ActivityLog (logActivity)
 *  - HTTP response shaping
 *
 * Tenant contract: `clinicId` is a mandatory, explicit input and is never
 * derived here. Every DB predicate below is scoped by that clinicId (or by
 * an id the caller has already validated against it).
 *
 * Storage/transaction ordering (preserved from both routes, unchanged):
 * validate signature → write storage → DB transaction → success. On any
 * transaction failure (including a CAS zero-row conflict or a Prisma unique-
 * constraint violation) the just-written storage object is best-effort
 * deleted and the original error is rethrown unchanged, so each route's
 * existing error-classification logic (statusCode/P2002 checks) keeps
 * working without modification. No cross-boundary atomicity is claimed.
 */

import prisma from '../../db.js';
import { buildStorageKey, deleteFile, fileNameFromKey, saveFile } from '../fileStorage.js';
import { isAllowedFileSignature } from '../../utils/fileSignature.js';
import { IMAGING_EXTENSIONS_BY_MIME, normalizeDeclaredMime } from './imagingUploadValidation.js';

// Mirrors canAttachStudyToRequest (imagingRequestTransitions.ts) exactly —
// kept as a local literal (both routes already hardcoded this same list
// inline) rather than importing, so this module has no dependency beyond the
// narrow mechanics it owns.
const REQUEST_ATTACHABLE_STATUSES = ['requested', 'scheduled'];

// ─── Typed errors (small closed set, never a raw Prisma/provider error to
// non-Prisma-aware callers — though the underlying Prisma error, e.g. P2002,
// is still rethrown as-is for the bridge route's own duplicate recovery) ──

export class ImagingIngestFileValidationError extends Error {
  readonly code = 'IMAGING_INGEST_FILE_VALIDATION_FAILED' as const;
  constructor() {
    super('Uploaded file failed signature validation.');
    this.name = 'ImagingIngestFileValidationError';
  }
}

export class ImagingIngestRequestCasConflictError extends Error {
  readonly code = 'IMAGING_INGEST_REQUEST_CAS_CONFLICT' as const;
  readonly statusCode = 409 as const;
  constructor() {
    super('Imaging request is not open for new studies');
    this.name = 'ImagingIngestRequestCasConflictError';
  }
}

export interface IngestImagingStudyCoreInput {
  /** Already access-validated by the caller — never derived here. */
  clinicId: string;
  source: 'manual_upload' | 'bridge';
  /** Manual: req.user!.id. Bridge: null (no human actor). */
  createdById: string | null;
  /** Bridge: agent.id. Manual: null. */
  bridgeAgentId: string | null;
  /** Bridge: server-recomputed sha256 of the file buffer. Manual: null. */
  ingestKey: string | null;
  patientId: string | null;
  appointmentId: string | null;
  treatmentCaseId: string | null;
  deviceId: string | null;
  modality: string;
  studyDate: Date | null;
  description: string | null;
  /**
   * Already looked up and open-state-validated by the caller (findFirst +
   * canAttachStudyToRequest). This core re-applies the identical
   * {id, clinicId, status: {in: [requested, scheduled]}} CAS predicate
   * inside its own write transaction — it performs no lookup of its own.
   */
  imagingRequestId: string | null;
  fileBuffer: Buffer;
  originalName: string;
  /** Raw declared/multer mimetype — normalized internally. */
  declaredMimeType: string;
  fileSize: number;
}

export interface IngestImagingStudyCoreResult {
  studyId: string;
  effectiveMime: string;
  imagingRequestUpdated: boolean;
}

export async function ingestImagingStudyCore(
  input: IngestImagingStudyCoreInput,
): Promise<IngestImagingStudyCoreResult> {
  const effectiveMime = normalizeDeclaredMime(input.declaredMimeType, input.originalName);
  if (!isAllowedFileSignature(input.fileBuffer, effectiveMime, input.originalName, IMAGING_EXTENSIONS_BY_MIME)) {
    throw new ImagingIngestFileValidationError();
  }

  const storageKey = buildStorageKey(input.clinicId, input.originalName);
  await saveFile(storageKey, input.fileBuffer, effectiveMime);

  try {
    const study = await prisma.$transaction(async (tx) => {
      const created = await tx.imagingStudy.create({
        data: {
          clinicId: input.clinicId,
          patientId: input.patientId,
          appointmentId: input.appointmentId,
          treatmentCaseId: input.treatmentCaseId,
          deviceId: input.deviceId,
          imagingRequestId: input.imagingRequestId,
          modality: input.modality,
          studyDate: input.studyDate ?? new Date(),
          description: input.description,
          source: input.source,
          status: 'active',
          createdById: input.createdById,
          bridgeAgentId: input.bridgeAgentId,
          ingestKey: input.ingestKey,
        },
      });

      await tx.imagingImage.create({
        data: {
          clinicId: input.clinicId,
          studyId: created.id,
          fileName: fileNameFromKey(storageKey),
          originalName: input.originalName,
          fileSize: input.fileSize,
          mimeType: effectiveMime,
          filePath: storageKey,
        },
      });

      if (input.imagingRequestId) {
        // Race-resistant: transition to 'received' only if still open;
        // otherwise the caller's earlier open-state check has gone stale
        // (concurrent transition) and this must fail closed.
        const updated = await tx.imagingRequest.updateMany({
          where: {
            id: input.imagingRequestId,
            clinicId: input.clinicId,
            status: { in: REQUEST_ATTACHABLE_STATUSES },
          },
          data: { status: 'received' },
        });
        if (updated.count === 0) {
          throw new ImagingIngestRequestCasConflictError();
        }
      }

      return created;
    });

    return { studyId: study.id, effectiveMime, imagingRequestUpdated: Boolean(input.imagingRequestId) };
  } catch (err) {
    // Best-effort compensation: storage and Postgres are not atomic. No
    // outbox/saga — a failed delete here is swallowed exactly like both
    // routes' pre-existing outer-catch compensation did.
    await deleteFile(storageKey).catch(() => {});
    throw err;
  }
}
