/**
 * F2-GUARDRAIL-IMPL-001 — configuration loading and validation.
 *
 * Deliberately narrow: this module reads exactly two checked-in JSON files
 * (scan-roots.json, domain-map.json) and validates their shape. It never
 * reads environment variables, secrets, or production configuration.
 */
import { readFileSync } from 'node:fs';
import type { DomainMapConfig, ScanRootsConfig } from './types.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function readJson(filePath: string, label: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    // filePath here is caller-supplied (a CLI --flag or a default relative
    // to this script), never derived from repository source content, so
    // echoing it is not the same class of leak as an fs error's own
    // message/err.path on a *scanned* file — still prefer the OS code only.
    throw new ConfigError(`${label}: cannot read "${filePath}" (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`${label}: "${filePath}" is not valid JSON: ${(err as Error).message}`);
  }
}

export function loadScanRoots(filePath: string): ScanRootsConfig {
  const data = readJson(filePath, 'scan-roots config') as Partial<ScanRootsConfig>;
  if (!Array.isArray(data.roots) || data.roots.length === 0) {
    throw new ConfigError(`scan-roots config "${filePath}": "roots" must be a non-empty array`);
  }
  if (!data.roots.every((r) => typeof r === 'string' && r.length > 0)) {
    throw new ConfigError(`scan-roots config "${filePath}": every entry in "roots" must be a non-empty string`);
  }
  if (!Array.isArray(data.fileExtensions) || data.fileExtensions.length === 0) {
    throw new ConfigError(`scan-roots config "${filePath}": "fileExtensions" must be a non-empty array`);
  }
  if (!data.fileExtensions.every((e) => typeof e === 'string' && e.length > 0)) {
    throw new ConfigError(`scan-roots config "${filePath}": every entry in "fileExtensions" must be a non-empty string`);
  }
  if (data.excludePatterns !== undefined) {
    if (!Array.isArray(data.excludePatterns)) {
      throw new ConfigError(`scan-roots config "${filePath}": "excludePatterns" must be an array`);
    }
    if (!data.excludePatterns.every((p) => typeof p === 'string' && p.length > 0)) {
      throw new ConfigError(`scan-roots config "${filePath}": every entry in "excludePatterns" must be a non-empty string`);
    }
  }
  return {
    schemaVersion: String(data.schemaVersion ?? 'unknown'),
    provenance: String(data.provenance ?? ''),
    roots: data.roots,
    fileExtensions: data.fileExtensions,
    excludePatterns: data.excludePatterns ?? [],
  };
}

export function loadDomainMap(filePath: string): DomainMapConfig {
  const data = readJson(filePath, 'domain-map config') as Partial<DomainMapConfig>;
  if (typeof data.files !== 'object' || data.files === null || Array.isArray(data.files)) {
    throw new ConfigError(`domain-map config "${filePath}": "files" must be an object`);
  }
  for (const [key, value] of Object.entries(data.files)) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new ConfigError(`domain-map config "${filePath}": files["${key}"] must be a non-empty string`);
    }
  }
  return {
    schemaVersion: String(data.schemaVersion ?? 'unknown'),
    provenance: (data.provenance as Record<string, unknown>) ?? {},
    scanRootPrefixes: Array.isArray(data.scanRootPrefixes) ? data.scanRootPrefixes : [],
    fileCount: typeof data.fileCount === 'number' ? data.fileCount : Object.keys(data.files).length,
    files: data.files as Record<string, string>,
  };
}
