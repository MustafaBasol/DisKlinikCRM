/**
 * F2-GUARDRAIL-IMPL-001 — minimal, deterministic, dependency-free glob
 * matcher.
 *
 * Supports exactly the subset of glob syntax used by this guardrail's own
 * checked-in config (config/scan-roots.json excludePatterns) and by the
 * frozen F2-GUARDRAIL-PREP-010-A baseline's `proposedEnforcementKey.
 * callerPathGlob` values: `**` (any number of path segments), `*` (any
 * characters within one segment), and `{a,b,c}` brace alternation (e.g.
 * `server/src/services/{googleAiStudio,whatsappConversationAgent}.ts`).
 *
 * Deliberately not a general-purpose glob engine and not a new dependency —
 * see docs/program/evidence/F2-GUARDRAIL-IMPL-001_* for the tool-choice
 * rationale (TypeScript compiler API + this tiny matcher were sufficient;
 * no minimatch/fast-glob/dependency-cruiser dependency was added).
 */

function expandBraces(pattern: string): string[] {
  const start = pattern.indexOf('{');
  if (start === -1) return [pattern];
  const end = pattern.indexOf('}', start);
  if (end === -1) return [pattern];
  const prefix = pattern.slice(0, start);
  const suffix = pattern.slice(end + 1);
  const options = pattern.slice(start + 1, end).split(',');
  return options.flatMap((opt) => expandBraces(`${prefix}${opt}${suffix}`));
}

function globToRegExp(pattern: string): RegExp {
  let out = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      // '**' optionally consumes a following '/' so 'a/**/b' matches 'a/b'.
      if (pattern[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  out += '$';
  return new RegExp(out);
}

/** path and pattern are both POSIX-style ('/'-separated) relative paths. */
export function globMatch(pattern: string, path: string): boolean {
  return expandBraces(pattern).some((expanded) => globToRegExp(expanded).test(path));
}
