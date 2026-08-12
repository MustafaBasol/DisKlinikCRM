import { createHash } from 'node:crypto';

/**
 * Stable identity for a violation: (file, rule, exact source line text).
 * Deliberately NOT line-number-only — a baseline exception must stop
 * protecting a site the moment the flagged line's content changes, so an
 * edit to an accepted site always re-surfaces as a fresh finding requiring
 * conscious re-review (see F3-IMPL-007 evidence doc, "baseline-drift
 * protection").
 */
export function computeFingerprint(relFile: string, ruleId: string, lineText: string): string {
  const hash = createHash('sha1');
  hash.update(`${relFile}::${ruleId}::${lineText.trim()}`);
  return hash.digest('hex').slice(0, 16);
}
