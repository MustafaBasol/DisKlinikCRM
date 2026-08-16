/**
 * safeUrl.ts — Absolute http(s) URL guard for values that reach an `href`.
 *
 * F3-SEC-004 / R-076. React escapes text content, but it does NOT stop a
 * `javascript:` / `data:` / `vbscript:` URL placed in an href — that navigates
 * and executes on click. Any operator-supplied string rendered as a link has to
 * have its scheme checked first.
 *
 * The backend now rejects unsafe values at write time, but values persisted
 * before that fix still exist, so the render sink guards itself independently
 * rather than trusting the API response.
 *
 * Parsing with WHATWG `URL` rather than a regex is deliberate:
 *   - `URL` normalises the scheme, so `JaVaScRiPt:` is caught the same as
 *     `javascript:`;
 *   - `URL` strips embedded tab/CR/LF before parsing, so `java\tscript:alert(1)`
 *     (which a naive `startsWith` check would wave through, and which browsers
 *     DO execute) is caught;
 *   - relative paths (`/x`) and protocol-relative refs (`//evil.example`) throw
 *     without a base, so they are rejected as "not absolute" for free.
 *
 * The server-side twin of this module lives at `server/src/utils/safeUrl.ts`.
 * The two are intentionally duplicated: server and client are compiled from
 * separate tsconfig roots with no shared package. Keep their behaviour in sync.
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
 * protocol-relative refs, and unparseable junk — is false.
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
 * Returns a value safe to put in an `href`, or null when there isn't one.
 *
 * Callers must render the link only when this returns non-null; the raw value
 * may still be shown as inert text, which stays escaped by React.
 */
export function getSafeHttpUrl(value: string | null | undefined): string | null {
  return isSafeHttpUrl(value) ? (value as string).trim() : null;
}
