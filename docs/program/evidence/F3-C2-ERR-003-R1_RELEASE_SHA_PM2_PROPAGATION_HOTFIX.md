# F3-C2-ERR-003-R1 — RELEASE_SHA PM2 propagation hotfix

**Phase:** F3 — Production Hardening · Criterion 2 · §5 item 10 (external error tracking)
**Baseline (branch base):** `65afcfb3f2bca6a95f2535cc4abfa77065b4f699` (`origin/main`, the currently deployed production commit)
**Pre-deploy production SHA (prior release):** `0478c86bf97b74b2aa9f465130d2a4daaa3579ec`
**Migration impact:** none
**Secrets/DSN impact:** none — `SENTRY_DSN` is neither introduced, referenced, nor activated

This document does **not** mark §5 item 10 PASS and does **not** mark Criterion 2 satisfied.

---

## 1. Production finding this hotfix addresses

The F3-C2-ERR-001 deploy succeeded and the application is healthy:

| Fact | Value |
|---|---|
| Deployed SHA | `65afcfb3f2bca6a95f2535cc4abfa77065b4f699` |
| Node / npm | v22.23.1 / 10.9.8 |
| `@sentry/node` | 10.70.0 |
| Prisma migrations | 73 found, 0 pending |
| `noramedi-api` / `noramedi-worker` | online / online |
| Health | HTTP 200 |
| `SENTRY_DSN` | unset (intended) |

Final verification nevertheless reported, for **both** processes:

```
RELEASE_SHA_CONFIGURED=NO
RELEASE_SHA_MATCH=NO
```

→ `DEPLOYED=YES`, `PRODUCTION_VERIFIED=NO`. No application rollback was or is warranted: the defect degrades error-event attribution only (an empty `release` tag once a DSN is configured), not availability or data handling.

Evidence classification: `VERIFIED_PRODUCTION_OBSERVED` for the table above (operator-supplied), `VERIFIED_REPOSITORY` for every repository claim below.

## 2. Root cause

`scripts/noramedi-deploy.sh` derived and exported the release id correctly:

```sh
RELEASE_SHA="${RELEASE_SHA:-$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || echo unknown)}"
export RELEASE_SHA
pm2 startOrReload "$ECOSYSTEM_FILE" --only "$PM2_API_NAME" --update-env
```

but `ecosystem.config.cjs` did not declare `RELEASE_SHA` in either app's `env:` block. The F3-C2-ERR-001 assumption was that `--update-env` propagates the exported shell variable into the reloaded processes. Live production evidence disproves that assumption, and PM2's own documentation explains it:

> "Via CLI, the environment is *conservative* meaning that, when you will run different process management actions (restart, reload, stop/start), new environment variables will not be updated into your application."
>
> "If you are using Ecosystem file to manage your application environment variables under the `env:` attribute, the updated ones will always be updated on `pm2 <restart/reload> app`."
>
> — [PM2 Documentation → Best Practices → Environment Variables](https://pm2.io/docs/runtime/best-practices/environment-variables/)

Complementary primary source: [PM2 → Environment Variables](https://pm2.keymetrics.io/docs/usage/environment/) documents the injection order **when starting a new process** — the shell environment first, then the ecosystem `env:` block overriding it. Both processes were already registered/running, so the reload path applied the recorded environment, not the deploy shell's.

The behavioural gap between "`--update-env` with an ecosystem file" and "`--update-env` with an app name" is a known, long-standing PM2 report ([Unitech/pm2#3192](https://github.com/Unitech/pm2/issues/3192), [#3796](https://github.com/Unitech/pm2/issues/3796)); the ecosystem `env:` attribute is the mechanism PM2 *documents as guaranteed*, so that is what this fix uses.

## 3. Fix (smallest reliable option)

Option A from the task brief — declare the variable in the ecosystem `env:` blocks — with one addition: a git-HEAD fallback so the guarantee holds for every repository-supported reload path, not only a full `noramedi-deploy.sh` run.

**`ecosystem.config.cjs`**

```js
function resolveReleaseSha() {
  const supplied = (process.env.RELEASE_SHA || '').trim();
  if (supplied) return supplied;

  try {
    const head = execFileSync('git', ['-C', __dirname, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return head || 'unknown';
  } catch {
    return 'unknown';
  }
}

const RELEASE_SHA = resolveReleaseSha();
```

…referenced as `RELEASE_SHA,` inside both apps' `env:` blocks.

Why this is correct and minimal:

- The ecosystem file is a plain CommonJS module that the PM2 CLI `require`s, so `process.env.RELEASE_SHA` is read **in the deploy shell**, at reload time — the value is never hard-coded and never stale.
- PM2 guarantees `env:` values are re-applied on every restart/reload (quoted above); that is precisely the guarantee the previous implementation lacked.
- Precedence deliberately mirrors the deploy script: operator/deploy-supplied value wins, then this checkout's git HEAD, then the literal `"unknown"`. `__dirname` is `$APP_DIR` (the ecosystem file lives at the deployed repository root), so the fallback resolves to the *deployed* commit.
- Nothing may throw: a config-load failure would abort a deploy, so every failure mode degrades to `"unknown"`.
- The fallback also fixes the reboot/manual path (`pm2 startOrReload ecosystem.config.cjs` without the deploy script), which under a bare Option A would have overwritten a correct value with an empty one.

**`scripts/noramedi-deploy.sh`**

- Step 4b comment corrected: the export is still required (it is the input the ecosystem file reads) but is *not* by itself what propagates the value.
- New **step 8b**: after both processes are online, the script reads `pm2 jlist` and prints, per app, `RELEASE_SHA_CONFIGURED=YES/NO RELEASE_SHA_MATCH=YES/NO`. Deliberately **non-fatal** — a missing release tag never makes the deployed application unhealthy, so it must not abort an otherwise successful deploy; it is reported loudly instead. The helper prints only a single state word (`match` / `mismatch` / `unset` / `missing`); no environment value can reach the deploy log through it.

Explicitly **not** done: no literal SHA anywhere, no `server/.env` persistence, no new secret, no `SENTRY_DSN` change, no new endpoint, no GlitchTip provisioning, no F4 work.

## 4. Files changed

| File | Change |
|---|---|
| `ecosystem.config.cjs` | `resolveReleaseSha()` + `RELEASE_SHA` declared in both apps' `env:` blocks; rationale/primary-source comment |
| `scripts/noramedi-deploy.sh` | corrected step 4b rationale; added non-fatal step 8b propagation verification (`release_sha_state_of`) |
| `server/src/tests/deployReleaseShaPropagation.test.ts` | new — 26 regression assertions (see §5) |
| `server/package.json` | registered `test:deploy-release-sha-propagation`; added it to `server:test:non-disposable` |

## 5. Tests

New suite: `server/src/tests/deployReleaseShaPropagation.test.ts`. It loads the real `ecosystem.config.cjs` the way PM2 does — a child Node process that `require`s it with a controlled environment — and statically scans the deploy script.

| Required proof | Covered by |
|---|---|
| 1. Contract consumes deployment `RELEASE_SHA` dynamically | §1 — two different supplied SHAs produce two different declared values |
| 2. SHA never hard-coded | §2 — no 40-char commit id and no quoted hex-like literal in either file; config must reference `process.env.RELEASE_SHA` |
| 3. API and worker both receive it | §3 — per-app `env` ownership checks, both apps still reloaded from the ecosystem file |
| 4. Process roles unchanged | §4 — `NORAMEDI_PROCESS_ROLE` api/worker, exactly two apps, unchanged entrypoints |
| 5. `RUN_BACKGROUND_JOBS=false` API-only | §5 — API `'false'`, key absent on worker |
| 6. No `SENTRY_DSN` in ecosystem config | §6 — absent from both env blocks, declared key sets asserted exactly; deploy script mentions it only in comments |
| 7. Deploy script still derives SHA from deployed git HEAD | §7 — `git -C "$APP_DIR" rev-parse HEAD`, export ordered before the PM2 reloads, `|| echo unknown` degradation |
| 8. Operator-supplied override intentionally retained | §8 — `${RELEASE_SHA:-…}` precedence, supplied value beats git HEAD, unset falls back to git HEAD/`unknown`, blank value treated as unset |
| (added) deploy-time verification exists and cannot fail a healthy deploy | §9 |

**Regression proof (fails on the pre-fix implementation).** With `ecosystem.config.cjs` and `scripts/noramedi-deploy.sh` restored to the pre-fix `HEAD` versions and the new suite unchanged:

```
Results: 16 passed, 10 failed
```

failing exactly on the propagation/consumption assertions (`RELEASE_SHA` absent from both apps' env, no `process.env.RELEASE_SHA` reference, override/fallback behaviour, deploy-time verification). After the fix: **26 passed, 0 failed**.

### Commands and results

| Command | Result |
|---|---|
| `cd server && npx tsx src/tests/deployReleaseShaPropagation.test.ts` | **26 passed, 0 failed** |
| `cd server && npx tsx src/tests/processRole.test.ts` | **8 passed, 0 failed** |
| `cd server && npx tsx src/tests/backgroundJobsOwnership.test.ts` | **10 passed, 0 failed** |
| `cd server && npx tsx src/tests/errorTracking.test.ts` | **24 passed, 0 failed** |
| `npx tsx scripts/ci-classify/__tests__/classify.test.ts` | **22 passed, 0 failed** |
| `cd server && npm run typecheck` | exit 0 |
| `npm run guardrail:scan` | exit 0 |
| `bash -n scripts/noramedi-deploy.sh` | exit 0 |
| `node -e "require('./ecosystem.config.cjs')"` | exit 0 |

`ecosystem.config.cjs` classifies as `UNKNOWN` in the path-aware PR CI classifier (`scripts/ci-classify`), i.e. it fails safe to the full lane — unchanged by this hotfix and asserted by the classifier's own test.

## 6. Rollback (exact, additive)

The change is additive and self-contained:

1. `git revert <hotfix merge/commit SHA>` (or `git checkout <previous SHA> -- ecosystem.config.cjs scripts/noramedi-deploy.sh server/package.json && rm server/src/tests/deployReleaseShaPropagation.test.ts`)
2. Redeploy through the supported path, or reload directly:
   `pm2 startOrReload /var/www/noramedi/ecosystem.config.cjs --only noramedi-api --update-env` then the same for `noramedi-worker`
3. `/usr/local/sbin/noramedi-healthcheck.sh --local` → expect exit 0; both PM2 processes `online`

Post-rollback state equals today's production behaviour (healthy application, `RELEASE_SHA` unset on both processes). No migration, no data change, no configuration file to restore.

## 7. Tenant / security / KVKK impact

None. `RELEASE_SHA` is a non-secret commit identifier already visible in `git log` and in the deploy log. No tenant, patient, PHI, or PII data is read, written, logged, or transmitted. No KVKK data-flow change; the F3-C2-ERR-002 provider decision and classification are untouched. `SENTRY_DSN` remains unset in production and remains outside this repository (server `.env`), and the new deploy-time check prints only a state word, never an environment value.

## 8. Production reverification (operator, after merge — not executed from the agent session)

Deploy/reload through the supported path with `SENTRY_DSN` unset. Required acceptance:

```
DEPLOYED_SHA=<new merged main SHA>

noramedi-api:      status=online  SENTRY_DSN_CONFIGURED=NO  RELEASE_SHA_CONFIGURED=YES  RELEASE_SHA_MATCH=YES
noramedi-worker:   status=online  SENTRY_DSN_CONFIGURED=NO  RELEASE_SHA_CONFIGURED=YES  RELEASE_SHA_MATCH=YES

HEALTH_EXIT=0
```

Step 8b of the deploy script now prints the `RELEASE_SHA_CONFIGURED` / `RELEASE_SHA_MATCH` pair for both processes during the deploy itself. Use timestamp-bounded log queries only; undated historical PM2 log tails are not evidence of a new failure.
