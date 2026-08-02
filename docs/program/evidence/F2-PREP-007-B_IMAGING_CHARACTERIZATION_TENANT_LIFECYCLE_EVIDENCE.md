# F2-PREP-007-B — Imaging Characterization: Tenant, RBAC, Lifecycle, and Privacy Callers — Evidence

**Phase:** F2 — Imaging Stage 0 characterization coverage.
**Parent contract:** `docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md` (characterization-test gate, §14) and its JSON companion `docs/program/architecture/evidence/F2-PREP-006-E_imaging_boundary_contract.json` (`characterizationTestGate.characterizationTests`, entries `CT-02`, `CT-03`, `CT-05`, `CT-17`, `CT-23`, `CT-26`, `CT-30`).
**Type:** TEST-ONLY. No application/runtime code, Prisma schema/migration, package.json, lockfile, workflow, or shared program-control file is changed by this task.
**Status:** `AGENT_COMPLETED` / `VALIDATION_PASSED` / `PR_OPENED_AWAITING_REVIEW`. Not merged, not deployed, not production-verified.

---

## 1. Baseline

```
git fetch origin main --quiet
git rev-parse origin/main
  -> 5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb
```

Worktree created directly from `origin/main` at that exact SHA (no sibling F2-PREP-007-A/C worktree reused, read, merged, or rebased onto), on a fresh branch:

```
branch: test/f2-prep-007-b-imaging-tenant-lifecycle
HEAD after this task's single commit's parent (pre-commit): 5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb
```

`git log -1 --format=%H` on the worktree immediately after creation returned `5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb`, confirming the worktree's starting point is bit-for-bit `origin/main`'s tip — no divergence. Two sibling branches (`test/f2-prep-007-a-imaging-auth-shape`, `test/f2-prep-007-c-imaging-ingest-storage`) were observed to exist at the same origin SHA during branch creation; neither was read, merged from, or depended on by this task, per the CodeGraph-discipline and isolated-worktree instructions.

---

## 2. Reading performed (targeted, not a whole-repo scan)

