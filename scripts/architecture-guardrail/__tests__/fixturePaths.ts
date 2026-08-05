import { resolve } from 'node:path';

const FIXTURES_DIR = resolve(import.meta.dirname, 'fixtures');

export const FIXTURE_REPO_ROOT = resolve(FIXTURES_DIR, 'repo');
export const FIXTURE_SCAN_ROOTS = resolve(FIXTURES_DIR, 'scan-roots.json');
export const FIXTURE_SCAN_ROOTS_MISSING_ROOTS = resolve(FIXTURES_DIR, 'scan-roots-missing-roots.json');
export const FIXTURE_SCAN_ROOTS_MISSING_PATH = resolve(FIXTURES_DIR, 'scan-roots-missing-path.json');
export const FIXTURE_SCAN_ROOTS_FILE_EXTENSIONS_NOT_STRINGS = resolve(
  FIXTURES_DIR,
  'scan-roots-file-extensions-not-strings.json',
);
export const FIXTURE_SCAN_ROOTS_FILE_EXTENSIONS_EMPTY_STRING = resolve(
  FIXTURES_DIR,
  'scan-roots-file-extensions-empty-string.json',
);
export const FIXTURE_SCAN_ROOTS_FILE_EXTENSIONS_MIXED = resolve(FIXTURES_DIR, 'scan-roots-file-extensions-mixed.json');
export const FIXTURE_SCAN_ROOTS_EXCLUDE_PATTERNS_NOT_ARRAY = resolve(
  FIXTURES_DIR,
  'scan-roots-exclude-patterns-not-array.json',
);
export const FIXTURE_SCAN_ROOTS_EXCLUDE_PATTERNS_NOT_STRINGS = resolve(
  FIXTURES_DIR,
  'scan-roots-exclude-patterns-not-strings.json',
);
export const FIXTURE_SCAN_ROOTS_EXCLUDE_PATTERNS_EMPTY_STRING = resolve(
  FIXTURES_DIR,
  'scan-roots-exclude-patterns-empty-string.json',
);
export const FIXTURE_DOMAIN_MAP = resolve(FIXTURES_DIR, 'domain-map.json');
export const FIXTURE_DOMAIN_MAP_INVALID_SHAPE = resolve(FIXTURES_DIR, 'domain-map-invalid-shape.json');
export const FIXTURE_BASELINE_VALID = resolve(FIXTURES_DIR, 'baseline-valid.json');
export const FIXTURE_BASELINE_MISSING_EDGES = resolve(FIXTURES_DIR, 'baseline-missing-edges.json');
export const FIXTURE_MALFORMED_JSON = resolve(FIXTURES_DIR, 'malformed.json');
