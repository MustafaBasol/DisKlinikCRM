# F3-PROD-004 — Reproducible Frontend Deployment & Rollback Automation (R-038)

**Phase:** F3 — Production Hardening / parallel first-customer readiness lane
**Date:** 2026-08-17 · **R1 architecture-review response:** 2026-08-17 (§19)
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
| T | Shell-level regression coverage for any of the above | **MISSING** | **AUTOMATED** (188 assertions, §8/§19) |
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

**Same-filesystem is enforced, not assumed.** `rename(2)` cannot cross devices; if it could, `mv` would silently degrade to copy-then-delete with a genuinely long window. The script compares `stat` device IDs and fails closed on a mismatch (`assert_same_filesystem`).

**An undetermined device is also a refusal.** If `stat` cannot report a device for either path, the precondition is *unverifiable*, and the operation is refused — no rename, no state change, live bundle unchanged. The first revision of this script warned and continued in that case, which made a fail-closed contract fail open on exactly the hosts where nothing had verified the precondition. Corrected under R1; see §19.1.

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

**`releaseSha` is a validated contract, not free text** (added under R1 — §19.3). Accepted: a 40- or 64-character **lowercase** hex git object id, or the exact literal `unknown`. Anything else — a quote, a newline, a space, a slash, an abbreviated SHA, uppercase hex, arbitrary prose — is **refused before anything is built or renamed**, not escaped and accepted. This is the shape the rest of the program already produces (`noramedi-deploy.sh:182` and `ecosystem.config.cjs:84-97` both resolve `git rev-parse HEAD`, falling back to that same literal), and nothing in the repository produces or consumes an abbreviated `RELEASE_SHA`. Values read back *out* of a pre-existing marker, or out of `pm2_env`, are held to the same contract and reported as `INVALID` rather than echoed into operator output.

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

**Fail-closed conditions, each with a test:** build failure · staging output missing · staging empty · `index.html` missing · `index.html` referencing an absent hashed asset · stale staging directory · rollback-destination collision · cross-filesystem staging/live · **undetermined filesystem device (R1)** · unsafe or empty deployment root · invalid rollback source · rollback source equal to the live or staging path · non-existent rollback source · symlinked live/staging/source path · unsafe `--tag` · **malformed release identity, including `--expect-sha` (R1)** · **build-executable override that is not an absolute path to an executable regular file (R1)** · unknown command or option · missing option value · rename-2 failure without restoration.

A `--dry-run` is subject to every one of these. It reports that the real operation **would refuse**, and never prints its completion line in that case: a dry run must not describe a deployment as safe on a host where it would fail.

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
| 1 | `bash scripts/noramedi-frontend-deploy.test.sh` | **188 passed, 0 failed, 2 skipped** (105/1 before R1) |
| 2 | `npm run test:shell` (the exact CI aggregate) | **exit 0** — opscheck 178/178, pgBackRest 239/239, PITR app smoke 50/50, frontend deploy 188/188 |
| 3 | `npm run test:ci-classify` | **28 passed, 0 failed** (was 24 before this task) |
| 4 | `npm run typecheck:ci-classify` | **exit 0** |
| 5 | `for f in scripts/*.sh scripts/test-runtime/*.sh; do bash -n "$f"; done` (the CI gate verbatim) | **exit 0, all pass** |
| 6 | `npx tsx scripts/ci-classify/cli.ts --files-from=<this task's changed files>` | `docsOnly: false`, all five deep-gate flags `true` (§12) |

**The two skips, reported rather than hidden.** Both are Windows/MSYS filesystem limitations of the development host, not gaps in the suite. (1) The symlinked-live-path guard — MSYS cannot create real symlinks without developer mode. (2) The non-executable build-override guard (added under R1) — this filesystem reports a shebang file as executable even after `chmod -x`, so the "not executable" branch cannot be reached locally. In both cases the suite prints `SKIPPED`, counts it, and repeats the count in the summary line. **On `ubuntu-latest` — the only runner that gates this repository — neither skip fires and both guards are exercised.** Neither is claimed as locally verified.