- `AGENTS.md`
- `docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md` + `docs/program/architecture/evidence/F2-PREP-006-E_imaging_boundary_contract.json` (merged contract + machine-readable companion)
- `docs/program/evidence/F2-PREP-006-D_IMAGING_PUBLIC_CONTRACT_AND_TEST_DESIGN.md` + `docs/program/evidence/F2-PREP-006-D_imaging_contract_test_design.json` (candidate test definitions this task's 7 CTs are drawn from)
- `server/src/routes/imaging.ts` (full file, 1303 lines)
- `server/src/routes/imagingBridgePublic.ts` (full file)
- `server/prisma/schema.prisma` lines 2540–2780 (all 8 Imaging/BRG models)
- `server/src/services/imaging/imagingRequestTransitions.ts`, `bridgeTokens.ts`, `bridgePairing.ts`
- `server/src/services/fileStorage.ts` (full file — local-disk storage-key/save/exists semantics)
- The three accepted Privacy/KVKK direct-Imaging-access callers in full: `server/src/services/privacy/deletionReviewInventory.ts`, `orphanFileInspection.ts`, `patientAnonymization.ts`
- `server/src/schemas/index.ts` (imaging-related Zod schemas, lines ~547–672)
- `server/src/middleware/auth.ts` (`authorize()`), `server/src/utils/roles.ts` (`normalizeRole`), `server/src/utils/helpers.ts` (`createRateLimiter`), `server/src/utils/counterStore.ts` (in-memory fallback confirmed — no Redis required for deterministic rate-limit tests)
- Existing disposable-Postgres test orchestration: `.github/workflows/ci-layers.yml`, `scripts/test-runtime/orchestrator.ts` (confirmed its 3 fixed profiles — `postgres`/`postgres-compat`/`storage` — each run a fixed `package.json` script name; since this task may not modify `package.json`, a standalone disposable-Postgres Docker container was provisioned directly for local validation instead of adding a 4th orchestrator invocation path — see §5)
- `server/src/tests/dbVerification/dbVerificationHarness.ts` (shared fixture/route-extraction harness — reused unmodified, see §7) and `fileBackupDbIntegration.test.ts` / `kvkkHigh006DbClinicScopeAccess.test.ts` (existing db-integration test patterns this file's structure follows)
- `server/src/tests/imaging.test.ts`, `imagingBridgePairing.test.ts`, `imagingBridgeOnboarding.test.ts`, `imagingBridgeUpdate.test.ts`, `kvkkAttachmentImagingLifecycle.test.ts` (existing coverage, to confirm no duplication and to select the regression suites re-run in §6)

No whole-repo scan was performed. CodeGraph use was limited to locating actual Prisma client operations on `imagingBridgePairingDevice` across the Imaging/Privacy files already listed above (CT-03's static-scope assertion, itself now also codified as a live, non-substring-based assertion inside the new test file — see §3).

---

## 3. CT-by-CT evidence

### CT-02 — ListPatientImaging rejects cross-clinic patient/study access

Route: `GET /api/patients/:patientId/imaging` (`server/src/routes/imaging.ts:711`).

- Positive control: an own-clinic patient's study is returned (200).
- A valid `patientId` belonging to a **different organization entirely** resolves to `404 Patient not found` — never the record, and the cross-org study row is confirmed byte-for-byte untouched afterward.
- A same-org, explicitly-authorized sibling clinic (via `allowedClinicIds`) **is** reachable — proves the 404 above is real tenant isolation, not a route-wide failure.
- A same-org, **unassigned** clinic requested via `?clinicId=` is denied `403` before any patient lookup runs.
- **Defense-in-depth characterization:** a deliberately data-inconsistent `ImagingStudy` row (`clinicId` = clinic B, but `patientId` pointing at a real clinic-A patient — not reachable via any current route, since `ImagingStudy.patientId` has no DB-level cross-column check against `Patient.clinicId`) is confirmed to **never** leak into a clinic-A-scoped list. This proves `ListPatientImaging`'s `imagingStudy.findMany({ where: { patientId, ...scope } })` clause is itself directly `clinicId`-scoped, not solely reliant on the patient-ownership check.

5/5 assertions pass against current behavior. **No defect found** — CT-02 fully confirms the catalogued assertion.

### CT-03 — ImagingBridgePairingDevice access remains tenant-scoped through its parent pairing

`ImagingBridgePairingDevice` (`server/prisma/schema.prisma:2718`) has no own `clinicId` column — only `pairingId → ImagingBridgePairing.clinicId`.

- **Static check** (source-level, bounded to the 5 Imaging/Privacy files read for this task, corrected per Copilot review — see PR #294 review thread): rather than counting raw `imagingBridgePairingDevice` substring occurrences (which would also match comments/imports/type references and could fail on an unrelated, behavior-preserving edit), the test detects only actual Prisma client operations — calls matching `prisma.imagingBridgePairingDevice.<method>(` / `tx.imagingBridgePairingDevice.<method>(` — via a balanced-parenthesis scan of each call's argument list (`findPrismaModelOperations`, not a fixed-shape/whitespace-sensitive regex). It then asserts every discovered operation's argument text contains a `pairingId:` filter, and separately asserts at least one such operation exists (so the scoping assertion cannot pass vacuously if the model were ever unreferenced). Currently exactly one real operation is found — `tx.imagingBridgePairingDevice.findMany({ where: { pairingId: pairing.id } })` at `server/src/routes/imagingBridgePublic.ts:452`, already-row-locked and already-resolved before this call — and it is scoped as required. This is a live, automatically re-verified assertion in the committed test, not only a one-time grep.
- **Behavioral check:** two independent clinics (different organizations) each create a pairing bound to their own device. Redeeming clinic A's code binds **only** clinic A's device (never clinic B's), and vice versa — both directions independently verified, plus a direct DB-level disjointness check on the resulting `ImagingBridgeAgent`/`ImagingBridgeBinding` rows.
- Both pairing sessions independently transition to `redeemed`.

Note: the F2-PREP-006-D catalogue's suggested fixture ("two clinics with pairings/devices of the same `deviceId` string") is structurally impossible under the current schema — `ImagingDevice.id` is a single-column global primary key (`@id @default(uuid())`), not composite with `clinicId`, so two real device rows can never share an `id` value. The substantive property under test — join-scoping through the parent pairing, not the literal same-string collision — is what the committed test actually characterizes, which is the property `CR`/blocker discussion in the boundary contract (§10, `imagingBridgePairingDeviceTenantColumn`) cares about.

6/6 assertions (incl. the static check) pass. **No defect found** — CT-03 confirms the boundary contract's own claim (§10) that "`CT-03` already characterizes the current `pairingId`-transitive join-scoping as correct."

### CT-05 — SetImagingLegalHold RBAC gate

Route: `PATCH /api/imaging/studies/:id/legal-hold` (`server/src/routes/imaging.ts:927`), hardcoded `authorize(['OWNER', 'ORG_ADMIN'])` — narrower than the file's general `IMAGING_MANAGE_ROLES`.

- `CLINIC_MANAGER`, `DENTIST`, `RECEPTIONIST` each independently receive `403` and are confirmed to leave `legalHold`/`legalHoldReason` completely unmutated in the DB.
- `OWNER` succeeds, sets `legalHold=true` with the reason persisted verbatim.
- `ORG_ADMIN` succeeds and can release the same hold (`legalHold=false`).

5/5 assertions pass. **No defect found** — CT-05 fully confirms the catalogued assertion.

### CT-17 — archive/unarchive changes only `ImagingStudy.status`

Routes: `PATCH /api/imaging/studies/:id/archive` and `.../unarchive` (`server/src/routes/imaging.ts:916-921`, shared `setStudyStatus` helper at `:894-913`).

- Archiving a study with one real `ImagingImage` row (written to a real local-disk file via `saveFile`) changes `ImagingStudy.status` to `archived`. The `ImagingImage` row is asserted `deepEqual` to its pre-archive snapshot (every column, since the model carries no `updatedAt`), and the physical file's `mtimeMs`, `size`, and byte content are all confirmed unchanged.
- **Idempotency characterization:** a second `archive` call on an already-archived study returns 200 with `ImagingStudy.updatedAt` **unchanged**, confirming the source's same-status short-circuit (`imaging.ts:901`) genuinely skips the `UPDATE`, not merely returns the same JSON.
- Unarchive restores `status=active`; the `ImagingImage` row and physical file are re-confirmed untouched.

3/3 assertions pass. **No defect found** — CT-17 fully confirms the catalogued assertion and the boundary contract's own idempotency-rule claim for this pair of commands.

### CT-23 — study-from-ImagingRequest relink consistency — **VERIFIED_DEFECT**

Route: `PATCH /api/imaging/studies/:id/link` (`server/src/routes/imaging.ts:807-854`).

The characterization-test catalogue's own assertion text (F2-PREP-006-D JSON, `characterizationTests[CT-23].assertions[0]`) states: *"a study created from an ImagingRequest cannot be relinked to an appointmentId/treatmentCaseId that is inconsistent with the originating request's own patient."* This does **not** hold against current behavior.

Tracing `LinkImagingStudy`'s full handler body: it validates the newly-supplied `patientId`/`appointmentId`/`treatmentCaseId` against the clinic only (`validateClinicalLinks`), and never reads or compares against `study.imagingRequestId` or that request's own `patientId` at any point. `study.imagingRequestId` itself is neither cleared nor re-validated by this route.

Per this task's constraints ("if a required assertion contradicts current behavior, reproduce twice and report `VERIFIED_DEFECT` without changing production code"), the scenario was reproduced twice, on two independent fixture sets, both committed as live, deterministic assertions in the test file (not merely observed once during authoring):

- **Reproduction 1/2:** a study created from an open `ImagingRequest` for patient P1 is relinked via the real route handler to a different patient P2 (valid, same clinic) → **200 OK**, no rejection. Post-relink, `study.patientId === P2` while `study.imagingRequest.patientId` still `=== P1` — a confirmed inconsistent state.
- **Reproduction 2/2:** identical result on a second, fully independent fixture set (different clinic/patients/request) — confirms the permissive behavior is deterministic source behavior, not a fixture artifact or flake.

2/2 reproductions confirm the defect. **Disposition:** `VERIFIED_DEFECT`. **No production code was changed** — `server/src/routes/imaging.ts` is untouched by this task, per its test-only scope. The committed test asserts the *actual* current (permissive) behavior — this is the correct characterization-test posture per this same contract's own precedent for `CT-32` ("characterization should capture the current clobber behavior... write to first PROVE the current gap exists"). The gap itself (no `imagingRequestId`-consistency check on relink) is a new, not-previously-catalogued finding surfaced by this task, additional to the already-known `CR-03`/`BLK-02` `ImagingRequest` PATCH-concurrency gap — it is a distinct code path (`LinkImagingStudy`, not `UpdateImagingRequest`/`CancelImagingRequest`) and is **not** covered by any existing blocker decision in the F2-PREP-006-E contract. Recommended follow-up (out of this task's scope): a future task should decide whether `LinkImagingStudy` should validate consistency against `study.imagingRequestId` when one is present, or clear `imagingRequestId` on relink to a different patient, and should add this as an explicit blocker entry before Stage 1 (facade) or Stage 2 (`ImagingRequest` concurrency hardening) exposes `LinkImagingStudy` to any caller beyond `imaging.ts` itself.

### CT-26 — rejected/rate-limited heartbeat does not mutate bridge `lastSeenAt`/status

Route: `POST /api/public/imaging/bridge/heartbeat` (`server/src/routes/imagingBridgePublic.ts:130`), `heartbeatTokenLimiter` = 6 requests/60s per token hash (`:52`).

- The first 6 heartbeats (within the per-token limit) all succeed (`200 {ok:true}`) and the agent transitions to `status=online` with `lastSeenAt` set.
- The 7th heartbeat in the same window returns `429`, and the agent row's `lastSeenAt`, `status`, and `updatedAt` are all confirmed **byte-for-byte unchanged** from immediately before the rejected call — the rate-limit check runs strictly before any `prisma.imagingBridgeAgent.update` in the source, and this test confirms that ordering holds under a real DB.

2/2 assertions pass. **No defect found** — CT-26 fully confirms the catalogued assertion.

### CT-30 — characterize current Privacy/KVKK direct-Imaging-access callers

Baseline for a future `ImagingLifecyclePort` migration (F2-CC-14, revised — boundary contract §9) to prove identical results against. All three accepted callers (boundary contract §6) are exercised via their real, exported entrypoints against real fixtures:

- **`buildDeletionReviewInventory`** (`deletionReviewInventory.ts`, `DAV-01`): reads `ImagingImage` via `{clinicId, study:{patientId}}`, selecting `{fileSize, study:{legalHold}}`. Characterized: `imaging.total`/`legalHold`/`retainedClinical`/`estimatedBytes` counts are exact; presence of *any* imaging data unconditionally adds an `IMAGING_RETENTION_NOT_APPROVED` blocker, and legal-hold imaging additionally adds a distinct `IMAGING_LEGAL_HOLD` blocker with its own count.
- **`inspectOrphans`** (`orphanFileInspection.ts`, `DAV-02`/`SB-01`): reads `ImagingImage` via the same `{clinicId, study:{patientId}}` shape, then performs a live `fileExists()` check per row. Characterized: a present file classifies `activeLinkedObject`; a DB row whose physical file is absent classifies `dbRowPhysicalMissing` — both confirmed against one present + one genuinely-missing file in the same test.
- **`markConfirmedMissing`** (`SMB-01`): stamps `storageVerifiedMissingAt` only on the rows explicitly passed in, confirmed to never touch an unrelated (still-present) row.
- **`anonymizePatientData`** → `redactPatientImagingImages` (`patientAnonymization.ts`, `SMB-02`): redacts `ImagingImage.originalName` to `'[ANONYMIZED]'` for non-legal-hold images only, via the same `{clinicId, study:{patientId}}` read shape; legal-hold images are confirmed completely untouched (not even a no-op write). Re-running on an already-anonymized patient is confirmed idempotent (`alreadyAnonymized:true`, zero failures, no double-mutation, no reversion).

7/7 assertions pass. **No defect found** — all three callers' current Imaging-access shape (query filter, selected fields, legal-hold interaction, idempotency) is now pinned by a live db-integration test, giving Stage 3 (`ImagingLifecyclePort` caller migration) an exact behavioral target to match.

---

## 4. Summary table

| CT | Area | Result | Assertions |
|---|---|---|---|
| CT-02 | Tenant isolation — ListPatientImaging | Confirmed, matches catalogue | 5/5 pass |
| CT-03 | Tenant isolation — ImagingBridgePairingDevice | Confirmed, matches catalogue | 6/6 pass |
| CT-05 | RBAC — SetImagingLegalHold | Confirmed, matches catalogue | 5/5 pass |
| CT-17 | Lifecycle — archive/unarchive immutability | Confirmed, matches catalogue | 3/3 pass |
| CT-23 | Relink consistency | **VERIFIED_DEFECT** (permissive; catalogue's assertion does not hold) | 2/2 reproductions confirm |
| CT-26 | Retry/failure — heartbeat rate limit | Confirmed, matches catalogue | 2/2 pass |
| CT-30 | Current Privacy/KVKK callers | Confirmed, matches catalogue; baseline pinned | 7/7 pass |

**29 assertions total in the new suite, 29 passed, 0 failed**, across two independent full runs (see §5).

---

## 5. Exact commands and counts

Disposable PostgreSQL provisioned directly via Docker (not through `scripts/test-runtime/orchestrator.ts`, since its 3 fixed profiles each invoke a fixed `package.json` script name and this task may not modify `package.json` — see §2). This mirrors the orchestrator's own provisioning shape (ephemeral named container, disposable database/user/password, migrations applied, torn down after) without touching any shared script.

```
docker run -d --name diskcrm-f2prep007b-pg \
  -e POSTGRES_DB=f2prep007b -e POSTGRES_USER=f2prep007b -e POSTGRES_PASSWORD=f2prep007bpw \
  -p 0:5432 postgres:16-alpine
# host port dynamically assigned by Docker (-p 0:5432) -> 32768 this run
docker exec diskcrm-f2prep007b-pg pg_isready -U f2prep007b -d f2prep007b   # readiness poll, 1/30s

cd server
export DATABASE_URL="postgresql://f2prep007b:f2prep007bpw@localhost:32768/f2prep007b?schema=public"
npx prisma migrate deploy
  -> All migrations have been successfully applied.

npx tsx src/tests/imagingCharacterizationTenantLifecycle.test.ts
  -> Imaging-Characterization-Tenant-Lifecycle: 29 passed, 0 failed   (run 1)
  -> Imaging-Characterization-Tenant-Lifecycle: 29 passed, 0 failed   (run 2, re-run to confirm determinism/no-collision)

npx tsx src/tests/imaging.test.ts                       -> 103 passed, 0 failed
npx tsx src/tests/imagingBridgePairing.test.ts           -> 50 passed, 0 failed
npx tsx src/tests/imagingBridgeOnboarding.test.ts        -> 14 passed, 0 failed
npx tsx src/tests/imagingBridgeUpdate.test.ts             -> 44 passed, 0 failed
npx tsx src/tests/kvkkAttachmentImagingLifecycle.test.ts  -> 110 passed, 0 failed
npx tsx src/tests/multiBranchAccess.test.ts                -> 142 passed, 0 failed
npx tsx src/tests/treatmentCaseClinicScope.test.ts          -> 11 passed, 0 failed
npx tsx src/tests/patientsImportClinicScope.test.ts          -> 14 passed, 0 failed
npx tsx src/tests/kvkkHigh006Batch2ClinicScope.test.ts        -> 37 passed, 0 failed

npm run typecheck   (npx prisma generate && tsc --noEmit)
  -> exit 0, no diagnostics

git diff --check --cached
  -> clean, no output

git status --short
  -> A  server/src/tests/imagingCharacterizationTenantLifecycle.test.ts
     (this evidence document itself, added after the above validation runs)
```

**Changed-file scope verification:** exactly two files are added by this task — `server/src/tests/imagingCharacterizationTenantLifecycle.test.ts` and this document. No `server/` file outside `server/src/tests/` is touched. No `prisma/schema.prisma`, `prisma/migrations/`, `package.json`, `package-lock.json`, `.github/workflows/`, or shared `docs/program/` control file (`NORAMEDI_MASTER_TRACKER.md`, `CURRENT_PHASE.md`, `phases/F2_MODULAR_BOUNDARIES.md`) is modified — confirmed by `git status --short` and `git diff --stat` against `origin/main`.

---

## 6. Database isolation and cleanup

- Every fixture (`Organization`, `Clinic`, `User`, `Patient`, `ImagingDevice`, `ImagingRequest`, `ImagingStudy`, `ImagingImage`, `ImagingBridgeAgent`, `ImagingBridgePairing`, `ImagingBridgeBinding`, `PatientPrivacyRequest`) is created with a per-run `randomUUID()`-suffixed name/slug via `createClinicFixtureSet`/`createStaffUser`/`createTestPatient` (reused unmodified from `dbVerificationHarness.ts`) — safe for concurrent/parallel execution against the same or a different disposable database, including alongside the sibling F2-PREP-007-A/C suites.
- A local `cleanupImagingFixtures()` deletes every Imaging/BRG/`PatientPrivacyRequest` row scoped to this run's fixture clinic ids, in FK-safe order (`ImagingImage → ImagingStudy → ImagingBridgeBinding → ImagingBridgeAgent → ImagingBridgePairing → ImagingRequest → ImagingDevice → PatientPrivacyRequest`; `ImagingBridgePairingDevice` needs no explicit delete — its FK to `ImagingBridgePairing` is `onDelete: Cascade` in the schema), **before** delegating to the shared harness's unmodified `cleanupAllFixtures()` for `Patient`/`User`/`Clinic`/`Organization`.
- Physical test files written via `saveFile()` (CT-17, CT-30) have their per-clinic upload subdirectories removed via `fs.rm(..., {recursive:true, force:true})`.
- All cleanup runs inside a single `.finally()` block on `main()`, unconditionally, on both pass and failure paths (verified: a deliberately-run second full pass left **zero** residual rows — `SELECT count(*)` across all 13 relevant tables returned 0/0 after two consecutive runs — and zero leftover files under `uploads/`).
- The disposable Postgres container itself was torn down via `docker rm -f diskcrm-f2prep007b-pg` after validation; `docker ps -a` confirms no residual container.

---

## 7. Shared test helpers

`server/src/tests/dbVerification/dbVerificationHarness.ts` was **read and reused unmodified** — no changes were required or made to it, satisfying the "do not modify shared test helpers unless unavoidable" constraint. No modification was needed for any of the 7 CTs in scope.

---

## 8. Tenant/KVKK impact

None. This task is test-only — it characterizes existing tenant-isolation (CT-02, CT-03), RBAC (CT-05), lifecycle-immutability (CT-17), and Privacy/KVKK caller (CT-30) behavior without changing any of it. The one finding that deviates from the originally-catalogued expectation (CT-23) is reported as `VERIFIED_DEFECT`, not silently fixed — no `server/src/routes/imaging.ts` code was touched, so current production tenant/KVKK behavior (including the CT-23 gap, which already exists on `main` today) is completely unchanged by this PR.

---

## 9. Migration: none

No Prisma schema or migration file is touched. `ImagingLifecyclePort` is not introduced; all three Privacy/KVKK callers continue to access `ImagingImage`/`ImagingStudy` directly, exactly as before this task.

---

## 10. Rollback

Revert this task's single commit (or close the PR without merging). Zero production risk — no application code, schema, or shared program-control file is changed; only one new test file and this evidence document are added.

---

## 11. Status separation

- **Agent completed:** yes.
- **Validations passed:** yes — new suite (29/29, ×2 runs), 9 existing regression suites (all green, see §5), `npm run typecheck` (clean), `git diff --check` (clean), changed-file scope (2 files, both within this task's authorized create-list).
- **PR opened:** yes, against `main`, test-only. See §12 for URL/head SHA (filled in after PR creation).
- **Merged:** no. **Deployed:** no. **Production verified:** no.
- **Runtime implementation / `ImagingLifecyclePort`:** not introduced by this task (out of scope, per the parent contract's Stage 0 gate).
- **CT-02/03/05/17/26/30:** characterized, confirmed matching the F2-PREP-006-D/E catalogue's own assertions.
- **CT-23:** characterized; **`VERIFIED_DEFECT`** relative to the catalogue's assertion text — reproduced twice, reported, not fixed (out of this test-only task's scope). Recommended as a new, explicit blocker-decision candidate for a future task, before `LinkImagingStudy` is exposed through any facade beyond `imaging.ts` itself.
- **This task's own 7 CTs relative to the boundary contract's Stage-1 gate (§14):** `CT-02`, `CT-05`, `CT-17`, `CT-26` are members of the 18-test "mandatory before refactor" (Stage 1) bucket — all now pass. `CT-23`, `CT-30` are members of the 3-test "mandatory before caller migration" (Stage 3) bucket — `CT-30` passes cleanly; `CT-23` passes as a characterization of actual (permissive) behavior but surfaces the new finding above, which a future task should resolve or explicitly accept before Stage 3 exposes `LinkImagingStudy` externally. `CT-03` is additionally required for `imagingBridgePairingDeviceTenantColumn`'s "before Stage 5" schema decision (§10) — passes, confirming the current join-scoping remains correct without that additive column.
- **G1/G2:** unchanged, `NOT_APPROVED`. **R-070/R-046:** unchanged, `OPEN`. **R-071:** unchanged. **`PZ-IMG-03`:** unchanged, `OPEN` — unaffected by this task (Backup/Storage RBAC, not touched here).
- **KVKK physical/architecture freeze:** unchanged, active, untouched.

## 12. PR / head SHA

- PR: https://github.com/MustafaBasol/DisKlinikCRM/pull/294 (`test/f2-prep-007-b-imaging-tenant-lifecycle` → `main`), opened, not merged.
- Head commit SHA at PR open: `0a1a6acb3b6a8641666fd3fd8633cd0e96e842f2`.
- Base: `origin/main` at `5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb` (§1) — the PR's single commit is a linear child of that exact SHA, no rebase/merge commit involved.

## 13. Unverified claims

- CI (`.github/workflows/ci-layers.yml` Layer 3 `disposable-postgres-tests`) was **not** run for this PR by this task — the new test file is not wired into any `package.json` script (per the "no package.json ... changes" constraint) and is therefore not reachable by any existing CI aggregate today. It was validated locally against an equivalent hand-provisioned disposable PostgreSQL 16 container instead (§5), using the same real Prisma client, real migrations, and real route/service code CI would exercise. Wiring this file into a `package.json` test script (and, if desired, one of the existing disposable-Postgres CI aggregates) is explicitly left to the "final consolidation" task referenced in the task brief, which owns shared program-control and script-aggregate files.
- The CT-23 finding's severity/priority classification ("should this block Stage 3") is this task's own recommendation, not a decision — final disposition is owned by whichever task next updates the boundary contract's `blockerDecisions`.

## 14. Next action

External program-owner review of this PR; if accepted, the next task in sequence per the boundary contract (§15) is Stage 1 (additive `ImagingLifecyclePort`/public-contract facade) for the already-passing CTs, gated on a separate decision about the CT-23 finding raised here before `LinkImagingStudy` is exposed through any facade.
