/**
 * safeUrl.ts — Absolute http(s) URL guard for operator-supplied link values.
 *
 * F3-SEC-004 / R-076. A privileged clinic user can type any string into a
 * "website" style field, and that string later reaches an `href` on an
 * unauthenticated public page. React escapes text, but it does NOT stop
 * `javascript:` / `data:` / `vbscript:` in an href — so the scheme has to be
 * checked explicitly.
 *
 * Parsing with WHATWG `URL` rather than a regex is deliberate:
 *   - `URL` normalises the scheme, so `JaVaScRiPt:` is caught the same as
 *     `javascript:`;
 *   - `URL` strips embedded tab/CR/LF before parsing, so `java\tscript:alert(1)`
 *     (which a naive `startsWith('javascript:')` check would wave through, and
 *     which browsers DO execute) is caught;
 *   - relative paths (`/x`) and protocol-relative refs (`//evil.example`) throw
 *     without a base, so they are rejected as "not absolute" for free.
 *
 * The browser-side twin of this module lives at `src/utils/safeUrl.ts`. The two
 * are intentionally duplicated: server and client are compiled from separate
 * tsconfig roots with no shared package, so there is nowhere to put one copy.
 * Keep the behaviour of the two in sync.
 */

/**
 * The only schemes allowed to reach an `href`.
 *
 * Widening this list is a security decision, not a config tweak — the
 * F3-SEC-004 regression tests assert its exact contents.
 */
export const SAFE_URL_PROTOCOLS: readonly string[] = ['http:', 'https:'];

/**
 * True only for an absolute URL whose scheme is http: or https:.
 *
 * Everything else — including empty/whitespace input, relative paths,
 * protocol-relative refs, and unparseable junk — is false. Empty-string
 * semantics are the caller's business, not this function's.
 */
export function isSafeHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;

  const trimmed = value.trim();
  if (!trimmed) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  return SAFE_URL_PROTOCOLS.includes(parsed.protocol);
}

/**
 * Returns the value when it is a safe absolute http(s) URL, otherwise null.
 *
 * Used to suppress unsafe values that are ALREADY in the database at the
 * public API boundary. It never rewrites the stored row — cleanup of legacy
 * rows is a separate, controlled task.
 */
export function sanitizeSafeHttpUrl(value: string | null | undefined): string | null {
  return isSafeHttpUrl(value) ? (value as string).trim() : null;
}
