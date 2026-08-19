/**
 * mappingEngine.ts — F3-DATA-MIG-TODAY
 *
 * ###########################################################################
 * #  NO OPAQUE AI MAPPING. NOT NOW, NOT LATER.                              #
 * #                                                                         #
 * #  Every suggestion this engine produces is EXPLAINABLE by exactly one    #
 * #  deterministic rule, and the `reason` field records WHICH rule fired.   #
 * #  A reviewer approving a mapping for 14,890 real patients must be able   #
 * #  to answer "why is this column going there?" with a rule name, not with #
 * #  "the model thought so".                                                #
 * #                                                                         #
 * #  Deterministic rules remain AUTHORITATIVE. If a model is ever added to  #
 * #  this product, it may only ANNOTATE — it may never override a rule,     #
 * #  never invent a destination that is not in DESTINATION_FIELDS, and      #
 * #  never raise a state above AUTO_REVIEW. The same headers must produce   #
 * #  the same suggestions on every run, on every machine, forever;          #
 * #  otherwise a re-mapped rerun writes different data from the same file.  #
 * ###########################################################################
 *
 * RESOLUTION ORDER — FIRST MATCH WINS:
 *   1. SAVED_TEMPLATE          conf 95   a previously approved template
 *   2. FIRST_CUSTOMER_MATRIX   conf 100  matrix hit on the BYTE-EXACT header
 *   3. NORMALIZED              conf 90   matrix hit on the normalized header
 *   4. EXACT_HEADER            conf 85   header equals a destination key/segment
 *   5. ALIAS                   conf 80   vendor-neutral alias table
 *   6. EMPTY_SOURCE_COLUMN     conf 100  headerless AND confirmed zero data -> IGNORE
 *   7. UNKNOWN_HEADER          conf 0    no rule matched -> MANUAL_REQUIRED
 *
 * PERFORMANCE: O(headers). Every lookup structure is built ONCE at module
 * load; the per-header work is a handful of Map.get calls. Nothing here ever
 * touches a row. 91 headers x 14,890 rows must never become a nested scan.
 */

import {
  DESTINATION_FIELDS,
  getDestinationField,
  type CanonicalCellType,
  type CanonicalHeader,
  type DestinationFieldDef,
  type DestinationValueType,
  type MappingReason,
  type MappingState,
  type MappingSuggestion,
  type SourceColumnProfile,
  type TransformName,
} from '../contracts.js';
import {
  FIRST_CUSTOMER_MATRIX,
  FIRST_CUSTOMER_MATRIX_BY_FIELD,
  FIRST_CUSTOMER_SOURCE_SYSTEM,
  type MatrixEntry,
} from './firstCustomerMatrix.js';
import { normalizeHeader } from './normalizeHeader.js';

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export interface SavedTemplateRow {
  destinationField: string | null;
  transform: TransformName | null;
  composeOrder: number | null;
}

export interface SuggestOptions {
  sourceSystem: string;
  /**
   * A previously approved mapping for THIS sourceSystem, keyed BYTE-EXACTLY on
   * the original header. Never keyed on the normalized form — see
   * normalizeHeader.ts for why that would silently re-key on rerun.
   */
  savedTemplate?: ReadonlyMap<string, SavedTemplateRow>;
}

/**
 * The concrete object this engine returns. It IS a MappingSuggestion (the
 * declared return type of suggestMappings) plus one optional annotation.
 *
 * `typeConflict` is how a reviewer SEES the disagreement instead of having it
 * silently resolved: the matrix is authoritative about MEANING, the profile is
 * authoritative about SHAPE, and when they disagree we keep the meaning,
 * downgrade the state to AUTO_REVIEW, and record both sides here.
 */
export interface EngineSuggestion extends MappingSuggestion {
  typeConflict?: {
    destinationType: DestinationValueType;
    observedMajorityType: CanonicalCellType;
    /** 0..1 share of non-empty cells carrying observedMajorityType. */
    observedShare: number;
  };
}

export function hasTypeConflict(
  s: MappingSuggestion,
): s is EngineSuggestion & { typeConflict: NonNullable<EngineSuggestion['typeConflict']> } {
  return (s as EngineSuggestion).typeConflict !== undefined;
}

