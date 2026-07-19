# F0-011 — Object Storage and Backup Migration Design

Task: F0-011 · Phase: F0 — Baseline, Program Control, and Architecture Validation
Status: `AGENT_COMPLETED` (documentation only; external review required before merge)
Baseline commit: `origin/main` @ `64b9edeb5e1e90f47aa85dfca0822fd8f61cbe26` (PR #179 merge commit, "docs(architecture): design queue and outbox PoC (F0-010)") — matches the program-status handoff instruction's stated known commit exactly; confirmed via `git fetch origin --prune && git rev-parse origin/main` at task start. **No baseline drift.**
Worktree: `D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-011-storage-backup-design`, branch `docs/f0-011-object-storage-backup-migration-design`
Primary worktree (`D:\Mustafa\Siteler\DisKlinikCRM`): not read, not modified — only `git status --short` / `git branch --show-current` / `git rev-parse HEAD` / `git worktree list` were run against it, before this worktree was created. It was observed to contain uncommitted KVKK-HIGH-008 work; that state was not inspected further.
Parallel task: F0-011-P1 (Active KVKK-HIGH-008 Work Baseline and Freeze Boundary) — separate worktree (`D:\Mustafa\Siteler\DisKlinikCRM-worktrees\f0-011-p1-kvkk-high008-baseline`, branch `docs/f0-011-p1-kvkk-high008-baseline`), observed only in `git worktree list` output; not read, not touched by this task.

> **Non-authorization statement (required, verbatim):**
> F0-011 defines object-storage, migration, backup, and restore evidence requirements only. It does not authorize a storage-provider selection, bucket creation, credential change, runtime storage implementation, schema or migration change, production file transfer, local-file deletion, backup configuration change, restore execution, DICOM/PACS implementation, or production deployment. Those actions remain blocked until the active architecture freeze conditions are explicitly released and the relevant ADR and operational gates receive evidence-based acceptance.

---

## 1. Purpose and scope

This document is a design specification for a future object-storage abstraction, local-to-object-storage migration, and backup/restore program — not an implementation. It is the evidence-gathering step ADR-008 (Object-storage abstraction, `ACCEPTED_WITH_CONDITIONS`) names as its own reevaluation trigger ("F0-011 design document exists, is reviewed, and a provider/data-residency decision is made" — `adr-foundation-review.md` §5.4) and the step ADR-013 (Backup, PITR, and DR, `DEFERRED`) names as the source of its RPO/RTO and DR-topology inputs.

It is bound by, and does not attempt to loosen, `docs/program/KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md`. Per that document's §2 row 16 ("Storage and attachment lifecycle"), the storage baseline is `MERGED` (KVKK-ATTACH-IMAGING-001, PRs #160/162/163), state `local-VPS-only (R-029)`, mutability `STABLE`, allowed parallel work explicitly scoped to **"F0-011 storage/backup design only"**, prohibited work explicitly scoped to **"storage-key migration, attachment physical-deletion redesign"** (already frozen program-wide). §2 row 18 ("Backup and restore") records current state `LOCAL_VPS_STORAGE, no offsite copy, PITR NOT_CONFIGURED, restore-test UNVERIFIED (R-030/R-031/R-032)`, allowed work **"F0-011 backup/PITR design only"**, prohibited work **"any live backup/PITR implementation"**. §4 restates: "Design work being allowed does not authorize implementation — F0-009/F0-010/F0-011 remain design-only tasks even after this document." This document does not change any of that.

Scope is documentation and design only: no file under `server/src/`, `server/prisma/schema.prisma`, `server/prisma/migrations/`, `src/`, deployment scripts, CI workflows, or environment files was touched to produce it.

## 2. Program status verified at task start

- F0-002 through F0-010: all `MERGED` (F0-002 PR #172 `db89b60c91666cb029c32757f171f227a643c79c`; F0-006 PR #173 `91276dc7`; F0-010 PR #179, this task's baseline). F0-011's two declared dependencies (F0-002 repository/deployment baseline, F0-006 production topology verification) are both `MERGED` — dependency-ready confirmed.
- ADR-008 (Object-storage abstraction): `ACCEPTED_WITH_CONDITIONS` (F0-008, 2026-07-19). Affirms `server/src/services/fileStorage.ts` and its tenant-scoped key convention (`buildStorageKey`) as the pattern to build on. Explicitly: "does not decide a storage provider, does not authorize a storage-key migration (explicitly frozen), and does not resolve R-029." Provider/data-residency selection is marked **NEEDS EXTERNAL VENDOR/LEGAL DECISION**, not a PoC question.
- ADR-013 (Backup, PITR, and DR): `DEFERRED` (F0-008, 2026-07-19). RPO/RTO targets and DR topology explicitly deferred to this task. Retention-period components marked **NEEDS EXTERNAL LEGAL DECISION** (`docs/compliance/53§16`, `56§15`).
- Four open risks name this task as their designated mitigation path: R-029 (local disk, no object storage, Medium/High, `OPEN`), R-030 (DB backup on same host as DB, no offsite copy, Medium/High, `OPEN`), R-031 (no PITR, `archive_mode=off`, Medium/High, `OPEN`), R-032 (no durable evidence a restore test was ever run, Medium/High, `OPEN`).
- Storage/backup implementation (as opposed to design) is blocked by the KVKK architecture freeze boundary (§3 items 8-10) independent of KVKK-HIGH-007/HIGH-008 status, and independent of ADR-008/013 status.
- `docs/program/phases/F4_STORAGE_AND_BACKUP.md` exists but is kickoff-era and thin; it names this document as its design input and does not itself attempt storage/backup design.

## 3. Current repository evidence — storage architecture summary

Full evidence and file:line citations: [`evidence/f0-011-storage-flow-inventory.json`](evidence/f0-011-storage-flow-inventory.json) (bounded coverage — see its own `generated_from.coverage_statement`). Method: targeted investigation of `server/src/services/fileStorage.ts`, `server/src/routes/attachments.ts`, `server/src/routes/imaging.ts`, `server/src/routes/imagingBridgePublic.ts`, `server/src/services/privacy/*`, `server/src/jobs/*export*`, and `server/prisma/schema.prisma`. No `.codegraph/` index exists in this worktree; investigation used Glob/Grep/Read directly (recorded per the task's CodeGraph-usage requirement).

**Headline facts:**

- **A mature, already-dual-mode storage abstraction exists.** `server/src/services/fileStorage.ts` (597 lines) is not a greenfield problem — it already implements local-disk and S3-compatible backends behind one interface, toggled by `isRemoteStorageEnabled()` reading `S3_BUCKET` (`fileStorage.ts:43`). This is a stronger starting position than a typical F0-level storage review finds, and materially changes this design's shape: the primary open question is not "how do we build an abstraction" but "which provider, what migration evidence, what backup/restore program."
- **Production is confirmed local-disk-only.** `PRODUCTION_TOPOLOGY.md` §6 (itself sourced from `F0-006_PRODUCTION_TOPOLOGY_EVIDENCE.md`) confirms storage mode `LOCAL_VPS_STORAGE`, path `/var/www/noramedi/server/uploads` (~3.1 MB observed), and `ENVIRONMENT_MATRIX.md` confirms `S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT` are all `MISSING` in production — described there as "the expected signature of intentional local-storage mode, not a partial/broken S3 configuration." Per this program's evidence-classification convention (`docs/program/evidence/README.md`: "repository capability is never treated as proof of production configuration"), the existence of working S3 code in `fileStorage.ts` is **not** evidence S3 is used in production, and this document does not treat it as such.
- **Object keys are already PHI/PII-safe by construction.** `buildStorageKey(clinicId, originalName)` (`fileStorage.ts:69-72`) produces `${clinicId}/${Date.now()}-${random}${ext}` — a server-derived clinic ID, timestamp, and random string; only the file extension is taken from user input. The original filename (which could contain a patient name) is stored in the database `originalName` column, never in the storage key. `isSafeStorageKey()` (`fileStorage.ts:148`) independently rejects absolute paths, `..` segments, and control characters on every lookup path. This is a materially stronger starting point than the task's key-design requirements (§"Object-storage abstraction design") would need to build from scratch.
- **No signed/presigned URL generation exists anywhere.** All attachment and imaging downloads are streamed through the Node API process, gated by session cookie + role + clinic scope (`attachments.ts:208-240`, `imaging.ts:748-800`), not by a cloud-issued time-limited URL. Bulk/privacy exports use a distinct, already-working bearer-token model instead (`crypto.randomBytes(32)`, only the SHA-256 hash persisted, atomic single claim, `expiresAt`) — this is the closest existing precedent for what a future presigned-URL-equivalent contract should preserve.
- **No physical-file deletion path is tied to KVKK anonymization.** `patientAnonymization.ts` redacts `originalName` to `'[ANONYMIZED]'` on `PatientAttachment`/`ImagingImage` rows and explicitly documents "physical file bytes are never touched — fileName/filePath are already non-identifying storage keys" (`patientAnonymization.ts:61-63`). A prior live-delete endpoint was **removed**, not hardened, because it deleted physical files/rows "with no workflow binding, no dry-run snapshot, no atomic DB+storage guarantee" (`deletionReviewInventory.ts:18-27`; corroborated `patientPrivacy.ts:683-689`). The only physical-file deletion path in the codebase today is the attachment `DELETE` route and the two export-cleanup cron jobs.
- **Backups exist for the database only.** `backupService.ts` (277 lines) wraps externally-provisioned artifacts (`BACKUP_DIR=/root/noramedi-backups`, `BACKUP_SCRIPT=/usr/local/sbin/noramedi-db-backup.sh`, cron unit `/etc/cron.d/noramedi-db-backup`) — none of which exist inside the repository; the service only shells out to them and validates results. `RETENTION_DAYS=7` is declared in the service, but its actual enforcement mechanism is external and unverified. A `runRestoreTest()` function exists (`createdb` → `pg_restore` → row-count sanity checks → `dropdb`) — a genuine, if unevidenced-as-exercised, DB restore-verification capability. **No file-tree backup implementation was found in the inspected storage, backup, attachment, imaging, export, and job paths** (`backupService.ts`, `fileStorage.ts`, `attachments.ts`, `imaging.ts`, `imagingBridgePublic.ts`, `services/privacy/*`, export-related jobs, and `PRODUCTION_TOPOLOGY.md`) — no repository-wide search was run, so this is a bounded finding, not a repository-wide absence claim (see §5 coverage statement for the areas this inspection did not cover). The backup directory is on the same host as the database (R-030); no offsite copy was found or supplied (treated as absent per the task's evidence rules); PITR is not configured (`archive_mode=off`, R-031); there is no durable evidence `runRestoreTest()` has ever actually been run (R-032).
- **Static serving of uploads is confirmed absent, and the absence is test-enforced.** No `express.static` call over any upload directory exists in `server/src`; the only match for the string is a regression assertion in `server/src/tests/imaging.test.ts:251` that explicitly checks the imaging route source does **not** contain `express.static`. This is unusually strong evidence for a "not statically served" claim — a deliberate, tested invariant rather than an absence of matching code.

## 4. Current production storage reality

Per the task's required verified/inferred/unverified distinction:

| Question | Answer | Evidence class |
|---|---|---|
| Is local VPS storage active in production? | Yes, `/var/www/noramedi/server/uploads`, ~3.1 MB observed | `VERIFIED_PRODUCTION_OBSERVED` (`PRODUCTION_TOPOLOGY.md` §6, sourced from F0-006 evidence) |
| Is S3-compatible storage configured or only supported? | Only supported — code path exists (`fileStorage.ts`), all three required env vars (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`) confirmed `MISSING` in production | `VERIFIED_PRODUCTION_OBSERVED` for absence; code support is `VERIFIED_REPOSITORY` |
| Is a production bucket/provider verified? | No — none exists | `VERIFIED_PRODUCTION_OBSERVED` (absence) |
| Are files inside or outside the application repository? | Outside — `uploads/` is a runtime directory under `process.cwd()`, not a tracked path; `/var/www/noramedi/server/uploads` on the production host is separate from the deployed application code | `VERIFIED_REPOSITORY` (code) + `VERIFIED_PRODUCTION_OBSERVED` (path) |
| Do uploads survive application deployments? | Not independently verified in this task; `uploads/` is outside `process.cwd()`'s deployed-artifact churn by construction (a redeploy that replaces application files would not touch a sibling data directory), but no deployment-cycle observation was performed | `INFERRED` |
| Are uploads included in server backups? | **Not confirmed.** `PRODUCTION_TOPOLOGY.md` §7 explicitly flags this as unverified; evidence (backup script paths, `backupService.ts` scope) points at database-only coverage | `UNVERIFIED_PRODUCTION`, leaning `INFERRED: NO` |
| Do filesystem backups exist? | No file-tree backup script/job/cron unit was found in the inspected storage, backup, attachment, imaging, export, and job paths, or in `PRODUCTION_TOPOLOGY.md` — bounded inspection, not a repository-wide search | `NOT_FOUND_IN_BOUNDED_SCOPE` |
| Do database backups exist? | Yes — cron-driven `pg_dump`-style backup to `/root/noramedi-backups`, 7-day declared retention | `VERIFIED_PRODUCTION_OBSERVED` |
| Do restore tests exist? | Capability exists (`runRestoreTest()`); no durable evidence it has ever been exercised | `VERIFIED_REPOSITORY` (capability) / `UNVERIFIED_PRODUCTION` (execution) — this is R-032 |
| Does PITR exist? | No — `archive_mode=off` | `VERIFIED_PRODUCTION_OBSERVED` (R-031) |
| Does off-site backup exist? | Not found, not supplied — treated as absent | `UNVERIFIED_PRODUCTION`, leaning `INFERRED: NO` (R-030) |
| Does backup encryption exist? | Not evidenced either way — the backup script itself is not in the repository | `UNVERIFIED_PRODUCTION` |
| Is backup retention defined? | Declared as 7 days in `backupService.ts`; enforcement mechanism (the external script) not in repository | `VERIFIED_REPOSITORY` (declaration) / `UNVERIFIED_PRODUCTION` (enforcement) |
| Does backup monitoring/alerting exist? | Not evidenced | `UNVERIFIED_PRODUCTION` |
| Do backups unintentionally include export/temp files? | Not evidenced either way — export temp files live under `os.tmpdir()`, outside both `uploads/` and the DB backup path, so no code-level coupling was found, but this was not independently verified against the (out-of-repository) backup script | `INFERRED: unlikely, not verified` |
| Is object-storage configuration represented in the environment matrix? | Yes — `ENVIRONMENT_MATRIX.md` explicitly lists `S3_BUCKET`/`S3_REGION`/`S3_ENDPOINT` as tracked-and-`MISSING`; however these vars are also absent from `server/.env.example`, so an operator following only the example would not discover them | `VERIFIED_REPOSITORY` |
| Are credentials in process environment or files? | S3 credentials, if ever configured, would be environment variables per `fileStorage.ts`'s reads (`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`); not applicable today since S3 mode is off | `VERIFIED_REPOSITORY` (design), `N/A` (production, mode off) |
| Is provider region/data residency verified? | N/A — no provider is in use | `N/A` |

**This document does not infer production S3 usage from environment-variable support**, consistent with the task's instruction and this program's evidence-classification convention.

## 5. Storage-flow inventory (bounded)

Full detail: [`evidence/f0-011-storage-flow-inventory.json`](evidence/f0-011-storage-flow-inventory.json). Coverage statement (restated from the JSON, see its own `generated_from.coverage_statement` for the authoritative version): this inventory covers every code path this task's mandatory CodeGraph-equivalent inspection found under `server/src/services/fileStorage.ts`, `server/src/routes/attachments.ts`, `server/src/routes/imaging.ts`, `server/src/routes/imagingBridgePublic.ts`, `server/src/services/privacy/*`, and the export-related jobs. It does **not** claim repository-wide completeness. Four areas are explicitly flagged `UNRESOLVED — would require broader scan`: (1) WhatsApp/Instagram/SMS message-media handling — targeted grep found no `fileStorage.ts` import in those service directories, but they were not read in full; (2) clinic logo/branding upload — no such feature was found, but this was a grep-level check; (3) email-attachment sending — not deeply read; (4) `imagingBridgePublic.ts`'s studies-upload handler (400+ lines) was not read in full, so its retry/idempotency/failure-state behavior is classified `AMBIGUOUS`. Any storage-shaped flow not named in the JSON should be treated as **unclassified**, not as "confirmed absent" or "confirmed safe."

Summary counts (full detail and per-flow fields in the JSON):

| Dimension | Breakdown |
|---|---|
| Total storage flows classified | 14 |
| By storage mode | `local_or_s3_dual` (abstraction-backed): 10 · `local_only_by_design_staging` (export temp buffer): 1 · `local_only_unabstracted` (DB backup): 1 · `not_found` (file-tree backup): 1 · `ambiguous` (imaging bridge ingest): 1 |
| By sensitivity | `VERY_HIGH` (imaging, clinic/patient exports, DB backup): 6 · `HIGH` (patient/lab attachments): 4 · `MEDIUM` (export cleanup jobs): 1 · `N/A` (control/gap-record rows): 3 |
| By backup coverage | `NOT_COVERED` (file bytes — attachments, imaging binaries, exports): 10 · `this_is_the_backup_mechanism` (DB backup itself): 1 · `N/A` (control/staging rows): 3 |
| By migration priority (proposed, not decided) | `HIGH`: 3 (patient attachments, imaging images, DB backup pipeline) · `MEDIUM`: 2 · `LOW`: 4 · `N/A` (control/gap rows): 5 |
| By confidence | `high`: 12 · `medium`: 1 · `low`: 1 (`AMBIGUOUS` imaging bridge studies upload) |

**Do not claim repository-wide completeness** — this inventory is explicitly bounded, as marked in both this section and the JSON's own `coverage_statement`.

## 6. Object-storage abstraction design

### 6.1 What already exists vs. what this design adds

`fileStorage.ts` already provides `saveFile`, `saveFileFromPath` (streaming/atomic-rename multipart-capable upload), `openFileStream`, `fileExists`, `statFile`, `deleteFile`, `buildStorageKey`, `buildExportStorageKey`. This is a substantial subset of the task's candidate operation list. The gap this design identifies, not implements:

| Candidate operation | Status today | Design note |
|---|---|---|
| `putObject` (`saveFile`) | Exists | — |
| `getObject`/`openReadStream` (`openFileStream`) | Exists | — |
| `deleteObject` (`deleteFile`) | Exists, idempotent | — |
| `deleteObjects` (batch) | **Missing** | Needed for migration contraction and bulk cleanup; today cleanup jobs delete one key at a time |
| `headObject`/`objectExists` (`statFile`/`fileExists`) | Exists | — |
| `copyObject`/`moveObject` | **Missing** | Required for the expand-migrate-contract design (§9) — backfill needs a non-destructive copy, not a client-side download+reupload |
| `generateDownloadUrl` | **Missing** — all downloads are proxied through the API process today | Open design question, §7.4 |
| `generateUploadUrl` | **Missing**, and not justified today — no evidence of a direct-browser-upload need; current upload path (multer memory-storage → `saveFile`) already validates MIME/size/magic-bytes server-side before any bytes reach storage, which a direct-browser-upload model would have to reproduce client-side or via a post-upload validation pass | Not recommended without a specific, evidenced latency/bandwidth problem |
| checksum calculate/verify | **Missing** as a first-class operation — `S3_FORCE_PATH_STYLE`/multipart path exists but no checksum field is persisted anywhere in the schema today | Required for migration verification (§10) and restore verification (§13) |
| `listObjects` (migration/admin only) | **Missing** | Required for reverse-orphan detection (`orphanFileInspection.ts` already documents this exact gap, "would need a bounded, clinic-prefixed `ListObjectsV2`, deliberately deferred") and for migration backfill enumeration |
| metadata update | **Missing** | Needed for retention/legal-hold tagging at the storage layer, if that model is chosen over DB-only legal hold (today legal hold is DB-only, `PatientAttachment.legalHold`) |
| multipart upload / abort multipart | Partial — `saveFileFromPath` uses `@aws-sdk/lib-storage`'s managed multipart uploader internally when S3 mode is on, but there is no abort-on-failure/cleanup path for an interrupted multipart upload | Needed for imaging/CBCT-scale files (§11) |
| health check | **Missing** | Needed as an observability primitive (§14) and as the input to local-fallback logic (§9 stage 9) |

### 6.2 Object key structure

The existing `buildStorageKey(clinicId, originalName)` → `${clinicId}/${Date.now()}-${random}${ext}` and `buildExportStorageKey(clinicId, exportId)` → `exports/${clinicId}/${uuid}.zip` conventions are affirmed as the pattern to extend, per ADR-008. This design proposes extending the prefix with an explicit domain segment for new key generation, without renaming or migrating any existing key (any such migration is frozen):

```
<domain>/<clinicId>/<yyyy>/<mm>/<opaqueId><ext>
```

where `<domain>` ∈ `{attachments, imaging, exports, lab-attachments}`, `<opaqueId>` is a `crypto.randomUUID()` (stronger collision resistance than the current `Date.now()+Math.random()` composite, which this design flags as a low-severity hardening candidate — not a defect, since collisions would be caught by the filesystem/S3 `PutObject` semantics, but a UUID is the more defensible primitive for a net-new key format). The `<yyyy>/<mm>` segment bounds `listObjects` page sizes for migration/admin tooling and lifecycle-rule scoping, at the cost of losing perfect flat-prefix locality — a tradeoff this design flags as a PoC measurement question (test matrix Experiment 19), not a settled decision.

**Object keys must not contain**, and — per the evidence in §3 — currently do not contain: patient names, national identifiers (TC kimlik), phone numbers, email addresses, diagnosis text, or treatment descriptions. This is a continuation of the existing invariant, not a new one.

**Metadata allowlist:** `organizationId`, `clinicId`, `domain`, `contentType`, `sizeBytes`, `checksumSha256`, `uploadedAt`, `legalHold` (boolean, mirrored from DB — DB remains authoritative), `retentionClass`. PHI/PII must not appear in object storage metadata any more than in the key itself — the original filename in particular (which the DB already isolates in `originalName`) must never be copied into object-store metadata.

**Original filename treatment:** stays DB-only (`originalName` column), as today. This is already correct and this design does not change it.

**Extension/MIME handling:** the existing extension-only-from-original-filename policy (`buildStorageKey`) plus server-side magic-byte validation (`isAllowedFileSignature`, attachments; `IMAGING_ALLOWED_MIME`, imaging) is affirmed. Content-type validation, max size (currently 10 MB for attachments, `MAX_FILE_MB` for imaging), and antivirus/malware scan hooks are addressed in §6.3.

**Path traversal prevention:** `isSafeStorageKey()` is affirmed as the enforcement point for any new lookup path; this design does not propose replacing it, only extending its coverage to any new operations added per §6.1.

### 6.3 Validation, scanning, and integrity requirements (design proposals, not implemented)

- **Antivirus/malware scan hooks:** not present today. This design proposes a scan hook point between multer's memory buffer and `saveFile()` — synchronous for attachments (10 MB cap makes inline scanning tractable), asynchronous/quarantine-then-promote for imaging (CBCT studies can be large; §11). No scanner product is selected by this document.
- **Checksum requirements:** every `putObject` should compute and persist a SHA-256 checksum alongside the object (mirrors the existing `ingestKey` sha256-based dedup already used for imaging bridge ingest, `schema.prisma:2475-2480` — this is not a new concept for this codebase, only a new place to apply it). Verification on every `getObject`/restore is a PoC measurement question (CPU cost, Experiment "checksum CPU impact").
- **Idempotency:** the imaging bridge's `ingestKey` (clinicId + sha256) dedup pattern is the strongest existing precedent and should be the template for any new idempotent-upload contract, rather than inventing a new one.
- **Correlation IDs:** no storage operation carries one today. This design proposes adding a `correlationId` to every storage operation's audit log entry (§14), threading through from the originating HTTP request or job run — mirroring the correlation-ID concept F0-010's outbox design already proposes for the same reason (traceability across an async boundary).

## 7. Tenant isolation design

### 7.1 Current state (evidence)

Every attachment/imaging route resolves org/clinic scope via `validateAndGetClinicIdScope` before touching storage, never trusting `req.user.clinicId` directly (`attachments.ts`, `imaging.ts`, consistent with the application-level tenant-scoping model ADR-002 already establishes). Object keys are clinic-prefixed by construction (`buildStorageKey`), so a leaked or guessed key still requires passing the same DB-row `findFirst` scoped by `organizationId`/`clinicId` before `openFileStream` is ever called — key guessing alone does not bypass authorization, because the DB row (not the key) is the authorization boundary. This is a materially better starting position than an unscoped-bucket design.

### 7.2 Design requirements for a future object-store-backed model

- **Object-key prefixing:** continues as the tenant-isolation mechanism at the storage layer, but is explicitly **not** the authorization boundary — the DB-row scoped lookup remains the authorization boundary, exactly as today. A future direct-object-store-access model (e.g. presigned URLs, §7.4) must not weaken this by making the key itself sufficient for access.
- **Application authorization before URL generation:** if presigned URLs are ever introduced, the authorization check (scoped `findFirst`) must happen before URL issuance, not be replaced by it — the same ordering the current stream-through-API model already enforces.
- **Signed URL TTL/audience/scope:** not applicable today (no signed URLs exist); if introduced, this design recommends short TTLs (minutes, not hours), scoped to a single object key, single download, matching the existing export bearer-token model's "atomic single claim" pattern rather than a reusable long-lived URL.
- **Cross-organization / cross-clinic-within-org denial:** already enforced by the scoped `findFirst` pattern; no change proposed.
- **Platform-admin/break-glass access:** not evidenced as existing for file storage specifically (distinct from the `platformAdmin.ts` pattern used elsewhere, e.g. restore-test triggering). A future implementation should require the same authorization + `writeAuditLogInTx` pattern F0-010's design already recommends for outbox replay, applied here to any admin-initiated storage access.
- **Service-to-service credentials:** N/A today (single API process talks to storage directly); relevant once a migration worker (§10) exists as a distinct process — that worker needs its own scoped storage credentials, not the API process's.
- **Bucket-level vs. prefix-level isolation, per-environment separation, test/production separation:** addressed in §7.3.
- **Storage access logging:** not present today beyond the existing `auditImaging` calls on imaging view (`imaging.ts:770`) and attachment audit entries. A future object-store-backed model should log every `getObject`/`putObject`/`deleteObject` at the storage layer (not just the application route layer) if the provider supports access logging, as a second, independent evidence trail.
- **Orphaned DB references / orphaned objects:** `orphanFileInspection.ts` already detects `dbRowPhysicalMissing` (DB row present, file missing) in a bounded, single-patient, dry-run mode. Reverse-orphan detection (object exists, no DB row) is explicitly not implemented and would need `listObjects` (§6.1) — this design names it as a required migration-and-ongoing-operations capability, not yet built.
- **Tenant deletion/export requirements:** the existing clinic bulk export (`clinicBulkExportPackage.ts`) is the closest precedent for a full-tenant data extraction; a tenant storage *deletion* capability (as opposed to export) does not appear to exist and is out of this task's scope to design (it would intersect the already-frozen "attachment physical-deletion redesign" boundary).

### 7.3 Bucket topology comparison

| Model | Fit for NoraMedi today | Adoption trigger |
|---|---|---|
| 1. Shared bucket, tenant-prefixed keys | **Recommended default**, directly extends the existing `buildStorageKey`/`buildExportStorageKey` convention; lowest operational burden; consistent with the "shared bucket with tenant prefixes" pattern the task itself frames as the baseline to compare against | N/A — default |
| 2. Bucket per environment (dev/staging/prod) | Recommended regardless of tenant-bucket strategy — this is an environment-isolation control, not a tenant-isolation control, and should be adopted independent of any per-tenant decision | Should be the first bucket-topology decision made, ahead of any per-tenant question |
| 3. Bucket per region | Not evidenced as needed — no multi-region requirement found in repository evidence; would only become relevant if data-residency requirements (§8) demand geographic separation beyond a single Turkey-resident provider | A named data-residency requirement mandating regional separation, evidenced by legal/contractual review |
| 4. Bucket per large/dedicated tenant | Not evidenced as needed today (single-clinic file volumes observed in the low-MB range, §3) | Proposed measurable trigger: a single organization's storage volume, request rate, or a contractual/legal requirement (e.g. a tenant's own data-processing agreement mandating storage isolation) exceeds what prefix-level isolation and per-tenant IAM scoping can practically bound — not a subjective "large customer" judgment |
| 5. Bucket per clinic | **Not recommended as a default**, per the task's explicit instruction. Would only be justified by the same per-tenant trigger as option 4, applied at clinic rather than organization granularity, and only for a clinic with a specific, evidenced isolation requirement (e.g. a contractual mandate) — not as a general pattern |

### 7.4 Presigned URLs: open question, not decided

Whether to introduce presigned/signed URLs (moving downloads off the API process's request/response cycle) is an open design question this document surfaces but does not resolve. Arguments for: reduces API-process bandwidth/memory pressure for large imaging files (§11); arguments against: the current stream-through-API model gives a single, auditable choke point for every download (every `openFileStream` call is already behind the scoped authorization check and, for imaging, an explicit audit log write) — a presigned-URL model moves that choke point to URL-issuance time and requires the TTL/audience discipline in §7.2 to preserve equivalent auditability. This is a PoC/future-implementation-task decision (test matrix Experiments 4-5), not decided here.

## 8. KVKK and data residency

- **Repository-verified:** production storage is currently entirely within Turkey by virtue of being on the existing VPS host (no evidence of any non-Turkey storage location today). This is a fact about the *current* local-VPS state, not a residency guarantee about any future object-storage provider.
- **Legal-policy-dependent (not resolved by this document):** whether a future object-storage provider must contractually and technically guarantee Turkey-only data residency, sub-processor disclosure, and support-access restrictions is a legal/compliance question. ADR-008's own review already marks provider selection **NEEDS EXTERNAL VENDOR/LEGAL DECISION** — this document does not resolve that, only enumerates what the decision must cover (§12).
- **Processor/subprocessor implications:** any object-storage vendor becomes a KVKK data processor; this requires a data-processing agreement and sub-processor disclosure review before any provider is authorized — not performed by this document.
- **Backup location requirements:** any future off-site backup destination (§10) is subject to the same residency review as primary storage — an off-site copy stored outside Turkey would need the same legal sign-off as a non-Turkey primary provider, not a lesser bar.
- **Replication-region restrictions:** not evidenced as decided; a future provider's multi-region replication feature (if any) must be explicitly scoped to Turkey-only regions or disabled, pending legal confirmation.
- **Support-access restrictions:** whether a provider's own support staff can access customer data (common in managed-service contracts) is a contractual question this document flags but does not resolve.
- **Deletion timelines vs. retention/legal hold conflicts:** `PatientAttachment.legalHold`/`legalHoldReason` already exists as a DB-level hold mechanism that blocks the only physical-delete path (the atomic `deleteMany({legalHold:false})` guard in `attachments.ts`). Any future object-store lifecycle rule (e.g. a bucket lifecycle policy) must not be able to delete an object whose DB row is under legal hold — this means lifecycle rules cannot be the sole enforcement mechanism; the DB-row check must remain authoritative, or the lifecycle rule must itself be driven by DB state rather than object age alone.
- **Encryption-key control:** addressed in §11.
- **Auditability:** existing `AuditLog`/`auditImaging` patterns are the baseline; §7.2 proposes extending them to storage-layer access logging.
- **Incident notification evidence:** out of scope for this document; would be covered by the existing `docs/compliance/55-kvkk-security-incident-response-foundation.md` process, extended to name a storage-provider-outage/breach scenario explicitly once a provider exists.
- **Data export requirements:** already substantially met by the existing clinic bulk export / patient privacy export flows; a future object-storage migration must preserve their current behavior, not regress it.
- **Anonymization vs. physical deletion:** the existing model (anonymize DB metadata, never touch file bytes, §3) is a deliberate, documented KVKK-side design choice (`docs/compliance/53-kvkk-attachment-imaging-lifecycle.md`) — this document does not propose changing it, and any future change to that model is explicitly inside the already-frozen "attachment physical-deletion redesign" boundary.
- **Residual copies in backups / restore implications for deleted-or-anonymized data:** this is the sharpest unresolved question this document surfaces (see restore scenario 16, §14) — because file bytes are never deleted on anonymization, a restore does not risk "reappearing" file content the way a hard-deleted record would. The DB-row anonymization state itself, however, could regress on a restore to a pre-anonymization backup — this is a genuine gap requiring reconciliation logic (§10, migration ledger) that does not exist today and is not authorized by this document.

## 9. Backup architecture design

Per-category comparison, as required:

### 9.1 PostgreSQL (category A)

| Option | Fit | Notes |
|---|---|---|
| Logical `pg_dump` | **Current state** (evidence-confirmed via `backupService.ts`'s wrapping of an external script) | Simple, portable, but full-database-only granularity and no PITR |
| Physical base backup | Not evidenced as in use | Would be the natural complement to WAL archiving (below) |
| WAL archiving / PITR | **Not configured** (`archive_mode=off`, R-031) | Required for any RPO tighter than the backup interval; currently the only recovery-point resolution is the backup schedule itself |
| Managed backup (provider-native) | N/A — self-hosted VPS Postgres, no managed DB service in use | Would require a platform migration decision out of this document's scope |
| Encrypted off-site backup | **Not evidenced** — backup directory is on the same host as the database (R-030) | Highest-priority proposed gap to close |

### 9.2 Object storage (category B)

| Option | Fit |
|---|---|
| Native versioning | Not applicable today (no object storage in production); a future provider decision should weigh versioning as a lightweight first line of defense against accidental overwrite/delete |
| Replication | Provider-dependent; must respect the residency constraints in §8 |
| Inventory | Provider-native inventory reports are a plausible low-cost input to the migration ledger's reconciliation step (§10) once a provider exists |
| Object lock / legal hold | Directly relevant to the legal-hold conflict noted in §8 — if the eventual provider supports object-level legal hold, it could become a second enforcement layer for `PatientAttachment.legalHold`, but DB state must remain authoritative per §8 |
| Lifecycle rules | Must be DB-state-aware or absent, per §8's legal-hold reasoning — a naive age-based lifecycle rule is explicitly not recommended without that safeguard |
| Backup to a secondary provider | Strongest durability model; highest operational/cost burden; a PoC/future-implementation question |
| No-secondary-copy model | Current de facto state (single local disk, no backup of file bytes at all) — explicitly the weakest option and the gap this document flags most strongly (no file-tree backup was found in the inspected storage/backup/attachment/imaging/export/job paths — bounded finding, see §5) |

### 9.3 Categories C-H (design notes only)

- **C. Local filesystem during migration:** the migration design (§10) requires the local `uploads/` tree to remain the source of truth and be backed up (at minimum via a one-time full inventory/checksum snapshot, §10 stage 1) before any backfill begins — today it is not backed up at all.
- **D. Configuration/secrets references:** any future object-storage credentials must follow the same environment-variable-only pattern `fileStorage.ts` already uses for S3 keys — never committed to the repository. This document does not change that.
- **E. Deployment metadata:** out of scope for this document; would be covered by a future deployment-runbook update once a provider is selected.
- **F. Audit evidence:** `AuditLog` retention/backup is implicitly covered by the existing DB backup (category A) since `AuditLog` is a Postgres table — no separate mechanism is proposed.
- **G. Imaging/DICOM data:** covered in §11; backup treatment follows category B/C, with imaging's larger file sizes as the key scaling consideration.
- **H. Export artifacts where legally required:** the existing export-cleanup jobs (§3) already delete export archives on a short TTL (1 hour for patient exports, per-clinic-export expiry for bulk exports) — this is a retention *floor* already enforced, not a backup requirement; whether any export artifact needs longer-term retention for legal reasons is a policy question this document does not resolve.

### 9.4 RPO/RTO and other proposals (business-approval-required, not authoritative)

All values below are **PoC proposals requiring business/legal approval**, not established targets:

| Parameter | Proposed value (PoC target) | Rationale |
|---|---|---|
| Database RPO | ≤ 24h now (matches current daily-equivalent backup cadence, unverified exact interval); ≤ 15 min once PITR is implemented | Closes R-031 |
| Database RTO | ≤ 4h | Matches typical single-VPS restore-from-dump timing order of magnitude; not measured |
| Object/file storage RPO | ≤ 24h once backup exists (currently effectively infinite — no backup exists) | Closes the file-tree-backup gap identified in §3 |
| Object/file storage RTO | ≤ 4h | Symmetric with database RTO |
| Backup frequency | Daily minimum for DB (current, unverified exact schedule); daily or continuous (via versioning/replication) for object storage once adopted | — |
| Retention tiers | Short (7-30 days, operational recovery), long (legal-hold-linked, indefinite while hold active) — mirrors the existing DB `RETENTION_DAYS=7` as the operational tier | — |
| Off-site requirement | Mandatory for both DB and object storage (closes R-030) | — |
| Immutable-copy requirement | Recommended for at least the most recent N daily backups (ransomware/accidental-deletion protection) | — |
| Restore-test frequency | Proposed monthly, automated, evidence-producing (closes R-032) | — |

## 10. Local-to-object-storage migration design

### 10.1 Staged expand-migrate-contract sequence (not authorized, not implemented)

| Stage | Content | Dependency | Rollback |
|---|---|---|---|
| 1. Inventory and checksum | Full enumeration of `uploads/` + SHA-256 checksum per file, cross-referenced against `PatientAttachment`/`LabOrderAttachment`/`ImagingImage` DB rows (closes the reverse-orphan gap `orphanFileInspection.ts` already flags) | This document | Discard the inventory; no production state touched |
| 2. Storage abstraction confirmed with local provider as default | No code change — `fileStorage.ts` already defaults to local mode; this stage is a verification step, not a build step | Stage 1 | N/A |
| 3. Dual-read, local-primary | Reads try local first, object-store as fallback (requires the object-store copy to exist first — sequenced after stage 6 in a strict reading; listed here per the task's template ordering, but this document flags stage 3 and stage 6 as logically coupled, not independently sequenceable) | Stage 2 | Disable dual-read flag |
| 4. Object-store shadow copy | Every new write also copied to object storage, DB continues pointing at local key | Stage 3 (flag infra) | Disable shadow-write; delete shadow copies |
| 5. Dual-write with idempotency | New writes go to both, keyed by the same idempotent key (extends the `ingestKey`-style sha256 dedup pattern, §6.3) | Stage 4 | Disable dual-write |
| 6. Backfill historical objects | Migration worker (new, isolated process — not the API process) reads stage 1's inventory, copies each file to object storage, records outcome in the migration ledger (§10.2) | Stage 5 | Halt worker; already-copied objects are additive, not destructive — no rollback needed for partial backfill |
| 7. Verification by checksum and metadata | Compare stage 1 checksums against object-store checksums for every migrated file | Stage 6 | Re-queue mismatches; do not proceed to stage 8 with unverified rows |
| 8. Object-store-primary reads | Flip read priority; local remains fallback | Stage 7, 100% verified | Flip back to local-primary |
| 9. Local fallback period | Observation window with object-store-primary, local-as-fallback-only, health-check-gated (§6.1 health check op) | Stage 8 | Extend fallback period or flip back |
| 10. Local writes disabled | New writes go to object storage only | Stage 9 clean | Re-enable local writes |
| 11. Observation period | Extended soak, no local writes, local reads only as emergency fallback | Stage 10 | Re-enable local writes |
| 12. Local data archived | Local `uploads/` tree moved to cold/offline storage, not deleted | Stage 11 clean + explicit approval | Restore from archive |
| 13. Local data deletion | **Only after legal/operational approval** — not proposed as a default outcome, and not authorized by this document under any circumstances | Stage 12 + separate explicit approval | N/A — this is the point of no return the design deliberately gates hardest |

**This document does not authorize any stage above.** No stage was executed to produce it.

### 10.2 Migration ledger design (fields only, not implemented)

Proposed fields, following this program's existing ledger-shaped precedents (`ClinicBulkExportArchive`'s status/failureCode model, `MessagingInboundEvent`'s attempt/idempotency-key model — both cited as direct precedents in F0-010's own outbox field design):

`sourcePath`, `destinationKey`, `organizationId`, `clinicId`, `modelType` (`PatientAttachment` | `LabOrderAttachment` | `ImagingImage` | `ExportArchive`), `recordId`, `sourceSize`, `sourceChecksum`, `destinationChecksum`, `status` (`pending`/`copying`/`copied`/`verified`/`failed`/`cutover`/`source_deleted`), `attemptCount`, `lastError`, `startedAt`, `copiedAt`, `verifiedAt`, `cutoverAt`, `deletedSourceAt`, `correlationId`, `workerId`, `legalHold` (mirrored from the source row at snapshot time — must be re-checked at deletion time, not trusted stale), `retentionClass`.

**Not implemented.** No table, migration, or code was created for this ledger.

### 10.3 Batch/execution properties (design requirements, not built)

- **Tenant-scoped execution:** backfill must be runnable per-organization or per-clinic, not only globally, so a single tenant's backlog cannot block or be blocked by another's (mirrors the fairness reasoning F0-010's design already applies to its own worker pool, §7.8 of that document).
- **Idempotency:** re-running the backfill for an already-`copied`/`verified` row must be a no-op, keyed by the ledger's own status, not by re-derived state.
- **Concurrency/throttling:** must be bounded to avoid saturating either the source disk I/O or the destination provider's rate limits; exact bounds are a PoC measurement question.
- **Retry:** failed copies retry with backoff, bounded attempt count, then land in an explicit failed/poison state (mirrors `inboundEventRetryJob.ts`'s existing pattern, cited in F0-010's design as the template).
- **Failure ledger:** the `status='failed'` + `lastError` fields above are the failure ledger; no separate table is proposed.
- **Metrics/stopping condition:** migration should halt automatically (not just alert) on a checksum-mismatch rate exceeding a threshold, or a tenant-isolation verification failure — either is treated as a stop-the-line condition, not a log line.
- **Backup requirement:** stage 1's inventory/checksum snapshot is itself the backup precondition — no backfill should begin without it.
- **Tenant/security verification:** every migrated object's key must be re-verified against `isSafeStorageKey()` and its `organizationId`/`clinicId` cross-checked against the source DB row before being marked `verified`.
- **Data reconciliation:** stage 7's checksum comparison is the primary reconciliation mechanism; §8's anonymization-state reconciliation question (has the source DB row been anonymized since the snapshot was taken?) must also be checked before cutover, not only at backfill time.

**Explicitly not recommended: a big-bang migration.** No stage above proposes migrating all tenants/domains simultaneously; every stage is designed to be tenant- and domain-scoped and independently haltable.

## 11. DICOM/CBCT and imaging storage strategy

Imaging is addressed separately from ordinary attachments per the task's instruction, because the evidence shows materially different scale and lifecycle characteristics:

- **Current state:** `ImagingStudy` is explicitly immutable in this codebase's design — status moves to `archived`, never hard-deleted ("tanısal veri hiç hard-delete edilmez" — schema comment, `schema.prisma:2450-2497`). `ImagingImage.filePath` is documented in-schema as "depolama anahtarı — asla public URL üretilmez" (a storage key, never a public URL). `ImagingBridgeAgent`/`Pairing`/`Binding` metadata explicitly never stores local device file paths, usernames, or MAC addresses — a deliberate minimization choice already in place.
- **Study/series identifiers:** exist as DB relations (`ImagingStudy` → `ImagingImage`); this document does not propose changing that model.
- **De-identification requirements:** not evidenced as implemented at the DICOM-tag level (only the application-layer key/filename minimization in §6.2 applies); whether DICOM header de-identification (patient name/ID tags embedded in the file itself, independent of the application's own metadata) is required is a clinical/legal question this document flags but does not resolve — this is a materially different risk than key-level PHI, since DICOM Part-10 files can carry PHI in their own headers regardless of how the application names the storage key.
- **Compression:** **this document does not propose lossy compression of original diagnostic images**, per the task's explicit prohibition. Any future compression strategy for thumbnails/previews (distinct from originals) is out of scope here.
- **Checksum/integrity, multipart/resumable upload:** covered by §6.1/§6.3's general checksum and multipart requirements; imaging is the primary driver for prioritizing the multipart-abort-cleanup gap identified in §6.1, given file sizes are plausibly larger than the 10 MB attachment cap (`MAX_FILE_MB` for imaging is a separate, imaging-specific limit — exact value not verified in this bounded pass).
- **Imaging bridge transfer / local device cache / failed-incomplete studies:** the imaging bridge studies-upload handler (`imagingBridgePublic.ts`) was not read in full in this task's bounded investigation and is explicitly flagged `AMBIGUOUS` in the inventory (§5) — its retry/resumability/idempotency behavior under a future object-storage backend is an open question requiring a targeted follow-up read, not resolved here.
- **Study deletion:** not supported today (conservative-retain, per §3) — this document does not propose changing that.
- **Provider egress cost:** a real consideration once a provider is selected (imaging is the highest-volume storage domain by design); not quantifiable without volume data this task did not gather.
- **Future PACS interoperability / DICOMweb compatibility:** explicitly out of scope — per ADR-011 (DICOM/PACS architecture, `ACCEPTED_WITH_CONDITIONS`), PACS is not built from scratch, and this document does not attempt to design one. Any future PACS/DICOMweb work is ADR-011's scope, phase F10, dependent on ADR-008 (this document's subject).
- **AI model access / temporary AI-processing copies / derived annotations:** not evidenced as existing today beyond the WhatsApp-embedded AI scope ADR-009 already bounds; if a future imaging-AI feature needs temporary derived copies, those copies should follow the same tenant-scoped, checksum-verified, TTL-bound pattern the existing export-temp-file mechanism (`EXPORT_TEMP_DIR`) already establishes, not a new ad hoc pattern.
- **Audit and patient-consent implications:** imaging views already write an audit log entry on every access (`auditImaging`, `imaging.ts:770`) — stronger than the attachment path's audit coverage. Any future object-storage-backed imaging access must preserve this, not regress to unaudited access.

**This document does not design or build a PACS from scratch**, per the task's explicit instruction.

## 12. Encryption and key management

| Requirement | Current state | Design note |
|---|---|---|
| TLS in transit | Assumed via existing HTTPS termination (not independently re-verified in this task; covered by F0-006's production topology evidence) | No change proposed |
| Provider-side encryption at rest | N/A today (no object storage in production); any future provider must support encryption-at-rest as a baseline requirement, not an optional add-on | Provider-selection criterion (§13) |
| Customer-managed keys | Not evidenced as required by any repository source; would be justified only by a specific legal/contractual requirement (e.g. a clinic's own data-processing agreement) | Not proposed as a default |
| Key rotation | N/A today; a future provider's credential rotation must not require a code deployment (credentials read from environment, per existing `fileStorage.ts` pattern) | Design requirement for any future provider integration |
| Key separation by environment | Not evidenced as implemented for storage credentials; should follow the same per-environment separation already recommended for buckets (§7.3) | — |
| Secret storage | Environment variables only, per existing `fileStorage.ts` convention — **encryption keys must not be placed in application source or database rows**, consistent with the task's explicit prohibition | No change proposed |
| Credential rotation | Same as key rotation | — |
| Least privilege | Not evidenced/decided; a future provider's IAM policy should scope the application's credentials to only the operations in §6.1 it actually needs, and a future migration worker's credentials should be separately scoped and time-bounded to the migration window | Design requirement |
| Presigned URL signing | N/A today (no presigned URLs exist, §7.4) | If introduced, signing key/credential handling follows the same environment-variable, least-privilege pattern |
| Audit logs for key/credential access | Not evidenced; provider-native audit trails (e.g. IAM access logs) should be treated as a second, independent evidence trail alongside application-level `AuditLog`, mirroring §7.2's storage-access-logging proposal | — |
| Backup encryption / encryption-key backup | Not evidenced for the existing DB backup (backup script not in repository); a future off-site backup (§9) must specify its own encryption approach and, critically, back up the encryption key separately from the encrypted data itself (a key lost with the data it protects is not a backup) | Explicit gap this document flags |
| Provider-admin access | Contractual question, tied to §8's support-access-restriction point | Not resolved here |
| Incident response | Covered by existing `docs/compliance/55-kvkk-security-incident-response-foundation.md`; a future storage-provider incident scenario should be added to that document once a provider exists, not designed here | — |

## 13. Provider alternatives (category comparison, not a selection)

| Category | Data residency | S3 compatibility | DICOM suitability | Operational burden | Lock-in | Notes |
|---|---|---|---|---|---|---|
| 1. Turkey-hosted S3-compatible provider | Best fit if verified Turkey-only | Typically yes (S3-API-compatible) | Adequate if large-object/multipart support confirmed | Low-medium (managed) | Medium (S3-API portability mitigates) | Requires named-vendor legal/contractual review before any selection — not performed by this document |
| 2. Global hyperscaler with Turkey/residency constraints | Requires a Turkey region and contractual residency guarantee, both unverified for any specific vendor by this document | Yes (native) | Strong (mature multipart, lifecycle, versioning tooling) | Low (managed) | Medium-high (feature lock-in beyond base S3 API) | Same legal/contractual review requirement as category 1 |
| 3. Self-hosted MinIO | Full control over residency (same VPS or a Turkey-hosted second host) | Yes (S3-API-compatible by design) | Adequate | **High** — self-operated durability, HA, patching, backup-of-the-backup-system itself | Low (open-source, portable) | Trades vendor dependency for operational burden; would itself need the backup/DR treatment this document specifies for any storage system |
| 4. Existing VPS local storage (status quo) | Best (already Turkey, already reviewed) | N/A — not S3-compatible without the abstraction already in place | Works today, no scale-tested imaging-specific evidence | Low incremental (already running), but **carries R-029/R-030/R-031/R-032's unresolved gaps as-is** | N/A (already the baseline) | Explicitly evaluated as an alternative, not dismissed by default — remaining on local storage while closing the *backup* gaps (§9) independent of any storage-provider decision is a legitimate interim outcome this document does not foreclose |
| 5. Hybrid (local cache + object store) | Depends on which tier holds primary residency-sensitive data | Yes, via the object-store tier | Plausible fit for imaging (local cache for active studies, object store for archive) | Medium-high (two systems to operate) | Medium | Closest fit to the staged migration design in §10, which is itself inherently hybrid during stages 3-11 |

**No provider is selected by this document.** Per ADR-008, provider selection needs a data-residency/vendor decision that is explicitly a legal/business input, not a PoC output.

## 14. Observability

Proposed metrics, logs, and alerts (none implemented — no observability standard exists yet in this program; ADR-012 is `DEFERRED`, and this document's proposals are inputs to that future ADR, not a substitute for it):

**Metrics:** upload/download success and failure rates; latency p50/p95/p99 per operation type; object size distribution; checksum mismatch count; orphan object count and orphan DB-reference count (both currently undetectable — reverse-orphan detection requires `listObjects`, §6.1/§7.2); migration backlog size and retry count (§10); backup success/failure and backup age; restore duration; signed-URL generation/use counts (if introduced); cross-tenant denial attempts (should be zero, alertable if not); delete failures; lifecycle-rule failures (if lifecycle rules are ever adopted); provider error rate; storage utilization; egress volume; local disk utilization (directly relevant given local storage's current unmonitored state — R-005 in the risk register already names local-disk-exhaustion as a risk); temp-file age (the existing `EXPORT_TEMP_DIR` sweep is a partial mitigation today, cron-based rather than metric-alerted); multipart-abandoned-upload count.

**Logs/alerts:** must not include PHI/PII, consistent with §6.2/§8's key/metadata minimization rules — a storage-operation log line should carry `organizationId`/`clinicId`/`objectKey`/`operationType`/`outcome`/`correlationId`, never `originalName`, patient name, or diagnosis text.

## 15. PoC / verification matrix

Full experiment specification (35 experiments): [`f0-011-storage-backup-test-matrix.md`](f0-011-storage-backup-test-matrix.md).

**This document does not authorize running any of these experiments.** They are the exact specification a future, separately-scheduled PoC task must execute, in a disposable environment, never production.

## 16. Acceptance criteria

### 16.1 Security/correctness — absolute, not negotiable

Zero cross-organization access; zero unauthorized cross-clinic access; zero PHI/PII in object keys (already true today per §3, must remain true for any new key format); zero checksum mismatch after verified migration; zero untracked privileged download; zero silent backup failure; zero restore-induced tenant leakage; zero reappearance of legally deleted/anonymized patient content without explicit reconciliation (§8's residual-copy question); all migration operations idempotent; all source deletions delayed until verification and approval (§10.1 stage 13 gate); all break-glass access audited.

### 16.2 Performance — PoC proposals, not established facts

Upload/download p50/p95/p99; throughput; multipart thresholds; migration objects/second and bytes/second; error/retry rate; local disk pressure; provider latency; restore duration; backup duration; checksum CPU impact; imaging transfer duration. **No numeric threshold is asserted as an established fact anywhere in this document** — every number in §9.4 is explicitly marked as a proposal requiring approval, and every item in this section is a PoC output, not a prior claim.

## 17. Freeze-boundary impact mapping

| Item | Freeze status | This document's relationship to it |
|---|---|---|
| This document itself (design, JSON inventory, test matrix) | Allowed now — `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §2 rows 16/18, §4, §6 | Fully compliant; documentation only |
| Storage-key migration | Frozen — §2 row 16, §3 item 8 | Not performed; §10's ledger and staged design are specifications only |
| Attachment physical-deletion redesign | Frozen — §2 row 16, §3 item 9 | Not performed; §8's anonymization-vs-deletion discussion is analysis only |
| Imaging storage lifecycle redesign | Frozen — §2 row 17, §3 item 10 | Not performed; §11 is analysis only |
| Any live backup/PITR implementation | Frozen — §2 row 18 | Not performed; §9 is design only |
| Provider selection, bucket creation, credential change | Not explicitly enumerated as a freeze-boundary row (no provider exists to freeze), but blocked by ADR-008's own `NEEDS EXTERNAL VENDOR/LEGAL DECISION` marking and by this task's own non-authorization statement | Not performed |

## 18. ADR-008 and ADR-013 status recommendation

Consistent with the same agent-authority limits F0-008/F0-009/F0-010 already applied (an agent can move an ADR to a documentary, not final, status), this task's recommendation, recorded in `ARCHITECTURE_DECISIONS.md` (see accompanying update):

- **ADR-008 (Object-storage abstraction): `ACCEPTED_WITH_CONDITIONS` → unchanged status, conditions refined.** This document is the design document ADR-008's own reevaluation trigger names ("F0-011 design document exists, is reviewed, and a provider/data-residency decision is made"). The design half of that trigger is now satisfied (this document); the provider/data-residency decision half remains genuinely unmet — that decision is legal/business, not a PoC output, and this document does not claim to make it. This task refines ADR-008's conditions with: the object-storage abstraction candidate operation gap analysis (§6.1), the object-key structure extension proposal (§6.2), the bucket-topology comparison and dedicated-bucket triggers (§7.3), and the provider-category comparison (§13) — all as evidence inputs to the still-pending external decision, not as the decision itself.
- **ADR-013 (Backup, PITR, and DR): `DEFERRED` → `NEEDS_POC`.** The RPO/RTO proposals (§9.4), backup architecture comparison (§9.1-9.3), and restore-scenario specification (test matrix) now exist, satisfying the "F0-011 design" half of the ADR's stated evidence gap. The retention-period legal-decision component remains separately unmet (external legal input required, per `docs/compliance/53§16`/`56§15`) and is not resolved by this document.

Both recommendations require external (ChatGPT/user) review before being treated as final program policy, per `NORAMEDI_MASTER_TRACKER.md` §2.2/§2.3 — this task, like every F0 task before it, can reach `AGENT_COMPLETED` but cannot itself accept an ADR status change as binding.

## 19. Unresolved questions (explicitly not answered by this document)

- Exact object key `<yyyy>/<mm>` bucketing tradeoff (§6.2) — a PoC measurement question.
- Presigned-URL adoption (§7.4) — an open design fork, not resolved.
- Imaging bridge studies-upload handler's retry/idempotency behavior (§11, F010-style `AMBIGUOUS` classification) — needs a dedicated future read of the full `imagingBridgePublic.ts` studies-upload handler.
- DICOM-tag-level de-identification requirement (§11) — a clinical/legal question.
- WhatsApp/Instagram/SMS media storage, clinic logo/branding upload, email-attachment storage — flagged `UNRESOLVED — would require broader scan` in §5; not confirmed absent, only not found by targeted inspection.
- Whether uploads are actually included in production backups — `UNVERIFIED_PRODUCTION`, leaning inferred-no (§4); needs direct production evidence, not repository inspection, to resolve.
- Exact retention periods, immutable-copy policy, and off-site provider selection (§9.4) — business/legal approval required.
- Provider selection itself (§13) — legal/vendor decision, explicitly not this document's to make.

## 20. Implementation blockers (restated)

1. `KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md` §2 rows 16/18 and §3 items 8-10 — storage-key migration, attachment physical-deletion redesign, and imaging storage lifecycle redesign frozen regardless of KVKK-HIGH-007/HIGH-008 status.
2. ADR-008's provider/data-residency decision requires external vendor/legal input this task cannot provide.
3. ADR-013's retention-period components require external legal input this task cannot provide.
4. No observability exists (ADR-012 `DEFERRED`) to produce the volume/latency baseline any future migration or backup-frequency decision should be informed by.
5. §5's four unresolved-scan areas mean this inventory, while bounded and evidence-backed, is not a certified complete map of every file-bearing flow in the repository.

---

**Non-authorization statement (restated):** F0-011 defines object-storage, migration, backup, and restore evidence requirements only. It does not authorize a storage-provider selection, bucket creation, credential change, runtime storage implementation, schema or migration change, production file transfer, local-file deletion, backup configuration change, restore execution, DICOM/PACS implementation, or production deployment. Those actions remain blocked until the active architecture freeze conditions are explicitly released and the relevant ADR and operational gates receive evidence-based acceptance.
