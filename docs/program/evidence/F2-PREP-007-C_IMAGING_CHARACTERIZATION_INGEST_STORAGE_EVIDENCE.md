# F2-PREP-007-C — Imaging Characterization: Upload, Storage, Idempotency, and Compensation

**Task:** F2-PREP-007-C — Imaging Characterization: Upload, Storage, Idempotency, and Compensation
**Phase:** F2 — Imaging Stage 0 characterization coverage.
**Status:** AGENT_COMPLETED / VALIDATION_PASSED / PR_OPENED_AWAITING_REVIEW
**Frozen baseline:** `origin/main` @ `5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb` (verified via `git fetch origin main` + `git rev-parse origin/main` immediately before worktree creation; matched exactly, no divergence).
**Worktree/branch:** `test/f2-prep-007-c-imaging-ingest-storage`, created via `git worktree add ... 5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb` (isolated; the primary working tree was never touched).

## 1. Non-authoritative characterization statement

This task adds **characterization tests only**. It does not converge manual (`CreateImagingStudy`) and bridge (`IngestImagingStudy`) ingest, does not fix storage compensation behavior, and makes no production-code, Prisma schema/migration, dependency, lockfile, workflow, or package-script change. Nothing in this document authorizes any Stage 0–7 modularization work; it only adds to the characterization-test gate `F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md` already requires before Stage 1 can begin.

## 2. Inputs read

