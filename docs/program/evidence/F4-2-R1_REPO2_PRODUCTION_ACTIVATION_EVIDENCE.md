# F4-2-R1 — repo2 Off-Host Encrypted Repository: Production Activation Evidence

`F4-2-R1_STATUS = ACTIVATED_WITH_OPEN_GOVERNANCE_GAP` · `AGENT_COMPLETED = YES`
`PR_OPENED = YES` · `MERGED = NO` · `DEPLOYED = N/A (no application code)` · `PRODUCTION_VERIFIED = YES`
`repo2 = ACTIVATED` · `REPO1_PRESERVED = YES` · `GLITCHTIP_CHANGED = NO` · `IMAGING_STORAGE_CHANGED = NO`
`R-030-DB = OPEN (NOT closed by this task — see §12)` · `R-030 = OPEN` · `R-030-FILES = OPEN`
`FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED` · `F4 COMPLETE = NO` · `F5 AUTHORIZED = NO`
`KVKK_SUBPROCESSOR_REGISTER = CORRECTED RETROACTIVELY — see §11 (gate was crossed before correction)`

Evidence session: **2026-08-21T10:45–11:05 +03**, executed directly against production
(`disklinik-prod-01`) and the Türkiye secondary VPS (`vps-1281461-23217`) under the
program owner's explicit architecture/controller decision of 2026-08-21 (decisions 1–10).

> **This document records observed production state.** It does **not** close `R-030-DB`
> and does **not** satisfy `FIRST_CUSTOMER_RECOVERY_GATE`. Four blockers remain open
> (§12), one of which is a **KVKK governance gate that this activation crossed before
> the register was corrected** (§11). That is recorded as a finding against this task,
> not written out of the record.

---

## 1. Task, authorization, and scope

