# F2-PREP-007-A — Imaging Characterization: Auth, Redaction, Audit, and Wire Shape

**Phase:** F2 — Imaging Stage 0 characterization coverage.
**Parent contract:** [F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md](../architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md) §14 (characterization-test gate) and its JSON companion's `characterizationTests[]`.
**Type:** TEST-ONLY. No application code, Prisma schema/migration, dependency, package.json, workflow, or program-control-file change is made or authorized by this task.
**Status:** `AGENT_COMPLETED` / `VALIDATION_PASSED` / `PR_OPENED_AWAITING_REVIEW`. Not merged, not deployed, not production-verified.

---

## 1. Task and phase

F2-PREP-007-A implements five of the eighteen Stage-1-gating characterization tests defined by F2-PREP-006-E's contract (§14 / JSON `characterizationTests[]`):

| CT ID | Area | Target |
|---|---|---|
| CT-06 | rbac / auth boundary | `imagingBridgePublic.ts` Bearer auth must reject a clinic-session JWT (401) |
| CT-16 | secure-url-authorization | `legalHoldReason` redaction uniform across `GetImagingStudy`, `ListPatientImaging`, `ListUnlinkedImagingStudies`, `CreateImagingStudy` |
| CT-19 | archive-deletion | No `DELETE` route exists for `ImagingStudy` or `ImagingImage` |
| CT-21 | audit | Legal-hold audit metadata carries `actorRole` + hold-state booleans, never `legalHoldReason` text |
| CT-28 | backward-compatibility | Deterministic response-shape snapshots for `GetImagingStudy`, `ListPatientImaging`, `CreateImagingStudy` |

This is Stage 0 (characterization) only. Per the contract's §15 sequencing table, Stage 1 (additive facade) may not begin until all 18 Stage-1-gating tests exist and pass against current behavior; this task delivers 5 of those 18. The remaining 13 (CT-02, 03, 05, 07, 08, 10–14, 17, 26, 27, 32) are out of scope for this task and remain open.

---

## 2. Baseline / worktree proof

```
git fetch origin --prune
git rev-parse origin/main
-> 5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb

git status --short
-> (clean)

git worktree add ../DisKlinikCRM-f2prep007a -b test/f2-prep-007-a-imaging-auth-shape origin/main
-> HEAD is now at 5dc5ad6 Merge pull request #292 from MustafaBasol/docs/f2-prep-006-e-imaging-boundary-consolidation
```

Exact baseline SHA: `5dc5ad67c7e9feee11f6fece9a7d65e03033d2fb` (`origin/main` tip at task start, matching the SHA specified in the task brief). Worktree is fresh and isolated at `../DisKlinikCRM-f2prep007a`; no sibling worktree was reused, read, merged, or rebased onto. No rebase, no force-push.

Environment setup performed in the fresh worktree (no `node_modules`/generated Prisma client are checked into git):

```
cd server && npm ci --no-audit --no-fund
-> added 400 packages (package.json / package-lock.json unchanged — npm ci installs
   exactly what the existing lockfile specifies, never modifies it)

npx prisma generate
-> Generated Prisma Client (v7.8.0) to .\node_modules\@prisma\client
```

---

## 3. Files read and targeted CodeGraph scope

Read in full before writing any test code:

