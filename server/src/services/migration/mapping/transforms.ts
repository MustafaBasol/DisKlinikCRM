/**
 * transforms.ts — F3-DATA-MIG-TODAY
 *
 * The deterministic value transforms named by TRANSFORM_NAMES in contracts.ts.
 *
 * PRIVACY CONTRACT FOR THIS WHOLE FILE — no exceptions:
 *   - `warnings` entries are CODES. Never a cell value, never a fragment of
 *     one, never a length that could identify one.
 *   - `error.message` is a TEMPLATE. It names the transform and the class of
 *     failure. It never interpolates the offending value.
 *   - Nothing here logs. Transforms are pure functions of their input.
 * A migration processes 14,890 rows of real patient data; a single value
 * interpolated into a warning string would be copied into the dry-run report,
 * the audit trail and the operator's screen at once.
 *
 * DETERMINISM CONTRACT: every transform is a pure function of (cells, rowNumber)
 * with no clock dependency except `date_excel_serial`'s future check, no
 * randomness, and no dependence on iteration order beyond the caller-supplied
 * composition order. Re-running the same workbook must produce byte-identical
 * output, or idempotent re-import is impossible.
 */

import type { CanonicalCell, MigrationErrorCode, TransformName } from '../contracts.js';
import { normalizeHeader, turkishUpper } from './normalizeHeader.js';

export interface TransformInput {
  /**
   * The source cells for this destination, already in COMPOSITION ORDER
   * (ascending composeOrder). Single-source transforms read cells[0].
   * The caller owns the ordering; a transform must never re-sort, because a
   * transform-side sort would be a second, competing definition of the rule.
   */
  cells: CanonicalCell[];
  /** 1-based data-row number, for the caller's row-level reporting. */
  rowNumber: number;
}

export interface TransformOutput {
  value: string | number | boolean | Date | null;
  /** Stable CODES only. See the privacy contract above. */
  warnings: string[];
  /** Present only when the row must fail. `message` is a template. */
  error?: { code: MigrationErrorCode; message: string };
}

export type TransformFn = (input: TransformInput) => TransformOutput;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const EMPTY_CELL: CanonicalCell = { type: 'empty', text: '' };

/** cells[0] with an explicit empty fallback, so no transform can throw on a short row. */
function first(input: TransformInput): CanonicalCell {
  return input.cells.length > 0 ? input.cells[0] : EMPTY_CELL;
}

function ok(value: TransformOutput['value'], ...warnings: string[]): TransformOutput {
  return { value, warnings };
}

function fail(code: MigrationErrorCode, message: string): TransformOutput {
  return { value: null, warnings: [], error: { code, message } };
}

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// text transforms
// ---------------------------------------------------------------------------

/** Trim only. '' becomes NULL, not ''. An empty string is a value; absence is not. */
const trim: TransformFn = (input) => {
  const t = first(input).text.trim();
  return ok(t === '' ? null : t);
};

/**
 * Trim, then collapse every internal whitespace run to a single space.
 * WHY collapse: legacy name fields routinely carry double spaces and stray
 * tabs. Collapsing is deterministic and makes reruns produce the same string;
 * it does NOT change which characters are present, so it cannot alter identity.
 */
const trimCollapse: TransformFn = (input) => {
  const t = first(input).text.trim().replace(/\s+/g, ' ');
  return ok(t === '' ? null : t);
};

