/**
 * mappingWriteDiff.ts — F3-DATA-MIG-TODAY-001-R12.
 *
 * THE PRODUCTION DEFECT THIS MODULE EXISTS TO FIX
 * -----------------------------------------------
 * Release 5de3cee shipped a mapping screen that saves by serialising EVERY
 * mapping row and PUTting the whole collection (`next.map(...)` in
 * MigrationMappingStep.persistMapping). R11's legal gate, on the other side of
 * that request, read the mere PRESENCE of a `sourceField` in the payload as an
 * attempt to edit it. The two stored LEGAL_BLOCKED columns of the first
 * customer's workbook (KVKKONAYKODU, KVKKSMS) are in every such payload, so
 * every save — including one that only changed SUBEDOSYANO — was rejected with
 * HTTP 400 and the mapping step could not progress at all.
 *
 * Presence is not an edit. What the guard actually needs to know is whether the
 * request would CHANGE the stored semantic state of a protected row, and that
 * is a question about the DIFF, not about the payload's size. This module
 * computes that diff, once, server-side, so both the guard and the write loop
 * work from the same answer.
 *
 * WHY THE DIFF IS COMPUTED ON THE SERVER, NOT TRUSTED FROM THE CLIENT
 * ------------------------------------------------------------------
 * The client is also being changed to send only the row it edited, which makes
 * the common case small and obvious. That is a bandwidth and clarity
 * improvement, NOT the security fix. A hand-crafted request may still send
 * ninety-one rows, or one row with a forged `state`, and the answer must be the
 * same: the STORED row is the authority, the payload is a proposal, and the
 * comparison happens here inside the route's transaction. Nothing in this
 * module reads a client-asserted "changed" flag, because such a flag would be
 * exactly the thing an attacker sets to false.
 *
 * THE THREE OUTCOMES PER SUBMITTED ROW
 * ------------------------------------
 *   NO-OP    the proposal already matches what is stored, and the stored row
 *            already carries a named operator decision. Nothing is written and
 *            nothing is refused. This is the case the 400 was firing on.
 *   WRITE    either the semantic tuple changes, or the tuple matches but the
 *            row has never been operator-confirmed (the R9 data-loss gate's
 *            confirmation path: an operator confirming a system-recommended
 *            IGNORE submits it unchanged and that submission IS the decision).
 *   REFUSED  the stored row is LEGAL_BLOCKED and the proposal would change it.
 *            Fail closed, whole request, no partial write.
 *
 * A LEGAL_BLOCKED row whose proposal does NOT change it is a NO-OP, and
 * deliberately not even a stamp: recording "a Platform Admin decided this" over
 * a KVKK Art. 6 gate would relabel a program-owner decision as an operator one,
 * which is the same record-integrity harm R11's guard was written to prevent.
 *
 * PATCH SEMANTICS FOR ABSENT FIELDS
 * ---------------------------------
 * A field the payload does not mention INHERITS the stored value. The previous
 * route coerced an absent `state` to `'MANUAL_REQUIRED'` and an absent
 * `destinationField` to `null`, so a partial payload silently un-decided a
 * column. With delta saves that would be a live data-loss path, not a
 * theoretical one: the client now sends one row, and any field it forgot would
 * blank the stored value.
 *
 * PRIVACY: this module sees mapping DECISIONS and vendor column HEADERS only.
 * It never touches a cell value, and the messages it produces name columns,
 * never data.
 */

import { MAPPING_STATES, getDestinationField, MigrationError } from '../contracts.js';
import { isOperatorConfirmed, type DataLossGateRecord } from './dataLossGate.js';
import { LEGALLY_GATED_STATE } from './legalGateGuard.js';

/** The four fields that together ARE a mapping decision. Everything else is bookkeeping. */
export interface MappingSemanticTuple {
  destinationField: string | null;
  transform: string | null;
  composeOrder: number | null;
  state: string;
}

