/**
 * validateMapping.ts — F3-DATA-MIG-TODAY-001
 *
 * The gate between "the operator has been clicking around in the mapping
 * screen" and "this run may execute". Every rule here exists because the
 * alternative is a silent data defect discovered after go-live.
 *
 * The five that matter most, and why they are hard errors rather than warnings:
 *
 *  1. EVERY source column must carry a decision. A column with no mapping row
 *     is not "unmapped" — it is UNDECIDED, and an undecided column is how a
 *     required field silently disappears from a migration. Absence of a
 *     decision is never treated as a decision to drop.
 *
 *  2. Two sources may not target one destination unless that destination
 *     declares `allowsComposition`. Otherwise the second write silently
 *     clobbers the first and the operator sees a plausible-looking result with
 *     one column's data missing.
 *
 *  3. A transform must be on the destination's allow-list. A transform is a
 *     semantic contract, not a formatting preference: feeding a date column
 *     through the phone normalizer produces confident garbage.
 *
 *  4. A LEGAL_BLOCKED column may not carry a destination. A legal gate is not
 *     a technical obstacle to be routed around by picking a destination in the
 *     UI — if the gate is to be lifted, that is a program-owner decision
 *     recorded in the accepted contract, not a dropdown selection.
 *
 *  5. The required destinations must be satisfied. Without
 *     `provenance.sourceId` the run cannot be idempotent, so a rerun or a
 *     batch retry would duplicate every patient it touched.
 *
 * PRIVACY: issues carry a source header, a destination key and a code. They
 * never carry a cell value.
 */

import {
  DESTINATION_FIELDS,
  getDestinationField,
  type MappingValidationIssue,
  type MappingValidationResult,
  type CanonicalHeader,
  type MigrationErrorCode,
} from '../contracts.js';

/**
 * The persisted mapping row, loosened to a structural type so this module can
 * validate both a Prisma row and an in-memory draft without importing Prisma.
 */
export interface MappingRecordLike {
  sourceField: string;
  sourceIndex: number;
  destinationField: string | null;
  transform: string | null;
  composeOrder: number | null;
  state: string;
}

/**
 * States that represent a completed decision to WRITE something. A run may
 * execute only when every mapping row is in one of these, or in one of the
 * explicit non-writing decisions below.
 */
const WRITING_STATES = new Set(['AUTO_CONFIDENT', 'RESOLVED']);

/**
 * States that do not write, and that this MAPPING-STAGE validator accepts as
 * settled enough to leave the mapping screen.
 *
 * READ THE NAME NARROWLY. F3-DATA-MIG-TODAY-001-R9 corrected a claim that used
 * to sit here: that these were states "the operator (or the accepted
 * first-customer matrix) affirmatively chose". The parenthesis was the defect.
 * A state that arrived from firstCustomerMatrix.ts is a SYSTEM RECOMMENDATION
 * computed before the workbook was uploaded — nobody chose it, and treating it
 * as an operator decision is how a populated column gets dropped with the
 * paperwork looking complete.
 *
 * This validator is still right to let them through, because it gates
 * CONTINUE, not EXECUTE: at this point the operator has not yet been shown the
 * measured per-column fill and cannot fairly be asked to confirm exclusions.
 * The confirmation is owed one step later, at the dry run, where the real
 * counts exist — see dataLossGate.ts, which is what actually gates Execute and
 * which does NOT accept a recommendation in place of a decision.
 */
const NON_WRITING_DECIDED_STATES = new Set(['IGNORE', 'BLOCKED', 'LEGAL_BLOCKED']);

/**
 * States that still need a human. A run may not execute while any remain.
 *
 * SENSITIVE_REVIEW_REQUIRED is UNDECIDED, not decided-and-excluded. That is
 * the whole point of the state: a KVKK Art. 6 special-category column is no
 * longer permanently unimportable for being sensitive, but it is also never
 * imported without a Platform Admin explicitly resolving it. Putting it in
 * NON_WRITING_DECIDED_STATES instead would silently drop the column; putting
 * it in WRITING_STATES would import special-category data with no human
 * approval. Both are exactly what this state exists to prevent.
 */
const UNDECIDED_STATES = new Set([
  'MANUAL_REQUIRED',
  'AUTO_REVIEW',
  'SENSITIVE_REVIEW_REQUIRED',
]);

/**
 * Does this mapping state still need a human?
 *
 * Exported so every caller derives 'is this run still unresolved?' from ONE
 * definition. The analyze route previously hard-coded its own list, which
 * meant adding a state to UNDECIDED_STATES here silently left that route
 * believing the run was ready: the run status said MAPPING_READY while
 * validateMappings() said the mapping was invalid. A status that describes a
 * mapping the database does not hold is the exact defect class this module
 * exists to prevent.
 */
