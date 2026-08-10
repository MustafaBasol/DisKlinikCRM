/**
 * requestIdCorrelation.test.ts — F3-IMPL-001
 *
 * attachRequestIdHeader (middleware/requestId.ts) echoes pino-http's per
 * request req.id back to the client as X-Request-Id. Before this, the id
 * existed only inside server-side structured logs — a client/support agent
 * had no value to hand back that a log line could be found by. These tests
 * prove: (1) the header is present on every response, (2) it is generated
 * per request (not a static default id such as the `undefined` string
 * produced when req.id is missing at header-write time), and (3) two
 * concurrent requests get distinct ids.
 *
 * Exercises the real pino-http middleware + real attachRequestIdHeader wired
 * into a minimal live Express server (node:http client against
 * app.listen(0)), same technique as httpRequestLogPrivacy.test.ts.
 *
 * Run with: tsx src/tests/requestIdCorrelation.test.ts
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { Writable } from 'node:stream';
import express from 'express';
import pino from 'pino';
import { buildHttpLogger } from '../utils/logger.js';
import { attachRequestIdHeader } from '../middleware/requestId.js';

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

function buildTestApp(instance: pino.Logger) {
  const app = express();
  app.use(buildHttpLogger(instance));
  app.use(attachRequestIdHeader);
  app.get('/api/ping', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

async function withServer(fn: (port: number) => Promise<void>) {
  const stream = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  const instance = pino({ level: 'info', base: undefined }, stream);
  const app = buildTestApp(instance);
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

function issueRequest(port: number, path: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path }, res => {
      res.on('data', () => {});
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  section('attachRequestIdHeader');

  await withServer(async (port) => {
    await test('every response carries a non-empty X-Request-Id header', async () => {
      const { statusCode, headers } = await issueRequest(port, '/api/ping');
      assert.equal(statusCode, 200);
      assert.ok(headers['x-request-id'], 'expected an x-request-id response header');
      assert.notEqual(String(headers['x-request-id']), 'undefined');
    });

    await test('two separate requests get two distinct X-Request-Id values', async () => {
      const first = await issueRequest(port, '/api/ping');
      const second = await issueRequest(port, '/api/ping');
      assert.notEqual(first.headers['x-request-id'], second.headers['x-request-id']);
    });
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
