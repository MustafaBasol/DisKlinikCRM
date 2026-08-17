# F3-PROD-005 — R-038 Production Verification and Closure (Frontend Deploy/Rollback Reproducibility)

**Task:** F3-PROD-005 — R-038 Production Verification Closure · **Phase:** F3 Production Hardening · **ClickUp:** `869ejxa5a`
**Date:** 2026-08-17 · **Type:** documentation-only closure task; the production run itself was operator-executed and is recorded here as **operator-supplied evidence**, not repository-task action
**Branch:** `docs/f3-prod-005-r038-production-closure` · **Baseline:** `origin/main` @ `4cfe94f2f871994a9b33e9281bb2ff43552c62d6` (PR #439 merge — F3-PROD-004-R3), clean worktree

---

## 1. Task-ID collision and authority check

`F3-PROD-005` did not previously exist anywhere in `docs/program/`, `.github/` or `scripts/` prior to this task — confirmed by exact-string search. It is the next sequential ID in the `F3-PROD-*` production-deployment/exit-gate-reconciliation category (`F3-PROD-001/002/003/004(+R1/R2/R2-R1/R3)` exist). The F3-PROD-004 evidence document itself names this task and its precondition explicitly: *"F3-PROD-005 remains BLOCKED until this merges"* (§22.7, referring to PR #438/#439). `origin/main` @ `4cfe94f2f871994a9b33e9281bb2ff43552c62d6` is PR #439's merge commit, so that precondition is satisfied.

This task performs **no runtime code change, no deploy-script change, no application/server/frontend change, no migration, and no production access of its own**. It records, reconciles and closes the program's own state (`RISK_REGISTER.md`, `NORAMEDI_MASTER_TRACKER.md`, `phases/F3_PRODUCTION_HARDENING.md`, `CHANGELOG.md`, `evidence/README.md`) against **operator-executed, operator-supplied production evidence** received 2026-08-17, exactly as F3-PROD-002/F3-PROD-003 did for their own risk rows. No tenant/schema/data mutation is claimed or performed by this task itself.

---

## 2. What R-038 required before closure — the exact checklist this evidence answers

F3-PROD-004's own evidence document (§16) named four items as **"production verification required before R-038 may be considered for closure (independent, operator-executed, not self-asserted)"**:

| # | Required step | Answered by |
|---|---|---|
| 1 | `verify` on production `dist` pre-deploy, expected to warn no `release.json` exists — that warning *is* the R-038 condition, observed | §4 (PRE-DEPLOY) |
| 2 | One `deploy --dry-run` on the production host, confirming zero mutations and the intended paths | §5 (DRY RUN) |
| 3 | One real `deploy`, then `verify --url … --check-backend`, confirming `release.json` is reachable over HTTP — establishing nginx serves the promoted directory | §6 (REAL DEPLOY), §7 (INITIAL PUBLIC VERIFY) |
| 4 | One `rollback --dry-run`, and — in a maintenance window — one real `rollback` followed by a `deploy` forward, so the rollback path is rehearsed before it is needed | §8 (MANDATORY REAL ROLLBACK), §9 (FORWARD REDEPLOY) |

The task brief's own lifecycle criteria for closure are: **implementation merged; automation CI green; production deployed; public serving verified; rollback rehearsed; forward redeploy verified** — see §12 (lifecycle table). All six are evidenced below from the operator-supplied production run and cross-checked against the six-commit chain that produced `4cfe94f`.

---

## 3. Repository / production identity

| Field | Value |
|---|---|
| Production app directory | `/var/www/noramedi` |
| Production checkout HEAD / `origin/main` (final) | `4cfe94f2f871994a9b33e9281bb2ff43552c62d6` |
| Frontend deploy script, installed path | `/usr/local/sbin/noramedi-frontend-deploy.sh` |
| Installed script SHA256 | `c1caf8227bb4b94d7cfb7424fb778844ef06230cd014bd3c5bc30fe05e466f09` |
| Installed mode / ownership | `0755` `root:root` |

`4cfe94f2f871994a9b33e9281bb2ff43552c62d6` is the merge commit for PR #439 (F3-PROD-004-R3), confirmed independently by this task's own `git fetch origin main` / `git rev-parse origin/main` at repository-task start (§1) — the production checkout and the repository's own `origin/main` are the same commit, not merely reported as matching.

---

## 4. PRE-DEPLOY state (production, before this run)

| Field | Value |
|---|---|
| Checkout | clean |
| Root `node_modules` | present |
| `vite` | present |
| Filesystem device (app/dist/parent) | same, `64512` — the F3-PROD-004-R1 same-filesystem precondition holds on this host |
| Disk | healthy |
| Pre-existing frontend `index` SHA256 | `fa66c510b9d130ec3f192f54bacbcef21d73fb2a129804e1b51f0ecc334437c2` |
| `release.json` | absent |
| Pre-deploy `verify` | `exit 1`, **solely** because no release marker exists — the exact R-038 condition F3-PROD-004 §16 item 1 named, now directly observed rather than inferred |
| API / PM2 | healthy |
| Backend `RELEASE_SHA` (from `pm2 jlist` → `pm2_env.RELEASE_SHA`, not local git) | `40bfcb899c54e545f992003b2203ad729114a5fe` |

This closes checklist item 1 in §2: the pre-deploy `verify` failure is the documented, intended R-038 signal (a bundle predating this task's marker), not an unexpected fault.

---

## 5. DRY RUN

| Field | Value |
|---|---|
| `TARGET_SHA` | `4cfe94f2f871994a9b33e9281bb2ff43552c62d6` |
| `DRY_RUN_EXIT` | `0` |
| Index unchanged | YES |
| Deploy-state pointer unchanged | YES |
| `dist.next` created | NO |
| Rollback directory created | NO |
| Checkout | stayed clean |

Closes checklist item 2 in §2: zero mutation, intended paths only.

---

## 6. REAL DEPLOY

| Field | Value |
|---|---|
| `DEPLOY_EXIT` | `0` |
| Build | Vite 5.4.21, 2714 modules transformed |
| Release marker | written |
| Initial rollback point (preserved bundle) | `/var/www/noramedi/dist.rollback-f3-prod-005-20260817T164211Z` |
| Release marker SHA | `4cfe94f2f871994a9b33e9281bb2ff43552c62d6` |
| Checkout | clean |
| API health | OK |

---

## 7. INITIAL PUBLIC VERIFY

| Field | Value |
|---|---|
| `VERIFY_EXIT` | `0` |
| Root → final | HTTP 200 → `https://app.noramedi.com/login` |
| Marker | HTTP 200, `Content-Type: application/json`, `https://app.noramedi.com/release.json` |
| `PUBLIC_RELEASE_SHA` | `4cfe94f2f871994a9b33e9281bb2ff43552c62d6` |
| `PUBLIC_SHA_MATCHES_LOCAL` | YES |
| `NGINX_SERVES_PROMOTED_DIST` | **VERIFIED** |
| Backend health | OK |

Closes checklist item 3 in §2 in full: `NGINX_SERVES_PROMOTED_DIST = VERIFIED` is the production, over-HTTP confirmation that F0-006 left as `UNVERIFIED_PRODUCTION` and that F3-PROD-003/F3-PROD-004 both explicitly declined to claim from repository evidence alone. This is the first point in this program's history this fact is established over the public network rather than assumed from the filesystem procedure.

---

## 8. MANDATORY REAL ROLLBACK

| Field | Value |
|---|---|
| `--from` (explicit) | `/var/www/noramedi/dist.rollback-f3-prod-005-20260817T164211Z` |
| `ROLLBACK_EXIT` | `0` |
| Rollback preserved the just-promoted bundle at | `/var/www/noramedi/dist.rollback-preroll-20260817T164525Z` |
| Restored frontend release | **UNKNOWN** — the pre-R-038 bundle being restored to predates the release-marker contract and carries no marker of its own; this is expected, not a defect |
| `POST_INDEX_SHA` | `fa66c510b9d130ec3f192f54bacbcef21d73fb2a129804e1b51f0ecc334437c2` |
| `OLD_INDEX_RESTORED` | YES — matches the PRE-DEPLOY index SHA in §4 exactly |
| `OLD_RELEASE_MARKER_PRESENT` | NO — consistent with §4 (`release.json` absent pre-deploy) |
| Public root | remained HTTP 200 |
| Public `/release.json` | became `text/html` SPA fallback (no marker to serve — the restored bundle predates the marker contract) |
| Public fallback body SHA256 | exactly equal to the restored index SHA `fa66c510…` |
| API health | OK |
| Checkout | clean |

Closes checklist item 4 (rollback half) in §2. The rollback both (a) used the deterministic `--from` path rather than any directory-order inference, per the F3-PROD-004 §5 rollback contract, and (b) is independently verified byte-for-byte: the restored `index` SHA and the publicly served fallback body SHA both equal the PRE-DEPLOY index SHA recorded in §4, so the rollback did not merely exit `0` — it demonstrably returned production to its exact pre-task frontend state.

---

## 9. FORWARD REDEPLOY

| Field | Value |
|---|---|
| Retained deployment artifacts present before redeploy | `dist.rollback-f3-sec-004-20260817T093856`, `dist.rollback-preroll-20260817T164525Z` |
| Cleanliness gate | **did NOT block deployment** — this is the production verification of **F3-PROD-004-R3** |
| `DEPLOY_EXIT` | `0` |
| New rollback point | `/var/www/noramedi/dist.rollback-f3-prod-005-forward-20260817T164630Z` |
| Final local marker SHA | `4cfe94f2f871994a9b33e9281bb2ff43552c62d6` |
| Checkout | clean |

This is the second half of checklist item 4 in §2 — the rollback path was rehearsed and then a forward redeploy proceeded cleanly with two retained rollback bundles present in the deployment root. F3-PROD-004-R3's own evidence (§22.5) predicted exactly this: a successful deploy must not dirty the checkout with its own artifacts, and the `.gitignore` rules it added (`dist.next/`, `dist.next.stale-*/`, `dist.rollback-*/`, `.noramedi-frontend-release-state`) are what let this redeploy proceed with retained rollback directories on disk without the cleanliness gate refusing it. **This is production, first-run confirmation that the R3 fix works as designed** — R3 itself was repository-only and could not observe this.

---

## 10. FINAL PUBLIC VERIFY

| Field | Value |
|---|---|
| `VERIFY_EXIT` | `0` |
| Public root | HTTP 200 → `/login` |
| Public marker | HTTP 200 |
| `PUBLIC_RELEASE_SHA` | `4cfe94f2f871994a9b33e9281bb2ff43552c62d6` |
| `PUBLIC_SHA_MATCHES_LOCAL` | YES |
| `NGINX_SERVES_PROMOTED_DIST` | **VERIFIED** |
| Backend health | OK |
| Final API health | `{"status":"ok"}` |

Production ends this run on the intended target SHA, publicly serving the promoted bundle, with backend health confirmed — the forward redeploy is not merely `exit 0`, it is independently confirmed live over HTTP a second time.

---

## 11. Deliberate release skew (frontend/backend), stated exactly

| Field | Value |
|---|---|
| Frontend release (this task) | `4cfe94f2f871994a9b33e9281bb2ff43552c62d6` |
| Backend `RELEASE_SHA` (running PM2 process) | `40bfcb899c54e545f992003b2203ad729114a5fe` |
| `RELEASE_SHA_MATCH` | **NO** |

**This is expected and does not invalidate R-038 closure.** The accepted deployment model in this program permits independent frontend and backend releases — the backend was last deployed at F3-PROD-003 (PR #434, `40bfcb89…`) and has had no subsequent code change requiring redeployment; this task deploys only the frontend, at a later `origin/main` commit that is purely `docs/program/**` + the F3-PROD-004-R2/R2-R1/R3 fix commits, none of which touch backend runtime source. `RELEASE_SHA_MATCH = NO` is `verify`'s own reporting of this fact (F3-PROD-004 §7 — "Backend/frontend skew is reported, not forced"), and R-038's own scope is the **frontend** deployment/rollback reproducibility risk — it does not name backend/frontend release-SHA alignment as a criterion. **No claim of full-stack release SHA alignment is made anywhere in this document.**

---

## 12. R-038 lifecycle — before / after

| Lifecycle stage | Status |
|---|---|
| Automation implementation | `MERGED` (F3-PROD-004 / PR #437; F3-PROD-004-R1 same PR; F3-PROD-004-R2 / PR #438; F3-PROD-004-R2-R1 same PR; F3-PROD-004-R3 / PR #439) |
| Automation CI | GREEN (`npm run test:shell` chain, `test:ci-classify`, both typechecks, `bash -n` gate — all reconfirmed at each R-revision, see F3-PROD-004 evidence §§11,19–22) |
| Production deployment | PASSED (§6) |
| Production public serving verification | PASSED (§7, §10) |
| Rollback rehearsal | PASSED (§8) |
| Forward redeploy | PASSED (§9) |
| Closure documentation | **PASSED — this PR**, not complete until merged |

| R-038 field | Before this task | After this task |
|---|---|---|
| Status | `CLOSURE_PROPOSED_AWAITING_MERGE_AND_DEPLOYMENT` | **`CLOSED`** |
| Closure date | — | **2026-08-17** |
| Closure basis | — | F3-PROD-004(+R1/R2/R2-R1/R3) repository implementation, merged via PR #437/#438/#439; this task's operator-executed, operator-supplied production run: pre-deploy verify (§4), dry run (§5), real deploy (§6), initial public verify (§7), mandatory real rollback with byte-identical restoration proof (§8), forward redeploy proving F3-PROD-004-R3's cleanliness-gate fix in production (§9), final public verify (§10) |
| Self-closed? | — | **No** — remediating task F3-PROD-004(+R1/R2/R2-R1/R3), closure task F3-PROD-005, per the R-019/R-071/R-072/R-073/R-075/R-033/R-040/R-076 no-self-closure precedent this program already uses |

**What this closure does not claim or change:** `R-030`/`R-030-DB`/`R-030-FILES` remain `OPEN`; `FIRST_CUSTOMER_RECOVERY_GATE` remains `NOT_SATISFIED`; the F3 exit gate remains `NOT_SATISFIED` — R-038 is named by none of its own three criteria (F0-006/F3-PROD-004 precedent, unchanged); F4 is not complete; F5 is not authorized; repo2 is not activated. Backend/frontend release-SHA alignment is explicitly **not** claimed (§11).

---

## 13. Migration, security, tenant isolation, KVKK

- `MIGRATION_REQUIRED` / `MIGRATION_CREATED` / `PRODUCTION_MIGRATION`: all **NO**. No schema file, no Prisma migration, touched by this task or by the production run it records.
- No application, server, or frontend source file is changed by this task — this PR is `docs/program/**` only.
- No tenant, clinic, or patient data was read, written, or mutated by the production run: it deploys and rolls back a static frontend bundle and a JSON release marker containing only `releaseSha`/`builtAt`/`builtBy`/`task` (F3-PROD-004 §6) — no PHI/PII field.
- No secret, environment variable, DSN, or credential value appears anywhere in this evidence document or in the production evidence supplied to produce it.
- **KVKK:** none applicable — a frontend deploy/rollback/marker cycle processes no personal or health data.

---

## 14. Files changed by this task

| File | Change |
|---|---|
| `docs/program/evidence/F3-PROD-005_R038_PRODUCTION_VERIFICATION.md` | **new** — this file |
| `docs/program/RISK_REGISTER.md` | `R-038` row: status → `CLOSED`, closure basis recorded; header narrative entry added |
| `docs/program/NORAMEDI_MASTER_TRACKER.md` | new top narrative entry for F3-PROD-005 |
| `docs/program/phases/F3_PRODUCTION_HARDENING.md` | new top narrative entry, phase header, risk section, and change-history table row for F3-PROD-005 |
| `docs/program/CHANGELOG.md` | new top entry for F3-PROD-005 |
| `docs/program/evidence/README.md` | new index row for this file (additive) |

No application, server, frontend, schema, migration, lockfile, deploy-script, or CI-workflow file is touched. `scripts/noramedi-frontend-deploy.sh` and `scripts/noramedi-deploy.sh` are both untouched by this task, and are byte-identical to their state at `4cfe94f` (this task's own baseline).

---

## 15. Rollback of this closure PR

**Revert the docs merge only.** This PR changes no runtime behavior, so reverting it only reverts documentation/risk-register state — it does not touch, and cannot roll back, anything in production. If a future finding requires re-opening `R-038`, that is a program decision recorded by editing `RISK_REGISTER.md` again (status back to `OPEN` or a new row), not a `git revert` of this PR.

The tested, repository-defined **runtime** rollback for the frontend remains `noramedi-frontend-deploy.sh rollback` (deterministic target, `--from` or the recorded state pointer — runbook §4.12), exactly as rehearsed in §8 of this document. The backend rollback procedure is unchanged (runbook §4.1). Neither is altered, exercised again, or invalidated by merging this PR.