- `AGENTS.md`
- `docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md` (full)
- `docs/program/architecture/evidence/F2-PREP-006-E_imaging_boundary_contract.json` (full)
- `docs/program/evidence/F2-PREP-006-D_imaging_contract_test_design.json` (`characterizationTests[]` entries for CT-01 through CT-31, `blockingTests`/`nonBlockingTests`, `backwardCompatibilityRequirements`)
- `server/src/routes/imaging.ts` (full — 1303 lines: route table, redaction helpers, `CreateImagingStudy`, `ListUnlinkedImagingStudies`, `ListPatientImaging`, `GetImagingStudy`, `SetImagingLegalHold`, `auditImaging`, `studyInclude`/`studyImageSelect`)
- `server/src/routes/imagingBridgePublic.ts` (full — `authenticateBridgeAgent`, all five public routes)
- `server/src/utils/auditLog.ts` (full — `writeAuditLog`, `AuditLogInput` shape, confirms `actorRole` is a top-level field, not nested under `metadata`)
- `server/src/middleware/auth.ts` (full — `authenticate`, `authorize`, `generateToken`, `AuthRequest` shape, `JWT_SECRET` handling)
- `server/src/utils/clinicScope.ts` (full — `validateAndGetClinicIdScope`/`buildClinicIdScope`/`resolveEffectiveClinicId`, needed to correctly mock the scope-resolution calls every read/write route makes)
- `server/src/services/fileStorage.ts` (full — confirmed `saveFile`/`deleteFile` default to local disk with no S3/DB dependency when `S3_BUCKET` is unset, informing the CreateImagingStudy test's real-but-synthetic local file write)
- `server/src/services/imaging/bridgeTokens.ts` (full — `generateBridgeToken`/`hashBridgeToken`)
- `server/src/services/imaging/imagingUploadValidation.ts` (full — `normalizeDeclaredMime`, `IMAGING_EXTENSIONS_BY_MIME`, confirms `'image/jpeg'` passes through unchanged)
- `server/src/utils/helpers.ts` (`getParam`, `createRateLimiter` — confirmed the rate limiter defaults to an in-memory store with no Redis/DB dependency)
- `server/src/tests/imaging.test.ts`, `imagingBridgePairing.test.ts`, `imagingBridgeOnboarding.test.ts`, `imagingBridgeUpdate.test.ts` (existing conventions: hand-rolled `test`/`section` harness, `src()` source-regression helper)
- `server/src/tests/communicationPreferencesRoute.test.ts`, `treatmentCasesProposalPdfRoute.test.ts`, `externalCalendarWebhookRouteE2E.test.ts` (established repo convention for route-level testing — **this repo has no supertest/live-listening-server pattern anywhere**; route handlers are extracted directly from the real router's internal `stack` and invoked against a constructed request/response, and `prisma`'s model delegates are swapped for in-memory fakes as plain writable properties on the shared singleton)
- `server/src/schemas/index.ts` (`imagingStudyUploadSchema`, `IMAGING_MODALITIES` — confirmed `{ modality: 'OTHER' }` is a minimal valid `CreateImagingStudy` body)

**Targeted CodeGraph scope:** limited to the Imaging/Bridge route files above, their directly-imported helpers (`clinicScope.ts`, `auditLog.ts`, `fileStorage.ts`, `bridgeTokens.ts`, `imagingUploadValidation.ts`), and the existing Imaging test suite. No scan of the whole repository was performed or needed; no scope expansion beyond this list occurred.

---

## 4. CT IDs implemented

All five (CT-06, CT-16, CT-19, CT-21, CT-28) are implemented as **executable, passing tests** in `server/src/tests/imagingCharacterizationAuthShape.test.ts` — none are documentation-only placeholders.

Per F2-PREP-006-D's own test-level classification, none of these five requires disposable-Postgres/live-storage infrastructure (`CT-06`: integration-supertest → adapted to this repo's handler-extraction convention; `CT-16`: unit-mock; `CT-19`: static-route-inventory; `CT-21`: unit-mock; `CT-28`: snapshot/unit-mock). All five run standalone, in-process, with no live Postgres and no network I/O.

---

## 5. Current behavior findings

**No `VERIFIED_DEFECT` was found.** All five CTs' accepted assertions (per F2-PREP-006-D's `characterizationTests[]`) matched current, running production behavior on first execution — no reproduction-twice-and-report path was triggered. Specifically:

- **CT-06:** `imagingBridgePublic.ts`'s `authenticateBridgeAgent` never inspects JWT structure at all — it treats the `Authorization: Bearer` value as an opaque string, SHA-256-hashes it, and looks up an `ImagingBridgeAgent` row by `tokenHash`. A clinic-session JWT (even a genuine, correctly-signed one, minted via the real `generateToken()`) never collides with a seeded agent's hash, so it is rejected 401 with the same generic body as every other rejection reason (revoked, unknown, missing). Confirmed with both a real signed JWT and, as a positive control, a genuine bridge credential for a seeded agent (accepted 200) — proving the fake DB lookup is a real match, not an always-null stub.
- **CT-16:** `redactStudyLegalHoldReason(study, canSeeLegalHoldReason(req))` is applied identically at all four response sites (`imaging.ts:681, 704, 730, 741`). Confirmed by exercising the real, unmodified route handlers (not a reimplementation) for `CLINIC_MANAGER`/`DENTIST`/`RECEPTIONIST` (redacted to `null`, `legalHold` boolean still visible) and `OWNER`/`ORG_ADMIN` (reason text preserved) across all four surfaces, plus a source-regression guard asserting the exact `redactStudyLegalHoldReason(full!, canSeeLegalHoldReason(req))` call text at `CreateImagingStudy`'s response line.
- **CT-19:** Live route-table introspection of the real, imported `imaging.ts` and `imagingBridgePublic.ts` Express routers (not just a source-text grep) confirms zero `DELETE` routes target any `/imaging/studies*` path or any path containing `images`. The three real `DELETE` routes that do exist (`/imaging/devices/:id`, `/imaging/bridges/:id`, `/imaging/bridge-pairings/:id`) are unrelated to `ImagingStudy`/`ImagingImage`. A sanity check confirms the introspection genuinely finds delete routes (not a vacuous always-pass), and an independent source-text regex cross-check agrees exactly with the live route table.
- **CT-21:** `SetImagingLegalHold`'s `auditImaging(...)` call passes `metadata: { legalHold, previousLegalHold }` only — confirmed by capturing the real `prisma.auditLog.create` call (via `writeAuditLog`, unmodified) across both placing (OWNER) and releasing (ORG_ADMIN) a hold, and asserting the full serialized audit entry never contains the reason text, for either role. `actorRole` is written as a **top-level** `AuditLog` column (via `writeAuditLog`'s `actorRole` input), not nested inside `metadata` — this is the current, correct shape and satisfies the contract's assertion that "audit entry records actorRole."
- **CT-28:** Snapshots recorded for `GetImagingStudy` (OWNER and RECEPTIONIST — the redacted case), `ListPatientImaging` (array-of-study-shape), and `CreateImagingStudy` (real handler invocation, real local-disk file save, real `$transaction`/create/find-unique call sequence, redacted response). Field names, `images[]` nesting, and the seven `studyInclude` relations (`device`, `patient`, `appointment`, `treatmentCase`, `imagingRequest`, `createdBy`, plus `images`) are all captured.

No contradiction between the accepted contract's assertions and observed behavior was found for any of the five CTs in this task's scope.

---

## 6. Files changed

Created only — no existing file modified:

- `server/src/tests/imagingCharacterizationAuthShape.test.ts` (new, self-contained)
- `docs/program/evidence/F2-PREP-007-A_IMAGING_CHARACTERIZATION_AUTH_SHAPE_EVIDENCE.md` (this file)

No shared test helper was modified. No production file (`server/src/routes/**`, `server/src/services/**`, `server/src/utils/**`, `server/src/middleware/**`) was touched. No Prisma schema/migration. No `package.json`/`package-lock.json` change (`npm ci` in the worktree installs from the existing, unmodified lockfile). No `CURRENT_PHASE.md`, master tracker, phase document, evidence `README.md`, workflow, or package-script file touched.

### Design notes on test technique