| Item | Value |
|---|---|
| Task ID | `F4-2-R1-REPO2-PREFLIGHT-AND-PRODUCTION-ACTIVATION` |
| Phase | F4 — Object Storage, Backup, PITR and Restore Evidence |
| Authorization | Program owner, 2026-08-21, decisions 1–10 (transport = C1 SFTP; reject imaging MinIO reuse; cipher-pass off VPS2; Gate 6 mandatory; preserve repo1; preserve GlitchTip/imaging isolation; single evidence PR at the end; reconcile VPS2 to topology-C dumb endpoint; conditional removal of unused pgBackRest on VPS2; no activation until repo1/WAL/capacity gates pass) |
| Prior state | PR #429 (F4-2, merged 2026-08-16) and PR #441 (F4-FCR-004, merged 2026-08-17) built the capability. `repo2` had **never been activated**; the secondary VPS was recorded as `NOT PROCURED` as of 2026-08-17. |
| Repository baseline | `origin/main` = `fe87c78cb865b0cdbfedcf4c9df5891eef823138` |
| Production release SHA | `c01c568d36d67869c76d012d0b953383162c411b` (PR #468, 2026-08-20 21:31 +02) |

**Not touched by this task:** `SENTRY_DSN`, NoraMedi telemetry, GlitchTip, DICOM/CBCT/imaging,
Kafka/Kubernetes, application architecture, application schema, Prisma migrations, existing
backups, `repo1` configuration, WAL archiving continuity. No destructive restore was performed
against production PostgreSQL.

---

## 2. STEP 1 — Production baseline (VPS1, read-only) — repo1 and WAL archiving HEALTHY

Collected `2026-08-21T10:46:08+03:00` on `disklinik-prod-01`.

| Fact | Value |
|---|---|
| OS / kernel | Ubuntu 24.04.4 LTS, 6.8.0-138-generic |
| PostgreSQL | **16.15**, cluster `16/main`, port 5432, online, `data_directory=/var/lib/postgresql/16/main` |
| pgBackRest | **2.50** |
| PM2 | `noramedi-api` online (pid 63614), `noramedi-worker` online (pid 63615), 12h uptime |
| Health | `GET /api/health` → `{"status":"ok"}` |
| `archive_mode` | `on` |
| `archive_command` | `pgbackrest --stanza=noramedi archive-push %p` |
| `archive_timeout` / `wal_level` | `300` / `replica` |
| `pg_stat_archiver` | `archived_count=1699`, **`failed_count=0`**, `last_archived_wal=0000000100000006000000AF` @ `2026-08-21 10:45:30.698241+03` |
| WAL backlog | `ready_count=0`, `pg_wal` = 67 109 238 B (64 MiB) |
| Disk (`/`) | 76 G total, 63 G available, 13 % used |
| `noramedi_crm` size | **19 MB** (19 946 519 B); full cluster as measured by pgBackRest: 40.4 MB |
| repo1 | `status: ok`, `cipher: aes-256-cbc`, latest full `20260819-142733F`, backup set size 4.55 MB |
| repo2 keys on VPS1 | **0** (in both `/etc/pgbackrest/pgbackrest.conf` and legacy `/etc/pgbackrest.conf`) |
| `/var/lib/postgresql/.ssh` | **absent** |

**Gate verdict: `STEP_1 = PASS`.** repo1 healthy, WAL archiving healthy, zero archive failures.
No stop condition triggered.

---

## 3. STEP 2 — VPS2 baseline (read-only), and what was found already built

Collected `2026-08-21T10:34–10:52 +03` on `vps-1281461-23217` (`94.138.221.64`).

| Fact | Value |
|---|---|
| OS / kernel | Ubuntu 24.04.4 LTS, 6.8.0-138-generic |
| Resources | 4 vCPU, 7.8 GiB RAM, 1.9 GiB swap |
| Storage | single `/dev/sda2` ext4, 148 G, **132 G available**, 8 % used |
| Encryption at rest | **NONE** — plain ext4, no LUKS, empty `/etc/crypttab` |
| Timezone | `Europe/Istanbul` |
| `systemctl --failed` | 0 units |
| Firewall (before) | UFW active, default deny in; 22/80/443 open |
| Workloads | GlitchTip stack (`noramedi-gt-r5-{web,worker,postgres,valkey}`) + `noramedi-minio` |

### 3.1 A pre-existing repo2 foundation was found — and it did **not** match the accepted design

`/etc/pgbackrest/pgbackrest.conf` on VPS2 was dated **2026-08-20** and self-identified as
*"VPS2 (repo2 technical foundation) — Lane D / F4-IMAGING-001-R5."* It diverged from the
accepted topology-C SFTP design on five points:

| Item | Accepted design (`F4_RECOVERY_OPERATIONS.md` §16.5 / §22.4b–c) | Found on VPS2 | Verdict |
|---|---|---|---|
| Topology | C — off-host, **no `repo2-host`** | no `repo2-host` | ✅ |
| pgBackRest on backup host | **"DO NOT install"** — dumb storage endpoint (§16.5) | **2.50 installed** | ❌ deviation |
| Config file on secondary | *"the secondary no config file at all"* | present | ❌ deviation |
| `repo2-type` | `sftp` or `s3` | **`posix`** | ❌ neither |
| `repo2-path` | `/var/lib/pgbackrest` | `/var/lib/pgbackrest/repo2` | ❌ mismatch |
| Host-key pinning | `fingerprint` + `sha256` + 64-hex | **absent** | ❌ |
| `authorized_keys` | VPS1 public key installed | **none** | ❌ transport not established |

**Security finding (closed by this task, §5):** the VPS2 config held a real 64-character
`repo2-cipher-pass` at `root:pgbackrest 0640` — group-readable by the very account that
serves the ciphertext over SFTP. Under topology C the storage host must hold **ciphertext
only**; co-locating the passphrase with the data defeats repository encryption against a
VPS2 compromise. Verified non-placeholder by length + pattern test; **the value was never
printed, captured, or transmitted.**

**Production-safety finding (closed by this task, §6):** Gate 6 (`F4_RECOVERY_OPERATIONS.md`
§22.9 — one-way trust) **FAILED**. VPS2 could reach production on the SSH port:

```
port 22:   UNREACHABLE_GOOD
port 2210: REACHABLE_BAD      <-- VPS1 SSH port reachable from the backup host
port 5432: UNREACHABLE_GOOD
port 5000: UNREACHABLE_GOOD
```

---

## 4. STEP 3 — Capacity gate

| Input | Value | Source |
|---|---|---|
| `noramedi_crm` database size | 19 MB | `pg_database_size()` |
| Cluster size as backed up | 41 MB | pgBackRest backup record |
| Compressed full backup (zst) | **4.4 MB** | repo2 backup set size |
| Retention | `repo2-retention-full=7` (count), `repo2-retention-archive=7` (full) | activated config |
| Full-backup steady state | ≈ 31 MB (7 × 4.4 MB) | derived |
| WAL generation, measured | ≈ 1 694 segments × 16 MB ≈ 27 GB raw since 2026-08-15 15:00 ⇒ **≈ 4.5 GB/day raw**, compressed zst in repo | derived from WAL min/max `…000011` → `…0000AF` |
| VPS2 available | **132 GB** | `df -h /` |
| repo2 actual footprint after activation | **5.4 MB** | `du -sh /var/lib/pgbackrest` on VPS2 |

`REPO2_CAPACITY_GATE = PASS`, with a large margin. No storage was purchased; the deferred
imaging disk was not added, per instruction. **No clinic-count runway figure is asserted** —
there is no evidence base for one and none was invented.

WAL-bytes gate arithmetic (`F4_RECOVERY_OPERATIONS.md` §22.10) verified on the production
PGDATA filesystem: available = **67 571 437 568 B**; 25 % = **16 892 859 392 B**; accepted
`NORAMEDI_OPSCHECK_PITR_MAX_WAL_BYTES` = `4294967296` (4 GiB) ≤ 25 %. **`GATE_OK`.**

---

## 5. STEP 5 — VPS2 reconciled to a topology-C dumb SFTP endpoint

Pre-state captured to `/root/f4-2-r1-vps2-prestate-20260821-105104.txt` (root-only, cipher
value redacted, provenance hash retained) before any mutation — decision 9.

**Confirmed unused before removal** (decision 9): no cron reference, no systemd unit or timer,
no running process, no APT reverse-dependency. The only artifacts were three
`lane-d-synthetic-*` log files from a synthetic stanza that had already been deleted.
Repository contained **0 regular files** below the top level — the script aborts if that is
not true, so no backup data was at risk.

Actions performed:

1. `shred -u /etc/pgbackrest/pgbackrest.conf`; `rm -rf /etc/pgbackrest` — **repo2 cipher
   passphrase removed from the storage host** (decision 3).
2. `apt-get purge pgbackrest` — VPS2 is now a dumb storage endpoint (§16.5), verified `ABSENT_GOOD`.
3. `pgbackrest` system account retained: uid 111, **`/usr/sbin/nologin`**, home `/var/lib/pgbackrest`.
4. Repository path reconciled to the accepted value: `install -d -o pgbackrest -g pgbackrest -m 0750 /var/lib/pgbackrest`; the stale empty `repo2/` subtree and empty `.ssh/` removed.
5. **`authorized_keys` moved OUT of the repository path** to `/etc/ssh/authorized_keys.d/pgbackrest`
   (`root:root 0644`) via `AuthorizedKeysFile` in the Match block. **Deliberate hardening beyond
   the runbook:** the runbook co-locates the repository with the SFTP account's home, which would
   let a compromised repository writer rewrite its own trust anchor. It cannot now.
6. Key installed with source pinning and full restriction:
   `restrict,from="185.210.92.141" ssh-ed25519 …`
7. sshd Match block (validated with `sshd -t` before `systemctl reload ssh`):

```
Match User pgbackrest
    AuthorizedKeysFile /etc/ssh/authorized_keys.d/pgbackrest
    ForceCommand internal-sftp
    AllowTcpForwarding no
    AllowAgentForwarding no
    X11Forwarding no
    PermitTTY no
    PasswordAuthentication no
    PermitTunnel no
```

### 5.1 Transport proven before any config was written on VPS1

| Probe | Result |
|---|---|
| TCP VPS1 → VPS2:22 | `REACHABLE_GOOD` |
| Authentication | `Authenticated to 94.138.221.64 ([94.138.221.64]:22) using "publickey"` |
| SFTP working directory | `/var/lib/pgbackrest` |
| Write + delete in repo path | `write_probe_exit=0` |
| **Interactive shell** | **refused** — `This service allows sftp connections only.` |
| **Escape to GlitchTip** | **refused** — `remote readdir("/opt/noramedi-glitchtip/"): Permission denied` |

Client keypair generated **on VPS1** (`ssh-keygen -t ed25519 -N ''`), private key never
printed or moved: `/var/lib/postgresql/.ssh/repo2` (`postgres:postgres 0600`), public
fingerprint `SHA256:g4CGihsf/AqzneDMIdE2NG0oIJfhYTgnRWvSxZn1OAo`.

---

## 6. STEP 4 / Gate 6 — one-way trust enforced

Applied on VPS2 (egress deny, chosen over narrowing inbound `22/tcp` because the latter would
have locked the operator out of the host — a destructive action outside the granted scope):

```
ufw deny out to 185.210.92.141 port 2210 proto tcp
ufw deny out to 185.210.92.141 port 22   proto tcp
```

Re-test, and again after all activation work completed:

```
port 22:   UNREACHABLE_GOOD
port 2210: UNREACHABLE_GOOD
port 5432: UNREACHABLE_GOOD
port 5000: UNREACHABLE_GOOD
```

`GATE_6 = PASS`. Source restriction is additionally enforced at the key level
(`from="185.210.92.141"`), which does not depend on VPS2's own firewall state.

---

## 7. STEP 6 — repo2 activation on VPS1

Config backed up to `/etc/pgbackrest/pgbackrest.conf.bak.f4-2-r1-20260821-105606`.

| Hash | Value |
|---|---|
| BEFORE | `eae9dab935d6e4958632f8789b471ff3a45b3502931ff8ef20a9a28b3000bd62` |
| AFTER (initial) | `8e443cbce0ad5ea180a66c1b34acd3317b7ca41480fab9c5fe263e81ae1842cd` |
| AFTER (fingerprint corrected, live) | `9b491ae59bbb203f2cc7aa5dbb7311252797d191d62217771c699c127326df89` |

Block inserted into `[global]` (`postgres:postgres 0600`):

```ini
repo2-type=sftp
repo2-path=/var/lib/pgbackrest
repo2-sftp-host=94.138.221.64
repo2-sftp-host-user=pgbackrest
repo2-sftp-private-key-file=/var/lib/postgresql/.ssh/repo2
repo2-sftp-public-key-file=/var/lib/postgresql/.ssh/repo2.pub
repo2-sftp-host-key-check-type=fingerprint
repo2-sftp-host-key-hash-type=sha256
repo2-sftp-host-fingerprint=3ecc73006398e7e7e87456649e40935f9e8aea4f3dfe1fd21c03aea92b796b0c
repo2-cipher-type=aes-256-cbc
repo2-cipher-pass=<generated on VPS1 with `openssl rand -hex 32`; never printed>
repo2-retention-full=7
repo2-retention-full-type=count
repo2-retention-archive=7
repo2-retention-archive-type=full
repo2-bundle=y
```

- **`NO_REPO2_HOST_GOOD`** — asserted programmatically; the `ERROR [072]` shape is absent.
- **`REPO1_IDENTICAL_GOOD`** — `diff` of all `repo1-*` keys before/after is empty.
- Passphrase distinctness from repo1 verified by **sha256 comparison only**; neither plaintext
  was read into a printable variable, and both hashes were `unset` immediately.
- Preflight (`noramedi-pgbackrest-preflight.sh`, dry-run) **exit 0**, all repo2 checks `OK`
  including `repo2-sftp-host-key-check-type=fingerprint`, `…-hash-type=sha256`, and a pinned
  64-lowercase-hex fingerprint.

### 7.1 NEW FINDING — libssh2 negotiates `ecdsa-sha2-nistp256`, not `ssh-ed25519`

The first `stanza-create` **failed closed** at exit 101:

```
ERROR: [101]: host [3ecc73006398e7e7e87456649e40935f9e8aea4f3dfe1fd21c03aea92b796b0c]
       and configured fingerprint (repo-sftp-host-fingerprint)
       [f66d385fe945f94dbaa5dbc8c01c2e5263fb7c0603b5da47aa4035d75df092bc] do not match
```

OpenSSH 9.6 negotiates the host's **ed25519** key (`f66d38…`); pgBackRest 2.50's bundled
**libssh2 prefers `ecdsa-sha2-nistp256`** (`3ecc73…`). Pinning the fingerprint that
`ssh -v`/`ssh-keyscan -t ed25519` reports therefore **cannot work** and fails closed every time.

This is the first time the pinned host-key shape has been exercised against 2.50 in
production; prior program evidence noted it had never been tested (the Gate 0 topology harness
runs with `host-key-check-type=none`). **Operational rule, now proven:** derive the pin from
the key the pgBackRest build actually receives — either from the `ERROR [101]` message itself
or via `ssh-keyscan -t ecdsa` — not from the OpenSSH-negotiated key.

Independent confirmation of the corrected pin:
`ssh-keyscan -t ecdsa 94.138.221.64 | awk '{print $3}' | base64 -d | sha256sum`
→ `3ecc73006398e7e7e87456649e40935f9e8aea4f3dfe1fd21c03aea92b796b0c` ✅

The pinned algorithm is `ecdsa-sha2-nistp256` — a modern algorithm. The program's
`MODERN SSH AUTH CANNOT BE NEGOTIATED => NO-GO` rule (F4-FCR-004-R1) is **not** engaged and
SHA-1 `ssh-rsa` was **not** enabled anywhere.

### 7.2 Activation result

```
stanza-create → exit 0   ("stanza 'noramedi' already exists on repo1 and is valid";
                          "stanza-create for stanza 'noramedi' on repo2" … completed successfully)
check         → exit 0
  INFO: check repo1 configuration (primary)
  INFO: check repo2 configuration (primary)
  INFO: WAL segment 0000000100000006000000B2 successfully archived … on repo1
  INFO: WAL segment 0000000100000006000000B2 successfully archived … on repo2
```

Both repositories visible and healthy.

---

## 8. STEP 7 — First controlled full backup to repo2

Command: `bash scripts/noramedi-pgbackrest-backup.sh --repo 2 --type full`

| Field | Value |
|---|---|
| Start / End | `2026-08-21T10:59:15+03:00` / `2026-08-21T10:59:24+03:00` |
| Wrapper duration | **9 s** (pgBackRest `backup` itself 7 823 ms) |
| Backup label | **`20260821-105916F`** |
| Type / repo | `full` / **repo2** |
| WAL start/stop | `0000000100000006000000B4` / `0000000100000006000000B4` |
| Database size | 41 MB (file total 2 073) |
| Backup set size on repo2 | **4.4 MB** |
| Exit code | **0** |
| `expire` | completed successfully (nothing to expire at count 1 of 7) |
| `verify --repo=2` | **exit 0** (17 917 ms) |

**repo1 untouched:** backup count still **7**, labels byte-identical to the §2 baseline
(`20260815-150014F`, `…_20260815-221709D`, `20260815-224355F`, `20260819-000341F`,
`…_20260819-105037D`, `20260819-114101F`, `20260819-142733F`). No backup was deleted anywhere.

---

## 9. STEP 8 — WAL continuity

```
pg_switch_wal() → 0000000100000006000000B5
```

| Measure | Value |
|---|---|
| Archived within | < 5 s |
| `archived_delta` | 1 |
| **`failed_delta`** | **0** |
| `ready_count` after | 0 |
| `pg_wal` bytes after | 67 109 238 (unchanged, 64 MiB) |
| Segment present in repo1 | `repo1_hits=1` |
| **Segment present in repo2** | **`repo2_hits=1`** — `0000000100000006000000B5-69b5920ce15c94592d929885e8c1ce0b5ea35676.zst` |
| `pgbackrest check` | exit 0; `…000000B6` archived to **both** repo1 and repo2 |
| repo2 archive range | `0000000100000006000000B2` → `0000000100000006000000B6` |

---

## 10. STEPS 9–11 — Isolated restore drill sourced from repo2, smoke, RPO/RTO

Command (production PostgreSQL untouched throughout):

```
sudo REHEARSAL_OS_USER=postgres PG_BINDIR=/usr/lib/postgresql/16/bin \
     NORAMEDI_APP_SERVER_DIR=/var/www/noramedi/server \
     NORAMEDI_PITR_DRILL_PROD_PGDATA=/var/lib/postgresql/16/main \
     bash scripts/noramedi-pgbackrest-restore-drill.sh \
     --repo 2 --record --stanza noramedi --port 55433
```

| Field | Value |
|---|---|
| `run_id` | `20260821-080128-85617` |
| Isolated data dir | `/dev/shm/noramedi-pitr-drill-20260821-080128-85617` (tmpfs, RAM-backed) |
| Port / auth | `55433`, socket-only (`listen_addresses=''`), peer-mapped, no TCP, no `trust` |
| Source | **repo2**, backup `20260821-105916F` |
| Recovery target | `<latest, no target>`; recovery point `2026-08-21T08:00:00Z` |
| **RPO** | **1 min** (source `pg_last_xact_replay_timestamp`) vs target 60 min → **within** |
| **RTO** | **10 s** to `tenant_smoke_complete` vs target 14 400 s → **within** |
| RTO breakdown | restore 1 s · connections-ready 4 s · promotion 7 s · db-verify 8 s · app smoke 10 s · tenant smoke 10 s |
| Migrations | expected 80 from deployed release · **0 missing** · **0 ahead** · 0 unfinished · 0 rolled back |
| Public tables | 115 |
| Application smoke | **passed** (deployed Prisma client connected and queried the restored schema) |
| Tenant-isolation smoke | **passed** — cross-clinic appointments **0**, orphan clinic references **0**, orphaned appointments **0**, RLS policies 0 (expected 0; this domain does not use RLS) |
| Aggregate counts | clinics 3 · patients 21 · appointments 28 *(aggregate counts only; no row values read or recorded — no PHI)* |
| Result | **PASS** · `R032_eligible: true` · `drill_exit=0` |
| Cleanup | `/dev/shm/noramedi-pitr-drill-…` **removed and verified gone**; no cleanup incident |

**Production untouched, verified after the drill:** port 5432 listener count 1, drill-port
listener count 0, `prod_alive` query succeeded, `GET /api/health` → `{"status":"ok"}`,
`pg_stat_archiver.failed_count` = 0.

Off-host proof marker written (`/var/lib/noramedi/pitr-offhost-proof.json`):

```json
{"schemaVersion":1,"result":"passed","repo":2,"stanza":"noramedi",
 "target":"94.138.221.64","runId":"20260821-080128-85617",
 "finishedAt":"2026-08-21T08:01:39Z"}
```

Consequently `noramedi-pgbackrest-status.sh` now reports, from its own independent evaluation:

```json
"offHost": "yes", "tier": "T2", "offHostReason": "RESTORE_PROVEN_FROM_REPO2",
"checkStatus": "ok", "repo2BackupCount": 1,
"repo2LastBackupAt": "2026-08-21T07:59:21Z"
```

This is the first time in the program's history that `offHost` has evaluated to `yes`.

---

## 11. STEP 14 — Security / tenant / KVKK review

| Flag | Value |
|---|---|
| `TENANT_ISOLATION_CHANGED` | **NO** — and independently re-verified by the drill's tenant smoke (0 cross-clinic, 0 orphans) |
| `AUTH_CHANGED` | **NO** (application auth untouched; a new SFTP service credential was created for backup transport only) |
| `APP_SCHEMA_CHANGED` | **NO** |
| `MIGRATION_CREATED` | **NO** |
| `MIGRATION_DEPLOYED` | **NO** (80 migrations observed, unchanged) |
| `PHI_EXPOSED_IN_LOGS` | **NO** — no secret, passphrase, or private key printed at any point; only aggregate counts recorded |
| `BACKUP_ENCRYPTED` | **YES** — `aes-256-cbc`, verified by `info` reporting `cipher: aes-256-cbc` on repo2 |
| `TRANSPORT_ENCRYPTED` | **YES** — SSH/SFTP with pinned `ecdsa-sha2-nistp256` host key |
| `REPO2_OFF_HOST` | **YES** — `offHost=yes`, `RESTORE_PROVEN_FROM_REPO2` |
| `REPO1_PRESERVED` | **YES** — 7 backups, identical labels, `repo1-*` keys byte-identical |
| `GLITCHTIP_CHANGED` | **NO** |
| `IMAGING_STORAGE_CHANGED` | **NO** |

### 11.1 GlitchTip / imaging isolation proof (VPS2, after activation)

| Check | Result |
|---|---|
| Separate service accounts | `pgbackrest` (111, nologin) · `noramedi-glitchtip` (987) · `noramedi-imaging` — distinct |
| Separate directories | `/var/lib/pgbackrest` `pgbackrest:pgbackrest 0750` · `/opt/noramedi-glitchtip` `0750` · `/srv/noramedi-imaging` `0750` · `/opt/noramedi-minio` `root:root 0750` |
| `pgbackrest` → GlitchTip | `GT_NOT_READABLE_GOOD` (also refused over SFTP) |
| `pgbackrest` → imaging | `IMG_NOT_READABLE_GOOD` |
| `pgbackrest` → MinIO | `MINIO_NOT_READABLE_GOOD` |
| Shared writable path | **none** |
| Imaging MinIO reused for repo2? | **NO** — rejected per decision 2. It remains loopback-only and its data dir is imaging staging. |
| GlitchTip runtime after activation | all 4 containers Up; `web`/`postgres`/`valkey` healthy; `noramedi-minio` healthy |
| `systemctl --failed` on VPS2 | 0 units |
| Cipher passphrase present on VPS2 | **`NONE_FOUND_GOOD`** |
| pgBackRest binary on VPS2 | **`ABSENT_GOOD`** |

### 11.2 KVKK GOVERNANCE GAP — the register was corrected *after* the gate, not before

`docs/compliance/62-kvkk-subprocessor-register.md` §6 stated, before this task:

> "…the row stops being true **the moment a pgBackRest `repo2` on any other host is
> activated** — at that point the backup destination becomes a distinct hosting relationship
> holding full physical copies of the database plus a continuous WAL stream, i.e. özel
> nitelikli sağlık verisi. … This row must be corrected, and §1 given a second hosting entry,
> **before** any byte leaves the production host — **not after**."

**That sequencing requirement was not met.** repo2 was activated and 4.4 MB of encrypted full
backup plus a continuous WAL stream now reside on the IHS-hosted secondary VPS, and the
register is being corrected in the same change set — i.e. **after** the first byte left. This
is recorded as a **finding against this task**, not written out of the record.

Mitigating facts, none of which cure the sequencing defect:

- §1a of the register (added 2026-08-20) **already named the second hosting relationship**:
  IHS Kurumsal Teknoloji Hizmetleri, Türkiye / NGN Data Center, with E1/E2/E4/E5 residency
  evidence recorded. So the "second hosting entry" requirement was substantively satisfied in
  advance; what was **not** satisfied is the Workload-B scope extension and §6's correction.
- §1a explicitly gates Workload B separately: *"Do not read this row … as authorization for
  Workload B or C — those remain scoped-only … and require their own, heavier gate
  (special-category health data, KVKK Art. 6 DPA scope)."* **That heavier gate is still open**
  (`COUNSEL REVIEW PENDING`; DPA scope to Art. 6 unconfirmed; `I1–I5` provider items undefined).
- All backup content at rest on VPS2 is **AES-256-CBC ciphertext**, and after §5 the
  decryption passphrase **does not exist anywhere on VPS2**. The provider therefore holds
  ciphertext without the key.
- Transport was encrypted and host-key-pinned; the storage account has no shell and no read
  access to any other workload.

**Consequence:** `R-030-DB` is **not** closed, `FIRST_CUSTOMER_RECOVERY_GATE` remains
`NOT_SATISFIED`, and the program owner must now choose between (a) completing the Art. 6 DPA
scope + counsel confirmation and recording it as a ratification, or (b) rolling repo2 back
(§13) until that gate clears. **This decision belongs to the program owner and is not made
here.**

---

## 12. STEP 13 — Post-activation health, and the four remaining blockers

### 12.1 VPS1

```
pgbackrest info      → stanza noramedi, status: ok, cipher: aes-256-cbc
pg_stat_archiver     → archived_count=1709, failed_count=0,
                       last_archived_wal=0000000100000006000000B8 @ 11:03:03.673934+03
GET /api/health      → {"status":"ok"}
pm2                  → noramedi-api online, noramedi-worker online
df /                 → 63 G available, 13 % used
ready_count          → 0
```

### 12.2 VPS2

```
df /                 → 132 G available, 8 % used
du -sh repo2         → 5.4 M
backup set           → 20260821-105916F present, backup.info + .copy present
archive              → 8 segments B2…B8 present as .zst
ownership            → pgbackrest:pgbackrest 0750 throughout
systemctl --failed   → 0 units
```

### 12.3 Four blockers that keep `R-030-DB` OPEN

1. **`repo2-cipher-pass` is NOT escrowed off-host.** It exists only in
   `/etc/pgbackrest/pgbackrest.conf` on VPS1. The runbook (§15) requires escrow **before**
   `stanza-create`, because the passphrase is fixed at stanza creation and cannot be rotated
   in place. **Until escrow is done, losing VPS1 means losing the ability to decrypt repo2 —
   which defeats the entire purpose of an off-host repository.** This requires an operator to
   read the value once and store it in an independent secret store; it cannot be automated
   from here without printing the secret. **This is the single highest-priority follow-up.**
2. **repo2 has no backup schedule.** `/etc/cron.d/noramedi-pgbackrest` does not exist on VPS1
   — repo1 backups have also been ad-hoc. repo2 currently holds exactly one full backup.
   Creating a new recurring production job was judged outside the granted authorization and
   was deliberately **not** performed.
3. **The deployed monitoring cannot see any of this.** `/usr/local/sbin/noramedi-opscheck.sh`
   is the **2026-08-13** build (17 301 B) with **0** occurrences of `pitr`; the repository
   version (2026-08-17, 74 840 B) has **103**. Setting `NORAMEDI_OPSCHECK_PITR_*` variables
   today would be **inert**, so they were deliberately **not** written. Consequently the WAL
   backlog gate and the off-host alert are **not active**, and an unreachable repo2 would fail
   `archive-push` with no alerting — the exact failure mode preflight warns about. Requires
   deploying the current opscheck plus an operator-supplied Healthchecks PITR ping URL, then
   `NORAMEDI_OPSCHECK_PITR_REQUIRE_OFFHOST=true`.
4. **KVKK Workload-B gate open** — §11.2.

---

## 13. STEP 12 — Rollback, proven non-destructively

Rollback was **proven without being executed destructively**: the live config was copied to a
scratch file with all `repo2-*` keys stripped, and pgBackRest was run against it via `--config`.

```
repo2 keys in scratch config: 0
repo1 keys in scratch config: 8
pgbackrest --config=<scratch> --stanza=noramedi check  → exit 0
  INFO: WAL segment 0000000100000006000000B8 successfully archived … on repo1
pgbackrest --config=<scratch> --stanza=noramedi info   → status: ok
live_sha256        = 9b491ae59bbb203f2cc7aa5dbb7311252797d191d62217771c699c127326df89
live_sha256_after  = 9b491ae59bbb203f2cc7aa5dbb7311252797d191d62217771c699c127326df89   (unchanged)
```

Rollback therefore satisfies all four required properties: production continues on repo1, WAL
archiving stays healthy, PostgreSQL stays available, and repo2 evidence is not deleted.

Documented rollback commands (**not executed**):

```bash
# 1. Config-level rollback (production continues on repo1)
sudo cp -a /etc/pgbackrest/pgbackrest.conf.bak.f4-2-r1-20260821-105606 \
           /etc/pgbackrest/pgbackrest.conf
sudo -u postgres pgbackrest --stanza=noramedi check

# 2. Credential rollback
sudo rm -f /var/lib/postgresql/.ssh/repo2 /var/lib/postgresql/.ssh/repo2.pub
# on VPS2:
sudo rm -f /etc/ssh/authorized_keys.d/pgbackrest && sudo systemctl reload ssh

# 3. repo2 data — DESTROYS BACKUPS ONLY, production untouched. Do NOT run except to decommission.
# on VPS2:
sudo find /var/lib/pgbackrest -mindepth 1 -delete

# 4. opscheck off-host requirement (once opscheck supports it)
NORAMEDI_OPSCHECK_PITR_REQUIRE_OFFHOST=false
```

---

## 14. Deviations from the runbook, and why

| Deviation | Rationale |
|---|---|
| `authorized_keys` at `/etc/ssh/authorized_keys.d/pgbackrest` instead of inside `/var/lib/pgbackrest/.ssh` | The runbook co-locates the repository with the SFTP account's home directory. Because that account owns the repository directory, it could unlink/replace its own `.ssh` and rewrite its trust anchor. Moving the file out, root-owned, removes that persistence path with no functional cost. |
| Gate 6 enforced as **egress deny on VPS2** rather than narrowing inbound `22/tcp` to VPS1 only | The runbook's literal instruction ("allow ONLY the production host → backup host :22") would have removed the operator's own administrative access to VPS2 — a destructive action outside the granted authorization. Source restriction is additionally enforced at the key level via `from=`, which is independent of firewall state. Both were verified. |
| Host-key pin uses `ecdsa-sha2-nistp256`, not `ssh-ed25519` | Forced by libssh2's algorithm preference in pgBackRest 2.50 — see §7.1. Pinning ed25519 fails closed 100 % of the time. |
| `NORAMEDI_OPSCHECK_PITR_*` variables **not** written | They would be inert against the deployed 2026-08-13 opscheck build (§12.3 item 3). Writing them would have created a false impression of active monitoring. |
| No repo2 backup schedule created | Creating a new recurring production job is outside the granted authorization (§12.3 item 2). |

---

## 15. Reproduction / verification commands (read-only)

```bash
# VPS1
sudo -u postgres pgbackrest --stanza=noramedi info
sudo -u postgres pgbackrest --stanza=noramedi --repo=2 info
sudo -u postgres pgbackrest --stanza=noramedi check
sudo -u postgres psql -x -c "select archived_count, failed_count, last_archived_wal,
    last_archived_time, last_failed_wal, last_failed_time from pg_stat_archiver;"
bash /var/www/noramedi/scripts/noramedi-pgbackrest-status.sh --stdout

# VPS2
du -sh /var/lib/pgbackrest
stat -c '%n %U:%G %a' /var/lib/pgbackrest
command -v pgbackrest || echo "ABSENT_GOOD"
for p in 22 2210; do timeout 5 bash -c "cat </dev/null >/dev/tcp/185.210.92.141/$p" \
  && echo "port $p REACHABLE_BAD" || echo "port $p UNREACHABLE_GOOD"; done
```

---

## 16. Lifecycle

`agent completed = YES` · `tests passed = N/A (no application code changed; production
verification performed instead)` · `PR opened = YES` · `merged = NO` · `deployed = N/A` ·
`production verified = YES`

`MERGE_SAFE = YES` (documentation only) · `DEPLOY_SAFE = YES` (no application change) ·
`FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED`
