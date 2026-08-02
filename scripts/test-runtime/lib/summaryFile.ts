import { writeFileSync } from 'node:fs';

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
  const flag = args.find((a) => a.startsWith('--summary-file='));
  if (!flag) return;
  const path = flag.slice('--summary-file='.length);
  try {
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[test-runtime] Failed to write --summary-file "${path}": ${err instanceof Error ? err.message : String(err)} (does not affect the reported exit code)`);
  }
}
