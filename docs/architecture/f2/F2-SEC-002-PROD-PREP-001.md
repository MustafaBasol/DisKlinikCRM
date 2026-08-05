# F2-SEC-002-PROD-PREP-001 — WhatsApp Production Topology Verification (Read-Only)

Evidence classifications follow the [`docs/program/evidence/README.md`](../../program/evidence/README.md) legend: `VERIFIED_GIT`, `VERIFIED_GITHUB`, `VERIFIED_REPOSITORY`, `OBSERVED_LOCAL_ONLY`, `UNVERIFIED_PRODUCTION`, `VERIFIED_PRODUCTION_OBSERVED`, `CONFLICTING_EVIDENCE`, `NOT_APPLICABLE`. This document is task-scoped evidence, not the authoritative live-status source — that remains [`NORAMEDI_MASTER_TRACKER.md`](../../program/NORAMEDI_MASTER_TRACKER.md).

## 1. Task identity

| Field | Value |
|---|---|
| Task ID | F2-SEC-002-PROD-PREP-001 |
| Task name | Read-only WhatsApp production topology verification |
| ClickUp task | [`869ee40rf`](https://app.clickup.com/t/869ee40rf) |
| Repository | `MustafaBasol/DisKlinikCRM` |
| Base branch | `main` |
| Runs parallel to | `F2-GUARDRAIL-IMPL-001` — this task did not touch guardrail implementation files, CI workflows, static-analysis scripts, imaging modules, or any other active worktree/branch |
| Evidence date | 2026-08-05 |
| Mandate | Read-only verification only: no deploy, no restart, no DB write, no migration, no env change, no secret/token access, no PII export |

## 2. Baseline SHA

| Item | Value | Classification |
|---|---|---|
| `origin/main` at task start | `da23f6fd4b86d4a37dc56f90859b0806f8ce60c6` | `VERIFIED_GIT` (`git fetch origin --prune && git rev-parse origin/main`) |
| Working tree status at start | Clean (`git status --short` empty) | `VERIFIED_GIT` |
| Branch created | `docs/f2-sec-002-prod-prep-001`, from `origin/main` | `VERIFIED_GIT` |
| Worktree path | `E:/Ek Gelir/Siteler/DisKlinikCRM-f2-sec-002-prod-prep` | `OBSERVED_LOCAL_ONLY` |
| Command | `git worktree add ../DisKlinikCRM-f2-sec-002-prod-prep -b docs/f2-sec-002-prod-prep-001 origin/main` | — |

The repository has many other active worktrees (including `F2-GUARDRAIL-IMPL-001` at `E:/Ek Gelir/Siteler/DisKlinikCRM-git-f2-guardrail-impl-001`, HEAD `da23f6f`); none were read from, written to, or merged into this branch.

## 3. F2-SEC-002 merge evidence

| Fact | Value | Classification |
|---|---|---|
| PR | [#319](https://github.com/MustafaBasol/DisKlinikCRM/pull/319) — "fix(whatsapp): F2-SEC-002 remove global default-clinic resolution" | `VERIFIED_GITHUB` (`gh pr view 319`) |
| State | `MERGED` | `VERIFIED_GITHUB` |
| Merge commit | `09ee20b7f1f655a4025a32927a8e81e596e1bb97` | `VERIFIED_GITHUB` |
| Merged at | `2026-08-04T20:44:22Z` | `VERIFIED_GITHUB` |
| Base ↔ head | `main` ← `fix/f2-sec-002-whatsapp-explicit-clinic-resolution` | `VERIFIED_GITHUB` |
| Ancestor of `origin/main`? | Yes — `git merge-base --is-ancestor 09ee20b7f1f655a4025a32927a8e81e596e1bb97 origin/main` exits 0 | `VERIFIED_GIT` |
| Files changed (PR #319, authoritative) | `docs/program/evidence/F2-SEC-002_WHATSAPP_EXPLICIT_CLINIC_RESOLUTION.md`, `server/package.json`, `server/src/routes/whatsapp.ts`, `server/src/tests/dbVerification/whatsappPublicApiExplicitClinicBinding.test.ts` | `VERIFIED_GITHUB` (`gh pr view 319 --json files`) |
| Post-merge main CI on `09ee20b` | `ci-main-and-nightly`, `push` trigger, run `30949232722`, conclusion `success`; also a later `schedule`-triggered run `30972254219`, conclusion `success` | `VERIFIED_GITHUB` (`gh run list --commit 09ee20b...`) |
| Schema/migration files touched | None — no `server/prisma/schema.prisma` or `server/prisma/migrations/**` entries in the file list above | `VERIFIED_GITHUB` |
| `server/package.json` diff content | Only `server:test:disposable-db` and `server:test:legacy-db-required` script strings extended with new test names — no `dependencies`/`devDependencies` change, no `package-lock.json` change in the PR | `VERIFIED_GIT` (`git show 09ee20b -- server/package.json`) |

## 4. Production HEAD evidence

**`NOT_VERIFIED`.**

No SSH session or other read-only production access was available in this task execution. A local probe of this environment's own SSH client/config (to establish whether a route to production even exists) was attempted and denied by the operator before any command reached a network boundary. Per the task's "Erişim yoksa davranış" instructions, this was treated as the access-not-available signal, the probe was not retried, and no further attempt was made to reach production.

Consequently:
- Production application-directory presence (`/var/www/noramedi`) — `NOT_VERIFIED`
- Production `git rev-parse HEAD` — `NOT_VERIFIED`
- Production working-tree cleanliness — `NOT_VERIFIED`

## 5. Production deployment status

**`UNKNOWN`** — whether merge commit `09ee20b7f1f655a4025a32927a8e81e596e1bb97` (or a descendant) is running in production cannot be determined without §4. It must not be inferred from CI success, merge state, or any prior evidence document.

A prior, unrelated evidence document exists — [`docs/program/PRODUCTION_TOPOLOGY.md`](../../program/PRODUCTION_TOPOLOGY.md) (source task F0-006, evidence timestamp `2026-07-19T13:43:12+03:00`) — and is cited throughout §6–§8 below for **topology/process architecture**, which is structural and does not change per-deploy. It is explicitly **not** usable as deployment-currency evidence here: its evidence timestamp (2026-07-19) predates the F2-SEC-002 merge (2026-08-04) by roughly two weeks, so it cannot speak to whether `09ee20b` specifically is deployed. Classification for any claim sourced from it: `UNVERIFIED_PRODUCTION` (as originally classified in that document) with respect to current state; the topology facts themselves remain the best available reference absent live access.

## 6. Runtime process topology

| Fact | Value | Classification |
|---|---|---|
| API process name | `noramedi-api` (PM2, fork mode) | `VERIFIED_PRODUCTION_OBSERVED` per F0-006 (2026-07-19), cited via `PRODUCTION_TOPOLOGY.md` §2–§3 |
| API entrypoint | `server/src/index.ts` (`npm run start` → `npx prisma generate && tsx src/index.ts`) | `VERIFIED_REPOSITORY` (`server/package.json`) |
| Worker process name | `noramedi-worker` (PM2, fork mode) | `VERIFIED_PRODUCTION_OBSERVED` per F0-006, cited |
| Worker entrypoint | `server/src/worker.ts` (`npm run start:worker`) | `VERIFIED_REPOSITORY` |
| Does `server/src/routes/whatsapp.ts` (the file F2-SEC-002 changed) load into the worker process? | **No.** `grep -rn "routes/whatsapp"` across `server/src` matches only `server/src/index.ts` (plus unrelated files: `logRedaction.ts`, test files, `metaWhatsAppAiProcessor.ts`, `appointmentAvailabilityService.ts` — none of which is `worker.ts`). `worker.ts` has no import referencing `whatsapp` at all. | `VERIFIED_REPOSITORY` |
| Conclusion | The F2-SEC-002 change affects only the `noramedi-api` process. `noramedi-worker` does not need to restart or rebuild for this change to take effect. | Derived from the two rows above |
| API restart/reload mechanism | `pm2 reload noramedi-api --update-env`, invoked only by `scripts/noramedi-deploy.sh` step 5 | `VERIFIED_REPOSITORY` (script content) + `VERIFIED_PRODUCTION_OBSERVED` per F0-006 that this is the actual production mechanism |
| Worker restart/reload mechanism | Not defined anywhere in this repository; external to the codebase | `VERIFIED_REPOSITORY` (absence) + F0-006 finding, cited |
| PM2 process definition source | No `ecosystem.config.*` in the repository — process registration (name, cwd, restart policy) originates entirely outside this repository | `VERIFIED_REPOSITORY` (absence), cited from F0-006 |

## 7. WhatsApp provider topology

| Fact | Value | Classification |
|---|---|---|
| Providers present in codebase | Meta Cloud API (`server/src/routes/metaWhatsAppWebhook.ts`, `server/src/services/whatsapp/metaWhatsAppAiProcessor.ts`, `server/src/jobs/metaTemplateSyncJob.ts`) and Evolution API (`server/src/services/evolutionApi.ts`) | `VERIFIED_REPOSITORY` |
| Provider selection granularity | Per-connection: `WhatsAppConnection.provider` field, linked to a clinic via `ClinicWhatsAppConnection`; not a single global provider switch | `VERIFIED_REPOSITORY` (schema fields referenced in `whatsapp.ts`) |
| Which provider path does F2-SEC-002 affect? | **Evolution API only.** `resolveWhatsappPublicApiConnection` in the changed code explicitly filters `where: { isActive: true, provider: 'evolution_api' }`. The route file's own header comment states the scope is intentionally Evolution-only, since Meta Cloud API has a fully separate webhook route (`routes/metaWhatsAppWebhook.ts`) untouched by this PR. | `VERIFIED_GIT` (diff of `fb4e23766478db413f9e34f009302d4f4f0948f7`) |
| Are both providers active in the current production deployment simultaneously? | `UNVERIFIED_PRODUCTION` — this requires a `WhatsAppConnection` table read, which is both a production-DB query (unavailable per §4) and out of this task's read-only-metadata scope (no patient/connection data was requested even hypothetically) | `UNVERIFIED_PRODUCTION` |
| Is provider choice clinic-specific or connection-specific? | Connection-specific (a `WhatsAppConnection` row), then bound to clinic(s) via `ClinicWhatsAppConnection` links — i.e. effectively per-clinic through the link table, not a single organization-wide toggle | `VERIFIED_REPOSITORY` |

No provider credential, token, or webhook-secret value was read, logged, or reported anywhere in this evidence.

## 8. Deployment scope

| Question | Answer | Basis |
|---|---|---|
| Migration required? | **No.** PR #319 touches no `server/prisma/schema.prisma` or `server/prisma/migrations/**` file. The `WhatsAppConnection.webhookSecret` column the new logic reads already existed prior to this PR (present in the parent commit `2452b8c` schema at the time of the merge). | `VERIFIED_GIT` |
| Backend rebuild required? | **Yes, for `noramedi-api` only.** The route/middleware logic in `server/src/routes/whatsapp.ts` changed; the process runs via `tsx` directly against source (no separate compile artifact observed in the deploy script beyond `prisma generate`), so "rebuild" here means the running process must be reloaded against the new source — i.e. a `pm2 reload noramedi-api` after the code is present on disk. | `VERIFIED_REPOSITORY` §6, §4 |
| Frontend rebuild required? | **No.** No file under `src/` (the Vite frontend) is part of PR #319's file list. | `VERIFIED_GITHUB` (§3 file list) |
| Worker restart/rebuild required? | **No.** See §6 — `worker.ts` does not import the changed file. | `VERIFIED_REPOSITORY` |
| Environment/config change required? | **No new variable.** The change reuses `ENCRYPTION_KEY` (already a required, fatal-checked variable — see §9) to decrypt existing `WhatsAppConnection.webhookSecret` values, and reuses the existing `WHATSAPP_WEBHOOK_SECRET` variable (same name, no rename), now explicitly demoted in code to a `LEGACY_SINGLE_CONNECTION_COMPATIBILITY` fallback path rather than the primary resolution mechanism. | `VERIFIED_GIT` (diff) |
| Backward-compatibility risk | **Yes — a real behavior change, by design.** The legacy global `WHATSAPP_WEBHOOK_SECRET` path (`resolveWhatsappPublicApiConnection`) now only resolves when (a) no connection-specific secret matches the provided credential, **and** (b) exactly one active Evolution `WhatsAppConnection` exists. R0 previously accepted the global secret whenever exactly one connection existed, with no requirement that the *caller's* credential be anything more than "the one shared secret." If production currently runs more than one active Evolution connection and any legitimate caller was relying on the global secret alone (rather than a connection-specific `webhookSecret`), that caller starts receiving a generic `404` after this deploys. This is the intended fix (R0's ambiguity was the vulnerability), but it is a behavior change worth an explicit post-deploy check — see §11. | `VERIFIED_GIT` (diff), `UNVERIFIED_PRODUCTION` for whether this specific condition exists today |

## 9. Environment/configuration assessment

Variable names only — no values were read or are reported, consistent with [`ENVIRONMENT_MATRIX.md`](../../program/ENVIRONMENT_MATRIX.md)'s own convention.

| Variable | Role in F2-SEC-002 | New in this PR? | Classification |
|---|---|---|---|
| `ENCRYPTION_KEY` | Decrypts stored `WhatsAppConnection.webhookSecret` values (`decryptSecretTagged`, imported from the pre-existing `server/src/utils/encryption.ts`) | No — pre-existing, required/fatal-checked variable (see `ENVIRONMENT_MATRIX.md` §1) | `VERIFIED_GIT` (utility predates this PR by several commits; not touched by PR #319) |
| `WHATSAPP_WEBHOOK_SECRET` | Retained as the `LEGACY_SINGLE_CONNECTION_COMPATIBILITY` fallback only | No — same variable name as before, role narrowed in code, not renamed or newly introduced | `VERIFIED_GIT` |

No variable needs to be added, renamed, or removed for this deployment.

## 10. Migration assessment

No migration is required or included. See §8. If a future change to this area does introduce a migration, the deploy script's existing ordering (`git pull` → `npm ci` → `prisma migrate deploy` → `prisma generate` → `pm2 reload noramedi-api`, per `scripts/noramedi-deploy.sh`, `VERIFIED_REPOSITORY`) already runs migrations before the reload step; that ordering is unaffected by this task and was not modified.

## 11. Production verification plan

No production verification has been executed under this task — this is a plan for a human operator to run after deploy, using no real patient data.

**Pre-deploy checks**
1. Confirm current production HEAD via `git -C /var/www/noramedi rev-parse HEAD` and record it (needed for §12 rollback).
2. Confirm working tree is clean: `git -C /var/www/noramedi status --short`.
3. Confirm `git merge-base --is-ancestor 09ee20b7f1f655a4025a32927a8e81e596e1bb97 <current-production-HEAD>` is currently **false** (i.e. the fix is not yet present) — sanity-checks that this plan is being run against the right pre-state.

**Post-deploy technical smoke checks (no real WhatsApp message)**
4. `pm2 describe noramedi-api` — confirm process is `online`, uptime resets to just after the reload, restart count as expected.
5. `pm2 describe noramedi-worker` — confirm this process was **not** restarted by the deploy (per §6/§8, it shouldn't need to be) and is still `online` with its prior uptime.
6. `GET /api/health` — confirm `200`/healthy response (per `PRODUCTION_TOPOLOGY.md` §3, DB-backed, unauthenticated).
7. `git -C /var/www/noramedi rev-parse HEAD` — confirm it now equals or descends from `09ee20b7f1f655a4025a32927a8e81e596e1bb97`.
8. Call one legacy public API route (e.g. `GET /api/public/whatsapp/services`) with **no** credential — expect `401`, matching the pre-existing (unchanged) "no credential" behavior.
9. Call the same route with a deliberately wrong/garbage credential — expect the new generic `404` (per the non-enumeration design in the merged code), not a `500` or a `401`.

**Provider-based checks**
10. If more than one active Evolution `WhatsAppConnection` exists in production (read-only count query only, e.g. `SELECT count(*) FROM "WhatsAppConnection" WHERE "isActive"=true AND provider='evolution_api';` — count only, no row contents), treat §8's backward-compatibility risk as live: confirm with the connection owner(s) that each relies on its own connection-specific secret, not the shared `WHATSAPP_WEBHOOK_SECRET`, before or immediately after deploy.
11. Confirm the Meta Cloud API webhook path (`routes/metaWhatsAppWebhook.ts`) is untouched: its own health/behavior should show **no** change before/after this deploy, since PR #319 never modifies that file.

**Log verification (no PII)**
12. Tail application logs immediately after deploy filtering only for the new log labels introduced by this change — `[whatsapp-public-api] secret matches multiple connections`, `[whatsapp-public-api] no connection credential match`, `[whatsapp-public-api] resolved via LEGACY_SINGLE_CONNECTION_COMPATIBILITY`, `[whatsapp-public-api] cross-org denormalization`, `[whatsapp-public-api] connection resolution error` — to confirm the code path is reachable and behaving as expected. None of these log lines include secret values, patient data, or message content by design (verified in the diff — they log counts and booleans only). Do not search these logs for patient names, phone numbers, or message content under any circumstance.

**Human-controlled verification (not automated)**
13. If a real end-to-end WhatsApp message test is desired, that must be a manual, human-initiated action using a test/internal number — explicitly **not** to be scripted or run by an agent, per this task's constraints.

**Rollback triggers** — see §12 for the mechanism; trigger conditions:
- `/api/health` fails to return healthy within the deploy script's existing retry window.
- `noramedi-api` fails to reach/stay in `online` PM2 state.
- The legacy public API starts returning `500` (resolution code throwing) rather than the expected `401`/`404` set on step 8/9.
- A legitimate, previously-working caller unexpectedly starts receiving `404` post-deploy and step 10 above was not completed beforehand (i.e. the backward-compatibility risk materialized without warning).

## 12. Rollback plan

No migration is included in this change (§8, §10), so **backend-only rollback is sufficient** — no migration-down step, no data-shape reconciliation.

1. **Record the pre-deploy SHA** — step 1 of §11's pre-deploy checks captures the exact previous production HEAD before this deploy runs. This is the value to roll back to.
2. **Rollback mechanism**: on `/var/www/noramedi`, check out the recorded pre-deploy SHA and reload only `noramedi-api`:
   ```
   git -C /var/www/noramedi checkout <recorded-pre-deploy-sha>
   pm2 reload noramedi-api --update-env
   ```
   (Commands listed for operator reference; not executed by this task.)
3. **`noramedi-worker` is not involved** in either the forward deploy or the rollback, per §6/§8 — it does not need to be touched in either direction.
4. **Process health check after rollback**: repeat §11 steps 4 and 6 (`pm2 describe noramedi-api`, `GET /api/health`) to confirm the rollback itself succeeded.
5. **No database rollback is needed or possible via migration-down**, since no migration ran forward. If the `LEGACY_SINGLE_CONNECTION_COMPATIBILITY` behavior change (§8) caused a legitimate caller to be locked out before rollback, no data was altered — rollback alone restores the prior (R0) behavior for that caller.

## 13. Security and privacy constraints

Confirmed honored throughout this task:
- No deploy, restart, migration, or environment-variable change was performed.
- No production SQL was executed (no read or write); no production database connection was opened.
- No `.env` file (local or production) was printed.
- No secret, token, API key, webhook secret, or connection string was read or reported. All environment-variable references in this document are names only.
- No patient name, phone number, message content, or other real patient data was read, searched for, or included anywhere in this document.
- No log search for PII was performed (none was possible — no production log access existed).
- No test WhatsApp message was sent.
- The one local-environment probe attempted (checking for an SSH client/config in this session) was denied before any network boundary was reached, and was not retried.

## 14. Access limitations

Production SSH or any other read-only production access **was not available** in this task's execution environment. The attempted local probe of SSH availability was denied by the operator; per the task's defined fallback, this was treated as "access not available" rather than something to work around, escalate past, or request credentials for.

**Full read-only command list to run once access is granted** (all previously authorized by this task's brief; none executed here):

```bash
# Production commit status
git -C /var/www/noramedi rev-parse HEAD
git -C /var/www/noramedi status --short
git merge-base --is-ancestor 09ee20b7f1f655a4025a32927a8e81e596e1bb97 <production-HEAD-from-above>

# Runtime topology
pm2 list
pm2 describe noramedi-api
pm2 describe noramedi-worker
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'   # expected empty/N-A per PRODUCTION_TOPOLOGY.md §4 (bare-VPS, no Docker in this topology)

# Post-deploy smoke (§11)
curl -sS -o /dev/null -w '%{http_code}\n' https://api.noramedi.com/api/health
curl -sS -o /dev/null -w '%{http_code}\n' https://api.noramedi.com/api/public/whatsapp/services            # expect 401, no credential
curl -sS -o /dev/null -w '%{http_code}\n' -H 'x-whatsapp-secret: not-a-real-secret' https://api.noramedi.com/api/public/whatsapp/services   # expect 404, not 500

# Provider topology (count only, no row contents)
# via whatever read-only DB console access is authorized:
#   SELECT count(*) FROM "WhatsAppConnection" WHERE "isActive"=true AND provider='evolution_api';
```

## 15. Final disposition

**`ACCESS_BLOCKED`**

Repository-side analysis for F2-SEC-002 is complete and internally consistent (§3, §6–§10): the merge is confirmed on `origin/main`, the change is scoped to one process (`noramedi-api`) and one provider path (Evolution API only), requires no migration/env change/frontend rebuild/worker restart, and carries one identified, explicit backward-compatibility risk (§8, §11 step 10) to check post-deploy. None of this can be cross-checked against actual production state without live read-only access, which was not available in this execution. No production fact in this document should be treated as verified beyond what is explicitly marked `VERIFIED_PRODUCTION_OBSERVED` (all of which is sourced from the pre-existing, dated F0-006 evidence, not from this task).
