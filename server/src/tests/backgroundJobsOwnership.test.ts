/**
 * backgroundJobsOwnership.test.ts — F3-IMPL-001
 *
 * resolveApiBackgroundJobsOwnership() (utils/backgroundJobsOwnership.ts)
 * makes the previously inline, untested
 * `process.env.RUN_BACKGROUND_JOBS !== 'false'` decision in index.ts an
 * explicit, tested function — while deliberately preserving today's exact
 * production default (see the module docstring for why the default was NOT
 * flipped). This proves the API and worker decisions independently, per
 * F3-IMPL-001's test requirements for the worker/job-ownership change.
 *
 * Pure function, no DB/network required.
 *
 * Run with: tsx src/tests/backgroundJobsOwnership.test.ts
 */

import assert from 'node:assert/strict';
import { resolveApiBackgroundJobsOwnership } from '../utils/backgroundJobsOwnership.js';

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
  section('resolveApiBackgroundJobsOwnership — API process');

  await test('RUN_BACKGROUND_JOBS unset -> owns jobs (single-process default, production)', () => {
    const decision = resolveApiBackgroundJobsOwnership(envWith({ NODE_ENV: 'production' }));
    assert.equal(decision.ownsJobs, true);
    assert.match(decision.reason, /unset/i);
  });

  await test('RUN_BACKGROUND_JOBS unset -> owns jobs (development)', () => {
    const decision = resolveApiBackgroundJobsOwnership(envWith({ NODE_ENV: 'development' }));
    assert.equal(decision.ownsJobs, true);
  });

  await test('RUN_BACKGROUND_JOBS=false -> does NOT own jobs, in production', () => {
    const decision = resolveApiBackgroundJobsOwnership(
      envWith({ NODE_ENV: 'production', RUN_BACKGROUND_JOBS: 'false' }),
    );
    assert.equal(decision.ownsJobs, false);
    assert.match(decision.reason, /RUN_BACKGROUND_JOBS=false/);
  });

  await test('RUN_BACKGROUND_JOBS=false -> does NOT own jobs, in development', () => {
    const decision = resolveApiBackgroundJobsOwnership(
      envWith({ NODE_ENV: 'development', RUN_BACKGROUND_JOBS: 'false' }),
    );
    assert.equal(decision.ownsJobs, false);
  });

  await test('RUN_BACKGROUND_JOBS=true -> owns jobs explicitly', () => {
    const decision = resolveApiBackgroundJobsOwnership(
      envWith({ NODE_ENV: 'production', RUN_BACKGROUND_JOBS: 'true' }),
    );
    assert.equal(decision.ownsJobs, true);
  });

  await test('RUN_BACKGROUND_JOBS=<garbage> -> owns jobs (only the literal "false" opts out — legacy loose parsing preserved)', () => {
    const decision = resolveApiBackgroundJobsOwnership(
      envWith({ NODE_ENV: 'production', RUN_BACKGROUND_JOBS: 'nope' }),
    );
    assert.equal(decision.ownsJobs, true);
  });

  await test('decision does not depend on NODE_ENV when RUN_BACKGROUND_JOBS is explicitly set', () => {
    for (const nodeEnv of ['production', 'development', 'test', undefined]) {
      const off = resolveApiBackgroundJobsOwnership(envWith({ NODE_ENV: nodeEnv, RUN_BACKGROUND_JOBS: 'false' }));
      assert.equal(off.ownsJobs, false, `expected false for NODE_ENV=${nodeEnv}`);
    }
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
