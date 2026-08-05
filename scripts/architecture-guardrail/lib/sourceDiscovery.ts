/**
 * F2-GUARDRAIL-IMPL-001 — source discovery.
 *
 * Enumerates source files under the explicitly configured scan roots only.
 * Never walks the whole repository. A missing/unreadable configured root is
 * recorded as an error (it is a genuine configuration problem, not an
 * architectural finding) and scanning continues over the remaining roots —
 * one bad root must not silently suppress the rest of the scan, and must
 * not crash the process either.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportError, ScanRootsConfig } from './types.js';
import { globMatch } from './globMatch.js';
import { toRepoRelativePosix } from './normalization.js';

export interface DiscoveryResult {
  files: string[]; // repo-relative POSIX paths, deterministically sorted
  errors: ReportError[];
}

export function discoverSourceFiles(repoRoot: string, config: ScanRootsConfig): DiscoveryResult {
  const errors: ReportError[] = [];
  const found = new Set<string>();

  for (const root of config.roots) {
    const absoluteRoot = join(repoRoot, root);
    let rootStat;
    try {
      rootStat = statSync(absoluteRoot);
    } catch {
      errors.push({
        code: 'SCAN_ROOT_UNREADABLE',
        message: `Configured scan root does not exist or is unreadable: "${root}"`,
        filePath: root,
      });
      continue;
    }
    if (!rootStat.isDirectory()) {
      errors.push({
        code: 'SCAN_ROOT_NOT_A_DIRECTORY',
        message: `Configured scan root is not a directory: "${root}"`,
        filePath: root,
      });
      continue;
    }

    walk(absoluteRoot, repoRoot, config, found, errors);
  }

  return { files: [...found].sort((a, b) => a.localeCompare(b)), errors };
}

function walk(
  dirAbsolute: string,
  repoRoot: string,
  config: ScanRootsConfig,
  found: Set<string>,
  errors: ReportError[],
): void {
  let entries;
  try {
    entries = readdirSync(dirAbsolute, { withFileTypes: true });
  } catch (err) {
    const relPath = toRepoRelativePosix(repoRoot, dirAbsolute);
    errors.push({
      code: 'DIRECTORY_UNREADABLE',
      // Only the OS error code is safe to include — Node's fs error
      // message embeds the absolute filesystem path; relPath (already
      // repo-relative) carries the location instead.
      message: `Cannot read directory (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`,
      filePath: relPath,
    });
    return;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childAbsolute = join(dirAbsolute, entry.name);
    if (entry.isDirectory()) {
      walk(childAbsolute, repoRoot, config, found, errors);
      continue;
    }
    if (!entry.isFile()) continue;

    const relPath = toRepoRelativePosix(repoRoot, childAbsolute);
    if (!config.fileExtensions.some((ext) => relPath.endsWith(ext))) continue;
    if (config.excludePatterns.some((pattern) => globMatch(pattern, relPath))) continue;
    found.add(relPath);
  }
}