/**
 * E-mail: trim + lowercase, '' -> NULL.
 *
 * An invalid address is DROPPED with a warning, NEVER a row failure. Measured
 * source: 7 filled values of which roughly 1 parses. Failing rows over a
 * decade-old typo would block a migration to protect a field that
 * contracts.ts already declares is never a dedup key.
 * The warning carries no value — only the code.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const lowerTrim: TransformFn = (input) => {
  const t = first(input).text.trim().toLowerCase();
  if (t === '') return ok(null);
  if (!EMAIL_SHAPE.test(t)) return ok(null, 'EMAIL_INVALID_DROPPED');
  return ok(t);
};

// ---------------------------------------------------------------------------
// phone
// ---------------------------------------------------------------------------

/**
 * Canonical Turkish phone normalization -> '+90XXXXXXXXXX'.
 *
 * ###########################################################################
 * # THE RESULT OF THIS TRANSFORM IS **NEVER** A DEDUPLICATION KEY.          #
 * # 28.6 % of source rows share a phone number, because families share      #
 * # phones — that is supported product behaviour, not duplicate data.       #
 * # Merging on this value would silently fuse distinct patients, including  #
 * # children onto a parent. The dry-run reports shared-phone impact         #
 * # instead; nothing in the pipeline may match, merge or dedupe on it.      #
 * ###########################################################################
 *
 * Excel destroys the leading zero of a national number stored as a NUMBER
 * (271 rows in the measured source). A bare 10-digit value beginning with `5`
 * is therefore genuinely AMBIGUOUS: it is either a Turkish mobile whose zero
 * Excel ate, or a foreign number that happens to start with 5. We apply the
 * Turkish assumption because the source is a Turkish clinic — but we ALWAYS
 * emit PHONE_LEADING_ZERO_RESTORED so the assumption is CLASSIFIED and
 * countable in the dry-run report, never a silent guess.
 */
const phoneTr: TransformFn = (input) => {
  const cell = first(input);
  const raw = cell.text.trim();
  if (raw === '') return ok(null);

  // Strip the formatting humans type: spaces, dashes, parentheses, dots,
  // non-breaking spaces and underscores. Everything else is significant.
  const stripped = raw.replace(/[\s().\-_ ]/g, '');
  const hadPlus = stripped.startsWith('+');
  const digits = stripped.replace(/\D/g, '');

  // Anything with a non-digit left over (letters, 'DAHILI', 'YOK') is junk.
  const digitsOnlyBody = hadPlus ? stripped.slice(1) : stripped;
  if (digits === '' || !/^\d+$/.test(digitsOnlyBody)) {
    return ok(null, 'PHONE_UNPARSEABLE');
  }

  const warnings: string[] = [];
  let national: string;

  if (digits.length === 12 && digits.startsWith('90')) {
    // '+90…' and bare '90…' are the same 12-digit shape after stripping.
    national = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    national = digits.slice(1);
  } else if (digits.length === 10) {
    national = digits;
    if (national.startsWith('5')) {
      // See the ambiguity note above. Restore, but always classify.
      warnings.push('PHONE_LEADING_ZERO_RESTORED');
    }
  } else {
    return ok(null, 'PHONE_UNPARSEABLE');
  }

  if (national.length !== 10 || national.startsWith('0')) {
    return ok(null, 'PHONE_UNPARSEABLE');
  }

  return ok(`+90${national}`, ...warnings);
};

// ---------------------------------------------------------------------------
// date
// ---------------------------------------------------------------------------

/**
 * Excel serial -> UTC-noon Date.
 *
 * Excel's 1900 epoch carries the inherited Lotus 1-2-3 bug: it believes
 * 1900-02-29 existed (serial 60). Serials >= 61 are therefore one day ahead of
 * the true calendar, which the conventional 1899-12-30 anchor corrects.
 * Serials 1..59 predate the phantom day and use the 1899-12-31 anchor.
 * Serial 60 itself is the phantom day and has no true calendar date.
 *
 * UTC NOON, not midnight: a birth date stored at 00:00 UTC renders as the
 * PREVIOUS DAY for any viewer west of Greenwich, and as the same day east of
 * it. Anchoring at 12:00 UTC keeps the calendar date stable across every
 * timezone the product is read in.
 */
