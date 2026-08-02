# F2-PREP-006-B — Imaging Data, Storage, Tenant and KVKK Boundary Assessment

**Phase:** F2 — Modularization Preparation
**Parent:** F2-PREP-006 — Imaging Pilot Boundary Contract Definition
**Frozen baseline:** `4cb334d213b4dbbac4193f1a8c1878deddb55714`
**Branch:** `docs/f2-prep-006-b-imaging-data-storage-kvkk`
**Type:** READ-ONLY ASSESSMENT / EVIDENCE ONLY — no application code, schema, migration, test, workflow, package, route, service, import, storage behavior, or runtime configuration was changed by this task.
**Status:** AGENT_COMPLETED / VALIDATION_PASSED / PR_OPENED_AWAITING_REVIEW

Machine-readable companion: [`F2-PREP-006-B_imaging_data_storage_kvkk.json`](F2-PREP-006-B_imaging_data_storage_kvkk.json).

This task is assessment/evidence only. It does not authorize module extraction, caller migration, or dependency-cruiser adoption, and it does not claim KVKK legal closure. All cross-task reconciliation (including with sibling tasks F2-PREP-006-A, -C, -D) is explicitly deferred to **F2-PREP-006-E**, which is the sole consolidation and current-status reconciliation owner. This document does not inspect, merge, or rely on any sibling task branch's content.

---

## 1. Scope and method

Per task governance, CodeGraph/search was used only within the targeted paths below, on an isolated worktree/branch created from the exact frozen baseline SHA (no `origin/main` merge):

- Imaging-related Prisma models identified via prior evidence (`F2-PREP-001_domain_ownership_inventory.json`, `F2-PREP-002_cross_domain_dependency_map.json`)
- `server/src/services/fileStorage.ts` (storage abstraction)
- `server/src/services/imaging/` (7 files: upload/release-metadata validation, request-transition rules, bridge pairing/token/onboarding/update config)
- `server/src/routes/attachments.ts`, `server/src/routes/imaging.ts`, `server/src/routes/imagingBridgePublic.ts`
- Imaging-adjacent privacy/export/anonymization/retention code (`server/src/services/privacy/*`) reached through concrete references
- Authorization/audit helpers concretely imported by the above (`server/src/middleware/auth.ts`, `server/src/middleware/platformAuth.ts`, `server/src/utils/clinicScope.ts`, `server/src/utils/auditLog.ts`, `server/src/utils/activity.ts`)
- Related tests (title/structure level)

**Three scope expansions** occurred, each forced by a concrete import and fully documented in the JSON (`scopeExpansions`):

