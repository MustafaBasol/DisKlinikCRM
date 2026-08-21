# F3-1 — Tenant Model Inventory and `organizationId` Classification Foundation

| Alan | Değer |
|---|---|
| Task ID | `F3-1` |
| ClickUp | `869ed1q5v` |
| Epic | EPIC F3 — Tenant Data Protection, Prisma Guard ve RLS PoC |
| Repository phase mapping | The repository tracks tenant/RLS execution under **F5** ([phases/F5_TENANT_RLS_AND_DATABASE.md](../phases/F5_TENANT_RLS_AND_DATABASE.md)), whose entry conditions are **NOT satisfied**. F3-1 is classification-only foundation work and does **not** enter F5 — see §7. |
| Branch | `feature/f3-1-tenant-model-classification-foundation` |
| Base | `origin/main` @ `3cc37474de829960e35015c08b578f7b7f1cbfa0` |
| Schema changed | **NO** |
| Migration created | **NO** |
| Runtime behavior changed | **NO** |
| Production mutation | **NONE** |

---

## 1. What this task delivers

An **executable, CI-enforced** answer to "who owns this table", for every model in
`server/prisma/schema.prisma`, that F3-2 (TenantContext + Prisma/data-access guard) and F3-3
(PostgreSQL FORCE RLS PoC) can consume without re-deriving it.

Two files carry the whole deliverable:

| File | Kind | Purpose |
|---|---|---|
| `server/src/utils/tenantModelClassification.ts` | production code (data + pure lookups) | The canonical registry: one entry per Prisma model, plus fail-closed lookup helpers. No Prisma import, no I/O, no request-path work. |
| `server/src/tests/tenantModelClassification.test.ts` | test / CI enforcement | Parses the real `schema.prisma` and holds the registry to it in both directions. Fails CI on drift. |

Supporting changes:

| File | Kind | Purpose |
|---|---|---|
| `server/package.json` | build wiring | Adds `test:tenant-model-classification`; enrols it in `server:test:non-disposable` (CI Layer 2) and the legacy `test` chain. |
| `scripts/architecture-guardrail/config/domain-map.json` | tooling config | Maps the new file to `core-tenant-security`, the domain that already owns `utils/clinicScope.ts` and `utils/tenantGuard.ts`, so the advisory guardrail classifies its edges instead of reporting `UNRESOLVED`. |

This task deliberately produces **no new inventory prose**. The narrative that already exists
([../../architecture/tenant-rls-pgbouncer-poc-design.md](../../architecture/tenant-rls-pgbouncer-poc-design.md),
`docs/architecture/evidence/f0-009-tenant-model-inventory.json`) is F0-009 design input and is now
**superseded as the operative classification** by the registry, which is the only copy CI checks.

---

## 2. Current-state reconciliation against `origin/main`

F0-009's inventory was taken at commit `9669b06aa19035d45ccdec85837b71c9e4e8512d` and recorded
**91 models**. `schema.prisma` at `3cc3747` declares **114**.

- **Added since F0-009: 23.** `PatientEmergencyContact`, `PatientContactPoint`,
  `PatientMedicalHistory`, `MedicalCondition`, `PatientCondition`, `InventoryUnit`,
  `PlatformAdminAuditEvent`, `PatientLegacyConsentCorrection`, `FileBackupRun`, `FileBackupEntry`,
  `RecoveryDrillRun`, `ExternalCalendarIntegration`, `ExternalCalendarMapping`,
  `ExternalCalendarInboundEvent`, `ExternalCalendarAppointmentLink`, `MigrationRun`,
  `MigrationRunBatch`, `MigrationFieldMapping`, `MigrationReferenceMap`, `MigrationRecord`,
  `MigrationRowOutcome`, `MigrationPreservedSourceValue`, `PatientIdentityDocument`.
- **Removed since F0-009: 0.** Every model F0-009 classified still exists under its original name.

Every one of the 23 was unclassified until this task. That is precisely the failure mode the new
test suite converts from silent to loud: 23 tables — including patient medical history, patient
identity documents and the whole clinic-data-migration surface — reached `main` without anyone
being forced to record who owns them.

