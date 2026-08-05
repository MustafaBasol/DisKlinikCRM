# F1-004-P1-R2-PROD-001 — Emergency Contact Primary Promotion: Production Deployment and Functional Verification

| Field | Value |
|---|---|
| Task ID | F1-004-P1-R2-PROD-001 |
| Closeout task ID | F1-004-P1-R2-PROD-001-CLOSEOUT (this document; documentation and program-tracker reconciliation only) |
| Related verification task | F1-004-P1-R2-PROD-001-V1 |
| Parent task | F1-004-P1-R2 (root-cause confirmation and fix), continued by F1-004-P1-R2-R3 (CREATE-race closure via `expectedCurrentPrimaryContactId` optimistic-concurrency precondition) |
| Phase | F1 — Engineering Safety Net / Production Verification Closeout |
| Purpose | Records production deployment and real, human-operator, two-tab functional verification of the primary-contact optimistic-concurrency precondition into the repository's authoritative program documents, and formally closes F1-004-P1-R2-PROD-001. Documentation and program-tracker reconciliation only — no production code, migration, deployment, or data change is made by this task. |

## Evidence ownership and trust model

This document distinguishes three categories of claim throughout:

- **Agent verified** — confirmed directly by this closeout task via local Git metadata, the GitHub CLI against github.com, and direct inspection of tracked repository source files.
- **Human operator verified** — executed and observed by the authenticated human production operator directly against the production system and a live two-tab browser session; not performed, re-performed, or independently re-observed by this agent. This agent did not connect to production, did not control a browser against production, and was not supplied credentials.
- **Repository documented** — a fact recorded in this document on the operator's report, reconciled against (and not contradicted by) the agent-verifiable repository facts above, but not itself independently re-derivable from the repository.

Human-operator evidence is treated as valid production evidence once clearly attributed and reconciled with repository facts, per this task's own instructions. It is not downgraded merely because it had not yet been committed to the repository, and it is not re-performed by this task.

## 1. Production SHA

**Agent verified.** `255392cdaa6687bce1c217ab39e4df47367b25dd`.

