/**
 * fatalErrorHandlers.test.ts — F3-OBS-001
 *
 * handleFatalError() (utils/fatalErrorHandlers.ts) is exercised directly
 * (not by actually raising a real process-level uncaughtException/
 * unhandledRejection, which would kill the test runner). Proves: (1) it
 * always calls the injected `exit(1)`, (2) it logs through the same
 * production-safe redaction policy as the rest of the codebase
 * (safeErrorLog / logUnhandledError's own contract) — full message+stack
 * outside production, `error.name` + a fixed message in production, never
 * the raw message, (3) both 'uncaughtException' and 'unhandledRejection'
 * kinds are handled, (4) a non-Error rejection reason (e.g. a thrown
 * string) does not crash the handler itself.
 *
 * Run with: tsx src/tests/fatalErrorHandlers.test.ts
 */

import assert from 'node:assert/strict';
import pino from 'pino';
import { Writable } from 'node:stream';
import { handleFatalError } from '../utils/fatalErrorHandlers.js';

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

function capturingLogger(): { logger: pino.Logger; lines: () => unknown[] } {
  const records: unknown[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      records.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  const logger = pino({ level: 'fatal', base: undefined }, stream);
  return { logger, lines: () => records };
}

async function main() {
  section('handleFatalError');

  await test('logs a fatal line and calls exit(1) on uncaughtException', () => {
    const { logger, lines } = capturingLogger();
    let exitCode: number | undefined;
    handleFatalError('uncaughtException', new Error('disk full'), {
      processLabel: 'api',
      logger,
      exit: (code) => { exitCode = code; },
    });
    assert.equal(exitCode, 1);
    assert.equal(lines().length, 1);
    const line = lines()[0] as Record<string, unknown>;
    assert.equal(line.kind, 'uncaughtException');
    assert.equal(line.processLabel, 'api');
    assert.equal(line.errType, 'Error');
  });

  await test('logs a fatal line and calls exit(1) on unhandledRejection', () => {
    const { logger, lines } = capturingLogger();
    let exitCode: number | undefined;
    handleFatalError('unhandledRejection', new Error('queue overflow'), {
      processLabel: 'worker',
      logger,
      exit: (code) => { exitCode = code; },
    });
    assert.equal(exitCode, 1);
    const line = lines()[0] as Record<string, unknown>;
    assert.equal(line.kind, 'unhandledRejection');
    assert.equal(line.processLabel, 'worker');
  });

  await test('a non-Error rejection reason (thrown string) does not throw and still exits(1)', () => {
    const { logger } = capturingLogger();
    let exitCode: number | undefined;
    assert.doesNotThrow(() => {
      handleFatalError('unhandledRejection', 'plain string rejection reason', {
        processLabel: 'worker',
        logger,
        exit: (code) => { exitCode = code; },
      });
    });
    assert.equal(exitCode, 1);
  });

  await test('production: the logged message is the fixed sanitized string, never the raw error message', () => {
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { logger, lines } = capturingLogger();
      handleFatalError('uncaughtException', new Error('DATABASE_URL=postgresql://user:s3cr3t@host/db'), {
        processLabel: 'api',
        logger,
        exit: () => {},
      });
      const line = lines()[0] as Record<string, unknown>;
      assert.equal(line.errMessage, 'internal error');
      assert.equal(line.errStack, undefined);
      assert.ok(!JSON.stringify(line).includes('s3cr3t'));
    } finally {
      process.env.NODE_ENV = previousEnv;
    }
  });

  await test('non-production: the full message is logged (diagnostic value), still no exit-code surprise', () => {
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const { logger, lines } = capturingLogger();
      let exitCode: number | undefined;
      handleFatalError('uncaughtException', new Error('helpful diagnostic detail'), {
        processLabel: 'api',
        logger,
        exit: (code) => { exitCode = code; },
      });
      const line = lines()[0] as Record<string, unknown>;
      assert.equal(line.errMessage, 'helpful diagnostic detail');
      assert.equal(exitCode, 1);
    } finally {
      process.env.NODE_ENV = previousEnv;
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
