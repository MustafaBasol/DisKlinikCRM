# HTTP-LOG-PRIVACY-HARDENING-001 — HTTP Request Log Privacy Hardening

Task: HTTP-LOG-PRIVACY-HARDENING-001
Baseline: `origin/main @ cadc0784def237179f1af49de6f75a2ac9f2e969`
Branch: `fix/http-log-privacy-hardening-001`
Status: **CLOSED_VERIFIED** (2026-07-28 — see §12; implementation/review history in §1–§11 below is preserved unchanged)

---

## 1. Scope

Close the confirmed KVKK/privacy blocker in production-reachable HTTP request
logging (`server/src/utils/logger.ts`, wired via `app.use(httpLogger)` in
`server/src/index.ts`). No other KVKK finding, infra, retention, DPA, breach,
or architecture work is touched.

---

## 2. Investigation — actual logging call path

- Logger instance: `server/src/utils/logger.ts` exports `logger` (base pino
  instance, used for non-HTTP app logging elsewhere) and `httpLogger`
  (`pino-http`, `pinoHttp(...)`), mounted at `server/src/index.ts:138` via
  `app.use(httpLogger)`, **before** any router is mounted.
- Mechanism: `pino-http` v11, not custom middleware.
- **Confirmed root cause (deeper than the preliminary hypothesis):** the old
  `req` serializer (`req => { req.url = maskUrl(req.url); return req; }`) did
  **not** receive the raw Node `IncomingMessage`. Because `wrapSerializers`
  defaults to `true`, pino-http first runs pino-std-serializers'
  `reqSerializer`, which builds `{ id, method, url, query, params, headers,
  remoteAddress, remotePort, raw }`, and hands *that* object to the custom
  serializer. The old code mutated only `.url` and returned the rest
  untouched — so **`req.query`, `req.params`, `req.headers` (all headers,
  including `x-forwarded-for`/`x-real-ip`), and `req.remoteAddress`/
  `req.remotePort` were all written to every request log line**, in clear
  text. Only `req.headers.authorization` and `req.headers.cookie` were
  redacted; everything else (forwarded IP chain, `patientId`/`clinicId`/email/
  phone/token query params, route params) was fully exposed. This is a
  materially larger exposure than "the serializer may return the raw request
  object" — it returned a fully populated, mostly unredacted request digest.
- `res` serializer: default (`statusCode`, `headers` — including any
  `set-cookie`, redacted via the existing `res.headers["set-cookie"]` path).
