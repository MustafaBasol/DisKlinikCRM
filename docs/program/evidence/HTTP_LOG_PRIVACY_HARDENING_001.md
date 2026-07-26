# HTTP-LOG-PRIVACY-HARDENING-001 — HTTP Request Log Privacy Hardening

Task: HTTP-LOG-PRIVACY-HARDENING-001
Baseline: `origin/main @ cadc0784def237179f1af49de6f75a2ac9f2e969`
Branch: `fix/http-log-privacy-hardening-001`
Status: **IMPLEMENTED_NOT_PRODUCTION_VERIFIED**

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

**Status remains `IMPLEMENTED_NOT_PRODUCTION_VERIFIED`.**

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
