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

> ## [2026-08-20 AMENDMENT — `F3-C2-ERR-004-R1-IHS-KVKK-GATE-RECONCILIATION`]
>
> Later operator work closed **BLOCKER 2** (ingress) and **BLOCKER 3** (admin/synthetic
> artifacts) in full, and the program owner supplied and accepted the Türkiye
> data-location/provider evidence that **BLOCKER 1** was waiting on. **This amendment
> narrows further; it still does not activate telemetry.** `SENTRY_DSN` remains unset,
> no NoraMedi organization/project/DSN exists in GlitchTip, and no NoraMedi production
> synthetic or real event has been sent. See **§15** for the full reconciliation, the
> E1–E5/I1–I5 gate matrix, and the exact hard-gate decision:
> **`IHS_KVKK_DSN_HARD_GATE = BLOCKED`** — the register update this document requires
> is written (`docs/compliance/62-kvkk-subprocessor-register.md` §1a) but **not yet
> merged**, and counsel confirmation of the undefined `I1–I5` items and the hosting
> provider's subprocessor characterization (`F3-C2-ERR-002` §7.3) remains outstanding.
> All findings and gate assessments below this line are preserved **unedited** as
> history; do not read them as current without cross-checking §15.

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

---

## 15. R1 Reconciliation (2026-08-20) — `F3-C2-ERR-004-R1-IHS-KVKK-GATE-RECONCILIATION`