### 2.1 Classifications that changed relative to F0-009

These are corrections, not schema drift, unless stated otherwise.

| Model | F0-009 | F3-1 | Why |
|---|---|---|---|
| `CommunicationConsentConflictBucket` | `ambiguous_nullable_tenant` | `CLINIC_SCOPED_DIRECT` | **F0-009 was wrong.** `git show 9669b06:server/prisma/schema.prisma` shows `organizationId String` and `clinicId String` — both already NOT NULL at F0-009's own baseline. It was named in F0-009's own correction note as one of the four ambiguous entries; it never was one. |
| `Clinic` | `clinic_scoped_direct` | `ORGANIZATION_SCOPED_DIRECT` | `Clinic` has no `clinicId` column; its own `id` **is** the clinic identity and its only tenant column is a NOT NULL `organizationId`. Filing it as clinic-scoped invited a guard to look for a column that does not exist. |
| `JobLock` | `platform_global` | `SYSTEM_INTERNAL` | Distinguishing infrastructure state from platform *application* data is exactly the point of the new class. A scheduler lock is not "global data every tenant may read". |
| `SecurityIncidentActivity` | `child_via_parent` | `EXPLICIT_REVIEW_REQUIRED` | It derives tenant identity from `SecurityIncident`, which F0-009 itself classified ambiguous. Ambiguity is inherited, not resolved; calling the child "parent-safe" would have let a guard treat it as tenant-safe by transitivity. A dedicated test now forbids that shape. |

The other three F0-009 `ambiguous_nullable_tenant` entries (`SecuritySignalEvent`,
`SecurityIncident`, `MessagingInboundEvent`) were re-verified against the current schema and remain
ambiguous. `ExternalCalendarInboundEvent`, added since F0-009, has the same pre-resolution shape and
joins them.

---

## 3. Classification summary

| Class | Count |
|---|---|
| `ORGANIZATION_SCOPED_DIRECT` | 9 |
| `CLINIC_SCOPED_DIRECT` | 82 |
| `PARENT_SCOPED` | 8 |
| `PLATFORM_GLOBAL` | 6 |
| `SYSTEM_INTERNAL` | 4 |
| `EXPLICIT_REVIEW_REQUIRED` | 5 |
| **TOTAL** | **114** |

Guard-mode distribution (intent recorded for F3-2; nothing is enforced at runtime by F3-1):
`AUTO_FILTER_DUAL_KEY` 31 · `AUTO_FILTER_CLINIC_ID` 51 · `AUTO_FILTER_ORGANIZATION_ID` 9 ·
`PARENT_OWNERSHIP_VALIDATION` 8 · `NO_TENANT_FILTER` 6 · `SYSTEM_CONTEXT_ONLY` 4 ·
`BLOCKED_PENDING_REVIEW` 5.

### 3.1 `EXPLICIT_REVIEW_REQUIRED` (5) — not tenant-safe, must not be guarded by guess

| Model | Why ownership cannot be inferred |
|---|---|
| `SecuritySignalEvent` | `organizationId` and `clinicId` are both nullable **by design**: a failed login or unauthenticated probe legitimately has no tenant. |
| `SecurityIncident` | Same nullable pair, plus a platform-admin-only lifecycle. A cross-tenant incident is a real state, so no single-tenant predicate is correct. |
| `SecurityIncidentActivity` | No tenant column; would inherit from `SecurityIncident`, which is itself unresolved. |
| `MessagingInboundEvent` | Raw inbound webhook envelope persisted **before** the connection is resolved; both tenant columns are frequently null on arrival. |
| `ExternalCalendarInboundEvent` | Same pre-resolution shape for calendar-provider webhooks. |

`assertTenantOwnershipResolved()` throws for all five, and the test suite proves it does.

### 3.2 `PLATFORM_GLOBAL` (6) and `SYSTEM_INTERNAL` (4)

`PLATFORM_GLOBAL`: `MedicalCondition`, `Plan`, `PlatformAdmin`, `PlatformSetting`,
`PlatformAdminAuditEvent`, `PlatformSmsProvider`.

