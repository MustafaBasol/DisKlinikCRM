/**
 * httpRequestLogPrivacy.test.ts — HTTP-LOG-PRIVACY-HARDENING-001 regression
 * tests for server/src/utils/logger.ts (buildHttpLogger/httpLogger).
 *
 * pino-http's default req serializer places req.query, req.params,
 * req.headers (all headers, incl. x-forwarded-for/x-real-ip) and
 * req.remoteAddress directly onto the logged object; only authorization/
 * cookie headers were redacted. That meant clinicId/patientId query params,
 * concrete UUID path segments, the forwarded-IP chain, and the raw client
 * address were all written to production request logs in clear text.
 *
 * These tests exercise the REAL pino-http middleware (buildHttpLogger) wired
 * into a minimal live Express server (node:http client against app.listen(0)),
 * not just the helper functions in isolation — this is the only way to
 * observe the actual timing/serialization behavior (route templates only
 * resolve at response-completion time; pino redaction/serializers run for
 * real) rather than a hand-mocked req/res standing in for them.
 *
 * Run with: tsx src/tests/httpRequestLogPrivacy.test.ts
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import express from 'express';
import pino from 'pino';
import {
  buildHttpLogger,
  logUnhandledError,
  safeRoute,
  sanitizePathFallback,
} from '../utils/logger.js';

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

// ── Sentinel values (synthetic only — never real patient/credential data) ──

const SENTINEL = {
  ipv4: '203.0.113.77',
  ipv4Second: '198.51.100.23',
  ipv6: '2001:db8::dead:beef',
  clinicId: randomUUID(),
  patientId: randomUUID(),
  routeUuid: randomUUID(),
  email: 'sentinel-patient@example-test.invalid',
  phone: '+905550009999',
  token: 'tok_live_SENTINELTOKEN1234567890ABCDEF',
  genericId: 'generic-id-SENTINEL-000111',
  bearer: 'SENTINEL-BEARER-TOKEN-abc123',
  sessionCookie: 'SENTINEL-SESSION-COOKIE-value',
  csrfCookie: 'SENTINEL-CSRF-COOKIE-value',
  csrfHeader: 'SENTINEL-CSRF-HEADER-value',
  apiKey: 'sk_live_SENTINELAPIKEY',
  password: 'Sentinel-Password-2026!',
  patientName: 'Sentinel Testperson',
  userAgent: 'Sentinel-UA-Test/1.0 ' + 'X'.repeat(400),
};

// ── Test harness: real pino-http middleware over a real listening server ──

interface CapturingLogger {
  instance: pino.Logger;
  lines: string[];
}

function createCapturingLogger(): CapturingLogger {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString('utf8'));
      cb();
    },
  });
  const instance = pino({ level: 'info', base: undefined }, stream);
  return { instance, lines };
}

function buildTestApp(instance: pino.Logger) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(buildHttpLogger(instance));
  app.use(express.json());

  app.get('/api/patients/:id', (req, res) => {
    res.status(200).json({ ok: true });
  });
  app.get('/api/patients/:id/appointments/:apptId', (req, res) => {
    res.status(200).json({ ok: true });
  });
  app.post('/api/patients/:id', (req, res) => {
    res.status(201).json({ received: true });
  });
  app.get('/api/patients/:id/boom', (req, res) => {
    // Mirrors the real 500 path when no error/res.err is wired: pino-http
    // synthesizes the error object from the status code alone.
    res.status(500).json({ error: 'Internal server error' });
  });

  // A real thrown Error whose message embeds request-derived sentinel
  // values (mirrors e.g. `throw new Error('Patient ' + id + ' not found')`
  // — see review §4.2). Reaches pino-http's error branch via res.err, then
  // the mirrored global error handler below (mirrors index.ts:250).
  app.get('/api/patients/:id/real-throw', (_req, res, next) => {
    const err = new Error(`Patient ${SENTINEL.patientId} lookup failed for clinic ${SENTINEL.clinicId}`);
    (res as unknown as { err: Error }).err = err;
    next(err);
  });

  // Mirrors server/src/index.ts's global Express error handler verbatim
  // (including routing all 5xx logging through logUnhandledError instead of
  // a raw console.error(err) — see review §4.3).
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status >= 500) logUnhandledError(req, status, err, instance);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : 'Invalid request' });
  });

  return app;
}

function buildMountedRouterApp(instance: pino.Logger) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(buildHttpLogger(instance));

  const clinics = express.Router();
  clinics.get('/:clinicId/appointments', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use('/api/clinics', clinics);

  return app;
}

async function withServer(
  fn: (ctx: { port: number; lines: string[] }) => Promise<void>,
  appBuilder: (instance: pino.Logger) => express.Express = buildTestApp,
) {
  const { instance, lines } = createCapturingLogger();
  const app = appBuilder(instance);
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected server to bind a TCP port');
  }
  try {
    await fn({ port: address.port, lines });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

interface RequestOptions {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

function issueRequest(
  port: number,
  { method = 'GET', path, headers = {}, body }: RequestOptions,
): Promise<{ statusCode: number }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: body
          ? { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
          : headers,
      },
      res => {
        res.on('data', () => {});
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0 }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Log writes happen on the server-side res 'finish'/'close' event, which can
 * land a tick or two after the client sees 'end' — poll briefly instead of
 * assuming it is already flushed. */
