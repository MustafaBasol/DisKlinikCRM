# F4-2-R2 — `R-030-DB` closure verification and the Workload-B gate

**Phase:** F4 — Object Storage, Backup, PITR and Restore Evidence
**Task:** `F4-2-R2-R030DB-CLOSURE-AND-WORKLOAD-B-GATE`
**Date:** 2026-08-21
**Baseline:** `origin/main` @ `c036838a787eac138bbbf9a1bcf3d16b9444a74f` (PR #471 merge, F4-2-R1)
**Branch:** `docs/f4-2-r2-r030db-closure-verification`
**Production release at time of work:** `c01c568d36d67869c76d012d0b953383162c411b`

> **Outcome up front.** Three of the four blockers that `RISK_REGISTER.md` names against
> `R-030-DB` are now closed with executed production evidence. The fourth — the KVKK
> Workload-B legal gate — is **not** closed and was not touched, because it is a counsel
> determination and no counsel evidence exists in this repository.
>
> **`R-030-DB` = `OPEN`.** **`FIRST_CUSTOMER_RECOVERY_GATE` = `NOT_SATISFIED`.**
> **`WORKLOAD_B_LEGAL_GATE` = `COUNSEL_PENDING`.**
>
> This document proposes no closure it did not verify, and closes nothing by naming it.

---

## 1. Closure criteria this task was measured against

`RISK_REGISTER.md`'s `R-030-DB` row states, in its `F4-2-R1` update, that the row stays
`OPEN` for two independent reasons: the program convention that a task does not declare
its own closure (closure must be proposed by a **separate** task verifying the criteria
one by one — this is that task), **and** because four blockers are factually open. The
row enumerates them. They are the closure criteria, and nothing else is:

| # | Criterion as written in `RISK_REGISTER.md` | Verdict |
|---|---|---|
| 1 | `repo2-cipher-pass` escrowed off-host — VPS1 loss must not mean repo2 becomes undecryptable | **SATISFIED** (§3, operator-attested) |
| 2 | `repo2` has a recurring backup schedule — `/etc/cron.d/noramedi-pgbackrest` did not exist | **SATISFIED** (§4–§5, executed) |
| 3 | Deployed monitoring understands PITR/repo2 — WAL-backlog gate and off-host alert active | **SATISFIED** (§6–§8, executed) |
| 4 | KVKK Workload-B gate — Md. 6 special-category DPA scope, subprocessor characterization | **NOT SATISFIED — `COUNSEL_PENDING`** (§11) |

The row also records that `R-030-DB` is the **sole** blocker of
`FIRST_CUSTOMER_RECOVERY_GATE`. Criterion 4 is therefore load-bearing for both.

---

## 2. STEP 1 — production re-verification: no F4-2-R1 safety property regressed

Read-only, before any mutation.

### VPS1 — `disklinik-prod-01` (185.210.92.141)

```
pgbackrest version        → 2.50
pgbackrest info           → stanza noramedi, status: ok, cipher: aes-256-cbc
pgbackrest check          → exit 0; WAL 0000000100000006000000D1 archived to repo1 AND repo2
pg_stat_archiver          → archived_count=1734, failed_count=0
                            last_archived_wal=0000000100000006000000D1 @ 12:57:36+03
                            last_failed_wal = (empty)
readyCount                → 0
pg_wal bytes              → 83886454
archive_mode / wal_level  → on / replica
archive_command           → pgbackrest --stanza=noramedi archive-push %p
PostgreSQL                → 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
df /                      → 63 G available, 13 % used
GET /api/health (nginx)   → 200
pm2                       → noramedi-api online, noramedi-worker online
pgbackrest.conf sha256    → 9b491ae59bbb203f2cc7aa5dbb7311252797d191d62217771c699c127326df89
systemctl --failed        → 0 units
```

The config hash is **byte-identical to the value F4-2-R1 recorded** (`live_sha256`), so no
repository configuration drifted between the two tasks.

### VPS2 — `vps-1281461-23217` (94.138.221.64, IHS)

```
df /                      → 132 G available, 8 % used
du -sh /var/lib/pgbackrest→ 5.5 M
backup set                → 20260821-105916F present; backup.info + backup.info.copy present
archive segments          → 32 .zst (was 8 at F4-2-R1 — the WAL stream is flowing)
ownership                 → pgbackrest:pgbackrest 0750
pgbackrest binary         → ABSENT_GOOD (dumb storage endpoint, topology C)
storage account           → pgbackrest:x:111:111::/var/lib/pgbackrest:/usr/sbin/nologin
sshd Match User pgbackrest→ ForceCommand internal-sftp, AllowTcpForwarding no,
                            AllowAgentForwarding no, X11Forwarding no, PermitTTY no,
                            PasswordAuthentication no, PermitTunnel no
authorized key options    → restrict,from="185.210.92.141"   (root-owned, outside the
                            account's home, at /etc/ssh/authorized_keys.d/pgbackrest)
one-way trust             → VPS2 → VPS1 port 22   UNREACHABLE_GOOD
                            VPS2 → VPS1 port 2210 UNREACHABLE_GOOD
GlitchTip                 → gt-r5-web healthy, worker/postgres/valkey up; /_health/ → 200
MinIO (imaging)           → healthy, untouched
systemctl --failed        → 0 units
```

**Every safety property F4-2-R1 established still holds.** No STOP condition fired.

---

## 3. STEP 2 — repo2 cipher passphrase escrow

`REPO2_CIPHER_ESCROW = COMPLETED`, attested by the operator on **2026-08-21**.

| Fact | Value |
|---|---|
| Escrow location | Off-host password manager, operator-controlled |
| Attested by | Program owner / operator, in the task instruction |
| Secret requested by the agent | **No** |
| Secret read by the agent | **No** |
| Secret printed, logged, copied to any document, PR, ClickUp or chat | **No** |
| Agent verification performed | Presence of `repo2-cipher-pass` as a **line count only** (`grep -c` → `1`); the value was never read |
| Recovery dependency | No longer single-host: losing VPS1 no longer means losing the ability to decrypt repo2 |

**What this evidence is and is not.** This is an **operator attestation**, not an
agent-verified fact, and it is recorded as such. Verifying it would require reading the
secret, which is prohibited. The attestation is sufficient for the technical escrow gate
because the gate's purpose — removing the single-host decryption dependency — is a
custody question the operator alone can answer. Independent confirmation would require a
restore performed using only the escrowed copy on a host that is not VPS1; that has not
been done and is **not** claimed here.

---

## 4. STEP 3 — recurring schedule: design recorded before mutation

### What already existed

| Item | State found |
|---|---|
| `/etc/cron.d/noramedi-pgbackrest` | **did not exist** |
| `/usr/local/sbin/noramedi-pgbackrest-backup.sh` | **not installed** |
| repo1 pgBackRest backups | ad-hoc; newest was **47 h old** |
| repo2 backups | exactly one (`20260821-105916F`) |
| `/etc/cron.d/noramedi-db-backup` | `15 3 * * * root /usr/local/sbin/noramedi-db-backup.sh` (pg_dump tier) |
| root crontab | `30 2 * * * /usr/local/sbin/noramedi-uploads-backup.sh` |
| retention | `repo1/repo2-retention-full=7` (count), `repo1/repo2-retention-archive=7` (full) |
| MTA on VPS1 | **none** — no `sendmail`, no `postfix`, no `/var/mail/root` |

### Decisions, and why

| Decision | Rationale |
|---|---|
| Use `/etc/cron.d/noramedi-pgbackrest` + the existing wrapper | The repository-approved mechanism, named in the wrapper's own header and in `ops/pgbackrest/noramedi-pgbackrest.cron.example`. No parallel scheduling framework was created. |
| **Daily full**, not diff/incr | The approved file's own rationale: the database is 41 MB → 4.4 MB compressed in 8 s, so a full-only chain makes restore a single step with no dependency graph to reason about during an incident. "Revisit around ~1 GB." A diff chain would trade incident-time clarity for a saving measured in megabytes. |
| repo2 full at **03:30** | Exactly the commented-out repo2 line in the approved example. |
| repo2 verify **Sunday 04:15** | Mirrors the approved repo1 verify entry. It matters more for repo2, which lives on infrastructure this program does not operate and where silent corruption is otherwise unobservable from here. Same approved wrapper, same `--verify` flag. |
| Retention untouched | `expire --repo=2` runs after each successful backup, scoped to repo2. Steady state ≈ 7 × 4.4 MB + WAL against 132 GB free. |
| **No outer `flock`** | The approved file documents that an outer `flock` on the wrapper's own lock path self-deadlocks: every scheduled run would exit 5 and never invoke pgBackRest while cron reported benign overlap. The wrapper owns its lock internally (fd 9, exit 5). |
| **Deviation: log redirection instead of `MAILTO=root`** | VPS1 has no MTA, so cron mail would silently discard the wrapper's exit-4 disk abort — the single most important message it can emit. Output is appended to `/var/log/noramedi-pgbackrest-cron.log` with plain `>>`, **not** a pipe, so the wrapper's exit code is not masked. pgBackRest's own detail log continues to `/var/log/pgbackrest/`. |
| Expected load | ~8–20 s and ~4.4 MB/day to VPS2, plus the continuous WAL stream. |
| Rollback | `rm /etc/cron.d/noramedi-pgbackrest` (§13). |

---

## 5. STEP 4 — schedule installed and exercised

### Install

```
install -o root -g root -m 0755 /var/www/noramedi/scripts/noramedi-pgbackrest-backup.sh \
                                /usr/local/sbin/noramedi-pgbackrest-backup.sh
sha256 = 69cfc10d75851196498d8ece54be76a7c38b9de7b1ef639e046d5ce5f2e7ae59
       = git cat-file blob main:scripts/noramedi-pgbackrest-backup.sh   ✔ byte-identical
```

Dry runs first, invoking nothing:

```
--repo 2 --type full --dry-run → would run: pgbackrest --stanza=noramedi --repo=2 --type=full backup
                                 would then: pgbackrest --stanza=noramedi --repo=2 expire   exit 0
--repo 2 --verify  --dry-run   → would run: pgbackrest --stanza=noramedi --repo=2 verify    exit 0
```

### The installed entries

```cron
45 2 * * *  root  /usr/local/sbin/noramedi-pgbackrest-backup.sh --type full            >> /var/log/noramedi-pgbackrest-cron.log 2>&1
0  2 * * 0  root  /usr/local/sbin/noramedi-pgbackrest-backup.sh --verify               >> /var/log/noramedi-pgbackrest-cron.log 2>&1
30 3 * * *  root  /usr/local/sbin/noramedi-pgbackrest-backup.sh --repo 2 --type full   >> /var/log/noramedi-pgbackrest-cron.log 2>&1
15 4 * * 0  root  /usr/local/sbin/noramedi-pgbackrest-backup.sh --repo 2 --verify      >> /var/log/noramedi-pgbackrest-cron.log 2>&1
```

`/etc/cron.d/noramedi-pgbackrest`, root:root 0644, sha256
`2ad9aed4c06c770de753c2565056b4c4c2ab3e46aaf4d44651b91fd8fcbec1df`.

Daily timeline, all local (Europe/Istanbul):
`02:30` uploads tar (pre-existing) → `02:45` repo1 full → `03:15` pg_dump (pre-existing) →
`03:30` repo2 full. Sundays add `02:00` repo1 verify and `04:15` repo2 verify.

### Why repo1 lines are here, when §4 designed a repo2-only schedule

**This is a correction to this task's own Step 3 design, recorded rather than written out.**
The repo2-only schedule was installed first, and the design was then found incomplete:
opscheck's `pitr` check asserts `NORAMEDI_OPSCHECK_PITR_MAX_BACKUP_AGE_HOURS` against the
stanza's **repo1** `lastBackupAt`. With repo1 ad-hoc that age was **47 h against a 30 h
limit**, so the check failed on a wholly healthy cluster and the WAL-backlog and off-host
gates could never be armed. Criterion 3 is therefore **not reachable** without recurring
repo1 coverage. The repo1 entries come from the same approved example file; nothing was
invented. `02:45` rather than the example's `02:30` because root's crontab already runs
the uploads backup at `02:30` on the same filesystem — the example predates that entry and
reasoned only about the 03:15 pg_dump.

### Controlled manual runs through the scheduled path

Both were invoked with the **exact command line the cron entry uses**.

| Run | Exit | Duration | Result |
|---|---|---|---|
| repo2 full | **0** | 21 s (backup 18.0 s + expire) | new label **`20260821-130506F`**, 41 MB → 4.4 MB, 2073 files |
| repo1 full | **0** | 12 s | repo1 fulls 5 → 6, entries 7 → 8 |

Post-conditions:

```
repo2 backups          1 → 2   (20260821-105916F, 20260821-130506F)
repo1 backups          7 → 8   (retention-full=7 by COUNT; 6 fulls ≤ 7, expire did NOT
                                remove anything — verified before and after)
pg_stat_archiver       1738/0 → 1749/0, failed_count stays 0 throughout
readyCount             0
pgbackrest check       exit 0, WAL archived to BOTH repos
expire --repo=2        completed successfully (1303 ms, then 1414 ms)
```

**Secrets:** pgBackRest redacts its own passphrase options in every log line
(`--repo1-cipher-pass=<redacted> --repo2-cipher-pass=<redacted>`). No secret appears on a
command line, in `/var/log/noramedi-pgbackrest-cron.log`, or in `/etc/cron.d/`.

**Observation, recorded not corrected:** `expire` runs **twice** per backup — once from
pgBackRest's own post-backup expire, once from the wrapper's explicit expire step. It is
idempotent and cost 1.4 s, so it was left alone; it is noted as a minor redundancy in the
wrapper rather than silently ignored.

---

## 6. STEP 5 — PITR-aware opscheck deployed

### Versions

| | Deployed before | Target / deployed now |
|---|---|---|
| `/usr/local/sbin/noramedi-opscheck.sh` | 17 301 B, 2026-08-13, sha256 `d19c167b…` | 74 840 B, sha256 `2bdd90f8…` |
| `pitr` occurrences | **0** | **144** |
| `REQUIRE_OFFHOST` | 0 | 18 |
| `MAX_WAL_READY_COUNT` / `MAX_WAL_BYTES` | 0 / 0 | 14 / 14 |
| `repo2` occurrences | 0 | 27 |
| `check_pitr()` defined | no | yes |

Provenance: the deployed source is `/var/www/noramedi/scripts/noramedi-opscheck.sh`, whose
`git hash-object` is `bb7aaf5ee1b1f3072b32cd5f6db63643d8965cfb` — **identical to
`main:scripts/noramedi-opscheck.sh`**. No unrelated application change was deployed; the
application release SHA is untouched at `c01c568`.

The PITR **status writer** was also absent and was installed:
`/usr/local/sbin/noramedi-pgbackrest-status.sh` (sha256 `dfa7c6a7…`) plus its systemd
service and 15-minute timer, now `enabled`.

Rollback copies taken before every mutation:
`/usr/local/sbin/noramedi-opscheck.sh.bak.f4-2-r2-20260821-102501Z`,
`/etc/noramedi/opscheck.env.bak.f4-2-r2-*`,
`/etc/systemd/system/noramedi-pgbackrest-status.service.bak.f4-2-r2-*`.

### The ordering that made the swap backward-compatible

The 2026-08-13 build defaults to `pm2,disk,backup`. The current build defaults to
`pm2,disk,backup,filebackup,drill`. On this host
`/var/lib/noramedi/recovery-status.json` reports `fileBackup.enabled=false` and an empty
`drill` object, so **both new checks fail by design**. Swapping the binary without pinning
the list would have turned production monitoring red on two subsystems this task does not
own.

`NORAMEDI_OPSCHECK_CHECKS=pm2,disk,backup` was therefore written to
`/etc/noramedi/opscheck.env` **before** the new binary landed — a no-op against the old
build, since it equals its default. The hypothesis was then confirmed empirically: an
invocation that does not read the `EnvironmentFile` ran all five and returned **exit 24**
(bits 8+16), while the timer-driven run that does read it ran exactly
`[pm2 disk backup]` and returned **exit 0**.

**Deviation from runbook §22.4a:** that section's sample block enables
`pm2,disk,backup,filebackup,drill,pitr`. It assumes `filebackup`/`drill` are already
active, which on this host they are not. Enabling them is a separate decision with its own
subsystem work, and is **not** made here.

---

## 7. STEP 5a — a defect found in the shipped status-writer unit, and fixed

The first run of `noramedi-pgbackrest-status.service` produced a well-formed but
**degraded** document: `archive.mode: "unknown"`, `commandOk: false`, `statusOk: false`,
and no `walBytes`, `readyCount`, `lastArchivedAt`, `backupCount` or `repo2*` fields. The
service exited 0 and logged nothing — the script's `psql_one()` discards stderr.

Reproduced under the unit's exact property set:

```
runuser: cannot set user id: Operation not permitted
```

Measured, not inferred:

```
inside the unit's sandbox : CapEff = 000001fffffeff7f
baseline (no sandbox)     : CapEff = 000001ffffffffff
                                          ^^      ^
                            bit 16 (CAP_SYS_MODULE) clear — expected, ProtectKernelModules
                            bit  7 (CAP_SETUID)     clear — NOT expected
```

Every PostgreSQL-derived field in the writer goes through `as_pg()`, which is
`runuser -u postgres`. Without `CAP_SETUID` that call cannot switch users, so all of them
were silently omitted. **No single directive reproduces this** — `User=root`,
`NoNewPrivileges`, `RestrictSUIDSGID`, `ProtectSystem=strict`, `ProtectHome`,
`PrivateTmp` and `StateDirectory` were each tested alone and all passed; only the combined
set fails. That is why it was never noticed.

**Consequence had it not been fixed:** opscheck's `pitr` check would have failed on every
five-minute run against a healthy cluster, and the WAL-backlog limits could not have been
armed at all, because a configured limit with a missing measurement is a `FAIL` by
contract. It fails closed — the safe direction — but permanently and falsely, which is the
"red is the normal colour" failure mode this repository warns about elsewhere.

**Fix**, applied to `ops/systemd/noramedi-pgbackrest-status.service` and deployed:

```ini
AmbientCapabilities=CAP_SETUID CAP_SETGID
```

Preferred over `NoNewPrivileges=no` (also verified to work) because it restores exactly
the two capabilities `runuser` needs and leaves every other hardening directive in force.
Verified after deployment: `AmbientCapabilities=cap_setgid cap_setuid`,
`NoNewPrivileges=yes`, `ProtectSystem=strict`, `ProtectHome=yes` all still set, and the
document now carries `mode: "on"`, `commandOk`, `walBytes`, `readyCount`,
`lastArchivedAt`, `archivedCount`, `lastBackupAt`, `repo2LastBackupAt`,
`repo2BackupCount` — all nine previously-missing fields present.

---

## 8. STEP 6 — off-host and WAL-backlog monitoring armed

### Configuration written to `/etc/noramedi/opscheck.env` (root:root **0600**)

```
NORAMEDI_OPSCHECK_CHECKS=pm2,disk,backup,pitr
NORAMEDI_OPSCHECK_PITR_REQUIRE_OFFHOST=true
NORAMEDI_OPSCHECK_PITR_REQUIRE_WAL_BACKLOG=true
NORAMEDI_OPSCHECK_PITR_MAX_WAL_READY_COUNT=32
NORAMEDI_OPSCHECK_PITR_MAX_WAL_BYTES=16901096448
NORAMEDI_OPSCHECK_PITR_PING_URL=<operator-supplied, never read or printed>
```

**No variable here is inert.** `pitr` is in the check list, and `REQUIRE_WAL_BACKLOG` is
validated at startup on every run regardless of which checks execute.

Threshold derivation, per runbook §22.4a:

| Variable | Value | Basis |
|---|---|---|
| `MAX_WAL_READY_COUNT` | `32` | ≈ 512 MiB at the host's confirmed `wal_segment_size=16777216`. With `archive_timeout=300`, an idle cluster needs ~2.7 h of total archive outage to reach it — after the 120-minute archived-WAL-age assertion has already fired. Under write load the ordering reverses, which is the point: age and volume fail independently. |
| `MAX_WAL_BYTES` | `16901096448` | 25 % of measured available bytes on the PGDATA filesystem. `PGDATA=/var/lib/postgresql/16/main`; `df -B1` available = `67604385792`. The 25 % is a stated headroom convention, **not** a measurement. Observed `pg_wal` at activation: `83886454` B (~80 MiB), ≈ 0.5 % of the limit. |
| `REQUIRE_OFFHOST` | `true` | Fail-closed default, written explicitly so the intent is on the record. |
| `REQUIRE_WAL_BACKLOG` | `true` | The activation gate: with it set and either limit `0`, opscheck refuses to start (exit 64) rather than running blind. |

### The external heartbeat

The task's instruction was to use the **existing** Healthchecks service (hosted
`hc-ping.com`, alongside UptimeRobot), not to provision a new heartbeat receiver. No
Healthchecks management API key exists on VPS1, so the agent could not create the check;
the operator created **"NoraMedi Production PITR / repo2"** and wrote its ping URL to
`/etc/noramedi/opscheck.env` directly. The URL never entered this conversation.

