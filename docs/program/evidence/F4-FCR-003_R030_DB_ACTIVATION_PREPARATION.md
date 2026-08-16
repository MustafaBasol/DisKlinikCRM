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
