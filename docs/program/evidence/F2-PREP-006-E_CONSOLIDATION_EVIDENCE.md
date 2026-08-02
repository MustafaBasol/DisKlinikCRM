# F2-PREP-006-E — Consolidation Evidence and Methodology

**Task:** F2-PREP-006-E — Imaging Boundary Contract Consolidation
**Phase:** F2 — Modularization Preparation
**Type:** Methodology/validation record for [../architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md](../architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md).

## 1. Pre-flight verification

Before any evidence was read, the following was independently verified (not assumed from the task brief):

```
git fetch origin --prune
git rev-parse origin/main
-> 46ba7b219002c8267bf127b39718efea091657b4

for sha in 38249af95f3975af1088e03c856c1443a034f517 5a90eb3edd3842d107825169423bb10db53ee403 \
           8e77f2fe4d82b9b6e5e1364e18c8a16bfba1711b 46ba7b219002c8267bf127b39718efea091657b4; do
  git merge-base --is-ancestor $sha origin/main && echo ancestor-OK
done
-> ancestor-OK x4

gh pr view 288 --json number,title,mergeCommit,state
gh pr view 289 --json number,title,mergeCommit,state
gh pr view 290 --json number,title,mergeCommit,state
gh pr view 291 --json number,title,mergeCommit,state
-> all state=MERGED, mergeCommit.oid matches the task-brief SHAs exactly:
   288 -> 46ba7b219002c8267bf127b39718efea091657b4 (F2-PREP-006-A)
   289 -> 38249af95f3975af1088e03c856c1443a034f517 (F2-PREP-006-B)
   290 -> 5a90eb3edd3842d107825169423bb10db53ee403 (F2-PREP-006-C)
   291 -> 8e77f2fe4d82b9b6e5e1364e18c8a16bfba1711b (F2-PREP-006-D)

git ls-tree -r --name-only origin/main -- docs/program/evidence/ | grep -i "F2-PREP-006"
-> confirmed all 8 evidence files exist on origin/main, including the exact filename
   F2-PREP-006-B_imaging_data_storage_kvkk.json (not "..._tenant_kvkk.json" as the task brief
   itself spelled it — see contradiction CTR-02 in the main document)
```

**A genuine initial miss, corrected before proceeding:** an early `ls docs/program/evidence/` on the *current checked-out branch* (not `origin/main`) returned no F2-PREP-006 files, which momentarily looked like the task's premise was fabricated. This was a tooling mistake (listing the wrong ref), not a finding about the repository — re-run against `origin/main` via `git ls-tree` confirmed all eight files exist, and `gh pr view` confirmed all four PRs are genuinely merged with exactly the SHAs the task brief supplied. Recorded here for transparency, not because it changed any conclusion.

## 2. Worktree creation

```
git worktree add <local-path-omitted> -b docs/f2-prep-006-e-imaging-boundary-consolidation origin/main
-> HEAD is now at 46ba7b2 (Merge pull request #288 ...)
```

Fresh, isolated worktree, sibling of every other worktree already listed by `git worktree list`. No F2-PREP-006-A/B/C/D worktree (`f2-prep-006-a-imaging-ownership-inventory`, `f2-prep-006-b-imaging-data-storage-kvkk`, `f2-prep-006-c-imaging-callers-transactions`, `f2-prep-006-d-imaging-contract-test-design`) was reused, entered, or read from directly — every sibling's content was read exclusively through its own merged file under `docs/program/evidence/` on `origin/main`, inside this new worktree.

## 3. Reading order and method

