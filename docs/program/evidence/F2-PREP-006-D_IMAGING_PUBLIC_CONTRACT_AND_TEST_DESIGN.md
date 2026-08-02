# F2-PREP-006-D — Imaging Public Contract and Characterization-Test Design

**Status:** AGENT_COMPLETED / VALIDATION_PASSED / PR_OPENED_AWAITING_REVIEW
**Task:** F2-PREP-006-D — Imaging Public Contract and Characterization-Test Design
**Phase:** F2 — Modularization Preparation
**Parent:** F2-PREP-006 — Imaging Pilot Boundary Contract Definition
**Frozen wave baseline:** `4cb334d213b4dbbac4193f1a8c1878deddb55714`
**Branch:** `docs/f2-prep-006-d-imaging-contract-test-design`

## Non-authority statement

This document drafts a **candidate** public command/query/event contract and a **candidate** characterization-test catalogue for the Imaging domain (`IMG` + `BRG` per the F2-PREP-005 charter). **Nothing in this document is authoritative.** Every command, query, event, and test is marked `candidate`, never `accepted`. Final reconciliation across all F2-PREP-006 sibling discovery tasks (A/B/C/D) is owned exclusively by **F2-PREP-006-E**. This task did not read, merge, or depend on sibling branches A, B, or C, and does not update sibling status.

This task authorizes **no application code, no Prisma schema/migration changes, no test files, no workflow changes, no `dependency-cruiser` installation, no module extraction, and no caller migration.** It preserves the current KVKK physical-architecture freeze and does not modify the state of R-070 (OPEN), R-046 (OPEN), R-071 (CLOSURE_PROPOSED_AWAITING_EXTERNAL_CONFIRMATION), or G1/G2 (NOT_APPROVED).

## Inputs used

