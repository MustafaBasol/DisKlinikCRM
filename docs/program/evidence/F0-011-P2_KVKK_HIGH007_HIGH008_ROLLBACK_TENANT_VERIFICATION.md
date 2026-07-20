# F0-011-P2 — KVKK-HIGH-007/HIGH-008 Rollback, Tenant-Impact, and Independent Test Verification

**Task identifier:** F0-011-P2
**Verification date:** 2026-07-20
**Baseline `origin/main` SHA:** `4c439716d9d56a989a1beb177e426eaae65255dd` (merge commit of PR #185, `KVKK-HIGH-008-PMVR` reconciliation)
**Worktree:** `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-011-p2-verify`, branch `docs/f0-011-p2-kvkk-high007-high008-verification`
**Primary working tree:** not modified. `D:\Mustafa\Siteler\DisKlinikCRM`, branch `docs/kvkk-20260720-production-reconciliation`, HEAD `404f653181b5acc7599956a1bcdb35000af3d9cd`, clean at task start; only read-only `git status --short`/`git rev-parse`/`git fetch` were run against it.

## 0. Relationship to KVKK-HIGH-008-PMVR Phase B1 (PR #185)

`NORAMEDI_MASTER_TRACKER.md` §6 F0-011-P2 records that a parallel task, **KVKK-HIGH-008-PMVR Phase B1** (branch `audit/kvkk-high-008-post-merge-readiness`, PR #185, merged as part of this baseline), had already completed work materially overlapping items (1)–(3) of this task's original scope: 483 test assertions across 19 suites, a three-scenario disposable-Postgres rollback rehearsal, and a reproduced cross-tenant write-rejection test. `CURRENT_PHASE.md`'s 2026-07-20 entry explicitly characterizes PMVR Phase B1's findings as **"author-reported, not yet independently re-verified."**

This task supplies exactly that: a **fresh, independent** re-verification, executed in its own isolated worktree/branch/session/disposable-database stack, not derived from or dependent on PMVR's artifacts, transcripts, or scripts. Where this task's independent results corroborate PMVR's conclusions, that is noted below. One tooling-level finding (§4.3) goes beyond what PMVR's evidence documents (PMVR documents forward-reapplication idempotency; it does not document `_prisma_migrations` bookkeeping drift after a *physical* rollback, or the `prisma migrate resolve --rolled-back` failure mode).

Per the tracker's own scope narrowing note, the one item this task cannot close by itself is **an explicit external accept/reject decision on R-061** — that decision belongs to a human risk owner, not to an agent (`NORAMEDI_MASTER_TRACKER.md` §2.3 agent-authority limits: self-assignable status stops at `AGENT_COMPLETED`). §7 below documents the rationale for that decision without asserting it has been made.

## 1. CodeGraph usage

No `.codegraph/` directory exists in this worktree (confirmed: `ls .codegraph` → not found). Per standing instruction, CodeGraph was skipped entirely rather than indexed ad hoc, and narrowly targeted `Grep`/`Glob`/`Read` were used instead, scoped to `server/src/services/communicationConsent/`, `server/src/routes/communicationPreferences.ts`, `server/src/tests/`, `server/prisma/migrations/`, and `docs/program/`. No repository-wide scan was performed.

Targeted searches used (all narrowly scoped, no path broader than `server/src` or `docs/program`):
- `CommunicationConsentConflictBucket|PatientLegacyConsentCorrection` in `server/src` → 6 files, narrowed further investigation.
- `legacyConsentCorrection|communicationConsentConflictTracker|LegacyConsentCorrection|ConflictTracker` in `server/src` → 6 files.
- `kvkk.high.?007|kvkk.high.?008|HIGH-007|HIGH-008` (case-insensitive) in `server/src` → 28 files, used to enumerate every call site touching the two migrations' models and every adjacent consent-gate integration point.
- `prisma\.(patientLegacyConsentCorrection|communicationConsentConflictBucket)\.` in `server/src` → every ORM call site against the two new models (service code, jobs, tests) — used to confirm no unscoped background-job/admin query exists (§6.7).
- `R-061` in `docs` → 9 files, narrowed to `RISK_REGISTER.md` line 87 for the authoritative risk entry.
- `dataRetention\.runtimeEnabled` in `server/src` → 2 files, used to understand the existing `PlatformSetting` runtime-toggle pattern referenced as a candidate mitigation (not implemented by this task).

## 2. Disposable PostgreSQL setup

A dedicated Docker container was created for this task only, isolated from an unrelated pre-existing container (`noramedi-kvkk-test-db`, port 5433, left untouched):

- Image: `postgres:16-alpine`
- Container: `f0011p2-verify-pg`, port `5434` (host-only, not the default 5432)
- Credentials: local-only, non-production, generated for this task, never used anywhere outside this disposable container
- Three databases created inside the same container for phase isolation (no cross-phase state bleed):
  - `noramedi_f0011p2` — Part A (independent test execution)
  - `noramedi_f0011p2_partbc` — Part B/C (migration-forward and rollback rehearsal)
  - `noramedi_f0011p2_partd` — Part D (tenant-isolation verification)
- Migrations applied through the project's normal mechanism: `npx prisma migrate deploy` (Prisma v7.8.0, config `server/prisma.config.ts`), never hand-run SQL for the full-deploy paths.
- Container and both extra databases are disposable; nothing here is reachable from, or shared with, any production or shared environment.

## Part A — Independent test verification

Ran directly against `noramedi_f0011p2` after `prisma migrate deploy` applied all 64 migrations cleanly (`All migrations have been successfully applied.`).

| Suite | Command | Result | Exit |
|---|---|---|---|
| `legacyConsentCorrection.test.ts` (HIGH-008 core) | `npx tsx src/tests/legacyConsentCorrection.test.ts` | 28 passed, 0 failed | 0 |
| `legacyReconciliationResolver.test.ts` (HIGH-007 core) | `npx tsx src/tests/legacyReconciliationResolver.test.ts` | 30 passed, 0 failed | 0 |
| `communicationConsentAuditReport.test.ts` | `npx tsx src/tests/communicationConsentAuditReport.test.ts` | 7 passed, 0 failed | 0 |
| `communicationPreferencesRoute.test.ts` | `npx tsx src/tests/communicationPreferencesRoute.test.ts` | 12 passed, 0 failed | 0 |
| `communicationPreferenceReconciliationReport.test.ts` | `npx tsx src/tests/communicationPreferenceReconciliationReport.test.ts` | 9 passed, 0 failed | 0 |
| `communicationConsent.test.ts` | `npx tsx src/tests/communicationConsent.test.ts` | 92 passed, 0 failed | 0 |
| `communicationPreferenceBackfill.test.ts` | `npx tsx src/tests/communicationPreferenceBackfill.test.ts` | 7 passed, 0 failed | 0 |
| `messagesConsentGate.test.ts` | `npx tsx src/tests/messagesConsentGate.test.ts` | 4 passed, 0 failed | 0 |
| `recallConsentGate.test.ts` | `npx tsx src/tests/recallConsentGate.test.ts` | 4 passed, 0 failed | 0 |
| **Total** | 9 suites | **193 passed, 0 failed** | all 0 |

Coverage spans: role-based authorization (OWNER/ORG_ADMIN/CLINIC_MANAGER allowed, RECEPTIONIST/DENTIST/BILLING denied), cross-org (404) and same-org-wrong-clinic (403) rejection at the route layer, idempotency/concurrency under real concurrent Postgres transactions (20-way parallel mutation races), transactional rollback on downstream constraint failure, audit-log PII exclusion, conflict-bucket concurrency (20 parallel identical detections → exactly one bucket, `occurrenceCount=20`), and the full HIGH-007 reconciliation mode matrix.

**Environment note:** `communicationPreferenceReconciliationReport.test.ts` spawns `npx tsx <script>` as child processes (matching its own established test pattern); on this Windows/npx setup each spawn has meaningful startup overhead, which exceeded this task's own tool-level 120s default timeout on the first attempt (exit 143 while 7/9 sub-tests had already passed). Re-run with a longer timeout completed cleanly, 9/9 passed. Classified **unrelated/non-blocking** — an artifact of this verification session's own tooling timeout, not of the suite or the application under test.

**Full project test suite (`npm test`, ~60 files):** not run. The task's targeted-suite requirement is mandatory and was met (193/193 passing across every suite that imports, exercises, or asserts on HIGH-007/HIGH-008 code); the full suite is optional ("if practical") and was judged out of critical path given the size of this task — recorded here as **not verified** rather than silently assumed passing.

**Do not rely solely on prior agent reports:** every test above was executed fresh, in this task's own worktree/session/disposable database, independent of PMVR Phase B1's own (unseen, not reused) test run.

## Part B — Migration-forward baseline rehearsal

Database: `noramedi_f0011p2_partbc`.

1. **Pre-HIGH-007 baseline established** using a temporary migrations-folder copy (`server/.tmp-prisma-partial/`, deleted before this task's diff was finalized — see §8) with the two in-scope migrations removed, applied via `prisma migrate deploy --config .tmp-prisma-partial/prisma.config.ts`: 62 migrations applied, ending at `20260718164142_add_communication_preference_and_consent`. Confirmed via `\dt`: neither `CommunicationConsentConflictBucket` nor `PatientLegacyConsentCorrection` exists yet.
2. **Seeded minimal pre-migration data**: 1 `Organization`, 1 `Clinic`, 1 `User`, 1 `Patient` (`smsOptOut=true`).
3. **Applied both in-scope migrations** using the real, unmodified `server/prisma/migrations` folder: `npx prisma migrate deploy` → both applied cleanly, 64/64 total.
4. **Data-mutation check:** the seeded `Patient` row (`smsOptOut=true`, `createdAt`/`updatedAt` timestamps) was read back byte-identical after both migrations applied. Both new tables started at 0 rows. **Confirmed: both migrations are structure-only — they create new objects and add one new index on the pre-existing `OperationalEvent` table; they never read, write, or transform pre-existing operational data.**
5. **Schema evidence** (`\d+`, `pg_indexes`) — matches the committed migration SQL exactly:
   - `CommunicationConsentConflictBucket`: 12 columns, all `NOT NULL`; PK on `id`; unique index on `(organizationId, clinicId, channel, purpose, reasonCode, bucketStartedAt)` — **clinic-scoped uniqueness, not global**; supporting indexes on `(organizationId, clinicId, createdAt)` and `(bucketStartedAt)`. **No foreign-key constraints at all** — `organizationId`/`clinicId` are unvalidated `text` columns (by design: this table deliberately excludes any patient identifier and is documented as an aggregate-only counter; the absence of FKs means a malformed org/clinic id could theoretically be written, but the table carries no patient-identifying evidence, so the practical risk is low — noted here as a residual observation, not a blocker).
   - `PatientLegacyConsentCorrection`: 16 columns; `previousRecordedAt`/`sourceReference` nullable, everything else `NOT NULL`; PK on `id`; unique index on `(organizationId, patientId, idempotencyKey)` — **not `clinicId`**, which is safe because `patientId` already pins a single clinic and the service layer defense-in-depth-checks `existing.clinicId !== input.clinicId` (see §6); supporting indexes on `(organizationId, clinicId, createdAt)` and `(patientId, createdAt)`; FK constraints to `Organization`, `Clinic`, `Patient`, `User` (`correctedById`), all `ON DELETE RESTRICT ON UPDATE CASCADE`.
   - `OperationalEvent_source_organizationId_clinicId_createdAt_idx` confirmed present on the pre-existing `OperationalEvent` table (additive index only).

**Status: database-rehearsed, independently verified.**

## Part C — Rollback rehearsal

Prisma has no native down-migration; reverse DDL was hand-authored (`server/.tmp-rollback-high008-high007.sql`, deleted before finalizing — see §8) reversing HIGH-008 then HIGH-007 in a single transaction: drop the 4 FKs and the `PatientLegacyConsentCorrection` table, drop the `PatientLegacyConsentField` enum, drop the `OperationalEvent` index, drop the `CommunicationConsentConflictBucket` table.

### Scenario 1 — empty additive tables

Rehearsed against the state at the end of Part B (both migrations applied, 0 rows in either new table).

- Rollback SQL executed cleanly inside a transaction (`BEGIN`…`COMMIT`, all statements succeeded).
- Post-rollback: both tables, the enum, and the `OperationalEvent` index are gone; the seeded `Patient` row (`smsOptOut=true`) is byte-identical to before. **Schema cleanly returns to the pre-HIGH-007 state; pre-existing data is unaffected.**

### Finding — `_prisma_migrations` bookkeeping does not self-reconcile after a physical rollback

This is the one finding in this task that goes beyond PMVR Phase B1's own evidence (which documents forward-reapplication idempotency, not physical-rollback bookkeeping):

1. After the DDL rollback above, `_prisma_migrations` still listed both migrations as applied (`finished_at` set). Running `prisma migrate deploy` again reported **`No pending migrations to apply`** — Prisma's own tooling did not detect, and will not repair, the drift between its bookkeeping and the actual (rolled-back) schema.
2. `npx prisma migrate resolve --rolled-back <name>` was attempted for both migrations and **failed for both**: `Error: P3012 — Migration ... cannot be rolled back because it is not in a failed state.` Prisma's supported rollback-bookkeeping command only operates on migrations that failed mid-apply — it explicitly refuses to act on a migration that finished cleanly, which is exactly the case after a manual physical-DDL rollback.
3. The only path found that allowed `prisma migrate deploy` to treat the two migrations as pending again was a raw, **unsupported** `DELETE FROM _prisma_migrations WHERE migration_name IN (...)`. After that, `prisma migrate deploy` reapplied both migrations cleanly (64/64), confirming migration reapplication itself works — but only after bypassing Prisma's own bookkeeping table directly.

**Operational conclusion:** a physical schema rollback of these migrations is not a tool-supported operation in this codebase's migration stack. It requires hand-authored reverse DDL (no down-migration exists) *and*, if the normal `prisma migrate deploy` recovery path is to work again afterward, an unsupported direct edit of Prisma's internal bookkeeping table. This is an additional, concrete reason (beyond destructive data loss, below) to prefer the retain-and-cutback path over physical schema rollback.

**This finding is recorded as `RISK_REGISTER.md` R-070** (new row added by this task, kept `OPEN`) rather than left as an ambiguous prose note, because it has a concrete failure mode beyond these two specific migrations: any future hand-authored physical rollback of an already-successful Prisma migration can leave the actual schema state inconsistent with `_prisma_migrations`, and `prisma migrate resolve --rolled-back` rejects a migration Prisma considers successfully applied (`P3012`), so it cannot repair that drift. The raw `DELETE FROM _prisma_migrations WHERE migration_name IN (...)` statement used in this rehearsal to force Prisma to re-treat the migrations as pending was observed **only as an unsupported disposable-environment recovery experiment** and must not be documented, read, or used as the normal or default production rollback procedure. R-070's hardened mitigation (see `RISK_REGISTER.md`) is: avoid physical rollback of additive migrations, retain schema and forward-fix by default, and — only if an exceptional physical rollback is explicitly authorized — require verified backup/export, an approved reverse-DDL script, explicit schema-and-ledger reconciliation, post-rollback schema verification, `_prisma_migrations` verification, and DBA/program approval before execution; direct `_prisma_migrations` mutation remains emergency-only and unsupported.

### Scenario 2 — populated evidence tables

Reapplied both migrations (64/64), then inserted **synthetic** evidence: 1 `CommunicationConsentConflictBucket` row (`conflict_seed_1`) and 1 `PatientLegacyConsentCorrection` row (`correction_seed_1`), both referencing the same seeded org/clinic/patient/user from Part B. No real patient data was used anywhere in this task.

- Re-ran the identical rollback SQL. It succeeded (same clean `BEGIN`…`COMMIT`).
- Post-rollback: both tables are gone — **along with the one synthetic conflict-bucket row and the one synthetic correction row they held.** There is no backup, export, or soft-delete step in this rollback path; `DROP TABLE` is not reversible.

**This physical rollback path is explicitly not characterized as safe.** The fact that the SQL executes without error is not evidence of safety — it demonstrates the opposite: once either table holds even one row of real reconciliation/correction/conflict evidence, dropping it permanently destroys that KVKK-relevant evidence. **Status: rollback-rehearsed, independently verified — destructive-impact claim demonstrated, not merely asserted.**

### Retained-schema application cutback — compatibility test

Tested (not merely inspected) whether an older, pre-HIGH-007 application build can operate correctly against a database that **retains** the additive tables (the "retain the schema, roll back the app" cutback path):

1. Identified the parent commit before HIGH-007 was introduced: `1da9586` → parent `7fcf2f8` ("add centralized communication preference and consent management", #169).
2. Extracted that commit's `server/prisma/schema.prisma` via `git show 7fcf2f8:server/prisma/schema.prisma` — confirmed it defines 91 models and contains **zero** references to `CommunicationConsentConflictBucket` or `PatientLegacyConsentCorrection`.
3. Generated an isolated Prisma Client from that old schema (`server/.tmp-old-client/`, deleted before finalizing — see §8), instantiated with the same `@prisma/adapter-pg` driver-adapter pattern the real application uses (`server/src/db.ts`).
4. Ran that old client against `noramedi_f0011p2_partbc` **while the additive HIGH-007/HIGH-008 tables were present** (post-reapplication state): `patient.count()`, `patient.findFirst()`, `organization.count()`, `clinic.count()` all succeeded and returned correct data (`patientCount: 1, patientSmsOptOut: true, orgCount: 1, clinicCount: 1`).

**Conclusion: independently verified, not merely inspected.** A pre-HIGH-007 application build's Prisma Client operates correctly against a database that retains the HIGH-007/HIGH-008 additive tables — the extra tables are simply invisible to a client generated from a schema that doesn't declare them. This directly supports the recommended production cutback sequence:

```
disable or stop the affected workflow/control (role/access-level action — see §7)
→ deploy a compatible prior application commit
→ retain additive evidence tables (do not physically drop them)
→ forward-fix
```

## Part D — Multi-clinic tenant-isolation verification

Database: `noramedi_f0011p2_partd` (full 64-migration schema). A standalone script (`server/.tmp-tenant-isolation-check.ts`, deleted before finalizing — see §8) called the **real, unmodified** service functions (`correctSmsOptOut`, `listLegacyConsentCorrections`, `getLegacyConsentCorrectionDetail`, `recordCommunicationConsentConflict`) plus one raw-SQL query mirroring the route's own query shape — not reimplementations, not mocks.

Synthetic dataset: two organizations (`Clinic A Org`, `Clinic B Org`), one clinic each, one staff user each, one patient each — **deliberately identical** patient name (`Ayse Yilmaz` in both), **deliberately identical** `idempotencyKey` string used independently by both tenants, and **deliberately identical** conflict-bucket `channel`/`purpose`/`reasonCode`/hour-bucket across both tenants. No real patient data was used.

| # | Assertion | Setup | Action | Expected | Actual | Result |
|---|---|---|---|---|---|---|
| 1 | Clinic A query cannot return Clinic B corrections | 1 correction created per tenant | `listLegacyConsentCorrections({org:A,...})` | Only A's 1 row | Only A's 1 row (0 leakage) | **PASS** |
| 2 | Clinic B query cannot return Clinic A corrections | (same) | `listLegacyConsentCorrections({org:B,...})` | Only B's 1 row | Only B's 1 row | **PASS** |
| 3 | Creation path assigns correct `clinicId` (A) | — | `correctSmsOptOut` for patient A | `correction.clinicId === clinicA.id` | matched | **PASS** |
| 3 | Creation path assigns correct `clinicId` (B) | — | `correctSmsOptOut` for patient B | `correction.clinicId === clinicB.id` | matched | **PASS** |
| 4/10 | No update/delete path exists on correction records (so cross-clinic ownership can never be changed post-creation) | — | inspected service module exports | no `update`/`delete`/`remove` export | confirmed create-only + 2 read functions only | **PASS** |
| 5/6 | Conflict/reconciliation lookup is clinic-scoped despite identical channel/purpose/reasonCode/hour | 2 detections for A, 1 for B, same bucket key shape | `recordCommunicationConsentConflict` × 3, then `findMany` filtered by org | separate buckets, `occurrenceCount` 2 and 1 | bucketsA.length=1 (count 2), bucketsB.length=1 (count 1) | **PASS** |
| 8 | Org A cannot read Org B's correction detail by ID | — | `getLegacyConsentCorrectionDetail({org:A, correctionId: B's id})` | `null` | `null` | **PASS** |
| 8 | Org A cannot read Org B's detail even substituting B's own patientId | — | same, with `patientId: patientB.id` under org A scope | `null` | `null` | **PASS** |
| 8 | Foreign patientId cannot be corrected under another org's scope (A→B) | — | `correctSmsOptOut({org:A, clinicId:A, patientId: patientB.id, ...})` | throws `clinic_scope_mismatch` | threw `clinic_scope_mismatch` | **PASS** |
| 8 | Foreign patientId cannot be corrected under another org's scope (B→A) | — | `correctSmsOptOut({org:B, clinicId:B, patientId: patientA.id, ...})` | throws `clinic_scope_mismatch` | threw `clinic_scope_mismatch` | **PASS** |
| 8 | Rejected cross-tenant attempt caused no mutation | after both rejected attempts above | re-read `patientB.smsOptOut` | unchanged by the illegitimate attempt (still reflects only the legitimate correction) | unchanged | **PASS** |
| 9 | Unique key is `(org, patient, idemKey)`, not global on `idemKey` alone | identical `idempotencyKey` used by both tenants | both `correctSmsOptOut` calls | both succeed independently, 2 distinct rows | 2 rows, distinct ids, one per org | **PASS** |
| — | Raw-SQL org-scoped lookup (mirrors route query shape) cannot return a foreign row | — | `SELECT id FROM "PatientLegacyConsentCorrection" WHERE id=<B's id> AND organizationId=<A> AND clinicId=<A>` | 0 rows | 0 rows | **PASS** |
| 7 | Background job (`dataRetentionCleanupJob.ts`) touching `CommunicationConsentConflictBucket` is safe despite filtering only by age, not by org/clinic | code inspection, not a disposable-DB test | reviewed `makeCommunicationConsentConflictBucketsDeps` | deletion criteria is per-row age only, never cross-references another tenant's data | confirmed: `deleteMany({ where: { id: { in: rows.map(r=>r.id) } } })`, `rows` selected only by `bucketStartedAt < threshold` | **PASS (by inspection — see note below)** |

**14/14 disposable-database assertions pass; 1 additional item (job scoping) verified by code inspection rather than a database rehearsal** because it is a global-by-design age-based retention sweep, not a per-tenant query — deleting one tenant's expired row never reads or affects another tenant's row, since the row's own `bucketStartedAt` is the only deletion criterion. This is standard, intentional design for a purely aggregate, non-PII retention table (documented in the table's own module comment as "deliberately excludes any patient-level identifier"). Classified: **statically inspected**, not database-rehearsed, for this one item — everything else in this table is **independently verified** against a real disposable Postgres database.

**No cross-tenant leakage, no unscoped ambiguous query, and no missing clinic-ownership field was found anywhere in this scope.** (Had any been found, per the task's stopping conditions, this task would have stopped and reported it instead of proceeding.)

Corroborates, via fresh independent execution, PMVR Phase B1's own reported cross-tenant write-rejection finding, using different synthetic data and a different assertion set (14 assertions vs. PMVR's own count, not reused).

**R-046 cross-reference:** `RISK_REGISTER.md` R-046 (line 73) is the primary risk row this task's rollback and tenant-impact evidence attaches to (distinct from R-061, which tracks the no-kill-switch decision). R-046's own "remains missing" column previously read, verbatim, "populated-table/production senaryosu hâlâ yok" ("populated-table/production scenario still missing") — Part C Scenario 2 above directly supplies the populated-table half of that gap at the disposable-rehearsal level. **R-046 is NOT moved to `MITIGATED` by this task.** Its own acceptance criteria require independent rollback rehearsal (empty-vs-populated, now satisfied — disposable level), tenant-impact evidence (now satisfied — disposable level), **and** full production cross-tenant negative verification **and** full production audit verification (neither performed by this task — out of scope, no production access permitted). R-046 remains `OPEN`; see the corresponding `RISK_REGISTER.md` annotation for the exact wording.

**R-046 acceptance-criteria breakdown (explicit, this correction pass):**
- **Satisfied (disposable-rehearsal level):** (1) disposable empty-table rollback rehearsal (Part C Scenario 1); (2) disposable populated-table destructive-drop proof (Part C Scenario 2); (3) additive-schema application-cutback compatibility test (pre-HIGH-007 Prisma Client against a database retaining the additive tables, Part E.4); (4) disposable cross-org/cross-clinic tenant-isolation verification (Part D, 14/14 assertions, 0 leakage).
- **Outstanding (production level, out of this task's scope):** (1) production cross-tenant negative verification; (2) production audit-attribution verification; (3) production-specific operational cutback/runbook confirmation (the §E.5 incident-response sequence is disposable-reasoned and code-inspected, not exercised against the actual production deployment).

## Part E — R-061 no-kill-switch decision documentation

### 0. PR #186 — parallel implementation status (verified this correction pass)

Independently confirmed via `gh pr view 186 --json number,title,state,isDraft,baseRefName,headRefName,mergeable,mergeStateStatus,commits`: **PR #186 exists**, title "fix(kvkk): gate legacy consent correction runtime (KVKK-HIGH-008-F1)", branch `fix/kvkk-high008-runtime-toggle`, base `main`, state `OPEN`, not a draft, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, 6 commits. It is a **parallel implementation PR** for the `privacy.legacyConsentCorrection.runtimeEnabled` toggle recommended in §6 below. **It is not in `origin/main` and was not technically reviewed by F0-011-P2** — this task did not inspect or modify its runtime code (out of scope). The program has already authorized the implementation direction; building is already underway in this open PR. The remaining decision for R-061 is not "accept no flag or authorize building" — it is **external acceptance, merge, deployment, and production verification of PR #186**.

`RISK_REGISTER.md` R-061 (line 87) is the authoritative, already-existing risk entry: KVKK-HIGH-008 has **no dedicated runtime kill switch**, unlike KVKK-HIGH-007 (which has three independent env-var flags: `COMMUNICATION_CONSENT_ENFORCEMENT_ENABLED`, `COMMUNICATION_CONSENT_ENFORCEMENT_MODE`, `COMMUNICATION_CONSENT_LEGACY_RECONCILIATION_ENABLED`, all default-disabled/audit — see `server/src/services/communicationConsent/enforcementConfig.ts`). R-061 is currently `OPEN`, and the tracker records that **an explicit human accept/reject decision remains genuinely outstanding** — this task cannot make that decision, only document its rationale for whoever does.

### 1. Why no kill switch exists today

KVKK-HIGH-008's legacy-consent-correction workflow was deliberately built as a manual, per-record, staff-triggered, role-gated action (OWNER/ORG_ADMIN/CLINIC_MANAGER only — verified in Part A/D above) rather than an automatic or scheduled process. Independent code inspection (this task and, previously, PMVR Phase B1) found **no cron, worker, startup, or scheduled invocation path anywhere in `server/src/jobs`** — the only way a correction record is ever created is one authenticated, authorized, rate-limited-by-human-action HTTP request at a time. A rollout kill switch is the standard mitigation for a control that can run *unattended and at volume*; this control cannot.

### 2. Why silently disabling it could create more compliance risk than leaving it on

If a `runtimeEnabled=false`-style flag were flipped mid-incident, staff who believe they are correcting a stale/incorrect legacy SMS opt-out signal (with documented evidence — verbal confirmation, signed form, etc.) would instead hit a silent or generic failure. Two concrete risks follow:
- **Evidence-integrity risk:** the correction workflow's entire purpose is producing an *auditable, immutable* record of why a legacy consent signal was overridden (`PatientLegacyConsentCorrection` is explicitly create-only — confirmed §D). Silently blocking it does not undo any correction already made; it only prevents *new*, properly evidenced corrections from being recorded, which can push staff toward undocumented workarounds elsewhere in the system — the opposite of the control's purpose.
- **Fail-open/fail-closed ambiguity:** unlike HIGH-007 (which has a designed `disabled`/`audit`/`enforce` state machine with defined fallback behavior in every state), a bolted-on kill switch for HIGH-008 would need its own careful design of exactly what happens to an in-flight request when flipped — done hastily during an incident, this is itself a source of new defects, not a proven safety net.

### 3. Operational controls that remain available today, without any code change

- **Role-based access revocation.** Every write path is gated by `authorize([...EXPORT_ROLES])` (OWNER/ORG_ADMIN/CLINIC_MANAGER) at the route layer (verified in Part A). Suspending or demoting a specific user's role, or disabling a specific user's account, immediately removes their ability to invoke this workflow, without touching any other tenant or any other workflow.
- **Read access remains available regardless.** History/detail endpoints are read-only and cannot themselves cause new evidence-integrity harm.
- **Reverse-proxy/WAF-level route blocking**, if ever needed, can block the three specific endpoint paths (`POST .../legacy-corrections/sms-opt-out` and its two `GET` siblings) without a code deployment — an infrastructure-level control, not a code kill switch, but real and available today.
- **Application redeploy** (a prior compatible commit that predates the route entirely) is always available and is the documented, tested (§C) path if the workflow itself must stop existing, not just stop being reachable.

### 4. Stopping an execution path vs. application rollback/cutback vs. retaining evidence tables vs. destructive schema rollback — kept explicitly distinct

| Action | What it does | Data impact | Reversibility |
|---|---|---|---|
| **Stop an execution path** (role revocation, WAF route block) | Prevents new requests from reaching the handler | None — no schema or data change | Instant, fully reversible |
| **Application rollback/cutback** (redeploy a prior compatible commit) | Removes the route/handler code entirely from the running app | None to existing evidence rows; independently verified compatible with retained additive tables (§C) | Reversible by redeploying forward again |
| **Retaining evidence tables** | A *property* of the above two options, not an action by itself | Preserves every correction/conflict row already created | N/A |
| **Destructive schema rollback** (`DROP TABLE`) | Physically removes the additive tables and every row they hold | **Irreversible loss of any existing correction/conflict evidence** (independently demonstrated, §C Scenario 2); also leaves `_prisma_migrations` bookkeeping in an unsupported, drifted state (§C finding) | Not reversible; forward-reapplication recreates empty tables only, not the destroyed rows |

### 5. Safe incident-response sequence (explicit, operationally usable default)

1. **Assess:** confirm whether the incident is caused by the correction *workflow itself* (a defect in `correctSmsOptOut`/its route) or by something else that merely touches the same tables/patients.
2. **Contain, without destroying evidence:** if the workflow itself is implicated, revoke/suspend the specific role(s) or accounts able to invoke it (§3) — this stops new invocations in seconds, with zero schema change and zero data loss.
3. **If containment via access control is insufficient** (e.g. a defect reachable without the intended role gate — which would itself be a separate, more severe finding requiring its own incident path), deploy the last known-good compatible application commit. Do **not** drop the additive tables as part of this step — §C independently confirms a prior-commit application operates correctly with the additive tables retained.
4. **Never physically drop `CommunicationConsentConflictBucket` or `PatientLegacyConsentCorrection` as an incident-response action** once either has ever held real data — §C Scenario 2 independently demonstrates this destroys evidence irrecoverably, and §C's bookkeeping finding shows there is no tool-supported path back.
5. **Forward-fix** once the defect is understood, preferring a corrected deployment over any schema change.
6. **Record the incident and every action taken** in `AuditLog`/`ActivityLog` per the codebase's existing audit conventions (`writeAuditLogInTx` is already used by the correction path itself — see `legacyConsentCorrection.ts`), plus a `RISK_REGISTER.md` entry if the incident reveals a new or elevated risk.

### 6. Conditions that would justify a future, narrowly scoped kill switch

- The workflow gains any automatic, scheduled, or bulk-invocation path (a defensible trigger, since a kill switch's value scales with unattended blast radius — currently near-zero, since every invocation is one authenticated human action).
- A real incident occurs where role-based containment (§3) proves too slow or too coarse (e.g. many distinct staff accounts across many clinics would need simultaneous suspension).
- The workflow's scope expands beyond the single `SMS_OPT_OUT` field it corrects today (`PatientLegacyConsentField` enum currently has exactly one member) to cover higher-volume or higher-risk fields.
- A specific `PlatformSetting`-backed runtime toggle design already exists and was recommended (not implemented) by PMVR Phase B1: `privacy.legacyConsentCorrection.runtimeEnabled`, default `false`, no migration required, mirroring the existing `privacy.dataRetention.runtimeEnabled` pattern (`server/src/routes/platformAdmin.ts:1050-1068`, verified present and functioning for the data-retention case in this task's targeted code inspection). This is no longer merely a ready-to-build follow-up: it is already being built in **PR #186** (`fix/kvkk-high008-runtime-toggle`, `OPEN`, not merged — verified via `gh pr view 186` in this correction pass, see §0 above). This task did not inspect or modify PR #186's code (constraint: no runtime implementation changes; see §8).

### 7. Who should authorize a future kill switch, and required observability/audit evidence

- **Authorization:** the same risk-owning role(s) responsible for closing R-061 itself — this is a program/compliance decision, not an engineering judgment call, precisely because it trades an evidence-integrity risk (silent disable) against an unattended-blast-radius risk (no disable). This task does not have, and does not claim, that authorization.
- **Required observability if built:** every toggle flip must itself be an `AuditLog`/`ActivityLog`-recorded, actor-attributed event (matching the existing `privacy.dataRetention.runtimeEnabled` route's own admin-only, audited pattern); the toggle's current state must be readable via an admin-only, audited `GET` endpoint (already precedented); no toggle should default to anything other than the current no-flag behavior on introduction.

### 8. Explicit statement — this decision does not authorize uncontrolled continued execution during an incident

Documenting "no kill switch exists, and here is why that is currently defensible" is **not** a statement that the workflow may keep running unconditionally during a genuine incident. §5 above defines a concrete, non-destructive containment path (role/access revocation, then application rollback if needed) that is available *today*, without any new code. The absence of a purpose-built flag does not mean the absence of any control — it means the control is access-level and deployment-level rather than a single environment variable.

### 9. Explicit statement — enabling flags and running backfills are outside this task

This task enabled no `COMMUNICATION_CONSENT_*` flag, ran no reconciliation/enforcement mode above `disabled`/`audit` defaults in any disposable environment beyond what the pre-existing test suites already exercise as their own test fixtures, and ran no backfill script against any database other than the disposable ones described in §2, using only synthetic fixture data equivalent to what the project's own test suites already create and delete for each test run.

## Part F — Documentation and evidence

This document is the primary new evidence artifact. Cross-references were added to (see §8 for exact diff):
- `RISK_REGISTER.md` — R-061 entry, appending an independent-re-verification note (not rewriting PMVR's or prior entries).
- `NORAMEDI_MASTER_TRACKER.md` — §6 F0-011-P2 section and top-of-file dated entry.
- `CURRENT_PHASE.md` — top-of-file dated entry.

`KVKK-HIGH-006` (Direct Default-Clinic Scope Remediation) was not implemented, inspected for implementation purposes, or touched by this task — it is explicitly out of scope per this task's own instructions.

## Status-language legend (per instruction, do not over-claim)

- **Statically inspected:** Part D item 7 (retention job scoping), Part E §1/§3 (route authorization gating, cross-referenced from Part A's executed tests), Part E §6 (PlatformSetting pattern).
- **Tests passed: yes — 193/193 targeted/affected assertions across 9 suites (Part A); full repository suite (~60 files) not run — see "Not verified by this task" below.**
- **Unit/integration-tested (independently executed, this task):** Part A, all 9 suites, 193 assertions.
- **Database-rehearsed (independently executed, this task):** Part B (migration-forward), Part C (both rollback scenarios, bookkeeping finding, retained-schema cutback compatibility test).
- **Independently verified (this task, not reused from PMVR or any prior report):** Parts A, B, C, D in full; the one exception is Part D item 7, which is statically inspected and explicitly labeled as such above.
- **Not verified by this task:** the full (~60-file) project test suite (§A); an external human accept/reject decision on R-061 (§E — not this task's authority); PR #184's production-deployment narrative (§0 — out of this task's scope; production was not accessed).

## Residual risks and follow-ups

0. **R-046 remains `OPEN`** (not `MITIGATED`). This task independently satisfies R-046's disposable-rehearsal acceptance criteria (empty- and populated-table rollback rehearsal, tenant-impact evidence) but not its full-production-verification criteria (cross-tenant negative verification and audit verification against the actual production database) — those remain outstanding and are explicitly out of this task's permitted scope (no production access). See §D cross-reference above.
1. **R-061 remains `OPEN`.** This task supplies independently-verified rationale and a documented containment sequence (§E.5) but does not, and cannot, self-authorize closing it. **PR #186** (`fix/kvkk-high008-runtime-toggle`, task KVKK-HIGH-008-F1, `OPEN`, not merged, `MERGEABLE`/`CLEAN` — verified via `gh pr view 186`, §E.0) is a parallel, already-underway implementation of the recommended `privacy.legacyConsentCorrection.runtimeEnabled` toggle; it was not technically reviewed by F0-011-P2. The program has already authorized building the toggle — the remaining decision is not "accept no flag or authorize building," it is external acceptance, merge, deployment, and production verification of PR #186. R-061 remains `OPEN` until all of those occur.
2. **`_prisma_migrations` bookkeeping fragility** (§C) is a new, more specific finding than previously documented — recorded as new risk row **R-070** in `RISK_REGISTER.md`, kept `OPEN` (not closed by this pass). Concrete failure mode: an operator/tool could reach an incorrect belief about actual schema state after any future hand-authored physical rollback, not just these two migrations, because `_prisma_migrations` does not self-reconcile and Prisma's own `migrate resolve --rolled-back` refuses to act on a cleanly-applied migration. Hardened mitigation (see `RISK_REGISTER.md` R-070): avoid physical rollback of additive migrations by default (retain schema, forward-fix); if an exceptional physical rollback is ever authorized, require verified backup/export, approved reverse-DDL, explicit schema-and-ledger reconciliation, post-rollback schema verification, `_prisma_migrations` verification, and DBA/program approval; direct `_prisma_migrations` mutation (as used in this rehearsal) is emergency-only, unsupported, and not a documented production procedure.
3. **`CommunicationConsentConflictBucket` has no FK constraints** on `organizationId`/`clinicId` (§B). **Classification: verified low risk, not a new risk row.** Concrete failure-mode analysis: without an FK, a malformed or stale `organizationId`/`clinicId` string could theoretically be written to this table (no referential-integrity enforcement at the database layer). However, the table (a) carries no patient identifier at all — by design, it is a pure aggregate counter (channel/purpose/reasonCode/hour-bucket + occurrence count) — so a malformed row cannot itself leak or misattribute patient data; (b) is only ever written by `recordCommunicationConsentConflict`, which receives `organizationId`/`clinicId` from the same authenticated, already-validated request context used by every other scoped write in this codebase, not from unvalidated external input; and (c) is read only through the same org/clinic-scoped query pattern verified cross-tenant-safe in Part D. The worst realistic outcome of a malformed id is an orphaned aggregate-count row invisible to every legitimate tenant query — an operational/data-hygiene nuisance, not a KVKK/tenant-isolation defect. Not escalated to a new risk row.
4. **Full project test suite** was not run (§A) — optional per this task's instructions, but a genuine coverage gap if a future task needs stronger confidence outside the HIGH-007/HIGH-008 surface.
5. **PR #184's production-deployment narrative** was not independently re-verified by this task (out of scope — no production access is permitted here); it remains exactly as accepted/unaccepted as `RISK_REGISTER.md` already records it.

## Explicit non-actions

- **Production was not touched.** No production database, environment variable, credential, storage, or service was accessed, read, or written by this task. All work occurred against a disposable Docker Postgres container and an isolated git worktree.
- **No feature flag was enabled.** No `COMMUNICATION_CONSENT_*` environment variable was set to a non-default value in any persisted configuration; test suites' own internal fixtures (which explicitly instantiate specific mode combinations as isolated unit-test inputs, not as a running server configuration) are the only place any mode other than the default appears, and that is the pre-existing, unmodified behavior of those test files.
- **No backfill was run.** `backfillCommunicationPreferences.ts` was invoked only in `--report` (read-only, no-DB-write) mode, exclusively by the pre-existing, unmodified `communicationPreferenceReconciliationReport.test.ts` suite, exactly as that suite already does independent of this task.
- **KVKK-HIGH-006 was not implemented**, and no route-scoping runtime code was changed anywhere in this task.