// ---------------------------------------------------------------------------
// Lookup tables — built ONCE
// ---------------------------------------------------------------------------

/** normalized header -> matrix entry. Built once; see the perf note above. */
const MATRIX_BY_NORMALIZED: ReadonlyMap<string, MatrixEntry> = (() => {
  const m = new Map<string, MatrixEntry>();
  for (const e of FIRST_CUSTOMER_MATRIX) {
    const key = normalizeHeader(e.sourceField);
    // First writer wins, so a future normalization collision degrades to
    // "the earlier column's decision" rather than to a nondeterministic one.
    if (!m.has(key)) m.set(key, e);
  }
  return m;
})();

/** normalized destination key AND normalized last path segment -> destination key. */
const DESTINATION_BY_HEADER_FORM: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const d of DESTINATION_FIELDS) {
    const segments = d.key.split('.');
    const last = segments[segments.length - 1];
    for (const form of [d.key, last]) {
      const key = normalizeHeader(form);
      if (!m.has(key)) m.set(key, d.key);
    }
  }
  return m;
})();

/** Strip separators so 'DOGUM_TARIHI' and 'DOGUMTARIHI' hit the same alias. */
function compactKey(normalized: string): string {
  return normalized.replace(/_/g, '');
}

/**
 * A SMALL, EXPLICIT, VENDOR-NEUTRAL alias table.
 *
 * Deliberately small. Every entry is a term that means the same thing across
 * Turkish dental practice-management exports generally, not a guess about one
 * vendor's schema. Vendor-specific knowledge belongs in a mapping profile
 * (firstCustomerMatrix.ts), never here — an alias fires for EVERY customer, so
 * a wrong entry here mis-maps every future migration at once.
 *
 * Keys are normalizeHeader() output with separators removed (see compactKey),
 * so 'Doğum Tarihi', 'DOGUM_TARIHI' and 'dogumtarihi' all resolve identically.
 *
 * Deliberately ABSENT: any alias onto a consent, note, postal-code or
 * identity-adjacent destination. Consent is never inferred, clinical notes are
 * legally gated, and identity aliasing is left to explicit profiles only.
 */
export const DESTINATION_ALIASES: ReadonlyMap<string, string> = new Map<string, string>([
  // first name
  ['FIRSTNAME', 'patient.firstName'],
  ['AD', 'patient.firstName'],
  ['ADI', 'patient.firstName'],
  ['NAME', 'patient.firstName'],
  // last name
  ['SURNAME', 'patient.lastName'],
  ['LASTNAME', 'patient.lastName'],
  ['SOYAD', 'patient.lastName'],
  ['SOYADI', 'patient.lastName'],
  // phone
  ['PHONE', 'patient.phone'],
  ['GSM', 'patient.phone'],
  ['MOBILE', 'patient.phone'],
  ['CEP', 'patient.phone'],
  ['CEPTEL', 'patient.phone'],
  ['MOBILEPHONE', 'patient.phone'],
  // e-mail
  ['EMAIL', 'patient.email'],
  ['MAIL', 'patient.email'],
  ['EPOSTA', 'patient.email'],
  // date of birth
  ['BIRTHDATE', 'patient.dateOfBirth'],
  ['DATEOFBIRTH', 'patient.dateOfBirth'],
  ['DOB', 'patient.dateOfBirth'],
  ['DOGUMTARIHI', 'patient.dateOfBirth'],
  // address / city / country
  ['ADDRESS', 'patient.address'],
  ['ADRES', 'patient.address'],
  ['CITY', 'patient.city'],
  ['SEHIR', 'patient.city'],
  ['COUNTRY', 'patient.country'],
  ['ULKE', 'patient.country'],
  // gender
  ['GENDER', 'patient.gender'],
  ['CINSIYET', 'patient.gender'],
  ['SEX', 'patient.gender'],
]);

// ---------------------------------------------------------------------------
// Type-compatibility gate
// ---------------------------------------------------------------------------

/**
 * The dominant NON-EMPTY cell type in a column, with its share.
 *
 * Empty cells are excluded from the denominator on purpose: a column that is
 * 99 % empty and 1 % date is a DATE column with poor fill, not an empty one.
 * A column with no filled cells at all returns null — see the ULKE case, which
 * is 0 % filled yet a valid mapping.
 */
