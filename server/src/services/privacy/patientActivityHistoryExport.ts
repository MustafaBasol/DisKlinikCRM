/**
 * patientActivityHistoryExport.ts — F2-IMG-AUDIT-003
 *
 * KVKK per-patient export completeness for bridge-linked imaging.
 *
 * `patientPrivacy.ts`'s `activityHistory` export field previously derived
 * exclusively from `ActivityLog`. Bridge-originated imaging ingest
 * (`server/src/routes/imagingBridgePublic.ts`) is a machine actor with no
 * `User` row to attribute to — per F2-IMG-AUDIT-002's accepted decision
 * (docs/program/evidence/F2-IMG-AUDIT-002_MACHINE_ACTOR_ACTIVITYLOG_DECISION.md),
 * it stays in `AuditLog` only and must never fabricate/borrow a `User`
 * identity to satisfy `ActivityLog.userId`'s non-nullable FK. That leaves a
 * real completeness gap: a patient whose imaging arrived via the bridge with
 * a resolved `imagingRequestId` has that ingestion event missing from their
 * KVKK data-subject export, while the same event for a manually-uploaded
 * study appears (imaging.ts writes both AuditLog and ActivityLog).
 *
 * This module builds an EXPORT PROJECTION only — it does not merge the two
 * tables at persistence level, does not touch `ActivityLog`'s schema or
 * actor model, and does not change bridge ingest audit behavior. It reads
 * the already-written `imaging_bridge_study_ingested` AuditLog rows and
 * normalizes them into the same `activityHistory` shape, truthfully
 * represented as a machine/bridge actor (never a fabricated or borrowed
 * `User`).
 *
 * Patient linkage is resolved via a structured id join, never text parsing:
 * `AuditLog.entityId` (a bridge-ingested `ImagingStudy.id`) -> looked up
 * against `ImagingStudy.patientId`, itself only ever set via an explicit
 * `imagingRequestId` supplied by the bridge caller (see
 * imagingBridgePublic.ts's "no name/phone/filename matching" comment) —
 * never inferred from free text.
 *
 * The `ImagingStudy.patientId` lookup (F2-STAGE3-GAPC-001) goes through the
 * Imaging domain's own `getBridgeStudyIdsForPatient` facade
 * (server/src/services/imaging/public.ts) rather than a direct Prisma
 * `imagingStudy.findMany` call — this module has no direct persistence
 * dependency on the Imaging domain's `ImagingStudy` model. The facade
 * returns only study ids (no metadata/storage/timestamps), scoped by the
 * same `{ clinicId, patientId, source: 'bridge' }` predicate this module
 * always used. `AuditLog` itself remains a direct Prisma dependency here —
 * it is not an Imaging-owned model.
 */

import prisma from '../../db.js';
import { getBridgeStudyIdsForPatient } from '../imaging/public.js';

const BRIDGE_IMAGING_AUDIT_ACTION = 'imaging_bridge_study_ingested';
const BRIDGE_IMAGING_ENTITY_TYPE = 'imaging_study';

/**
 * Global cardinality ceiling for the merged `activityHistory` export field.
 * Before F2-IMG-AUDIT-003 this was the export's only cap (ActivityLog's own
 * `take: 500`, since ActivityLog was the only source). Now that bridge
 * AuditLog rows are merged in as a second source, each source is still capped
 * at this same number at fetch time (see `MAX_BRIDGE_IMAGING_AUDIT_ROWS`
 * below and the `take: 500` on the ActivityLog query in patientPrivacy.ts),
 * but `mergePatientActivityHistory` must ALSO apply this as a final cap on
 * the merged, sorted result — otherwise two independently-capped 500-row
 * sources produce up to 1000 exported rows, silently breaking this
 * backward-compatibility contract (F2-IMG-AUDIT-003-R1).
 */
export const MAX_PATIENT_ACTIVITY_HISTORY_ROWS = 500;

/** Per-source fetch cap for bridge AuditLog rows; mirrors MAX_PATIENT_ACTIVITY_HISTORY_ROWS. */
const MAX_BRIDGE_IMAGING_AUDIT_ROWS = MAX_PATIENT_ACTIVITY_HISTORY_ROWS;

/**
 * Explicit rank for the deterministic secondary sort key. Arbitrary but
 * stable — only its relative ordering matters, not the values themselves.
 */
const SOURCE_RANK: Record<ActivityHistorySource, number> = { staff: 0, bridge: 1 };

export type ActivityHistorySource = 'staff' | 'bridge';

