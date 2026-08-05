/**
 * Covers requirements 1-6: exact-edge extraction, callerPath normalization,
 * callerSymbol extraction, ownerDomain classification, targetModelOrSymbol
 * classification, accessKind classification.
 */
import type { Harness } from './testHarness.js';
import { extractEdges } from '../lib/edgeExtraction.js';
import { loadDomainMap, loadScanRoots } from '../lib/configLoader.js';
import { discoverSourceFiles } from '../lib/sourceDiscovery.js';
import { FIXTURE_DOMAIN_MAP, FIXTURE_REPO_ROOT, FIXTURE_SCAN_ROOTS } from './fixturePaths.js';

export function registerEdgeExtractionTests(h: Harness): void {
  h.section('edgeExtraction: exact-edge extraction over fixture repo');

  const scanRoots = loadScanRoots(FIXTURE_SCAN_ROOTS);
  const domainMap = loadDomainMap(FIXTURE_DOMAIN_MAP);
  const discovery = discoverSourceFiles(FIXTURE_REPO_ROOT, scanRoots);
  const result = extractEdges(FIXTURE_REPO_ROOT, discovery.files, domainMap);

  h.test('discovery excludes __tests__/**, only finds real source files', () => {
    h.assert(
      !discovery.files.some((f) => f.includes('__tests__')),
      'excludePatterns must remove the __tests__ fixture file',
    );
    h.assert(discovery.files.includes('server/src/routes/orderRoute.ts'), 'orderRoute.ts must be discovered');
  });

  h.test('cross-domain named import produces a finding with the exact 5-field tuple', () => {
    const finding = result.findings.find(
      (f) => f.callerPath === 'server/src/routes/orderRoute.ts' && f.callerSymbol === 'processPayment',
    );
    h.assert(finding !== undefined, 'expected a finding for the processPayment import');
    h.assertEqual(finding!.callerPath, 'server/src/routes/orderRoute.ts', 'callerPath');
    h.assertEqual(finding!.callerSymbol, 'processPayment', 'callerSymbol');
    h.assertEqual(finding!.ownerDomain, 'domain-payments', 'ownerDomain (target file domain)');
    h.assertEqual(finding!.targetModelOrSymbol, 'services/paymentService.ts', 'targetModelOrSymbol');
    h.assertEqual(finding!.accessKind, 'import', 'accessKind');
    h.assertEqual(finding!.callerDomain, 'domain-orders', 'callerDomain (informational)');
  });

  h.test('callerPath is repo-relative POSIX, never containing the fixture repo prefix twice or a leading slash', () => {
    for (const f of result.findings) {
      h.assert(f.callerPath.startsWith('server/src/'), `callerPath must start with server/src/: ${f.callerPath}`);
      h.assert(!f.callerPath.startsWith('/'), `callerPath must not be absolute: ${f.callerPath}`);
    }
  });

  h.test('a named import produces exactly one finding per imported binding', () => {
    const paymentFindings = result.findings.filter(
      (f) => f.callerPath === 'server/src/routes/orderRoute.ts' && f.targetModelOrSymbol === 'services/paymentService.ts',
    );
    const symbols = paymentFindings.map((f) => f.callerSymbol).sort();
    h.assertDeepEqual(symbols, ['processPayment', 'refundPayment'], 'two named imports -> two findings');
  });

  h.test('namespace import (import * as x) yields callerSymbol "*"', () => {
    const finding = result.findings.find(
      (f) => f.callerPath === 'server/src/routes/orderRoute.ts' && f.targetModelOrSymbol === 'services/inventoryService.ts',
    );
    h.assert(finding !== undefined, 'expected a finding for the namespace import');
    h.assertEqual(finding!.callerSymbol, '*', 'namespace import symbol');
  });

  h.test('side-effect-only import (no binding) yields callerSymbol "module"', () => {
    const finding = result.findings.find(
      (f) => f.callerPath === 'server/src/routes/orderRoute.ts' && f.targetModelOrSymbol === 'services/sideEffectOnly.ts',
    );
    h.assert(finding !== undefined, 'expected a finding for the side-effect-only import');
    h.assertEqual(finding!.callerSymbol, 'module', 'side-effect import symbol');
  });

  h.test('default import yields callerSymbol "default" and UNRESOLVED ownerDomain for an unmapped target', () => {
    const finding = result.findings.find(
      (f) => f.callerPath === 'server/src/routes/orderRoute.ts' && f.targetModelOrSymbol === 'unscoped/outOfScope.ts',
    );
    h.assert(finding !== undefined, 'expected a finding for the default import of an unmapped file');
    h.assertEqual(finding!.callerSymbol, 'default', 'default import symbol');
    h.assertEqual(finding!.ownerDomain, 'UNRESOLVED', 'unmapped target file must classify as UNRESOLVED, never guessed');
  });

  h.test('same-domain import produces no finding at all', () => {
    const finding = result.findings.find(
      (f) => f.callerPath === 'server/src/routes/orderRoute.ts' && f.targetModelOrSymbol === 'utils/helper.ts',
    );
    h.assert(finding === undefined, 'orderRoute.ts and utils/helper.ts share domain-orders; must not be a finding');
  });

  h.test('a source file with broken syntax still yields its syntactically-valid top-level import edge, no crash', () => {
    const finding = result.findings.find(
      (f) => f.callerPath === 'server/src/routes/brokenSyntax.ts' && f.callerSymbol === 'processPayment',
    );
    h.assert(finding !== undefined, 'TypeScript is error-tolerant; the valid top-level import must still be extracted');
    h.assertEqual(result.errors.length, 0, 'malformed function body must not register as a file-level error');
  });
}