function excelSerialToUtcNoon(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const whole = Math.floor(serial);
  if (whole < 1 || whole > 2_958_465) return null; // 2958465 = 9999-12-31
  if (whole === 60) return null; // the phantom 1900-02-29
  const anchor = whole >= 61 ? Date.UTC(1899, 11, 30) : Date.UTC(1899, 11, 31);
  const d = new Date(anchor + whole * DAY_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0, 0));
}

function utcNoon(year: number, month1: number, day: number): Date | null {
  if (year < 1000 || year > 9999 || month1 < 1 || month1 > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month1 - 1, day, 12, 0, 0, 0));
  // Reject rolled-over dates (31.02.1990 would otherwise become 03.03.1990).
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month1 - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

/** dd.MM.yyyy · dd/MM/yyyy · dd-MM-yyyy · yyyy-MM-dd (and yyyy/MM/dd, yyyy.MM.dd). */
function parseDateString(raw: string): Date | null {
  const s = raw.trim();
  if (s === '') return null;

  // ISO-first: a leading 4-digit group is unambiguously the year.
  const iso = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (iso) return utcNoon(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // Turkish day-first. NOTE: day-first is asserted, not detected — the source
  // is a Turkish vendor export and dd/MM is that locale's convention. Guessing
  // per-value from whether the first group exceeds 12 would make two rows in
  // the same column parse under different rules.
  const dmy = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
  if (dmy) return utcNoon(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  return null;
}

/**
 * Date of birth. Accepts a real date cell, a numeric Excel serial, or the
 * common Turkish/ISO string forms.
 *
 * A FUTURE date is an ERROR (ROW_VALUE_INVALID), not a warning: the product's
 * patient write schema refuses future birth dates, so a row carrying one
 * cannot be written at all. Reporting it as a warning would let the dry-run
 * promise a write that execution would then reject.
 */
const dateExcelSerial: TransformFn = (input) => {
  const cell = first(input);
  let parsed: Date | null = null;

  if (cell.type === 'date' && cell.dateValue instanceof Date && !isNaN(cell.dateValue.getTime())) {
    const d = cell.dateValue;
    parsed = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0, 0));
  } else if (cell.type === 'number' && typeof cell.numberValue === 'number') {
    parsed = excelSerialToUtcNoon(cell.numberValue);
  } else {
    const text = cell.text.trim();
    if (text === '') return ok(null);
    parsed = parseDateString(text);
    // A string cell may still hold a bare serial, e.g. '36526'.
    if (parsed === null && /^\d{1,7}$/.test(text)) {
      parsed = excelSerialToUtcNoon(Number(text));
    }
  }

  if (parsed === null) {
    // cell.text is checked so an empty date/number cell reports absence, not junk.
    return cell.text.trim() === '' ? ok(null) : ok(null, 'DATE_UNPARSEABLE');
  }

  if (parsed.getTime() > Date.now()) {
    return fail(
      'ROW_VALUE_INVALID',
      'date_excel_serial: value is in the future; the patient write schema rejects future birth dates',
    );
  }

  return ok(parsed);
};

// ---------------------------------------------------------------------------
// enums
// ---------------------------------------------------------------------------

/**
 * Gender dictionary, case- and diacritic-insensitive (keys are the output of
 * normalizeHeader, which Turkish-upper-cases and folds Ç/Ğ/İ/Ö/Ş/Ü).
 */
const GENDER_DICTIONARY: ReadonlyMap<string, 'male' | 'female' | 'other'> = new Map([
  ['E', 'male'],
  ['ERKEK', 'male'],
  ['M', 'male'],
  ['MALE', 'male'],
  ['BAY', 'male'],
  ['1', 'male'],
  ['K', 'female'],
  ['KADIN', 'female'],
  ['F', 'female'],
  ['FEMALE', 'female'],
  ['BAYAN', 'female'],
  ['2', 'female'],
  ['O', 'other'],
  ['OTHER', 'other'],
  ['DIGER', 'other'],
  ['3', 'other'],
]);

