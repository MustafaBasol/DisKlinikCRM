import assert from 'node:assert/strict';
import { csrfProtection } from '../middleware/csrf.js';
import { getBearerFallbackWarnings, isBearerFallbackEnabled } from '../utils/authFallback.js';
import {
  createCsrfToken,
  getCsrfCookieName,
  getSessionCookieDeploymentWarnings,
  isCsrfSecretConfigured,
  SESSION_MAX_AGE_MS,
  type SessionType,
  verifyCsrfToken,
} from '../utils/sessionCookies.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  OK ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  FAIL ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function makeReq(options: {
  method?: string;
  originalUrl?: string;
  type?: SessionType;
  authSource?: 'cookie' | 'bearer';
  sessionId?: string;
  headerToken?: string;
  cookieToken?: string;
  origin?: string;
}) {
  const {
    method = 'POST',
    originalUrl = '/api/patients',
    type = 'clinic',
    authSource = 'cookie',
    sessionId,
    headerToken,
    cookieToken,
    origin,
  } = options;

  const cookieName = getCsrfCookieName(type);
  const headers: Record<string, string> = {};
  if (cookieToken) headers.cookie = `${cookieName}=${encodeURIComponent(cookieToken)}`;
  if (headerToken) headers['x-csrf-token'] = headerToken;
  if (origin) headers.origin = origin;

  const req: any = {
    method,
    originalUrl,
    path: originalUrl,
    headers,
    authSource,
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  };

  if (type === 'clinic') req.user = { sessionId };
  else req.platformAdmin = { sessionId };

  return req;
}

function makeRes() {
  return {
    _status: 200,
    _body: undefined as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  };
}

