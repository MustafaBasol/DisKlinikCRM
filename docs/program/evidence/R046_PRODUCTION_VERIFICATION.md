# R-046 — Production Verification Completion Package

**Task ID:** R046-PRODUCTION-VERIFICATION (parallel task C)
**Date:** 2026-07-28
**Worktree:** `E:\Ek Gelir\Siteler\DisKlinikCRM-r046`, branch `audit/r046-production-verification`, created from `origin/main` @ `94cc4ac58f0487dd186886878c5628627f0b1ce3` (PR #241 merge — the current tip of `origin/main` at task start; the task brief's stated baseline `26c6c339a7cd8db06b1707c059f7f27857f45e61` is two merges behind this and was superseded before this task began, see §0).
**Primary working tree:** not modified. Only read-only `git fetch`/`git rev-parse`/`git branch -a` were run against it before this worktree was created.

## Status

`READY_FOR_PRODUCTION_READ_ONLY_VERIFICATION`

**Not** `CLOSED_VERIFIED`. **Not** `CLOSURE_PROPOSED_AWAITING_OPERATOR_EVIDENCE` — that status is reserved for the point after the operator has run §6's commands and pasted results back into this file (or a follow-up file); that has not happened yet. This document prepares the exact operator commands and reconciles every closure criterion, but R-046 itself **remains `OPEN`** in `RISK_REGISTER.md` (see §7).

## 0. Baseline correction

The task brief specified `origin/main @ 26c6c339a7cd8db06b1707c059f7f27857f45e61` (PR #240's merge commit). At task start, `origin/main`'s actual tip was `94cc4ac58f0487dd186886878c5628627f0b1ce3` (PR #241, `docs/f1-001-impact-test-selection-architecture`), two merges ahead. `docs/program/` does not exist at all on the `feature/kvkk-crit-003-security-incident-foundation` branch this session started on (confirmed: `git cat-file -e <branch>:docs/program` fails), so the worktree was built from the current, actual `origin/main` tip rather than the stale hash, to avoid working from an outdated tracker/risk-register snapshot. No file this task touches differs in content between the two commits (verified: `git diff 26c6c339..94cc4ac -- docs/program/RISK_REGISTER.md server/prisma/migrations` is limited to the unrelated F1-001 risk row R-072).

## 1. What R-046 governs (exact scope)

`RISK_REGISTER.md` row R-046 (line 110): the risk that the KVKK-HIGH-007 continuation migration — merged as PR #175, merge commit `1da9586995b625624b7385c14e70ba6a322def73` — was deployed to production **without independently verified rollback and tenant-impact evidence**, creating a risk of irrecoverable data/schema damage.

**Exact migrations in scope** (`server/prisma/migrations/`):
- `20260719120821_kvkk_high007_consent_reconciliation` — creates `CommunicationConsentConflictBucket` (+1 index on pre-existing `OperationalEvent`).
- `20260719155318_kvkk_high008_legacy_consent_correction` — creates enum `PatientLegacyConsentField` + table `PatientLegacyConsentCorrection` (+4 FKs).

R-046's evidence chain also carries forward `20260720180000_add_platform_admin_audit_event` (PR #186, additive `PlatformAdminAuditEvent` table) as a directly related later migration exercising the same audit path this row's "audit-log behavior" criterion covers — it is tracked jointly in prior evidence and is included in this task's fresh verification for the same reason.

**Affected models:** `CommunicationConsentConflictBucket` (aggregate-only, no patient identifier, no FKs — deliberate design), `PatientLegacyConsentCorrection` (patient-identifying, FK-enforced to `Organization`/`Clinic`/`Patient`/`User`, append-only), `PlatformAdminAuditEvent` (platform-admin action audit trail).

**Tenant/clinic scoping:** both consent-adjacent tables carry `organizationId`+`clinicId`; `PatientLegacyConsentCorrection` additionally FKs to `patientId`. Service-layer authorization is enforced in `server/src/services/communicationConsent/legacyConsentCorrection.ts` and `communicationConsentConflictTracker.ts`, called from `server/src/routes/communicationPreferences.ts` after `loadScopedPatient` resolves and authorizes the caller's `organizationId`/`clinicId` against the target patient.

## 2. Prior R-046 evidence — reconciled

| Date | Task | Contribution | Classification |
|---|---|---|---|
| 2026-07-20 | KVKK-HIGH-008-PMVR (PR #185) | Author-reported disposable-Postgres migration rehearsal (3 scenarios), 483 assertions/19 suites, migration-ordering analysis, initial rollback/cutback plan (§11 of [evidence](KVKK-HIGH-008-PMVR_POST_MERGE_READINESS_EVIDENCE.md)) | Author-reported, not yet independently re-verified (per this document's own §12 non-authorization statement) |
| 2026-07-20 | PR #184 | Operator-supplied production evidence: migration applied (64/64), `prisma migrate status` clean | `VERIFIED_USER_SUPPLIED_PRODUCTION_EVIDENCE` — narrative only, no raw command transcript committed as a standalone artifact |
| 2026-07-20 | F0-011-P2 (PR #187) | **Independent** re-verification, fresh worktree/session: empty-table rollback (clean), populated-table rollback (destructive, demonstrated not asserted), `_prisma_migrations` bookkeeping-drift finding (→ new risk R-070), 14/14 cross-tenant isolation assertions (0 leakage), pre-HIGH-007 app-client compatibility test | `VERIFIED_DISPOSABLE_REHEARSAL` — [full evidence](F0-011-P2_KVKK_HIGH007_HIGH008_ROLLBACK_TENANT_VERIFICATION.md) |
| 2026-07-20 | KVKK-HIGH-008-F1-PROD-DOCS | Operator-supplied production evidence for PR #186/#187: 65/65 migrations, PM2 health, runtime toggle effective-`false`, `PlatformAdminAuditEvent`/`PatientLegacyConsentCorrection` counts both `0` | `VERIFIED_USER_SUPPLIED_PRODUCTION_EVIDENCE` — [full evidence](KVKK-HIGH-008-F1_PRODUCTION_DEPLOYMENT_VERIFICATION.md) |
| 2026-07-21 | KVKK-HIGH-008-F1-PROD-BEHAVIORAL-SAFE-VERIFY | Operator-executed, non-activating production behavioral pass: unauthenticated-PATCH rejection confirmed live (`401`), 10/10 database invariants unchanged before/after; authenticated policy/invalid-payload checks `BLOCKED / NOT EXECUTED` (login credential rejection, not a finding) | `VERIFIED_USER_SUPPLIED_PRODUCTION_EVIDENCE` (partial) — [full evidence](KVKK-HIGH-008-F1_PRODUCTION_SAFE_BEHAVIORAL_VERIFICATION.md) |

**Consistent conclusion across every prior pass:** disposable-rehearsal criteria (empty + populated rollback, tenant isolation, application-cutback compatibility) are satisfied. Full production cross-tenant negative verification and full production audit verification are **not** performed by any prior task and are explicitly named as the reason R-046 remains `OPEN` in every one of the above documents, including the most recent (2026-07-21).

## 3. What this task adds (agent-executed, disposable-only — see §8 for the safety boundary this stayed inside)

All of §3 was executed in this session against a **dedicated, disposable Docker Postgres container created for this task only** (`r046verify-pg`, image `postgres:16-alpine`, resolved version `PostgreSQL 16.14` — matches production's documented version per `PRODUCTION_TOPOLOGY.md` — host-only port `55461`, credentials generated for this task, destroyed at the end of this task per §9). No production system, credential, or data was touched by any command in this section.

### 3.1 Fresh independent migration-apply verification

`npx prisma migrate deploy` against an empty database: **65/65 migrations applied, exit 0**, "All migrations have been successfully applied." `npx prisma migrate status`: "Database schema is up to date!" `_prisma_migrations` row count independently confirmed via direct `psql`: `65`.

### 3.2 Fresh independent schema-integrity verification

Direct `psql \d+` introspection of both tables matches the committed migration SQL exactly (columns, types, nullability, defaults, PK, indexes, unique constraints, FK `ON DELETE`/`ON UPDATE` rules) — reproduces F0-011-P2 §B's finding independently, this session, this database.

### 3.3 New committed, repeatable verification script

`server/scripts/verify-kvkk-high007-high008-rollback-tenant.ts` — formalizes what KVKK-HIGH-008-PMVR and F0-011-P2 each did with throwaway scripts (explicitly deleted after use per their own §8/Part F) into a **permanent, repeatable** script, following this repository's existing `scripts/verify-*-lifecycle.ts` convention (disposable-DB-only, not wired into `npm test`, imports and calls the real unmodified service functions rather than reimplementing them). Running it end-to-end against the fresh database from §3.1:

```
Part 1 — schema integrity (read-only)
  PASS  CommunicationConsentConflictBucket has exactly the expected indexes/constraint
  PASS  PatientLegacyConsentCorrection has exactly the expected indexes/constraints/FKs

Part 2 — rollback rehearsal, empty tables (destructive DDL, disposable DB only)
  PASS  reverse DDL cleanly drops both migrations while tables are empty
  PASS  pre-existing data is unaffected by the rollback

Part 3 — forward-recovery (re-apply committed migration SQL after rollback)
  PASS  forward SQL re-creates both tables with the identical schema

Part 4 — multi-tenant isolation (real service functions, deliberately colliding data)
  PASS  correctSmsOptOut assigns the correct clinicId per tenant despite identical patient name
  PASS  cross-tenant correction attempt is rejected with clinic_scope_mismatch, no mutation
  PASS  listLegacyConsentCorrections is clinic-scoped: tenant A cannot see tenant B rows
  PASS  getLegacyConsentCorrectionDetail refuses to return tenant B's row under tenant A's scope
  PASS  recordCommunicationConsentConflict buckets are clinic-scoped despite identical channel/purpose/reasonCode/hour

Part 5 — rollback rehearsal, populated tables (DESTRUCTIVE — run last, ends the script)
  PASS  reverse DDL against populated tables drops all rows irrecoverably (destructive-impact proof, not merely asserted)

11 passed, 0 failed
```

This independently reproduces, in a fresh session with a freshly created disposable database (not reused from F0-011-P2 or PMVR), every disposable-rehearsal finding those two prior tasks reported:
- Rollback is data-loss-free only while both tables are empty (Part 2).
- Once either table holds rows, the same reverse DDL destroys them irrecoverably (Part 5) — destructive-impact demonstrated, not asserted.
- Raw-SQL forward-recovery reproduces the identical schema (Part 3), but does **not** reconcile `_prisma_migrations` — re-confirms R-070's bookkeeping-drift finding still holds (a subsequent `prisma migrate deploy` after this kind of manual forward-recovery would report "No pending migrations to apply" without having run through Prisma's own migration engine).
- Zero cross-tenant leakage across 5 assertions using two tenants with deliberately colliding patient names, idempotency keys, and conflict-bucket bucket keys (Part 4) — a smaller, independently-designed assertion set than F0-011-P2's 14, covering the same four call sites (`correctSmsOptOut`, `listLegacyConsentCorrections`, `getLegacyConsentCorrectionDetail`, `recordCommunicationConsentConflict`).

### 3.4 New: failed-migration-recovery rehearsal (previously undocumented for this program)

Every prior R-046 pass covers **physical rollback after a migration finished successfully** (R-070). None covers the distinct case of **a migration failing partway through `prisma migrate deploy` itself** — this task's "failed migration recovery is documented" requirement was previously unmet. Rehearsed against a second disposable database in the same container (`r046failedmig`) using a temporary migrations-folder copy (`server/.tmp-r046-failedmig/`, not committed — see §9) with a single deliberately invalid SQL statement appended to a copy of the HIGH-007 migration file:

1. `prisma migrate deploy` applied all 62 prior migrations, then failed on the corrupted 63rd with **`P3018`** (`syntax error at or near "valid"`).
2. Direct `psql` query of `_prisma_migrations` for that migration: `finished_at` = `NULL`, `applied_steps_count` = `0`. Direct `psql` check: neither `CommunicationConsentConflictBucket` nor the deliberately-broken table exist. **The whole migration file is wrapped in one transaction and rolled back atomically on failure — no partial schema objects are left behind**, for this migration (neither HIGH-007's nor HIGH-008's SQL contains any non-transactional statement such as `CREATE INDEX CONCURRENTLY`).
3. `prisma migrate status` after the failure: exit `1`; lists the two later migrations as "not yet applied" but does not itself restate the failure reason in that command's own output — an operator relying on `migrate status` alone, without also checking `_prisma_migrations.finished_at`, could miss that a migration is in a failed state versus simply pending. Recorded as an observation, not escalated to a new risk row (the `deploy` command's own error output, §step 1, is unambiguous).
4. Retrying `prisma migrate deploy` without resolving first: refused with **`P3009`** ("migrate found failed migrations in the target database, new migrations will not be applied").
5. **Recovery, reproduced successfully:** restored the migration file to its real, uncorrupted committed content; ran `npx prisma migrate resolve --rolled-back 20260719120821_kvkk_high007_consent_reconciliation` ("Migration ... marked as rolled back"); ran `prisma migrate deploy` again → all three remaining migrations (the corrected HIGH-007, HIGH-008, and PR #186's audit-event migration) applied cleanly. Final state independently confirmed: `65/65` `_prisma_migrations` rows with `finished_at` set; all three named tables (`CommunicationConsentConflictBucket`, `PatientLegacyConsentCorrection`, `PlatformAdminAuditEvent`) present.

**Documented recovery procedure (failed-mid-apply case, distinct from R-070's after-success-physical-rollback case):**
1. Do not attempt to re-run `prisma migrate deploy` immediately — it will refuse with `P3009`.
2. Inspect the failure: the `deploy` command's own error output names the exact migration and the underlying database error; cross-check `_prisma_migrations` (`finished_at IS NULL` for that migration) if `status` alone is ambiguous.
3. Because the migration transaction rolled back atomically (confirmed above for these two migrations — verify this holds for any future migration before relying on it, since a migration containing an explicitly non-transactional statement would not have this guarantee), no manual schema cleanup is needed before resolving.
4. Fix the underlying issue (in this rehearsal: the SQL statement itself; in production, likely an environment/permissions/lock issue rather than bad SQL, since this exact file is already merged and reviewed).
5. Run `prisma migrate resolve --rolled-back <migration_name>` to tell Prisma's bookkeeping the failed migration did not apply.
6. Run `prisma migrate deploy` again.
7. Independently verify the final state (`prisma migrate status` reports up to date, plus a direct schema check) before considering the incident closed.

This procedure is **read-only-safe to rehearse again** in any future disposable environment; it was not committed as a script (unlike §3.3) because it requires temporarily corrupting a migration-file copy, which does not fit this repository's `scripts/verify-*.ts` convention of exercising real, unmodified code — it is recorded here as a documented, reproducible procedure instead.

### 3.5 Fresh independent test-suite re-execution

Every HIGH-007/HIGH-008-related committed suite re-run against the §3.1 database, fresh, this session:

| Suite | Result |
|---|---|
| `legacyConsentCorrection.test.ts` | 36 passed, 0 failed |
| `legacyReconciliationResolver.test.ts` | 30 passed, 0 failed |
| `communicationConsentAuditReport.test.ts` | 7 passed, 0 failed |
| `communicationPreferencesRoute.test.ts` | 12 passed, 0 failed |
| `communicationConsent.test.ts` | 92 passed, 0 failed |
| `communicationPreferenceBackfill.test.ts` | 7 passed, 0 failed |
| `messagesConsentGate.test.ts` | 4 passed, 0 failed |
| `recallConsentGate.test.ts` | 4 passed, 0 failed |
| `communicationPreferenceReconciliationReport.test.ts` | 9 passed, 0 failed |
| **Total** | **201 passed, 0 failed** |

`legacyConsentCorrection.test.ts` grew from 28 (PMVR/F0-011-P2 baseline) to 36 — additional coverage added since (KVKK-HIGH-008-F1's runtime-toggle gating), consistent with `git log` for that file; not a regression.

### 3.6 New: permanent schema-integrity regression test (wired into `npm test`)

`server/src/tests/kvkkHigh007High008SchemaIntegrity.test.ts` — read-only (no DDL), added to `server/package.json`'s `test` script (new entry `test:kvkk-high007-high008-schema-integrity`, inserted after `test:legacy-consent-correction`) so it runs in the same environment every other DB-backed suite already runs in, on every future `npm test`. Asserts the exact index/constraint/FK set for both tables and their `ON DELETE RESTRICT` rules (a regression to `CASCADE` here would silently delete KVKK correction evidence on an `Organization`/`Clinic`/`Patient`/`User` delete), plus the absence of `deletedAt`/`updatedAt` columns on `PatientLegacyConsentCorrection` (guards its append-only design). Result: `3 passed, 0 failed`. This is the one piece of §3 that provides **ongoing**, not one-time, protection — a future accidental migration that weakens these constraints will fail CI/local `npm test`, not just this one-time audit.

## 4. R-046 acceptance-criteria breakdown (this task's disposition)

| Criterion | Status before this task | Status after this task |
|---|---|---|
| Migration ancestry | Confirmed (PR #175 merge commit ancestor of `main`) | Unchanged — reconfirmed via `git merge-base --is-ancestor` in this worktree |
| Disposable rollback rehearsal (empty tables) | `VERIFIED_DISPOSABLE_REHEARSAL` (F0-011-P2) | Independently reproduced again, fresh session (§3.3 Part 2) |
| Disposable rollback rehearsal (populated tables, destructive) | `VERIFIED_DISPOSABLE_REHEARSAL` (F0-011-P2) | Independently reproduced again, fresh session (§3.3 Part 5); now a **committed, repeatable script** rather than a deleted throwaway |
| Disposable tenant-impact evidence | `VERIFIED_DISPOSABLE_REHEARSAL`, 14/14 (F0-011-P2) | Independently reproduced again, fresh session, 5/5 (§3.3 Part 4) |
| Failed-migration recovery documented | **Not previously covered by any R-046 evidence** | **Newly satisfied** (§3.4) — distinct from R-070's after-success case |
| Constraint/index regression protection | None (one-time evidence only) | **Newly satisfied, ongoing** (§3.6, wired into `npm test`) |
| Production migration-application evidence | `VERIFIED_USER_SUPPLIED_PRODUCTION_EVIDENCE`, narrative only | Unchanged by this task (no production access) — §6 prepares the command package to convert this into a committed raw-transcript artifact |
| Full production cross-tenant negative verification | **Missing** | **Still missing** — see §5 for why this cannot simply be "run now," and §6 for the safe path forward |
| Full production audit verification | **Missing** | **Still missing** — production has `0` rows in every relevant table (per KVKK-HIGH-008-F1-PROD-DOCS), so there is nothing to inspect yet; see §5 |
| Production schema state | `VERIFIED_USER_SUPPLIED_PRODUCTION_EVIDENCE` | Unchanged by this task — §6 prepares read-only commands to reconfirm and commit raw output |

## 5. Why "full production cross-tenant negative verification" is not simply executable now

This is the one closure criterion this task cannot responsibly reduce to "run this command." Two structural facts constrain it, both already established by prior evidence and unchanged by this task:

1. **Production currently has zero rows** in `PatientLegacyConsentCorrection`, `CommunicationConsentConflictBucket`, and `PlatformAdminAuditEvent` (KVKK-HIGH-008-F1-PROD-DOCS §12/§13, reconfirmed as of 2026-07-20/21 by the two most recent production passes). A behavioral cross-tenant test needs either real data to inspect (none exists) or a live attempt to create data across tenants.
2. **A live cross-tenant mutation *attempt* against production, even one expected to be rejected, requires touching a real patient record.** Prior evidence (`KVKK-HIGH-008-F1_PRODUCTION_SAFE_BEHAVIORAL_VERIFICATION.md` §4.4) already examined this exact question for the single-tenant disabled-route case and concluded a real patient is required and is **prohibited as a test subject** — `loadScopedPatient` resolves a real patient via `findFirst` *before* any gate/scope check runs, so a synthetic non-existent ID 404s before exercising anything. The same reasoning applies, with strictly higher stakes, to a cross-tenant variant: a bug that fails open would mutate a real patient's real consent data. This task's safety boundary explicitly prohibits modifying real patient data, and prior tasks independently reached the same conclusion for a materially easier case — so this task does not propose a live cross-tenant mutation attempt against production, and recommends against one.

**What remains legitimately available, read-only, and safe (see §6 for exact commands):**
- Re-confirm production schema/constraint/FK state matches §3.2's disposable findings (no data required).
- Re-confirm `_prisma_migrations` state for the three named migrations (no data required).
- If/when real rows eventually exist (organic staff usage), read-only, aggregate/count-level inspection that each row's `organizationId`/`clinicId` is internally consistent with its `patientId`'s actual clinic — a data-integrity check, not a live attack simulation.
- Static/`EXPLAIN`-based confirmation that the deployed route code's query shape is scoped by `organizationId`/`clinicId` (code-and-plan reading, not live cross-tenant probing).

**Recommendation to the decision owner (not a decision this task makes):** treat the disposable-rehearsal tenant-isolation evidence — now independently reproduced twice (F0-011-P2's 14/14, this task's 5/5), against real, unmodified service code — as the operative tenant-isolation evidence for R-046, and scope "full production audit verification" to activate automatically the first time the workflow is used organically in production (a read-only follow-up check at that point, not a synthetic test today). If the decision owner instead requires a live production cross-tenant behavioral test before closing R-046, that is a distinct, higher-stakes decision requiring its own explicit controlled-activation authorization (named approver, scheduled window, consented or synthetic test subjects, rollback plan) — outside this task's scope to authorize or perform, per the same non-authorization posture every prior R-046/KVKK-HIGH-008 evidence document has maintained.

## 6. Operator-required production commands (read-only; not executed by this task)

**Every command below is read-only** (`SELECT`, `git log`, `pm2`/`curl` status checks) and does not write to `PlatformSetting`, does not create a `PlatformAdminAuditEvent`, does not touch any patient record, and does not deploy or restart anything. Run from the production host (`/var/www/noramedi` per `PRODUCTION_TOPOLOGY.md`), in this order. **Paste the raw output back into this file (a new `## 6a. Operator-executed results` section, or a dedicated follow-up evidence file linked from here) — a narrative summary is not sufficient; this is precisely the "no independently-executed repository artifact" gap every prior R-046 pass has flagged.**

### 6.1 Migration-table verification

```bash
psql "$DATABASE_URL" -c "
SELECT migration_name, finished_at IS NOT NULL AS applied, rolled_back_at IS NOT NULL AS rolled_back
FROM _prisma_migrations
WHERE migration_name IN (
  '20260719120821_kvkk_high007_consent_reconciliation',
  '20260719155318_kvkk_high008_legacy_consent_correction',
  '20260720180000_add_platform_admin_audit_event'
)
ORDER BY migration_name;
"
psql "$DATABASE_URL" -c "SELECT count(*) AS total_migrations, count(*) FILTER (WHERE finished_at IS NULL) AS unfinished FROM _prisma_migrations;"
```
**Expected:** all three rows `applied=t`, `rolled_back=f`; `unfinished=0`; `total_migrations=65`. **Stop condition:** if `unfinished > 0` or `rolled_back=t` for any of the three, stop and escalate — do not proceed to §6.2.

### 6.2 Production read-only schema verification

```bash
psql "$DATABASE_URL" -c "\d+ \"CommunicationConsentConflictBucket\""
psql "$DATABASE_URL" -c "\d+ \"PatientLegacyConsentCorrection\""
psql "$DATABASE_URL" -c "
SELECT tc.constraint_name, rc.delete_rule, rc.update_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
WHERE tc.table_name = 'PatientLegacyConsentCorrection' AND tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.constraint_name;
"
```
**Expected:** identical to §3.2's disposable output (4 indexes on `CommunicationConsentConflictBucket`, 0 FKs; 4 indexes + 4 `RESTRICT`/`CASCADE` FKs on `PatientLegacyConsentCorrection`) — reproduced verbatim in §3.2 above for comparison. **Stop condition:** any difference from §3.2's output — stop and escalate, do not proceed.

### 6.3 Safe tenant-impact inspection (aggregate/count-only, no PII)

```bash
psql "$DATABASE_URL" -c "
SELECT count(*) AS total_corrections, count(DISTINCT \"organizationId\") AS distinct_orgs, count(DISTINCT \"clinicId\") AS distinct_clinics
FROM \"PatientLegacyConsentCorrection\";
"
psql "$DATABASE_URL" -c "
-- Integrity check: every correction's clinicId must match its own patient's clinicId.
-- Returns 0 rows if healthy; any row returned is an immediate stop condition.
SELECT c.id, c.\"organizationId\", c.\"clinicId\", p.\"clinicId\" AS patient_actual_clinic_id
FROM \"PatientLegacyConsentCorrection\" c
JOIN \"Patient\" p ON p.id = c.\"patientId\"
WHERE c.\"clinicId\" != p.\"clinicId\" OR c.\"organizationId\" != p.\"organizationId\";
"
psql "$DATABASE_URL" -c "
SELECT count(*) AS total_buckets, count(DISTINCT \"organizationId\") AS distinct_orgs, count(DISTINCT \"clinicId\") AS distinct_clinics
FROM \"CommunicationConsentConflictBucket\";
"
```
**Expected:** the first and third queries report counts only (no PII); if `total_corrections`/`total_buckets` are both `0` (expected, per §5), the isolation integrity query trivially returns 0 rows and this is recorded as "no data yet to inspect," not as a passed behavioral test. **Stop condition:** the middle query returning any row at all — that would mean a production cross-tenant scoping violation already exists; stop immediately and escalate as a security incident, do not attempt any remediation via this command package.

### 6.4 Audit evidence collection (aggregate/count-only)

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM \"PlatformAdminAuditEvent\";"
psql "$DATABASE_URL" -c "
SELECT action, count(*) FROM \"AuditLog\"
WHERE action = 'patient_legacy_sms_opt_out_corrected'
GROUP BY action;
"
```
**Expected:** consistent with §6.3 — `0` rows if the workflow has not yet been used organically. If non-zero, this is the trigger to run a follow-up, dedicated read-only audit-attribution check (row-level, not included here, since it would require deciding what PII-safe fields are acceptable to view — a separate, smaller task once there is real data to design that check against).

### 6.5 Authenticated endpoint re-attempt (only if valid platform-admin credentials are available)

Re-run `KVKK-HIGH-008-F1_PRODUCTION_SAFE_BEHAVIORAL_VERIFICATION.md`'s Test C1 (`GET` read-only policy endpoint) and Test C3 (authenticated invalid-payload rejection) — both were `BLOCKED / NOT EXECUTED` in that pass due to a login credential rejection, not attempted since. This task did not obtain or request credentials and did not re-attempt this step. If credentials are available now, re-running exactly that prior evidence file's §4.1/§4.3 command package (unchanged, still non-activating) would close that specific gap without requiring any new command design.

## 7. Risk register disposition

`RISK_REGISTER.md` R-046 **remains `OPEN`**. This task's own disposable-rehearsal contribution (§3) does not change that — it was already `VERIFIED_DISPOSABLE_REHEARSAL` before this task, from F0-011-P2. This task's actual contribution to R-046's closure path is: (a) a second, independent, fresh-session reproduction of every disposable-rehearsal finding, now via a **committed, repeatable** script instead of throwaway scripts; (b) closing the previously-uncovered failed-migration-recovery documentation gap; (c) adding permanent, CI-wired regression protection for the schema; (d) an exact, safety-reviewed operator command package for the specific remaining production-evidence gap, with explicit stop conditions.

**`RISK_REGISTER.md` itself is deliberately not modified by this task** (this task's own conflict-avoidance instructions exclude the central tracker, risk register, final-reconciliation, and launch-gate files, to avoid colliding with other in-flight parallel tasks touching those same shared files). Whoever next reconciles `RISK_REGISTER.md` should link this document from R-046's own evidence-links cell, in the same append-only, dated-bracketed-note style every prior R-046 update in that file already uses — no existing wording in that row needs to change, since this task does not move R-046 out of `OPEN`.

## 8. Safety boundary compliance

- **No destructive production rollback was executed or proposed.** §3's rollback rehearsals ran exclusively against disposable, throwaway Postgres containers created for this task and destroyed at the end of it (§9).
- **No real patient data was read, created, or modified.** §3.3's tenant-isolation test uses synthetic organizations/clinics/users/patients (`R046 Verify Org A`/`B`, throwaway UUIDs, a fixed synthetic patient name mirroring F0-011-P2's own precedent) created and destroyed entirely within the disposable database.
- **No schema downgrade was performed on the production database.** No command in §3 or §3.4 connected to any production host, credential, or `DATABASE_URL`.
- Every rollback/forward-recovery proof in §3.3/§3.4 is one of the permitted forms: **disposable database rehearsal** (§3.3) and **repository-backed rollback procedure verified against an equivalent environment** (§3.4, using the real, unmodified committed migration SQL against a Postgres version matching production's documented version).

## 9. Cleanup

The disposable container (`r046verify-pg`) and its two databases (`r046verify`, `r046failedmig`) are destroyed (`docker rm -f`) after this evidence file is finalized. The temporary migrations-folder copy (`server/.tmp-r046-failedmig/`) used only for §3.4 is untracked and excluded from this task's commit — it is not part of the diff this PR introduces. Nothing under `server/.tmp-*` is committed, matching the precedent set by every prior R-046-adjacent evidence document's own temp-file handling.

## 10. Non-authorization statement

This document, and the `audit/r046-production-verification` task that produced it, record disposable-environment evidence and a prepared, safety-reviewed operator command package only. They do not execute any production command, do not authorize a live production cross-tenant test against real patient data, do not activate any feature flag, do not change any production environment variable, process, or database, and do not declare R-046 `MITIGATED` or `CLOSED_VERIFIED`. Moving R-046 to `CLOSURE_PROPOSED_AWAITING_OPERATOR_EVIDENCE` requires the operator to run §6 and commit its raw output; moving it beyond that to any closed state requires the decision owner's explicit resolution of §5's structural gap (either accepting disposable-rehearsal tenant-isolation evidence as sufficient, or separately authorizing a controlled-activation production test) — neither of which this task performs.
