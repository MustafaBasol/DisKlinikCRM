# F2-IMG-AUDIT-002-DECIDE — Bridge ActivityLog Machine-Actor Design Decision

**Phase:** F2 — Modular Boundaries and Public Contracts
**Task ID:** F2-IMG-AUDIT-002-DECIDE
**ClickUp:** 869efu8ce
**Mode:** READ-ONLY / ARCHITECTURE DECISION
**Date:** 2026-08-09 (R1 reconciliation/wording correction: 2026-08-09, PR #343, same PR, not yet merged)
**Branch:** `docs/f2-img-audit-002-decide`
**Task-start baseline:** `main` @ `abc7c040430df08c5c7b81b73c2dfd2bb26000b7` — the baseline the §1–§11 analysis below (schema read, consumer trace, precedent search) was actually performed against. This is **not** this PR's final base — see below.
**Final reconciliation baseline (R1):** `origin/main` @ `6a248ea1c359b2e86f39f9fff0b1d8577357fc10` — the exact PR #344 (`F2-STAGE3-IMPL-001-R1`) merge commit, independently re-confirmed via `git fetch origin main` / `git rev-parse origin/main`. This branch was reconciled onto that exact SHA with a normal `git merge` (no rebase, no force-push) to produce this PR's current head. **Intervening commits characterized:** `abc7c040..6a248ea` (`F2-CT-32-R2`/PR #342, `F2-STAGE3-IMPL-001`+`-R1`/PR #344) were independently diffed against `server/prisma/schema.prisma`, `server/src/routes/imagingBridgePublic.ts`, `server/src/utils/activity.ts`, `server/src/routes/dashboard.ts`, `server/src/routes/patientPrivacy.ts`, and `server/src/services/communicationConsent/legacyConsentCorrection.ts` — **zero changes** to any of them (empty diff). PR #344 migrated `patientAnonymization.ts`/`orphanFileInspection.ts` onto `ImagingLifecyclePort`, an unrelated Privacy/KVKK imaging-lifecycle surface; it did not touch `ActivityLog`, `AuditLog`, or the bridge ingest route. The schema/consumer/precedent evidence gathered in §1–§11 against the task-start baseline is therefore still accurate against this final reconciliation baseline — nothing here is re-litigated, only the base-SHA record and the wording corrections in §4/§6/§9/§11 below are new in this R1 pass.

No runtime code, Prisma schema, migrations, routes, or audit/activity behavior were read-modified or
changed to produce this document. This resolves the design question deferred by
[F2-IMG-AUDIT-001_BRIDGE_DUPLICATE_AUDIT_PARITY.md](F2-IMG-AUDIT-001_BRIDGE_DUPLICATE_AUDIT_PARITY.md)
§24 and characterized (not decided) by `F2-IMG-AUDIT-PREP-001_IMAGING_INGEST_AUDIT_ASYMMETRY_CHARACTERIZATION.md` (referenced by prior task briefs; not itself a committed file in this repository as of this reconciliation — its characterization is not relied on for any claim in this document, which independently re-derives the schema/consumer/precedent evidence in §2–§5 directly from source).

---

## 1. Question being resolved

Should `server/src/routes/imagingBridgePublic.ts` (a machine-actor ingest path — bridge devices
authenticate via a bearer token, not a `User` session) write to `ActivityLog` for bridge-originated
imaging studies, given `ActivityLog.userId` is a required, non-nullable `User` foreign key and the bridge
has no human user to attribute to?

## 2. Independent verification of PREP-001's schema claim

Re-read `server/prisma/schema.prisma` directly on current `main` (not trusted from the prior doc):

```prisma
model ActivityLog {
  id       String   @id @default(uuid())
  clinicId String
  clinic   Clinic   @relation(fields: [clinicId], references: [id])
  userId   String                                            // ← mandatory, non-nullable
  user     User     @relation(fields: [userId], references: [id])
  entityType String
  entityId   String
  patientId  String?
  appointmentId String?
  treatmentCaseId String?
  insuranceProvisionId String?
  action String
  description String?
  metadataJson String?
  ...
}

model AuditLog {
  id             String   @id @default(uuid())
  organizationId String
  clinicId       String?
  actorUserId    String?                                      // ← nullable
  actorRole      String?                                      // ← nullable
  action         String
  entityType     String
  entityId       String?
  metadata       Json?
  ...
}
```

Confirmed unchanged since PREP-001 and unaffected by the merged F2-IMG-AUDIT-001-FIX (which added an
`AuditLog` write only, no schema touch). `ActivityLog.userId` is a required FK; `AuditLog.actorUserId` is
nullable and already carries `null` for every bridge-originated row.

Confirmed `server/src/routes/imagingBridgePublic.ts` (current `main`) has **zero** references to
`logActivity`/`activityLog`/`ActivityLog` anywhere in the file (`grep` returned no matches). The route
does resolve a real `patientId` when `imagingRequestId` is supplied and open (`patientId:
request?.patientId ?? null`, line ~317) and passes it into `ingestImagingStudyCore` — so the "no ActivityLog
entry, even when a patient is resolvable" characterization in PREP-001 is still exactly accurate.

## 3. ActivityLog's actual current contract (verified from consumers, not inferred)

`server/src/utils/activity.ts` (`logActivity`) — writes are keyed by `entityType`
(`patient`/`appointment`/`treatment_case`/`insurance_provision`) with a mandatory `userId`, uses its own
separate `PrismaClient`/pool (cannot join a caller's `$transaction`), and swallows its own errors.

Verified consumers on current `main`:

| Consumer | File | What it does with `ActivityLog` | Requires non-null `userId`? |
|---|---|---|---|
| Clinic "recent activity" dashboard widget | `server/src/routes/dashboard.ts:151-165` | `findMany` with `include: { user: { select: firstName, lastName } }` — renders "who did this" | **Yes, structurally.** A Prisma `include` on a required (non-optional) relation returns the joined row for every result; there is no row where `user` is absent under the current schema. |
| Patient-detail "Recent Activity" / "Activity Timeline" UI | `src/pages/PatientDetail.tsx:299,364-375` | `getActivityActorLabel(log)` returns `t('systemActor')` (i.e. "System") only if `metadata.systemGenerated === true`, **else** falls through to `${log.user.firstName} ${log.user.lastName}` — a hard, unguarded property access on `log.user` | **Yes, functionally.** A row without a resolvable `user` (or without the `systemGenerated` metadata flag) throws in this render path. |
| KVKK per-patient data export (staff-initiated Data Subject Access flow) | `server/src/routes/patientPrivacy.ts:276-287,366` | `findMany({ where: { patientId, clinicId }, select: { id, action, entityType, description, createdAt } })` → returned as `activityHistory` in the export payload | No — `userId` itself is not selected/exposed in this payload, only row existence + description/action/createdAt. |
| KVKK clinic bulk export (`ACTIVITY_LOG_SELECT`) | `server/src/services/privacy/clinicBulkExportPackage.ts:1209-1215`, `clinicBulkExportFieldAllowlists.ts:156-168` | Streams `id, userId, entityType, entityId, patientId, appointmentId, treatmentCaseId, insuranceProvisionId, action, description, createdAt` per clinic, NDJSON | `userId` value **is** exported as a field, but the export itself does not require it be non-null at the query level — the *schema* enforces non-null at write time, not at export time. |
| Patient anonymization (KVKK erasure) | `server/src/services/privacy/patientAnonymization.ts:384-401` | Reads/redacts `description` text on existing rows scoped by `patientId`; never creates rows, never reads `userId` | No. |
| `dentalChart.ts`, `attachments.ts` | writers only (`activityLog.create`) | N/A (write paths, all human-session routes: `req.user!.id`) | N/A |

**Conclusion on Q1/Q2:** `ActivityLog`'s actual, currently-enforced contract is a **human-staff-attributed
clinic activity feed**, scoped to four specific patient-adjacent entity types, joined to `User` for
display at two separate UI call sites (one of which — `PatientDetail.tsx:374` — has an unguarded property
access that would throw, not silently degrade, on a row without a resolvable `user`). It is not designed,
today, as a sink for "every system/machine event" — no cron job, webhook ingest, or `OperationalEvent`
writes to it.

## 4. Is `AuditLog` already the correct machine-event sink? (Q3)

Yes, as the established bridge-event sink — this is not a design proposal, it is already how the bridge
behaves for every other event on this exact route. Post F2-IMG-AUDIT-001-FIX, all three ingest outcomes
(new study, sequential-duplicate, concurrent P2002-duplicate) write `AuditLog` rows with
`actorUserId: null`/`actorRole: null` (an explicit, nullable, already-modeled "no human actor" state),
scoped correctly by `organizationId`/`clinicId`, immutable, and indexed.

**On `AuditLog`'s authority — scoped correction (R1):** independent, pre-existing codebase documentation
at `server/src/services/communicationConsent/legacyConsentCorrection.ts:217-227` (unrelated feature, not
authored for this task) explicitly treats `AuditLog` as authoritative evidence **for that one flow** —
its own comment states "the correction row + AuditLog entry... the sole authoritative evidence" for a
legacy-consent-correction action, characterizing `ActivityLog` there as a "best-effort... operational
projection." That is a flow-specific statement about one feature's own evidence model, not a
codebase-wide invariant — this document does not claim `AuditLog` is *the* codebase-wide authoritative
compliance record. What the evidence actually supports, scoped precisely: (1) `AuditLog` is the
established bridge audit sink — every bridge ingest outcome already writes there, with correctly nullable
actor fields; (2) at least one other, unrelated flow in this codebase independently made the same
architectural choice (treat `AuditLog` as authoritative for its own evidence needs) for its own reasons.
Those two facts are corroborating precedent for Option A's soundness, not proof that `AuditLog` is
universally authoritative across every compliance surface in this repository — see §6a for the one
identified surface (per-patient KVKK export) where it currently is *not* the source read from.

This is corroborating, not conclusive, evidence (it was not cross-checked against `docs/compliance/**`,
which remains out of this task's authorized inspection scope). It is nonetheless a concrete, pre-existing
statement in the codebase about how this codebase treats `AuditLog`'s authority in at least one flow, and
it supports Option A as a reasonable, precedented choice — not as a claim that all KVKK/compliance
completeness concerns are thereby resolved (see §6a/§11).

## 5. Existing precedent for machine/AI-actor `ActivityLog` writes — found and evaluated (Q7 evidence)

A precedent for machine-originated `ActivityLog` entries **does** exist, discovered while tracing the
`PatientDetail.tsx:367` `metadata.systemGenerated` branch back to its writers:

`server/src/routes/whatsapp.ts:1349-1355`, `server/src/services/instagram/instagramAiConversationProcessor.ts:582-588`,
and `server/src/services/whatsapp/metaWhatsAppAiProcessor.ts:647-653` each define an identical
`getClinicSystemUserId(clinicId)`:

```ts
const getClinicSystemUserId = async (clinicId: string) => {
  const user = await prisma.user.findFirst({
    where: { clinicId, isActive: true },
    select: { id: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });
  return user?.id ?? null;
};
```

This resolves an **arbitrary real staff `User` row** (the first active user by role-then-creation-date
ordering — in practice, whichever role sorts first, commonly the clinic's owner/admin account) and uses
its id as `ActivityLog.userId` for AI/automation-generated events (WhatsApp/Instagram bot-created
patients, appointment requests, etc.), tagged with `metadata: { systemGenerated: true, ... }` so
`PatientDetail.tsx` can override the *display* label to "System" in that one screen. The dashboard widget
(`dashboard.ts:151-165`) has no equivalent override — a `systemGenerated` row still renders the borrowed
real user's actual name there.

**This is evaluated, not adopted, as precedent.** It is exactly the pattern this task's hard prohibitions
bar for the bridge ("reuse clinic owner," implicitly "reuse an arbitrary staff account") — a real human
identity is borrowed to satisfy the FK, which is a soft misattribution the codebase already carries as
technical debt elsewhere, only partially mitigated (one of two display sites) by a metadata flag. It
demonstrates that **no clean synthetic-actor or polymorphic-actor model exists in this codebase today** —
only this borrowed-identity workaround — which weakens, not strengthens, the case for extending
`ActivityLog` to the bridge: doing so cleanly would mean building the first real machine-actor model from
scratch (Options B/C/D), and doing so the same way WhatsApp/Instagram already do it would mean repeating a
pattern explicitly prohibited for this task and arguably worth its own separate remediation, not
replication. Recommend flagging this precedent for a future, separate architecture review; out of this
task's scope to change.

## 6. Would adding bridge to `ActivityLog` create noise without compliance value? (Q5)

Yes, for the general case, with one narrow, real exception (§7):

- The bridge ingest event is **already** captured in `AuditLog` (`imaging_bridge_study_ingested`,
  tenant-scoped, immutable) for 100% of outcomes as of F2-IMG-AUDIT-001-FIX. A second write to
  `ActivityLog` for the same event, using a borrowed or synthetic actor, would be a duplicate record of
  an event that already has an authoritative home — not new compliance evidence, just a second copy with
  weaker attribution semantics (either `null` — rejected by the FK — or a fabricated/borrowed actor —
  prohibited by this task).
- Most bridge ingests have **no** `patientId` at all (`request?.patientId ?? null` — only populated when
  the caller supplies an open `imagingRequestId`). `ActivityLog.entityType` values are keyed to
  patient-adjacent business entities; an unlinked bridge study would be an orphaned row with no
  `patientId`/`appointmentId`/`treatmentCaseId` relation populated, of no use to the two consumers that
  matter (dashboard feed, patient timeline) since neither the dashboard's clinic-wide feed nor the
  patient-scoped timeline would have anything meaningful to show for it beyond "a device uploaded a
  file," a fact already in `AuditLog`.
- Writing every device upload into the clinic-wide "recent activity" dashboard feed (`dashboard.ts`),
  attributed to a borrowed human account, actively **degrades** that feed's stated purpose — showing
  which staff member did what — by mixing in device traffic that no staff member performed.

## 6a. Two distinct KVKK surfaces — do not conflate (R1 clarification)

This decision's scope and this decision's compliance implication are two different things, and this
document previously did not separate them clearly enough. Stated explicitly:

1. **Bridge ingest audit capture** — the question this task (`F2-IMG-AUDIT-002`) actually decides: whether
   the bridge's own ingest event needs an `ActivityLog` write. It does not; it is already captured in
   `AuditLog` for 100% of outcomes (§4/§6). This part is fully handled by Option A.
2. **Per-patient KVKK data-subject export completeness** — a **separate, already-identified gap** (§7):
   `patientPrivacy.ts`'s per-patient export builds its `activityHistory` field exclusively from
   `ActivityLog`, never `AuditLog`. Because the bridge never writes to `ActivityLog` (by design, per this
   decision) and does write a real, resolvable `patientId` when `imagingRequestId` is supplied, a
   KVKK export for that patient will omit the bridge ingestion event that a manually-uploaded equivalent
   would show. This gap is **not created** by accepting Option A here — it already exists on current
   `main` — but Option A also does not close it.

**Therefore: `F2-IMG-AUDIT-002 = NO_ACTION_REQUIRED` resolves surface (1) only.** It must not be read, cited,
or summarized elsewhere in this program's documentation as "KVKK satisfied," "KVKK completeness resolved,"
or any equivalent blanket claim. Surface (2) remains open, tracked as the proposed follow-up
**F2-IMG-AUDIT-003** (§11) — a route/export-query-only fix, no `ActivityLog` schema or actor-model change
required to close it.

## 7. One real, narrow asymmetry found — not a machine-actor problem (Q6)

Independent verification surfaced a genuine gap, but it is **not** the gap F2-IMG-AUDIT-002 was framed
around, and it does **not** require an `ActivityLog` actor-model change:

When a bridge ingest **does** resolve a real `patientId` (via `imagingRequestId`), the manual-upload
equivalent (`server/src/routes/imaging.ts:738-748`) writes a patient-scoped `ActivityLog` row
(`action: 'create'`, `entityType: 'imaging_study'`, `patientId`) using the real `req.user!.id`. The bridge
path, for the identical logical event (a study now linked to that same patient's open imaging request),
writes nothing to `ActivityLog`. Since the staff-initiated KVKK per-patient export
(`patientPrivacy.ts:276-287`) builds its `activityHistory` field **exclusively** from `ActivityLog` (it
does not query `AuditLog` at all — confirmed by grep: neither `patientPrivacy.ts` nor
`clinicBulkExportPackage.ts` reads from `auditLog` for export content, only writes to it to log the export
action itself), a KVKK data-subject export for a patient whose imaging arrived via the bridge with a
resolved `imagingRequestId` will **omit** that ingestion event, while the same patient's manually-uploaded
study would appear.

This is real and worth tracking, but the fix does not touch `ActivityLog`'s actor model at all — it is a
KVKK-export **completeness** gap (the per-patient export reads the wrong/incomplete source for this one
entity type), not an ActivityLog-writer gap. See §11 for the proposed follow-up task, scoped to
`patientPrivacy.ts`/`clinicBulkExportPackage.ts` export queries only, with zero schema change.

## 8. Options considered (Q7)

| Option | Description | Evaluated |
|---|---|---|
| **A** | Keep machine bridge activity in `AuditLog` only; no `ActivityLog` write | **Accepted** — see §9 |
| **B** | Additive `actorType`/`actorId` polymorphic columns on `ActivityLog` | Rejected — see §10 |
| **C** | Dedicated `SystemActivity`/`Event` model | Rejected — see §10 |
| **D** | Explicit synthetic service-principal `User`-like identity | Rejected — see §10 |

## 9. Decision matrix

| Criterion | A: AuditLog only (status quo) | B: actorType/actorId | C: SystemActivity model | D: synthetic principal |
|---|---|---|---|---|
| Tenant isolation | Unaffected — `AuditLog` already `organizationId`/`clinicId` scoped, proven by F2-IMG-AUDIT-001-FIX's cross-tenant test | Requires new tenant-scoping proof on every existing `ActivityLog` reader (dashboard, patient timeline, both export paths) | New model needs its own tenant-scoping proof from scratch | `User.clinicId` already scoped, but a synthetic row still needs auth/role modeling to avoid becoming a privileged bypass account |
| KVKK/auditability | Bridge ingest capture already satisfied — `AuditLog` is the established bridge sink (§4). Per-patient KVKK export completeness is a **separate, not-yet-closed** gap (§6a/§7) — Option A does not itself satisfy it | No compliance gain over A; duplicates an already-audited event | Same — plus a third log table to reconcile during any future audit/export work | Same, plus misattribution risk if the synthetic identity is ever mistaken for a real accountable person |
| Actor attribution | Truthful: `actorUserId: null` correctly states "no human actor" | Truthful *if* implemented correctly, but no such implementation exists today (§5 shows only a borrowed-identity workaround, not a real polymorphic model) | Truthful, cleanest separation, but highest build cost for the least-justified need | **Not truthful** unless carefully scoped — a synthetic "user" is easy to later mistake for a real staff account (as §5's precedent already risks) |
| Immutability | Unaffected | Unaffected | Unaffected | Unaffected |
| Backward compatibility | Zero change | Every `ActivityLog` consumer (`dashboard.ts` include, `PatientDetail.tsx` unguarded `log.user` access, `clinicBulkExportPackage.ts` field allowlist, patient timeline) must be individually audited for null/synthetic-actor handling | New model has zero existing consumers to break, but zero existing consumers to reuse either | `PatientDetail.tsx:374`'s unguarded `log.user.firstName` access would need an explicit guard or the synthetic user needs real `firstName`/`lastName` values — either way, touches shared UI |
| Query compatibility | No change to any existing query | Every `where`/`include` touching `ActivityLog.userId`/`user` across 43 files with `logActivity` calls and the consumers in §3 is a candidate for review | New table, no query compatibility risk, but no reuse of existing `activityLog` indices/queries either | `User` table queries (auth, staff lists, permission checks) must exclude the synthetic row everywhere — high blast radius, easy to miss one call site |
| Migration complexity | **None** | Schema migration + backfill decision for 43 existing callers' historical rows (do they get a default `actorType`?) | New table + migration; no backfill needed (greenfield) but full new read/write surface | Schema migration to create the row safely (idempotent seed), plus every environment (dev/staging/prod/DR) needs the seed applied before first machine-actor write |
| Production rollback | N/A (no change) | Migration rollback must handle the interim data written with the new columns | New table drop is clean, but any code that started depending on it must roll back first | Removing the seeded user mid-flight orphans any `ActivityLog` rows already attributed to it (FK violates on delete, matching the exact non-nullable-FK problem this task exists to avoid) |
| Reporting impact | None | Existing reports must add "was this a real human?" branching wherever `ActivityLog` actor names are surfaced | Reports needing a unified "everything that happened" view must now query two tables | Reports risk **silently over-counting "staff activity"** unless every consumer is updated to exclude the synthetic row — a correctness regression, not just a UI nuisance |
| Storage growth | None beyond the existing `AuditLog` row already written | One row per bridge ingest, duplicating `AuditLog` | One row per bridge ingest, in a new table | One row per bridge ingest, indistinguishable in storage from real staff rows without the `systemGenerated`-style flag |
| Operational usefulness | `AuditLog` is already queryable via `/ops/audit-logs` (`Operations.tsx`) for this exact event | Marginal — same event, second location | Marginal — same event, third location, plus a new admin UI would eventually be wanted to view it | Marginal, and actively risks operational confusion (support staff seeing "Dr. X did this" when a device did it) |
| Future official integrations / AI / machine actors | `AuditLog`'s nullable `actorUserId`/`actorRole` already generalizes to any future machine actor (webhooks, cron, other bridges) with zero further schema change | Establishes a real pattern *if* eventually justified by a cross-cutting need — but that need has not been demonstrated; §5 shows the codebase's actual current answer to "how do machine actors show up in ActivityLog" is a borrowed-identity workaround, which B would not automatically fix unless the 43 existing callers were also migrated | Cleanest long-term answer *if* a genuine cross-cutting machine-activity-feed product need is ever confirmed — not evidenced today | Sets a precedent that is a strict regression from A: it reintroduces exactly the "who really did this" ambiguity AuditLog's nullable actor fields were designed to avoid |

## 10. Rejected options and why

- **B (actorType/actorId)** — no confirmed product/compliance requirement justifies retrofitting 43
  existing `logActivity` call sites and the four verified consumers in §3 for a need whose only concrete
  evidence (§7) is solvable without touching `ActivityLog` at all. Rejected per this task's explicit "do
  not recommend B/C/D without evidence" instruction — the evidence gathered supports A, not B.
- **C (dedicated SystemActivity/Event model)** — same reasoning; additionally, `OperationalEvent`
  (`schema.prisma`, referenced in `Operations.tsx`) already exists as a distinct "system-level operational
  events" model in this codebase, so a bridge-ingest event, if it ever needed a dedicated system-event
  home, has an existing candidate table to extend rather than a new one to invent — not evaluated further
  here since no evidence supports needing either.
- **D (synthetic service-principal identity)** — actively worse than the status quo on attribution
  truthfulness (§9), and the one existing precedent for "machine actor in ActivityLog" (§5) is a borrowed
  *real* identity, not a synthetic one, meaning D would be introducing a genuinely new pattern with no
  in-codebase example to de-risk it from, for a need not evidenced.

## 11. Accepted option and next steps

**Accepted: Option A — keep machine bridge activity in `AuditLog` only. No `ActivityLog` change.**

`F2-IMG-AUDIT-002 = NO_ACTION_REQUIRED` for the question as originally framed (bridge machine-actor
`ActivityLog` parity).

**Final decision — explicit summary:**

- `ActivityLog` is, and remains, a **human-staff activity-feed** table (§3): keyed to four patient-adjacent
  business entities, joined to `User` for display at two UI call sites, one of which throws on an
  unresolvable `user`.
- `ActivityLog.userId` is a **mandatory, non-nullable `User` foreign key** (§2) — confirmed unchanged on
  the final reconciliation baseline (`6a248ea1c359b2e86f39f9fff0b1d8577357fc10`).
- The imaging bridge (`imagingBridgePublic.ts`) is a **machine actor** — bearer-token authenticated, no
  human `User` session, no `req.user` to attribute a write to (§1).
- The existing WhatsApp/Instagram "borrowed real staff `User`" pattern (§5) is evaluated here as an
  **anti-pattern this decision does not adopt or endorse as approved precedent** — it is technical debt
  already present elsewhere in the codebase, not a template for the bridge.
- `AuditLog` **remains the bridge's audit sink**, unchanged, exactly as implemented by
  F2-IMG-AUDIT-001-FIX (`actorUserId: null`/`actorRole: null`, tenant-scoped, immutable) — see §4 for the
  precise, scoped basis for this (not a claim of codebase-wide authority).
- **No schema, migration, or runtime code change** is made or required by this decision (§12/§13/§16).
- **KVKK per-patient export completeness for bridge-linked imaging remains a separate, open, not-yet-closed
  gap** (§6a/§7), tracked as the proposed follow-up `F2-IMG-AUDIT-003` below — `NO_ACTION_REQUIRED` on this
  task does **not** mean that gap is resolved.

One narrowly-scoped, independent follow-up is proposed from the evidence in §7 — **not** a machine-actor
schema change:

**Proposed next task: F2-IMG-AUDIT-003 — KVKK per-patient export completeness for bridge-linked imaging
studies.** Scope: extend the per-patient export path (`server/src/routes/patientPrivacy.ts` and/or
`server/src/services/privacy/clinicBulkExportPackage.ts`) to also surface the `AuditLog`
`imaging_bridge_study_ingested` row(s) whose `entityId` matches an `ImagingStudy` linked to the exported
patient, so a KVKK data-subject export is complete regardless of ingest path. Route-and-export-query-only;
zero `ActivityLog` schema change; zero bridge-route change; zero new audit-write contract (reads an
already-written `AuditLog` field). This is a separate product/compliance decision in its own right (does
the export format need a new "source: bridge" section, or does it map into the existing `activityHistory`
shape?) and is explicitly **not** authorized or scoped by this decision — flagged for prioritization only.

## 12. Schema impact

**None.** No `ActivityLog`/`AuditLog`/`User` schema change is required or recommended by this decision.

## 13. Migration impact

**None.**

## 14. Rollback impact

**N/A.** No code or schema change was made by this task.

## 15. Files changed

| File | Change |
|---|---|
| `docs/program/evidence/F2-IMG-AUDIT-002_MACHINE_ACTOR_ACTIVITYLOG_DECISION.md` | Original (this document) + R1 wording/baseline correction (this pass) |
| `docs/program/NORAMEDI_MASTER_TRACKER.md` | R1 — additive top entry recording this reconciliation |
| `docs/program/phases/F2_MODULAR_BOUNDARIES.md` | R1 — additive status-line correction appended |
| `docs/program/evidence/README.md` | R1 — additive index row for this evidence file |
| `docs/program/CURRENT_PHASE.md` | R1 — additive; F2-STAGE3-IMPL-001/PR #344's existing top entry is not rewritten or regressed |

No runtime, test, schema, migration, or route file was modified in either the original pass or this R1
correction. Verified by `git status`/`git diff` scoped outside `docs/program/`: no changes.

## 16. Explicit exclusions (per task's hard prohibitions — none of the following were done)

`ActivityLog.userId` was not made nullable. No fake/SYSTEM/synthetic `User` was created. No existing
identity (clinic owner, bridge creator) was reused for a new write. No FK constraint was relaxed. No
polymorphic actor column was added. `prisma/schema.prisma` was not modified. No migration was created.
`server/src/routes/imagingBridgePublic.ts` was not modified. No audit behavior was changed.

## 17. Merge safety

Docs-only addition/correction under `docs/program/`. No code, schema, migration, or test file touched in
either the original pass or this R1 reconciliation — carries zero runtime risk by construction. No runtime
tests are required for a docs-only change.

## 18. Status (R1)

`F2-IMG-AUDIT-002-DECIDE = NO_ACTION_REQUIRED` (unchanged by this R1 pass — this correction fixes wording
and reconciles the PR against current `main`; it does not reopen or re-litigate the accepted Option A
decision). PR #343: `DOCS_ONLY` / `NOT_MERGED` / `NOT_DEPLOYED` / `NOT_PRODUCTION_VERIFIED`. Reconciled
against `origin/main` @ `6a248ea1c359b2e86f39f9fff0b1d8577357fc10` (exact PR #344 merge commit) via a
normal `git merge` (no rebase, no force-push) — zero conflicts, zero source files touched by the
reconciliation. `F2-IMG-AUDIT-003` (KVKK per-patient export completeness, §6a/§11) remains proposed only,
not implemented, not authorized by this document.
