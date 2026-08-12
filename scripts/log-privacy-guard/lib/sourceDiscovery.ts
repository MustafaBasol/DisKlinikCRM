import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { ScanRootsConfig } from './types.js';

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

/**
 * Deliberately minimal — this tool's excludePatterns are a fixed, known set
 * (`**\/__tests__/**`, `**\/*.test.ts`, `**\/*.spec.ts`), not a general glob
 * engine. Broadening the pattern vocabulary should broaden this function
 * explicitly, not silently via a generic matcher no one audited.
 */
function isExcluded(relPosixPath: string, excludePatterns: string[]): boolean {
  const base = relPosixPath.split('/').pop() ?? relPosixPath;
  for (const pattern of excludePatterns) {
    if (pattern === '**/__tests__/**' && relPosixPath.includes('/__tests__/')) return true;
    if (pattern === '**/*.test.ts' && base.endsWith('.test.ts')) return true;
    if (pattern === '**/*.spec.ts' && base.endsWith('.spec.ts')) return true;
  }
  return false;
}

export interface DiscoveredFile {
  absPath: string;
  relPosixPath: string;
}

export function discoverSourceFiles(repoRoot: string, config: ScanRootsConfig): DiscoveredFile[] {
  const results: DiscoveredFile[] = [];

  function walk(dirAbs: string) {
    let entries: string[];
    try {
      entries = readdirSync(dirAbs);
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryAbs = join(dirAbs, entry);
      let st;
      try {
        st = statSync(entryAbs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (entry === 'node_modules') continue;
        walk(entryAbs);
        continue;
      }
      if (!st.isFile()) continue;
      if (!config.fileExtensions.some((ext) => entry.endsWith(ext))) continue;
      const relPosixPath = toPosix(relative(repoRoot, entryAbs));
      if (isExcluded(relPosixPath, config.excludePatterns)) continue;
      results.push({ absPath: entryAbs, relPosixPath });
    }
  }

  for (const root of config.roots) {
    walk(resolve(repoRoot, root));
  }

  results.sort((a, b) => a.relPosixPath.localeCompare(b.relPosixPath));
  return results;
}
