# F3-3 — PostgreSQL FORCE RLS and PgBouncer Transaction-Mode PoC

| Alan | Değer |
|---|---|
| Task ID | `F3-3` |
| ClickUp | `869ed1qv5` |
| Epic | EPIC F3 — Tenant Data Protection, Prisma Guard ve RLS PoC |
| Branch | `feature/f3-3-rls-pgbouncer-poc` |
| Base | `feature/f3-2-tenant-context-prisma-guard` @ `068a04a` (PR #476, draft) |
| Environment | Disposable Docker containers, created and destroyed per run |
| Schema changed | **NO** |
| Prisma migration created | **NO** |
| Production RLS / role / PgBouncer change | **NONE** |
| Result | **51 experiments · 51 passed · 0 failed · 0 blocked** |

---

## 1. What this is, and what it is emphatically not

This is the **execution** of the proof-of-concept that
[`tenant-rls-pgbouncer-poc-design.md`](../../architecture/tenant-rls-pgbouncer-poc-design.md)
(F0-009) designed and explicitly declined to run.

It is **not** a rollout. It is not evidence that RLS may be enabled in
production. `ADR-004` and `ADR-005` remain `NEEDS_POC` — moving them is a human
decision that this document exists to inform, not to pre-empt.

Everything ran in throwaway containers on a throwaway Docker network, named with
a per-run random suffix and destroyed in a `finally` block. The harness reads no
`DATABASE_URL`; every connection string it uses is built from a container it
started itself. No Prisma migration was created; the RLS objects are plain SQL
files under `docs/architecture/poc/f3-3-rls-pgbouncer/sql/`, deliberately outside
`server/prisma/migrations/` so that nothing can apply them by accident.

### 1.1 Authority to run it

[`tenant-rls-pgbouncer-poc-design.md`](../../architecture/tenant-rls-pgbouncer-poc-design.md)
§12 classifies the two things this task does:

| Action | F0-009 §12 classification |
|---|---|
| Rollout Stage 7 — disposable RLS PoC execution | *"Allowed now: isolated disposable PoC only — **not** authorized to actually run by this document; a future task must explicitly schedule and execute it"* |
| Rollout Stage 9 — PgBouncer PoC | *"Allowed now: isolated disposable PoC only, same caveat"* |

F3-3 is that future task. The conditions attached to "allowed now" are met and
checkable: disposable environment, no production contact, no repository
migration, deterministic rollback (§8), and no database-role or PgBouncer change
outside the containers.

The same §12 lists Stages 1-6, 8, 10 and 11 as **blocked**. None of them is
performed here. In particular this task does **not** enable RLS on any staging
or production database, does not alter any production role, and does not deploy
PgBouncer anywhere.

---

## 2. Environment

| Component | Value |
|---|---|
| PostgreSQL | `postgres@sha256:57c72fd2…07777` (16-alpine) — **the same digest** `scripts/test-runtime/lib/postgres.ts` pins, so the PoC and CI Layer 3 are not measuring different builds |
| PgBouncer | `edoburu/pgbouncer@sha256:4c1ca296…dc1cd` — **PgBouncer 1.25.2**, libevent 2.1.12, OpenSSL 3.5.6 |
| Docker | Server 29.6.2 |
| Node | v24.18.0, win32 x64 |
| Prisma | 7.9.1 with `@prisma/adapter-pg` — the application's own client, not a substitute |
| Schema | The **real** `server/prisma/schema.prisma`, applied with `prisma migrate deploy` as the migrator role |

Using the real schema rather than F0-009 §7.1's proposed minimal one is a
deliberate deviation: it means the policies are measured against the actual
column types (`text`, not `uuid` — see §5.3) and the **actual indexes**, which
is where §7.6's open question about index behaviour is answered.

---

## 3. Roles — the separation that makes the results mean anything

| Role | Owner of tables? | `BYPASSRLS`? | Superuser? | How it reaches data |
|---|---|---|---|---|
| `noramedi_migrator` | **yes**, all four | **yes** | no (bootstrap role) | Bypasses RLS entirely. Used only for `prisma migrate deploy` and fixture seeding. |
| `noramedi_app` | **no** | **no** | **no** | Policies only. Every denial experiment runs as this role. |
| `noramedi_platform` | **no** | **no** | **no** | An explicit permissive policy `TO noramedi_platform` on exactly the four tables. |

Asserted, not assumed, by experiments **S1** and **S2** — because a runtime role
that turned out to be a superuser or a table owner would make every "denied"
result meaningless.

**Break-glass is a grant, not an override.** F0-009 §7.2 and this task's §32
brief both say the platform path must not be solved with `BYPASSRLS`, and it is
not: `noramedi_platform` sees every tenant's rows on the four tables it has a
policy for (**W1**) and sees *nothing* on a FORCE'd table it has no policy for
(**W2**). Adding a table does not silently widen break-glass access.

---

## 4. `ENABLE` vs `FORCE` — proved, not cited

`ALTER TABLE … ENABLE ROW LEVEL SECURITY` does not apply to the table's **owner**.
That is documented, and it is also the easiest way for an RLS rollout to be
quietly worthless: if the runtime role ever ends up owning a table — an
`ALTER TABLE … OWNER TO`, a restore performed as the wrong role, a table created
by the application instead of the migrator — every policy on it stops applying
to exactly the connection it was written for, and **nothing errors**.

On the four real tables the owner is the migrator, so the distinction is
invisible. A dedicated table owned by `noramedi_app` makes it visible:

| Experiment | Setup | Result |
|---|---|---|
| **F1** | `ENABLE` only, policy `USING (false)`, queried by the owner | owner sees **2 of 2** rows — the policy is never consulted |
| **F2** | `+ FORCE`, nothing else changed | owner sees **0 of 2** rows |
| **F3** | `NO FORCE` again | owner sees **2 of 2** rows again |

The bypass appears and disappears with the flag alone. **`FORCE` is required**,
and a rollout that applies `ENABLE` without it is relying on table ownership as
a security control.

---

## 5. Fail-closed behaviour

### 5.1 Missing context

| Experiment | Claim | Result |
|---|---|---|
| **M1** | A query with **no** tenant context returns zero rows on all four tables | `Patient` 0 · `PaymentPlan` 0 · `PaymentPlanInstallment` 0 · `Clinic` 0 |
| **M2** | An `INSERT` with no context is refused by `WITH CHECK` | refused, SQLSTATE `42501` |
| **M3** | An **empty-string** context is treated as missing, not as a wildcard | 0 rows |
| **M5** | A role with **no policy at all** on a FORCE'd table | 0 rows — RLS denies by default, so a *forgotten* policy hides data rather than exposing it |

The mechanism is one line of SQL and it is worth stating exactly:

```sql
SELECT nullif(current_setting('app.organization_id', true), '')
```

`missing_ok = true` returns NULL instead of raising; `column = NULL` is NULL;
NULL excludes the row. There is deliberately **no**
`OR current_setting(…) IS NULL` anywhere — that single clause is what turns a
missing context into total access, and **S4** asserts against `pg_policies` (not
against our own source file) that no policy contains one, and that every policy
carries both `USING` and `WITH CHECK`.

### 5.2 `WITH CHECK` is not optional

A policy with only `USING` constrains what you can *see*, not what you can
*write*: an insert of another tenant's row would succeed and merely become
invisible afterwards. All four policies mirror `USING` in `WITH CHECK`, and
**X4/X5/X6** are the writes that prove it.

### 5.3 Malformed context — an honest caveat

**M4** passes: a garbage context value returns zero rows. But the *reason*
matters and is not the reassuring one.

NoraMedi's ids are Prisma `String`, i.e. PostgreSQL **`text`**, not `uuid`. So a
malformed value cannot raise a cast error — it simply matches nothing. That is
still fail-closed, but it fails **quietly**. With a `uuid` column, the same input
would raise `invalid input syntax for type uuid` and be loud.

Recorded as a finding rather than smoothed over: if a future rollout wants
malformed context to be an alarm rather than an empty result, that is an
argument for typed tenant columns, and it is a schema decision with a much wider
blast radius than RLS.

---

## 6. Isolation results

Every row below is an executed experiment. Full log:
`docs/architecture/poc/f3-3-rls-pgbouncer/` → `npm run poc:f3-3-rls`.

### The correct tenant

| # | Claim | Result |
|---|---|---|
| T1 | Tenant A sees its own patients and nothing else | PASS |
| T2 | A clinic-1-restricted context does **not** see clinic 2 **of its own organization** | PASS |
| T3 | The organization-scoped table returns only the caller's organization | PASS |
| T4 | A parent-scoped child is visible only through a parent the caller can read | PASS |
| T5 | Legitimate same-tenant insert + update + delete all succeed | PASS |

T5 is the false-denial bar. F0-009 §10.2 treats it as strictly as the security
bar, "since a guard that fails closed *too* aggressively breaks the product".

### The wrong tenant

| # | Claim | Result |
|---|---|---|
| X1 | Cannot **read** another tenant's row by primary key | 0 rows |
| X2 | Cannot **update** it | 0 rows affected; verified unchanged via the BYPASSRLS role |
| X3 | Cannot **delete** it | 0 rows affected; row still present |
| X4 | Cannot **insert** carrying another tenant's clinic | refused `42501` |
| X5 | **The pairing attack** — A's `organizationId` with B's `clinicId` | refused `42501` |
| X6 | Cannot **move** its own row into another tenant | refused `42501` |
| X7 | An **unqualified** `UPDATE "Patient" SET …` affects 2 rows, not 4 | PASS |
| X8 | An unqualified bulk `DELETE` deletes only the caller's | PASS |
| X9 | Cannot read another tenant's clinic, payment plan or installment | all 0 |

X7 is the one to read twice. An `UPDATE` with **no `WHERE` clause at all** — the
exact shape a forgotten predicate produces — touched only the caller's rows. At
the database layer the policy *is* the `WHERE` clause.

---

## 7. Where RLS is NOT enough — reproduced deliberately

F0-009 §7.3 predicted that PostgreSQL's foreign-key constraint checks run with
elevated privilege regardless of RLS, so a cross-tenant FK-target insert would
**not** be caught. The PoC reproduces it:

| # | Result |
|---|---|
| **FK1** | Tenant A cannot see tenant B's patient — 0 rows. |
| **FK2** | Tenant A nevertheless **successfully created** a `PaymentPlan` in its own clinic whose `patientId` points at tenant B's patient. **The row was written.** |
| **FK3** | An FK to a genuinely non-existent row still fails with `23503`. The gap is *visibility*, not referential integrity. |

`PaymentPlan`'s policy constrains `clinicId`. It says nothing about
`patientId` — so a row with the caller's own clinic and another tenant's patient
satisfies `WITH CHECK`, and the FK check resolves a parent the caller cannot
read.

**This is the single most important result in this document.** It is direct,
executed evidence for ADR-002's "RLS is additive to, not a replacement for,
application-level scoping":

- RLS **allows** this write.
- The F3-2 Prisma guard **refuses** it — `assertUniqueTargetOwned` fetches the
  target's ownership columns and compares them, which is exactly the check RLS
  structurally cannot perform. Proved in `tenantGuardIsolation.test.ts` §E
  ("a nested connect to another tenant's row is refused and writes nothing").

Neither layer is sufficient alone. That is the finding.

---

## 8. Transaction-local context — the PgBouncer prerequisite

| # | Claim | Result |
|---|---|---|
| TX1 | The context is visible for the whole interactive transaction, across statements and an intervening sleep | PASS |
| TX2 | After **COMMIT** the setting is gone; the next statement on the same pooled connection sees 0 rows | PASS |
| TX3 | After **ROLLBACK** the setting is gone | PASS |
| TX4 | **Negative control:** a *session*-scoped `set_config(…, false)` **does** survive its transaction | PASS |
| TX5 | Re-setting identity mid-transaction re-evaluates the policy and grants nothing new | PASS |

TX4 is what makes TX2 and TX3 mean something. Without it, "the setting was gone
afterwards" could have been caused by anything — a pool reset, a new connection,
luck. With it, the difference is attributable to `is_local => true` and nothing
else.

**P1** — 40 interleaved transactions alternating between two tenants over a
**3-connection** pool: zero leaks.

---

## 9. PgBouncer, transaction pooling

**Not blocked.** PgBouncer 1.25.2 ran in `pool_mode = transaction` and every
experiment passed.

| # | Question (F0-009 §8.2) | Result |
|---|---|---|
| PB1 | Does Prisma + `@prisma/adapter-pg` work through transaction pooling **at all**? | **Yes** — simple queries, raw SQL and interactive transactions |
| PB2 | Does transaction-local tenant context survive the pooler? | **Yes** — own rows visible, foreign rows not |
| PB3 | A query with **no** context on a pooled connection | **0 rows** — fail-closed is identical under pooling |
| PB4 | Is an interactive `$transaction` pinned to **one** backend? | **Yes** — same `pg_backend_pid()` throughout. If it were not, the whole design collapses |
| PB5 | Are backends **genuinely reused**? | **Yes** — 12 statements shared fewer than 12 backends. Without this, PB6 would pass vacuously |
| PB6 | 60 interleaved tenants over a 3-backend pool | **0 leaks** |
| PB7 | Prepared statements with `max_prepared_statements = 0` | **Works** — `node-postgres` issues unnamed statements unless a `name` is given, so the conservative configuration an older PgBouncer would force is fine |
| PB8 | Writes through the pooler | own-tenant insert persisted; cross-tenant insert refused `42501` |
| PB10 | PgBouncer killed mid-flight | queries **error**; they do not hang, and they do not silently run unscoped |

`server_reset_query` was left **empty on purpose**. The usual `DISCARD ALL`
would have masked exactly the failure being hunted: if a transaction-local
setting somehow survived its transaction, a reset query would clean it up and
the leak test would report a false pass.

### 9.1 An operational consequence worth naming

`auth_type = scram-sha-256` requires a **plaintext** auth file. A SCRAM verifier
cannot be replayed onward, so a pooler that authenticates to PostgreSQL on the
client's behalf needs the original secret. Putting PgBouncer in front of
PostgreSQL therefore means a file containing real database passwords in
plaintext on the pooler host — a new secret-at-rest to own, rotate and back up.

In this PoC that file is generated per run with random values and deleted at
teardown. In production it would be a standing artefact, and that is a
deployment decision, not a technical detail. (The alternative, `auth_query`,
moves the secret into the database and brings its own review.)

The first attempt used `md5` and failed with `client_login_timeout (server
down)`. PostgreSQL 14+ stores SCRAM verifiers, so there was no md5 hash for
PgBouncer to authenticate against. Recorded because the error message points at
the network and the cause is the password algorithm.

---

## 10. Performance

Disposable PostgreSQL 16-alpine in Docker on Windows, 404 patient rows, 200
iterations + 20 warmup per figure. **Local measurement only — no production
latency claim is made, and none should be derived from this.**

### 10.1 The headline numbers, and why they are misleading

| Path | median | p95 | p99 |
|---|---|---|---|
| RLS **off**, hand-written predicate | 5.470 ms | 6.652 ms | 7.305 ms |
| RLS **on** | 8.372 ms | 13.253 ms | 16.247 ms |
| RLS on **+ PgBouncer** | 10.182 ms | 14.187 ms | 18.058 ms |

Reported naively that is **p50 +53 %**, far outside F0-009 §10.2's proposed
≤10 % threshold — and it would be the wrong conclusion.

### 10.2 Decomposed

The RLS path issues **two extra round trips per transaction** (`set_config`
twice) that the baseline does not. Adding a baseline that pays the same round
trips separates the two costs:

| Path | median |
|---|---|
| RLS off, no context calls | 5.470 ms |
| RLS off, **same two `set_config` round trips** | 7.961 ms |
| RLS on, two `set_config` round trips | 8.372 ms |
| RLS on, **context set in ONE statement** | **6.297 ms** |

| Component | Cost | As % of baseline |
|---|---|---|
| Two context round trips | **2.491 ms** | **45.5 %** |
| **Policy evaluation** | **0.411 ms** | **7.5 %** |

**The policy costs 7.5 %, inside F0-009's ≤10 % p50 proposal. The other 45 % is
network, and it is a client-side design choice, not a property of RLS.**
Batching both settings into a single statement recovers 2.075 ms — a 25 %
improvement over the naive implementation, obtained by asking the database once
instead of twice.

That distinction is the difference between "RLS is too expensive" and "our first
implementation was chatty", and a rollout plan that did not measure it would
have reached the wrong answer.

Caveat: a ~1.3 ms round trip on Docker-on-Windows loopback is slower than a
production unix socket or same-VPC hop, so the round-trip share is inflated here
relative to production — which makes the policy's 7.5 % share *conservative*,
not optimistic.

### 10.3 Query plans (F0-009 §7.6's open question, answered)

`EXPLAIN (ANALYZE, BUFFERS)` under RLS, one per policy family:

| Family | Plan | Verdict |
|---|---|---|
| Dual-key (`Patient`) | `Index Scan using "Patient_clinicId_primaryPractitionerId_idx"`, `Index Cond` on `clinicId`, `Filter` on `organizationId` | **Existing composite index used.** No new index shape needed. |
| Clinic-only (`PaymentPlan`) | `Index Scan using "PaymentPlan_clinicId_status_idx"` | Existing index used. |
| Organization-only (`Clinic`) | `Index Scan using "Clinic_organizationId_slug_key"` | Existing index used. |
| **Parent-scoped (`PaymentPlanInstallment`)** | **`Seq Scan`** with a hashed `SubPlan` over `PaymentPlan` | **The scaling caveat.** Fine at PoC row counts (0.046 ms) but it is a sequential scan of the child table. |

So F0-009 §7.6's question — "does an RLS predicate actually use the existing
`@@index([clinicId, …])` composite indexes?" — is answered **yes for the three
direct-column families**, which is 91 of the 114 models.

The parent-scoped family is the one that needs attention before any rollout
touches those 8 models at real row counts. Two options, neither pre-selected:
denormalize a tenant column onto the child (a schema change, and a second source
of truth), or add an index that makes the subplan cheap. This is a measurement a
rollout must repeat at production data volumes, not a conclusion.

One incidental confirmation from the plan: the child's `EXISTS` subplan shows
the `clinicId` predicate **twice** — once from the child's own policy and once
from `PaymentPlan`'s policy applying *inside* the subquery. The parent's RLS
does apply within the child's policy, which is the reassuring answer and worth
having as evidence rather than as an assumption.

### 10.4 Worker iteration

**W3** — a `reminders.ts`-shaped sweep across 3 tenants: median 24.5 ms per
sweep, **8.2 ms per tenant**. Switching tenant costs one extra round trip inside
a transaction the job already opens. F0-009 §7.6 asked whether this is fast
enough to avoid giving jobs an RLS-free role; on this evidence **it is**, and
"`system_context_required` means RLS off for that role" is not required.

---

## 11. Rollback

| # | Claim | Result |
|---|---|---|
| R1 | The rollback script removes every policy and both RLS flags | all 4 tables `relrowsecurity=false`, `relforcerowsecurity=false`, 0 policies |
| R2 | The previously-**denied** cross-tenant read now **succeeds** | PASS |
| R3 | Rollback dropped no column and no row | 404 patients, 4 clinics, tenant columns intact |

R2 is the one that makes R1 worth anything. Confirming the flags are off proves
the script ran; re-running the denial from X1 and watching it now *succeed*
proves the denial was caused by the policy and not by something incidental, and
that the withdrawal is complete.

Order matters and the script encodes it: **policies are dropped before RLS is
disabled**. The other order leaves orphaned policies attached to the table that
spring back to life the moment anyone re-enables RLS.

A production rollout would apply this table by table, verifying between steps —
never as one transaction across every table at once.

---

## 12. Against the F3-3 acceptance gates

| Gate | Result |
|---|---|
| FORCE RLS works under a non-owner runtime role | **PASS** (S1-S3, F1-F3) |
| Missing tenant context fails closed | **PASS** (M1-M3, M5, PB3) |
| Correct tenant sees own rows | **PASS** (T1-T5) |
| Wrong tenant sees zero / cannot mutate | **PASS** (X1-X9) |
| Transaction-local context resets | **PASS** (TX2, TX3, with TX4 as the control) |
| Prisma interactive transactions work | **PASS** (TX1, TX5, PB4) |
| Parallel tenants do not leak | **PASS** (P1: 40 over 3 conns · PB6: 60 over 3 backends) |
| Bulk and nested behaviour tested | **PASS** (X7, X8, T4, FK1-FK3) |
| Worker / system path addressed | **PASS** (W1-W3) |
| Role separation demonstrated | **PASS** (S1, S2, W1, W2) |
| Rollback demonstrated | **PASS** (R1-R3) |
| Latency measured | **PASS** (§10, decomposed) |
| PgBouncer transaction mode demonstrated **or** blocked with a repro plan | **DEMONSTRATED** (PB1-PB10) — not blocked |

Against F0-009 §10.1's absolute security bar: **zero** successful cross-tenant
reads, **zero** successful cross-tenant writes, **zero** context-leakage events,
**zero** false denials.

**With one qualification that must not be lost: FK2.** RLS permitted a
cross-tenant foreign-key reference. That is not a policy defect and not a
failure of this PoC — it is the documented limit of the mechanism, and it is
why the F3-2 application guard stays load-bearing.

---

## 13. What this does NOT establish

- **Not production readiness.** Nothing here ran against staging or production.
- **Not scale.** 404 rows. The parent-scoped sequential scan (§10.3) is the
  first thing that would change at real volume.
- **Not full coverage.** Four of 114 models, chosen one per ownership shape. The
  five `EXPLICIT_REVIEW_REQUIRED` models were deliberately **excluded**: their
  tenant columns are nullable by design, so writing a policy for them would be
  inventing an ownership decision the programme has not made. F0-009 §7.5 named
  this as the hard case and it remains open.
- **Not a connection-budget model.** F0-009 §8.5's sizing table is untested;
  this PoC used a 3-connection pool to force reuse, not a realistic budget.
- **Not a `utils/activity.ts` answer.** That second `PrismaClient`/`Pool` (F0-009
  §2.2) is still a separate connection surface a rollout must cover.
- **Not authorization.** `ADR-004` and `ADR-005` stay `NEEDS_POC`.

---

## 14. Recommendation

The mechanism works and the measured cost is acceptable. Specifically, for the
architecture reviewer:

1. **`FORCE` is mandatory**, not optional (§4). A rollout that applies `ENABLE`
   alone is relying on table ownership as a security control.
2. **Set both context values in ONE statement** (§10.2). It is a 25 %
   improvement over the obvious implementation and costs nothing.
3. **Keep the application guard.** FK2 is executed proof that RLS alone permits
   a cross-tenant FK reference (§7). The two layers close different holes.
4. **Break-glass via a role-scoped policy, never `BYPASSRLS`** (§3) — proven
   workable, and it keeps break-glass scoped to named tables.
5. **Measure the parent-scoped family at production volume before enabling it**
   (§10.3). Eight models, sequential scan, untested at scale.
6. **Decide the PgBouncer plaintext auth-file question** (§9.1) before, not
   during, a deployment.
7. **The five `EXPLICIT_REVIEW_REQUIRED` models still have no RLS answer**, and
   F3-2's decision (system-owned) means they would be reached by a role whose
   policy needs designing separately.

**None of this authorizes a rollout.** The next step is a human decision on
ADR-004/ADR-005, and — before any staging or production RLS — the KVKK
baseline-stable declaration that
[`KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md`](../KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md)
§5 condition 5 still leaves unsatisfied.

---

## 15. Rollback of this task

```text
revert the F3-3 commit / PR
```

No database rollback: the only database that ever existed was destroyed when the
run finished. No migration, no production change, no deployment step. Reverting
removes five SQL files, a PgBouncer config template, a README, two TypeScript
files under `server/src/tests/poc/`, one `package.json` script, and this
document.
