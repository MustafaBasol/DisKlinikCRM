/**
 * F2-GUARDRAIL-IMPL-001 — defensive secret redaction.
 *
 * This guardrail never intentionally reads secrets or production
 * configuration (it only reads source file paths/import syntax and small
 * checked-in JSON config/evidence files). This module is a defense-in-depth
 * safety net applied to every free-text string that reaches the report
 * (error/warning messages, which wrap fs/parse error text that could in
 * principle echo back part of a path or environment string) — matching the
 * same pattern family ci-layers.yml's existing disposable-runtime jobs
 * already scan run-summary artifacts for.
 */
const SECRET_PATTERNS: RegExp[] = [
  /postgres(?:ql)?:\/\/[^\s"']+/gi,
  /s3:\/\/[^\s"']+/gi,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
  /secretAccessKey["']?\s*[:=]\s*["']?[^\s"']+/gi,
  /accessKeyId["']?\s*[:=]\s*["']?[^\s"']+/gi,
  /password["']?\s*[:=]\s*["']?[^\s"']+/gi,
];

export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

export function containsSecretPattern(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => new RegExp(pattern.source, pattern.flags).test(text));
}
