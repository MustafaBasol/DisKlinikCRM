/** Covers requirement 12 (malformed config) and 14 (unreadable/missing configured path), plus empty-result discovery. */
import type { Harness } from './testHarness.js';
import { ConfigError, loadDomainMap, loadScanRoots } from '../lib/configLoader.js';
import { discoverSourceFiles } from '../lib/sourceDiscovery.js';
import {
  FIXTURE_DOMAIN_MAP,
  FIXTURE_DOMAIN_MAP_INVALID_SHAPE,
  FIXTURE_MALFORMED_JSON,
  FIXTURE_REPO_ROOT,
  FIXTURE_SCAN_ROOTS,
  FIXTURE_SCAN_ROOTS_MISSING_PATH,
  FIXTURE_SCAN_ROOTS_MISSING_ROOTS,
} from './fixturePaths.js';

export function registerConfigAndDiscoveryTests(h: Harness): void {
  h.section('configLoader: malformed / invalid-shape config handling');

  h.test('malformed JSON scan-roots config throws ConfigError, not a raw parse crash', () => {
    h.assertThrows(() => loadScanRoots(FIXTURE_MALFORMED_JSON), 'malformed JSON must throw ConfigError');
    try {
      loadScanRoots(FIXTURE_MALFORMED_JSON);
    } catch (err) {
      h.assert(err instanceof ConfigError, 'must be a typed ConfigError');
    }
  });

  h.test('scan-roots config missing "roots" throws ConfigError', () => {
    h.assertThrows(() => loadScanRoots(FIXTURE_SCAN_ROOTS_MISSING_ROOTS), 'missing roots array must throw');
  });

  h.test('nonexistent scan-roots config path throws ConfigError', () => {
    h.assertThrows(() => loadScanRoots('/does/not/exist/scan-roots.json'), 'unreadable config file must throw');
  });

  h.test('domain-map config with "files" as an array (wrong shape) throws ConfigError', () => {
    h.assertThrows(() => loadDomainMap(FIXTURE_DOMAIN_MAP_INVALID_SHAPE), 'wrong-shaped files must throw');
  });

  h.test('valid scan-roots and domain-map load without error', () => {
    const scanRoots = loadScanRoots(FIXTURE_SCAN_ROOTS);
    const domainMap = loadDomainMap(FIXTURE_DOMAIN_MAP);
    h.assert(scanRoots.roots.length > 0, 'roots must be non-empty');
    h.assert(Object.keys(domainMap.files).length > 0, 'files must be non-empty');
  });

  h.section('sourceDiscovery: unreadable/missing configured path and empty result');

  h.test('a configured scan root that does not exist on disk is recorded as an error, other roots still scanned', () => {
    const scanRoots = loadScanRoots(FIXTURE_SCAN_ROOTS_MISSING_PATH);
    const result = discoverSourceFiles(FIXTURE_REPO_ROOT, scanRoots);
    h.assert(result.errors.length === 1, `expected exactly one discovery error, got ${result.errors.length}`);
    h.assertEqual(result.errors[0].code, 'SCAN_ROOT_UNREADABLE', 'error code');
    h.assertEqual(result.errors[0].filePath, 'server/src/does-not-exist', 'error filePath must be repo-relative, not absolute');
    h.assert(result.files.some((f) => f.startsWith('server/src/routes/')), 'the other, valid root must still be scanned');
  });

  h.test('discovery of a root whose only files are all excluded yields an empty (but valid) result', () => {
    const scanRoots = loadScanRoots(FIXTURE_SCAN_ROOTS);
    const emptyScopeConfig = { ...scanRoots, roots: ['server/src/routes/__tests__'] };
    const result = discoverSourceFiles(FIXTURE_REPO_ROOT, emptyScopeConfig);
    h.assertEqual(result.files.length, 0, 'all files under this root are excluded by excludePatterns');
    h.assertEqual(result.errors.length, 0, 'an empty-after-exclusion result is not itself an error');
  });

  h.test('no discovered path is ever absolute', () => {
    const scanRoots = loadScanRoots(FIXTURE_SCAN_ROOTS);
    const result = discoverSourceFiles(FIXTURE_REPO_ROOT, scanRoots);
    for (const f of result.files) {
      h.assert(!f.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(f), `discovered path must be repo-relative: ${f}`);
    }
  });
}
