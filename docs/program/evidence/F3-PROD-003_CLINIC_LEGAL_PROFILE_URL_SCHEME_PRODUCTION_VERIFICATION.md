# F3-PROD-003 — Clinic Legal Profile Website URL Scheme: Production Verification and R-076 Closure-Lifecycle Reconciliation

**Status: `MERGED` / `DEPLOYED` / `PRODUCTION_VERIFIED` (partial — blocking/negative path only) / `R-076` → `MITIGATED`, explicitly not `CLOSED`.**

> **Amended 2026-08-17 by F3-PROD-003-R1 (documentation-only correction requested by architecture review, same branch / same PR #435).** Two descriptive errors were corrected, and nothing else: (1) the frontend `dist` replacement was described as an *atomic swap*; it is in fact a **two-step same-filesystem rename swap** (`mv dist "$ROLLBACK_DIR"` then `mv dist.next dist`) and is therefore **near-atomic, not a single atomic exchange** — see §5.1. (2) The backend rollback procedure was described as reverting `origin/main` and re-running the deploy script with `--skip-migrate` only; that wording implied a remote-branch rewrite for a runtime rollback and, by omitting `--skip-pull`, would have let the script's `git pull` fast-forward production back to current `main` and defeat the rollback — see §11, now aligned to the authoritative runbook. **No finding, status, count, SHA, or lifecycle state changed:** `R-076` remains `MITIGATED` (not `CLOSED`), `MERGED` = yes, `DEPLOYED` = yes, `PRODUCTION_VERIFIED` = partial, negative path production-verified, positive path outstanding, `SAFE_PUBLISHED_WEBSITE_COUNT = 0`, no production data mutated, migration = none.

This task performed **no production access itself**. All production facts below are **operator-supplied**, accepted per this program's established convention for operator-executed evidence (e.g. F3-PROD-001, F3-PROD-002, F3-IMPL-002-PROD-RECON). Where independently checkable from this repository/GitHub without production access, facts were re-verified and are marked as such.

## 1. Task identity and phase

| Field | Value |
|---|---|
| Task ID | **F3-PROD-003 — issued by this task** |
| Title | R-076 Production Verification and Closure-Lifecycle Reconciliation |
| Phase | F3 — Production Hardening |
| Risk | R-076 (opened 2026-08-12 by F3-SEC-003; remediated by F3-SEC-004; `OPEN` at that task's completion) |
| Remediating task | F3-SEC-004 (2026-08-16), PR #434 |
| This task | Production deployment/verification lifecycle closure reconciliation only — no code change |
| Schema/migration change | **NO** (none introduced by F3-SEC-004; none introduced here) |

**Task-ID collision/selection.** `docs/program/` was searched for `F3-PROD-003` before use; no match. This program already uses the `F3-PROD-*` category specifically for production-deployment-and-exit-gate reconciliation of a previously repository-only task (`F3-PROD-001` — F3 train deployment reconciliation; `F3-PROD-002` — deploy-script execution verification, closing R-033/R-040 on operator-executed evidence). This task is the same category applied to F3-SEC-004/R-076, so the next sequential ID, `F3-PROD-003`, is used rather than a suffix on `F3-SEC-004` (a `-PROD-RECON`-style suffix was considered — that pattern was used once, by `F3-IMPL-002-PROD-RECON`, for reconciling a worker-contract installation gap, a narrower and different situation).

## 2. Purpose

F3-SEC-004 shipped a three-layer fix for R-076 (probable stored XSS via `ClinicLegalProfile.website`) but was explicitly repository-only: `AGENT_COMPLETED` / `TESTS_PASSED` / `PR_OPENED` (Draft), not merged, not deployed, not production-verified. Its own evidence document (§16, §17) states R-076 cannot be closed by that task and names the exact next steps: merge, deploy frontend+backend together, production-verify (a legitimate `https` link still renders; a `javascript:` write is rejected with 400), then let architecture review consider closure — by a task other than F3-SEC-004. This task performs that reconciliation.

## 3. Baseline and branch

| Field | Value |
|---|---|
| Branch | `docs/f3-prod-003-r076-production-closure`, created from `origin/main`, clean tree |
| `origin/main` (this task's baseline) | `40bfcb899c54e545f992003b2203ad729114a5fe` — **also the deployed production release** |
| Prior production release | `b370b0181fa2f84e24f0f80560425da81f60dcb2` |

No production access of any kind was performed by this task.

## 4. Merge status — independently confirmed

```
$ gh pr view 434 --json state,mergeCommit,baseRefName,headRefName,title
{
  "baseRefName": "main",
  "headRefName": "fix/f3-sec-004-clinic-legal-profile-url-xss",
  "mergeCommit": { "oid": "40bfcb899c54e545f992003b2203ad729114a5fe" },
  "state": "MERGED",
  "title": "fix(security): restrict clinic legal-profile website URLs (R-076)"
}
```

`state: "MERGED"` and the merge commit is byte-identical to `origin/main` HEAD at the time this task ran. **This is independent confirmation, not merely accepted operator claim** — this task ran `gh pr view` itself.

```
$ git merge-base --is-ancestor b370b0181fa2f84e24f0f80560425da81f60dcb2 40bfcb899c54e545f992003b2203ad729114a5fe
$ echo $?
0
$ git rev-list --count b370b0181fa2f84e24f0f80560425da81f60dcb2..40bfcb899c54e545f992003b2203ad729114a5fe
13
```

The prior production release is a true ancestor (fast-forward, as the operator stated). The 13-commit gap is **not** F3-SEC-004 alone:

```
40bfcb8 Merge pull request #434 from .../fix/f3-sec-004-clinic-legal-profile-url-xss   ← F3-SEC-004 (R-076)
d6334c6 docs(f3): correct the R-076 scan fidelity claim (F3-SEC-004-R1)
5bfbc97 fix(security): restrict clinic legal-profile website URLs (R-076)
0c02b87 Merge pull request #433 from .../feature/f4-fcr-003-r030-db-recovery-readiness ← unrelated, already tracked
8996bb2 docs(f4): record the CI-observed shell counts and the Layer 3 flake rerun
4308579 feat(f4): decide the repo2 topology, and unblock CHECKPOINT 7 on 2.50
6d0d9da docs(f4): record the CI-observed shell-suite counts for F4-FCR-003-R1
02ef208 fix(f4): repair the CI guard, prove pgBackRest 2.50 parity, add WAL backlog monitoring
826aec1 test(f4): assert the recovery deep gate instead of relying on it
5194b23 feat(f4): prepare R-030-DB off-host recovery activation, and run Gate 0
c0567ef Merge pull request #432 from .../docs/f4-3-r079-production-closure              ← unrelated, already tracked
e1a380c docs(program): separate implementation and closure-record lifecycles (R1)
1d7364a docs(program): close R-079 with production legal-hold evidence
```

Two of the thirteen commits are **unrelated merges already tracked elsewhere in this program** (F4-3/R-079 production-closure evidence, PR #432; F4-FCR-003/R-030-DB recovery readiness, PR #433). This deploy therefore also brought those changes into production for the first time, alongside F3-SEC-004. **Neither is assessed, re-verified, or altered by this task** — this task's scope is R-076/F3-SEC-004 only. This is recorded here purely so the deployed-SHA delta is accurately described, consistent with this program's practice of not conflating what a deploy carries with what a given task verifies (cf. F3-PROD-001's correction regarding F3-IMPL-007/F3-CI-OPT-001 riding along in an earlier deploy).

## 5. Accepted production evidence (as supplied, not independently re-verified)

Everything in this section is operator-supplied; this task performed no production access.

### 5.1 Deployment

- `bash scripts/noramedi-deploy.sh --skip-pull --skip-build --skip-migrate` — matches the script's documented flags (`--skip-pull`: source already fast-forwarded; `--skip-build`: no dependency change in F3-SEC-004; `--skip-migrate`: no schema/migration in F3-SEC-004). `prisma generate` ran (not skipped) — Prisma Client v7.9.1 generated.
- `noramedi-api` / `noramedi-worker`: both `status=online`, `release=40bfcb899c54e545f992003b2203ad729114a5fe`.
- `/api/health` reached `200` on attempt 3 (two startup-window `000` results first) — a bounded retry pattern this program has observed and accepted before (cf. F3-PROD-002 §7).
- Frontend: built to `dist.next` via `npx tsc -b && npx vite build --outDir dist.next` (2714 modules, 93 assets, `dist.next/index.html` present, only pre-existing chunk-size warnings); then put into place by a **two-step same-filesystem rename swap** — `mv dist "$ROLLBACK_DIR"` followed by `mv dist.next dist` — with the prior `dist` preserved as the rollback backup `dist.rollback-f3-sec-004-20260817T093856`.

**Atomicity, stated precisely (corrected by F3-PROD-003-R1):** this is a **near-atomic two-rename replacement, not a single atomic exchange**. Two `mv` calls means a very short interval exists between them in which `/var/www/noramedi/dist` does not exist at all. The operational properties that make this materially safer than copying files into a live `dist` tree still hold — each rename is a same-filesystem metadata operation rather than a multi-file copy, Vite's content-hashed asset filenames mean no old and new asset can collide under one name, and the prior build is retained in full for restore — but this document does **not** claim filesystem-level atomicity for the swap.

### 5.2 Frontend build/swap/rollback is not a repository-scripted procedure

```
$ grep -n "rollback\|dist\.next\|dist\b" scripts/noramedi-deploy.sh
(no matches)
```

`scripts/noramedi-deploy.sh`'s own header documents its full sequence: `git pull` → `npm ci` → `prisma migrate deploy` → `prisma generate` → PM2 `startOrReload` (API, worker) → API healthcheck → worker verification. **There is no frontend build, swap, or rollback step anywhere in this script**, and no other repository script performs one. The `dist.next` build, the two-rename swap into `dist`, and the `dist.rollback-*` backup convention used for this deploy are therefore an **operator-performed manual procedure**, not a repository-defined contract.

This is not a new finding: **`R-038`** (`docs/program/RISK_REGISTER.md`) already reads, verbatim, *"Frontend build-artifact'in kaynak kod ile eşleştiği doğrulanmadı — hiçbir depo scripti frontend build'i deploy etmiyor"* and has been `OPEN` since F0-006. This task's observation directly corroborates that row and changes nothing about its status.

## 6. Security smoke — performed with the repository's own auth/CSRF helpers

Per the operator's report, all identity/session/CSRF material was constructed using this repository's own test helpers (`createSessionId()`, `generateToken(...)`, `createCsrfToken('clinic', sessionId)`) rather than any ad hoc mechanism, and delivered via the production-real transport (`hcrm_session` cookie, `csrf_token` cookie, `X-CSRF-Token` header) — i.e. the real production auth/CSRF middleware evaluated a genuine request, not a bypass.

### 6.1 Authorization/tenant control

```
TARGET_CLINIC_FOUND=YES
AUTHORIZED_USER_FOUND=YES
CANONICAL_ROLE=OWNER
TARGET_IN_ALLOWED_CLINICS=YES
GET_STATUS=200
```

### 6.2 CSRF control

An unsafe mutation attempted **without** a valid CSRF token:

```
PUT_STATUS=403
PUT_ERROR=Forbidden: Invalid CSRF token
```

Confirms CSRF is live and cannot be defeated merely by holding a valid session.

### 6.3 R-076 negative smoke — the load-bearing result

Using the already-published test clinic (write path per repository contract for a published profile: `POST /api/clinics/:clinicId/legal-profile/publish`), payload `{"website": "javascript:alert(1)"}`:

```
CSRF_CONTRACT_USED=YES
HTTP_STATUS=400
VALIDATION_ERROR=YES
WEBSITE_FIELD_ERROR=YES
```

The full chain — authenticated session → authorized OWNER → valid tenant scope → valid session-bound CSRF → the published-profile mutation route → `websiteSchema` refinement — rejected the exact payload R-076 describes, in production, **before persistence**. **No production legal-profile mutation occurred.**

### 6.4 Public API and deployed artifact

```
GET https://api.noramedi.com/api/public/clinics/gebzedisdunyasi/kvkk
HTTP/1.1 200 OK
LEGAL_PROFILE_PRESENT=YES
WEBSITE_FIELD_PRESENT=YES
WEBSITE_IS_NULL_OR_EMPTY=YES
```

The deployed JS graph includes `assets/ClinicKvkkPublicPage-D_fDfo8-.js`, confirming the render-guard component (Layer 3, `WebsiteCell`/`getSafeHttpUrl`) is present in the live frontend artifact.

**No raw legal-profile content, session token, CSRF token, clinic ID, user ID, secret, or credential is reproduced anywhere in this document.**

## 7. Positive-path production gap — stated exactly, not narrowed

F3-SEC-004's own evidence document, §17 ("Exact next operator/reviewer action"), item 3, reads verbatim:

> *"Production-verify: a published clinic's KVKK page still links a legitimate `https` website; a `javascript:` write is rejected with 400."*

This is a **conjunctive** step written by the remediating task itself, not invented here. §6.3 above satisfies the second half. The first half was attempted:

```
SAFE_PUBLISHED_WEBSITE_COUNT = 0
```

A read-only scan of all active published `ClinicLegalProfile` rows found **no** row with a non-empty `website` value. There is currently no naturally occurring production data against which to click/render a legitimate `http`/`https` link on the public page.

**This gap is not treated as evidence that valid `http`/`https` values fail.** That behavior is covered by F3-SEC-004's pre-merge regression suites — backend `test:clinic-legal-profile` 40/40 (including accepted `https`/`http` cases), frontend `ClinicKvkkPublicPage.website.vitest.test.tsx` 16/16 (including `https`/`http` → clickable-anchor cases) — both mutation-verified (weakening the allowlist to unconditional acceptance turned both suites red; restoring returned them green). Nor is it narrowed away: per this document's own instructions, **production data was not created or modified to manufacture this test case.**

## 8. R-076 disposition

**`R-076` → `MITIGATED`. Explicitly not `CLOSED`.**

The row's own stated closure criterion (`docs/program/RISK_REGISTER.md`) is: `MERGED` + `DEPLOYED` + `PRODUCTION_VERIFIED`, with self-closure by F3-SEC-004 barred per the R-019/R-071/R-072/R-073/R-075 precedent.

| Element | Status | Basis |
|---|---|---|
| `MERGED` | **Satisfied** | Independently confirmed, §4 |
| `DEPLOYED` | **Satisfied** | Operator-supplied PM2/health evidence, §5.1 |
| `PRODUCTION_VERIFIED` | **Partial** | Blocking/negative path (§6.3) production-verified; positive-path step named by F3-SEC-004 §17 item 3 could not be executed (§7) |

Closing R-076 on the negative-path evidence alone would mean quietly treating a two-part, already-written criterion as satisfied by only its first part — exactly the kind of silent relaxation this task was instructed not to perform. **`MITIGATED`** is used rather than `CLOSED` to reflect that the remediation is deployed and its core security property (the exploit is blocked) is directly production-verified, while the named acceptance step remains open. **Exact remaining criterion:** production-verify that a published clinic's KVKK page renders a legitimate `http`/`https` `website` value as a live, clickable link. This becomes executable the first time any clinic publishes a legal profile with a non-empty `http`/`https` website — no action is required to force it, and none should be taken to force it early.

**Not self-closed.** The remediating task was F3-SEC-004; this closure-lifecycle task is F3-PROD-003; the executor of the production steps was the operator — the same three-way separation this program has used for R-033/R-034/R-040 (F3-IMPL-002 / F3-IMPL-002-PROD-RECON / F3-PROD-002, operator-executed) and for R-075 (F3-SEC-003 / external PR reviewer).

## 9. F3 exit gate — unchanged

R-076 is named by none of F3's three exit-gate criteria (observability, security checklist, incident-response drill). Its `MITIGATED` status does not advance the gate. **`F3_EXIT_GATE = NOT SATISFIED`. `F3_COMPLETE = NO`. `F4_TRANSITION_AUTHORIZED = NO`.** Nothing in R-030/R-030-DB/R-030-FILES/`FIRST_CUSTOMER_RECOVERY_GATE`/F4 completion/F5 authorization is touched by this task.

## 10. Migration status

**NOT RUN, intentionally** — `--skip-migrate` was passed because F3-SEC-004 introduced no Prisma schema change, no migration, and no backfill. This task performed no migration of its own.

## 11. Rollback

*(Rewritten by F3-PROD-003-R1 — the prior wording said "revert `origin/main` to `b370b018…` and re-run `scripts/noramedi-deploy.sh --skip-migrate`". That was both inaccurate and unsafe: it implied rewriting the remote `main` branch in order to perform a **production runtime** rollback, and it omitted `--skip-pull`, without which the script's step 1 `git pull` would fast-forward the production checkout straight back to current `main` and silently defeat the rollback. The corrected text below is used instead; the superseded sentence is preserved here as history, not deleted.)*

**Backend rollback baseline:** `b370b0181fa2f84e24f0f80560425da81f60dcb2` — the prior known-good production release. **No DB rollback is required or possible to need:** F3-SEC-004 wrote no migration, so no schema change has to be reversed; `RISK_REGISTER.md` `R-046`'s standing rule (retain additive schema, redeploy application code only, forward-fix afterward) applies unchanged.

**No remote-branch operation is implied.** Rolling production back does **not** mean reverting, resetting, or force-pushing `origin/main`. It is a change to what revision the production checkout has checked out. A repository-side revert PR is a separate decision with its own review, and this task neither requires nor recommends one.

**The repository provides no dedicated rollback script that selects a previous git revision.** `scripts/noramedi-deploy.sh` deploys whatever revision the production checkout is on (and, unless `--skip-pull` is given, first `git pull`s it forward); it has no "deploy revision X" or "roll back" mode. The revision selection is therefore a separate, operator-performed step.

**Approved procedure — cited, not invented.** [`docs/program/runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md` §4.1 "Rollback"](../runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md) is this program's authoritative runbook for exactly this operation, and it already specifies the sequence (its own `[MUTATING]` markers retained):

```
git -C /var/www/noramedi log --oneline -5                    # identify the prior commit
git -C /var/www/noramedi checkout <prior-sha>                # [MUTATING] here: b370b0181fa2f84e24f0f80560425da81f60dcb2
/usr/local/sbin/noramedi-deploy.sh --skip-pull --skip-build --skip-migrate --skip-generate   # [MUTATING]
```

`--skip-pull` is **mandatory** in this form and is not merely an optimization: the deploy script's step 1 is `git pull` (skipped only by `--skip-pull`, per the script's own header, lines 7 and 28), so omitting it against an intentionally checked-out prior release would pull the production checkout back to current `main` and undo the rollback before PM2 ever reloads. `--skip-migrate` is appropriate because this rollback crosses no F3-SEC-004 migration. `--skip-build`/`--skip-generate` follow the runbook's reload-only form and are correct here because F3-SEC-004 changed no dependency and no Prisma schema. The runbook also notes the deploy script is installed at `/usr/local/sbin/noramedi-deploy.sh` on the VPS; `LAUNCH_GATES.md` §2.D's "None exists today" — no automated rollback — remains accurate.

**Frontend — not repository-scripted (see §5.2):** the operator preserved the prior build at `dist.rollback-f3-sec-004-20260817T093856`; restoring it in place of `dist` is a manual filesystem operation performed by the operator. **This repository defines no script that performs the frontend restore**, and none is invented here.

No database rollback is required or was performed: F3-SEC-004 wrote no migration, and the §6.3 negative smoke was rejected with 400 before any write reached the database.

## 12. Security / tenant / KVKK impact

- Tenant authorization is unchanged; `LEGAL_PROFILE_ROLES` / `authorize` / `resolveEffectiveClinicId` were not touched by F3-SEC-004 and are not touched by this task.
- OWNER authorization and requested-clinic scope were independently production-verified in §6.1 — no cross-tenant access was exercised or introduced.
- CSRF protection was independently production-verified active in §6.2.
- No patient/PHI data was used or accessed by this verification; the only mutation attempt made was rejected before persistence.
- No raw legal-profile data, session token, CSRF token, clinic ID, user ID, secret, or credential is present anywhere in this document or in the tracker/risk-register entries this task wrote.
- Public stored-XSS exposure from unsafe `website` schemes remains blocked by the three layers F3-SEC-004 shipped: (1) write-time `http`/`https` allowlist — production-verified in §6.3; (2) public-API suppression of unsafe legacy values — present in the deployed code (§9 of the F3-SEC-004 evidence document), not exercised against an actual unsafe stored row in production because none currently exists; (3) frontend render-time guard — its artifact is confirmed present in the deployed JS graph (§6.4), not itself browser-exercised in production.
- No production legal-profile data was mutated by this task at any point.

## 13. Validation performed by this task

| Check | Result |
|---|---|
| `git diff --check` | exit `0` |
| Files changed | `docs/program/**` only (`RISK_REGISTER.md`, `NORAMEDI_MASTER_TRACKER.md`, `phases/F3_PRODUCTION_HARDENING.md`, `evidence/F3-SEC-004_...md` pointer, this document, `CHANGELOG.md`) |
| Runtime/schema/CI/deployment-script files changed | **None** |
| `gh pr view 434` | Confirmed `state: MERGED`, merge commit matches `origin/main` HEAD |
| `git merge-base --is-ancestor` | Confirmed prior release is an ancestor of the deployed release |

No runtime test suite was re-run by this task (docs-only change, no defect found in the evidence that would require it).

## 14. State distinctions preserved

| Stage | State |
|---|---|
| Agent completed (F3-SEC-004) | Yes (2026-08-16) |
| Tests passed (F3-SEC-004) | Yes — 40/40 backend, 16/16 frontend, 200/200 full suite, both typechecks, `git diff --check` |
| PR opened | Yes — #434 |
| Merged | Yes — independently confirmed (§4) |
| Deployed | Yes — operator-supplied (§5.1) |
| Production verified | **Partial** — negative path yes (§6.3), positive path outstanding (§7) |
| R-076 | `MITIGATED`, not `CLOSED` |

## 15. Exact next task

Run the F3-SEC-004 §8 read-only counting scan on production (still not executed by any task) and record the three integers. Independently, monitor for the first clinic to publish a legal profile with a non-empty `http`/`https` website in production, and at that point execute the one remaining step named by F3-SEC-004 §17 item 3 (confirm the public KVKK page renders it as a live link) to move R-076 from `MITIGATED` to a position where architecture review can consider `CLOSED`.