- `err` serializer: default (`pino-std-serializers`' `errSerializer`), which
  copies all own-enumerable properties of the `Error` onto the log object —
  a latent risk if any error object anywhere ever carries request/PII data as
  a custom property.
- **Route template timing:** `pino-http` binds the (serialized) `req` object
  to a child logger the moment its middleware runs (`logger.child({req})` in
  `pino-http/logger.js`), i.e. at request start — **before** Express has
  matched a route. `req.route`/`req.baseUrl` are therefore never available to
  a `req` serializer. They **are** available at response-completion time
  (`res` `finish`/`close`), which is when `pino-http`'s `customSuccessObject`/
  `customErrorObject` hooks run. This is why the fix computes the route
  template in those hooks, not in the `req` serializer.
- No separate "request received" log line exists (`autoLogging` is on but
  `customReceivedObject`/`customReceivedMessage` were never configured) — only
  one line per request, at completion or error.
- `res.err` is never set anywhere in the codebase; the only realistic 5xx
  error path is `customLogLevel`'s `res.statusCode >= 500` branch, which
  synthesizes `new Error('failed with status code <n>')` — matches the app's
  actual global error handler (`index.ts:250`), which logs via
  `console.error('[unhandled-error]', err)` directly and does **not** go
  through `httpLogger` — out of scope, untouched.
- `trust proxy` (`index.ts:129`) is required for correct IP-keyed rate
  limiting behind the reverse proxy and was **not** changed; the fix instead
  ensures the logger never emits `req.ip`, `req.ips`, or any forwarded-header
  value regardless of the trust-proxy setting.
- No other module imports the old `maskUrl` export (removed) or the `req`/
  `res`/`err` serializer internals; `logger` (the base pino instance used by
  `reminders.ts`, `whatsappOutboundMessaging.ts`, `postTreatmentMessaging.ts`)
  is unchanged.

---

## 3. Remediation

`server/src/utils/logger.ts` rewritten with a structured allowlist,
defense-in-depth design:

1. **Safe serializers** (`wrapSerializers: false`, so these receive the raw
   objects directly): `req` → `{ id, method }` only; `res` → `{ statusCode }`
   only; `err` → `{ type, message, stack? }` (stack only outside
   `NODE_ENV=production`), discarding any other own-enumerable error
   properties.
2. **Route template computed at completion, not at request start** —
   `safeRoute()` is invoked from `customSuccessObject`/`customErrorObject` and
   prefers `req.baseUrl + req.route.path` (covers mounted routers); falls back
   to `sanitizePathFallback()` when no route matched (404s, pre-route
   failures).
3. **`sanitizePathFallback()`** — strips the query string/fragment, then
   replaces any path segment that looks like a UUID, a 4+ digit numeric id, an
   email address, or a 20+ char opaque token with `:id`. Segments that don't
   match are left intact (no blanket segment destruction).
4. **Query strings are never logged at all** — omitted entirely rather than
   filtered by an expanding denylist; `req.query` is not part of the safe
   serializer output.
5. **Pino `redact.paths`** kept and expanded as defense-in-depth (authorization/
   cookie/set-cookie in both cases, `x-forwarded-for`, `x-real-ip`,
   `x-csrf-token`, `x-api-key`, `req.remoteAddress`, `req.remotePort`,
   `req.query`, `req.params`) — inert today since the serializers never emit
   those fields, but a second layer if a future change reintroduces them.
6. **User-agent: omitted, not retained.** The generic HTTP access log never
   had a genuine operational need for it (already captured, where actually
   needed, by `auditLog.ts`/`securitySignalService.ts` for security-signal
   purposes); the simplest and safest choice was to drop it from this log
   entirely rather than add a bounding/normalization layer for a field with no
   confirmed consumer here.
7. Request/response body logging: unchanged — was never enabled by the
   generic HTTP middleware, and remains that way.
8. `index.ts` is unmodified — `httpLogger`'s export shape and
   `app.use(httpLogger)` call site are unchanged; `trust proxy` is unmodified.

---

## 4. Files changed

- `server/src/utils/logger.ts` — rewritten (safe serializers, route-template
  helper, path sanitizer, expanded redaction). `maskUrl`/`SENSITIVE_QUERY_PARAMS`
  removed (superseded — query strings are no longer logged at all).
- `server/src/tests/httpRequestLogPrivacy.test.ts` — new, 22 assertions.
- `server/package.json` — registered `test:http-log-privacy`, appended to the
  aggregate `test` script.
- `docs/program/evidence/HTTP_LOG_PRIVACY_HARDENING_001.md` — this document.

---

## 5. Sensitive data now excluded from HTTP request logs

Full client IP, `x-real-ip`, `x-forwarded-for`, all request headers (incl.
authorization/cookies/CSRF/API keys), `req.query`, `req.params`, request body,
concrete UUIDs/record identifiers in the URL, raw `req`/`res`/socket/connection
objects, and user-agent.

## 6. Operational metadata retained

Request id, HTTP method, resolved route template (or sanitized fallback path),
response status code, response time (ms).

---

## 7. Automated tests run

```
cd server
npx tsc --noEmit                          # via: npm run typecheck (prisma generate && tsc --noEmit)
npx tsx src/tests/httpRequestLogPrivacy.test.ts
npm run test:http-log-privacy
git diff --check
```

**Results:**

- `npm run typecheck` → clean (no errors in `logger.ts`, the new test file, or
  any of its three other consumers; pre-existing unrelated errors in
  unrelated files were not introduced by this change and were not present
  before Prisma-client generation completed).
- `npx tsx src/tests/httpRequestLogPrivacy.test.ts` → **22 passed, 0 failed**
  (pure-function `safeRoute`/`sanitizePathFallback` cases, plus a real
  `express` + real `pino-http` + real `node:http` client integration harness
  covering §7.1–§7.9 of the task spec: safe metadata retained; IPv4/IPv6/
  forwarded-header omission; route-template vs. UUID-path redaction; query
  string privacy; auth/cookie/CSRF/API-key regression; body privacy;
  user-agent omission; 5xx error-path leak check; production vs. development
  parity plus stack-trace env-gating).
- `git diff --check` → no whitespace errors (one benign CRLF-normalization
  warning from Git, not a diff-check failure).
- Full repo-wide `npm test` (≈80 scripts, most requiring a live disposable
  Postgres) was **not** run: this change touches only `logger.ts`, which has
  exactly three other consumers (`reminders.ts`, `whatsappOutboundMessaging.ts`,
  `postTreatmentMessaging.ts`), all of which use the unmodified `logger`
  export (not `httpLogger`) and are covered by the typecheck above. No
  existing test file imported `httpLogger` or the removed `maskUrl` export
  (confirmed via repo-wide grep) prior to this change, so there is no broader
  suite whose outcome this change could plausibly affect.

---

## 8. Manual synthetic log-output verification

A throwaway script (`server/manual-log-verify.mts`, deleted after use — not
part of this PR) started `buildHttpLogger()` on a real Express app on an
ephemeral port and issued two requests with synthetic sentinel values (fresh
random UUIDs for `patientId`/`clinicId`, RFC 5737/3849 documentation-range
IPs, synthetic tokens/cookies/bearer values — no real patient data or
credentials).

Emitted log lines (production run, `NODE_ENV=production`):

```json
{"level":30,"time":1785056585234,"req":{"id":1,"method":"GET"},"res":{"statusCode":200},"responseTime":8,"route":"/api/patients/:id","msg":"request completed"}
{"level":50,"time":1785056585246,"req":{"id":2,"method":"GET"},"res":{"statusCode":500},"err":{"type":"Error","message":"failed with status code 500"},"responseTime":1,"route":"/api/patients/:id/boom","msg":"request errored"}
```

Grep of the full raw output for every sentinel value used (both sentinel
UUIDs, both sentinel IPs, the bearer token, session cookie, CSRF cookie,
token-like query value, sentinel email, sentinel user-agent) — **all
confirmed absent**. Safe fields confirmed present: `req.id`, `req.method`,
`route` (resolved template, not the concrete UUID path), `res.statusCode`,
`responseTime`. Confirmed stack trace present under a non-production run and
absent under `NODE_ENV=production` (shown above).

---

## 9. Known limitations / follow-up

- This fix hardens the generic HTTP request-log path only. It does not audit
  or change any application-level `logger.info/warn/error(...)` call sites
  elsewhere in the codebase (e.g. `reminders.ts`, `whatsappOutboundMessaging.ts`)
  — those were out of scope per the task brief and were not found to route
  through `httpLogger`.
- `index.ts`'s global Express error handler logs unhandled 5xx errors via
  `console.error('[unhandled-error]', err)`, not through `httpLogger` — this
  is a pre-existing, separate logging path, unmodified, and outside this
  task's scope.
- Full repo-wide `npm test` was not executed (see §7) — the affected module's
  blast radius was independently confirmed to be limited to the three files
  listed above, all unaffected by this change.
- No production log volumes were inspected. Production verification is
  explicitly out of scope for this task.

**Status remains `IMPLEMENTED_NOT_PRODUCTION_VERIFIED`.** [Superseded 2026-07-28 — see §12: production deployment and log-privacy verification now close this task as `CLOSED_VERIFIED`. This §9 text is preserved unchanged as the historical record at merge time.]

---

## 10. Independent review addendum (post-merge-request review)

An independent review of this PR (fresh worktree at PR head
`487ffa45791a10e0bf492a74c479507eb1382a9b`) found that §2/§9's characterization
of `index.ts`'s global error handler as "out of scope, untouched" understated
the risk: the handler is directly on the production-reachable HTTP
request-error path this task set out to close, and it logged the **raw,
unsanitized** `err` object via `console.error('[unhandled-error]', err)` for
every 5xx response — including thrown/rejected application errors whose
`.message` can embed request-derived identifiers (e.g. `` `Patient ${id} not
found` ``). Synthetic reproduction (sentinel patient/clinic UUIDs, email,
bearer token, session cookie, in both `NODE_ENV=production` and
`development`, via a real thrown sync error, a rejected async handler, and an
explicit `res.err` assignment) confirmed every sentinel value reached
`console.error`'s captured output in both environments. Separately,
`safeErrorLog()`'s `message` field was unrestricted in production; wiring
`res.err` anywhere (the standard pino-http mechanism, and the natural fix for
the first issue) would have leaked the same content straight into the
structured pino log instead.

**Fixes applied** (`server/src/utils/logger.ts`, `server/src/index.ts`):

1. `safeErrorLog()` now returns a fixed, content-free `message` ("internal
   error") and omits `stack` when `NODE_ENV === 'production'`, instead of
   echoing `error.message` unconditionally. `error.name` (type) is still
   logged in all environments; full message/stack are retained outside
   production for diagnostics.
2. New exported `logUnhandledError(req, status, err, instance?)` — the single
   safe logging entry point for `index.ts`'s global error handler. Logs
   `reqId`, `route` (via `safeRoute`), `status`, and the same sanitized
   `errType`/`errMessage`/`errStack` shape as `safeErrorLog`, through the
   structured pino `logger`, never a raw `console.error(err)`. (Flat field
   names, not `err`, deliberately avoid colliding with pino's own
   default-registered `err` serializer on a plain, already-sanitized object.)
3. `index.ts`'s global error handler now calls `logUnhandledError(req, status,
   err)` in place of `console.error('[unhandled-error]', err)`.
4. `sanitizePathFallback()`'s identifier detection now also tests the
   percent-decoded form of each path segment (guarded against malformed
   encoding) and recognizes punctuated phone-number segments (`+90 555 000 99
   99`, `+905550009999`), closing two confirmed bypasses of the fallback
   sanitizer (percent-encoded UUIDs/emails; phone numbers) that previously
   let those identifiers through un-redacted on unmatched (404 / pre-route)
   paths.

**Residual, documented (not fixed in this pass):** the fallback sanitizer
still does not redact short numeric path segments (<4 digits, e.g. `/42`) or
free-text name-like slugs (e.g. `/jane-doe`) — both are low-severity,
fallback-path-only (never on a matched route), and the latter is not
reliably solvable via segment-pattern matching. `REDACT_PATHS` also still
carries several mixed-case header path entries (`req.headers.Authorization`,
`req.headers["X-Forwarded-For"]`, etc.) that can never match, since
Node.js/Express always lowercase incoming header names — inert dead code,
not a leak, since the allowlist serializers already omit all headers.

Regression tests added: `server/src/tests/httpRequestLogPrivacy.test.ts`
§7.10 (real thrown error via `res.err`, both environments, both
`logUnhandledError` and `httpLogger` output lines), a mounted sub-router
`safeRoute` case, and four additional `sanitizePathFallback` cases
(percent-encoded email/UUID, phone number, malformed encoding). Suite is now
29 assertions (was 22), all passing; `npm run typecheck` and `git diff
--check` also re-verified clean.

---

## 11. Second independent review addendum — fallback route redesign (constant label)

A second independent review of this PR (fresh worktree at PR head
`af7a9b8b38f39297adae4b03086695fcc02ff3e8`) revisited §10's residual
limitation and determined it was **not acceptable as a permanent design**,
not merely a low-severity gap: a segment-pattern classifier (§10's
`isIdentifierLikeSegment`, matching UUID/email/opaque-token/numeric-id/phone
shapes) can never be exhaustive, and an external caller fully controls which
unmatched path is sent. Concretely, requests such as `/api/patients/42`
(short numeric id), `/api/patient/jane-doe` or `/api/patient/Mustafa-Basol`
(free-text name-like slugs), `/api/reset/my-short-secret` (short secret), and
`/api/lookup/AB123` (short reference code) all bypassed every regex in the
old fallback and were logged **verbatim** in the `route` field whenever
Express produced no matched route template (404s and pre-route failures)
— the exact production-reachable path this task set out to close.

**Investigation confirming the redesign was safe:**

- `sanitizePathFallback()` has exactly one call site: `safeRoute()`'s
  no-match branch (`route` is `undefined`, or `route.path` is not a
  `string` — covers 404s, pre-route errors, and the array/RegExp route-path
  shapes Express also allows). `safeRoute()` itself has exactly two call
  sites, both inside `logger.ts`: `logUnhandledError()` and
  `buildHttpLogger()`'s `customSuccessObject`/`customErrorObject` hooks. No
  other module in the repository reads the logged `route` field — confirmed
  by a repo-wide search restricted to direct consumers of that field.
  (`server/src/middleware/clinicAccess.ts` computes an unrelated,
  similarly-named `routeTemplate` locally, for a security-signal detector,
  independent of `logger.ts` and unaffected by this change.)
- No route in `server/src/routes/*` or `index.ts` is registered with an
  array or `RegExp` path, so the array/RegExp branch is a defensive
  guarantee for future routes, not a currently-exercised path today — either
  way it now also resolves to the constant label instead of falling through
  to path-segment classification.
- No operational script, monitoring dashboard, or test (besides the ones in
  this suite, which are updated in lockstep with this change) depends on the
  detailed fallback path string. There is no concrete operational dependency
  that a constant label would break.
- `baseUrl` is **not** retained in the unmatched-route fallback: the fallback
  branch of `safeRoute()` never reads `req.baseUrl`, so there is no risk of a
  partially-matched mount prefix leaking a user-controlled segment. Only the
  matched-route branch uses `baseUrl`, and only in combination with a
  confirmed string `route.path` (i.e., a route Express actually resolved) —
  that behavior is unchanged.
- `sanitizePathFallback()` no longer inspects its input at all (decoding,
  regex testing) — it cannot throw on malformed or percent-encoded input,
  closing that investigation question by construction rather than by
  additional guarding.

**Fix applied** (`server/src/utils/logger.ts`): `sanitizePathFallback()` no
longer classifies path segments by pattern. It now unconditionally returns a
fixed, non-identifying label — `/:unmatched` — regardless of the raw
path/segments passed in. The five identifier-classification regexes
(`UUID_SEGMENT_RE`, `NUMERIC_ID_SEGMENT_RE`, `EMAIL_SEGMENT_RE`,
`OPAQUE_TOKEN_SEGMENT_RE`, `PHONE_SEGMENT_RE`) and the
`isIdentifierLikeSegment()` helper were removed as dead code — nothing else
referenced them. `safeRoute()`'s matched-route branch (`baseUrl +
route.path`) is unchanged: a matched Express route (including mounted
routers) still logs its normalized template exactly as before.

**Updated residual-limitations status:**

- Matched routes retain their normalized route template (`/api/patients/:id`,
  `/api/clinics/:clinicId/patients/:patientId`, including mounted-router
  templates) — unchanged from §3/§10.
- Unmatched paths — 404s, pre-route failures, and any non-string
  (array/RegExp) route path — **no longer retain any user-controlled path
  segment value**. They resolve to the fixed label `/:unmatched`
  unconditionally. This closes the §10 residual gap: short numeric ids,
  name-like slugs, short secrets/reference codes, and any other
  unenumerated identifier shape can no longer be injected into production
  logs through an unmatched-route path, because no classification is
  performed at all.
- The previously-noted inert `REDACT_PATHS` mixed-case header entries are
  unchanged (still dead code, not a leak, per §10).

Regression tests added/updated in
`server/src/tests/httpRequestLogPrivacy.test.ts`: the pure-helper section now
asserts `sanitizePathFallback` returns the constant label for every case in
§10's residual list plus the full original bypass corpus (UUID, long/short
numeric id, email, opaque token, phone with and without punctuation,
percent-encoded identifiers, malformed percent-encoding, name-like slugs,
short secrets/reference codes, a bare query string) and for `route.path`
values that are arrays or `RegExp` objects; a matching set of live-server
(`real Express + real pino-http + real node:http` client) cases in §7.3
confirms the same for the actual completed/error log line, alongside the
existing matched-route and mounted-router assertions. Suite is now **44
assertions** (was 29), all passing.

**Validation re-run** (this worktree, PR head
`af7a9b8b38f39297adae4b03086695fcc02ff3e8`):

```
cd server
npm run typecheck              # clean
npm run test:http-log-privacy  # 44 passed, 0 failed
git diff --check               # clean
```

**Status remains `IMPLEMENTED_NOT_PRODUCTION_VERIFIED`.** Production
verification (real production log volume inspection) remains explicitly out
of scope for this task. [Superseded 2026-07-28 — see §12: production
deployment and a real production log capture now close this task as
`CLOSED_VERIFIED`. This §11 text is preserved unchanged as the historical
record at PR-head time.]

---

## 12. Production deployment and production verification (2026-07-28)

**Status: `CLOSED_VERIFIED`.** This section is an additive closeout record.
Nothing in §1–§11 above is altered; production verification (explicitly out
of scope for the merge itself, per §9/§11) has now been performed and is
recorded here.

### 12.1 Merge and deployment

- PR: [#239](https://github.com/MustafaBasol/DisKlinikCRM/pull/239) — "fix(kvkk): harden HTTP request log privacy".
- PR merge commit / baseline for this closeout: `d03116368e6c55cfa87ff1e35b95c485f7ff240d`.
- Production repository (`/var/www/noramedi`), branch `main`, deployed to the
  same SHA: `d03116368e6c55cfa87ff1e35b95c485f7ff240d`. Production working
  tree confirmed clean at that SHA.

### 12.2 Runtime state

- PM2 processes `noramedi-api` and `noramedi-worker` were both restarted
  after deployment and both remained `online`; clean shutdown and clean
  restart messages were observed for both. No restart loop, import failure,
  Prisma Client failure, port conflict, or database connection error was
  observed.
- API runtime: PM2 command `npm run start` → application command
  `npx prisma generate && tsx src/index.ts`, bound to `127.0.0.1:5000`.
- Worker runtime: PM2 command `npm run start:worker` → application command
  `npx prisma generate && tsx src/worker.ts`.

### 12.3 Focused validation on the production host

```
npm run typecheck              → clean
npm run test:http-log-privacy  → 44 passed, 0 failed
```

No server-level `build` script exists in this repository — the application
runs directly through `tsx`, not a compiled artifact. An attempted
`npm run build` accordingly has no script to run; this is a missing-script
condition, not a code or deployment failure, and is not characterized as one.

### 12.4 Health checks

- Local backend: `http://127.0.0.1:5000/api/health` → `HTTP 200`,
  `{"status":"ok"}`. (`/health`, without the `/api` prefix, returns `404`
  and is not this application's health endpoint.)
- Correct public API host: `https://api.noramedi.com`. Nginx evidence
  confirms `api.noramedi.com → proxy_pass http://127.0.0.1:5000`; Docker/
  Traefik is not used for this production API path. Public health:
  `https://api.noramedi.com/api/health` → `HTTP/1.1 200 OK`,
  `Content-Type: application/json; charset=utf-8`, `{"status":"ok"}`.
- `https://noramedi.com/api/health` and `https://app.noramedi.com/api/health`
  are frontend SPA hosts, not the API health endpoint — both returned
  frontend HTML during this pass and are **not** recorded as public API
  health failures. `crm.noramedi.com` did not resolve and is not part of the
  verified production API path.

### 12.5 Production HTTP log privacy verification

Synthetic values only were used — no real patient or credential data.
Synthetic request data included a patient UUID, a clinic UUID, a synthetic
email, a synthetic French-format phone number, a synthetic token, a synthetic
session cookie, a synthetic bearer token, a synthetic name slug, two
documentation-range IPv4 addresses, a short numeric identifier, and a
`jane-doe` free-text slug.

**Public matched request** — `GET https://api.noramedi.com/api/health` →
`HTTP 200`, `Content-Type: application/json`, `{"status":"ok"}`. Emitted
production log:

```json
{"level":30,"req":{"id":7,"method":"GET"},"res":{"statusCode":200},"responseTime":27,"route":"/api/health","msg":"request completed"}
```

**Public unmatched request** — a request carrying the synthetic path
identifiers, query parameters, forwarded-IP headers, an `authorization`
value, and a cookie value, against a path with no matching route → `HTTP 401`,
`{"error":"Unauthorized: Cookie session required"}` (acceptable: the request
reached the production authentication layer). Emitted production log:

```json
{"level":40,"req":{"id":8,"method":"GET"},"res":{"statusCode":401},"responseTime":3,"route":"/:unmatched","msg":"request completed"}
```

**Leak verification:** all of the synthetic values above (patient UUID,
clinic UUID, email, phone, token, cookie, bearer token, name slug, both
forwarded IPv4 values, `jane-doe`) were confirmed **absent** from the
captured production log segment.

```
PUBLIC_LEAK_COUNT=0
```

**Forbidden fields confirmed absent:** `headers`, `query`, `params`,
`remoteAddress`, `remotePort`, `socket`, `connection`, `x-forwarded-for`,
`x-real-ip`, `authorization`, `cookie`, `set-cookie`.

**Route behavior confirmed:** the matched request logged `route` as
`/api/health`; the unmatched request logged `route` as the fixed label
`/:unmatched` (the §11 constant-label redesign) — no user-controlled
unmatched path segment was logged.

**Error-path check:** the pre-fix raw `[unhandled-error]` console marker was
absent from the captured production log segment.

### 12.6 Scope of this verification — explicit boundary

This production pass covered a normal matched request and an
authentication-rejected unmatched request only. **An intentional production
`5xx` was not generated during this verification** — that would require
exercising a real thrown/rejected error against the live system, which was
not performed here and is not claimed to have been performed. Real
thrown-error and 5xx sanitization behavior (§10, §11's `logUnhandledError()`
path) is covered by the 44-assertion automated suite
(`npm run test:http-log-privacy`), independently re-confirmed passing on the
production host during this pass (§12.3) — it is not separately claimed to
have been exercised by a live production 500.

### 12.7 Closure

All items required to move this task from `IMPLEMENTED_NOT_PRODUCTION_VERIFIED`
(§7–§11) to `CLOSED_VERIFIED` are satisfied: the fix is merged and deployed to
production at an exact, confirmed SHA; both PM2 processes are healthy on
restart; typecheck and the full 44-assertion focused suite pass on the
production host; the correct public API health endpoint responds `200`; and a
live production log capture, using synthetic-only data, confirms zero leaked
sentinel values, absence of every forbidden field, and absence of the pre-fix
`[unhandled-error]` raw marker.

**Task status: `CLOSED_VERIFIED`.**
