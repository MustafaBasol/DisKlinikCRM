# F3-C2-ERR-004 — GlitchTip Workload A Production Verification

**Phase:** F3 — Production Hardening · Criterion 2 · `F3-SEC-EXIT-001` §5 item 10 (external error tracking)
**Baseline:** `origin/main` @ `16887e60c3b9a827d0219a9ba210304b0e89b5ff` (PR #464 merge commit)
**Branch:** `feature/f3-c2-err-004-glitchtip-production-verification`
**Scope:** Workload **A** (observability / GlitchTip) only.
**Migration impact:** none. **Schema impact:** none. **Runtime/route impact:** none.

> ## THIS TASK DID NOT ACTIVATE ERROR TRACKING.
>
> `SENTRY_DSN` was **not** configured in any environment. **No** NoraMedi production
> event was sent to any provider. **No** GlitchTip port was exposed. **No** production
> process was restarted. `F3-SEC-EXIT-001` §5 item 10 remains **`NOT_SATISFIED`** and
> `F3_EXIT_CRITERION_2` remains **`NOT_SATISFIED`**.
>
> Activation is blocked by three independent gates recorded in §7. Two of them are
> **not technically closable** — they require the program owner to obtain contractual
> artifacts from the hosting provider and to make a naming/TLS decision. This document
> narrows the remaining work; it does not claim any part of it done.

---

## 1. What this task actually delivered

| # | Deliverable | State |
|---|---|---|
| 1 | Current-state discovery of the NoraMedi error-tracking boundary (Gate A) | **DONE** — §2 |
| 2 | Telemetry privacy threat model, incl. tenant-identifier assessment (Gate B) | **DONE** — §3 |
| 3 | Live read-only inventory of VPS2 Workload A (Gate C) | **DONE** — §4 |
| 4 | GlitchTip persistence/data-protection determination (Gate D) | **DONE** — §5 |
| 5 | **Pre-production wire proof** that the boundary redacts a fully contaminated error | **DONE** — §6 |
| 6 | A committed, tested Stage 5 synthetic verification mechanism (Gate F) | **DONE** — §8 |
| 7 | DSN activation (Gate E) | **BLOCKED** — §7 |
| 8 | Production synthetic verification (Gate F, live) | **BLOCKED** — §7 |
| 9 | Failure/rollback procedure (Gate G) | **SPECIFIED, NOT REHEARSED** — §9 |
| 10 | Production evidence (Gate H) | **NOT COLLECTED** — §10 |

**One new security finding requiring action before any exposure: §4.3.**

---

## 2. Gate A — current-state discovery

Established from `origin/main` @ `16887e60`, not from the working tree.

| # | Question | Finding |
|---|---|---|
| 1 | Existing error-tracking implementation? | **YES.** `server/src/utils/errorTracking.ts` (484 lines), merged, reviewed across F3-OBS-001 R1/R2 and F3-C2-ERR-001 R3. **Do not duplicate.** |
| 2 | SDK dependency? | `@sentry/node` pinned **exact** at `10.70.0` in `server/package.json`. GlitchTip is Sentry-protocol compatible, so the boundary needs **zero** modification. |
| 3 | Initialization? | Lazy and DSN-gated. `buildSentryInitOptions()` is deny-by-default: `defaultIntegrations: false`, `integrations: []`, `skipOpenTelemetrySetup`, `registerEsmLoaderHooks: false`, `sendDefaultPii: false`, `includeServerName: false`, `attachStacktrace: false`, `maxBreadcrumbs: 0`, tracing/profiling/spotlight/clientReports/debug all pinned off. |
| 4 | Call sites? | Exactly **one**: `server/src/index.ts:345`, the global Express 5xx handler, invoked as `void captureFatalError(...)`. |
| 5 | **Worker coverage?** | **NONE.** `server/src/worker.ts` installs `installFatalErrorHandlers` only and never imports `errorTracking.ts`. Error tracking is **API-5xx-only by design.** Recorded as a scope boundary in §11.4 — deliberately **not** changed by this task. |
| 6 | DSN / env contract? | `SENTRY_DSN` — documented (commented out) in `server/.env.example` §"F3-OBS-001 / F3-C2-ERR-001". Credential-equivalent. Lives only in `/var/www/noramedi/server/.env`, `chmod 600`, hand-edited, never echoed. Propagated to PM2 **exclusively** by `pm2 startOrReload … --update-env` in `scripts/noramedi-deploy.sh`. |
| 7 | Release tagging? | `RELEASE_SHA`. Two independent mechanisms: `scripts/noramedi-deploy.sh` step 4b exports it before `--update-env`; `ecosystem.config.cjs` additionally declares it in `env:` for both apps (the F3-C2-ERR-003-R1 hotfix, after `noramedi-worker` came up with it unset). An operator-supplied value wins. |
| 8 | Request-ID / correlation? | `server/src/middleware/requestId.ts` + pino-http. Surfaced as `X-Request-Id`; passed to the boundary as `requestId`. |
| 9 | Log/privacy guard coverage? | `scripts/log-privacy-guard` over five roots (`routes`, `services`, `jobs`, `middleware`, `utils`). 303 files scanned, **no new violations**. `server/src/scripts/` is deliberately **not** a scan root ("Do not broaden without a new evidence entry") — so the new script in §8 carries its own dedicated suite instead. |
| 10 | Prior GlitchTip deployment? | **YES** — see §4. Staged on VPS2 on 2026-08-20 by `F4-IMAGING-001-R5` (PR #459, **DRAFT, unmerged**). |

### 2.1 CodeGraph / search scope

Per the narrow-scope rule, no repository-wide scan was run. Discovery used targeted `grep`
over `server/src/{utils,middleware,routes,tests,scripts}`, `scripts/`, `ops/`, `ecosystem.config.cjs`
and `docs/program/`. `codegraph_explore` was **not** invoked — the boundary has exactly one
call site and it was located directly, so a graph query would have cost tokens for an answer
already in hand.

---

## 3. Gate B — telemetry privacy threat model

### 3.1 Prohibited — must never leave NoraMedi application context

Patient name · TC kimlik / national identity number · passport and other national identifiers ·
phone · email · address · medical history · diagnosis and treatment free text · appointment
notes · message bodies · WhatsApp/Instagram payload contents · raw webhook payloads ·
patient-identifying uploaded filenames · DICOM `PatientName` · DICOM `PatientID` ·
DICOM accession / patient identifiers · image binary data · `Authorization` and `Cookie`
headers · session/token/API credentials · database URLs · storage credentials · Meta/WhatsApp
secrets.

**How the boundary enforces this — by construction, not by filtering.** `captureFatalError`
never forwards `err` or anything derived from it. It does not send `err.message`, `err.stack`,
`err.cause`, `err.name`, or any custom own-property. It calls `captureMessage` with a fixed
literal, never `captureException`, so there is no `Error` object in the call for SDK-internal
frame/stack extraction to act on at all.

`err.name` deserves its own line: `Error.prototype.name` is a plain writable string, so
`err.name = 'patient=… token=…'` is valid JavaScript. It is therefore **not** an intrinsically
safe telemetry value and is replaced with one of exactly two literals — `'Error'` or
`'UnknownError'`.

### 3.2 Permitted — operationally necessary only

| Field | Why it is safe |
|---|---|
| `requestId` | Opaque per-process correlation counter. Re-validated against `/^[A-Za-z0-9_.:-]{1,64}$/` — no whitespace, `@`, `=`, `&`, `%`, `/`. Fails → **dropped**. |
| `role` | Fixed small vocabulary (`api`). Re-validated against `/^[a-z][a-z0-9_-]{0,31}$/`. Fails → **dropped**. |
| `route` | Express **route template**, never a raw path. Re-validated; fails → replaced with the fixed `'/:unsafe-route'` placeholder. |
| `errType` | One of two hardcoded literals. |
| `environment` | `NODE_ENV`. Deployment metadata. |
| `release` | `RELEASE_SHA` — a public commit id, non-secret by construction. |
| `event_id`, `timestamp`, `level`, `platform` | Provider-protocol scaffolding. |

Nothing else. `sanitizeOutboundEvent` discards whatever the SDK assembled and rebuilds the
event from this allow-list, returning `null` unless the message is exactly
`'internal error captured'`.

### 3.3 Tenant identifiers — explicit assessment (required, not assumed)

**Finding: `clinicId` / `organizationId` are NOT sent, and this task does not add them.**

This was assessed rather than inherited. The arguments for adding a tenant dimension are real
— it would let an operator see whether a 5xx burst is one clinic or all of them. It is still
refused, for three reasons:

1. **A clinic identifier is not anonymous in this deployment.** NoraMedi's first-customer
   footprint is a small number of named dental clinics. A tenant id that appears in an external
   system alongside error volume and timing is, in practice, re-identifying: it reveals *which
   named clinic* had an outage and when. That is commercially sensitive and, combined with
   route templates, edges toward revealing clinical workload patterns.
2. **The value would arrive as free text.** There is no bounded validator for a tenant field
   today, and the §3.1 threat is precisely that a future caller wires in a human-readable
   clinic name rather than an opaque id. Adding the field would mean adding a fourth bounded
   validator and a fourth way to get it wrong.
3. **It is not needed for the F3 objective.** §5 item 10 asks for external error tracking, not
   per-tenant analytics. `requestId` already correlates an event to a specific request in
   NoraMedi's own structured logs, which *do* have the tenant context and which never leave
   Türkiye-resident NoraMedi infrastructure. The tenant answer is one log lookup away, on the
   NoraMedi side of the boundary, without ever exporting it.

**If a future task decides tenant dimensions are required**, the minimum bar is: an opaque,
non-human-readable, non-enumerable identifier (not the slug, not the name, not a sequential
id), a bounded validator alongside `boundedRole`/`boundedRequestId`, a corresponding entry in
`sanitizeOutboundEvent`'s allow-list, and a KVKK re-assessment — because it converts the
telemetry stream from "no personal data" into "pseudonymised data about an identifiable legal
person's operations".

---

## 4. Gate C — VPS2 Workload A baseline (live, read-only)

Inspected over SSH on 2026-08-20. **Read-only: no service was started, stopped, reconfigured
or restarted, and no file was written.** Workload B (`pgBackRest` repo2) was not touched, not
queried and not reconfigured.

### 4.1 Host and network

| Item | Observed |
|---|---|
| Host | `vps-1281461-23217`, Ubuntu **24.04.4 LTS**, kernel `6.8.0-138-generic`, up 1 day |
| Provider | IHS Kurumsal Teknoloji Hizmetleri (AS49126), Istanbul TR |
| **Only public listener** | **`22/tcp` (sshd), v4 + v6. Nothing else.** |
| `ufw` | `active` · `Default: deny (incoming), allow (outgoing), deny (routed)` · rules: `22/tcp ALLOW IN Anywhere` (+ v6). **Byte-identical to its 2026-08-19 baseline; not modified by this task.** |
| Loopback-only listeners | `127.0.0.1:8000` (GlitchTip web), `127.0.0.1:9000`/`9001` (MinIO), `127.0.0.54:53`/`127.0.0.53:53` (systemd-resolved) |

### 4.2 GlitchTip stack (Workload A)

Compose project `noramedi-glitchtip-r5` at `/opt/noramedi-glitchtip/stack-r5/compose.yml`,
owned `noramedi-glitchtip:noramedi-glitchtip`, `compose.yml` mode `0640`, `.env` mode `0600`.

| Container | Image (tag **and** digest pinned) | Status | Published ports |
|---|---|---|---|
| `noramedi-gt-r5-web` | `glitchtip/glitchtip:6.2.6@sha256:a3d8eb1b…` | Up 6h (healthy) | `127.0.0.1:8000->8000` |
| `noramedi-gt-r5-worker` | `glitchtip/glitchtip:6.2.6@sha256:a3d8eb1b…` | Up 6h | none |
| `noramedi-gt-r5-postgres` | `postgres:17.11-trixie@sha256:e3841145…` | Up 6h (healthy) | **none** |
| `noramedi-gt-r5-valkey` | `valkey/valkey:8.1.9-alpine@sha256:e0eb7c48…` | Up 6h (healthy) | **none** |

PostgreSQL and Valkey are **not published at all** — the §12 row 7 armed stop condition ("no
public PostgreSQL port — STOP if public exposure is needed") is **satisfied**.

Security-relevant configuration, read from the stack `.env` (values below are non-secret
configuration flags; no secret value was read, printed or recorded):

```
ENABLE_USER_REGISTRATION=False        ENABLE_OPEN_USER_REGISTRATION=False
ENABLE_ORGANIZATION_CREATION=False    ENABLE_SOCIAL_APPS_USER_REGISTRATION=False
DEBUG=False                           ENABLE_TEST_API=False
ENABLE_OBSERVABILITY_API=False        GLITCHTIP_ENABLE_MCP=False
GLITCHTIP_BOOTSTRAP_DEV=False         SOCIAL_AUTH_BLOCK_PRIVATE_IPS=True
ENVIRONMENT=staging                   EMAIL_BACKEND=…console.EmailBackend
GLITCHTIP_EVENT_RETENTION_DAYS=7      GLITCHTIP_RETENTION_DAYS=7
```

`SECRET_KEY`, `POSTGRES_PASSWORD` and `DATABASE_URL` are present as keys; **their values were
never read.** Recorded as `CONFIGURED`, per the program's `VARIABLE = CONFIGURED` convention.

This resolves the `AMBIGUOUS` status `F3-C2-ERR-002` §13.2 recorded for the registration
variable name: **both** `ENABLE_USER_REGISTRATION` and `ENABLE_OPEN_USER_REGISTRATION` exist as
distinct settings in 6.2.6 and **both are set to `False`**. They are not aliases.

### 4.3 🔴 NEW FINDING — the only account on the instance is an attack-simulation artifact

```
users=1        superusers=0        orgs=1        projects=1        project_keys=1
id=1  superuser=false  staff=false  active=true  created=2026-08-20 08:22:16+00
org:     SYNTHETIC-Attacker-Org      (slug synthetic-attacker-org)
project: SYNTHETIC-Probe-Project     (slug synthetic-probe-project)
```

`F4-IMAGING-001-R5` proved an upstream GlitchTip 6.2.6 defect: the registration gate is
`settings.ENABLE_USER_REGISTRATION or not await User.objects.aexists()`, so on a **zero-user**
instance signup and organization creation are open *regardless of the env switches*. The proof
of that defect **left its artifacts in place**: user `id=1`, the organization
`SYNTHETIC-Attacker-Org`, the project `SYNTHETIC-Probe-Project`, and the one existing project
key.

Three consequences, none previously recorded:

1. **There is no administrator.** `superusers=0`. Nobody can administer this instance.
2. **The only DSN that exists belongs to the attacker-simulation project.** Pointing NoraMedi
   production at `project_keys=1` would deliver production telemetry into a project owned by a
   probe artifact organization. That is not an acceptable production destination, independent
   of every other gate.
3. **⚠ Ordering hazard — deleting the probe user FIRST would re-open the hole.** Registration is
   currently closed *only because a user exists*. Removing user `id=1` before a superuser exists
   returns the instance to the zero-user state in which signup is open regardless of
   configuration. **The superuser must be created before the probe artifacts are removed.**
   The instance is loopback-only today, so this is not remotely exploitable right now — but it
   becomes exploitable the moment ingress is opened, which is exactly the step that follows.

**Remediation is a Gate C prerequisite to any exposure, and it is NOT blocked by the provider
gate.** It is not performed here for one reason: `createsuperuser` requires a password, and this
task may not generate, transport or print a secret. It is handed to the operator as a single
controlled step — §12.

### 4.4 Network path to NoraMedi production: none

GlitchTip binds `127.0.0.1:8000`; `ufw` permits only `22/tcp`; there is no reverse proxy, no
TLS certificate and no DNS name. **No path exists from the production application host to
GlitchTip**, and none is opened by this task. `F3-C2-ERR-002` §9 Stage 2 steps 9–11 (nginx,
Let's Encrypt, HSTS) are unperformed, and the observability FQDN is still the literal
placeholder `<observability-fqdn>` — no name has ever been chosen.

---

## 5. Gate D — what GlitchTip persists, and why server-side scrubbing is not the boundary

`F4-IMAGING-001-R5` established by direct probe against this instance that GlitchTip stores
event payloads, stack traces, user/context fields, request headers and bodies when it receives
them, and that with default settings **`Authorization` headers, session cookies and
special-category health fields land verbatim in its PostgreSQL**. It also established that
`scrubIPAddresses` only anonymises the server-observed IP and does not do what its name
suggests, and that free-text exception values are never scrubbed — and that the exception value
becomes the issue title.

A defence-in-depth scrub configuration **is** applied on this instance
(`GLITCHTIP_PII_SCRUB_DEFAULT` with `enabled: true`, `scrub_emails`, `scrub_credit_cards`,
`scrub_private_keys`, and a sensitive-keys list covering `tckn`, `tc_kimlik_no`, `diagnosis`,
`diagnosis_note`, `patient_note`, `anamnesis`, `icd10`, `treatment_note`, `national_id`,
`phone`, `birthdate`, `ip_address`, `username`), with retention pinned to **7 days**.

**That configuration is a second layer and is explicitly not the privacy boundary.** It is
key-name-based, so it cannot protect free text; it runs *after* transmission, so the data has
already crossed the boundary and been written; and it is provider-side, so it is exactly the
control that a provider compromise or misconfiguration removes. The primary control is and
remains the NoraMedi-side allow-list in `errorTracking.ts`: **sensitive data is not sent in the
first place.** §6 proves that empirically.

---

## 6. Pre-production wire evidence — affirmative redaction proof

> **This is LOCAL evidence. It is NOT production verification.** It was produced on the
> developer workstation against a throwaway loopback HTTP server standing in for the provider
> ingest endpoint. It used the **real** `@sentry/node@10.70.0` and the **real, unmodified**
> `server/src/utils/errorTracking.ts` at `origin/main` @ `16887e60`. No production host, no
> VPS2 service and no real DSN were involved.

**A first attempt produced a false pass and is recorded rather than discarded.** The initial run
reported "0 leaked fields" — but `@sentry/node` is declared in `server/package.json` and **is
not installed in this repository's `node_modules` at all**, so the boundary had taken its
"SDK unloadable" path and sent nothing. A clean `0 of 12` against a payload that was never
transmitted is not evidence. The SDK was installed into an isolated directory and the probe
re-run before any of the results below were accepted.

**Method.** An `Error` was constructed carrying every prohibited class from §3.1 in
`err.message`, with `err.name` overwritten, an `err.cause` chain, and a custom `patientRecord`
own-property — then passed to `captureFatalError` together with a raw URL containing an embedded
patient id and a query string, a free-text `role`, and a non-conforming `requestId`.

**Result — exactly one envelope, complete body:**

```json
{"message":"internal error captured","level":"error","platform":"node",
 "event_id":"46bad7ac61b2435ca46c559e0990352a","timestamp":1787237704.119,
 "environment":"production","release":"16887e60c3b9a827d0219a9ba210304b0e89b5ff",
 "tags":{"errType":"Error","role":"api","requestId":"f3-c2-err-004-verify-10608"},
 "extra":{"route":"/:unsafe-route"},
 "sdk":{"name":"sentry.javascript.node","version":"10.70.0",
        "integrations":[],"packages":[{"name":"npm:@sentry/node","version":"10.70.0"}]}}
```

| Assertion | Result |
|---|---|
| Envelopes sent | **1** (exactly one, per §9 Stage 5) |
| Canary tokens present anywhere on the wire | **0 of 19** — `grep NORAMEDI-CANARY` over the raw wire capture returns nothing |
| Raw route with embedded id + query string | **refused**, replaced by `/:unsafe-route` |
| Malformed `role` / `requestId` (separate run) | **dropped entirely**, not placeholdered |
| Conforming `role` / `requestId` | **preserved** — correlation demonstrably works |
| `release` | equals the supplied deployed SHA |
| `environment` | `production` |
| Stack trace / `exception` | **absent** |
| `breadcrumbs`, `request`, `user`, `contexts`, `modules`, `server_name` | **all absent** |
| SDK integrations on the wire | **`[]`** — deny-by-default confirmed empirically, not from docs |
| `sdk.packages` | `npm:@sentry/node@10.70.0` only — SDK self-identification, never NoraMedi's module inventory |

**Flush behaviour (new, and load-bearing for Stage 5).** `captureFatalError` is fire-and-forget
by contract. A short-lived verification process can therefore exit before the transport has
written the request. Measured: without an explicit flush delivery happened only because the
process happened to live ~50 ms longer, which is not a guarantee across a real TLS path;
with `Sentry.flush()` the call returned `true` and delivery was deterministic. **Any Stage 5
mechanism must flush.** The script in §8 does.

---

## 7. Gate E — DSN activation: **BLOCKED** by three independent gates

### 7.1 BLOCKER 1 — provider residency and DPA evidence (external, legal)

`F3-C2-ERR-002` §6 makes the E1–E5 Türkiye data-location pack a precondition to proceeding past
Stage 2 step 1, and §9 Stage 4 step 1 makes the merged subprocessor-register update a **hard
gate** before `SENTRY_DSN` is set. Current state:

- **E1** (contractual statement of datacenter country) — **UNMET**
- **E2** (facility identification) — **UNMET**
- **E3** (independent network corroboration) — **PARTIAL** (RIPE RDAP `country: TR`, `netname: IHS-VPS-NET5`)
- **E4** (written no-migration/replication/failover-outside-Türkiye confirmation) — **UNMET**
- **E5** (backup/snapshot storage region) — **UNMET**
- **I1–I5** (provider/DPA items) — **UNMET**
- `docs/compliance/62-kvkk-subprocessor-register.md` §7 still reads `NO SUBPROCESSOR IDENTIFIED`
  for error tracking; §1 still has no second hosting row; **"IHS" appears zero times anywhere in
  `docs/compliance/`.**

These are contractual artifacts obtainable only from the provider by the program owner. They
are **not technically obtainable from the host** and cannot be produced by this task. This is
the blocker the tracker already carries as `F3-C2-ERR-004 = BLOCKED_WAITING_IHS`.

The §6 stop condition is explicit: if E1–E5 cannot be obtained, **stop** — and do not fall back
to a Frankfurt-hosted option without counsel, because that converts a no-transfer decision into
a KVKK Art. 9 cross-border transfer.

### 7.2 BLOCKER 2 — no observability FQDN, no TLS, no ingress (decision + build)

GlitchTip is loopback-only. For NoraMedi to deliver events there must be a public, TLS-protected
ingress. `GLITCHTIP_DOMAIN` is still the placeholder `<observability-fqdn>`: **no hostname has
ever been chosen**, so no DNS record, no Let's Encrypt certificate and no nginx vhost exist.
This is a program-owner naming decision followed by Stage 2 steps 9–11. It matches this task's
stated stop condition *"TLS/domain configuration is unknown and needed before exposure."*

### 7.3 BLOCKER 3 — no legitimate admin, and the only DSN is a probe artifact (§4.3)

`superusers=0`. The single existing project key belongs to `SYNTHETIC-Attacker-Org` /
`SYNTHETIC-Probe-Project`. There is no DSN that it would be correct to configure.

**Unlike blockers 1 and 2, this one is closable now**, and it must be closed *before* ingress is
opened — see the ordering hazard in §4.3. It is the single controlled step handed to the
operator in §12.

### 7.4 Not a blocker, but required before Stage 4: production is behind `main`

`F3-C2-ERR-002` §9 Stage 3 requires `main` to be deployed with `SENTRY_DSN` still unset. The last
recorded production deploy is `65afcfb3` (`F3-C2-ERR-003-R1`: Node `v22.23.1` — inside the armed
floor `^18.19.0 || >=20.6.0`, so that stop condition is **satisfied** — `@sentry/node` 10.70.0
installed, API + worker online, health 200). `origin/main` is now `16887e60`. **Current
production state was not re-verified by this task** — the production application host is
operator-mediated and no SSH alias for it is documented in this repository. The Stage 1/3
preflight in §12 is boolean-only and safe to run.

---

## 8. Gate F — the synthetic verification mechanism (delivered)

Gate F requires a controlled, non-PHI synthetic production event and forbids a permanent public
"throw error" endpoint. **No such mechanism existed.** `F3-C2-ERR-002` §9 Stage 5 prescribes "a
throwaway host-side script invoking `captureFatalError` directly" — i.e. the least-reviewed code
in the entire activation, hand-written on a production host at the exact moment a freshly
configured DSN first goes live.

This task commits that script instead: **`server/src/scripts/verifyErrorTrackingDelivery.ts`**.

- **Adds no route, no endpoint, no runtime surface.** Nothing imports it; it runs only when an
  operator invokes it.
- **Refuses by default.** Without `--send-one-synthetic-event` it prints a boolean config report
  and exits `2`. With no DSN configured it exits `3`. It cannot fire by accident.
- **Sends exactly one event** — matching Stage 5's "exactly one" and Stage 6's "event count
  exactly 1". An earlier draft sent two (to also exercise the malformed-`role` path on the wire);
  that was corrected, because it would have failed the runbook's own acceptance check. The
  malformed-input path is covered by unit tests instead.
- **Proves redaction affirmatively.** It sends a *deliberately contaminated* error — 19 synthetic
  canary tokens spanning every §3.1 prohibited class — and prints them, so the operator searches
  the GlitchTip UI for each and confirms **absence**. A clean event proves delivery; a clean
  event *from a contaminated input* proves redaction.
- **Uses no real data.** Every canary is fabricated and matches no record.
- **Never prints the DSN.** Config output is boolean-only. A static-source test asserts exactly
  one read of `env.SENTRY_DSN` exists and that no output call takes it as an argument.
- **Flushes** with a bounded 15 s budget, and reports `FLUSHED` / `FLUSH_TIMEOUT` /
  `SDK_UNAVAILABLE` / `FLUSH_ERROR` rather than throwing.

Its test suite, `server/src/tests/errorTrackingVerification.test.ts`, imports the **same exported
constants the script sends**, so the payload proven clean cannot drift from the payload production
emits, and asserts that not one canary byte survives `buildOutboundCaptureContext` +
`sanitizeOutboundEvent` — including against a pessimistic event pre-loaded with hostile
`request.headers.authorization`, `cookie`, `user.email`, `contexts`, `breadcrumbs`, `modules` and
`server_name`. It also asserts the suite itself is falsifiable (that the contaminated error really
does carry the canaries), so the redaction assertions cannot pass vacuously.

---

## 9. Gate G — failure modes and rollback

### 9.1 Failure behaviour (established by test, not by claim)

| Scenario | Behaviour | Evidence |
|---|---|---|
| GlitchTip healthy | One sanitized event per 5xx | §6 wire capture |
| GlitchTip unavailable / unreachable DSN | `captureFatalError` swallows, warns **once per process**, returns; the HTTP error response is unaffected | `test:error-tracking` — "a throwing `Sentry.init` is swallowed, latched, and never retried per-request"; "a rejecting module loader is swallowed and never rejects into the caller" |
| Invalid DSN | `Sentry.init` failure is **latched** so a permanently broken DSN is not re-initialized on every subsequent 5xx | same suite |
| SDK absent (`npm ci` not re-run) | Pure no-op + one warning; events still reach structured logs | same suite |
| NoraMedi restart | State is per-process; re-initializes lazily on first 5xx | by construction |
| GlitchTip restart | Indistinguishable from "unavailable" above | §9.1 row 2 |

**Availability contract.** `index.ts` calls `void captureFatalError(...)`, and
`fatalErrorHandlers.ts` registers an `unhandledRejection` handler that `process.exit(1)`s. A
rejected promise here would therefore **kill the API**. The function is wrapped so it can never
reject, and the test suite asserts the caller is never blocked and never awaits it. **No
patient-facing request can be blocked or failed by an observability failure.**

### 9.2 Rollback

**Telemetry deactivation (the Stage 5 stop-and-revert action, `F3-C2-ERR-002` §10.1):**

1. Blank or remove the `SENTRY_DSN` line in `/var/www/noramedi/server/.env` **with an editor**.
   Never `echo`, never a here-string, never `set -x`.
2. `scripts/noramedi-deploy.sh --skip-pull --skip-build --skip-migrate --skip-generate`.
   `--update-env` is what propagates the change; a bare `pm2 restart` will **not**.
3. Verify: `SENTRY_DSN_CONFIGURED=NO`, both PM2 apps `online`, `scripts/noramedi-healthcheck.sh`
   passing (401 counts as healthy).

`captureFatalError` returns to a pure no-op and `@sentry/node` is not imported at all. **No
schema change, no migration, no NoraMedi-side state is created by activation, so there is
nothing to roll back in the database.**

**Provider infrastructure (§10.2):** `docker compose -p noramedi-glitchtip-r5 down` at
`/opt/noramedi-glitchtip/stack-r5`. The NoraMedi API is unaffected.

> **Do NOT pass `-v` / `--volumes`.** Normal rollback must not delete the telemetry database or
> its volumes. Workload B (`pgBackRest` repo2 at `/var/lib/pgbackrest/repo2`) and Workload C
> (MinIO, compose project `noramedi-minio`) are **separate compose projects on separate paths**;
> scoping `down` to `-p noramedi-glitchtip-r5` is what keeps them untouched. Never run a bare
> `docker compose down` from a shared directory, and never `docker system prune`.

**Full revert (§10.3):** `git revert` the boundary's merge commit, `npm ci` in `server/`,
redeploy. Not required for deactivation — the env-var change above is sufficient and is the
reason the boundary was built DSN-gated.

---

## 10. Gate H — production evidence: **NOT COLLECTED**

Recording honestly what does and does not exist:

| Required | State |
|---|---|
| VPS2 service/process status | **COLLECTED** — §4.2 |
| Container/service names | **COLLECTED** — §4.2 |
| Listening ports | **COLLECTED** — §4.1 |
| Firewall state | **COLLECTED** — §4.1 (unchanged from baseline) |
| Reverse-proxy / TLS status | **COLLECTED: none exists** — §4.4 |
| NoraMedi API health | **NOT COLLECTED** — production host operator-mediated (§7.4) |
| NoraMedi worker health | **NOT COLLECTED** — same |
| Release SHA in production | **NOT RE-VERIFIED** — last recorded `65afcfb3` (§7.4) |
| Synthetic GlitchTip event id | **DOES NOT EXIST** — no production event was sent |
| Redaction verification | **PRE-PRODUCTION ONLY** — §6, local wire capture |
| Restart verification | **NOT PERFORMED** — nothing was restarted |
| Rollback command set | **SPECIFIED, NOT REHEARSED** — §9.2 |

No secret value was read, printed, logged or committed by this task.

---

## 11. Security / tenant / compliance review

1. **Tenant isolation.** No change. No tenant-scoped code path was touched, no query, no route,
   no middleware. `clinicId`/`organizationId` are deliberately **not** exported as telemetry
   dimensions — §3.3.
2. **KVKK / privacy.** Activation remains gated on the merged subprocessor-register update and
   the E1–E5 pack; both are unmet (§7.1). The register's error-tracking row is **unchanged** and
   still reads `NO SUBPROCESSOR IDENTIFIED`, which is correct while nothing is deployed and no
   data can reach any provider. Under the adopted Option A there is no cross-border transfer —
   *conditional on* §6 evidence that does not yet exist. **No KVKK compliance claim is made.**
3. **Authentication.** No change to NoraMedi authentication. On the GlitchTip side, §4.3 records
   that no administrator exists and that all registration switches are `False`.
4. **Secret management.** Unchanged. `SENTRY_DSN` remains a hand-edited `chmod 600` `.env` line
   propagated only via `--update-env`. This task introduced no secret, read no secret value, and
   the new script is tested to never print one.
5. **Network exposure.** **Unchanged — nothing was exposed.** `ufw` is byte-identical to its
   baseline; the only public port on VPS2 remains `22/tcp`; GlitchTip stays on `127.0.0.1:8000`.
6. **Storage persistence.** No new persistence. GlitchTip retention is pinned to 7 days.
   Rollback explicitly does not delete volumes (§9.2).
7. **Audit.** No change to `AuditLog` or any audit path.
8. **Availability / failure modes.** Proven non-blocking and non-fatal (§9.1). A provider outage
   cannot degrade a patient-facing request.
9. **Modular monolith contracts.** Preserved. `guardrail:scan` clean; no cross-domain import was
   added. The new script imports only `../utils/errorTracking.js`.

### 11.4 Scope boundaries deliberately NOT crossed

- **Worker error tracking is absent and stays absent.** `worker.ts` has no `captureFatalError`
  call. Adding one is a design change beyond this task's scope and would need its own privacy
  review of worker-originated error context. **Recorded as a known gap, not silently closed.**
- pgBackRest repo2 not activated, not configured, not queried. Backup/PITR topology untouched.
- VPS2 imaging storage not activated; no additional disk purchased; no DICOM/CBCT or attachment
  migration. The deferred VPS2 imaging-volume purchase was not reopened.
- No Kafka, no Kubernetes, no microservices.
- `docs/program/runbooks/F4_RECOVERY_OPERATIONS.md` still asserts the secondary host is
  `NOT PROCURED` in at least eight places, which has been false since 2026-08-19. **Reported, not
  fixed** — that runbook is Workload B territory and correcting it belongs to the F4 lifecycle.
- `F3-C2-ERR-003` has **no master-tracker entry at all** despite its evidence document existing.
  **Reported, not retroactively invented.**

---

## 12. Exact next steps

**Step 1 — close BLOCKER 3 (operator, on VPS2). The one action available now.**

Order matters: create the superuser **before** removing the probe artifacts, or the instance
returns to the zero-user state in which registration re-opens regardless of configuration (§4.3).

```
ssh noramedi-vps2-claude
docker exec -it noramedi-gt-r5-web ./manage.py createsuperuser
```

Choose the email and password interactively. **Do not pass the password on the command line, do
not echo it, do not record it in the tracker or any evidence document.** Then re-run the
read-only check and confirm `superusers=1`:

```
docker exec noramedi-gt-r5-postgres psql -U gt_r5 -d glitchtip_r5 -tAc \
  "select 'users=' || count(*) || ' superusers=' || count(*) filter (where is_superuser) from users_user;"
```

Report that output before any further mutation. Removal of `SYNTHETIC-Attacker-Org`,
`SYNTHETIC-Probe-Project` and user `id=1`, and creation of the real `noramedi` organization and
project, are **step 2** and must not be run until step 1's output is confirmed.

**Step 2 — program owner:** obtain E1, E2, E4, E5 and I1–I5 from IHS, and merge the
`docs/compliance/62-kvkk-subprocessor-register.md` update (§7 → `ACTIVE`, new §1 hosting row).
This is the gate the tracker carries as `BLOCKED_WAITING_IHS`. Nothing downstream may proceed
without it.

**Step 3 — program owner:** choose the observability FQDN. Then Stage 2 steps 9–11 (nginx →
`127.0.0.1:8000`, Let's Encrypt, HSTS, HTTP→HTTPS) and the `ufw`/ingress change, and set
`GLITCHTIP_DOMAIN` + `CSRF_TRUSTED_ORIGINS` accordingly.

**Step 4 — Stage 3:** deploy `main` to production with `SENTRY_DSN` still unset; confirm
`SENTRY_NODE_INSTALLED=YES`, both PM2 apps online, health OK, and **zero** SDK activation.

**Step 5 — Stage 4/5/6:** set the DSN from the real `noramedi` project, restart via
`noramedi-deploy.sh --skip-pull --skip-build --skip-migrate --skip-generate`, then run:

```
cd /var/www/noramedi/server && npx tsx src/scripts/verifyErrorTrackingDelivery.ts --send-one-synthetic-event
```

Verify in the GlitchTip UI that exactly one event exists, that it carries the printed
`CORRELATION_REQUEST_ID`, and that **every** printed `ABSENT_REQUIRED:` token is absent. Any one
present ⇒ stop and revert per §9.2.

---

## 13. Lifecycle

```
AGENT_COMPLETED       = YES   (repository scope only)
TESTS_PASSED          = pending external confirmation (counts in §14)
PR_OPENED             = YES  (#467, DRAFT)
MERGED                = NO
DEPLOYED              = NO
PRODUCTION_VERIFIED   = NO
```

`F3-SEC-EXIT-001` §5 item 10 = **`NOT_SATISFIED`** · `F3_EXIT_CRITERION_2` = **`NOT_SATISFIED`**
· `F3_EXIT_GATE` = **`NOT SATISFIED`** · `F3_COMPLETE` = **`NO`** · `F4_TRANSITION_AUTHORIZED` =
**`NO`** · `F3-C2-ERR-004` = **`BLOCKED_WAITING_IHS`** (unchanged; narrowed, not closed).

---

## 14. Test evidence

All run at `origin/main` @ `16887e60` plus this branch's changes, in an isolated worktree.

| Command | Result | Exit |
|---|---|---|
| `npm run typecheck` (in `server/`) | clean | **0** |
| `npm run test:error-tracking-verification` (**new**) | **19 passed, 0 failed** | 0 |
| `npm run test:error-tracking` | 24 passed, 0 failed | 0 |
| `npm run test:fatal-error-handlers` | 5 passed, 0 failed | 0 |
| `npm run test:request-id-correlation` | 2 passed, 0 failed | 0 |
| `npm run test:readiness` | 8 passed, 0 failed | 0 |
| `npm run test:health-routes` | 7 passed, 0 failed | 0 |
| `npm run test:deploy-release-sha-propagation` | 26 passed, 0 failed | 0 |
| `npm run test:route-error-log-privacy` | 65 passed, 0 failed | 0 |
| `npm run test:log-privacy-guard` | 39 passed, 0 failed | 0 |
| `npm run log-privacy-guard:scan` | 303 files, **no new violations** | 0 |
| `npm run test:ci-classify` | 28 passed, 0 failed | 0 |
| `npm run typecheck:ci-classify` | clean | 0 |
| `npm run typecheck:log-privacy-guard` | clean | 0 |
| `npm run guardrail:scan` | no new findings | 0 |

**Total: 223 passed, 0 failed** across 10 suites, plus 4 clean scans/typechecks.

`test:error-tracking-verification` is registered in the `server:test:non-disposable` aggregate,
which the CI classifier's coverage assertion requires — `test:ci-classify` re-run after the
change confirms no suite is orphaned.
