# F3-C2-ERR-002 — Error Tracking Provider Decision, Target Architecture and KVKK Classification

**Phase:** F3 — Production Hardening
**Exit gate:** Criterion 2 · Governing checklist `TEN_ITEM_SECTION_5` · Target item **§5 item 10 — external error tracking**
**Baseline:** `origin/main` @ `c600ea70022546dd503209002123efa3260666a3` (PR #416 merge commit; head `a115a670f4547713d68fea09ba0b8c59c69d9628`)
**Predecessor:** `F3-C2-ERR-001` (PR #416, merged, 13/13 CI) — see [F3-OBS-001_PRODUCTION_OBSERVABILITY_MINIMUM.md](F3-OBS-001_PRODUCTION_OBSERVABILITY_MINIMUM.md) §15

> **This document is a decision and a runbook. Nothing in it has been executed.**
> No provider is deployed. No `SENTRY_DSN` exists in any environment. No production
> synthetic event has been sent. PR #416 itself is **not deployed**. **`F3-SEC-EXIT-001`
> §5 item 10 remains `NOT_SATISFIED` and `F3_EXIT_CRITERION_2` remains `NOT_SATISFIED`.**

---

## 1. Why this task exists

`F3-OBS-001` §15.8 step 1 is an explicit stop: *"Choose the provider and record the
decision. Until this is recorded, stop here."* PR #416 made the error-tracking boundary
deployable and safe to activate; it deliberately did not choose a provider, because that
choice is simultaneously an architectural, an operational and a **KVKK** decision.

§15.10 of that document already classified three options and recommended a self-hosted
model. This task re-verifies the temporally unstable facts behind that recommendation
against current primary sources, and resolves the one question §15.10 left implicit:
**where the self-hosted instance runs.** §15.10 assumed "on infrastructure already in the
register" (i.e. colocated on the production application host). The program owner's
direction for this task is different and, on the analysis in §7 below, better:
**a separate observability VPS physically located in Türkiye.**

That difference is material and is the main new finding of this document — see §7.3.

---

## 2. Verified repository and deployment state (read-only)

All facts below were read from `origin/main` at the baseline SHA, not from the local
working tree (which was checked out at a pre-#416 branch during this task).

| # | Check | Result |
|---|---|---|
| 1 | Fresh `origin/main` SHA | `c600ea70022546dd503209002123efa3260666a3` |
| 2 | PR #416 merge commit in `main` | **YES** — `c600ea70` is `origin/main` itself |
| 2b | PR #416 head in `main` | **YES** — `a115a670` is an ancestor of `origin/main` |
| 3 | Deployment script | `scripts/noramedi-deploy.sh`: `git pull --ff-only` → `npm ci` (in `server/`) → `prisma migrate deploy` → `prisma generate` → **step 4b `export RELEASE_SHA`** → `pm2 startOrReload … --only noramedi-api --update-env` → same for `noramedi-worker` → healthcheck → worker `online` verification |
| 4 | PM2 topology | `ecosystem.config.cjs`, two fork-mode apps (`noramedi-api`, `noramedi-worker`), both `cwd: server/`, `script: npm`. Environment propagation is **exclusively** via `--update-env` on `pm2 startOrReload`; the file itself carries only `NORAMEDI_PROCESS_ROLE` and `RUN_BACKGROUND_JOBS` and **no secrets** |
| 5 | `@sentry/node@10.70.0` declared engine | `node >= 18`. **But the binding constraint is transitive:** `@opentelemetry/core`, `@opentelemetry/instrumentation`, `@opentelemetry/resources`, `@opentelemetry/sdk-trace-base` @ `2.10.0` each declare **`node: ^18.19.0 \|\| >=20.6.0`** |
| 6 | Repo Node engine expectation | **NONE.** Neither the root `package.json` nor `server/package.json` declares an `engines` field. The repository states no Node floor of its own |
| 7 | Production install method | `npm ci` in `server/`, **including devDependencies** (the script comments this explicitly: `tsx` and `prisma` are needed at runtime, since `start` is `npx prisma generate && tsx src/index.ts`). `@sentry/node` is a **production** dependency, so it installs under this method with no change |

### 2.1 Effective Node floor — and the one thing that is NOT verified

Combining rows 5 and 6, the effective runtime floor introduced by PR #416 is:

```
node ^18.19.0 || >=20.6.0
```

**Production's actual Node version is `UNVERIFIED`.** No repository artifact records it,
and `engines` is absent, so `npm ci` will **not** fail loudly on an incompatible host — it
will install and then fail (or misbehave) at import time, and only on the first 5xx after
a DSN is configured. This is a real preflight gate, not a formality: see §9 Stage 1 and
§13 rejected/unverified claims.

> **STOP CONDITION (armed, not triggered):** if the production host reports a Node
> version outside `^18.19.0 || >=20.6.0`, **stop** — do not deploy PR #416 and do not
> configure a DSN. Node 24.x (the version this repository's tooling runs under locally)
> satisfies it; that is not evidence about the production host.

### 2.2 CodeGraph scope and queries

Per the task's narrow-scope rule, exactly one CodeGraph query was issued:

```
codegraph_explore("errorTracking.ts initErrorTracking captureError SENTRY_DSN RELEASE_SHA
                   beforeSend — how is the error tracking boundary initialized and what calls it",
                  maxFiles: 6)
```

**Result, reported honestly:** the index returned the **pre-#416** version of
`server/src/utils/errorTracking.ts` (working-tree state; the tool flagged it as pending
sync) and pulled in two unrelated `windows-bridge/*.cs` files. It correctly identified the
blast radius (`resetErrorTrackingStateForTests`, `safeExternalErrorType`, the
`errorTracking.test.ts` coverage) and confirmed the boundary has **no callers outside**
`server/src/index.ts`'s global 5xx path plus its own tests. **The merged privacy contract
in §5 below was therefore read directly from `origin/main`, not from the CodeGraph
output.** No repository-wide scan was performed.

---

## 3. Provider comparison

Re-verified against current primary sources on 2026-08-14 (see §14 for citations).

| | **Option A — self-hosted GlitchTip on a separate Türkiye VPS** *(recommended)* | **Option B — GlitchTip hosted EU** | **Option C — Sentry SaaS, DE region** |
|---|---|---|---|
| Physical / data region | **Türkiye** — operator-chosen, must be evidenced (§6) | **Frankfurt, Germany** — DigitalOcean FRA1, `eu.glitchtip.com`, behind Cloudflare as reverse proxy/WAF | **Frankfurt, Germany** — Sentry's EU data silo (GA since 2026-05-04) |
| Cross-border transfer | **NO** (conditional on §6 evidence) | **YES** | **YES** |
| New subprocessor | **Software: NO.** GlitchTip is self-operated software, not a vendor relationship. **Hosting: YES** — a new IaaS provider (see §7.3) | **YES** — GlitchTip's operator, **plus** DigitalOcean, Cloudflare and Mailgun as its own sub-processors | **YES** — Functional Software, Inc. (Sentry) and its subprocessor list |
| DPA requirement | With the **hosting** provider only; no software-vendor DPA exists to sign | Required — GlitchTip DPA + its subprocessor chain | Required — Sentry DPA + subprocessor list review |
| KVKK Art. 9 implications | **Not engaged**, if the host is in Türkiye | **Engaged.** Türkiye has issued **no adequacy decision** for the EU/Germany | **Engaged**, identical basis |
| Standard-contract / notification | N/A | If a standard contract is the chosen basis: signed contract **notified to the Authority within five business days of signature** (physical, KEP, or the `standartsozlesme.kvkk.gov.tr` module) | Same |
| Operational complexity | **Highest** — NoraMedi owns provisioning, TLS, upgrades, backups, retention | Low | Lowest |
| Failure-domain impact | **Best** — a separate host; GlitchTip cannot consume the application host's CPU/disk/Postgres, and its own outage cannot degrade the API | Neutral | Neutral |
| Vendor lock-in | **Lowest** — open-source, self-operated, Sentry-protocol | Medium — but data is portable and the protocol is the same | Highest |
| Rollback difficulty | **Trivial** — unset `SENTRY_DSN`; destroying the VPS is independent of NoraMedi | Trivial technically; the *transfer* already happened | Same |
| Sentry SDK protocol compatibility | **Yes** — "compatible with Sentry client SDKs"; "GlitchTip aims to be Sentry API compatible, and anything that works with Sentry should also work with GlitchTip"; the standard **envelope endpoint** is accepted | Yes (same software) | Yes (reference implementation) |
| Suitability for NoraMedi healthcare production | **Highest** | Acceptable, but converts an exit-gate item into a legal workstream | Acceptable, widest transfer footprint |

### 3.1 A note on Option B that is easy to miss

Option B is **not** "self-hosting, but managed". GlitchTip's hosted EU instance publicly
documents its own dependency chain: DigitalOcean FRA1 for compute, Cloudflare as reverse
proxy/WAF, and Mailgun for transactional email. Choosing Option B therefore adds
**four** onward relationships to the subprocessor register, not one, and routes NoraMedi's
error stream through a WAF operated by a third party. Its documented data-residency
commitment ("all data on the EU instance … stays within the EU") is a strong statement for
**GDPR** purposes and is simply not the question KVKK Art. 9 asks — the EU is still
"abroad" from Türkiye's standpoint.

---

## 4. Decision

> **ADOPTED PROVIDER MODEL: `OPTION A` — self-hosted GlitchTip on a dedicated
> observability VPS physically located in Türkiye.**
>
> **This is a decision to adopt a *model*, not an authorization to deploy.** Deployment is
> gated on §6 (Türkiye hosting evidence), §9 Stage 1 (production Node compatibility), and
> the register update in §8. `F3-SEC-EXIT-001` §5 item 10 stays `NOT_SATISFIED` until §9
> Stage 5–6 have actually been performed and verified.

**Exact reasons, in decision-weight order:**

1. **It is the only option that does not create a cross-border personal-data transfer.**
   Both alternatives land in Frankfurt, and Türkiye has issued no adequacy decision, so
   both require an Art. 9 mechanism — realistically the standard contract, with its
   five-business-day notification duty and administrative-fine exposure for failure to
   notify. Opening an Art. 9 workstream **during** an exit gate, for a telemetry channel
   that carries a fixed message and four bounded fields, is a poor trade.
2. **It adds no software subprocessor.** NoraMedi operates the software on
   NoraMedi-controlled infrastructure; there is no vendor receiving the data. (The
   *hosting* provider is a separate question, answered in §7.3 — it is **not** free.)
3. **Protocol compatibility is confirmed and the merged boundary is unchanged.** GlitchTip
   accepts Sentry SDK envelopes; `server/src/utils/errorTracking.ts`, `ecosystem.config.cjs`
   and `scripts/noramedi-deploy.sh` need **zero** modification. The DSN is the only input.
4. **Failure-domain isolation.** This is where the program owner's "separate VPS"
   direction improves on `F3-OBS-001` §15.10's colocated assumption. An error-tracking
   sink whose purpose is *to survive an application crash* must not share the crashing
   host: colocation would put a Django app, a second PostgreSQL and a Celery worker onto
   the machine that runs the healthcare API and its production database, competing for the
   same CPU, disk and page cache — and a GlitchTip disk-fill would take the API's database
   with it. **No contrary evidence was found. No escalation is raised.**
5. **Lowest lock-in, trivial rollback**, both directions (§10).

**What this decision does *not* claim:** it does not claim KVKK compliance, it does not
resolve any `TO BE VERIFIED` marker in the subprocessor register, and it does not assert
that the *existing* production host is in Türkiye — that fact is itself unverified
(§7.4).

---

## 5. Data minimization — the exact outbound contract

Taken verbatim from the **merged** `server/src/utils/errorTracking.ts` at
`c600ea70`. This is what GlitchTip will receive, and nothing else. Every field is
rebuilt from an allow-list in `sanitizeOutboundEvent` (`beforeSend`), which returns
`null` — dropping the event entirely — unless the message is exactly the fixed constant.

### 5.1 What GlitchTip receives

| Field | Value | Bound |
|---|---|---|
| `message` | `internal error captured` | Fixed constant `EXTERNAL_TRACKING_MESSAGE`. **Also the allow-list key** — any other message is dropped |
| `level` | `error` | Fixed |
| `platform` | `node` | Fixed |
| `tags.errType` | `Error` \| `UnknownError` | Exactly two literals from `safeExternalErrorType()`. **Never `err.name`** (writable, attacker-controlled) |
| `tags.role` | e.g. `api`, `worker` | `/^[a-z][a-z0-9_-]{0,31}$/` |
| `tags.requestId` | opaque per-process counter | `/^[A-Za-z0-9_.:-]{1,64}$/` — excludes whitespace, `@`, `=`, `&`, `%`, `/` |
| `extra.route` | route **template**, e.g. `/api/patients/:id` | `/^\/[\w/:.*\-{}()[\]]{0,199}$/`; a failing value becomes the fixed `/:unsafe-route` placeholder, never the original |
| `environment` | `NODE_ENV` | — |
| `release` | deployed git SHA (`RELEASE_SHA`) | — |
| `event_id`, `timestamp` | SDK-generated | — |

**Irreducible SDK protocol metadata** (documented, not claimable away): `sdk.{name,
version, integrations, packages}` is re-attached by `@sentry/core`'s
`createEventEnvelope` **after** `beforeSend` runs, so the boundary cannot control it. Its
verified content is SDK self-identification only — `npm:@sentry/node@10.70.0` and an
**empty** integration list. The envelope header's `trace` DSC and `sent_at` are likewise
irreducible. `event.modules` (NoraMedi's installed-package inventory) is **absent**,
confirmed on the wire.

### 5.2 What must NOT appear — stop-and-revert list

If **any** of the following is visible in the GlitchTip UI for a NoraMedi event, that is a
**stop-and-revert** condition under §9 Stage 5, not a tuning opportunity:

patient data of any kind · tenant/clinic names or IDs · raw URLs · raw error text
(`err.message`) · `err.name` · `err.cause` chains · stack traces · HTTP headers · cookies ·
query-string values · request bodies · authentication material · tokens/API keys · phone
numbers · email addresses · treatment, appointment or imaging data · message content ·
`server_name`/hostname · OS/device/CPU/locale/timezone contexts · installed-module
inventory · breadcrumbs · `user` · console output · local variable values · source-context
lines.

### 5.3 Retention

**Initial F3 retention: `GLITCHTIP_MAX_EVENT_LIFE_DAYS=30`.**

GlitchTip's default is **90 days**; leaving it at the default would be a silent choice of
indefinite-ish retention for a healthcare operator. 30 days is enough to investigate a
production incident and to establish a 5xx baseline across an F3 gate, and it is
deliberately set **before** the first event, not after. A scheduled task performs the
purge, so a reduction takes up to one day to take effect. Revisit only with a stated
operational reason.

### 5.4 Residual privacy risk, stated exactly

Carried forward unchanged from `F3-OBS-001` §15.10 and still true under Option A:

1. **An event *stream* is metadata.** Volume, timing and route-template distribution of
   5xx errors reveal operational patterns about a healthcare provider. Under Option A that
   pattern data stays on NoraMedi-operated infrastructure in Türkiye; **this is the single
   largest privacy improvement Option A buys.**
2. `requestId` is a **join key** to NoraMedi's own logs. Not PII alone; meaningful to
   anyone holding both sides. Under Option A, only NoraMedi holds either.
3. `route` is bounded **structurally, not semantically** — `/api/patients/:id` discloses
   that a patients endpoint exists. Schema shape, not data.
4. **`sendDefaultPii: false` is deprecated in v10 and removed in v11.** This configuration
   does not rely on it, but any future `@sentry/node` major upgrade must re-run the
   adversarial SDK review from `F3-OBS-001` §15.2 rather than assume the guarantee holds.

---

## 6. Türkiye data-location evidence requirement

The decision in §4 is **conditional on this evidence existing before Stage 2 of §9.**
Marketing copy on a provider's website is **not** evidence.

| # | Required artifact | Acceptable form |
|---|---|---|
| E1 | Provider's **contractual** statement of the datacenter's country for the specific instance | Order confirmation, invoice, or control-panel region field naming Türkiye/İstanbul/Ankara — captured as a screenshot or PDF |
| E2 | Datacenter facility identification | Provider's named facility/city for that region |
| E3 | Independent network-level corroboration | Public IP geolocation **plus** RIPE/WHOIS `country: TR` for the allocated netblock. Geolocation alone is not sufficient — it is inference |
| E4 | Written confirmation that the provider will not migrate, replicate or fail over the instance or its backups outside Türkiye without notice | Contract clause or written support statement |
| E5 | Backup/snapshot storage region | Explicitly stated as Türkiye; snapshots are a separate storage location from the volume |

Turkey-located IaaS with İstanbul/Ankara datacenters is **available in the market** from
multiple providers, so this is a procurement and documentation step, not a feasibility
risk. **This document deliberately names no vendor** — vendor selection is the program
owner's, and any recommendation here would be temporally unstable and unverified.

> **STOP CONDITION (armed, not triggered):** if E1–E5 cannot be obtained for the chosen
> provider, **stop**. Do not fall back to Option B or C without an explicit escalation and
> counsel involvement — that fallback converts a no-transfer decision into an Art. 9
> transfer.

---

## 7. KVKK classification

**Counsel-confirmation items are marked `COUNSEL`. Nothing here is legal advice, and no
legal certainty is claimed beyond the cited evidence.**

### 7.1 The four roles, kept distinct

The core analytical point of this section — these are routinely conflated, and conflating
them produces the wrong register entry:

| Role | Under Option A | Rationale |
|---|---|---|
| **SOFTWARE PROVIDER** | GlitchTip (the open-source project) | Supplies code. **Receives no personal data.** Downloading and running open-source software does not create a processor relationship any more than running PostgreSQL does |
| **HOSTING INFRASTRUCTURE PROVIDER** | The chosen Türkiye VPS provider — **NEW** | Supplies compute/storage/network on which NoraMedi-controlled data rests |
| **DATA PROCESSOR / SUBPROCESSOR** | **The hosting provider — `LIKELY YES`, `COUNSEL`.** GlitchTip-the-project — **NO** | See §7.3 |
| **CROSS-BORDER TRANSFER** | **NO**, conditional on §6 | Art. 9 is engaged by the *destination country*, not by the existence of a vendor |

### 7.2 What Art. 9 requires (verified)

Under KVKK Art. 9 as amended, transfer abroad requires: an **adequacy decision** by the
Board for the destination country; or, absent one, **appropriate safeguards** — the
Board-published **standard contract**, binding corporate rules, a protocol between public
institutions, or a written undertaking with Board authorization; or a narrow set of
**exceptional/incidental** cases. Where a standard contract is used, it must be notified to
the Authority **within five business days of signature**, via physical delivery, KEP, or
the Authority's `standartsozlesme.kvkk.gov.tr` notification module. **No adequacy decision
for the EU/Germany is in evidence**, which is precisely why Options B and C are expensive.

**Under Option A, none of this machinery is engaged** — because there is no transfer
abroad, not because an exemption applies.

### 7.3 The finding this task adds: the hosting provider is not free

`F3-OBS-001` §15.10 recorded Option A as *"New subprocessor: **None** (runs on
infrastructure already in the register)"*. That parenthetical **is no longer true** under
the separate-VPS direction, and the register must not inherit the claim.

A **new** IaaS provider now holds — on its disks, in its hypervisor, and in its snapshots —
data that NoraMedi determines the purpose and means of processing for. That the payload is
minimized to a fixed message and four bounded fields **reduces the sensitivity of the
processing; it does not change the role of the party storing it.** The same reasoning the
register already applies to the existing production VPS in §1 (`ACTIVE`, provider identity
`TO BE VERIFIED`) applies here.

**Classification: the Türkiye observability VPS provider is `LIKELY YES` a data
processor/subprocessor and must be entered in the register. `COUNSEL` must confirm the
precise characterization**, which depends on the contracting structure — specifically
whether the platform entity or each individual clinic is the controller, the same open
question the register already records for Google and Meta. **Evidence needed:** provider
identity, the §6 E1–E5 residency pack, the executed hosting contract/DPA (or documented
absence), encryption-at-rest capability, and the backup/snapshot storage region.

### 7.4 A pre-existing gap this task must not paper over

The subprocessor register §1 records the **existing** production hosting provider's
identity **and region** as `TO BE VERIFIED`, noting an unconfirmed "Hostinger" reference
that later independently-gathered topology evidence did not re-confirm.

Consequence, stated plainly: **NoraMedi cannot presently evidence that its primary
production database is in Türkiye.** The observability decision here is the *stronger* of
the two postures, not a repair of the weaker one. Option A avoids creating a *new*
cross-border transfer; it does not resolve register §1, and this document must not be
read as having done so. That item remains the register's own §10 next-action 1.

---

## 8. Subprocessor register — exactly what changes

File: `docs/compliance/62-kvkk-subprocessor-register.md`

**Changing now (this PR), decision-recording only:**

- §7 (Monitoring / alerting / observability) — record that a provider **model** has been
  decided (Option A) and point to this document. **The `NO SUBPROCESSOR IDENTIFIED` status
  token for error tracking is UNCHANGED**, because nothing is deployed, no DSN is set, and
  no data can reach any provider.
- §7 — correct the inherited "no new subprocessor" implication per §7.3: under a separate
  Türkiye VPS, the **hosting** provider is a new relationship even though the **software**
  is not.

**Changing later, at activation (NOT this PR), and required *before* Stage 4 of §9:**

- §7 status → `ACTIVE`, naming GlitchTip as **self-operated software** (not a
  subprocessor).
- **A new hosting row** (or a §1 sub-row) for the Türkiye observability VPS provider:
  identity, region + §6 E1–E5 evidence, DPA status, encryption at rest, backup region.
- §9 summary table row `7c` — from `NO SUBPROCESSOR IDENTIFIED` to the resolved state.
- §10 next-action 6 is the register's own instruction to do exactly this; it is satisfied
  by that later update, not by this one.

---

## 9. Deployment sequence — operator runbook (NOT executed)

**Order is not negotiable. Stage 3 deploys with `SENTRY_DSN` still unset, on purpose.**

### Stage 1 — NoraMedi production preflight (read-only, on the application host)

```bash
node -v                                   # MUST satisfy ^18.19.0 || >=20.6.0  — STOP if not
npm -v
git -C /var/www/noramedi rev-parse HEAD   # currently-deployed SHA
df -h /var/www /var/lib/postgresql        # free disk
free -m                                   # free memory
grep -q '"@sentry/node"' /var/www/noramedi/server/package.json && echo SENTRY_DEP_DECLARED=YES
test -d /var/www/noramedi/server/node_modules/@sentry/node && echo SENTRY_NODE_INSTALLED=YES || echo SENTRY_NODE_INSTALLED=NO
grep -qc '^SENTRY_DSN=.\+' /var/www/noramedi/server/.env && echo SENTRY_DSN_CONFIGURED=YES || echo SENTRY_DSN_CONFIGURED=NO
```

Expected before Stage 3: deployed SHA is pre-`c600ea70`, `SENTRY_NODE_INSTALLED=NO`,
`SENTRY_DSN_CONFIGURED=NO`. Install method is `npm ci` **with** devDependencies, which is
already correct for a production dependency — no deploy-script change is required.

**Boolean-only output. Never `cat` the `.env`. Never `set -x`.**

### Stage 2 — GlitchTip infrastructure (separate Türkiye VPS)

1. Provision the VPS in Türkiye. **Collect §6 E1–E5 before continuing.**
2. Base OS: current Ubuntu LTS. Full patch + reboot; enable unattended security upgrades.
3. SSH: key-only, `PasswordAuthentication no`, `PermitRootLogin no`, non-root admin user,
   source-restricted to known admin IPs where feasible.
4. UFW default-deny inbound: allow **only** SSH (restricted) and 443. **Never** 5432,
   **never** 6379, **never** 8000 from the internet.
5. Install Docker Engine + Compose plugin from the official repository.
6. Compose stack: `postgres` (project sample uses `postgres:18`; documented floor is
   **14+**) + `web` (GlitchTip), bound to **`127.0.0.1:8000`** only. **Omit Valkey
   initially** — see §11.
7. `SECRET_KEY` from `openssl rand -hex 32`, written straight into an operator-only env
   file (`chmod 600`). Never echoed, never in shell history, never committed.
8. `GLITCHTIP_DOMAIN=https://<observability-fqdn>`; `GLITCHTIP_MAX_EVENT_LIFE_DAYS=30`.
9. nginx reverse proxy on the same host, `127.0.0.1:8000` upstream; TLS via Let's Encrypt;
   HTTP→HTTPS redirect; modern cipher suite; HSTS.
10. Initialize the database, create the **first** admin account, then **disable open
    registration** (`ENABLE_USER_REGISTRATION=False` — **verify the exact variable name
    against the deployed image's own documentation**; older references use
    `ENABLE_OPEN_USER_REGISTRATION`). Verify no second account can self-register.
11. Enable MFA on the admin account **if the deployed GlitchTip version supports it** —
    `VERIFY_AT_PROVISIONING`, not asserted here. If unsupported, compensate with
    IP-restricted access to the UI and record the gap.
12. Create the `noramedi` organization and project; obtain the DSN. **Copy it directly
    from the UI into the destination — never print it to a terminal, a log, a screenshot,
    or this repository.**

### Stage 3 — deploy `main` to NoraMedi with **`SENTRY_DSN` still UNSET**

```bash
/usr/local/sbin/noramedi-deploy.sh          # or the standard invocation
git -C /var/www/noramedi rev-parse HEAD      # MUST equal c600ea70…  (or later main)
test -d /var/www/noramedi/server/node_modules/@sentry/node && echo SENTRY_NODE_INSTALLED=YES
pm2 jlist | ...                              # noramedi-api and noramedi-worker == online
/usr/local/sbin/noramedi-healthcheck.sh      # 401 counts as healthy
grep -qc '^SENTRY_DSN=.\+' server/.env || echo SENTRY_DSN_CONFIGURED=NO
```

**Acceptance:** dependency present on disk, both processes online, health OK, and **no SDK
runtime activation** — with no DSN the import is never even attempted, so there must be
zero Sentry-related log lines and zero outbound connections to the observability host.

### Stage 4 — activate

1. Confirm §8's register update is merged. **This is a hard gate, per `F3-OBS-001` §15.8
   step 2.**
2. Append `SENTRY_DSN=<value>` to `/var/www/noramedi/server/.env` with an editor.
   `chmod 600`. Never `echo`, never a here-string in an interactive shell, never `set -x`.
3. `RELEASE_SHA` needs **no** manual step — deploy step 4b derives it from the deployed
   SHA and exports it before `--update-env`. Confirm it equals the deployed SHA.
4. Re-run `noramedi-deploy.sh --skip-pull --skip-build --skip-migrate --skip-generate`.
   **`--update-env` is what propagates the new environment**; a bare `pm2 restart` will
   not. This is the only supported restart path.
5. Boolean-only verification: `SENTRY_DSN_CONFIGURED=YES`, `RELEASE_SHA_CONFIGURED=YES`,
   `RELEASE_SHA == deployed SHA`, `NODE_ENV=production`, `SENTRY_NODE_INSTALLED=YES`,
   `noramedi-api` and `noramedi-worker` `online`. **Never print the DSN.**

### Stage 5 — synthetic proof (exactly one event)

Use the **existing** approved one-shot mechanism: a throwaway host-side script invoking
`captureFatalError` directly, or a controlled existing 5xx path. **Do NOT add a public
error endpoint** and do not add any route.

**Acceptance criteria — all must hold:**

- Exactly **one** event appears in GlitchTip.
- `message` is **exactly** `internal error captured`.
- Tags: **only** `errType` ∈ {`Error`,`UnknownError`}, `role`, `requestId`.
- Extra: **only** `route`, and it is a **template**, never a real path.
- `environment` and `release` set; `release` equals the deployed SHA.
- **Absent:** everything in §5.2. Any single item present ⇒ **stop and revert** (§10.1).

### Stage 6 — health

API healthcheck; both PM2 processes `online`; error logs clean; GlitchTip event count
**exactly 1**; and — the check that proves the deny-by-default configuration — normal
request traffic for a sustained window generates **zero** additional auto-events.

---

## 10. Rollback — two independent paths

### 10.1 Telemetry deactivation (no code deploy, no provider involvement)

Remove or blank `SENTRY_DSN` in `server/.env`, re-run
`noramedi-deploy.sh --skip-pull --skip-build --skip-migrate --skip-generate` so PM2
reloads with `--update-env`. `captureFatalError` returns to a **pure no-op** and
`@sentry/node` is not imported at all. This is the stop-and-revert action for Stage 5.

### 10.2 Provider infrastructure (independent of NoraMedi)

`docker compose down` (or destroy the VPS) on the observability host. **NoraMedi's API is
unaffected**: the boundary is non-throwing end to end, `Sentry.init` failure is latched so
a broken SDK is not retried on every 5xx, and delivery failure never blocks or delays an
HTTP error response. This independence is a direct consequence of the separate-host
decision.

### 10.3 Full revert

`git revert` PR #416's merge commit, `npm ci` in `server/`, redeploy. Removes the
dependency and the `RELEASE_SHA` export.

**No database rollback in NoraMedi. No schema change, no migration, no data rollback, and
no NoraMedi-side state created by activation.**

---

## 11. Target architecture and sizing

**No Kubernetes. No Kafka. No microservices. No database-per-tenant. One VPS, Docker
Compose, four moving parts.**

```
  NoraMedi production host (existing, unchanged)          Türkiye observability VPS (new)
  ┌──────────────────────────────────────┐                ┌──────────────────────────────┐
  │ noramedi-api  (PM2, fork)            │                │ nginx :443 (TLS, LE)         │
  │   └─ errorTracking.ts ── HTTPS ──────┼──── 443 ──────▶│   └─▶ glitchtip web          │
  │ noramedi-worker (PM2, fork)          │                │        (127.0.0.1:8000)      │
  │ PostgreSQL (production, untouched)   │                │        └─▶ postgres (14+)    │
  └──────────────────────────────────────┘                │            (docker network,  │
    UFW default-deny; only 443 outbound to the            │             no host port)    │
    observability FQDN is added                           │ UFW: deny-in except 22*, 443 │
                                                          └──────────────────────────────┘
                                                            * SSH source-restricted
```

**Valkey is omitted initially.** GlitchTip documents Valkey/Redis 7+ as **optional**;
setting `VALKEY_URL` to an empty string makes it use PostgreSQL for cache, Celery and
sessions — **less RAM, slower**. At NoraMedi's F3 volume (one event per 5xx, expected tens
per day, not thousands) the throughput loss is irrelevant and the removed component is one
fewer network service, one fewer memory hog and one fewer thing to firewall. This is the
smallest F3-safe shape, and it is **not** a dead end: adding Valkey later is one compose
service plus one env var.

### 11.1 Minimum sizing

| | Absolute floor | **Recommended for F3** |
|---|---|---|
| vCPU | 1 (x86 or arm64) | **2** |
| RAM | 512 MB (project's *recommended* figure; 256 MB is its documented all-in-one minimum **without** Valkey) | **4 GB** — headroom for PostgreSQL + nginx + OS on the same box |
| Disk | 20 GB | **80 GB SSD** |
| Network | — | 443 in; SSH restricted |

Disk reference point: the project documents **~30 GB for a 1-million-event/month
instance**. NoraMedi's F3 expectation is several orders of magnitude below that, and
`GLITCHTIP_MAX_EVENT_LIFE_DAYS=30` caps growth regardless. 80 GB is chosen so that disk is
never the thing that fails first.

### 11.2 Scale-up triggers (measurable, not vibes)

| Trigger | Action |
|---|---|
| Sustained > **10,000 events/month** | Add the Valkey service; restore `VALKEY_URL` |
| Disk > **60 %** used, or projected 30-day growth exceeds free space | Grow the volume; reconsider retention |
| RAM steady-state > **75 %**, or the OOM killer fires once | 8 GB tier |
| Ingest latency or Celery backlog visible in the UI | Valkey first, then vCPU |
| More than one NoraMedi environment reporting into one instance | Separate GlitchTip **projects** first; separate hosts only if isolation is actually required |
| Ingest exceeds ~1M events/month | Re-architect deliberately — **out of F3 scope** |

---

## 12. Security baseline checklist (GlitchTip host)

**No secret value may be printed, logged, screenshotted or committed at any point.**

| # | Control | Requirement | Status |
|---|---|---|---|
| 1 | Türkiye hosting evidence | §6 E1–E5 collected and filed | `REQUIRED_BEFORE_STAGE_2` |
| 2 | OS | Current Ubuntu LTS, fully patched, rebooted | `REQUIRED` |
| 3 | SSH | Key-only; no root login; no password auth; source-restricted | `REQUIRED` |
| 4 | Firewall | UFW default-deny inbound; **only** SSH (restricted) + 443 | `REQUIRED` |
| 5 | TLS | Let's Encrypt, auto-renew, HTTP→HTTPS redirect, HSTS | `REQUIRED` |
| 6 | nginx | Reverse proxy to `127.0.0.1:8000`; app never bound to a public interface | `REQUIRED` |
| 7 | PostgreSQL isolation | Docker-internal network only; **no** published host port; not reachable off-host | `REQUIRED` — **STOP if public exposure is needed** |
| 8 | Valkey isolation | N/A initially; same rule if added | `N/A` |
| 9 | Admin account / MFA | First admin created, then self-registration disabled; MFA enabled **if the deployed version supports it** | `VERIFY_AT_PROVISIONING` |
| 10 | `SECRET_KEY` | `openssl rand -hex 32`, env file `chmod 600`, never echoed or committed | `REQUIRED` |
| 11 | DB credentials | Generated per-instance, stored only in the operator env file, never reused from NoraMedi | `REQUIRED` |
| 12 | SMTP | Default `consolemail://` sends nothing. Any real SMTP provider is a **new subprocessor** and an outbound channel — **prefer leaving email unconfigured for F3** | `DECIDE — default: none` |
| 13 | Backups | Nightly `pg_dump`, encrypted at rest, **stored in Türkiye**, restore tested at least once | `REQUIRED` |
| 14 | Encryption at rest | Distinguish **provider-side** (volume/snapshot encryption — needs a provider statement) from **guest-side** (LUKS/filesystem — NoraMedi-controlled and independently evidenceable). Record which is in force; do not assume | `EVIDENCE_REQUIRED` |
| 15 | Log retention | `GLITCHTIP_MAX_EVENT_LIFE_DAYS=30`; host/nginx log rotation bounded | `REQUIRED` |
| 16 | Patching | Unattended security upgrades; documented cadence for GlitchTip image updates | `REQUIRED` |
| 17 | Access control | Named human accounts only; no shared logins; access list recorded | `REQUIRED` |
| 18 | Incident rollback | §10.1 and §10.2 rehearsed before Stage 5 | `REQUIRED` |

---

## 13. Findings

### 13.1 Accepted

1. `origin/main` = `c600ea70…`; PR #416's head **and** merge commit are both in `main`.
2. Effective Node floor from PR #416 is **`^18.19.0 || >=20.6.0`**, driven by transitive
   `@opentelemetry/*@2.10.0`, **not** by `@sentry/node`'s own `>=18`.
3. The repository declares **no** `engines` field anywhere, so `npm ci` cannot enforce the
   floor and will not fail loudly on an incompatible host.
4. Production install (`npm ci`, devDependencies included) already handles a production
   dependency correctly — **no deploy-script change is needed** to install `@sentry/node`.
5. GlitchTip: Docker Compose supported; **PostgreSQL 14+** required; **Valkey/Redis 7+
   optional** (`VALKEY_URL=""` falls back to PostgreSQL); `SECRET_KEY` required;
   recommended 512 MB RAM / x86 or arm64, 256 MB documented all-in-one minimum; ~30 GB
   disk at 1M events/month; default event retention **90 days**, tunable via
   `GLITCHTIP_MAX_EVENT_LIFE_DAYS`.
6. GlitchTip is **Sentry-protocol compatible** and accepts the standard envelope endpoint;
   the merged boundary needs no change.
7. GlitchTip hosted: **US = DigitalOcean NYC1**, **EU = DigitalOcean FRA1 (Frankfurt)**,
   the EU instance behind Cloudflare with Mailgun for email — i.e. **multiple** onward
   relationships, not one.
8. Sentry SaaS offers **only** US and EU (Germany/Frankfurt) data regions, GA since
   2026-05-04. **No Türkiye region exists.**
9. KVKK Art. 9: no Türkiye adequacy decision for the EU is in evidence; the standard
   contract must be notified to the Authority **within five business days of signature**
   (physical, KEP, or `standartsozlesme.kvkk.gov.tr`).
10. Türkiye-located IaaS with İstanbul/Ankara datacenters is available from multiple
    providers — §6 is a procurement/documentation step, not a feasibility risk.
11. **New:** the separate-VPS direction invalidates `F3-OBS-001` §15.10's "runs on
    infrastructure already in the register" parenthetical. The **hosting** provider is a
    new relationship even though the **software** is not (§7.3).
12. **New:** the subprocessor register cannot presently evidence that the *existing*
    production host is in Türkiye (§7.4) — a pre-existing gap this task does not close.

### 13.2 Rejected / unverified

| Claim | Status | Why |
|---|---|---|
| Production Node satisfies `^18.19.0 \|\| >=20.6.0` | **`UNVERIFIED` — blocking for Stage 3** | No repository artifact records the production Node version; must be measured in Stage 1 |
| The existing NoraMedi production host is in Türkiye | **`UNVERIFIED`** | Register §1 marks provider identity **and** region `TO BE VERIFIED`; the "Hostinger" reference was never independently re-confirmed |
| GlitchTip supports admin MFA | **`UNVERIFIED`** | Not confirmed against the deployed version; §12 row 9 is `VERIFY_AT_PROVISIONING`, not asserted |
| Exact registration-disable variable is `ENABLE_USER_REGISTRATION` | **`AMBIGUOUS`** | Current docs use `ENABLE_USER_REGISTRATION`; older references use `ENABLE_OPEN_USER_REGISTRATION`. Verify against the deployed image |
| Any specific Türkiye VPS vendor is suitable | **`NOT_ASSESSED`** | Deliberately out of scope; vendor selection is the program owner's, and §6 is the acceptance test |
| GlitchTip's stated data residency satisfies KVKK | **`REJECTED as a KVKK argument`** | It is a GDPR/EU-residency statement. The EU is still "abroad" under Art. 9 |
| The hosting provider's precise KVKK role | **`LIKELY YES` processor/subprocessor — `COUNSEL`** | Depends on the platform-vs-clinic contracting structure, itself an open register question |
| KVKK compliance is achieved by Option A | **`NOT CLAIMED`** | Option A avoids a *new* transfer; it does not make the register complete or resolve any `TO BE VERIFIED` marker |
| `@sentry/core`-only alternative should replace `@sentry/node` | **`OUT_OF_SCOPE`** | Recorded in `F3-OBS-001` §15.6; not reopened here |

---

## 14. Sources re-verified for this task (2026-08-14)

- GlitchTip — [Install documentation](https://glitchtip.com/documentation/install/) ·
  [compose.sample.yml](https://glitchtip.com/assets/compose.sample.yml) ·
  [Hosted architecture](https://glitchtip.com/documentation/hosted-architecture/) ·
  [Sentry SDK documentation](https://glitchtip.com/sdkdocs/) · [home](https://glitchtip.com/)
- Sentry — [Data storage location (US or EU)](https://docs.sentry.io/organization/data-storage-location/) ·
  [Data storage location in Germany is generally available](https://sentry.io/changelog/data-storage-location-in-germany-is-generally-available/) ·
  [Where are your servers located?](https://help.sentry.io/account/legal/where-are-your-servers-located/)
- KVKK — [Transfer of personal data abroad](https://www.kvkk.gov.tr/Icerik/6642/Transfer-of-Personal-Data-Abroad) ·
  [Procedures and principles for the transfer of personal data abroad](https://www.kvkk.gov.tr/Icerik/7997/The-Procedures-And-Principles-For-The-Transfer-Of-Personal-Data-Abroad) ·
  [Standart Sözleşme Bildirim Modülü hakkında kamuoyu duyurusu](https://www.kvkk.gov.tr/Icerik/8043/Standart-Sozlesme-Bildirim-Modulu-Hakkinda-Kamuoyu-Duyurusu) ·
  [Standard contract 2 (controller to processor)](https://www.kvkk.gov.tr/Icerik/7993/Standard-Contract-for-the-Transfer-of-Personal-Data-Abroad-2-Controller-to-Processor-)

---

## 15. Lifecycle and program state

- Repository work (this document): `AGENT_COMPLETED`
- Tests: **`N/A` — documentation-only change**, no runtime code touched
- `DEPLOYED = NO` · `PRODUCTION_VERIFIED = NO`
- Provider **model** adopted: **YES (Option A)** · Provider **deployed**: **NO** ·
  DSN configured: **NO** · Synthetic event sent: **NO** · Provider-UI verification:
  `NOT_PERFORMED`
- Migrations: **NONE** — no schema change, no migration, no data change, no new route, no
  new PM2 app, no `ecosystem.config.cjs` change
- Tenant isolation impact: **NONE** — no tenant-scoped code path is touched
- Security impact: **NONE in this PR**; the baseline in §12 governs the future host
- **`F3-SEC-EXIT-001` §5 item 10: `NOT_SATISFIED`.** A decision is not an activation;
  §9 Stages 2–6 are unperformed.
- **`F3_EXIT_CRITERION_2 = NOT_SATISFIED`** — blocking reason 5 is narrowed again, not
  closed; reasons 1–4 and 6–7 are untouched.
- `F3_EXIT_CRITERION_3`: not touched, not assessed.
- **`F3_EXIT_GATE = NOT SATISFIED` · `F3_COMPLETE = NO` · `F4_TRANSITION_AUTHORIZED = NO`.**