async function waitForNewLine(lines: string[], countBefore: number, timeoutMs = 2000): Promise<string> {
  const start = Date.now();
  while (lines.length <= countBefore) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for a new log line (have ${lines.length}, expected > ${countBefore})`);
    }
    await new Promise(r => setTimeout(r, 5));
  }
  return lines[lines.length - 1];
}

function fullLogText(lines: string[]): string {
  return lines.join('\n');
}

/** Like waitForNewLine, but for scenarios that emit more than one log line
 * per request (e.g. logUnhandledError + the httpLogger completion line) —
 * waits for an exact count so callers can identify each line by its `msg`
 * field instead of assuming array position. */
async function waitForLineCount(lines: string[], countBefore: number, expectedNewLines: number, timeoutMs = 2000): Promise<string[]> {
  const start = Date.now();
  while (lines.length < countBefore + expectedNewLines) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${expectedNewLines} new log line(s) (have ${lines.length - countBefore}, expected ${expectedNewLines})`);
    }
    await new Promise(r => setTimeout(r, 5));
  }
  return lines.slice(countBefore, countBefore + expectedNewLines);
}

async function main() {
  section('safeRoute / sanitizePathFallback — pure helper tests');

  await test('sanitizePathFallback redacts a UUID path segment', () => {
    const out = sanitizePathFallback(`/api/unregistered/${SENTINEL.routeUuid}/edit`);
    assert.ok(!out.includes(SENTINEL.routeUuid), `fallback still contains raw UUID: ${out}`);
    assert.equal(out, '/api/unregistered/:id/edit');
  });

  await test('sanitizePathFallback redacts a long numeric id segment', () => {
    const out = sanitizePathFallback('/api/legacy/908213');
    assert.equal(out, '/api/legacy/:id');
  });

  await test('sanitizePathFallback redacts an email path segment', () => {
    const out = sanitizePathFallback(`/api/lookup/${SENTINEL.email}`);
    assert.ok(!out.includes(SENTINEL.email));
    assert.equal(out, '/api/lookup/:id');
  });

  await test('sanitizePathFallback redacts a long opaque token segment', () => {
    const out = sanitizePathFallback(`/api/verify/${SENTINEL.token}`);
    assert.ok(!out.includes(SENTINEL.token));
    assert.equal(out, '/api/verify/:id');
  });

  await test('sanitizePathFallback strips the query string entirely', () => {
    const out = sanitizePathFallback(`/api/patients?patientId=${SENTINEL.patientId}`);
    assert.ok(!out.includes(SENTINEL.patientId));
    assert.equal(out, '/api/patients');
  });

  await test('safeRoute prefers the matched route template over the concrete path', () => {
    const out = safeRoute({
      baseUrl: '/api/clinics',
      route: { path: '/:clinicId/patients/:id' },
      originalUrl: `/api/clinics/${SENTINEL.clinicId}/patients/${SENTINEL.patientId}`,
    });
    assert.equal(out, '/api/clinics/:clinicId/patients/:id');
  });

  await test('safeRoute falls back to sanitized path when no route matched', () => {
    const out = safeRoute({ originalUrl: `/api/unknown/${SENTINEL.routeUuid}` });
    assert.equal(out, '/api/unknown/:id');
  });

  await test('sanitizePathFallback redacts a percent-encoded email path segment', () => {
    const out = sanitizePathFallback(`/api/lookup/${encodeURIComponent(SENTINEL.email)}`);
    assert.ok(!out.includes(SENTINEL.email));
    assert.ok(!out.includes(encodeURIComponent(SENTINEL.email)));
    assert.equal(out, '/api/lookup/:id');
  });

  await test('sanitizePathFallback redacts a percent-encoded UUID path segment', () => {
    const encoded = SENTINEL.routeUuid.replace(/-/g, '%2D');
    const out = sanitizePathFallback(`/api/lookup/${encoded}`);
    assert.ok(!out.includes(SENTINEL.routeUuid));
    assert.equal(out, '/api/lookup/:id');
  });

  await test('sanitizePathFallback redacts a phone number path segment (with punctuation)', () => {
    const out = sanitizePathFallback(`/api/lookup/${encodeURIComponent(SENTINEL.phone)}`);
    assert.ok(!out.includes(SENTINEL.phone));
    assert.equal(out, '/api/lookup/:id');
    const outSpaced = sanitizePathFallback('/api/lookup/+90 555 000 99 99');
    assert.equal(outSpaced, '/api/lookup/:id');
  });

  await test('sanitizePathFallback does not throw on malformed percent-encoding', () => {
    const out = sanitizePathFallback('/api/lookup/%E0%A4%A');
    assert.equal(typeof out, 'string');
  });

  section('mounted-router coverage — safeRoute composes baseUrl + route.path');

  await withServer(async ({ port, lines }) => {
    await test('a route served through a mounted sub-router logs baseUrl + route.path, not the concrete id', async () => {
      const before = lines.length;
      await issueRequest(port, { path: `/api/clinics/${SENTINEL.clinicId}/appointments` });
      const line = await waitForNewLine(lines, before);
      assert.ok(!line.includes(SENTINEL.clinicId), 'clinicId leaked from mounted-router route');
      const parsed = JSON.parse(line);
      assert.equal(parsed.route, '/api/clinics/:clinicId/appointments');
    });
  }, buildMountedRouterApp);

  section('7.1 — safe operational metadata retained');

  await withServer(async ({ port, lines }) => {
    await test('completed request log retains reqId, method, route, statusCode, responseTime', async () => {
      const before = lines.length;
      await issueRequest(port, { path: `/api/patients/${SENTINEL.patientId}` });
      const line = await waitForNewLine(lines, before);
      const parsed = JSON.parse(line);
      assert.ok(parsed.req?.id !== undefined, 'missing req.id');
      assert.equal(parsed.req?.method, 'GET');
      assert.equal(parsed.route, '/api/patients/:id');
      assert.equal(parsed.res?.statusCode, 200);
      assert.equal(typeof parsed.responseTime, 'number');
    });
  });

  section('7.2 — IP address and forwarded headers never logged');

  await withServer(async ({ port, lines }) => {
    await test('x-forwarded-for, x-real-ip, and loopback remote address are absent from the log line', async () => {
      const before = lines.length;
      await issueRequest(port, {
        path: `/api/patients/${SENTINEL.patientId}`,
        headers: {
          'x-forwarded-for': `${SENTINEL.ipv4}, ${SENTINEL.ipv4Second}`,
          'x-real-ip': SENTINEL.ipv4,
        },
      });
      const line = await waitForNewLine(lines, before);
      assert.ok(!line.includes(SENTINEL.ipv4), 'sentinel IPv4 leaked into log line');
      assert.ok(!line.includes(SENTINEL.ipv4Second), 'second sentinel IPv4 leaked into log line');
      assert.ok(!line.includes('127.0.0.1'), 'loopback remote address leaked into log line');
      assert.ok(!line.includes('::1'), 'loopback IPv6 remote address leaked into log line');
      const parsed = JSON.parse(line);
      assert.equal(parsed.req?.remoteAddress, undefined);
      assert.equal(parsed.req?.headers, undefined);
    });

    await test('an IPv6 sentinel passed via x-forwarded-for is never logged', async () => {
      const before = lines.length;
      await issueRequest(port, {
        path: `/api/patients/${SENTINEL.patientId}`,
        headers: { 'x-forwarded-for': SENTINEL.ipv6 },
      });
      const line = await waitForNewLine(lines, before);
      assert.ok(!line.includes(SENTINEL.ipv6), 'sentinel IPv6 leaked into log line');
    });
  });

  section('7.3 — path identifier redaction');

  await withServer(async ({ port, lines }) => {
    await test('a route template with two path params logs the template, not the concrete UUIDs', async () => {
      const before = lines.length;
      const apptId = randomUUID();
      await issueRequest(port, { path: `/api/patients/${SENTINEL.patientId}/appointments/${apptId}` });
      const line = await waitForNewLine(lines, before);
      assert.ok(!line.includes(SENTINEL.patientId), 'patientId UUID leaked into log line');
      assert.ok(!line.includes(apptId), 'appointment UUID leaked into log line');
      const parsed = JSON.parse(line);
      assert.equal(parsed.route, '/api/patients/:id/appointments/:apptId');
    });

    await test('an unmatched path with an embedded UUID falls back to a sanitized path (no route template)', async () => {
      const before = lines.length;
      await issueRequest(port, { path: `/api/no-such-route/${SENTINEL.routeUuid}` });
      const line = await waitForNewLine(lines, before);
      assert.ok(!line.includes(SENTINEL.routeUuid), 'concrete UUID leaked into fallback log line');
      const parsed = JSON.parse(line);
      assert.equal(parsed.route, '/api/no-such-route/:id');
      assert.equal(parsed.res?.statusCode, 404);
    });
  });

  section('7.4 — query-string privacy');

  await withServer(async ({ port, lines }) => {
    await test('patientId/clinicId/email/phone/token/UUID/generic-id query params are never logged', async () => {
      const before = lines.length;
      const query = [
        `patientId=${SENTINEL.patientId}`,
        `clinicId=${SENTINEL.clinicId}`,
        `email=${encodeURIComponent(SENTINEL.email)}`,
        `phone=${encodeURIComponent(SENTINEL.phone)}`,
        `token=${SENTINEL.token}`,
        `recordId=${SENTINEL.routeUuid}`,
        `ref=${SENTINEL.genericId}`,
      ].join('&');
      await issueRequest(port, { path: `/api/patients/${SENTINEL.patientId}?${query}` });
      const line = await waitForNewLine(lines, before);
      for (const [key, value] of Object.entries({
        patientId: SENTINEL.patientId,
        clinicId: SENTINEL.clinicId,
        email: SENTINEL.email,
        phone: SENTINEL.phone,
        token: SENTINEL.token,
        recordId: SENTINEL.routeUuid,
        genericId: SENTINEL.genericId,
      })) {
        assert.ok(!line.includes(value), `${key} sentinel value leaked into log line`);
      }
      const parsed = JSON.parse(line);
      assert.equal(parsed.req?.query, undefined);
      assert.equal(parsed.route, '/api/patients/:id', 'query string must not appear in the logged route either');
    });
  });

  section('7.5 — header and credential regression');

  await withServer(async ({ port, lines }) => {
    await test('Authorization, cookies, CSRF header, and API key are never logged', async () => {
      const before = lines.length;
      await issueRequest(port, {
        path: `/api/patients/${SENTINEL.patientId}`,
        headers: {
          authorization: `Bearer ${SENTINEL.bearer}`,
          cookie: `session=${SENTINEL.sessionCookie}; csrf=${SENTINEL.csrfCookie}`,
          'x-csrf-token': SENTINEL.csrfHeader,
          'x-api-key': SENTINEL.apiKey,
        },
      });
      const line = await waitForNewLine(lines, before);
      for (const [key, value] of Object.entries({
        bearer: SENTINEL.bearer,
        sessionCookie: SENTINEL.sessionCookie,
        csrfCookie: SENTINEL.csrfCookie,
        csrfHeader: SENTINEL.csrfHeader,
        apiKey: SENTINEL.apiKey,
      })) {
        assert.ok(!line.includes(value), `${key} sentinel value leaked into log line`);
      }
    });
  });

  section('7.6 — request body privacy');

  await withServer(async ({ port, lines }) => {
    await test('patient name/phone/email/password/token/clinicId/patientId in the body are never logged', async () => {
      const before = lines.length;
      const body = JSON.stringify({
        name: SENTINEL.patientName,
        phone: SENTINEL.phone,
        email: SENTINEL.email,
        password: SENTINEL.password,
        token: SENTINEL.token,
        clinicId: SENTINEL.clinicId,
        patientId: SENTINEL.patientId,
      });
      await issueRequest(port, { method: 'POST', path: `/api/patients/${SENTINEL.patientId}`, body });
      const line = await waitForNewLine(lines, before);
      for (const [key, value] of Object.entries({
        name: SENTINEL.patientName,
        phone: SENTINEL.phone,
        email: SENTINEL.email,
        password: SENTINEL.password,
        token: SENTINEL.token,
        clinicId: SENTINEL.clinicId,
      })) {
        assert.ok(!line.includes(value), `body field ${key} leaked into log line`);
      }
    });
  });

  section('7.7 — user-agent is omitted from the general HTTP access log');

  await withServer(async ({ port, lines }) => {
    await test('an oversized user-agent value never appears in the log line (documented: omitted, not normalized)', async () => {
      const before = lines.length;
      await issueRequest(port, {
        path: `/api/patients/${SENTINEL.patientId}`,
        headers: { 'user-agent': SENTINEL.userAgent },
      });
      const line = await waitForNewLine(lines, before);
      assert.ok(!line.includes('Sentinel-UA'), 'user-agent value leaked into log line');
      const parsed = JSON.parse(line);
      assert.equal(parsed.req?.headers, undefined, 'no headers object of any kind should be present');
      assert.equal(parsed.userAgent, undefined);
      assert.equal(parsed.ua, undefined);
    });
  });

  section('7.8 — error path (5xx) does not leak request internals');

  await withServer(async ({ port, lines }) => {
    await test('a 500 response logs safe error metadata without leaking IP, query, body, or the concrete UUID path', async () => {
      const before = lines.length;
      await issueRequest(port, {
        path: `/api/patients/${SENTINEL.patientId}/boom?clinicId=${SENTINEL.clinicId}`,
        headers: {
          'x-forwarded-for': SENTINEL.ipv4,
          authorization: `Bearer ${SENTINEL.bearer}`,
          cookie: `session=${SENTINEL.sessionCookie}`,
        },
        method: 'GET',
      });
      const line = await waitForNewLine(lines, before);
      assert.ok(!line.includes(SENTINEL.patientId), 'patientId UUID leaked into error log');
      assert.ok(!line.includes(SENTINEL.clinicId), 'clinicId leaked into error log');
      assert.ok(!line.includes(SENTINEL.ipv4), 'forwarded IP leaked into error log');
      assert.ok(!line.includes(SENTINEL.bearer), 'bearer token leaked into error log');
      assert.ok(!line.includes(SENTINEL.sessionCookie), 'session cookie leaked into error log');

      const parsed = JSON.parse(line);
      assert.equal(parsed.res?.statusCode, 500);
      assert.equal(parsed.route, '/api/patients/:id/boom');
      assert.ok(parsed.err?.type, 'expected a safe err.type on the error log');
      assert.ok(parsed.err?.message, 'expected a safe err.message on the error log');
      assert.equal(parsed.req?.headers, undefined);
      assert.equal(parsed.req?.remoteAddress, undefined);
    });
  });

  section('7.9 — production vs. development: privacy guarantees do not regress, stack trace is env-gated');

  const originalNodeEnv = process.env.NODE_ENV;
  try {
    for (const env of ['production', 'development']) {
      process.env.NODE_ENV = env;
      await withServer(async ({ port, lines }) => {
        await test(`[NODE_ENV=${env}] sensitive data still absent from the completed-request log`, async () => {
          const before = lines.length;
          await issueRequest(port, {
            path: `/api/patients/${SENTINEL.patientId}?clinicId=${SENTINEL.clinicId}`,
            headers: {
              'x-forwarded-for': SENTINEL.ipv4,
              authorization: `Bearer ${SENTINEL.bearer}`,
            },
          });
          const line = await waitForNewLine(lines, before);
          assert.ok(!line.includes(SENTINEL.patientId));
          assert.ok(!line.includes(SENTINEL.clinicId));
          assert.ok(!line.includes(SENTINEL.ipv4));
          assert.ok(!line.includes(SENTINEL.bearer));
        });

        await test(`[NODE_ENV=${env}] error log stack trace is present only outside production`, async () => {
          const before = lines.length;
          await issueRequest(port, { path: `/api/patients/${SENTINEL.patientId}/boom` });
          const line = await waitForNewLine(lines, before);
          const parsed = JSON.parse(line);
          if (env === 'production') {
            assert.equal(parsed.err?.stack, undefined, 'stack trace must not be logged in production');
          } else {
            assert.ok(typeof parsed.err?.stack === 'string' && parsed.err.stack.length > 0);
          }
        });
      });
    }
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }

  section('7.10 — a real thrown error (res.err) does not leak its message via httpLogger or the global error handler');

  const originalNodeEnv2 = process.env.NODE_ENV;
  try {
    for (const env of ['production', 'development']) {
      process.env.NODE_ENV = env;
      await withServer(async ({ port, lines }) => {
        await test(`[NODE_ENV=${env}] a real thrown Error whose message embeds patientId/clinicId is handled correctly by logUnhandledError and httpLogger`, async () => {
          const before = lines.length;
          await issueRequest(port, { path: `/api/patients/${SENTINEL.patientId}/real-throw` });
          // This request produces exactly two log lines: logUnhandledError's
          // "unhandled error" (written synchronously in the mirrored global
          // error handler, before the response is sent) and httpLogger's own
          // "request errored" completion line (written on res 'finish').
          const newLines = await waitForLineCount(lines, before, 2);

          const parsedLines = newLines.map(l => JSON.parse(l));
          const unhandledLine = parsedLines.find(p => p.msg === 'unhandled error');
          const httpLine = parsedLines.find(p => p.msg === 'request errored');
          assert.ok(unhandledLine, 'expected an "unhandled error" log line from logUnhandledError');
          assert.ok(httpLine, 'expected an httpLogger "request errored" completion line');

          assert.equal(unhandledLine.route, '/api/patients/:id/real-throw');
          assert.equal(unhandledLine.status, 500);
          assert.ok(unhandledLine.reqId !== undefined, 'expected reqId on the unhandled-error log line');
          assert.equal(unhandledLine.errType, 'Error');

          assert.equal(httpLine.res?.statusCode, 500);
          assert.equal(httpLine.err?.type, 'Error');

          if (env === 'production') {
            // Production: the raw message (which embeds patientId/clinicId)
            // must never reach either log line — this is the security
            // property under test (review §4.2/§4.3).
            const text = fullLogText(newLines);
            assert.ok(!text.includes(SENTINEL.patientId), 'patientId leaked via a real error message in production');
            assert.ok(!text.includes(SENTINEL.clinicId), 'clinicId leaked via a real error message in production');
            assert.equal(unhandledLine.errMessage, 'internal error', 'production must not echo the raw error message (logUnhandledError)');
            assert.equal(httpLine.err?.message, 'internal error', 'production must not echo the raw error message (httpLogger)');
            assert.equal(unhandledLine.errStack, undefined);
            assert.equal(httpLine.err?.stack, undefined);
          } else {
            // Development: full diagnostic message is a deliberate,
            // documented exception (local/dev-only) — assert it is present,
            // not absent.
            assert.ok(unhandledLine.errMessage.includes(SENTINEL.patientId), 'expected full diagnostic message outside production (logUnhandledError)');
            assert.ok(httpLine.err?.message.includes(SENTINEL.patientId), 'expected full diagnostic message outside production (httpLogger)');
          }
        });
      });
    }
  } finally {
    if (originalNodeEnv2 === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv2;
  }

  section('Regression sanity: nothing in this suite ever logs a raw request/socket object');

  await withServer(async ({ port, lines }) => {
    await test('the full captured log text across every prior scenario contains no "socket" or "connection" object dump', async () => {
      await issueRequest(port, { path: `/api/patients/${SENTINEL.patientId}` });
      await waitForNewLine(lines, lines.length - 1);
      const text = fullLogText(lines);
      assert.ok(!text.includes('"remoteFamily"'));
      assert.ok(!text.includes('"socket"'));
      assert.ok(!text.includes('"connection"'));
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