**Task type:** documentation/evidence/compliance-register reconciliation. **No repository
runtime code, route, schema, or migration was touched by R1.** No production mutation, no DSN
creation, no production event. Same PR (#467), same branch.

### 15.1 What changed on the ground since the original evidence above

Program-owner-supplied and accepted facts, as of 2026-08-20:

**GlitchTip ingress (closes BLOCKER 2 in full):**

| Item | State |
|---|---|
| Observability FQDN | `errors.noramedi.com` |
| DNS | Production-verified |
| TLS | Let's Encrypt issued; expiry `2026-11-18`; automatic renewal configured |
| Reverse proxy | nginx, active |
| GlitchTip application binding | Unchanged — still `127.0.0.1:8000` only |
| Firewall | `ufw` default incoming deny; publicly allowed ports only `22/80/443` |
| Public HTTPS | `HTTP/2 200` verified |
| HTTP → HTTPS | `301` verified |
| Unknown Host header | catch-all `444` / empty reply, verified |
| `GLITCHTIP_DOMAIN` | now `https://errors.noramedi.com` (was the literal placeholder `<observability-fqdn>`) |

**GlitchTip administration (closes BLOCKER 3 in full):** a legitimate GlitchTip superuser has
been created; the `SYNTHETIC-Attacker-Org` / `SYNTHETIC-Probe-Project` / user `id=1` / project-key
artifacts recorded as the §4.3 finding have been **fully removed**, and their absence has been
**verified directly against the production GlitchTip database** (not inferred).

**IHS provider evidence (narrows BLOCKER 1 — does not fully close it):**

| Fact | Value |
|---|---|
| Physical host / disk infrastructure | Türkiye / NGN Data Center |
| Provider backup location | Türkiye |
| Overseas replication/failover/migration | Provider states: none |
| Guest-level encryption | LUKS/dm-crypt technically permitted |
| Resource expansion | Possible while preserving existing data |
| Provider staff post-credential-change access | Not retained routinely; support access requires customer-provided access |
| Provider-side encryption at rest | **None** |
| Custom DPA | **None offered** under the standard online-service model |
| Fixed IOPS/throughput guarantee | **Absent** |
| Sanitization / subprocessor-of-subprocessor / support-audit evidence | **Incomplete** |

These residual items are recorded exactly as evidenced in
`docs/compliance/62-kvkk-subprocessor-register.md` §1a — **not** upgraded into a claim that a
custom DPA exists, and not silently dropped.

**Still not done (unchanged by R1):** real NoraMedi GlitchTip organization/project; real DSN;
`SENTRY_DSN` activation; NoraMedi production synthetic event; receipt/redaction/release/request
correlation verification against a live event; PR #467 merge; deployment of any runtime change
this PR contains (there are none — see §14, `git diff --check` clean, no schema/route change).

### 15.2 E1–E5 / I1–I5 gate matrix

Definitions are `F3-C2-ERR-002` §6 (E1–E5) verbatim. **`I1–I5` has no discrete definition
anywhere in this repository** — it is used only as a bundled shorthand for "provider/DPA items"
across `F3-C2-ERR-002` §7.1/§9, this document's §7.1 (above), the master tracker, and
`F4-IMAGING-001-R5`. Not guessed here; classified as `UNDEFINED_IN_REPOSITORY`.

| ID | Requirement | Classification | Basis |
|---|---|---|---|
| E1 | Contractual statement of datacenter country | `SATISFIED_BY_ACCEPTED_PROVIDER_EVIDENCE` (documentary form — invoice/screenshot/PDF — not captured) | Program-owner-accepted: Türkiye / NGN Data Center, 2026-08-20 |
| E2 | Datacenter facility identification | `PARTIALLY_SATISFIED` | Facility named (NGN Data Center); no city-level location recorded |
| E3 | Independent network-level corroboration | `PARTIALLY_SATISFIED` (unchanged) | RIPE RDAP `country: TR`, `netname: IHS-VPS-NET5` — geolocation-adjacent inference only, per §6's own "geolocation alone is not sufficient" |
| E4 | Written no-migration/replication/failover-outside-Türkiye confirmation | `SATISFIED_BY_ACCEPTED_PROVIDER_EVIDENCE` (documentary form — contract clause vs. support statement — not distinguished) | Program-owner-accepted provider statement, 2026-08-20 |
| E5 | Backup/snapshot storage region | `SATISFIED_BY_ACCEPTED_PROVIDER_EVIDENCE` | Program-owner-accepted: Türkiye, 2026-08-20 |
| I1–I5 | Provider/DPA items (undefined) | `UNDEFINED_IN_REPOSITORY — COUNSEL_REVIEW_REQUIRED` | No document in this repository enumerates I1 through I5 individually; only the bundled label exists. The substantive DPA facts that are known (no custom DPA, no provider-side encryption at rest, no fixed IOPS guarantee, incomplete sanitization/support-audit evidence) are recorded in the register §1a regardless of the missing enumeration |

**Not classified as `NOT_REQUIRED_FOR_THIS_SELF_HOSTED_GLITCHTIP_ACTIVATION` for any item** —
E1–E5 and the I-items all bear on the **hosting** relationship (IHS), which is engaged
regardless of GlitchTip being self-hosted software; only the *software* itself (GlitchTip) is
outside subprocessor scope, per `F3-C2-ERR-002` §7.1's four-role distinction (§7.3 of that
document), which this task does not revisit.

### 15.3 Hard-gate decision

```
IHS_KVKK_DSN_HARD_GATE = BLOCKED
```

**The external wait this gate was named for (`BLOCKED_WAITING_IHS`) is resolved** — the
program owner has supplied and accepted the E1/E2/E4/E5-substance evidence, and BLOCKER 2/3 are
closed in full. **The gate itself stays `BLOCKED`, for two reasons neither of which this task
may close unilaterally:**

1. **`F3-C2-ERR-002` §9 Stage 4 step 1 requires the subprocessor-register update to be
   MERGED**, not merely written and committed. The register update exists
   (`docs/compliance/62-kvkk-subprocessor-register.md` §1a and the row-`1a`/`7c` reconciliation
   in §7 and §9) but lives only on this task's branch, in draft PR #467. Merging PR #467 is a
   separate, program-owner-authorized action this task does not take (see the task's own
   instruction not to mark the PR ready for merge).
