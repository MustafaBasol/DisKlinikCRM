/** Covers requirement 13 (malformed baseline) and 18 (existing/new/resolved classification). */
import type { Harness } from './testHarness.js';
import {
  BaselineError,
  computeResolvedBaselineEdgeIds,
  findMatchingBaselineEntry,
  loadBaselineEntries,
} from '../lib/baseline.js';
import type { ExactEdgeTuple } from '../lib/types.js';
import { FIXTURE_BASELINE_MISSING_EDGES, FIXTURE_BASELINE_VALID, FIXTURE_MALFORMED_JSON } from './fixturePaths.js';

export function registerBaselineTests(h: Harness): void {
  h.section('baseline: malformed baseline handling');

  h.test('malformed JSON baseline throws BaselineError, not a raw parse crash', () => {
    h.assertThrows(() => loadBaselineEntries(FIXTURE_MALFORMED_JSON), 'malformed baseline JSON must throw');
    try {
      loadBaselineEntries(FIXTURE_MALFORMED_JSON);
    } catch (err) {
      h.assert(err instanceof BaselineError, 'must be a typed BaselineError');
    }
  });

  h.test('baseline JSON missing the top-level "edges" array throws BaselineError', () => {
    h.assertThrows(() => loadBaselineEntries(FIXTURE_BASELINE_MISSING_EDGES), 'missing edges[] must throw');
  });

  h.test('nonexistent baseline file path throws BaselineError', () => {
    h.assertThrows(() => loadBaselineEntries('/does/not/exist/baseline.json'), 'unreadable baseline must throw');
  });

  h.test('a single edge with an incomplete proposedEnforcementKey is skipped, not fatal to the whole file', () => {
    const entries = loadBaselineEntries(FIXTURE_BASELINE_VALID);
    h.assert(
      !entries.some((e) => e.baselineEdgeId === 'FIX-004'),
      'FIX-004 has no ownerDomain and must be skipped, not crash the loader',
    );
    h.assertEqual(entries.length, 3, 'exactly 3 of the 4 fixture edges have a complete key');
  });

  h.section('baseline: EXISTING / NEW / RESOLVED classification');

  const entries = loadBaselineEntries(FIXTURE_BASELINE_VALID);

  h.test('an exact callerPath match classifies as EXISTING', () => {
    const tuple: ExactEdgeTuple = {
      callerPath: 'server/src/routes/orderRoute.ts',
      callerSymbol: 'processPayment',
      ownerDomain: 'domain-payments',
      targetModelOrSymbol: 'services/paymentService.ts',
      accessKind: 'import',
    };
    const match = findMatchingBaselineEntry(entries, tuple);
    h.assert(match !== null, 'expected a baseline match');
    h.assertEqual(match!.baselineEdgeId, 'FIX-001', 'must match the exact-callerPath entry');
  });

  h.test('callerSymbol differing from the baseline entry still matches (excluded from match key, documented limitation)', () => {
    const tuple: ExactEdgeTuple = {
      callerPath: 'server/src/routes/orderRoute.ts',
      callerSymbol: 'aDifferentSymbolThanBaselineRecorded',
      ownerDomain: 'domain-payments',
      targetModelOrSymbol: 'services/paymentService.ts',
      accessKind: 'import',
    };
    const match = findMatchingBaselineEntry(entries, tuple);
    h.assert(match !== null, 'match key intentionally excludes callerSymbol — see lib/baseline.ts header comment');
  });

  h.test('a glob callerPathGlob entry matches any caller path satisfying the glob', () => {
    const tuple: ExactEdgeTuple = {
      callerPath: 'server/src/routes/orderRoute.ts',
      callerSymbol: '*',
      ownerDomain: 'domain-inventory',
      targetModelOrSymbol: 'services/inventoryService.ts',
      accessKind: 'import',
    };
    const match = findMatchingBaselineEntry(entries, tuple);
    h.assert(match !== null, 'expected a glob match');
    h.assertEqual(match!.baselineEdgeId, 'FIX-002', 'must match the glob entry');
  });

  h.test('a tuple with no baseline counterpart classifies as NEW (no match found)', () => {
    const tuple: ExactEdgeTuple = {
      callerPath: 'server/src/routes/brandNewRoute.ts',
      callerSymbol: 'brandNewSymbol',
      ownerDomain: 'domain-payments',
      targetModelOrSymbol: 'services/paymentService.ts',
      accessKind: 'import',
    };
    const match = findMatchingBaselineEntry(entries, tuple);
    h.assert(match === null, 'no baseline entry covers this caller/target pair -> NEW');
  });

  h.test('an exact-callerPath baseline entry absent from current findings is classified RESOLVED', () => {
    const currentTuples: ExactEdgeTuple[] = [
      {
        callerPath: 'server/src/routes/orderRoute.ts',
        callerSymbol: 'processPayment',
        ownerDomain: 'domain-payments',
        targetModelOrSymbol: 'services/paymentService.ts',
        accessKind: 'import',
      },
    ];
    const resolved = computeResolvedBaselineEdgeIds(entries, currentTuples);
    h.assertDeepEqual(resolved, ['FIX-003'], 'FIX-003 (legacyRoute.ts) is not in currentTuples -> resolved');
  });

  h.test('a glob baseline entry is never classified RESOLVED (ill-defined for a pattern, by design)', () => {
    const resolved = computeResolvedBaselineEdgeIds(entries, []);
    h.assert(!resolved.includes('FIX-002'), 'FIX-002 is a glob entry and must be excluded from resolved computation');
  });
}
