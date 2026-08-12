import type { BaselineExceptionEntry, RuleId, Violation } from './types.js';
import { ALL_RULE_IDS } from './types.js';

export class BaselineConfigError extends Error {}

const FINGERPRINT_RE = /^[0-9a-f]{16}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates the baseline-exceptions.json shape. Deliberately strict and
 * fail-closed (throws, does not warn-and-continue) — a malformed exceptions
 * file must never be silently treated as "no exceptions" (which would make
 * every previously-grandfathered site fail CI unexpectedly) nor as "trust
 * everything" (a parse failure must not turn into an open gate). See
 * evidence doc §8 (baseline-drift protection).
 */
export function validateBaselineEntries(raw: unknown): BaselineExceptionEntry[] {
  if (!Array.isArray(raw)) {
    throw new BaselineConfigError('baseline-exceptions.json must be a JSON array');
  }
  const entries: BaselineExceptionEntry[] = [];
  raw.forEach((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new BaselineConfigError(`baseline-exceptions.json[${index}] is not an object`);
    }
    const e = item as Record<string, unknown>;
    if (typeof e.file !== 'string' || e.file.length === 0) {
      throw new BaselineConfigError(`baseline-exceptions.json[${index}].file must be a non-empty string`);
    }
    if (e.file.includes('*') || e.file.includes('?')) {
      throw new BaselineConfigError(
        `baseline-exceptions.json[${index}].file ("${e.file}") must be an exact path — wildcards are not allowed`,
      );
    }
    if (typeof e.line !== 'number' || !Number.isInteger(e.line) || e.line <= 0) {
      throw new BaselineConfigError(`baseline-exceptions.json[${index}].line must be a positive integer`);
    }
    if (typeof e.ruleId !== 'string' || !ALL_RULE_IDS.includes(e.ruleId as RuleId)) {
      throw new BaselineConfigError(
        `baseline-exceptions.json[${index}].ruleId must be one of ${ALL_RULE_IDS.join(', ')}`,
      );
    }
    if (typeof e.fingerprint !== 'string' || !FINGERPRINT_RE.test(e.fingerprint)) {
      throw new BaselineConfigError(
        `baseline-exceptions.json[${index}].fingerprint must be a 16-hex-char string (run the scanner to compute it)`,
      );
    }
    if (typeof e.reason !== 'string' || e.reason.trim().length < 15) {
      throw new BaselineConfigError(
        `baseline-exceptions.json[${index}].reason must explain, in at least 15 characters, why this site is accepted`,
      );
    }
    if (typeof e.addedDate !== 'string' || !DATE_RE.test(e.addedDate)) {
      throw new BaselineConfigError(`baseline-exceptions.json[${index}].addedDate must be an ISO date (YYYY-MM-DD)`);
    }
    entries.push({
      file: e.file,
      line: e.line,
      ruleId: e.ruleId as RuleId,
      fingerprint: e.fingerprint,
      reason: e.reason,
      addedDate: e.addedDate,
      addedBy: typeof e.addedBy === 'string' ? e.addedBy : undefined,
    });
  });

  const seenFingerprints = new Map<string, number>();
  const duplicates: BaselineExceptionEntry[] = [];
  for (const entry of entries) {
    const count = (seenFingerprints.get(entry.fingerprint) ?? 0) + 1;
    seenFingerprints.set(entry.fingerprint, count);
    if (count > 1) duplicates.push(entry);
  }
  if (duplicates.length > 0) {
    throw new BaselineConfigError(
      `baseline-exceptions.json contains duplicate fingerprint(s): ${duplicates
        .map((d) => `${d.file}:${d.line} (${d.fingerprint})`)
        .join(', ')}`,
    );
  }

  return entries;
}

export interface ApplyBaselineResult {
  newViolations: Violation[];
  grandfathered: Violation[];
  staleExceptions: BaselineExceptionEntry[];
}

export function applyBaseline(
  violations: Violation[],
  baseline: BaselineExceptionEntry[],
): ApplyBaselineResult {
  const byFingerprint = new Map<string, BaselineExceptionEntry>();
  for (const entry of baseline) byFingerprint.set(entry.fingerprint, entry);

  const used = new Set<string>();
  const newViolations: Violation[] = [];
  const grandfathered: Violation[] = [];

  for (const v of violations) {
    const entry = byFingerprint.get(v.fingerprint);
    if (entry) {
      used.add(entry.fingerprint);
      grandfathered.push(v);
    } else {
      newViolations.push(v);
    }
  }

  const staleExceptions = baseline.filter((entry) => !used.has(entry.fingerprint));

  return { newViolations, grandfathered, staleExceptions };
}