2. **Counsel confirmation is outstanding** on two related, unresolved items: `F3-C2-ERR-002`
   §7.3's `COUNSEL REVIEW PENDING` marker on the IHS hosting relationship's precise
   subprocessor characterization, and the `I1–I5` items, which have no discrete definition to
   confirm against (§15.2). Neither is resolved by supplying the E1/E2/E4/E5-substance facts
   above — those facts are necessary evidence, not a substitute for counsel sign-off, and the
   register itself (§0 classification legend) explicitly disclaims making legal determinations.

**Exact missing artifacts/actions to close the gate:**

- Merge `docs/compliance/62-kvkk-subprocessor-register.md`'s §1a update (this PR or a
  follow-up) to `main`.
- Obtain counsel confirmation of the IHS hosting relationship's subprocessor characterization
  and DPA sufficiency (`F3-C2-ERR-002` §7.3), and either a discrete `I1–I5` definition or an
  explicit counsel statement that the §1a evidence is sufficient without one.
- Only after both of the above: proceed to `F3-C2-ERR-002` §9 Stage 3 (deploy `main` with DSN
  still unset) and Stage 4 (set the real DSN) — neither is authorized by this task.

### 15.4 Lifecycle (R1, additive — does not rewrite §13 above)

```
AGENT_COMPLETED       = YES   (repository/documentation scope only)
TESTS_PASSED          = N/A — no source/runtime/test file changed by R1 (see §14 above,
                         unchanged; git diff --check clean)
PR_OPENED             = YES  (#467, unchanged, still DRAFT)
MERGED                = NO
DEPLOYED              = NO
PRODUCTION_VERIFIED   = NO (repository/register facts only; no NoraMedi telemetry event exists)
TELEMETRY_ACTIVE      = NO
DSN_ACTIVE             = NO
SYNTHETIC_EVENT_VERIFIED = NO
```

`F3-SEC-EXIT-001` §5 item 10 = **`NOT_SATISFIED`** · `F3_EXIT_CRITERION_2` = **`NOT_SATISFIED`**
· `F3_EXIT_GATE` = **`NOT SATISFIED`** · `F3_COMPLETE` = **`NO`** · `F4_TRANSITION_AUTHORIZED` =
**`NO`** · `F3-C2-ERR-004 = BLOCKED_WAITING_COUNSEL_AND_MERGE`** (narrowed from
`BLOCKED_WAITING_IHS` — the IHS external wait is resolved; what remains is the repository-side
merge gate and counsel sign-off, both internal to the program, not external to a third party).

### 15.5 Exact next task

1. **Program owner:** decide whether to merge PR #467 as-is (documentation/evidence/register
   reconciliation only — no runtime, schema, or route change; CI 13/13 at head) or hold it
   pending further review.
2. **Program owner / counsel:** resolve `F3-C2-ERR-002` §7.3's `COUNSEL REVIEW PENDING` marker
   and the `I1–I5` definition gap (§15.2).
3. **Only after 1 and 2:** `F3-C2-ERR-002` §9 Stage 3 (deploy `main` with `SENTRY_DSN` still
   unset) and Stage 4 (set the real DSN, from a real `noramedi` GlitchTip organization/project —
   which also does not yet exist and is explicitly **not** created by this task), then Stage 5/6
   synthetic verification via the already-committed
   `server/src/scripts/verifyErrorTrackingDelivery.ts`.

This task does **not** create the real NoraMedi GlitchTip organization/project or DSN, even
though the hard-gate analysis above narrows toward eventual closure — that remains a
subsequent, separately authorized task, exactly as scoped.

---

## 16. R5 addendum (2026-08-21) — `F3-C2-ERR-004-R5-LEGAL-GOVERNANCE-DECISION-PACKET`

**Task type:** legal/governance decision-packet preparation. **No repository runtime code,
route, schema, or migration was touched by R5.** No production mutation, no DSN creation, no
production event, no LUKS configuration. Full detail:
[`F3-C2-ERR-004_R5_IHS_LEGAL_GOVERNANCE_DECISION_PACKET.md`](F3-C2-ERR-004_R5_IHS_LEGAL_GOVERNANCE_DECISION_PACKET.md).

