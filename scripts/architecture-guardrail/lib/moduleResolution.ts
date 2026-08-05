/**
 * F2-GUARDRAIL-IMPL-001 — minimal relative-import resolver.
 *
 * Resolves a relative import specifier (e.g. './whatsapp/whatsappOutboundMessaging.js')
 * found in a source file to the on-disk .ts/.tsx file it refers to, following
 * this repository's own convention of writing `.js` specifiers that resolve
 * to `.ts` source files (Node ESM + TypeScript "allowImportingTsExtensions"-
 * adjacent pattern, seen throughout scripts/test-runtime/**). Only relative
 * specifiers ('./' or '../') are ever resolved — package/bare specifiers
 * (npm dependencies) are out of scope by construction, since cross-domain
 * *internal* boundary-crossing is what this guardrail detects, not
 * third-party dependency usage.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/** Returns the resolved absolute file path, or null if it cannot be resolved on disk. */
export function resolveRelativeImport(callerFileAbsolute: string, specifier: string): string | null {
  const callerDir = dirname(callerFileAbsolute);
  const stripped = specifier.replace(/\.jsx?$/, '');
  const base = normalize(join(callerDir, stripped));

  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // race between existsSync and statSync — treat as unresolved
      }
    }
  }
  return null;
}