function observedMajority(
  profile: SourceColumnProfile | undefined,
): { type: CanonicalCellType; share: number } | null {
  if (!profile) return null;
  const counts = profile.typeCounts;
  let total = 0;
  let bestType: CanonicalCellType | null = null;
  let bestCount = 0;
  for (const key of Object.keys(counts) as CanonicalCellType[]) {
    if (key === 'empty') continue;
    const c = counts[key] ?? 0;
    total += c;
    if (c > bestCount) {
      bestCount = c;
      bestType = key;
    }
  }
  if (total === 0 || bestType === null) return null;
  const share = bestCount / total;
  // "Majority" means strictly more than half. A 50/50 column is genuinely
  // mixed and must not be treated as evidence against the matrix.
  return share > 0.5 ? { type: bestType, share } : null;
}

/**
 * Which observed majority types a destination type can legitimately receive.
 *
 * Read as: "a column that is majority X may be written to a destination of
 * type T". Anything not listed is a CONFLICT.
 */
const COMPATIBLE_MAJORITIES: Record<DestinationValueType, ReadonlySet<CanonicalCellType>> = {
  // Free text. A majority-date or majority-boolean column is not a name/address.
  string: new Set<CanonicalCellType>(['string', 'number']),
  // Phones arrive as text, or as numbers whose leading zero Excel destroyed.
  phone: new Set<CanonicalCellType>(['string', 'number']),
  // An e-mail is never a number, a date or a boolean.
  email: new Set<CanonicalCellType>(['string']),
  // Real date cells, Excel serials (number) and Turkish date strings.
  date: new Set<CanonicalCellType>(['date', 'number', 'string']),
  // Legacy enum tokens: 'E'/'K', 1/2, or a real boolean flag (SILINDI).
  enum: new Set<CanonicalCellType>(['string', 'number', 'boolean']),
  // Identity numbers: 10,799 of the measured TCNO values are number cells.
  identity: new Set<CanonicalCellType>(['string', 'number']),
  // A vendor primary key is text or an integer.
  provenance: new Set<CanonicalCellType>(['string', 'number']),
  // A reference label is text; a numeric code is possible.
  reference: new Set<CanonicalCellType>(['string', 'number']),
};

/**
 * A HARD GATE at every step. `null` means compatible (or unknowable, which is
 * treated as compatible — absence of shape evidence must never veto a decision
 * that was made on meaning). A non-null result is the conflict to report.
 */
function typeConflictFor(
  dest: DestinationFieldDef,
  profile: SourceColumnProfile | undefined,
): EngineSuggestion['typeConflict'] {
  const majority = observedMajority(profile);
  if (!majority) return undefined;
  if (COMPATIBLE_MAJORITIES[dest.type].has(majority.type)) return undefined;
  return {
    destinationType: dest.type,
    observedMajorityType: majority.type,
    observedShare: Math.round(majority.share * 10_000) / 10_000,
  };
}

// ---------------------------------------------------------------------------
// Suggestion assembly
// ---------------------------------------------------------------------------

function defaultTransformFor(dest: DestinationFieldDef): TransformName | null {
  // The catalog lists allowedTransforms in preference order; the first entry is
  // the documented default for that destination.
  return dest.allowedTransforms.length > 0 ? dest.allowedTransforms[0] : null;
}

interface BuildArgs {
  header: CanonicalHeader;
  normalized: string;
  destinationKey: string | null;
  transform: TransformName | null;
  composeOrder: number | null;
  confidence: number;
  reason: MappingReason;
  state: MappingState;
  profile: SourceColumnProfile | undefined;
  /**
   * true for recorded decisions (saved template, matrix): a shape conflict
   * DOWNGRADES to AUTO_REVIEW but keeps the destination.
   * false for heuristics (exact/alias): a shape conflict REJECTS the proposal
   * and the caller falls through to the next rule.
   */
  keepOnConflict: boolean;
}

