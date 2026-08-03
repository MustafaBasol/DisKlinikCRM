/**
 * formulaSafety.ts — spreadsheet formula-injection neutralization (US-07.3-P1).
 *
 * OWASP CSV/Excel formula-injection: a text cell whose value begins with
 * `=`, `+`, `-`, or `@` can be interpreted as a formula by spreadsheet
 * software when the file is opened, letting attacker-controlled text (e.g. a
 * filter value or a joined label) execute a formula on the recipient's
 * machine. Neutralized by prefixing such values with a leading apostrophe,
 * which forces every spreadsheet application to render the cell as literal
 * text instead of evaluating it.
 *
 * Only applied to TEXT cells. Numeric/currency/date/datetime/boolean columns
 * are never routed through this — they stay real numeric/date/boolean cell
 * values, so a legitimate negative number (e.g. -150) must never be turned
 * into a string just because it starts with "-".
 */

const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@'];

export function isFormulaInjectionCandidate(value: string): boolean {
  return value.length > 0 && FORMULA_TRIGGER_CHARS.includes(value[0]);
}

export function neutralizeFormulaInjection(value: string): string {
  if (isFormulaInjectionCandidate(value)) {
    return `'${value}`;
  }
  return value;
}
