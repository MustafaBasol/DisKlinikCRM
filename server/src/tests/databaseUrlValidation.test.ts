/**
 * databaseUrlValidation.test.ts — F3-IMPL-001
 *
 * getRequiredDatabaseUrl() (utils/databaseUrl.ts) replaces the previous
 * `process.env.DATABASE_URL!` non-null assertion in db.ts with an explicit,
 * PRODUCTION-ONLY fail-hard check (mirrors the existing ENCRYPTION_KEY
 * pattern in index.ts). Positive case: a configured value always passes
 * through unchanged. Negative case: missing/blank in production throws
 * immediately with a diagnostic message. Outside production, a missing value
 * is returned as-is (undefined) rather than thrown — this is intentional and
 * covered below: an unconditional throw was tried first and confirmed (by
 * running server:test:non-disposable, the "zero external infra" CI layer) to
 * crash dozens of unrelated tests that import db.ts only transitively and
 * never issue a real query.
 *
 * Pure function, no DB/network required.
 *
 * Run with: tsx src/tests/databaseUrlValidation.test.ts
 */

import assert from 'node:assert/strict';
import { getRequiredDatabaseUrl } from '../utils/databaseUrl.js';

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
  section('getRequiredDatabaseUrl — positive (every environment)');

  for (const nodeEnv of ['production', 'development', 'test', undefined]) {
    await test(`returns the configured value unchanged (NODE_ENV=${nodeEnv ?? '(unset)'})`, () => {
      const value = getRequiredDatabaseUrl({
        DATABASE_URL: 'postgresql://user:pass@db.internal:5432/noramedi',
        NODE_ENV: nodeEnv,
      } as unknown as NodeJS.ProcessEnv);
      assert.equal(value, 'postgresql://user:pass@db.internal:5432/noramedi');
    });
  }

  await test('trims surrounding whitespace', () => {
    const value = getRequiredDatabaseUrl({
      DATABASE_URL: '  postgresql://localhost:5432/dev  ',
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(value, 'postgresql://localhost:5432/dev');
  });

  section('getRequiredDatabaseUrl — negative, production only (fail-hard)');

  await test('throws when DATABASE_URL is unset in production', () => {
    assert.throws(
      () => getRequiredDatabaseUrl({ NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv),
      /DATABASE_URL is not set/,
    );
  });

  await test('throws when DATABASE_URL is an empty string in production', () => {
    assert.throws(
      () => getRequiredDatabaseUrl({ DATABASE_URL: '', NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv),
      /DATABASE_URL is not set/,
    );
  });

  await test('throws when DATABASE_URL is whitespace-only in production', () => {
    assert.throws(
      () => getRequiredDatabaseUrl({ DATABASE_URL: '   ', NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv),
      /DATABASE_URL is not set/,
    );
  });

  section('getRequiredDatabaseUrl — negative, non-production (preserve prior behavior, no throw)');

  for (const nodeEnv of ['development', 'test', undefined]) {
    await test(`does NOT throw when DATABASE_URL is unset (NODE_ENV=${nodeEnv ?? '(unset)'}) — returns it as-is`, () => {
      const value = getRequiredDatabaseUrl({ NODE_ENV: nodeEnv } as unknown as NodeJS.ProcessEnv);
      assert.equal(value, undefined);
    });
  }

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
