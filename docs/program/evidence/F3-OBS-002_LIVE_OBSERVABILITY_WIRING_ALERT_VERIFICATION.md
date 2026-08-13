# F3-OBS-002 — Live Observability Wiring and Alert Verification

**Task ID:** F3-OBS-002 · **Phase:** F3 — Production Hardening · **Priority:** CRITICAL / F3 exit-gate criterion 1 · **Risk:** R-074
**Branch:** `feature/f3-obs-002-live-observability-alert-verification` · **Worktree:** `E:\Ek Gelir\Siteler\DisKlinikCRM-worktrees\f3-obs-002-v2`
**Baseline:** `origin/main` @ `87e9353ac9557a3896dc2ef7f71217ac453132fa` (PR #404/F3-PROD-002 merge commit), fresh `git fetch`/`git worktree add`, no drift at task start.
**Status:** `PRODUCTION_INSTALLED / PRODUCTION_VERIFIED / LIVE_ALERT_VERIFIED` — repository-side artifacts implemented, self-reviewed and tested (42/42, post-R1); production installation, external-provider activation, both controlled alert-delivery drills, and a credential-rotation remediation are all complete and evidenced. **Closes R-074. Satisfies F3 exit-gate criterion 1 only — the overall F3 exit gate remains `NOT SATISFIED`.** See §17–§20.

**Revision history of this file.** §1–§16 below are the original implementation-phase text (Phases A/B of this task), preserved unedited as dated historical record except for two factual corrections marked inline in §10 and §14. §17–§20 are the production-activation, drill, remediation and closure layers added afterwards. Per this program's convention the earlier text is **revised by addition, not rewritten** — where the original said an activation was "proposed, not performed," that was true at its own point in time and §17 is what changed it.

**Original implementation-phase framing (2026-08-12, superseded by §17):** this document intentionally stops short of a completion claim: per this task's own governing instructions, no external provider was configured, no systemd unit was installed on any host, and no controlled drill was executed. Those steps require explicit human/operator approval and are proposed, not performed (§10–§11). This file will be revised (not replaced) once that evidence exists.

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
# CORRECTED (§19 defect 1, found during live installation): the parent directory must be
# created first — install(1) does NOT create parent directories, so the next line fails with
# "No such file or directory" on a host where /etc/noramedi does not already exist.
install -d -o root -g root -m 0750 /etc/noramedi
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

## 12. Program status (as of the implementation phase — superseded by §20)

```
R-074 = OPEN
F3_EXIT_GATE = NOT SATISFIED
F3_COMPLETE = NO
F4_TRANSITION_AUTHORIZED = NO
```

No `docs/program/RISK_REGISTER.md`, `CURRENT_PHASE.md`, or `NORAMEDI_MASTER_TRACKER.md` row was edited by this task. This file itself is the only new evidence artifact; it is deliberately not indexed as a closure record.

> **Superseded by §20 (F3-OBS-002-CLOSE).** The block above is the implementation phase's own accurate point-in-time state and is preserved unedited. Current program state, after production activation (§17), both drills (§18) and the R3 credential remediation (§19): **`R-074 = CLOSED`**, **F3 exit-gate criterion 1 = `SATISFIED`** — while **`F3_EXIT_GATE` remains `NOT SATISFIED`**, `F3_COMPLETE = NO` and `F4_TRANSITION_AUTHORIZED = NO`, because criteria 2 and 3 are untouched by this task.

## 13. What remains before R-074 can close

1. Operator/program-controller approval of the provider choice and the installation commands in §10.
2. Actual external-provider configuration (uptime monitors + dead-man's-switch checks + alert channel) — not yet done.
3. Actual installation of `noramedi-opscheck.sh` + the systemd unit/timer on the production host — not yet done.
4. Both controlled drills (§14) executed and their evidence captured.
5. `docs/compliance/62-kvkk-subprocessor-register.md` updated with the chosen provider(s).
6. A final revision of this evidence file with real (non-secret) timestamps/latencies, followed by the `RISK_REGISTER.md`/`CURRENT_PHASE.md`/`NORAMEDI_MASTER_TRACKER.md` updates that step 5 of the interim report's closure criteria requires.

## 14. Controlled drill plan (proposed, not yet executed)

**DRILL A — external HTTP/API monitor.** Temporarily edit only the `/api/readyz` monitor's assertion (e.g. change the expected Redis-check keyword to a string the real, unchanged, healthy response does not contain) so the monitor evaluates the live, healthy endpoint as failed — the running application is never touched. Capture: trigger timestamp, monitor detection timestamp, alert-rule timestamp, delivery timestamp, channel, recipient, acknowledgement if available, revert timestamp, recovery/green timestamp, and the two calculated latencies (detection, recovery).

**DRILL B — dead-man's-switch check.** Do not stop `noramedi-api`/`noramedi-worker`. Set `NORAMEDI_OPSCHECK_SUPPRESS_PING=disk` (or another single check name) in `/etc/noramedi/opscheck.env` and leave it in place past the configured grace period so only that one check's provider-side alert fires — the local check itself keeps running and keeps reporting its true (healthy) result the whole time, confirmed by this task's own test coverage (§11, "Suppressed ping"). Then remove the env-file line. Capture the same timestamp/latency set as Drill A.

> **CORRECTED (§19 defect 2, proven in the live drill).** This paragraph originally instructed the operator to "restart the timer/service so it takes effect" after each env edit, and again after removing the line. **That is wrong and was never necessary.** `noramedi-opscheck.service` is `Type=oneshot` and loads `EnvironmentFile=-/etc/noramedi/opscheck.env`, which systemd re-reads on **every** `ExecStart` — so an env change takes effect on the next scheduled tick with **no `systemctl daemon-reload`, no service restart, and no timer restart**. Proven in both directions during the live drill (§18): suppression was applied at `11:26:44Z` and took effect at the `11:26:59Z` tick; it was removed at `11:44:20Z` and normal pinging resumed at the `11:48:13Z` tick — the timer was never touched, and `systemctl is-enabled`/`is-active` read `enabled`/`active` continuously throughout. The original wording was also actively hazardous: restarting the timer would reset its monotonic interval mid-drill and corrupt the very detection-latency measurement the drill exists to capture.

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

---

# Production activation and live verification (added by F3-OBS-002-CLOSE)

Everything from §17 onward is production evidence. All host facts are operator-executed; the timestamps and journal lines below were captured during the sequenced drill session and are recorded to the precision at which each source actually exposes them — never rounded up to a precision the source does not have.

**All times in §17–§19 are UTC.** Two timezone conversions are load-bearing and are stated once here rather than repeated: the production host renders journal timestamps at **UTC+03:00**, and the Healthchecks.io account UI renders at **UTC+02:00** (see §19, defect 4). Provider-UI times quoted below are given as displayed, with the UTC conversion alongside.

## 17. Production installation and external-provider wiring

**Implementation baseline.** [PR #405](https://github.com/MustafaBasol/DisKlinikCRM/pull/405) (`feature/f3-obs-002-live-observability-alert-verification`) is **`MERGED`**, merge commit **`0478c86bf97b74b2aa9f465130d2a4daaa3579ec`**, which is also the SHA deployed to production and the baseline this closure task branched from. Targeted tests **42/42 passing** (§11, current block); **PR CI 13/13 green** (operator-supplied); **no migration** — 73 migrations, unchanged, no schema/data/tenant change at any point in this task.

**Host-side installation.** `scripts/noramedi-opscheck.sh` is installed at `/usr/local/sbin/noramedi-opscheck.sh` (`root:root`, `0755`), with the service and timer units installed from `ops/systemd/`. `/etc/noramedi/opscheck.env` exists, `root:root`, mode **`0600`**, and is **not** git-tracked. `systemctl show noramedi-opscheck.service -p EnvironmentFiles` reports `/etc/noramedi/opscheck.env (ignore_errors=yes)`, matching the unit template. The timer is **`enabled`** and **`active`** on a 5-minute cadence (`OnUnitActiveSec=5min`, `AccuracySec=30s`), production-verified across the entire session.

**External monitors — UptimeRobot (5-minute interval, email alerting assigned to a real human operator on all three):**

| Monitor | Target | Assertion |
|---|---|---|
| `noramedi-api-livez` | `GET https://api.noramedi.com/api/livez` | HTTP/plain status |
| `noramedi-api-readyz` | `GET https://api.noramedi.com/api/readyz` | general readiness |
| `noramedi-api-readyz-redis` | `GET https://api.noramedi.com/api/readyz` | **body-keyword assertion on `"name":"redis","status":"ok"`** — §2's Form C fallback, alert condition "start incident when keyword does not exist" |

The Redis monitor uses the body-keyword form, not JSONPath, because the account tier does not offer JSONPath. This is §2's own documented universal fallback and is **`KNOWN_BRITTLE`** by construction: it asserts a substring of a serialized object literal, so any future reordering of the `{ name, status }` keys in `readiness.ts` would break the monitor without breaking the application. That coupling is recorded here deliberately rather than left implicit — it is the one part of this wiring that a routine, well-intentioned refactor could silently disarm.

**Dead-man's-switch checks — Healthchecks.io:** `noramedi-pm2`, `noramedi-disk`, `noramedi-backup`, each **Period = 5 minutes, Grace = 15 minutes**, email integration assigned on all three, DOWN and UP/recovery notifications enabled. Per §6's design the three ping URLs are credentials: they live only in `/etc/noramedi/opscheck.env` and appear nowhere in this repository, this document, or any transcript.

**Execution verified in production.** Both a manual (`systemctl start noramedi-opscheck.service`) and scheduled (timer-driven) invocation were confirmed, each emitting the full `pm2` / `disk` / `backup` sequence with `summary: checks=[pm2 disk backup] exit=0` and `Result=success` / `ExecMainStatus=0`. All three Healthchecks checks and all three UptimeRobot monitors were confirmed `UP` before drilling began.

## 18. Controlled alert-delivery and recovery drills

Both drills were run against live production with **no application failure induced**: §14's design was followed exactly — Drill A falsifies an external *assertion* about a healthy system, Drill B withholds *telemetry* from a healthy system. At no point were the API, worker, PostgreSQL, Redis, the backup process, or the systemd timer stopped, restarted or reloaded, and no application code ran differently.

### 18.1 Drill A — external HTTP monitor (UptimeRobot, Redis assertion) — **PASS**

| Event | UTC | Note |
|---|---|---|
| Trigger | `10:56:28Z` | expected keyword changed to a string the healthy response does not contain |
| Monitor **DOWN** | `10:57:29Z` | provider root cause `Keyword Does Not Exist` |
| Human DOWN email | *received, header time not captured* | see measurement limitation below |
| Assertion restored | `11:01:15Z` | restored to the exact `"name":"redis","status":"ok"` baseline |
| Monitor **UP** | `11:01:27Z` | incident duration 3 m 58 s |
| Human recovery email | `11:01:32Z` | Gmail header `Thu, 13 Aug 2026 04:01:32 -0700` |

**Detection latency 61 s. Recovery latency 12 s** (restore → UP), recovery email delivered 5 s after UP / 17 s after restore.

**Negative control — the application never degraded.** An independent witness polled `GET /api/readyz` every 60 s throughout, capturing **15/15 samples with `database ok` and `redis ok`** from `10:57:02Z` to `11:11:08Z` — fully bracketing the `10:57:29Z`–`11:01:27Z` incident on both sides. The DOWN state therefore originated entirely in the injected assertion, which is exactly what makes this a valid negative control rather than a real outage. Only the one monitor's keyword field was mutated; its URL, alert condition, interval and email assignment, and both other monitors, were untouched.

**Measurement limitation, recorded rather than estimated:** the DOWN email was definitely received by the human operator (subject `noramedi-api-readyz-redis is down.`), but its `Date:` header was not captured before the evidence window closed and is unrecoverable. **`A_HUMAN_ALERT_LATENCY` is therefore `NOT PRECISELY MEASURED`** and is deliberately left unquantified. Delivery is proven; only the figure is missing. Drill A passes on delivery grounds, and this gap is disclosed rather than back-filled with a plausible number.

### 18.2 Drill B — dead-man's-switch (Healthchecks, disk) — **PASS**

| Event | UTC | Note |
|---|---|---|
| Last successful `disk` ping | `11:21:55Z` | journal-proven |
| Suppression applied | `11:26:44Z` | `NORAMEDI_OPSCHECK_SUPPRESS_PING=disk` appended |
| Provider **DOWN** | `11:41Z` | UI `13:41` (+02:00); minute precision only |
| Human DOWN email | `11:41:57Z` | Gmail header `Thu, 13 Aug 2026 04:41:57 -0700` |
| Suppression removed | `11:44:20Z` | env restored byte-identically |
| First restored `disk` ping | `11:48:13Z` | journal |
| Provider **UP** | `11:48Z` | UI `13:48` (+02:00) |
| Human recovery email | `11:48:15Z` | Gmail header `Thu, 13 Aug 2026 04:48:15 -0700` |

**The disk was healthy for the entire drill.** Every suppressed run still logged `disk check: OK — 12% used at '/' (threshold 90%)` immediately before `ping suppressed for 'disk' (NORAMEDI_OPSCHECK_SUPPRESS_PING) — local result only`. This drill tests the **absence of telemetry**, not a disk failure — precisely §14's intent.

**Suppression was selective, and that is the load-bearing claim.** Four runs fell inside the suppression window (`11:26:59Z`, `11:32:24Z`, `11:37:54Z`, `11:43:00Z`) and **every one** shows `ping ok for 'pm2'` **+** `ping suppressed for 'disk'` **+** `ping ok for 'backup'` **+** `exit=0`. Exactly one of three channels went dark; `noramedi-pm2` and `noramedi-backup` stayed `UP` throughout and never alerted.

**Latencies:**
- **Human-alert latency: `20 m 02 s` — exact**, both endpoints at second precision (`11:21:55Z` last ping → `11:41:57Z` email).
- **Detection latency: bounded to `[19 m 05 s, 20 m 02 s]`**, *not* claimed to second precision. The provider UI exposes the DOWN event to the minute only; the interval is the minute `11:41Z` tightened by the email header, and it straddles the theoretical `20 m 00 s` (Period 5 m + Grace 15 m from `11:21:55Z`). Quoting a second-precision figure from a minute-precision display would be a fabricated precision, so the bound is reported instead.
- **Recovery latency: `3 m 53 s – 3 m 55 s`** (restore → UP), dominated by waiting for the next 5-minute tick rather than by provider latency; first restored ping → UP was **≤ 2 s**.

**Zero collateral impact.** A sentinel sampled PM2 and `/api/livez` nine times from `11:27:52Z` to `11:52:11Z`, spanning both the DOWN and the recovery: `noramedi-api` and `noramedi-worker` `online` at every sample, restart counts **12/12** and PIDs **607545 / 607578** unchanged — identical to the pre-drill baseline, so this task caused no process restart of any kind.

## 19. R3 — monitoring-credential exposure and remediation

**The finding, preserved as a rejected claim rather than quietly corrected.** The Phase C drill report asserted **`Secrets exposed = no`**. Architecture review **REJECTED** that claim: the full UUID-bearing Healthchecks ping URL for `noramedi-disk` was visible in an operator-provided screenshot captured during evidence collection. **That rejection stands as historical record.** The credential was treated as compromised and rotated before R-074 was allowed to close — the closure below rests on the remediation, not on the original claim.

**Blast radius, stated accurately in both directions.** A `hc-ping.com` URL is a write-only signal endpoint. A holder could send `success` (masking a genuine failure of that one check) or `/fail` (raising a false alarm on it) — a real integrity problem for the alerting chain, and simultaneously **no path whatsoever** to the host, the API, the database, or any patient/tenant data. The exposure is bounded to the trustworthiness of one monitoring signal.

**Remediation, minimum blast radius.** A replacement check was created (`noramedi-disk-v2`, later renamed) with semantics **identical** to the retired one: Period 5 m, Grace 15 m, email integration assigned, DOWN and UP/recovery notifications enabled. Only `NORAMEDI_OPSCHECK_DISK_PING_URL` was changed, edited directly on the host by the operator in their own session; the new credential never entered any transcript, log, screenshot, or this document, and was never hashed or value-grepped. `noramedi-pm2`, `noramedi-backup`, UptimeRobot, application code, schema, PM2 and the systemd unit/timer definitions were all untouched.

**Rotation proven by one-to-one correspondence, not by assertion.** Every host execution after the env edit appears as a provider ping on the replacement, while the old check stayed frozen at its last pre-edit run:

| Host run (journal, UTC) | Trigger | Replacement check | Old check |
|---|---|---|---|
| `12:03:55Z` | scheduled, pre-edit | — | `14:03` ← **frozen here** |
| `12:09:23Z` | scheduled, post-edit | `14:09` ✔ | no advance |
| `12:10:00Z` | manual | `14:10` ✔ | no advance |
| `12:15:20Z` | scheduled | `14:15` ✔ | no advance |
| `12:20:24Z` | scheduled, post-rename | `14:20` ✔ | (deleted) |

Two independent facts make this conclusive. First, the script pings via `curl -fsS`, which fails on any HTTP ≥ 400, and Healthchecks returns **404 for an unknown UUID** — so `ping ok for 'disk'` could not have been emitted against an invalid credential. Second, the old check's Last Ping never moved again. All runs reported `exit=0` with `pm2` and `backup` unaffected throughout.

**Retirement.** The old check was **paused first**, verified to be receiving nothing, then **deleted**; Healthchecks does not reissue deleted UUIDs, so the compromised credential is permanently unusable and was never reused. The replacement was then **renamed to `noramedi-disk`**, and a post-rename scheduled ping (`12:20:24Z` → `14:20`) confirms the rename preserved the UUID and did not disturb ingest. Pausing before the old check's own dead-man expiry (`12:23:55Z`) also meant **no spurious DOWN alert was ever generated** — the production alert record contains no phantom incident from this remediation.

Incidentally, the retirement re-verified the dead-man arithmetic for free: the old check stopped being fed at `12:03:55Z` and was on track to go DOWN at exactly `12:23:55Z` — Period + Grace to the second — which is why the drill in §18.2 was **not** re-run. Its four re-run triggers (differing semantics, differing email integration, differing schedule, or evidence of drift) were each checked and none fired.

**Exposure scope: `disk-only`.** Operator review of the shared evidence confirms the `noramedi-pm2` and `noramedi-backup` URLs were redacted and only the disk URL was visible; there is no evidence supporting rotation of the other two, and none was performed. A host audit independently confirmed no second on-disk copy of any ping URL existed: `/etc/noramedi/opscheck.env.bak.TEMPORARY_VALIDATION_STATE` contains a single `NORAMEDI_OPSCHECK_SUPPRESS_PING` line and **no credential of any kind**.

**Final verified state.** Timer `enabled`/`active` on its normal 5-minute cadence; suppression **absent**; env `root:root 0600`; last run `Result=success`, `ExecMainStatus=0`; all three Healthchecks checks `UP`; all three UptimeRobot monitors `UP`; `/api/livez` ok; `/api/readyz` `database ok` + `redis ok`; PM2 `noramedi-api` and `noramedi-worker` both `online`, restart counts **12/12**, PIDs **607545 / 607578** — unchanged across the entire task.

### 19.1 Documentation defects found by live validation, corrected in this PR

Four of the five corrections below exist **because** the design was exercised against a real host. They are the concrete return on running the drills rather than reasoning about them.

1. **Missing parent-directory creation in the install procedure.** §10's `install -o root -g root -m 0600 /dev/null /etc/noramedi/opscheck.env` fails on a host where `/etc/noramedi` does not yet exist — `install(1)` does not create parent directories. **Corrected** in §10, `ops/systemd/noramedi-opscheck.env.example` and `ops/systemd/noramedi-opscheck.service` (comment blocks only) by prepending `install -d -o root -g root -m 0750 /etc/noramedi`.
2. **Incorrect restart requirement in the Drill B procedure.** §14 instructed a service/timer restart after each env edit. `EnvironmentFile` is re-read on every `ExecStart` of the oneshot, so **no restart, no `daemon-reload`, and no timer restart is required** — and restarting the timer would reset its monotonic interval and corrupt the drill's own detection-latency measurement. **Corrected** inline in §14 and proven in both directions in §18.2.
3. **Dead-man detection semantics misread as a 15-minute SLA.** Period 5 m + Grace 15 m means DOWN at **approximately 20 minutes** of silence from the last successful ping — not 15. The 15-minute figure is the grace component alone. **Corrected** in `ops/systemd/noramedi-opscheck.timer`'s comment block and in the runbook's §4.11 detection column; §18.2's measured `[19 m 05 s, 20 m 02 s]` is the empirical confirmation.
4. **Provider-UI timezone reading hazard.** The Healthchecks account UI rendered timestamps at **UTC+02:00**, while the host journal renders at UTC+03:00 and the drill protocol records UTC. This was caught only because a baseline reading of `13:21` was cross-checked against a journal ping at `11:21:55Z` — taken at face value it would have corrupted every Drill B latency by two hours. **Recorded** here and in §4.11; the standing recommendation is to set the provider account to UTC, and failing that to normalize every provider timestamp explicitly at capture time rather than at analysis time.
5. **Obsolete production artifact.** `/etc/noramedi/opscheck.env.bak.TEMPORARY_VALIDATION_STATE` remains on the host from an earlier validation step. It is verified credential-free (one `NORAMEDI_OPSCHECK_SUPPRESS_PING` line) and inert, but serves no purpose. **Marked obsolete**, with the cleanup command recorded in §20 as a post-merge operational action. **Not executed by this task** — this PR performs no production mutation.

## 20. Closure, program state, and residual items

**R-074 → `CLOSED`.** The row required live dashboard/alert-channel/uptime-probe evidence. Delivered: an external prober chain and an independent dead-man chain, both wired to a real human email channel, both **proven end-to-end by controlled drill** — detection, human delivery, and recovery — and the one monitoring credential exposed during evidence capture was rotated and permanently retired before closure. This is not self-closure by the remediating task: the implementation was PR #405, the provider/host actions were the operator's, and the Phase C and R3 reports were both accepted by architecture review, which is also what rejected the original `Secrets exposed = no` claim.

**F3 exit-gate criterion 1 ("Gözlemlenebilirlik standardı canlıda kanıtla çalışıyor — log/metrik/trace/alarm") → `SATISFIED`.**

**The overall F3 exit gate remains `NOT SATISFIED`**, and this task asserts nothing about why. Criterion 2 (security-hardening checklist) and criterion 3 (incident-response drill sufficiency) were **out of scope and unassessed here** — no evidence about either was gathered, and their state is unchanged by this closure.

```
R-074                      = CLOSED
F3_EXIT_CRITERION_1        = SATISFIED
F3_EXIT_CRITERION_2        = UNCHANGED (not assessed by this task)
F3_EXIT_CRITERION_3        = UNCHANGED (not assessed by this task)
F3_EXIT_GATE               = NOT SATISFIED
F3_COMPLETE                = NO
F4_TRANSITION_AUTHORIZED   = NO
```

**Not claimed by this closure.** Sentry/error-tracking adoption (§9 remains deliberately deferred, unimplemented); log aggregation; OTel metrics/tracing; elevated-5xx-rate and TLS-expiry alerting (§4.11's own "what this does NOT cover"); any on-call rotation. R-074's closure rests on the uptime-prober + dead-man + human-email chain actually being proven live, which is what its row named — not on the full observability roadmap being complete.

**Residual operational items, none blocking this PR:**

1. **Post-merge host cleanup** of the obsolete artifact (§19.1 item 5). Operator action, deliberately not executed by this documentation task:
   ```bash
   sudo rm -f /etc/noramedi/opscheck.env.bak.TEMPORARY_VALIDATION_STATE
   ```
2. **Set the Healthchecks account timezone to UTC** to remove the +02:00 reading hazard (§19.1 item 4).
3. **The Redis keyword assertion is `KNOWN_BRITTLE`** (§17): a key reorder in `readiness.ts`'s `{ name, status }` literal would silently disarm the `noramedi-api-readyz-redis` monitor without any application-level symptom. Worth a regression guard in a future task; not opened here.
4. **The screenshot containing the retired disk URL** may still exist wherever it was shared. Deletion of the check is what neutralized the credential, not redaction of the image — so this is hygiene, not an open exposure.