**Coverage against the required categories:** successful staged build/promotion ✓ · build failure → live unchanged ✓ · invalid staging output → live unchanged (three variants) ✓ · rollback target collision → abort ✓ · second rename failure → previous live bundle restored ✓ · explicit rollback → expected version becomes live ✓ · invalid rollback source → abort (five variants) ✓ · unsafe path → abort (thirteen variants) ✓ · dry-run → zero mutations ✓ · release marker correctness ✓ · no secret leakage ✓ · shell syntax ✓ · path quoting with spaces ✓ · **undetermined filesystem device → deploy, rollback and both dry-runs refuse (R1)** ✓ · **build override → six rejection variants plus three proven-not-executed injection payloads (R1)** ✓ · **release identity → sixteen rejection variants and three accepted values, each with the marker re-parsed as JSON (R1)** ✓.

### 11.1 Mutation / falsification

Two mutants at first authoring, both applied to the real file, both reverted before commit; **three further mutants under R1 are in §19.4.** Counts in this subsection are those of the pre-R1 suite (105 assertions). **`git grep "false && mv"` returns nothing and `git diff` shows no mutant text.**

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
| Tests executed locally | **YES** — 188/188 suite, `npm run test:shell` exit 0, 28/28 classifier, both typechecks and the `bash -n` gate clean, 2 platform skips reported |
| `TESTS_PASSED` (tracker status) | **NOT SELF-ASSIGNED** — `docs/program/README.md` §5 forbids an agent assigning this. §11 reports what was executed; the status is external. |
| `PR_OPENED` | YES (see tracker entry) |
| `MERGED` | **NO** |
| `DEPLOYED` | **NO** |
| `PRODUCTION_VERIFIED` | **NO** |

---

## 18. Files changed

| File | Change |
|---|---|
| `scripts/noramedi-frontend-deploy.sh` | **new** — deploy/rollback/verify, promotion, restoration, path safety, release-identity contract, release marker |
| `scripts/noramedi-frontend-deploy.test.sh` | **new** — 188-assertion hermetic regression suite |
| `package.json` | `test:shell:frontend-deploy` added; chained into `test:shell` |
| `scripts/ci-classify/classify.ts` | one `CI_TOOLING` clause for `scripts/**/*.sh` |
| `scripts/ci-classify/__tests__/classify.test.ts` | one F3-PROD-004 test + two `samples` entries |
| `.github/workflows/ci-layers.yml` | step name corrected to include the new suite (name only) |
| `docs/program/NORAMEDI_MASTER_TRACKER.md`, `RISK_REGISTER.md`, `phases/F3_PRODUCTION_HARDENING.md`, `CHANGELOG.md`, `runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md` | documentation |
| **this file** | new evidence document |

No application source file, no Prisma schema, no migration, no lockfile, no `ecosystem.config.cjs`, and no change to `scripts/noramedi-deploy.sh`.

---

## 19. F3-PROD-004-R1 — architecture review response