export interface PatientActivityHistoryEntry {
  id: string;
  action: string;
  entityType: string;
  description: string | null;
  createdAt: Date;
  /** Truthful actor category — 'bridge' entries are machine-originated, never a fabricated/borrowed User. */
  source: ActivityHistorySource;
}

/** Shape of the pre-existing `prisma.activityLog.findMany` projection in patientPrivacy.ts. */
export interface StaffActivityLogRow {
  id: string;
  action: string;
  entityType: string;
  description: string | null;
  createdAt: Date;
}

function describeBridgeIngestEvent(metadata: unknown): string {
  const meta = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>;
  const modality = typeof meta.modality === 'string' && meta.modality.length > 0 ? meta.modality : 'OTHER';
  const duplicate = meta.duplicate === true;
  return duplicate
    ? `Görüntüleme çalışması köprü (cihaz) üzerinden yeniden gönderildi — yinelenen yükleme algılandı (${modality})`
    : `Görüntüleme çalışması köprü (cihaz) üzerinden içe aktarıldı (${modality})`;
}

/**
 * Fetches bridge-originated imaging-ingest AuditLog rows linked to the given
 * patient, scoped to the same clinic and organization. Returns them
 * pre-normalized into the export `activityHistory` shape — allowlisted
 * fields only (no storageKey, filesystem path, token, or raw DICOM/metadata
 * dump; only `modality`/`duplicate` are read out of `metadata` to build a
 * human-readable description).
 */
export async function collectBridgeImagingActivityForPatient(
  patientId: string,
  clinicId: string,
  organizationId: string,
): Promise<PatientActivityHistoryEntry[]> {
  const studyIds = await getBridgeStudyIdsForPatient(clinicId, patientId);
  if (studyIds.length === 0) return [];

  const auditRows = await prisma.auditLog.findMany({
    where: {
      organizationId,
      clinicId,
      entityType: BRIDGE_IMAGING_ENTITY_TYPE,
      entityId: { in: studyIds },
      action: BRIDGE_IMAGING_AUDIT_ACTION,
    },
    select: { id: true, action: true, entityType: true, metadata: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: MAX_BRIDGE_IMAGING_AUDIT_ROWS,
  });

  return auditRows.map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    description: describeBridgeIngestEvent(row.metadata),
    createdAt: row.createdAt,
    source: 'bridge' as const,
  }));
}

/**
 * Merges the staff ActivityLog projection with the bridge AuditLog
 * projection into one `activityHistory` list, sorted newest-first and capped
 * at `MAX_PATIENT_ACTIVITY_HISTORY_ROWS` total.
 *
 * Dedupe identity is `${source}:${id}` — each row's own structured primary
 * key from its origin table, never free-text description. This is
 * deliberate: two bridge upload attempts for the same `ImagingStudy`
 * (e.g. an original ingest plus a later duplicate-detected retry) are
 * genuinely distinct real-world events sharing the same `entityId`+`action`,
 * so collapsing on anything less specific than the row's own id would
 * silently drop real audit evidence. Concatenating table-scoped UUIDs under
 * a source-prefixed key makes accidental cross-table collision structurally
 * impossible, while a same-row re-fetch (e.g. an upstream retry) still
 * collapses to one entry.
 *
 * Ordering is `createdAt` DESC, with a deterministic tie-break (source rank,
 * then `id` lexical) for equal timestamps — never reliant on Map insertion
 * order, which is not a stable contract across the two independently-fetched
 * sources.
 *
 * The final `.slice(0, MAX_PATIENT_ACTIVITY_HISTORY_ROWS)` preserves the
 * pre-F2-IMG-AUDIT-003 global cap: each source is independently capped at
 * `MAX_PATIENT_ACTIVITY_HISTORY_ROWS` rows at fetch time, so without this
 * final cap a patient with >500 rows in both sources could export up to
 * 2x the historical maximum (F2-IMG-AUDIT-003-R1).
 */
export function mergePatientActivityHistory(
  staffRows: StaffActivityLogRow[],
  bridgeRows: PatientActivityHistoryEntry[],
): PatientActivityHistoryEntry[] {
  const merged = new Map<string, PatientActivityHistoryEntry>();
  for (const row of staffRows) {
    merged.set(`staff:${row.id}`, { ...row, source: 'staff' });
  }
  for (const row of bridgeRows) {
    merged.set(`bridge:${row.id}`, row);
  }
  return Array.from(merged.values())
    .sort((a, b) => {
      const byCreatedAt = b.createdAt.getTime() - a.createdAt.getTime();
      if (byCreatedAt !== 0) return byCreatedAt;
      const bySource = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
      if (bySource !== 0) return bySource;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, MAX_PATIENT_ACTIVITY_HISTORY_ROWS);
}
