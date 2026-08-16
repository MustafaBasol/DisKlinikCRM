# F4-FCR-003 — R-030-DB off-host recovery activation preparation

**Task:** `F4-FCR-003` · **Phase:** F4 — Object Storage, Backup, PITR and Restore Evidence
**Risk:** `R-030-DB` — **`OPEN`**, and it stays open.
**Date:** 2026-08-16
**Type:** Repository implementation + a local, synthetic-data experiment. **No production access.**
**Baseline:** `origin/main` @ `c0567efc20d808e3fd0ecedfae167e808ee2e5d7`
**Branch:** `feature/f4-fcr-003-r030-db-recovery-readiness`
**Task lifecycle:** `AGENT_COMPLETED` · `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`
**Activation lifecycle:** `PREPARED_NOT_EXECUTED`

> **Task ID note.** `F4-FCR-003` did not exist in this repository before this
> document. The tracker named the work descriptively — *"the next task in the
> F4 recovery lane is off-host repository enablement for `R-030`"* — and
> issued no ID, the last recovery-lane ID being `F4-2`. Per
> [`README.md`](../README.md) §ID rules, the ID is issued here and in
> [`NORAMEDI_MASTER_TRACKER.md`](../NORAMEDI_MASTER_TRACKER.md) together. It is
> recorded as **newly issued**, not as pre-existing.

## 0. What this task did NOT do

Stated first, because the value of everything below depends on it being true.

- **No production access of any kind.** No SSH, no production PostgreSQL
  connection, no credential discovery.
- **No secondary Türkiye VPS** was procured, and none exists.
- **No `repo2` was created.** No production configuration was changed. No
  cron or systemd unit was installed or modified.
- **No byte left any host.** No backup was taken. No PITR marker was written.
  No restore drill was run against production.
- **No schema change and no migration** — verified: the diff contains no
  `prisma/` path and no `.sql`.
- **`R-030-DB` is not closed, downgraded, or advanced.** Neither is `R-030`,
  `R-030-FILES`, or `R-080`. `FIRST_CUSTOMER_RECOVERY_GATE` remains
  `NOT_SATISFIED`.

The tracker was right that the remaining work is *procurement, legal and
operator activation, not code*. This task does not contradict that. It
addresses a different question: **when the operator finally gets that one
maintenance window, does the repository let them spend it on activation, or on
debugging the repository?** Six defects said the latter.

## 1. The four latent defects, and why each one mattered

Every one is a **silent-failure** defect: it produces a confidently wrong
signal rather than an error, which is the failure class this program's
evidence design exists to prevent.

### 1.1 A plaintext repo2 backup was possible (`P1`, KVKK Art. 6)

`noramedi-pgbackrest-backup.sh` contained **zero** occurrences of `cipher`.
Encryption was enforced only by `noramedi-pgbackrest-preflight.sh` — a
*separate operator step*, ordered by prose in runbook §16.5, not a gate.
`--repo 2` invoked without it would write a physical copy of every table,
including special-category health data, **in plaintext** to infrastructure this
program does not operate. The status writer's `REPO2_PLAINTEXT` verdict was the
only backstop, and it lands *after* the bytes are gone.

**Fixed:** a fail-closed cipher gate on the write path, scoped to
`REPO_NUM != 1` so today's production `--repo 1` path is byte-for-byte
unchanged. It reads the cipher *type* only; the passphrase is never read.

### 1.2 A passing repo2 restore could yield `offHost: unproven` forever (`P1`)

The drill derived its proof target with **one alternation and `head -n1`** —
whichever `repo2-host|s3-endpoint|path` key appeared **first in file order**.
The status writer applies a **fixed precedence**: host → s3-endpoint → path.

An SSH repo2 legitimately carries **both** `repo2-host` and `repo2-path`, and
pgBackRest attaches no meaning to their order. Write them the other way round
and the drill records the path while the writer looks for the host. The drill
passes, the proof is written, the writer discards it, and `offHost` sits at
`unproven` permanently with no diagnostic anywhere. §16.5's snippet happens to
list the host first, so following it literally worked — nothing enforced it.

**Fixed:** the drill now uses the same per-key lookup and the same precedence,
so the two agree by construction. It is also keyed on `REPO_NUM` rather than a
hardcoded `repo2`, which closes a second hole: a `--repo 3` drill previously
recorded *repo2's* target, which the writer would then **match**, earning a
repo2 off-host claim from a restore that never touched repo2.

### 1.3 A target mismatch was reported as proof staleness (`P1`)

When the writer refused a proof it emitted `RESTORE_PROOF_STALE_OR_FUTURE`
regardless of cause. A target-mismatched proof is neither stale nor
future-dated — so the operator was pointed at proof *ageing* while the real
cause was §1.2.

**Fixed:** distinct reason codes — `RESTORE_PROOF_TARGET_MISMATCH`,
`RESTORE_PROOF_NOT_FROM_REPO2`, `RESTORE_PROOF_NOT_PASSED`,
`RESTORE_PROOF_UNREADABLE` — with the staleness reason kept for actual
staleness. `offHostReason` is a free-form `safeToken(…, 48)` in the TypeScript
reader, so this needed no contract change. Every refusal still yields epoch 0;
fail-closed behaviour is unchanged.

