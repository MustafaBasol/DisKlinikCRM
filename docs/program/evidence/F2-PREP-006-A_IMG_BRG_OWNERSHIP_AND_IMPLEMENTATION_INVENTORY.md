# F2-PREP-006-A — IMG/BRG Ownership and Implementation Inventory

Status: `AGENT_COMPLETED` / `VALIDATION_PASSED` / `PR_OPENED_AWAITING_REVIEW`. Discovery/evidence only — no application code, Prisma schema/migration, test, workflow, package, route, service, or storage-behavior change is authorized or made by this task. Machine-readable companion: [F2-PREP-006-A_img_brg_inventory.json](F2-PREP-006-A_img_brg_inventory.json).

## 0. Governance context

- **Phase:** F2 — Modularization Preparation.
- **Parent task:** F2-PREP-006 — Imaging Pilot Boundary Contract Definition.
- **This task:** F2-PREP-006-A — IMG/BRG Ownership and Implementation Inventory (one of four parallel, independent discovery siblings F2-PREP-006-A..D; reconciliation is F2-PREP-006-E's job, not this task's).
- **Frozen wave baseline:** `4cb334d213b4dbbac4193f1a8c1878deddb55714` (merge commit of PR #287, `docs/f2-prep-005-consolidated-modularization-charter`).
- **Isolated worktree/branch:** created fresh from the exact frozen SHA above, branch `docs/f2-prep-006-a-imaging-ownership-inventory`. Confirmed via `git worktree add -b docs/f2-prep-006-a-imaging-ownership-inventory <path> 4cb334d213b4dbbac4193f1a8c1878deddb55714`; `git log -1 --format=%H` in the worktree returns the exact frozen SHA.
- **Wave rules honored:** no merge of `origin/main`; no read/merge/cherry-pick/inspection of any sibling F2-PREP-006-B/C/D branch or worktree; no sibling live-status update; no dependency-cruiser implementation; no module extraction or caller migration authorized; Imaging stays inside the modular monolith; KVKK physical architecture freeze, R-070 `OPEN`, R-046 `OPEN`, R-071 `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`, and G1/G2 `NOT_APPROVED` are all preserved, none touched by this task.
- **CodeGraph discipline:** targeted paths only (§1 of the task brief); no project-wide scan. Every scope expansion beyond the initial path list is logged with its trigger in the JSON companion's `scopeExpansions[]` and summarized in §2 below.

## 1. What this task read

**Inspected repository paths (server-side, at the frozen baseline):**
- `server/src/routes/imaging.ts` (1303 lines, 27 routes)
- `server/src/routes/imagingBridgePublic.ts` (606 lines, 5 routes)
- `server/src/services/imaging/` — all 7 files: `bridgeOnboardingConfig.ts`, `bridgePairing.ts`, `bridgeTokens.ts`, `bridgeUpdateConfig.ts`, `imagingRequestTransitions.ts`, `imagingUploadValidation.ts`, `releaseMetadataValidation.ts`
- `server/src/jobs/imagingBridgeOfflineJob.ts`
- `server/src/tests/imaging.test.ts`, `imagingBridgeOnboarding.test.ts`, `imagingBridgePairing.test.ts`, `imagingBridgeUpdate.test.ts`, `kvkkAttachmentImagingLifecycle.test.ts`
- `server/prisma/schema.prisma` — the 8 Imaging/Bridge models only: `ImagingDevice`, `ImagingRequest`, `ImagingStudy`, `ImagingImage`, `ImagingBridgeAgent`, `ImagingBridgePairing`, `ImagingBridgePairingDevice`, `ImagingBridgeBinding`

**Prior-task evidence read for grounding (per the objective that ownership must not be classified from path/filename alone):**
- F2-PREP-001 (`domain ownership and boundary inventory`) — full read of the `IMG`/`BRG` domain entries and the model-ownership table.
- F2-PREP-002 (`cross-domain dependency and direct-access map`) — full read of `IMG-*`/`PAT-*`/`INF-*`/`TX-*`/`F2-CC-*` edges touching Imaging.
- F2-PREP-004 (`modularization sequence and pilot selection`) — full read of the Imaging pilot rationale (§3, §7).
- F2-PREP-005 (`consolidated modularization charter`) — read of §10 (`Selected pilot boundary charter — Imaging`) and §20 (exact-next-task framing) to confirm this task's place in the program.

These four documents already establish that **`IMG` = "Imaging — Server Ingest and Viewer"** and **`BRG` = "Imaging — Device Bridge / Windows Bridge"** are the program's own working codes. This task independently re-derived the route/service/model inventory from the repository rather than re-stating those documents' conclusions, and only cites them where they are corroborated by this task's own direct evidence (noted per-item below).

## 2. Scope expansions (all documented, all triggered by a concrete finding)

| # | Expansion | Trigger |
|---|---|---|
| 1 | `server/src/index.ts` (3 lines only) | Confirm exact route-mount prefixes (`/api` vs `/api/public`) and authenticate-before/after ordering. |
| 2 | `server/src/schemas/index.ts` (imaging exports only, lines 533–671) | Every route file imports named Zod schemas from here; needed for DTO-ownership evidence. |
| 3 | `server/src/jobs/startBackgroundJobs.ts` (2 lines) | Confirm the offline job is actually registered at startup, not dead code. |
| 4 | `server/src/services/privacy/{clinicBulkExportConfig,deletionReviewInventory,orphanFileInspection,patientAnonymization}.ts` | `grep` hit for `prisma.imagingImage` outside the Imaging module — independently re-verifies F2-PREP-002's PAT-14/PAT-16/F2-CC-14 findings rather than merely citing them. |
| 5 | `server/src/tests/clinicBulkExport.test.ts`, `server/src/tests/dbVerification/fileBackupDbIntegration.test.ts` | Found incidentally touching Imaging models/routes while enumerating callers; recorded as incidental, not counted as dedicated Imaging tests. |
| 6 | `server/package.json` (imaging script names only) | Needed an exact, re-runnable command per test file. |
| 7 | `.github/workflows/windows-bridge-pr.yml` (path-filter + job-step lines) | Independently verify F2-PREP-004's CI-isolation claim and check which test scripts the job actually runs. |
| 8 | `windows-bridge/`, `bridge-agent/` (top-level directory listing only) | Confirm the external deployables exist; internals intentionally not scanned (out of targeted scope, consistent with F2-PREP-001's own limitation). |

No other path outside the original brief was read.

## 3. Route inventory (32 routes, reproduced by direct `grep`, not copied from prior evidence)

`grep -n "^router\.(get|post|put|patch|delete)\("` against `imaging.ts` returns exactly **27** matches and against `imagingBridgePublic.ts` exactly **5** — independently reproducing F2-PREP-001's own "1303 lines/27 routes" citation rather than trusting it.

Full per-route table (file, line, method, path, auth mechanism, models touched, owner candidate) is in the JSON companion's `routes[]` (32 entries, IDs `IMG-RT-01..19`, `BRG-RT-01..08`, `PUB-RT-01..05`). Summary:

| Owner | Count | Where |
|---|---|---|
| IMG | 19 | `routes/imaging.ts` — devices (4), requests (4), studies/images (11) |
| BRG | 8 | `routes/imaging.ts` — bridges (4), bridge-pairings (3), bridge-onboarding config (1) |
| BRG | 5 | `routes/imagingBridgePublic.ts` — heartbeat, studies (ingest), pair, bootstrap, update |
| **Total** | **32** | |

**Key finding:** 8 of `imaging.ts`'s 27 routes (30%) manage exclusively `BRG`-owned models (`ImagingBridgeAgent`, `ImagingBridgePairing`) and touch zero `IMG`-owned models. The file's name does not describe roughly a third of its own content.

## 4. Service/helper/adapter inventory

**`services/imaging/` (7 files, all read in full):**

| File | Owner | Consumed by |
|---|---|---|
| `bridgeTokens.ts` | BRG | `imaging.ts` (create), `imagingBridgePublic.ts` (verify) |
| `bridgePairing.ts` | BRG | `imaging.ts` (create), `imagingBridgePublic.ts` (redeem) |
| `bridgeOnboardingConfig.ts` | BRG | `imaging.ts` only |
| `bridgeUpdateConfig.ts` | BRG | `imagingBridgePublic.ts` only |
| `imagingRequestTransitions.ts` | **IMG** | `imaging.ts` **and** `imagingBridgePublic.ts` (cross-owner import, no facade) |
| `imagingUploadValidation.ts` | **SHARED (IMG+BRG)** — explicitly documented as shared in its own header comment | both route files |
| `releaseMetadataValidation.ts` | **SHARED INFRASTRUCTURE (generic)** — contains zero imaging-specific logic (URL/version/sha256/cert-thumbprint parsing) | `bridgeOnboardingConfig.ts`, `bridgeUpdateConfig.ts` (both BRG) |

**Route-local helpers** (not in `services/imaging/`, found by reading both route files in full — 13 total, see JSON `helpers[]`): the most consequential are `validateClinicalLinks` (IMG's pre-transaction FK-validation helper — the mechanism F2-PREP-004 credits for Imaging's "cleanest transactional profile" claim), `authenticateBridgeAgent` (BRG's entire device-trust boundary, with no existence outside this one route file), and `redactStudyLegalHoldReason` (an **exported**, KVKK-relevant redaction helper that lives in a route file, not a service).

**Adapters / shared infrastructure used but not owned by Imaging:** `services/fileStorage.ts`, `utils/fileSignature.ts`, `utils/filePreview.ts` — generic, consumed identically by both IMG and BRG routes. **External protocol integrations:** `windows-bridge/` (.NET, `NoraMedi.Bridge.sln`) and a separate `bridge-agent/` (Node/TS) top-level project both exist; this task confirms their existence only — their internal structure and the relationship between the two (successor/predecessor vs. two live integration modes) is **unresolved by this task's scope**.

## 5. Prisma model inventory (8 models, all read directly from `schema.prisma`)

| Model | Owner | Tenant scoping | Notable |
|---|---|---|---|
| `ImagingDevice` | IMG | `clinicId` direct | — |
| `ImagingRequest` | IMG | `clinicId` direct | explicitly a minimal placeholder per its own schema comment |
| `ImagingStudy` | IMG | `clinicId` direct | carries `bridgeAgentId` (BRG FK) + `ingestKey`; `@@unique([clinicId, ingestKey])` is the idempotency guarantee both the bridge-ingest route and its dedup path rely on; owns `legalHold`/`legalHoldReason` (KVKK, docs/compliance/53) |
| `ImagingImage` | IMG | `clinicId` direct | no `legalHold` of its own — inherits the parent study's; `filePath` is a storage key, never a public URL |
| `ImagingBridgeAgent` | BRG | `clinicId` direct | schema comment explicitly lists what must never be stored (Windows username, hardware serial, MAC, local paths, filenames, patient identity) |
| `ImagingBridgePairing` | BRG | `clinicId` direct | `codeHash` unique (HMAC, never plaintext) |
| `ImagingBridgePairingDevice` | BRG | **no `clinicId`/`organizationId` column** — only transitive via `pairingId` | independently reconfirms F2-PREP-004's own finding by direct schema read in this task |
| `ImagingBridgeBinding` | BRG | `clinicId` direct | local folder paths intentionally never stored server-side, per its own schema comment |

## 6. Test inventory

**5 dedicated Imaging/Bridge test files** (3,739 lines total): `imaging.test.ts` (1023, `test:imaging`), `imagingBridgeOnboarding.test.ts` (236, `test:imaging-bridge-onboarding`), `imagingBridgePairing.test.ts` (485, `test:imaging-bridge-pairing`), `imagingBridgeUpdate.test.ts` (512, `test:imaging-bridge-update`), `kvkkAttachmentImagingLifecycle.test.ts` (1483, `test:kvkk-lifecycle` — cross-domain, Privacy-owned but exercises IMG's legal-hold/redaction lifecycle directly). **2 incidental cross-domain test files** touch Imaging models in passing (`clinicBulkExport.test.ts`, `dbVerification/fileBackupDbIntegration.test.ts`) and are not counted among the 5 dedicated files. **7 total relevant test files** (5 dedicated + 2 incidental) is the JSON companion's `tests[]` array length; the deterministic inventory counts in §13 use this same 7.

**CI-coverage gap found:** `.github/workflows/windows-bridge-pr.yml`'s path filter includes `server/src/services/imaging/**` and `server/src/tests/imaging*.ts`, but its job step only runs `test:imaging`, `test:imaging-bridge-pairing`, `test:imaging-bridge-onboarding`, and `test:imaging-bridge-update` — **not** `test:kvkk-lifecycle`, even though a `services/imaging/**` change would be in scope for that test too (`kvkkAttachmentImagingLifecycle.test.ts` does not match the `imaging*.ts` glob). This is a gap this task observes and records; it is not fixed here (no workflow file may be changed by this task).

## 7. Cross-domain access (independently re-verified, not merely cited)

This task directly `grep`'d for `prisma.imaging` outside the Imaging module and then read each hit:

- `server/src/services/privacy/patientAnonymization.ts` — reads and updates `imagingImage` directly (metadata redaction via the patient's `ImagingStudy` rows).
- `server/src/services/privacy/orphanFileInspection.ts` — reads and updates `imagingImage` directly (`storageVerifiedMissingAt`).
- `server/src/services/privacy/deletionReviewInventory.ts` — reads `imagingImage` directly (read-only counts).
- `server/src/services/privacy/clinicBulkExportConfig.ts` — comment-only reference, no direct Prisma call found in this file itself.

This independently confirms F2-PREP-002's PAT-14/PAT-16/F2-CC-14 findings: Privacy's cross-domain access into `ImagingImage` is real, is documented as intentional KVKK-lifecycle behavior (not an accidental violation), and today has **no facade** — every one of these callers reaches the Prisma model directly. F2-PREP-002 already proposed a forward-looking `ImagingLifecyclePort`/`AttachmentLifecyclePort` contract for exactly this; this task corroborates the need without authorizing or scheduling it.

## 8. Duplicated logic (new finding, not previously documented at this level of detail)

Reading both upload/ingest handlers in full (`imaging.ts:559-689` and `imagingBridgePublic.ts:199-392`) shows they independently implement the **same skeleton**: validate file signature → save to storage → `prisma.$transaction` creating `ImagingStudy` + `ImagingImage` and conditionally advancing a linked `ImagingRequest` to `received` → delete-file rollback on failure → audit log. The bridge path adds ingest-key recomputation/dedup/`P2002`-race handling and an agent-status touch; the manual path adds request-driven patient/appointment/case link resolution. **No shared "ingest a study" function exists for either route to call** — this is genuine duplicated business logic, not merely similar-looking code, and the two copies have already drifted in minor ways (error-message wording, whether name-matching is attempted). A second, smaller duplication: `imagingBridgePublic.ts`'s `bootstrap` route returns a hardcoded `{ channel: 'stable', mandatory: false }` update-policy stub instead of calling the same `getBridgeUpdateConfig()` its own `update` route uses — a latent drift risk if the real policy's defaults ever change.

## 9. Is BRG an ACL, an adapter, shared infrastructure, or part of IMG?

The evidence does not support a single clean answer. `imagingBridgePublic.ts`'s own header comments assert explicit anti-corruption-layer properties for the **device-facing edge**: no PHI/token/filename ever logged, every rejection reason (revoked, expired, invalid) collapses to the same generic 401, no storage path or URL is ever returned to the untrusted caller, and ingest idempotency is content-addressed (`clinicId + ingestKey`) rather than trusting the caller's own identity claim. That half of BRG is a textbook adapter/ACL.

The **admin-facing edge** — `BRG-RT-01..08`, physically inside `imaging.ts` — is ordinary same-process CRUD, stylistically indistinguishable from IMG's own routes in the same file, and its ingest route (`PUB-RT-02`) directly writes `IMG`-owned models (`ImagingStudy`, `ImagingImage`) rather than staying confined to its own 4 models.

**Conclusion: unresolved combination, split by edge** — anti-corruption/adapter behavior at the external (device) boundary, ordinary domain logic at the internal (admin) boundary, both operating over the same 4 BRG-owned Prisma models. This task does not resolve which framing should win; that determination (and any decision to formalize the two edges as distinct sub-modules) is left to F2-PREP-006-E and/or a future, separately-authorized boundary-contract task.

## 10. Proposed IMG/BRG responsibility split (proposal only — not approved, not implementation-authorized)

- **IMG** would own `ImagingDevice`/`ImagingRequest`/`ImagingStudy`/`ImagingImage`, routes `IMG-RT-01..19`, and `imagingRequestTransitions.ts`; it would gain a named ingest application-service (replacing the §8 duplication) and a facade for Privacy's three existing direct-Prisma callers (§7) to move onto — mirroring F2-PREP-002's own `F2-CC-14` proposal.
- **BRG** would own `ImagingBridgeAgent`/`ImagingBridgePairing`/`ImagingBridgePairingDevice`/`ImagingBridgeBinding`, the device routes `PUB-RT-01..05`, the admin routes `BRG-RT-01..08` (today physically in `imaging.ts`), all 4 bridge service files, and the offline job; it would gain an extracted `authenticateBridgeAgent` module. `releaseMetadataValidation.ts` is flagged as a candidate for promotion to program-wide shared infrastructure rather than staying nested under BRG, since it contains no imaging-specific logic at all.
- Full detail (including every item's exact evidence citation) is in the JSON companion's `proposedImgBrgSplit`, `overlaps[]`, `missingPublicSurfaces[]`, and `unresolvedOwnership[]`.

**This section is directional only. No file move, module creation, dependency-cruiser rule, or contract implementation is authorized, scheduled, or recommended-with-a-timeline by this task.**

## 11. Findings summary (10 findings, full detail + evidence citations in JSON `findings[]`)

1. `imaging.ts`'s name does not match ~30% of its own content (BRG routes).
2. `imagingBridgePublic.ts` is correctly named for its own content but is not BRG's whole surface.
3. Study/image ingest logic is duplicated, not shared, between the two upload paths.
4. `releaseMetadataValidation.ts` is generic, not imaging-specific, despite its location.
5. `imagingUploadValidation.ts`'s IMG+BRG sharing is a positive, well-documented finding.
6. Privacy's cross-domain direct access into `ImagingImage` is real, bounded, and facade-less — independently reconfirmed.
7. `ImagingBridgePairingDevice`'s missing tenant-scope column is independently reconfirmed.
8. A CI-coverage gap: `windows-bridge-pr.yml`'s path filter includes `services/imaging/**` but its test step skips `test:kvkk-lifecycle`.
9. `redactStudyLegalHoldReason` is a de-facto public, KVKK-relevant symbol with no home outside a route file.
10. BRG's role splits cleanly into an ACL/adapter edge (device-facing) and an ordinary-domain-logic edge (admin-facing) — no single classification fits the whole.

## 12. Limitations

- No project-wide CodeGraph scan was performed; only the targeted paths listed in §1 plus the logged expansions in §2.
- `windows-bridge/` and `bridge-agent/` internals were not read (top-level listing only), matching F2-PREP-001's own stated limitation. The relationship between the two directories is unresolved.
- Frontend Imaging consumers (`src/pages/ImagingQueue.tsx`, `src/components/imaging/**`) were not independently re-scanned; this document defers to F2-PREP-001's own frontend enumeration since frontend paths are outside this task's targeted server-side scope.
- `server/src/services/fileBackupService.ts` (cited by F2-PREP-002's `INF-07` for read-only `ImagingImage` access) was not independently re-read in full by this task.
- Of the 32 routes, the two upload/ingest handlers, the pair/bootstrap/update handlers, and every local helper function were read line-by-line; the remaining CRUD-shaped routes were classified from path + imports + role-array context without a full line-by-line read, since doing so would not change any ownership or overlap conclusion.
- This task does not authorize, schedule, or recommend a timeline for any remediation. All proposals are for F2-PREP-006-E and/or a future, separately-authorized task to act on.

## 13. Validation performed

```
node -e "const fs=require('fs'); const p='docs/program/evidence/F2-PREP-006-A_img_brg_inventory.json'; const j=JSON.parse(fs.readFileSync(p,'utf8')); console.log(j)"
-> exit 0, object printed (taskId 'F2-PREP-006-A', frozenBaseline '4cb334d213b4dbbac4193f1a8c1878deddb55714', ...)

node -e "
const fs=require('fs');
const p='docs/program/evidence/F2-PREP-006-A_img_brg_inventory.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
console.log('routes:', j.routes.length);
console.log('services:', j.services.length);
console.log('models:', j.models.length);
console.log('tests total:', j.tests.length);
console.log('helpers:', j.helpers.length);
console.log('adapters:', j.adapters.length);
console.log('findings:', j.findings.length);
console.log('overlaps:', j.overlaps.length);
console.log('testCounts:', j.testCounts);
"
-> exit 0
   routes: 32
   services: 7
   models: 8
   tests total: 7          (5 dedicated Imaging/Bridge test files + 2 incidental cross-domain test files)
   helpers: 13
   adapters: 5
   findings: 10
   overlaps: 4
   testCounts: { dedicatedImagingTestFiles: 5, incidentalCrossDomainTestFiles: 2, totalRelevantTestFiles: 7, totalDedicatedLines: 3739 }

git diff --check -> clean
```

Only `docs/program/**` files are changed by this task (this document, the JSON companion, `docs/program/evidence/README.md`, and the relevant tracker/phase entries). No `server/`, `src/`, `.github/workflows/`, `prisma/`, or `package.json` file is touched.

## 14. Status separation

- **Agent completed:** yes.
- **Validation passed:** yes (JSON parse, deterministic counts, `git diff --check`, scope-restriction check — all above).
- **PR opened:** yes, against `main`, documentation-only.
- **Merged:** no.
- **F2 implementation authorized:** no.
- **Module extraction / caller migration authorized:** no.
- **dependency-cruiser implementation authorized:** no.
- **G1/G2:** unchanged, `NOT_APPROVED`.
- **R-070/R-046:** unchanged, `OPEN`. **R-071:** unchanged, `CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION`.
- **KVKK physical architecture freeze:** unchanged, active, untouched by this task.

Overall: `AGENT_COMPLETED` / `VALIDATION_PASSED` / `PR_OPENED_AWAITING_REVIEW`.

**Exact next task:** F2-PREP-006-E, after all of F2-PREP-006-A through -D's evidence is available. This task imposes no new requirement on F2-PREP-006-E beyond the proposals recorded in §10 and the JSON companion's `unresolvedOwnership[]`.