The first armed run returned **exit 32** (ping-transport bit): the local `pitr` check
passed but the heartbeat failed, while the other three pings succeeded — so DNS/TLS was
fine and the value itself was wrong. Diagnosed **without reading the secret**, using only
structure, lengths and status codes:

```
stored value length      : 76      (working pm2 URL: 56)
path segment count       : 4       (working pm2 URL: 1)
  segment 1 length 6     → "https:"
  segment 2 length 0     → ""            (from the "//")
  segment 3 length 11    → "hc-ping.com"
  segment 4 length 36    → canonical UUID
hc-ping.com response     : 400 "invalid url format"   (control pm2 URL: 200)
last segment alone       : 200
```

A doubled `https://hc-ping.com/` prefix — a paste artifact. The UUID itself was valid and
the check existed. Repaired with a literal-prefix `sed`, which neither reads nor prints the
value; the file shrank by exactly 20 bytes, the length of the duplicated prefix
(3064 → 3044), and permissions were reasserted as `root:root 0600`.

`SUPPRESS_PING` was **not** used: with a working URL there is no reason to suppress, and
the instruction was explicit on that point.

### Verified result

```
[opscheck] pm2 check: 'noramedi-api' online / 'noramedi-worker' online
[opscheck] ping ok for 'pm2' (outcome=success)
[opscheck] disk check: OK — 13% used at '/' (threshold 90%)
[opscheck] ping ok for 'disk' (outcome=success)
[opscheck] backup check: OK — newest backup is 10h old (max 30h)
[opscheck] ping ok for 'backup' (outcome=success)
[opscheck] pitr check: OK — archive_mode=on, newest WAL fresh, repo encrypted,
                            check ok, off-host=yes, waiting-to-archive=0
[opscheck] ping ok for 'pitr' (outcome=success)
[opscheck] summary: checks=[pm2 disk backup pitr] exit=0
systemctl --failed → 0 units
```