- `git fetch origin --prune` run clean.
- `git rev-parse origin/main` → `255392cdaa6687bce1c217ab39e4df47367b25dd`.
- `git merge-base --is-ancestor 255392cdaa6687bce1c217ab39e4df47367b25dd origin/main` → true (the SHA is `origin/main`'s own current tip, confirmed by direct equality with the `rev-parse` output above, not merely ancestry).
- This closeout task's own worktree was created via `git worktree add ... origin/main`, and its `HEAD` independently confirms the identical SHA `255392cdaa6687bce1c217ab39e4df47367b25dd`.
- This SHA matches the production SHA reported by the human production operator's deployment evidence (§5 below) exactly.

## 2. PR and merge

**Agent verified**, via `gh pr view 325 --repo MustafaBasol/DisKlinikCRM --json number,title,state,mergedAt,mergeCommit,baseRefName,headRefName`:

- Number: `325`
- Title: `fix(patients): add primary-contact concurrency precondition for create and update (F1-004)`
- State: `MERGED`
- Base branch: `main`
- Head branch: `fix/f1-004-p1-r2-emergency-contact-update-race`
- `mergedAt`: `2026-08-05T18:31:13Z`
- `mergeCommit.oid`: `255392cdaa6687bce1c217ab39e4df47367b25dd` — identical to the `origin/main` tip confirmed in §1, i.e. PR #325's merge commit is the current tip of `main`, not an older, superseded merge.

## 3. Post-merge `main` CI

**Repository documented**, reconciled against the PR record above (§2): post-merge `main` CI run `31035113998`, result `SUCCESS`. This closeout task did not independently re-query this specific run ID via `gh run view`, since it is upstream of, and unaffected by, this task's own documentation-only change; it is recorded here as supplied and is consistent with PR #325's `MERGED` state and merge commit confirmed independently in §2.

## 4. Repository-confirmed API contract

**Agent verified**, by direct inspection of `server/src/routes/patientEmergencyContacts.ts` on this task's own worktree (HEAD `255392cdaa6687bce1c217ab39e4df47367b25dd`):

- Endpoints: `POST /api/patients/:patientId/emergency-contacts`, `PUT /api/patients/:patientId/emergency-contacts/:contactId`.
- Both accept an optional `expectedCurrentPrimaryContactId` field whenever the request would set `isPrimary=true`. Three accepted forms, confirmed directly in the route's own header comment and corroborated by its `resolvePrimaryPromotion` call sites:
  - **omitted** — falls back to the pre-existing (F1-004-P1-R2) best-effort "prior vs current" comparison; allowed for backward compatibility with older clients, knowingly not race-free against the mechanism F1-004-P1-R2-R3 closed.
  - **explicit `null`** — the client observed no current primary contact.
  - **a contact ID** — the client observed that exact contact as the current primary.
- Conflict contract: both `POST` and `PUT` catch a primary-contact conflict via `isPrimaryContactConflict(txErr)` and respond `res.status(409).json({ ..., code: 'PRIMARY_CONTACT_CONFLICT' })` — confirmed at two call sites in the route file (create path and update path), each returning HTTP `409` with `code: 'PRIMARY_CONTACT_CONFLICT'` verbatim.
- This contract matches the human-operator production evidence in §8–§9 below exactly: the operator's Tab B requests receiving HTTP `409` with `code: PRIMARY_CONTACT_CONFLICT` is the same conflict path this task independently confirmed in the merged source.

## 5. Deployment evidence

**Human operator verified**, supplied by the authenticated human production operator; not re-performed or independently re-observed by this agent:

- Production code updated to target SHA `255392cdaa6687bce1c217ab39e4df47367b25dd`.
- Database schema up to date.
- 72 migrations found, no pending migration.
- Prisma Client generated.
- Backend typecheck: passed.
- API restarted: restart count 7 → 8.
- Worker restarted: restart count 7 → 8.
- API online; Worker online.
- No real post-restart application errors observed.

## 6. Migration status

**Human operator verified** (count) and **agent verified** (no new migration introduced by this closeout):

- Production reported 72 migrations found, 0 pending, at deployment time.
- No schema action was performed during the human operator's browser verification (§8–§9) — that verification exercised only the existing, already-deployed `POST`/`PUT` emergency-contact endpoints.
- This closeout task introduces no new migration. `git status`/`git diff --stat` for this task's branch touch only documentation files (see §20).

## 7. Exact automated validation results

**Human operator verified**, supplied by the authenticated human production operator as part of the same deployment:

- Backend emergency-contact tests: 31/31.
- Frontend focused tests: 40/40.
- Frontend production build: passed.

These counts are consistent with the counts independently recorded in the merged PR #325 evidence trail (`patientEmergencyContacts.test.ts` 31/31, 40/40 frontend component tests) already present in `docs/program/evidence/F1-004-P1-R2_EMERGENCY_CONTACT_UPDATE_RACE_ROOT_CAUSE_AND_FIX.md` prior to this closeout — this task did not re-run these suites itself; a docs-only closeout does not warrant re-running the application test suite (see §19).

## 8. API/worker restart evidence

**Human operator verified.** API restart count 7 → 8; Worker restart count 7 → 8; both processes reported online after restart with no real post-restart application errors.

## 9. Health, TLS, and CORS verification

**Human operator verified**, all performed directly against production by the authenticated human operator:

- Local API health: HTTP 200, `{"status":"ok"}`.
- Public API health: HTTP 200, `{"status":"ok"}`.
- `app.noramedi.com/login`: HTTP 200.
- Static asset: HTTP 200, `immutable` cache header present.
- TLS certificate SAN list includes: `api.noramedi.com`, `app.noramedi.com`, `noramedi.com`, `www.noramedi.com`.
- CORS preflight: HTTP 204.
- `Access-Control-Allow-Origin: https://app.noramedi.com`.
- `Access-Control-Allow-Credentials: true`.

## 10. Human-operated Scenario 1 — existing-primary stale state

**Human operator verified**, performed directly against production using two browser tabs and DevTools Network inspection; not performed, re-performed, or independently observed by this agent:

1. Both tabs opened the same test patient.
2. Both tabs observed the same current primary emergency contact.
3. Tab A promoted a different contact to primary.
4. Without refreshing, Tab B attempted to promote another contact.
5. Tab B's request carried the primary contact ID originally observed by Tab B: `expectedCurrentPrimaryContactId: "<masked-original-primary-id>"`.
6. Tab B received HTTP `409 Conflict`, `code: PRIMARY_CONTACT_CONFLICT` — matching the repository-confirmed contract in §4.
7. The UI displayed: "Another request just set a primary contact for this patient. Please retry."
8. Tab B refreshed.
9. Tab B observed Tab A's contact as the canonical primary.
10. Tab B retried with the newly observed canonical primary ID.
11. The retry succeeded.
12. Both tabs refreshed and showed exactly one primary contact.

## 11. Human-operated Scenario 2 — no-primary / explicit-`null` stale state

**Human operator verified**, performed directly against production using two browser tabs and DevTools Network inspection; not performed, re-performed, or independently observed by this agent:

1. Both tabs observed a patient state with no primary emergency contact.
2. Both tabs therefore held `expectedCurrentPrimaryContactId: null`.
3. Tab A promoted a contact to primary successfully.
4. Without refreshing, Tab B attempted to promote another contact using `expectedCurrentPrimaryContactId: null`.
5. Tab B received HTTP `409 Conflict`, `code: PRIMARY_CONTACT_CONFLICT`.
6. The UI displayed the expected retry warning.
7. Tab B refreshed.
8. Tab B observed Tab A's newly created canonical primary.
9. Tab B retried with the now-current primary contact ID.
10. The retry succeeded.
11. Both tabs refreshed and showed exactly one primary contact.

**Interpretation, stated explicitly:** the null scenario is not expected to, and did not, let both concurrent requests succeed. Correct behavior is Tab A succeeding from the no-primary state and Tab B's stale `null` precondition being rejected once Tab A has created a primary — proving `null` is enforced as a real observed-state precondition, not treated as "skip concurrency checking." The observed result matches this expected behavior exactly.

## 12. HTTP 409 and `PRIMARY_CONTACT_CONFLICT` result

**Human operator verified** (both scenarios produced this result on production) and **agent verified** (the merged source at `255392cdaa6687bce1c217ab39e4df47367b25dd` implements exactly this response — see §4). Both the create-path and update-path conflict branches in `patientEmergencyContacts.ts` return HTTP `409` with `code: 'PRIMARY_CONTACT_CONFLICT'`; the human-operator observations in §10–§11 are consistent with this contract in both scenarios.

## 13. Refresh/retry success

**Human operator verified.** In both scenarios, after Tab B refreshed and re-observed the canonical primary contact, a retry using the newly observed primary ID succeeded, confirming the intended client recovery path (reload, then retry) is not just theoretically available but functions correctly against production.

## 14. Exactly-one-primary invariant

**Human operator verified.** After both scenarios, both tabs refreshed and showed exactly one primary contact for the test patient — confirming the single-primary invariant (enforced by the advisory lock plus optimistic-concurrency precondition at the application layer, and the pre-existing partial unique index at the database layer) held under real concurrent production traffic, not merely under the CI stress rounds already recorded in the merged PR evidence.

## 15. Tenant/security impact

- The change prevents stale concurrent promotion from silently overwriting the canonical primary state.
- The production verification confirmed fail-closed behavior: a stale precondition is rejected with `409`/`PRIMARY_CONTACT_CONFLICT` rather than being silently accepted or silently overwritten.
- No cross-tenant access was involved. The human-operator verification used one authorized clinic and one authorized test patient throughout both scenarios.
- The exactly-one-primary invariant remained intact in both scenarios (§14).
- No new direct cross-domain access was introduced by PR #325 — confirmed by repository inspection: the change is confined to `server/src/routes/patientEmergencyContacts.ts`, `server/src/services/patientEmergencyContacts.ts`, `server/src/services/patientEmergencyContactsConcurrency.ts`, and their frontend/test counterparts, all already within the emergency-contacts domain's existing ownership.
- Modular-monolith boundaries were not changed. This closeout introduces no code change and PR #325 introduced no new domain, service boundary, or routing change beyond the existing emergency-contacts endpoints.

## 16. Migration impact

- No new migration was introduced by this closeout.
- Production reported 72 migrations and no pending migration (§5, §6).
- No schema action was performed during the human operator's browser verification (§10–§11) — both scenarios exercised only the existing `POST`/`PUT` emergency-contact endpoints against already-migrated schema.

## 17. Rollback

Two distinct rollback paths, not to be conflated:

- **Closeout documentation rollback**: revert the documentation commit that introduces this evidence file and the associated tracker/phase-document updates. This has no runtime, schema, or production effect — it only reverts repository documentation.
- **Already-deployed application rollback**: if a later regression is discovered, use the repository's established deployment rollback method to return production to the pre-PR #325 production SHA. **The exact pre-PR #325 production SHA is not stated here because it is not confirmed by repository or evidence records available to this closeout task — it remains unverified.** Do not infer or invent a specific prior SHA; the operator/deployment tooling should identify the correct pre-#325 target at rollback time from its own deployment history.
- No migration rollback is required for either path, since PR #325 introduced no schema change (§16).

## 18. Privacy handling

- Patient name, phone number, and email are not included anywhere in this document.
- Full patient UUID and full emergency-contact UUID are not included; where an ID is referenced, it is masked in the operator's original form, e.g. `ca0fab09…efe50`, or referred to only as `<masked-original-primary-id>` / "the newly observed canonical primary ID" without a literal value.
- Clinic user names are not included.
- Cookies, tokens, request headers, and credentials are not included.
- Screenshots from the human operator's two-tab browser verification were reviewed outside the repository and are intentionally excluded from this document and from the repository due to PII exposure risk (patient/contact identifying information visible in the UI and DevTools Network panel). No screenshot is committed by this closeout.

## 19. Validation commands run by this closeout task

This is a documentation-only closeout. No application, migration, or deployment suite was re-run, consistent with the task's own instruction not to rerun expensive application suites for a docs-only change unless affected-test detection requires it. This repository does not expose an automated affected-test-detection command scoped to a documentation-only diff outside the CI workflow itself, so the applicable check is a direct diff-scope confirmation:

```
git diff --stat origin/main...HEAD
```

confirms only documentation files under `docs/program/` are touched by this task's commit (see §20) — no `server/src/**`, `src/components/**`, test file, `server/prisma/**`, `package.json`/lockfile, or `.github/workflows/**` path appears in the diff. This is the docs-only-detection result for this task: **code and test suites were correctly skipped.**

```
git diff --check
```

reports no whitespace-conflict-marker errors in the changed files.

This repository was not found to expose a dedicated markdown link/format validation script in `package.json`/`server/package.json` at the time of this check; none was run.

Repository-fact checks (all §1–§4 above):

```
git fetch origin --prune
git rev-parse origin/main
git merge-base --is-ancestor 255392cdaa6687bce1c217ab39e4df47367b25dd origin/main
gh pr view 325 --repo MustafaBasol/DisKlinikCRM --json number,title,state,mergedAt,mergeCommit,baseRefName,headRefName
```

## 20. Files changed by this closeout task

- `docs/program/evidence/F1-004-P1-R2-PROD-001-production-verification.md` (new — this file)
- `docs/program/NORAMEDI_MASTER_TRACKER.md` (reconciled — new top entry recording production verification, prior `NOT_MERGED`/`NOT_DEPLOYED`/`NOT_PRODUCTION_VERIFIED` entries annotated, not deleted)
- `docs/program/CURRENT_PHASE.md` (closeout entry added)

No `server/src/**`, `src/components/**`, test file, `server/prisma/**`, `package.json`/lockfile, or `.github/workflows/**` path is touched.

## 21. Final classification

- Repository facts (PR #325 merge, production SHA, API contract, conflict response shape): **agent verified**.
- Production deployment, automated validation counts, restart evidence, health/TLS/CORS checks: **human operator verified**, reconciled against repository facts, not contradicted by them.
- Two-tab functional verification (Scenario 1, Scenario 2/null, HTTP 409/`PRIMARY_CONTACT_CONFLICT`, refresh/retry success, exactly-one-primary invariant): **human operator verified**, not re-performed by this agent.
- **Task status: `PRODUCTION VERIFIED` / `DONE`.**
- This closeout task itself: documentation and program-tracker reconciliation only, no code/migration/deployment/production action performed by the agent.