- `AGENTS.md` (project-wide MVP/security conventions).
- `docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md` + companion `docs/program/architecture/evidence/F2-PREP-006-E_imaging_boundary_contract.json` — the **accepted** consolidation. Confirmed the `characterizationTestGate` carries CT-01..CT-32 forward from F2-PREP-006-D **unrenumbered** (`characterizationTestGate.bucketed.mandatoryBeforeRefactor.tests` explicitly lists `CT-07, CT-08, CT-10, CT-11, CT-12, CT-13, CT-14, ..., CT-27, ...`), so the CT IDs in this task's dispatch map 1:1 onto F2-PREP-006-D's own catalogue with no reconciliation-driven renumbering.
- `docs/program/evidence/F2-PREP-006-D_IMAGING_PUBLIC_CONTRACT_AND_TEST_DESIGN.md` + companion `F2-PREP-006-D_imaging_contract_test_design.json` — the **candidate** catalogue's `characterizationTests[]` entries for CT-07, CT-08, CT-10, CT-11, CT-12, CT-13, CT-14, CT-27 (contract target, test level, infrastructure, fixture isolation, assertions) were used as the drafting spec for each test body below.
- `docs/program/evidence/KVKK-HIGH-006-DISPOSABLE_POSTGRES_VERIFICATION.md` — precedent for disposable-Postgres provisioning (postgres:16-alpine, ephemeral container, random non-default port, no volume mount).
- `server/src/routes/imaging.ts` (read in full — manual upload, device/request/study CRUD, archive/legal-hold, redaction helpers).
- `server/src/routes/imagingBridgePublic.ts` (read in full — heartbeat, bridge ingest, pairing redemption, bootstrap, update).
- `server/src/services/imaging/imagingUploadValidation.ts`, `imagingRequestTransitions.ts` (read in full).
- `server/src/services/fileStorage.ts` (read in full — local-disk vs. S3 storage abstraction; `BASE_UPLOAD_DIR` is a module-level constant derived from `process.cwd()` at first import, which drives this suite's storage-isolation technique, §4 below).
- `server/prisma/schema.prisma` lines 2547–2771 (`ImagingDevice`, `ImagingRequest`, `ImagingStudy`, `ImagingBridgeAgent`, `ImagingBridgePairing`, `ImagingBridgePairingDevice`, `ImagingBridgeBinding`, `ImagingImage`).
- `server/src/tests/dbVerification/dbVerificationHarness.ts` (reused unmodified — `getFullChain`, `runChain`, `mockResponse`, `authRequest`, `createClinicFixtureSet`, `createStaffUser`, `createTestPatient`, `prisma`).
- `server/src/tests/dbVerification/inventoryUnitConversionConcurrency.test.ts` and `dbVerification/fileBackupDbIntegration.test.ts` — precedent for the real-Postgres concurrency-race technique (`Promise.all`, no fixed sleep) and for this suite family's self-contained local cleanup convention.
- `server/src/tests/externalCalendarWebhookRouteE2E.test.ts` and `server/src/tests/httpRequestLogPrivacy.test.ts` — precedent for the real-`express()` + `app.listen(0)` + raw `node:http` request technique used for CT-27 (multer/busboy must parse a genuine multipart stream to exercise 413/400/500 middleware paths; a fake in-memory request object cannot).
- `server/src/tests/imaging.test.ts`, `imagingBridgePairing.test.ts`, `imagingBridgeOnboarding.test.ts`, `imagingBridgeUpdate.test.ts`, `kvkkAttachmentImagingLifecycle.test.ts` — read to confirm no existing test already exercises a live-DB/live-storage manual/bridge upload, race, or compensation path (all five are either mock/unit-level or, for the KVKK lifecycle suite, target legal-hold/redaction/attachment scope, not ingest storage).

CodeGraph use was targeted to the Imaging/Bridge/storage/test paths listed above; no whole-repo scan was performed.

## 3. Scope expansion (none required)

No scope expansion beyond the paths listed above was needed — `imagingRequestTransitions.ts` and `imagingUploadValidation.ts` were already in the F2-PREP-006-D `inspectedPaths` and are shared, single-source-of-truth modules both ingest routes import; reading them directly (not re-deriving their rules) was sufficient to write CT-08's linked-request-advance assertions and CT-27's oversize/invalid-type assertions correctly.

## 4. Test infrastructure

| Aspect | Value |
|---|---|
| Database | Disposable PostgreSQL, `postgres:16-alpine`, container `imaging-char-007c-pg`, ephemeral (`docker run --rm -d`, no volume mount), database `noramedi_imaging_char_007c`, user `noramedi_test`, port `55440` (non-default). All 66+ existing migrations applied cleanly via `npx prisma migrate deploy` with no drift. Container and database are destroyed at the end of this task (see §9). |
| Storage | Real local-disk `fileStorage.ts` (no S3/MinIO — not required for this suite's assertions, and the task instructs local temp storage is preferred). Isolation: `services/fileStorage.ts`'s `BASE_UPLOAD_DIR` is a module-level `path.resolve(process.cwd(), 'uploads')` constant, computed once at first import. The test file calls `fs.mkdtempSync(os.tmpdir()+...)` then `process.chdir()` to that fresh directory **before** any dynamic `import()` reaches `fileStorage.ts` (ES module dynamic-import specifiers resolve against the importing module's own URL, not `cwd`, so this is safe for the relative imports used). Every file this suite ever writes therefore lands under a unique, per-process-run OS-temp root, never under the worktree's real `uploads/` directory. |
| Route invocation | Two techniques, chosen per what each CT needs to exercise: (1) direct chain/handler invocation via the existing `dbVerificationHarness.ts` (`getFullChain`/`runChain`/`mockResponse`/`authRequest`) with the route's own multer middleware skipped and `req.file` supplied directly in the exact shape multer would produce — used for CT-07/08/10/11/12/13/14, which characterize the real handler/transaction/compensation logic, not multer's own stream parsing. (2) A real `express()` app with the real, unmodified `imagingBridgePublicRoutes` router mounted at `/api/public` (matching production `index.ts:185`), `app.listen(0)`, driven by raw `node:http` requests with hand-built multipart bodies — used only for CT-27, which specifically characterizes multer/busboy's own 413/400/500 middleware behavior and therefore needs a genuine multipart stream. |
| Race synchronization | CT-11, CT-13, CT-14 fire two identical/conflicting calls via `Promise.all` against real, independent Postgres connections and real disk I/O — no fixed sleep anywhere in the suite. This is the same no-manual-lock technique already accepted in this codebase for a real-DB race with no ordering requirement (`dbVerification/inventoryUnitConversionConcurrency.test.ts`, "Race 3" — concurrent stock-out). CT-27's malformed-multipart sub-test uses `server.once('listening', ...)` (event-driven, not a sleep) to know when the ephemeral HTTP server is ready. |
| Fixtures | Each CT test creates its own fresh `createClinicFixtureSet(...)` (2 organizations, 4 clinics) + `createStaffUser` (OWNER) +, where needed, `createTestPatient`/`ImagingRequest`/`ImagingBridgeAgent` — no shared mutable fixture state between CT tests, so the directory-listing-based orphan-file assertions (`listClinicUploadFiles`) are exact (no other test's file can land in the same clinic's storage subdirectory). |

## 5. Test file

`server/src/tests/imagingCharacterizationIngestStorage.test.ts` (new). Run standalone (no package.json script added, per the "no package-script change" constraint):

```
cd server
DATABASE_URL=postgresql://noramedi_test:<pw>@127.0.0.1:<port>/<db> npx tsx src/tests/imagingCharacterizationIngestStorage.test.ts
```

### Exact test counts per CT ID

| CT ID | Assertions in this suite | Result (3 consecutive runs) |
|---|---|---|
| CT-07 | 1 | 3/3 passed |
| CT-08 | 1 | 3/3 passed |
| CT-10 | 1 | 3/3 passed |
| CT-11 | 3 (rep1/rep2/rep3, fresh clinic+agent+ingestKey each rep) | 3/3 passed × 3 reps = 9/9 |
| CT-12 | 1 | 3/3 passed |
| CT-13 | 1 | 3/3 passed |
| CT-14 | 1 | 3/3 passed |
| CT-27 | 4 (27a oversize/413, 27b invalid-type/400, 27c malformed-multipart/500, 27-final no-partial-rows) | 3/3 passed × 4 = 12/12 |
| **Total** | **13 assertions per run** | **13/13 passed, 0 failed, on every one of 3 consecutive full-suite runs (39/39 assertion-runs total)** |

## 6. What each CT characterizes, and how it was reproduced

- **CT-07** — `POST /api/imaging/studies` (manual, `CreateImagingStudy`): a single unlinked upload persists an `ImagingImage` row whose `fileSize`/`mimeType`/`originalName` exactly match the uploaded PNG, and `openFileStream(filePath)` reads back byte-identical content.
- **CT-08** — `POST /api/public/imaging/bridge/studies` (`IngestImagingStudy`) with `imagingRequestId` set to an open (`requested`) `ImagingRequest`: one call commits `ImagingStudy`+`ImagingImage` and flips the request to `received`, inheriting the request's `patientId`.
- **CT-10** — the same `(clinicId, ingestKey)` posted twice **sequentially**: the second call hits the `findFirst` pre-check (`imagingBridgePublic.ts:257-267`), which runs **before** any storage write — confirmed directly by asserting the clinic's upload directory still holds exactly one file after the second call, not two.
- **CT-11** — the same `(clinicId, ingestKey)` posted **concurrently** (`Promise.all`, three fresh-fixture repetitions): neither pre-check sees the other's row yet, so both proceed to `saveFile` + `$transaction`; Postgres's `@@unique([clinicId, ingestKey])` constraint lets exactly one `INSERT` win, the loser's transaction throws `P2002`, and the catch block (`imagingBridgePublic.ts:343-358`) deletes the loser's already-written file before returning the winner's `studyId` with `duplicate:true`. Verified via DB row counts (`imagingStudy.count`/`imagingImage.count` both `=1`) and a directory listing (`=1` file).
- **CT-12** — the manual route has no `ingestKey` field at all; two sequential byte-identical uploads create two fully independent `ImagingStudy`/`ImagingImage` rows and two separate files (`NULL` never collides under a Postgres unique index) — this is **documented intentional current behavior**, not a defect, matching `F2-PREP-006-D`'s `idempotencyRules` for `CreateImagingStudy`.
- **CT-13** — the manual route's `$transaction` can only throw **after** `saveFile` in one currently-reachable path: a linked `ImagingRequest` closing between the handler's pre-transaction open-status read and the transaction's own `updateMany(... status IN [requested, scheduled])` guard. This suite reproduces that deterministically by firing two concurrent manual uploads against the same open request — Postgres serializes the two `UPDATE`s on that row; the second sees `count===0`, throws `{statusCode:409}`, and the catch block (`imaging.ts:682-688`) deletes that request's already-written file. Verified: exactly one `ImagingStudy` survives, the request ends `received`, and exactly one file remains on disk.
- **CT-14** — same P2002 race as CT-11, run as an independent fixture/repetition, with the added assertion that the one surviving on-disk file's basename matches the **winner's own** persisted `ImagingImage.filePath` (not merely "some file remains") — directly confirming the loser's own key, not the winner's, was the one deleted.
- **CT-27** — three real-HTTP sub-cases against the unmodified bridge router with `IMAGING_MAX_FILE_MB=1`: (a) a 2 MiB file → multer's `LIMIT_FILE_SIZE` → **413**; (b) a `.txt`/`text/plain` file → the route's own `fileFilter` → **400**; (c) `Content-Type: multipart/form-data` with no `boundary=` parameter → busboy throws `Multipart: Boundary not found` during construction, caught by the upload wrapper's generic `else` branch (`imagingBridgePublic.ts:211-212`) → **500** (confirmed by the actual `console.error('[imaging-bridge] upload middleware error: Multipart: Boundary not found')` line observed in every run). None of the three ever reaches the async handler body (multer/fileFilter rejection happens before `next()`), so a fourth assertion directly confirms zero `ImagingStudy`/`ImagingImage` rows and zero files for that clinic afterward.

No test in this suite observed behavior contradicting the accepted F2-PREP-006-D/E characterization — **no `VERIFIED_DEFECT` is reported.**

## 7. Validation performed

| Check | Result |
|---|---|
| `git rev-parse origin/main` before worktree creation | `5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb` — matched the dispatched baseline exactly |
| New suite, run 1 | 13 passed, 0 failed |
| New suite, run 2 (immediately after fixing a fixture-cleanup bug, see §8) | 13 passed, 0 failed |
| New suite, run 3 | 13 passed, 0 failed |
| `npx tsc --noEmit` (server backend typecheck) | Clean, zero errors |
| `server/src/tests/imaging.test.ts` (existing mock suite) | 103 passed, 0 failed |
| `server/src/tests/imagingBridgePairing.test.ts` | 50 passed, 0 failed |
| `server/src/tests/imagingBridgeOnboarding.test.ts` | 14 passed, 0 failed |
| `server/src/tests/imagingBridgeUpdate.test.ts` | 44 passed, 0 failed |
| `server/src/tests/kvkkAttachmentImagingLifecycle.test.ts` (DB-backed, imaging/attachment legal-hold + scope) | 110 passed, 0 failed |
| `git diff --check` | Clean, no whitespace errors |
| Changed-file scope | `git status --short` shows exactly two new, untracked files: the test file and this evidence doc — no other file in the repository was modified |

## 8. A cleanup bug found and fixed in this suite's own first draft (not production code)

The first draft's `newFixture()` helper tracked only `createClinicFixtureSet(...).orgId` for teardown, but that harness function creates **two** organizations per call (`orgId` and `otherOrgId` — `crossOrgClinicId` belongs to `otherOrgId`). This left `otherOrgId`'s organization/clinic rows behind after `localCleanup()`. Found by directly querying the disposable database after the first two runs (20 leftover non-default organizations, exactly `2 runs × 10 fixtures`). Fixed by (a) tracking `otherOrgId` too, and (b) switching the clinic-teardown query to filter by the precisely-tracked clinic-id set (`id: { in: clinicIds }`) rather than only `organizationId`, so this class of bug cannot recur even if a future fixture helper adds another organization. Re-verified clean (§9) after the fix, across all three validation runs.

A second, unrelated issue was found and fixed in the same pass: on Windows, `fs.rmSync` cannot remove a directory that is the process's current working directory (`EPERM`). The suite now calls `process.chdir(os.tmpdir())` before removing its own per-run temp storage root in `localCleanup()`.

Both fixes are in the delivered test file; neither touched production code.

## 9. Cleanup proof / orphan-file verification

After each of the three full validation runs, direct queries against the disposable database confirmed:

```
imagingStudy: 0, imagingImage: 0, imagingRequest: 0, imagingBridgeAgent: 0,
organization (non-default): 0, clinic (non-default): 0, patient: 0, user: 0, auditLog: 0
```

Every row this suite creates (`ImagingStudy`, `ImagingImage`, `ImagingRequest`, `ImagingBridgeAgent`, `AuditLog`, `Patient`, `User`, `Clinic`, `Organization`) is removed in `localCleanup()`, called from `main()`'s success path and from the top-level `main().catch(...)` fatal-error path, so teardown runs even if an assertion throws mid-suite. The suite's own per-run temp storage root is removed in the same call (`fs.rmSync(..., {recursive:true, force:true})`), after `process.chdir()`s out of it.

**Update (corrective round, §16):** the one artifact that previously remained from a pre-`EPERM`-fix debugging run, `%LOCALAPPDATA%\Temp\imaging-char-ingest-storage-eiNseb`, has since been removed and its removal independently verified. See §16 for the exact command and verification output. This was always debugging residue only (synthetic PNG test fixture bytes, no real patient data, and its database rows were already confirmed removed at the time it was first reported) — it is not, and never was, a defect in the delivered suite's own cleanup path, which left zero residue on every one of the (now six total, across two validation rounds) full-suite runs.

Disposable Postgres container `imaging-char-007c-pg` and its database were created solely for this task's validation and are stopped/removed as part of closing out this task (ephemeral, `--rm`, no volume — nothing persists after `docker stop`).

## 10. Tenant / KVKK impact

None. This task adds tests only; no production authorization, tenant-scoping, redaction, retention, or KVKK-lifecycle code path was touched. Every fixture is synthetic (randomly generated names/phones/file bytes), created and destroyed within this task's own disposable database and temp storage root — no real clinic, patient, or imaging data was read or written. `AuditLog` rows created during the suite (via the real `auditImaging`/`writeAuditLog` call sites the routes already invoke) are synthetic and removed in `localCleanup()`.

## 11. Migration / schema impact

None. No Prisma schema or migration file was added or modified. `npx prisma migrate deploy` against the disposable Postgres applied the existing migration history unchanged, with no drift.

## 12. Rollback

Revert the two new files (`server/src/tests/imagingCharacterizationIngestStorage.test.ts`, this evidence doc) — both are additive and self-contained; nothing else in the repository references them. No data migration, no config change, no shared program-control file was touched, so rollback is a single-commit revert with no follow-up steps.

## 13. Separated statuses

- **F2-PREP-006-A/B/C/D/E** (imaging boundary discovery/consolidation): unchanged, already merged, not modified by this task.
- **F2-PREP-007-A** (imaging auth-shape characterization, sibling task): a local worktree/branch exists (`test/f2-prep-007-a-imaging-auth-shape`) but had no commits beyond the shared baseline at the time this task read it — not depended on, not modified.
- **F2-PREP-007-C** (this task): AGENT_COMPLETED / VALIDATION_PASSED / PR_OPENED_AWAITING_REVIEW. Only CT-07, CT-08, CT-10, CT-11, CT-12, CT-13, CT-14, CT-27 were in scope; the other 24 characterization tests in the accepted gate (CT-01..CT-06, CT-09, CT-15..CT-26, CT-28..CT-32) are explicitly **not** implemented by this task and remain open for a future F2-PREP-007 sibling.
- This task does not update `CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`, `phases/F2_MODULAR_BOUNDARIES.md`, `evidence/README.md`, or any other shared program-control file, per the dispatch instruction that final consolidation owns them.

## 14. PR / head SHA

- **Base:** `main` @ `5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb`.
- **Branch:** `test/f2-prep-007-c-imaging-ingest-storage`.
- **Head SHA (original submission):** `36a13cd691353e250434d5c4f47f38090faffeb4`.
- **Corrective-round substantive commit (§16):** `39171db` (test-harness timeout fix + debug-directory cleanup).
- **Corrective-round doc-only follow-up commit:** `31fd682` (records `39171db` back into this section).
- **PR URL:** https://github.com/MustafaBasol/DisKlinikCRM/pull/295 (open, awaiting review — not merged). The PR's actual current head SHA is whichever of the above commits is most recently pushed to `test/f2-prep-007-c-imaging-ingest-storage` — see `git log` / the PR page for the authoritative value at any given moment.

## 15. Next action

Program-owner review of this PR. If approved, this task's 8 CT IDs join the already-passing set toward the 18-test `mandatoryBeforeRefactor` gate F2-PREP-006-E defined (`characterizationTestGate.bucketed.mandatoryBeforeRefactor`, count 18: CT-02,03,06,07,08,10,11,12,13,14,16,17,19,21,26,27,28,32). This task newly proves CT-07/08/10/11/12/13/14/27 green; CT-02/03/06/16/17/19/21/26/28/32 remain open for future sibling tasks. No Stage 0–7 modularization work is authorized by this task.

## 16. Corrective round — Copilot review fix + debug-directory cleanup closure

This section records a follow-up correction pass on the same PR/branch (no new branch or PR was created), addressing one open Copilot review finding and closing out the one outstanding cleanup item from §9.

### 16.1 Review finding fixed

**GitHub review comment** (PR #295, `copilot-pull-request-reviewer`, comment id `3699989012`, `server/src/tests/imagingCharacterizationIngestStorage.test.ts:624`):

> issueRawRequest() has no timeout, so if the router/middleware ever stops responding (e.g., multipart parsing edge case), this characterization suite can hang indefinitely and stall CI/local runs. Adding a bounded timeout and clearing it on both success and error makes the test runner fail fast instead of hanging.

**Fix:** `issueRawRequest()` (used only by CT-27's real-HTTP sub-cases) now:
- Uses a bounded **10,000 ms (10 s)** timeout (`RAW_REQUEST_TIMEOUT_MS`) — generous relative to this suite's actual sub-second, in-process requests, while staying well inside typical CI step/job timeouts, so a genuine hang still fails the run fast rather than exhausting a much longer outer CI timeout.
- On timeout: calls `req.destroy()` (kills the request/socket), rejects with a deterministic `Error` (`"issueRawRequest: <path> timed out after 10000ms with no response"`), and sets a `settled` guard so any later event (e.g. the `error` this `destroy()` itself triggers) is a no-op instead of a second resolve/reject.
- Clears the timer (`clearTimeout(timer)`) on both normal completion (`res.on('end', ...)`) and on `req.on('error', ...)` — the only path that does *not* explicitly call `clearTimeout` is the timeout callback itself, since by definition that timer has already fired and requires no further clearing.
- CT-27's behavior/assertions and every production code path are unchanged — this is a test-harness-only correction, confirmed by re-running CT-27 (and the full suite) three consecutive times, all green (§16.3).

### 16.2 Debug-directory cleanup closure

The one item §9 previously flagged as needing manual removal, `%LOCALAPPDATA%\Temp\imaging-char-ingest-storage-eiNseb`, has been removed and independently re-verified as gone:

```
# Removal (Node fs.rmSync, forward-slash path — this Windows/Git-Bash hybrid
# shell was found to mis-handle backslash-escaped Windows paths passed through
# `node -e "..."`, which silently no-op'd force:true on a first attempt; a
# forward-slash path resolves correctly on Windows and avoids that ambiguity
# entirely):
node -e "
const fs = require('fs');
const p = 'C:/Users/Mustafa/AppData/Local/Temp/imaging-char-ingest-storage-eiNseb';
console.log('exists before:', fs.existsSync(p));
if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
console.log('exists after:', fs.existsSync(p));
"
# -> exists before: true
# -> exists after: false

# Independent second verification (separate tool/process, Bash-native, not Node):
ls "C:\Users\Mustafa\AppData\Local\Temp" | grep -i "imaging-char"
# -> (no output; explicit fallback check printed) CONFIRMED_REMOVED
```

Both checks agree: the directory no longer exists. No file from it remains anywhere on disk. This closes the item §9 previously left open — §9 has been updated in place to reflect this.

### 16.3 Re-validation performed after the corrective changes

| Check | Result |
|---|---|
| New disposable Postgres (`postgres:16-alpine`, container `imaging-char-007c-pg-v2`, ephemeral, non-default port `55441`) + `prisma migrate deploy` | All migrations applied cleanly, no drift |
| New suite, corrective run 1/3 | 13 passed, 0 failed |
| New suite, corrective run 2/3 | 13 passed, 0 failed |
| New suite, corrective run 3/3 | 13 passed, 0 failed |
| Explicit temp-root residue check after run 1 | `NO_RESIDUE` |
| Explicit temp-root residue check after run 2 | `NO_RESIDUE` |
| Explicit temp-root residue check after run 3 | `NO_RESIDUE` |
| DB residual counts after all 3 corrective runs | `imagingStudy:0, imagingImage:0, imagingRequest:0, imagingBridgeAgent:0, organization(non-default):0, clinic(non-default):0, patient:0, user:0, auditLog:0` |
| `npx tsc --noEmit` (server) | Clean, zero errors |
| `server/src/tests/imaging.test.ts` | 103 passed, 0 failed |
| `server/src/tests/imagingBridgePairing.test.ts` | 50 passed, 0 failed |
| `server/src/tests/imagingBridgeOnboarding.test.ts` | 14 passed, 0 failed |
| `server/src/tests/imagingBridgeUpdate.test.ts` | 44 passed, 0 failed |
| `server/src/tests/kvkkAttachmentImagingLifecycle.test.ts` (DB-backed) | 110 passed, 0 failed |
| `git diff --check` | Clean |
| `git diff --name-only origin/main...HEAD` | Exactly two files: the test suite and this evidence doc — no production code, Prisma schema/migration, dependency, lockfile, workflow, package file, shared helper, or program-control document touched |
| Disposable Postgres teardown | `docker stop imaging-char-007c-pg-v2` (ephemeral `--rm`, no volume — fully destroyed) |

No CT scope or test semantics changed in this round; only `issueRawRequest()`'s timeout handling was added, and the one debug-directory cleanup item was closed.

### 16.4 Commit / PR

- Corrective-round commit: `39171db` (`fix(imaging-tests): bound issueRawRequest() timeout, close debug-dir cleanup`) — test-harness fix + debug-directory cleanup + this evidence-doc update, all in one commit.
- Follow-up doc-only commit records this exact SHA back into §14 above (same pattern as the original submission's PR-URL/head-SHA follow-up) — see `git log` on this branch for the final pushed head SHA.
- PR review thread (comment id `3699989012`) replied to with this fix summary and marked resolved.
- Branch/PR unchanged: `test/f2-prep-007-c-imaging-ingest-storage` / PR #295. Not merged.