1. Read all four evidence packages (A, B, C, D) — both MD narrative and JSON companion for each — in full.
2. Read F2-PREP-005 (the charter these four discovery tasks all trace back to) in full, to have the accepted pilot boundary charter (§10) and cross-domain access policy (§11) as the authoritative pre-existing frame.
3. Read F2-PREP-002 and F2-PREP-004 for the origin of `F2-CC-14` and the origin of the 7-stage expand/migrate/contract pattern this task's stage sequence adapts.
4. Read `CURRENT_PHASE.md`, `NORAMEDI_MASTER_TRACKER.md`, `phases/F2_MODULAR_BOUNDARIES.md`, `evidence/README.md` to determine exactly what each already records for F2-PREP-006-A..D (finding: only A had appended entries to any of the four; B, C, and D each explicitly stated in their own text that they did not touch shared tracker/index/phase files, consistent with the wave's own "do not update sibling status" rule — this consolidation is therefore the first task to index B, C, and D at all).
5. Read `ARCHITECTURE_DECISIONS.md`'s ADR-015 entry to confirm no new ADR is warranted (contract syntax/versioning/enforcement is already an explicit, accepted, deferred-to-F2 decision point this contract operates inside, not a gap requiring a new ADR).
6. Read `RISK_REGISTER.md`'s R-070, R-046, and R-071 rows in full (each is several hundred words with dense change-history) to confirm — as every A/B/C/D document already asserted — that all three are general, program-level, migration/tooling/consent-scope risks with no Imaging-specific content, and therefore genuinely unaffected by this task's evidence.
7. Cross-compared A/B/C/D against each other and against the charter for factual/numeric agreement (ownership tables, edge IDs, F2-CC-14's original scope, BRG classification) and recorded every disagreement found as an explicit, numbered contradiction with a stated resolution (main document §2), rather than silently picking one source or leaving it unresolved.
8. Synthesized the accepted contract catalogue, characterization-test-gate reconciliation, and stage sequence directly from the union of A/B/C/D's own stable-ID'd findings — no new source-code reading was required, since all cited IDs (`OVL-*`, `DAV-*`, `SMB-*`, `SB-*`, `CT-*`, `F-*`) already carry exact file:line evidence in their originating document.

## 4. CodeGraph discipline

No CodeGraph tool call was made by this task. No project-wide scan was performed. No source-scope expansion beyond the documents listed in §3 was required — every contradiction found (§2 of the main document) was resolvable by direct textual comparison of the four evidence packages against each other and against the charter, without needing to re-read `server/src` source. This is recorded as a deliberate, evidenced choice, not an omission: A/B/C/D each already independently re-verified the relevant source at the shared frozen baseline with file:line citations, and this task's mandate is reconciliation of that evidence, not re-discovery of it.

## 5. Validation

```
node -e "JSON.parse(require('fs').readFileSync('docs/program/architecture/evidence/F2-PREP-006-E_imaging_boundary_contract.json','utf8'))"
-> parse OK

node -e "
const j=require('./docs/program/architecture/evidence/F2-PREP-006-E_imaging_boundary_contract.json');
console.log('commands', j.acceptedContractCatalogue.commandsAccepted, j.acceptedContractCatalogue.commands.length);
console.log('queries', j.acceptedContractCatalogue.queries.length);
console.log('tests', j.characterizationTestGate.totalTestsReconciled, j.characterizationTestGate.totalBlocking, j.characterizationTestGate.totalNonBlocking);
console.log('contradictions', j.contradictions.length);
console.log('stages', j.expandMigrateContractStages.length);
"
-> commands 20 20
   queries 14
   tests 32 21 11
   contradictions 5
   stages 8

git diff --check -> clean
git status --short -- docs/program -> only new/modified files, all under docs/program/**
git status --short -- server src .github package.json server/package.json -> empty
```

**Deterministic-count validation methodology:** every count cited in the main document's tables is the literal length of the corresponding JSON array, printed by the `node -e` commands above — the narrative and the JSON cannot drift out of sync with each other, consistent with the convention established by F2-PREP-002/-005/-006-A/-B/-C/-D.

**Unique stable IDs:** all `IMG-CMD-*`, `BRG-CMD-*`, `IMG-QRY-*`, `BRG-QRY-*`, `IMG-EVT-*`, and `CT-*`/`CTR-*` identifiers introduced or referenced by this task were checked by inspection for uniqueness within this task's own JSON — no ID collides with another ID in the same array. IDs inherited from A/B/C/D (`OVL-*`, `DAV-*`, `SMB-*`, `SB-*`, `FP-*`, `CR-*`, `BLK-*`) are reused verbatim, never renumbered, so cross-referencing back to the originating evidence file remains exact.

**Every accepted contract item is linked to evidence:** each of the 20 accepted commands and 12 pre-existing accepted queries cites its real route (file + line, inherited verbatim from F2-PREP-006-D's own `evidence` field); the 2 new queries added by the F2-CC-14 revision cite the exact direct-access finding they replace (`DAV-01`/`DAV-02`, `SB-01`); the 6 rejected items each cite the specific "not currently supported" reasoning already recorded in F2-PREP-006-D's own `assumptions`. No candidate item is accepted without a link back to its originating evidence.

**Every blocker is linked to source evidence:** `CR-03`/`BLK-02`/`FP-06` (F2-PREP-006-C), `CR-01`/`CR-02`/`BLK-01` (F2-PREP-006-C), `PZ-IMG-03` (F2-PREP-002 origin, refined by F2-PREP-006-B), the `ImagingBridgePairingDevice` tenant-column gap (F2-PREP-006-A `F-07`, corroborated by F2-PREP-004 and characterized by F2-PREP-006-D's `CT-03`/`CT-29`).

**Every migration stage is linked to accepted contracts/tests:** each of the 8 stages in the main document's §15 table and the JSON's `expandMigrateContractStages[]` names the specific contract items (`IMG-CMD-*`/`BRG-CMD-*`) and characterization tests (`CT-*`) that gate it.

**No candidate silently promoted:** the 6 rejected commands (§13 of the main document) demonstrate that not every candidate D drafted was accepted without justification.

**No contradiction left unresolved:** all 5 found (§2 of the main document) carry an explicit resolution.

**No A/B/C/D evidence file modified:** confirmed by `git status --short` scoped to `docs/program/evidence/` showing zero modifications to any `F2-PREP-006-A/B/C/D_*` file — only new files under this task's own naming (`F2-PREP-006-E_*`) and additive updates to the four program-control documents listed in the main document's §16.

**No absolute local filesystem path, no secret/token value:** confirmed by a manual read-through of both new documents and their JSON companion before finalizing this evidence record; every worktree path cited is either the repository-relative form or, where a local path would otherwise appear, spelled out as an illustrative example only (e.g. the worktree-creation command in §2 above, matching the convention already used by every F2-PREP-006 sibling task).

## 6. Limitations

- This task performed reconciliation only; it did not re-read any current `server/src` source file, since none of the five contradictions found required it (see §4).
- This task does not resolve `PZ-IMG-03`, the `windows-bridge/`/`bridge-agent/` relationship, or the `IngestImagingStudy` audit-call asymmetry — all three are explicitly forwarded, not decided, per the main document.
- This task does not authorize, schedule with a firm date, or begin any Stage 0–7 work. It defines the gate each stage must pass, nothing more.
- The characterization-test gate's new test (`CT-32`) is specified at the same level of detail A/B/C/D used for their own tests (behavior, level, infrastructure, fixtures, assertions, cleanup, CI layer, failure interpretation) but, like all 31 of D's own tests, is not implemented by this task — no test file is created or modified.

## 7. Output files

- `docs/program/architecture/F2-PREP-006-E_IMAGING_BOUNDARY_CONTRACT.md` (new)
- `docs/program/architecture/evidence/F2-PREP-006-E_imaging_boundary_contract.json` (new)
- `docs/program/evidence/F2-PREP-006-E_CONSOLIDATION_EVIDENCE.md` (this file, new)
- Additive updates to `docs/program/CURRENT_PHASE.md`, `docs/program/NORAMEDI_MASTER_TRACKER.md`, `docs/program/phases/F2_MODULAR_BOUNDARIES.md`, `docs/program/evidence/README.md`
