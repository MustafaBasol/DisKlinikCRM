/**
 * healthRoutes.test.ts — F3-OBS-001
 *
 * buildHealthRouter() (routes/health.ts) exposes GET /livez and GET /readyz.
 * These tests exercise the real router mounted on a live Express server
 * (node:http client against app.listen(0)) — same technique as
 * requestIdCorrelation.test.ts / httpRequestLogPrivacy.test.ts — with
 * injected fake dependency-check functions so no real Postgres/Redis is
 * required. Proves: (1) /livez never checks dependencies and always
 * answers 200 even when the DB check would fail, (2) /readyz reflects
 * evaluateReadiness()'s verdict as the correct HTTP status, (3) process
 * role is reported, (4) the response never contains a connection string or
 * raw exception text — only the fixed reason-code vocabulary.
 *
 * `GET /api/health` itself is NOT exercised here — it stays inline in
 * index.ts, unmodified (see routes/health.ts's docstring); index.ts cannot
 * be imported directly by a test (it calls `app.listen()` at module load).
 *
 * Run with: tsx src/tests/healthRoutes.test.ts
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { buildHealthRouter } from '../routes/health.js';

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

function buildTestApp(options: Parameters<typeof buildHealthRouter>[0]) {
  const app = express();
  app.use('/api', buildHealthRouter(options));
  return app;
}

async function withServer(options: Parameters<typeof buildHealthRouter>[0], fn: (port: number) => Promise<void>) {
  const app = buildTestApp(options);
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected server to bind a TCP port');
  }
  try {
    await fn(address.port);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

function issueRequest(port: number, path: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  section('GET /api/livez');

  await withServer(
    { processRole: 'api', checkDatabase: async () => { throw new Error('db is down'); } },
    async (port) => {
      await test('always 200, never checks dependencies (DB check would throw)', async () => {
        const { statusCode, body } = await issueRequest(port, '/api/livez');
        assert.equal(statusCode, 200);
        const json = JSON.parse(body);
        assert.equal(json.status, 'ok');
      });

      await test('reports the process role, no other fields', async () => {
        const { body } = await issueRequest(port, '/api/livez');
        const json = JSON.parse(body);
        assert.equal(json.role, 'api');
        assert.deepEqual(Object.keys(json).sort(), ['role', 'status']);
      });
    },
  );

  section('GET /api/readyz — dependencies healthy');

  await withServer(
    { processRole: 'worker', checkDatabase: async () => undefined },
    async (port) => {
      await test('200 when the database check succeeds', async () => {
        const { statusCode, body } = await issueRequest(port, '/api/readyz');
        assert.equal(statusCode, 200);
        const json = JSON.parse(body);
        assert.equal(json.status, 'ok');
        assert.equal(json.role, 'worker');
      });

      await test('reports a database check entry with status ok', async () => {
        const { body } = await issueRequest(port, '/api/readyz');
        const json = JSON.parse(body);
        const dbCheck = json.checks.find((c: { name: string }) => c.name === 'database');
        assert.deepEqual(dbCheck, { name: 'database', status: 'ok' });
      });
    },
  );

  section('GET /api/readyz — database unavailable (negative / dependency-unavailable behavior)');

  await withServer(
    { processRole: 'api', checkDatabase: async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'); } },
    async (port) => {
      await test('503 when the database check fails', async () => {
        const { statusCode, body } = await issueRequest(port, '/api/readyz');
        assert.equal(statusCode, 503);
        const json = JSON.parse(body);
        assert.equal(json.status, 'degraded');
      });

      await test('never leaks the raw driver error / connection string / credentials', async () => {
        const { body } = await issueRequest(port, '/api/readyz');
        assert.ok(!body.includes('hunter2'));
        assert.ok(!body.includes('10.0.0.5'));
        assert.ok(!body.includes('ECONNREFUSED'));
        const json = JSON.parse(body);
        const dbCheck = json.checks.find((c: { name: string }) => c.name === 'database');
        assert.equal(dbCheck.status, 'fail');
        assert.equal(dbCheck.reason, 'error');
      });
    },
  );

  section('GET /api/readyz — Redis configured and unreachable does not fail readiness');

  await withServer(
    {
      processRole: 'api',
      checkDatabase: async () => undefined,
      checkRedis: async () => { throw new Error('redis ECONNREFUSED'); },
    },
    async (port) => {
      await test('200 (Redis is optional; DB is the only mandatory dependency)', async () => {
        const { statusCode, body } = await issueRequest(port, '/api/readyz');
        assert.equal(statusCode, 200);
        const json = JSON.parse(body);
        assert.equal(json.status, 'ok');
        const redisCheck = json.checks.find((c: { name: string }) => c.name === 'redis');
        assert.equal(redisCheck.status, 'fail');
      });
    },
  );

  section('Summary');
  console.log('\n─────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
