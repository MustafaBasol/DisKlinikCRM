# F0-009 — PoC Experiment Matrix

Companion to [`tenant-rls-pgbouncer-poc-design.md`](tenant-rls-pgbouncer-poc-design.md). Documentation-only. None of these experiments are authorized to run by this document — they are the exact specification a future, separately-scheduled PoC task must execute in a disposable environment (never production, never the shared development database, never existing project migrations).

Each experiment below follows: **Setup → Action → Expected result → Failure interpretation → Security significance → Acceptance threshold → Rollback/cleanup.**

---

### Experiment 1 — Tenant-context propagation across concurrent requests

- **Setup:** Disposable environment per design-doc §7.1. TenantContext library (design-doc §4) implemented in the PoC harness only. At least 3 simulated tenants, each with an authenticated "request" driven by the harness.
- **Action:** Fire N concurrent simulated requests (mixed across the 3 tenants) that each read and write through the guard, using `mapWithConcurrency`-style concurrency mirroring `jobs/reminders.ts:573`.
- **Expected result:** Every request's Prisma calls observe only its own tenant's `AsyncLocalStorage`-propagated context, regardless of interleaving.
- **Failure interpretation:** Any observed cross-tenant context value under concurrency indicates the context-construction/propagation design (design-doc §4.3) has a shared-mutable-state bug — most likely a `AsyncLocalStorage.run()` call scoped too broadly (e.g. once per batch instead of once per iteration).
- **Security significance:** Highest — this is the base guarantee every other experiment assumes holds.
- **Acceptance threshold:** Zero cross-tenant context observations across ≥ 10,000 concurrent simulated request-pairs.
- **Rollback/cleanup:** Destroy the disposable environment; no persistent state.

### Experiment 2 — Context-absence fail-closed test

- **Setup:** Same environment. Guard wired in enforce mode (design-doc §11 Stage 4-equivalent, but inside the PoC only).
- **Action:** Issue a Prisma call for a `clinic_scoped_direct` model with no `TenantContext` present at all (simulating a code path that forgot to go through auth middleware).
- **Expected result:** The call is rejected (403/500-equivalent) before reaching the database, or — if it reaches the database — is denied by RLS if RLS is also enabled in that experiment run.
- **Failure interpretation:** If the call succeeds and returns data, the guard's default-deny requirement (design-doc §4.2, §5.4) is violated — this is a design-breaking finding, not a tuning issue.
- **Security significance:** Highest — this is the single behavior the whole "fail closed" requirement rests on.
- **Acceptance threshold:** 100% rejection rate across every model classification family in the PoC's minimal schema (design-doc §7.1).
- **Rollback/cleanup:** Destroy environment.

### Experiment 3 — Context-leakage test (Node-level and DB-session-level)