/**
 * Legacy gender token -> 'male' | 'female' | 'other' | null.
 *
 * ###########################################################################
 * # AN UNRECOGNIZED VALUE BECOMES **NULL PLUS A WARNING** — NEVER 'other',  #
 * # AND NEVER A GUESS AT 'male'/'female'.                                   #
 * #                                                                         #
 * # WHY, exactly: NULL means "gender was not recorded". 'other' means "the  #
 * # patient affirmatively reported a gender outside male/female". These are #
 * # DIFFERENT CLINICAL AND PERSONAL FACTS. Defaulting unknowns to 'other'   #
 * # would fabricate thousands of patient self-reports out of blank cells    #
 * # and vendor typos, and nothing downstream could ever distinguish the     #
 * # fabricated ones from the real ones. Guessing male/female from a name or #
 * # a majority is worse still. The warning makes the unknowns countable.    #
 * ###########################################################################
 */
const genderTr: TransformFn = (input) => {
  const raw = first(input).text.trim();
  if (raw === '') return ok(null);
  const key = normalizeHeader(raw);
  const mapped = GENDER_DICTIONARY.get(key);
  if (mapped === undefined) return ok(null, 'GENDER_VALUE_UNRECOGNIZED');
  return ok(mapped);
};

/**
 * Legacy blood-group token -> 'A_POSITIVE' | ... | 'O_NEGATIVE' | null.
 *
 * ###########################################################################
 * # RH IS **NEVER** INFERRED, AND AN UNRECOGNIZED VALUE BECOMES **NULL PLUS #
 * # A WARNING** - NEVER A GUESS AND NEVER A PLACEHOLDER.                    #
 * #                                                                         #
 * # 'A' is not A_POSITIVE. A source that recorded the ABO group but not the #
 * # Rh factor recorded HALF a blood group, and completing it from the       #
 * # population majority would fabricate a transfusion-relevant clinical     #
 * # fact. That case gets its OWN warning code so the operator can count it  #
 * # and go back to the source, instead of it disappearing into a generic    #
 * # 'unrecognized' bucket.                                                  #
 * ###########################################################################
 *
 * ACCEPTED SHAPES (whole value only, after the compaction below):
 *   ABO      AB | A | B | O | 0        ('0' is Turkish presentation of O)
 *   RH       optional literal 'RH'
 *   SIGN     + | POZITIF | POZ | POSITIVE | POSITIF | POS
 *            - | NEGATIF | NEG | NEGATIVE
 * so 'A+', 'a rh+', 'A Rh POZITIF', 'AB RH NEGATIF', '0 Rh (+)' all resolve,
 * and each resolves to exactly one canonical value. 'A B +' does NOT: a
 * space inside the ABO token is ambiguity, not noise.
 *
 * WHY A WHOLE-STRING MATCH, and why that is the safety property that matters:
 * the ABO part alone is a single letter or digit, so any looser rule would
 * read unrelated codes as blood groups. Requiring BOTH an ABO part and an Rh
 * sign, with nothing else left over, is what makes '0' safe to accept: a bare
 * '0', a bare 'A', a row number, a status code such as '0/1' or a vendor
 * reference like 'AB-123' all fail the match and are reported, never mapped.
 * This is the mechanism behind "'0' and 'O' normalize to the same ABO group
 * ONLY in clearly blood-group-shaped values".
 *
 * The Turkish dotted/dotless I pair IS folded, because 'POZITIF' spelled with
 * a dotted capital I is the same word. O-umlaut is deliberately NOT folded to
 * O, unlike normalizeHeader: folding it would let a Turkish word beginning
 * with that letter be read as blood group O. normalizeHeader is unusable here
 * for a second reason too - it collapses '+' and '-' to '_', which is
 * precisely the information this transform depends on.
 */