/**
 * A stored row, loosened structurally so a Prisma row or a fixture both fit.
 *
 * `MappingSemanticTuple` is applied via intersection rather than `extends`
 * because `DataLossGateRecord` types `destinationField` as OPTIONAL (a row
 * written before the column existed carries no value) while the tuple requires
 * it. An intersection narrows to the stricter of the two, which is what a row
 * read out of the database with an explicit `select` actually is.
 */
export type StoredMappingRow = DataLossGateRecord &
  MappingSemanticTuple & {
    sourceField: string;
  };

/** One entry as it arrived on the wire. Every field is untrusted. */
export type IncomingMappingEntry = Record<string, unknown>;

export type MappingWriteOutcome = 'WRITE' | 'NO_OP' | 'REFUSED_LEGAL_GATE' | 'UNKNOWN_COLUMN';

export interface MappingWritePlanEntry {
  sourceField: string;
  outcome: MappingWriteOutcome;
  /** The values to persist. Only present when `outcome === 'WRITE'`. */
  next?: MappingSemanticTuple;
  /** True when the semantic tuple differs from what is stored. */
  semanticChange: boolean;
}

export interface MappingWritePlan {
  entries: MappingWritePlanEntry[];
  /** Rows to actually UPDATE, in submission order. */
  writes: Array<{ sourceField: string; next: MappingSemanticTuple }>;
  /** Stored-LEGAL_BLOCKED rows the request tried to change. Non-empty ⇒ refuse everything. */
  legallyGatedEdits: string[];
  /** Submitted columns that do not exist on this run. Reported, never written. */
  unknownColumns: string[];
  /** Submitted rows that already matched and were already decided. */
  noOpCount: number;
}

const VALID_STATES: ReadonlySet<string> = new Set(MAPPING_STATES);

/**
 * Normalise ONE untrusted payload field against its stored value.
 *
 * `has` is the difference between "the client set this to null" and "the client
 * did not mention it". Only the first clears the stored value.
 */