**Heartbeat confirmation.** opscheck pings with `curl -fsS`, which fails on any non-2xx.
`ping ok for 'pitr'` therefore means **hc-ping.com accepted the heartbeat with a 2xx**,
i.e. the check exists and the monitor received it — the same evidence standard the three
pre-existing checks meet. The Healthchecks dashboard's own rendering was not viewed by the
agent and is not claimed. `pm2`, `disk` and `backup` heartbeats were verified still sent;
UptimeRobot was not touched.

Timers: `noramedi-opscheck.timer` every 5 min, `noramedi-pgbackrest-status.timer` every
15 min, both active and enabled.

---

## 9. STEP 7 — fail-closed characterization

**Nothing live was broken.** Live WAL archiving, the live pgBackRest config and live repo2
data were untouched. Two safe instruments only: fixture status documents in a scratch
directory selected via the documented `NORAMEDI_OPSCHECK_PITR_STATUS_FILE` override, and
threshold env overrides on single isolated invocations. `--dry-run` throughout, so no ping
was emitted to any monitor.

| # | Condition | Expected | Observed | Exit |
|---|---|---|---|---|
| C0 | live document, all thresholds armed | PASS | `OK — off-host=yes, waiting-to-archive=0` | 0 |
| A1 | repo2 holds **zero** backups | FAIL | "a repo2 is configured but holds ZERO backups… cannot restore" | 128 |
| A2 | repo2 configured, age unmeasurable | FAIL | "refusing to assume it is fresh" | 128 |
| A3 | `pgbackrest check` reports `error` | FAIL | "last 'pgbackrest check' result is 'error'" | 128 |
| B1 | repo2 backup 50 h old (max 30 h) | FAIL | "only the off-host copy survives loss of this host" | 128 |
| B2 | repo1 backup 50 h old (max 30 h) | FAIL | "newest pgBackRest backup is 50h old" | 128 |
| B3 | newest archived WAL 50 h old (max 120 m) | FAIL | "the recoverable point is falling behind the RPO target" | 128 |
| C1 | `readyCount=250` vs limit 32 | FAIL | "archive-push is not keeping up… pg_wal will keep growing" | 128 |
| C2 | **real** `walBytes` vs a deliberately tiny limit | FAIL | "pg_wal holds 80 MiB (max 0 MiB)" | 128 |
| C3 | limit armed but `readyCount` **missing** | FAIL, never pass | "refusing to assume the backlog is empty" | 128 |
| C4 | `REQUIRE_WAL_BACKLOG=true` with a limit still `0` | refuse to start | `FATAL: … is 0 (not evaluated)` | **64** |
| D1 | `offHost=no`, `REQUIRE_OFFHOST=true` | FAIL | "the backup does not survive loss of this host" | 128 |
| D2 | same document, `REQUIRE_OFFHOST=false` | WARN + pass | `WARNING … RPO is improved; host-loss durability is NOT` | 0 |
| D3 | `offHost=unproven`, `REQUIRE_OFFHOST=true` | FAIL | as D1 | 128 |
| E1 | status document 50 h old (max 2 h) | FAIL | "the writer is not running" | 128 |
| F1 | `archive_mode=off` | FAIL | "there is no PITR capability" | 128 |

