/**
 * biff8Reader.limits.ts — resource limits, error codes and the typed error
 * class for the dependency-free OLE2/CFB + BIFF8 (.xls) reader.
 *
 * Legacy `.xls` workbooks arrive from outside the trust boundary (a clinic
 * hands us a file exported by third-party practice-management software), so
 * every structural quantity the file declares about itself — sector ids,
 * chain lengths, string lengths, row/column extents, SST cardinalities — is
 * untrusted input. Nothing here is allocated or iterated on a file-declared
 * number without first being bounded by one of the constants below.
 *
 * PRIVACY CONTRACT: `Biff8Error.detail` carries STRUCTURAL facts only —
 * byte offsets, record ids, counts, limit names. It must NEVER contain cell
 * content, sheet content, or any decoded string from the workbook, because
 * these messages are logged. See the same note at the top of biff8Reader.ts.
 */

/** Stable machine-readable failure codes. Safe to branch on and to log. */
export type Biff8ErrorCode =
  | 'NOT_OLE2'
  | 'BIFF5_UNSUPPORTED'
  | 'WORKBOOK_STREAM_MISSING'
  | 'CFB_MALFORMED'
  | 'BIFF_MALFORMED'
  | 'LIMIT_EXCEEDED'
  | 'ENCRYPTED_UNSUPPORTED'
  | 'NO_SHEETS';

/**
 * The single error type thrown by the reader.
 *
 * Follows the codebase convention (see externalCalendarErrors.ts): no shared
 * generic AppError base class exists in this repo, so each domain defines its
 * own plain-Error subclass and callers branch on `instanceof` / `.code`.
 */
export class Biff8Error extends Error {
  readonly code: Biff8ErrorCode;

  /** Structural detail only — never cell content. See the file header. */
  readonly detail?: string;

  constructor(code: Biff8ErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'Biff8Error';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Hard resource ceilings. Every breach throws
 * `Biff8Error('LIMIT_EXCEEDED', '<limitName> …')`.
 */
export interface Biff8Limits {
  /** Maximum accepted input buffer size. */
  maxFileBytes: number;
  /** Maximum BOUNDSHEET records honoured in the globals substream. */
  maxSheets: number;
  /** Maximum column index + 1 for any sheet. */
  maxColumns: number;
  /** Maximum row index + 1 for any sheet. */
  maxRows: number;
  /** Maximum cell values materialised across the whole workbook. */
  maxCells: number;
  /** Maximum unique strings declared by the SST. */
  maxSstStrings: number;
  /** Maximum UTF-16 code units in a single string. */
  maxStringChars: number;
  /** Maximum UTF-16 code units summed across the whole SST. */
  maxTotalStringChars: number;
  /** Maximum sectors walked in a single FAT / mini-FAT chain. */
  maxSectorChainLength: number;
  /** Maximum CONTINUE records logically appended to one record. */
  maxContinueChain: number;
}

/**
 * Defaults sized for the accepted first-customer workbook (11.3 MB container,
 * 14,891 x 92 cells, 53,981 unique SST strings / 165,366 references) with
 * roughly an order of magnitude of headroom, while still refusing a file that
 * would exhaust the Node heap.
 */
export const DEFAULT_BIFF8_LIMITS: Biff8Limits = {
  maxFileBytes: 64 * 1024 * 1024,
  maxSheets: 64,
  maxColumns: 1024,
  maxRows: 200_000,
  maxCells: 5_000_000,
  maxSstStrings: 2_000_000,
  maxStringChars: 32_768,
  maxTotalStringChars: 200_000_000,
  maxSectorChainLength: 2_000_000,
  maxContinueChain: 500_000,
};

/** Merge caller overrides over the defaults. Unknown keys are ignored by TS. */
export function resolveBiff8Limits(overrides?: Partial<Biff8Limits>): Biff8Limits {
  if (!overrides) return DEFAULT_BIFF8_LIMITS;
  return { ...DEFAULT_BIFF8_LIMITS, ...overrides };
}

/**
 * Throw a LIMIT_EXCEEDED error. `limitName` and the two numbers are the only
 * things that reach the message — never a value read out of the workbook.
 */
export function throwLimitExceeded(
  limitName: keyof Biff8Limits,
  observed: number,
  allowed: number,
): never {
  throw new Biff8Error('LIMIT_EXCEEDED', `${limitName} observed=${observed} allowed=${allowed}`);
}