async function runMiddleware(req: any, type: SessionType) {
  const res = makeRes();
  let nextCalled = false;
  await (csrfProtection(type) as any)(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

async function withEnv(updates: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const previous = Object.fromEntries(
    Object.keys(updates).map((key) => [key, process.env[key]]),
  ) as Record<string, string | undefined>;

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

console.log('\nsessionCookieCsrf.test.ts');

await test('safe methods skip CSRF', async () => {
  const { res, nextCalled } = await runMiddleware(makeReq({ method: 'GET' }), 'clinic');
  assert.equal(nextCalled, true);
  assert.equal(res._status, 200);
});

await test('public webhook paths skip CSRF', async () => {
  const { res, nextCalled } = await runMiddleware(
    makeReq({ originalUrl: '/api/public/whatsapp/evolution-webhook' }),
    'clinic',
  );
  assert.equal(nextCalled, true);
  assert.equal(res._status, 200);
});

await test('Bearer fallback skips CSRF during migration', async () => {
  const { res, nextCalled } = await runMiddleware(makeReq({ authSource: 'bearer' }), 'clinic');
  assert.equal(nextCalled, true);
  assert.equal(res._status, 200);
});

await test('cookie-authenticated unsafe request requires CSRF', async () => {
  const { res, nextCalled } = await runMiddleware(makeReq({ sessionId: 'session-1' }), 'clinic');
  assert.equal(nextCalled, false);
  assert.equal(res._status, 403);
});

await test('clinic CSRF token must be signed and session-bound', async () => {
  const token = createCsrfToken('clinic', 'session-1');
  const { res, nextCalled } = await runMiddleware(
    makeReq({ sessionId: 'session-1', headerToken: token, cookieToken: token }),
    'clinic',
  );
  assert.equal(nextCalled, true);
  assert.equal(res._status, 200);
});

await test('CSRF token is rejected after session max age', async () => {
  const token = createCsrfToken('clinic', 'session-1', Date.now() - SESSION_MAX_AGE_MS - 1);
  assert.equal(verifyCsrfToken(token, 'clinic', 'session-1'), false);
});

await test('CSRF token with excessive future iat is rejected', async () => {
  const token = createCsrfToken('clinic', 'session-1', Date.now() + 10 * 60 * 1000);
  assert.equal(verifyCsrfToken(token, 'clinic', 'session-1'), false);
});

await test('mismatched CSRF cookie/header is rejected', async () => {
  const headerToken = createCsrfToken('clinic', 'session-1');
  const cookieToken = createCsrfToken('clinic', 'session-2');
  const { res, nextCalled } = await runMiddleware(
    makeReq({ sessionId: 'session-1', headerToken, cookieToken }),
    'clinic',
  );
  assert.equal(nextCalled, false);
  assert.equal(res._status, 403);
});

await test('platform CSRF token is isolated from clinic token', async () => {
  const token = createCsrfToken('clinic', 'platform-session');
  const { res, nextCalled } = await runMiddleware(
    makeReq({
      type: 'platform',
      sessionId: 'platform-session',
      headerToken: token,
      cookieToken: token,
    }),
    'platform',
  );
  assert.equal(nextCalled, false);
  assert.equal(res._status, 403);
});

await test('production warns when CSRF_SECRET is missing or weak', async () => {
  await withEnv({ NODE_ENV: 'production', CSRF_SECRET: undefined }, () => {
    assert.equal(isCsrfSecretConfigured(), false);
    assert.ok(
      getSessionCookieDeploymentWarnings().some((warning) => warning.includes('CSRF_SECRET')),
    );
  });
});

await test('production accepts a strong explicit CSRF_SECRET', async () => {
  await withEnv({ NODE_ENV: 'production', CSRF_SECRET: 'a'.repeat(32) }, () => {
    assert.equal(isCsrfSecretConfigured(), true);
    assert.equal(
      getSessionCookieDeploymentWarnings().some((warning) => warning.includes('CSRF_SECRET')),
      false,
    );
  });
});

await test('cookie domain warnings catch URL-style domains', async () => {
  await withEnv({ SESSION_COOKIE_DOMAIN: 'https://example.com' }, () => {
    assert.ok(
      getSessionCookieDeploymentWarnings().some((warning) => warning.includes('bare domain')),
    );
  });
});

await test('Bearer fallback defaults to enabled during migration', async () => {
  await withEnv({
    AUTH_BEARER_FALLBACK_ENABLED: undefined,
    CLINIC_BEARER_FALLBACK_ENABLED: undefined,
    PLATFORM_BEARER_FALLBACK_ENABLED: undefined,
  }, () => {
    assert.equal(isBearerFallbackEnabled('clinic'), true);
    assert.equal(isBearerFallbackEnabled('platform'), true);
  });
});

await test('Bearer fallback can be disabled globally or per auth surface', async () => {
  await withEnv({ AUTH_BEARER_FALLBACK_ENABLED: 'false' }, () => {
    assert.equal(isBearerFallbackEnabled('clinic'), false);
    assert.equal(isBearerFallbackEnabled('platform'), false);
  });

  await withEnv({
    AUTH_BEARER_FALLBACK_ENABLED: 'true',
    PLATFORM_BEARER_FALLBACK_ENABLED: 'false',
  }, () => {
    assert.equal(isBearerFallbackEnabled('clinic'), true);
    assert.equal(isBearerFallbackEnabled('platform'), false);
  });
});

await test('production warns while Bearer fallback is enabled', async () => {
  await withEnv({
    NODE_ENV: 'production',
    AUTH_BEARER_FALLBACK_ENABLED: 'true',
    CLINIC_BEARER_FALLBACK_ENABLED: undefined,
    PLATFORM_BEARER_FALLBACK_ENABLED: undefined,
  }, () => {
    const warnings = getBearerFallbackWarnings();
    assert.ok(warnings.some((warning) => warning.includes('Clinic Bearer auth fallback')));
    assert.ok(warnings.some((warning) => warning.includes('Platform Bearer auth fallback')));
  });
});

console.log(`\nTotal: ${passed + failed}  OK ${passed}  FAIL ${failed}`);
if (failed > 0) {
  process.exit(1);
}