function pick<T>(entry: IncomingMappingEntry, key: string, stored: T, coerce: (v: unknown) => T): T {
  return Object.prototype.hasOwnProperty.call(entry, key) ? coerce(entry[key]) : stored;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function asNullableInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * The proposed tuple for one submitted row, with absent fields inherited.
 *
 * Both enumerations are validated HERE rather than left to `validateMappings`
 * downstream. validateMappings runs AFTER the write, so an unknown state or a
 * destination key that is not in the catalog would already be persisted by the
 * time it complains — the row would be rejected on every subsequent load with
 * no way to fix it from the screen except by re-analyzing the whole run.
 */
export function proposedTuple(
  entry: IncomingMappingEntry,
  stored: MappingSemanticTuple,
): MappingSemanticTuple {
  const state = pick(entry, 'state', stored.state, (v) => String(v ?? ''));
  if (!VALID_STATES.has(state)) {
    throw new MigrationError('MAPPING_INVALID', {
      message: `Unknown mapping state "${state}".`,
    });
  }
  const destinationField = pick(entry, 'destinationField', stored.destinationField, asNullableString);
  if (destinationField !== null && !getDestinationField(destinationField)) {
    throw new MigrationError('MAPPING_INVALID', {
      message: `Unknown destination field "${destinationField}".`,
    });
  }
  return {
    destinationField,
    transform: pick(entry, 'transform', stored.transform, asNullableString),
    composeOrder: pick(entry, 'composeOrder', stored.composeOrder, asNullableInt),
    state,
  };
}

/** Do these two decisions say the same thing? */
export function tuplesEqual(a: MappingSemanticTuple, b: MappingSemanticTuple): boolean {
  return (
    a.destinationField === b.destinationField &&
    a.transform === b.transform &&
    a.composeOrder === b.composeOrder &&
    a.state === b.state
  );
}

/**
 * Build the write plan for a whole PUT payload.
 *
 * `storedRows` MUST have been read inside the same transaction that will apply
 * the plan. A state read outside it is already stale, and the legal gate would
 * then be deciding against a row the write no longer matches.
 *
 * Duplicate `sourceField`s in one payload are folded: the LAST entry wins, and
 * only one write is emitted. Two entries for one column would otherwise produce
 * two UPDATEs whose order decides the result, and the second would compare
 * against a stored row the first had already superseded.
 */
export function buildMappingWritePlan(
  incoming: readonly IncomingMappingEntry[],
  storedRows: readonly StoredMappingRow[],
): MappingWritePlan {
  const stored = new Map(storedRows.map((r) => [r.sourceField, r]));

  // Fold duplicates, preserving first-seen ORDER so messages stay assertable.
  const lastByField = new Map<string, IncomingMappingEntry>();
  const order: string[] = [];
  for (const entry of incoming) {
    const sourceField = String(entry?.sourceField ?? '');
    if (!lastByField.has(sourceField)) order.push(sourceField);
    lastByField.set(sourceField, entry ?? {});
  }

  const entries: MappingWritePlanEntry[] = [];
  const writes: Array<{ sourceField: string; next: MappingSemanticTuple }> = [];
  const legallyGatedEdits: string[] = [];
  const unknownColumns: string[] = [];
  let noOpCount = 0;

  for (const sourceField of order) {
    const entry = lastByField.get(sourceField)!;
    const row = stored.get(sourceField);

    if (!row) {
      unknownColumns.push(sourceField);
      entries.push({ sourceField, outcome: 'UNKNOWN_COLUMN', semanticChange: false });
      continue;
    }

    const current: MappingSemanticTuple = {
      destinationField: row.destinationField,
      transform: row.transform,
      composeOrder: row.composeOrder,
      state: row.state,
    };
    const next = proposedTuple(entry, current);
    const semanticChange = !tuplesEqual(current, next);

    if (row.state === LEGALLY_GATED_STATE) {
      if (semanticChange) {
        legallyGatedEdits.push(sourceField);
        entries.push({ sourceField, outcome: 'REFUSED_LEGAL_GATE', semanticChange: true });
      } else {
        // Present but unchanged. NOT an edit, so not refused — and not stamped
        // either: an operator confirmation over a legal gate would misrecord
        // who took that decision.
        noOpCount++;
        entries.push({ sourceField, outcome: 'NO_OP', semanticChange: false });
      }
      continue;
    }

    /*
     * A tuple-identical submission is still a WRITE when the row carries no
     * named operator decision yet. That is not busywork: it is precisely how an
     * operator confirms a SYSTEM-RECOMMENDED exclusion under the R9 data-loss
     * gate — they leave the column as proposed and save it, and the stamp this
     * write applies is the auditable record of that decision.
     */
    if (!semanticChange && isOperatorConfirmed(row)) {
      noOpCount++;
      entries.push({ sourceField, outcome: 'NO_OP', semanticChange: false });
      continue;
    }

    writes.push({ sourceField, next });
    entries.push({ sourceField, outcome: 'WRITE', next, semanticChange });
  }

  return { entries, writes, legallyGatedEdits, unknownColumns, noOpCount };
}

/**
 * Fail closed when the request would change a legally gated column.
 *
 * Names the source COLUMNS — vendor header text, which is schema, never a
 * patient value — so the refusal is actionable without any cell content
 * reaching a response body, a log line or an audit record.
 */
export function assertPlanHasNoLegallyGatedEdits(plan: MappingWritePlan): void {
  if (plan.legallyGatedEdits.length === 0) return;
  const names = plan.legallyGatedEdits.map((f) => `"${f}"`).join(', ');
  throw new MigrationError('MAPPING_INVALID', {
    message:
      `${plan.legallyGatedEdits.length} source column(s) (${names}) are blocked by an unresolved ` +
      `legal decision and cannot be re-mapped, re-stated or ignored from the mapping screen. ` +
      `Lifting a legal gate is a program-owner decision, not a mapping choice.`,
  });
}