**16/16 behaved as specified**, every failure fail-closed, and C2 exercised a **real**
measurement rather than a fixture. Post-characterization live state: `1748/0` archived,
`readyCount 0`, `pgbackrest check` exit 0, config sha256 unchanged, `pitr` check green.

---

## 10. STEP 8 — fresh restore closure verification

A **new** drill, distinct from F4-2-R1's `20260821-080128-85617`. No restore over
production; isolated, RAM-backed, socket-only.

```
sudo REHEARSAL_OS_USER=postgres PG_BINDIR=/usr/lib/postgresql/16/bin \
     NORAMEDI_APP_SERVER_DIR=/var/www/noramedi/server \
     NORAMEDI_PITR_DRILL_PROD_PGDATA=/var/lib/postgresql/16/main \
     bash scripts/noramedi-pgbackrest-restore-drill.sh \
     --repo 2 --record --stanza noramedi --port 55433
```

| Field | Value |
|---|---|
| `run_id` | **`20260821-103423-96465`** |
| Source repository | **repo 2** (off-host, IHS) |
| Backup label | **`20260821-130506F`** — the backup **this task's new schedule produced** |
| WAL recovery | segments `…D5`–`…DE` fetched from the **repo2** archive; `redo done at 6/DE0024A8`; `selected new timeline ID: 2`; `archive recovery complete` |
| Recovery point reached | `2026-08-21T10:32:00Z` (`pg_last_xact_replay_timestamp`) |
| Restore start / end | `10:34:26Z` / `10:34:51Z` |
| **RPO** | **2 min** — target 60, within |
| **RTO** | **25 s** to `tenant_smoke_complete` — target 14400, within |
| PostgreSQL ready | `database system is ready to accept connections`; `still_in_recovery: f` |
| Migrations | **80 applied**, 80 expected by the deployed release, **0 missing, 0 ahead**, 0 unfinished, 0 rolled back |
| Application smoke | **passed** — deployed Prisma client connected and queried the restored schema |
| Tenant-isolation smoke | **passed** — 0 cross-clinic appointments, 0 orphan clinic references, 0 orphaned appointments; `rls_policies: 0 (expected 0 — this domain does not use RLS)` |
| Aggregate counts (no row values) | 115 tables, 3 clinics, 21 patients, 28 appointments |
| Result | **`PASS`**, `R032_eligible: true` |
| Isolation | `/dev/shm/noramedi-pitr-drill-20260821-103423-96465` removed and verified gone; no listener on 55433 |
| Marker refreshed | `pitr-offhost-proof.json` now `runId 20260821-103423-96465`, `finishedAt 2026-08-21T10:34:51Z` |

