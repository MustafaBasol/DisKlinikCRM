/**
 * processRole.test.ts — F3-IMPL-002
 *
 * assertProcessRole() (utils/processRole.ts) is the fail-closed guard behind
 * the repository-defined NORAMEDI_PROCESS_ROLE contract: each PM2 app
 * declared in ecosystem.config.cjs sets this variable, and each entrypoint
 * (index.ts="api", worker.ts="worker") asserts its own expected role at
 * startup. Proves: unset is backward compatible (no throw), a matching
 * declared role is accepted, and a missing/mismatched/invalid declared role
 * fails closed (throws) rather than silently running with an ambiguous
 * production role.
 *
 * Pure function, no DB/network required.
 *
 * Run with: tsx src/tests/processRole.test.ts
 */

import assert from 'node:assert/strict';
import { assertProcessRole } from '../utils/processRole.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((err: unknown) => {
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      failed++;
    });
}

function section(title: string) {
  console.log(`\n${title}`);
}

function envWith(vars: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return vars as unknown as NodeJS.ProcessEnv;
}

async function main() {
  section('assertProcessRole — backward compatibility (dev/test, pre-existing deployments)');

  await test('NORAMEDI_PROCESS_ROLE unset -> does not throw for "api"', () => {
    const result = assertProcessRole('api', envWith({}));
    assert.equal(result.declared, false);
    assert.equal(result.role, 'api');
  });

  await test('NORAMEDI_PROCESS_ROLE unset -> does not throw for "worker"', () => {
    const result = assertProcessRole('worker', envWith({}));
    assert.equal(result.declared, false);
    assert.equal(result.role, 'worker');
  });

  section('assertProcessRole — matching declared role');

  await test('NORAMEDI_PROCESS_ROLE=api on the api entrypoint -> ok, declared=true', () => {
    const result = assertProcessRole('api', envWith({ NORAMEDI_PROCESS_ROLE: 'api' }));
    assert.equal(result.declared, true);
    assert.equal(result.role, 'api');
  });

  await test('NORAMEDI_PROCESS_ROLE=worker on the worker entrypoint -> ok, declared=true', () => {
    const result = assertProcessRole('worker', envWith({ NORAMEDI_PROCESS_ROLE: 'worker' }));
    assert.equal(result.declared, true);
    assert.equal(result.role, 'worker');
  });

  section('assertProcessRole — fails closed on ambiguous/invalid production role');

  await test('NORAMEDI_PROCESS_ROLE=worker on the api entrypoint -> throws (mismatched role)', () => {
    assert.throws(
      () => assertProcessRole('api', envWith({ NORAMEDI_PROCESS_ROLE: 'worker' })),
      /does not match this process's entrypoint/,
    );
  });

  await test('NORAMEDI_PROCESS_ROLE=api on the worker entrypoint -> throws (mismatched role)', () => {
    assert.throws(
      () => assertProcessRole('worker', envWith({ NORAMEDI_PROCESS_ROLE: 'api' })),
      /does not match this process's entrypoint/,
    );
  });

  await test('NORAMEDI_PROCESS_ROLE=<garbage> -> throws (unrecognized role) for either expected role', () => {
    for (const expected of ['api', 'worker'] as const) {
      assert.throws(
        () => assertProcessRole(expected, envWith({ NORAMEDI_PROCESS_ROLE: 'nope' })),
        /not a recognized process role/,
      );
    }
  });

  await test('NORAMEDI_PROCESS_ROLE="" (empty string) -> throws (unrecognized role, not treated as unset)', () => {
    assert.throws(
      () => assertProcessRole('api', envWith({ NORAMEDI_PROCESS_ROLE: '' })),
      /not a recognized process role/,
    );
  });

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