**What changed since §15:**

1. **PR #467 merged** 2026-08-20T21:31:34Z (`cdf0d66d`) — §15.3 reason 1 (register update
   must be *merged*, not just committed) is **resolved**. §15.3 reason 2 (counsel
   confirmation) is **not** resolved by the merge alone.
2. **`I1–I5` (the "provider/DPA items" KVKK-context shorthand referenced in §15.2)
   is now DEPRECATED** — confirmed by direct search that no discrete definition of it
   ever existed in this repository, and confirmed that a different, unrelated,
   genuinely-defined `I1–I5` exists in `docs/program/runbooks/F4_RECOVERY_OPERATIONS.md`
   §22.7 (pgBackRest repo2 backup-independence evidence) that must not be conflated with
   this usage. It is replaced by five named decision dimensions
   (`PROCESSOR_CHARACTERIZATION`, `CONTRACT_DPA_SUFFICIENCY`, `TRANSFER_RESIDENCY_POSTURE`,
   `ENCRYPTION_AT_REST_DISPOSITION`, `VENDOR_LIFECYCLE_EVIDENCE`) with an explicit human
   decision matrix. §15.2's table stands as history; do not re-search this document's own
   §7.1 or `F3-C2-ERR-002` §7.1/§9 expecting to find an `I1–I5` enumeration — direct search
   confirms none exists in either.
3. **Encryption-at-rest (guest-side LUKS) technical classification performed:** for
   Workload A specifically, `RECOMMENDED_BUT_NOT_EXISTING_HARD_GATE` (Class B) — `F3-C2-ERR-002`
   §12 row 14 is `EVIDENCE_REQUIRED`, not stage-gated, and §12.1 explicitly scopes the
   "primary control" / hard-gate framing (§7.3 item 2, `B/C-4`) to Workloads B/C only,
   which remain unauthorized and out of scope. Full evidence in the R5 packet §6.
4. **Hard gate restated with an explicit binary structure:**
   `IHS_KVKK_DSN_HARD_GATE = BLOCKED_PENDING_AUTHORIZED_DECISION` — narrower and more
   explicit than §15.3's prose `BLOCKED`, but not a different substantive conclusion:
   activation remains blocked on the same underlying counsel/program-owner sign-off,
   now split into five independently answerable decisions (R5 packet §4).

**Not done by R5, unchanged:** real NoraMedi GlitchTip organization/project; real DSN;
`SENTRY_DSN` activation; any production event; PR #467 was already merged before R5 started
and R5 does not deploy, restart, or touch VPS2/GlitchTip/pgBackRest/MinIO/imaging in any way;
LUKS is not configured.

**Lifecycle (R5):** `AGENT_COMPLETED = YES` (documentation/governance scope only) ·
`MERGED = NO` · `DEPLOYED = NO` · `PRODUCTION_VERIFIED = NO` · `TELEMETRY_ACTIVE = NO` ·
`DSN_ACTIVE = NO`. `F3-SEC-EXIT-001` §5 item 10 remains `NOT_SATISFIED`;
`F3_EXIT_CRITERION_2` remains `NOT_SATISFIED`; `F3-C2-ERR-004` tracker token unchanged at
`BLOCKED_WAITING_COUNSEL_AND_MERGE` in substance, now more precisely expressed as
`IHS_KVKK_DSN_HARD_GATE = BLOCKED_PENDING_AUTHORIZED_DECISION` per the R5 packet.

**Exact next task:** program owner/counsel completes the R5 packet's §4 DECISION-1 through
DECISION-5. Only after all five are recorded may a subsequent, separately authorized
technical task proceed to `F3-C2-ERR-002` §9 Stage 3.

## 17. R-CLOSE addendum (2026-08-22) — `F3-C2-ERR-004-CLOSE` production evidence reconciliation