**No PHI row values appear in this evidence** — aggregate counts only, exactly as the
drill's own "safe to copy verbatim — no PII" summary provides.

Production during and after the drill: `1749/0` archived, `readyCount 0`,
`pgbackrest check` exit 0, `GET /api/health` 200, both PM2 processes online, config
sha256 unchanged.

That the restored backup is the one the **new schedule** produced is worth stating
plainly: it closes the loop between criteria 2 and the restore evidence — the scheduled
path does not merely run, it produces restorable backups.

---

## 11. STEP 9 — security / tenant / KVKK technical flags

| Flag | Value | Basis |
|---|---|---|
| `TENANT_ISOLATION_CHANGED` | **NO** | No application or schema change; drill tenant smoke passed with 0 cross-clinic rows |
| `AUTH_CHANGED` | **NO** | No auth code, config or credential-model change |
| `APP_SCHEMA_CHANGED` | **NO** | No Prisma schema change |
| `MIGRATION_CREATED` | **NO** | — |
| `MIGRATION_DEPLOYED` | **NO** | Production stays at 80/80, release SHA `c01c568` unchanged |
| `PHI_EXPOSED_IN_LOGS` | **NO** | Evidence carries aggregate counts only; pgBackRest redacts cipher-pass options itself; no secret read or printed |
| `REPO1_PRESERVED` | **YES** | 7 → 8 backups, retention `expire` did not remove anything; pg_dump tier and its 03:15 cron untouched |
| `REPO2_ENCRYPTED` | **YES** | `repo2-cipher-type=aes-256-cbc`, unchanged |
| `TRANSPORT_ENCRYPTED` | **YES** | SSH/SFTP, pinned `sha256` host fingerprint, `host-key-check-type=fingerprint` |
| `CIPHER_ESCROWED` | **YES (operator-attested)** | §3 — attestation, not agent-verified |
| `REPO2_SCHEDULE_ACTIVE` | **YES** | `/etc/cron.d/noramedi-pgbackrest`, daily 03:30 full + Sunday 04:15 verify, both exercised |
| `WAL_MONITORING_ACTIVE` | **YES** | `REQUIRE_WAL_BACKLOG=true`, limits 32 / 16901096448, both measurements present, breach characterized |
| `OFFHOST_MONITORING_ACTIVE` | **YES** | `REQUIRE_OFFHOST=true`, `offHost=yes` asserted every 5 min, external heartbeat accepted 2xx |
| `RESTORE_FRESHLY_PROVEN` | **YES** | `20260821-103423-96465`, repo2-sourced, `PASS` |
| `GLITCHTIP_CHANGED` | **NO** | Observed healthy only; no config, no DSN, still inactive |
| `IMAGING_CHANGED` | **NO** | MinIO observed healthy; isolation from the storage account re-verified |

