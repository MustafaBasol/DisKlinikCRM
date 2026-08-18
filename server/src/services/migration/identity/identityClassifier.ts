/**
 * identityClassifier.ts — classify identity candidates BEFORE persistence
 * F3-DATA-MIG-TODAY
 *
 * This module is the gate between a legacy spreadsheet column and the encrypted
 * `PatientIdentityDocument` table. It answers exactly one question per source
 * row: may this value become a VERIFIED identity document, or must it be
 * QUARANTINED?
 *
 * QUARANTINED means: classified and counted, NEVER written. That middle state
 * is the whole point. A migration that imports a malformed legacy value has
 * manufactured a false verified identity; a migration that drops it has
 * destroyed evidence the clinic needs to reconcile its own records. Both are
 * wrong. The classification IS the retained record — see
 * `PERSISTABLE_IDENTITY_CLASSIFICATIONS` in contracts.ts, which lists exactly
 * one member.
 *
 * NO LOGGING IN THIS FILE. No `console.*`, no logger import. Every value that
 * flows out of here is a classification, a count, a row number, a length, or a
 * tenant-bound HMAC token — never a raw identity value, except the `normalized`
 * field on a VALID decision, which exists solely so the caller can hand it
 * straight to `encryptIdentityValue()`.
 */

import {
  IDENTITY_CLASSIFICATIONS,
  MigrationError,
  PERSISTABLE_IDENTITY_CLASSIFICATIONS,
  type IdentityClassification,
} from '../contracts.js';
import {
  assertPatientIdentityCryptoConfigured,
  computeIdentityLookupHash,
} from '../../../utils/patientIdentityCrypto.js';
import { validateTckn, tcknDigitLength } from './tckn.js';

/** Default document type. The backend string contract is TCKN | PASSPORT | FOREIGN_ID. */
const DEFAULT_DOC_TYPE = 'TCKN';

export interface IdentityCandidate {
  rowNumber: number;
  rawValue: string | null;
}

export interface IdentityDecision {
  rowNumber: number;
  classification: IdentityClassification;
  /** Present ONLY when classification === 'VALID'. */
  normalized: string | null;
  /** Present ONLY when classification === 'VALID'. */
  lookupHash: string | null;
  /** Safe shape descriptor for a quarantined value: digit count only. */
  digitLength?: number;
  warningCode?: string;
}

export interface ClassifyOptions {
  organizationId: string;
  docType?: string;
  /** lookupHash -> existing patientId, for the DESTINATION organization only. */
  existingLookupHashes?: ReadonlyMap<string, string>;
}

/** Internal first-pass record. Never returned, never logged. */
interface FirstPassEntry {
  candidate: IdentityCandidate;
  normalized: string | null;
  valid: boolean;
  digitLength: number;
  failureReason?: string;
}

/**
 * Classify a batch of identity candidates.
 *
 * TWO PASSES, O(N). Pass 1 validates each value and counts how many source rows
 * carry each normalized value in a Map. Pass 2 assigns classifications using
 * those counts. A nested "does any other row match this one" scan would be
 * O(N^2) — on the ~11,500-row first-customer workbook that is ~1.3x10^8
 * comparisons for a result a hash map gives in one linear sweep.
 */
