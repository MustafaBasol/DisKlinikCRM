/**
 * tckn.ts — T.C. Kimlik No shape and checksum validation — F3-DATA-MIG-TODAY
 *
 * PURE VALIDATION. No I/O, no database, no crypto, no logging, no imports with
 * side effects. This module decides only whether a string COULD be a well-formed
 * T.C. Kimlik No. It never decides what to do about it — that is
 * identityClassifier.ts — and it never persists or transmits anything.
 *
 * NO LOGGING, EVER. There is no `console.*` call and no logger import in this
 * file, and no value returned from it carries the input. `failureReason` is a
 * CODE. It must never include the value, a prefix of it, or any digit of it.
 *
 * The ONLY thing derived from an INVALID value that this module lets the caller
 * keep is `tcknDigitLength()` — a count. That is the deliberate safe shape
 * descriptor the migration retains for a quarantined legacy value, and it is
 * the only such derivation permitted to be persisted or reported.
 *
 * WHAT THIS DOES NOT DO: a checksum-valid number is not a REAL number. Only the
 * NVİ Kimlik Doğrulama service can confirm that a number belongs to a living
 * person with a given name and birth year, and this product performs no such
 * call. `VALID` here means "structurally well-formed", never "verified against
 * the state register".
 */

/** Shape/checksum failure codes. Codes only — never a value or part of one. */
export type TcknFailureReason =
  | 'EMPTY'
  | 'NOT_NUMERIC'
  | 'WRONG_LENGTH'
  | 'LEADING_ZERO'
  | 'CHECKSUM';

const TCKN_LENGTH = 11;

/**
 * Strip everything that is not an ASCII digit.
 *
 * Legacy exports carry spaces, dots, hyphens and non-breaking spaces inside the
 * identity column from decades of manual entry and spreadsheet round-trips.
 * Normalizing to digits only is what makes the checksum and the lookup token
 * stable across those cosmetic variations — the same person entered as
 * "12345678901" and "123 456 789 01" must produce the SAME lookup hash, or
 * duplicate detection silently fails.
 */
export function normalizeTckn(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[^0-9]/g, '');
}

/**
 * Structural shape: exactly 11 digits, first digit non-zero.
 *
 * d1 != 0 is part of the specification, not a heuristic: no issued T.C. Kimlik
 * No begins with 0. Values like "00000000000" (a common legacy placeholder for
 * "unknown") therefore fail here rather than reaching the checksum.
 */
export function isValidTcknShape(v: string): boolean {
  if (typeof v !== 'string' || v.length !== TCKN_LENGTH) return false;
  if (!/^[0-9]{11}$/.test(v)) return false;
  return v.charCodeAt(0) !== 48; // '0'
}

/**
 * The two official check digits.
 *
 *   d10 = ((d1+d3+d5+d7+d9) * 7 - (d2+d4+d6+d8)) mod 10
 *   d11 = (d1+d2+...+d10) mod 10
 *
 * JavaScript's `%` returns a negative result for a negative dividend, and the
 * d10 expression genuinely can be negative (the even-position sum may exceed
 * seven times the odd-position sum), so the result is normalized into 0..9 with
 * `((x % 10) + 10) % 10`. A naive `x % 10` silently rejects valid numbers.
 *
 * Assumes `v` already satisfies `isValidTcknShape`; returns false otherwise so
 * the function is safe to call in isolation.
 */
export function isValidTcknChecksum(v: string): boolean {
  if (!isValidTcknShape(v)) return false;

  const d: number[] = new Array(TCKN_LENGTH);
  for (let i = 0; i < TCKN_LENGTH; i += 1) {
    d[i] = v.charCodeAt(i) - 48;
  }

  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8]; // d1,d3,d5,d7,d9
  const evenSum = d[1] + d[3] + d[5] + d[7]; // d2,d4,d6,d8

  const expectedD10 = (((oddSum * 7 - evenSum) % 10) + 10) % 10;
  if (d[9] !== expectedD10) return false;

  let firstTenSum = 0;
  for (let i = 0; i < 10; i += 1) firstTenSum += d[i];
  const expectedD11 = firstTenSum % 10;

  return d[10] === expectedD11;
}

/**
 * Normalize, then classify the failure (if any) into a stable CODE.
 *
 * The `failureReason` ordering is deliberate and reported in that order:
 * EMPTY -> NOT_NUMERIC -> WRONG_LENGTH -> LEADING_ZERO -> CHECKSUM. A reviewer
 * reading a dry-run report needs to distinguish "the column held free text"
 * (NOT_NUMERIC) from "someone typed a tax number here" (WRONG_LENGTH, usually
 * 10 or 12 digits) from "a digit was mistyped" (CHECKSUM) — those are three
 * different remediation stories, and collapsing them into one "invalid" bucket
 * destroys the only diagnostic signal available without looking at values.
 */
export function validateTckn(raw: string): {
  normalized: string;
  valid: boolean;
  failureReason?: TcknFailureReason;
} {
  const source = typeof raw === 'string' ? raw : '';
  const normalized = normalizeTckn(source);

  if (source.trim().length === 0) {
    return { normalized, valid: false, failureReason: 'EMPTY' };
  }
  if (normalized.length === 0) {
    // Non-empty input that contained no digits at all: free text in the column.
    return { normalized, valid: false, failureReason: 'NOT_NUMERIC' };
  }
  if (normalized.length !== TCKN_LENGTH) {
    return { normalized, valid: false, failureReason: 'WRONG_LENGTH' };
  }
  if (normalized.charCodeAt(0) === 48) {
    return { normalized, valid: false, failureReason: 'LEADING_ZERO' };
  }
  if (!isValidTcknChecksum(normalized)) {
    return { normalized, valid: false, failureReason: 'CHECKSUM' };
  }

  return { normalized, valid: true };
}

/**
 * Digit count of the normalized value. A LENGTH, never a value.
 *
 * This is the safe shape descriptor the migration retains for a quarantined
 * legacy value: it tells a reviewer that the 12-digit entries in the identity
 * column are almost certainly tax numbers (vergi kimlik no) misfiled into it,
 * without exposing a single digit of anybody's data.
 */
export function tcknDigitLength(raw: string): number {
  return normalizeTckn(raw).length;
}
