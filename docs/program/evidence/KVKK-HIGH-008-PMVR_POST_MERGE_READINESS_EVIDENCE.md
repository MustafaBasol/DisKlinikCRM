# KVKK-HIGH-008-PMVR — Post-Merge Deployment Readiness and Production Migration Verification (Phase B1 evidence)

Task: KVKK-HIGH-008-PMVR. Phase: parallel operational verification track under F0 program control. Scope: **Phase B1 only** — repository evidence, independent disposable-Postgres migration rehearsal, deployment-readiness analysis, and production read-only preflight planning. No production access was performed or authorized in this phase.

Worktree: `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\kvkk-high-008-readiness`, branch `audit/kvkk-high-008-post-merge-readiness`, created from `origin/main` at baseline commit **`c49466e15daa66933bf5c2e36fe46343e08bfcdd`** (PR #181 merge — "F0-011-P1 — Active KVKK-HIGH-008 Work Baseline and Architecture Freeze Boundary"). The primary working tree (`D:\Mustafa\Siteler\DisKlinikCRM`) was left untouched: only `git status --short`, `git branch --show-current`, and `git rev-parse HEAD` were run against it before this worktree was created; its dirty documentation files were never opened, diffed, or modified by this task.

## 1. Active parallel work / migration ownership check

All 19 local branches were checked for Prisma migration directories newer than PR #180's (`20260719155318_kvkk_high008_legacy_consent_correction`). None exist — no branch anywhere in the local repository owns an unmerged migration stacked after PR #180's. The primary tree's dirty files (`docs/compliance/...`, `docs/program/...`) are documentation-only (F0-012-adjacent reconciliation work) and contain no migration. **Conclusion: no competing/active migration blocks this readiness assessment.**

## 2. PR #175 evidence (repository, not description)

- Merge commit: `1da9586995b625624b7385c14e70ba6a322def73` ("KVKK-HIGH-007 follow-up: legacy/central consent reconciliation, audit-mode readiness, UX hardening (#175)"), parent `7cf7a827277779091b9e34e726eebccd39f624ae`.
- Migration: `server/prisma/migrations/20260719120821_kvkk_high007_consent_reconciliation/migration.sql`.
- Content: `CREATE TABLE "CommunicationConsentConflictBucket"` (+ 3 indexes, 1 unique) and one additional index on the pre-existing `OperationalEvent` table. **Purely additive** — no `ALTER`/`DROP` on any existing table/column/constraint.
- Confirmed ancestor of `origin/main` (`git merge-base --is-ancestor 1da9586 origin/main` → yes).

## 3. PR #180 evidence (repository, not description)

- Merge commit: `e972bfef918471074137bb0f11705d43a1ca2ce5` ("Merge pull request #180 from MustafaBasol/feature/kvkk-high008-legacy-consent-correction"), merging `64b9edeb...` (main) and `e2317d4...` (feature branch, itself already containing a merge of `origin/main`).
- Migration: `server/prisma/migrations/20260719155318_kvkk_high008_legacy_consent_correction/migration.sql`.
- Content: `CREATE TYPE "PatientLegacyConsentField"` enum, `CREATE TABLE "PatientLegacyConsentCorrection"` (+ 3 indexes, 4 FKs to `Organization`/`Clinic`/`Patient`/`User`). **Purely additive.** The migration's own header comment states it was hand-authored specifically to exclude unrelated pre-existing schema drift a `prisma migrate dev` auto-diff would otherwise have bundled in (FK drop/recreate on `ImagingStudy`/`WhatsAppConversationMessage`, a `User` unique-index drop, several `@updatedAt` default drops, a `WhatsAppConnection` column-type change) — none of that is present in the applied SQL, confirmed by direct read of the file.
- Confirmed ancestor of `origin/main`.

## 4. Migration ordering table

| Migration | Order | Owning PR | Affected objects | Backfill | Lock risk | Destructive | Rollback | App compatibility |
|---|---|---|---|---|---|---|---|---|
| `20260719120821_kvkk_high007_consent_reconciliation` | 63rd of 64 | #175 | New table `CommunicationConsentConflictBucket`; 1 new index on existing `OperationalEvent` | None | Low (`CREATE TABLE`/`CREATE INDEX` only, no table rewrite) | No | No down-migration (Prisma migrate has none by design); schema rollback = drop the new table/index, no data loss since nothing pre-existing is touched | Old app code runs unaffected (new table unused); new app code requires the table present |
| `20260719155318_kvkk_high008_legacy_consent_correction` | 64th of 64 (last) | #180 | New enum `PatientLegacyConsentField`; new table `PatientLegacyConsentCorrection` + 4 FKs | None | Low (`CREATE TYPE`/`CREATE TABLE` only) | No | No down-migration; schema rollback = drop the new table/enum, no data loss | Old app code runs unaffected; new app code requires the table present |

Findings against the required determinations:
1. **PR #175 must be applied before PR #180?** Not functionally required — PR #180's table has no FK or data dependency on PR #175's table (confirmed by reading both migration SQL files: `PatientLegacyConsentCorrection` has zero references to `CommunicationConsentConflictBucket`). They are independent schema additions that happen to be sequential in the migration timeline. Scenario C (below) proves PR #180 applies cleanly on a database that only has PR #175 applied, with no ordering hazard.
2. **Does PR #180 assume a backfill/enforcement state from PR #175?** No — verified by code read of `legacyConsentCorrection.ts` and the migration SQL; the two features do not interact at the schema or backfill level.
3. **Destructive?** Neither migration is destructive (no `DROP`/`ALTER` of existing objects).
4. **Default/constraint changes to existing objects?** None.
5. **App-code compatibility before/after?** Both migrations are purely additive; old application code (pre-#175 or pre-#180) continues to run unaffected against a database that has these migrations applied, since it never queries the new tables.
6. **Rollback mechanism?** Schema rollback only (drop the new objects) — no data-correction or forward-fix path is needed because nothing pre-existing is mutated by either migration. This is **schema rollback**, not application cutback, in the taxonomy required by this task.
7. **Concurrent active KVKK work introducing a migration after PR #180?** No — see §1.

## 5. Disposable PostgreSQL environments

PostgreSQL version: **16.14** (matches the production topology evidence in `docs/program/PRODUCTION_TOPOLOGY.md`, "PostgreSQL 16.14 — database noramedi_crm"). Prisma: **7.8.0** (from `server/package.json`). All three scenarios ran in disposable Docker containers (`postgres:16.14` official image), each destroyed immediately after evidence capture. No production credentials were used at any point; each container had its own throwaway password.

| Scenario | Container | Port | Purpose |
|---|---|---|---|
| A | `kvkk-audit-pg-a` | 55501 | Clean `origin/main` — all 64 migrations from empty |
| B | `kvkk-audit-pg-b` | 55502 | Pre-PR #175 state (62 migrations) seeded with representative data, then upgraded through PR #175 + PR #180 |
| C | `kvkk-audit-pg-c` | 55503 | PR #175-applied state (63 migrations) seeded with edge-case data, then PR #180 applied, migration re-run to confirm idempotence, workflow exercised against pre-existing data |
| final (auth suite) | `kvkk-audit-pg-final` | 55504 | Clean DB for the `platformAdmin.test.ts` auth suite |

All four containers were removed (`docker rm -f`) after evidence capture; none remain running.

## 6. Migration rehearsal results

### Scenario A — clean database
```
npx prisma migrate deploy   → exit 0, 64 migrations applied, "All migrations have been successfully applied."
npx prisma migrate status   → exit 0, "Database schema is up to date!"
npx prisma generate         → exit 0, Prisma Client v7.8.0 generated
```

### Scenario B — pre-PR #175 upgrade with pre-existing data
1. Materialized commit `7cf7a82` (pre-PR #175) in a temporary worktree, installed deps, `prisma migrate deploy` → 62 migrations applied cleanly.
2. Seeded synthetic data: 2 organizations (multi-clinic Org A with 2 clinics; single-clinic Org B), 3 clinics, 5 patients covering: eligible-for-correction (`smsOptOut=true`, with and without a recorded timestamp), not-eligible (`smsOptOut=false`), and an ambiguous legacy record (`smsOptOut=true`, `phone=null`, `smsOptOutAt=null`).
3. Advanced the same worktree's files to `origin/main` (bringing in PR #175 + PR #180's migrations and code), reinstalled deps, ran `prisma migrate deploy` again → both new migrations applied cleanly on top of the pre-existing seeded rows, 0 errors.
4. Verification query confirmed: all 5 pre-existing patients intact and unchanged (4 with `smsOptOut=true`, 1 with `false`); new tables (`PatientLegacyConsentCorrection`, `CommunicationConsentConflictBucket`) both start at 0 rows as expected (no backfill logic exists or is needed — both migrations are schema-only); the ambiguous null-value patient's `phone`/`smsOptOutAt` remained `null`, unmutated.
5. `src/tests/legacyConsentCorrection.test.ts` run against this upgraded-with-data database: **28 passed, 0 failed.**

### Scenario C — pre-PR #180 upgrade with edge-case seed data
1. Materialized commit `1da9586` (PR #175 merged, pre-PR #180) in a temporary worktree, `prisma migrate deploy` → 63 migrations applied.
2. Seeded synthetic data: 2 organizations (Org C-A multi-clinic, Org C-B single-clinic), 3 clinics, 5 patients (two eligible in different clinics of the same org, one eligible in a different org, one not-eligible, one ambiguous null-value record).
3. Advanced worktree to `origin/main`, reinstalled deps, ran `prisma migrate deploy` **twice**: first run applied PR #180's migration; second run reported `No pending migrations to apply` (Prisma migrate deploy is itself idempotent/safe to re-run).
4. Exercised the real `correctSmsOptOut` service function directly against the pre-existing seeded data (not fixtures created by the function itself), covering every required representative case:
   - Eligible record in caller's own org/clinic → succeeded (`replay: false`, `newValue: false`).
   - Not-eligible record (`smsOptOut` already `false`) → rejected `legacy_signal_not_present`.
   - **Cross-tenant attempt**: caller scoped to Org C-A/Clinic 1 targeting an Org C-B patient → rejected `clinic_scope_mismatch`, **no mutation occurred**.
   - Same-org, wrong-clinic attempt (patient belongs to Clinic 1, caller scoped to Clinic 2) → rejected `clinic_scope_mismatch`.
   - Re-correcting an already-corrected record → rejected `legacy_signal_already_corrected`.
   - Ambiguous null-value legacy record (`phone=null`, `smsOptOutAt=null`) → corrected successfully, no crash, `previousRecordedAt` correctly recorded as `null`.
   - Repeated execution with the same idempotency key twice → second call returned `replay: true` with the identical correction `id` (no duplicate row).
   - Final tenant-scoped counts: 3 correction rows in Org C-A, **0 in Org C-B** — confirms no cross-tenant leakage of the correction table itself.
5. `src/tests/legacyConsentCorrection.test.ts` run again against this database: **28 passed, 0 failed.**

All temporary seed/exercise scripts (`src/scripts/_auditSeedScenarioB.ts`, `_auditVerifyScenarioB.ts`, `_auditSeedScenarioC.ts`, `_auditExerciseScenarioC.ts`) were synthetic-data-only, used solely inside the disposable temporary worktrees, and deleted before those worktrees were removed. They were never committed.

## 7. Test results (exact commands, working directory `server/`, `DATABASE_URL` pointed at the relevant disposable container)

| Command | Exit | Result |
|---|---|---|
| `npx prisma migrate deploy` (Scenario A) | 0 | 64/64 migrations applied |
| `npx prisma migrate status` (Scenario A) | 0 | up to date |
| `npx prisma generate` (Scenario A) | 0 | client generated |
| `npx tsx src/tests/legacyConsentCorrection.test.ts` (Scenario A) | 0 | 28 passed, 0 failed |
| `npx tsx src/tests/communicationConsent.test.ts` | 0 | 92 passed, 0 failed |
| `npx tsx src/tests/communicationPreferenceBackfill.test.ts` | 0 | 7 passed, 0 failed |
| `npx tsx src/tests/legacyReconciliationResolver.test.ts` | 0 | 30 passed, 0 failed |
| `npx tsx src/tests/communicationConsentAuditReport.test.ts` | 0 | 7 passed, 0 failed |
| `npx tsx src/tests/communicationPreferencesRoute.test.ts` | 0 | 12 passed, 0 failed |
| `npx tsx src/tests/communicationPreferenceReconciliationReport.test.ts` | 0 | 9 passed, 0 failed |
| `npx tsx src/tests/securityIncident.test.ts` | 0 | 55 passed, 0 failed |
| `npx tsx src/tests/messagesConsentGate.test.ts` | 0 | 4 passed, 0 failed |
| `npx tsx src/tests/recallConsentGate.test.ts` | 0 | 4 passed, 0 failed |
| `npx tsx src/tests/patientPrivacy.test.ts` | 0 | 38 passed, 0 failed |
| `npx tsx src/tests/clinicBulkExport.test.ts` | **1** | **116 passed, 1 failed** — see §8, unrelated to KVKK-HIGH-008/#175/#180 |
| `npx tsx src/tests/sessionCookieCsrf.test.ts` | 0 | 15/15 OK |
| `npx tsx src/tests/platformAdmin.test.ts` | 0 | 39/39 OK |
| `npx tsx src/tests/legacyConsentCorrection.test.ts` (Scenario B, upgraded-with-data DB) | 0 | 28 passed, 0 failed |
| `npx tsx src/tests/legacyConsentCorrection.test.ts` (Scenario C, upgraded-with-data DB) | 0 | 28 passed, 0 failed |
| `npm run typecheck` (backend, `npx prisma generate && tsc --noEmit`) | 0 | clean, no errors |
| `npx vitest run src/components/CommunicationPreferencesPanel.vitest.test.tsx` (repo root) | 0 | 12 passed, 0 failed |
| `npm run test:communication-consent-matrix` (repo root) | 0 | 29 passed, 0 failed |
| `npm run build` (repo root, `tsc -b && vite build`) | 0 | clean, no type errors |

**Total independently executed and passing: 483 test assertions across 19 suites/commands, 0 failures attributable to KVKK-HIGH-008/PR #175/PR #180.**

## 8. Unrelated incidental finding (not KVKK-HIGH-008 scope, not fixed)

`src/tests/clinicBulkExport.test.ts` → `status DTO never serializes sensitive fields` fails with `expected the explicit status DTO block to be present`. This is a static source-text match (`source.indexOf('res.json({\n      jobId: row.id,')`) against `server/src/routes/clinicBulkExport.ts`, part of the unrelated KVKK-HIGH-004 (secure clinic bulk export) module — no file it touches overlaps with PR #175/#180. Reproduces identically on an unmodified `origin/main` checkout; not caused by this task, not fixed by this task (out of scope — no clinic-bulk-export files were touched, per this task's authorization boundaries). Flagged here for whichever task owns that module.

## 9. Feature flag / kill-switch decision

**Classification: B — Manual administrative action**, with a residual characteristic of **F — user-facing workflow enabled globally the instant the deploy ships** (no rollout control):

- Route: `POST /api/patients/:patientId/communication-preferences/legacy-corrections/sms-opt-out` (`server/src/routes/communicationPreferences.ts:557-598`), gated `authorize([...EXPORT_ROLES])` (OWNER/ORG_ADMIN/CLINIC_MANAGER only) — confirmed by the authorization-matrix tests (RECEPTIONIST/DENTIST/BILLING correctly denied 403, no mutation).
- Every call requires a non-empty, human-authored `correctionReason` and `notes`, plus a closed-set `evidenceType` — the service layer rejects empty/invalid values independent of the route's zod validation (`legacyConsentCorrection.ts:220-237`).
- Frontend surface (`src/components/CommunicationPreferencesPanel.tsx:631`, `LegacyConsentCorrectionModal.tsx`) requires an explicit staff button click that opens a form modal — nothing calls the correction function automatically; no `useEffect` in the panel triggers it.
- No cron/job/worker anywhere in `server/src/jobs` references this workflow or its table. No startup hook references it. Activation is exclusively API-driven by an authorized human action, one patient at a time.
- The correction is immutable (create-only table, verified: no update/delete Prisma calls anywhere in the codebase against `patientLegacyConsentCorrection`), transactionally atomic with the `Patient.smsOptOut` flip, and PII-safe in its audit trail (dedicated test: `AuditLog entry is written safely — no notes/reason/patient-name PII in metadata or description`).

**Residual risk not fully addressed by the above:** because there is no rollout control, the moment this workflow is deployed to production it becomes simultaneously available to every OWNER/ORG_ADMIN/CLINIC_MANAGER across **every tenant**, with no ability to pilot on one clinic or pause it without a full code rollback/redeploy — and because the action flips a real `Patient.smsOptOut` field (affecting whether that patient receives SMS), an unforeseen defect discovered after some corrections have already been made in production cannot be un-done through this workflow itself (correcting an already-corrected record is explicitly rejected `legacy_signal_already_corrected` by design). This matches the class of risk the task's guiding principle is concerned with, even though the workflow is not "automatic" in the cron/startup sense.

**Decision: a runtime database toggle is the appropriate control, not a blocker to the schema/migration work itself.** The codebase already has the exact precedent and infrastructure needed, with **no new Prisma migration required**:
- `server/src/services/platformSettings.ts` — generic `getPlatformSetting`/`setPlatformSetting` against the existing `PlatformSetting` key/value table (already in the schema since `20260615000000_add_platform_setting`).
- `server/src/routes/platformAdmin.ts:1050-1068` — the exact same pattern already exists for the data-retention cleanup job (`privacy.dataRetention.runtimeEnabled`, read via `GET /api/platform/privacy/data-retention/policy`, set via `PATCH /api/platform/privacy/data-retention/settings`), including an env-level hard switch + runtime toggle + derived "effective enabled / source" reporting.

**Recommended follow-up (not implemented in this branch — see §11 non-authorization and the task's isolation-from-active-migration-work constraint):**
- Add `privacy.legacyConsentCorrection.runtimeEnabled` as a new `PlatformSetting` key (no migration — reuses the existing table).
- Add a check at the top of the POST handler (`communicationPreferences.ts:557`, before `loadScopedPatient`): if the setting is not exactly `'true'`, respond `503`/`{ errorCode: 'feature_disabled' }` — **fail-closed by default** (absence of the key = disabled), per the task's default-new-high-risk-controls-to-disabled principle.
- Mirror the data-retention pattern's `GET`/`PATCH` platform-admin endpoints so the toggle can be flipped without a redeploy once explicitly approved.
- This is a small, isolated, non-migration change and should ship as its own separate PR/commit, not bundled into this audit branch or into any active KVKK-HIGH-008 branch — see the task's explicit instruction not to mix a safety implementation invisibly with audit documentation.

This strengthens, but does not close, **R-061** (still `OPEN` — no flag exists in `main` today).

## 10. Tenant / KVKK / audit impact (repository + rehearsal evidence combined)

- **Owning tenant fields:** `organizationId`, `clinicId` on `PatientLegacyConsentCorrection`, both required and FK-enforced to `Organization`/`Clinic`.
- **Cross-tenant exposure:** none found; independently reproduced a real cross-tenant write attempt in Scenario C and confirmed rejection (`clinic_scope_mismatch`) with zero correction rows created for the non-owning tenant.
- **Platform-admin access path:** none — this workflow has no platform-admin route; it is clinic-management-role only.
- **Job/worker tenant context:** not applicable — no job/worker touches this table.
- **Audit entries:** `writeAuditLogInTx` inside the same transaction as the correction row and the `Patient.smsOptOut` flip — confirmed atomic (rollback test: a downstream FK violation on `correctedById` rolls back the `Patient` update, the correction row, and the audit row together, all three, verified against real Postgres).
- **Data minimization:** list endpoint returns summary fields only (no `correctionReason`/`notes`/`sourceReference`/`requestFingerprint`/`idempotencyKey`); detail endpoint adds the free-text fields but still never the fingerprint/idempotency key — both enforced by dedicated tests, re-verified in this task's rehearsal runs.
- **Correction traceability:** immutable, append-only — no update/delete path exists in the codebase for this table.
- **Reversibility:** the correction record itself is never modified or deleted; the underlying `Patient.smsOptOut`/`smsOptOutAt` fields could in principle be changed again by other application paths, but this specific workflow provides no "undo" and explicitly refuses to re-run once already corrected.
- **Legal hold / retention / anonymization interaction:** not exercised in this phase (out of scope for Phase B1 — no legal-hold or retention-job code paths reference this table, confirmed by grep; a full interaction check would require a dedicated follow-up if this ever becomes relevant to retention-driven anonymization).
- **Consent evidence overwritten vs. appended:** appended only — this workflow explicitly never creates, alters, or deletes a `PatientCommunicationPreference`/`PatientCommunicationConsentEvent` row (dedicated test, re-verified: `no central preference is created and no consent is granted`, and `central preference explicitly granted before correction remains completely unchanged`).

## 11. Rollback and cutback plan

| Concept | PR #175 (`...consent_reconciliation`) | PR #180 (`...legacy_consent_correction`) |
|---|---|---|
| Down migration exists | No (Prisma migrate does not generate one; none authored) | No |
| Prisma safe rollback here | Yes, in the narrow sense that dropping the new table/index/enum loses no pre-existing data (both migrations touch nothing pre-existing) | Yes, same reasoning |
| Rollback data loss | None — only the new, empty-until-used tables would be dropped | None |
| Old app code on new schema | Compatible (ignores new tables) | Compatible |
| New app code on old schema | Would fail (missing table) — so deployment must be **schema-first, then app code** | Same — schema-first, then app code |
| Expand-migrate-contract preserved | Yes (expand-only; no contract phase exists or is needed) | Yes |

**Cutback sequence (if a production issue is found after deployment), in order:**
1. **Feature deactivation** (once the recommended toggle from §9 exists): flip `privacy.legacyConsentCorrection.runtimeEnabled` to `false` via the platform-admin endpoint — no redeploy needed. **This does not exist yet in `main` today** — until it does, the only deactivation path is (2).
2. **Application rollback**: redeploy the previous release commit (route code stops accepting requests); the new table remains in the schema, harmlessly unused, since old code never queries it.
3. **Worker/job stop**: not applicable — no worker/job is involved in this workflow.
4. **Migration rollback**: only necessary if the schema itself is implicated (not expected, since the migration is additive-only) — drop `PatientLegacyConsentCorrection` (and `PatientLegacyConsentField` enum) manually; verify no application code path still references it first.
5. **Data restoration**: not expected to be necessary — no pre-existing data is ever mutated by the migrations themselves; the `Patient.smsOptOut`/`smsOptOutAt` flips made by staff through the workflow are true corrections recorded with reasons, not migration side effects, and are governed by (6)/(7) below, not by migration rollback.
6. **Tenant-specific remediation**: if a specific correction is later found to be wrong, the correct fix is a **new, forward, staff-authored correction** re-flipping `smsOptOut` back — the existing correction row is never edited or deleted; this preserves the append-only audit trail.
7. **Forward-fix**: preferred over any schema rollback for any defect found in the correction logic itself, given the additive nature of the schema.
8. **Backup prerequisite**: a fresh, verified backup immediately before any production migration apply (see Production Migration Status in the report below — backup freshness/restore capability was **not** verified in this phase; it is a Phase-B1-out-of-scope, production-facing check).
9. **Audit requirement**: any manual production intervention (migration apply, rollback, or tenant-specific remediation) must itself be recorded in the deployment log per the runbook in the accompanying delivery report — not automated by this task.

## 12. Non-authorization statement

This document, and the branch/worktree that produced it, records read-only and disposable-environment evidence only. It does not apply any migration to production, does not deploy any code, does not restart any process, does not activate any feature, does not change any production environment variable or file, and does not declare the KVKK baseline stable. Production migration-applied/deployed/feature-activated/production-verified status for both PR #175 and PR #180 remain **unconfirmed** after this task, exactly as before it — this task only independently re-verified that the migrations and application code are **safe to apply** in a disposable environment; it did not observe or touch the actual production database, host, or process.