Every application-level mutation flag is **NO**, as expected.

---

## 12. STEP 10 — Workload-B governance disposition

### A. Technical facts now proven

| Fact | Evidence |
|---|---|
| Türkiye hosting | Register §1a: IHS, Türkiye / NGN Data Center; E1/E3 program-owner-accepted, RIPE RDAP `country: TR` |
| No overseas replication/failover/migration | E4/E5, provider-stated and program-owner-accepted |
| AES-256-CBC at rest | `repo2-cipher-type=aes-256-cbc`; F4-FCR-003-R2 measured a synthetic PHI marker 6 000× in PGDATA and **0×** across all repo2 objects |
| Passphrase outside VPS2 | Held on the production primary only; provider holds ciphertext without the key |
| Encrypted transport | SSH/SFTP, pinned `ecdsa-sha2-nistp256` host key |
| Least-privilege storage account | `nologin`, `ForceCommand internal-sftp`, `restrict,from="185.210.92.141"`, no forwarding, no TTY |
| Workload isolation | No read access to GlitchTip or imaging; `pgbackrest` binary absent on VPS2; one-way trust re-verified |
| Off-host escrow | §3, operator-attested |
| Backup/restore evidence | §5, §10 — recurring schedule + fresh repo2-sourced restore, RPO 2 min / RTO 25 s |