`SYSTEM_INTERNAL`: `JobLock`, `FileBackupRun`, `FileBackupEntry`, `RecoveryDrillRun`.

Both are **positive assertions** carrying a recorded rationale, never a default: a test fails if a
model in either class has no rationale, and a second test fails if a `PLATFORM_GLOBAL` model
declares any tenant column at all. `FileBackupEntry` is the one deliberate judgement call — it
carries a denormalized `clinicId` with **no FK to `Clinic`** and no tenant-facing read path, so it is
recorded as system evidence with `rls: REQUIRES_DESIGN_REVIEW` rather than promoted to
clinic-scoped, which would imply a tenant read surface that does not exist.

### 3.3 Models that likely need future schema work

Recorded in the registry as `futureSchemaWork`; **no migration is created by this task**.

| Model | Recorded requirement |
|---|---|
| `SentMessage` | `ORGANIZATION_ID_NOT_NULL` — the column exists but is still nullable (legacy backfill gap). |
| `ClinicInvitation` | `ORGANIZATION_ID_NOT_NULL` — same. |
| `SecuritySignalEvent`, `SecurityIncident`, `SecurityIncidentActivity`, `MessagingInboundEvent`, `ExternalCalendarInboundEvent` | `TENANT_OWNERSHIP_DECISION_REQUIRED` — the answer may or may not turn out to be a schema change; it is an F3-2/F3-3 design decision first. |

**No blanket "every clinic-scoped model needs `organizationId`" claim is made.** The 51 models with
`clinicId` and no organization column reach organization identity through
`clinicId -> Clinic.organizationId`, which is NOT NULL and FK-enforced; the registry records that
path explicitly as `organizationDerivedVia`, and a test asserts the hop still exists and stays NOT
NULL. Whether F3-3 needs that denormalized onto each table for an RLS predicate is an F3-3
measurement, not an F3-1 assertion.

---

## 4. Drift detection (what now fails CI)

`server/src/tests/tenantModelClassification.test.ts`, database-free, run in CI Layer 2
(`server:test:non-disposable`).

| Required behavior | Enforced by |
|---|---|
| **A** — every Prisma model is classified | Set difference schema → registry; plus count equality, no duplicates, and registry order must match `schema.prisma` declaration order. |
| **B** — no stale entries | Set difference registry → schema; plus every declared `PARENT_SCOPED` target model must exist. |
| **C** — declared ownership fields are real | `organizationId`/`clinicId` presence **and nullability** must match the schema exactly; `CLINIC_SCOPED_DIRECT` must have NOT NULL `clinicId`; `ORGANIZATION_SCOPED_DIRECT` must have NOT NULL `organizationId` (`Organization` itself excepted and required to say why); `AUTO_FILTER_DUAL_KEY` requires both NOT NULL; `PARENT_SCOPED` must name a real, to-one, non-optional, FK-bearing relation with a non-nullable FK scalar, and must have no tenant column of its own; the `clinicId -> Clinic.organizationId` hop must still exist and stay NOT NULL. |
| **D** — global models are explicit | A model without `clinicId` must still be classified; `PLATFORM_GLOBAL`/`SYSTEM_INTERNAL`/`PARENT_SCOPED`/`EXPLICIT_REVIEW_REQUIRED` must each carry a rationale; `PLATFORM_GLOBAL` may not declare a tenant column, derive an organization, or inherit from a parent; guard mode and RLS candidacy must be consistent with the classification; a nullable `organizationId` may not be recorded as `futureSchemaWork: NONE`. |
| **E** — ambiguity stays visible | `EXPLICIT_REVIEW_REQUIRED` must be `BLOCKED_PENDING_REVIEW` + `REQUIRES_DESIGN_REVIEW` + `TENANT_OWNERSHIP_DECISION_REQUIRED` + rationale; `isTenantGuardApplicable()` must return false and `assertTenantOwnershipResolved()` must throw for each; **no `PARENT_SCOPED` model may inherit from a parent that is not itself tenant-owned**; an unknown model throws rather than defaulting to global; the registry is frozen. Every run prints the per-class counts, the review list and the future-schema-work list. |