**Task type:** documentation/governance reconciliation only. This addendum records
**operator-supplied, already-completed** production activation evidence; it does not
itself activate, deploy, restart, or configure anything, and cannot independently
re-verify infrastructure state beyond what was supplied.

**Program-owner override, dated 2026-08-22:** `TECHNICAL_ACTIVATION_AUTHORIZED = YES`.
The program owner explicitly authorized proceeding with the technical `SENTRY_DSN`
activation ahead of completion of the R5 packet's §4 DECISION-1 through DECISION-5, as a
**sequencing/risk-acceptance override only**. This is **not** `LEGAL_EXTERNAL_APPROVED`
and is **not** KVKK legal-compliance, DPA-sufficiency, or counsel approval — those remain
`PENDING`. `IHS_KVKK_DSN_HARD_GATE` (R5 packet §5) stays `BLOCKED_PENDING_AUTHORIZED_DECISION`
**in its legal substance** — all five decisions are still blank; the override authorizes
only the technical/sequencing step of activation ahead of them, not any of the five
themselves.

**Production activation evidence (operator-supplied):**

- Checkout at activation: `3cc37474de829960e35015c08b578f7b7f1cbfa0`.
- GlitchTip 6.2.6, self-hosted on VPS2/IHS Türkiye; `errors.noramedi.com` public HTTPS;
  organization `NoraMedi`, project `NoraMedi Production`; real production DSN provisioned
  and active on VPS1 (value never recorded here or anywhere in this repository).
- **Verification #1** (`requestId=f3-c2-err-004-verify-189301`): committed verifier
  executed with explicit `--send-one-synthetic-event`; `SENTRY_DSN_CONFIGURED=YES`;
  `RELEASE_SHA_CONFIGURED=YES` (`RELEASE_SHA_VALUE=3cc37474de829960e35015c08b578f7b7f1cbfa0`);
  `NODE_ENV=production`; `FLUSH_STATUS=FLUSHED`; `EVENTS_SENT=1`; provider raw JSON
  confirmed: title/message exactly `internal error captured`, `role=api`,
  `errType=Error`, `environment=production`, release matches checkout,
  `route=/:unsafe-route`; all verifier NORAMEDI synthetic PHI/credential/DICOM/raw-route
  canaries absent.
- **Observed provider normalization:** raw JSON contained `user.username=[Filtered]` and
  `ip_address=[Filtered]`, `modules={}` — no real user/IP/module inventory leaked.
  Provider-side configuration confirmed: `GLITCHTIP_PII_SCRUB_DEFAULT` enabled, sensitive
  keys include `tckn`, `tc_kimlik_no`, `diagnosis`, `diagnosis_note`, `patient_note`,
  `anamnesis`, `icd10`, `treatment_note`, `national_id`, `phone`, `birthdate`,
  `ip_address`, `username`. Classified as **provider-side scrubbing/normalization, not a
  PHI/PII leak** — consistent with, and not a new finding beyond, §3/§6 above.
- **Security incident during verification:** a `docker compose config` diagnostic
  rendered the resolved Compose environment and printed GlitchTip's `POSTGRES_PASSWORD`
  and `SECRET_KEY` into operator terminal/chat evidence. Both values were immediately
  treated as compromised. **No secret value is reproduced anywhere in this document or
  this task's changes.**
- **Containment:** Postgres role password rotated; `POSTGRES_PASSWORD` and
  `DATABASE_URL` updated consistently; GlitchTip `SECRET_KEY` rotated; active `.env`
  mode `0600`; `gt-web` and `gt-worker` recreated using the new environment; operator
  login re-verified successfully.
- **Post-rotation runtime:** `gt-postgres` healthy, `gt-valkey` healthy, `gt-web`
  healthy, `gt-worker` up, local GlitchTip HTTP `200`, public
  `https://errors.noramedi.com` HTTP `200`.
