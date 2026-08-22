# F3-2 — TenantContext and Prisma/Data-Access Guard

| Alan | Değer |
|---|---|
| Task ID | `F3-2` |
| ClickUp | `869ed1qdm` |
| Epic | EPIC F3 — Tenant Data Protection, Prisma Guard ve RLS PoC |
| Repository phase mapping | The repository tracks tenant/RLS execution under **F5** ([phases/F5_TENANT_RLS_AND_DATABASE.md](../phases/F5_TENANT_RLS_AND_DATABASE.md)), whose entry conditions are **NOT satisfied**. F3-2 does **not** enter F5 — see §9. |
| Branch | `feature/f3-2-tenant-context-prisma-guard` |
| Base | `origin/main` @ `f3449aada443a36eb01e8654d442e0199c230271` (PR #475, F3-1 merge) |
| Input | F3-1 registry `server/src/utils/tenantModelClassification.ts` — consumed, not re-derived |
| Schema changed | **NO** |
| Migration created | **NO** |
| Guard installed on the shared Prisma client | **NO** — see §2 |
| Production mutation | **NONE** |

---

## 1. What this task delivers

ADR-002's **Layer 2**: an ambient tenant execution context, and a Prisma client
extension that consumes the F3-1 classification registry to constrain or refuse
every operation on every model.

Layer 1 (`utils/clinicScope.ts`, `middleware/clinicAccess.ts`, ~90 route files)
is **untouched and remains mandatory**. Layer 2 exists because Layer 1 has one
structural weakness that review cannot remove: a query that simply *forgets* the
predicate looks, at the call site, exactly like a query that does not need one.
The failure is silent; its blast radius is another clinic's patient data.

| File | Kind | Purpose |
|---|---|---|
| `server/src/tenancy/tenantContext.ts` | production | `AsyncLocalStorage` execution context. `runAsTenant` / `runAsSystem` / `getTenantContext` / `requireTenantContext`, a CLOSED `SystemContextReason` union, and the nesting rules. |
| `server/src/tenancy/prismaTenantGuard.ts` | production | The Prisma `$extends` query extension. Per-operation, per-guard-mode enforcement; the whole decision core is exported as a pure function so it can be tested without PostgreSQL. |
| `server/src/tenancy/tenantGuardErrors.ts` | production | Typed refusal codes, so tests assert on `code` and never on message text. |
| `server/src/tenancy/auditedRawSql.ts` | production | The single, narrow, justification-carrying escape for raw SQL from tenant execution. |
| `server/src/tenancy/rawSqlAuditRegistry.ts` | production data | Executable per-file inventory of every raw-SQL call site in `server/src`, with a tenant-safety classification and justification for each. |
| `server/src/middleware/tenantContext.ts` | production | Establishes the context immediately after `authenticate`, from server-derived identity only. |
| `server/src/tests/tenantContext.test.ts` | test (DB-free) | 29 assertions: context semantics, fail-closed accessors, nesting, system-escalation refusal, concurrency isolation, the real Express middleware. |
| `server/src/tests/tenantGuardUnit.test.ts` | test (DB-free) | 73 assertions: every guard mode × every Prisma operation, write integrity, nested writes, raw SQL, fail-closed defaults. |
| `server/src/tests/rawSqlTenantAudit.test.ts` | test (DB-free, CI-enforced) | 12 assertions: re-scans `server/src` and fails CI if raw SQL appears unclassified, or a classified file's call-site count drifts. |
| `server/src/tests/tenantSystemContextInventory.test.ts` | test (DB-free, CI-enforced) | 16 assertions: every background job has a system context; every access to the five unresolved models is declared, counted and justified. |
| `server/src/tests/dbVerification/tenantGuardIsolation.test.ts` | test (Layer 3) | 36 assertions against a real disposable PostgreSQL: cross-organization and cross-clinic isolation, bulk-write counts, transactions, concurrency. |
| `server/src/tests/dbVerification/tenantGuardBenchmark.ts` | measurement | Guard overhead, end-to-end and rewrite-only. Asserts nothing; deliberately not in any CI chain. |

Supporting changes: `server/package.json` (five new scripts; four enrolled in
CI Layer 2, one in Layer 3), `scripts/architecture-guardrail/config/domain-map.json`
(six files mapped to `core-tenant-security`).

Runtime files edited, and why, in §3.

---

## 2. The most important sentence in this document

**The guard is not installed on `server/src/db.ts`.**

`db.ts` is byte-identical to `main`. Every one of the ~90 route files still
receives a plain, unextended `PrismaClient`, and the only place a guarded client
exists is inside two test files that construct one explicitly with
`createTenantGuardedClient(prisma)`.

That is deliberate, and it is the boundary this task refuses to cross alone:
installing the extension on the shared client is *"Prisma tenant extension
rollout"*, [NORAMEDI_MASTER_TRACKER.md §8](../NORAMEDI_MASTER_TRACKER.md#8-blocked-tasks-bloklu-i̇şler)
item 4, which is `BLOCKED`. What ships here is the mechanism plus the evidence,
so that the rollout decision is made against measurements instead of intent.

The one thing that *is* wired into the request path — the context middleware —
filters nothing. With no extension installed, establishing a context is
observably inert; §7's test evidence includes a direct assertion that the shared
client still returns another tenant's row, precisely so that "we did not
silently roll out" is a checked fact rather than a claim.

---

## 3. Runtime files changed

Eleven files, in three groups. None changes behaviour with the guard uninstalled.

### 3.1 Request boundary (1 file)

| File | Change |
|---|---|
| `server/src/index.ts` | One `app.use('/api', tenantContextMiddleware)` immediately after the global `authenticate` mount, plus its import. That mount point is the whole reason this is a two-line change instead of a ninety-file one. |

### 3.2 Background work (4 files)

`AsyncLocalStorage` does not cross a scheduler boundary: a cron callback starts
a fresh async chain with no context, so under the guard every job would refuse
every tenant-owned model — at 03:00, with nobody watching.

| File | Change |
|---|---|
| `server/src/utils/jobLock.ts` | `withJobLock` runs its callback inside `runAsSystem({ reason: 'background-job', detail: name })`. **One edit covers eleven of the fifteen job files**, because they all already funnel through this function to take their lease. |
| `server/src/jobs/recoveryStatusJob.ts` | Declares its own context: deliberately lock-free (atomic temp-file+rename write). |
| `server/src/jobs/clinicBulkExportWorker.ts` | Declares its own context: deliberately lock-free, because a cluster-wide named lock would serialize every replica and defeat the multi-replica throughput this worker exists for. |
| `server/src/jobs/fileBackupJob.ts` | **Unchanged.** Its lease — and therefore its context — is taken one level deeper, inside `fileBackupService.runFileBackup()`. Asserted rather than assumed. |

Writing the inventory test is what found the last two. The first version of that
test matched the bare token `withJobLock` anywhere in a file, and
`recoveryStatusJob.ts` — the one job that deliberately does *not* take a lease —
passed it, because its doc comment **explains that it does not take one**. The
scanner now ignores comment lines, and with that fixed it immediately surfaced
`clinicBulkExportWorker.ts` as a job with database access and no context at all.

### 3.3 The five unresolved models (5 files)

See §5 for the decision. The edits are mechanical consequences of it: every
access to `SecuritySignalEvent`, `SecurityIncident`, `SecurityIncidentActivity`,
`MessagingInboundEvent` or `ExternalCalendarInboundEvent` now runs inside an
explicit `runAsSystem({ reason })`.

| File | Reason declared | Sites |
|---|---|---|
| `server/src/services/security/securitySignalService.ts` | `security-signal-recording` | 2 |
| `server/src/services/security/securityDetectionRules.ts` | `security-signal-recording` | 2 |
| `server/src/services/security/securityIncidentService.ts` | `security-incident-lifecycle` | 24 |
| `server/src/services/messagingInboundIdempotency.ts` | `inbound-webhook-envelope` | 3 |
| `server/src/services/externalCalendar/externalCalendarIdempotency.ts` | `inbound-webhook-envelope` | 4 |

`securityIncidentService.ts` uses a thin exported wrapper delegating to a
renamed `…Inner` function, so that no existing function body was re-indented and
the diff stays reviewable.

---

## 4. The TenantContext contract

```ts
type ExecutionContext = TenantExecutionContext | SystemExecutionContext;

interface TenantExecutionContext {
  mode: 'TENANT';
  organizationId: string;
  clinicScope: { kind: 'EXPLICIT'; clinicIds: readonly string[] } | { kind: 'ORGANIZATION_WIDE' };
  actor: { kind: 'USER' | 'PLATFORM_ADMIN' | 'SERVICE'; id: string | null; sessionId?: string };
  correlationId?: string;   // req.id when one already exists; never generated here
}

interface SystemExecutionContext {
  mode: 'SYSTEM';
  reason: SystemContextReason;  // CLOSED union, validated at runtime
  detail?: string;              // e.g. the JobLock name. Never PII.
  actor: ExecutionActor;
  correlationId?: string;
}

runAsTenant(context, fn)      // enter a tenant
runAsSystem({ reason }, fn)   // enter declared tenant-independent work
getExecutionContext()         // either, or undefined
getTenantContext()            // TENANT only, or undefined
getSystemContext()            // SYSTEM only, or undefined
requireTenantContext()        // TENANT or THROW  <- the fail-closed accessor
isSystemContext()
describeExecutionContext()    // short, identifier-free string for logs
```

Every field is copied from `req.user`, which `middleware/auth.ts` builds from a
verified session plus a fresh database read. **No field comes from a header,
query parameter or body.** `?clinicId=` and `X-Clinic-Id` are deliberately
IGNORED by the middleware: they select a *view* inside the user's authorized set
and are validated by Layer 1 on every use, so letting them narrow — or widen —
the guard's boundary would put a client-supplied value on the security path.

**`canAccessAllClinics` becomes `ORGANIZATION_WIDE`, not a copy of
`allowedClinicIds`.** For an OWNER, `allowedClinicIds` holds only explicitly
assigned clinics, routinely a subset and often empty; copying it would silently
under-scope exactly the users who need org-wide dashboards. The guard resolves
the real set once, lazily, through the unguarded client, and only when a
clinic-only model is actually touched — an organization-scoped read costs no
extra query, which is asserted.

### 4.1 Nesting

| Inner ↓ / Outer → | none | SYSTEM | TENANT (same org) | TENANT (other org) |
|---|---|---|---|---|
| `runAsTenant` | allowed | allowed | allowed (narrowing) | **THROWS** `TENANT_CONTEXT_CROSS_ORGANIZATION_REENTRY` |
| `runAsSystem` | allowed | allowed | **only 3 allowlisted reasons** | — |

### 4.2 System execution is narrow by construction

Seven reasons exist. Three of them may escalate from inside an active tenant
request, and each has a specific justification:

| Reason | Escalates from a tenant request? | Why |
|---|---|---|
| `security-signal-recording` | **yes** | A cross-tenant denial is detected DURING the denied request. Recording it "as the denied tenant" would misattribute the incident; not recording it loses the alert silently. |
| `security-incident-lifecycle` | **yes** | Same origin, via `upsertIncidentFromSignal`. |
| `database-health-check` | **yes** | A probe route may sit behind `authenticate`. |
| `background-job` | no | Reaching it from a request is a routing defect. |
| `inbound-webhook-envelope` | no | Every writer is a public route above the `authenticate` mount. |
| `platform-administration` | no | Platform routes mount above `authenticate`. |
| `clinic-data-migration` | no | Migration execution is not a tenant request. |

There is no boolean bypass, no `skipTenantCheck`, and no free-text reason: the
union is validated at runtime as well as at compile time, so a JS caller or an
`as any` cast cannot invent one.

### 4.3 A real trap this task hit, and now pins

`AsyncLocalStorage` propagation and *lazy* promises interact badly, and the
naive implementation is wrong:

```ts
storage.run(ctx, () => prisma.patient.findMany())    // WRONG — silently unscoped
```

A `PrismaPromise` does nothing until something calls `.then` on it. The promise
is built inside the context, returned, the context exits, and only *then* does
the caller's `await` subscribe — with no store active. This is not hypothetical:
the F3-2 benchmark script hit it and died with `MISSING_TENANT_CONTEXT` on its
first guarded query, which is how it was found. `runAsTenant`/`runAsSystem` now
route through `storage.run(ctx, async () => fn())`, and
`tenantContext.test.ts` pins it with a lazy thenable that records which store was
active when it was *subscribed to* — an eager `Promise` cannot detect the
difference and would have let the regression back in unnoticed.

---

## 5. The five `EXPLICIT_REVIEW_REQUIRED` models — decision

F3-1 refused to classify these five and required a decision before any guard
could be written. **All five are SYSTEM-OWNED**, but the reasoning is not the
same for all five, and the reasons they carry differ accordingly.

| Model | Decision | Rationale | Runtime path | Schema change needed? | Registry change? |
|---|---|---|---|---|---|
| `SecuritySignalEvent` | `SYSTEM_OWNED` · reason `security-signal-recording` | Both tenant columns are nullable **by design**: a failed login or unauthenticated probe legitimately has no tenant. Its threshold rules count DISTINCT resources/clinics — the breadth **is** the detection, so a tenant predicate would force the answer to 1 and disable the rule. | `securitySignalService.ts` (create, count), `securityDetectionRules.ts` (2 × findMany). Fires from inside the denied tenant request → on the escalation allowlist. | **NO** | **NO** |
| `SecurityIncident` | `SYSTEM_OWNED` · reason `security-incident-lifecycle` | A cross-tenant incident is a REAL state, and the nullable pair is what makes "this actor touched three organizations" representable. No single-tenant predicate is correct. Lifecycle is platform-admin-only. | `securityIncidentService.ts`, all 24 sites. `upsertIncidentFromSignal` is reached from inside a tenant request → on the allowlist. | **NO** | **NO** |
| `SecurityIncidentActivity` | `SYSTEM_OWNED` · reason `security-incident-lifecycle` | No tenant column at all; it would inherit from `SecurityIncident`, i.e. inherit the unresolved question. Kept on its parent's decision deliberately — splitting them would invite drift. | Same file. | **NO** | **NO** |
| `MessagingInboundEvent` | `SYSTEM_OWNED` · reason `inbound-webhook-envelope` | The raw provider envelope, written BEFORE routing resolves which connection (and so which clinic) it belongs to. A guard demanding a tenant on insert would make the idempotency record impossible to write, and losing it means reprocessing a duplicate inbound message. | `messagingInboundIdempotency.ts` (create + 2 updates) from public webhook routes; retry/retention sweeps via `withJobLock`. **Not** on the escalation allowlist — every writer is above the `authenticate` mount, so reaching it from a tenant request would be a routing defect and should throw. | **NO** | **NO** |
| `ExternalCalendarInboundEvent` | `SYSTEM_OWNED` · reason `inbound-webhook-envelope` | Identical pre-resolution shape for calendar-provider webhooks. | `externalCalendarIdempotency.ts` (create + 3 updates); retry/retention sweeps via `withJobLock`. Same allowlist exclusion. | **NO** | **NO** |

**No schema change and no registry change is required by this decision**, which
is the point of making it explicitly: F3-1 recorded `TENANT_OWNERSHIP_DECISION_REQUIRED`
as future schema work *because the answer might have been a schema change*. It
is not. The nullable tenant columns on all five are correct as they stand, and
`futureSchemaWork` stays as F3-1 recorded it (the registry field means "the
question is open"; this document is the answer, and changing the registry would
be an F3-1 edit that CI has no way to validate against a decision it cannot see).

**Ownership immutability after resolution** was considered and deliberately NOT
implemented: `MessagingInboundEvent`/`ExternalCalendarInboundEvent` have their
tenant columns populated later by the routing step, so a hard immutability rule
would break the very backfill that resolves them. That remains an open F3-3/F5
question (it is also F0-009 §14 item 4, still unresolved).

`tenantSystemContextInventory.test.ts` §B enforces this decision: the five are
scanned for, every accessing file is declared with its mechanism, reason,
justification and call-site count, and a new file touching one of them fails CI
until it is classified.

---

## 6. Prisma enforcement coverage

### 6.1 By guard mode

| Guard mode | Models | Read | Write | Status |
|---|---|---|---|---|
| `AUTO_FILTER_DUAL_KEY` | 31 | `organizationId = ctx.org AND clinicId IN ctx.clinics` | both fields validated; injected on create | **SUPPORTED** |
| `AUTO_FILTER_ORGANIZATION_ID` | 9 | `organizationId = ctx.org` (or `id = ctx.org` for `Organization`) | org validated/injected; a *supplied* clinicId is still validated, never invented | **SUPPORTED** |
| `AUTO_FILTER_CLINIC_ID` | 51 | `clinicId IN ctx.clinics` | clinic validated; injected on create when unambiguous | **SUPPORTED** |
| `PARENT_OWNERSHIP_VALIDATION` | 8 | relation predicate through the single declared owning relation | parent FK fetched and its ownership proved before the write | **SUPPORTED** |
| `NO_TENANT_FILTER` | 6 | pass through (that is what platform-global means) | **FAIL_CLOSED** from tenant execution | **SPECIALIZED** |
| `SYSTEM_CONTEXT_ONLY` | 4 | **FAIL_CLOSED** | **FAIL_CLOSED** | **FAIL_CLOSED** |
| `BLOCKED_PENDING_REVIEW` | 5 | **FAIL_CLOSED** | **FAIL_CLOSED** | **FAIL_CLOSED** |
| unknown model | — | **FAIL_CLOSED**, in every context including SYSTEM | same | **FAIL_CLOSED** |
| no execution context | — | **FAIL_CLOSED** for tenant-owned models | same | **FAIL_CLOSED** |

`AUTO_FILTER_ORGANIZATION_ID`'s write rule is the one place the distinction
between "the column exists" and "the guard mode owns it" matters. `AuditLog`
carries a NULLABLE `clinicId` while being organization-scoped: injecting a
clinic into an organization-level audit row would be wrong, while accepting
another tenant's clinic id would be worse. It is validated when supplied and
never invented.

### 6.2 By Prisma operation

All 17 model operations the generated client exposes are classified; an
unclassified operation is refused, and `unclassifiedModelOperations()` plus a
test hold the taxonomy to the client's own list.

| Operation | Mechanism | Status |
|---|---|---|
| `findUnique`, `findUniqueOrThrow` | predicate merged into `where`, unique key preserved at the top level | **SUPPORTED** |
| `findFirst`, `findFirstOrThrow`, `findMany` | `where` merge | **SUPPORTED** |
| `count`, `aggregate`, `groupBy` | `where` merge (incl. `args === undefined`) | **SUPPORTED** |
| `create` | data validated + ownership injected; nested payloads walked | **SUPPORTED** |
| `createMany`, `createManyAndReturn` | every element validated | **SUPPORTED** |
| `update`, `updateMany`, `updateManyAndReturn` | `where` merge **and** data validated (ownership fields may move within the caller's own tenant, never out of it) | **SUPPORTED** |
| `delete`, `deleteMany` | `where` merge | **SUPPORTED** |
| `upsert` | `where` merge + BOTH branches validated | **SPECIALIZED** — see §6.4 |
| `$queryRaw`, `$queryRawUnsafe`, `$executeRaw`, `$executeRawUnsafe` | refused from tenant execution | **FAIL_CLOSED** |

### 6.3 The load-bearing Prisma assumption, verified

Merging a predicate into a *unique* `where` relies on Prisma's extended
where-unique behaviour (`WhereUniqueInput` is `AtLeast<unique key & full filter
set>`). If Prisma accepted the extra filters type-wise and ignored them at
runtime, the whole unit suite would still be green and every single-row read
would be unguarded.

`tenantGuardIsolation.test.ts` §A tests that claim first, against a real
database, with plain unextended Prisma: a `findUnique` carrying a non-matching
extra filter returns `null`, one carrying a matching filter still returns the
row, and an `update` with a non-matching filter throws instead of updating.
**Verified.** The merge also *spreads* rather than nesting, because burying the
unique key inside `AND` would make Prisma reject the call outright.

### 6.4 Nested writes

The guard walks nested relation payloads using Prisma's runtime DMMF (trimmed in
Prisma 7 to `{ name, kind, type, relationName }` — enough to map a relation
field to its target model; to-one vs to-many is decided from the payload's
runtime shape instead, so nothing depends on metadata Prisma no longer ships).

| Nested key | Handling |
|---|---|
| `create`, `createMany` | recursively validated/injected for the target model |
| `connect`, `disconnect`(object), `set`, `delete`(object) | ownership of each target row **proved by fetching its ownership columns** and comparing in JavaScript |
| `connectOrCreate` | `where` resolved: a foreign match is refused; a miss falls through to a guarded `create` |
| `update`, `updateMany`, `upsert` | `where` merged, `data` validated |
| `deleteMany` | predicate merged |
| `delete: true` / `disconnect: true` | allowed — reached only through a row the top-level `where` already constrained |
| **anything else** | **`UNSUPPORTED_WRITE_SHAPE`** |

The default branch is a refusal on purpose. Prisma's nested-write grammar is
large and grows; a guard that silently ignores a key it does not recognise is a
guard a future Prisma release quietly disables.

**The ownership relation is checked before that walk, and more strictly.**
`{ clinic: { connect: { id } } }` sets `clinicId` just as surely as
`{ clinicId }` does. Leaving it to the generic walk is not good enough: `Clinic`
is *organization*-scoped, so the walk would only prove the target clinic belongs
to the caller's organization — letting a clinic-1-restricted context write into
sibling clinic 2. The ownership relation is therefore validated against the
caller's clinic SET, and the only accepted shape is `{ connect: { id } }`;
`create`, `connectOrCreate`, `disconnect` and connect-by-any-other-field are
refused rather than interpreted. This gap was found by re-reading the guard, not
by a failing test, so it now has one in both suites.

**Ownership is filled in using the caller's own input style.** Prisma inputs are
either *checked* (relation fields, no FK scalars) or *unchecked* (FK scalars, no
relation fields), and a payload may not mix them. Injecting `organizationId`
into a payload that wrote `clinic: { connect: … }` produces a
`PrismaClientValidationError` and turns a legitimate write into a hard failure.
The database-backed suite caught exactly that; the guard now injects
`organization: { connect: { id } }` when the caller used the relation form, and
the plain scalar otherwise.

Ownership proving deliberately does **not** rely on Prisma honouring extra
filters inside a *nested* unique input — that is documented for top-level
`where` and unverified for nested ones. It fetches the row's ownership columns
with the caller's unmodified `where` and compares them here. A null row is
treated exactly like a foreign row: "not yours" and "not there" are the same
answer to give.

### 6.5 What the guard deliberately does NOT do

- **Relations reached through `include`/`select` from an already-constrained
  root are not separately filtered.** Those rows are reachable only through
  foreign keys from a row the caller owns, so they are transitively bounded by
  FK integrity — but "transitively" is weaker than "unconditionally", and making
  it unconditional is exactly what F3-3's RLS layer is for. Recorded as residual
  risk in §12.
- **It does not parse SQL.** See §8.
- **`upsert` against another tenant's row does not produce a clean denial.** The
  `where` cannot match, so Prisma falls to the create branch, which the guard
  forces into the caller's own tenant; the observable outcome may be a unique
  violation rather than a tenant error. What matters — that the other tenant's
  row is untouched — is asserted directly against the database.

---

## 7. Security validation — the negative-test matrix

Every row below is an executed assertion, not a design intention.
`db` = `dbVerification/tenantGuardIsolation.test.ts` (real PostgreSQL);
`unit` = `tenantGuardUnit.test.ts`; `ctx` = `tenantContext.test.ts`.

### Read isolation

| Claim | Result | Where |
|---|---|---|
| A cannot read B's `Patient` by id (`findUnique`, `findFirst`, `findUniqueOrThrow`) | PASS | db |
| A's `findMany` returns only A's rows | PASS | db |
| A cannot read B's clinical/financial rows (clinicId-only model) | PASS | db |
| A cannot read B's organization-scoped rows (`AuditLog`) | PASS | db |
| A cannot read B's parent-scoped rows (`PaymentPlanInstallment`) | PASS | db |
| `count` / `aggregate` / `groupBy` are constrained (aggregate did not sum another tenant's money) | PASS | db |
| A clinic-1-restricted context cannot read a **clinic-2 row in its own organization** | PASS | db |
| An organization-wide context CAN read that row, and still cannot cross the organization | PASS | db |
| An empty clinic list reads nothing (`{ in: [] }`, not "everything") | PASS | db, unit |
| All 8 read operations get the predicate | PASS | unit |

### Write isolation

| Claim | Result | Where |
|---|---|---|
| A cannot `update` B's row | PASS | db |
| A cannot `delete` B's row | PASS | db |
| `updateMany` across both tenants affects **exactly 1** row | PASS | db |
| `deleteMany` across both tenants deletes **only** A's | PASS | db |
| A cannot `create` with B's `clinicId`, and no row is left behind | PASS | db, unit |
| **The pairing attack** — A's `organizationId` with B's `clinicId` — is refused | PASS | db, unit |
| An update that MOVES a row to another tenant is refused (bare value and `{ set: }`) | PASS | unit |
| Moving a row between the caller's OWN clinics is allowed | PASS | unit |
| `createMany` validates every element, not just the first | PASS | unit |
| `upsert` cannot hijack another tenant's row (asserted on the row itself) | PASS | db |
| Creating a tenant root, or rewriting its id, is refused | PASS | unit |
| An ownership field written with an operator the guard cannot evaluate is refused | PASS | unit |
| The guard never mutates the caller's own args object | PASS | unit |

### Nested and parent-scoped

| Claim | Result | Where |
|---|---|---|
| A nested `create` inherits the caller's tenant, in the database | PASS | db, unit |
| A nested `create` carrying another tenant's clinicId is refused | PASS | unit |
| A nested `connect` to another tenant's row is refused and writes nothing | PASS | db, unit |
| A parent-scoped create against another tenant's parent is refused and writes nothing | PASS | db, unit |
| A parent-scoped create against a NON-EXISTENT parent is refused (not allowed) | PASS | unit |
| A parent-scoped create with no owner at all is refused | PASS | unit |
| `connectOrCreate` matching a foreign row is refused; a miss falls to a guarded create | PASS | unit |
| An unrecognised nested key fails closed | PASS | unit |

### Fail-closed defaults

| Claim | Result | Where |
|---|---|---|
| A tenant-owned model with **no context** is refused, for every one of the 17 operations | PASS | db, unit |
| An **unknown model** is refused with no context, in tenant execution, **and under system execution** | PASS | unit |
| A `SYSTEM_INTERNAL` model is refused from tenant execution, for every operation | PASS | db, unit |
| An `EXPLICIT_REVIEW_REQUIRED` model is refused from tenant execution, for every operation | PASS | db, unit |
| All five review-required models are blocked — none was quietly reclassified | PASS | unit |
| Platform-global data is readable but **not writable** from tenant execution (and not writable with no context) | PASS | db, unit |
| All four raw operations are refused from tenant execution and with no context | PASS | db, unit |

### System execution

| Claim | Result | Where |
|---|---|---|
| The five review-required models and `JobLock` ARE reachable under system execution | PASS | db, unit |
| Raw SQL is allowed under system execution | PASS | db, unit |
| Raw SQL is allowed inside `runWithAuditedRawSql`, and refused again the moment that scope ends | PASS | unit |
| An audited scope with no justification is refused at construction | PASS | unit |
| A tenant request CANNOT escalate to system execution for any non-allowlisted reason | PASS | ctx |
| The allowlist is exactly 3 and is a strict subset of the 7 declared reasons | PASS | ctx |
| An undeclared reason is rejected at **runtime**, not only by the type system | PASS | ctx |
| A tenant slice inside a system job is constrained again, and system is restored afterwards | PASS | unit, ctx |

### Concurrency and leakage

| Claim | Result | Where |
|---|---|---|
| Two concurrent tenants on real timers never observe each other | PASS | ctx |
| 50 concurrent tenants each observe exactly their own organization, twice, across awaits | PASS | ctx |
| A system job interleaved with tenant requests never becomes one of them | PASS | ctx |
| 100 interleaved guarded reads each carry their own tenant predicate | PASS | unit |
| 12 interleaved tenants through ONE guarded client against a real database never cross-contaminate | PASS | db |
| Two concurrent requests through the real Express middleware stay isolated | PASS | ctx |
| An error thrown inside a context does not leak the context out of it | PASS | ctx |
| A **lazy thenable** returned from the callback is subscribed to inside the context | PASS | ctx |
| Entering a different organization from inside a tenant context throws | PASS | ctx |
| The context object is frozen; downstream code cannot widen its own scope | PASS | ctx |
| The middleware ignores client-supplied clinic selection entirely | PASS | ctx |
| The middleware copies the clinic list, so mutating `req.user` afterwards cannot widen it | PASS | ctx |

### Layer 1 intact

| Claim | Result | Where |
|---|---|---|
| The default exported `prisma` still has **no** predicate injected (rollout has not silently happened) | PASS | db |
| The guarded client is a distinct object; wrapping did not mutate the shared one | PASS | db |
| All pre-existing tenant/clinic-scope suites still pass unchanged | PASS | §10 |

---

## 8. Raw SQL

A Prisma-level guard structurally cannot secure raw SQL, and a guard that tried
to parse SQL to decide whether a tenant predicate was present would be a guard
that is confidently wrong. So the guard **refuses** raw SQL from tenant
execution, and the honest control over the existing statements is a reviewed
inventory that CI refuses to let drift.

`tenancy/rawSqlAuditRegistry.ts` records **36 call sites across 20 files**:

| Classification | Sites | Meaning |
|---|---|---|
| `NO_ROW_ACCESS` | 18 | `SELECT 1` probes and `pg_advisory_xact_lock` / `pg_try_advisory_xact_lock` calls. They return a lock, not data — there is no tenant boundary to cross. |
| `TENANT_SAFE_EXPLICIT_PREDICATE` | 15 | The statement's own `WHERE` carries an explicit organization/clinic predicate derived from the Layer-1 scope helpers. Raw only because of `FOR UPDATE`, `DATE_TRUNC`/`EXTRACT` group-bys, JSONB expressions, or `SET x = NULL` on a JSON column. |
| `SYSTEM_ONLY` | 3 | Reachable only outside tenant execution: the public bridge-pairing redemption (the pairing code *is* the tenant-resolution credential, so a tenant predicate would be circular), the migration executor's outcome count, and the `SecurityIncident` severity compare-and-set. |
| `NEEDS_TENANT_CONTEXT_HELPER` | 0 | — |
| `MIGRATION_OR_ADMIN_ONLY` | 0 | — |
| **`UNSAFE_BLOCKER`** | **0** | No raw path is reachable from tenant execution without a provable predicate. |

`rawSqlTenantAudit.test.ts` re-scans `server/src` every CI run and fails if a
file contains raw SQL with no entry, if a reviewed file's call-site count moves
(a NEW statement added to an already-reviewed file), or if an entry goes stale.
Keying is per file plus a count, not per line, so unrelated edits do not churn
it. Two files are excluded by name — `prismaTenantGuard.ts` and
`rawSqlAuditRegistry.ts` NAME the operations as data — and the test asserts those
exclusions still contain what justifies them.

`runWithAuditedRawSql({ registryKey, justification })` is the narrow escape for
tenant-path raw SQL. It is implemented and tested, but the existing call sites
are **not yet routed through it**: wrapping them is rollout work, and the guard
is not installed, so it would change nothing today except the diff size. The
CI-enforced registry is what stops new raw-SQL paths appearing unclassified in
the meantime.

---

## 9. Freeze-boundary assessment (for architecture review)

This section is written to be checked, not believed.

[KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md](../KVKK_ARCHITECTURE_FREEZE_BOUNDARY.md)
§3 item 12 and [NORAMEDI_MASTER_TRACKER.md §8](../NORAMEDI_MASTER_TRACKER.md#8-blocked-tasks-bloklu-i̇şler)
item 4 both list **"Prisma tenant-extension rollout"** as `BLOCKED`, gated on §5
condition 5 (an external "KVKK baseline stable" declaration), which is
unsatisfied. [tenant-rls-pgbouncer-poc-design.md](../../architecture/tenant-rls-pgbouncer-poc-design.md)
§12 goes further and, "out of caution", classifies even Stage 1 (unwired
metadata) and Stages 2-6 (guard library) as blocked.

**What this task did NOT do**, against those exact words:

- No rollout. The extension is not installed on `db.ts`, on any route, or on any
  service. Asserted by a test (§7, "Layer 1 intact").
- No schema change, no migration, no backfill, no database-role change, no
  `DATABASE_URL` topology change, no RLS, no PgBouncer.
- No production mutation of any kind.
- No tenant-scope middleware *restructuring*: `clinicScope.ts`,
  `clinicAccess.ts` and `auth.ts` are byte-identical to `main`. One additive
  `app.use` line was added after them.

**What this task DID do that is not documentation**: it added repository code
(11 runtime files touched, 6 new production modules), which §12's cautious
reading covers. That is flagged here rather than argued away.

The reason it proceeded is a merged-PR precedent that outranks a design
document under [tracker §2.1](../NORAMEDI_MASTER_TRACKER.md#21-kaynak-hiyerarşisi)
("Git commitleri, merge edilmiş PR'lar…" is source-hierarchy rank 1; the design
doc is rank 6): **F3-1 raised this identical question in its own §7 and was
merged as PR #475**, and F3-1's §10 names F3-2 as the recommended next task.
This document does not treat that as a general freeze release — it is evidence
about this lane only, and it does not extend to rollout, which stays blocked.

**`F5` remains `TODO` and is not entered.** `ADR-002` stays
`ACCEPTED_WITH_CONDITIONS`; `ADR-004` and `ADR-005` stay `NEEDS_POC` — nothing
here is PoC evidence for either, because neither RLS nor PgBouncer is touched.

If the program owner judges that §12's cautious classification should have held,
the rollback in §13 is a single revert with no database or deployment
consequence.

---

## 10. Test evidence

All commands run from a clean worktree at `origin/main` @ `f3449aa` + this
change, with the worktree's own `npm ci` (no shared `node_modules` junction), and
`prisma generate` run inside that worktree.

### New suites

| Command | Result |
|---|---|
| `npm run test:tenant-context` | **29 passed / 0 failed** |
| `npm run test:tenant-guard-unit` | **73 passed / 0 failed** |
| `npm run test:raw-sql-tenant-audit` | **12 passed / 0 failed** |
| `npm run test:tenant-system-context-inventory` | **16 passed / 0 failed** |
| `npm run test:tenant-guard-isolation` (disposable PostgreSQL 16-alpine, digest-pinned) | **36 passed / 0 failed** |
| **Total new assertions** | **166** |

### Aggregates and typecheck

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` (server; `prisma generate && tsc --noEmit`) | 0 | **PASS** |
| `npx tsc -b` (root/frontend) | 0 | **PASS** |
| `npm run server:test:non-disposable` (CI Layer 2; the `&&` chain the four DB-free suites join) | 0 | an `&&` chain, so **every member passed** |
| `npm run test:runtime:postgres` (CI Layer 3 orchestrator; provisions a digest-pinned disposable PostgreSQL 16-alpine, migrates, runs `server:test:disposable-db`, tears down) | 0 | **PASS**; `test:tenant-guard-isolation` runs last in the chain and reported **36 passed / 0 failed** |
| `npm run test:runtime:postgres-compat` (CI Layer 3-compat; `server:test:legacy-db-required`, which owns `test:security-incidents` and the consent/messaging suites this task edited) | 0 | **PASS** |
| `npm run typecheck:guardrail` (root) | 0 | **PASS** |
| `npm run guardrail:test` (root) | 0 | **74 passed / 0 failed** |
| `npm run guardrail:scan` (root, advisory/report-only) | 0 | 1209 advisory findings, of which **9 are new and all are the same intended edge**: seven callers importing `runAsSystem` from `core-tenant-security`, plus the middleware importing `AuthRequest` from `core-identity-access`. A cross-cutting security primitive being imported by the code it protects is the design, not a violation; this job never fails on findings. |
| `npm run typecheck:log-privacy-guard` (root) | 0 | **PASS** |
| `npm run test:log-privacy-guard` (root) | 0 | **39 passed / 0 failed** |
| `npm run log-privacy-guard:scan -- --strict-baseline` (root, **blocking gate**) | 0 | 308 files scanned, **no new violations**; 103 grandfathered, unchanged |

### 10.1 Focused regression suites for the files this task edited

| Suite | Result |
|---|---|
| `test:security-incidents` (55 assertions over the restructured `securityIncidentService.ts`, including its raw-SQL tenant-ownership proofs) | **55 passed / 0 failed** |
| `test:roles`, `test:schedule`, `test:orgdash`, `test:treatment-case-scope`, `test:reports-clinic-scope`, `test:appointment-request-record-scope`, `test:dental-chart-clinic-scope`, `test:kvkk-high006-batch3`, `test:patients-import-clinic-scope`, `test:messages-record-scope`, `test:tenant-model-classification` | all green — members of the Layer 2 chain above, which exited 0 |
| The six `kvkk-high006-db-*` clinic-scope suites, `whatsappPublicApiExplicitClinicBinding`, `patientIdentityDb` | all green — members of the Layer 3 chain above, which exited 0 |

**One environment note, not a regression.** The first local Layer 3 run failed at
`test:migration-execution-db` with `IDENTITY_CRYPTO_NOT_CONFIGURED`, and since the
chain is `&&`, every suite after it — including this task's — never ran.
`PATIENT_IDENTITY_ENCRYPTION_KEY` and `PATIENT_IDENTITY_LOOKUP_SECRET` have no
development fallback by design, and CI generates throwaway values for them
(`ci-layers.yml`). Re-running with the same two variables set produced exit 0.
Nothing in this task touches that path.

### Negative verification — the guard was proven to fire, not assumed to

Four of the assertions in §7 exist **because the code was wrong first**, which is
the strongest evidence available that they are not vacuous:

1. The lazy-thenable context loss (§4.3) was found by the benchmark failing with
   `MISSING_TENANT_CONTEXT`, not by inspection.
2. `clinicBulkExportWorker.ts` had no execution context at all. The first
   version of the inventory test passed it, because the scanner matched a token
   inside a **doc comment**. Fixing the scanner to ignore comments turned a
   green test red and surfaced a real gap.
3. The ownership-relation gap (§6.4): `{ clinic: { connect: { id: siblingClinic } } }`
   was accepted where the scalar equivalent was refused. Found by re-reading the
   guard; the unit suite was green throughout, because it only tested the scalar
   form.
4. Closing (3) then broke a legitimate write, because injecting the
   `organizationId` scalar beside a relation-form connect mixes Prisma's checked
   and unchecked input variants. Only the database-backed suite could see that —
   the fake port happily accepted the invalid shape.

The third and fourth together are the argument for keeping both suites: the unit
suite catches decisions the database cannot see cheaply, and the database suite
catches Prisma semantics the fake port cannot model.

---

## 11. Performance

Measured with `npm run test:tenant-guard-benchmark` against a disposable
PostgreSQL 16-alpine, Node v24.18.0, win32 x64, 400 seeded patients, 30 warmup +
300 timed iterations per figure.

The baseline is **not** "the same query with no tenant predicate" — that would
measure the cost of tenant isolation itself, which the application already pays
through `clinicScope.ts`. The baseline is the query **with the predicate a
Layer-1 route writes by hand**, so what is reported is the marginal cost of the
extension.

| Operation | Baseline median | Guarded median | Overhead |
|---|---|---|---|
| `findMany(take: 50)` | 2.831 ms | 2.893 ms | +0.062 ms (+2.2 %) |
| `findUnique(by id)` | 1.889 ms | 1.800 ms | −0.089 ms (−4.7 %) |
| `count` | 1.670 ms | 1.422 ms | −0.248 ms (−14.9 %) |
| `update(by id)` | 3.256 ms | 3.387 ms | +0.131 ms (+4.0 %) |
| `create` | 3.143 ms | 3.226 ms | +0.083 ms (+2.6 %) |
| **`create` on a `PARENT_SCOPED` model** | 2.670 ms | 4.174 ms | **+1.504 ms (+56.3 %)** |

The negative figures are the honest reading of the data: for reads, the guard's
cost is **below the run-to-run noise of a real database**, so the comparison
cannot resolve it. That is why the second measurement exists — the guard's own
CPU, with no database at all:

| Rewrite-only (20 000 iterations each) | median | p95 |
|---|---|---|
| read rewrite, `AUTO_FILTER_DUAL_KEY` | 0.002 ms | 0.004 ms |
| read rewrite, `AUTO_FILTER_CLINIC_ID` | 0.001 ms | 0.003 ms |
| read rewrite, `AUTO_FILTER_ORGANIZATION_ID` | 0.001 ms | 0.002 ms |
| read rewrite, `PARENT_SCOPED` | 0.001 ms | 0.004 ms |
| write validate, `create` | 0.004 ms | 0.007 ms |
| write validate, nested `create` | 0.009 ms | 0.019 ms |

**Reading:** the guard's own cost is 1–11 µs per operation, i.e. three orders of
magnitude below a single round trip, and not materially concerning. The one
figure that IS worth watching is `PARENT_SCOPED` create: +1.5 ms is not the
rewrite, it is the **extra ownership lookup** the guard performs before the
insert — one additional query, which is exactly what a parent-scoped write costs
when it is proved rather than assumed. Eight of the 114 models are
`PARENT_SCOPED`, and none of them is on a hot path today.

`ORGANIZATION_WIDE` contexts pay one clinic-list query per request, memoized per
context, and only when a clinic-only model is actually touched — asserted, not
assumed.

**This is a local/CI measurement. No production latency claim is made, and none
should be derived from it.** No production measurement exists.

---

## 12. Residual tenant risk carried forward

| Risk | Why it remains | Where it is closed |
|---|---|---|
| **The guard enforces nothing in production.** It is not installed. | Rollout is frozen (§9). | F5 rollout, gated on the KVKK baseline declaration |
| Relations reached via `include`/`select` from a constrained root are not separately filtered | Transitively bounded by FK integrity, not unconditionally | F3-3 RLS |
| Raw SQL call sites are classified but not yet routed through `runWithAuditedRawSql` | Wrapping them changes nothing while the guard is uninstalled | F5 rollout |
| `utils/activity.ts` holds a SECOND `PrismaClient`/`Pool`, outside `db.ts` | Pre-existing (F0-009 §2.2, §14 item 2); a future rollout must cover both client surfaces or consolidate them | F5 rollout prerequisite |
| `Clinic` rows are guarded at organization granularity, so a clinic-restricted user can still read a sibling clinic's identity row through the guard alone | The guard implements exactly what the F3-1 registry declares, and does not add rules the registry does not record. Layer 1 governs this today and remains mandatory (ADR-002). | F3-1 registry change, if the program owner wants it |
| `upsert` against a foreign row surfaces as a unique violation rather than a clean tenant error | Prisma semantics; the important property (no cross-tenant mutation) is asserted | documented, not scheduled |
| Ownership immutability after webhook tenant resolution is undecided | Would break the backfill that resolves it (§5) | F3-3 / F5, = F0-009 §14 item 4 |

---

## 13. Rollback

```text
revert the F3-2 commit / PR
```

No database rollback. No data rollback. No migration to reverse. No deployment
step to undo. Reverting removes six production modules and five test files, and
restores eleven runtime files to their `main` content; since no route, service
or client is guarded, nothing at runtime loses a behaviour it had.

---

## 14. Recommended next task

**`F3-3` — FORCE RLS + PgBouncer transaction-mode PoC**, in a disposable
environment only. See [F3-3's own evidence document](F3-3_RLS_PGBOUNCER_POC.md)
for the entry-gate assessment performed against
[tenant-rls-pgbouncer-poc-design.md](../../architecture/tenant-rls-pgbouncer-poc-design.md)
§12, which classifies "Rollout Stage 7 (disposable RLS PoC execution)" and
"Rollout Stage 9 (PgBouncer staging PoC)" as *"Allowed now: isolated disposable
PoC only"*, conditional on a task explicitly scheduling them.

Before any **rollout** of this guard, in order:

1. The KVKK baseline-stable declaration (freeze boundary §5 condition 5).
2. A decision on `utils/activity.ts`'s second Prisma client (§12).
3. Route the classified tenant-path raw SQL through `runWithAuditedRawSql`.
4. A shadow/report-only mode, so the first production exposure to
   `MISSING_TENANT_CONTEXT` is a log line rather than a 500.