const BLOOD_GROUP_ABO: ReadonlyMap<string, string> = new Map([
  ['A', 'A'],
  ['B', 'B'],
  ['AB', 'AB'],
  ['O', 'O'],
  // Turkish clinical usage writes the O group with the digit zero ('0 Rh+').
  // Canonical STORAGE is always the letter O; the digit is an input spelling
  // and a Turkish-UI presentation choice, never a stored value.
  ['0', 'O'],
]);

const BLOOD_GROUP_RH_POSITIVE: ReadonlySet<string> = new Set([
  '+', 'POZITIF', 'POZ', 'POSITIVE', 'POSITIF', 'POS',
]);

const BLOOD_GROUP_RH_NEGATIVE: ReadonlySet<string> = new Set([
  '-', 'NEGATIF', 'NEG', 'NEGATIVE',
]);

/**
 * The ABO part, at the START of the value, and only where it is followed by a
 * genuine boundary: end of value, whitespace, a sign, or the literal 'RH'.
 *
 * The lookahead is what makes 'AB' read as the AB group rather than as group A
 * followed by a stray 'B', and what makes 'A B +' fail outright instead of
 * being "helpfully" read as AB+. A space INSIDE the ABO token is not harmless
 * whitespace - it changes which of two real blood groups is meant - so it is
 * treated as ambiguity and reported, never resolved by guesswork.
 */
const BLOOD_GROUP_ABO_HEAD = /^(AB|A|B|O|0)(?=$|[\s+-]|RH)/;

/** What may follow the ABO part: an optional literal RH, then the Rh sign. */
const BLOOD_GROUP_TAIL = /^(?:RH)?\s*(\+|-|[A-Z]+)$/;

const bloodGroupTr: TransformFn = (input) => {
  const raw = first(input).text.trim();
  // A blank cell means 'no blood group recorded', which is exactly what NULL
  // means. That is not a defect and must not be warned about, or the operator
  // would face one warning per empty row.
  if (raw === '') return ok(null);

  // Fold the Turkish dotted/dotless I only (see the doc comment), then reduce
  // every run of characters that carry no meaning here - parentheses, slashes,
  // dots, repeated spaces - to a SINGLE SPACE. A separator is preserved rather
  // than deleted precisely so that 'A B +' stays two tokens and cannot be
  // silently welded into 'AB+'.
  const compact = turkishUpper(raw)
    .replace(/\u0130/g, 'I')
    .replace(/[^A-Z0-9+-]+/g, ' ')
    .trim();

  const head = BLOOD_GROUP_ABO_HEAD.exec(compact);
  if (head === null) return ok(null, 'BLOOD_GROUP_VALUE_UNRECOGNIZED');

  const abo = BLOOD_GROUP_ABO.get(head[1]!);
  if (abo === undefined) return ok(null, 'BLOOD_GROUP_VALUE_UNRECOGNIZED');

  const tail = compact.slice(head[1]!.length).trim();
  // The ABO group was recorded and the Rh factor was not. Rh is NEVER
  // inferred, so this is NULL - but with its own code, so the operator can
  // count these and go back to the source instead of losing them in a generic
  // 'unrecognized' bucket.
  if (tail === '' || tail === 'RH') return ok(null, 'BLOOD_GROUP_RH_MISSING');

  const matched = BLOOD_GROUP_TAIL.exec(tail);
  if (matched === null) return ok(null, 'BLOOD_GROUP_VALUE_UNRECOGNIZED');

  const sign = matched[1]!;
  if (BLOOD_GROUP_RH_POSITIVE.has(sign)) return ok(abo + '_POSITIVE');
  if (BLOOD_GROUP_RH_NEGATIVE.has(sign)) return ok(abo + '_NEGATIVE');
  // A word we do not recognize sat where the Rh sign belongs. It is NOT an
  // Rh-missing case (something WAS written there) and it is certainly not a
  // reason to assume positive.
  return ok(null, 'BLOOD_GROUP_VALUE_UNRECOGNIZED');
};