- **Verification #2** (`requestId=f3-c2-err-004-verify-190582`, post-rotation):
  committed verifier executed exactly once; `FLUSH_STATUS=FLUSHED`; `EVENTS_SENT=1`;
  provider raw JSON again verified with the same fixed safe fields; all sensitive
  verifier canaries absent — confirms NoraMedi → GlitchTip ingest remained operational
  after rotation.
- **Secret-backup cleanup:** obsolete files removed —
  `.env.pre-errors-fqdn-20260820-195250`,
  `.env.pre-secret-rotation-20260822-164602`,
  `.env.pre-secret-rotation-20260822-164815` — final `LEGACY_ENV_BACKUP_COUNT=0`; active
  `.env` present, mode `0600`. Recorded as **logical file removal plus credential
  rotation only** — no physical secure-erase (SSD block level) claim is made.

**Lifecycle (R-CLOSE):**

```
AGENT_COMPLETED (this docs task)      = YES
AGENT_COMPLETED (prior activation)    = YES (operator-executed, not performed by this task)
TECHNICAL_ACTIVATION_AUTHORIZED       = YES (2026-08-22 program-owner override, sequencing/risk-acceptance only)
TESTS_PASSED                          = implementation PR's prior scoped automated evidence unchanged;
                                         this activation additionally evidenced by the committed
                                         production verifier + runtime/provider checks above —
                                         no new automated-test count invented
PR_OPENED (new runtime PR)            = NO
MERGED (new runtime merge)            = NO
DEPLOYED                              = YES, narrowly: SENTRY_DSN activation + GlitchTip secret
                                         rotation/recreate (config/runtime activation only) —
                                         NO NoraMedi application code deployed
PRODUCTION_VERIFIED                   = YES (Workload A technical activation, privacy boundary,
                                         delivery, runtime — verifications #1/#2 above)
LEGAL_EXTERNAL_APPROVED               = NO / PENDING
```

`F3-SEC-EXIT-001` §5 item 10 is now stale on its literal "confirmed absent in-repo"
premise and is annotated `TECHNICALLY_SATISFIED_PENDING_LEGAL_RATIFICATION` (see that
document's own addendum). `F3_EXIT_CRITERION_2` and `F3_EXIT_GATE` remain `NOT SATISFIED`
overall — other independently-sufficient, unrelated reasons (e.g. the platform-admin
MFA negative-test-coverage gap; the separately-tracked `R-030-DB` Workload-B legal gate)
are each alone sufficient and are unchanged by this task. `F3_COMPLETE = NO`;
`F4_TRANSITION_AUTHORIZED = NO`.

**Migration:** NONE. **Rollback:** telemetry rollback is removal/restoration of the
`SENTRY_DSN` configuration followed by a PM2 reload on the same deployed release; no
DB/schema migration rollback applies; the compromised pre-rotation GlitchTip credentials
must **not** be restored; the deleted pre-rotation `.env` backups are not rollback
sources; if GlitchTip must be disabled, NoraMedi's existing fail-open telemetry behavior
(`errorTracking.ts` is a no-op without a reachable DSN) is preserved unchanged.

**Tenant/security impact:** telemetry boundary stays deny-by-default; no patient name,
TCKN, phone, email, address, diagnosis, appointment note, message body, `Authorization`,
cookie, `DATABASE_URL`, storage credential, Meta secret, DICOM identifier, filename,
`clinicId`, unsafe route, or unsafe role/request ID reached the provider in the
controlled verifications above; tenant/clinic identifiers are not exported by this event
boundary; no schema/migration change; no cross-domain modular-monolith boundary change.

**Exact next task:** unchanged from §16 — program owner/counsel completes R5 packet §4
DECISION-1 through DECISION-5; this override does not resolve, and must not be read as
resolving, any of the five. `F3-C2-ERR-004-R6-IHS-LUKS-ENABLEMENT` remains named but not
opened, pending DECISION-4's disposition.