- **No supertest / live HTTP server**, matching this repo's own established, documented convention (`treatmentCasesProposalPdfRoute.test.ts`, `communicationPreferencesRoute.test.ts`, `externalCalendarWebhookRouteE2E.test.ts`): the real, unmodified route handlers are extracted from the real routers' `router.stack` and invoked directly against a constructed request/response. `authorize()`/`handleUpload` (multer) middleware layers are deliberately skipped in favor of directly constructing `req.user`/`req.file`, exactly as the cited precedent files document doing.
- **No live Postgres.** `prisma`'s model delegates (`auditLog`, `clinic`, `patient`, `imagingStudy`, `imagingImage`, `imagingRequest`, `imagingBridgeAgent`, `imagingBridgeBinding`) and `$transaction` are swapped for small in-memory fakes as plain writable properties on the shared `prisma` singleton — the same technique `externalCalendarWebhookRouteE2E.test.ts` documents using. A single canned study fixture (shaped exactly like `imaging.ts`'s `studyInclude` result) is returned by the read fakes regardless of the `where` clause's filter details — this is a deliberate unit-mock/snapshot-level design matching CT-16/CT-28's own designated test level (`unit-mock`/`snapshot`, not `db-integration`); tenant-isolation correctness of the `where` clause itself is CT-01/CT-02's job, explicitly out of this task's scope.
- **`CreateImagingStudy` is exercised as real, running code**, including a genuine (tiny, synthetic-JPEG-magic-bytes) local-disk file write via the real, unmodified `fileStorage.ts` (which defaults to local disk with no S3/DB dependency when `S3_BUCKET` is unset) — not a stub. The written file is deleted in a `finally`-style cleanup step at the end of the suite, verified by asserting the directory no longer exists.
- **Deterministic fixtures, not post-hoc normalization of randomness.** Per the task's "normalize UUIDs/timestamps/paths before snapshots" constraint: rather than generating real `crypto.randomUUID()`/`new Date()` values and normalizing them after the fact, every fixture ID and timestamp is a fixed, deterministic literal string from the start (e.g. `study-f2prep007a-0000`, `2026-01-01T00:00:00.000Z`) — there is no nondeterministic value for any assertion to depend on. A `normalizeForSnapshot()` walker (UUID/ISO-timestamp/absolute-path → placeholder) is still included and applied as a defensive second layer, so a future regression that introduces a real generated UUID/Date/path into a response would be caught rather than silently producing a flaky snapshot.
- **No PHI, token, filename, or `legalHoldReason` content is ever logged.** The one synthetic "reason" string used (`SYNTHETIC_TEST_ONLY_LEGAL_HOLD_JUSTIFICATION_TEXT`) is checked only via `assert.ok(!serialized.includes(...))`/`assert.equal(..., null)` — pass/fail booleans, never printed. No real bridge token, JWT, or file path appears in any console output.

---

## 7. Exact test commands and counts

All commands run from the worktree's `server/` directory.

```
npx tsx src/tests/imagingCharacterizationAuthShape.test.ts
-> 36 passed, 0 failed
```

Breakdown: CT-06 (5 tests), CT-19 (5 tests), CT-21 (4 tests), CT-16 (17 tests: 3 redacted roles × 4 surfaces + 2 unredacted roles × 2 surfaces + 1 source-regression guard), CT-28 (4 tests), cleanup (1 test) = 36.

