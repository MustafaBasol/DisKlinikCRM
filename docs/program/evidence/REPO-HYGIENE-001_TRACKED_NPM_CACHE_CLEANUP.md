# REPO-HYGIENE-001 — Remove Accidentally Tracked npm Cache Directories

Task: REPO-HYGIENE-001 — Remove Accidentally Tracked npm Cache Directories
Phase: F0 — Repository Reliability
Target directories: `server/.npm-cache2/`, `server/.npm-cache3/`
Status: **Rebaselined onto current `main`, committed, and opened as a PR** (REPO-HYGIENE-001-R1 — see § 9)

---

## 0. Isolation and starting state

| Fact | Value |
|---|---|
| Base branch | `main` |
| Main SHA at original task start | `91276dc7f610ef6923e3c1a7572f0ebba578a2f7` |
| Main SHA after R1 rebaseline | `c522d61a7ac14923048b0708e261ee2ef99b943d` (115 commits / 158 files ahead of the original baseline — see § 9) |
| Worktree | `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\repo-hygiene-001-npm-cache-cleanup` |
| Branch | `chore/remove-tracked-npm-caches` (created from `main` at `91276dc7`, later fast-forwarded to `c522d61`) |
| Worktree creation method | Normal `git worktree add -b chore/remove-tracked-npm-caches main` — **succeeded on the first attempt**, no sparse-checkout fallback was needed (see § 4) |

---

## 1. Root cause

Both directories were introduced in a single existing commit, **`0936867`** — `Add secure cookie auth and signed CSRF migration` (2026-06-03) — as an unrelated side effect of that change (`git log --diff-filter=A` shows the same commit as the sole "add" event for every file in both directories).

The repository root `.gitignore` already contained an exact-match rule:

```
.npm-cache/
```

This rule ignores a directory named literally `.npm-cache`, but does **not** match `.npm-cache2/` or `.npm-cache3/` — gitignore glob rules without a wildcard require an exact path-segment match. When a developer ran npm locally with `--cache` pointed at a numbered/suffixed directory (an npm cache directory picks up a numeric suffix when the default cache path is unavailable or a prior instance is locked) and later ran a broad `git add`, the two directories were swept into the commit because they were not covered by any ignore rule.

---

## 2. Content and size verification

Confirmed via `git ls-tree -r -l HEAD -- server/.npm-cache2 server/.npm-cache3` and `git ls-files`:

| Metric | Value |
|---|---|
| Tracked files under `server/.npm-cache2/` | 141 |
| Tracked files under `server/.npm-cache3/` | 7 |
| **Total tracked files** | **148** |
| **Total tracked size** | **28,408,514 bytes** (≈ 27.10 MiB / 28.41 MB) |

**Content-only confirmation** — every path matches npm's on-disk cache layout exactly, with no exceptions:

- `_cacache/content-v2/sha512/<xx>/<xx>/<sha512-hex>` — content-addressable cache blobs (no file extension, binary hash-keyed storage — npm's `cacache` package layout)
- `_cacache/index-v5/<xx>/<xx>/<hash>` — npm's cache index shards
- `_update-notifier-last-checked` — npm's `update-notifier` timestamp marker (present once per directory, both empty/0-byte in this repo)

No source files, configuration, lockfiles, or documentation are present in either directory. This is standard, disposable, regenerable npm cache output — never legitimate application content.

---

## 3. Reference scan (targeted, repo-wide, excluding `node_modules`)

Searched for any script, config, or CI workflow that could intentionally consume these paths:

| Surface checked | Result |
|---|---|
| `.npmrc` files (repo-wide, excluding `node_modules`) | **None found** — no custom `cache` directive anywhere in the repo |
| `package.json` / `server/package.json` scripts | No reference to `npm-cache`, `--cache`, or either directory |
| `.github/workflows/*.yml` (`windows-bridge-pr.yml`, `windows-bridge-release.yml` — the only two workflow files in the repo) | Only cache reference is the standard `actions/setup-node` built-in `cache: 'npm'` keyed off `package-lock.json` / `server/package-lock.json` hashes — this is GitHub Actions' own dependency cache, unrelated to `server/.npm-cache2` or `server/.npm-cache3` |
| Repo-wide grep for the literal string `npm-cache` across `*.json .yml .yaml .js .ts .sh .ps1 .md .npmrc` | Zero hits outside the two target directories themselves |
| Other `.gitignore` files (`.codegraph/.gitignore`, `bridge-agent/.gitignore`, `server/.gitignore`, `windows-bridge/.gitignore`) | No conflicting or overlapping rules |

**Conclusion:** no runtime, build, test, deployment, or CI process intentionally reads from either directory. They are dead, accidentally committed cache weight only.

---

## 4. Windows checkout behavior (actual, not assumed)

The task brief anticipated a possible Windows `MAX_PATH` failure given the deeply nested, long, hash-named `_cacache` paths (up to ~140 characters under `server/.npm-cache2/_cacache/content-v2/sha512/xx/xx/<128-char-hex>`). In practice:

- `git worktree add --no-checkout` / sparse-checkout fallback was **not required**. A plain `git worktree add -b chore/remove-tracked-npm-caches main` completed cleanly (1,236 files checked out, no path-length errors) in this environment.
- This indicates Windows long-path support (or a sufficiently short repository root path) is already effective here, so the failure mode described in the task brief did not reproduce. It remains a latent risk for any environment without long-path support enabled — which is itself a reason to stop tracking these paths regardless of whether this checkout reproduced the failure.

---

## 5. Changes made

1. **Untracked both directories** (index only — `git rm -r --cached server/.npm-cache2 server/.npm-cache3`):
   - 148 files staged as deleted (`D`) from the index.
   - Working-tree copies were **left in place on disk** (`--cached` does not delete local files) — confirmed present after the operation. This is the correct outcome: the directories continue to function as an ordinary local npm cache, just like `node_modules/`, without being tracked by Git.

2. **Ignore rule** — narrowest single-line change, in the repository root `.gitignore`:

   ```diff
   -.npm-cache/
   +.npm-cache*/
   ```

   This is a minimal edit to an existing, already-present rule (line 12) rather than a new block. The wildcard covers `.npm-cache/`, `.npm-cache2/`, `.npm-cache3/`, and any future numbered/suffixed variant, repo-wide (gitignore patterns without a leading `/` match at any depth, so this also covers `server/.npm-cache*/`). No source file or directory in the repository begins with `.npm-cache`, so this cannot hide legitimate content.

3. **Not touched** (per task requirement 6, confirmed via `git status --short`): `package.json`, `package-lock.json`, `server/package.json`, `server/package-lock.json`, `node_modules`-related configuration, and all application source. `git diff main -- package-lock.json server/package-lock.json` is empty — lockfiles are byte-identical to `main`.

**Pre-existing, out-of-scope note:** the repository root `.gitignore` contains a pre-existing anomaly at line 17 (`. c o d e g r a p h /`, UTF-16-encoded text embedded inline in an otherwise UTF-8 file — visible as NUL bytes in a hex dump, which is why `git diff --check`/`diff` classifies the whole file as binary). This predates this task's change (confirmed identical in `git show HEAD:.gitignore`), is unrelated to npm caches, and was **not modified**, per the instruction to use targeted inspection only and not touch unrelated content. Worth a separate, narrowly-scoped follow-up.

---

## 6. Verification performed

| Check | Method | Result |
|---|---|---|
| Tracked-file removal complete | `git ls-files server/.npm-cache2 server/.npm-cache3` in the deliverable worktree | **Empty** — passes task requirement 7 |
| `git diff --check` (working tree) | Run in deliverable worktree | Exit 0, no whitespace errors |
| `git diff --cached --check` (staged) | Run in deliverable worktree | Exit 0, no whitespace errors |
| `git status --short` | Run in deliverable worktree | 148 × `D`, 1 × `M` (`.gitignore`) — no unexpected entries |
| Ignore rule takes effect | `git status --short --ignored` | Both directories now reported as ignored, not untracked |
| Windows worktree/checkout succeeds **after** the change | See § 4a below | **Pass** |
| `package-lock.json` integrity | `git diff main -- package-lock.json server/package-lock.json` | Empty — byte-identical, untouched |

### 4a. Post-change checkout verification (temporary, fully cleaned up)

Because the task requires stopping **without committing** the deliverable branch, the post-change checkout test was performed on a fully disposable branch, never merged into or left attached to `chore/remove-tracked-npm-caches`:

1. Created a temporary worktree + branch `tmp/verify-npm-cache-cleanup` from `main` at `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\_tmp-verify-npm-cache-src`.
2. Applied the identical change (same `git rm --cached`, same `.gitignore` edit) and made **one local-only commit** (`a6e7e03`, author `Verify Bot <verify@local>`) purely to give the checkout test something to check out.
3. Ran an independent `git clone --branch tmp/verify-npm-cache-cleanup --single-branch` of the local repo into a second temp path, `_tmp-verify-npm-cache-checkout` — this exercises a real, from-scratch Windows checkout of the post-change tree (not just a worktree pointer swap).
4. Result: clone succeeded (exit 0), 1,629 files checked out, `server/.npm-cache2` and `server/.npm-cache3` absent from the working tree, `git status --short` clean, `git ls-files server/.npm-cache2 server/.npm-cache3` empty.
5. **Cleanup:** deleted the clone directory, ran `git worktree remove --force` on the temp source worktree, and `git branch -D tmp/verify-npm-cache-cleanup`. Confirmed via `git worktree list` and `git branch --list "tmp/*"` that no trace remains. This temporary commit/branch never touched `main`, was never pushed, and no longer exists anywhere.

The deliverable worktree (`chore/remove-tracked-npm-caches`) was untouched by this verification side-track and still has HEAD at `91276dc7` (i.e., still `main`, no commit made) with the 148 deletions + 1 modification staged.

---

## 7. Rollback

Two layers, since this evidence now covers both the original staged-only state and the R1 rebaseline/commit:

- **Before commit (this worktree, uncommitted state):** discard entirely with:
  ```
  git worktree remove --force "D:\Mustafa\Siteler\DisKlinikCRM-worktrees\repo-hygiene-001-npm-cache-cleanup"
  git branch -D chore/remove-tracked-npm-caches
  ```
- **After commit (R1, § 9):** `git revert <commit-sha>` on `main` restores the 148 files to tracking (their content is still reachable from `0936867` and every commit since — `git rm --cached` never rewrote history) and reverts the one-line `.gitignore` change. No force-push or history rewrite is required in either direction.

---

## 8. Rollup answers (original staged-change analysis, § 0–6)

1. **Original main SHA:** `91276dc7f610ef6923e3c1a7572f0ebba578a2f7` (superseded — see § 9 for the current baseline)
2. **Tracked file count/size:** 148 files, 28,408,514 bytes (≈27.10 MiB) — 141 under `server/.npm-cache2/`, 7 under `server/.npm-cache3/`
3. **References found:** none. No `.npmrc`, script, or CI workflow reads from either directory (§ 3; re-verified against current `main` in § 9)
4. **Files removed (untracked):** 148, via `git rm -r --cached`; physical copies left on disk as an ordinary local cache
5. **Ignore changes:** root `.gitignore` line 12 changed from `.npm-cache/` to `.npm-cache*/`
6. **Worktree verification:** pre-change worktree checkout succeeded normally (no sparse-checkout fallback needed); post-change checkout verified via disposable temp branch + independent clone, then fully cleaned up (§ 4a); re-verified post-rebase in § 9
7. **package-lock status:** untouched, byte-identical to `main` at the time of the original analysis
8. **Tests run:** none required beyond the above (no repository configuration changed beyond ignore rules); `git diff --check` / `git diff --cached --check` both clean
9. **Migration/runtime impact:** none — cache directories are not referenced by any runtime, build, test, deployment, or CI path
10. **Commit safety:** superseded — the change has since been committed and pushed; see § 9

---

## 9. REPO-HYGIENE-001-R1 — Rebaseline and PR (2026-07-23)

The branch above sat on a stale `main` (`91276dc7`, 115 commits / 158 files behind current `main`). This section reconciles it onto current `main` and completes the commit/push/PR steps the original pass deliberately deferred.

### 9.1 Safety artifacts (created before touching anything)

Before any stash/rebase operation, the following were written **outside the repository** (scratch directory, never committed, contain no cache blob content in this evidence file):

- `staged.patch` — `git diff --cached --binary` of the full staged state (148 deletions + `.gitignore`)
- `unstaged.patch` — `git diff --binary` (empty; confirmed no unstaged changes existed)
- `evidence-doc-backup.md` — copy of this file as it existed pre-rebase
- `git-status-snapshot.txt` / `git-status-porcelain-snapshot.txt` — full `git status` output
- `branch-head-sha.txt` / `origin-main-sha.txt` — `91276dc7...` and `c522d61...` respectively

### 9.2 Overlap check

```
git diff --name-status HEAD..origin/main -- .gitignore server/.npm-cache2 server/.npm-cache3
```

Returned **empty** — current `main` never touched `.gitignore` or either cache directory since the original baseline (confirmed independently by content-hash comparison of the 148 target files: identical before and after). Safe to reconcile without conflict-resolution risk to the target paths.

### 9.3 Reconciliation method

1. `git stash push -u -m "REPO-HYGIENE-001-R1: pre-rebase safety stash ..."` — stashed staged (148 deletions + `.gitignore`), unstaged (none), and untracked (evidence doc) state.
2. `git merge --ff-only origin/main` — fast-forwarded `91276dc7` → `c522d61` (a straight fast-forward; `91276dc7` is an ancestor of `c522d61`, so no rebase conflicts were possible). `reset --hard` was deliberately avoided per task constraints even though the working tree was clean at that point.
3. `git stash pop` — restored the `.gitignore` edit and the untracked evidence file correctly, but **silently did not restore the 148 staged file deletions** (the index still showed all 148 files tracked, unchanged, after the pop). Root cause not fully isolated; the worktree reports `core.sparseCheckout=true` with no sparse-checkout pattern file present ("this worktree is not sparse" / "100% of tracked files present"), which is the leading suspect for the 3-way apply of the deletion hunks misbehaving. The stash's underlying commit (`fcc39e84...`, 3 parents: base/index/untracked) was independently verified via `git cat-file`/`git diff` to contain the correct 148-file + `.gitignore` diff before this was treated as a discrepancy, and was pinned under `refs/repo-hygiene-safety/pre-rebase-stash-backup` so it could not be garbage-collected.
4. Because the 148 target files were byte-identical between the old and new baseline (§ 9.2), the deletions were reconstructed directly and safely: `git rm -r --cached server/.npm-cache2 server/.npm-cache3`, then `git add .gitignore`. The resulting staged file list was diffed against the original `staged.patch` backup — **identical**, confirming no content drift and no unintended change.
5. Stash dropped only after this verification passed.

### 9.4 Post-rebase reconfirmation

- Staged: 148 deletions (141 under `server/.npm-cache2/`, 7 under `server/.npm-cache3/`) + 1 `.gitignore` line change (`.npm-cache/` → `.npm-cache*/`, confirmed via hex diff to be the *only* byte change — the pre-existing unrelated UTF-16 anomaly further down the file, noted in § 5, is untouched).
- Untracked: this evidence file only.
- Unstaged: none.
- `package.json`, `package-lock.json`, `server/package.json`, `server/package-lock.json`: not present in the staged diff (current `main` had already moved these independently of this branch; this branch does not re-touch them).
- Consumer-reference scan (§ 3) re-run against the post-rebase tree (which added 158 new/changed files, including new scripts and evidence docs): no `.npmrc` files, no `package.json`/`server/package.json` script references, no workflow references beyond GitHub Actions' unrelated built-in `setup-node` cache, no deployment/bridge script references to either directory.
- `git ls-files server/.npm-cache2 server/.npm-cache3` → 0 entries.
- `git diff --check` and `git diff --cached --check` → both exit 0, no whitespace errors.

### 9.5 Post-commit fresh worktree checkout verification

Performed **after** committing (§ 9.6), against the real commit on `chore/remove-tracked-npm-caches` — a normal, non-sparse `git worktree add` (no `--no-checkout`, no sparse-checkout config) to a fresh temporary path, confirming the branch checks out cleanly end-to-end with the cache directories absent. Temporary worktree removed afterward; `git worktree list` confirms no trace remains.

### 9.6 Commit, push, PR

Committed as a single commit (`chore(repo): stop tracking npm cache artifacts`) containing the 148 file deletions, the `.gitignore` change, and this evidence file; pushed to `origin/chore/remove-tracked-npm-caches`; PR opened against `main` (not merged — left for review). The commit SHA and PR URL are recorded in the task response delivered alongside this evidence, and are also discoverable via `git log -1` on this branch and `gh pr view` respectively.