function build(args: BuildArgs): EngineSuggestion | null {
  const dest = args.destinationKey === null ? undefined : getDestinationField(args.destinationKey);
  const conflict = dest ? typeConflictFor(dest, args.profile) : undefined;

  if (conflict && !args.keepOnConflict) return null;

  const suggestion: EngineSuggestion = {
    sourceField: args.header.original,
    sourceLabel: args.header.original,
    sourceIndex: args.header.index,
    sourceNormalized: args.normalized,
    destinationField: dest ? dest.key : null,
    destinationLabel: dest ? dest.label : null,
    transform: dest ? args.transform : null,
    composeOrder: dest ? args.composeOrder : null,
    confidence: args.confidence,
    reason: args.reason,
    mappingState: args.state,
  };

  if (conflict) {
    // Keep the MEANING, surface the SHAPE disagreement, and force a human to
    // look at it. Never silently resolve one against the other.
    suggestion.typeConflict = conflict;
    suggestion.mappingState = 'AUTO_REVIEW';
    suggestion.confidence = Math.min(suggestion.confidence, 50);
  }

  return suggestion;
}

/**
 * Deterministic mapping suggestions for a parsed workbook's headers.
 *
 * @param headers  every physical header, byte-exact, in column order
 * @param profiles per-column aggregate profiles (counts only, never values)
 */