export function classifyIdentities(
  candidates: IdentityCandidate[],
  opts: ClassifyOptions,
): IdentityDecision[] {
  const docType = opts.docType?.trim() || DEFAULT_DOC_TYPE;
  const existing = opts.existingLookupHashes;

  // ---- pass 1: normalize, validate, count ---------------------------------
  const entries: FirstPassEntry[] = [];
  const normalizedCounts = new Map<string, number>();
  let anyNonBlank = false;

  for (const candidate of candidates) {
    const raw = typeof candidate.rawValue === 'string' ? candidate.rawValue : '';
    const isBlank = raw.trim().length === 0;

    if (isBlank) {
      entries.push({ candidate, normalized: null, valid: false, digitLength: 0, failureReason: 'EMPTY' });
      continue;
    }

    anyNonBlank = true;
    const result = validateTckn(raw);
    entries.push({
      candidate,
      normalized: result.normalized.length > 0 ? result.normalized : null,
      valid: result.valid,
      digitLength: tcknDigitLength(raw),
      failureReason: result.failureReason,
    });

    // Only structurally valid values participate in duplicate detection. Two
    // rows both holding the placeholder "00000000000" are not a duplicate
    // PERSON; they are two independent data-entry defects, and lumping them
    // into DUPLICATE_SOURCE would hide that from the reviewer.
    if (result.valid) {
      normalizedCounts.set(result.normalized, (normalizedCounts.get(result.normalized) ?? 0) + 1);
    }
  }

  // FAIL CLOSED BEFORE TOUCHING ANY VALUE — but only when there is at least one
  // non-blank candidate. A workbook with no identity column at all must not
  // require the dedicated key material to be provisioned: demanding a secret
  // for data that does not exist would push operators towards setting a
  // throwaway value, which is exactly how key isolation erodes in practice.
  if (anyNonBlank) {
    assertPatientIdentityCryptoConfigured();
  }

  // ---- pass 2: assign classifications -------------------------------------
  const decisions: IdentityDecision[] = [];

  for (const entry of entries) {
    const rowNumber = entry.candidate.rowNumber;

    // Blank / null -> ABSENT.
    // NOT an error and NOT a warning: roughly 23 % of the real source rows
    // legitimately have no T.C. Kimlik No recorded. Treating absence as a
    // failure would flood the dry-run report with noise and hide the real
    // defects underneath it.
    if (entry.normalized === null && entry.failureReason === 'EMPTY') {
      decisions.push(quarantine(rowNumber, 'ABSENT'));
      continue;
    }

    // Fails shape or checksum -> INVALID_LEGACY. QUARANTINED: no identity
    // document is written.
    // The value is a historical DATA-ENTRY ERROR, not storage corruption. It
    // must be neither imported as a verified identity (that would launder a
    // typo into a government identifier) nor silently discarded (the clinic
    // needs to know which rows to go and fix). Only the classification and the
    // digit count are retained.
    //
    // Note on the 12-digit values observed in the source: those are almost
    // certainly VERGİ KİMLİK NO (tax numbers) misfiled into the T.C. column by
    // staff entering corporate/invoice records. `digitLength` is what lets a
    // reviewer reach that conclusion without anyone reading a single value.
    if (!entry.valid) {
      decisions.push({
        ...quarantine(rowNumber, 'INVALID_LEGACY'),
        digitLength: entry.digitLength,
        warningCode: entry.failureReason ? `TCKN_${entry.failureReason}` : 'TCKN_INVALID',
      });
      continue;
    }

    const normalized = entry.normalized as string;

    // The same normalized value on >= 2 SOURCE rows in this batch -> ALL of
    // those rows get DUPLICATE_SOURCE. QUARANTINED, NEVER auto-merged.
    // Which of the colliding rows (if any) is the "real" one is not
    // determinable from the workbook: it may be a genuine duplicate patient
    // record, a guardian's number recorded on a child's row, or a copy-paste
    // error. Auto-picking one would merge two people's clinical histories.
    // Every colliding row is quarantined, not just the second occurrence —
    // quarantining only the later rows would silently bless whichever row
    // happened to be sorted first.
    if ((normalizedCounts.get(normalized) ?? 0) >= 2) {
      decisions.push({
        ...quarantine(rowNumber, 'DUPLICATE_SOURCE'),
        digitLength: entry.digitLength,
        warningCode: 'TCKN_DUPLICATE_IN_SOURCE',
      });
      continue;
    }

    // A valid value whose lookupHash already exists in the DESTINATION
    // organization against a DIFFERENT patient -> AMBIGUOUS. QUARANTINED.
    // A guardian's T.C. appearing on a child's record is SOURCE AMBIGUITY and
    // data-quality debt — it is NOT legitimate patient identity semantics.
    // NoraMedi models a guardian through the guardian/relation fields, never by
    // stamping the guardian's national identity number onto the minor's
    // identity document. Such a collision is therefore never auto-merged and
    // never treated as correct; it is handed to a human.
    let lookupHash: string;
    try {
      lookupHash = computeIdentityLookupHash(opts.organizationId, docType, normalized);
    } catch (error) {
      // A configuration/tenant-context failure is fatal for the whole batch and
      // must propagate — never degrade into a quarantine that looks like a data
      // problem.
      if (error instanceof MigrationError) throw error;
      throw new MigrationError('INTERNAL_ERROR', {
        message: 'Identity lookup token computation failed',
        detail: 'Lookup token could not be computed for a validated identity value.',
      });
    }

    const existingPatientId = existing?.get(lookupHash);
    if (existingPatientId !== undefined) {
      decisions.push({
        ...quarantine(rowNumber, 'AMBIGUOUS'),
        digitLength: entry.digitLength,
        warningCode: 'TCKN_DESTINATION_COLLISION',
      });
      continue;
    }

    decisions.push({
      rowNumber,
      classification: 'VALID',
      normalized,
      lookupHash,
    });
  }

  // Anything that did not resolve cleanly into one of the branches above ->
  // MANUAL_REVIEW. Defensive by design: the loop is total today, so this is
  // unreachable, but a future edit that adds a branch and forgets to push a
  // decision must degrade into "a human looks at it", never into a dropped row
  // whose absence nobody notices.
  if (decisions.length !== candidates.length) {
    const decided = new Set(decisions.map((d) => d.rowNumber));
    for (const candidate of candidates) {
      if (!decided.has(candidate.rowNumber)) {
        decisions.push({
          ...quarantine(candidate.rowNumber, 'MANUAL_REVIEW'),
          warningCode: 'TCKN_UNRESOLVED',
        });
      }
    }
  }

  assertOnlyValidIsPersistable(decisions);
  return decisions;
}

