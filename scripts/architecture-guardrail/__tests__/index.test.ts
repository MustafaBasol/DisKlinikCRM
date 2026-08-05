/**
 * F2-GUARDRAIL-IMPL-001 — focused unit test entry point.
 * Run: npx tsx scripts/architecture-guardrail/__tests__/index.test.ts
 */
import { createHarness } from './testHarness.js';
import { registerEdgeExtractionTests } from './edgeExtraction.test.js';
import { registerFindingIdTests } from './findingId.test.js';
import { registerNormalizationTests } from './normalization.test.js';
import { registerConfigAndDiscoveryTests } from './configAndDiscovery.test.js';
import { registerBaselineTests } from './baseline.test.js';
import { registerReportTests } from './report.test.js';
import { registerCliTests } from './cli.test.js';

const h = createHarness('architecture-guardrail');

registerEdgeExtractionTests(h);
registerFindingIdTests(h);
registerNormalizationTests(h);
registerConfigAndDiscoveryTests(h);
registerBaselineTests(h);
registerReportTests(h);
registerCliTests(h);

const { passed, failed } = h.summary();
console.log(`\n${'-'.repeat(60)}`);
console.log(`architecture-guardrail unit tests: ${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
