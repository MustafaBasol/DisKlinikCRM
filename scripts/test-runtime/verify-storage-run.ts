#!/usr/bin/env node
/**
 * F4-CI-L4-STORAGE-GATE-001 — Layer 4 storage-run gate.
 *
 * Test/CI tooling only. Never imported by application runtime.
 *
 * Reads the `storage-run-summary.json` artifact produced by
 * `npm run test:runtime:storage -- --summary-file=<path>` and fails the job
 * unless that artifact proves a real storage run happened. Runs on EVERY
 * Layer 4 execution, not only on failure — the defect this closes is
 * precisely that the artifact was validated `if: failure()`, so the vacuous
 * green path was never inspected at all.
 *
 * Usage:
 *   npx tsx scripts/test-runtime/verify-storage-run.ts <summary-file> [--require-offhost-destination]
 *
 * Exit codes:
 *   0  summary present, parsable, and proves a real, complete storage run
 *   1  summary missing, unreadable, unparsable, or failing the contract
 *   2  bad invocation
 */
import { readFileSync } from 'node:fs';
import { validateStorageRunSummary, STORAGE_GATE_CONTRACT_SUMMARY } from './lib/storageRunSummary.js';

function main(): number {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) {
    console.error('Usage: verify-storage-run.ts <summary-file> [--require-offhost-destination]');
    return 2;
  }
  const requireOffHostShapedDestination = args.includes('--require-offhost-destination');

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    console.error(
      `[layer4-gate] FAIL: run-summary artifact "${path}" could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error('[layer4-gate] A Layer 4 run that produced no summary artifact produced no evidence — failing closed.');
    return 1;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(
      `[layer4-gate] FAIL: run-summary artifact "${path}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }

  const result = validateStorageRunSummary(parsed, { requireOffHostShapedDestination });
  if (!result.valid) {
    console.error(`[layer4-gate] FAIL: "${path}" does not prove a real storage run:`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    console.error(`[layer4-gate] Contract:\n  ${STORAGE_GATE_CONTRACT_SUMMARY}`);
    return 1;
  }

  const proof = (parsed as { executionProof?: { executedCount?: number } }).executionProof;
  const minio = (parsed as { minio?: { addressMode?: string } }).minio;
  console.log(
    `[layer4-gate] PASS: storage suite executed ${proof?.executedCount ?? '?'} test case(s) against a ${
      minio?.addressMode ?? '?'
    } MinIO destination, migrations applied, cleanup clean.`,
  );
  return 0;
}

process.exitCode = main();
