/**
 * toothDetailHelpers.ts — DENTAL-CHART-UX-001-R2 (Lane D)
 *
 * Pure, UI-framework-free helpers for ToothDetailPanel:
 *  - composing the "Upper right first molar" orientation+family wording key
 *  - ordering the tooth's linked procedures for display
 *  - deriving the bounded, read-only tooth timeline
 *
 * Nothing here fetches data, mutates data, or touches persistence. Every
 * function is a total, side-effect-free transform over props the panel
 * already receives.
 *
 * ── TIMELINE SCOPE (see delivery report for the full investigation) ──
 * The chart has no per-tooth history table and none is added here.
 * `ToothRecord` is a single mutable row per (patientId, toothFdi) that is
 * upserted on every edit (server/src/routes/dentalChart.ts PUT handler), so
 * it can only ever answer "when was this created" and "when was it last
 * touched" — never what the status was in between. `TreatmentProcedure` rows
 * ARE an append-only, tooth-linked (toothFdi), already-fetched,
 * already-tenant-scoped source (server/src/routes/treatmentPlanProcedures.ts
 * GET /api/patients/:patientId/treatment-procedures), so their
 * createdAt/scheduledDate/completedAt are folded in as real lifecycle
 * events. No new fetch, no new persistence, no cross-domain access, no
 * unbounded query — the procedure list is exactly the `procedures` prop the
 * panel already receives, already scoped to this tooth by the caller.
 */
import type { ToothArch, ToothSide } from './odontogram/toothIdentity';
import type { ProcedureStatus, ToothRecord, TreatmentProcedure } from './dentalChart.types';

export type ToothOrientationKey =
  | 'upperRightQuadrant'
  | 'upperLeftQuadrant'
  | 'lowerRightQuadrant'
  | 'lowerLeftQuadrant';

/** Maps arch+side to the existing `patients:dentalChart.orientation.*` key. */
export function getToothOrientationKey(arch: ToothArch, side: ToothSide): ToothOrientationKey {
  if (arch === 'upper') return side === 'right' ? 'upperRightQuadrant' : 'upperLeftQuadrant';
  return side === 'right' ? 'lowerRightQuadrant' : 'lowerLeftQuadrant';
}

// Clinically-active work surfaces first, then finished, then cancelled last.
// Does not reorder/rename ProcedureStatus itself — display-only.
const PROCEDURE_STATUS_ORDER: Record<ProcedureStatus, number> = {
  in_progress: 0,
  planned: 1,
  completed: 2,
  cancelled: 3,
};

/**
 * Orders a tooth's linked procedures for the panel: active statuses first,
 * then within a status, most recently scheduled (falling back to most
 * recently created) first. Never mutates the input array.
 */
export function sortProceduresForPanel(procedures: TreatmentProcedure[]): TreatmentProcedure[] {
  return [...procedures].sort((a, b) => {
    const statusDiff =
      (PROCEDURE_STATUS_ORDER[a.status] ?? 99) - (PROCEDURE_STATUS_ORDER[b.status] ?? 99);
    if (statusDiff !== 0) return statusDiff;
    const aDate = a.scheduledDate ?? a.createdAt;
    const bDate = b.scheduledDate ?? b.createdAt;
    return new Date(bDate).getTime() - new Date(aDate).getTime();
  });
}

export type ToothTimelineEntryKind =
  | 'record_created'
  | 'record_updated'
  | 'procedure_added'
  | 'procedure_scheduled'
  | 'procedure_completed';

export interface ToothTimelineEntry {
  id: string;
  kind: ToothTimelineEntryKind;
  /** ISO date string (or whatever the source field carries) — display only. */
  at: string;
  procedureName?: string;
  createdByName?: string | null;
}

function fullName(person?: { firstName: string; lastName: string } | null): string | null {
  if (!person) return null;
  const name = `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim();
  return name || null;
}

/**
 * Builds the bounded, honestly-labelled read-only timeline described above.
 * Sorted newest first. Tolerant of missing dates/records — never throws.
 */
export function buildToothTimeline(
  record: ToothRecord | undefined,
  procedures: TreatmentProcedure[],
): ToothTimelineEntry[] {
  const entries: ToothTimelineEntry[] = [];

  if (record?.createdAt) {
    entries.push({
      id: `record-created-${record.id}`,
      kind: 'record_created',
      at: record.createdAt,
      createdByName: fullName(record.createdBy),
    });
  }
  // Only a distinct "updated" event when it actually differs from creation —
  // otherwise every never-touched-since-creation record would show two
  // identical timestamps and imply an edit that never happened.
  if (record?.updatedAt && record.updatedAt !== record.createdAt) {
    entries.push({
      id: `record-updated-${record.id}`,
      kind: 'record_updated',
      at: record.updatedAt,
      createdByName: fullName(record.createdBy),
    });
  }

  for (const procedure of procedures) {
    if (procedure.createdAt) {
      entries.push({
        id: `procedure-added-${procedure.id}`,
        kind: 'procedure_added',
        at: procedure.createdAt,
        procedureName: procedure.procedureName,
      });
    }
    if (procedure.scheduledDate) {
      entries.push({
        id: `procedure-scheduled-${procedure.id}`,
        kind: 'procedure_scheduled',
        at: procedure.scheduledDate,
        procedureName: procedure.procedureName,
      });
    }
    if (procedure.completedAt) {
      entries.push({
        id: `procedure-completed-${procedure.id}`,
        kind: 'procedure_completed',
        at: procedure.completedAt,
        procedureName: procedure.procedureName,
      });
    }
  }

  return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