export function isUndecidedMappingState(state: string): boolean {
  return UNDECIDED_STATES.has(state);
}

function issue(
  code: MigrationErrorCode,
  message: string,
  sourceField?: string,
  destinationField?: string,
): MappingValidationIssue {
  return { code, message, sourceField, destinationField };
}

export function validateMappings(
  records: MappingRecordLike[],
  headers: CanonicalHeader[],
): MappingValidationResult {
  const issues: MappingValidationIssue[] = [];

  const headerByField = new Map(headers.map((h) => [h.original, h]));
  const recordByField = new Map<string, MappingRecordLike>();

  // ---- structural integrity: exactly one record per header ----------------
  for (const record of records) {
    if (recordByField.has(record.sourceField)) {
      issues.push(
        issue(
          'MAPPING_INVALID',
          `Source column "${record.sourceField}" has more than one mapping decision.`,
          record.sourceField,
        ),
      );
      continue;
    }
    recordByField.set(record.sourceField, record);

    if (!headerByField.has(record.sourceField)) {
      issues.push(
        issue(
          'MAPPING_INVALID',
          `Mapping decision refers to source column "${record.sourceField}", which is not present in the analyzed worksheet.`,
          record.sourceField,
        ),
      );
    }
  }

  for (const header of headers) {
    if (!recordByField.has(header.original)) {
      // Rule 1. Undecided is not the same as ignored.
      issues.push(
        issue(
          'MAPPING_REQUIRED',
          `Source column "${header.original}" has no mapping decision. Every column must be mapped, ignored or blocked before this run can execute.`,
          header.original,
        ),
      );
    }
  }

  // ---- per-record rules ---------------------------------------------------
  let unresolvedCount = 0;
  let sensitiveReviewCount = 0;
  let blockedCount = 0;
  let legalBlockedCount = 0;
  let ignoredCount = 0;
  let mappedCount = 0;

  /** destination key -> the records targeting it, for the collision rule. */
  const recordsByDestination = new Map<string, MappingRecordLike[]>();

  for (const record of records) {
    const { sourceField, state, destinationField, transform, composeOrder } = record;

    if (UNDECIDED_STATES.has(state)) {
      unresolvedCount++;
      if (state === 'SENSITIVE_REVIEW_REQUIRED') sensitiveReviewCount++;
      issues.push(
        issue(
          'MAPPING_REQUIRED',
          state === 'SENSITIVE_REVIEW_REQUIRED'
            ? `Source column "${sourceField}" holds special-category (KVKK Art. 6) content and needs an explicit review decision. Approve a destination, or mark it ignored/blocked — it will not be imported until you do.`
            : `Source column "${sourceField}" is still awaiting review (${state}). Confirm or change the suggestion before executing.`,
          sourceField,
          destinationField ?? undefined,
        ),
      );
      // An UNDECIDED row gets exactly this one issue and nothing more. The
      // destination/transform/composition checks below apply only to a row
      // that has DECIDED to write (a WRITING_STATE) — MANUAL_REQUIRED never
      // carries a destination by contract (mappingEngine.ts rule 7), so
      // running those checks here would ALSO report it as "decided but has
      // no destination": the same column simultaneously undecided and
      // decided, which is the exact contradiction this state machine must
      // never produce.
      continue;
    }

    if (state === 'LEGAL_BLOCKED') {
      legalBlockedCount++;
      // Rule 4.
      if (destinationField) {
        issues.push(
          issue(
            'LEGAL_BLOCKED',
            `Source column "${sourceField}" is blocked by an unresolved legal decision and must not be given a destination. Lifting the gate is a program-owner decision, not a mapping choice.`,
            sourceField,
            destinationField,
          ),
        );
      }
      continue;
    }

    if (state === 'BLOCKED') {
      blockedCount++;
      if (destinationField) {
        issues.push(
          issue(
            'MAPPING_INVALID',
            `Source column "${sourceField}" is marked blocked but still carries destination "${destinationField}". Clear the destination or change the decision.`,
            sourceField,
            destinationField,
          ),
        );
      }
      continue;
    }

    if (state === 'IGNORE') {
      ignoredCount++;
      if (destinationField) {
        issues.push(
          issue(
            'MAPPING_INVALID',
            `Source column "${sourceField}" is marked ignored but still carries destination "${destinationField}".`,
            sourceField,
            destinationField,
          ),
        );
      }
      continue;
    }

    if (!WRITING_STATES.has(state)) {
      // UNDECIDED_STATES already `continue`d above, so anything reaching here
      // is neither a recognised writing state nor a recognised undecided one.
      issues.push(
        issue(
          'MAPPING_INVALID',
          `Source column "${sourceField}" carries an unknown mapping state "${state}".`,
          sourceField,
        ),
      );
      continue;
    }

    // A writing state must actually point somewhere.
    if (!destinationField) {
      issues.push(
        issue(
          'MAPPING_REQUIRED',
          `Source column "${sourceField}" is marked as decided but has no destination. Choose a destination, or mark it ignored/blocked.`,
          sourceField,
        ),
      );
      continue;
    }

    const destination = getDestinationField(destinationField);
    if (!destination) {
      issues.push(
        issue(
          'MAPPING_INVALID',
          `Source column "${sourceField}" targets unknown destination "${destinationField}".`,
          sourceField,
          destinationField,
        ),
      );
      continue;
    }

    mappedCount++;

    // Rule 3. Transform must be on the destination's allow-list.
    if (transform !== null && !destination.allowedTransforms.includes(transform as never)) {
      issues.push(
        issue(
          'MAPPING_TYPE_INCOMPATIBLE',
          `Transform "${transform}" is not valid for destination "${destinationField}". Allowed: ${destination.allowedTransforms.join(', ')}.`,
          sourceField,
          destinationField,
        ),
      );
    }

    // Composition may only be requested where the destination declares it.
    if (composeOrder !== null && !destination.allowsComposition) {
      issues.push(
        issue(
          'MAPPING_COMPOSITION_UNSUPPORTED',
          `Destination "${destinationField}" does not support composing several source columns, but "${sourceField}" specifies a composition order.`,
          sourceField,
          destinationField,
        ),
      );
    }

    const bucket = recordsByDestination.get(destinationField);
    if (bucket) bucket.push(record);
    else recordsByDestination.set(destinationField, [record]);
  }

  // ---- Rule 2: destination collisions and composition well-formedness -----
  for (const [destinationKey, targeting] of recordsByDestination) {
    if (targeting.length < 2) {
      // A single source with a composeOrder is harmless but pointless; a
      // composition of one is still a valid composition, so nothing to flag.
      continue;
    }

    const destination = getDestinationField(destinationKey);
    if (!destination?.allowsComposition) {
      issues.push(
        issue(
          'MAPPING_DESTINATION_COLLISION',
          `${targeting.length} source columns (${targeting
            .map((r) => `"${r.sourceField}"`)
            .join(', ')}) target destination "${destinationKey}", which accepts only one. The later write would silently overwrite the earlier one.`,
          undefined,
          destinationKey,
        ),
      );
      continue;
    }

    // Composition is allowed here — but it must be TOTALLY ORDERED, or the
    // result is non-deterministic across reruns and idempotency breaks.
    const orders = targeting.map((r) => r.composeOrder);
    if (orders.some((o) => o === null || o === undefined)) {
      issues.push(
        issue(
          'MAPPING_COMPOSITION_UNSUPPORTED',
          `Destination "${destinationKey}" composes ${targeting.length} source columns, so every one of them needs an explicit composition order.`,
          undefined,
          destinationKey,
        ),
      );
      continue;
    }

    const seen = new Set<number>();
    for (const order of orders as number[]) {
      if (seen.has(order)) {
        issues.push(
          issue(
            'MAPPING_COMPOSITION_UNSUPPORTED',
            `Destination "${destinationKey}" has two source columns sharing composition order ${order}. The order must be unique, or the composed value changes between reruns and idempotency breaks.`,
            undefined,
            destinationKey,
          ),
        );
        break;
      }
      seen.add(order);
    }
  }

  // ---- Rule 5: required destinations --------------------------------------
  for (const destination of DESTINATION_FIELDS) {
    if (!destination.required) continue;
    if (recordsByDestination.has(destination.key)) continue;

    issues.push(
      issue(
        'MAPPING_REQUIRED',
        destination.key === 'provenance.sourceId'
          ? 'No source column is mapped to the provenance source id. Without it a rerun or a batch retry cannot recognise rows it already imported, and would create duplicate patients.'
          : `Required destination "${destination.label}" (${destination.key}) has no source column mapped to it.`,
        undefined,
        destination.key,
      ),
    );
  }

  return {
    valid: issues.length === 0,
    issues,
    unresolvedCount,
    sensitiveReviewCount,
    blockedCount,
    legalBlockedCount,
    ignoredCount,
    mappedCount,
  };
}