### 1.4 The sentinel-organization mismatch was still unfixed (`P1`)

Runbook §21.7 recorded this and **prescribed the fix**; no runtime script had
implemented it. The marker *writer* is an operator-side program deliberately
not in this repository, so the two agree on the sentinel literal only by
convention. When they diverged, the drill queried `__noramedi_pitr_drill__`
while markers were written under `noramedi-f4-pitr-sentinel`, producing
`marker A = 0` — which the drill reports as *"recovery undershot the target or
the marker was never archived"*. That is a confidently wrong diagnosis, and it
cost **a full restore on the fourth attempt**.

**Fixed as prescribed:** `--pitr-run-id` now requires
`NORAMEDI_PITR_MARKER_ORG` to be stated explicitly. The default survives for
unverified triage restores, which read no marker at all.

### 1.5 repo2 could be activated with no retention bound (`P1`)

Preflight validated repo2's cipher, passphrase presence and passphrase
distinctness — and nothing else. `repo2-retention-full`/`-archive` appeared in
the SSH template block, were **missing from the S3 block**, and no code path
failed when absent. pgBackRest expires nothing it was not told to expire, so an
off-host repository would grow without bound on infrastructure this program
neither monitors for disk nor can free space on during an incident.

**Fixed:** preflight requires both keys with a usable value; the S3 template
block gains them.

## 2. Gate 0 — executed, `PASS`, and it changed the runbook

Gate 0 existed as **four comment lines** inside a section headed `NOT
EXECUTED`, restated as an open question in three places and answered in none.

**Harness:** [`scripts/noramedi-gate0-repo2-unreachability.sh`](../../../scripts/noramedi-gate0-repo2-unreachability.sh)
**Evidence:** [`F4-FCR-003_gate0_repo2_unreachability.json`](F4-FCR-003_gate0_repo2_unreachability.json)
**Run:** `20260816T135232Z-26650`, smoke mode, pgBackRest **2.59.0** /
PostgreSQL 16.15 / docker 29.6.2 `linux/amd64`. **77 samples.**
**Classification:** `OBSERVED_LOCAL_ONLY`.

No second VPS was needed, and that is not a shortcut. Gate 0 asks a
*failure-mode* question, and from the pushing process's point of view "repo2 is
unreachable" is indistinguishable between a dead VPS and a severed container
network; the transport changes only how long the error takes. R-030-DB needs a
genuinely independent failure domain. Gate 0 does not — and conflating the two
is what made this experiment look impossible to run.

### 2.1 The answer

**`archive-push` FAILS THE COMMAND** when one of two repositories is
unreachable. It does **not** return success having written repo1 only.

| Measure | Baseline → Outage → Recovery |
|---|---|
| `archivedCount` | 8 → **8 (frozen)** → 9 |
| `failedCount` | 0 → **6** |
| `readyCount` | 0 → 1 → **0** |
| `walBytes` | 50,332,019 → **67,109,235** |
| postgres | **running throughout** |
| acknowledged commits lost | **0** |

This is the **safe** outcome, and it is the one that matters most: PostgreSQL
never marks a segment archived that did not reach repo2, so it cannot recycle
it, so the off-host chain cannot develop a silent hole. The risk is therefore
**observable disk growth** rather than **undetectable data loss**.

### 2.2 The finding nobody had written down

**An unreachable repo2 halts WAL archiving to `repo1` as well.**
`archivedCount` did not advance *at all* during the outage, despite continuous
write load and a perfectly healthy local repo1 — because `archive_command`
fails as a unit.

So a repo2 outage is not "the off-host copy falls behind". It suspends the
**entire** archive chain and degrades repo1's PITR resolution for the duration.
No repository document said this. It changes how a repo2 alert should be
triaged and how the maintenance window should be planned.

### 2.3 Two published commands were invalid

Gate 0's bring-up hit them before an operator could:

- `pgbackrest --stanza=noramedi --repo=2 stanza-create` — **rejected**
- `pgbackrest --stanza=noramedi --repo=2 check` — **rejected**
  (`ERROR: [031]: option 'repo' not valid for command 'check'`)

Both are inherently all-repository operations and take no `--repo`. Verified
empirically per command on 2.59.0: `--repo` is **rejected** by `check` and
`stanza-create`, and **accepted** by `backup`, `restore`, `info`, `expire`,
`verify` — which is why the backup wrapper and the restore drill were never
affected. **Only the runbook was wrong**, and §16.5 step 9 would have failed on
activation day. Corrected.

