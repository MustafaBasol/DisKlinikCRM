# F2-IMG-AUDIT-002-DECIDE — Bridge ActivityLog Machine-Actor Design Decision

**Phase:** F2 — Modular Boundaries and Public Contracts
**Task ID:** F2-IMG-AUDIT-002-DECIDE
**ClickUp:** 869efu8ce
**Mode:** READ-ONLY / ARCHITECTURE DECISION
**Date:** 2026-08-09
**Branch:** `docs/f2-img-audit-002-decide`
**Baseline:** `main` @ `abc7c040430df08c5c7b81b73c2dfd2bb26000b7`

No runtime code, Prisma schema, migrations, routes, or audit/activity behavior were read-modified or
changed to produce this document. This resolves the design question deferred by
[F2-IMG-AUDIT-001_BRIDGE_DUPLICATE_AUDIT_PARITY.md](F2-IMG-AUDIT-001_BRIDGE_DUPLICATE_AUDIT_PARITY.md)
§24 and characterized (not decided) by
[F2-IMG-AUDIT-PREP-001_IMAGING_INGEST_AUDIT_ASYMMETRY_CHARACTERIZATION.md](F2-IMG-AUDIT-PREP-001_IMAGING_INGEST_AUDIT_ASYMMETRY_CHARACTERIZATION.md).

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

Yes, and this is not a design proposal — it is already how the bridge behaves for every other event on
this exact route. Post F2-IMG-AUDIT-001-FIX, all three ingest outcomes (new study, sequential-duplicate,
concurrent P2002-duplicate) write `AuditLog` rows with `actorUserId: null`/`actorRole: null` (an explicit,
nullable, already-modeled "no human actor" state), scoped correctly by `organizationId`/`clinicId`,
immutable, indexed, and — per independent, pre-existing codebase documentation found at
`server/src/services/communicationConsent/legacyConsentCorrection.ts:217-227` (unrelated feature, not
authored for this task) — explicitly treated elsewhere in this codebase as **the authoritative
compliance/evidence record**, with `ActivityLog` characterized in that same comment as a
"best-effort... operational projection" whose loss leaves "the correction row + AuditLog entry... the
sole authoritative evidence."

This is corroborating, not conclusive, evidence (it was not cross-checked against `docs/compliance/**`,
which remains out of this task's authorized inspection scope — flagged as unverified in PREP-001 §6 and
still unverified here). It is nonetheless the only concrete, pre-existing statement in the codebase about
the two tables' relative authority, and it directly supports Option A.

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
| KVKK/auditability | Already satisfied — `AuditLog` is the documented authoritative record (§4) | No compliance gain over A; duplicates an already-audited event | Same — plus a third log table to reconcile during any future audit/export work | Same, plus misattribution risk if the synthetic identity is ever mistaken for a real accountable person |
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
| `docs/program/evidence/F2-IMG-AUDIT-002_MACHINE_ACTOR_ACTIVITYLOG_DECISION.md` | New — this document |

No runtime, test, schema, migration, or route file was modified. Verified by `git status`/`git diff`
scoped outside `docs/program/evidence/`: no changes.

## 16. Explicit exclusions (per task's hard prohibitions — none of the following were done)

`ActivityLog.userId` was not made nullable. No fake/SYSTEM/synthetic `User` was created. No existing
identity (clinic owner, bridge creator) was reused for a new write. No FK constraint was relaxed. No
polymorphic actor column was added. `prisma/schema.prisma` was not modified. No migration was created.
`server/src/routes/imagingBridgePublic.ts` was not modified. No audit behavior was changed.

## 17. Merge safety

Docs-only addition under `docs/program/evidence/`. No code, schema, or test file touched. Safe to merge
once reviewed — carries zero runtime risk by construction (nothing outside this one new file changed).
