# F1-003-P2 — Disposable PostgreSQL and MinIO Provisioning and Collision Avoidance: Implementation and Verification

**Status: `AGENT_COMPLETED` — implementation complete, locally runtime-verified, PR opened, not merged. Maximum status: `AGENT_COMPLETED` / `PR_OPENED_AWAITING_REVIEW`.**

## 1. Task identity and phase

| Field | Value |
|---|---|
| Task ID | F1-003-P2 |
| Title | Disposable PostgreSQL and MinIO Provisioning and Collision Avoidance |
| Phase | F1 — CI and Test Architecture |
| Parent task | F1-003 — Baseline CI Test Execution and Disposable Runtime Readiness |
| Task type | IMPLEMENTATION + LOCAL RUNTIME VERIFICATION + EVIDENCE |
| Initial status | READY / NOT_STARTED |

## 2. Baseline commit

`origin/main` at task start: `ed568c9db3b0d62a049bc291d2137f5c913a7ac7` — the PR #256 merge commit (F1-003-P2A/R1/R1A/R1B disposable-runtime design lineage). `git merge-base --is-ancestor ed568c9d... origin/main` exited `0`. `git log --oneline --decorate -12 origin/main` confirmed zero commits after the PR #256 merge — `origin/main`'s tip *is* the PR #256 merge commit itself.

## 3. Worktree and branch

- Primary repository (`E:\Ek Gelir\Siteler\DisKlinikCRM-git`, branch `fix/revenue-report-group-by`): confirmed clean, untouched by this task.
- Fresh, isolated worktree created from `origin/main`: `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f1-003-p2-disposable-runtime`, branch `feature/f1-003-p2-disposable-runtime`.
- `git worktree list` at task start showed no existing `f1-003-p2*` worktree and confirmed the P1/B1/P2A worktrees (`f1-003-p1-test-script-closure`, `f1-003-b1-overdue-installments`, `f1-003-p2a-runtime-design`) were not reused, modified, reset, or inspected for dirty state.

## 4. Authoritative sources reviewed

`AGENTS.md`; `docs/program/NORAMEDI_MASTER_TRACKER.md`; `docs/program/CURRENT_PHASE.md` (recent entries); `docs/program/phases/F1_CI_AND_TEST_ARCHITECTURE.md` (full); `docs/program/TEST_OWNERSHIP.md`; `docs/program/RISK_REGISTER.md` (R-070 row, direct read); `docs/program/evidence/README.md`; `docs/program/evidence/F1-003-P2A_DISPOSABLE_RUNTIME_PROVISIONING_DESIGN.md` (full — the authoritative implementation contract, §K/§L); `docs/program/evidence/F1-003-P2A_disposable_runtime_contract.json` (full); `docs/program/evidence/F1-003-P1_TEST_SCRIPT_CLOSURE_AND_EXECUTION_CONTRACT.md` references; `server/package.json`; root `package.json`; `server/.env.example`; `server/prisma/schema.prisma` (datasource block); `server/prisma/migrations/` (directory count: 67); `server/src/tests/dbVerification/fileBackupDbIntegration.test.ts` (full); `server/src/tests/dbVerification/dbVerificationHarness.ts` (full); `server/src/services/fileBackupDestination.ts` (env-var usage); `server/src/db.ts`.

The merged F1-003-P2A design/contract is treated as authoritative and directly implementable — it already resolved every open design question (naming algorithm, cleanup-failure policy, image pinning policy, legacy `server:test` policy, MinIO-dependency reconciliation) that this task would otherwise have had to re-derive.

## 5. CodeGraph commands and findings

`ToolSearch(query="CodeGraph code graph analysis", max_results=5)` returned zero matching deferred tools — the sixth independent confirmation in this program (after F1-001, F1-002-P1, F1-002-P2, the original F1-003-P2A pass, and F1-003-R1). No repository-wide scan was performed. Narrowly-bounded `Read`/`Grep`/`Glob` were used instead, scoped exactly to the paths the task brief names (see §4 above), plus the two new evidence files.

The 12 target questions were answered primarily from the already-merged F1-003-P2A design/contract (which had already answered them at the file level via direct reads of `fileBackupDbIntegration.test.ts` and `kvkkAttachmentImagingLifecycle.test.ts`), cross-checked against `server/package.json` and a `Glob` of `server/src/tests/dbVerification/*.ts`:

1. **Which scripts import the real database client?** All 9 `server:test:disposable-db` members plus `test:file-backup-db-integration`, via `server/src/tests/dbVerification/dbVerificationHarness.ts`'s `import prisma from '../../db.js'`, which opens a live `pg` pool at import time.
2. **Which scripts require `DATABASE_URL` before module import?** All of the above — `server/src/db.ts` reads `process.env.DATABASE_URL!` at module top level.
3. **Destructive fixture cleanup?** `dbVerificationHarness.ts`'s `cleanupAllFixtures()` deletes every row under its own synthetic organization IDs in FK-safe order; `fileBackupDbIntegration.test.ts` additionally cleans its own MinIO bucket objects via the real backup/restore code path.
4. **Which scripts mutate `process.env`?** Only `fileBackupDbIntegration.test.ts` (sets `FILE_BACKUP_*` vars at runtime, deletes/re-sets `FILE_BACKUP_LOCAL_DIR`/`FILE_BACKUP_S3_BUCKET` mid-file to switch destinations).
5. **Process isolation requirements?** Each leaf script is its own `tsx` process (per existing `server/package.json` convention); the orchestrator additionally isolates at the Docker level (container-per-run).
6. **Scripts safely sharing one disposable Postgres within one aggregate run?** All 9 `server:test:disposable-db` members and the 1 `server:test:storage-integration` member — each creates its own synthetic org/clinic IDs, so they do not collide with each other inside one provisioned instance (confirmed live, §14/§15).
7. **Sole genuine live MinIO-dependent leaf target?** `test:file-backup-db-integration` — confirmed by direct code read: unmocked `S3Client` + real `adminS3.send(new CreateBucketCommand(...))`. `test:kvkk-lifecycle` was already corrected by F1-003-R1A to Postgres-only/MinIO-free (S3 SDK usage fully mocked at `S3Client.prototype.send`).
8. **Exact env vars required before the storage test imports?** `DATABASE_URL`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` — confirmed by direct read of `fileBackupDbIntegration.test.ts` lines 353-374 (the test constructs `FILE_BACKUP_S3_*` vars itself from these three).
9. **Resources requiring stale-resource labels?** PostgreSQL containers, MinIO containers, per-run Docker networks — all labeled (§9 below).
10. **Failure paths that could leave resources behind?** Provisioning failure mid-sequence, readiness timeout, migration failure, test failure, and cleanup-step failure itself — all handled by unconditional `teardown()` plus the stale sweeper as defense-in-depth (verified live, §20-§22).
11. **Reusable existing scripts/helpers without cross-domain coupling?** `dbVerificationHarness.ts` and the existing `server:test:disposable-db`/`server:test:storage-integration` aggregate scripts are reused unmodified — this task adds no new test-domain code, only test/dev orchestration tooling outside `server/src`.
12. **Code paths that would accidentally allow production-like endpoints?** None existed before this task (confirmed by F1-003-P2A §15's own direct check of `db.ts`/`dbVerificationHarness.ts`); this task adds the first production-endpoint guard (§13).

## 6. Implementation architecture

Additive, test/dev-only tooling under `scripts/test-runtime/`, never imported by application runtime:

- `scripts/test-runtime/orchestrator.ts` — the shared Node/TypeScript orchestrator (CLI entry point, invoked via `npx tsx`).
- `scripts/test-runtime/lib/` — pure/testable logic modules: `naming.ts` (run-ID generation and per-target-system sanitization), `labels.ts` (Docker label construction), `redact.ts` (credential/URL redaction), `guard.ts` (production-endpoint guard), `docker.ts` (thin Docker CLI wrapper + pure port-JSON parsing), `postgres.ts`/`minio.ts` (provisioning + readiness), `process.ts` (migration/test child-process execution), `cleanup.ts` (teardown), `outcome.ts` (exit-status combination + stale-TTL logic), `sweep.ts` (stale-resource sweeper), `profiles.ts` (profile/failure-mode validation).
- `scripts/test-runtime/provision.ps1` / `provision.sh` — thin PowerShell/Bash entry-point wrappers. All real orchestration logic lives in the shared TypeScript orchestrator; the wrappers only resolve the repo root, do a fast Docker-availability preflight, forward arguments, and forward the real exit code.
- `scripts/test-runtime/sweep.ps1` / `sweep.sh` — thin wrappers for the stale-resource sweeper.
- `scripts/test-runtime/tsconfig.json` — isolated typecheck scope for this tooling (Node-only, does not affect the frontend or server tsconfig).
- `scripts/test-runtime/__tests__/orchestratorUnit.test.ts` — focused unit tests for every pure-logic module, no Docker required.

This preserves the modular-monolith boundary: the tooling is entirely outside `server/src`, `src/` (frontend), and `bridge-agent/`; it is never imported by any application entry point; it introduces no new application-domain dependency, no Kafka/Kubernetes/microservices/database-per-tenant, and no framework rewrite.

## 7. Files changed

Additive only:

- New: `scripts/test-runtime/**` (16 files — orchestrator, 11 lib modules, 2 shell wrappers, 2 PowerShell wrappers, 1 tsconfig, 1 unit-test file).
- Modified: root `package.json` — 5 new additive scripts (`test:runtime:unit`, `test:runtime:postgres`, `test:runtime:storage`, `test:runtime:parallel`, `test:runtime:cleanup-stale`, `typecheck:runtime`); no existing script renamed, removed, or reordered.
- **`server/package.json` is byte-for-byte unchanged** — confirmed via `git status --short` showing no entry for it. The 9+1 disposable-runtime target scripts and the 3 aggregates already existed from F1-003-P1; this task required no server-side script change.
- New evidence: this document and its JSON companion.
- Documentation updates: `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/CURRENT_PHASE.md`, `docs/program/phases/F1_CI_AND_TEST_ARCHITECTURE.md`, `docs/program/evidence/README.md` (status-recording only).

No application route/service/domain file, no Prisma schema, no migration file, no `.github/workflows/**`, no Docker Compose production file, and no `RISK_REGISTER.md` edit (R-070 remains untouched/OPEN).

## 8. Runtime profiles

Four explicit profiles implemented, exactly as required:

1. **`postgres`** — provisions disposable PostgreSQL only, runs migrations, executes `server:test:disposable-db`.
2. **`storage`** — provisions disposable PostgreSQL + disposable MinIO, runs migrations, executes `server:test:storage-integration`.
3. **`verify-parallel`** — runs 2 concurrent `postgres`-profile invocations, then 2 concurrent `storage`-profile invocations, and asserts no collision across all 4.
4. **`cleanup-stale`** — dry-run by default; `--live` performs real removal; only resources labeled `com.noramedi.test-runtime=true` and older than the configured TTL (default 4h) are ever considered.

A future full-runtime profile (composing legacy `server:test` + the three aggregates as sibling steps) is documented as not-yet-implemented per §K.5 of the merged design — not built in this task.

## 9. Package scripts

Root `package.json` (additive):

```
test:runtime:unit          -> tsx scripts/test-runtime/__tests__/orchestratorUnit.test.ts
test:runtime:postgres      -> tsx scripts/test-runtime/orchestrator.ts postgres
test:runtime:storage       -> tsx scripts/test-runtime/orchestrator.ts storage
test:runtime:parallel      -> tsx scripts/test-runtime/orchestrator.ts verify-parallel
test:runtime:cleanup-stale -> tsx scripts/test-runtime/orchestrator.ts cleanup-stale
typecheck:runtime          -> tsc --noEmit -p scripts/test-runtime/tsconfig.json
```

Invocation from repository root: `npm run test:runtime:postgres`, etc. Failure-injection flags: `npm run test:runtime:postgres -- --inject-failure=test` (repeatable — `--inject-failure=test --inject-failure=cleanup` combines both). Stale sweeper: `npm run test:runtime:cleanup-stale -- --live --ttl-hours=8`.

From the PowerShell/Bash wrappers directly: `pwsh -File scripts/test-runtime/provision.ps1 -Profile postgres` / `scripts/test-runtime/provision.sh postgres`.

## 10. PostgreSQL image/tag/digest

- Tag (historical, at original implementation time): `postgres:16-alpine`
- Resolved digest: `sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`
- Resolved version, confirmed live: `docker run --rm postgres:16-alpine postgres --version` → `postgres (PostgreSQL) 16.14` (major version 16, matching the expected provisional choice — no silent major-version drift).
- Selection rationale (unchanged from the merged design): historical repository precedent — 3 prior disposable-Postgres uses in this repository all used version-16-family images.
- ~~**Production major-version parity is NOT claimed.** No repository/deployment evidence source records production PostgreSQL's major version (re-confirmed by this task's own search — same finding as F1-003-P2A §13). Recorded, again, as an explicit pre-P3/pre-release verification item.~~ **[SUPERSEDED 2026-07-29 by F1-003-P2-R1, §38 below: F1-003-P2V (merged PR #259) established production PostgreSQL as `16.14`. Major-version parity between this disposable image and production is now CONFIRMED (`16` = `16`). Exact image/build/package parity is still NOT claimed. This original sentence is preserved verbatim as dated historical evidence, not deleted — see §38 for the canonical current wording and the digest-pin switch it also records.]**

## 11. MinIO image/tag/digest

- Tag: `minio/minio:RELEASE.2025-04-08T15-41-24Z`
- Resolved digest: `sha256:8834ae47a2de3509b83e0e70da9369c24bbbc22de42f2a2eddc530eee88acd1b`
- Image reference actually used by the provisioning code: `minio/minio@sha256:8834ae47a2de3509b83e0e70da9369c24bbbc22de42f2a2eddc530eee88acd1b` (digest-pinned, not the mutable tag alone).
- `latest` is never used anywhere in the implementation.
- Selection rationale: first MinIO use in this program's history (per the merged design's own finding) — no prior repository precedent existed to match against. The tag was resolved and its digest verified via `docker pull minio/minio:RELEASE.2025-04-08T15-41-24Z` followed by `docker inspect --format '{{index .RepoDigests 0}}'`, both executed live during this task, with internet access available in this environment.

## 12. Run-ID and label contract

Run-ID format: `<compact-UTC-timestamp>-<8-hex-char-random>-<process-PID>`, e.g. `20260729T074700Z-2252d697-18272`. Derived names, exactly per the merged design's naming algorithm:

- Containers: `nmtest-pg-<scopeTag>-<runId>` / `nmtest-minio-<scopeTag>-<runId>`, lowercased and slugified, truncated to 63 chars.
- Networks: `nmtest-net-<scopeTag>-<runId>`.
- Databases: `nmtest_<scopeTag>_<runId>`, sanitized to a valid Postgres identifier (lowercase, underscore-only, never starts with a digit, ≤63 bytes).
- Usernames: `nmt_<scopeTag>_<runId>`, same sanitization rules.
- Buckets (not created by the orchestrator itself — see §19): would follow `nmtest-<scopeTag>-<runId>`, S3-safe (lowercase, hyphen, 3-63 chars, alnum start/end) if ever needed.

Every Docker resource created carries exactly the required labels: `com.noramedi.test-runtime=true`, `com.noramedi.test-run-id=<runId>`, `com.noramedi.test-profile=<profile>`, `com.noramedi.test-created-at=<UTC ISO timestamp>`, `com.noramedi.test-task=F1-003-P2`. Cleanup and the stale sweeper both key off these labels, never name prefixes alone.

## 13. Credentials/redaction

PostgreSQL passwords and MinIO secret keys are generated via `node:crypto.randomBytes` (24 random bytes, base64url); MinIO access-key-ids via 8 random bytes (hex, `nmtest`-prefixed). Every credential is passed to child processes exclusively through the in-memory `env` option of `child_process.spawn` — never written to a temp file, never written to a committed `.env` file, never hardcoded. `lib/redact.ts` fully redacts (no partial-character reveal) `DATABASE_URL` passwords and any `*_SECRET`/`*_PASSWORD`/`*_KEY`-shaped environment variable before any logging path exists; the `RunSummary` JSON printed to stdout never contains a raw connection string or credential — only run IDs, container/database names, host ports, and exit codes. Verified by 8 dedicated unit tests (redaction section) plus direct inspection of every real run's printed JSON output during live verification (§17-§22) — no secret ever appeared.

## 14. Production endpoint guards

`lib/guard.ts` implements fail-closed checks, enforced **before** any Docker provisioning command or migration/test import:

- Rejects any `DATABASE_URL`/`MINIO_ENDPOINT`/`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` already present in the *invoking* environment — the orchestrator never merges with or silently prefers an inherited value.
- Rejects a non-loopback `DATABASE_URL`/`MINIO_ENDPOINT` host.
- Rejects known production hostname patterns (`noramedi.com`, `app.noramedi.com`).
- Rejects an HTTPS MinIO endpoint for the local Docker profile.
- Verifies the constructed database name actually carries the current run's own identity (not merely a blacklist string match) — this specific check caught a real bug during verification (§23).

Live-verified in §22 (production-guard failure injection): a fake production-like `DATABASE_URL` set in the invoking environment was rejected with **zero Docker containers or networks created** — confirmed by `containerNames: []`/`networkName: "(none)"` in the run's own output and by `docker ps`/`docker network ls` showing no new resources.

## 15. Network controls

Mandatory controls: no real external provider call occurs (confirmed — the only genuinely-reachable-over-a-network destination in any test is the disposable, loopback-bound MinIO container itself); test-level provider mocks remain fully active and untouched (this task changes zero application/test code); generated DB/storage endpoints only (guard-enforced); production URL guards (§14).

Best-effort controls implemented: an isolated Docker bridge network is created per run (`docker network create`) and both the PostgreSQL and (for `storage`) MinIO containers are attached to it; only the minimum necessary ports are published to the host loopback interface (`-p 127.0.0.1::5432`, `::9000`, `::9001`) — never `0.0.0.0`, never a fixed host port.

**Not claimed:** application-level outbound egress filtering (e.g. a fetch/undici dispatcher allow-list) is not implemented — this remains a documented recommendation from the merged design, not a hard acceptance criterion, and this task does not claim it exists. Full OS/firewall-level egress denial is not claimed or implemented.

## 16. Readiness behavior

- **PostgreSQL:** bounded wait (default 60s, configurable), polling `docker exec <container> pg_isready -U <user> -d <db>` at 1s intervals; throws with the last diagnostic output on timeout; never retries indefinitely.
- **MinIO:** bounded wait (default 60s), polling `GET http://127.0.0.1:<port>/minio/health/ready`; throws with the last error/HTTP status on timeout.
- Both bounds are live-verified: normal runs complete well within 60s; the dedicated readiness-failure-injection test (§21) forces a 200ms bound and observes a genuine timeout with full diagnostic detail, not a fabricated one.

## 17. Migration behavior

Sequence, exactly as specified: `npx prisma generate` → `npx prisma migrate deploy`, run from the `server/` directory with the generated `DATABASE_URL` applied via the child process's own `env`, never `prisma migrate dev`/`db push`, never a manual `_prisma_migrations` rewrite, no migration file created or modified.

Live-verified twice (postgres-profile run and storage-profile run): both times, `npx prisma migrate deploy` reported **"All migrations have been successfully applied"** against the current migration set (67 directories, confirmed via `ls server/prisma/migrations | wc -l`), exit code `0`. A dedicated migration-failure-injection test (§20) also confirms a genuinely invalid `DATABASE_URL` produces a real non-zero exit from `prisma migrate deploy` and correctly prevents any test from starting.

## 18. Exact disposable-db execution

```
> npm run test:runtime:postgres
> tsx scripts/test-runtime/orchestrator.ts postgres
```

Run ID `20260729T074700Z-2252d697-18272`, container `nmtest-pg-postgres-20260729t074700z-2252d697-18272`, host port `50237`, database `nmtest_postgres_20260729t074700z_2252d697_18272`.

- Migration: exit `0`, "All migrations have been successfully applied."
- Test: `server:test:disposable-db`, exit `0` — all 9 members executed and passed. Per-member results observed directly in the run's console output: `DB-Target-Clinic-Creation` 15/15, `DB-Insurance-List-Behavior` 4/4, `DB-Plan-Limits-Quota` 13/13, `DB-Input-Handling` 6/6, `appointmentRequestConversionAtomicity` 16/16, `platformAdminPasswordRecovery` 21/21 (ok/FAIL vocabulary), `metaWhatsAppPostBookingHandler` 6/6 — no failures anywhere in the aggregate.
- Cleanup: `success: true`, zero errors.
- Combined outcome: `exitCode: 0`.
- Duration: single run completed well within 2 minutes end-to-end (provisioning + readiness + migration + 9-member test suite + cleanup).

## 19. Exact storage-integration execution

```
> npm run test:runtime:storage
> tsx scripts/test-runtime/orchestrator.ts storage
```

Run ID `20260729T075454Z-f1f0bffe-15716`; PostgreSQL container `nmtest-pg-storage-20260729t075454z-f1f0bffe-15716` (host port `60049`); MinIO container `nmtest-minio-storage-20260729t075454z-f1f0bffe-15716` (host port `57955`); database `nmtest_storage_20260729t075454z_f1f0bffe_15716`.

- Migration: exit `0`.
- Test: `server:test:storage-integration` → `test:file-backup-db-integration`, exit `0` — **21 passed, 0 failed**, including a real MinIO bucket creation (`CreateBucketCommand`), a real upload/independent-read-back cycle via a second S3 client, real out-of-band object deletion/corruption detection, and full local-destination FK/cascade/orphan-behavior coverage.
- Cleanup: `success: true`, zero errors.
- Combined outcome: `exitCode: 0`.

**Bucket-naming note:** the orchestrator does not create or name a bucket itself. `fileBackupDbIntegration.test.ts` (unmodified — its bucket-naming/teardown code change remains a separately-authorized, unresolved item per the merged design §22 item 5) creates its own bucket named `file-backup-review-${Date.now()}`. This is safe under this implementation because every `storage`-profile run provisions its own, fully separate MinIO server instance — there is no shared bucket namespace across runs for two runs' bucket names to collide in, regardless of the millisecond-timestamp naming scheme.

## 20. Parallel collision verification

`npm run test:runtime:parallel` — 2 concurrent `postgres`-profile invocations followed by 2 concurrent `storage`-profile invocations (`Promise.all` in both cases), run twice across two separate invocations of this task with identical results both times:

```
"collisionCheck": {
  "uniqueRunIds": true,
  "uniqueContainerNames": true,
  "uniqueDatabaseNames": true,
  "uniqueHostPorts": true
}
```

All 4 constituent runs (2 postgres + 2 storage) independently returned `outcome.exitCode: 0`. `docker ps -aq --filter label=com.noramedi.test-runtime=true` and `docker network ls -q --filter label=com.noramedi.test-runtime=true` both returned `0` after completion — zero labeled resources left behind by any of the 4 concurrent runs.

Second, fully-captured invocation's exact run IDs (all distinct): `20260729T083833Z-d46bdec2-20608`, `20260729T083834Z-db15409b-20608` (the postgres pair); `20260729T084316Z-f45cdaed-20608`, `20260729T084316Z-edc5d2af-20608` (the storage pair) — all 4 exit codes `0`, all collision checks `true` again, zero labeled resources remained afterward.

## 21. Failure-injection verification

All 6 controlled failure scenarios were exercised against the **real, live** orchestrator (no fabricated/mocked results):

1. **Test command failure** (`--inject-failure=test`): a harmless injected failing child command (`node -e process.exit(1)`) replaces the real npm script. Result: `test.code: 1`, `cleanup.success: true`, `outcome.exitCode: 1`.
2. **Migration failure** (`--inject-failure=migration`): `DATABASE_URL` deliberately pointed at an unbound loopback port (`127.0.0.1:1`) for the migration step only. Result: `migration.code: 1` (step `migrate-deploy`), `test: null` (never started), `cleanup.success: true`, `outcome.exitCode: 1`.
3. **Readiness timeout** (`--inject-failure=readiness`): readiness bound forced to 200ms. Result: a genuine `pg_isready` timeout with full diagnostic (`... no response`), `cleanup.success: true`, `outcome.exitCode: 1`.
4. **Cleanup failure, tests passed** (`--inject-failure=cleanup`): see §23 for how this was made genuine (not fabricated). Result: `test.code: 0` (real 9/9 pass), `cleanup.success: false` ("network has active endpoints"), `outcome.exitCode: 1` — cleanup failure alone forces a non-zero exit even though tests passed.
5. **Test failure + cleanup failure** (`--inject-failure=test --inject-failure=cleanup`): Result: `test.code: 1`, `cleanup.success: false`, `outcome.exitCode: 1` — the *original* test-failure exit code is preserved (not overwritten by the cleanup failure), and the cleanup failure is additionally, separately reported in `outcome.reasons` rather than conflated into one opaque message.
6. **Production guard** (fake production-like `DATABASE_URL` pre-set in the invoking environment, no flag needed): Result: rejected before any Docker command — `containerNames: []`, `networkName: "(none)"`, `outcome.exitCode: 1`. Confirmed via `docker ps`/`docker network ls` that literally nothing was created.

After every injected-failure run whose cleanup succeeded (scenarios 1-3, 6) and after the test-harness hygiene step for scenarios 4-5 (see §23), `docker ps -aq --filter label=com.noramedi.test-runtime=true` returned `0`.

## 22. Cleanup verification

Normal-success cleanup (postgres profile, storage profile, all 4 parallel runs): `cleanup.success: true`, zero errors, in every case. Directly verified after each: `docker ps -aq --filter label=com.noramedi.test-runtime=true | wc -l` → `0`; `docker network ls -q --filter label=com.noramedi.test-runtime=true | wc -l` → `0`. No temp files or generated env files are created on disk by this implementation (credentials are passed purely via in-memory child-process `env`), so there is nothing on disk to leak.

## 23. Stale-resource sweeper

Verified against owned fixtures, not merely described: two containers were created directly via `docker run` carrying the tool's own labels — `nmtest-sweep-test-fresh` (`com.noramedi.test-created-at` = current UTC time) and `nmtest-sweep-test-stale` (`com.noramedi.test-created-at` = `2026-01-01T00:00:00.000Z`, far past the 4-hour default TTL).

- **Dry run** (`npx tsx scripts/test-runtime/orchestrator.ts cleanup-stale`): `ttlHours: 4`, `dryRun: true`, `candidates: [nmtest-sweep-test-stale]`, `removed: []` — nothing destructive happened; the fresh container was untouched.
- **Live run** (`... cleanup-stale --live`): `dryRun: false`, `candidates: [nmtest-sweep-test-stale]`, `removed: [nmtest-sweep-test-stale]`, `errors: []`. Confirmed via `docker ps -a --filter label=com.noramedi.test-runtime=true --format {{.Names}}` immediately after: only `nmtest-sweep-test-fresh` remained — the sweeper touched exactly and only the stale, labeled resource.
- The fresh fixture container was then removed manually as test-harness hygiene (it was a fixture proving non-destructiveness, not a real disposable-runtime run).

## 24. Unit tests

`scripts/test-runtime/__tests__/orchestratorUnit.test.ts`, run via `npm run test:runtime:unit` — **50 passed, 0 failed**, no Docker required. Coverage: run-ID generation/sanitization (container/database/bucket/username naming rules across all four target-system constraints), Docker port-binding JSON parsing (including malformed/missing-binding/non-numeric cases), the production-endpoint guard (loopback checks, production-hostname-pattern matching, inherited-override rejection, and a dedicated regression test for the real end-to-end normalization bug found in §23 below), credential/URL redaction, Docker label generation and filter-argument construction, stale-resource TTL selection and staleness classification, cleanup exit-status combination (all 4 success/failure combinations from the finalized cleanup-failure policy), runtime-profile validation, and failure-injection-mode validation.

## 25. Typecheck and syntax validation

- `npx tsc --noEmit -p scripts/test-runtime/tsconfig.json` — **0 errors.**
- `npm run typecheck` (server: `npx prisma generate && tsc --noEmit`) — **0 errors** (confirms this task introduced no server-side type regression; server/package.json itself is unchanged).
- PowerShell syntax: `[System.Management.Automation.Language.Parser]::ParseFile` on `provision.ps1` and `sweep.ps1` — both parse cleanly. **One real bug was found and fixed during this validation**: an em-dash immediately followed by an apostrophe inside a double-quoted string within a `Register-EngineEvent` script block produced a genuine PowerShell parser error ("The string is missing the terminator"). Fixed by rewording to ASCII-only punctuation; re-validated clean.
- Bash syntax: `bash -n` on `provision.sh` and `sweep.sh` — both pass.
- `node -e "require('./package.json')"` (root) and `node -e "require('./server/package.json')"` — both OK.
- `node -e "JSON.parse(...)"` on this task's own new JSON evidence file — valid.
- `git diff --check` — clean; only benign CRLF-normalization notices, no whitespace errors or conflict markers.

## 26. Exact commands/results

See §18-§25 above for the full exact-command/exact-result record. Summary table:

| Command | Result |
|---|---|
| `npm run test:runtime:unit` | 50 passed, 0 failed |
| `npx tsc --noEmit -p scripts/test-runtime/tsconfig.json` | 0 errors |
| `npm run typecheck` (server) | 0 errors |
| `npm run test:runtime:postgres` | exit 0, 9/9 disposable-db members pass |
| `npm run test:runtime:storage` | exit 0, 21/21 file-backup-db-integration assertions pass |
| `npm run test:runtime:parallel` (×2 invocations) | exit 0 both times, zero collisions both times **[Initial pre-F1-003-P2-R1 observation, 2 runs only. F1-003-P2-R1 later found a real Windows EBUSY on a 3rd/4th rerun; F1-003-P2-R2 (§39) found the root cause, fixed it, and re-verified with 5 consecutive clean runs post-fix — see §39.7 for the full 8-attempt history.]** |
| `--inject-failure=test` | exit 1, cleanup succeeds |
| `--inject-failure=migration` | exit 1, tests never start, cleanup succeeds |
| `--inject-failure=readiness` | exit 1, genuine timeout, cleanup succeeds |
| `--inject-failure=cleanup` | exit 1, real tests pass, real cleanup failure forces non-zero |
| `--inject-failure=test --inject-failure=cleanup` | exit 1 (original test-failure code preserved), cleanup failure separately reported |
| fake production `DATABASE_URL` pre-set | exit 1, rejected before any Docker call |
| `npm run test:runtime:cleanup-stale` (dry-run) | 1 stale candidate identified, 0 removed |
| `npm run test:runtime:cleanup-stale -- --live` | 1 stale resource removed, fresh fixture untouched |
| `npm run server:test:non-disposable` | exit 0, 68/68 — no regression from this task |
| `git diff --check` | clean |

## 27. Pass/fail/skip counts

- `server:test:disposable-db`: 9 members, 9 passed, 0 failed, 0 skipped (real per-member assertion totals: 15+4+13+6+16+21+6 = 81 individual assertions across the 9 members, all passing — exact per-member breakdown in §18).
- `server:test:storage-integration`: 1 member, 21 assertions passed, 0 failed, 0 skipped.
- `server:test:non-disposable`: 68 members, exit 0 (unaffected baseline from F1-003-B1; not re-enumerated per-assertion by this task — cited as the already-merged, unregressed result).
- `scripts/test-runtime` unit tests: 50 passed, 0 failed, 0 skipped.

## 28. Migration status

- No Prisma schema change.
- No new migration file created (67 migration directories before and after this task).
- Existing migrations applied only to disposable, per-run databases (never a production database).
- No `_prisma_migrations` manual rewrite.
- No rollback automation implemented or claimed.
- **R-070 remains OPEN**, untouched by this task.

## 29. R-070 boundary

Restated, unchanged: `prisma migrate deploy` is forward-only; this implementation's default profiles never mutate `_prisma_migrations` directly and never perform a physical schema rollback; no destructive rollback-rehearsal profile was implemented (the merged design's own "profile 5" remains explicitly out of scope, opt-in, non-default, and unbuilt here). Neither this task nor its runtime verification closes, mitigates, or narrows R-070 in any way. `docs/program/RISK_REGISTER.md` is not edited by this task.

## 30. Backward compatibility

- `server/package.json` is byte-for-byte unchanged (verified via `git status`).
- Legacy `server:test`, `server:test:non-disposable`, `server:test:disposable-db`, and `server:test:storage-integration` are all unchanged and independently confirmed still working (`server:test:non-disposable` re-run at exit 0; the two new-aggregate scripts executed live with real passing results).
- All new root `package.json` scripts are purely additive; no existing script renamed, removed, or reordered.
- Local developers can opt into the new profiles without any change to their existing workflow.
- No application runtime file imports any part of `scripts/test-runtime/`.
- No production environment requirement introduced.
- No schema/data backfill.
- No deployment change of any kind.
- Legacy `server:test`'s own 23 silently-DB-required members are **not** provisioned or executed by this task — deliberately deferred, per the merged design's own explicit two-outcome framing (§9a item 4/§K.5). This decision is recorded here, not left to silence.

## 31. Security impact

See the JSON companion's `securityImpact` object for the complete structured record. Narrative summary: secrets are generated with `node:crypto.randomBytes`, never logged in full, never written to disk; every Docker invocation uses an argv array (`shell: false`) except the two Windows `npm.cmd`/`npx.cmd` invocations, which require `shell: true` to spawn at all on Windows but pass only fixed internal literal arguments (never externally-supplied text), so no injection surface is introduced; every created resource is label-scoped for cleanup/sweeping; both images are digest-pinned; no `latest` tag is used anywhere.

## 32. Tenant-isolation impact

None expected, and none observed: no application code was touched; every test fixture used is already synthetic (UUID-based organizations/clinics via `dbVerificationHarness.ts`, unchanged); no tenant-filter logic changed; parallel runs use fully isolated per-run databases (confirmed live, §20).

## 33. KVKK/privacy impact

None expected, and none observed: no real patient data anywhere in this task's own verification (all fixtures synthetic, `@example.invalid`/`555`-style, matching the program's existing convention); no production backup or object store touched (MinIO instances are disposable, loopback-bound, and destroyed per run); no consent/retention logic changed; no KVKK physical-architecture freeze boundary touched; this evidence document and its JSON companion contain no PII and no secret (only run IDs, container/database names, host ports, and exit/pass/fail counts).

## 34. Rollback

Exact rollback method: `git revert` the merge/implementation commit(s) on this branch. This removes all new `scripts/test-runtime/**` files and reverts the additive root `package.json` script changes in one operation. If any stale labeled Docker resource happens to remain from a manual/interrupted local run at rollback time, `npm run test:runtime:cleanup-stale -- --live` (or, once the code is reverted, a manual `docker rm -f`/`docker network rm` against the exact labeled names) removes only this tool's own labeled resources — never a broader Docker cleanup. No schema rollback, no production data rollback, no deployment rollback, and no R-070 implication of any kind.

## 35. Remaining risks

- ~~Production PostgreSQL major-version parity with `postgres:16-alpine` is unconfirmed — carried forward as a pre-P3/pre-release verification item, not resolved by this task.~~ **[SUPERSEDED 2026-07-29 by F1-003-P2-R1, §38: major-version parity is now CONFIRMED (production `16.14`, disposable `16.14`); exact image/build/package parity remains an open item, now correctly framed as "not claimed" rather than "unconfirmed."]**
- Legacy `server:test`'s own 23 DB-required members remain unprovisioned by any disposable-runtime tooling — deliberately deferred to a future, separately-authorized task.
- `fileBackupDbIntegration.test.ts`'s `Date.now()`-based bucket naming and incomplete bucket-teardown path remain unresolved test-code items, requiring separate authorization (unchanged from the merged design).
- Cleanup is **not** guaranteed to survive a hard process kill (SIGKILL), an OS crash, or a Docker daemon crash — only best-effort `SIGINT`/`SIGTERM` handling is implemented in the orchestrator, with the platform limitation explicitly documented in both shell wrappers.
- Full OS/firewall-level network-egress denial is not implemented — only Docker's own loopback-only port publishing and a per-run isolated bridge network exist; an application-level outbound-fetch allow-list remains a documented recommendation, not built here.
- Two real defects were found and fixed by this task's own verification process during implementation (§36 lists the third, guard-normalization, defect explicitly as an "accepted finding" — see below); a reviewer should independently re-run the failure-injection suite to confirm the fixes hold.

## 36. Explicit non-claims

This task does **not** claim: disposable-Postgres/MinIO provisioning is wired into any CI workflow (no `.github/workflows/**` file exists or was created); R-070 is resolved, mitigated, or closed (it remains `OPEN`); F1's exit gate is satisfied; F1 or F1-003 is complete; G1/G2 approval status has changed; the KVKK baseline is stable or that the KVKK freeze boundary was touched; ~~production PostgreSQL major-version parity is established~~ **[SUPERSEDED 2026-07-29 by F1-003-P2-R1, §38: major-version parity IS now established/confirmed via merged F1-003-P2V evidence (PR #259) — this task still does not claim exact image/build/package parity with production]**; full network-egress denial exists; cleanup survives a hard kill/OS crash/Docker-daemon crash; legacy `server:test`'s own DB-required members were provisioned or executed by this task (they were deliberately deferred); a production database, production storage endpoint, or real patient data was accessed at any point; this task reached any status beyond `AGENT_COMPLETED` / `PR_OPENED_AWAITING_REVIEW`.

## 37. Acceptance-criteria matrix

See the JSON companion's `acceptanceCriteria` array for the full 34-item machine-readable matrix. ~~All 34 items: `MET`~~ **[CORRECTED — see §39 below. This blanket statement is preserved as this task's own original, as-observed-at-the-time claim, based on exactly 2 fresh `verify-parallel` runs with no adversarial repetition. Items 17 and 18 (concurrent postgres/storage runs succeed without collision) were later found by F1-003-P2-R1 to rest on an unproven assumption — a 3rd rerun hit a real `EBUSY` race in concurrent `prisma generate`. F1-003-P2-R2 found the root cause, fixed it, and re-earned `MET` status for items 17/18 with materially stronger evidence: 5 consecutive clean runs after the fix, not 2. The other 32 items are unaffected by this correction.]** Narrative highlights: every falsifiable criterion from the merged F1-003-P2A design §L was independently, live-verified against a real Docker Desktop engine on this machine — not merely asserted from code inspection. Two real bugs were found and fixed by that live-verification process before every criterion could be marked `MET`:

1. **Guard-normalization bug**: the production-endpoint guard's own database-identity check compared the *raw* (mixed-case, dash-containing) run ID against the *sanitized* (lowercased, underscore-separated) generated database name, causing every real disposable-Postgres run to fail its own safety check. Fixed by normalizing both sides identically before comparison (`lib/guard.ts`); a dedicated regression unit test now reproduces the exact real-world naming shapes involved.
2. **Windows `spawn EINVAL`**: `child_process.spawn` cannot invoke `npm.cmd`/`npx.cmd` directly on Windows without `shell: true`. Fixed by conditionally enabling `shell: true` for those two invocations only on `win32`, passing only fixed internal literal arguments (never user-controlled text), so no injection surface is introduced.
3. **`docker rm -f` idempotency**: found, while designing the cleanup-failure-injection test, that `docker rm -f` on an already-removed container returns exit code `0` (Docker treats forced removal as idempotent) — meaning the originally-planned "pre-remove the container out-of-band, then let the normal path fail" injection technique never actually produced a real failure. Redesigned to attach a genuine, untracked sidecar container to the run's Docker network, which makes `docker network rm` **really** fail with "has active endpoints" — a real, reproducible failure signal, with test-harness hygiene afterward (executed only after the measured cleanup outcome is computed) removing the sidecar so this verification run itself does not leak resources.

These are reported here transparently, not hidden, as evidence that the verification process was adversarial against its own implementation rather than a happy-path-only self-check.

## 38. F1-003-P2-R1 update (2026-07-29): PostgreSQL parity correction and image-pinning verification

This section records a later reconciliation task (F1-003-P2-R1, continued on this same open PR #260 branch, no new PR) that merged `origin/main` after **F1-003-P2V/P2V-R1 merged as PR #259** (merge commit `8592a570708c6308d7a19aff703db6e0a699ece7`, mergedAt `2026-07-29T07:57:11Z`).

**PostgreSQL parity — corrected wording (supersedes §10/§35/§36 above, which are preserved unedited):**
- Production PostgreSQL observed version: `16.14`
- Disposable PostgreSQL observed version: `16.14`
- Major-version parity: **CONFIRMED** (`16` = `16`)
- Observed patch-version equality: `16.14 = 16.14`
- Exact image/build/package parity: **NOT claimed** (production's exact base-image/build provenance is not recorded anywhere in the repository)

**Image-pinning verification (actual invocation inspected, not assumed):**

| | PostgreSQL | MinIO |
|---|---|---|
| Configured reference (before this task) | `postgres:16-alpine` (floating tag) | `minio/minio@sha256:8834ae...` (digest) |
| Configured reference (after this task) | `postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` | unchanged |
| Exact `docker run`/`pull` reference used | `postgres@sha256:57c72f...` (was `postgres:16-alpine`) | `minio/minio@sha256:8834ae47a2de3509b83e0e70da9369c24bbbc22de42f2a2eddc530eee88acd1b` |
| Resolved image ID (this task, live `docker image inspect`) | `sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` | not re-inspected by ID this task; digest re-pulled and matched (see below) |
| Repo digest (this task, live) | `postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` | `minio/minio@sha256:8834ae47a2de3509b83e0e70da9369c24bbbc22de42f2a2eddc530eee88acd1b` |
| Digest-pinned invocation? | **Yes, after this task** (was tag-only before) | **Yes, unchanged** |
| Only the resolved digest recorded after pulling (tag could silently drift)? | No longer applicable — the digest itself is now the invocation, not merely recorded after the fact | No — was already the invocation, not merely recorded |
| Byte-reproducible on future runs? | **Yes** — `docker run postgres@sha256:...` always resolves to the exact same content-addressed image, unaffected by upstream re-tagging of `postgres:16-alpine` | **Yes**, unchanged — already digest-pinned since original implementation |

Before this task, PostgreSQL's own invocation used the word "pinned" ambiguously in prose (§10 said "matching the expected provisional choice" without distinguishing tag-pinning from digest-pinning); this section states plainly: **the previous PostgreSQL invocation was tag-pinned only, not digest-pinned** — Docker Hub could re-publish `postgres:16-alpine` under a new digest at any time, and a future run would have silently picked up different bytes. **Option A was applied**: `scripts/test-runtime/lib/postgres.ts`'s `POSTGRES_IMAGE` now resolves to the digest reference above; `POSTGRES_IMAGE_TAG` is retained for logging only and is never passed to `docker run`. Both the PostgreSQL digest and the MinIO digest were independently re-verified live in this task via `docker pull <ref>` — both reported "Image is up to date," confirming the exact same content is still resolvable today (2026-07-29), not merely carried forward from the original implementation task's earlier pull.

**Real profiles rerun against the new PostgreSQL reference (this task, live Docker Desktop engine, not carried forward):**
- `postgres` profile: migration exit `0`, `server:test:disposable-db` (9 members) exit `0`, cleanup succeeded.
- `storage` profile: migration exit `0`, `server:test:storage-integration` exit `0` (21/21 assertions), cleanup succeeded.
- `verify-parallel` (2×postgres + 2×storage concurrent): run **3 times** in this task (one more than the originally-planned 2, due to an anomaly below). Run 1: all 4 exit `0`, `collisionCheck` all `true` (unique run IDs/container names/database names/host ports). Run 2: **a real, non-fabricated intermittent failure** — one of the two `storage` invocations failed at the `prisma generate` step with `EBUSY: resource busy or locked, copyfile ... query_compiler_fast_bg.postgresql.js -> ... query_compiler_fast_bg.js`, a Windows-filesystem-level race when multiple concurrent `prisma generate` invocations write to the same shared `server/node_modules/.prisma/client` output directory under 4-way concurrency; the failing run's own collision fields (run ID/container/database/port) were still unique — this is not a naming/port collision, it is a separate, newly-discovered local-filesystem race, independent of the PostgreSQL digest-pin change (the failure occurs in a Node-level `prisma generate` step, before any Docker/image interaction). Cleanup still succeeded for the failed run. Run 3: repeated to check for a pattern — all 4 exit `0` again, `collisionCheck` all `true`. **This EBUSY race is recorded here as a new, honestly-reported finding, not silently omitted** — a candidate future risk item for the `verify-parallel` orchestration (e.g. serializing `prisma generate` across concurrent invocations, or giving each run its own isolated `node_modules`), out of this task's own narrow scope to fix.
- Postgres-relevant failure-injection modes rerun against the digest-pinned image: `--inject-failure=test` (exit `1`, "tests failed with exit code 1", cleanup succeeded), `--inject-failure=migration` (exit `1`, migration failed at `migrate-deploy`, cleanup succeeded), `--inject-failure=readiness` (exit `1`, readiness timeout after 200ms, cleanup succeeded), `--inject-failure=cleanup` (tests passed, cleanup deliberately failed via sidecar attachment, exit `1` — fail-fatal policy confirmed). All four reproduced the same real, non-fabricated failure signals as the original implementation.
- Zero-resource cleanup verified after every rerun above (including the deliberately-failed cleanup-injection run and the EBUSY-failed parallel run): `docker ps -a` and `docker network ls`, filtered and unfiltered, show zero `nmtest-*` containers or networks remaining.
- `npm run server:test:non-disposable` (run from `server/`) rerun: exit `0`, 68/68, no failure marker in the combined log — no regression from this task's one-line image-reference change.

**Not claimed by this task:** that the EBUSY race is fixed (it is recorded, not resolved); that `verify-parallel` is now guaranteed collision-free under all concurrency levels (2 of 3 fresh runs were clean; the third's failure was a filesystem race, not a naming/port collision, and collision-uniqueness fields were `true` even in the failed run); that this task performed any production access, deployment, schema/migration authoring, or CI-workflow change.

## 39. F1-003-P2-R2 update (2026-07-30): parallel Prisma generation race eliminated, deterministic verification

This section records F1-003-P2-R2, continued on this same open PR #260 branch (no new PR), which resolves the EBUSY finding recorded in §38 above.

### 39.1 Blocking finding (preserved, not deleted)

F1-003-P2-R1's `verify-parallel` reruns (§38): run 1 success, **run 2 — one `storage` invocation failed with a real Windows `EBUSY`** (`copyfile ...\node_modules\@prisma\client\runtime\query_compiler_fast_bg.postgresql.js -> ...\node_modules\.prisma\client\query_compiler_fast_bg.js`) during `prisma generate`, run 3 success. This is preserved above verbatim, not rewritten.

### 39.2 Root cause

CodeGraph confirmed unavailable for this task too (`ToolSearch` returned zero matches — consistent with every prior program task); bounded `Read`/`Grep` used instead, scoped exactly to `scripts/test-runtime/**`, root `package.json`, `server/package.json`, `server/prisma/schema.prisma`, `server/prisma.config.ts`, and `server/src/db.ts`.

- `scripts/test-runtime/lib/process.ts`'s `runMigrations()` ran `npx prisma generate && npx prisma migrate deploy` **unconditionally on every single disposable-profile invocation**, targeting the shared, schema-derived default output directory `server/node_modules/.prisma/client` (`server/prisma/schema.prisma`'s `generator client` block has no custom `output`; `server/prisma.config.ts` only configures `schema`/`migrations`/`datasource` paths, not generator output).
- `orchestrator.ts`'s `runVerifyParallel()` runs the postgres pair (2-way concurrent, via `Promise.all`) to completion **first**, then the storage pair (2-way concurrent) — not full 4-way concurrency as §38's prose imprecisely stated. The EBUSY was correctly observed within the storage pair specifically; this section corrects that imprecision without deleting §38's original wording.
- Each concurrent child independently spawned its own `npx prisma generate` child process (`spawnAsync`), racing on the same shared output directory — a genuine Windows filesystem collision, not a Docker name/port/database collision (all `collisionCheck` fields were already `true` in the failed run).
- Prisma Client generation output depends only on `schema.prisma`, never on `DATABASE_URL` or any other per-run value (confirmed by direct inspection of `server/src/db.ts`'s `new PrismaClient(...)` construction — the connection string is supplied at runtime, not baked in at generate time) — so one generation safely serves every child spawned within the same orchestrator invocation.
- `prisma migrate deploy` does not require the generated `@prisma/client` output — it operates directly against `prisma/migrations/**` and the schema, independent of the generated client (Prisma's own documented CLI architecture; not itself a claim requiring repository-specific evidence).

Answers to the 7 required root-cause questions: (1) `npx prisma generate`, run once per disposable-profile invocation; (2) `server/node_modules/.prisma/client` (the default `prisma-client-js` output); (3) not required per invocation — only once per orchestrator process; (4) yes, safely, since generation is schema-derived only; (5) no, `migrate deploy` does not require generation first; (6) not attempted — Option A (below) achieves the fix without any per-run output path or import change; (7) no cross-process lock needed — `verify-parallel`'s concurrency is entirely same-process (one Node orchestrator process spawning child Docker/CLI processes via `Promise.all`), so an in-process generate-once step, ordered before fan-out, fully eliminates the race.

### 39.3 Chosen remediation: Option A — generate once before parallel fan-out

New module `scripts/test-runtime/lib/prismaGeneration.ts`: `generatePrismaClientOnce(env, runner?)` runs `npx prisma generate` exactly once and mints a random 32-hex-char single-process authorization token (`node:crypto.randomBytes(16)`) recorded in a private, module-scoped `Set<string>`. `isValidGenerationAuthorization(auth)` returns `true` only for a token present in that set — a fabricated/foreign token, an object from an unrelated call, or `undefined` all return `false`. `runMigrations()` (`lib/process.ts`) now accepts an optional `{ authorization }`; when `isValidGenerationAuthorization(authorization)` is `false` (including when no authorization is supplied at all — the standalone `postgres`/`storage` profile path, unchanged from before this task), it runs its own `prisma generate` exactly as before. `orchestrator.ts`'s `runVerifyParallel()` now calls `generatePrismaClientOnce()` exactly once, before spawning any child; if generation fails, the function returns immediately with `generation.succeeded: false` and empty `postgresPair`/`storagePair` arrays — **zero Docker resources are created**, matching "generation failure prevents fan-out." On success, the one authorization is passed to all 4 `runDisposableProfile()` calls, each of which passes it through to its own `runMigrations()` call, which skips its own generate step.

This is the narrowest safe fix supported by direct repository evidence: no schema/migration change, no application import change, no lock/mutex, no new external dependency, and standalone single-invocation profiles are byte-for-byte unaffected (they still generate exactly once, exactly as before — just via the same code path, now gated by an authorization check that is trivially `false` when none is supplied).

Rejected: Option B (cross-process lock) — unnecessary complexity for a same-process concurrency problem; Option C (per-run isolated Prisma output) — would require either an application import change or non-trivial `node_modules` manipulation, for no additional safety benefit over Option A.

### 39.4 Files changed

- `scripts/test-runtime/lib/paths.ts` (new) — extracted `REPO_ROOT`/`SERVER_DIR` constants (previously inline in `process.ts`) to break a would-be circular import between `process.ts` and the new `prismaGeneration.ts`.
- `scripts/test-runtime/lib/prismaGeneration.ts` (new) — the generate-once coordination mechanism described above.
- `scripts/test-runtime/lib/process.ts` — `runMigrations()` accepts `{ authorization }` and skips its own generate step only when a valid authorization is presented.
- `scripts/test-runtime/lib/profiles.ts` — added `'parent-generate'` to `INJECTABLE_FAILURE_MODES`, a new test-only failure-injection mode analogous to the existing 4 (a real, deterministic non-zero exit via `NMTEST_INJECT_PARENT_GENERATE_FAILURE=1`, not a fabricated failure).
- `scripts/test-runtime/orchestrator.ts` — `RunOptions.generationAuthorization`; `runDisposableProfile()` passes it to `runMigrations()`; `runVerifyParallel()` now generates once up front and aborts before fan-out on failure; `main()`'s `verify-parallel` exit-code logic now also requires `generation.succeeded` and all 4 children having actually run.
- `scripts/test-runtime/__tests__/orchestratorUnit.test.ts` — 9 new focused unit tests for the coordination mechanism (§39.5) plus an update to the existing `isValidInjectFailureMode` test to include `'parent-generate'`.

No schema, migration, CI workflow, application-domain, or `server/package.json` file was touched.

### 39.5 Unit tests (Docker-free, `npm run test:runtime:unit`)

`generatePrismaClientOnce` accepts an injectable `GenerateRunner` function specifically so these tests exercise the coordination logic without spawning a real subprocess:

1. Only one generation owner: a counting fake runner proves the underlying command is invoked exactly once per `generatePrismaClientOnce()` call.
2. A single minted token authorizes multiple independent verifiers — models concurrent children all correctly recognizing the one shared authorization.
3. Generation failure propagates the real underlying exit code (not fabricated).
4. A failed generation mints no token — no child can be authorized by a failed run.
5. The `parent-generate` injection env var forces deterministic failure regardless of the underlying runner's own outcome.
6. A slow-but-successful runner still resolves to success — no premature/artificial timeout is introduced (Option A has no lock/wait loop, so no timeout mechanism is needed or added).
7. A fabricated/unrelated token never validates — unrelated run IDs cannot spoof authorization.
8. A child without a valid authorization cannot skip generation (the exact fail-safe gate `runMigrations()` itself uses).
9. `resetGenerationAuthorizationsForTest()` revokes previously-valid tokens (cleanup/release behavior between test cases).

Two list items from the task's minimum-coverage list are explicitly **not applicable** under Option A and are recorded as such rather than faked: **stale-lock behavior** (no lock exists — Option A has no lock to go stale) and a dedicated **timeout-behavior** test beyond item 6 above (no cross-process wait loop is introduced; the existing `npx prisma generate` call has no additional timeout wrapper, consistent with the "no sleep as correctness mechanism" and "no indefinite wait" prohibitions — Option A removes the concurrency rather than making processes wait on each other).

Result: **59/59 passed, 0 failed** (the pre-existing 50 plus these 9 new ones).

### 39.6 Standalone profile and failure-injection reruns (real Docker Desktop engine)

- `npm run test:runtime:postgres`: exit `0`, `server:test:disposable-db` (9 members) exit `0`.
- `npm run test:runtime:storage`: exit `0`, `server:test:storage-integration` exit `0` (21/21 assertions).
- `npm run server:test:non-disposable` (from `server/`): exit `0`, 68/68 — no regression.
- Postgres failure-injection modes re-run against the new wiring: `--inject-failure=test` (exit `1`, tests failed, cleanup succeeded), `--inject-failure=migration` (exit `1`, failed at `migrate-deploy`, cleanup succeeded), `--inject-failure=readiness` (exit `1`, readiness timeout, cleanup succeeded), `--inject-failure=cleanup` (tests passed, cleanup deliberately failed via sidecar, exit `1`) — all four unchanged in behavior, confirming standalone invocations are unaffected by this fix.
- New `verify-parallel --inject-failure=parent-generate`: `generation.succeeded: false`, `code: 1`, `postgresPair: []`, `storagePair: []`, exit `1` — **zero Docker containers or networks created** (confirmed via `docker ps -a`/`docker network ls` immediately after), proving generation failure genuinely prevents fan-out.

### 39.7 Parallel stability gate — total attempts, every failure, 5 consecutive successes

Total `verify-parallel` attempts across F1-003-P2-R1 and F1-003-P2-R2 combined: **8** (3 pre-fix in R1, 5 post-fix in R2). Every attempt, not only the final five:

| # | Task | Result | Notes |
|---|---|---|---|
| 1 | R1 | success | pre-fix |
| 2 | R1 | **FAILED** | real Windows `EBUSY` in concurrent `prisma generate` (storage pair) — the finding this task fixes |
| 3 | R1 | success | pre-fix, re-run to check for a pattern |
| 4 | R2 (attempt 1) | success | post-fix; exactly 1 `Generated Prisma Client` log line for the whole run; zero `EBUSY` |
| 5 | R2 (attempt 2) | success | post-fix; 1 generation; zero `EBUSY` |
| 6 | R2 (attempt 3) | success | post-fix; 1 generation; zero `EBUSY` |
| 7 | R2 (attempt 4) | success | post-fix; 1 generation; zero `EBUSY` |
| 8 | R2 (attempt 5) | success | post-fix; 1 generation; zero `EBUSY` — **5th consecutive clean run, gate satisfied** |

Attempts 4-8 (R2's own 5 consecutive runs) each: `generation.succeeded: true`; both postgres-pair and both storage-pair children exit `0` (4/4 every run); `collisionCheck` all `true` every run; exactly one `Generated Prisma Client` line in the combined log every run (confirming the fix — generation happens once, not up to 4 times); zero `EBUSY` anywhere; `docker ps -a`/`docker network ls` show zero `nmtest-*` resources immediately after every single run. The counter was never reset to hide attempt 2's failure — it is recorded here as part of the same continuous total.

### 39.8 Migration status

No schema or migration file created or modified. Existing migrations (already-committed `prisma/migrations/**`) were applied only to disposable, per-run databases during every rerun above. No production database access. No `_prisma_migrations` table manually altered. No rollback performed or claimed.

### 39.9 Security / tenant / KVKK impact

- **Trust boundary**: the generate-once mechanism is an in-process, same-invocation trust boundary, not a cross-process or cross-machine one — `validTokens` is a private module-scoped `Set` that dies with the orchestrator process; there is no persisted lock/temp file of any kind, so there is no stale-lock-file deletion safety question to answer (no lock file exists).
- **Command-injection impact**: none — the new code paths introduce no new shell string concatenation; `generatePrismaClientOnce`'s default runner reuses the existing `spawnAsync` argv-array invocation pattern (`shell: true` only for the pre-existing Windows `npx.cmd` case, with only fixed internal literal arguments, unchanged from before this task).
- **Temp/lock-file permissions**: not applicable — no file-based lock or temp artifact is created by this mechanism.
- No application runtime file imports this tooling (`scripts/test-runtime/**` remains test/dev-only).
- No tenant-scoping/authorization behavior changed — every disposable-DB test in `server:test:disposable-db`/`server:test:storage-integration`/`server:test:non-disposable` passed unchanged.
- No real patient data — all fixtures remain synthetic, unchanged from the original P2 implementation.
- No KVKK freeze boundary touched.

### 39.10 Rollback

Single `git revert` of this task's commit — removes `lib/paths.ts` and `lib/prismaGeneration.ts`, and reverts the `process.ts`/`profiles.ts`/`orchestrator.ts`/unit-test changes, restoring the pre-R2 (racy) behavior. No lock/temp artifact exists to clean up (none is ever created). No schema/data/deployment rollback applicable.

### 39.11 Corrected acceptance-criteria status (items 17 and 18)

| id | text | pre-R2 status | R2 status | Evidence |
|---|---|---|---|---|
| 17 | At least two concurrent postgres runs succeed without collision | `MET` (2 runs only, later found to rest on an unproven assumption per §38) | `MET` | 5/5 consecutive clean runs post-fix, §39.7 |
| 18 | At least two concurrent storage runs succeed without collision | `MET` (2 runs only; run 2 of a later 3rd/4th check hit real `EBUSY`, §38) | `MET` | 5/5 consecutive clean runs post-fix, §39.7 |

All other 32 criteria are unaffected by this correction and remain `MET` as originally recorded.