Also corrected: the **secondary** must declare its repository under the same
index the primary uses (`repo2-path`, not `repo1-path`). The remote inherits
the primary's option set, and the collision surfaces as `local repo1 and repo2
paths are both '…' but must be different` — a message that names *paths* rather
than *indexes*, sending the operator to change a directory that is correct.

### 2.4 What Gate 0 did NOT establish

- **Monitoring sufficiency.** Smoke mode does not run to disk exhaustion.
  There is **no `pg_wal`-size check and no `archive_status/*.ready` counter
  anywhere in this repository**; the only backpressure signals are
  archived-WAL age > 120 min and filesystem > 90%, and whether either trips
  before a full disk has never been computed. `--mode full` exists for this.
  **Recorded as an open risk, not as a pass.**
- **Anything about production's build.** These semantics hold for 2.59.0.
  Production's installed version is recorded nowhere in this repository;
  CHECKPOINT 1 asks for it explicitly and gates on parity.
- **Anything about durability.** A severed container network models
  unreachability and is no model at all of an independent failure domain.

## 3. Operator activation packet

Runbook [§22](../runbooks/F4_RECOVERY_OPERATIONS.md), CHECKPOINT 0–12, with
per-checkpoint gates, before/after config hashes, an evidence-capture list, and
a rollback table. §22.4 is deliberately out of numeric order because it changes
the commands typed in later checkpoints.

**CHECKPOINT 2 onward cannot begin**: the seven §16.2 prerequisites are unmet
and the secondary VPS is `NOT PROCURED`. CHECKPOINT 0 and 1 are read-only and
can be run today.

## 4. Tests

| Command | Exit | Passed | Failed | Skipped |
|---|---|---|---|---|
| `npm run test:shell` | 0 | **416** (150 + **216** + 50) | 0 | 1 |
| `npm run test:pitr-status-contract` (server) | 0 | 16 | 0 | 0 |
| `npm run test:platform-recovery-safety` (server) | 0 | 60 | 0 | 0 |
| `npx tsc --noEmit` | 0 | 0 `error TS` | 0 | 0 |
| `git diff --check` | 0 | clean | 0 | 0 |
| `bash -n` on the Gate 0 harness | 0 | clean | 0 | 0 |

The pgBackRest suite went **197 → 216** (+19). The single skip is
Windows-only (`/proc/meminfo` absent); CI on `ubuntu-latest` runs it.

New coverage: the plaintext-repo2 write refusal and that `--repo 1` is
unaffected; repo2 retention presence and a canary-leak assertion; the distinct
refusal reason codes; **the drill→proof→status handoff**, which tests 10–12
never touched because they hand-write the proof file; and the sentinel refusal
plus proof that it does not leak onto the unverified triage path.

## 5. Security / KVKK

- **Reduces** the risk of an unencrypted physical copy of special-category
  health data leaving production. That is the change with real KVKK weight.
- No new endpoint, credential, or surface. No tenant-scoped code path touched.
- The Gate 0 harness uses **synthetic data only**, runs on an `--internal`
  docker network so it provably cannot reach production, generates per-run
  random passphrases that are never printed, and verifies its own cleanup —
  reporting an incomplete teardown as an incident rather than a warning.
- The seven §16.2 legal prerequisites are **unchanged and unmet**. Nothing here
  advances them, and item 3 (subprocessor register §1 and §6) must still be
  corrected *before* a repo2 exists.

## 6. Rollback

Repository: revert the single commit. No schema, no migration, no data
change, nothing to undo in the database.

Behavioural note for reviewers: the two fail-closed gates (plaintext repo2,
unstated sentinel) can turn a previously-succeeding *invocation* into a
refusal. Both refuse only invocations that were already unsafe — a plaintext
off-host backup, and a verified drill whose marker sentinel is unstated — and
neither is reachable on the `--repo 1` path that runs in production today.

Production rollback for the activation itself is runbook §22.17.

---

# F4-FCR-003-R1 — architecture review remediation

**Date:** 2026-08-16 · **Branch:** unchanged · **PR:** #433 (same draft PR)
**Reviewed head:** `826aec1286029ecfa4980b5c75b0deea13416cd4`
**Type:** CI repair + local version-pinned experiment + additive monitoring.
**No production access. No production mutation. `R-030-DB` stays `OPEN`.**

Three review findings. Everything below is **additive**: no existing assertion
was weakened or deleted, and no existing production behaviour changes by
default.

## R1.1 CI was RED — and the guard, not the fixture, was wrong

The pgBackRest shell suite failed on `ubuntu-latest` at **217 passed / 1
failed**, on the one assertion that proves a guard can fail:

```
FAIL - no 'rm -rf ... 2>/dev/null || true' anywhere
       — the guard still PASSES on a mutant that reintroduces the defect
```

The same tree was **216 / 0** on the development machine. That difference is
the finding.

### Root cause

`guard_no_silent_rm` was written as a negated pipeline, under this file's
`set -o pipefail`:

```bash
! grep -vE '^[[:space:]]*#' "$1" | grep -qE 'rm -rf[^|]*2>/dev/null[[:space:]]*\|\|[[:space:]]*true'
```

`grep -q` exits **0 the instant it matches**, without draining stdin. The
upstream `grep -v` then takes `SIGPIPE` on its next write and exits **141**.
`pipefail` makes 141 — not grep's 0 — the pipeline's status, and the leading
`!` inverts that into **success**, i.e. *"pattern not found"*.

So the guard reported CLEAN on precisely the input that **contains** the
defect, and only on that input: with no match, `grep -q` reads to EOF, the
producer exits 0, and the guard behaves correctly. Whether it fails is a race
on how much the producer still had to flush when `grep -q` left — which is why
it lost on CI and won locally on byte-identical files.

Reproduced deterministically:

```
$ old_guard  big-file-with-defect-on-line-1   -> reports CLEAN  (3/3 runs)
$ new_guard  big-file-with-defect-on-line-1   -> detects        (3/3 runs)
$ pipeline status under pipefail = 141        (without pipefail = 0)
```

**This was not only a broken fixture.** A real reintroduction of the unsafe
cleanup into `noramedi-pgbackrest-restore-drill.sh` could have been reported
clean by the same race. The correct fix is to the guard, not to the mutant.

### Fix

Materialise the haystack, then grep it — no pipeline, so the answer is grep's
own exit status and nothing else:

```bash
haystack_has() { grep -qE "$2" <<<"$1"; }
absent_in()    { ! haystack_has "$1" "$2"; }
```

`guard_no_trust_auth`, `guard_no_tcp_rule` and `guard_peer_auth_present` had
the identical unsound shape — two of them are HIGH security guards on the
disposable cluster's `pg_hba` — and were converted the same way. Their
producers emit a small block so they had not yet lost the race; they could.

**The mutation assertion is unchanged.** No expected string was edited.

### The new control, and why it is non-vacuous

The mutant alone is a weak stress case: the drill's non-comment body is ~50 KB
and the defect lands two thirds down, so it fits in one 64 KiB pipe buffer and
a pipeline-shaped guard usually wins the race by luck. A permanent control now
removes the luck rather than depending on the mutant to expose it — the defect
is the **first** line, followed by ~1.5 MB of filler:

| Input | Old guard | New guard |
|---|---|---|
| oversized haystack **with** the defect on line 1 | reports CLEAN (false negative, deterministically) | **detects** |
| the same haystack **without** the defect | reports clean | reports clean |

The second row is what makes the control non-vacuous: it discriminates, rather
than merely rejecting large files. Both rows are asserted.

## R1.2 pgBackRest version parity — `OBSERVED_LOCAL_ONLY — SAME SEMANTICS`, with one bring-up difference

Production is **pgBackRest 2.50 / PostgreSQL 16.14**. The original Gate 0 ran
on **2.59.0 / 16.15**, so its result did not transfer.

The harness now pins both:

```bash
scripts/noramedi-gate0-repo2-unreachability.sh --mode smoke \
  --pgbackrest-version 2.50 --postgres-image postgres:16.14-bookworm
```

Pinned pgBackRest resolves through **apt-archive.postgresql.org** (the live
PGDG repository retains only the two newest builds). An unresolvable pin fails
the build with `PGBACKREST_PIN_UNAVAILABLE` and exits 3; there is no fallback,
and the pin is re-verified against the running binary before the experiment
starts. `postgres:16.14-bookworm` gives exact PostgreSQL parity.

### The archive-push question, answered on 2.50

Same question, same injection (`M1_BLACKHOLE`), same config shape as production
(`process-max=2`, **no** `archive-async`, **no** `spool-path`, **no**
`archive-push-queue-max`):

| Phase | archived | failed | `.ready` | `pg_wal` bytes |
|---|---|---|---|---|
| baseline first → last | 0 → **4** | 0 → 0 | 1 → 0 | 50.3 MB → 83.9 MB |
| **outage** first → last | **4 → 4 (frozen)** | 1 → **36** | 1 → **12** | 83.9 MB → **285.2 MB** |
| recovery first → last | 4 → **29** | 39 → 39 | 13 → **0** | 302.0 MB → 503.3 MB |

Answering the review's question list directly, on 2.50:

- **What does `archive-push` return?** It **fails the command**
  (`failedCount` 1 → 36). It does not return success having written repo1 only.
- **Does PostgreSQL keep accepting foreground writes?** **Yes** — the synthetic
  writer committed continuously and `postgresState` stayed `running`.
- **Does `archived_count` freeze?** **Yes** — frozen at 4 for the entire
  outage, under continuous write load and with repo1 healthy and reachable.
  The whole archive chain is suspended, repo1 included.
- **Does `failed_count` increase?** **Yes**, monotonically.
- **Does a `.ready` backlog appear?** **Yes** — 1 → 12 in 180 s.
- **Does WAL disk usage increase?** **Yes** — 83.9 MB → 285.2 MB in 180 s
  (~1.1 MB/s at this synthetic, deliberately accelerated rate).
- **After repo2 recovery, does the backlog drain?** **Yes** — `.ready` 13 → 0,
  `archivedCount` 4 → 29, `pgbackrest check` exit 0, **zero acknowledged
  commits lost**.

### A/B against the prior build, with pgBackRest as the only variable

The original 2.59.0 Gate 0 ran on PostgreSQL **16.15**, so it was not a clean
comparison. A control arm was re-run with the pin at **2.59.0** and the same
`postgres:16.14-bookworm` image, same docker engine, same config, same
injection — leaving the pgBackRest build as the only difference.

| Property | 2.50 (production's build) | 2.59.0 (control) | Same? |
|---|---|---|---|
| `archivePushFailureMode` | `FAILS_COMMAND` | `FAILS_COMMAND` | **yes** |
| `archivedCount` advanced during outage | `false` (4 → 4) | `false` (12 → 12) | **yes** |
| `failedCount` rose | yes (1 → 36) | yes (0 → 3) | **yes** (magnitude differs — retry cadence, not semantics) |
| `.ready` backlog appeared | **12** | **12** | **yes** |
| `pg_wal` grew | 83.9 → 285.2 MB | 117.4 → 318.8 MB | **yes** |
| PostgreSQL kept accepting writes | `running` | `running` | **yes** |
| backlog fully drained on recovery | `true` | `true` | **yes** |
| acknowledged commits lost | **0** | **0** | **yes** |
| `backup --repo=2` **from the PostgreSQL host** | **REFUSED — `ERROR [072]`** | **succeeded** | **NO** |
| reverse SSH trust required | **true** | `false` | **NO** |
| run outcome | `PASS_ARCHIVE_SEMANTICS_ONLY` | `PASS` | — |

Every semantic property of the archive-push question matches. The two rows that
differ are both about **where the base backup may be initiated**, not about
what `archive-push` does with a segment.

**`VERSION_PARITY_OBSERVED_LOCAL_ONLY`.** This is still not production
verification. A pinned local build reproduces the binary, not production's
filesystem, WAL rate, network, or load.

### The difference that does transfer: `ERROR [072]` at bring-up

On **2.50**, `backup --repo=2` invoked on the **PostgreSQL** host with
`repo2-host` configured is refused outright:

```
ERROR: [072]: backup command must be run on the repository host
```

The identical topology and command succeed on 2.59.0. This matters because
`noramedi-pgbackrest-backup.sh --repo 2` — runbook §22.11 CHECKPOINT 7 — runs
on the primary. Initiating the backup on the repository host instead requires
SSH trust in the **repo-host → production** direction, which §16.5 explicitly
forbids and which §22.9's one-way trust deliberately does not create.

So on production's current build, **CHECKPOINT 7 as published cannot succeed.**
`stanza-create` and `check` are unaffected and pass on 2.50. Runbook §22.11 now
carries this blocker, and §22.4a states the two options (upgrade pgBackRest
first, or revisit the trust model — the second being a security decision, not a
runbook edit). Neither is authorized here.

Because the repo2 base backup was unobtainable on 2.50, the 2.50 run was taken
with the new, opt-in `--allow-missing-repo2-backup`. That flag is off by
default, caps the outcome at `PASS_ARCHIVE_SEMANTICS_ONLY`, records the blocker
verbatim in the summary, and emits an extra explicit non-claim. The
archive-push question does not depend on a base backup — it depends on the
stanza, which the unchanged hard gate proved with `check` on both repositories
before any injection — but **repo2 restorability on 2.50 is untested and is
claimed nowhere.**

### One harness defect found and fixed on the way

The first 2.50 run classified `INDETERMINATE` on a healthy experiment:
102,500 rows committed and **zero** archive attempts across the whole outage.
`archive-push` runs once per **completed** segment; `repeat(md5(...),256)` is
almost perfectly compressible, so ~800 MB of inserts became a few MB of WAL,
and `archive_timeout=300` is longer than smoke mode's 180-second window. The
harness now forces a WAL switch every 15 s — the same mechanism
`archive_timeout` already uses in production, run faster. It changes **when**
segments are produced, not what `archive-push` does with one.

## R1.3 WAL backlog monitoring

Gate 0's own conclusion was that a repo2 outage arrives as **disk growth**, and
nothing in this repository measured that. `failedCount` rises but cannot
express how much WAL is now un-archived; `lastArchivedAgeMinutes` measures
**time**, not volume, and under write load the filesystem can fill long before
120 minutes elapse; the `disk` check measures `/` as a percentage and names the
wrong subsystem when it finally trips at 90%.

### Signals

Two optional fields on `archive`, **same `schemaVersion` 1**:

| Field | Source | Meaning |
|---|---|---|
| `archive.walBytes` | `SELECT coalesce(sum(size),0) FROM pg_ls_waldir()` | total bytes in `pg_wal` |
| `archive.readyCount` | `SELECT count(*) FROM pg_ls_dir('pg_wal/archive_status') WHERE f LIKE '%.ready'` | segments waiting to be archived |

Both resolve **relative to the data directory PostgreSQL is actually running
on**. No PGDATA is hardcoded, none is derived from a version-specific path, and
none is guessed from the filesystem — a cluster moved to a different data
directory keeps measuring the right one. They are the same two quantities the
Gate 0 sampler records, so production and experiment are directly comparable.

**Neither reads WAL content.** `pg_ls_waldir()` returns segment names and
sizes; `pg_ls_dir` returns marker filenames. No segment is opened, so no tuple,
no patient row and no secret is observable through this path. Only two
aggregates leave the query.

**Unmeasurable means ABSENT, never 0.** A 0 would read as "no backlog" during
exactly the outage these fields exist to detect. Asserted in both suites.

### Thresholds

| Variable | Default | Behaviour |
|---|---|---|
| `NORAMEDI_OPSCHECK_PITR_MAX_WAL_READY_COUNT` | `0` | 0 = not evaluated |
| `NORAMEDI_OPSCHECK_PITR_MAX_WAL_BYTES` | `0` | 0 = not evaluated |
| `NORAMEDI_OPSCHECK_PITR_REQUIRE_WAL_BACKLOG` | `false` | activation gate |

No production limit is invented silently. The repository contains no measured
production WAL rate and no `df` for the PGDATA filesystem, so both default to
**off** and the activation gate is what makes them mandatory.

**`.ready` — suggested 32, derived in runbook §22.4a.** 32 segments ≈ 512 MiB
at the 16 MiB default; at production's `archive_timeout=5min` an idle cluster
needs ~2.7 h of total outage to reach it (after the existing 120-minute age
assertion has fired), while under write load it is reached in minutes — which
is the case the age assertion misses. Gate 0 measured `.ready` 1 → 12 in 180 s
at an accelerated synthetic rate: the signal is monotonic and fast, not spiky.

**`pg_wal` bytes — no default, deliberately.** The safe value is a function of
free space on the PGDATA filesystem. Root at ≈13% used is a percentage, not a
denominator, and `df -B1 <PGDATA>` was not captured at preflight. §22.4a
requires the operator to measure it and set ≤ 25% of available bytes.

### Alerting and failure behaviour

Reuses the existing opscheck / dead-man chain: both assertions ride the
existing `pitr` check and its **bit 7 (128)**. No new exit bit, no new
provider-side check, no new subsystem. **No Prometheus, no OTel** — F6 remains
future work.

- Limit configured, measurement **missing or unreadable** → **FAIL**. Enabling
  a check and then being unable to take its measurement must not read green.
- `REQUIRE_WAL_BACKLOG=true` with either limit still `0` → opscheck **refuses
  to start**, exit **64**, at startup rather than at check time. Activating
  repo2 with a monitor that cannot see WAL backlog is a configuration error,
  and a refusal to start cannot be mistaken for a transient alert.
- `REQUIRE_WAL_BACKLOG` is validated as a strict `true`/`false` enum, so a
  typo (`TRUE`, `1`, `yes`) cannot silently disable the gate.
- The OK line reports the backlog figure so an operator can watch it trend.

### Backward compatibility

| Writer | Monitor | Result |
|---|---|---|
| pre-R1 | pre-R1 | unchanged |
| pre-R1 | R1, limits unset (default) | **unchanged** |
| pre-R1 | R1, limit set | FAILS — measurement missing, fails closed |
| R1 | pre-R1 | unchanged; extra fields ignored |
| R1 | R1 | new assertions apply |

Production today runs a single repo1 with no limits set, so this change is a
no-op there until an operator sets one. All three rows that must be unchanged
are asserted in the suites, not merely argued here.

## R1.4 Tests

| Command | Exit | Passed | Failed | Skipped |
|---|---|---|---|---|
| `npm run test:shell` | 0 | **457** (178 + 229 + 50) | 0 | 1 |
| `npm run test:shell:opscheck` | 0 | 178 (was 150) | 0 | 0 |
| `npm run test:shell:pgbackrest` | 0 | 229 (was 216) | 0 | 1 |
| `npm run test:shell:pitr-app-smoke` | 0 | 50 | 0 | 0 |
| `npm run test:pitr-status-contract` (server) | 0 | **27** (was 16) | 0 | 0 |
| `npm run test:pitr-status-file` (server) | 0 | 39 | 0 | 0 |
| `npm run test:platform-recovery-safety` (server) | 0 | 60 | 0 | 0 |
| `npm run test:ci-classify` | 0 | 23 | 0 | 0 |
| `npx tsc --noEmit` (server) | 0 | 0 `error TS` | 0 | 0 |
| `git diff --check` | 0 | clean | 0 | 0 |

The single skip is Windows-only (`/proc/meminfo` absent). CI on `ubuntu-latest`
runs it, which is why the CI figures are two higher and carry no skip:

| Suite | Local (Windows) | CI (`ubuntu-latest`, run `31959099545`) |
|---|---|---|
| opscheck | 178 / 0 | 178 / 0 |
| pgBackRest | 229 / 0 / 1 skipped | **231 / 0** |
| PITR app smoke | 50 / 0 | 50 / 0 |
| **`npm run test:shell`** | **457 / 0 / 1** | **459 / 0 / 0** |

**Superseded by R2 (§R2 below).** R2 added ten assertions to the pgBackRest
suite, so the figures above are the R1 record and are correct history:

| Suite | Local (Windows) | CI (`ubuntu-latest`, run `31966176391`) |
|---|---|---|
| opscheck | 178 / 0 | 178 / 0 |
| pgBackRest | **239** / 0 / 1 skipped | **241 / 0** |
| PITR app smoke | 50 / 0 | 50 / 0 |
| **`npm run test:shell`** | **467 / 0 / 1** | **469 / 0 / 0** |

The "CI is two higher and carries no skip" relationship is unchanged — the skip
is still the same Windows-only `/proc/meminfo` positive control.

**CI on `4308579`: all 13 required checks green** — but only after one rerun,
and the reason is recorded here rather than waved away. Layer 3 failed once on:

```
FAIL CHARACTERIZATION: a numeric valid OTP is accepted via String() coercion
  Expected values to be strictly equal:  401 !== 200
```

That is the known leading-zero flake in `platformAdminLoginTotpGate.test.ts`:
the fixture occasionally generates a TOTP beginning with `0`, which loses its
leading digit through the numeric round-trip and arrives as a five-digit code.
**It was proven to be a flake rather than asserted to be one** — `gh run rerun
--failed` re-ran only that job against a byte-identical tree and it passed. The
R2 diff also contains no TypeScript and no `server/` source change, so it cannot
reach that test. The flake itself remains **unfixed and untracked by R2**; it is
not in this task's scope.

CI on `02ef208`: **all 13 required checks green**, including the Layer 1 job
that was red on `826aec1`. The two lines that matter, from that job's log:

```
ok - no 'rm -rf ... 2>/dev/null || true' anywhere — and the guard fails on a mutant that reintroduces it
ok - guard_no_silent_rm detects the defect even when the haystack is far larger than one pipe buffer
```

## R1.5 What R1 does NOT do

- Does **not** activate repo2, and does not create one.
- Does **not** claim production Gate 0, production RPO/RTO, or `offHost=yes`.
- Does **not** close `R-030`, `R-030-DB`, `R-030-FILES` or `R-080`.
- Does **not** satisfy `FIRST_CUSTOMER_RECOVERY_GATE`.
- Does **not** touch production configuration, and does not upgrade production
  pgBackRest — the `ERROR [072]` finding is *reported*, not resolved.
- Does **not** prove repo2 restorability on 2.50: no repo2 base backup exists
  on that build in this harness.
- Does **not** measure time to `pg_wal` exhaustion. Smoke mode does not run to
  a full disk; that remains an open risk.
- No schema change. No migration.

## 7. What remains, and who can do it

| Prerequisite | State |
|---|---|
| Repository implementation | **READY** |
| Gate 0 failure semantics | **READY** — `PASS`, `OBSERVED_LOCAL_ONLY` |
| Gate 0 monitoring sufficiency | **NOT READY** — needs `--mode full`; no `pg_wal` monitoring exists |
| Production pgBackRest version parity | **OPERATOR EVIDENCE REQUIRED** |
| Secondary Türkiye VPS | **NOT READY** — `NOT PROCURED` |
| E1–E5 residency pack | **OPERATOR EVIDENCE REQUIRED** |
| KVKK Art. 6 hosting DPA | **OPERATOR EVIDENCE REQUIRED** (`COUNSEL_REVIEW_REQUIRED`) |
| Subprocessor register §1 + §6 | **NOT READY** — must be corrected *before* repo2 exists |
| Failure-domain independence artifacts | **OPERATOR EVIDENCE REQUIRED** |
| Key escrow outside both hosts | **OPERATOR EVIDENCE REQUIRED** |
| repo2 activation / backup / drill | **NOT READY** — blocked on all of the above |

`R-030` `OPEN` · `R-030-DB` `OPEN` · `R-030-FILES` `OPEN` · `R-080` `OPEN` ·
`R-079` `CLOSED` · `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED` ·
F4 `TODO`.

---

# R2 — repo2 backup topology decision

`F4-FCR-003-R2` · reviewed head `6d0d9da` · same branch, same draft PR #433 ·
`OBSERVED_LOCAL_ONLY` · no production access, no production mutation, no
`repo2` created, no pgBackRest upgraded, no byte moved off-host.

```
SELECTED TOPOLOGY = C
```

An off-host `repo2` with **no repository host**, written by the production
primary.

## R2.1 The blocker was `repo2-host`, not `--repo=2`

`ERROR [072]` is `HostInvalidError`. It is raised by `repoIsLocalVerify()` in
`src/protocol/helper.c`, called as the first statement of `cmdBackup()`, and
the whole test is:

```c
FUNCTION_LOG_RETURN(BOOL, !cfgOptionIdxTest(cfgOptRepoHost, repoIdx));
```

It fires **only when `repoN-host` is set**. `backup` and `expire` were the only
two commands that ever carried it; `info`, `verify` and `restore` never did.

So the blocker was never "2.50 cannot back up to repo2" and never "backup
cannot run on the primary". It was **"2.50 cannot back up to a repo2 that has a
repository host"** — and the runbook only had a repository host because §16
chose the SSH shape on *procurement evidence*, not on technical need.

## R2.2 What was actually run

`scripts/noramedi-gate0-repo2-topology.sh`, run `20260816T174036Z-89155`.
Disposable Docker, PostgreSQL 16.14, pgBackRest pinned to **2.50** through
`apt-archive.postgresql.org` and re-verified against the running binary.
Synthetic data only. **Every command invoked on the PostgreSQL host.**

| Shape | Role | `backup --repo=2` | `info` | `verify` | `restore` |
|---|---|---|---|---|---|
| `repo2-host` | **negative control** | **REFUSED, exit 72** | — | — | — |
| `repo2-type=s3` | candidate | **0** | 0 | 0 | **0** |
| `repo2-type=sftp` | candidate | **0** | 0 | 0 | **0** |

The negative control is what makes this non-vacuous. Without it the harness
could only ever confirm, and a harness that cannot fail proves nothing — the
lesson of R1-F1, where a guard reported CLEAN on precisely the input containing
the defect. It also closes R1's open item: **repo2 restorability on 2.50 is no
longer untested**, for no-repo-host shapes.

## R2.3 Confidentiality, measured rather than asserted

3 000 rows carrying a synthetic PHI marker were written, checkpointed and
backed up.

| Location | Marker occurrences |
|---|---|
| live database | 3 000 rows |
| **PGDATA on disk** | **6 000** — PHI is *not* encrypted at rest on the primary |
| **all stored repo2 objects** | **0** raw, **0** after decompressing every object |

Repository objects carry the OpenSSL `Salted__` envelope. With the passphrase
supplied via `PGBACKREST_REPO2_CIPHER_PASS` but wrong, `info --repo=2` fails
with `[FormatError] unable to load info file`; with the correct passphrase from
the config it reports `status: ok`, `cipher: aes-256-cbc`. **The storage
operator holds ciphertext only.**

What is **not** encrypted is object and file **names**. Without
`repo2-bundle=y` the repository leaks PostgreSQL relation paths and
per-relation sizes, plus stanza name, backup labels and schedule. That is why
`repo2-bundle=y` is published in both config shapes.

## R2.4 Why not A, and why not B

**A — repository-host-driven. REJECTED.** It is the only option that gives a
PHI database host a new **inbound** trust relationship, and it does so *on top
of* the outbound path it cannot remove: `archive_command` runs on the primary
by definition, so production→repo-host SSH is still required for WAL. A
therefore makes trust **mutual**, not reversed. It contradicts two published,
armed gates — §16.5 ("the backup host must not be able to reach production")
and §22.9's `UNREACHABLE_GOOD` — which would have to be deleted, not adjusted.
It moves the backup off `noramedi-pgbackrest-backup.sh`, so the fail-closed
encryption gate stops being enforced by code. And R1's harness already retried
the backup from the repository host on 2.50: that retry **also failed**
(`ERROR_072_THEN_REPO_HOST_BACKUP_ALSO_FAILED`).

**B — upgrade first. REJECTED as unnecessary, not as unsound.** The capability
is real and the minimum version exact: the check was deleted in **2.55.0**
(2025-04-21, PR 2512), present through 2.54.2 and absent from 2.55.0 onward.
The upgrade is also low-risk in itself — `REPOSITORY_FORMAT` is `5` at every
tag from 2.50 to 2.59.0, so repo1 stays readable with no re-init. But B buys
**primary-driven backup against a repository host**, and R2 shows the primary
already drives repo2 on 2.50 whenever repo2 has none. B would pay a package
upgrade on a live PHI database host — plus 2.59.0's restriction that only
`restore` may run as root by default, which would break the existing
root-invoked cron wrapper — for a capability already in hand.

Upgrading remains legitimate later. It is simply not a prerequisite for
`R-030-DB`, and should not be sequenced in front of it.

## R2.5 Transport is a procurement variable

The decision fixes the **topology** — where `backup` runs and which way trust
flows. Both proven shapes satisfy it.

| | `repo2-type=sftp` | `repo2-type=s3` |
|---|---|---|
| Status | **PROCUREMENT-READY** | **PROMOTE ON CLEARANCE** |
| Secondary runs | `sshd` only, **no pgBackRest** | nothing of ours |
| Version parity burden | none | none |
| Residency evidence | E1–E5 on a plain TR VPS, which §16 records as market-available | hardest — a new vendor class, and **no Türkiye-resident S3-compatible provider is evidenced as procurable** anywhere here |
| Immutability | no native object-lock | yes |
| Known cost | libssh2 may offer only SHA-1 `ssh-rsa`, so the endpoint's sshd may need `PubkeyAcceptedAlgorithms +ssh-rsa` and the keypair must be PEM | two bucket lifecycle rules are effectively mandatory (abort incomplete multipart uploads; expire noncurrent versions) |

The `ssh-rsa` cost applies to the **secondary's** authentication posture, never
to production, and it is build-dependent — production's own libssh2 may already
negotiate `rsa-sha2`. **Verify at CHECKPOINT 5 rather than assuming either
way**, and prefer S3 if a Türkiye provider clears.

⚠ **Do not enforce immutability by revoking the credential's delete right.**
`backup` runs `expire` automatically and `expire-auto` is **global**, not
per-repository, so a WORM or object-locked repo2 fails the `backup` command
itself, at the expire stage, after the data has already been written.

## R2.6 What R2 does NOT do

- Does **not** close `R-030`, `R-030-DB` or `R-030-FILES`.
- Does **not** satisfy `FIRST_CUSTOMER_RECOVERY_GATE`.
- Does **not** authorize §16.5, §22, or any production configuration change.
- Does **not** procure, provision, or select a vendor.
- Does **not** upgrade production pgBackRest, and does not recommend doing so
  before `R-030-DB`.
- Does **not** prove failure-domain independence. Containers on one docker
  network are no model of an independent Türkiye host.
- Does **not** establish Türkiye residency for anything. A hostname is not
  residency evidence and neither is a bucket name.
- Does **not** measure production RPO or RTO.

What it removes is the **last unresolved technical topology question**.

`R-030` `OPEN` · `R-030-DB` `OPEN` · `R-030-FILES` `OPEN` · `R-080` `OPEN` ·
`R-079` `CLOSED` · `FIRST_CUSTOMER_RECOVERY_GATE = NOT_SATISFIED` ·
F4 `TODO` · `F4_TRANSITION_AUTHORIZED = NO` · `MIGRATION_REQUIRED = NO`.
