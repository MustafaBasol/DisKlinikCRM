/**
 * readiness.test.ts — F3-OBS-001
 *
 * evaluateReadiness() (utils/readiness.ts) makes /readyz's dependency-check
 * policy an explicit, tested function via injected fake checks — no real
 * Postgres/Redis required (see the module's own docstring for why Redis is
 * treated as optional/non-blocking while the database is mandatory).
 *
 * Pure function, no DB/network required.
 *
 * Run with: tsx src/tests/readiness.test.ts
 */

import assert from 'node:assert/strict';
import { evaluateReadiness } from '../utils/readiness.js';

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

async function main() {
  section('evaluateReadiness — database (mandatory)');

  await test('DB check succeeds -> status ok, database check ok', async () => {
    const result = await evaluateReadiness({ checkDatabase: async () => undefined });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.checks.find(c => c.name === 'database'), { name: 'database', status: 'ok' });
  });

  await test('DB check rejects -> status degraded, database check fail/error', async () => {
    const result = await evaluateReadiness({ checkDatabase: async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432 user=crm_user'); } });
    assert.equal(result.status, 'degraded');
    assert.deepEqual(result.checks.find(c => c.name === 'database'), { name: 'database', status: 'fail', reason: 'error' });
  });

  await test('DB check exceeds timeout -> status degraded, reason timeout', async () => {
    const result = await evaluateReadiness({
      checkDatabase: () => new Promise(resolve => setTimeout(resolve, 50)),
      timeoutMs: 5,
    });
    assert.equal(result.status, 'degraded');
    assert.deepEqual(result.checks.find(c => c.name === 'database'), { name: 'database', status: 'fail', reason: 'timeout' });
  });

  await test('DB failure never leaks the raw error message into the result', async () => {
    const secret = 'postgresql://crm_user:s3cr3t-password@10.0.0.5:5432/noramedi_crm';
    const result = await evaluateReadiness({ checkDatabase: async () => { throw new Error(secret); } });
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('s3cr3t-password'));
    assert.ok(!serialized.includes('10.0.0.5'));
  });

  section('evaluateReadiness — redis (optional, non-blocking)');

  await test('no checkRedis provided -> reported skipped/not_configured, status still ok', async () => {
    const result = await evaluateReadiness({ checkDatabase: async () => undefined });
    assert.deepEqual(result.checks.find(c => c.name === 'redis'), { name: 'redis', status: 'skipped', reason: 'not_configured' });
    assert.equal(result.status, 'ok');
  });

  await test('checkRedis succeeds -> reported ok', async () => {
    const result = await evaluateReadiness({ checkDatabase: async () => undefined, checkRedis: async () => 'PONG' });
    assert.deepEqual(result.checks.find(c => c.name === 'redis'), { name: 'redis', status: 'ok' });
  });

  await test('checkRedis fails -> reported fail, but overall status stays ok (Redis is not mandatory)', async () => {
    const result = await evaluateReadiness({
      checkDatabase: async () => undefined,
      checkRedis: async () => { throw new Error('redis connection refused'); },
    });
    assert.deepEqual(result.checks.find(c => c.name === 'redis'), { name: 'redis', status: 'fail', reason: 'error' });
    assert.equal(result.status, 'ok', 'a Redis failure must not flip overall readiness to degraded');
  });

  await test('DB down AND Redis down -> status degraded (DB alone drives the verdict)', async () => {
    const result = await evaluateReadiness({
      checkDatabase: async () => { throw new Error('db down'); },
      checkRedis: async () => { throw new Error('redis down'); },
    });
    assert.equal(result.status, 'degraded');
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
