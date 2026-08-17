# F3-PROD-004 — Reproducible Frontend Deployment & Rollback Automation (R-038)

**Phase:** F3 — Production Hardening / parallel first-customer readiness lane
**Date:** 2026-08-17
**Baseline:** `origin/main` @ `57909ce28d89cc14d67869c75b107c7595a17f23` (PR #436 merge, F4-1A2), clean worktree
**Branch:** `feature/f3-prod-004-frontend-deploy-rollback`
**ClickUp:** `869ejqzwx`

> **This is not an F4 task and does not authorize F5.** F4 recovery work remains externally blocked by secondary Türkiye VPS/provider/legal prerequisites. This is a parallel first-customer production-readiness remediation. It performs **no production access**, **no deployment**, and **no schema or data change**.

---

## 1. Task-ID collision and authority check

| Check | Result |
|---|---|
| `F3-PROD-004` already used? | **No.** An exact-string search of `docs/program/**`, `.github/**` and `scripts/**` returns zero matches. `F3-PROD-001`, `F3-PROD-002` and `F3-PROD-003` exist; `004` is the next sequential ID in the category this program already uses for production-deployment/exit-gate work. **ID issued by this task.** |
| `R-038` current wording | `RISK_REGISTER.md:148`, verbatim: *"Frontend build-artifact'in kaynak kod ile eşleştiği doğrulanmadı — hiçbir depo scripti frontend build'i deploy etmiyor"*. Olasılık `Low`, Etki `Medium`, Mevcut kontrol `UNVERIFIED`, **Eksik kontrol** *"Build/deploy dry-run karşılaştırması"*, **Azaltım** *"Gelecek görev: artifact-hash doğrulaması"*, Faz `F0-006`, Durum **`OPEN`**. |
| Newer ADR/runbook superseding the manual frontend-deploy evidence? | **No.** The most recent statement is F3-PROD-003 (2026-08-17), which *corroborates* the gap: [`F3-PROD-003_CLINIC_LEGAL_PROFILE_URL_SCHEME_PRODUCTION_VERIFICATION.md` §5.2](F3-PROD-003_CLINIC_LEGAL_PROFILE_URL_SCHEME_PRODUCTION_VERIFICATION.md) — *"There is no frontend build, swap, or rollback step anywhere in this script, and no other repository script performs one."* |
| Was `R-038` closed by newer evidence? | **No.** It is `OPEN` at the baseline SHA and was explicitly left `OPEN` by F3-PROD-003. |

**No collision. No stop condition triggered.** (Stop conditions are individually addressed in §14.)

---

## 2. Deploy contract inventory (produced before any edit)

Classification: `AUTOMATED` = performed by a repository script · `MANUAL` = operator-performed, documented · `MISSING` = performed by nobody · `UNVERIFIED` = claimed but not established by repository evidence.

### 2.1 Backend lifecycle — `scripts/noramedi-deploy.sh` (unchanged by this task)

| # | Step | Where | Before | After |
|---|---|---|---|---|
| 1 | `git pull --ff-only` | `noramedi-deploy.sh:70` | AUTOMATED | AUTOMATED (untouched) |
| 2 | `npm ci` (server only) | `:79` | AUTOMATED | AUTOMATED (untouched) |
| 3 | `prisma migrate deploy` | `:85` | AUTOMATED | AUTOMATED (untouched) |
| 4 | `prisma generate` | `:91` | AUTOMATED | AUTOMATED (untouched) |
| 4b | Resolve + export `RELEASE_SHA` | `:182-184` + `ecosystem.config.cjs:84-99,113,125` | AUTOMATED | AUTOMATED (untouched) |
| 5-6 | PM2 `startOrReload` API + worker | `:189`, `:195` | AUTOMATED | AUTOMATED (untouched) |
| 7 | API healthcheck (`/api/health`, 12×5 s) | `:202` → `noramedi-healthcheck.sh` | AUTOMATED | AUTOMATED (untouched) |
| 8 | Worker PM2-online verification | `:209-213` | AUTOMATED | AUTOMATED (untouched) |
| 8b | `RELEASE_SHA` propagation check (warns, never aborts) | `:221-241` | AUTOMATED | AUTOMATED (untouched) |
| — | Backend revision rollback | runbook §4.1 | MANUAL | MANUAL (unchanged; §9.1) |

**The backend script has no `--dry-run` and no frontend step of any kind.** Confirmed by reading all 243 lines: it only ever `pushd`es into `$APP_DIR/server`; there is no `npm run build`, no `vite`, no `dist`, no `nginx`, no `rsync`/`cp`.

### 2.2 Frontend lifecycle — the R-038 gap

| # | Step | Before | After |
|---|---|---|---|
| K | Frontend production build | **MISSING** (no repository script) | **AUTOMATED** |
| L | Stage into a non-live directory (`dist.next`) | MANUAL (operator, F3-PROD-003 §5.1) | **AUTOMATED** |
| M | Artifact validation of the staged build | **MISSING** | **AUTOMATED** |
| N | Promotion into the live path | MANUAL | **AUTOMATED** |
| O | Preserve the superseded bundle | MANUAL (ad-hoc `dist.rollback-<label>-<ts>`) | **AUTOMATED** (same naming convention) |
| P | Deterministic frontend rollback | **MISSING** — no repository command, and the runbook's rollback sections do not mention the frontend at all | **AUTOMATED** |
| Q | Frontend release marker (artifact ↔ source) | **MISSING** — no `release.json`, no `__RELEASE__`, no `define:` in `vite.config.ts`, no release-related `import.meta.env` | **AUTOMATED** (`dist/release.json`) |
| R | Post-promotion frontend verification | **MISSING** | **AUTOMATED** |
| S | Backend/frontend release-SHA consistency | **MISSING** | **AUTOMATED** (reported, §7) |
| T | Shell-level regression coverage for any of the above | **MISSING** | **AUTOMATED** (105 assertions, §8) |
| U | Which directory nginx actually serves | **UNVERIFIED** (F0-006 §3/§4; host nginx config is not repository-owned) | **STILL UNVERIFIED — see §10** |
| V | Database rollback for a frontend deploy | NOT REQUIRED | NOT REQUIRED |

### 2.3 Exact R-038 gap, and the unsafe ambiguity it carried

R-038 is two defects in one row, and both are addressed:

1. **No repository script deploys the frontend.** The build/promote/rollback sequence existed only as operator muscle memory. Its correctness depended on typing three `mv` commands in the right order with the right names, under time pressure, with no validation between them and no defined behaviour if one failed.
2. **The build artifact was not verifiable against its source revision.** Nothing in a served bundle recorded which commit produced it. Answering *"what is production's frontend running?"* required reverse-engineering content-hashed bundle filenames.

**The unsafe ambiguity:** the accepted procedure has a window between `mv dist <rollback>` and `mv dist.next dist` in which the live directory does not exist. Nothing defined what happens if the second rename fails. An operator in that state has an outage with no live bundle and no written instruction — and this had never been rehearsed, because there was nothing to rehearse it against.

---

## 3. What was built

One script, subcommand-shaped, so no second deployment abstraction is introduced:

```
scripts/noramedi-frontend-deploy.sh deploy   [OPTIONS]
scripts/noramedi-frontend-deploy.sh rollback [OPTIONS]
scripts/noramedi-frontend-deploy.sh verify   [OPTIONS]
scripts/noramedi-frontend-deploy.sh help
```

`scripts/noramedi-deploy.sh` **remains authoritative for the backend and is not modified by this task.** The two are additive and independent, exactly as the existing release process already allows backend and frontend to be deployed separately.

Conventions inherited from the sibling scripts: header-comment `usage()` via `grep '^#' "$0"`; `timestamp()` + `[HH:MM:SS]` log lines; `OK —` / `WARNING —` / `FATAL —` prefixes; `===` banners; `NORAMEDI_APP_DIR:-/var/www/noramedi`; the 12×5 healthcheck budget. Strictness is `set -Eeuo pipefail` — the house pragma is `set -euo pipefail`, and `-E` is added here only so that a future `ERR` trap would fire inside the promotion functions rather than being silently skipped there.

---

## 4. Promotion semantics — stated exactly

Promotion is a **TWO-STEP SAME-FILESYSTEM RENAME PROMOTION**:

```bash
mv <app-dir>/dist       <app-dir>/dist.rollback-<tag>-<UTC>    # rename 1
mv <app-dir>/dist.next  <app-dir>/dist                          # rename 2
```

It is **NEAR-ATOMIC**. It is **NOT A SINGLE ATOMIC EXCHANGE**. A very short interval exists between the two renames in which `dist` does not exist. This wording is carried verbatim in the script's own header, is asserted by the test suite (`help states the promotion semantics verbatim`, `help states that promotion is not a single atomic exchange`), and matches the correction F3-PROD-003-R1 applied to the tracker.

This task **does not** upgrade the procedure to an atomic exchange and claims no filesystem-level atomicity. What it adds:

- the window is bounded by code rather than by typing speed;
- every precondition is checked **before** rename 1, so the overwhelmingly common failure exits with the live bundle byte-identical;
- a failure of rename 2 triggers a **bounded best-effort restoration** (`mv <rollback> <dist>`), so production is not left without a live directory;
- both outcomes of that restoration produce a distinct, explicit operator message.

**Same-filesystem is enforced, not assumed.** `rename(2)` cannot cross devices; if it could, `mv` would silently degrade to copy-then-delete with a genuinely long window. The script compares `stat` device IDs and fails closed on a mismatch (`assert_same_filesystem`). If the device cannot be determined it says so and marks the precondition `UNVERIFIED` rather than claiming it.

---

## 5. Rollback contract — deterministic, never guessed

Rollback resolves its target from exactly two sources, **never** from directory ordering:

1. `--from <dir>` — an explicit bundle named by the operator; or
2. `<app-dir>/.noramedi-frontend-release-state`, the `ROLLBACK_DIR=` line **written by the deploy that created that bundle**, and written only *after* the promotion succeeded — so it can never point at a bundle that was not actually superseded.

With neither, rollback **aborts**. The suite proves it does not fall back to a plausible-looking directory even when one is sitting there (`rollback refuses when no target is given and none is recorded`; `the tempting-looking directory was not promoted`).

Every rollback target is bounded before use: it must be a direct child of the deployment root, be named `dist.rollback-*`, not be the live or staging path, not be a symlink, and **pass the same bundle validation a fresh build must pass**. The current live bundle is preserved before being replaced, so a rollback is itself reversible; the script prints the exact command to undo it.

**No `rm` anywhere.** The script contains no deletion primitive at all — a superseded bundle can only ever be *moved*. Even `--clean-staging` moves a stale `dist.next` to `dist.next.stale-<UTC>` rather than deleting it. This is asserted structurally by the suite, on the file's non-comment lines.

---

## 6. Release traceability

No frontend release marker existed anywhere in the repository (searched: `release.json`, `__RELEASE__`, `import.meta.env.VITE_*SHA*`, `define:` in `vite.config.ts` — all absent), so no rival contract is displaced. `dist/release.json` is created:

```json
{
  "releaseSha": "<git SHA of the deployed checkout>",
  "builtAt": "<UTC ISO-8601>",
  "builtBy": "noramedi-frontend-deploy.sh",
  "task": "F3-PROD-004"
}
```

The operator can now answer *"what git SHA is this frontend serving?"* with `cat /var/www/noramedi/dist/release.json` locally, or `curl https://<host>/release.json` remotely.

**Nothing else may be added to it.** It is served publicly by nginx like any other file in the bundle. It carries no hostname, no filesystem path, no environment value, no secret. The suite asserts this both by content-matching and by pinning the field count, so a future field cannot be added without a test turning red.

Deploying from a dirty worktree would produce a bundle no SHA describes — precisely the R-038 traceability failure — so the script **refuses a dirty checkout** unless `--allow-dirty` is passed, in which case it warns that the recorded SHA does not fully describe the bundle.

---

## 7. Backend/frontend release consistency

**Can the current deployment produce `backend SHA != frontend SHA`? Yes** — the two halves deploy independently, and this is a deliberate property of the existing process, not a defect. This task therefore **reports** the condition instead of forcing joint deployment. Every `deploy`, `rollback` and `verify` run prints:

```
FRONTEND_RELEASE_SHA = <from dist/release.json>
BACKEND_RELEASE_SHA  = <from pm2 jlist -> pm2_env.RELEASE_SHA>
RELEASE_SHA_MATCH    = YES | NO | NOT_APPLICABLE
```

`MATCH = NO` additionally emits a `WARNING` stating that skew is permitted but must be a deliberate choice rather than a surprise.

**The backend SHA is never fabricated from local git state.** It is read from the *running* process via `pm2 jlist` → `pm2_env.RELEASE_SHA` — the same evidence path `noramedi-deploy.sh:139-154` uses. `git rev-parse` would report what is *checked out*, not what is *running*, and would make genuine skew invisible. Where PM2 or node is unavailable the answer is `NOT_APPLICABLE`, never a guess. The suite asserts this explicitly: with no PM2 present, `verify` reports `NOT_APPLICABLE` for both the backend SHA and the match, rather than claiming agreement it cannot establish.

Only the `RELEASE_SHA` key is ever read out of `pm2_env`, so no other value in the process environment can reach the log through this path.

---

## 8. Verification, dry-run, and fail-closed conditions

**`verify` (read-only, zero mutations):** validates the live bundle, reports the three release lines above, optionally checks `--expect-sha`, optionally fetches `BASE/` and `BASE/release.json` with `--url`, and optionally runs the **existing** `noramedi-healthcheck.sh` with `--check-backend`. No new health endpoint is invented. Backend health is reported on its own line, after the frontend result is already decided — **a frontend failure can never be hidden behind a healthy backend.**

**`--dry-run`** validates preconditions, prints the intended paths and renames, and performs no build, no rename, no delete, no state write, no PM2 interaction. Proven by full recursive byte-level snapshot comparison, and by asserting the build command never executed.

**Fail-closed conditions, each with a test:** build failure · staging output missing · staging empty · `index.html` missing · `index.html` referencing an absent hashed asset · stale staging directory · rollback-destination collision · cross-filesystem staging/live · unsafe or empty deployment root · invalid rollback source · rollback source equal to the live or staging path · non-existent rollback source · symlinked live/staging/source path · unsafe `--tag` · unknown command or option · missing option value · rename-2 failure without restoration.

---

## 9. Path safety

The script renames production directories, so every path is bounded **before** any mutation:

- **Deployment root** must be absolute, must not be one of 24 denylisted system directories (`/`, `/var`, `/var/www`, `/usr`, `/usr/local`, `/etc`, `/home`, `/tmp`, `/root`, …), must not be `$HOME`, must be at least two path components deep, and must exist. **The denylist and depth floor are checked before the existence test** — ordering them after it would make the guard's behaviour depend on which system directories happen to exist on the host, which is exactly how the first revision of this suite failed to detect the guard's removal (§11).
- **Live bundle** must be exactly `<root>/dist` — correct basename, correct parent, not a symlink.
- **Staging bundle** must be exactly `<root>/dist.next`, not a symlink.
- **Every preserved/rollback bundle** must be a direct child of the root and named `dist.rollback-*`.
- **`--tag`** becomes a directory-name component and is restricted to `[A-Za-z0-9._-]+`, excluding `.` and `..`. Traversal, separators, spaces, globs, `$( )`, backticks and `;` are all refused, and the suite proves no tag ever reaches a shell as code.
- Paths are canonicalised with a portable `cd`+`pwd -P` helper (not `realpath`, which must not be a behaviour dependency between the Ubuntu host and every shell that runs this suite), so the parent directory's symlinks are resolved before the assertions run.
- **No cleanup trap exists, and no deletion primitive exists**, so there is no constrained-cleanup question to answer: there is nothing to constrain.

---

## 10. What this task explicitly does NOT establish

**Whether nginx actually serves `<app-dir>/dist` is still `UNVERIFIED_PRODUCTION`.**

The script promotes `<app-dir>/dist`, which is exactly the path the accepted manual procedure operates on (F3-PROD-003 §5.1, inside the production checkout). But the host nginx configuration is **not repository-owned**: `PRODUCTION_TOPOLOGY.md:80` records the actual host config content as unconfirmed, the repository's own `nginx.conf` is container-internal (`root /usr/share/nginx/html`), and the only `root .../dist` line in the repository (`docs/22-hostinger-vps-postgres-deploy-plan.md:115`) still carries pre-rename branding and is not authoritative.

This task **reproduces the accepted filesystem procedure and makes no claim about the web server.** The script's own header says so. `verify --url https://<host>` is the check that closes that loop, and it is a named production-verification step in §13 — not something asserted here.

This is a pre-existing, already-recorded gap (F0-006, R-039/R-040). It is neither created nor closed by this task.

---

## 11. Tests

All suites run against `mktemp` working directories with PATH-injected fakes. **Nothing in this suite names `/var/www/noramedi`, touches a database, a PM2 process, or the network.**

| # | Command | Result |
|---|---|---|
| 1 | `bash scripts/noramedi-frontend-deploy.test.sh` | **105 passed, 0 failed, 1 skipped** |
| 2 | `npm run test:shell` (the exact CI aggregate) | **exit 0** — opscheck 178/178, pgBackRest 239/239, PITR app smoke 50/50, frontend deploy 105/105 |
| 3 | `npm run test:ci-classify` | **28 passed, 0 failed** (was 24 before this task) |
| 4 | `npm run typecheck:ci-classify` | **exit 0** |
| 5 | `for f in scripts/*.sh scripts/test-runtime/*.sh; do bash -n "$f"; done` (the CI gate verbatim) | **exit 0, all pass** |
| 6 | `npx tsx scripts/ci-classify/cli.ts --files-from=<this task's changed files>` | `docsOnly: false`, all five deep-gate flags `true` (§12) |

**The one skip, reported rather than hidden:** the symlinked-live-path guard could not be exercised on the Windows/MSYS development host, which cannot create real symlinks without developer mode. The suite prints `SKIPPED`, counts it, and repeats it in the summary line. **On `ubuntu-latest` — the only runner that gates this repository — that branch does not execute and the guard is exercised.** It is not claimed as locally verified.

**Coverage against the required categories:** successful staged build/promotion ✓ · build failure → live unchanged ✓ · invalid staging output → live unchanged (three variants) ✓ · rollback target collision → abort ✓ · second rename failure → previous live bundle restored ✓ · explicit rollback → expected version becomes live ✓ · invalid rollback source → abort (five variants) ✓ · unsafe path → abort (thirteen variants) ✓ · dry-run → zero mutations ✓ · release marker correctness ✓ · no secret leakage ✓ · shell syntax ✓ · path quoting with spaces ✓.

### 11.1 Mutation / falsification

Two mutants, both applied to the real file, both reverted before commit. **`git grep "false && mv"` returns nothing and `git diff` shows no mutant text.**

**Mutant A — restoration branch disabled** (`if mv -- "$rollback_dir" "$LIVE_DIR"` → `if false && mv …`):

```
FAIL - CRITICAL: the live bundle does not exist after a failed activation rename
FAIL - the restored live bundle is '', expected v1
FAIL - the failure message does not state the restoration outcome
FAIL - a stray preserved bundle survived the restoration
Results: 101 passed, 4 failed, 1 skipped   (exit 1)
```

**Killed.** Restored → `105 passed, 0 failed`.

**Mutant B — deployment-root denylist, `$HOME` check and depth floor deleted entirely:**

```
Results: 103 passed, 0 failed, 1 skipped   (exit 0)
```

**SURVIVED — and this is the most useful result in this document.** The path-safety tests asserted only a non-zero exit. With the guard gone, `--app-dir /` still exited non-zero, because `/dist` does not happen to exist and the *initial-deploy* guard caught it instead. **The tests passed while the protection they existed to prove was completely absent.**

Two fixes followed, both from the mutant rather than from review:

1. **Tests strengthened** — each path-safety case now asserts the refusal came from the deployment-root guard *by its own wording* (`as a deployment root` / `too shallow` / `home directory`), not merely that something failed. `/var/www` and `/usr/local` were added because they are depth-2 and are caught **only** by the denylist.
2. **The script was reordered** — the denylist, `$HOME` check and depth floor now run **before** the existence test. Previously the guard's behaviour depended on which system directories existed on the host, so the same deletion produced different symptoms on different platforms and could not be reliably detected anywhere.

Re-run with mutant B still applied against the strengthened suite: **96 passed, 9 failed, exit 1 — killed.** Guard restored: **105 passed, 0 failed.**

---

## 12. CI classification — proof the changed test actually runs

The F4-1A2 failure mode was a changed test that no lane executed. That is proven not to recur here, hop by hop:

| Hop | Evidence |
|---|---|
| 1. Changed file → category | `scripts/noramedi-frontend-deploy.sh` and `…test.sh` → **`CI_TOOLING`** (`scripts/ci-classify/classify.ts:143-160`, new clause `underDir(p,'scripts') && p.endsWith('.sh')`) |
| 2. Category → flags | `CI_TOOLING` → `FULL_DEEP_GATE` (`classify.ts:103`); `docsOnly` **`false`** |
| 3. Classifier CLI output | Run on this task's real changed-file list: `"docsOnly": false`, all five flags `true` |
| 4. Flags → job | `.github/workflows/ci-layers.yml:319-325` — job `workflow-and-syntax-lint` runs when `needs.classify.outputs.docs_only != 'true'`. **The lane is keyed on `docs_only`, not on a per-category flag** — so `docsOnly === false` is the property that actually matters, and that is what the new regression test asserts. |
| 5. Job → command | `ci-layers.yml:365` — `npm run test:shell` |
| 6. Command → aggregate | `package.json:42` — `… && npm run test:shell:frontend-deploy` |
| 7. Aggregate → file | `package.json:42` (new script) — `bash scripts/noramedi-frontend-deploy.test.sh` |
| 8. Syntax gate | `ci-layers.yml:350` globs `scripts/*.sh`, so both new files are `bash -n` checked with zero wiring |

**Why the classifier clause was added even though it changes no job selection today.** Both files already reached the full deep gate via the `UNKNOWN` fall-through. That was correct *by accident*. The new clause makes it a stated rule with a test behind it, so the lane that runs `npm run test:shell` stays selected by the very files it tests. `CI_TOOLING` maps to the same `FULL_DEEP_GATE`, so **no job selection changes** — verified by the pre-existing `recovery/backup/PITR paths keep the full deep gate (R-030-DB protection)` test, which covers seven `scripts/*.sh` recovery paths and still passes.

**Three new regression assertions** (`scripts/ci-classify/__tests__/classify.test.ts`): a dedicated F3-PROD-004 test asserting `docsOnly === false` + full gate for the script, its suite, `noramedi-deploy.sh`, and for the realistic mixed changeset (scripts + `package.json` + docs); plus two `samples` entries pinning the category.

**One further guard, in the shell suite itself:** nothing in this repository asserted that a `scripts/*.test.sh` file is reachable from `npm run test:shell` — a sibling suite added later could sit in the tree, pass `bash -n`, and never run. The suite now enumerates every `scripts/*.test.sh` and fails if any is not referenced by `package.json` **and** chained into the `test:shell` aggregate.

The step name at `ci-layers.yml:366` was updated from *"(opscheck, pgBackRest, PITR app smoke)"* to include *"frontend deploy"*, since it had become inaccurate. That is the only CI workflow change.

---

## 13. Rollback

Three distinct categories, deliberately not merged:

### 13.1 Application / backend rollback — **unchanged by this task**

Per [`runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md` §4.1](../runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md). A **production-checkout revision change, not an `origin/main` rewrite**:

```bash
git -C /var/www/noramedi log --oneline -5                 # identify the prior known-good commit
git -C /var/www/noramedi checkout <prior-sha>             # [MUTATING]
/usr/local/sbin/noramedi-deploy.sh --skip-pull --skip-build --skip-migrate --skip-generate   # [MUTATING]
```

`--skip-pull` is **mandatory** — the script's step 1 is `git pull`, which would otherwise fast-forward production back to current `main` and defeat the rollback.

### 13.2 Frontend artifact rollback — **new, and this is what R-038 was missing**

Every deploy prints the exact command, with the exact preserved directory, at the end of its own run. There is no "restore the previous version" instruction anywhere in this task's output.

```bash
# What is live right now, and does it match the backend?
/usr/local/sbin/noramedi-frontend-deploy.sh verify

# Roll back to the bundle the last deploy preserved (the path it recorded — never guessed):
/usr/local/sbin/noramedi-frontend-deploy.sh rollback --dry-run     # inspect first; mutates nothing
/usr/local/sbin/noramedi-frontend-deploy.sh rollback               # [MUTATING]

# Or to a specific preserved bundle, named exactly:
/usr/local/sbin/noramedi-frontend-deploy.sh rollback \
  --from /var/www/noramedi/dist.rollback-<tag>-<UTC>               # [MUTATING]

# Confirm, including that the browser actually receives it:
/usr/local/sbin/noramedi-frontend-deploy.sh verify --url https://<host> --check-backend
```

**Rolling back this PR itself needs none of the above.** The change is additive: two new files, one new npm script, one classifier clause, one CI step name, and documentation. Reverting the merge commit removes them. **The production frontend `dist` is not touched by merging this PR** — nothing runs until an operator runs it.

### 13.3 Database rollback — **NOT REQUIRED**

No schema change, no migration, no data mutation. Nothing to reverse.

---

## 14. Stop conditions — each checked

| Stop condition | Status |
|---|---|
| `F3-PROD-004` collides with an existing task | **No** (§1) |
| `R-038` already `CLOSED` by newer evidence | **No** — `OPEN` at baseline, explicitly left `OPEN` by F3-PROD-003 |
| Production frontend serving model materially different from the accepted manual dist-swap evidence | **No.** The script operates on exactly the path and sequence F3-PROD-003 §5.1 records. The *unverified* part — whether nginx serves it — is a pre-existing recorded gap, is not asserted away, and is stated in §10 and in the script header. |
| Safe promotion requires infrastructure redesign | **No.** No Kubernetes, Swarm, container, blue/green, reverse-proxy or CI/CD platform change. Two renames, as today. |
| Schema/data migration appears necessary | **No** |
| New external provider required | **No** |
| Production access required | **No.** Nothing in this task accessed production. |
| Path safety cannot be bounded | **No** (§9), and the bound is mutation-proven (§11.1) |
| Rollback cannot be made deterministic | **No** (§5) |
| Tracker and runbook materially disagree | **No.** Both record the frontend procedure as manual and unscripted; they agree, and this task is what changes that. |

---

## 15. Migration, security, tenant isolation, KVKK

| Field | Value |
|---|---|
| `MIGRATION_REQUIRED` | **NO** |
| `MIGRATION_CREATED` | **NO** |
| `PRODUCTION_MIGRATION` | **NO** |
| Prisma schema touched | **NO** |
| Application data mutated | **NO** |
| PHI/PII processing change | **NONE** — no application source file is modified by this task |
| Tenant-isolation change | **NONE** |
| Auth/authorization change | **NONE** |
| Subprocessor change | **NONE** |
| Storage-provider change | **NONE** |
| Secret-format change | **NONE** |

**Log privacy.** `scripts/log-privacy-guard` scans `.ts` files under five `server/src/**` roots only, so a `.sh` file is out of its scope by configuration (`config/scan-roots.json:11`, whose provenance note forbids broadening without a new evidence entry). The guard's *spirit* is enforced here by construction and by test instead: the script contains no `printenv`, no environment dump, no `declare -p`; it reads exactly one key (`RELEASE_SHA`) out of `pm2_env` and nothing else; the only identifiers it prints are paths under the deployment root and the git release SHA, which the deploy log is expected to record and which `git log` already shows. Every invocation in the suite runs with a canary planted in `DATABASE_URL`, `SENTRY_DSN` and a token variable, and the canary is asserted absent from the output of the success, failure, restoration, dry-run and help paths.

---

## 16. Risk and gate status

| Item | Before | After | Note |
|---|---|---|---|
| **R-038** | `OPEN` | **`CLOSURE_PROPOSED_AWAITING_MERGE_AND_DEPLOYMENT`** | **NOT closed by this task.** Both components of the row are addressed in the repository, but the row's own missing control is a *build/deploy comparison*, which requires an executed production run. Closure requires `MERGED` + `DEPLOYED` + `PRODUCTION_VERIFIED` and independent confirmation, per the R-019/R-071/R-072/R-073/R-075/R-033/R-040/R-076 no-self-closure precedent. The status token is the one this register already uses (R-079, F4-3-R2). |
| R-030 | `OPEN` | `OPEN` | untouched |
| R-030-DB | `OPEN` | `OPEN` | untouched |
| R-030-FILES | `OPEN` | `OPEN` | untouched |
| R-039 / R-040 | `OPEN` / `CLOSED` | unchanged | the nginx static-root ambiguity in §10 belongs to F0-006/R-039's territory and is neither claimed nor closed here |
| `FIRST_CUSTOMER_RECOVERY_GATE` | `NOT_SATISFIED` | `NOT_SATISFIED` | blocker remains `R-030-DB`; this task is named by none of its criteria |
| F3 exit gate | `NOT_SATISFIED` | `NOT_SATISFIED` | R-038 is named by none of its three criteria |
| F4 | NOT COMPLETE | NOT COMPLETE | externally blocked; unchanged |
| F5 | NOT AUTHORIZED | NOT AUTHORIZED | unchanged |
| repo2 | NOT ACTIVATED | NOT ACTIVATED | unchanged |

**Production verification required before `R-038` may be considered for closure** (independent, operator-executed, not self-asserted):

1. `noramedi-frontend-deploy.sh verify` on the current production `dist` — expected to **warn** that no `release.json` exists, since the live bundle predates this task. That warning *is* the R-038 condition, observed.
2. One `deploy --dry-run` on the production host, confirming zero mutations and the intended paths.
3. One real `deploy`, then `verify --url https://<host> --check-backend`, confirming `release.json` is reachable **over HTTP** — which is what finally establishes that nginx serves the promoted directory (§10).
4. One `rollback --dry-run`, and — in a maintenance window — one real `rollback` followed by a `deploy` forward, so the rollback path is rehearsed before it is needed rather than during an incident.

---

## 17. Lifecycle

| Field | Value |
|---|---|
| `AGENT_COMPLETED` | **YES** |
| Tests executed locally | **YES** — 105/105 suite, `npm run test:shell` exit 0, 28/28 classifier, both typechecks and the `bash -n` gate clean, 1 platform skip reported |
| `TESTS_PASSED` (tracker status) | **NOT SELF-ASSIGNED** — `docs/program/README.md` §5 forbids an agent assigning this. §11 reports what was executed; the status is external. |
| `PR_OPENED` | YES (see tracker entry) |
| `MERGED` | **NO** |
| `DEPLOYED` | **NO** |
| `PRODUCTION_VERIFIED` | **NO** |

---

## 18. Files changed

| File | Change |
|---|---|
| `scripts/noramedi-frontend-deploy.sh` | **new** — deploy/rollback/verify, promotion, restoration, path safety, release marker |
| `scripts/noramedi-frontend-deploy.test.sh` | **new** — 105-assertion hermetic regression suite |
| `package.json` | `test:shell:frontend-deploy` added; chained into `test:shell` |
| `scripts/ci-classify/classify.ts` | one `CI_TOOLING` clause for `scripts/**/*.sh` |
| `scripts/ci-classify/__tests__/classify.test.ts` | one F3-PROD-004 test + two `samples` entries |
| `.github/workflows/ci-layers.yml` | step name corrected to include the new suite (name only) |
| `docs/program/NORAMEDI_MASTER_TRACKER.md`, `RISK_REGISTER.md`, `phases/F3_PRODUCTION_HARDENING.md`, `CHANGELOG.md`, `runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md` | documentation |
| **this file** | new evidence document |

No application source file, no Prisma schema, no migration, no lockfile, no `ecosystem.config.cjs`, and no change to `scripts/noramedi-deploy.sh`.