A parser-sanity test guards the guard: if the schema parser regresses (for example on Windows CRLF
line terminators — this repository checks `schema.prisma` out with CRLF, and a parser splitting on
bare `\n` would leave a trailing `\r` on every token and match nothing), it fails loudly instead of
reporting "no tenant columns anywhere" as all-clear.

---

## 5. What this prevents, and what it does not

**Prevents (from this commit forward):**

- A new Prisma model reaching `main` with nobody having decided whether it is tenant-owned.
- A model losing its `clinicId`/`organizationId`, or having it silently relaxed to nullable, while
  something still claims it is directly scoped.
- A renamed or deleted model leaving a stale classification behind that a future guard would trust.
- A `PARENT_SCOPED` child being treated as tenant-safe when its parent's ownership is unresolved.
- A future guard defaulting an unknown or ambiguous model to "global" — every lookup fails closed.

**Does NOT prevent (unchanged, still open):**

- Any actual cross-tenant read or write at runtime. **Nothing here executes on a request path.**
  Tenant isolation today is still exactly what it was: application-layer `where` clauses built by
  `utils/clinicScope.ts` and `middleware/clinicAccess.ts`. F3-1 adds no enforcement.
- Raw-SQL paths, which bypass any future Prisma-level guard entirely. F0-009's raw-SQL inventory
  stands as the input for that; F3-1 deliberately did not re-audit it.
- Anything at the database level. There is no RLS, no DB role separation, no PgBouncer work.

**Residual risk carried into F3-2/F3-3:** the registry states intent (`guardMode`, `rls`) that no
code yet honors. It must not be read as "these models are protected". Until F3-2 ships, a
classification error here is a *documentation* error, not an exposure — which is the point of doing
it first.

---

## 6. Boundaries respected

- **No `schema.prisma` change, no migration, no DB mutation.** Verified by `git diff --stat`.
- **No F3-2 work:** no `AsyncLocalStorage` TenantContext, no Prisma `$extends`, no `runAsTenant` /
  `runAsSystem`, no query rewriting, no request transaction wrapping. The exported helpers are pure
  lookups over a frozen constant; they reject unknown/ambiguous models but enforce nothing.
- **No F3-3 work:** no RLS, no policies, no DB roles, no `DATABASE_URL` topology change, no
  PgBouncer.
- **No cross-domain import.** The registry lives in `core-tenant-security` alongside
  `utils/clinicScope.ts`; it imports nothing, so it creates no edge in either direction. No clinical
  module was touched.
- **Zero production runtime impact.** Static data plus lookups; no schema parsing outside the test,
  no reflection, no request-path evaluation.
- **Parallel-lane safety.** No odontogram file, no `ToothRecord` change, no dental-chart frontend
  file, no `schema.prisma`, no migration directory was touched.

---

## 7. Freeze-boundary assessment (for architecture review)

[KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](../KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md) §2 row 15 ("Tenant
scoping") records permitted work as *"documentation, F0-009 PoC design only"* and prohibits *"RLS
migrations, `organizationId` backfills, tenant-extension rollout"*, unblocking on KVKK baseline
stabilization plus F5 entry.

F3-1 performs **none of the three prohibited items** and changes no runtime behavior, but it is
**not documentation-only** — it adds repository code and CI enforcement. This is flagged rather than
assumed: the program owner should confirm that an executable, non-runtime classification registry
falls inside row 15's permitted scope. If it does not, the rollback in §9 is a single revert with no
database or deployment consequence.

`F5` remains `TODO` and is **not** entered by this task. No ADR is moved: `ADR-004` and `ADR-005`
stay `NEEDS_POC`.

---

## 8. Backward compatibility

No existing behavior changes. Two new files, one of which is a test; three added lines in
`server/package.json` (a new script plus its enrolment in two existing chains); one added line in an
advisory tooling config. No existing test was weakened, deleted, or had an assertion removed. No
runtime module imports the registry yet.

---

## 8.1 Test evidence

All commands run from a clean worktree at `origin/main` @ `3cc3747` + this change, with the
worktree`s own `npm ci` (no shared `node_modules` junction).

| Command | Result |
|---|---|
| `npm run test:tenant-model-classification` (server) | **28 passed / 0 failed**, ~1.1s |
| `npm run typecheck` (server; `prisma generate && tsc --noEmit`) | **PASS**, 44s |
| `npm run server:test:non-disposable` (server; the CI Layer 2 chain this suite joins) | **exit 0** — an `&&` chain, so every member passed |
| `npm run typecheck:guardrail` (root) | **PASS** |
| `npm run guardrail:test` (root) | **74 passed / 0 failed** |
| `npm run guardrail:scan` (root, advisory/report-only) | **exit 0**; 1200 pre-existing advisory findings, **0** of which involve the new file |

Focused tenant/clinic-scope regression suites, run individually:

| Suite | Result |
|---|---|
| `test:roles` (multi-branch access + role permissions) | exit 0, all passed |
| `test:schedule` | 41 ✓ / 0 ✗ |
| `test:orgdash` | 35 ✓ / 0 ✗ |
| `test:treatment-case-scope` | exit 0, all passed |
| `test:reports-clinic-scope` | 16 ✓ / 0 ✗ |
| `test:appointment-request-record-scope` | 13 ✓ / 0 ✗ |
| `test:dental-chart-clinic-scope` | 17 ✓ / 0 ✗ |
| `test:kvkk-high006-batch3` | 31 ✓ / 0 ✗ |
| `test:patients-import-clinic-scope` | 14 ✓ / 0 ✗ |
| `test:messages-record-scope` | 21 passed / 0 failed |
| `test:migration-patient-schema-drift` (sibling schema-drift guard) | 31 passed / 0 failed |

### Negative verification — the guard was proven to fire, not assumed to

Each mutation below was injected into the registry, the suite re-run, and the registry restored
byte-for-byte (`git status` clean afterwards). `schema.prisma` was never touched.

| Injected defect | Result |
|---|---|
| Registry entry for `Patient` deleted (simulates a new, unclassified Prisma model) | **24 passed / 4 failed**, exit 1 — `these Prisma models have no tenant classification: Patient` |
| `ToothRecord` entry renamed to `ToothRecordRenamed` (simulates a deleted/renamed model) | **24 passed / 4 failed** — `these classification entries reference models that no longer exist: ToothRecordRenamed` |
| `ToothRecord` claims an `organizationId` column it does not have | **fails** — `ToothRecord: registry declares organizationId, schema has none` |
| `SecurityIncident` laundered from `EXPLICIT_REVIEW_REQUIRED` to `CLINIC_SCOPED_DIRECT` | **fails on 4 independent assertions** — nullable `clinicId`, missing `organizationDerivedVia`, guard-mode mismatch, RLS-candidacy mismatch |

No existing test was weakened, skipped, or had an assertion removed.

## 9. Rollback

```text
revert the F3-1 commit / PR
```

No database rollback. No data rollback. No production migration rollback. No deployment step to
undo. Reverting removes two files and restores three lines of `package.json` and one line of
`domain-map.json`; nothing at runtime references the registry, so nothing breaks.

---

## 10. Recommended next task

**`F3-2` — TenantContext and Prisma/data-access guard PoC**, consuming
`requireTenantClassification()` / `assertTenantOwnershipResolved()` from this registry rather than
re-deriving ownership.

**Sequencing caveat:** F3-2 touches Prisma runtime wiring. The `US-02.8` / `US-02.1` odontogram lane
is still active and may touch `schema.prisma` and migrations. F3-1 was safe to run in parallel
because it touches neither; **F3-2 is not**. Wait for the odontogram branch to merge and `main` to
be stable before starting F3-2, or scope F3-2's first slice to a model set the odontogram lane
provably does not touch.

Before F3-2 begins, the five `EXPLICIT_REVIEW_REQUIRED` models need an ownership decision — they are
the only models a guard cannot be written for.