### B. Program-owner technical risk decisions recorded

Operational acceptance of the repo2 architecture (topology C, SFTP, no repository host);
the retention and schedule design in §4; and the reliability controls in §6–§8. These are
**technical** decisions and are recorded as such.

### C. Counsel-only items — all unresolved

| Item | Owner | State |
|---|---|---|
| DECISION-1 — subprocessor characterization | **Counsel** | `COUNSEL REVIEW PENDING`; the program's own `LIKELY YES` is an architectural opinion, not a legal finding |
| DECISION-2 — DPA / contract sufficiency for KVKK Md. 6 special-category health data | **Counsel** | No separate/custom DPA offered under IHS's standard online-service model — `CONFIRMED_ABSENT` as a fact; sufficiency of standard terms is the packet's central open legal question |
| DECISION-3 — Art. 9 / international-transfer sufficiency of the conditional E1/E2/E4/E5 evidence | **Counsel** | Open; `NOT ENGAGED` was concluded for **Workload A only** and explicitly not extended to Workload B |
| DECISION-5 — sub-subprocessor legal disposition | **Counsel**, once the fact is established | Provider sub-subprocessor evidence `INCOMPLETE`; whether IHS itself uses one is unknown |

**No counsel evidence of any kind exists in this repository.** The decision packet
`F3-C2-ERR-004_R5` records DECISION-1/2/3/5 as unanswered, and its authorized-answer
fields are still blank checkboxes.

**`WORKLOAD_B_LEGAL_GATE = COUNSEL_PENDING`.** It is not closed, not narrowed, and not
inferred from the architecture evidence in A. Compliance is not claimed from encryption:
`LAUNCH_GATES.md` §0 explicitly forbids collapsing "Production-verified (technical)" into
"Legally/externally compliant (KVKK/VERBİS/DPA/contractual)", and that separation is
observed here.

The F4-2-R1 **sequencing defect** — register §6 required correction *before* the first
byte left the production host, and it was made *after* — is a recorded governance finding
against that task. It is **not** cured by this task and is not restated as resolved.

### Does repository policy permit technical closure while the legal gate stays open?

**No.** This was determined from the authoritative record, not assumed. The `R-030-DB` row
in `RISK_REGISTER.md` enumerates its own four closure blockers, and the KVKK Workload-B
gate is **blocker 4 of 4** — it sits inside the risk's own closure criteria, not beside
them. The row further states that `R-030-DB` is the **sole** blocker of
`FIRST_CUSTOMER_RECOVERY_GATE`. There is therefore no repository policy under which the
row closes technically while its own fourth criterion is open.

---

## 13. STEP 11 — `R-030-DB` closure decision

| Criterion | Verdict | Evidence |
|---|---|---|
| 1 — cipher passphrase escrowed off-host | **SATISFIED** (operator-attested) | §3 |
| 2 — repo2 recurring backup schedule | **SATISFIED** (executed) | §4, §5 |
| 3 — deployed monitoring understands PITR/repo2; WAL backlog + off-host alert active | **SATISFIED** (executed) | §6, §7, §8, §9 |
| 4 — KVKK Workload-B gate | **NOT SATISFIED** | §12 |

### `R030_DB = OPEN`

**Exact remaining condition:** criterion 4 — counsel determination of DECISION-1
(subprocessor characterization), DECISION-2 (DPA sufficiency for KVKK Md. 6
special-category health data), DECISION-3 (Art. 9 / transfer sufficiency for Workload B),
and DECISION-5 (sub-subprocessor disposition, once the underlying fact is established).

Nothing else remains. Criteria 1–3 are proposed **closed** by this task, which is the
separate closure task the row itself called for.

This task does **not** self-close the row merely because it is named a closure task, and
it does not weaken criterion 4 to reach a green result. Two smaller findings are likewise
recorded rather than written out: this task's own Step 3 design was incomplete (§5), and
the shipped status-writer unit was defective (§7).

---

## 14. STEP 12 — `FIRST_CUSTOMER_RECOVERY_GATE`

### `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`

**Reason:** `R-030-DB` is its sole blocker per `RISK_REGISTER.md`, and `R-030-DB` is
`OPEN` on criterion 4.

The two states are deliberately not conflated:

| | State |
|---|---|
| **Technical recoverability** | **PROVEN.** Encrypted off-host repository on an independent failure domain, recurring daily backups, continuous WAL to both repositories, active fail-closed monitoring with an external heartbeat, and a fresh repo2-sourced restore at RPO 2 min / RTO 25 s with 80/80 migrations and passing application and tenant-isolation smokes. |
| **Legal / compliance launch readiness** | **NOT ESTABLISHED.** The Workload-B gate is `COUNSEL_PENDING`; full physical copies of özel nitelikli sağlık verisi plus a continuous WAL stream are resident with a provider whose DPA sufficiency for KVKK Md. 6 is an open counsel question. |

A gate that measures launch readiness is not satisfied by the first column alone.

---

## 15. STEP 13 — rollback

Every production mutation, with its rollback validated or its rollback path recorded.

| # | Mutation | Rollback | Validated |
|---|---|---|---|
| 1 | `/usr/local/sbin/noramedi-pgbackrest-backup.sh` installed | `rm -f` — nothing depends on it once the cron file is gone | Pre-state recorded (`NOT_INSTALLED`) |
| 2 | `/etc/cron.d/noramedi-pgbackrest` created | `rm -f /etc/cron.d/noramedi-pgbackrest` — restores the exact prior state (the file did not exist). Backup at `/etc/cron.d/noramedi-pgbackrest.bak.f4-2-r2-*` | Pre-state recorded (`NO_CRON_FILE`); `noramedi-db-backup` sha256 `921cfe68…` verified unchanged after |
| 3 | `/usr/local/sbin/noramedi-opscheck.sh` upgraded | `install -m 0755 /usr/local/sbin/noramedi-opscheck.sh.bak.f4-2-r2-20260821-102501Z /usr/local/sbin/noramedi-opscheck.sh` | Backup taken and listed before overwrite (17 301 B, sha256 `d19c167b…`) |
| 4 | `/etc/noramedi/opscheck.env` extended | `install -m 0600 -o root -g root /etc/noramedi/opscheck.env.bak.f4-2-r2-<ts> /etc/noramedi/opscheck.env` | Three timestamped backups exist (pre-pin, pre-arm, pre-urlfix) |
| 5 | Status writer + units installed, timer enabled | `systemctl disable --now noramedi-pgbackrest-status.timer; rm -f /etc/systemd/system/noramedi-pgbackrest-status.{service,timer} /usr/local/sbin/noramedi-pgbackrest-status.sh; systemctl daemon-reload` | Pre-state recorded (both `NOT_INSTALLED`) |
| 6 | Status-writer unit capability fix | `install -m 0644 /etc/systemd/system/noramedi-pgbackrest-status.service.bak.f4-2-r2-* …; systemctl daemon-reload` | Backup taken (sha256 `c78f5792…`); reverting restores the degraded-document behaviour of §7, so this rollback is a regression and is listed for completeness only |
| 7 | Two manual pgBackRest backups | **Not rolled back, and must not be.** `expire` removed nothing; both are valid retained backups under the configured policy | repo1 7 → 8, repo2 1 → 2, both verified |

**Partial rollback of monitoring only** (keep the schedule, silence the pitr check):
set `NORAMEDI_OPSCHECK_CHECKS=pm2,disk,backup` in `/etc/noramedi/opscheck.env`. No
redeploy needed — systemd re-reads `EnvironmentFile=` on every `ExecStart`.

**repo2 is NOT removed by any rollback above**, per instruction. If the Workload-B legal
gate forces repo2 deactivation, the already-proven F4-2-R1 procedure is used unchanged
(`F4-2-R1_REPO2_PRODUCTION_ACTIVATION_EVIDENCE.md` §13): config-level rollback to
`/etc/pgbackrest/pgbackrest.conf.bak.f4-2-r1-20260821-105606`, then credential rollback.
**Additionally, this task's cron file must be removed first** — otherwise the 03:30 entry
would fail nightly against a repository that is no longer configured. Step 3 of that
procedure (deleting repo2 data) destroys evidence and must not be run except to
decommission.

---

## 16. Repository changes

| File | Change |
|---|---|
| `ops/systemd/noramedi-pgbackrest-status.service` | **Runtime fix** — `AmbientCapabilities=CAP_SETUID CAP_SETGID` plus the measured rationale (§7) |
| `ops/pgbackrest/noramedi-pgbackrest.cron.example` | Header corrected: it is now installed in production; records the 02:45 and 04:15 deviations |
| `docs/program/NORAMEDI_MASTER_TRACKER.md` | F4-2-R2 entry |
| `docs/program/phases/F4_STORAGE_AND_BACKUP.md` | F4-2-R2 section |
| `docs/program/runbooks/F4_RECOVERY_OPERATIONS.md` | §22.4d — activated schedule and monitoring, as-built |
| `docs/program/RISK_REGISTER.md` | `R-030-DB` updated: three blockers closed, row stays `OPEN` on blocker 4 |
| `docs/compliance/62-kvkk-subprocessor-register.md` | §6 factual update only: repo2 now holds recurring backups and monitoring is active; gate unchanged |
| `docs/program/evidence/F4-2-R2_…` | This document |

No application, schema, migration, test or CI file is touched.

---

## 17. Lifecycle

`agent completed = YES` · `tests passed = see §18` · `PR opened = YES` · `merged = NO` ·
`deployed = N/A (no application change; production runtime/config changes were made and
verified directly)` · `production verified = YES`

`MERGE_SAFE = YES` · `DEPLOY_SAFE = YES` (no application change) ·
`R030_DB = OPEN` · `WORKLOAD_B_LEGAL_GATE = COUNSEL_PENDING` ·
`FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`