/**
 * Tokens the legacy vendor uses for a SET boolean flag.
 * 'E' is Turkish "evet" (yes). 'H' ("hayır", no) is deliberately absent and is
 * matched by the explicit falsy list below, so a Turkish no is never read as
 * an English-looking yes.
 */
const TRUTHY_TOKENS: ReadonlySet<string> = new Set(['1', 'TRUE', 'E', 'EVET', 'X', 'Y', 'YES']);

/** Tokens that explicitly mean CLEARED. Checked before TRUTHY_TOKENS. */
const FALSY_TOKENS: ReadonlySet<string> = new Set(['0', 'FALSE', 'H', 'HAYIR', 'N', 'NO']);

/**
 * Soft-delete flag -> patientStatus.
 *
 * truthy -> 'archived'; falsy, blank or unrecognized -> 'new'.
 *
 * THIS TRANSFORM NEVER WRITES `deletedAt`. Patient soft-delete in this product
 * IS patientStatus === 'archived'; `deletedAt` is a phantom column written by
 * no runtime path, and populating it would make migrated patients invisible to
 * queries that ignore it while remaining visible to those that do not.
 * Archived patients also do not consume plan quota, so this mapping directly
 * affects the commercial limit check.
 *
 * An unrecognized token resolves to 'new' rather than warning: 'new' is the
 * product default for a patient with no activity, so an unreadable flag
 * degrades to the safe state (visible, not hidden). Hiding a patient on a
 * misread flag would be the harmful direction.
 */
const deletedToStatus: TransformFn = (input) => {
  const cell = first(input);
  if (cell.type === 'boolean' && typeof cell.booleanValue === 'boolean') {
    return ok(cell.booleanValue ? 'archived' : 'new');
  }
  if (cell.type === 'number' && typeof cell.numberValue === 'number') {
    return ok(cell.numberValue !== 0 ? 'archived' : 'new');
  }
  const raw = cell.text.trim();
  if (raw === '') return ok('new');
  const key = normalizeHeader(raw);
  if (FALSY_TOKENS.has(key)) return ok('new');
  return ok(TRUTHY_TOKENS.has(key) ? 'archived' : 'new');
};

// ---------------------------------------------------------------------------
// composition
// ---------------------------------------------------------------------------

/**
 * Join the composition-ordered parts with ', '.
 *
 * ###########################################################################
 * # THE RULE MUST BE **STABLE ACROSS RERUNS**.                              #
 * # It is a pure function of the ordered inputs: same cells in, same string #
 * # out, forever. It does not skip a part based on a length threshold, does #
 * # not de-duplicate similar parts, does not reorder, and does not consult  #
 * # any other column.                                                       #
 * #                                                                         #
 * # WHY: the composed address is compared against the destination on every  #
 * # rerun. An unstable rule would produce a different string on the second  #
 * # run of the SAME file, so every patient would look "changed" and         #
 * # idempotent re-import — the whole point of provenance matching — would   #
 * # break. Empty parts are simply omitted; that omission is itself stable   #
 * # because it depends only on the cell being empty.                        #
 * ###########################################################################
 */
const composeAddress: TransformFn = (input) => {
  const parts: string[] = [];
  for (const cell of input.cells) {
    const t = cell.text.trim();
    if (t !== '') parts.push(t);
  }
  if (parts.length === 0) return ok(null);
  return ok(parts.join(', '));
};

// ---------------------------------------------------------------------------
// clinical notes composition
// ---------------------------------------------------------------------------

