/**
 * F2-GUARDRAIL-IMPL-001 — path normalization.
 *
 * Every path that reaches a Finding, an error, or a warning must be a
 * POSIX-style ('/'-separated), repository-relative path — never an absolute
 * local path (Windows or POSIX), and never a bare backslash-separated
 * Windows path. This is the single choke point all such conversions go
 * through so the "no absolute paths in output" and "Windows/POSIX
 * normalization" requirements are enforced in one place, not re-implemented
 * per caller.
 */
/**
 * Converts any path separators to POSIX '/' without touching path
 * semantics. Deliberately string-based, not `node:path`-based: `node:path`
 * chooses win32 vs. posix semantics from the *host OS running the tool*,
 * not from the shape of the string being processed. This guardrail's own
 * output (and this module's own test coverage) must be identical whether
 * it runs on a Windows developer machine or ubuntu-latest CI — an
 * OS-dependent path module would make that guarantee false.
 */
export function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Normalizes an absolute filesystem path (Windows or POSIX, as produced by
 * fs/TypeScript APIs) into a repository-relative POSIX path, via plain
 * string-prefix stripping after both inputs are POSIX-normalized — see
 * `toPosix`'s comment for why this avoids `node:path`'s OS-dependent
 * `relative`/`isAbsolute`. Throws if the result would still be absolute or
 * would escape the repository root — such a path must never reach a report.
 */
export function toRepoRelativePosix(repoRoot: string, absolutePath: string): string {
  const repoRootPosix = toPosix(repoRoot).replace(/\/+$/, '');
  const targetPosix = toPosix(absolutePath);
  const prefix = `${repoRootPosix}/`;
  if (!targetPosix.startsWith(prefix)) {
    throw new Error(`normalization: refusing to emit a path outside the repository root: "${absolutePath}"`);
  }
  const rel = targetPosix.slice(prefix.length);
  if (isLikelyAbsolutePath(rel) || rel === '..' || rel.startsWith('../')) {
    throw new Error(`normalization: refusing to emit a path outside the repository root: "${absolutePath}"`);
  }
  return rel;
}

/** True if `path` looks like an absolute local filesystem path (Windows or POSIX), independent of host OS. */
export function isLikelyAbsolutePath(path: string): boolean {
  const posixForm = toPosix(path);
  if (posixForm.startsWith('/')) return true;
  // Windows drive-letter absolute path (e.g. "E:/...", "E:\\...").
  if (/^[a-zA-Z]:\//.test(posixForm)) return true;
  return false;
}