export function suggestMappings(
  headers: CanonicalHeader[],
  profiles: SourceColumnProfile[],
  opts: SuggestOptions,
): MappingSuggestion[] {
  // O(profiles) once, then O(1) per header. Index first (physical position is
  // authoritative), header text second (a defensive fallback for profilers
  // that only report the header).
  const profileByIndex = new Map<number, SourceColumnProfile>();
  const profileByHeader = new Map<string, SourceColumnProfile>();
  for (const p of profiles) {
    if (!profileByIndex.has(p.index)) profileByIndex.set(p.index, p);
    if (!profileByHeader.has(p.header)) profileByHeader.set(p.header, p);
  }

  /**
   * The first-customer matrix is a PROFILE FOR ONE SOURCE SYSTEM, and it says
   * so in its name. Applying it to a different vendor's export would attach
   * this customer's legal gates and semantics to columns that merely share a
   * name — e.g. another vendor's SILINDI could mean something else entirely.
   * Other source systems fall through to the vendor-neutral rules (4-6).
   * SOURCE_SYSTEM_DEFAULT in contracts.ts is this same value, so the ordinary
   * path does use the matrix.
   */
  const matrixApplies = opts.sourceSystem === FIRST_CUSTOMER_SOURCE_SYSTEM;
  const template = opts.savedTemplate;

  const out: MappingSuggestion[] = [];

  for (const header of headers) {
    // Match on THIS module's normalization, and report the same value, so the
    // suggestion is internally consistent and a reviewer can reproduce it.
    const normalized = normalizeHeader(header.original);
    const profile = profileByIndex.get(header.index) ?? profileByHeader.get(header.original);

    // --- 1. saved template (byte-exact key) -------------------------------
    const saved = template?.get(header.original);
    if (saved) {
      const built = build({
        header,
        normalized,
        destinationKey: saved.destinationField,
        transform: saved.transform,
        composeOrder: saved.composeOrder,
        confidence: 95,
        reason: 'SAVED_TEMPLATE',
        // A saved row with no destination is an operator's recorded "ignore
        // this column", which is a decision, not an unresolved gap.
        state: saved.destinationField === null ? 'IGNORE' : 'AUTO_CONFIDENT',
        profile,
        keepOnConflict: true, // a human approved it; surface, do not discard
      });
      if (built) {
        out.push(built);
        continue;
      }
    }

    // --- 2. matrix, byte-exact header -------------------------------------
    const exactEntry = matrixApplies ? FIRST_CUSTOMER_MATRIX_BY_FIELD.get(header.original) : undefined;
    if (exactEntry) {
      const built = build({
        header,
        normalized,
        destinationKey: exactEntry.destinationField,
        transform: exactEntry.transform,
        composeOrder: exactEntry.composeOrder ?? null,
        confidence: exactEntry.confidence,
        reason: exactEntry.reason,
        state: exactEntry.mappingState,
        profile,
        keepOnConflict: true, // the matrix is authoritative about MEANING
      });
      if (built) {
        out.push(built);
        continue;
      }
    }

    // --- 3. matrix, normalized header -------------------------------------
    const normEntry = matrixApplies ? MATRIX_BY_NORMALIZED.get(normalized) : undefined;
    if (normEntry) {
      const built = build({
        header,
        normalized,
        destinationKey: normEntry.destinationField,
        transform: normEntry.transform,
        composeOrder: normEntry.composeOrder ?? null,
        confidence: 90,
        reason: 'NORMALIZED',
        // AUTO_REVIEW, never AUTO_CONFIDENT: the header did not match
        // byte-exactly, so this is a NEARBY column, not THE column. A human
        // confirms that the vendor renamed or re-cased it rather than adding
        // a different column with a similar name.
        state:
          normEntry.destinationField === null
            ? normEntry.mappingState // an ignore/block stays what it is
            : 'AUTO_REVIEW',
        profile,
        keepOnConflict: true,
      });
      if (built) {
        out.push(built);
        continue;
      }
    }

    // --- 4. exact destination key or last path segment --------------------
    const exactDestKey = DESTINATION_BY_HEADER_FORM.get(normalized);
    if (exactDestKey) {
      const dest = getDestinationField(exactDestKey);
      const built = dest
        ? build({
            header,
            normalized,
            destinationKey: dest.key,
            transform: defaultTransformFor(dest),
            composeOrder: null,
            confidence: 85,
            reason: 'EXACT_HEADER',
            state: 'AUTO_REVIEW',
            profile,
            keepOnConflict: false, // heuristic: a shape conflict rejects it
          })
        : null;
      if (built) {
        out.push(built);
        continue;
      }
    }

    // --- 5. vendor-neutral alias table ------------------------------------
    const aliasKey = DESTINATION_ALIASES.get(compactKey(normalized));
    if (aliasKey) {
      const dest = getDestinationField(aliasKey);
      const built = dest
        ? build({
            header,
            normalized,
            destinationKey: dest.key,
            transform: defaultTransformFor(dest),
            composeOrder: null,
            confidence: 80,
            reason: 'ALIAS',
            state: 'AUTO_REVIEW',
            profile,
            keepOnConflict: false, // heuristic: a shape conflict rejects it
          })
        : null;
      if (built) {
        out.push(built);
        continue;
      }
    }

    // --- 6. headerless column with CONFIRMED zero meaningful data ---------
    // `header.headerWasBlank` (set only by canonicalParser.ts when the header
    // CELL itself was blank) tells apart a genuinely nameless column from a
    // named one that merely produced this same synthesized text — a plain
    // string match on 'COLUMN_<index>' could not make that distinction.
    // `profile.filledCount === 0` is the SAME "meaningful data" measurement
    // the mapping screen's fill-rate bar already shows the operator, so this
    // decision and what the operator sees can never disagree. No profile at
    // all means unknowable, which stays MANUAL_REQUIRED below — absence of
    // evidence is never treated as evidence of emptiness.
    //
    // Nuance (do not widen this without re-reading the two rules): a blank
    // header with SOME data (however little) still falls through to rule 7 —
    // masking one real patient value as an "empty" column would silently drop
    // it, which is exactly what MANUAL_REQUIRED exists to prevent.
    if (header.headerWasBlank && profile !== undefined && profile.filledCount === 0) {
      out.push({
        sourceField: header.original,
        sourceLabel: header.original,
        sourceIndex: header.index,
        sourceNormalized: normalized,
        destinationField: null,
        destinationLabel: null,
        transform: null,
        composeOrder: null,
        confidence: 100,
        reason: 'EMPTY_SOURCE_COLUMN',
        mappingState: 'IGNORE',
      });
      continue;
    }

    // --- 7. nothing matched -----------------------------------------------
    // MANUAL_REQUIRED, not IGNORE. An unrecognized column is an UNANSWERED
    // QUESTION; defaulting it to IGNORE would let a whole column of real
    // patient data disappear without anyone deciding that it should.
    out.push({
      sourceField: header.original,
      sourceLabel: header.original,
      sourceIndex: header.index,
      sourceNormalized: normalized,
      destinationField: null,
      destinationLabel: null,
      transform: null,
      composeOrder: null,
      confidence: 0,
      reason: 'UNKNOWN_HEADER',
      mappingState: 'MANUAL_REQUIRED',
    });
  }

  return out;
}
