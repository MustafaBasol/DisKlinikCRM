/**
 * legalGateGuard.ts — F3-DATA-MIG-TODAY-001-R11.
 *
 * ONE RULE: a source column stored as LEGAL_BLOCKED may not be edited from the
 * mapping screen. Not re-mapped, not re-stated, not even ignored.
 *
 * WHY THIS EXISTS SEPARATELY FROM validateMapping.ts. Rule 4 there forbids a
 * LEGAL_BLOCKED row from CARRYING a destination, and it reads the state AS
 * WRITTEN. That is the right rule for validating a mapping, and it is unable to
 * defend the gate on write: the mapping PUT route persists the client's `state`
 * verbatim, so a payload moving the row to RESOLVED in the same request leaves
 * Rule 4 with a RESOLVED row and nothing to fire on. The gate lifts silently
 * and the column becomes mappable.
 *
 * So the check that matters is not "what does the payload say this row is" but
 * "what is this row RIGHT NOW, in the database, independent of the payload" —
 * which is why this takes the STORED states as its authority and ignores every
 * state the client asserted.
 *
 * R11 widens what an operator can reach in the destination dropdown (legacy
 * preservation becomes selectable, and BLOCKED rows stop being locked), which
 * is exactly why the one class of column that must stay unreachable is pinned
 * down here rather than left to the UI declining to render a control.
 *
 * WHY IGNORE IS REFUSED TOO. IGNORE writes nothing, so permitting it would leak
 * no patient data. It would still relabel a KVKK Art. 6 legal exclusion as an
 * ordinary operator exclusion, dropping the column out of the LEGAL_BLOCKED
 * tally that the dry run surfaces and an auditor reads. The gate is about the
 * RECORD of the decision as much as the data.
 *
 * This cannot strand a run: dryRun.ts deliberately keeps LEGAL_BLOCKED out of
 * the blockers that suppress `executable`, so a run reaches Dry-run and Execute
 * with its legally-gated columns still gated.
 */

import { MigrationError } from '../contracts.js';

/** The stored state that this guard refuses to let an operator edit. */
export const LEGALLY_GATED_STATE = 'LEGAL_BLOCKED';

/**
 * Which of the edited columns are legally gated in the database RIGHT NOW.
 *
 * `storedStateBySourceField` must come from the same transaction that will
 * apply the edits — a state read outside it can be stale by the time the write
 * lands. A column absent from the map is not gated (it is unknown to this run,
 * and the update itself will simply match no rows).
 *
 * Order follows `editedSourceFields` so the resulting message is stable and
 * therefore assertable; duplicates in the input are reported once.
 */
export function findLegallyGatedEdits(
  editedSourceFields: readonly string[],
  storedStateBySourceField: ReadonlyMap<string, string>,
): string[] {
  const gated: string[] = [];
  const seen = new Set<string>();
  for (const sourceField of editedSourceFields) {
    if (seen.has(sourceField)) continue;
    seen.add(sourceField);
    if (storedStateBySourceField.get(sourceField) === LEGALLY_GATED_STATE) {
      gated.push(sourceField);
    }
  }
  return gated;
}

/**
 * Fail closed if any edited column is legally gated.
 *
 * The message names the source COLUMNS — vendor header text, which is schema,
 * never a patient value — so an operator can see which columns were refused
 * without any cell content reaching a response body, a log line or an audit
 * record.
 */
export function assertNoLegallyGatedEdits(
  editedSourceFields: readonly string[],
  storedStateBySourceField: ReadonlyMap<string, string>,
): void {
  const gated = findLegallyGatedEdits(editedSourceFields, storedStateBySourceField);
  if (gated.length === 0) return;

  const names = gated.map((f) => `"${f}"`).join(', ');
  throw new MigrationError('MAPPING_INVALID', {
    message:
      `${gated.length} source column(s) (${names}) are blocked by an unresolved legal decision ` +
      `and cannot be re-mapped, re-stated or ignored from the mapping screen. Lifting a legal ` +
      `gate is a program-owner decision, not a mapping choice.`,
  });
}