- **Accepted charter:** `docs/program/architecture/F2-PREP-005_CONSOLIDATED_MODULARIZATION_CHARTER.md` — Section 8 (pilot scoring), Section 9–10 (Imaging selected as primary pilot, boundary charter: owned models/commands/events, allowed inbound callers, forbidden direct access), Section 12 (dependency-cruiser POC approval scope), Section 14 (expand-migrate-contract discipline), Section 21 (recommendation ≠ approval).
- **F2-PREP-001** — `docs/program/evidence/F2-PREP-001_DOMAIN_OWNERSHIP_AND_BOUNDARY_INVENTORY.md` (ownership basis for the charter's owned-models list).
- **F2-PREP-002** — `docs/program/evidence/F2-PREP-002_CROSS_DOMAIN_DEPENDENCY_AND_DIRECT_ACCESS_MAP.md` (edges `IMG-01` through `IMG-14`, cited throughout below).
- **F2-PREP-004** — `docs/program/evidence/F2-PREP-004_MODULARIZATION_SEQUENCE_AND_PILOT_SELECTION.md` (test-coverage gap: "the domain's existing 5 test files are mock/unit-level only... add dedicated tests for the currently-unverified live-file-storage/live-DB paths" — this is the single largest driver of the `blocking` characterization tests below).
- **`docs/program/phases/F10_IMAGING_DICOM_AND_AI.md`** — confirms the current implementation is explicitly the pre-F10 baseline ("existing imaging/bridge work, status UNVERIFIED"); F10 itself (PACS integration, imaging AI) has not started in this codebase.
- Current Imaging routes, DTOs, service exports, tests, event/queue usage, and error/audit conventions — read directly from source at the frozen baseline (see `inspectedPaths` in the companion JSON).
- Explicitly **not** read: any `F2-PREP-006-A/B/C` branch or evidence file (none exist at the frozen baseline; confirmed by directory listing).

## Scope and CodeGraph discipline

Inspection was limited to the paths listed in the companion JSON's `inspectedPaths` — Imaging's own routes, schemas, services, tests, jobs, and Prisma models. Three scope expansions occurred, each triggered by a concrete import/reference and documented in `scopeExpansions`:

1. `routes/imaging.ts` explicitly names `routes/attachments.ts` as its own design precedent and duplicates its legal-hold redaction logic — read for comparison only, no attachments.ts contract drafted here.
2. F2-PREP-002 edge `IMG-09` groups `routes/notifications.ts` under the same dependency-map slice as Imaging, but its actual read target is `prisma.labWorkOrder` (a Labs-owned model) — read to confirm this caller is genuinely out of Imaging's contract surface (see test `CT-31`).
3. The Privacy-domain callers named as an accepted exception in the charter (`patientAnonymization.ts`, `orphanFileInspection.ts`, `deletionReviewInventory.ts`, `dataRetentionPolicy.ts`) were read to catalogue that exception precisely.

No project-wide scan was performed.

## Candidate commands

20 evidence-grounded candidate commands were drafted (full list, mappings, and per-command detail — input DTO, tenant/actor context, authorization, validation, idempotency, transaction expectation, audit, side effects, candidate events, errors, backward compatibility — are in the companion JSON's `candidateCommands` / `candidateCommandDetails`). Three are expanded in full detail in the JSON as representative examples: `CreateImagingStudy`, `IngestImagingStudy`, `SetImagingLegalHold`.

Every command name suggested by the task prompt was checked against real evidence and explicitly mapped as `SUPPORTED`, `PARTIAL`, `PARTIAL_ALTERNATE`, or **not backed by current evidence**:

- **Not currently supported, and not drafted as a real command:**
  - `RequestImagingProcessing` / `GetImagingProcessingResult` — no imaging AI/processing pipeline exists yet; this is F10 (`docs/program/phases/F10_IMAGING_DICOM_AND_AI.md`) future scope, currently status `TODO`.
  - `UpdateProcessingStatus` as a distinct "processing" concept — the closest real analog is `ImagingRequest.status` (requested → scheduled → received/cancelled/failed), which is already covered by `UpdateImagingRequest`/`CancelImagingRequest`.
  - `FinalizeImagingUpload` as a separate step — both upload paths (`CreateImagingStudy`, `IngestImagingStudy`) are single-shot; there is no register-then-finalize two-phase upload protocol today. Introducing one would be a real behavior change, out of scope for this draft.
  - `RequestSecureImagingAccess` as a token/descriptor-issuing command — no such descriptor is ever issued. Access is always a live, re-authenticated stream response (`StreamImagingImagePreview`/`StreamImagingImageDownload`), never a signed URL or access grant.
  - `ExportImagingEvidence` as an Imaging-owned command — imaging data export is Privacy-domain-owned today (`patientPrivacyExportPackage.ts`, `clinicBulkExportPackage.ts`), an accepted cross-domain read per the charter, not something this contract should claim ownership of.
- **Supported or partially supported**, with real route evidence: `CreateImagingRecord` → `CreateImagingRequest` + `CreateImagingStudy`; `RegisterImagingAsset` → `RegisterImagingDevice` (and, as an alternate reading, `RegisterImagingBridgeAgent`); `LinkImagingToEntity` → `LinkImagingStudy`/`UnlinkImagingStudy`; `UpdateImagingMetadata` → `UpdateImagingRequest`; `ArchiveImaging` → `ArchiveImagingStudy`/`UnarchiveImagingStudy`; `DeleteImagingAsset` → `DeleteImagingDevice`/`DeleteImagingBridgeAgent` (there is **no** delete for `ImagingStudy`/`ImagingImage` — originals are immutable by design, per the Prisma schema's own section comment); `RevokeImagingAccess` → `RevokeImagingBridgeAgent` (revokes a bridge credential, not a per-image access grant, since no grant model exists).

## Candidate queries

12 evidence-grounded candidate queries were drafted (full detail — input, output, tenant/RBAC rules, field minimization, pagination, caching restriction, audit/read-access requirement, errors — in the companion JSON's `candidateQueries`). Notably: **no query in the current system is paginated** (`ListPatientImaging`, `ListImagingRequests`, `ListUnlinkedImagingStudies` all return unbounded arrays) — flagged as a pre-existing, out-of-scope gap, not something this contract introduces or fixes.

## Candidate events

Exactly **one** candidate event is drafted: `ImagingStudyReceived`, sourced directly from the accepted charter (Section 10: "proposed, not yet implemented"). **No event bus, message queue, or outbox table exists anywhere in the Imaging codebase today** — confirmed by targeted search scoped to Imaging paths. No Kafka or new event platform is proposed, per governance constraints; mechanism selection (in-process call vs. an outbox table matching an existing program pattern) is explicitly left open and deferred to F2-PREP-006-E.

## Error contract

A single consolidated error contract (status codes 400/401/403/404/409/413/415/429/500 and what triggers each) is drafted in the companion JSON's `errorContract`, derived directly from the current route implementations — not invented. Notably: `404` is used deliberately in place of `403` for cross-tenant entity lookups (both for studies and for bridge-agent auth) specifically to avoid an existence oracle; this pattern must be preserved by any future contract layer.

## Idempotency rules

Three rules are documented in `idempotencyRules`. The most significant: `IngestImagingStudy` is idempotent per `(clinicId, ingestKey)` via a **defense-in-depth pair** — a fast pre-check read, and an authoritative Postgres `@@unique([clinicId, ingestKey])` constraint that catches races (`P2002`), with the race loser's just-written file deleted before it returns the winner's `studyId`. `CreateImagingStudy` (manual upload) is deliberately **not** idempotent — it has no `ingestKey` field, and `NULL` values never collide under the unique index.

## Characterization-test catalogue

31 candidate tests are drafted across all 13 required areas (tenant isolation, RBAC, upload/finalization, duplicate/idempotency, storage compensation, secure URL authorization, archive/deletion, audit, linked entity ownership, malformed metadata, retry/failure, backward compatibility, current direct-access callers) — full per-test detail (contract target, test level, infrastructure, fixture isolation, assertions, blocking status, existing-coverage note) is in the companion JSON's `characterizationTests`.

- **20 blocking**, **11 non-blocking**.
- The dominant driver of the blocking set is the gap F2-PREP-004 already identified: *"the domain's existing 5 test files are mock/unit-level only; no live-DB or live-file-storage verification exists today."* Every test in this catalogue that needs a disposable-Postgres and/or live-storage harness to actually characterize current behavior (uploads, idempotency races, storage compensation on failure, tenant isolation under real queries) is marked `blocking` — these must exist and pass **before** any refactor, per the charter's own sequencing (Section 14, item 3).
- Tests that only need to confirm behavior already exercised by the existing mock-level suite (RBAC role gates, Zod schema validation, no-PII-in-audit, no-public-URL) are marked `non-blocking` — they characterize, but do not gate, since equivalent coverage already exists at a lower fidelity.
- Two tests are structural regression guards with no live-server requirement: `CT-19` (static route-table check that no delete endpoint exists for `ImagingStudy`/`ImagingImage`) and `CT-31` (static import check that `routes/notifications.ts` never touches an Imaging-owned Prisma model directly).
- One test (`CT-29`) is a forward-compatibility placeholder tied to F2-PREP-004's own recommendation to eventually give `ImagingBridgePairingDevice` its own `clinicId`/`organizationId` column — not a defect in current behavior.

## Backward-compatibility requirements

Eight requirements are drafted in `backwardCompatibilityRequirements`, all derived directly from the accepted charter's Section 10/14: expand-migrate-contract only (never a simultaneous cutover); the charter's named allowed inbound callers (Patients read-only, Privacy's KVKK lifecycle exception) and forbidden-direct-access rule must remain exactly as they are today; `legalHoldReason` redaction and the never-a-public-URL streaming pattern must be preserved regardless of any future contract layer; this task explicitly does not claim to resolve `PZ-IMG-02` or `PZ-IMG-03`.

## Dependency-cruiser POC draft (report-only, not implemented)

A specification only — **no package installed, no config file added, no CI step wired**. Candidate allowed roots, forbidden edges, and an explicit allow-list (covering the Privacy KVKK exception and the shared `fileStorage.ts` infrastructure) are drafted directly from the charter's own Section 12 guidance, along with report format, false-positive review process, CI budget (reusing the existing `windows-bridge-pr.yml` path-filter precedent), a trivial removal path, and promotion criteria requiring at least one full report-only review cycle plus explicit program-owner approval before any blocking mode — which, even then, stays scoped to Imaging only. Full detail in `toolingPocDraft`.

## Assumptions, evidence gaps, and unresolved questions

Recorded in full in the companion JSON (`assumptions`, `evidenceGaps`, `unresolvedQuestions`). The most consequential:

- **No audit call was found in the `IngestImagingStudy` route handler**, unlike `CreateImagingStudy`'s explicit `auditImaging('imaging_study_uploaded')` call. This asymmetry is not explained by any document read for this task; F2-PREP-006-E should confirm whether it is intentional (bridge-volume reasoning) or a real gap.
- Whether `ExportImagingEvidence` should exist as an Imaging-owned command at all, or whether the contract should formally document imaging-data export as permanently Privacy-owned, is left open for F2-PREP-006-E to decide.
- The concrete mechanism for `ImagingStudyReceived` (no event infrastructure exists today) is explicitly not decided by this task.

## Next consolidation owner

**F2-PREP-006-E** owns reconciliation of this draft against siblings F2-PREP-006-A/B/C and any final acceptance decision. Nothing in this document is authoritative until that reconciliation occurs and receives program-owner approval.
