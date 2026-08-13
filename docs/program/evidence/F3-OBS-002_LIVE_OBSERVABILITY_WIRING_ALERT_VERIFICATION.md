# F3-OBS-002 — Live Observability Wiring and Alert Verification

**Task ID:** F3-OBS-002 · **Phase:** F3 — Production Hardening · **Priority:** CRITICAL / F3 exit-gate criterion 1 · **Risk:** R-074
**Branch:** `feature/f3-obs-002-live-observability-alert-verification` · **Worktree:** `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-obs-002-v2`
**Baseline:** `origin/main` @ `87e9353ac9557a3896dc2ef7f71217ac453132fa` (PR #404/F3-PROD-002 merge commit), fresh `git fetch`/`git worktree add`, no drift at task start.
**Status:** `IMPLEMENTED_REPOSITORY_SIDE / NOT_PRODUCTION_INSTALLED / NOT_PRODUCTION_VERIFIED` — repository-side artifacts implemented, self-reviewed, and tested (42/42, post-R1); production/external activation NOT performed. This is a skeleton evidence file for the implementation phase only. **Does not close R-074. Does not satisfy the F3 exit gate.** See §12.

This document intentionally stops short of a completion claim: per this task's own governing instructions, no external provider was configured, no systemd unit was installed on any host, and no controlled drill was executed. Those steps require explicit human/operator approval and are proposed, not performed (§10–§11). This file will be revised (not replaced) once that evidence exists.

---

## 1. What changed and why

The interim inventory (accepted, prior report in this same task thread) found the repository-side observability foundation (F3-OBS-001: `/api/livez`, `/api/readyz`, fatal-error logging, a no-op-by-default error-tracking boundary) fully built and confirmed live, but **zero** external monitor, alert channel, or human-notification path anywhere. Four corrections from that review shaped this implementation phase:

1. **Redis monitoring must not rely on `/api/readyz`'s root `status` field** — `evaluateReadiness()` ([`readiness.ts`](../../../server/src/utils/readiness.ts)) is deliberately fail-open on Redis (module docstring, lines 18-27): a Redis outage never flips `status` away from `"ok"`. A monitor asserting only root status would silently miss every Redis-only degradation. See §2.
2. **Dead-man's-switch ping URLs are secrets.** They are never committed, never printed by the opscheck script, and are documented by variable name only. See §5.
3. **No naive fire-and-forget Sentry call was added to the fatal-error path.** `fatalErrorHandlers.ts` still does not call `captureFatalError` — see §9 for why this is deliberately deferred, not fixed here.
4. **The host-side check is a repo-owned shell script run by a root-owned systemd oneshot service + timer, not application-embedded node-cron** — independence from the two processes it monitors is the entire point (a monitor running inside `noramedi-api` cannot report that `noramedi-api` is down). See §6/§10.

## 2. Redis monitoring — exact assertion design

Confirmed production JSON shape of `GET /api/readyz` (`routes/health.ts:49-59`, `utils/readiness.ts:72-98`):

```json
{
  "status": "ok",
  "role": "api",
  "checks": [
    { "name": "database", "status": "ok" },
    { "name": "redis", "status": "ok" }
  ]
}
```

`{ name: 'redis', status: 'ok' }` is a JS object literal with `name` inserted before `status`; `JSON.stringify` preserves insertion order for string keys, so the serialized substring is deterministically `"name":"redis","status":"ok"` — confirmed by reading the exact object-literal source, not assumed. Production has `REDIS_URL` set (`PRODUCTION_TOPOLOGY.md` §1: "Redis 7.0.15 (active, REDIS_URL set)"), so `checkRedis` is provided and a healthy production response contains `redis`/`ok`, never `skipped`.

**Proposed external-monitor assertion (two acceptable forms, provider-dependent):**
- **JSONPath/API-check form** (if the provider supports it): assert `$.checks[?(@.name=='redis')].status == "ok"`.
- **Body-keyword form** (universal fallback): assert the raw response body contains the literal substring `"name":"redis","status":"ok"`.

Either form fails correctly when Redis is down (`status` becomes `"fail"`) or when `REDIS_URL` is unset in some future environment (`status` becomes `"skipped"`) — both are distinguishable from `"ok"` by a plain substring/JSONPath match. **No root-status-only assertion is proposed anywhere in this design.** This is documented here as the exact provider-configuration instruction to hand to the operator at activation time (§10) — no provider has been configured yet.

## 3. Backup freshness — exact source and semantics

Read directly from [`backupService.ts`](../../../server/src/services/backupService.ts) rather than duplicated or called via its authenticated HTTP route, per this task's instruction:

- `BACKUP_DIR = '/root/noramedi-backups'` (`backupService.ts:9`)
- `BACKUP_FILENAME_RE = /^noramedi_crm-\d{8}-\d{6}\.dump$/` (`backupService.ts:14`) — mirrored exactly (as a POSIX ERE) in `scripts/noramedi-opscheck.sh`'s `BACKUP_FILENAME_RE`.
- Freshness semantics: `listBackupFiles()` sorts by filesystem `mtime` descending and treats `files[0]` as "latest" (`backupService.ts:60-61`) — the opscheck script's `check_backup()` reproduces this exact "newest matching-filename file's `mtime`" rule via `stat -c %Y`, not any different heuristic.
- **No expected-cadence/staleness threshold exists anywhere in `backupService.ts`** — it returns raw file metadata only. `NORAMEDI_OPSCHECK_BACKUP_MAX_AGE_HOURS` (default 30h) is a new, opscheck-only threshold, chosen against the cron-declared daily cadence (`/etc/cron.d/noramedi-db-backup`, `PRODUCTION_TOPOLOGY.md` §6) plus margin — not a value `backupService.ts` itself asserts.
- Retention (`RETENTION_DAYS = 7`, `backupService.ts:13`) is unrelated to freshness and is not read or duplicated by the opscheck script.
- This local filesystem read requires root (the directory is under `/root`), which is why the opscheck systemd service runs as `User=root` (§6) — the same privilege level `noramedi-api`/`noramedi-worker` already run at (`PRODUCTION_TOPOLOGY.md` §2, "Owner: root").
- No backup business logic (retention pruning, `runBackup()`, `runRestoreTest()`) is duplicated — the opscheck script only ever reads directory/file metadata, never executes or modifies anything under `BACKUP_DIR`.

## 4. Files changed

| File | Type | Purpose |
|---|---|---|
| `scripts/noramedi-opscheck.sh` | New | The three independent local checks (pm2, disk, backup) + dead-man's-switch pings. Not yet installed on any host. |
| `scripts/noramedi-opscheck.test.sh` | New/Modified (R1) | Bash test harness, PATH-injected fake `pm2`/`df`/`curl`. 42/42 passing (§11). |
| `ops/systemd/noramedi-opscheck.service` | New | Reviewed template; root oneshot unit; not installed. |
| `ops/systemd/noramedi-opscheck.timer` | New | Reviewed template; 5-minute interval; not installed. |
| `ops/systemd/noramedi-opscheck.env.example` | New | Variable **names** only (no values) for the production-only, not-git-tracked `/etc/noramedi/opscheck.env`. |
| `docs/program/runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md` | Modified | Added §4.11 (automated monitoring design, explicitly marked not-yet-active); annotated the Detection lines in §4.1, §4.2, §4.7, §4.9 with current F3-OBS-002 status. No F3-IR-001 status metadata changed. |
| `docs/program/evidence/F3-OBS-002_LIVE_OBSERVABILITY_WIRING_ALERT_VERIFICATION.md` | New (this file) | Implementation-phase evidence skeleton. |

**Not changed:** `server/src/**` (no application code touched — the fatal-error/Sentry wiring gap identified in the interim report is explicitly deferred, §9), `ecosystem.config.cjs`, `server/.env.example` (these opscheck variables are host-level, not Node-app-level — kept out of the app's own env file to avoid implying the Node process reads them; documented instead in `ops/systemd/noramedi-opscheck.env.example`), `docs/program/RISK_REGISTER.md`, `docs/program/CURRENT_PHASE.md`, `docs/program/NORAMEDI_MASTER_TRACKER.md` (program-status files are deliberately not touched at this mid-flight stage — R-074/exit-gate/F4 state is unchanged, see §12; a tracker update is appropriate once real production/drill evidence exists, not before).

## 5. Secret-handling design

Three ping URLs (`NORAMEDI_OPSCHECK_PM2_PING_URL`, `NORAMEDI_OPSCHECK_DISK_PING_URL`, `NORAMEDI_OPSCHECK_BACKUP_PING_URL`) are treated as credentials throughout:

- Never accepted as a CLI argument (would leak via `ps`/shell history) — read only from environment.
- The deployed systemd service loads them via `EnvironmentFile=-/etc/noramedi/opscheck.env`, a file that (per the proposed installation commands, §10) is root-owned, mode `0600`, and **not part of this git repository** — `ops/systemd/noramedi-opscheck.env.example` documents variable names only, every value blank.
- The script itself (`scripts/noramedi-opscheck.sh`) never echoes a ping URL on any code path — success, curl failure, or missing-config — only fixed check labels (`pm2`/`disk`/`backup`) and outcome words are printed. Verified by an explicit test case (§11: "No secret leakage").
- This evidence file, and every future revision of it, records variable **names**, check **names**, timestamps, and HTTP result codes only — never a URL/UUID/key value, consistent with this task's instruction and with the existing `backupService.ts#runRestoreTest()` `'[redacted-test-db]'` precedent already established in this codebase.

## 6. Systemd design

Standalone `Type=oneshot` service + `OnUnitActiveSec=5min` timer (`ops/systemd/noramedi-opscheck.{service,timer}`), independent of PM2/the two monitored application processes — the existing production host has no prior systemd-timer convention (`PRODUCTION_TOPOLOGY.md` §6 explicitly notes backups run via cron, "no systemd timer found"), so this introduces the pattern the task instructions explicitly asked for rather than following a pre-existing repo convention (none existed). Runs as `root` (required: PM2 processes and `/root/noramedi-backups` are both root-owned, §3). **Not installed anywhere** — `ops/systemd/*.service`/`*.timer` are reviewed templates only, per the proposed commands in §10.

Hardening, reviewed line-by-line against the script's actual requirements as part of the final self-review (§15):
- `NoNewPrivileges=yes`, `ProtectSystem=strict` (read-only root filesystem except explicit exceptions — reads are unaffected, only writes are restricted, so `pm2 jlist`/`df`/`stat` all still work), `ProtectHome=read-only` (deliberately not `yes` — the backup-freshness check must still read under `/root`), `StateDirectory=noramedi-opscheck` (systemd-managed `/var/lib/noramedi-opscheck`, matches the script's own state-dir default for the restart-count delta, §7), `PrivateTmp=yes`.
- Added in the final self-review: `ProtectKernelTunables=yes`, `ProtectKernelModules=yes`, `ProtectControlGroups=yes`, `RestrictSUIDSGID=yes`, `LockPersonality=yes` — evaluated against every operation the script performs (`pm2 jlist`, `df`, `stat`, `curl`, `node -e`) and none of them touch kernel tunables/modules, cgroups, SUID/SGID files, or personality(); safe.
- Deliberately **not** added: `MemoryDenyWriteExecute` — `check_pm2()` shells out to `node -e '...'` to parse `pm2 jlist`'s JSON, and Node's V8 engine requires writable+executable memory mappings for JIT compilation; this hardening flag is a well-known way to break any Node.js process outright. Adding it would have silently broken the pm2 check specifically, not caused an obvious startup failure.
- Documented, not fixed (cannot be verified without a real host): `pm2 jlist` talks to the local pm2 daemon over `~/.pm2/pub.sock` and may touch small state/log files under root's home directory, which `ProtectHome=read-only` makes read-only to this service. The proposed installation steps (§10) now include checking `journalctl -u noramedi-opscheck.service` on first run specifically for a pm2-related failure; if one appears, the fix is a narrow `ReadWritePaths=/root/.pm2` exception, not relaxing `ProtectHome` wholesale.
- Overlap safety: this is a plain (non-templated) unit, so systemd will not start a second concurrent instance while one is still running — no locking needed in the script itself. `OnUnitActiveSec` is relative to the previous run's *deactivation*, not a fixed wall-clock grid, so a slow run pushes the next run later by the same amount; `TimeoutStartSec=60` bounds how large that drift can be. `Persistent=false` is intentional — a reboot already means the monitored processes were briefly down, so no burst of catch-up runs is wanted; `OnBootSec=2min` covers the immediate post-boot case alone. All of this is now documented inline in the two unit files, not just here.

## 7. Restart/crash-loop signal — design decision

`pm2_env.restart_time` is read for both processes each run and compared to the previous run's value (persisted in `$STATE_DIR/pm2-restarts.state`). An increase is logged as an **informational line only — it does not affect the exit code or trigger a ping-fail.** Rationale: a legitimate `pm2 startOrReload` deploy (`scripts/noramedi-deploy.sh` steps 5-6) also increments this counter, so treating any increase as a failure would false-positive on every routine deploy. A real time-windowed crash-loop threshold (e.g. "N restarts within M minutes") would need more state than a single-prior-value delta safely provides without added complexity — deliberately not attempted here. Only `pm2_env.status != "online"` is a hard failure criterion for the `pm2` check.

## 8. KVKK / tenant / security impact

- Every value the opscheck script reads or transmits is host/process metadata: PM2 process names and status words, a disk-usage percentage, and a backup filename/mtime. None of it is patient data, tenant data, a connection string, a header, or a token — confirmed by reading the script's own source (§4) and by the "No secret leakage" test case (§11).
- No tenant/application domain code was touched.
- No new subprocessor relationship exists yet — no external provider has been configured (§10 is a proposal, not an activation). When an uptime-monitor/dead-man's-switch provider is actually selected and activated, `docs/compliance/62-kvkk-subprocessor-register.md` requires that provider be added as a new row **before or with** activation — that step is called out explicitly in §10 and is not yet done.
- No Sentry/error-tracking-provider adoption is proposed by this task (§9) — the associated subprocessor-register/redaction-verification requirement that adoption would trigger stays out of scope here.

## 9. Explicitly deferred: fatal-error → error-tracking wiring

The interim inventory correctly found `fatalErrorHandlers.ts`'s `handleFatalError()` logs via `safeErrorLog` and calls `process.exit(1)` without ever calling `captureFatalError()` — so even a fully configured `SENTRY_DSN` today would never see a process-fatal event, only HTTP-request-scoped 5xx errors (the only place `captureFatalError` is currently called, `index.ts:312`).

**This is deliberately not fixed in this task.** `captureFatalError()` is `async` (network I/O to the tracking provider); `handleFatalError()` must call `process.exit(1)` promptly after an unrecoverable error. A bounded-flush design — start the async send, race it against a short timeout, and only then exit, with the timeout itself isolated from the exit path so a hung/unreachable provider can never delay process termination — is a real, separate piece of design and testing work, not a one-line `void captureFatalError(...)` insertion (which would prove nothing about delivery and risks masking failures silently). Per this task's own instruction: **R-074 does not require this to close**, since the pm2/disk/backup/uptime chain (§2, §6) already provides the required end-to-end alert path independent of Sentry. This is recorded here as a distinct, future, narrowly-scoped follow-up — not implemented, not claimed complete, no risk-register row opened for it by this task.

## 10. Proposed production installation (NOT executed — pending approval)

```bash
# On the production host, as root, from the deployed repository checkout:
install -o root -g root -m 0755 scripts/noramedi-opscheck.sh /usr/local/sbin/noramedi-opscheck.sh
install -o root -g root -m 0644 ops/systemd/noramedi-opscheck.service /etc/systemd/system/noramedi-opscheck.service
install -o root -g root -m 0644 ops/systemd/noramedi-opscheck.timer /etc/systemd/system/noramedi-opscheck.timer
install -o root -g root -m 0600 /dev/null /etc/noramedi/opscheck.env
# then: fill in the three *_PING_URL values in /etc/noramedi/opscheck.env manually — never via this repository
systemctl daemon-reload
systemctl enable --now noramedi-opscheck.timer
systemctl status noramedi-opscheck.timer
journalctl -u noramedi-opscheck.service -n 20 --no-pager   # confirm first run's summary line, no secrets present,
                                                             # and specifically no pm2-related failure caused by
                                                             # ProtectHome=read-only (see §6 residual-risk note —
                                                             # if present, add ReadWritePaths=/root/.pm2, not a
                                                             # wholesale ProtectHome relaxation)
```

External-provider steps (still to be selected/approved — see the interim report's §10 provider recommendation: an UptimeRobot-class uptime prober plus a Healthchecks.io-class dead-man's-switch service):
1. Create 2 HTTP monitors: `https://api.noramedi.com/api/livez` (plain status) and `https://api.noramedi.com/api/readyz` (body/keyword assertion per §2 — both the general-health and the Redis-specific assertion).
2. Create 3 dead-man's-switch checks (`pm2`, `disk`, `backup`), each with a grace period ≥ 15 minutes (3x the timer's 5-minute interval, per `ops/systemd/noramedi-opscheck.timer`'s own comment).
3. Configure a real alert-delivery channel (minimum: email) on all 5 monitors, addressed to the production operator (§4.11 of the runbook).
4. Add the chosen provider(s) to `docs/compliance/62-kvkk-subprocessor-register.md` as part of, not after, this activation.

**Rollback for every step above:** disable/delete the monitor in the provider console (seconds, zero application impact); `systemctl disable --now noramedi-opscheck.timer` (stops the local check; zero impact on `noramedi-api`/`noramedi-worker`, which the opscheck script never starts, stops, or reloads); `rm /etc/systemd/system/noramedi-opscheck.{service,timer} && systemctl daemon-reload` to fully remove. No PM2 process, no database, no tenant-facing behavior is touched by installing, running, or removing any of this.

## 11. Tests and validation performed (in this worktree, no production access)

**Historical — pre-R1 implementation-phase self-review (§15), superseded by the R1 count below; kept for the record, not current.**

```
$ bash -n scripts/noramedi-opscheck.sh
(no output — syntax OK)

$ bash -n scripts/noramedi-opscheck.test.sh
(no output — syntax OK)

$ bash scripts/noramedi-opscheck.test.sh
Syntax
  ok - noramedi-opscheck.sh parses (bash -n)
Fully healthy — 4/4 assertions ok
API process offline — 3/3 assertions ok (incl. /fail-suffixed ping on local failure)
Worker process offline — 1/1 assertions ok
Disk over threshold — 1/1 assertions ok
Disk under threshold — 1/1 assertions ok
Disk exactly at threshold boundary — 2/2 assertions ok
Invalid disk threshold config fails closed — 3/3 assertions ok
Backup stale — 1/1 assertions ok
Backup exactly at max-age boundary — 1/1 assertions ok
Invalid backup max-age config fails closed — 2/2 assertions ok
Backup directory missing — 1/1 assertions ok
Backup directory has no matching file — 1/1 assertions ok
Ping transport failure (local checks otherwise healthy) — 2/2 assertions ok
Ping URL not configured — 2/2 assertions ok
Dry-run mode — 2/2 assertions ok
Suppressed ping (drill mechanism) — 3/3 assertions ok
No secret leakage — 1/1 assertions ok

Results: 32 passed, 0 failed
```

**Current — R1 full re-run, after the three corrections in §16.** This is the CURRENT test count; the 32/32 transcript above is historical only.

```
$ bash -n scripts/noramedi-opscheck.sh
(no output — syntax OK)

$ bash -n scripts/noramedi-opscheck.test.sh
(no output — syntax OK)

$ bash scripts/noramedi-opscheck.test.sh
Syntax
  ok - noramedi-opscheck.sh parses (bash -n)
Fully healthy — 4/4 assertions ok
API process offline — 3/3 assertions ok (incl. /fail-suffixed ping on local failure)
Worker process offline — 1/1 assertions ok
Disk over threshold — 1/1 assertions ok
Disk under threshold — 1/1 assertions ok
Disk exactly at threshold boundary — 2/2 assertions ok
Invalid disk threshold config fails closed — 3/3 assertions ok (incl. exit code 16, R1)
Exit-code contract: config/CLI errors use 16, never collide with bitmask bits 0-3 — 3/3 assertions ok (R1)
Backup stale — 1/1 assertions ok
Backup exactly at max-age boundary — 1/1 assertions ok
Backup mtime in the future (clock skew fails closed, not silently healthy) — 4/4 assertions ok (R1)
Invalid backup max-age config fails closed — 3/3 assertions ok (incl. exit code 16, R1)
Backup directory missing — 1/1 assertions ok
Backup directory has no matching file — 1/1 assertions ok
Ping transport failure (local checks otherwise healthy) — 2/2 assertions ok
Ping URL not configured — 2/2 assertions ok
Dry-run mode — 2/2 assertions ok
Suppressed ping (drill mechanism) — 3/3 assertions ok
No secret leakage — 1/1 assertions ok

Results: 42 passed, 0 failed

$ git diff --check
(no output — clean)
```

Coverage matches this task's required scenario list exactly: api offline, worker offline, disk over threshold, backup stale (plus: backup dir missing, backup dir with no matching file — two additional fail-closed edge cases), curl/ping failure, no-secret-leakage — plus dry-run, the drill-suppression mechanism (§14), exact threshold-boundary behavior for both disk and backup, and fail-closed rejection of malformed threshold config (added during the final self-review, §15). **R1 adds:** a future-mtime backup scenario (bit 4 set, FAIL diagnostic naming the future-timestamp condition, `/fail`-suffixed ping fired, no secret-token leakage on that path) and an explicit exit-code-contract scenario proving config/CLI errors (invalid threshold, invalid max-age, unknown flag, unknown `--check` value) all exit `16` while a genuine check failure still exits within the `0-15` bitmask range (§16).

`shellcheck` was **not** introduced — it is not already present in this repository/CI (confirmed by grep before starting), and the task instructions say not to add a new dependency solely for this. `bash -n` plus the fake-command unit harness above is the validation performed, consistent with the syntax-check-only precedent already used for `scripts/test-runtime/*.sh` in `.github/workflows/ci-layers.yml`.

No CI workflow file was modified — `scripts/noramedi-healthcheck.sh` and `scripts/noramedi-deploy.sh` also have no CI syntax check today (confirmed by grep), so adding one for only the new script would be new scope beyond what this task's instructions authorize; noted here as a pre-existing gap, not fixed by this task.

Runbook edit validated with `git diff --check` (no whitespace errors) and a manual read for internal consistency with the R-074/exit-gate wording used elsewhere in this program (§12).

## 12. Program status (unchanged by this task)

```
R-074 = OPEN
F3_EXIT_GATE = NOT SATISFIED
F3_COMPLETE = NO
F4_TRANSITION_AUTHORIZED = NO
```

No `docs/program/RISK_REGISTER.md`, `CURRENT_PHASE.md`, or `NORAMEDI_MASTER_TRACKER.md` row was edited by this task. This file itself is the only new evidence artifact; it is deliberately not indexed as a closure record.

## 13. What remains before R-074 can close

1. Operator/program-controller approval of the provider choice and the installation commands in §10.
2. Actual external-provider configuration (uptime monitors + dead-man's-switch checks + alert channel) — not yet done.
3. Actual installation of `noramedi-opscheck.sh` + the systemd unit/timer on the production host — not yet done.
4. Both controlled drills (§14) executed and their evidence captured.
5. `docs/compliance/62-kvkk-subprocessor-register.md` updated with the chosen provider(s).
6. A final revision of this evidence file with real (non-secret) timestamps/latencies, followed by the `RISK_REGISTER.md`/`CURRENT_PHASE.md`/`NORAMEDI_MASTER_TRACKER.md` updates that step 5 of the interim report's closure criteria requires.

## 14. Controlled drill plan (proposed, not yet executed)

**DRILL A — external HTTP/API monitor.** Temporarily edit only the `/api/readyz` monitor's assertion (e.g. change the expected Redis-check keyword to a string the real, unchanged, healthy response does not contain) so the monitor evaluates the live, healthy endpoint as failed — the running application is never touched. Capture: trigger timestamp, monitor detection timestamp, alert-rule timestamp, delivery timestamp, channel, recipient, acknowledgement if available, revert timestamp, recovery/green timestamp, and the two calculated latencies (detection, recovery).

**DRILL B — dead-man's-switch check.** Do not stop `noramedi-api`/`noramedi-worker`. Set `NORAMEDI_OPSCHECK_SUPPRESS_PING=disk` (or another single check name) in `/etc/noramedi/opscheck.env`, restart the timer/service so it takes effect, and leave it in place past the configured grace period so only that one check's provider-side alert fires — the local check itself keeps running and keeps reporting its true (healthy) result the whole time, confirmed by this task's own test coverage (§11, "Suppressed ping"). Then remove the env-file line and restart again. Capture the same timestamp/latency set as Drill A.

Both drills are config-only, reversible in one step, touch no tenant data, and were designed specifically to avoid the "deliberately cause a real API outage" fallback this task's instructions treat as a last resort requiring separate explicit approval.

## 15. Final self-review — findings and fixes (before PR)

A targeted line-by-line review against 10 specific gates (secret handling, systemd security contract, pm2/disk/backup check correctness, dead-man ping semantics, timer semantics, drill safety, Redis assertion design) was performed on all seven changed/new files before opening a PR. Two genuine defects were found and fixed; several other gate items were confirmed already correct and are noted for completeness.

**Fixed:**
1. **Fail-open on malformed threshold config (real bug).** `check_disk()`/`check_backup()` compare against `NORAMEDI_OPSCHECK_DISK_THRESHOLD_PERCENT`/`NORAMEDI_OPSCHECK_BACKUP_MAX_AGE_HOURS` with no validation that either is numeric. Bash's `[[ N -ge X ]]` with a non-numeric `X` returns false without tripping `set -e` when it is the direct condition of an `if` — so an invalid value made the disk/backup check silently report "OK" regardless of actual usage/age, the opposite of fail-closed. Fixed: both values are now validated at script startup (integer, `DISK_THRESHOLD_PERCENT` in 1-100, `BACKUP_MAX_AGE_HOURS` ≥ 1) and the script exits nonzero immediately on an invalid value, rather than silently proceeding. Covered by 5 new test scenarios.
2. **Test-harness timezone bug** in `touch_backup_file()` (test file only, not the shipped script): it computed a UTC timestamp via `date -u -d "-N hours"` but passed it to `touch -t`, which interprets its argument in **local** time — silently skewing the resulting mtime by the host's UTC offset. A coarse existing test (48h-old file, 30h max) didn't reveal it; the new exact-boundary test did (measured 32h instead of 30h). Fixed by switching to `touch -d "@$epoch"` (absolute Unix epoch, timezone-unambiguous).

**Also improved (not bugs, but gaps against the review gates):**
3. `DISK_PATH` was documented as "test-only, never set in production" — factually wrong: it is the one real operational knob for which mount is measured. Reclassified as operational tuning; documented that the current default (`/`) is justified by `PRODUCTION_TOPOLOGY.md`'s single-disk-host observation (app, uploads, DB, and the backup directory all share one filesystem, no confirmed second mount), and that this must be re-verified if that topology ever changes.
4. `pm2 jlist` had no local execution bound — only the systemd unit's `TimeoutStartSec=60` protected against a hung pm2 daemon, and that protection disappears for a manual/interactive run (e.g. during a drill). Added a local `timeout 10` wrapper.
5. `export LC_ALL=C` added at script start so `df`/`stat`/`awk` number formatting can never vary by host locale (defense-in-depth; `df -P` was already locale-stable by POSIX spec).
6. Systemd hardening: added `ProtectKernelTunables`, `ProtectKernelModules`, `ProtectControlGroups`, `RestrictSUIDSGID`, `LockPersonality` (all confirmed safe against every operation the script performs). Evaluated and explicitly did **not** add `MemoryDenyWriteExecute`, which breaks V8 JIT and would have broken `check_pm2()`'s `node -e` call. Documented as a residual, host-unverifiable risk that `pm2 jlist` might need read/write access under `/root/.pm2` despite `ProtectHome=read-only`, with the exact narrow fix (`ReadWritePaths=/root/.pm2`) to apply if `journalctl` shows a pm2-specific failure on first install.
7. Added test coverage for the exact disk/backup threshold boundary (inclusive `>=` for disk, exclusive `>` for backup — both intentional and now explicit) and for the local-failure → `/fail`-suffixed-ping path (previously implied by design but not asserted).

**Confirmed already correct, no change needed:** PM2 check matches both process names exactly (not by array position), fails on absent/malformed/empty `pm2 jlist` output, never calls a mutating pm2 subcommand; backup check's directory/regex/mtime-newest-file semantics were already verified byte-for-byte against `backupService.ts` (§3); the local-check bit and the ping-transport bit (bit 3) were already independently tested as never conflating the two; `NORAMEDI_OPSCHECK_SUPPRESS_PING=disk` was already proven scoped to exactly one check via the existing curl-invocation-count assertion; no ping URL, environment value containing one, or secret token appears in script stdout/stderr on any path (curl's own stderr, which could echo the URL on failure, is explicitly redirected to `/dev/null` rather than surfaced); Redis assertion design (§2) already used a structured JSONPath-preferred / keyword-fallback design tied to the confirmed exact JSON shape, never the root `status` field.

Full re-validation after these fixes (pre-R1): `bash -n` clean on both scripts, `bash scripts/noramedi-opscheck.test.sh` → **32 passed, 0 failed**, `git diff --check` clean (§11 — historical block). **Superseded by the R1 count: 42 passed, 0 failed (§11 — current block, §16).**

## 16. R1 correction (post-review) — three defects fixed, edited in place on this same PR

A subsequent review of PR #405 found three defects in the implementation this §15 self-review did not catch. Per this program's `+R1` same-task-revision convention, all three are corrected in place on this branch (not a new dated layer), since PR #405 has not yet merged.

**1. Backup future-timestamp / clock-skew fail-open (real bug, `check_backup()`).** The freshness computation `age_hours=$(( (now - newest_epoch) / 3600 ))` was never guarded against `newest_epoch > now`. A backup file with a future mtime (clock skew, a bad `touch`, a restored/replayed file) produced a **negative** `age_hours`, which fails the `age_hours -gt BACKUP_MAX_AGE_HOURS` comparison and was therefore reported **OK** — the opposite of fail-closed, the same class of defect §15 already fixed once for malformed threshold config but which survived here in a different form. **Fixed:** `check_backup()` now explicitly rejects `newest_epoch > now` before computing age, with a fixed diagnostic (`"backup check: FAIL — newest backup timestamp is in the future"`, no filename in the message, and no filename ever reaches the ping payload — pings remain label+outcome-only, unchanged from §5's design) and sets the same backup bit (4) as every other backup failure. A bounded clock-skew tolerance was considered and rejected in favor of the simpler fail-closed rule the task instructions preferred — any future timestamp on the file that is supposed to be the *most recent* backup is itself evidence of a problem (misconfigured clock or corrupted metadata), not a condition worth tolerating within a margin. Covered by a new 4-assertion scenario (`scripts/noramedi-opscheck.sh`:283-325, `scripts/noramedi-opscheck.test.sh`, "Backup mtime in the future"): bit 4 set, the FAIL diagnostic is present, the local failure still pings the `/fail`-suffixed URL, and no ping-URL secret token leaks into script output on this path.

**2. Exit-code bitmask/exit-1 collision (`check_disk()`/`check_backup()` startup validation, CLI parsing).** The script's own header comment documented exit code as a bitmask where bit 0 (value 1) means "pm2 check failed," but startup validation of `NORAMEDI_OPSCHECK_DISK_THRESHOLD_PERCENT`/`NORAMEDI_OPSCHECK_BACKUP_MAX_AGE_HOURS`, and CLI parsing errors (unknown flag, unrecognized `--check` value) all `exit 1` directly — semantically colliding with "pm2 check failed" and making a bare `exit 1` ambiguous between "a real check failed" and "the script never ran any check because it was misconfigured." **Fixed via option A** (explicit configuration-error code outside the bitmask range): added `CONFIG_ERROR_EXIT_CODE=16` and changed all four config/CLI-error exit points (invalid disk threshold, invalid backup max-age, unknown CLI flag, unrecognized `--check` value) to exit `16` instead of `1`. `16` is outside `0-15`, the full range the four-bit `pm2|disk|backup|ping` mask can produce, so it can never be misread as any combination of check failures; the header comment (`scripts/noramedi-opscheck.sh`:31-47) now states explicitly that the bitmask applies only once startup configuration validation has passed. Backward-compatible: any caller already treating "nonzero = not fully healthy" is unaffected; only a caller specifically testing for `exit code == 1` to mean "pm2 failed" would need to know the semantics were previously ambiguous (no such caller exists in this repository — the opscheck script is not yet installed anywhere, §10). Covered by 5 new/extended test assertions across three scenarios: the existing "Invalid disk threshold" and "Invalid backup max-age" scenarios now additionally assert `CODE -eq 16`, and a new "Exit-code contract" scenario proves an unknown flag exits 16, an unrecognized `--check` value exits 16, and a genuine pm2-check failure still exits `1` (bit 0 only) — the two families are distinguishable, not merely both nonzero.

**3. Stale test count in this evidence document.** §4's files-changed table said `scripts/noramedi-opscheck.test.sh` was "23/23 passing," which never matched this file's own §11/§15 transcripts (32/32, from the moment those sections were first written) or the PR body/implementation report. This was a transcription error in the table row only, not a re-run discrepancy. **Fixed:** §4 now says 42/42 (the current, post-R1 count), matching §11 and §12/§15 below.

**Re-run after all three fixes:** `bash -n scripts/noramedi-opscheck.sh` clean, `bash -n scripts/noramedi-opscheck.test.sh` clean, `bash scripts/noramedi-opscheck.test.sh` → **42 passed, 0 failed**, `git diff --check` → clean (no whitespace errors). Full transcript in §11 (current block).

**Files touched by this R1 correction:** `scripts/noramedi-opscheck.sh`, `scripts/noramedi-opscheck.test.sh`, this evidence file. No other file documents the exit-code contract (confirmed by grep across `docs/program/` and `ops/systemd/` before starting), so no other file required a change. No application code, schema, migration, or CI workflow touched. Program status is unchanged (§12): **R-074 remains `OPEN`, the F3 exit gate remains `NOT SATISFIED`, F3 is not complete, F4 is not authorized** — this correction fixes defects in already-not-production-installed repository-side artifacts; it does not newly close, or newly block, anything the gate itself tracks.