The F3-PROD-004 design was **accepted** in architecture review, with **three blockers to correct before merge**. All three are corrected on the same branch, in the same PR (#437). Nothing in the accepted design changed: one script, `deploy`/`rollback`/`verify`, the two-step same-filesystem rename promotion described exactly as before, deterministic rollback with no directory-order guessing, bounded restoration on a rename-2 failure, no delete primitive, `release.json`, PM2 runtime SHA comparison, independent frontend/backend status, path safety, dry-run, R-038 lifecycle, and no application/schema/data change.

| # | Blocker | Correction |
|---|---|---|
| 1 | Same-filesystem check **failed open** on an undetermined device | Undetermined device is now a **refusal** (§19.1) |
| 2 | Build executed an **environment-supplied command string** | The build seam is now an **executable file**, executed directly; the production build is a fixed argument vector (§19.2) |
| 3 | `releaseSha` accepted **arbitrary bytes** into a publicly served marker | A **validated release-identity contract**, proven from repository evidence (§19.3) |

### 19.1 Blocker 1 — an undetermined filesystem device now refuses the operation

`assert_same_filesystem` compared `stat` device IDs and died on a mismatch, but when a device could **not** be determined it emitted a `WARNING` and returned success. That is the fail-closed promotion contract failing **open**, and failing open in the worst place: a host where `stat` cannot report a device is precisely a host where nothing has verified that staging, live and the preserved bundle share a filesystem, and a cross-device `mv` degrades silently into copy-then-delete — stretching the near-atomic window into a long one, on production, behind a warning nobody reads.

**UNKNOWN DEVICE = REFUSE OPERATION.** Both branches now `die`: no rename, no state mutation, live bundle unchanged, and the message says so.

**Dry-run behaviour is explicitly defined.** The check runs before the dry-run early return in both `deploy` and `rollback`, so a dry run on such a host **refuses too**, states that it is a dry run and that nothing was changed, and reports that the real operation would refuse. It does **not** print its `=== DRY RUN complete — zero mutations ===` line — a dry run must never describe a deployment as safe on a host where it would fail. That negative assertion is a test in its own right.

**Test seam — no production hook.** The suite puts a `stat` on `PATH` that cannot report a device, the same technique already used for the failing `mv`. Section M drives deploy, deploy `--dry-run`, rollback and rollback `--dry-run`, asserting in each case that the refusal came from *this* check by its own wording (`UNVERIFIABLE`), that the live bundle is byte-identical, and that no state file was written — plus a **positive control** proving the identical rollback succeeds once the device can be determined, so the four refusals are attributable rather than incidental.

### 19.2 Blocker 2 — no shell-string build execution

`NORAMEDI_FRONTEND_BUILD_CMD` was read from the environment and passed to `eval`. It existed for one reason — so the regression suite could substitute a build without a Vite toolchain — but it was an arbitrary-code seam in a tool an operator runs against a production host, and it is gone.

- **Production runs a fixed argument vector:** `BUILD_ARGV=(npm run build -- --outDir dist.next)`, invoked with no shell — no word splitting, no expansion, nothing the environment can influence.
- **The only substitution point is an executable file:** `NORAMEDI_FRONTEND_BUILD_EXECUTABLE`, which must be an **absolute path** (a bare name would be resolved through `PATH`), must contain no newline, must **exist**, must **not be a directory**, must be a **regular file**, and must be **executable**. It is then run directly with the staging directory as its single argument. It is never sourced and never interpreted as shell source.
- Using it emits a `WARNING`, so a production run that somehow has it set says so in the deploy log rather than silently building something unexpected.
- There is **no `eval`** and **no `sh -c` / `bash -c`** anywhere in the file, and the removed variable name appears nowhere in it — comments included.

The suite asserts all of that structurally on the comment-stripped file, and behaviourally: six rejection variants, three of which are real injection payloads (`printf x > …`, `/bin/sh -c '…'`, `/bin/echo hi; printf x > …`) whose **side-effect files are asserted not to exist afterwards**. The shell scripting the suite needs now lives entirely on the suite's side of that boundary — the test file authors a helper program, and the production script only ever executes a validated executable.

### 19.3 Blocker 3 — release identity is a validated contract

`releaseSha` is written into `dist/release.json`, which nginx serves publicly. It was interpolated unvalidated, so a value containing a quote or a newline produced a **malformed release marker** and arbitrary text in operator-facing output.

**The accepted contract, proven from repository evidence rather than chosen:** `scripts/noramedi-deploy.sh:182` resolves `RELEASE_SHA="${RELEASE_SHA:-$(git -C "$APP_DIR" rev-parse HEAD … || echo unknown)}"`, and `ecosystem.config.cjs:84-97` (`resolveReleaseSha`) does the same with the same fallback. Both produce a **full 40-character lowercase SHA-1 or the exact literal `unknown`**. Nothing in this repository produces or consumes an abbreviated `RELEASE_SHA`, so **short SHAs are not accepted**. 64 hex is allowed for forward compatibility with a SHA-256 object format.

```
accept:  ^[0-9a-f]{40}$   |   ^[0-9a-f]{64}$   |   unknown
```

- **Lowercase only, deliberately.** `git rev-parse` never emits uppercase; silently accepting it would make the frontend marker mismatch the backend's `pm2_env` value and report a release skew that does not exist. Uppercase hex gets its own message naming the fix.
- **Fail closed, never escape-and-continue.** Validation runs in `cmd_deploy` before the value is used for anything — before the preserved-directory name is derived from it, before the build — and again inside `write_release_marker` as defence in depth. `--expect-sha` is held to the same contract, so a malformed expectation is a refusal rather than a reported production mismatch.
- **The error message is bounded.** An overlong or control-character-bearing value is summarised (truncated at 80 characters with a length, tabs/newlines/CRs escaped) rather than echoed whole into the deploy log.
- **Values read back are not trusted either.** A `releaseSha` from a pre-existing or hand-edited marker, and the `RELEASE_SHA` read out of `pm2_env`, are reported as `INVALID` if they do not satisfy the contract, and `RELEASE_SHA_MATCH` becomes `NOT_APPLICABLE` rather than a verdict.
- **`release.json` validity is checked with a real JSON parser**, not grep: each accepted deploy re-reads the marker through `node`/`JSON.parse` and asserts both the exact four-field key set and that `releaseSha` round-trips byte-identically.

Sixteen rejection variants are tested — double quote, JSON field injection (`x", "builtBy": "…`), newline, carriage return, tab, space, backslash, slash, `$( )`, backticks, 12-character SHA, 39- and 41-character near-misses, non-hex of the right length, arbitrary prose, uppercase hex, and a 500-character blob — each asserting the specific refusal message and that nothing under the deployment root changed. The `$( )` and backtick cases additionally assert their payload never executed. Three accepted values (40-hex, 64-hex, `unknown`) assert success, marker validity and the derived preserved-directory name.

**One pre-existing test defect this contract exposed.** The secret-canary loop in section K ran a dry-run deploy with `--release-sha ffff1111` — eight characters. Under the new contract that invocation aborts at validation, so the case would have gone on "passing" while exercising nothing. It now uses a full 40-character SHA, and the dry-run path it was written to cover is actually reached.

### 19.4 R1 mutation / falsification

Three mutants, each applied to the real file, each reverted. `git grep` for mutant text returns nothing.

| Mutant | Change | Result |
|---|---|---|
| **1** | `assert_same_filesystem` restored to `warn` + `return 0` on an unknown device | **177 passed, 11 failed, exit 1 — killed.** Every section-M assertion failed, including the byte-level snapshot ones: the mutant actually performed the promotion and the rollback on a host where the precondition was unverifiable. |
| **2** | `eval` on an environment-supplied command string restored alongside the executable seam | **186 passed, 2 failed, exit 1 — killed** by the two structural assertions (`no eval at all`, `the removed seam is still referenced`). |
| **2b** | The stricter variant: override validation removed and the override run as `sh -c "$exe"` — i.e. a future "fix" that lets the seam take a command string again | **178 passed, 10 failed, exit 1 — killed.** Three injected payloads (`pwned-relative`, `pwned-absolute`, `pwned-semicolon`) were **actually created on disk** and the assertions detected them, so the security claim rests on observed behaviour and not only on a grep of the source. |
| **3** | `assert_valid_release_sha` short-circuited to `return 0` | **157 passed, 31 failed, exit 1 — killed.** Several rejected values exited non-zero anyway for unrelated reasons; because every assertion requires the *specific* refusal message, those cases still failed — the lesson mutant B taught this suite at first authoring, applied. |

Clean tree after reverting all three: **188 passed, 0 failed, 2 skipped, exit 0.**

### 19.5 R1 CI reachability

R1 changes only `scripts/noramedi-frontend-deploy.sh`, `scripts/noramedi-frontend-deploy.test.sh` and documentation. **No classifier rule and no workflow change was required or made** — the existing chain applies unchanged, re-verified with the real CLI on the R1 changed-path set:

```
fileCategories: scripts/noramedi-frontend-deploy.sh      -> CI_TOOLING
                scripts/noramedi-frontend-deploy.test.sh -> CI_TOOLING
docsOnly: false ; runBackendGeneral/runPostgres/runStorage/runFrontendFullSuite/runLegacyBackend: all true
```

→ `workflow-and-syntax-lint` (`ci-layers.yml:319-325`) → `npm run test:shell` (`:365`) → `test:shell:frontend-deploy` (`package.json:42`) → the 188-assertion suite, on `ubuntu-latest`, where both local skips are exercised.

### 19.6 R1 status — unchanged where it must be

`R-038` remains **`CLOSURE_PROPOSED_AWAITING_MERGE_AND_DEPLOYMENT`** — **NOT CLOSED**. R1 hardens the tool; it does not perform the production run the row's missing control requires. `R-030` / `R-030-DB` / `R-030-FILES` `OPEN` · `FIRST_CUSTOMER_RECOVERY_GATE` `NOT_SATISFIED` · F3 exit gate `NOT_SATISFIED` · F4 NOT COMPLETE · F5 NOT AUTHORIZED · repo2 NOT ACTIVATED. `MIGRATION_REQUIRED` / `MIGRATION_CREATED` / `PRODUCTION_MIGRATION` all **NO**; no tenant, auth, PHI/PII, provider, schema or production-data impact. The four production-verification steps in §16 are unchanged and still outstanding.

---

## 20. F3-PROD-004-R2 — the public verification check, corrected against the real host

**Date:** 2026-08-17 · **Branch:** `fix/f3-prod-004-r2-public-release-marker-verification` · **Baseline:** `origin/main` @ `dbdbbdfba4ece4f666fe5984244d41b253f7430a` (PR #437 merge) · **Found by:** F3-PROD-005 pre-flight, before any production mutation.

F3-PROD-005 read the live production site before installing anything. `verify --url` — the single check §10 nominates to close the `UNVERIFIED_PRODUCTION` nginx question — was wrong in **both** directions against the real host. Neither failure is reachable from the repository: both depend on production nginx behaviour that no test fixture described.

### 20.1 What was observed on production, pre-deploy

Read-only, from outside the host, against `https://app.noramedi.com` on 2026-08-17:

| Request | Observed | Merged script's verdict | Correct verdict |
|---|---|---|---|
| `GET /` | **302** → `https://app.noramedi.com/login` (`Server: nginx/1.24.0`, `Content-Length: 154`) | **FAIL** (`[[ "$code" == "200" ]]`, no `-L`) | reachable |
| `GET /release.json` | **200**, `Content-Type: text/html`, `Content-Length: 3069`, body byte-identical to `GET /__nonexistent__.json` | **PASS** | **no marker is served** |

The second row is the serious one. The SPA fallback (`try_files $uri /index.html`) answers **200 with `index.html` for any path that does not exist on disk**, so a status-code check reports the release marker as served on a host that has no release marker anywhere — which is exactly the R-038 condition the check exists to detect. The first row is the loud one: a correct deploy could never produce a passing `verify --url`, because production's root path redirects.

**Consequence for R-038:** `NGINX_PROMOTED_DIST_SERVING_EVIDENCE` could not have been established by the merged script. A passing `verify --url` would have been indistinguishable from the pre-deploy state.

### 20.2 The correction

`verify --url` no longer decides anything from an HTTP status:

- **Reachability** follows redirects (`-L --max-redirs 5`) and accepts any final **2xx**, so a redirecting root is not a failure.
- **The marker is decided by its CONTENT.** The response body is parsed for `releaseSha` through `marker_field_from_text`, the same extraction `read_marker_field` now uses for the on-disk file — one rule for both. A fallback HTML page has no `releaseSha` field and is reported `NOT_SERVED`.
- **Served-vs-promoted is compared explicitly.** Three new reported lines, in the style of the existing `RELEASE_SHA_MATCH`:

```
PUBLIC_RELEASE_SHA         = <sha> | NOT_SERVED | INVALID
PUBLIC_SHA_MATCHES_LOCAL   = YES | NO | NOT_APPLICABLE
NGINX_SERVES_PROMOTED_DIST = VERIFIED | NOT_VERIFIED
```

`VERIFIED` is printed only when the served marker and the promoted bundle report the **same valid release identity** and no other problem was recorded. That one line is the whole of what the script claims — it does not assert which nginx directive produced it. A value read out of the served marker goes through the same release-identity contract as every other foreign value (§19.3): reported `INVALID`, never echoed.

No mutation semantics changed. `deploy`, `rollback`, promotion, path safety, the device precondition and the release-identity contract are untouched; there is still no `rm`, no `eval`, and no shell-string execution in the file.

> **Amended by §21 (F3-PROD-004-R2-R1).** Moving the verdict onto the body was necessary but **not sufficient**: as written above, a `404` or `500` whose body happened to contain a valid matching marker could still reach `VERIFIED`, and so could a body fetched after a redirect to an unrelated host. §21 adds the final-status and effective-origin gates. Read §20.2 as the first half of the correction, not the contract.

### 20.3 Tests — 188 → 204

New section **P**, 16 assertions, driven by a `curl` on PATH that reproduces both production behaviours (302 root, SPA fallback) and **only follows the redirect when `-L` is actually passed**:

| Assertion | Proves |
|---|---|
| verify FAILS when the site serves the SPA fallback instead of a marker | the defect itself |
| a 200-with-no-marker is `NOT_SERVED` | status is not evidence |
| `NGINX_SERVES_PROMOTED_DIST = NOT_VERIFIED` on fallback HTML | no over-claim |
| a 302 on `/` does not fail verification when it resolves to 2xx | the false negative |
| the served `releaseSha` is parsed out of the response body | the mechanism |
| served marker == promoted bundle → `VERIFIED` | the positive case |
| public verification prints no environment secret | canary |
| served release != live bundle → fail, `PUBLIC_SHA_MATCHES_LOCAL = NO` | cache/wrong-root detection |
| malformed served identity → `INVALID`, not echoed | §19.3 contract holds for fetched values |
| unreachable site → fail, never `VERIFIED` | not "nothing to check" |
| pre-marker bundle behind a fallback → fail (the R-038 condition) | end-to-end |

| # | Command | Result |
|---|---|---|
| 1 | `bash scripts/noramedi-frontend-deploy.test.sh` | **204 passed, 0 failed, 2 skipped** (188/2 before R2) |
| 2 | `npm run test:shell` | **exit 0** — opscheck 178/178, pgBackRest 239/239, PITR app smoke 50/50, frontend deploy 204/204 |
| 3 | `npm run test:ci-classify` | **28 passed, 0 failed** |
| 4 | `npm run typecheck:ci-classify` | **exit 0** |
| 5 | `for f in scripts/*.sh scripts/test-runtime/*.sh; do bash -n "$f"; done` | **exit 0** |
| 6 | `npx tsx scripts/ci-classify/cli.ts --files-from=<changed>` | `docsOnly: false`, all five deep-gate flags `true` |

The same 2 skips as §11 (MSYS symlink and `chmod -x` limitations); neither is in section P, and both are exercised on `ubuntu-latest`.

### 20.4 R2 mutation / falsification

Both mutants applied to the real file, both reverted before commit. `git grep "MUTANT B"` returns nothing.

**Mutant A — `-L` removed from the fetch** (the redirect is no longer followed):

```
FAIL - verify failed against a healthy site whose root redirects (exit 1)
FAIL - the script withheld VERIFIED on a genuinely served marker
Results: 202 passed, 2 failed, 2 skipped   (exit 1)
```

**Mutant B — the merged defect reintroduced verbatim** (marker verdict taken from `[[ "$code" == "200" ]]`, public SHA assumed equal to local):

```
FAIL - verify passed against a host serving no release marker at all
FAIL - the fallback response was not reported as NOT_SERVED
FAIL - the script claimed the promoted dist is served on fallback HTML
FAIL - verify accepted a served release that is not the promoted one
FAIL - the disagreement was not reported
FAIL - verify accepted a malformed served release identity
FAIL - the malformed served value was echoed or mis-reported
Results: 197 passed, 7 failed, 2 skipped   (exit 1)
```

Mutant B is the falsification that matters: it restores exactly what was merged in PR #437, and section P turns red on the precise production condition — a live host with no release marker passing verification.

### 20.5 R2 status — unchanged where it must be

`R-038` remains **`CLOSURE_PROPOSED_AWAITING_MERGE_AND_DEPLOYMENT`** — **NOT CLOSED**. R2 makes the closure *check* sound; it performs no production access, no deployment, no schema or data change. `DEPLOYED = NO` · `PRODUCTION_VERIFIED = NO`. `R-030` / `R-030-DB` / `R-030-FILES` `OPEN` · `FIRST_CUSTOMER_RECOVERY_GATE` `NOT_SATISFIED` · F3 exit gate `NOT_SATISFIED` · F4 NOT COMPLETE · F5 NOT AUTHORIZED · repo2 NOT ACTIVATED. `MIGRATION_REQUIRED` / `MIGRATION_CREATED` / `PRODUCTION_MIGRATION` all **NO**; no tenant, auth, PHI/PII, provider, schema or production-data impact. The published `release.json` contract is unchanged — R2 only *reads* it.

---

## 21. F3-PROD-004-R2-R1 — a served marker needs a successful response from the right origin

**Date:** 2026-08-17 · **Branch:** `fix/f3-prod-004-r2-public-release-marker-verification` (unchanged) · **PR:** #438 (unchanged) · **Reviewed HEAD:** `b8568e47de526bebf3b9910fc338023a4ac12234` · **Raised by:** architecture review of R2.

The R2 review accepted the direction — root redirects followed, SPA fallback HTML rejected, body parsed, served-vs-promoted compared — and held one narrow blocker.

### 21.1 The remaining root cause

R2 made the marker verdict depend on the **body** and, in doing so, stopped consulting the marker response's **own** outcome. `verify_public_bundle()` at `b8568e4` could reach

```
NGINX_SERVES_PROMOTED_DIST = VERIFIED
```

with the final `/release.json` response being a **404** or a **500**, provided its body contained a well-formed `releaseSha` equal to the promoted bundle's. It could also reach it on a body fetched after a redirect to a **different host**, because `-L` was followed but the destination was never examined.

Both are the same mistake in a new place: an error page is not a served file, and another host's answer is not this host's answer. Either would have produced R-038 closure evidence that the production nginx never actually supported.

### 21.2 The HTTP status contract

`NGINX_SERVES_PROMOTED_DIST = VERIFIED` is now printed only when **all six** hold:

| # | Condition |
|---|---|
| 1 | app-root reachability passes — a final **2xx** after redirects |
| 2 | the final `/release.json` response is itself **2xx** |
| 3 | that response came from an **acceptable effective origin** |
| 4 | the body parses as a release marker |
| 5 | the `releaseSha` is valid under the §19.3 release-identity contract |
| 6 | the served `releaseSha` equals the promoted bundle's |

Conditions 2 and 3 are **gates, not scores**: a response failing either is reported `NOT_SERVED` and **its body is not parsed at all**, so a valid-looking marker on an error page or on a foreign origin cannot contribute evidence in any form — not to `PUBLIC_RELEASE_SHA`, not to `PUBLIC_SHA_MATCHES_LOCAL`.

### 21.3 The effective-URL / origin contract

`http_get` now returns `"<final-status> <effective-url>"` (curl `-w` with `%{http_code}` and `%{url_effective}`; `000 -` on curl failure). Both effective URLs are recorded in the run output, so an unexpected destination is visible in the evidence rather than inferred:

```
PUBLIC_ROOT_URL            = <final URL of GET />
PUBLIC_MARKER_STATUS       = <final status of GET /release.json>
PUBLIC_MARKER_URL          = <final URL of GET /release.json>
PUBLIC_RELEASE_SHA         = <sha> | NOT_SERVED | INVALID
PUBLIC_SHA_MATCHES_LOCAL   = YES | NO | NOT_APPLICABLE
NGINX_SERVES_PROMOTED_DIST = VERIFIED | NOT_VERIFIED
```

The origin rule is deliberately narrow — it decides one question, "did this answer come from the host the operator named", and is not a URL-policy framework:

| Redirect | Verdict |
|---|---|
| same scheme, host and port (default port derived from the scheme) | **acceptable** |
| `http` to `https` on the **same host** | **acceptable** — the transport moved, the origin did not |
| any other host | **FAIL / NOT_VERIFIED** |
| any other port | **FAIL / NOT_VERIFIED** |
| `https` downgraded to `http` | **FAIL / NOT_VERIFIED** |
| a non-absolute or non-`http(s)` effective URL | **FAIL / NOT_VERIFIED** |

`url_origin()` lowercases scheme and host, strips userinfo (`user@host` is not part of an origin), handles a bracketed IPv6 literal, and defaults the port from the scheme. `effective_origin_acceptable()` compares the parts without a subshell, a temp file or a herestring — the "no cleanup obligation" property of §20.2 is preserved.

### 21.4 Tests — 204 to 223

Section **P** grew by 19 assertions. No R2 assertion was removed or weakened. The fake `curl` now expands the `-w` format the way curl does (`%{http_code}`, `%{url_effective}`), so the production script's write-out string is exercised rather than assumed: drop `%{url_effective}` from it and the origin checks stop receiving a URL.

| Review case | Test | Result |
|---|---|---|
| 1. final 200 + matching valid marker | P2 | **PASS / VERIFIED** |
| 2. final **404** + matching valid JSON body | P7 | **FAIL / NOT_VERIFIED** |
| 3. final **500** + matching valid JSON body | P8 | **FAIL / NOT_VERIFIED** |
| 4. **302 same-origin** to a valid marker 200 | P9 | **PASS / VERIFIED** |
| 5. redirect to a **different host** + valid-looking marker | P10 | **FAIL / NOT_VERIFIED** |
| 6. SPA fallback 200 + HTML | P1 | **FAIL** |
| 7. malformed body | P11 | **FAIL** |
| 8. missing `releaseSha` | P12 | **FAIL** |
| 9. invalid `releaseSha` | P4 | **FAIL / INVALID**, not echoed |
| 10. valid but different SHA | P3 | **FAIL**, `PUBLIC_SHA_MATCHES_LOCAL = NO` |

P7/P8 also assert that `PUBLIC_RELEASE_SHA` is **not** the matching SHA on an error response — proving the body was never read — and that `PUBLIC_MARKER_STATUS` records the real status. P9 asserts both recorded effective URLs.

| # | Command | Result |
|---|---|---|
| 1 | `bash scripts/noramedi-frontend-deploy.test.sh` | **223 passed, 0 failed, 2 skipped** (204/0/2 at `b8568e4`) |
| 2 | `npm run test:shell` | **exit 0** — opscheck 178/178, pgBackRest 239/239, PITR app smoke 50/50, frontend deploy **223/223** |
| 3 | `npm run test:ci-classify` | **28 passed, 0 failed** |
| 4 | `npm run typecheck:ci-classify` | **exit 0** |
| 5 | `for f in scripts/*.sh scripts/test-runtime/*.sh; do bash -n "$f"; done` | **exit 0** |
| 6 | `git diff --check` | **exit 0** |

The same 2 skips as §11 and §20.3 (MSYS symlink, `chmod -x`); neither is in section P, and both run on `ubuntu-latest`.

### 21.5 R2-R1 mutation / falsification

Both mutants were applied to the real file and reverted before commit; the working tree was restored from a pre-mutation copy and re-run green (**223 / 0 / 2**) after each.

**Mutant C — the marker's 2xx requirement removed**, body comparison left intact (the `code != 2xx` test replaced by `if false`):

```
FAIL - a 404 response established serving evidence
FAIL - the script claimed VERIFIED on a 404 marker response
FAIL - a 404 response body was parsed and reported as a served marker
FAIL - a 500 response established serving evidence
FAIL - the script claimed VERIFIED on a 500 marker response
FAIL - a 500 response body was parsed and reported as a served marker
Results: 217 passed, 6 failed, 2 skipped   (exit 1)
```

**Mutant D — effective-origin validation disabled** (`effective_origin_acceptable()` returns 0 unconditionally):

```
FAIL - a cross-origin marker response established serving evidence
FAIL - the script claimed VERIFIED from a foreign origin
FAIL - a foreign-origin body was read as this host's marker
Results: 220 passed, 3 failed, 2 skipped   (exit 1)
```

Each mutant turns red exactly the cases the review predicted, and nothing else — the status gate and the origin gate are independently falsifiable.

### 21.6 R2-R1 status — unchanged where it must be

**Files changed:** `scripts/noramedi-frontend-deploy.sh`, `scripts/noramedi-frontend-deploy.test.sh`, this evidence file (§21; §20.2 amended with a forward pointer), `docs/program/CHANGELOG.md`, and `docs/program/runbooks/F3_FIRST_CUSTOMER_INCIDENT_RESPONSE.md` §4.12 — which told the operator the marker is judged by its parsed body, now half the rule. It records `PUBLIC_ROOT_URL`, `PUBLIC_MARKER_STATUS` and `PUBLIC_MARKER_URL` and says why an error page or a redirect off this host proves nothing even when the body looks right.

No runtime or application file outside `scripts/noramedi-frontend-deploy.sh` was touched, and within it nothing but public verification: `deploy`, `rollback`, two-step rename promotion, build argv, path guards, the release-identity contract and the no-delete policy are byte-identical to `b8568e4`. No new dependency; `curl` was already required by `--url`.

`R-038` remains **`CLOSURE_PROPOSED_AWAITING_MERGE_AND_DEPLOYMENT`** — **NOT CLOSED**. `DEPLOYED = NO` · `PRODUCTION_VERIFIED = NO` · `ROLLBACK_REHEARSED = NO`. **F3-PROD-005 remains BLOCKED** and no production access of any kind was made for R2-R1. `R-030` / `R-030-DB` / `R-030-FILES` `OPEN` · `FIRST_CUSTOMER_RECOVERY_GATE` `NOT_SATISFIED` · F3 exit gate `NOT_SATISFIED` · F4 NOT COMPLETE · F5 NOT AUTHORIZED · repo2 NOT ACTIVATED. `MIGRATION_REQUIRED` / `MIGRATION_CREATED` / `PRODUCTION_MIGRATION` all **NO**; no tenant, auth, PHI/PII, provider, schema or production-data impact, and no secret is read or printed by any line added here.