/**
 * Compose several clinical free-text source columns into `patient.notes`.
 *
 * Same contract as `composeAddress` and for the same reason: a PURE function
 * of the ordered inputs, stable across reruns forever. It does not skip a part
 * on a length threshold, does not de-duplicate, does not reorder and does not
 * consult any other column, so a rerun of the SAME workbook produces a
 * byte-identical string and idempotent re-import is preserved.
 *
 * Parts are joined with a NEWLINE rather than ', ' (the address join): these
 * are independent clinical statements written at different times by different
 * people, and running them together on one line would read as a single
 * sentence and change their clinical meaning. Each part is trimmed, and empty
 * parts are omitted — an omission that is itself stable because it depends
 * only on the cell being empty.
 *
 * NO VALUE IS EVER LOGGED OR RETURNED IN A WARNING by this transform. The
 * content is KVKK Art. 6 special-category by assumption, so it stays inside
 * the value channel and never reaches a message, a code or a report.
 */
const composeNotes: TransformFn = (input) => {
  const parts: string[] = [];
  for (const cell of input.cells) {
    const t = cell.text.trim();
    if (t !== '') parts.push(t);
  }
  if (parts.length === 0) return ok(null);
  return ok(parts.join('\n'));
};

// ---------------------------------------------------------------------------
// chart number
// ---------------------------------------------------------------------------

/**
 * Legacy chart / file number.
 *
 * A NUMBER cell becomes its plain integer string: no '.0' tail and no
 * exponent, because '14718' and '14718.0' and '1.4718e+4' are the same chart
 * number to reception but three different strings to a database.
 *
 * NOT UNIQUE, and this transform does NOT enforce uniqueness. Measured source:
 * 99.88 % distinct among filled values, with 17 duplicate pairs (34 rows).
 * Duplicates are a WARNING for manual reconciliation raised by the CALLER,
 * which can see all rows; a per-value transform cannot see the other 14,889
 * rows and must not pretend to. Silently overwriting one of a duplicate pair
 * would destroy a real clinic record.
 */
const chartNumber: TransformFn = (input) => {
  const cell = first(input);
  if (cell.type === 'number' && typeof cell.numberValue === 'number') {
    const n = cell.numberValue;
    if (Number.isFinite(n)) {
      const truncated = Math.trunc(n);
      // Below 1e21 JS never renders an integer in exponent form.
      if (Math.abs(truncated) < 1e21) return ok(String(truncated));
    }
  }
  const t = cell.text.trim();
  return ok(t === '' ? null : t);
};

// ---------------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------------

/**
 * ###########################################################################
 * #  T.C. KIMLIK NUMARASI — THE MOST SENSITIVE VALUE IN THE ENTIRE IMPORT.  #
 * #                                                                         #
 * #  This transform returns the RAW normalized digit string. That string is #
 * #  handed STRAIGHT to the identity classifier and the encryptor.          #
 * #                                                                         #
 * #  IT MUST NEVER BE:                                                      #
 * #    - logged, at any level, by any code path                             #
 * #    - embedded in a warning code, an error message or a `detail` string  #
 * #    - written to a dry-run report, a reconciliation report or an audit   #
 * #      payload                                                            #
 * #    - returned by any ordinary API, or stored as a Patient scalar        #
 * #    - used to build a cache key, a filename or a metrics label           #
 * #                                                                         #
 * #  Note deliberately absent behaviour: this transform emits NO warning at #
 * #  all, not even for a malformed value. Any warning here would have to    #
 * #  describe the value to be useful, and describing it is exactly what is  #
 * #  forbidden. Shape and checksum classification happens in the identity   #
 * #  classifier, which reports a CLASSIFICATION enum (VALID /               #
 * #  INVALID_LEGACY / AMBIGUOUS / ...), never the value or a fragment.      #
 * #  Values that fail classification are QUARANTINED — counted, never       #
 * #  written — so a malformed legacy value never becomes a verified         #
 * #  identity.                                                              #
 * #                                                                         #
 * #  The log-privacy CI guard must include tckn/nationalId/identityNumber   #
 * #  in its identifier set; see the decision package §4.                    #
 * ###########################################################################
 *
 * Digits only. A NUMBER cell is rendered as an integer string first — Excel
 * stored 10,799 of the measured values numerically, which also means a value
 * with a leading zero already lost it here; that loss is a SHAPE failure the
 * classifier reports, not something this transform may repair by guessing.
 */