/** A quarantined decision: classification only, never a value or a token. */
function quarantine(rowNumber: number, classification: IdentityClassification): IdentityDecision {
  return { rowNumber, classification, normalized: null, lookupHash: null };
}

/**
 * RUNTIME INVARIANT — the single guarantee this module exists to provide.
 *
 * Only `VALID` may carry `normalized` + `lookupHash`; everything else must carry
 * neither. This is asserted rather than merely documented so a future edit
 * cannot accidentally make a quarantined value persistable: the persistence
 * layer writes whatever `normalized`/`lookupHash` it is handed, so a leak here
 * would be a silent, permanent write of an unverified national identity number.
 * Failing the whole batch is the correct response — a partially-correct import
 * of identity data is worse than none.
 */
function assertOnlyValidIsPersistable(decisions: readonly IdentityDecision[]): void {
  for (const decision of decisions) {
    const persistable = PERSISTABLE_IDENTITY_CLASSIFICATIONS.includes(decision.classification);
    const carriesValue = decision.normalized !== null || decision.lookupHash !== null;

    if (!persistable && carriesValue) {
      throw new MigrationError('INTERNAL_ERROR', {
        message: 'Quarantined identity decision carried persistable material',
        detail:
          `Classification ${decision.classification} is not persistable but the ` +
          'decision carried a normalized value or a lookup token. Refusing to ' +
          'return the batch.',
      });
    }
    if (persistable && (decision.normalized === null || decision.lookupHash === null)) {
      throw new MigrationError('INTERNAL_ERROR', {
        message: 'Persistable identity decision was incomplete',
        detail:
          'A VALID classification must carry both a normalized value and a ' +
          'tenant-bound lookup token, or it cannot be written safely.',
      });
    }
  }
}

/**
 * Count decisions per classification.
 *
 * Every classification is present with an explicit 0 rather than omitted, so a
 * dry-run report renders a complete, stable set of rows and a reviewer can tell
 * "zero ambiguous values" apart from "ambiguity was never evaluated".
 */
export function summarizeClassifications(
  decisions: IdentityDecision[],
): Record<IdentityClassification, number> {
  const summary = {} as Record<IdentityClassification, number>;
  for (const classification of IDENTITY_CLASSIFICATIONS) {
    summary[classification] = 0;
  }
  for (const decision of decisions) {
    summary[decision.classification] += 1;
  }
  return summary;
}