1. `server/src/routes/platformAdmin.ts` + `server/src/middleware/platformAuth.ts` — followed to resolve the open PZ-IMG-03 question (F2-PREP-002 had marked the calling route for the backup service as "never located").
2. `server/src/services/fileBackupDestination.ts` — a static import of `fileBackupService.ts`, itself a storage dependency of `ImagingImage` via `FileBackupEntry`.
3. `server/src/services/security/securityDetectionRules.js` — identified as a dependency of `clinicScope.ts` (imaging's tenant-scope helper) but **deliberately not read**; flagged for the parent/consolidation task rather than expanded.

36 files/path-groups were inspected in total (`inspectedPaths` in the JSON); no project-wide scan was performed.

---

## 2. Model ownership classification (12 models)

| Model | Classification | Basis |
|---|---|---|
| `ImagingDevice` | IMG-owned | clinicId-scoped device catalog, Imaging Server/Viewer only |
| `ImagingRequest` | IMG-owned | clinicId-scoped clinical request; FKs to Patient/Appointment/TreatmentCase are outward references, not inbound ownership |
| `ImagingStudy` | IMG-owned | clinicId-scoped diagnostic study; owns `ImagingImage[]`; carries `legalHold` |
| `ImagingImage` | IMG-owned | clinicId-scoped storage-key reference row; inherits legal-hold from its study |
| `ImagingBridgeAgent` | BRG-owned | Device-bridge (Windows agent) principal, distinct sub-domain per F2-PREP-001 |
| `ImagingBridgePairing` | BRG-owned | One-time bridge onboarding flow |
| `ImagingBridgePairingDevice` | BRG-owned | No own clinicId — scope inherited via `pairingId` |
| `ImagingBridgeBinding` | BRG-owned | Device-to-agent binding created at pairing redemption |
| `PatientAttachment` | shared infrastructure | Patients-domain owned; shares storage/backup/anonymization infrastructure with Imaging but no Imaging code touches it directly |
| `LabOrderAttachment` | shared infrastructure | Lab-domain owned; appears only as a `FileBackupEntry.sourceModel` sibling |
| `FileBackupEntry` | shared infrastructure | Platform-wide, immutable backup ledger; `ImagingImage` is one of three source models |
| `FileBackupRun` | unresolved | Only seen as an FK target; fields not extracted in this pass (evidence gap) |

**IMG vs. BRG** follows F2-PREP-001's split of Imaging into "Imaging — Server Ingest and Viewer" and "Imaging — Device Bridge / Windows Bridge" as two sub-domains within the single modular-monolith Imaging boundary — this task does not propose separating them into different deployables.

---

## 3. Tenant scope: enforced, inherited, unverified

**Enforced** (direct evidence): every clinical route in `imaging.ts` and `attachments.ts` resolves `clinicId` exclusively through `resolveEffectiveClinicId()` or `validateAndGetClinicIdScope()` (`utils/clinicScope.ts:147-222`), which re-verifies the resolved clinic's `organizationId` against the authenticated user and checks `allowedClinicIds`. No route was found trusting a client-supplied `clinicId` without this re-validation. `imagingBridgePublic.ts` goes further: every route derives `clinicId` solely from the authenticated bridge-agent DB row (`agent.clinicId`), never from the request body. Storage keys (`fileStorage.ts buildStorageKey`) and backup destination keys (`fileBackupDestination.ts buildBackupDestinationKey`) both embed `clinicId` as a path segment, giving storage-level isolation independent of the DB check.

**Inherited**: `ImagingBridgePairingDevice` has no own `clinicId` — scope flows through `pairingId`. `ImagingImage.clinicId` is a direct field, but its consistency with the parent `ImagingStudy.clinicId` is an application-level assumption, not a DB constraint.

**Unverified**: `fileBackupService.ts iterateSourceRows()` scans `PatientAttachment`/`LabOrderAttachment`/`ImagingImage` across **all clinics** with no `clinicId` filter at the source-read layer — isolation for backups exists only at the destination-key level. Whether this is an intentional platform-operator design or an unreviewed gap was not resolved in this pass.

**No payload-controlled tenant-scope path was found** anywhere in the targeted scope.

---

## 4. Authorization and audit

- Role allowlists: `IMAGING_CLINICAL_ROLES` (OWNER/ORG_ADMIN/CLINIC_MANAGER/DENTIST/RECEPTIONIST) and the stricter `IMAGING_MANAGE_ROLES` (OWNER/ORG_ADMIN/CLINIC_MANAGER). BILLING and ASSISTANT never appear on any imaging route — test-confirmed via source-scan assertions.
- Legal-hold mutation on both `PatientAttachment` and `ImagingStudy` is restricted to OWNER/ORG_ADMIN only.
- `AuditLog` metadata for imaging events is deliberately PII-minimized (IDs/modality/counters only; filenames/patient names/UIDs excluded, test-verified). `writeAuditLog()` is fire-and-forget and silently swallows failures (`console.error` only) — audit-trail completeness is not guaranteed by construction.
- A **separate** table, `ActivityLog`, does carry original (user-supplied) filenames for `PatientAttachment` upload/delete — this does not receive the same PII-minimization discipline as `AuditLog`; filename PII exposure has not been assessed.
- Backup/restore authorization: the previously-unlocated calling route for `backupService.ts` (PZ-IMG-03, see §6) is `server/src/routes/platformAdmin.ts`, gated by a single-tier `authenticatePlatformAdmin` check with no role/tier field on the platform-admin principal, and no step-up re-authentication on the backup/restore routes specifically.

---

## 5. Storage, signed URLs, retention, export, anonymization, deletion

**Storage.** `fileStorage.ts` is the single abstraction for both attachment and imaging bytes (local disk or S3-compatible). `buildStorageKey()` embeds `clinicId` as the first path segment. `isSafeStorageKey()` blocks traversal/absolute-path/UNC injection (a prior Windows/Linux path-validation bug is documented as fixed). No checksum/integrity check exists on the primary upload path (only bridge-ingest dedup and backup copies compute checksums). No at-rest encryption logic exists in the application layer — any S3 SSE would be bucket-level infrastructure configuration, not confirmed in this pass.

**Signed URLs.** None exist. Access is exclusively per-request authenticated streaming (`authenticate` + `authorize(roles)` + tenant scope on every preview/download), an explicit, tested design choice documented in `imaging.ts`'s header comment ("images never get a public URL"). Responses set `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`, and every view is audited. A signed-URL / token-exchange contract would become a **future** requirement only if Imaging were ever extracted to a separate deployable — not a current gap.

**Retention.** `ImagingStudy` supports an `archived` status but originals are immutable by design — no delete endpoint exists; diagnostic data is retained indefinitely under current behavior. The applicable retention-policy text in `dataRetentionPolicy.ts` was not fully read (evidence gap).

**Export.** `patientPrivacyExportPackage.ts` (KVKK data export ZIP) references `PatientAttachment` but no reference to `ImagingImage`/`ImagingStudy` was found — imaging data does not appear to be included in the patient privacy export package. This is a grep-level finding, reported as probable, not certain (evidence gap).

**Anonymization.** `redactPatientImagingImages()` and `redactPatientAttachments()` perform **metadata-only** redaction (`originalName` -> `'[ANONYMIZED]'`); underlying image bytes are never touched. Redaction is skipped entirely when the parent record has `legalHold = true`.

**Physical deletion.** `PatientAttachment` has exactly one delete path (an atomic, TOCTOU-safe `deleteMany` guarded by `legalHold: false`, followed by physical file removal only after a confirmed delete). `ImagingImage`/`ImagingStudy` have **no** user-facing delete path at all — physical `deleteFile()` calls occur only as compensating cleanup on failed upload transactions. This matches the documented "conservative-retain by design, pending legal sign-off" posture already recorded elsewhere in the codebase (a prior live-delete endpoint was removed entirely, not hardened).

**Orphan cleanup.** Forward orphan detection exists (DB row present, file missing -> informational flag only, never triggers deletion). Reverse orphan detection (file present, no DB row) is explicitly not implemented.

---

## 6. Backup and PZ-IMG-03

`FileBackupEntry`/`FileBackupRun` are confirmed ledger-only tables (immutable, append-only audit trail). `fileBackupService.ts`/`fileBackupDestination.ts` contain zero authorization/RBAC logic themselves — all gating is external, at the calling route. That route, previously unlocated per F2-PREP-002's PZ-IMG-03 finding, is now identified as `server/src/routes/platformAdmin.ts` (lines 1553-1660), sitting behind a single `router.use(authenticatePlatformAdmin, csrfProtection('platform'))` applied once. The platform-admin principal carries no role/tier field, and no step-up authentication gates the backup/restore endpoints specifically.

**PZ-IMG-03 status: preserved as OPEN**, refined from "location unverified" to **"location resolved, authentication confirmed, RBAC granularity unproven."** Direct evidence proves single-tier authentication, not role-differentiated authorization — per task governance, PZ-IMG-03 is not closed without direct evidence of backup RBAC, and none was found. A confirmed, tested gap also shows deleting a source `PatientAttachment` row does **not** delete its `FileBackupEntry` row or destination object — backup copies can outlive source-row erasure or anonymization.

---

## 7. KVKK safeguards required (not a legal closure claim)

This assessment identifies safeguards the future Imaging boundary contract must preserve or add, without asserting legal sufficiency:

- Legal-hold as an audited, restricted-role control blocking both anonymization and deletion — already in place, should be preserved and formalized as an explicit cross-domain contract.
- Backup-erasure propagation — currently absent; must be characterized by legal/compliance before any closure claim, given the confirmed gap in §6.
- Anonymization completeness for imaging content (not just filename metadata) — a legal question this task cannot resolve.
- Export completeness — whether imaging must be included in a KVKK data-subject export.
- Backup RBAC (PZ-IMG-03) — role differentiation and step-up authentication for restore-capable operations.
- Audit-trail reliability — `writeAuditLog`'s fire-and-forget failure mode should be weighed against KVKK accountability expectations.
- `ActivityLog` filename exposure — should be assessed for incidental PII versus the deliberately PII-minimized `AuditLog`.

---

## 8. Risks (see JSON `risks` for full list, R1–R9)

Highest KVKK relevance: **R1** (backup copies outlive source erasure), **R2** (anonymization is metadata-only), **R4** (PZ-IMG-03 backup RBAC unproven), **R7** (ActivityLog filename exposure), **R8** (at-rest encryption unconfirmed), **R9** (imaging export-inclusion unconfirmed). Lower/no KVKK relevance: **R3** (backup source-scan not tenant-filtered — isolation relies on destination key), **R5** (silent audit-write failures), **R6** (`ImagingImage.clinicId` consistency is an application, not DB, invariant).

---

## 9. Evidence gaps (separate from the above findings)

- `dataRetentionPolicy.ts` and `patientPrivacyExportPackage.ts` were only grep-checked, not fully read.
- `fileBackupDestination.ts` encryption/SSE configuration not fully read.
- Object-storage bucket-level configuration (region, default encryption, versioning, lifecycle) is infrastructure, not visible to a code-only pass.
- `FileBackupRun` fields not extracted.
- `server/src/services/security/securityDetectionRules.ts` (cross-tenant denial signal logic) identified but not read.
- `LabOrderAttachment`'s own authorization path was not verified (out of primary Imaging scope).

Full detail, exact file:line citations, and the complete finding set are in the companion JSON.

---

## 10. Contract requirements for the future Imaging boundary contract

See JSON `contractRequirements` for the full list: an explicit `LegalHold` contract across `PatientAttachment`/`ImagingStudy`; a backup-erasure-propagation contract; a backup-RBAC contract (blocking PZ-IMG-03 closure until met); a signed-URL/token-exchange contract for a hypothetical future separate-deployable state; a query contract for Imaging's outward Patient/Appointment/TreatmentCase references; a reverse-orphan-cleanup contract; an export-completeness contract; and a DB-enforced (not merely assumed) `ImagingImage.clinicId` == parent-study invariant.

---

## 11. Limitations and non-authorizations

This task does not: create application code; change Prisma schema/migrations; change tests, workflows, packages, routes, services, imports, storage behavior, or runtime configuration; implement dependency-cruiser; authorize module extraction or caller migration; or move Imaging out of the modular monolith. It preserves the active KVKK physical architecture freeze, R-070 OPEN, R-046 OPEN, R-071 CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION, and G1/G2 NOT_APPROVED — none of those statuses are touched by this task. It does not inspect, merge, cherry-pick, rebase onto, or rely on any sibling F2-PREP-006 task branch. Cross-task reconciliation of this evidence against F2-PREP-006-A/-C/-D is the explicit responsibility of **F2-PREP-006-E**.

---

## Validation performed

- JSON parses (`node -e "require('./F2-PREP-006-B_imaging_data_storage_kvkk.json')"`) — pass.
- Deterministic counts: 12 `relevantModels`, 12 `ownershipClassification` entries, 36 `inspectedPaths`, 3 `scopeExpansions`, 9 `risks` — all internally consistent between this document and the JSON.
- `git diff --check` — pass (see PR).
- No secrets, no absolute local filesystem paths, and only `docs/program/**` files changed — confirmed by `git status`/`git diff` scoped to this branch.
- No runtime, schema, migration, test, workflow, or package files were changed.
