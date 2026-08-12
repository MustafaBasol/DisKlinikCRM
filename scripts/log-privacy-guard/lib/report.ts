import type { ScanResult } from './types.js';

export function formatHumanReport(result: ScanResult): string {
  const lines: string[] = [];
  lines.push('F3-IMPL-007 sensitive runtime logging regression guard');
  lines.push(`Files scanned: ${result.filesScanned}`);
  lines.push(`Duration: ${result.durationMs}ms`);
  lines.push('');

  if (result.errors.length > 0) {
    lines.push(`SCAN ERRORS (${result.errors.length}) — fail-closed:`);
    for (const err of result.errors) lines.push(`  ${err.file}: ${err.message}`);
    lines.push('');
  }

  if (result.duplicateExceptions.length > 0) {
    lines.push(`BASELINE CONFIG ERROR: duplicate exception fingerprint(s) — fail-closed.`);
    lines.push('');
  }

  if (result.violations.length === 0) {
    lines.push('No new violations.');
  } else {
    lines.push(`NEW VIOLATIONS (${result.violations.length}) — fails the gate:`);
    for (const v of result.violations) {
      lines.push(`  [${v.ruleId}] ${v.file}:${v.line}:${v.column}`);
      lines.push(`    ${v.snippet}`);
      lines.push(`    fix: ${v.remediation}`);
      lines.push(`    fingerprint: ${v.fingerprint}`);
    }
  }
  lines.push('');

  if (result.grandfathered.length > 0) {
    lines.push(`Grandfathered (matched a reviewed baseline exception): ${result.grandfathered.length}`);
  }
  if (result.suppressed.length > 0) {
    lines.push(`Suppressed via inline log-privacy-guard:allow comment: ${result.suppressed.length}`);
    for (const s of result.suppressed) {
      lines.push(`  [${s.ruleId}] ${s.file}:${s.line} — ${s.suppressionReason}`);
    }
  }
  if (result.staleExceptions.length > 0) {
    lines.push(`WARNING: ${result.staleExceptions.length} baseline exception(s) no longer match any finding (stale — safe to remove):`);
    for (const e of result.staleExceptions) {
      lines.push(`  ${e.file}:${e.line} [${e.ruleId}] fingerprint ${e.fingerprint} — ${e.reason}`);
    }
  }

  return lines.join('\n');
}

export function computeExitCode(result: ScanResult, strictBaseline: boolean): number {
  if (result.errors.length > 0) return 1;
  if (result.duplicateExceptions.length > 0) return 1;
  if (result.violations.length > 0) return 1;
  if (strictBaseline && result.staleExceptions.length > 0) return 1;
  return 0;
}