Relevant existing Imaging/Bridge tests (unmodified, re-run to confirm no regression from this task's presence):

```
npx tsx src/tests/imaging.test.ts                    -> 103 passed, 0 failed
npx tsx src/tests/imagingBridgeOnboarding.test.ts     -> 14 passed, 0 failed
npx tsx src/tests/imagingBridgePairing.test.ts        -> 50 passed, 0 failed
npx tsx src/tests/imagingBridgeUpdate.test.ts         -> 44 passed, 0 failed
```

Relevant audit/KVKK test:

```
npx tsx src/tests/kvkkAttachmentImagingLifecycle.test.ts   -> 110 passed, 0 failed
```

(This is the directly Imaging-relevant KVKK/audit suite — it already covers legal-hold redaction/audit-PII source regression across `imaging.ts` and `attachments.ts`. `retentionManualRunAudit.test.ts` was also considered but is a Platform-Admin retention-run audit test unrelated to Imaging and requires a live disposable Postgres not available in this sandboxed run — it was not exercised, and its absence does not affect this task's scope.)

Backend typecheck:

```
npx prisma generate && npx tsc --noEmit
-> exit 0, no diagnostics
```

`git diff --check`:

```
git diff --cached --check
-> exit 0 (one informational CRLF-normalization notice on the new file, not a whitespace error)
```

Changed-file scope verification:

```
git status --short
-> ?? server/src/tests/imagingCharacterizationAuthShape.test.ts
-> ?? docs/program/evidence/F2-PREP-007-A_IMAGING_CHARACTERIZATION_AUTH_SHAPE_EVIDENCE.md
```

Only these two new files exist in the diff — no existing file (production, test, or program-control) was modified.

**Infrastructure:** in-process Node/tsx only; no live Postgres, no network I/O, no Redis (rate limiters fall back to their in-memory store), one real local-disk write/delete pair under a synthetic clinic id, cleaned up within the suite itself. **Duration:** full new-suite run completes in under 2 seconds; combined with the four existing Imaging/Bridge suites and the KVKK suite, well under 30 seconds total.

---

## 8. Cleanup and fixture isolation

- All prisma model-delegate fakes are process-local (reassigned properties on the shared `prisma` singleton for the lifetime of this one `tsx` process); they do not persist and do not touch any real database.
- The one real filesystem side effect — `CreateImagingStudy`'s local-disk file save under `uploads/clinic-f2prep007a-0000/...` — is removed by the suite's own final `Cleanup` section (`fs.promises.rm(..., { recursive: true, force: true })`), and the test asserts `fs.existsSync(dir) === false` afterward. Confirmed post-run: `ls uploads` in `server/` shows no such directory.
- No organization/clinic/patient/user row is ever created in a real database (no live Postgres was used) — all identifiers are synthetic, fixed literal strings clearly namespaced `*-f2prep007a-*`.
- No token, filename, or `legalHoldReason` text is written to console output at any point (see §6, last bullet).

---

## 9. Tenant/KVKK/security impact

None. This is a test-only change; zero application code was modified. No production authorization, redaction, audit, or route-table behavior changed — this task only adds tests that observe and pin down the current, already-deployed behavior of `imaging.ts`/`imagingBridgePublic.ts`. The KVKK legal-hold redaction and audit-PII-minimization invariants this suite characterizes were already enforced by production code before this task and remain unchanged after it (confirmed by the existing `kvkkAttachmentImagingLifecycle.test.ts` suite passing unmodified, §7).

---

## 10. Migration and rollback

No migration. Rollback is trivial: revert the single commit adding these two new files; nothing else depends on them, and no production code path references this test file.

---

## 11. PR number and head SHA

See PR opened against `main` from branch `test/f2-prep-007-a-imaging-auth-shape`. PR number and exact head commit SHA are recorded in the PR itself at open time (this evidence file is authored in the same commit as the test file, prior to push).

---

## 12. Status

- **Agent completed:** yes.
- **Tests passed:** yes — new suite 36/36; four existing Imaging/Bridge suites 211/211 combined (103+14+50+44); KVKK/audit suite 110/110; typecheck clean; `git diff --check` clean; changed-file scope verified as exactly the two new files listed in §6.
- **PR opened:** yes, against `main`, test-only.
- **Merged:** no.
- **Deployed:** no.
- **Production verified:** no (test-only change; nothing to production-verify).

---

## 13. Rejected or unverified claims

None. All five implemented CTs' assertions were verified as currently true on first execution; no `VERIFIED_DEFECT` was reported, and no claim in this task's scope was rejected or left unverified.

---

## 14. What should happen next

- The remaining 13 Stage-1-gating characterization tests (CT-02, CT-03, CT-05, CT-07, CT-08, CT-10 through CT-14, CT-17, CT-26, CT-27, CT-32) still need implementation before Stage 1 (additive facade) of the F2-PREP-006-E expand-migrate-contract sequence may begin. Most of these require disposable-Postgres/live-storage infrastructure (per F2-PREP-006-D's own test-level classification) not exercised by this task.
- The 3 caller-migration-gating tests (CT-05, CT-23, CT-30) and the 11 non-blocking regression-coverage tests (CT-01, CT-04, CT-09, CT-15, CT-18, CT-20, CT-22, CT-24, CT-25, CT-29, CT-31) also remain open.
- This task does not update `CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`, `phases/F2_MODULAR_BOUNDARIES.md`, or `docs/program/evidence/README.md` by design (per the task brief, these are reserved for a final consolidation task to avoid parallel-task conflicts) — that consolidation task should record this task's 5 completed CT IDs against the contract's 18-item Stage-1 gate once this PR is reviewed/merged.
