import { writeFileSync } from 'node:fs';

/** Extracts the `--summary-file=<path>` value from an argv slice, if present. */
export function resolveSummaryFilePath(args: readonly string[]): string | undefined {
  const flag = args.find((a) => a.startsWith('--summary-file='));
  return flag ? flag.slice('--summary-file='.length) : undefined;
}

/**
 * F1-003-P3-R1: optional, additive `--summary-file=<path>` support. Writes
 * the given (already-redacted) data to a dedicated file as pure JSON — CI
 * can then treat that file as a genuine machine-readable artifact instead of
 * piping the orchestrator's combined human-readable stdout (test-runner
 * progress lines, migration output, etc.) to a file and mislabeling it a
 * JSON summary. Absent this flag, callers are unaffected.
 *
 * Deliberately never throws: a write failure here (bad path, disk full,
 * permissions) is an artifact-handling concern, not a test-outcome concern —
 * it must never crash the orchestrator process or override the real
 * `process.exitCode` already determined by the actual test/cleanup result.
 * Failure is reported to stderr only.
 */
export function maybeWriteSummaryFile(args: readonly string[], data: unknown): void {
  const path = resolveSummaryFilePath(args);
  if (!path) return;
  try {
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[test-runtime] Failed to write --summary-file "${path}": ${err instanceof Error ? err.message : String(err)} (does not affect the reported exit code)`);
  }
}

export interface SummaryWriteResult {
  requested: boolean;
  path?: string;
  written: boolean;
  error?: string;
}

/**
 * F4-CI-L4-STORAGE-GATE-001: the same write, but REPORTING whether it
 * happened instead of swallowing the outcome.
 *
 * The original never-throws contract above was written when the summary file
 * was purely an artifact convenience. It is now the CI gate's evidence: a run
 * that cannot produce its summary has produced no proof, and the caller must
 * be able to fail closed on that. This function still does not throw (so it
 * can never pre-empt a real test failure that is already being reported), but
 * it returns the outcome so the orchestrator can downgrade a would-be pass.
 */
export function writeSummaryFileReporting(args: readonly string[], data: unknown): SummaryWriteResult {
  const path = resolveSummaryFilePath(args);
  if (!path) return { requested: false, written: false };
  try {
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
    return { requested: true, path, written: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[test-runtime] Failed to write --summary-file "${path}": ${error}`);
    return { requested: true, path, written: false, error };
  }
}