- **Setup:** Same environment, run twice — once with RLS disabled (isolates Node-level `AsyncLocalStorage` leakage) and once with RLS enabled against a PgBouncer transaction-pooled endpoint (isolates DB-session-level leakage per design-doc §7.3/§8.2 Experiment 6).
- **Action:** Two simulated tenants issue interleaved, high-frequency requests against a shared pool under load, specifically targeting pool exhaustion/connection-reuse pressure.
- **Expected result:** Neither tenant ever observes the other's data or the other's `SET LOCAL` session variable.
- **Failure interpretation:** A Node-level leak points to the `AsyncLocalStorage` wiring; a DB-session-level leak (only visible in the RLS+PgBouncer run) points to a `SET LOCAL` reset gap between pooled transactions — these are different bugs in different layers and must not be conflated in the PoC report.
- **Security significance:** Highest.
- **Acceptance threshold:** Zero leakage events in both runs, at simulated peak concurrency (≥ 2x the PoC's normal load-test concurrency, to specifically stress pool reuse).
- **Rollback/cleanup:** Destroy environment; if PgBouncer is used, confirm its process is also torn down (not left running).

### Experiment 4 — Cross-org read denial

- **Setup:** Same environment. At least 2 organizations, each with ≥ 1 clinic and rows in every model family from design-doc §7.1's minimal schema.
- **Action:** Under organization A's context, attempt every read operation type from design-doc §5.1 (`findUnique`, `findFirst`, `findMany`, `count`, `aggregate`, `groupBy`) against organization B's rows, by ID where applicable.
- **Expected result:** Every attempt returns null/empty/404-equivalent, never organization B's data.
- **Failure interpretation:** Any successful cross-org read is a direct KVKK-relevant finding (design-doc §13) and fails the PoC outright per design-doc §10.1, regardless of any other result.
- **Security significance:** Highest — this is the core tenant-isolation guarantee.
- **Acceptance threshold:** Zero successful cross-org reads across all read operation types × all model classification families.
- **Rollback/cleanup:** Destroy environment.

### Experiment 5 — Cross-org write denial

- **Setup:** Same as Experiment 4.
- **Action:** Under organization A's context, attempt every write operation type from design-doc §5.1 (`create`, `createMany`, `update`, `upsert`, `updateMany`, `deleteMany`, `delete`, nested `connect`/`disconnect`) targeting organization B's rows or attempting to write organization B's tenant key into a payload.
- **Expected result:** Every attempt is rejected; no row belonging to organization B is created, modified, or deleted; no organization-A-created row ends up carrying organization B's tenant key.
- **Failure interpretation:** Any successful cross-org write is the single most severe possible finding in this entire PoC (irreversible data corruption/leakage) and fails the PoC outright.
- **Security significance:** Highest.
- **Acceptance threshold:** Zero successful cross-org writes across all write operation types × all model classification families, including the two operations flagged as "cannot safely auto-rewrite" (design-doc §5.2) — those must be *rejected*, not silently no-op'd.
- **Rollback/cleanup:** Destroy environment.

### Experiment 6 — Cross-clinic behavior inside the same organization

- **Setup:** Same environment, one organization with ≥ 2 clinics, a user whose `allowedClinicIds` includes only clinic 1.
- **Action:** Attempt reads/writes against clinic 2's rows under that user's context (same organization, different clinic).
- **Expected result:** Denied identically to the cross-org case for `clinic_scoped_direct`/`clinic_scoped_dual_key` models. For `org_scoped_optional_clinic` models (design-doc §3), confirm the org-wide-visible-until-resolved behavior (e.g. `WhatsAppInboxEntry` with `clinicId=null`) is preserved and distinguished from a genuine cross-clinic-denial case — this experiment must assert both behaviors separately, not treat "org-scoped" as a bug.
- **Failure interpretation:** A denial where org-wide visibility is intentionally correct (false-denial, design-doc §10.2) is as much a finding as a leak — both must be reported.
- **Security significance:** High.
- **Acceptance threshold:** Zero cross-clinic leaks on direct/dual-key models; zero false-denials on the intentionally org-scoped-optional-clinic models.
- **Rollback/cleanup:** Destroy environment.

### Experiment 7 — Nested create/connect denial

- **Setup:** Same environment, two related models from different tenants (mirroring design-doc §5.2 item 1 — e.g. the PoC's parent/child pair with an FK that isn't the tenant key itself).
- **Action:** Under tenant A's context, attempt a nested `create` with a `connect` to a tenant-B-owned related row.
- **Expected result:** Rejected at the parent-ownership-validation step (design-doc §5.1's nested-write row) before the write commits.
- **Failure interpretation:** A successful connect indicates the "cannot safely auto-rewrite" case from design-doc §5.2 was implemented as a silent rewrite (connecting to a guard-selected same-tenant row instead of rejecting) rather than a rejection — explicitly called out in the design as the wrong behavior.
- **Security significance:** High.
- **Acceptance threshold:** 100% rejection rate for cross-tenant nested connect/disconnect attempts.
- **Rollback/cleanup:** Destroy environment.

### Experiment 8 — `updateMany`/`deleteMany` containment

- **Setup:** Same environment, ≥ 3 tenants each with rows in a `clinic_scoped_direct` model.
- **Action:** Under tenant A's context, issue an `updateMany`/`deleteMany` with an intentionally broad/empty additional filter (e.g. `status: 'pending'` with no explicit clinic filter supplied by the caller) — simulating the exact bug class this experiment exists to catch: a caller that forgot to add a tenant predicate.
- **Expected result:** The guard's mandatory filter injection (design-doc §5.1) ensures only tenant A's matching rows are affected; row counts for tenants B and C are unchanged.
- **Failure interpretation:** Any row outside tenant A affected is the single highest-severity guard failure mode named in the design doc (§5.4) — one missed injection affecting every tenant's rows.
- **Security significance:** Highest.
- **Acceptance threshold:** Affected-row count exactly equals tenant A's matching row count in every trial; zero rows affected outside tenant A across ≥ 100 trials with randomized filter shapes.
- **Rollback/cleanup:** Destroy environment.

### Experiment 9 — `upsert` isolation

- **Setup:** Same environment.
- **Action:** Under tenant A's context, `upsert` against a `where` matching a tenant-B row's unique key (where the unique constraint doesn't include the tenant key, if such a model exists in the PoC schema) and separately against a genuinely-absent key.
- **Expected result:** The tenant-B-matching case is denied (treated as "not found," triggering a scoped create rather than an update of tenant B's row); the absent-key case creates a new tenant-A-scoped row.
- **Failure interpretation:** An upsert that updates tenant B's row is a cross-tenant write (Experiment 5's failure mode) reached via a different operation shape — must be caught here even if Experiment 5's direct `update` case passes.
- **Security significance:** Highest.
- **Acceptance threshold:** Zero cross-tenant upsert updates across all trials.
- **Rollback/cleanup:** Destroy environment.

### Experiment 10 — `findUnique` behavior (post-query validation path)

- **Setup:** Same environment.
- **Action:** Under tenant A's context, `findUnique` by primary key for a row known to belong to tenant B.
- **Expected result:** Returns null/404-equivalent via the post-query validation path (design-doc §5.1) — not via a `where` injection, since `findUnique` cannot safely carry an additional tenant predicate for every model shape without risking breaking legitimate primary-key lookups.
- **Failure interpretation:** A successful cross-tenant `findUnique` indicates the post-query validation step was skipped or bypassed — this is the specific gap the design doc's `tenantGuard.ts`-derived `findOwnedOrNull` pattern is meant to close structurally, not just by convention.
- **Security significance:** Highest.
- **Acceptance threshold:** Zero successful cross-tenant `findUnique` results across all model classification families.
- **Rollback/cleanup:** Destroy environment.

### Experiment 11 — Raw SQL bypass detection

- **Setup:** Same environment, plus a deliberately-planted raw-SQL statement mirroring `routes/reports.ts:87`'s shape (parameterized tenant predicate, string-interpolated non-tenant value) and one mirroring `securityIncidentService.ts:138`'s shape (no tenant predicate at all, ID-only `WHERE`).
- **Action:** Execute both raw-SQL shapes under tenant A's context, attempting to read/affect tenant B's rows via the ID-only statement.
- **Expected result:** The design doc is explicit (§5.2, §6) that raw SQL **cannot** be auto-guarded — so the expected result here is not "guard blocks it," it is "RLS (if enabled in this trial) blocks it, or the statement is confirmed to require an explicit, reviewed tenant predicate to be safe." This experiment's purpose is to produce evidence for exactly that trade-off, not to prove the guard catches raw SQL — it structurally cannot.
- **Failure interpretation:** If RLS is enabled and the ID-only raw-SQL statement *still* succeeds against tenant B's row, that specifically demonstrates RLS's role-configuration is wrong for this connection (e.g. connected as a `BYPASSRLS` role by mistake) — an important operational-configuration finding distinct from an application-logic bug.
- **Security significance:** Highest — this experiment is the direct empirical evidence for why RLS is "additive," not decorative (design-doc §6 item 4).
- **Acceptance threshold:** With RLS enabled and the `app` role (non-`BYPASSRLS`) used for the connection, zero successful cross-tenant effects from the ID-only raw-SQL shape.
- **Rollback/cleanup:** Destroy environment; remove the deliberately-planted vulnerable statements from the PoC harness (they exist only to be tested against, never to ship).

### Experiment 12 — Interactive transaction with RLS context

- **Setup:** Same environment, RLS enabled, PgBouncer transaction-pooled endpoint (per design-doc §8.2 Experiment 5).
- **Action:** Run a Prisma interactive `$transaction` callback (mirroring one of the 34 real call sites, e.g. `imaging.ts:348`'s shape) that issues `SET LOCAL` at the start and multiple statements inside the callback.
- **Expected result:** `SET LOCAL`'s value is visible and correctly enforced across every statement inside the same callback, and is gone (not inherited) by the next transaction on a possibly-reused pooled connection.
- **Failure interpretation:** If a later statement inside the *same* callback doesn't see the `SET LOCAL` value, PgBouncer/adapter transaction boundaries don't match Prisma's interactive-transaction boundaries — a design-breaking finding for the whole RLS+PgBouncer combination (design-doc §8.2 Experiment 5's stated risk).
- **Security significance:** Highest.
- **Acceptance threshold:** 100% of statements inside a single interactive-transaction callback observe the correct `SET LOCAL` value, across ≥ 500 trial transactions under concurrent load.
- **Rollback/cleanup:** Destroy environment.

### Experiment 13 — Transaction rollback and context cleanup

- **Setup:** Same environment.
- **Action:** Start a transaction, `SET LOCAL` tenant A's context, issue a write, then roll back. Immediately reuse the same (possibly pooled) connection for a fresh transaction under tenant B's context.
- **Expected result:** Tenant A's rolled-back write is fully undone; tenant B's fresh transaction does not observe tenant A's `SET LOCAL` value at all.
- **Failure interpretation:** Residual `SET LOCAL` state after rollback on a reused connection is a context-leakage finding (ties to Experiment 3) specific to the rollback path, which is not automatically covered by the commit-path leakage test.
- **Security significance:** Highest.
- **Acceptance threshold:** Zero residual-context observations across ≥ 500 rollback-then-reuse trials.
- **Rollback/cleanup:** Destroy environment.

### Experiment 14 — PgBouncer transaction-pool connection reuse

- **Setup:** Same environment, PgBouncer in transaction-pool mode, connection pool sized well below simulated concurrent transaction count (to force reuse).
- **Action:** Run the full read/write operation matrix (design-doc §5.1) at a concurrency level that guarantees connection reuse within the test window.
- **Expected result:** Every transaction gets a correctly-scoped connection regardless of prior occupants; no operation-shape from §5.1 fails or behaves differently than the direct-Postgres baseline (Experiment established separately as the performance baseline, §20 below).
- **Failure interpretation:** Any operation-shape that behaves correctly direct but incorrectly/differently pooled is a specific incompatibility finding for design-doc §8.1's "does the adapter function at all" question.
- **Security significance:** High (correctness) and Medium (this is also a functional-compatibility experiment, not purely security).
- **Acceptance threshold:** 100% functional parity with the direct-Postgres baseline across all §5.1 operation shapes.
- **Rollback/cleanup:** Destroy environment.

### Experiment 15 — Prepared-statement behavior

- **Setup:** Same environment, PgBouncer transaction-pool mode, both with the Prisma/adapter's default prepared-statement behavior and with whatever "disable prepared statements" configuration is found to exist per design-doc §8.2 Experiment 2 (pulled from current primary-source docs at PoC time).
- **Action:** Run a repeated query shape (e.g. the same `findMany` call pattern) many times across many pooled connections, watching for prepared-statement-related errors (e.g. "prepared statement already exists" / "prepared statement does not exist" class errors characteristic of statement-cache/connection-identity mismatches under pooling).
- **Expected result:** No prepared-statement errors with whichever configuration Experiment 2 determines is correct; the default (unconfigured) case is explicitly run first specifically to document whether the *default* is already safe or requires the extra configuration step.
- **Failure interpretation:** Prepared-statement errors under the default configuration confirm the extra configuration step is mandatory, not optional, for this Prisma/adapter/PgBouncer combination — must be recorded precisely (exact error class, exact configuration that resolves it) for the future implementation task.
- **Security significance:** Low (this is a correctness/availability concern, not a tenant-isolation concern) but blocking for §8.1's core question.
- **Acceptance threshold:** Zero prepared-statement errors across ≥ 10,000 trial queries with the determined-correct configuration.
- **Rollback/cleanup:** Destroy environment.

### Experiment 16 — Worker tenant iteration

- **Setup:** Same environment, a simulated job mirroring `jobs/reminders.ts`'s actual shape: `prisma.clinic.findMany()` with no filter, then `mapWithConcurrency` over clinics at a concurrency mirroring `REMINDER_CLINIC_CONCURRENCY`'s default (5).
- **Action:** Run the simulated job across ≥ 20 simulated clinics spanning ≥ 3 organizations, with RLS enabled and the job using a per-iteration `SET LOCAL` (design-doc §7.3's worker-behavior item, option (b)).
- **Expected result:** Each clinic's iteration only reads/writes that clinic's rows; total job duration is measured against the §10.2 worker-batch-duration threshold.
- **Failure interpretation:** Any cross-clinic read/write during the job run is a system-context design failure (design-doc §4, `system` mode); a duration regression beyond threshold is a performance finding, not a security one, and does not by itself fail the PoC — but must be reported honestly per §10.2.
- **Security significance:** High.
- **Acceptance threshold:** Zero cross-clinic effects; duration within the design-doc §10.2 worker-batch-duration proposed threshold (flagged as unmeasured-proposal until this experiment runs).
- **Rollback/cleanup:** Destroy environment.

### Experiment 17 — System-job restricted access

- **Setup:** Same environment, a simulated job mirroring `jobs/dataRetentionCleanupJob.ts`'s actual shape: no clinic loop at all, a single global age-threshold query/delete.
- **Action:** Run the simulated job under `system` context (design-doc §4.1) with the `system_context_required` guard mode and, separately, with RLS enabled using the `migrator`-or-equivalent bypass-appropriate role decision from design-doc §7.2/§7.3's worker-behavior item, option (a).
- **Expected result:** The job completes its genuinely-cross-tenant-by-design deletion correctly (this is the one experiment where "affects multiple tenants' rows" is the *correct* outcome, not a failure — must be scoped by age threshold exactly as today, no more and no less).
- **Failure interpretation:** If the job's cross-tenant behavior is accidentally blocked by an over-eager guard/RLS default, that is a false-denial (design-doc §10.2) breaking real product behavior — this experiment exists specifically to prevent the guard design from naively treating "no tenant context = deny" as universally correct when a legitimately-cross-tenant system job is the actual caller.
- **Security significance:** Medium (this experiment's finding is as much about correctness/availability as security — but a job that's "too restricted" is also a place where developers might be tempted to grant broader access than needed, which is its own risk).
- **Acceptance threshold:** Job's row-selection matches the pre-guard/pre-RLS baseline selection exactly (same age-threshold logic, same row set) with the `system` context/appropriate role applied.
- **Rollback/cleanup:** Destroy environment.

### Experiment 18 — Platform-admin/break-glass audited access

- **Setup:** Same environment, `platform_support` role (design-doc §7.2) configured with its own deliberately-scoped policy (not `BYPASSRLS`), simulated `runAsPlatformAdmin`/`runAsBreakGlass` wrappers (design-doc §5.5) wired to write an audit record on every invocation.
- **Action:** Invoke a cross-tenant read via `runAsPlatformAdmin` (with `reason`), and a cross-tenant write via `runAsBreakGlass` (with `reason` + confirmation token); separately, attempt to call the underlying cross-tenant capability *without* going through either wrapper.
- **Expected result:** Wrapped calls succeed and produce exactly one audit record each; the un-wrapped direct-access attempt fails (proving the escape hatch is genuinely narrow, not a generally-available capability).
- **Failure interpretation:** A successful un-wrapped bypass is a "unauthorized break-glass" finding (design-doc §10.1's "zero unaudited system/bypass access" bar) — one of the four absolute security-acceptance criteria.
- **Security significance:** Highest.
- **Acceptance threshold:** 100% of wrapped invocations produce an audit record; 100% of un-wrapped bypass attempts fail.
- **Rollback/cleanup:** Destroy environment.

### Experiment 19 — Migration role bypass

- **Setup:** Same environment, `migrator` role (`BYPASSRLS`, design-doc §7.2) used only for the PoC's own schema-setup step.
- **Action:** Confirm the `migrator` role can create/alter tables and apply RLS policies themselves (a role subject to its own policies could not enable RLS on a table it can't fully see); confirm the `app` role, attempted against the same DDL operations, is denied (roles are cleanly separated, not overlapping in privilege by accident).
- **Expected result:** `migrator` succeeds at all DDL; `app` fails at all DDL attempts.
- **Failure interpretation:** If `app` can perform DDL, the role-separation design (design-doc §7.2) has a privilege-boundary gap that undermines the entire RLS trust model (an app-level compromise could disable its own RLS policies).
- **Security significance:** Highest.
- **Acceptance threshold:** 100% DDL success for `migrator`; 100% DDL denial for `app`.
- **Rollback/cleanup:** Destroy environment.

### Experiment 20 — Performance benchmark ladder

- **Setup:** Same environment, representative-scale data (design-doc §7.1, scaled up specifically for this experiment — a fixed, documented row count per table, large enough for index/query-plan behavior to be meaningful, small enough to run repeatably in CI-adjacent infrastructure).
- **Action:** Run an identical, fixed load-test script five times, once per rung of the ladder: (1) baseline — no guard, no RLS, direct Postgres; (2) guard only, direct Postgres; (3) RLS only (no guard), direct Postgres; (4) guard + RLS, direct Postgres; (5) guard + RLS + PgBouncer transaction pooling.
- **Expected result:** Each rung's measurements (design-doc §10.2's full metric list: p50/p95/p99 latency delta, throughput delta, connection count, transaction count, pool wait time, error rate, CPU impact, query-plan/index evidence, worker-batch-duration impact) are captured and compared against rung (1)'s baseline and against the proposed thresholds.
- **Failure interpretation:** A threshold miss at any rung is a performance finding requiring either policy-family reconsideration (design-doc §7.4) or threshold renegotiation — explicitly not itself a security failure and must not be reported as one, but must be reported honestly and not minimized.
- **Security significance:** Low directly, but this is the experiment that produces the evidence ADR-004/ADR-005 need to move past `NEEDS_POC` — its *absence* is the current blocker.
- **Acceptance threshold:** All five rungs' `EXPLAIN ANALYZE` output and all §10.2 metrics captured and reported, regardless of whether proposed thresholds are met — the acceptance bar for this experiment is "measured and reported," not "meets a specific number," since the numbers themselves are explicitly unvalidated proposals (design-doc §10.2).
- **Rollback/cleanup:** Destroy environment; retain only the aggregated report (no raw production-shaped data, since this is synthetic PoC data throughout).

---

## Coverage note

This matrix covers the 20 experiments named in the task's Core Question G as a minimum set. It does not cover every one of the 91 models' individual quirks from the JSON inventory — the 5 `ambiguous_nullable_tenant` models and 6 `child_via_parent` models specifically should each get at least one dedicated variant of Experiments 4-10 during actual PoC execution, using their real shapes rather than only the minimal-schema stand-ins used above, before RLS work on those specific tables is considered evidenced. This is noted as a scope-expansion the future PoC task should apply, not assumed to already be covered by the 20 experiments as written.