const identityTckn: TransformFn = (input) => {
  const cell = first(input);
  let source = cell.text;
  if (cell.type === 'number' && typeof cell.numberValue === 'number' && Number.isFinite(cell.numberValue)) {
    const truncated = Math.trunc(cell.numberValue);
    if (Math.abs(truncated) < 1e21) source = String(truncated);
  }
  const digits = source.replace(/\D/g, '');
  return ok(digits === '' ? null : digits);
};

// ---------------------------------------------------------------------------
// provenance
// ---------------------------------------------------------------------------

/**
 * The vendor primary key.
 *
 * An EMPTY value is a hard ROW_REQUIRED_FIELD_MISSING error, not a warning.
 * Provenance is what makes a rerun MATCH an existing patient instead of
 * creating a second one. A row with no source id cannot be matched on a rerun,
 * so importing it would guarantee a duplicate patient the moment anyone runs
 * the migration twice — and reruns are a normal part of this workflow.
 */
const provenanceSourceId: TransformFn = (input) => {
  const cell = first(input);
  let text = cell.text.trim();
  if (text === '' && cell.type === 'number' && typeof cell.numberValue === 'number') {
    const truncated = Math.trunc(cell.numberValue);
    if (Math.abs(truncated) < 1e21) text = String(truncated);
  }
  if (text === '') {
    return fail(
      'ROW_REQUIRED_FIELD_MISSING',
      'provenance_source_id: source record id is empty; the row cannot be matched idempotently on rerun',
    );
  }
  return ok(text);
};

// ---------------------------------------------------------------------------
// reference
// ---------------------------------------------------------------------------

/**
 * Practitioner reference key.
 *
 * Returns the value AS-IS: no trim beyond the parser's canonical projection,
 * no case folding, no diacritic stripping, no whitespace collapsing.
 *
 * WHY byte-exact: the reference map is a human-approved table whose keys are
 * the 25 distinct source labels exactly as they appear. If this transform
 * folded case or diacritics, 'Dr. ÖZGÜR' and 'Dr. Ozgur' would collapse to one
 * key and every patient of one doctor could be assigned to another. There is
 * NO FUZZY MATCHING anywhere in this pipeline and no auto-creation of a User:
 * an unresolved value BLOCKS the rows carrying it, which a human then resolves
 * by extending the map. A blocked row is recoverable; a patient silently
 * attributed to the wrong clinician is not.
 */
const practitionerReference: TransformFn = (input) => {
  const text = first(input).text;
  return ok(text === '' ? null : text);
};

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

/**
 * Every name in TRANSFORM_NAMES has exactly one implementation. The Record
 * type makes a missing implementation a COMPILE error rather than an
 * undefined-is-not-a-function at row 8,000 of a live migration.
 */
export const TRANSFORMS: Record<TransformName, TransformFn> = {
  trim,
  trim_collapse: trimCollapse,
  lower_trim: lowerTrim,
  phone_tr: phoneTr,
  date_excel_serial: dateExcelSerial,
  gender_tr: genderTr,
  deleted_to_status: deletedToStatus,
  compose_address: composeAddress,
  compose_notes: composeNotes,
  blood_group_tr: bloodGroupTr,
  chart_number: chartNumber,
  identity_tckn: identityTckn,
  provenance_source_id: provenanceSourceId,
  practitioner_reference: practitionerReference,
};

export function applyTransform(name: TransformName, input: TransformInput): TransformOutput {
  const fn = TRANSFORMS[name];
  if (!fn) {
    // Unreachable through the type system; defensive for a value crossing a
    // JSON boundary (a saved template row edited by hand, for example).
    return fail('MAPPING_INVALID', `applyTransform: unknown transform "${String(name)}"`);
  }
  return fn(input);
}
